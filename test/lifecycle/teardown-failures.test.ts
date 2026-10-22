import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Policy, SessionRecord } from "../../src/contract/validate.js";
import { makeRealmError, RealmError } from "../../src/core/errors.js";
import { LifecycleController } from "../../src/lifecycle/controller.js";
import { bindWorkspaceUnderPolicy } from "../../src/fs/root.js";
import { SessionStore } from "../../src/session/store.js";
import { FakeExecutionService } from "../support/fake-execution.js";
import { FakeBridge } from "../support/fake-bridge.js";

const SESSION = "session-teardown-failures";
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

// A store whose writes can be made to fail after the controller has started.
class FlakyStore extends SessionStore {
  failWrites = false;

  override save(record: SessionRecord): void {
    if (this.failWrites) {
      throw makeRealmError("LOCK_CONFLICT");
    }
    super.save(record);
  }
}

function fixture(t: TestContext, startupBudgetMs = 10000) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-teardown-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const workspace = join(base, "workspace");
  mkdirSync(workspace);
  const store = new FlakyStore(join(base, "state"));
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

test("a bridge event whose state write fails keeps the write's code as the unpersisted cause (QUAL-01)", async (t) => {
  const { workspace, store, bridge, controller } = fixture(t);
  const started = await controller.create(workspace);
  assert.equal(started.state, "active");

  store.failWrites = true;
  bridge.emit({ kind: "down" });

  assert.equal(controller.hasUnpersistedState(), true);
  assert.equal(controller.unpersistedCause(), "LOCK_CONFLICT");
});

test("a stop whose fallback destroy also fails throws the destroy error with the stop error as its cause (QUAL-01)", async (t) => {
  const { workspace, exec, controller } = fixture(t);
  // Long enough that the start is still in flight when the stop begins, even on a loaded host.
  exec.setDelay("start", 2000);
  exec.beforeCall("stop", () => {
    // The teardown's own stop is call one. The stop that reclaims the pending start is call two.
    if (exec.callCount("stop") === 2) {
      exec.failNext("stop", "POLICY_DENIED");
    }
  });
  exec.failNext("destroy", "PODMAN_MACHINE_DOWN");

  const creating = controller.create(workspace);
  await waitUntil(() => exec.callCount("start") === 1, "the start to be issued");
  await assert.rejects(
    controller.stop(),
    (error: unknown) =>
      error instanceof RealmError &&
      error.code === "PODMAN_MACHINE_DOWN" &&
      error.causeCode === "POLICY_DENIED",
  );
  await creating;
});

test("a start that fails after its create gave up at the budget is kept, and the next destroy reports it (QUAL-01)", async (t) => {
  const { workspace, exec, controller } = fixture(t, 3000);
  exec.setDelay("start", 4000);
  exec.failNext("start", "PODMAN_MACHINE_DOWN");
  exec.failNext("destroy", "POLICY_DENIED");

  const outcome = await controller.create(workspace);
  assert.equal(outcome.state, "error");
  assert.equal(outcome.reason, "STARTUP_BUDGET_EXCEEDED");

  await assert.rejects(
    controller.destroy(),
    (error: unknown) =>
      error instanceof RealmError &&
      error.code === "POLICY_DENIED" &&
      error.causeCode === "PODMAN_MACHINE_DOWN",
  );
});

test("a create that fails after its budget expired is kept, and the next destroy reports it (QUAL-01)", async (t) => {
  const { workspace, exec, controller } = fixture(t, 3000);
  exec.setDelay("create", 4000);
  exec.failNext("create", "PODMAN_MISSING");

  const outcome = await controller.create(workspace);
  assert.equal(outcome.state, "error");
  assert.equal(outcome.reason, "STARTUP_BUDGET_EXCEEDED");

  await assert.rejects(
    controller.destroy(),
    (error: unknown) =>
      error instanceof RealmError &&
      error.code === "REALM_STOPPING" &&
      error.causeCode === "PODMAN_MISSING",
  );
});

test("a create that fails while a stop takes it over is kept, and the next destroy reports it (QUAL-01)", async (t) => {
  const { workspace, exec, controller } = fixture(t);
  exec.setDelay("create", 50);
  exec.failNext("create", "PODMAN_MISSING");

  const creating = controller.create(workspace);
  const stopped = await controller.stop();
  assert.equal(stopped.state, "unbound");
  await creating;

  await assert.rejects(
    controller.destroy(),
    (error: unknown) =>
      error instanceof RealmError &&
      error.code === "REALM_STOPPING" &&
      error.causeCode === "PODMAN_MISSING",
  );
});
