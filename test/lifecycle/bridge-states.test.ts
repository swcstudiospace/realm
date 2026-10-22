import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Policy } from "../../src/contract/validate.js";
import { RealmError } from "../../src/core/errors.js";
import type { RealmEvent } from "../../src/core/events.js";
import { LifecycleController } from "../../src/lifecycle/controller.js";
import { SessionStore } from "../../src/session/store.js";
import { FakeBridge } from "../support/fake-bridge.js";
import { FakeExecutionService } from "../support/fake-execution.js";

const SESSION = "session-bridge";
const CLOCK_TIME = "2026-10-21T09:30:00.000Z";

function policyFor(workspaceRoots: readonly string[]): Policy {
  return {
    mode: "advisory",
    workspaceRoots,
    credentialAllow: [],
    egressAllow: [],
    shellEnabled: false,
    startupBudgetMs: 10000,
    toolQueueMs: 2000,
  };
}

// A controller over the fake execution service and the fake bridge, with a real session
// store and workspace. The bridge is the only source of up, down, and mismatch events.
function fixture(t: TestContext) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-bridge-states-")));
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
    policy: policyFor([workspace]),
    store,
    exec,
    bridge,
    clock: () => new Date(CLOCK_TIME),
    teardownTimeoutMs: 5000,
  });
  return { workspace, store, exec, bridge, controller };
}

function assertRejectsWith(promise: Promise<unknown>, code: string): Promise<void> {
  return assert.rejects(promise, (error: unknown) => error instanceof RealmError && error.code === code);
}

test("ANDA-03: bridge down moves active to degraded with ANDA_UNREACHABLE, and bridge up moves it back to active", async (t) => {
  const { workspace, store, bridge, controller } = fixture(t);
  await controller.create(workspace);

  bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
  assert.equal(controller.snapshot().state, "degraded");
  assert.equal(controller.snapshot().reason, "ANDA_UNREACHABLE");
  assert.equal(store.load(SESSION)?.state, "degraded");

  bridge.emit({ kind: "up" });
  assert.equal(controller.snapshot().state, "active");
  assert.equal(controller.snapshot().reason, "anda reachable");
  assert.equal(store.load(SESSION)?.state, "active");
});

test("ANDA-03: a mismatch event moves active to error with ANDA_VERSION_MISMATCH", async (t) => {
  const { workspace, bridge, controller } = fixture(t);
  await controller.create(workspace);

  bridge.emit({ kind: "mismatch", code: "ANDA_VERSION_MISMATCH" });
  assert.equal(controller.snapshot().state, "error");
  assert.equal(controller.snapshot().reason, "ANDA_VERSION_MISMATCH");
});

test("ANDA-03: a mismatch event moves degraded to error with ANDA_VERSION_MISMATCH", async (t) => {
  const { workspace, bridge, controller } = fixture(t);
  await controller.create(workspace);
  bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
  assert.equal(controller.snapshot().state, "degraded");

  bridge.emit({ kind: "mismatch", code: "ANDA_VERSION_MISMATCH" });
  assert.equal(controller.snapshot().state, "error");
  assert.equal(controller.snapshot().reason, "ANDA_VERSION_MISMATCH");
});

test("ANDA-03: startup exhaustion moves connecting to error with ANDA_UNREACHABLE and keeps the container already recorded", async (t) => {
  const { workspace, store, exec, bridge, controller } = fixture(t);
  bridge.failNext("connect", "ANDA_UNREACHABLE");

  const snapshot = await controller.create(workspace);

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "ANDA_UNREACHABLE");
  assert.equal(exec.callCount("start"), 1);
  assert.notEqual(store.load(SESSION)?.containerId, null);
  assert.equal(store.load(SESSION)?.state, "error");
});

test("ANDA-03: a startup mismatch moves connecting to error, and create or start from that error is refused with ANDA_VERSION_MISMATCH", async (t) => {
  const { workspace, exec, bridge, controller } = fixture(t);
  bridge.failNext("connect", "ANDA_VERSION_MISMATCH");

  const snapshot = await controller.create(workspace);
  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "ANDA_VERSION_MISMATCH");

  await assertRejectsWith(controller.create(workspace), "ANDA_VERSION_MISMATCH");
  await assertRejectsWith(controller.start(), "ANDA_VERSION_MISMATCH");
  assert.equal(controller.snapshot().state, "error");
  assert.equal(controller.snapshot().reason, "ANDA_VERSION_MISMATCH");
  assert.equal(exec.callCount("create"), 1);
  assert.equal(bridge.callCount("connect"), 1);
});

test("ANDA-03: a mismatch that arrives while active also leaves error without retry", async (t) => {
  const { workspace, bridge, controller } = fixture(t);
  await controller.create(workspace);
  bridge.emit({ kind: "mismatch", code: "ANDA_VERSION_MISMATCH" });

  await assertRejectsWith(controller.create(workspace), "ANDA_VERSION_MISMATCH");
  assert.equal(controller.snapshot().state, "error");
});

test("ANDA-03: other error states stay retryable through the error to connecting edge", async (t) => {
  const { workspace, bridge, controller } = fixture(t);
  bridge.failNext("connect", "ANDA_UNREACHABLE");
  assert.equal((await controller.create(workspace)).reason, "ANDA_UNREACHABLE");

  const retried = await controller.create(workspace);
  assert.equal(retried.state, "active");
  assert.equal(retried.reason, "container running");
});

test("ANDA-03: an event in a non-active, non-degraded state is discarded without a throw or a transition", async (t) => {
  const { workspace, bridge, exec, controller } = fixture(t);
  const transitions: RealmEvent[] = [];
  controller.events.subscribe((event) => {
    transitions.push(event);
  });

  // error: a failed startup leaves the listener subscribed.
  bridge.failNext("connect", "ANDA_UNREACHABLE");
  await controller.create(workspace);
  const transitionsBeforeError = transitions.length;
  assert.equal(controller.snapshot().state, "error");
  bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
  bridge.emit({ kind: "up" });
  assert.equal(controller.snapshot().state, "error");
  assert.equal(transitions.length, transitionsBeforeError);

  // connecting: an event published during the startup handshake is not a state change.
  bridge.beforeCall("connect", () => {
    bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
  });
  await controller.create(workspace);
  assert.equal(controller.snapshot().state, "active");
  assert.equal(transitions.filter((event) => event.to === "degraded").length, 0);

  // stopping: an event published while the container is being stopped is discarded.
  exec.beforeCall("stop", () => {
    bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
    bridge.emit({ kind: "mismatch", code: "ANDA_VERSION_MISMATCH" });
  });
  const stopped = await controller.stop();
  assert.equal(stopped.state, "unbound");
  assert.equal(transitions.filter((event) => event.to === "error").length, 1);

  // unbound: the listener outlives stop until destroy, and an event there is discarded.
  bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
  assert.equal(controller.snapshot().state, "unbound");
  assert.equal(transitions.at(-1)?.to, "unbound");
});

test("ANDA-03: probe stays exec-only and never produces degraded", async (t) => {
  const { workspace, exec, controller } = fixture(t);
  const active = await controller.create(workspace);
  const containerId = exec.resources()[0]?.containerId;
  assert.ok(containerId !== undefined);

  assert.deepEqual(await controller.probe(), active);
  assert.equal(exec.callCount("probe"), 1);

  exec.setHealth(containerId, "unhealthy");
  const failed = await controller.probe();
  assert.equal(failed.state, "error");
  assert.equal(failed.reason, "probe failed");
});

test("CORE-05 ANDA-03: stop closes the bridge before exec.stop, and destroy closes it and removes the listener", async (t) => {
  const { workspace, exec, bridge, controller } = fixture(t);
  await controller.create(workspace);
  const order: string[] = [];
  bridge.beforeCall("close", () => {
    order.push("bridge.close");
  });
  exec.beforeCall("stop", () => {
    order.push("exec.stop");
  });

  await controller.stop();
  assert.deepEqual(order, ["bridge.close", "exec.stop"]);
  assert.equal(bridge.callCount("close"), 1);

  await controller.destroy();
  assert.equal(bridge.callCount("close"), 1, "destroy on an unbound session closes nothing again");
  assert.equal(controller.snapshot().state, "unbound");
});

test("CORE-05 ANDA-03: destroy from an active session closes the bridge and leaves no listener behind", async (t) => {
  const { workspace, store, bridge, controller } = fixture(t);
  await controller.create(workspace);

  await controller.destroy();
  assert.equal(bridge.callCount("close"), 1);
  assert.equal(store.load(SESSION), null);

  bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
  assert.equal(controller.snapshot().state, "unbound");
});

test("CORE-05 ANDA-03: a bridge close that exceeds the teardown bound returns REALM_STOPPING and a repeated destroy resumes it", async (t: TestContext) => {
  const { workspace, store, exec, bridge, controller } = fixture(t);
  await controller.create(workspace);
  t.after(() => {
    t.mock.timers.reset();
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  bridge.setDelay("close", 15000);

  const destroyed = assertRejectsWith(controller.destroy(), "REALM_STOPPING");
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  t.mock.timers.tick(5000);
  await destroyed;
  assert.equal(controller.snapshot().state, "stopping");
  assert.equal(store.load(SESSION)?.state, "stopping");
  assert.equal(exec.callCount("stop"), 1, "exec.stop is invoked in the same tick as the bridge close");

  bridge.setDelay("close", 0);
  const resumed = await controller.destroy();
  assert.equal(resumed.state, "unbound");
  assert.equal(store.load(SESSION), null);
  assert.equal(exec.resources().length, 0);
});
