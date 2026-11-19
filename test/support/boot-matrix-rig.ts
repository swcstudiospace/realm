// The per-host-id rig of the real-daemon boot matrix (test/integration/host-boot-matrix.test.ts, TEST-HOST-06): a fresh daemon
// in this process over the existing fakes (startRealmDaemon), with its own state directory and workspace root under one
// temporary base, a daemon logger that keeps every line, and the helpers that run realm mcp and realm acp against it. The
// daemon admits at most MAX_CONCURRENT_SESSIONS (2) sessions at once, so the rig starts none of its own: the test's standing
// sibling host is the one session that keeps the daemon alive while each scenario's project is released next to it.
// It is a copy-and-narrow of test/integration/host-boot-isolation.test.ts, which keeps its own private copy.
//
// Fixtures and fakes: a real daemon over fakes, no Podman, no real host. `spawn` records and starts nothing.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { runCli, type CliResult, type ConnectDaemon } from "../../src/cli/main.js";
import type { SpawnDaemon } from "../../src/daemon/launch.js";
import { RealmError } from "../../src/core/errors.js";
import { sendRequest } from "../../src/daemon/channel.js";
import { connectDaemon, type DaemonClient, type DaemonStatus } from "../../src/daemon/client.js";
import { createLogger } from "../../src/observe/logger.js";
import { isMetricsSnapshot, type MetricsSnapshot } from "../../src/observe/metrics.js";
import type { EnvironmentLike } from "../../src/session/paths.js";
import type { FakeTimers } from "./fake-host-daemon.js";
import { startRealmDaemon, type RealmDaemonFixture } from "./realm-daemon-fixture.js";
import { callStatus, capture, FakeSignals, framesOf, toolOutcomeOf, untilPresence, untilReplyOn, type Capture } from "./stdio-host-harness.js";
import { boundedWait } from "./timing.js";

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const CLOCK_ISO = "2026-10-21T09:30:00.000Z";
// The bound on one control request, and on one host call that the daemon answers.
export const MATRIX_BOUND_MS = 5000;
const ENV: EnvironmentLike = { PATH: "/usr/bin", HOME: "/root", XDG_RUNTIME_DIR: "/run/user/0" };

// One host process: realm mcp or realm acp on injected streams and signals.
export interface MatrixHost {
  // The --host id: the name of the presence marker directory.
  readonly label: string;
  readonly result: Promise<CliResult>;
  readonly input: PassThrough;
  readonly output: Capture;
  readonly diagnostics: Capture;
  readonly signals: FakeSignals;
  readonly spawns: string[];
}

export interface MatrixHostOptions {
  readonly connect?: ConnectDaemon;
  readonly timeoutMs?: number;
  readonly logLevel?: string;
  // realm mcp only: adds --reattach.
  readonly reattach?: boolean;
  // The boot driver's timers, random source and clock: injected so a retry wait never arms a real timer.
  readonly bootTimers?: FakeTimers;
}

// A connect whose first `failures` clients reject every call with DAEMON_START_TIMEOUT, then the real connectDaemon.
export interface FlakyConnect {
  readonly connect: ConnectDaemon;
  // The attach attempts made: the injected failures that were consumed plus the clients whose up was called.
  attempts(): number;
}

export interface MatrixRig {
  readonly root: string;
  readonly stateDir: string;
  // Every line the daemon logged, at the debug level.
  readonly daemonLines: readonly string[];
  // The host-boot audit chain file the daemon writes.
  readonly auditPath: string;
  // The projects released by the test itself so far; each is one down the daemon counts.
  releases(): number;
  project(name: string): string;
  bootHost(argv: readonly string[], options?: MatrixHostOptions): MatrixHost;
  mcpHost(host: string, workspace: string, options?: MatrixHostOptions): MatrixHost;
  acpHost(host: string, workspace: string, options?: MatrixHostOptions): MatrixHost;
  // One Realm status tool call through an MCP host: the daemon's state for its project, within the control bound.
  serveStatus(host: MatrixHost, id: number): Promise<unknown>;
  // One status call whose outcome is returned whole, whether it was forwarded or refused.
  statusOutcome(host: MatrixHost, id: number): Promise<Record<string, unknown>>;
  end(host: MatrixHost): Promise<CliResult>;
  release(path: string): Promise<void>;
  downCount(): Promise<number>;
  metrics(): Promise<MetricsSnapshot>;
  sandboxState(path: string): Promise<unknown>;
  markerPath(host: string): string;
  hangingUp(): ConnectDaemon;
  flakyConnect(failures: number): FlakyConnect;
  // Every runner's stdout holds protocol frames only.
  assertFramesOnly(): void;
  stop(): Promise<void>;
}

function stateOf(outcome: Record<string, unknown>): unknown {
  const value = outcome["value"];
  assert.ok(typeof value === "object" && value !== null && "snapshot" in value, `a status value, not ${JSON.stringify(outcome)}`);
  const snapshot = value.snapshot;
  assert.ok(typeof snapshot === "object" && snapshot !== null && "state" in snapshot, "a snapshot");
  return snapshot.state;
}

export async function startMatrixRig(index: number, id: string): Promise<MatrixRig> {
  // Short names: the control socket path must stay within the platform limit.
  const base = realpathSync(mkdtempSync(join(tmpdir(), `rbm${String(index)}-`)));
  const root = join(base, "r");
  const stateDir = join(base, "s");
  mkdirSync(root, { recursive: true });
  const daemonLines: string[] = [];
  const projects: string[] = [];
  const outputs: Capture[] = [];
  let released = 0;
  const logger = createLogger({
    sink: {
      write: (line) => {
        daemonLines.push(line);
        return true;
      },
    },
    level: "debug",
    now: () => new Date(CLOCK_ISO),
  });
  const fixture: RealmDaemonFixture = await startRealmDaemon({ stateDir, workspace: root, mode: "advisory", logger });

  const project = (name: string): string => {
    const path = join(root, name);
    mkdirSync(path, { recursive: true });
    const real = realpathSync(path);
    projects.push(real);
    return real;
  };

  const stop = async (): Promise<void> => {
    for (const path of projects) {
      await fixture.release(path).catch(() => undefined);
    }
    await boundedWait(fixture.done, `the daemon of ${id} stopping after its projects were released`, 10_000).catch(() => undefined);
    rmSync(base, { recursive: true, force: true });
  };

  // Only the sibling's session and one scenario's session are ever live together (the daemon admits two).
  const bootHost = (argv: readonly string[], options: MatrixHostOptions = {}): MatrixHost => {
    const input = new PassThrough();
    const output = capture();
    const diagnostics = capture();
    const signals = new FakeSignals();
    const spawns: string[] = [];
    const spawn: SpawnDaemon = (_file, args) => {
      spawns.push(...args);
      return { unref: () => undefined };
    };
    const env: EnvironmentLike = options.logLevel === undefined ? ENV : { ...ENV, REALM_LOG_LEVEL: options.logLevel };
    outputs.push(output);
    const timed =
      options.bootTimers === undefined
        ? {}
        : { bootTimers: options.bootTimers, random: options.bootTimers.random, now: options.bootTimers.now };
    const result = runCli(argv, {
      env,
      cwd: root,
      daemonEntry: join(base, "daemon", "main.js"),
      readConfig: () => ({ image: IMAGE, stateDir, workspaceRoot: root }),
      timeoutMs: options.timeoutMs ?? MATRIX_BOUND_MS,
      spawn,
      ...(options.connect === undefined ? {} : { connect: options.connect }),
      ...timed,
      mcpInput: input,
      mcpOutput: output.stream,
      acpInput: input,
      acpOutput: output.stream,
      diagnostics: diagnostics.stream,
      signals,
    });
    return { label: argv[argv.indexOf("--host") + 1] ?? "", result, input, output, diagnostics, signals, spawns };
  };

  const metrics = async (): Promise<MetricsSnapshot> => {
    const reply = await sendRequest(
      fixture.socketPath,
      { id: "matrix-metrics", method: "metrics", params: { selection: fixture.selectionFor(root) } },
      { timeoutMs: MATRIX_BOUND_MS },
    );
    assert.equal(reply.error, undefined);
    assert.ok(isMetricsSnapshot(reply.result));
    return reply.result;
  };

  const statusOutcome = async (host: MatrixHost, callId: number): Promise<Record<string, unknown>> => {
    // realm mcp answers before its boot settles and refuses a call until it has: the presence marker is written when it settles.
    await untilPresence(stateDir, host.label);
    host.input.write(callStatus(callId));
    const reply = await boundedWait(untilReplyOn(host.output, callId), `host status call ${String(callId)}`, MATRIX_BOUND_MS);
    return toolOutcomeOf(reply);
  };

  return {
    root,
    stateDir,
    daemonLines,
    auditPath: join(stateDir, "audit", "host-boot.jsonl"),
    releases: () => released,
    project,
    bootHost,
    mcpHost: (host, workspace, options) =>
      bootHost(["mcp", "--host", host, ...(options?.reattach === true ? ["--reattach"] : []), "--workspace", workspace], options),
    acpHost: (host, workspace, options) => bootHost(["acp", "--host", host, "--workspace", workspace], options),
    async serveStatus(host, callId) {
      const outcome = await statusOutcome(host, callId);
      try {
        return stateOf(outcome);
      } catch (error: unknown) {
        const tail = daemonLines.slice(-12).join("");
        throw new Error(`${error instanceof Error ? error.message : "no status value"}\nhost diagnostics: ${host.diagnostics.text()}\ndaemon log tail: ${tail}`, { cause: error });
      }
    },
    statusOutcome,
    end(host) {
      host.input.end();
      return boundedWait(host.result, "the host ending after stdin closed", 10_000);
    },
    async release(path) {
      released += 1;
      await fixture.release(path);
    },
    async downCount() {
      const snapshot = await metrics();
      return snapshot.controlRequests.find((row) => row.method === "down")?.count ?? 0;
    },
    metrics,
    async sandboxState(path) {
      const reply = await fixture.status(path);
      assert.equal(reply.error, undefined);
      const result = reply.result;
      assert.ok(typeof result === "object" && result !== null && "snapshot" in result);
      const snapshot = result.snapshot;
      assert.ok(typeof snapshot === "object" && snapshot !== null && "state" in snapshot);
      return snapshot.state;
    },
    markerPath: (host) => join(stateDir, "hosts", `${host}-active`, `${String(process.pid)}.json`),
    // A real client whose up never settles: a host hung in the daemon's up. The connect seam's third argument is forwarded, so the
    // real client keeps the host id it would carry in production.
    hangingUp: () => (socketPath, selection, options): DaemonClient => {
      const real = connectDaemon(socketPath, selection, options);
      return {
        status: () => real.status(),
        up: () => new Promise<DaemonStatus>(() => undefined),
        call: (tool) => real.call(tool),
        metrics: () => real.metrics(),
        close: () => {
          real.close();
        },
      };
    },
    flakyConnect(failures) {
      let failed = 0;
      let ups = 0;
      const connect: ConnectDaemon = (socketPath, selection, options): DaemonClient => {
        if (failed < failures) {
          failed += 1;
          const reject = (): Promise<never> => Promise.reject(new RealmError("DAEMON_START_TIMEOUT"));
          return { status: reject, up: reject, call: reject, metrics: reject, close: () => undefined };
        }
        const real = connectDaemon(socketPath, selection, options);
        return {
          status: () => real.status(),
          up: () => {
            ups += 1;
            return real.up();
          },
          call: (tool) => real.call(tool),
          metrics: () => real.metrics(),
          close: () => {
            real.close();
          },
        };
      };
      return { connect, attempts: () => failed + ups };
    },
    assertFramesOnly() {
      for (const output of outputs) {
        framesOf(output.text());
      }
    },
    stop,
  };
}
