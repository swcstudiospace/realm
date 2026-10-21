import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Policy, SessionRecord } from "../../src/contract/validate.js";
import { ERROR_CATALOGUE, RealmError } from "../../src/core/errors.js";
import type { RealmEvent } from "../../src/core/events.js";
import { LockTable } from "../../src/fs/locks.js";
import { LifecycleController } from "../../src/lifecycle/controller.js";
import { SessionStore } from "../../src/session/store.js";
import { FakeExecutionService } from "../support/fake-execution.js";
import { FakeBridge } from "../support/fake-bridge.js";

const SESSION = "session-1";
const CLOCK_TIME = "2026-10-21T09:30:00.000Z";
const SNAPSHOT_KEYS = ["lastTransitionAt", "reason", "state"];
const RAW_SECRET = "realm-test-raw-secret-7f3a9c";

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

interface FixtureOptions {
  readonly policyRoots?: (base: string, workspace: string, second: string) => readonly string[];
}

// Real directories under a temporary base, a session store on disk, and the fake
// execution service. The default policy allows only the workspace.
function fixture(t: TestContext, options: FixtureOptions = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-lifecycle-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const workspace = join(base, "workspace");
  const second = join(base, "second");
  const otherDir = join(base, "other");
  mkdirSync(workspace);
  mkdirSync(second);
  mkdirSync(otherDir);
  const roots = options.policyRoots
    ? options.policyRoots(base, workspace, second)
    : [workspace];
  const store = new SessionStore(join(base, "state"));
  const exec = new FakeExecutionService();
  const bridge = new FakeBridge();
  const locks = new LockTable();
  const controller = new LifecycleController({
    sessionId: SESSION,
    policy: policyFor(roots),
    store,
    exec,
    bridge,
    clock: () => new Date(CLOCK_TIME),
    locks,
  });
  return { base, workspace, second, otherDir, store, exec, bridge, locks, controller };
}

function assertRejectsWith(promise: Promise<unknown>, code: string): Promise<void> {
  return assert.rejects(promise, (error: unknown) => error instanceof RealmError && error.code === code);
}

// Rejects with a RealmError of the given code. Its message and stack must not carry the raw
// port failure text, and no raw error may be attached as its cause.
function assertRejectsRedacted(promise: Promise<unknown>, code: string): Promise<void> {
  return assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof RealmError);
    assert.equal(error.code, code);
    assert.equal(error.message.includes(RAW_SECRET), false);
    assert.equal(error.stack?.includes(RAW_SECRET), false);
    assert.equal("cause" in error, false);
    return true;
  });
}

test("create writes the record with containerId null before the fake create runs (RT-07)", async (t) => {
  const { controller, store, exec, workspace } = fixture(t);
  const seen: (SessionRecord | null)[] = [];
  exec.beforeCall("create", () => {
    seen.push(store.load(SESSION));
  });

  await controller.create(workspace);

  assert.equal(seen.length, 1);
  const atCreate = seen[0];
  assert.ok(atCreate);
  assert.equal(atCreate.containerId, null);
  assert.equal(atCreate.state, "connecting");
});

test("create stores the returned containerId before start, and the record holds it afterwards (RT-07)", async (t) => {
  const { controller, store, exec, workspace } = fixture(t);
  const seenAtStart: (SessionRecord | null)[] = [];
  exec.beforeCall("start", () => {
    seenAtStart.push(store.load(SESSION));
  });

  const snapshot = await controller.create(workspace);

  assert.equal(snapshot.state, "active");
  const container = exec.resources()[0];
  assert.ok(container);
  const atStart = seenAtStart[0];
  assert.ok(atStart);
  assert.equal(atStart.containerId, container.containerId);
  assert.equal(store.load(SESSION)?.containerId, container.containerId);
  assert.equal(store.load(SESSION)?.state, "active");
});

test("the stored record names the canonical workspace and the control socket under the state directory (D-14, D-37)", async (t) => {
  const { base, controller, store, workspace } = fixture(t);
  await controller.create(workspace);
  const record = store.load(SESSION);
  assert.equal(record?.workspaceRoot, workspace);
  assert.equal(record?.controlSocketPath, join(base, "state", "run", "control.sock"));
  assert.match(record?.realmId ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("a failed start moves connecting to error with the code as reason, and a retry runs error to connecting to active (CORE-06, D-38)", async (t) => {
  const { controller, exec, workspace } = fixture(t);
  const transitions: string[] = [];
  controller.events.subscribe((event: RealmEvent) => {
    transitions.push(`${event.from}>${event.to}`);
  });
  exec.failNext("start", "PODMAN_MACHINE_DOWN");

  const failed = await controller.create(workspace);
  assert.equal(failed.state, "error");
  assert.equal(failed.reason, "PODMAN_MACHINE_DOWN");

  const retried = await controller.create(workspace);
  assert.equal(retried.state, "active");

  assert.deepEqual(transitions, [
    "unbound>connecting",
    "connecting>error",
    "error>connecting",
    "connecting>active",
  ]);
});

test("a pre-existing record with a containerId causes no second create, only a second start (CORE-06)", async (t) => {
  const { controller, store, exec, workspace } = fixture(t);
  exec.failNext("start", "PODMAN_MACHINE_DOWN");
  await controller.create(workspace);
  assert.equal(typeof store.load(SESSION)?.containerId, "string");

  const retried = await controller.create(workspace);

  assert.equal(retried.state, "active");
  assert.equal(exec.callCount("create"), 1);
  assert.equal(exec.callCount("start"), 2);
  assert.equal(exec.resources().length, 1);
});

test("a failed port create leaves containerId null in the record and the session in error (RT-07)", async (t) => {
  const { controller, store, exec, workspace } = fixture(t);
  exec.failNext("create", "OPENSHELL_START_FAILED");

  const snapshot = await controller.create(workspace);

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "OPENSHELL_START_FAILED");
  assert.equal(store.load(SESSION)?.containerId, null);
  assert.equal(exec.callCount("start"), 0);
});

test("a raw port failure on create is refused as OPENSHELL_START_FAILED, leaves the session in error, and carries no raw text", async (t) => {
  const { controller, exec, workspace } = fixture(t);
  exec.failNext("create", new Error(`create exploded with ${RAW_SECRET}`));

  await assertRejectsRedacted(controller.create(workspace), "OPENSHELL_START_FAILED");
  assert.equal(controller.snapshot().state, "error");
  assert.equal(controller.snapshot().reason, "OPENSHELL_START_FAILED");
});

test("a raw port failure on start is refused as OPENSHELL_START_FAILED, keeps the stored containerId, and carries no raw text", async (t) => {
  const { controller, store, exec, workspace } = fixture(t);
  exec.failNext("start", new Error(`start exploded with ${RAW_SECRET}`));

  await assertRejectsRedacted(controller.create(workspace), "OPENSHELL_START_FAILED");
  assert.equal(controller.snapshot().state, "error");
  assert.equal(controller.snapshot().reason, "OPENSHELL_START_FAILED");
  assert.equal(typeof store.load(SESSION)?.containerId, "string");
});

test("a raw port failure on probe is refused as OPENSHELL_START_FAILED and leaves the session in error, with no raw text", async (t) => {
  const { controller, exec, workspace } = fixture(t);
  await controller.create(workspace);
  exec.failNext("probe", new Error(`probe exploded with ${RAW_SECRET}`));

  await assertRejectsRedacted(controller.probe(), "OPENSHELL_START_FAILED");
  assert.equal(controller.snapshot().state, "error");
  assert.equal(controller.snapshot().reason, "OPENSHELL_START_FAILED");
});

test("a running session with no recorded container yields a RealmError SCHEMA_INVALID whose message is catalogue text only (SCHEMA-01)", async (t) => {
  const { controller, store, workspace } = fixture(t);
  await controller.create(workspace);
  const record = store.load(SESSION);
  assert.ok(record);
  store.save({ ...record, containerId: null });

  await assert.rejects(controller.probe(), (error: unknown) => {
    assert.ok(error instanceof RealmError);
    assert.equal(error.code, "SCHEMA_INVALID");
    assert.equal(error.message, ERROR_CATALOGUE.SCHEMA_INVALID.reason);
    assert.equal(error.message.includes("container"), false);
    assert.equal(error.message.includes("record"), false);
    return true;
  });
  assert.equal(controller.snapshot().state, "active");
});

test("a workspace outside every policy root is refused with POLICY_DENIED and nothing changes (CORE-03, D-22)", async (t) => {
  const { controller, store, exec, otherDir } = fixture(t);
  await assertRejectsWith(controller.create(otherDir), "POLICY_DENIED");
  assert.equal(controller.snapshot().state, "unbound");
  assert.equal(store.load(SESSION), null);
  assert.equal(exec.callCount("create"), 0);
});

test("an empty workspaceRoots policy refuses every create with POLICY_DENIED (D-21 default)", async (t) => {
  const { controller, exec, workspace } = fixture(t, { policyRoots: () => [] });
  await assertRejectsWith(controller.create(workspace), "POLICY_DENIED");
  assert.equal(exec.callCount("create"), 0);
});

test("a policy root that cannot be canonicalized fails the bind with POLICY_DENIED (D-22)", async (t) => {
  const { controller, workspace } = fixture(t, {
    policyRoots: (dir, root) => [root, join(dir, "missing-root")],
  });
  await assertRejectsWith(controller.create(workspace), "POLICY_DENIED");
  assert.equal(controller.snapshot().state, "unbound");
});

test("a container bound to one workspace is never reused for another (S-02)", async (t) => {
  const { controller, exec, workspace, second } = fixture(t, {
    policyRoots: (_dir, root, other) => [root, other],
  });
  exec.failNext("start", "PODMAN_MACHINE_DOWN");
  await controller.create(workspace);

  await assertRejectsWith(controller.create(second), "POLICY_DENIED");
  assert.equal(controller.snapshot().state, "error");
  assert.equal(exec.callCount("create"), 1);
});

test("repeating create on an active session returns the same snapshot with no second create (CORE-06)", async (t) => {
  const { controller, exec, workspace } = fixture(t);
  const first = await controller.create(workspace);
  const second = await controller.create(workspace);
  assert.deepEqual(second, first);
  assert.equal(exec.callCount("create"), 1);
  assert.equal(exec.callCount("start"), 1);
  assert.equal(exec.resources().length, 1);
});

test("the port request carries only the idempotency key and the workspace root (AUD-02)", async (t) => {
  const { controller, exec, workspace } = fixture(t);
  await controller.create(workspace);
  const created = exec.calls().find((call) => call.operation === "create");
  assert.ok(created?.request);
  assert.deepEqual(Object.keys(created.request).sort(), ["idempotencyKey", "workspaceRoot"]);
  assert.equal(created.request.idempotencyKey, SESSION);
  assert.equal(created.request.workspaceRoot, workspace);
});

test("attach and detach are idempotent, change no state or record, and return the snapshot shape (CORE-06)", (t) => {
  const { controller, store } = fixture(t);
  const before = controller.snapshot();
  assert.deepEqual(Object.keys(before).sort(), SNAPSHOT_KEYS);

  const attached = controller.attach("host-a");
  assert.deepEqual(controller.attach("host-a"), attached);
  assert.deepEqual(Object.keys(attached).sort(), SNAPSHOT_KEYS);
  assert.deepEqual(attached, before);
  assert.deepEqual(controller.attachments(), ["host-a"]);

  const detached = controller.detach("host-a");
  assert.deepEqual(controller.detach("host-a"), detached);
  assert.deepEqual(Object.keys(detached).sort(), SNAPSHOT_KEYS);
  assert.deepEqual(controller.attachments(), []);
  assert.equal(store.load(SESSION), null);
});

test("a create result carries exactly the state, reason, and last-transition snapshot (CORE-06)", async (t) => {
  const { controller, workspace } = fixture(t);
  const active = await controller.create(workspace);
  assert.deepEqual(Object.keys(active).sort(), SNAPSHOT_KEYS);
  assert.deepEqual(Object.keys(controller.snapshot()).sort(), SNAPSHOT_KEYS);
});

test("create with a scripted fake delay beyond startupBudgetMs gives STARTUP_BUDGET_EXCEEDED and state error (CORE-06, D-28)", async (t) => {
  const { store, exec, workspace } = fixture(t);
  const controller = new LifecycleController({
    sessionId: SESSION,
    policy: { ...policyFor([workspace]), startupBudgetMs: 50 },
    store,
    exec,
    bridge: new FakeBridge(),
    clock: () => new Date(CLOCK_TIME),
  });
  exec.setDelay("create", 500);

  const snapshot = await controller.create(workspace);

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "STARTUP_BUDGET_EXCEEDED");
  assert.equal(controller.snapshot().state, "error");
  assert.equal(store.load(SESSION)?.state, "error");
  assert.equal(store.load(SESSION)?.containerId, null);
  assert.equal(exec.callCount("start"), 0);
});

test("destroy with a scripted stop delay beyond the teardown bound returns REALM_STOPPING, keeps the session stopping, and a repeated destroy resumes teardown (D-28, Q-1)", async (t) => {
  const { store, exec, controller, workspace } = fixture(t);
  await controller.create(workspace);
  // The teardown bound is TEARDOWN_TIMEOUT_MS (5000 ms) and has no injection point, so this
  // test drives it with node's mocked setTimeout instead of waiting out real time. The stop is
  // scripted at 3x the bound; tick(5000) fires the bound while the stop is still pending. The
  // mock is restored when the test ends, which also drops the stop's pending fake timer.
  t.after(() => {
    t.mock.timers.reset();
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  exec.setDelay("stop", 15000);

  const destroyed = assertRejectsWith(controller.destroy(), "REALM_STOPPING");
  // Let the destroy chain reach the bound timer before fake time advances. setImmediate is not
  // mocked, so this yields past every pending microtask.
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  t.mock.timers.tick(5000);
  await destroyed;
  assert.equal(controller.snapshot().state, "stopping");
  assert.equal(store.load(SESSION)?.state, "stopping");
  assert.equal(exec.resources().length, 1);

  exec.setDelay("stop", 0);
  const resumed = await controller.destroy();
  assert.equal(resumed.state, "unbound");
  assert.equal(store.load(SESSION), null);
  assert.equal(exec.resources().length, 0);
  assert.equal(exec.callCount("stop"), 2);
  assert.equal(exec.callCount("destroy"), 1);
});

test("create on an active session at another workspace is refused with POLICY_DENIED and changes nothing (S-02, CORE-03)", async (t) => {
  const { controller, exec, store, workspace, second } = fixture(t, {
    policyRoots: (_dir, root, other) => [root, other],
  });
  await controller.create(workspace);
  const before = controller.snapshot();
  const recordBefore = store.load(SESSION);

  await assertRejectsWith(controller.create(second), "POLICY_DENIED");
  assert.equal(exec.callCount("create"), 1);
  assert.deepEqual(controller.snapshot(), before);
  assert.deepEqual(store.load(SESSION), recordBefore);
});

test("create on an active session at the same workspace returns the snapshot with no port call (CORE-06)", async (t) => {
  const { controller, exec, workspace } = fixture(t);
  const active = await controller.create(workspace);
  const callsBefore = exec.calls().length;

  assert.deepEqual(await controller.create(workspace), active);
  assert.equal(exec.calls().length, callsBefore);
});

test("a raw failure from the port destroy is refused as REALM_STOPPING, keeps the record stopping, and releases the session's locks (D-28, D-33)", async (t) => {
  const { workspace, store, exec, locks, controller } = fixture(t);
  await controller.create(workspace);
  locks.acquire(workspace, SESSION);
  exec.failNext("destroy", new Error("destroy exploded"));

  await assertRejectsWith(controller.destroy(), "REALM_STOPPING");
  assert.equal(controller.snapshot().state, "stopping");
  assert.equal(store.load(SESSION)?.state, "stopping");
  assert.ok(store.load(SESSION)?.containerId);
  assert.equal(locks.isHeldBy(workspace, SESSION), false);
  assert.equal(locks.acquire(workspace, "next-owner").owner, "next-owner");
});

test("a raw failure from the port stop is refused as REALM_STOPPING, leaves the session stopping with its record, and skips destroy (D-28)", async (t) => {
  const { store, exec, controller, workspace } = fixture(t);
  await controller.create(workspace);
  exec.failNext("stop", new Error("stop exploded"));

  await assertRejectsWith(controller.destroy(), "REALM_STOPPING");
  assert.equal(controller.snapshot().state, "stopping");
  assert.equal(store.load(SESSION)?.state, "stopping");
  assert.ok(store.load(SESSION)?.containerId);
  assert.equal(exec.callCount("destroy"), 0);
});

test("a raw port failure on stop during destroy is refused as REALM_STOPPING, and the error carries no raw text (D-28)", async (t) => {
  const { controller, exec, workspace } = fixture(t);
  await controller.create(workspace);
  exec.failNext("stop", new Error(`stop exploded with ${RAW_SECRET}`));

  await assertRejectsRedacted(controller.destroy(), "REALM_STOPPING");
  assert.equal(controller.snapshot().state, "stopping");
});

test("destroy on a session whose record is gone moves to unbound with no port call, and a repeat changes nothing (CORE-06)", async (t) => {
  const { controller, exec, store, workspace } = fixture(t);
  await controller.create(workspace);
  store.delete(SESSION);
  const callsBefore = exec.calls().length;

  const destroyed = await controller.destroy();
  assert.equal(destroyed.state, "unbound");
  assert.deepEqual(await controller.destroy(), destroyed);
  assert.equal(exec.calls().length, callsBefore);
});

test("stop clears host attachments once the session is unbound (L-2)", async (t) => {
  const { controller } = fixture(t);
  controller.attach("a");
  await controller.stop();
  assert.deepEqual(controller.attachments(), []);
});

test("stop from active clears host attachments on reaching unbound (L-2)", async (t) => {
  const { controller, workspace } = fixture(t);
  await controller.create(workspace);
  controller.attach("a");
  await controller.stop();
  assert.deepEqual(controller.attachments(), []);
});

test("destroy clears host attachments on reaching unbound (L-2)", async (t) => {
  const { controller, workspace } = fixture(t);
  await controller.create(workspace);
  controller.attach("b");
  await controller.destroy();
  assert.deepEqual(controller.attachments(), []);
});

test("a teardown that fails keeps host attachments, since the session has not reached unbound (L-2)", async (t) => {
  const { controller, exec, workspace } = fixture(t);
  await controller.create(workspace);
  controller.attach("a");
  exec.failNext("stop", new Error("stop exploded"));

  await assertRejectsWith(controller.stop(), "REALM_STOPPING");
  assert.deepEqual(controller.attachments(), ["a"]);
});
