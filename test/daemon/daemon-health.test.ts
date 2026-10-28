// Daemon health loop (RT-04, owner ruling N1). While the session is active or degraded the daemon probes it every
// HEALTH_PROBE_INTERVAL_MS through the controller, so a runner that died moves the session to error and the status label
// reads disconnected without a doctor run. The interval timer is replaced by a recording fake that the test fires by hand, so
// no test sleeps and no real timer is armed.

import { after, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRealmError, RealmError, type ErrorCode } from "../../src/core/errors.js";
import type { ProbeResult } from "../../src/core/ports.js";
import { STATUS_LABELS } from "../../src/core/status.js";
import { sendRequest, type ControlReply } from "../../src/daemon/channel.js";
import { HEALTH_PROBE_INTERVAL_MS, startDaemon, type StartedDaemon } from "../../src/daemon/daemon.js";
import { FakeBridge } from "../support/fake-bridge.js";
import { FakeExecutionService } from "../support/fake-execution.js";

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const CLOCK_ISO = "2026-10-21T09:30:00.000Z";

interface HeldProbe {
  readonly resolve: (result: ProbeResult) => void;
}

// An execution service whose probe can be held open, so a test decides when an in-flight probe ends.
class HoldableProbeExecution extends FakeExecutionService {
  private hold = false;
  private readonly held: HeldProbe[] = [];
  probeCalls = 0;

  holdProbes(): void {
    this.hold = true;
  }

  releaseProbes(): void {
    this.hold = false;
  }

  heldCount(): number {
    return this.held.length;
  }

  releaseNext(result: ProbeResult): void {
    const next = this.held.shift();
    assert.ok(next, "a probe is held");
    next.resolve(result);
  }

  override probe(containerId: string, sandbox: string): Promise<ProbeResult> {
    this.probeCalls += 1;
    if (!this.hold) {
      return super.probe(containerId, sandbox);
    }
    return new Promise<ProbeResult>((resolve) => {
      this.held.push({ resolve });
    });
  }
}

const scratchDirs: string[] = [];
after(() => {
  for (const dir of scratchDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface ArmedInterval {
  readonly callback: () => void;
  readonly ms: number;
  readonly handle: NodeJS.Timeout;
  cleared: boolean;
}

interface FakeIntervals {
  // Every interval armed so far, in order, including cleared ones.
  readonly armed: readonly ArmedInterval[];
  // The intervals armed and not cleared.
  live(): readonly ArmedInterval[];
  // Fires each live interval once, as one interval period elapsing.
  fire(): void;
}

// Replaces setInterval and clearInterval for the test. The fake records each interval and hands back a real timer object
// that never fires, so the code under test can ref and unref it and the test can read hasRef. The placeholder timers are
// cleared when the test ends.
function fakeIntervals(t: TestContext): FakeIntervals {
  const armed: ArmedInterval[] = [];
  t.mock.method(globalThis, "setInterval", (callback: () => void, ms: number): NodeJS.Timeout => {
    const handle = setTimeout(() => undefined, 2 ** 31 - 1);
    armed.push({ callback, ms, handle, cleared: false });
    return handle;
  });
  t.mock.method(globalThis, "clearInterval", (handle: NodeJS.Timeout | string | number | undefined): void => {
    const entry = armed.find((candidate) => candidate.handle === handle);
    if (entry !== undefined) {
      entry.cleared = true;
    }
  });
  t.after(() => {
    for (const entry of armed) {
      clearTimeout(entry.handle);
    }
  });
  const live = (): readonly ArmedInterval[] => armed.filter((entry) => !entry.cleared);
  return {
    armed,
    live,
    fire: () => {
      for (const entry of live()) {
        entry.callback();
      }
    },
  };
}

interface Running {
  readonly daemon: StartedDaemon;
  readonly exec: HoldableProbeExecution;
  readonly bridge: FakeBridge;
  readonly workspace: string;
  readonly failures: ErrorCode[];
  readonly servers: Server[];
}

// Starts a daemon over the fake execution service. The session stays unbound until activate.
async function startIdle(t: TestContext, andaUrl?: string): Promise<Running> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-health-daemon-")));
  scratchDirs.push(base);
  const workspace = join(base, "ws");
  mkdirSync(workspace, { recursive: true });
  const policyPath = join(base, "policy.json");
  writeFileSync(policyPath, JSON.stringify({ workspaceRoots: [workspace] }));
  const exec = new HoldableProbeExecution();
  const bridge = new FakeBridge();
  const failures: ErrorCode[] = [];
  const servers: Server[] = [];
  const daemon = await startDaemon({
    runtimeInput: {
      image: IMAGE,
      stateDir: join(base, "state"),
      workspaceRoot: workspace,
      ...(andaUrl === undefined ? {} : { andaUrl }),
    },
    policyPath,
    sessionId: "sess-health",
    exec,
    bridge,
    clock: () => new Date(CLOCK_ISO),
    runOpenShell: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "", truncated: false }),
    sweep: () => Promise.resolve(0),
    onHealthProbeFailure: (code) => {
      failures.push(code);
    },
    onServer: (server) => {
      servers.push(server);
    },
  });
  t.after(async () => {
    try {
      await sendRequest(daemon.socketPath, { id: "cleanup-down", method: "down" });
    } catch {
      // The test already took the daemon down, so there is nothing left to stop.
    }
  });
  return { daemon, exec, bridge, workspace, failures, servers };
}

async function startActive(t: TestContext, andaUrl?: string): Promise<Running> {
  const running = await startIdle(t, andaUrl);
  const snapshot = await running.daemon.handle.controller.create(running.workspace);
  assert.equal(snapshot.state, "active");
  return running;
}

function containerIdOf(running: Running): string {
  const container = running.exec.resources()[0];
  assert.ok(container, "the session has a container");
  return container.containerId;
}

// Lets the probe a tick started run to the end of its microtask chain.
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

function stateOf(running: Running): string {
  return running.daemon.handle.controller.snapshot().state;
}

async function statusLabelOf(running: Running): Promise<unknown> {
  const reply: ControlReply = await sendRequest(running.daemon.socketPath, { id: "status", method: "status" });
  const result: unknown = reply.result;
  if (typeof result === "object" && result !== null && "display" in result) {
    const display: unknown = result.display;
    if (typeof display === "object" && display !== null && "label" in display) {
      return display.label;
    }
  }
  return undefined;
}

void test("RT-04: the health interval is 10 seconds", () => {
  assert.equal(HEALTH_PROBE_INTERVAL_MS, 10_000);
});

void test("RT-04: the timer is armed only when the session becomes active, at the health interval, and does not hold the process open", async (t) => {
  const timers = fakeIntervals(t);
  const running = await startIdle(t);
  assert.equal(timers.armed.length, 0, "an unbound session arms no timer");

  await running.daemon.handle.controller.create(running.workspace);

  const live = timers.live();
  assert.equal(live.length, 1);
  const [armed] = live;
  assert.ok(armed);
  assert.equal(armed.ms, HEALTH_PROBE_INTERVAL_MS);
  assert.equal(armed.handle.hasRef(), false, "the timer is unref'd");
});

void test("RT-04: a healthy probe keeps the session active, and every tick probes again", async (t) => {
  const timers = fakeIntervals(t);
  const running = await startActive(t);

  timers.fire();
  await settle();
  timers.fire();
  await settle();

  assert.equal(running.exec.probeCalls, 2);
  assert.equal(stateOf(running), "active");
  assert.equal(await statusLabelOf(running), STATUS_LABELS.active);
});

void test("RT-04: an unhealthy probe moves the session to error and the label to disconnected", async (t) => {
  const timers = fakeIntervals(t);
  const running = await startActive(t);
  running.exec.setHealth(containerIdOf(running), "unhealthy");

  timers.fire();
  await settle();

  assert.equal(stateOf(running), "error");
  assert.equal(await statusLabelOf(running), STATUS_LABELS.disconnected);
});

void test("RT-04, N1: a probe that throws AGENTOS_CRASH_LOOP moves the session to error with that reason, and status reads realm disconnected", async (t) => {
  const timers = fakeIntervals(t);
  const running = await startActive(t);
  running.exec.failNext("probe", "AGENTOS_CRASH_LOOP");

  timers.fire();
  await settle();

  const snapshot = running.daemon.handle.controller.snapshot();
  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "AGENTOS_CRASH_LOOP");
  assert.equal(await statusLabelOf(running), STATUS_LABELS.disconnected);
  assert.deepEqual(running.failures, [], "a failure the controller recorded in the state is not a refusal");
});

void test("RT-04: a probe failure that is not a catalogue error moves the session to error and is reported with its typed code", async (t) => {
  const timers = fakeIntervals(t);
  const running = await startActive(t);
  running.exec.failNext("probe", new Error("raw runtime text"));

  timers.fire();
  await settle();

  assert.equal(stateOf(running), "error");
  assert.deepEqual(running.failures, ["OPENSHELL_START_FAILED"]);
});

void test("RT-04: probes never overlap: a tick that finds a probe running does nothing", async (t) => {
  const timers = fakeIntervals(t);
  const running = await startActive(t);
  running.exec.holdProbes();

  timers.fire();
  await settle();
  timers.fire();
  await settle();
  timers.fire();
  await settle();
  assert.equal(running.exec.probeCalls, 1, "one probe is in flight, so later ticks start none");
  assert.equal(running.exec.heldCount(), 1);

  running.exec.releaseNext("healthy");
  await settle();
  running.exec.releaseProbes();
  timers.fire();
  await settle();
  assert.equal(running.exec.probeCalls, 2, "the next tick probes once the first probe has ended");
  assert.equal(stateOf(running), "active");
});

void test("RT-04: no probe runs and no timer is live once the session is no longer active", async (t) => {
  const timers = fakeIntervals(t);
  const running = await startActive(t);
  await running.daemon.handle.controller.stop();

  assert.equal(timers.live().length, 0, "leaving active cleared the timer");
  timers.fire();
  await settle();
  assert.equal(running.exec.probeCalls, 0);
  assert.equal(stateOf(running), "unbound");
});

void test("RT-04: the timer is cleared when a probe moves the session to error, and an errored session is not probed again", async (t) => {
  const timers = fakeIntervals(t);
  const running = await startActive(t);
  running.exec.failNext("probe", "AGENTOS_CRASH_LOOP");
  timers.fire();
  await settle();
  assert.equal(stateOf(running), "error");

  assert.equal(timers.live().length, 0);
  timers.fire();
  await settle();
  assert.equal(running.exec.probeCalls, 1);
});

void test("RT-04: moving between active and degraded keeps exactly one timer, and a degraded session is probed", async (t) => {
  const timers = fakeIntervals(t);
  const running = await startActive(t, "http://127.0.0.1:9/");
  const first = timers.live()[0];
  assert.ok(first);

  running.bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
  assert.equal(stateOf(running), "degraded");
  assert.equal(first.cleared, false, "entering degraded keeps the running timer");
  assert.equal(timers.armed.length, 1, "no second timer was armed");
  assert.equal(timers.live().length, 1);
  timers.fire();
  await settle();
  assert.equal(running.exec.probeCalls, 1, "a degraded session is probed");
  assert.equal(stateOf(running), "degraded");

  running.bridge.emit({ kind: "up" });
  assert.equal(stateOf(running), "active");
  assert.equal(timers.armed.length, 1, "returning to active arms no second timer");
  assert.equal(timers.live().length, 1);
  timers.fire();
  await settle();
  assert.equal(running.exec.probeCalls, 2);
});

void test("RT-04: a dead runner in degraded moves the session to error with AGENTOS_CRASH_LOOP, and the label reads disconnected", async (t) => {
  const timers = fakeIntervals(t);
  const running = await startActive(t, "http://127.0.0.1:9/");
  running.bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
  assert.equal(stateOf(running), "degraded");
  running.exec.failNext("probe", "AGENTOS_CRASH_LOOP");

  timers.fire();
  await settle();

  const snapshot = running.daemon.handle.controller.snapshot();
  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "AGENTOS_CRASH_LOOP");
  assert.equal(await statusLabelOf(running), STATUS_LABELS.disconnected);
  assert.equal(timers.live().length, 0, "the timer is cleared once the probe moved the session to error");
});

void test("RT-04: a timer armed in degraded is cleared when the session leaves degraded, and no probe runs afterwards", async (t) => {
  const timers = fakeIntervals(t);
  const running = await startActive(t, "http://127.0.0.1:9/");
  running.bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
  assert.equal(stateOf(running), "degraded");
  assert.equal(timers.live().length, 1);

  await running.daemon.handle.controller.stop();

  assert.equal(stateOf(running), "unbound");
  assert.equal(timers.live().length, 0, "leaving degraded cleared the timer");
  timers.fire();
  await settle();
  assert.equal(running.exec.probeCalls, 0);
});

void test("RT-04: a bridge mismatch that takes a degraded session to error clears the timer", async (t) => {
  const timers = fakeIntervals(t);
  const running = await startActive(t, "http://127.0.0.1:9/");
  running.bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
  assert.equal(timers.live().length, 1);

  running.bridge.emit({ kind: "mismatch", code: "ANDA_VERSION_MISMATCH" });

  assert.equal(stateOf(running), "error");
  assert.equal(timers.live().length, 0);
  timers.fire();
  await settle();
  assert.equal(running.exec.probeCalls, 0);
});

void test("RT-04: the timer is cleared on down, and no probe runs afterwards", async (t) => {
  const timers = fakeIntervals(t);
  const running = await startActive(t);
  assert.equal(timers.live().length, 1);

  await sendRequest(running.daemon.socketPath, { id: "down-1", method: "down" });
  await running.daemon.done;

  assert.equal(timers.live().length, 0);
  timers.fire();
  await settle();
  assert.equal(running.exec.probeCalls, 0);
});

void test("RT-04: the timer is cleared when the daemon stops for a failed listening server", async (t) => {
  const timers = fakeIntervals(t);
  const running = await startActive(t);
  const listening = running.servers[0];
  assert.ok(listening);
  const stopped = running.daemon.done.then(
    () => "resolved",
    (cause: unknown) => (cause instanceof RealmError ? cause.code : "not a RealmError"),
  );

  listening.emit("error", makeRealmError("REALM_NOT_ACTIVE"));

  assert.equal(await stopped, "REALM_NOT_ACTIVE");
  assert.equal(timers.live().length, 0);
  timers.fire();
  await settle();
  assert.equal(running.exec.probeCalls, 0);
});

void test("RT-04: an unhealthy result that lands after down began does not resurrect or overwrite the state", async (t) => {
  const timers = fakeIntervals(t);
  const running = await startActive(t);
  running.exec.holdProbes();
  timers.fire();
  await settle();
  assert.equal(running.exec.heldCount(), 1);

  await sendRequest(running.daemon.socketPath, { id: "down-1", method: "down" });
  await running.daemon.done;
  assert.equal(stateOf(running), "unbound");
  running.exec.releaseNext("unhealthy");
  await settle();

  assert.equal(stateOf(running), "unbound", "the late result is ignored");
  assert.deepEqual(running.failures, []);
});
