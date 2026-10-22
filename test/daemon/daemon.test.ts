// Daemon tests (CLI-01, RT-06, P6-D1, P6-D4, P6-D12). Every test drives the
// real module: single-owner start over a live Unix socket, the reap sweep
// before serving, all four CONTROL_METHODS over the channel, and graceful
// shutdown on down. No live Podman, OpenShell, or Anda engine is started: the
// adapter seam carries the existing fakes and scripted probes.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRealmError, RealmError } from "../../src/core/errors.js";
import { displayStatus, STATUS_LABELS } from "../../src/core/status.js";
import { sendRequest, type ControlReply } from "../../src/daemon/channel.js";
import {
  buildDaemonHandle,
  startDaemon,
  type StartedDaemon,
  type StartDaemonOptions,
} from "../../src/daemon/daemon.js";
import type { CheckResult } from "../../src/doctor/checks.js";
import { controlSocketPath } from "../../src/session/paths.js";
import { FakeBridge } from "../support/fake-bridge.js";
import { FakeExecutionService } from "../support/fake-execution.js";

// This file runs from dist/test/daemon, so three levels up is the package root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DAEMON_SOURCE = join(ROOT, "src", "daemon", "daemon.ts");

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

function makeDirs(t: TestContext): Fixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-daemon-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
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
      workloadArgv: ["/usr/bin/agent", "--serve"],
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
    sweep: async () => {
      events.push("sweep");
      return 0;
    },
    probe: async () => {
      events.push("probe");
      return { ok: true, version: "5.0.0" };
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
        timer = setTimeout(() => reject(new Error("daemon done did not resolve")), 5000);
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
    socket.once("error", (cause: unknown) => {
      clearTimeout(timer);
      socket.destroy();
      reject(cause);
    });
    socket.write(line);
  });
}

test("CLI-01: buildDaemonHandle wires the shared composition root and answers snapshot plus dispatcher status (P6-D12)", async (t) => {
  const fixture = makeDirs(t);
  const { options } = daemonParts(fixture);
  const handle = buildDaemonHandle(options);
  const snapshot = handle.controller.snapshot();
  assert.equal(snapshot.state, "unbound");
  assert.equal(displayStatus(snapshot).label, STATUS_LABELS.disconnected);

  const outcome = await handle.dispatcher.call({ status: {} });
  assert.equal(outcome.outcome, "done");
  if (outcome.outcome !== "done" || outcome.tool !== "status") {
    assert.fail("expected a done status");
  }
  assert.deepEqual(outcome.value.snapshot, snapshot);
  assert.equal(outcome.value.display.label, STATUS_LABELS.disconnected);
  await handle.close();
});

test("RT-06: startDaemon with no owner binds the socket and answers status over a real socket pair", async (t) => {
  const fixture = makeDirs(t);
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

test("RT-06: a second startDaemon against the same state directory refuses with LOCK_CONFLICT (single owner)", async (t) => {
  const fixture = makeDirs(t);
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

test("CLI-01: startDaemon runs the reap sweep before serving and deletes pre-existing records (P6-D4)", async (t) => {
  const fixture = makeDirs(t);
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

test("CLI-01: a failed sweep rejects startup before any record is touched (P6-D4)", async (t) => {
  const fixture = makeDirs(t);
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

test("CLI-01: up with a failing probe answers the probe code without starting (P6-D5)", async (t) => {
  const fixture = makeDirs(t);
  const { options, exec, events } = daemonParts(fixture, {
    probe: async () => ({ ok: false, code: "PODMAN_MISSING", reason: "podman is missing" }),
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

test("CLI-01: up with a healthy probe starts the session and answers the active snapshot", async (t) => {
  const fixture = makeDirs(t);
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

test("CLI-01: up with a missing workspaceRoot refuses with SCHEMA_INVALID", async (t) => {
  const fixture = makeDirs(t);
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

test("CLI-01: doctor dispatches runChecks over the socket", async (t) => {
  const fixture = makeDirs(t);
  const report: readonly CheckResult[] = [
    { id: "policy-file", status: "pass", detail: "policy file ok", fix: null },
  ];
  const { options } = daemonParts(fixture, {
    runChecks: async (doctorOptions) => {
      assert.equal(doctorOptions.stateDir, fixture.stateDir);
      return report;
    },
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

test("RT-06: unknown methods and malformed lines refuse with SCHEMA_INVALID and carry the id", async (t) => {
  const fixture = makeDirs(t);
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

test("CLI-01: down drains, closes, removes the socket, and resolves done", async (t) => {
  const fixture = makeDirs(t);
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

test("CLI-01: a second down is a no-op that still answers", async (t) => {
  const fixture = makeDirs(t);
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

test("RT-06: daemon.ts parses no argv, spawns no daemon, and reads no process environment (P6-D1)", () => {
  const source = readFileSync(DAEMON_SOURCE, "utf8");
  for (const forbidden of ["process.argv", "process.env", "process.exit", "detached"]) {
    assert.ok(!source.includes(forbidden), `daemon.ts must not contain ${forbidden}`);
  }
});
