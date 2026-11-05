import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Policy } from "../../src/contract/validate.js";
import { ERROR_CATALOGUE, makeRealmError, RealmError } from "../../src/core/errors.js";
import { LockTable } from "../../src/fs/locks.js";
import { bindWorkspaceUnderPolicy } from "../../src/fs/root.js";
import { hydrateAdopted } from "../../src/lifecycle/adoption.js";
import { LifecycleController } from "../../src/lifecycle/controller.js";
import { realmSandboxName } from "../../src/runtime/openshell.js";
import { controlSocketPath } from "../../src/session/paths.js";
import { SessionStore } from "../../src/session/store.js";
import { FakeBridge } from "../support/fake-bridge.js";
import { FakeExecutionService } from "../support/fake-execution.js";
import { currentBootId } from "../../src/session/proc-identity.js";
import { groupHasMembers, runnerRecordOf, writeRunnerRecord, type RunnerRecord } from "../../src/session/runner-record.js";
import { boundedWait } from "../support/timing.js";

const SESSION = "session-1";
const SANDBOX = realmSandboxName(SESSION);
const CLOCK_TIME = "2026-10-21T09:30:00.000Z";

function policyFor(workspaceRoots: readonly string[], startupBudgetMs: number): Policy {
  return {
    mode: "advisory",
    workspaceRoots,
    credentialAllow: [],
    egressAllow: [],
    shellEnabled: false,
    startupBudgetMs,
    toolQueueMs: 2000,
  };
}

interface FixtureOptions {
  readonly startupBudgetMs?: number;
  // The runner stop of hydration. Defaults to a short grace, so a test that stops a runner does not wait the production grace.
  readonly runnerStop?: { readonly graceMs?: number; readonly groupLive?: (pgid: number) => boolean };
}

interface Fixture {
  readonly workspace: string;
  readonly store: SessionStore;
  readonly exec: FakeExecutionService;
  readonly bridge: FakeBridge;
  readonly controller: LifecycleController;
}

function fixture(t: TestContext, options: FixtureOptions = {}): Fixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-hydrate-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const workspace = join(base, "workspace");
  mkdirSync(workspace);
  const pinnedRoot = bindWorkspaceUnderPolicy([workspace], workspace);
  const store = new SessionStore(join(base, "state"));
  const exec = new FakeExecutionService();
  const bridge = new FakeBridge();
  const controller = new LifecycleController({
    sessionId: SESSION,
    policy: policyFor([workspace], options.startupBudgetMs ?? 10000),
    store,
    exec,
    bridge,
    clock: () => new Date(CLOCK_TIME),
    locks: new LockTable(),
    pinnedRoot,
    runnerStop: options.runnerStop ?? { graceMs: 200 },
  });
  return { workspace, store, exec, bridge, controller };
}

function assertRejectsWith(promise: Promise<unknown>, code: string): Promise<void> {
  return assert.rejects(promise, (error: unknown) => error instanceof RealmError && error.code === code);
}

// Writes the record the startup reaper keeps for an adopted container.
function saveRecord(f: Fixture, containerId: string): void {
  f.store.save({
    realmId: randomUUID(),
    sessionId: SESSION,
    workspaceRoot: f.workspace,
    state: "active",
    controlSocketPath: controlSocketPath(f.store.stateDir),
    containerId,
  });
}

// Linux caps pids at 4194304 (2^22), so no process can hold this pid. A record that names it names no live runner.
const NO_LIVE_PID = 4194305;

function bootIdOrFail(): string {
  const bootId = currentBootId();
  assert.ok(bootId !== null, "the boot id is readable on this host");
  return bootId;
}

// Stands in for the startup reaper: the port holds a verified container for this session and the
// record names it. The runner record names no live runner, so hydration has no runner to stop and goes on. Returns the survivor's containerId.
async function adoptSurvivor(f: Fixture): Promise<string> {
  const { containerId } = await f.exec.create({ idempotencyKey: SESSION, workspaceRoot: f.workspace });
  saveRecord(f, containerId);
  writeRunnerRecord(f.store.stateDir, SESSION, {
    schema: 1,
    pid: NO_LIVE_PID,
    pgid: NO_LIVE_PID,
    startTicks: 0,
    bootId: bootIdOrFail(),
  });
  return containerId;
}

// The real exit event of each stand-in, by its process, so a case reads the signal the process exited with, not a proxy.
const runnerExits = new WeakMap<ChildProcess, Promise<void>>();

// A live process that leads its own group: the stand-in for a runner a previous daemon left running. The test kills its group
// at the end and awaits the exit within a bound, so nothing outlives the test and a stand-in that does not exit fails the test.
function liveRunner(t: TestContext): ChildProcess {
  const proc = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  const exited = new Promise<void>((resolve) => {
    proc.once("exit", () => {
      resolve();
    });
    proc.once("error", () => {
      resolve();
    });
  });
  runnerExits.set(proc, exited);
  t.after(async () => {
    if (proc.pid !== undefined) {
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        // The group is already gone.
      }
    }
    await boundedWait(exited, "the runner stand-in exits", 5000);
  });
  return proc;
}

// The signal the stand-in exited with, read after its real exit event has fired. The wait is bounded, so a stand-in that never
// exits fails the case instead of hanging it. Returns null when it exited with a code and no signal.
async function exitSignalOf(proc: ChildProcess): Promise<NodeJS.Signals | null> {
  const exited = runnerExits.get(proc);
  assert.ok(exited !== undefined, "the stand-in is tracked");
  await boundedWait(exited, "the runner stand-in exits", 5000);
  return proc.signalCode;
}

// Writes the record of a live runner, taken from the production helper, with the fields in edit replaced. Returns what it wrote.
function recordRunner(f: Fixture, runner: ChildProcess, edit: Partial<RunnerRecord> = {}): RunnerRecord {
  const pid = runner.pid;
  assert.ok(pid !== undefined, "the runner has a pid");
  const record = runnerRecordOf(pid, bootIdOrFail());
  assert.ok(record !== null, "the runner leads its own process group");
  const written: RunnerRecord = { ...record, ...edit };
  writeRunnerRecord(f.store.stateDir, SESSION, written);
  return written;
}

void test("a verified survivor hydrates to active with no create, and its containerId stays in the record", async (t) => {
  const f = fixture(t);
  const survivor = await adoptSurvivor(f);
  const before = f.exec.calls().length;

  const snapshot = await f.controller.hydrate(survivor);

  assert.equal(snapshot.state, "active");
  assert.equal(f.store.load(SESSION)?.containerId, survivor);
  assert.equal(f.store.load(SESSION)?.state, "active");
  assert.deepEqual(f.exec.calls().slice(before), [
    { operation: "start", containerId: survivor, sandbox: SANDBOX },
  ]);
});

void test("hydration connects the bridge once and subscribes it, so a later bridge event reaches the session", async (t) => {
  const f = fixture(t);
  const survivor = await adoptSurvivor(f);

  await f.controller.hydrate(survivor);

  assert.equal(f.bridge.callCount("connect"), 1);
  f.bridge.emit({ kind: "down" });
  assert.equal(f.controller.snapshot().state, "degraded");
});

void test("a record that names another container is refused before any port call", async (t) => {
  const f = fixture(t);
  const survivor = await adoptSurvivor(f);
  saveRecord(f, "fake-container-other");
  const before = f.exec.calls().length;

  await assertRejectsWith(f.controller.hydrate(survivor), "SCHEMA_INVALID");

  assert.equal(f.exec.calls().length, before);
  assert.equal(f.bridge.calls().length, 0);
  assert.equal(f.controller.snapshot().state, "unbound");
});

void test("a start that rejects moves the session to error with its code, and the survivor is removed", async (t) => {
  const f = fixture(t);
  const survivor = await adoptSurvivor(f);
  f.exec.failNext("start", "AGENTOS_CRASH_LOOP");
  const before = f.exec.calls().length;

  const snapshot = await f.controller.hydrate(survivor);

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "AGENTOS_CRASH_LOOP");
  assert.deepEqual(
    f.exec.calls().slice(before).map((call) => call.operation),
    ["start", "destroy"],
  );
  assert.equal(f.exec.resources().length, 0);
  assert.equal(f.store.load(SESSION)?.containerId, null);
  assert.equal(f.bridge.callCount("connect"), 0);
});

void test("when the removal of a failed survivor is unproven, the record keeps its containerId", async (t) => {
  const f = fixture(t);
  const survivor = await adoptSurvivor(f);
  f.exec.failNext("start", "AGENTOS_CRASH_LOOP");
  f.exec.failNext("destroy", "OPENSHELL_START_FAILED");

  const snapshot = await f.controller.hydrate(survivor);

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "AGENTOS_CRASH_LOOP");
  assert.equal(f.store.load(SESSION)?.containerId, survivor);
  assert.equal(f.exec.resources().length, 1);
});

void test("after an unproven removal, the next start retries the same container without a create", async (t) => {
  const f = fixture(t);
  const survivor = await adoptSurvivor(f);
  f.exec.failNext("start", "AGENTOS_CRASH_LOOP");
  f.exec.failNext("destroy", "OPENSHELL_START_FAILED");
  await f.controller.hydrate(survivor);
  const before = f.exec.calls().length;

  const snapshot = await f.controller.start();

  assert.equal(snapshot.state, "active");
  assert.equal(f.store.load(SESSION)?.containerId, survivor);
  assert.deepEqual(
    f.exec.calls().slice(before).map((call) => call.operation),
    ["start"],
  );
  assert.equal(f.bridge.callCount("connect"), 1);
});

void test("a bridge connect that outlasts the startup budget gives STARTUP_BUDGET_EXCEEDED, which is retryable", async (t) => {
  const f = fixture(t, { startupBudgetMs: 50 });
  const survivor = await adoptSurvivor(f);
  f.bridge.setDelay("connect", 500);

  const snapshot = await f.controller.hydrate(survivor);

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "STARTUP_BUDGET_EXCEEDED");
  assert.equal(ERROR_CATALOGUE.STARTUP_BUDGET_EXCEEDED.retryable, true);
  assert.equal(f.exec.resources().length, 0);
  assert.equal(f.store.load(SESSION)?.containerId, null);
});

void test("a start still in flight when the budget expires settles before the survivor is removed", async (t) => {
  const f = fixture(t, { startupBudgetMs: 50 });
  const survivor = await adoptSurvivor(f);
  f.exec.setDelay("start", 300);
  const before = f.exec.calls().length;

  const snapshot = await f.controller.hydrate(survivor);

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "STARTUP_BUDGET_EXCEEDED");
  assert.deepEqual(
    f.exec.calls().slice(before).map((call) => call.operation),
    ["start", "destroy"],
  );
  assert.equal(f.exec.resources().length, 0);
  assert.equal(f.store.load(SESSION)?.containerId, null);
});

void test("a stop that begins during hydration keeps the session out of active, and the stale result writes nothing", async (t) => {
  const f = fixture(t);
  const survivor = await adoptSurvivor(f);
  let startCalled: () => void = () => undefined;
  const inStart = new Promise<void>((resolve) => {
    startCalled = resolve;
  });
  f.exec.beforeCall("start", () => {
    startCalled();
  });
  const releaseStart = f.exec.holdNext("start");

  const hydrating = f.controller.hydrate(survivor);
  await inStart;
  const stopping = f.controller.stop();
  releaseStart();
  const [hydrated] = await Promise.all([hydrating, stopping]);

  assert.notEqual(hydrated.state, "active");
  assert.equal(f.controller.snapshot().state, "unbound");
  assert.notEqual(f.store.load(SESSION)?.state, "active");
  assert.equal(f.bridge.callCount("connect"), 0);
});

void test("a bridge connect that fails after a stop began during hydration is kept, and the next destroy reports it as the cause of its own failure (C1, G-04)", async (t) => {
  const f = fixture(t);
  const survivor = await adoptSurvivor(f);
  // The connect is held behind a gate, so the stop begins while the bridge handshake is in flight. The connect then fails with
  // a port code that no background step records.
  let connectCalled: () => void = () => undefined;
  const inConnect = new Promise<void>((resolve) => {
    connectCalled = resolve;
  });
  let openGate: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    openGate = () => {
      resolve();
    };
  });
  f.bridge.connect = async () => {
    connectCalled();
    await gate;
    throw makeRealmError("PODMAN_MACHINE_DOWN");
  };

  const hydrating = f.controller.hydrate(survivor);
  await inConnect;
  const stopped = await f.controller.stop();
  openGate();
  await hydrating;
  assert.equal(stopped.state, "unbound");

  f.exec.failNext("destroy", "OPENSHELL_START_FAILED");
  await assert.rejects(
    f.controller.destroy(),
    (error: unknown) =>
      error instanceof RealmError && error.code === "OPENSHELL_START_FAILED" && error.causeCode === "PODMAN_MACHINE_DOWN",
  );
});

void test("hydration refuses a workspace that is no longer the pinned directory, with no port call and no state change", async (t) => {
  const f = fixture(t);
  const survivor = await adoptSurvivor(f);
  const before = f.exec.calls().length;
  renameSync(f.workspace, `${f.workspace}-moved`);
  mkdirSync(f.workspace);

  await assertRejectsWith(f.controller.hydrate(survivor), "POLICY_DENIED");
  assert.equal(f.exec.calls().length, before, "no port call is made");
  assert.equal(f.controller.snapshot().state, "unbound", "the session state is unchanged");
});

function exitedOf(proc: ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

void test("a live recorded runner is terminated before exec.start is called", async (t) => {
  const f = fixture(t);
  const survivor = await adoptSurvivor(f);
  const runner = liveRunner(t);
  const pid = runner.pid;
  assert.ok(pid !== undefined, "the runner has a pid");
  recordRunner(f, runner);
  // The group probe at exec.start: no live member means the runner had been stopped before the start was issued.
  let membersAtStart: boolean | undefined;
  f.exec.beforeCall("start", () => {
    membersAtStart = groupHasMembers(pid);
  });

  const snapshot = await f.controller.hydrate(survivor);

  assert.equal(snapshot.state, "active");
  assert.equal(membersAtStart, false, "the recorded group was empty when exec.start was called");
  assert.equal(await exitSignalOf(runner), "SIGTERM", "the recorded runner exited on SIGTERM, the signal that stops it first");
});

void test("exec.start is called once, and only while the recorded group holds no live member", async (t) => {
  const f = fixture(t);
  const survivor = await adoptSurvivor(f);
  const runner = liveRunner(t);
  const pid = runner.pid;
  assert.ok(pid !== undefined, "the runner has a pid");
  recordRunner(f, runner);
  let membersAtStart: boolean | undefined;
  f.exec.beforeCall("start", () => {
    membersAtStart = groupHasMembers(pid);
  });

  await f.controller.hydrate(survivor);

  assert.equal(membersAtStart, false, "the recorded group was empty when exec.start was called");
  assert.equal(f.exec.calls().filter((call) => call.operation === "start").length, 1);
});

void test("an absent runner record means the session is not adopted, and no signal is sent", async (t) => {
  const f = fixture(t);
  const survivor = await adoptSurvivor(f);
  rmSync(join(f.store.stateDir, `${SESSION}.runner.json`));
  const bystander = liveRunner(t);
  const before = f.exec.calls().length;

  const snapshot = await f.controller.hydrate(survivor);

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "OPENSHELL_START_FAILED");
  assert.equal(bystander.signalCode, null, "no signal reached the live process");
  assert.equal(exitedOf(bystander), false);
  const after = f.exec.calls().slice(before);
  assert.equal(after.some((call) => call.operation === "start"), false, "exec.start is not called");
  assert.equal(after.some((call) => call.operation === "destroy"), true, "the survivor is removed");
});

void test("a recorded pid that is alive with other start ticks is never signalled, and the session is not adopted", async (t) => {
  const f = fixture(t);
  const survivor = await adoptSurvivor(f);
  const runner = liveRunner(t);
  const live = recordRunner(f, runner);
  recordRunner(f, runner, { startTicks: live.startTicks + 1 });
  const before = f.exec.calls().length;

  const snapshot = await f.controller.hydrate(survivor);

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "OPENSHELL_START_FAILED");
  assert.equal(runner.signalCode, null, "a reused pid is never signalled");
  assert.equal(exitedOf(runner), false);
  assert.equal(f.exec.calls().slice(before).some((call) => call.operation === "start"), false, "exec.start is not called");
});

void test("a record from another boot is not adopted, and its runner is not signalled", async (t) => {
  const f = fixture(t);
  const survivor = await adoptSurvivor(f);
  const runner = liveRunner(t);
  recordRunner(f, runner, { bootId: "boot-of-another-kernel" });
  const before = f.exec.calls().length;

  const snapshot = await f.controller.hydrate(survivor);

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "OPENSHELL_START_FAILED");
  assert.equal(runner.signalCode, null, "a record from another boot is not acted on");
  assert.equal(exitedOf(runner), false);
  assert.equal(f.exec.calls().slice(before).some((call) => call.operation === "start"), false, "exec.start is not called");
});

void test("a group that still holds members after the stop is not adopted, and exec.start is not called", async (t) => {
  // The group probe reports members at every check, which models a group that survives the stop. A real SIGKILL cannot be
  // ignored, so the survival is modelled here through the probe seam.
  const f = fixture(t, { runnerStop: { graceMs: 100, groupLive: () => true } });
  const survivor = await adoptSurvivor(f);
  const runner = liveRunner(t);
  recordRunner(f, runner);
  const before = f.exec.calls().length;

  const snapshot = await f.controller.hydrate(survivor);

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "OPENSHELL_START_FAILED");
  assert.equal(await exitSignalOf(runner), "SIGTERM", "the recorded runner exited on the SIGTERM sent to its group");
  assert.equal(f.exec.calls().slice(before).some((call) => call.operation === "start"), false, "exec.start is not called");
  assert.equal(f.exec.calls().slice(before).some((call) => call.operation === "destroy"), true, "the survivor is removed");
});

void test("a hydration that exceeds its budget reads error at the moment the failed count changes, not connecting", async (t) => {
  const f = fixture(t, { startupBudgetMs: 50 });
  const survivor = await adoptSurvivor(f);
  // The start is held, so the hydration cannot finish within its budget. The release runs before the fixture's cleanup, so the
  // held start settles and the survivor's removal can finish.
  const release = f.exec.holdNext("start");
  t.after(release);
  const pending = new Set([SESSION]);

  const failed = await hydrateAdopted(
    [{ sessionId: SESSION, containerId: survivor }],
    () => f.controller.hydrate(survivor),
    50,
    pending,
  );

  // Read at the moment hydrateAdopted returns with the failed count, with no wait: the state must already be error.
  assert.equal(failed, 1, "the hydration is counted as failed");
  assert.equal(pending.has(SESSION), false, "the session has left pending");
  assert.equal(f.controller.snapshot().state, "error", "the state is error at the moment the failure is counted");
  assert.equal(f.controller.snapshot().reason, "STARTUP_BUDGET_EXCEEDED");
});
