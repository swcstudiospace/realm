import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { RealmError } from "../../src/core/errors.js";
import {
  AGENTOS_BACKOFF_BASE_MS,
  AGENTOS_BACKOFF_CAP_MS,
  AGENTOS_MAX_CONSECUTIVE_FAILURES,
  AGENTOS_STABLE_WINDOW_MS,
  AgentOsSupervisor,
} from "../../src/runtime/agentos.js";
import { FakeAgentOsDriver } from "../support/fake-agentos.js";

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
    sessionId: "sess-supervisor",
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

async function assertGatewayLost(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) =>
      error instanceof RealmError && error.code === "OPENSHELL_GATEWAY_LOST" && error.retryable,
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

void test("a crashed driver is terminal: check holds the supervisor with AGENTOS_CRASH_LOOP and neither restarts nor backs off (RT-04, N1)", async () => {
  const { driver, supervisor, sleeps } = harness();
  await supervisor.start();

  driver.crash();
  await assertCrashLoop(supervisor.check());

  assert.deepEqual(sleeps, [], "no backoff wait follows a failed probe");
  assert.equal(driver.callCount("start"), 1, "the supervisor does not restart a driver that failed its probe");
  assert.equal(driver.callCount("stop"), 0, "the driver is left for the session stop to remove");
  assert.equal(supervisor.consecutiveFailures(), 0, "a failed probe is not a counted start failure");

  await assertCrashLoop(supervisor.check());
  assert.equal(driver.callCount("alive"), 1, "a held supervisor must not touch the driver again");

  await supervisor.start();
  assert.equal(await supervisor.check(), true, "an explicit start is the retry, and supervision resumes");
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

void test("a probe that rejects is terminal in the same way as one that answers false (RT-04, N1)", async () => {
  const { driver, supervisor, sleeps } = harness();
  await supervisor.start();
  driver.script("alive", "reject");

  await assertCrashLoop(supervisor.check());

  assert.deepEqual(sleeps, []);
  assert.equal(driver.callCount("start"), 1);
  assert.equal(driver.callCount("stop"), 0);
});

void test("the consecutive start-failure count resets only after 60000 ms of continuous alive (RT-04)", async () => {
  const { driver, supervisor, clock } = harness();
  driver.script("start", "reject", "reject", "reject");
  await supervisor.start();
  assert.equal(supervisor.consecutiveFailures(), 3);

  clock.now = 0;
  assert.equal(await supervisor.check(), true);
  clock.now = 59_999;
  assert.equal(await supervisor.check(), true);
  assert.equal(supervisor.consecutiveFailures(), 3, "the window is not yet stable");

  clock.now = 60_000;
  assert.equal(await supervisor.check(), true);
  assert.equal(supervisor.consecutiveFailures(), 0, "a full stable minute resets the count");
});

void test("a crash after a long stable run is still terminal, with no hysteresis (RT-04, N1)", async () => {
  const { driver, supervisor, clock } = harness();
  await supervisor.start();
  clock.now = 0;
  assert.equal(await supervisor.check(), true);
  clock.now = 120_000;
  assert.equal(await supervisor.check(), true);

  driver.crash();
  await assertCrashLoop(supervisor.check());
  assert.equal(driver.callCount("start"), 1);
});

void test("a hung alive call times out and is terminal, so supervision does not hang or restart (RT-04, N1)", async () => {
  const { driver, supervisor, sleeps } = harness();
  await supervisor.start();
  driver.script("alive", "hang");

  await assertCrashLoop(supervisor.check());

  assert.deepEqual(sleeps, []);
  assert.equal(driver.callCount("stop"), 0);
  assert.equal(driver.callCount("start"), 1);
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

void test("stopping during an in-flight initial start leaves no further start after stop (RT-04, G1)", async () => {
  const { driver, supervisor } = harness();
  const timers = trackTimers();
  try {
    driver.script("start", "hang");
    const started = supervisor.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(driver.callCount("start"), 1, "the start is in flight");
    await supervisor.stop();
    await started;
    assert.equal(driver.callCount("start"), 1, "a start that settles after stop must not start again");
    assert.equal(timers.pending(), 0, "no timer may survive teardown");
  } finally {
    timers.restore();
  }
});

// A driver whose start waits on a gate, so a test holds the initial start pending for as long as it needs. Until the
// gate opens, alive() answers false, as a real runner does before it is ready.
class GatedStartDriver extends FakeAgentOsDriver {
  private readonly gate: Promise<void>;
  private open: () => void = () => {};
  runnerExitedCalls = 0;

  constructor() {
    super();
    this.gate = new Promise<void>((resolve) => {
      this.open = resolve;
    });
  }

  override async start(): Promise<void> {
    await this.gate;
    await super.start();
  }

  override runnerExited(): boolean {
    this.runnerExitedCalls += 1;
    return super.runnerExited();
  }

  release(): void {
    this.open();
  }
}

function gatedHarness(): { readonly driver: GatedStartDriver; readonly supervisor: AgentOsSupervisor } {
  const driver = new GatedStartDriver();
  const supervisor = new AgentOsSupervisor({
    driver,
    sessionId: "sess-supervisor",
    callTimeoutMs: 60_000,
    random: () => 1,
    sleep: () => Promise.resolve(),
    now: () => 0,
  });
  return { driver, supervisor };
}

void test("a check made while the initial start is pending answers false, touches no driver probe and does not hold (RT-04, N1)", async () => {
  const { driver, supervisor } = gatedHarness();
  const started = supervisor.start();

  assert.equal(await supervisor.check(), false, "the runner is not ready, so the check answers false");
  assert.equal(driver.callCount("alive"), 0);
  assert.equal(driver.runnerExitedCalls, 0);
  assert.equal(supervisor.consecutiveFailures(), 0);

  driver.release();
  await started;
  assert.equal(driver.callCount("start"), 1);
  assert.equal(driver.isRunning(), true);
  assert.equal(await supervisor.check(), true, "the supervisor is running and the check answers true");
  assert.equal(driver.callCount("alive"), 1);
});

void test("doctor overlapping a pending start never holds the supervisor, so the next health check is not a crash loop (RT-04, N1)", async () => {
  const { driver, supervisor } = gatedHarness();
  const started = supervisor.start();

  // alive() would answer false here, because the runner has not started. Before the fix this held the supervisor.
  assert.equal(driver.isRunning(), false);
  assert.equal(await supervisor.check(), false);
  assert.equal(await supervisor.check(), false, "a second overlapping check changes nothing either");

  driver.release();
  await started;

  assert.equal(await supervisor.check(), true, "the runner started, so the health check answers true and nothing threw");
  assert.equal(driver.callCount("alive"), 1, "only the check after the start probed the driver");
  assert.equal(driver.callCount("stop"), 0, "the overlapping checks did not count a failure");
});

void test("stopping during a pending start leaves the supervisor stopped and a later start works (RT-04, N1)", async () => {
  const { driver, supervisor } = gatedHarness();
  const started = supervisor.start();
  await supervisor.stop();
  await started;

  assert.equal(await supervisor.check(), false, "a stopped supervisor answers false");
  assert.equal(driver.callCount("alive"), 0);

  driver.release();
  await supervisor.start();
  assert.equal(await supervisor.check(), true, "a start after the stop supervises again");
});

void test("the end of a stopped start does not clear the pending flag of a newer start (RT-04, N1)", async () => {
  const { driver, supervisor } = gatedHarness();
  const first = supervisor.start();
  await supervisor.stop();
  const second = supervisor.start();
  await first;

  assert.equal(await supervisor.check(), false, "the newer start is still pending, so the check answers false");
  assert.equal(driver.callCount("alive"), 0);

  driver.release();
  await second;
  assert.equal(await supervisor.check(), true);
});

void test("stopping during the initial start's backoff wait leaves no restart after stop and no timer behind (RT-04, G1)", async () => {
  const driver = new FakeAgentOsDriver();
  let waits = 0;
  let release: () => void = () => {};
  const supervisor = new AgentOsSupervisor({
    driver,
    sessionId: "sess-supervisor",
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
    driver.script("start", "reject");
    const started = supervisor.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(waits, 1, "the backoff wait is in flight");
    await supervisor.stop();
    release();
    await started;
    assert.equal(driver.callCount("start"), 1, "no retry may follow a stop");
    assert.equal(timers.pending(), 0, "no timer may survive teardown");
  } finally {
    timers.restore();
  }
});

void test("a runner that exited while the session was active is reported as AGENTOS_CRASH_LOOP at once, with no probe and no restart (RT-04)", async () => {
  const { driver, supervisor } = harness();
  await supervisor.start();
  driver.exitRunner();
  await assertCrashLoop(supervisor.check());
  assert.equal(driver.callCount("alive"), 0, "the exit is reported without a probe");
  assert.equal(driver.callCount("start"), 1, "the supervisor does not restart a runner that exited");
});

void test("a runner that exits while the probe is in flight is terminal even when the probe answered alive (RT-04, N1)", async () => {
  const { driver, supervisor, sleeps } = harness();
  await supervisor.start();

  const pending = supervisor.check();
  driver.exitRunner();
  await assertCrashLoop(pending);

  assert.equal(driver.callCount("alive"), 1, "the probe ran and answered alive");
  assert.equal(driver.callCount("start"), 1, "the supervisor does not restart the runner");
  assert.equal(driver.callCount("stop"), 0);
  assert.deepEqual(sleeps, []);
  await assertCrashLoop(supervisor.check());
  assert.equal(driver.callCount("alive"), 1, "the supervisor stays held, so later checks do not probe");
});

void test("B2: a driver stop that fails makes the supervisor stop reject with AGENTOS_STOP_FAILED, so a failed delete is never read as success", async () => {
  const { driver, supervisor } = harness();
  await supervisor.start();
  driver.script("stop", "reject");
  await assert.rejects(
    supervisor.stop(),
    (error: unknown) => error instanceof RealmError && error.code === "AGENTOS_STOP_FAILED",
  );
});

void test("OBS-04: a runner that exited while the gateway does not answer is OPENSHELL_GATEWAY_LOST, not AGENTOS_CRASH_LOOP", async () => {
  const { driver, supervisor } = harness();
  await supervisor.start();
  driver.exitRunner();
  driver.gatewayDown();
  await assertGatewayLost(supervisor.check());
  assert.equal(driver.gatewayCheckCount(), 1);
  assert.equal(driver.callCount("start"), 1, "the supervisor does not restart anything");
});

void test("OBS-04: a runner that exited while the gateway answers is AGENTOS_CRASH_LOOP", async () => {
  const { driver, supervisor } = harness();
  await supervisor.start();
  driver.exitRunner();
  await assertCrashLoop(supervisor.check());
  assert.equal(driver.gatewayCheckCount(), 1, "the failure path asks the gateway once");
});

void test("OBS-04: a probe that answers false while the gateway answers is AGENTOS_CRASH_LOOP, and while it does not is OPENSHELL_GATEWAY_LOST", async () => {
  const answering = harness();
  await answering.supervisor.start();
  answering.driver.crash();
  await assertCrashLoop(answering.supervisor.check());

  const silent = harness();
  await silent.supervisor.start();
  silent.driver.crash();
  silent.driver.gatewayDown();
  await assertGatewayLost(silent.supervisor.check());
});

void test("OBS-04: a probe that rejects while the gateway does not answer is OPENSHELL_GATEWAY_LOST", async () => {
  const { driver, supervisor } = harness();
  await supervisor.start();
  driver.script("alive", "reject");
  driver.gatewayDown();
  await assertGatewayLost(supervisor.check());
});

void test("OBS-04: a gateway status that rejects or never answers counts as a gateway that does not answer, within the call bound", async () => {
  for (const how of ["reject", "hang"] as const) {
    const { driver, supervisor } = harness();
    await supervisor.start();
    driver.exitRunner();
    driver.gatewayDown(how);
    await assertGatewayLost(supervisor.check());
    assert.equal(driver.gatewayCheckCount(), 1);
  }
});

void test("OBS-04: a healthy check never asks the gateway", async () => {
  const { driver, supervisor } = harness();
  await supervisor.start();
  driver.gatewayDown();
  assert.equal(await supervisor.check(), true);
  assert.equal(driver.gatewayCheckCount(), 0);
});

void test("OBS-04: a held supervisor keeps its code when the gateway comes back, until start() runs again", async () => {
  const { driver, supervisor } = harness();
  await supervisor.start();
  driver.exitRunner();
  driver.gatewayDown();
  await assertGatewayLost(supervisor.check());

  driver.gatewayUp();
  await assertGatewayLost(supervisor.check());
  assert.equal(driver.gatewayCheckCount(), 1, "a held supervisor classifies once");
  assert.equal(driver.callCount("alive"), 0);

  await supervisor.start();
  assert.equal(await supervisor.check(), true, "an explicit start is the retry and clears the held code");
  driver.exitRunner();
  await assertCrashLoop(supervisor.check());
});

void test("OBS-04: a start that gave up keeps AGENTOS_CRASH_LOOP even when the gateway does not answer", async () => {
  const { driver, supervisor } = harness();
  driver.script("start", "reject", "reject", "reject", "reject", "reject");
  driver.gatewayDown();
  await assertCrashLoop(supervisor.start());
  await assertCrashLoop(supervisor.check());
  assert.equal(driver.gatewayCheckCount(), 0, "the create and start path is not classified");
});

void test("OBS-04: a check made while the classification is in flight throws the same code as the first", async () => {
  const { driver, supervisor } = harness();
  await supervisor.start();
  driver.exitRunner();
  driver.gatewayDown();
  const first = supervisor.check();
  const second = supervisor.check();
  await assertGatewayLost(first);
  await assertGatewayLost(second);
  assert.equal(driver.gatewayCheckCount(), 1);
});

// Two checks in flight at once (a health tick and realm doctor), both parked in alive(). The first probe to answer fails
// and starts the classification, which is parked in gatewayAnswers(); the second probe then fails while it is in flight.
async function overlappingChecks(gateway: "up" | "down"): Promise<{
  readonly driver: FakeAgentOsDriver;
  readonly supervisor: AgentOsSupervisor;
  readonly first: Promise<boolean>;
  readonly second: Promise<boolean>;
}> {
  const { driver, supervisor } = harness();
  await supervisor.start();
  driver.crash();
  if (gateway === "down") {
    driver.gatewayDown();
  }
  driver.holdAlive();
  driver.holdGateway();
  const first = supervisor.check();
  const second = supervisor.check();
  await nextTurn();
  driver.releaseAlive();
  await nextTurn();
  driver.releaseAlive();
  await nextTurn();
  return { driver, supervisor, first, second };
}

void test("OBS-04: two overlapping probes that fail while the gateway does not answer both reject with OPENSHELL_GATEWAY_LOST", async () => {
  const { driver, first, second } = await overlappingChecks("down");
  const both = Promise.all([assertGatewayLost(first), assertGatewayLost(second)]);
  driver.releaseGateway();
  await both;
  assert.equal(driver.gatewayCheckCount(), 1, "the overlapping probes share one classification");
});

void test("OBS-04: two overlapping probes that fail while the gateway answers both reject with AGENTOS_CRASH_LOOP", async () => {
  const { driver, first, second } = await overlappingChecks("up");
  const both = Promise.all([assertCrashLoop(first), assertCrashLoop(second)]);
  driver.releaseGateway();
  await both;
  assert.equal(driver.gatewayCheckCount(), 1);
});

void test("OBS-04: a stop during the classification makes both overlapping checks return false", async () => {
  const { supervisor, first, second } = await overlappingChecks("down");
  await supervisor.stop();
  assert.equal(await first, false);
  assert.equal(await second, false);
});

void test("OBS-04: a stop that overtakes the classification makes check return false and leaves the supervisor stopped", async () => {
  const { driver, supervisor } = harness();
  await supervisor.start();
  driver.exitRunner();
  driver.gatewayDown("hang");
  const pending = supervisor.check();
  const concurrent = supervisor.check();
  await nextTurn();
  await supervisor.stop();
  assert.equal(await pending, false);
  assert.equal(await concurrent, false);
  assert.equal(await supervisor.check(), false, "a stopped supervisor does not probe");
});

void test("OBS-04: a new start that overtakes the classification makes check return false and does not hold the new run", async () => {
  const { driver, supervisor } = harness();
  await supervisor.start();
  driver.exitRunner();
  driver.gatewayDown("hang");
  const pending = supervisor.check();
  await nextTurn();
  await supervisor.start();
  assert.equal(await pending, false);
  driver.gatewayUp();
  assert.equal(await supervisor.check(), true, "the new run is healthy and is not held by the old classification");
});
