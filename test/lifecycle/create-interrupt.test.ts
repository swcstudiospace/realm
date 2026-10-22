import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Policy } from "../../src/contract/validate.js";
import { LifecycleController } from "../../src/lifecycle/controller.js";
import type { StateSnapshot } from "../../src/core/state-machine.js";
import { type ErrorCode, RealmError } from "../../src/core/errors.js";
import { bindWorkspaceUnderPolicy } from "../../src/fs/root.js";
import { SessionStore } from "../../src/session/store.js";
import { FakeExecutionService } from "../support/fake-execution.js";
import { FakeBridge } from "../support/fake-bridge.js";

const SESSION = "session-interrupt";
const CLOCK_TIME = "2026-10-21T09:30:00.000Z";

function policyFor(workspaceRoot: string, startupBudgetMs: number): Policy {
  return {
    mode: "advisory",
    workspaceRoots: [workspaceRoot],
    credentialAllow: [],
    egressAllow: [],
    shellEnabled: false,
    startupBudgetMs,
    toolQueueMs: 2000,
  };
}

// A real workspace under a temporary base, a session store on disk, and the fake port.
function fixture(t: TestContext, startupBudgetMs = 10000) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-interrupt-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const workspace = join(base, "workspace");
  mkdirSync(workspace);
  const store = new SessionStore(join(base, "state"));
  const exec = new FakeExecutionService();
  const bridge = new FakeBridge();
  const controller = new LifecycleController({
    sessionId: SESSION,
    policy: policyFor(workspace, startupBudgetMs),
    pinnedRoot: bindWorkspaceUnderPolicy([workspace], workspace),
    store,
    exec,
    bridge,
    clock: () => new Date(CLOCK_TIME),
  });
  return { workspace, store, exec, bridge, controller };
}

// Polls until the predicate holds. The bound keeps a broken implementation from hanging the run.
async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  const limit = Date.now() + 30000;
  while (!predicate()) {
    if (Date.now() > limit) {
      assert.fail(`timed out waiting for ${label}`);
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

// A create that a stop overtook resumes while the stop's teardown is still finishing, so it
// returns the state the teardown had left at that moment: stopping, or unbound once the stop
// completed. It never returns an error, and it never reports a live state.
function assertOvertaken(outcome: StateSnapshot): void {
  assert.ok(
    outcome.state === "stopping" || outcome.state === "unbound",
    `an overtaken create returned ${outcome.state}`,
  );
}

test("a stop issued while exec.create is pending leaves no running container and raises no REALM_INVALID_TRANSITION (C1, CORE-06)", async (t) => {
  const { workspace, store, exec, controller } = fixture(t);
  exec.setDelay("create", 50);

  const creating = controller.create(workspace);
  const stopped = await controller.stop();
  const outcome = await creating;

  assert.equal(stopped.state, "unbound");
  assertOvertaken(outcome);
  assert.equal(exec.resources().length, 0);
  assert.equal(exec.callCount("start"), 0);
  assert.equal(store.load(SESSION)?.containerId, null);
  assert.equal(store.load(SESSION)?.state, "unbound");
});

test("a destroy issued while exec.create is pending destroys the produced container and leaves no record (C1, CORE-06)", async (t) => {
  const { workspace, store, exec, controller } = fixture(t);
  exec.setDelay("create", 50);

  const creating = controller.create(workspace);
  const destroyed = await controller.destroy();
  const outcome = await creating;

  assert.equal(destroyed.state, "unbound");
  assertOvertaken(outcome);
  assert.equal(exec.resources().length, 0);
  assert.equal(exec.callCount("start"), 0);
  assert.equal(store.load(SESSION), null);
});

test("a stop issued while exec.create is pending whose port call fails leaves the session unbound with no error (C1)", async (t) => {
  const { workspace, exec, controller } = fixture(t);
  exec.setDelay("create", 50);
  exec.failNext("create", "OPENSHELL_START_FAILED");

  const creating = controller.create(workspace);
  const stopped = await controller.stop();
  const outcome = await creating;

  assert.equal(stopped.state, "unbound");
  assertOvertaken(outcome);
  assert.equal(exec.resources().length, 0);
});

test("a stop issued while exec.start is in flight leaves the container stopped, not running (C1)", async (t) => {
  const { workspace, store, exec, controller } = fixture(t);
  exec.setDelay("start", 100);

  const creating = controller.create(workspace);
  await waitUntil(() => exec.callCount("start") === 1, "exec.start to be called");
  const stopped = await controller.stop();
  const outcome = await creating;

  assert.equal(stopped.state, "unbound");
  assertOvertaken(outcome);
  const [container] = exec.resources();
  assert.equal(container?.started, false);
  assert.equal(store.load(SESSION)?.containerId, container?.containerId);
});

test("a create whose exec.create resolves after the budget expired gets its container destroyed (C2)", async (t) => {
  const { workspace, store, exec, controller } = fixture(t, 500);
  exec.setDelay("create", 2000);

  const snapshot = await controller.create(workspace);

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "STARTUP_BUDGET_EXCEEDED");
  assert.equal(store.load(SESSION)?.containerId, null);
  await waitUntil(() => exec.callCount("destroy") === 1, "the orphaned container to be destroyed");
  assert.equal(exec.resources().length, 0);
  assert.equal(exec.callCount("start"), 0);
  assert.deepEqual(
    exec.calls().filter((call) => call.operation === "destroy").map((call) => call.containerId),
    ["fake-container-1"],
  );
});

test("an orphaned container whose destroy fails is recorded, so the next destroy removes it (C2)", async (t) => {
  const { workspace, store, exec, controller } = fixture(t, 2000);
  exec.setDelay("create", 8000);
  exec.failNext("destroy", "OPENSHELL_START_FAILED");

  const snapshot = await controller.create(workspace);
  assert.equal(snapshot.reason, "STARTUP_BUDGET_EXCEEDED");
  await waitUntil(
    () => store.load(SESSION)?.containerId === "fake-container-1",
    "the failed orphan to be recorded",
  );
  assert.equal(exec.resources().length, 1);

  const destroyed = await controller.destroy();

  assert.equal(destroyed.state, "unbound");
  assert.equal(exec.resources().length, 0);
  assert.equal(store.load(SESSION), null);
});

// The rejection carries the catalogue code. A resolve, or any other error, fails the assertion.
async function assertRejectsWith(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof RealmError && error.code === code);
}

// The rejection carries the catalogue code and the kept background failure as its causeCode.
async function assertRejectsWithCause(promise: Promise<unknown>, code: string, causeCode: string): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) =>
      error instanceof RealmError && error.code === code && error.causeCode === causeCode,
  );
}

test("a stop during a pending exec.start leaves no running container, even when the create gave up at the budget (C1, F1)", async (t) => {
  const { workspace, store, exec, controller } = fixture(t, 1000);
  // The start is held behind a gate, so the stop begins while exec.start is in flight. The
  // executor form is used because tsconfig's ES2023 lib has no Promise.withResolvers.
  let openGate: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    openGate = () => resolve();
  });
  const start = exec.start.bind(exec);
  const issued: Promise<void>[] = [];
  exec.start = (containerId: string) => {
    const call = gate.then(() => start(containerId));
    issued.push(call);
    return call;
  };

  const creating = controller.create(workspace);
  await waitUntil(() => issued.length === 1, "exec.start to be issued");
  const stopping = controller.stop();
  // The create gives up at its 1000 ms budget while the stop is still waiting for the held start.
  const outcome = await creating;
  assertOvertaken(outcome);

  openGate();
  const stopped = await stopping;
  await Promise.all(issued);

  assert.equal(stopped.state, "unbound");
  const [container] = exec.resources();
  assert.equal(container?.started, false);
  assert.equal(store.load(SESSION)?.containerId, container?.containerId);
});

test("destroy waits for an orphaned create that is still in flight, then removes its container (C2, F2)", async (t) => {
  const { workspace, store, exec, controller } = fixture(t, 500);
  exec.setDelay("create", 2000);

  const snapshot = await controller.create(workspace);
  assert.equal(snapshot.reason, "STARTUP_BUDGET_EXCEEDED");

  const destroyed = await controller.destroy();

  assert.equal(destroyed.state, "unbound");
  assert.equal(exec.resources().length, 0);
  assert.equal(exec.callCount("destroy"), 1);
  assert.equal(store.load(SESSION), null);
});

test("an orphan whose destroy fails once is retried by the destroy that waits for it (C2, F2)", async (t) => {
  const { workspace, store, exec, controller } = fixture(t, 500);
  exec.setDelay("create", 2000);
  exec.failNext("destroy", "OPENSHELL_START_FAILED");

  await controller.create(workspace);
  const destroyed = await controller.destroy();

  assert.equal(destroyed.state, "unbound");
  assert.equal(exec.resources().length, 0);
  assert.equal(exec.callCount("destroy"), 2);
  assert.equal(store.load(SESSION), null);
});

test("an orphan whose destroy and its retry both fail keeps its containerId in the record, so the next destroy removes it (C2, F2)", async (t) => {
  const { workspace, store, exec, controller } = fixture(t, 500);
  exec.setDelay("create", 2000);
  // The first two destroy calls fail with different codes: the orphan's own destroy, then the
  // destroy that retries it.
  const failures: ErrorCode[] = ["PODMAN_MACHINE_DOWN", "OPENSHELL_START_FAILED"];
  exec.beforeCall("destroy", () => {
    const next = failures.shift();
    if (next !== undefined) {
      exec.failNext("destroy", next);
    }
  });

  await controller.create(workspace);
  await assertRejectsWithCause(controller.destroy(), "OPENSHELL_START_FAILED", "PODMAN_MACHINE_DOWN");

  assert.equal(controller.snapshot().state, "stopping");
  assert.equal(store.load(SESSION)?.containerId, "fake-container-1");
  assert.equal(exec.resources().length, 1);

  const destroyed = await controller.destroy();

  assert.equal(destroyed.state, "unbound");
  assert.equal(exec.resources().length, 0);
  assert.equal(store.load(SESSION), null);
});

test("a stop and a destroy issued together both resolve and leave the session unbound (C1, F3)", async (t) => {
  const { workspace, store, exec, controller } = fixture(t);
  exec.setDelay("create", 100);

  const creating = controller.create(workspace);
  const stopping = controller.stop();
  const destroying = controller.destroy();
  const [stopped, destroyed] = await Promise.all([stopping, destroying]);
  const outcome = await creating;

  assert.equal(stopped.state, "unbound");
  assert.equal(destroyed.state, "unbound");
  assertOvertaken(outcome);
  assert.equal(controller.snapshot().state, "unbound");
  assert.equal(exec.resources().length, 0);
  assert.equal(store.load(SESSION), null);
});

test("a probe still in flight when a stop begins resolves with the snapshot and does not reject (F4)", async (t) => {
  const { workspace, exec, controller } = fixture(t);
  await controller.create(workspace);
  exec.setDelay("probe", 100);
  exec.setHealth("fake-container-1", "unhealthy");

  const probing = controller.probe();
  await waitUntil(() => exec.callCount("probe") === 1, "exec.probe to be called");
  const stopped = await controller.stop();
  const probed = await probing;

  assert.equal(stopped.state, "unbound");
  assert.equal(probed.state, "unbound");
});

test("a probe that fails in flight when a stop begins resolves with the snapshot and does not reject (F4)", async (t) => {
  const { workspace, exec, controller } = fixture(t);
  await controller.create(workspace);
  exec.setDelay("probe", 100);
  exec.failNext("probe", "OPENSHELL_START_FAILED");

  const probing = controller.probe();
  await waitUntil(() => exec.callCount("probe") === 1, "exec.probe to be called");
  await controller.stop();
  const probed = await probing;

  assert.equal(probed.state, "unbound");
});

test("a create for another workspace during a first create is refused with POLICY_DENIED, and the first create completes (S-02, F5)", async (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-interrupt-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const first = join(base, "first");
  const second = join(base, "second");
  mkdirSync(first);
  mkdirSync(second);
  const store = new SessionStore(join(base, "state"));
  const exec = new FakeExecutionService();
  const controller = new LifecycleController({
    sessionId: SESSION,
    policy: policyFor(base, 10000),
    pinnedRoot: bindWorkspaceUnderPolicy([base], first),
    store,
    exec,
    bridge: new FakeBridge(),
    clock: () => new Date(CLOCK_TIME),
  });
  exec.setDelay("create", 50);

  const creating = controller.create(first);
  await assertRejectsWith(controller.create(second), "POLICY_DENIED");
  const outcome = await creating;

  assert.equal(outcome.state, "active");
  assert.equal(store.load(SESSION)?.workspaceRoot, first);
});

test("a bridge subscribe that throws moves the session to error instead of leaving it connecting (F6)", async (t) => {
  const { workspace, store, bridge, controller } = fixture(t);
  bridge.subscribe = () => {
    throw new Error("subscribe exploded");
  };

  await assertRejectsWith(controller.create(workspace), "OPENSHELL_START_FAILED");

  assert.equal(controller.snapshot().state, "error");
  assert.equal(controller.snapshot().reason, "OPENSHELL_START_FAILED");
  assert.equal(store.load(SESSION)?.state, "error");
});

test("a store write that throws during a bridge down event keeps the degraded state, does not throw, and the next write persists it (F7)", async (t) => {
  const { workspace, store, bridge, controller } = fixture(t);
  await controller.create(workspace);
  const save = store.save.bind(store);
  store.save = () => {
    throw new Error("disk full");
  };

  assert.doesNotThrow(() => {
    bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
  });

  assert.equal(controller.snapshot().state, "degraded");
  assert.equal(controller.snapshot().reason, "ANDA_UNREACHABLE");
  assert.equal(controller.hasUnpersistedState(), true);
  assert.equal(store.load(SESSION)?.state, "active");

  store.save = save;
  bridge.emit({ kind: "up" });

  assert.equal(controller.snapshot().state, "active");
  assert.equal(controller.hasUnpersistedState(), false);
  assert.equal(store.load(SESSION)?.state, "active");
});

test("a background stop and destroy that both fail are kept, and the next destroy reports them as the cause of its own failure (G-04, F1)", async (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-interrupt-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const workspace = join(base, "workspace");
  mkdirSync(workspace);
  const store = new SessionStore(join(base, "state"));
  const exec = new FakeExecutionService();
  const controller = new LifecycleController({
    sessionId: SESSION,
    policy: policyFor(workspace, 10000),
    pinnedRoot: bindWorkspaceUnderPolicy([workspace], workspace),
    store,
    exec,
    bridge: new FakeBridge(),
    clock: () => new Date(CLOCK_TIME),
    teardownTimeoutMs: 1000,
  });
  // The start outlives the teardown bound, so the stop hands it to the background.
  // The start settles after the stop's bound expires and before the destroy's bound expires.
  exec.setDelay("start", 1500);
  // Stop calls in order: the stop from the first stop, the stop from the destroy, then the stop of
  // the start once it settles. The last one fails, so the background falls back to destroy.
  let stops = 0;
  exec.beforeCall("stop", () => {
    stops += 1;
    if (stops === 3) {
      exec.failNext("stop", "OPENSHELL_START_FAILED");
    }
  });
  // Destroy calls in order: the background fallback destroy, then the destroy that retries it.
  const failures: ErrorCode[] = ["PODMAN_MACHINE_DOWN", "OPENSHELL_START_FAILED"];
  exec.beforeCall("destroy", () => {
    const next = failures.shift();
    if (next !== undefined) {
      exec.failNext("destroy", next);
    }
  });

  const creating = controller.create(workspace);
  await waitUntil(() => exec.callCount("start") === 1, "exec.start to be called");
  await assertRejectsWith(controller.stop(), "REALM_STOPPING");

  await assertRejectsWithCause(controller.destroy(), "OPENSHELL_START_FAILED", "PODMAN_MACHINE_DOWN");
  assert.equal(controller.snapshot().state, "stopping");
  assert.equal(store.load(SESSION)?.containerId, "fake-container-1");
  assert.equal(exec.resources().length, 1);

  const destroyed = await controller.destroy();

  assert.equal(destroyed.state, "unbound");
  assert.equal(exec.resources().length, 0);
  assert.equal(store.load(SESSION), null);
  assertOvertaken(await creating);
});
