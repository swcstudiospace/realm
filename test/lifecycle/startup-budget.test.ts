import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { Policy } from "../../src/contract/validate.js";
import { LifecycleController } from "../../src/lifecycle/controller.js";
import { SessionStore } from "../../src/session/store.js";
import { FakeExecutionService } from "../support/fake-execution.js";
import { FakeBridge } from "../support/fake-bridge.js";

const SESSION = "session-1";
const CLOCK_TIME = "2026-10-21T09:30:00.000Z";
const BUDGET_MS = 50;

function policyFor(
  workspaceRoots: readonly string[],
  startupBudgetMs: number,
  onRootsRead: () => void = () => {},
): Policy {
  return {
    mode: "advisory",
    get workspaceRoots() {
      onRootsRead();
      return workspaceRoots;
    },
    credentialAllow: [],
    egressAllow: [],
    shellEnabled: false,
    startupBudgetMs,
    toolQueueMs: 2000,
  };
}

// Replaces performance.now for one test. The controller reads it when the startup deadline
// is set and at every deadline check, so advancing this value models a slow synchronous step
// with no real wait. t.mock restores the real clock when the test ends.
function scriptedClock(t: TestContext): { advance(ms: number): void } {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  return {
    advance(ms: number): void {
      now += ms;
    },
  };
}

// A store whose every load first advances the scripted clock, modelling a slow record read.
function scriptedLoadStore(
  clock: { advance(ms: number): void },
  delayMs: number,
): (stateDir: string) => SessionStore {
  return (stateDir: string) => {
    const store = new SessionStore(stateDir);
    const load = store.load.bind(store);
    store.load = (sessionId: string) => {
      clock.advance(delayMs);
      return load(sessionId);
    };
    return store;
  };
}

interface FixtureOptions {
  readonly startupBudgetMs?: number;
  readonly onRootsRead?: () => void;
  readonly store?: (stateDir: string) => SessionStore;
}

// Real directories under a temporary base, a session store on disk, and the fake execution
// service. The policy allows only the workspace.
function fixture(t: TestContext, options: FixtureOptions = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-startup-budget-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const workspace = join(base, "workspace");
  mkdirSync(workspace);
  const stateDir = join(base, "state");
  const store = options.store ? options.store(stateDir) : new SessionStore(stateDir);
  const exec = new FakeExecutionService();
  const bridge = new FakeBridge();
  const controller = new LifecycleController({
    sessionId: SESSION,
    policy: policyFor([workspace], options.startupBudgetMs ?? 10000, options.onRootsRead),
    store,
    exec,
    bridge,
    clock: () => new Date(CLOCK_TIME),
  });
  return { workspace, store, exec, controller };
}

test("a slow store load that uses up the startup budget gives STARTUP_BUDGET_EXCEEDED and state error, with no container created (D-28)", async (t) => {
  const clock = scriptedClock(t);
  const { store, exec, controller, workspace } = fixture(t, {
    startupBudgetMs: BUDGET_MS,
    store: scriptedLoadStore(clock, 3000),
  });

  const snapshot = await controller.create(workspace);

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "STARTUP_BUDGET_EXCEEDED");
  assert.equal(controller.snapshot().state, "error");
  assert.equal(store.load(SESSION)?.state, "error");
  assert.equal(exec.callCount("create"), 0);
  assert.equal(exec.callCount("start"), 0);
});

test("a slow workspace bind that uses up the startup budget gives STARTUP_BUDGET_EXCEEDED and state error, with no container created (D-28)", async (t) => {
  const clock = scriptedClock(t);
  const { store, exec, controller, workspace } = fixture(t, {
    startupBudgetMs: BUDGET_MS,
    // bindWorkspace canonicalizes every policy root, so reading the roots is where the
    // scripted slow bind runs.
    onRootsRead: () => {
      clock.advance(3000);
    },
  });

  const snapshot = await controller.create(workspace);

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "STARTUP_BUDGET_EXCEEDED");
  assert.equal(controller.snapshot().state, "error");
  assert.equal(store.load(SESSION)?.state, "error");
  assert.equal(exec.callCount("create"), 0);
  assert.equal(exec.callCount("start"), 0);
});

test("a retry after exec.start overruns the budget reattaches to the one recorded container and starts that container (CORE-06, RT-07)", async (t) => {
  // Real timers, on purpose: withTimeout races the port call against a real setTimeout. The
  // budget is 200 ms and the scripted start delay is 800 ms, 4x the budget, so the budget
  // fires first. The abandoned start finishes on its own timer, which touches no disk.
  const { store, exec, controller, workspace } = fixture(t, { startupBudgetMs: 200 });
  exec.setDelay("start", 800);

  const failed = await controller.create(workspace);

  assert.equal(failed.state, "error");
  assert.equal(failed.reason, "STARTUP_BUDGET_EXCEEDED");
  const recorded = store.load(SESSION);
  assert.equal(recorded?.state, "error");
  const containerId = recorded?.containerId;
  assert.ok(typeof containerId === "string");
  assert.equal(exec.callCount("create"), 1);

  exec.setDelay("start", 0);
  const active = await controller.create(workspace);

  assert.equal(active.state, "active");
  assert.equal(exec.callCount("create"), 1);
  assert.equal(exec.resources().length, 1);
  assert.equal(store.load(SESSION)?.containerId, containerId);
  const starts = exec.calls().filter((call) => call.operation === "start");
  assert.deepEqual(
    starts.map((call) => call.containerId),
    [containerId, containerId],
  );
});
