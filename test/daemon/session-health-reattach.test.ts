// The bounded health re-attach (SessionHealth.reattach). After a probe moves a session to error, the health loop runs restart() up to
// policy.attempts times, waiting delayMs times the attempt number before each, and stops at the first attempt that leaves the error
// state. Without a policy a probe failure stays terminal until an explicit retry (owner ruling N1). The interval timer and the wait are
// fakes, so no test sleeps.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { makeRealmError, type ErrorCode } from "../../src/core/errors.js";
import type { StateSnapshot } from "../../src/core/state-machine.js";
import { SessionHealth, type SessionReattachPolicy } from "../../src/daemon/sessions.js";
import type { RealmHandle } from "../../src/realm/compose.js";
import type { Logger } from "../../src/observe/logger.js";
import type { Metrics } from "../../src/observe/metrics.js";

type StateName = StateSnapshot["state"];

const AT = "2026-11-16T10:00:00.000Z";

function snapshotOf(state: StateName, reason: string): StateSnapshot {
  return { state, reason, lastTransitionAt: AT };
}

interface Arrangement {
  readonly health: SessionHealth;
  readonly starts: () => number;
  readonly waits: readonly number[];
  readonly logged: readonly string[];
  readonly tick: () => Promise<void>;
  readonly stateNow: () => StateName;
}

type ReattachInput = Omit<SessionReattachPolicy, "sleep" | "restart">;

// A controller whose probe lands the session in error, and a restart that answers from startOutcomes, one per call. An outcome is the
// state the restart leaves the session in, or a code it refuses with.
function arrange(
  t: TestContext,
  policy: ReattachInput | undefined,
  startOutcomes: readonly (StateName | ErrorCode)[],
): Arrangement {
  let state: StateName = "active";
  let startCalls = 0;
  const listeners: ((event: { from: StateName; to: StateName; reason: string }) => void)[] = [];
  const logged: string[] = [];
  const callback: { current: (() => void) | undefined } = { current: undefined };
  t.mock.method(globalThis, "setInterval", (fn: () => void): NodeJS.Timeout => {
    callback.current = fn;
    return setTimeout(() => undefined, 2 ** 31 - 1);
  });
  t.mock.method(globalThis, "clearInterval", (handle: NodeJS.Timeout): void => {
    clearTimeout(handle);
  });
  const controller = {
    events: {
      subscribe: (listener: (event: { from: StateName; to: StateName; reason: string }) => void): (() => void) => {
        listeners.push(listener);
        return () => undefined;
      },
    },
    snapshot: (): StateSnapshot => snapshotOf(state, "reason"),
    probe: (): Promise<StateSnapshot> => {
      state = "error";
      return Promise.resolve(snapshotOf("error", "probe failed"));
    },
  };
  const restart = (): Promise<StateSnapshot> => {
    const outcome = startOutcomes[startCalls] ?? "error";
    startCalls += 1;
    if (outcome === "active" || outcome === "error") {
      state = outcome;
      return Promise.resolve(snapshotOf(outcome, "start"));
    }
    return Promise.reject(makeRealmError(outcome as ErrorCode));
  };
  const waits: number[] = [];
  const logger = {
    info: (event: string): void => {
      logged.push(event);
    },
    warn: (event: string): void => {
      logged.push(event);
    },
  } as unknown as Logger;
  const metrics = { recordTransition: (): void => undefined, recordHealthProbeFailure: (): void => undefined } as unknown as Metrics;
  const health = new SessionHealth({
    sessionId: "s",
    handle: { controller } as unknown as RealmHandle,
    metrics,
    logger,
    isStopping: (): boolean => false,
    onProbeFailure: undefined,
    upIdOf: () => undefined,
    reattach:
      policy === undefined
        ? undefined
        : {
            ...policy,
            restart,
            sleep: (ms: number): Promise<void> => {
              waits.push(ms);
              return Promise.resolve();
            },
          },
  });
  t.after(() => {
    health.dispose();
  });
  // The session is in service, so the loop arms its timer.
  for (const listener of listeners) {
    listener({ from: "connecting", to: "active", reason: "up" });
  }
  return {
    health,
    starts: () => startCalls,
    waits,
    logged,
    tick: async () => {
      assert.ok(callback.current, "the health loop armed its timer");
      callback.current();
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
    stateNow: () => state,
  };
}

const POLICY: ReattachInput = { attempts: 3, delayMs: 5_000 };

void test("reattach: a probe failure is followed by a restart, and the session is active again after the first attempt that works", async (t) => {
  const run = arrange(t, POLICY, ["active"]);
  await run.tick();
  assert.equal(run.starts(), 1);
  assert.equal(run.stateNow(), "active");
  assert.deepEqual(run.waits, [5_000], "the first attempt waits one delay unit");
});

void test("reattach: failed attempts are bounded, each waits one more delay unit, and the session stays in error afterwards", async (t) => {
  const run = arrange(t, POLICY, ["error", "OPENSHELL_START_FAILED", "error", "active"]);
  await run.tick();
  assert.equal(run.starts(), 3, "no fourth attempt runs");
  assert.deepEqual(run.waits, [5_000, 10_000, 15_000]);
  assert.equal(run.stateNow(), "error");
  assert.ok(run.logged.includes("health.reattach_failed"), "a refused attempt is logged with its code");
});

void test("reattach: without a policy a probe failure is terminal and no restart is attempted", async (t) => {
  const run = arrange(t, undefined, ["active"]);
  await run.tick();
  assert.equal(run.starts(), 0);
  assert.equal(run.stateNow(), "error");
});
