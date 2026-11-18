import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter } from "../../src/capability/limiter.js";

// The bound on capability audit lines (CAPT-07, D-32-10): 60 in a burst, one more per second, over an injected clock.

function drain(limiter: { take(): boolean }): number {
  let taken = 0;
  while (limiter.take() && taken < 1000) {
    taken += 1;
  }
  return taken;
}

void test("CAPT-07: a burst takes 60 lines and the 61st is refused", () => {
  const clock = { ms: 5_000 };
  const limiter = createLimiter(() => clock.ms);
  assert.equal(drain(limiter), 60);
  assert.equal(limiter.take(), false);
});

void test("CAPT-07: the bucket refills one line per second, exactly at the boundary millisecond", () => {
  const clock = { ms: 0 };
  const limiter = createLimiter(() => clock.ms);
  assert.equal(drain(limiter), 60);
  clock.ms = 999;
  assert.equal(limiter.take(), false, "999 ms is not yet one line");
  clock.ms = 1000;
  assert.equal(limiter.take(), true, "1000 ms is one line");
  assert.equal(limiter.take(), false);
  clock.ms = 3500;
  assert.equal(drain(limiter), 2, "2500 ms more is two whole lines");
});

void test("CAPT-07: an idle bucket never holds more than its capacity", () => {
  const clock = { ms: 0 };
  const limiter = createLimiter(() => clock.ms);
  assert.equal(limiter.take(), true);
  clock.ms = 10 * 60 * 60 * 1000;
  assert.equal(drain(limiter), 60);
});

void test("CAPT-07: a clock that moves backwards adds no credit and does not credit the same interval twice", () => {
  const clock = { ms: 10_000 };
  const limiter = createLimiter(() => clock.ms);
  assert.equal(drain(limiter), 60);
  clock.ms = 5_000;
  assert.equal(limiter.take(), false, "a clock that moved back gives nothing");
  clock.ms = 10_999;
  assert.equal(limiter.take(), false, "the interval before the earlier reading is not credited again");
  clock.ms = 11_000;
  assert.equal(limiter.take(), true);
});

void test("CAPT-07: a clock that stands still adds no credit", () => {
  const clock = { ms: 42 };
  const limiter = createLimiter(() => clock.ms);
  assert.equal(drain(limiter), 60);
  assert.equal(drain(limiter), 0);
});
