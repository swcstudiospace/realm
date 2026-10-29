// Retry from error after a startup whose bridge handshake was still running when the startup
// budget expired (ANDA-03, D-64). The bridge refuses a connect made during a handshake with a
// plain Error, so the controller must reuse the handshake it already started, not start a second
// one. Nothing here depends on elapsed time: performance.now is frozen, so no deadline check
// trips on slow disk work, node's mocked setTimeout holds every startup budget until the test
// ticks it, and the handshake is held by the test, so each step is decided by the test.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { Policy } from "../../src/contract/validate.js";
import { type ErrorCode, makeRealmError } from "../../src/core/errors.js";
import type { StateSnapshot } from "../../src/core/state-machine.js";
import { bindWorkspaceUnderPolicy } from "../../src/fs/root.js";
import { LifecycleController } from "../../src/lifecycle/controller.js";
import { SessionStore } from "../../src/session/store.js";
import { FakeBridge } from "../support/fake-bridge.js";
import { FakeExecutionService } from "../support/fake-execution.js";
import { scaledMs } from "../support/timing.js";

const SESSION = "session-1";
const CLOCK_TIME = "2026-10-21T09:30:00.000Z";
// Shared by the first startup and by every retry. It is only the length of the mocked startup timer
// that a test ticks, never a real wait.
const BUDGET_MS = 5000;

// Lets the controller's promise-only startup path run up to the bridge. Each step after a
// store or port call is a microtask, so one macrotask turn reaches the next connect call. It
// uses setImmediate, which the mocked setTimeout does not touch.
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

// Waits until the bridge has been called n times to connect. The loop yields on setImmediate and
// is bounded by a real-clock deadline (Date.now is not mocked), so a controller that never
// reaches the bridge fails the test instead of spinning.
async function connectCalls(bridge: FakeBridge, n: number): Promise<void> {
  const limit = Date.now() + scaledMs(5000);
  while (bridge.callCount("connect") < n) {
    if (Date.now() >= limit) {
      throw new Error(`the controller did not call the bridge to connect ${String(n)} time(s)`);
    }
    await settle();
  }
}

// FakeBridge with the bridge's handshake contract (ANDA-03): a connect made while a handshake
// is in flight is refused with a plain Error and is not recorded, as the real bridge refuses it.
// Each handshake stays open until the test calls finish, so the test decides when the bridge's
// own deadline has passed. The double uses no timers.
class HeldHandshakeBridge extends FakeBridge {
  private inFlight = false;
  private settleCurrent: ((error: Error | null) => void) | null = null;

  override async connect(deadlineMs: number): Promise<void> {
    if (this.inFlight) {
      throw new Error("AndaBridge.connect: a handshake is running or the bridge is already connected");
    }
    this.inFlight = true;
    const handshake = new Promise<void>((resolve, reject) => {
      this.settleCurrent = (error) => {
        if (error === null) {
          resolve();
        } else {
          reject(error);
        }
      };
    });
    // Marks a rejection handled even when the caller has stopped waiting, so none is unhandled.
    handshake.catch(() => {});
    try {
      await super.connect(deadlineMs);
      await handshake;
    } finally {
      this.inFlight = false;
      this.settleCurrent = null;
    }
  }

  // Settles the handshake in flight: resolves it, or rejects it with a catalogue code. With no
  // handshake in flight it does nothing, so cleanup can call it unconditionally.
  finish(code?: ErrorCode): void {
    const settle = this.settleCurrent;
    if (settle === null) {
      return;
    }
    this.settleCurrent = null;
    settle(code === undefined ? null : makeRealmError(code));
  }
}

function policyFor(workspaceRoot: string): Policy {
  return {
    mode: "advisory",
    workspaceRoots: [workspaceRoot],
    credentialAllow: [],
    egressAllow: [],
    shellEnabled: false,
    startupBudgetMs: BUDGET_MS,
    toolQueueMs: 2000,
  };
}

// Real directories under a temporary base, a session store on disk, the fake execution service,
// and the held-handshake bridge. Any handshake still held when the test ends is settled.
// The clock is frozen (never advanced), so no deadline check can trip on the startup's real disk
// work however loaded the host is, and setTimeout is mocked, so a startup budget ends only when the
// test ticks it. t.mock restores both when the test ends.
function fixture(t: TestContext) {
  t.mock.method(performance, "now", () => 1000);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    t.mock.timers.reset();
  });
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-bridge-retry-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const workspace = join(base, "workspace");
  mkdirSync(workspace);
  const store = new SessionStore(join(base, "state"));
  const exec = new FakeExecutionService();
  const bridge = new HeldHandshakeBridge();
  const controller = new LifecycleController({
    sessionId: SESSION,
    policy: policyFor(workspace),
    pinnedRoot: bindWorkspaceUnderPolicy([workspace], workspace),
    store,
    exec,
    bridge,
    clock: () => new Date(CLOCK_TIME),
  });
  t.after(() => {
    bridge.finish();
  });
  return { workspace, store, exec, bridge, controller };
}

interface Fixture {
  readonly workspace: string;
  readonly bridge: HeldHandshakeBridge;
  readonly controller: LifecycleController;
}

// Runs the first create up to its held handshake, then expires its startup budget: the only timer
// pending at that moment is the one racing the handshake, and the tick fires it.
async function expiredFirstStartup(t: TestContext, f: Fixture): Promise<StateSnapshot> {
  const creating = f.controller.create(f.workspace);
  await connectCalls(f.bridge, 1);
  t.mock.timers.tick(BUDGET_MS);
  return creating;
}

void test("a retry from error waits for the handshake the expired startup started, and starts no second connect (ANDA-03, D-64)", async (t) => {
  const f = fixture(t);
  const { bridge, controller } = f;
  const liveBefore = process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;

  const failed = await expiredFirstStartup(t, f);
  assert.equal(failed.state, "error");
  assert.equal(failed.reason, "STARTUP_BUDGET_EXCEEDED");
  assert.equal(bridge.callCount("connect"), 1);

  const retry = controller.start();
  await settle();
  assert.equal(bridge.callCount("connect"), 1, "the retry does not call the bridge while the handshake is held");
  bridge.finish();
  const active = await retry;

  assert.equal(active.state, "active");
  assert.equal(bridge.callCount("connect"), 1);
  assert.equal(process.getActiveResourcesInfo().filter((name) => name === "Timeout").length, liveBefore, "no timer survives the test");
});

void test("a retry whose held handshake never settles ends at its own budget, and the next startup reuses the handshake once it connects (ANDA-03)", async (t) => {
  const f = fixture(t);
  const { bridge, controller } = f;
  await expiredFirstStartup(t, f);

  const retrying = controller.start();
  await settle();
  t.mock.timers.tick(BUDGET_MS);
  const retry = await retrying;
  assert.equal(retry.state, "error");
  assert.equal(retry.reason, "STARTUP_BUDGET_EXCEEDED", "the wait is bounded by the retry's own budget");
  assert.equal(bridge.callCount("connect"), 1);

  bridge.finish();
  await settle();
  const active = await controller.start();
  assert.equal(active.state, "active");
  assert.equal(bridge.callCount("connect"), 1, "the handshake that connected is reused, not dialled again");
});

void test("a handshake that fails while a retry waits gives the retry the bridge's code, and the next startup starts a fresh handshake (ANDA-03)", async (t) => {
  const f = fixture(t);
  const { bridge, controller } = f;
  await expiredFirstStartup(t, f);

  const retry = controller.start();
  await settle();
  bridge.finish("ANDA_UNREACHABLE");
  const failed = await retry;
  assert.equal(failed.state, "error");
  assert.equal(failed.reason, "ANDA_UNREACHABLE", "the retry reports the bridge's code, not OPENSHELL_START_FAILED");
  assert.equal(bridge.callCount("connect"), 1);

  const next = controller.start();
  await settle();
  bridge.finish();
  const active = await next;
  assert.equal(active.state, "active");
  assert.equal(bridge.callCount("connect"), 2);
});

void test("after destroy, a new startup connects the bridge again instead of reusing the handshake of the old session (ANDA-03)", async (t) => {
  const { workspace, bridge, controller } = fixture(t);
  const first = controller.create(workspace);
  await connectCalls(bridge, 1);
  bridge.finish();
  assert.equal((await first).state, "active");

  await controller.destroy();
  assert.equal(controller.snapshot().state, "unbound");

  const second = controller.create(workspace);
  await connectCalls(bridge, 2);
  bridge.finish();
  assert.equal((await second).state, "active");
  assert.equal(bridge.callCount("connect"), 2);
});
