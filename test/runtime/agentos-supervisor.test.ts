import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RealmError } from "../../src/core/errors.js";
import {
  AGENTOS_BACKOFF_BASE_MS,
  AGENTOS_BACKOFF_CAP_MS,
  AGENTOS_MAX_CONSECUTIVE_FAILURES,
  AGENTOS_STABLE_WINDOW_MS,
  AgentOsSupervisor,
} from "../../src/runtime/agentos.js";
import { FakeAgentOsDriver } from "../support/fake-agentos.js";

// This file runs from dist/test/runtime, so three levels up is the package root.
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CALL_TIMEOUT_MS = 50;

function harness(): {
  readonly driver: FakeAgentOsDriver;
  readonly supervisor: AgentOsSupervisor;
  readonly sleeps: number[];
  readonly clock: { now: number };
} {
  const sleeps: number[] = [];
  const clock = { now: 0 };
  const driver = new FakeAgentOsDriver();
  const supervisor = new AgentOsSupervisor({
    driver,
    callTimeoutMs: CALL_TIMEOUT_MS,
    // A random draw of 1 gives the top of the jitter range, so each delay is the full ceiling.
    random: () => 1,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    now: () => clock.now,
  });
  return { driver, supervisor, sleeps, clock };
}

async function assertCrashLoop(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) =>
      error instanceof RealmError && error.code === "AGENTOS_CRASH_LOOP" && error.retryable,
  );
}

// Records every timer armed through the global setTimeout while it is installed, so a test can
// prove that teardown leaves none pending. Call restore() in a finally block.
function trackTimers(): { readonly pending: () => number; readonly restore: () => void } {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const armed = new Set<unknown>();
  globalThis.setTimeout = ((callback: () => void, ms?: number): unknown => {
    const handle: unknown = realSetTimeout(() => {
      armed.delete(handle);
      callback();
    }, ms);
    armed.add(handle);
    return handle;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (handle: unknown): void => {
    armed.delete(handle);
    realClearTimeout(handle as Parameters<typeof realClearTimeout>[0]);
  };
  return {
    pending: () => armed.size,
    restore: () => {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    },
  };
}

void test("the AgentOS backoff parameters are base 500 ms, cap 8000 ms, five attempts, and a 60000 ms stable window (RT-04)", () => {
  assert.equal(AGENTOS_BACKOFF_BASE_MS, 500);
  assert.equal(AGENTOS_BACKOFF_CAP_MS, 8000);
  assert.equal(AGENTOS_MAX_CONSECUTIVE_FAILURES, 5);
  assert.equal(AGENTOS_STABLE_WINDOW_MS, 60_000);
});

void test("a crashed driver restarts after the shared backoff schedule, with the delay drawn from the injected source (RT-04)", async () => {
  const { driver, supervisor, sleeps } = harness();
  await supervisor.start();

  driver.crash();
  assert.equal(await supervisor.check(), true);
  assert.deepEqual(sleeps, [500]);
  assert.equal(driver.isRunning(), true);

  driver.crash();
  assert.equal(await supervisor.check(), true);
  assert.deepEqual(sleeps, [500, 1000]);
  assert.equal(driver.callCount("start"), 3);
});

void test("a failed restart counts as a further failure and backs off again before the next attempt (RT-04)", async () => {
  const { driver, supervisor, sleeps, clock } = harness();
  driver.script("start", "reject", "reject");

  await supervisor.start();

  assert.deepEqual(sleeps, [500, 1000]);
  assert.equal(driver.callCount("start"), 3);
  assert.equal(supervisor.consecutiveFailures(), 2);
  assert.equal(driver.isRunning(), true);
  clock.now = 0;
  assert.equal(await supervisor.check(), true);
  assert.equal(supervisor.consecutiveFailures(), 2);
});

void test("the fifth consecutive failure holds the supervisor with AGENTOS_CRASH_LOOP, and an explicit retry runs again (RT-04)", async () => {
  const { driver, supervisor, sleeps } = harness();
  driver.script("start", "reject", "reject", "reject", "reject", "reject");

  await assertCrashLoop(supervisor.start());

  assert.equal(driver.callCount("start"), 5);
  assert.deepEqual(sleeps, [500, 1000, 2000, 4000]);
  assert.equal(supervisor.consecutiveFailures(), 5);

  await assertCrashLoop(supervisor.check());
  assert.equal(driver.callCount("alive"), 0, "a held supervisor must not touch the driver");

  await supervisor.start();
  assert.equal(driver.isRunning(), true);
  assert.equal(supervisor.consecutiveFailures(), 0);
});

void test("a crash and the failed restarts that follow it share one count toward the fifth failure (RT-04)", async () => {
  const { driver, supervisor, sleeps } = harness();
  await supervisor.start();
  driver.crash();
  driver.script("start", "reject", "reject", "reject", "reject");

  await assertCrashLoop(supervisor.check());

  assert.equal(driver.callCount("start"), 5, "one initial start plus four restart attempts");
  assert.deepEqual(sleeps, [500, 1000, 2000, 4000]);
});

void test("the consecutive count resets only after 60000 ms of continuous alive (RT-04)", async () => {
  const { driver, supervisor, clock } = harness();
  await supervisor.start();
  driver.crash();
  driver.script("start", "reject", "reject", "reject");

  assert.equal(await supervisor.check(), true);
  assert.equal(supervisor.consecutiveFailures(), 4);

  clock.now = 0;
  assert.equal(await supervisor.check(), true);
  clock.now = 59_999;
  assert.equal(await supervisor.check(), true);
  assert.equal(supervisor.consecutiveFailures(), 4, "the window is not yet stable");

  clock.now = 60_000;
  assert.equal(await supervisor.check(), true);
  assert.equal(supervisor.consecutiveFailures(), 0, "a full stable minute resets the count");

  driver.crash();
  assert.equal(await supervisor.check(), true);
  assert.equal(supervisor.consecutiveFailures(), 1);
});

void test("a crash inside the stable window keeps the count, so it still reaches AGENTOS_CRASH_LOOP (RT-04)", async () => {
  const { driver, supervisor, clock } = harness();
  await supervisor.start();
  driver.crash();
  driver.script("start", "reject", "reject", "reject");
  assert.equal(await supervisor.check(), true);
  assert.equal(supervisor.consecutiveFailures(), 4);

  clock.now = 0;
  assert.equal(await supervisor.check(), true);
  clock.now = 30_000;
  driver.crash();

  await assertCrashLoop(supervisor.check());
  assert.equal(supervisor.consecutiveFailures(), 5);
});

void test("a hung alive call times out and is treated as a crash, so supervision does not hang (RT-04)", async () => {
  const { driver, supervisor, sleeps } = harness();
  await supervisor.start();
  driver.script("alive", "hang");

  assert.equal(await supervisor.check(), true);

  assert.deepEqual(sleeps, [500]);
  assert.equal(driver.callCount("stop"), 1, "a hung driver is stopped before its restart");
  assert.equal(driver.callCount("start"), 2);
});

void test("a hung start call times out and counts as a failed attempt, so supervision does not hang (RT-04)", async () => {
  const { driver, supervisor, sleeps } = harness();
  driver.script("start", "hang");

  await supervisor.start();

  assert.deepEqual(sleeps, [500]);
  assert.equal(driver.callCount("start"), 2);
  assert.equal(driver.isRunning(), true);
});

void test("a stopped supervisor neither probes nor restarts the driver (RT-04)", async () => {
  const { driver, supervisor } = harness();
  await supervisor.start();
  await supervisor.stop();

  assert.equal(await supervisor.check(), false);
  assert.equal(driver.callCount("alive"), 0);
  assert.equal(driver.callCount("start"), 1);
  assert.equal(driver.isRunning(), false);
});

void test("the package manifest names no AgentOS library package, so no driver binding exists (RT-04, OQ-P3-05, OQ-P3-06)", () => {
  const manifest = readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8");
  assert.equal(/@rivet-dev|agentos-core/.test(manifest), false);
});

void test("stopping during an in-flight probe leaves no restart after stop and no timer behind (RT-04, G1)", async () => {
  const { driver, supervisor } = harness();
  const timers = trackTimers();
  try {
    await supervisor.start();
    driver.script("alive", "hang");
    const probe = supervisor.check();
    await supervisor.stop();
    assert.equal(await probe, false);
    assert.equal(driver.callCount("alive"), 1);
    assert.equal(driver.callCount("start"), 1, "no start may follow a stop");
    assert.equal(timers.pending(), 0, "no timer may survive teardown");
  } finally {
    timers.restore();
  }
});

void test("stopping during an in-flight restart leaves no further start after stop (RT-04, G1)", async () => {
  const { driver, supervisor } = harness();
  const timers = trackTimers();
  try {
    await supervisor.start();
    driver.crash();
    driver.script("start", "hang");
    const check = supervisor.check();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(driver.callCount("start"), 2, "the restart is in flight");
    await supervisor.stop();
    assert.equal(await check, false);
    assert.equal(driver.callCount("start"), 2, "a restart that settles after stop must not start again");
    assert.equal(timers.pending(), 0, "no timer may survive teardown");
  } finally {
    timers.restore();
  }
});

void test("stopping during the backoff wait leaves no restart after stop and no timer behind (RT-04, G1)", async () => {
  const driver = new FakeAgentOsDriver();
  let waits = 0;
  let release: () => void = () => {};
  const supervisor = new AgentOsSupervisor({
    driver,
    callTimeoutMs: CALL_TIMEOUT_MS,
    random: () => 1,
    sleep: () => {
      waits += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    now: () => 0,
  });
  const timers = trackTimers();
  try {
    await supervisor.start();
    driver.crash();
    const check = supervisor.check();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(waits, 1, "the backoff wait is in flight");
    await supervisor.stop();
    release();
    assert.equal(await check, false);
    assert.equal(driver.callCount("start"), 1, "no restart may follow a stop");
    assert.equal(timers.pending(), 0, "no timer may survive teardown");
  } finally {
    timers.restore();
  }
});
