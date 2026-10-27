// Daemon tests (CLI-01, RT-06, P6-D1, P6-D4, P6-D12). Every test drives the
// real module: single-owner start over a live Unix socket, the reap sweep
// before serving, all five CONTROL_METHODS over the channel, and graceful
// shutdown on down. No live Podman, OpenShell, or Anda engine is started: the
// adapter seam carries the existing fakes and scripted probes.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createConnection, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRealmError, RealmError } from "../../src/core/errors.js";
import { displayStatus, STATUS_LABELS } from "../../src/core/status.js";
import {
  MAX_CONTROL_LINE_BYTES,
  sendRequest,
  type ControlReply,
  type ControlRequest,
} from "../../src/daemon/channel.js";
import {
  buildDaemonHandle,
  type BuildDaemonHandleOptions,
  startDaemon,
  type StartedDaemon,
  type StartDaemonOptions,
} from "../../src/daemon/daemon.js";
import type { CheckResult } from "../../src/doctor/checks.js";
import type { PodmanProbeResult } from "../../src/runtime/podman-probe.js";
import { controlSocketPath } from "../../src/session/paths.js";
import type { ToolOutcome } from "../../src/tools/dispatch.js";
import { FakeBridge } from "../support/fake-bridge.js";
import { FakeExecutionService } from "../support/fake-execution.js";
import { FakeContainerStore, FakeLibpod } from "../support/fake-libpod.js";
import { FakeOpenShell } from "../support/fake-openshell.js";

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const CLOCK_ISO = "2026-10-21T09:30:00.000Z";

interface Fixture {
  readonly base: string;
  readonly ws: string;
  readonly stateDir: string;
}

interface DaemonParts {
  readonly options: StartDaemonOptions;
  readonly exec: FakeExecutionService;
  readonly bridge: FakeBridge;
  readonly events: string[];
}

// Scratch directories are removed once the whole file has run. A test's daemon is stopped by its own t.after
// hook, and t.after hooks run in registration order, so removing a directory at the end of its test would delete
// the socket that hook must still reach.
const scratchDirs: string[] = [];
after(() => {
  for (const dir of scratchDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDirs(): Fixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-daemon-")));
  scratchDirs.push(base);
  const ws = join(base, "ws");
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, "doc.txt"), "original");
  return { base, ws, stateDir: join(base, "state") };
}

function writePolicy(fixture: Fixture, name: string, policy: Record<string, unknown>): string {
  const path = join(fixture.base, name);
  writeFileSync(path, JSON.stringify(policy));
  return path;
}

function daemonParts(fixture: Fixture, overrides?: Partial<StartDaemonOptions>): DaemonParts {
  const events: string[] = [];
  const exec = new FakeExecutionService();
  const bridge = new FakeBridge();
  exec.beforeCall("create", () => {
    events.push("create");
  });
  const options: StartDaemonOptions = {
    runtimeInput: {
      image: IMAGE,
      stateDir: fixture.stateDir,
      workspaceRoot: fixture.ws,
    },
    // The policy names the workspace as a root, the same shape the compose
    // tests use: the daemon refuses a workspace outside every root.
    policyPath: writePolicy(fixture, "daemon-policy.json", { workspaceRoots: [fixture.ws] }),
    sessionId: "sess-daemon",
    exec,
    bridge,
    clock: () => new Date(CLOCK_ISO),
    runOpenShell: () =>
      Promise.resolve({ exitCode: 0, stdout: "", stderr: "", truncated: false }),
    sweep: () => {
      events.push("sweep");
      return Promise.resolve(0);
    },
    probe: () => {
      events.push("probe");
      return Promise.resolve<PodmanProbeResult>({ ok: true, version: "5.0.0" });
    },
    ...overrides,
  };
  return { options, exec, bridge, events };
}

function snapshotStateOf(reply: ControlReply): unknown {
  if (typeof reply.result === "object" && reply.result !== null && "snapshot" in reply.result) {
    const snapshot: unknown = reply.result.snapshot;
    if (typeof snapshot === "object" && snapshot !== null && "state" in snapshot) {
      return snapshot.state;
    }
  }
  return undefined;
}

function displayLabelOf(reply: ControlReply): unknown {
  if (typeof reply.result === "object" && reply.result !== null && "display" in reply.result) {
    const display: unknown = reply.result.display;
    if (typeof display === "object" && display !== null && "label" in display) {
      return display.label;
    }
  }
  return undefined;
}

// Resolves when down finishes teardown; fails fast instead of hanging the suite.
async function awaitDone(daemon: StartedDaemon): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      daemon.done,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("daemon done did not resolve"));
        }, 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function cleanupDaemon(daemon: StartedDaemon): Promise<void> {
  try {
    await sendRequest(daemon.socketPath, { id: "cleanup-down", method: "down" });
  } catch {
    // Already down or never served; nothing to tear down.
  }
  await Promise.race([
    daemon.done,
    new Promise<void>((resolve) => {
      setTimeout(resolve, 2000);
    }),
  ]);
}


// Bounds one wait in this file: a wait that never settles fails the test instead of hanging the run.
const WAIT_MS = 5000;
function bounded<T>(pending: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    pending,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${what} did not settle within ${String(WAIT_MS)} ms`));
      }, WAIT_MS);
    }),
  ]).finally(() => {
    clearTimeout(timer);
  });
}
function sendRawLine(socketPath: string, line: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection(socketPath);
    let text = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("raw read timed out"));
    }, 5000);
    socket.on("data", (chunk: Buffer) => {
      text += chunk.toString();
      const end = text.indexOf("\n");
      if (end !== -1) {
        clearTimeout(timer);
        socket.destroy();
        resolve(text.slice(0, end));
      }
    });
    socket.once("error", (cause: Error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(cause);
    });
    socket.write(line);
  });
}

// Writes one request line on a socket that is already open and resolves with the reply line.
function replyOn(socket: Socket, line: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let text = "";
    socket.on("data", (chunk: Buffer) => {
      text += chunk.toString();
      const end = text.indexOf("\n");
      if (end !== -1) {
        resolve(text.slice(0, end));
      }
    });
    socket.once("error", reject);
    socket.write(line);
  });
}

void test("CLI-01: buildDaemonHandle wires the shared composition root and answers snapshot plus dispatcher status (P6-D12)", async () => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const handle = buildDaemonHandle(options);
  const snapshot = handle.controller.snapshot();
  assert.equal(snapshot.state, "unbound");
  assert.equal(displayStatus(snapshot).label, STATUS_LABELS.disconnected);

  const outcome = await handle.dispatcher.call({ status: {} });
  assert.equal(outcome.outcome, "done");
  if (outcome.tool !== "status") {
    assert.fail("expected a done status");
  }
  assert.deepEqual(outcome.value.snapshot, snapshot);
  assert.equal(outcome.value.display.label, STATUS_LABELS.disconnected);
  await handle.close();
});

void test("RT-04, D-47: buildDaemonHandle builds with no AgentOS driver, and an up is refused with AGENTOS_NOT_CONFIGURED while no container is created", async (t) => {
  const fixture = makeDirs();
  const socketPath = join(fixture.base, "podman.sock");
  const store = new FakeContainerStore();
  const libpod = new FakeLibpod({ store, rootless: true });
  await libpod.start(socketPath);
  t.after(() => libpod.stop());
  const openshell = new FakeOpenShell(store);
  const options: BuildDaemonHandleOptions = {
    runtimeInput: {
      image: IMAGE,
      stateDir: fixture.stateDir,
      workspaceRoot: fixture.ws,
    },
    policyPath: writePolicy(fixture, "no-driver-policy.json", { workspaceRoots: [fixture.ws] }),
    sessionId: "sess-no-driver",
    bridge: new FakeBridge(),
    libpodSocketPath: socketPath,
    runOpenShell: openshell.runner,
    clock: () => new Date(CLOCK_ISO),
  };
  const handle = buildDaemonHandle(options);
  t.after(async () => {
    await handle.close();
  });

  const snapshot = await handle.controller.create(fixture.ws);
  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "AGENTOS_NOT_CONFIGURED");
  assert.equal(openshell.callCount(), 0, "no OpenShell run starts");
  assert.equal(store.list().length, 0, "no container is created");
});

void test("C4: with no andaUrl the session reaches active with no bridge handshake, and a tool call that needs Anda refuses with ANDA_UNREACHABLE", async (t) => {
  const fixture = makeDirs();
  const { options, bridge } = daemonParts(fixture);
  const handle = buildDaemonHandle(options);
  t.after(async () => {
    await handle.close();
  });

  const snapshot = await handle.controller.create(fixture.ws);
  assert.equal(snapshot.state, "active");
  assert.equal(bridge.callCount("connect"), 0, "no andaUrl means no handshake, even with a bridge injected");

  const write = await handle.dispatcher.call({ write: { path: "doc.txt", content: "changed" } });
  assert.deepEqual(write, { outcome: "refused", tool: "write", code: "ANDA_UNREACHABLE", retryable: true });
  assert.equal(readFileSync(join(fixture.ws, "doc.txt"), "utf8"), "original", "the refused write changes nothing");

  const exec = await handle.dispatcher.call({ exec: { argv: ["ls"] } });
  assert.deepEqual(exec, { outcome: "refused", tool: "exec", code: "ANDA_UNREACHABLE", retryable: true });
});

void test("B2: under advisory policy a write in error proceeds with the advisory warning", async (t) => {
  const fixture = makeDirs();
  const { options, bridge } = daemonParts(fixture, {
    runtimeInput: {
      image: IMAGE,
      stateDir: fixture.stateDir,
      workspaceRoot: fixture.ws,
      andaUrl: "http://127.0.0.1:9/",
    },
  });
  bridge.failNext("connect", "ANDA_UNREACHABLE");
  const handle = buildDaemonHandle(options);
  t.after(async () => {
    await handle.close();
  });

  const snapshot = await handle.controller.create(fixture.ws);
  assert.equal(snapshot.state, "error");

  const write = await handle.dispatcher.call({ write: { path: "doc.txt", content: "changed" } });
  if (write.outcome !== "done" || write.tool !== "write") {
    assert.fail(`expected a done write, got ${JSON.stringify(write)}`);
  }
  assert.equal(write.value.warning, "realm is error; the write proceeds under advisory policy");
  assert.equal(readFileSync(join(fixture.ws, "doc.txt"), "utf8"), "changed", "the advisory write in error lands");
});

void test("C4: with andaUrl set and the bridge unreachable, the start refuses with ANDA_UNREACHABLE", async (t) => {
  const fixture = makeDirs();
  const { options, bridge } = daemonParts(fixture, {
    runtimeInput: {
      image: IMAGE,
      stateDir: fixture.stateDir,
      workspaceRoot: fixture.ws,
      andaUrl: "http://127.0.0.1:9/",
    },
  });
  bridge.failNext("connect", "ANDA_UNREACHABLE");
  const handle = buildDaemonHandle(options);
  t.after(async () => {
    await handle.close();
  });

  const snapshot = await handle.controller.create(fixture.ws);
  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "ANDA_UNREACHABLE");
  assert.equal(bridge.callCount("connect"), 1, "a configured engine is handshaken at start");
});

void test("RT-06: startDaemon with no owner binds the socket and answers status over a real socket pair", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  const reply = await sendRequest(daemon.socketPath, { id: "s1", method: "status" });
  assert.equal(reply.id, "s1");
  assert.equal(snapshotStateOf(reply), "unbound");
  assert.equal(displayLabelOf(reply), STATUS_LABELS.disconnected);

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down" });
  assert.equal(down.id, "d1");
  assert.equal(snapshotStateOf(down), "unbound");
  await awaitDone(daemon);
});

void test("RT-06: a second startDaemon against the same state directory refuses with LOCK_CONFLICT (single owner)", async (t) => {
  const fixture = makeDirs();
  const first = await startDaemon(daemonParts(fixture).options);
  t.after(() => cleanupDaemon(first));

  await assert.rejects(
    startDaemon(daemonParts(fixture).options),
    (error: unknown) => error instanceof RealmError && error.code === "LOCK_CONFLICT",
  );

  // The first owner still serves.
  const reply = await sendRequest(first.socketPath, { id: "s1", method: "status" });
  assert.equal(reply.id, "s1");
  assert.ok(reply.result !== undefined);

  const down = await sendRequest(first.socketPath, { id: "d1", method: "down" });
  assert.equal(down.id, "d1");
  assert.ok(down.result !== undefined);
  await awaitDone(first);
});

void test("CLI-01: startDaemon runs the reap sweep before serving and deletes pre-existing records (P6-D4)", async (t) => {
  const fixture = makeDirs();
  const { options, events } = daemonParts(fixture);
  mkdirSync(join(fixture.stateDir, "sessions"), { recursive: true });
  const stale = join(fixture.stateDir, "sessions", "stale-session.json");
  writeFileSync(stale, JSON.stringify({ sessionId: "stale-session" }));

  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  assert.deepEqual(events, ["sweep"]);
  assert.equal(existsSync(stale), false);

  const reply = await sendRequest(daemon.socketPath, { id: "s1", method: "status" });
  assert.equal(snapshotStateOf(reply), "unbound");

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down" });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("CLI-01: a failed sweep rejects startup before any record is touched (P6-D4)", async () => {
  const fixture = makeDirs();
  mkdirSync(join(fixture.stateDir, "sessions"), { recursive: true });
  const kept = join(fixture.stateDir, "sessions", "kept-session.json");
  writeFileSync(kept, "{}");
  const { options } = daemonParts(fixture, {
    sweep: () => Promise.reject(makeRealmError("REALM_STOPPING")),
  });

  await assert.rejects(
    startDaemon(options),
    (error: unknown) => error instanceof RealmError && error.code === "REALM_STOPPING",
  );
  assert.equal(existsSync(kept), true);
  await assert.rejects(
    sendRequest(controlSocketPath(fixture.stateDir), { id: "s1", method: "status" }),
  );
});

void test("CLI-01: up with a failing probe answers the probe code without starting (P6-D5)", async (t) => {
  const fixture = makeDirs();
  const { options, exec, events } = daemonParts(fixture, {
    probe: () => Promise.resolve<PodmanProbeResult>({ ok: false, code: "PODMAN_MISSING", reason: "podman is missing" }),
  });
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  const reply = await sendRequest(daemon.socketPath, {
    id: "up-1",
    method: "up",
    params: { workspaceRoot: fixture.ws },
  });
  assert.deepEqual(reply, { id: "up-1", error: { code: "PODMAN_MISSING" } });
  assert.equal(exec.callCount("create"), 0);
  assert.deepEqual(events, ["sweep"]);

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down" });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("CLI-01: up with a healthy probe starts the session and answers the active snapshot", async (t) => {
  const fixture = makeDirs();
  const { options, events } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  const reply = await sendRequest(daemon.socketPath, {
    id: "up-1",
    method: "up",
    params: { workspaceRoot: fixture.ws },
  });
  assert.equal(reply.id, "up-1");
  assert.equal(snapshotStateOf(reply), "active");
  assert.equal(displayLabelOf(reply), STATUS_LABELS.active);
  assert.deepEqual(events, ["sweep", "probe", "create"]);

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down" });
  assert.equal(snapshotStateOf(down), "unbound");
  await awaitDone(daemon);
});

void test("CLI-01: up with a missing workspaceRoot refuses with SCHEMA_INVALID", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  const empty = await sendRequest(daemon.socketPath, { id: "up-1", method: "up", params: {} });
  assert.deepEqual(empty, { id: "up-1", error: { code: "SCHEMA_INVALID" } });
  const absent = await sendRequest(daemon.socketPath, { id: "up-2", method: "up" });
  assert.deepEqual(absent, { id: "up-2", error: { code: "SCHEMA_INVALID" } });

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down" });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("CLI-01: doctor dispatches runChecks over the socket", async (t) => {
  const fixture = makeDirs();
  const report: readonly CheckResult[] = [
    { id: "policy-file", status: "pass", detail: "policy file ok", fix: null },
  ];
  const { options } = daemonParts(fixture, {
    runChecks: (doctorOptions) =>
      new Promise<readonly CheckResult[]>((resolve) => {
        assert.equal(doctorOptions.stateDir, fixture.stateDir);
        resolve(report);
      }),
  });
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  const reply = await sendRequest(daemon.socketPath, { id: "doc-1", method: "doctor" });
  assert.equal(reply.id, "doc-1");
  assert.deepEqual(reply.result, report);

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down" });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

interface DispatcherRecord {
  readonly raws: unknown[];
  readonly outcomes: ToolOutcome[];
}

// Wraps the daemon's own dispatcher instance so each raw tool object and the outcome it produced
// are recorded. With no replacement the real pipeline runs; with one, the replacement answers.
function recordDispatcherCalls(
  daemon: StartedDaemon,
  replacement?: (raw: unknown) => Promise<ToolOutcome>,
): DispatcherRecord {
  const dispatcher = daemon.handle.dispatcher;
  const real = dispatcher.call.bind(dispatcher);
  const record: DispatcherRecord = { raws: [], outcomes: [] };
  dispatcher.call = async (raw: unknown): Promise<ToolOutcome> => {
    record.raws.push(raw);
    const outcome = await (replacement === undefined ? real(raw) : replacement(raw));
    record.outcomes.push(outcome);
    return outcome;
  };
  return record;
}

void test("RT-06: a tool request reaches the dispatcher exactly once and answers its outcome (P6-D12)", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  const record = recordDispatcherCalls(daemon);

  const reply = await sendRequest(daemon.socketPath, {
    id: "tool-1",
    method: "tool",
    params: { tool: { status: {} } },
  });
  assert.equal(reply.id, "tool-1");
  assert.equal(reply.error, undefined);
  assert.deepEqual(record.raws, [{ status: {} }]);
  const [outcome] = record.outcomes;
  assert.ok(outcome !== undefined, "the dispatcher must answer exactly one outcome");
  assert.deepEqual(reply.result, JSON.parse(JSON.stringify(outcome)));

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down" });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("RT-06: a tool request without a tool object refuses with SCHEMA_INVALID and never reaches the dispatcher (P6-D2, P6-D12)", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  const record = recordDispatcherCalls(daemon);

  const withoutTool: ControlRequest[] = [
    { id: "t-1", method: "tool" },
    { id: "t-2", method: "tool", params: {} },
    { id: "t-3", method: "tool", params: { tool: null } },
    { id: "t-4", method: "tool", params: { tool: "status" } },
    { id: "t-5", method: "tool", params: { tool: [] } },
    { id: "t-6", method: "tool", params: [] },
  ];
  for (const request of withoutTool) {
    const reply = await sendRequest(daemon.socketPath, request);
    assert.deepEqual(reply, { id: request.id, error: { code: "SCHEMA_INVALID" } });
  }
  assert.deepEqual(record.raws, []);

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down" });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("RT-06: a dispatcher that throws a RealmError answers that error's catalogue code (P6-D12)", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  const record = recordDispatcherCalls(daemon, () => Promise.reject(makeRealmError("TOOL_TIMEOUT")));

  const reply = await sendRequest(daemon.socketPath, {
    id: "tool-2",
    method: "tool",
    params: { tool: { status: {} } },
  });
  assert.deepEqual(reply, { id: "tool-2", error: { code: "TOOL_TIMEOUT" } });
  assert.equal(record.raws.length, 1);

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down" });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("RT-06: a refused outcome answers its catalogue code and no other field (P6-D12)", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  recordDispatcherCalls(
    daemon,
    () =>
      Promise.resolve<ToolOutcome>({
        outcome: "refused",
        tool: "read",
        code: "POLICY_DENIED",
        retryable: false,
      }),
  );

  const reply = await sendRequest(daemon.socketPath, {
    id: "tool-3",
    method: "tool",
    params: { tool: { read: { path: "doc.txt", maxBytes: 16 } } },
  });
  assert.deepEqual(reply, { id: "tool-3", error: { code: "POLICY_DENIED" } });

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down" });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("RT-06: an oversized request line is refused with a null-id SCHEMA_INVALID, and the dispatcher never sees it (P6-D2, P6-D12)", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  const record = recordDispatcherCalls(daemon);

  const padding = "x".repeat(MAX_CONTROL_LINE_BYTES);
  const oversized = `{"id":"big-1","method":"tool","params":{"tool":{"status":{}},"pad":"${padding}"}}`;
  const raw = await sendRawLine(daemon.socketPath, `${oversized}\n`);
  assert.deepEqual(JSON.parse(raw), { id: null, error: { code: "SCHEMA_INVALID" } });
  assert.deepEqual(record.raws, []);

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down" });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("CLI-01: a status reply carries the policy mode the daemon loaded (P6-D12)", async (t) => {
  const fixture = makeDirs();
  const policyPath = writePolicy(fixture, "fail-closed-policy.json", {
    mode: "fail-closed",
    workspaceRoots: [fixture.ws],
  });
  const { options } = daemonParts(fixture, { policyPath });
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  const status = await sendRequest(daemon.socketPath, { id: "s1", method: "status" });
  const result: unknown = status.result;
  const mode = typeof result === "object" && result !== null && "mode" in result ? result.mode : undefined;
  assert.equal(mode, "fail-closed");

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down" });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("RT-06: unknown methods and malformed lines refuse with SCHEMA_INVALID and carry the id", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  const unknown = await sendRequest(daemon.socketPath, { id: "u1", method: "nope" });
  assert.deepEqual(unknown, { id: "u1", error: { code: "SCHEMA_INVALID" } });

  const raw = await sendRawLine(daemon.socketPath, '{"id":"raw-1","method":42}\n');
  assert.deepEqual(JSON.parse(raw), { id: "raw-1", error: { code: "SCHEMA_INVALID" } });

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down" });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("CLI-01: down drains, closes, removes the socket, and resolves done", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  const before = await sendRequest(daemon.socketPath, { id: "s1", method: "status" });
  assert.equal(snapshotStateOf(before), "unbound");

  const reply = await sendRequest(daemon.socketPath, { id: "d1", method: "down" });
  assert.equal(reply.id, "d1");
  assert.equal(snapshotStateOf(reply), "unbound");
  await awaitDone(daemon);
  assert.equal(existsSync(daemon.socketPath), false);
  await assert.rejects(sendRequest(daemon.socketPath, { id: "after", method: "status" }));
});

void test("CLI-01: a second down is a no-op that still answers", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  const [first, second] = await Promise.all([
    sendRequest(daemon.socketPath, { id: "down-1", method: "down" }),
    sendRequest(daemon.socketPath, { id: "down-2", method: "down" }),
  ]);
  assert.equal(first.id, "down-1");
  assert.ok(first.result !== undefined && first.error === undefined);
  assert.equal(second.id, "down-2");
  assert.ok(second.result !== undefined && second.error === undefined);
  await awaitDone(daemon);
  assert.equal(existsSync(daemon.socketPath), false);
});

void test("QUAL-01: a connection that waits on a failed start is answered with the start's refusal code", async () => {
  const fixture = makeDirs();
  let sweepEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    sweepEntered = resolve;
  });
  let connectionAccepted!: () => void;
  const accepted = new Promise<void>((resolve) => {
    connectionAccepted = resolve;
  });
  let failSweep!: (cause: unknown) => void;
  const { options } = daemonParts(fixture, {
    onServer: (server) => {
      server.once("connection", () => {
        connectionAccepted();
      });
    },
    sweep: () => {
      sweepEntered();
      return new Promise<number>((_resolve, reject) => {
        failSweep = reject;
      });
    },
  });
  const starting = startDaemon(options);
  await bounded(entered, "the start sweep");
  const waiting = sendRawLine(controlSocketPath(fixture.stateDir), '{"id":"early","method":"status"}\n');
  // The start fails only once the server has accepted this connection. Closing the listening socket first would
  // reset the connection still in the accept queue, and the client would see a reset rather than the refusal.
  await bounded(accepted, "the early connection");
  failSweep(makeRealmError("REALM_STOPPING"));
  await bounded(
    assert.rejects(starting, (error: unknown) => error instanceof RealmError && error.code === "REALM_STOPPING"),
    "the failed start",
  );
  assert.deepEqual(JSON.parse(await bounded(waiting, "the refusal")), { id: null, error: { code: "REALM_STOPPING" } });
});

void test("QUAL-01: a connection that never completes its request line is answered TOOL_TIMEOUT", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture, { timeoutMs: 100 });
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  const raw = await sendRawLine(daemon.socketPath, '{"id":"partial"');
  assert.deepEqual(JSON.parse(raw), { id: null, error: { code: "TOOL_TIMEOUT" } });
});

void test("QUAL-01: a down whose socket file cannot be removed answers SCHEMA_INVALID and still stops", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  // Connected before the swap, so the down request reaches the daemon over this connection.
  const client = createConnection(daemon.socketPath);
  t.after(() => {
    client.destroy();
  });
  await bounded(
    new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    }),
    "the client connection",
  );
  // A non-empty directory where the socket file was: removing it without recursion fails.
  rmSync(daemon.socketPath, { force: true });
  mkdirSync(daemon.socketPath);
  writeFileSync(join(daemon.socketPath, "kept"), "not a socket");
  const raw = await bounded(replyOn(client, '{"id":"down-1","method":"down"}\n'), "the down reply");
  assert.deepEqual(JSON.parse(raw), { id: "down-1", error: { code: "SCHEMA_INVALID" } });
  await awaitDone(daemon);
});

void test("QUAL-01: a failed start whose socket file cannot be removed keeps its code and names the removal cause", async () => {
  const fixture = makeDirs();
  const socketPath = controlSocketPath(fixture.stateDir);
  const { options } = daemonParts(fixture, {
    sweep: () =>
      new Promise<number>((_resolve, reject) => {
        // The socket is listening here: a non-empty directory takes its file's place, then the start fails.
        rmSync(socketPath, { force: true });
        mkdirSync(socketPath);
        writeFileSync(join(socketPath, "kept"), "not a socket");
        reject(makeRealmError("REALM_STOPPING"));
      }),
  });
  await bounded(
    assert.rejects(
      startDaemon(options),
      (error: unknown) =>
        error instanceof RealmError && error.code === "REALM_STOPPING" && error.causeCode === "SCHEMA_INVALID",
    ),
    "the failed start",
  );
});

void test("QUAL-01: a reply that cannot be encoded is answered SCHEMA_INVALID, not a silent close", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  // A BigInt cannot be JSON-encoded, so the outcome cannot be written as dispatched.
  const unencodable: unknown = { outcome: "done", tool: "status", value: { size: BigInt(1) } };
  recordDispatcherCalls(daemon, () => Promise.resolve(unencodable as ToolOutcome));
  const reply = await sendRequest(daemon.socketPath, { id: "big-1", method: "tool", params: { tool: { status: {} } } });
  assert.deepEqual(reply, { id: "big-1", error: { code: "SCHEMA_INVALID" } });
});

void test("QUAL-01: a listening server that fails stops the daemon, and done rejects with that error's code", async (t) => {
  const fixture = makeDirs();
  const servers: Server[] = [];
  const { options } = daemonParts(fixture, {
    onServer: (server) => {
      servers.push(server);
    },
  });
  const daemon = await startDaemon(options);
  const listening = servers[0];
  assert.ok(listening !== undefined, "the daemon hands out its listening server");
  t.after(() => {
    listening.close();
  });
  const stopped = daemon.done.then(
    () => "resolved",
    (cause: unknown) => (cause instanceof RealmError ? cause.code : "not a RealmError"),
  );
  listening.emit("error", makeRealmError("REALM_NOT_ACTIVE"));
  let timer: NodeJS.Timeout | undefined;
  const outcome = await Promise.race([
    stopped,
    new Promise<string>((resolve) => {
      timer = setTimeout(() => {
        resolve("still serving");
      }, 5000);
    }),
  ]).finally(() => {
    clearTimeout(timer);
  });
  assert.equal(outcome, "REALM_NOT_ACTIVE");
});

void test("CLI-01: a fresh start makes the state and run directories 0700 and leaves a missing ancestor at the default mode (P6-D3)", async (t) => {
  const fixture = makeDirs();
  const ancestor = join(fixture.base, "ancestor");
  const stateDir = join(ancestor, "state");
  const { options } = daemonParts({ ...fixture, stateDir });
  const probe = join(fixture.base, "default-mode-probe");
  mkdirSync(probe);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  assert.equal(statSync(stateDir).mode & 0o777, 0o700);
  assert.equal(statSync(join(stateDir, "run")).mode & 0o777, 0o700);
  assert.equal(statSync(ancestor).mode & 0o777, statSync(probe).mode & 0o777, "the missing ancestor keeps the default mode");
});
