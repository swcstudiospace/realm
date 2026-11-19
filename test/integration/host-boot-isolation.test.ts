// Per-host failure isolation of the boot path (BOOT-04), against the real daemon in this process over the existing fakes
// (startRealmDaemon), the real connectDaemon and the real host-boot recorder. The hosts are realm mcp and realm acp driven
// through runCli with injected stdin, stdout, diagnostics and signals; they dial the daemon's real control socket.
//
// One host's hung up, failed boot, signal teardown or report flood must leave another host's session, the shared sandbox and the
// daemon answering within their bounds, and no boot path may send down (the daemon's controlRequests holds no down row until the
// test releases its projects itself). Nothing here needs Podman: it proves the boot path against fakes. A real Claude Code or Omp
// is the live rehearsal, not this file.
//
//   S1  host A's up never settles; host B boots and serves while A is pending; a SIGTERM ends A; B still serves.
//   S2  host C points at a socket nobody answers: exit 1 with DAEMON_START_TIMEOUT; B is unaffected.
//   S3  B's stdin ends: exit 0, marker gone, the sandbox is still active, no down row.
//   S4  a hostile process floods host-boot frames: bounded at the bucket, a fresh host still boots, the boot audit chain verifies.
//   S5  two hosts (claude, codex) and an ACP host on one project boot together; one ends, the others keep the sandbox.
//   S5b a labelled host driven through a wrapped connect keeps its host id: the daemon counts a capability-attach request.
//   S6  a project directory named with a newline, a quote, an ANSI escape and a token appears in no sink.
//   S7  stdout holds only protocol frames in every scenario above.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { performance } from "node:perf_hooks";
import { verifyAuditFile } from "../../src/audit/chain.js";
import { runCli, type CliResult, type ConnectDaemon } from "../../src/cli/main.js";
import type { SpawnDaemon } from "../../src/daemon/launch.js";
import { sendRequest, type ControlReply } from "../../src/daemon/channel.js";
import { connectDaemon, type DaemonClient, type DaemonStatus } from "../../src/daemon/client.js";
import { createLogger } from "../../src/observe/logger.js";
import { isMetricsSnapshot, type MetricsSnapshot } from "../../src/observe/metrics.js";
import type { EnvironmentLike } from "../../src/session/paths.js";
import { startRealmDaemon, type RealmDaemonFixture } from "../support/realm-daemon-fixture.js";
import {
  callStatus,
  capture,
  FakeSignals,
  frame,
  framesOf,
  listTools,
  toolOutcomeOf,
  untilPresence,
  untilReplyOn,
  type Capture,
} from "../support/stdio-host-harness.js";
import { boundedWait, pollUntil } from "../support/timing.js";

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const CLOCK_ISO = "2026-10-21T09:30:00.000Z";
const BOUND_MS = 5000;
const ENV: EnvironmentLike = { PATH: "/usr/bin", HOME: "/root", XDG_RUNTIME_DIR: "/run/user/0" };

let base = "";
let root = "";
let stateDir = "";
let fixture: RealmDaemonFixture;
const daemonLines: string[] = [];
const projects: string[] = [];
// Every runner's stdout, kept for the one assertion that holds across the file (S7).
const outputs: Capture[] = [];

before(async () => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "realm-boot-iso-")));
  root = join(base, "root");
  stateDir = join(base, "state");
  mkdirSync(root, { recursive: true });
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
  fixture = await startRealmDaemon({ stateDir, workspace: root, mode: "advisory", logger });
  // One standing session of its own: releasing the last live session stops the daemon, and the scenarios release theirs.
  await fixture.up(project("anchor"));
});

after(async () => {
  for (const project of projects) {
    await fixture.release(project).catch(() => undefined);
  }
  await boundedWait(fixture.done, "the daemon stopping after its projects were released", 10_000).catch(() => undefined);
  rmSync(base, { recursive: true, force: true });
});

function project(name: string): string {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  const real = realpathSync(path);
  projects.push(real);
  return real;
}

// ---- One host process --------------------------------------------------------------------------------------------------------

interface Host {
  // The --host id of the process, or "unlabelled": the name of its presence marker directory.
  readonly label: string;
  readonly result: Promise<CliResult>;
  readonly input: PassThrough;
  readonly output: Capture;
  readonly diagnostics: Capture;
  readonly signals: FakeSignals;
  readonly spawns: string[];
}

interface HostOptions {
  readonly connect?: ConnectDaemon;
  readonly stateDir?: string;
  readonly timeoutMs?: number;
  readonly logLevel?: string;
}

function bootHost(argv: readonly string[], options: HostOptions = {}): Host {
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
  const result = runCli(argv, {
    env,
    cwd: root,
    daemonEntry: join(base, "daemon", "main.js"),
    readConfig: () => ({ image: IMAGE, stateDir: options.stateDir ?? stateDir, workspaceRoot: root }),
    timeoutMs: options.timeoutMs ?? BOUND_MS,
    spawn,
    ...(options.connect === undefined ? {} : { connect: options.connect }),
    mcpInput: input,
    mcpOutput: output.stream,
    acpInput: input,
    acpOutput: output.stream,
    diagnostics: diagnostics.stream,
    signals,
  });
  const labelAt = argv.indexOf("--host");
  return { label: labelAt < 0 ? "unlabelled" : (argv[labelAt + 1] ?? "unlabelled"), result, input, output, diagnostics, signals, spawns };
}

const mcpHost = (host: string, workspace: string, options?: HostOptions): Host => bootHost(["mcp", "--host", host, "--workspace", workspace], options);

// The daemon admits a bounded number of concurrent sessions, so a scenario releases its project once its assertions are done.
// Each release is a down the test itself sends; a boot path adds none, so the daemon's down count must equal this count.
let releases = 0;

async function releaseProject(path: string): Promise<void> {
  releases += 1;
  await fixture.release(path);
}

async function downCount(): Promise<number> {
  const snapshot = await metrics();
  return snapshot.controlRequests.find((row) => row.method === "down")?.count ?? 0;
}

function stateOf(outcome: Record<string, unknown>): unknown {
  const value = outcome["value"];
  assert.ok(typeof value === "object" && value !== null && "snapshot" in value, `a status value, not ${JSON.stringify(outcome)}`);
  const snapshot = value.snapshot;
  assert.ok(typeof snapshot === "object" && snapshot !== null && "state" in snapshot, "a snapshot");
  return snapshot.state;
}

// One Realm status tool call through an MCP host: the daemon's state for its project, within the control bound. realm mcp answers
// before its boot settles and refuses a call until a client is adopted, so the call waits for the host's presence marker.
async function serveStatus(host: Host, id: number): Promise<unknown> {
  await untilPresence(stateDir, host.label);
  host.input.write(callStatus(id));
  const reply = await boundedWait(untilReplyOn(host.output, id), `host status call ${String(id)}`, BOUND_MS);
  return stateOf(toolOutcomeOf(reply));
}

async function end(host: Host): Promise<CliResult> {
  host.input.end();
  return boundedWait(host.result, "the host ending after stdin closed", 10_000);
}

const markerPath = (host: string): string => join(stateDir, "hosts", `${host}-active`, `${String(process.pid)}.json`);

async function metrics(): Promise<MetricsSnapshot> {
  const reply = await sendRequest(
    fixture.socketPath,
    { id: "iso-metrics", method: "metrics", params: { selection: fixture.selectionFor(root) } },
    { timeoutMs: BOUND_MS },
  );
  assert.equal(reply.error, undefined);
  assert.ok(isMetricsSnapshot(reply.result));
  return reply.result;
}

async function sandboxState(path: string): Promise<unknown> {
  const reply = await fixture.status(path);
  assert.equal(reply.error, undefined);
  const result = reply.result;
  assert.ok(typeof result === "object" && result !== null && "snapshot" in result);
  const snapshot = result.snapshot;
  assert.ok(typeof snapshot === "object" && snapshot !== null && "state" in snapshot);
  return snapshot.state;
}

// A real client whose up never settles: a host hung in the daemon's up. The connect seam's third argument is forwarded, so the real
// client keeps the host id it would carry in production.
function hangingUp(): ConnectDaemon {
  return (socketPath, selection, options): DaemonClient => {
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
  };
}

// ---- Scenarios (they share one daemon and run in order) -------------------------------------------------------------------------

void test("S1-S3: a hung up, a failed boot and a stdin close leave another host, the sandbox and the daemon serving, and no boot sends down", async () => {
  const projectOne = project("one");
  const projectTwo = project("two");

  // S1: host A hangs in up; host B boots and serves meanwhile.
  const hostA = mcpHost("claude", projectOne, { connect: hangingUp() });
  const hostB = mcpHost("codex", projectTwo);
  assert.equal(await serveStatus(hostB, 1), "active", "host B is active within its bound while A is pending");
  hostA.input.write(callStatus(1));
  const pendingReply = await boundedWait(untilReplyOn(hostA.output, 1), "host A's refused call while it is in up", BOUND_MS);
  assert.equal(toolOutcomeOf(pendingReply)["code"], "REALM_NOT_ACTIVE", "host A is still in up: its call is refused, not forwarded");
  assert.equal(existsSync(markerPath("claude")), false, "host A has no marker: no client was adopted");
  hostA.signals.raise("SIGTERM");
  const endedA = await boundedWait(hostA.result, "host A ending on SIGTERM", 10_000);
  assert.equal(endedA.exitCode, 143);
  assert.equal(endedA.stdout, "");
  assert.deepEqual(hostA.signals.exits, [143]);
  assert.equal(existsSync(markerPath("claude")), false, "host A's marker is not left behind");
  assert.equal(await serveStatus(hostB, 2), "active", "host B still serves after A's teardown");
  assert.equal(existsSync(markerPath("codex")), true, "host B's marker exists while it serves");

  // S2: host C points at a state directory no daemon answers on, with a spawn that starts nothing.
  const nobody = join(base, "state-nobody");
  const hostC = mcpHost("kimi", join(root, "one"), { stateDir: nobody, timeoutMs: 100 });
  hostC.input.write(listTools(1));
  await boundedWait(untilReplyOn(hostC.output, 1), "host C's handshake-time reply", BOUND_MS);
  await pollUntil(() => hostC.diagnostics.text() !== "", "host C's boot failure on stderr");
  const endedC = await end(hostC);
  assert.equal(endedC.exitCode, 1);
  assert.equal(endedC.stdout, "");
  assert.match(hostC.diagnostics.text(), /^DAEMON_START_TIMEOUT: /);
  assert.equal(framesOf(hostC.output.text()).length, 1, "a failed boot writes the one reply it was asked for and nothing else");
  assert.equal(hostC.spawns.length, 1, "one spawn is attempted before the bounded wait");
  assert.equal(await serveStatus(hostB, 3), "active", "host B is unaffected by C's failure");

  // S3: host B's stdin ends.
  const endedB = await end(hostB);
  assert.equal(endedB.exitCode, 0);
  assert.equal(existsSync(markerPath("codex")), false, "host B's marker is removed");
  assert.equal(await sandboxState(projectTwo), "active", "the project's sandbox outlives its host");
  assert.equal(await downCount(), 0, "no boot path issued down");
  await releaseProject(projectTwo);
});

void test("S4: a flood of host-boot frames is bounded, a fresh host still boots and the boot audit chain verifies", async () => {
  const projectThree = project("three");
  const sends: Promise<ControlReply>[] = [];
  const started = performance.now();
  for (let index = 0; index < 200; index += 1) {
    sends.push(
      sendRequest(
        fixture.socketPath,
        {
          id: `flood-${String(index)}`,
          method: "host-boot",
          params: {
            report: {
              schemaVersion: 1,
              bootId: `flood-${String(index)}`,
              hostId: "claude",
              transport: "mcp",
              phase: "attached",
              code: null,
              attempt: 1,
              durationMs: 1,
              state: "active",
            },
          },
        },
        { timeoutMs: BOUND_MS },
      ),
    );
  }
  const replies = await Promise.all(sends);
  const elapsedMs = performance.now() - started;
  const accepted = replies.filter((reply) => reply.error === undefined);
  const denied = replies.filter((reply) => reply.error?.code === "POLICY_DENIED");
  assert.equal(accepted.length + denied.length, 200, "every frame is accepted or POLICY_DENIED");
  assert.ok(accepted.length <= 60 + Math.floor(elapsedMs / 1000), `at most the bucket was accepted, not ${String(accepted.length)}`);
  assert.ok(denied.length > 0, "the rest are refused");

  // A fresh host boots and serves while the bucket is empty; its own reports are refused, which never changes its outcome.
  const fresh = mcpHost("codex", projectThree);
  assert.equal(await serveStatus(fresh, 1), "active");
  const statusStarted = performance.now();
  assert.equal(await sandboxState(projectThree), "active");
  assert.ok(performance.now() - statusStarted < BOUND_MS, "status answers within its bound");
  assert.equal(fresh.diagnostics.text(), "", "a refused report writes nothing at default level");
  assert.equal((await end(fresh)).exitCode, 0);

  const audit = join(stateDir, "audit", "host-boot.jsonl");
  assert.equal(existsSync(audit), true, "accepted reports wrote the boot chain");
  assert.equal(verifyAuditFile(audit).ok, true, "the boot audit chain still verifies after the flood");
  assert.equal(await downCount(), releases, "no boot path issued down: only the test's own release is counted");
  await releaseProject(projectThree);
});

void test("S5: two hosts and an ACP host on one project boot together; one ends and the others keep the sandbox", async () => {
  const shared = project("shared");
  const claude = mcpHost("claude", shared);
  const codex = mcpHost("codex", shared);
  const [claudeState, codexState] = await Promise.all([serveStatus(claude, 1), serveStatus(codex, 1)]);
  assert.equal(claudeState, "active");
  assert.equal(codexState, "active");
  const acp = bootHost(["acp", "--host", "kimi", "--workspace", shared]);
  acp.input.write(frame(1, "initialize", { protocolVersion: 1 }));
  acp.input.write(frame(2, "_realm/tool", { tool: { status: {} } }));
  const acpReply = await boundedWait(untilReplyOn(acp.output, 2), "the ACP host's status call", BOUND_MS);
  assert.equal(typeof acpReply["result"], "object");
  assert.equal((await end(claude)).exitCode, 0);
  assert.equal(await serveStatus(codex, 2), "active", "the other host keeps serving the same active sandbox");
  assert.equal(await sandboxState(shared), "active");
  assert.equal((await end(acp)).exitCode, 0);
  assert.equal((await end(codex)).exitCode, 0);
  assert.equal(await sandboxState(shared), "active", "the sandbox lasts until realm down");
  assert.equal(await downCount(), releases, "no boot path issued down: only the test's own releases are counted");
  await releaseProject(shared);
});

// A pass-through wrapper of the real client, the shape of hangingUp without the hang. A wrapper that dropped the connect seam's third
// argument would hand the real client no host id, and the client would never send capability-attach.
function passThrough(): ConnectDaemon {
  return (socketPath, selection, options): DaemonClient => {
    const real = connectDaemon(socketPath, selection, options);
    return {
      status: () => real.status(),
      up: () => real.up(),
      call: (tool) => real.call(tool),
      metrics: () => real.metrics(),
      close: () => {
        real.close();
      },
    };
  };
}

async function attachCount(): Promise<number> {
  const snapshot = await metrics();
  return snapshot.controlRequests.find((row) => row.method === "capability-attach")?.count ?? 0;
}

void test("S5b: a labelled host driven through a wrapped connect keeps its host id: the daemon counts a capability-attach request", async () => {
  const projectFour = project("four");
  const before = await attachCount();
  const host = mcpHost("claude", projectFour, { connect: passThrough() });
  assert.equal(await serveStatus(host, 1), "active");
  assert.ok((await attachCount()) - before >= 1, "the real client sent capability-attach, so its host id went through the wrapper");
  assert.equal((await end(host)).exitCode, 0);
  await releaseProject(projectFour);
});

void test("S6: a project directory named with a newline, a quote, an ANSI escape and a token appears in no log, report, metric, audit line or marker", async () => {
  const token = `ghp_${"a1B2c3D4e5".repeat(4).slice(0, 36)}`;
  const escape = String.fromCharCode(27);
  const name = `evil-name\n"quoted-name"${escape}[31mansi-name-${token}`;
  const hostile = project(name);
  const host = mcpHost("claude", hostile, { logLevel: "debug" });
  assert.equal(await serveStatus(host, 1), "active");
  const marker = readFileSync(markerPath("claude"), "utf8");
  const ended = await end(host);
  assert.equal(ended.exitCode, 0);
  const snapshot = await metrics();
  const auditFile = join(stateDir, "audit", "host-boot.jsonl");
  const sinks: Readonly<Record<string, string>> = {
    diagnostics: host.diagnostics.text(),
    "daemon log": daemonLines.join("\n"),
    metrics: JSON.stringify(snapshot),
    "boot audit": existsSync(auditFile) ? readFileSync(auditFile, "utf8") : "",
    marker,
    stderr: ended.stderr,
  };
  const fragments = ["evil-name", token, `${escape}[31m`, "\\u001b[31m", "quoted-name", "ansi-name"];
  for (const [sink, text] of Object.entries(sinks)) {
    for (const fragment of fragments) {
      assert.equal(text.includes(fragment), false, `${sink} holds the fragment ${JSON.stringify(fragment)}`);
    }
  }
  assert.ok(host.diagnostics.text().includes("host.boot.attached"), "the debug log was on, so the absence above is meaningful");
});

void test("S7: stdout of every runner holds only protocol frames", () => {
  assert.ok(outputs.length >= 6, "the scenarios above ran their runners");
  for (const output of outputs) {
    framesOf(output.text());
  }
});
