import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as timing from "./timing.js";

const { ManualClock, TIMEOUT_SCALE_VARIABLE, boundedWait, parseTimeoutScale, pollUntil, scaledMs, testTimeout } = timing;

let freshImports = 0;

// Loads a second copy of the timing module with the scale variable set (or unset) for the load, so the module-level read of
// the environment is covered. A static import cannot do this: the query string makes each load a fresh module instance. The
// variable is restored before this returns.
async function loadWithScale(raw: string | undefined): Promise<typeof timing> {
  const previous = process.env[TIMEOUT_SCALE_VARIABLE];
  if (raw === undefined) {
    Reflect.deleteProperty(process.env, TIMEOUT_SCALE_VARIABLE);
  } else {
    process.env[TIMEOUT_SCALE_VARIABLE] = raw;
  }
  try {
    freshImports += 1;
    return (await import(`./timing.js?fresh=${String(freshImports)}`)) as typeof timing;
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, TIMEOUT_SCALE_VARIABLE);
    } else {
      process.env[TIMEOUT_SCALE_VARIABLE] = previous;
    }
  }
}

// A promise that never settles: the stand-in for work that hangs. The executor form is used because tsconfig's ES2023 lib has
// no Promise.withResolvers.
function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

interface ArmedTimer {
  readonly handle: NodeJS.Timeout;
  readonly ms: number | undefined;
  cleared: boolean;
}

// Records every real timer armed with the given delay and whether it was cleared. Timers with any other delay (the test runner's
// own) pass through unrecorded.
function recordTimers(t: TestContext, watchedMs: number): readonly ArmedTimer[] {
  const armed: ArmedTimer[] = [];
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  t.mock.method(globalThis, "setTimeout", (callback: () => void, ms?: number): NodeJS.Timeout => {
    const handle = realSetTimeout(callback, ms);
    if (ms === watchedMs) {
      armed.push({ handle, ms, cleared: false });
    }
    return handle;
  });
  t.mock.method(globalThis, "clearTimeout", (handle: NodeJS.Timeout | string | number | undefined): void => {
    const entry = armed.find((candidate) => candidate.handle === handle);
    if (entry !== undefined) {
      entry.cleared = true;
    }
    realClearTimeout(handle);
  });
  return armed;
}

void test("parseTimeoutScale: a number from 1 to 10 is used as is", () => {
  assert.equal(parseTimeoutScale("1"), 1);
  assert.equal(parseTimeoutScale("2.5"), 2.5);
  assert.equal(parseTimeoutScale("10"), 10);
  assert.equal(parseTimeoutScale(" 3 "), 3);
});

void test("parseTimeoutScale: a missing, blank or invalid value means 1", () => {
  assert.equal(parseTimeoutScale(undefined), 1);
  assert.equal(parseTimeoutScale(""), 1);
  assert.equal(parseTimeoutScale("   "), 1);
  assert.equal(parseTimeoutScale("fast"), 1);
  assert.equal(parseTimeoutScale("NaN"), 1);
  assert.equal(parseTimeoutScale("Infinity"), 1);
  assert.equal(parseTimeoutScale("-Infinity"), 1);
});

void test("parseTimeoutScale: a value outside 1 to 10 is clamped", () => {
  assert.equal(parseTimeoutScale("0"), 1);
  assert.equal(parseTimeoutScale("0.5"), 1);
  assert.equal(parseTimeoutScale("-4"), 1);
  assert.equal(parseTimeoutScale("11"), 10);
  assert.equal(parseTimeoutScale("1000"), 10);
});

void test("TIMEOUT_SCALE: the module reads the variable once, when it loads", async () => {
  assert.equal((await loadWithScale(undefined)).TIMEOUT_SCALE, 1);
  assert.equal((await loadWithScale("4")).TIMEOUT_SCALE, 4);
  assert.equal((await loadWithScale("abc")).TIMEOUT_SCALE, 1);
  assert.equal((await loadWithScale("99")).TIMEOUT_SCALE, 10);
  assert.equal((await loadWithScale("0.2")).TIMEOUT_SCALE, 1);
});

void test("scaledMs and testTimeout: the bound is the milliseconds times the scale, rounded up", async () => {
  assert.equal(scaledMs(100), Math.ceil(100 * timing.TIMEOUT_SCALE));
  assert.deepEqual(testTimeout(250), { timeout: scaledMs(250) });

  const unscaled = await loadWithScale("1");
  assert.equal(unscaled.scaledMs(100), 100);
  assert.deepEqual(unscaled.testTimeout(250), { timeout: 250 });

  const scaled = await loadWithScale("2.5");
  assert.equal(scaled.scaledMs(3), 8);
  assert.equal(scaled.scaledMs(100), 250);
  assert.deepEqual(scaled.testTimeout(10), { timeout: 25 });
});

void test("boundedWait: resolves with the work's value and clears its timer", async (t) => {
  const watchedMs = scaledMs(12_345);
  const armed = recordTimers(t, watchedMs);

  assert.equal(await boundedWait(Promise.resolve("done"), "the work", 12_345), "done");

  assert.equal(armed.length, 1);
  const timer = armed[0];
  assert.ok(timer !== undefined);
  assert.equal(timer.cleared, true, "the bound timer must be cleared once the work settles");
});

void test("boundedWait: a rejection of the work passes through and still clears the timer", async (t) => {
  const armed = recordTimers(t, scaledMs(12_346));

  await assert.rejects(boundedWait(Promise.reject(new Error("work failed")), "the work", 12_346), { message: "work failed" });

  assert.equal(armed.length, 1);
  assert.equal(armed.every((entry) => entry.cleared), true);
});

void test("boundedWait: work that never settles rejects with the exact message at the scaled bound", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    t.mock.timers.reset();
  });

  const outcome = assert.rejects(boundedWait(neverSettles<string>(), "the hung call", 100), {
    message: `the hung call did not settle within ${String(scaledMs(100))} ms`,
  });
  t.mock.timers.tick(scaledMs(100) - 1);
  t.mock.timers.tick(1);
  await outcome;
});

void test("boundedWait: the default bound is 5000 ms, scaled", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    t.mock.timers.reset();
  });

  const outcome = assert.rejects(boundedWait(neverSettles<undefined>(), "the hung call"), {
    message: `the hung call did not settle within ${String(scaledMs(5000))} ms`,
  });
  t.mock.timers.tick(scaledMs(5000));
  await outcome;
});

void test("pollUntil: resolves once the predicate holds, and checks an async predicate", async () => {
  let checks = 0;
  await pollUntil(
    () => {
      checks += 1;
      return checks >= 3;
    },
    "the counter",
    { intervalMs: 1 },
  );
  assert.equal(checks, 3);

  let asyncChecks = 0;
  await pollUntil(
    () => {
      asyncChecks += 1;
      return Promise.resolve(asyncChecks >= 3);
    },
    "the async counter",
    { intervalMs: 1 },
  );
  assert.equal(asyncChecks, 3);
});

void test("pollUntil: a predicate that is already true needs one check and arms no timer", async (t) => {
  const timers = t.mock.method(globalThis, "setTimeout");
  let checks = 0;
  await pollUntil(() => {
    checks += 1;
    return true;
  }, "the ready state");
  assert.equal(checks, 1);
  assert.equal(timers.mock.callCount(), 0);
});

void test("pollUntil: a predicate that never holds rejects at the scaled deadline", async () => {
  let checks = 0;
  await assert.rejects(
    pollUntil(
      () => {
        checks += 1;
        return false;
      },
      "the never state",
      { timeoutMs: 30, intervalMs: 5 },
    ),
    { message: `the never state did not hold within ${String(scaledMs(30))} ms` },
  );
  assert.ok(checks >= 1, "the predicate is checked at least once");
});

void test("pollUntil: an async check that never settles rejects at the deadline instead of hanging", async () => {
  let checks = 0;
  await assert.rejects(
    pollUntil(
      () => {
        checks += 1;
        return neverSettles<boolean>();
      },
      "the stalled check",
      { timeoutMs: 30, intervalMs: 1 },
    ),
    { message: `the stalled check did not hold within ${String(scaledMs(30))} ms` },
  );
  assert.equal(checks, 1, "the stalled check ends the poll; no second check starts");
});

void test("pollUntil: a never-settling check still rejects when nothing else keeps the process alive", () => {
  // In this process the test runner keeps the event loop alive, so a deadline timer that was unref'd would go unnoticed here
  // and fail only on another runner. A fresh process with no other handle shows whether the timer alone ends the wait: with an
  // unref'd timer it exits with "unsettled top-level await" (status 13) before printing.
  const helper = new URL("./timing.js", import.meta.url).href;
  const script = [
    `import { pollUntil } from ${JSON.stringify(helper)};`,
    "try {",
    '  await pollUntil(() => new Promise(() => {}), "the stalled check", { timeoutMs: 100 });',
    '  console.log("RESOLVED");',
    "} catch (error) {",
    '  console.log("REJECTED " + error.message);',
    "}",
  ].join("\n");

  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    timeout: scaledMs(20_000),
    env: { ...process.env, [TIMEOUT_SCALE_VARIABLE]: "1" },
  });

  assert.equal(child.status, 0, `the child exited ${String(child.status)}: ${child.stderr}`);
  assert.match(child.stdout, /^REJECTED the stalled check did not hold within 100 ms/);
});

void test("pollUntil: an async check that answers true only after the deadline does not succeed", async () => {
  let answer: (held: boolean) => void = () => undefined;
  const late = new Promise<boolean>((resolve) => {
    answer = resolve;
  });
  let checks = 0;
  const outcome = assert.rejects(
    pollUntil(
      () => {
        checks += 1;
        return late;
      },
      "the late check",
      { timeoutMs: 30, intervalMs: 1 },
    ),
    { message: `the late check did not hold within ${String(scaledMs(30))} ms` },
  );
  await outcome;
  answer(true);
  assert.equal(checks, 1);
});

void test("pollUntil: a predicate that throws rejects with that error", async () => {
  await assert.rejects(
    pollUntil(
      () => {
        throw new Error("predicate failed");
      },
      "the broken state",
      { intervalMs: 1 },
    ),
    { message: "predicate failed" },
  );
});

void test("ManualClock: starts at 0 or at the given value and moves only when advanced", () => {
  const clock = new ManualClock();
  assert.equal(clock.now(), 0);
  clock.advance(250);
  assert.equal(clock.now(), 250);
  clock.advance(0);
  assert.equal(clock.now(), 250);

  const started = new ManualClock(1000);
  assert.equal(started.now(), 1000);
  started.advance(1);
  started.advance(4);
  assert.equal(started.now(), 1005);
});

void test("ManualClock: now can be passed on as a bare function", () => {
  const clock = new ManualClock(10);
  const read: () => number = clock.now;
  clock.advance(5);
  assert.equal(read(), 15);
});
