import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Policy } from "../../src/contract/validate.js";
import { RealmError } from "../../src/core/errors.js";
import { LockTable } from "../../src/fs/locks.js";
import { bindWorkspaceUnderPolicy } from "../../src/fs/root.js";
import { LifecycleController } from "../../src/lifecycle/controller.js";
import { SessionStore } from "../../src/session/store.js";
import { FakeBridge } from "../support/fake-bridge.js";
import { FakeExecutionService } from "../support/fake-execution.js";

const SESSION = "session-1";
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

function fixture(t: TestContext, startupBudgetMs = 10000) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-stale-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const workspace = join(base, "workspace");
  mkdirSync(workspace);
  const pinnedRoot = bindWorkspaceUnderPolicy([workspace], workspace);
  const store = new SessionStore(join(base, "state"));
  const exec = new FakeExecutionService();
  const controller = new LifecycleController({
    sessionId: SESSION,
    policy: policyFor([workspace], startupBudgetMs),
    store,
    exec,
    bridge: new FakeBridge(),
    clock: () => new Date(CLOCK_TIME),
    locks: new LockTable(),
    pinnedRoot,
  });
  return { workspace, store, exec, controller };
}

function assertRejectsWith(promise: Promise<unknown>, code: string): Promise<void> {
  return assert.rejects(promise, (error: unknown) => error instanceof RealmError && error.code === code);
}

interface Fixture {
  readonly workspace: string;
  readonly store: SessionStore;
  readonly exec: FakeExecutionService;
  readonly controller: LifecycleController;
}

// Brings the session to active, removes its container behind the controller's back, and lets the
// probe move it to error. Returns the removed container id.
async function activeThenRemoved(f: Fixture): Promise<string> {
  await f.controller.create(f.workspace);
  const oldId = f.store.load(SESSION)?.containerId;
  assert.ok(typeof oldId === "string");
  await f.exec.destroy(oldId, "realm-session-1");
  await assertRejectsWith(f.controller.probe(), "OPENSHELL_START_FAILED");
  assert.equal(f.controller.snapshot().state, "error");
  return oldId;
}

void test("TD-04: a removed container is destroyed and replaced on retry, reaching active", async (t) => {
  const f = fixture(t);
  const oldId = await activeThenRemoved(f);

  const snapshot = await f.controller.create(f.workspace);

  assert.equal(snapshot.state, "active");
  const newId = f.store.load(SESSION)?.containerId;
  assert.ok(typeof newId === "string");
  assert.notEqual(newId, oldId);
  assert.equal(f.exec.callCount("create"), 2);
  assert.equal(f.exec.resources().length, 1);
  const ops = f.exec.calls().map((call) => call.operation);
  const secondCreate = ops.lastIndexOf("create");
  const recoveryDestroy = ops.lastIndexOf("destroy");
  assert.ok(recoveryDestroy < secondCreate);
  assert.equal(f.exec.callCount("destroy"), 2);
});

void test("TD-04: the record is cleared before the second create", async (t) => {
  const f = fixture(t);
  await activeThenRemoved(f);
  const seen: (string | null | undefined)[] = [];
  f.exec.beforeCall("create", () => {
    seen.push(f.store.load(SESSION)?.containerId);
  });

  await f.controller.create(f.workspace);

  assert.deepEqual(seen, [null]);
});

void test("TD-04: a create that failed at start, whose container is then gone, reaches active in one call", async (t) => {
  const f = fixture(t);
  f.exec.failNext("start", "OPENSHELL_START_FAILED");
  const failed = await f.controller.create(f.workspace);
  assert.equal(failed.state, "error");
  assert.equal(failed.reason, "OPENSHELL_START_FAILED");
  const oldId = f.store.load(SESSION)?.containerId;
  assert.ok(typeof oldId === "string");
  await f.exec.destroy(oldId, "realm-session-1");

  const retried = await f.controller.create(f.workspace);

  assert.equal(retried.state, "active");
  assert.notEqual(f.store.load(SESSION)?.containerId, oldId);
  assert.equal(f.exec.resources().length, 1);
});

void test("TD-04: recovery runs once per call; a second start failure ends in error with one recovery destroy and two creates", async (t) => {
  const f = fixture(t);
  await activeThenRemoved(f);
  const destroysBefore = f.exec.callCount("destroy");
  f.exec.beforeCall("create", () => {
    f.exec.failNext("start", "OPENSHELL_START_FAILED");
  });

  const snapshot = await f.controller.create(f.workspace);

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "OPENSHELL_START_FAILED");
  assert.equal(f.exec.callCount("destroy") - destroysBefore, 1);
  assert.equal(f.exec.callCount("create"), 2);
  assert.equal(typeof f.store.load(SESSION)?.containerId, "string");
});

void test("TD-04: a destroy failure goes to error with its own code, keeps the old id, and creates nothing", async (t) => {
  const f = fixture(t);
  const oldId = await activeThenRemoved(f);
  f.exec.failNext("destroy", "AGENTOS_STOP_FAILED");

  const snapshot = await f.controller.create(f.workspace);

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "AGENTOS_STOP_FAILED");
  assert.equal(f.store.load(SESSION)?.containerId, oldId);
  assert.equal(f.exec.callCount("create"), 1);
});

for (const code of ["PODMAN_MACHINE_DOWN", "AGENTOS_CRASH_LOOP"] as const) {
  void test(`TD-04: a start failing with ${code} keeps the container and issues no destroy`, async (t) => {
    const f = fixture(t);
    f.exec.failNext("start", code);
    await f.controller.create(f.workspace);
    const id = f.store.load(SESSION)?.containerId;
    assert.ok(typeof id === "string");
    f.exec.failNext("start", code);

    const snapshot = await f.controller.create(f.workspace);

    assert.equal(snapshot.state, "error");
    assert.equal(snapshot.reason, code);
    assert.equal(f.store.load(SESSION)?.containerId, id);
    assert.equal(f.exec.callCount("destroy"), 0);
    assert.equal(f.exec.callCount("create"), 1);
  });
}

void test("TD-04: a fresh create whose first start fails with a raw error is unchanged: refused, container kept, no destroy", async (t) => {
  const f = fixture(t);
  f.exec.failNext("start", new Error("start exploded"));

  await assertRejectsWith(f.controller.create(f.workspace), "OPENSHELL_START_FAILED");

  assert.equal(f.controller.snapshot().state, "error");
  assert.equal(typeof f.store.load(SESSION)?.containerId, "string");
  assert.equal(f.exec.callCount("destroy"), 0);
  assert.equal(f.exec.callCount("create"), 1);
});

void test("TD-04: the recovery destroy respects the startup budget", async (t) => {
  const f = fixture(t);
  const clock = scriptedClock(t);
  const oldId = await activeThenRemoved(f);
  // The startup budget runs out at the moment the recovery destroy starts, whatever the host load is.
  f.exec.beforeCall("destroy", () => {
    clock.advance(60_000);
  });
  f.exec.setDelay("destroy", 150);

  const snapshot = await f.controller.create(f.workspace);

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "STARTUP_BUDGET_EXCEEDED");
  assert.equal(f.store.load(SESSION)?.containerId, oldId);
  assert.equal(f.exec.callCount("create"), 1);
});

// Replaces performance.now for one test, so a hook can model a startup budget that runs out at an
// exact step with no real wait. t.mock restores the real clock when the test ends.
function scriptedClock(t: TestContext): { advance(ms: number): void } {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  return {
    advance(ms: number): void {
      now += ms;
    },
  };
}

void test("a budget that runs out right after the port create settled records the new container, and destroy removes it", async (t) => {
  const clock = scriptedClock(t);
  const f = fixture(t);
  f.exec.beforeCall("create", () => {
    clock.advance(60_000);
  });

  const snapshot = await f.controller.create(f.workspace);

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "STARTUP_BUDGET_EXCEEDED");
  const created = f.exec.resources()[0];
  assert.ok(created);
  assert.equal(f.store.load(SESSION)?.containerId, created.containerId);

  await f.controller.destroy();

  assert.equal(f.exec.resources().length, 0);
  assert.equal(f.store.load(SESSION), null);
});

void test("TD-04: a budget that runs out right after the replacement create records the new container, not the stale one", async (t) => {
  const clock = scriptedClock(t);
  const f = fixture(t);
  const oldId = await activeThenRemoved(f);
  f.exec.beforeCall("create", () => {
    clock.advance(60_000);
  });

  const snapshot = await f.controller.create(f.workspace);

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "STARTUP_BUDGET_EXCEEDED");
  const created = f.exec.resources()[0];
  assert.ok(created);
  assert.notEqual(created.containerId, oldId);
  assert.equal(f.store.load(SESSION)?.containerId, created.containerId);

  await f.controller.destroy();

  assert.equal(f.exec.resources().length, 0);
});

void test("TD-04: a recovery destroy that outlived the budget finishes before a later create issues a create or destroy", async (t) => {
  const f = fixture(t);
  const clock = scriptedClock(t);
  await activeThenRemoved(f);
  const destroysBefore = f.exec.callCount("destroy");
  const DESTROY_MS = 150;
  let destroyStartedAt = 0;
  // The startup budget runs out at the moment the recovery destroy starts, whatever the host load is.
  f.exec.beforeCall("destroy", () => {
    destroyStartedAt = Date.now();
    clock.advance(60_000);
  });
  f.exec.setDelay("destroy", DESTROY_MS);

  const first = await f.controller.create(f.workspace);

  assert.equal(first.state, "error");
  assert.equal(first.reason, "STARTUP_BUDGET_EXCEEDED");
  assert.equal(f.exec.callCount("destroy") - destroysBefore, 1);
  assert.equal(f.exec.callCount("create"), 1);
  f.exec.setDelay("destroy", 0);
  // Every later destroy or create must be issued only after the first destroy's delay has elapsed.
  const elapsedAtLaterCalls: number[] = [];
  const check = (): void => {
    elapsedAtLaterCalls.push(Date.now() - destroyStartedAt);
  };
  f.exec.beforeCall("destroy", check);
  f.exec.beforeCall("create", check);

  const second = await f.controller.create(f.workspace);

  assert.equal(second.state, "active");
  assert.ok(elapsedAtLaterCalls.length > 0);
  assert.equal(elapsedAtLaterCalls.every((ms) => ms >= DESTROY_MS - 5), true);
  assert.equal(f.exec.resources().length, 1);
  assert.equal(f.exec.resources()[0]?.containerId, f.store.load(SESSION)?.containerId);
});

void test("TD-04: a destroy that runs while a create waits for the recovery destroy leaves no record, create or resource behind", async (t) => {
  const clock = scriptedClock(t);
  const f = fixture(t);
  f.exec.failNext("start", "OPENSHELL_START_FAILED");
  assert.equal((await f.controller.create(f.workspace)).state, "error");
  // The retry starts the recorded container again, that start fails the same way, and the recovery
  // destroy then outlives the budget, so it is still running when the next create arrives.
  f.exec.failNext("start", "OPENSHELL_START_FAILED");
  f.exec.beforeCall("destroy", () => {
    clock.advance(60_000);
  });
  f.exec.setDelay("destroy", 150);

  const first = await f.controller.create(f.workspace);

  assert.equal(first.state, "error");
  assert.equal(first.reason, "STARTUP_BUDGET_EXCEEDED");
  assert.equal(f.exec.callCount("create"), 1);
  // The scripted clock never moves again, so the second create has the full budget and parks on
  // the recovery destroy that is still running.
  f.exec.beforeCall("destroy", () => undefined);
  f.exec.setDelay("destroy", 0);

  const second = f.controller.create(f.workspace);
  const destroyed = f.controller.destroy();
  await Promise.all([second, destroyed]);

  assert.equal(f.controller.snapshot().state, "unbound");
  assert.equal(f.store.load(SESSION), null);
  assert.equal(f.exec.callCount("create"), 1);
  assert.equal(f.exec.resources().length, 0);
});

void test("TD-04: an overtaken create whose recovery wait times out leaves the newer create's session alone", async (t) => {
  // Every timer here is node's mocked setTimeout: the two budget timers and the recovery destroy's
  // delay move only when the test ticks them, so nothing waits in real time.
  t.after(() => {
    t.mock.timers.reset();
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const yieldToMicrotasks = async (): Promise<void> => {
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  };
  const f = fixture(t);
  f.exec.failNext("start", "OPENSHELL_START_FAILED");
  assert.equal((await f.controller.create(f.workspace)).state, "error");
  // The retry starts the recorded container again, that start fails the same way, and the recovery
  // destroy then runs far beyond every budget. Its create gives up at the first budget.
  f.exec.failNext("start", "OPENSHELL_START_FAILED");
  f.exec.setDelay("destroy", 30_000);
  const first = f.controller.create(f.workspace);
  await yieldToMicrotasks();
  t.mock.timers.tick(10_000);
  const gaveUp = await first;
  assert.equal(gaveUp.reason, "STARTUP_BUDGET_EXCEEDED");

  // The next create (the one that will be overtaken) parks on the recovery destroy, and the session
  // is then destroyed. Later, a newer create parks on the same destroy.
  f.exec.setDelay("destroy", 0);
  const overtaken = f.controller.create(f.workspace);
  await yieldToMicrotasks();
  assert.equal((await f.controller.destroy()).state, "unbound");
  t.mock.timers.tick(5_000);
  const newer = f.controller.create(f.workspace);
  await yieldToMicrotasks();

  // The overtaken create's budget ends while the newer create owns the session. It must change nothing:
  // the newer create is still connecting and no record was written for it.
  t.mock.timers.tick(5_000);
  assert.equal((await overtaken).state, "connecting");
  assert.equal(f.controller.snapshot().state, "connecting");
  assert.equal(f.store.load(SESSION), null);

  // The newer create then ends at its own budget, and only then does the session reach error.
  t.mock.timers.tick(5_000);
  const ended = await newer;
  assert.equal(ended.state, "error");
  assert.equal(ended.reason, "STARTUP_BUDGET_EXCEEDED");
});
