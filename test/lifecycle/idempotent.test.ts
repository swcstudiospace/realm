import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Policy } from "../../src/contract/validate.js";
import { LockTable } from "../../src/fs/locks.js";
import { LifecycleController } from "../../src/lifecycle/controller.js";
import { SessionStore } from "../../src/session/store.js";
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

// Real directories under a temporary base, a session store on disk, a lock table the test
// can inspect, and the fake execution service. The default budget is 10000 ms.
function fixture(t: TestContext, startupBudgetMs = 10000) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-idempotent-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const workspace = join(base, "workspace");
  mkdirSync(workspace);
  const store = new SessionStore(join(base, "state"));
  const exec = new FakeExecutionService();
  const locks = new LockTable();
  const controller = new LifecycleController({
    sessionId: SESSION,
    policy: policyFor([workspace], startupBudgetMs),
    store,
    exec,
    clock: () => new Date(CLOCK_TIME),
    locks,
  });
  return { base, workspace, store, exec, locks, controller };
}

test("repeating each of the seven operations returns the same snapshot with no duplicate fake resources (CORE-06)", async (t) => {
  const { controller, exec, store, workspace } = fixture(t);
  const active = await controller.create(workspace);
  const record = store.load(SESSION);

  assert.deepEqual(await controller.create(workspace), active);
  assert.deepEqual(await controller.start(), active);
  assert.deepEqual(await controller.probe(), active);
  assert.deepEqual(await controller.probe(), active);
  assert.equal(exec.callCount("create"), 1);
  assert.equal(exec.callCount("start"), 1);
  assert.equal(exec.resources().length, 1);
  assert.deepEqual(store.load(SESSION), record);

  const attached = controller.attach("host-a");
  assert.deepEqual(controller.attach("host-a"), attached);
  assert.deepEqual(attached, active);
  const detached = controller.detach("host-a");
  assert.deepEqual(controller.detach("host-a"), detached);
  assert.deepEqual(detached, active);
  assert.deepEqual(controller.attachments(), []);

  const stopped = await controller.stop();
  assert.equal(stopped.state, "unbound");
  assert.deepEqual(await controller.stop(), stopped);
  assert.equal(exec.callCount("stop"), 1);

  const destroyed = await controller.destroy();
  assert.deepEqual(await controller.destroy(), destroyed);
  assert.equal(exec.callCount("destroy"), 1);
  assert.equal(exec.resources().length, 0);
  assert.equal(store.load(SESSION), null);
});

test("a create that times out reattaches to one container on retry, with no duplicate resource (CORE-06, RT-07)", async (t) => {
  const { controller, exec, store, workspace } = fixture(t, 1000);
  exec.setDelay("create", 3000);

  const failed = await controller.create(workspace);
  assert.equal(failed.state, "error");
  assert.equal(failed.reason, "STARTUP_BUDGET_EXCEEDED");

  exec.setDelay("create", 0);
  const active = await controller.create(workspace);
  assert.equal(active.state, "active");

  // Real time, on purpose: the budget is enforced by a real setTimeout inside withTimeout,
  // and the fake's scripted delay is a real timer, so deterministic fake timers would also
  // have to drive the controller's timer. The wait lets the abandoned create run to its end.
  // The budget is 1000 ms, 3.6x the 274.82 ms slowest observed active create (N=200).
  // The scripted create delay is 3000 ms, 3x the budget, so the budget fires first.
  // The wait is 9000 ms, 3x the 3000 ms delay, so abandoned creates drain before the count check.
  // The Promise executor form is used because tsconfig's ES2023 lib has no Promise.withResolvers.
  await new Promise((resolve) => {
    setTimeout(resolve, 9000);
  });
  assert.equal(exec.resources().length, 1);
  assert.equal(store.load(SESSION)?.containerId, exec.resources()[0]?.containerId);
});

test("start from error runs create again and reuses the stored container; start in active changes nothing (CORE-06, D-38)", async (t) => {
  const { controller, exec, workspace } = fixture(t);
  exec.failNext("start", "PODMAN_MACHINE_DOWN");
  const failed = await controller.create(workspace);
  assert.equal(failed.state, "error");

  const retried = await controller.start();
  assert.equal(retried.state, "active");
  assert.equal(exec.callCount("create"), 1);
  assert.equal(exec.resources().length, 1);
  assert.deepEqual(await controller.start(), retried);
});

test("probe on an active session that is healthy changes nothing (CORE-06, D-38)", async (t) => {
  const { controller, exec, workspace } = fixture(t);
  const active = await controller.create(workspace);
  assert.deepEqual(await controller.probe(), active);
  assert.equal(exec.callCount("probe"), 1);
});

test("probe unhealthy in active moves to error with reason probe failed, and the record follows (D-38)", async (t) => {
  const { controller, exec, store, workspace } = fixture(t);
  await controller.create(workspace);
  const container = exec.resources()[0];
  assert.ok(container);
  exec.setHealth(container.containerId, "unhealthy");

  const snapshot = await controller.probe();

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "probe failed");
  assert.equal(store.load(SESSION)?.state, "error");
  assert.equal(store.load(SESSION)?.containerId, container.containerId);
});

test("probe outside active or degraded returns the snapshot without a port call (D-38)", async (t) => {
  const { controller, exec } = fixture(t);
  const snapshot = await controller.probe();
  assert.equal(snapshot.state, "unbound");
  assert.deepEqual(exec.calls(), []);
});

test("a probe that overruns the startup budget gives STARTUP_BUDGET_EXCEEDED and state error (D-28)", async (t) => {
  const { controller, exec, workspace } = fixture(t, 50);
  await controller.create(workspace);
  exec.setDelay("probe", 500);

  const snapshot = await controller.probe();

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "STARTUP_BUDGET_EXCEEDED");
});

test("stop of an unbound session is a no-op with no port call (CORE-06, D-38)", async (t) => {
  const { controller, exec } = fixture(t);
  const snapshot = await controller.stop();
  assert.equal(snapshot.state, "unbound");
  assert.deepEqual(exec.calls(), []);
});

test("stop of a stopping session is a no-op while the first stop completes (CORE-06, D-38)", async (t) => {
  const { controller, exec, workspace } = fixture(t);
  await controller.create(workspace);
  exec.setDelay("stop", 50);

  const first = controller.stop();
  const during = await controller.stop();
  assert.equal(during.state, "stopping");
  assert.equal(exec.callCount("stop"), 1);

  const done = await first;
  assert.equal(done.state, "unbound");
  assert.equal(exec.callCount("stop"), 1);
});

test("stop from error moves to unbound and keeps the container in the record for a later create (D-38)", async (t) => {
  const { controller, exec, store, workspace } = fixture(t);
  exec.failNext("start", "PODMAN_MACHINE_DOWN");
  await controller.create(workspace);

  const stopped = await controller.stop();

  assert.equal(stopped.state, "unbound");
  assert.equal(store.load(SESSION)?.state, "unbound");
  assert.equal(store.load(SESSION)?.containerId, exec.resources()[0]?.containerId);
  assert.equal(exec.callCount("stop"), 1);
});

test("destroy of an absent session is a no-op with no port call (CORE-06, D-38)", async (t) => {
  const { controller, exec, store } = fixture(t);
  const snapshot = await controller.destroy();
  assert.equal(snapshot.state, "unbound");
  assert.deepEqual(exec.calls(), []);
  assert.equal(store.load(SESSION), null);
});

test("destroy releases the session's advisory locks, leaves other owners' locks, and deletes the record (CORE-06, FS-04, D-33)", async (t) => {
  const { workspace, store, exec, locks, controller } = fixture(t);
  await controller.create(workspace);
  const held = join(workspace, "held.txt");
  const other = join(workspace, "other.txt");
  writeFileSync(held, "held");
  writeFileSync(other, "other");
  locks.acquire(held, SESSION);
  locks.acquire(other, "host-b");

  await controller.destroy();

  assert.equal(locks.isHeldBy(held, SESSION), false);
  assert.equal(locks.isHeldBy(other, "host-b"), true);
  assert.equal(locks.acquire(held, "next-owner").owner, "next-owner");
  assert.equal(store.load(SESSION), null);
  assert.equal(exec.callCount("destroy"), 1);
});
