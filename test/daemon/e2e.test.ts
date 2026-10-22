// End-to-end proof (RT-06, CLI-01, CLI-02, CLI-03; P6-D15). Every test drives the
// real 06-04 CLI entry against the real 06-03 daemon over a real Unix socket in a
// temporary state directory; the adapter seam carries the existing fakes (fake
// execution and bridge helpers), so no live Podman, OpenShell, container, daemon
// process, or network is ever started. The lifecycle, PODMAN_MISSING fast path,
// and doctor cases run through runCli; the permission case stats the real
// temporary run directory; and the no-mounts proof inspects the real
// buildCreateArgv output and policy document builders. Test titles cite their
// requirement ID.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ERROR_CATALOGUE } from "../../src/core/errors.js";
import { STATUS_LABELS } from "../../src/core/status.js";
import { runCli, type SpawnDaemon } from "../../src/cli/main.js";
import { sendRequest } from "../../src/daemon/channel.js";
import { startDaemon, type StartedDaemon, type StartDaemonOptions } from "../../src/daemon/daemon.js";
import { runDaemon } from "../../src/daemon/main.js";
import type { CheckId, CheckResult } from "../../src/doctor/checks.js";
import { buildCreateArgv, buildPolicyDocument } from "../../src/runtime/openshell.js";
import { controlSocketPath, type EnvironmentLike } from "../../src/session/paths.js";
import { FakeExecutionService } from "../support/fake-execution.js";
import { FakeBridge } from "../support/fake-bridge.js";

// This file runs from dist/test/daemon, so three levels up is the package root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OPENSHELL_SOURCE = join(ROOT, "src", "runtime", "openshell.ts");

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const CLOCK_ISO = "2026-10-21T09:30:00.000Z";

// The PODMAN_MISSING fast path must return promptly: the CLI must never hang
// waiting for a daemon or socket when the host cannot run containers (T-06-15).
const FAST_PATH_WALL_CLOCK_BOUND_MS = 2000;

interface Fixture {
  readonly base: string;
  readonly ws: string;
  readonly stateDir: string;
  // Daemons started for this test; torn down by the fixture's single teardown.
  readonly daemons: StartedDaemon[];
}

interface StatusBody {
  readonly snapshot: { readonly state: unknown };
  readonly display: { readonly label: unknown };
}

function makeDirs(t: TestContext): Fixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-e2e-")));
  const daemons: StartedDaemon[] = [];
  // One teardown owns both steps, in order: each daemon is brought down while its
  // socket file still exists, and only then is the directory removed. A removal
  // registered on its own could run first, leaving a listening server that holds
  // the event loop open.
  t.after(async () => {
    for (const daemon of daemons.splice(0)) {
      await cleanupDaemon(daemon);
    }
    rmSync(base, { recursive: true, force: true });
  });
  const ws = join(base, "ws");
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, "doc.txt"), "original");
  // The runtime config names the state directory. The CLI and the daemon both read this file from
  // XDG_CONFIG_HOME, so they meet at its stateDir whatever XDG_STATE_HOME says.
  mkdirSync(join(base, "config", "realm"), { recursive: true });
  writeFileSync(
    join(base, "config", "realm", "config.json"),
    JSON.stringify({
      image: IMAGE,
      workloadArgv: ["/usr/bin/agent", "--serve"],
      stateDir: join(base, "realm"),
      workspaceRoot: ws,
    }),
  );
  return { base, ws, stateDir: join(base, "realm"), daemons };
}

function cliEnv(fixture: Fixture): EnvironmentLike {
  return {
    PATH: "/usr/bin",
    HOME: "/root",
    XDG_RUNTIME_DIR: "/run/user/0",
    XDG_CONFIG_HOME: join(fixture.base, "config"),
    XDG_STATE_HOME: join(fixture.base, "xdg-state"),
  };
}

function writePolicy(fixture: Fixture, name: string): string {
  const path = join(fixture.base, name);
  writeFileSync(path, JSON.stringify({ workspaceRoots: [fixture.ws] }));
  return path;
}

function daemonOptions(fixture: Fixture, overrides?: Partial<StartDaemonOptions>): StartDaemonOptions {
  return {
    runtimeInput: {
      image: IMAGE,
      workloadArgv: ["/usr/bin/agent", "--serve"],
      stateDir: fixture.stateDir,
      workspaceRoot: fixture.ws,
    },
    policyPath: writePolicy(fixture, "e2e-policy.json"),
    sessionId: "sess-e2e",
    exec: new FakeExecutionService(),
    bridge: new FakeBridge(),
    clock: () => new Date(CLOCK_ISO),
    runOpenShell: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "", truncated: false }),
    sweep: async () => 0,
    probe: async () => ({ ok: true, version: "5.0.0" }),
    ...overrides,
  };
}

// One wait bound for a daemon to finish teardown. A test that never sees done
// resolve fails here instead of leaving the event loop held open.
const DONE_WAIT_MS = 5000;

// Resolves when down finishes teardown (server closed, socket removed). The single
// timer is cleared on every settle path, so no timer outlives the wait.
async function awaitDone(daemon: StartedDaemon): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("daemon done did not resolve")), DONE_WAIT_MS);
  });
  try {
    await Promise.race([daemon.done, expired]);
  } finally {
    clearTimeout(timer);
  }
}

// Best-effort teardown: asks a still-serving daemon to go down, then waits for
// done. A daemon the test already stopped refuses the dial at once, so this is a
// no-op in that case.
async function cleanupDaemon(daemon: StartedDaemon): Promise<void> {
  try {
    await sendRequest(daemon.socketPath, { id: "e2e-cleanup", method: "down" }, { timeoutMs: 1000 });
  } catch {
    // The test already tore the daemon down, or it never started serving.
  }
  try {
    await awaitDone(daemon);
  } catch {
    // Best effort on the way out; the temp directory is removed by t.after.
  }
}

// Starts a daemon and records it on the fixture. The fixture's single teardown
// brings every recorded daemon down before the directory is removed, on every
// exit path: pass, failed assertion, or a throw between start and the test's own down.
async function startTestDaemon(fixture: Fixture, options: StartDaemonOptions): Promise<StartedDaemon> {
  const daemon = await startDaemon(options);
  fixture.daemons.push(daemon);
  return daemon;
}

function recordingSpawn(calls: { readonly file: string; readonly args: readonly string[] }[]): SpawnDaemon {
  return (file, args) => {
    calls.push({ file, args });
    return { unref: () => undefined };
  };
}

async function okVersion(): Promise<{ exitCode: number; stdout: string }> {
  return { exitCode: 0, stdout: "podman version 5.5.0\n" };
}

function acceptConnect(): Promise<void> {
  return Promise.resolve();
}

test("up then status-active then down-to-disconnected flows through the CLI against the fake-backed daemon (CLI-01, RT-06)", async (t) => {
  const fixture = makeDirs(t);
  const daemon = await startTestDaemon(fixture, daemonOptions(fixture));

  const spawns: { readonly file: string; readonly args: readonly string[] }[] = [];
  const cliBase = {
    env: cliEnv(fixture),
    timeoutMs: 2000,
    spawn: recordingSpawn(spawns),
    runCommand: okVersion,
    connectSocket: acceptConnect,
  };

  const up = await runCli(["up", "--workspace", fixture.ws], cliBase);
  assert.equal(up.exitCode, 0);
  const upBody = JSON.parse(up.stdout) as StatusBody;
  assert.equal(upBody.snapshot.state, "active");
  assert.equal(upBody.display.label, STATUS_LABELS.active);
  // The daemon was already serving, so the CLI never spawns a second process.
  assert.equal(spawns.length, 0);

  const status = await runCli(["status"], cliBase);
  assert.equal(status.exitCode, 0);
  const statusBody = JSON.parse(status.stdout) as StatusBody;
  assert.equal(statusBody.snapshot.state, "active");
  assert.equal(statusBody.display.label, STATUS_LABELS.active);

  const down = await runCli(["down"], cliBase);
  assert.equal(down.exitCode, 0);
  const downBody = JSON.parse(down.stdout) as StatusBody;
  assert.equal(downBody.snapshot.state, "unbound");

  // Zero surviving daemon state: teardown resolves and the socket is gone.
  await awaitDone(daemon);
  assert.equal(existsSync(daemon.socketPath), false);

  // And the CLI now reports disconnected with the daemon absent.
  const after = await runCli(["status"], cliBase);
  assert.equal(after.exitCode, 0);
  assert.equal(after.stdout, "disconnected\n");
});

test("up with Podman missing reports disconnected with PODMAN_MISSING, spawns nothing, and returns within the bound (CLI-02, RT-06)", async (t) => {
  const fixture = makeDirs(t);
  const spawns: { readonly file: string; readonly args: readonly string[] }[] = [];
  let sends = 0;
  let connects = 0;

  const started = Date.now();
  const result = await runCli(["up", "--workspace", fixture.ws], {
    env: cliEnv(fixture),
    timeoutMs: 50,
    spawn: recordingSpawn(spawns),
    send: async () => {
      sends += 1;
      throw new Error("the socket must not be dialed without Podman");
    },
    runCommand: async () => {
      throw new Error("spawn podman ENOENT");
    },
    connectSocket: async () => {
      connects += 1;
    },
  });
  const elapsed = Date.now() - started;

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "PODMAN_MISSING\n");
  assert.ok(result.stderr.includes(ERROR_CATALOGUE.PODMAN_MISSING.reason));
  assert.equal(spawns.length, 0);
  assert.equal(sends, 0);
  assert.equal(connects, 0);
  assert.ok(
    elapsed < FAST_PATH_WALL_CLOCK_BOUND_MS,
    `up with missing Podman must return promptly, took ${elapsed} ms`,
  );
});

test("doctor through the CLI against the fake-backed daemon lists every item with fix text on every non-pass (CLI-03, RT-06)", async (t) => {
  const fixture = makeDirs(t);
  // Podman and socket probes fail deterministically, so the Podman-backed items
  // report non-pass with fixes; the control channel passes against the live
  // daemon socket and AgentOS fails with AGENTOS_NOT_CONFIGURED (no driver is bound).
  await startTestDaemon(fixture,
    daemonOptions(fixture, {
      doctorOptions: {
        runCommand: async () => {
          throw new Error("podman not installed");
        },
        connectSocket: async () => {
          throw new Error("connection refused");
        },
      },
    }),
  );

  const result = await runCli(["doctor"], {
    env: cliEnv(fixture),
    timeoutMs: 2000,
    runCommand: async () => {
      throw new Error("podman not installed");
    },
    connectSocket: async () => {
      throw new Error("connection refused");
    },
  });
  assert.equal(result.exitCode, 0);

  const report = JSON.parse(result.stdout) as CheckResult[];
  assert.ok(Array.isArray(report));
  // Seven pre-existing items plus the Phase 6 control-channel and agentos items
  // appended deliberately (06-05); the bound below tolerates the plan's
  // "eight" only if one pre-existing id were ever merged, but today all nine
  // report and every one is asserted present by id.
  const ids = report.map((item) => item.id);
  const expectedIds: readonly CheckId[] = [
    "policy-file",
    "state-dir",
    "session-store",
    "podman",
    "podman-service",
    "openshell",
    "anda-bridge",
    "control-channel",
    "agentos",
  ];
  for (const expected of expectedIds) {
    assert.ok(ids.includes(expected), `doctor report must list ${expected}`);
  }
  assert.ok(
    ids.indexOf("control-channel") > ids.indexOf("anda-bridge"),
    "control-channel must be appended after anda-bridge",
  );
  assert.ok(
    ids.indexOf("agentos") > ids.indexOf("anda-bridge"),
    "agentos must be appended after anda-bridge",
  );

  for (const item of report) {
    assert.ok(typeof item.id === "string");
    assert.ok(item.status === "pass" || item.status === "warn" || item.status === "fail");
    assert.ok(typeof item.detail === "string" && item.detail.length > 0);
    if (item.status === "pass") {
      assert.equal(item.fix, null);
    } else {
      assert.ok(
        typeof item.fix === "string" && item.fix.length > 0,
        `non-pass item ${item.id} must carry fix text`,
      );
    }
  }
});

// The CLI and the daemon entry meet at one state directory because both read it from the runtime
// config. XDG_STATE_HOME names another directory, so only the config can bring them together: runDaemon
// starts the daemon with the config's stateDir, and runCli finds that daemon's socket through the same read.
test("the CLI and the daemon entry resolve one state directory from the runtime config, not XDG_STATE_HOME (CLI-01, RT-06, OMP-01)", async (t) => {
  const fixture = makeDirs(t);
  const env = cliEnv(fixture);
  const stderr: string[] = [];
  let started: StartedDaemon | undefined;
  let startedStateDir: string | undefined;
  let markServing: (() => void) | undefined;
  const serving = new Promise<void>((resolve) => {
    markServing = resolve;
  });
  const daemonRun = runDaemon({
    env,
    start: async (options) => {
      startedStateDir = options.stateDir;
      started = await startTestDaemon(fixture, { ...daemonOptions(fixture), runtimeInput: options.runtimeInput });
      markServing?.();
      return started;
    },
    writeStderr: (line) => {
      stderr.push(line);
    },
    onSignal: () => () => undefined,
  });
  await Promise.race([serving, daemonRun]);
  assert.ok(started !== undefined, "the daemon entry starts a daemon before the CLI runs");
  assert.equal(startedStateDir, fixture.stateDir);

  const status = await runCli(["status"], { env, timeoutMs: 2000 });
  assert.equal(status.exitCode, 0);
  assert.equal(status.stderr, "", "the CLI reaches the daemon the config names, so it reports no absent daemon");
  const body = JSON.parse(status.stdout) as StatusBody;
  assert.equal(body.snapshot.state, "unbound");

  const down = await runCli(["down"], { env, timeoutMs: 2000 });
  assert.equal(down.exitCode, 0);
  assert.ok(started !== undefined);
  await awaitDone(started);
  assert.equal(await daemonRun, 0);
  assert.deepEqual(stderr, []);
});

test("the socket directory is 0700 with a 0600 socket after daemon start (RT-06)", async (t) => {
  const fixture = makeDirs(t);
  const daemon = await startTestDaemon(fixture, daemonOptions(fixture));

  assert.equal(daemon.socketPath, controlSocketPath(fixture.stateDir));
  const runDir = join(fixture.stateDir, "run");
  assert.equal(statSync(runDir).mode & 0o777, 0o700);
  assert.equal(statSync(daemon.socketPath).mode & 0o777, 0o600);

  const down = await sendRequest(daemon.socketPath, { id: "perm-down", method: "down" }, { timeoutMs: 2000 });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
  assert.equal(existsSync(daemon.socketPath), false);
});

test("the container-create argv and the policy document carry no socket path (RT-06)", () => {
  // A stand-in state directory that is never created: only its path shape matters.
  const stateDir = join(ROOT, "tmp", "realm-no-mounts-proof", "state");
  const socketPath = controlSocketPath(stateDir);

  const argv = buildCreateArgv({
    sessionId: "sess-proof",
    policyPath: join(ROOT, "tmp", "realm-no-mounts-proof", "policy.json"),
    cpus: 2,
    memory: "512m",
    workloadArgv: ["/usr/bin/agent", "--serve"],
  });
  const argvText = JSON.stringify(argv);
  assert.ok(!argvText.includes(".sock"), `create argv must not mount a socket: ${argvText}`);
  assert.ok(!argvText.includes(socketPath), "create argv must not carry the control socket path");
  assert.ok(!argvText.includes("podman.sock") && !argvText.includes("docker.sock"));

  const document = buildPolicyDocument([{ host: "example.com", port: 443 }], "/usr/bin/agent");
  const documentText = JSON.stringify(document);
  assert.ok(!documentText.includes(".sock"), `policy document must not mount a socket: ${documentText}`);
  assert.ok(!documentText.includes(socketPath), "policy document must not carry the control socket path");
  assert.ok(!documentText.includes("podman.sock") && !documentText.includes("docker.sock"));

  // Grep-source guard in the test/tools/no-bypass.test.ts style: the argv
  // module itself must name no .sock path, so a later edit mounting any socket
  // breaks the suite (T-06-14).
  const source = readFileSync(OPENSHELL_SOURCE, "utf8");
  assert.ok(!source.includes(".sock"), "openshell.ts must not name a socket path");
});
