import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Policy } from "../../src/contract/validate.js";
import { ERROR_CATALOGUE, RealmError } from "../../src/core/errors.js";
import { LockTable } from "../../src/fs/locks.js";
import { bindWorkspaceUnderPolicy } from "../../src/fs/root.js";
import { LifecycleController } from "../../src/lifecycle/controller.js";
import { realmSandboxName } from "../../src/runtime/openshell.js";
import { controlSocketPath } from "../../src/session/paths.js";
import { SessionStore } from "../../src/session/store.js";
import { FakeBridge } from "../support/fake-bridge.js";
import { FakeExecutionService } from "../support/fake-execution.js";

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

// Stands in for the startup reaper: the port holds a verified container for this session and the
// record names it. Returns the survivor's containerId.
async function adoptSurvivor(f: Fixture): Promise<string> {
  const { containerId } = await f.exec.create({ idempotencyKey: SESSION, workspaceRoot: f.workspace });
  saveRecord(f, containerId);
  return containerId;
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
