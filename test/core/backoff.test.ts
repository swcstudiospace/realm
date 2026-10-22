import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { computeBackoffDelayMs } from "../../src/core/backoff.js";

// Anda reconnect schedule (D-62) and AgentOS restart schedule (D-59).
const ANDA = { base: 500, cap: 30_000 } as const;
const AGENTOS = { base: 500, cap: 8_000 } as const;

// Deterministic pseudo-random draws in [0, 1), so the spread test is reproducible.
function seededDraws(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

void test("ANDA-03, RT-04: a zero random draw gives zero delay at every attempt", () => {
  for (let attempt = 0; attempt <= 40; attempt += 1) {
    assert.equal(computeBackoffDelayMs(attempt, AGENTOS.base, AGENTOS.cap, () => 0), 0);
    assert.equal(computeBackoffDelayMs(attempt, ANDA.base, ANDA.cap, () => 0), 0);
  }
});

void test("ANDA-03, RT-04: a draw of 1 gives the exponential ceiling, clamped at the cap", () => {
  const top = () => 1;
  // AgentOS: 500, 1000, 2000, 4000, 8000 (cap reached), then 8000 for every later attempt.
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6].map((attempt) => computeBackoffDelayMs(attempt, AGENTOS.base, AGENTOS.cap, top)),
    [500, 1000, 2000, 4000, 8000, 8000, 8000],
  );
  // Anda: 500 doubling up to the 30000 cap, which first applies at attempt 6 (32000 > 30000).
  assert.equal(computeBackoffDelayMs(5, ANDA.base, ANDA.cap, top), 16_000);
  assert.equal(computeBackoffDelayMs(6, ANDA.base, ANDA.cap, top), 30_000);
});

void test("ANDA-03, RT-04: a draw of one half gives half the ceiling, so the jitter is proportional", () => {
  const half = () => 0.5;
  assert.equal(computeBackoffDelayMs(0, ANDA.base, ANDA.cap, half), 250);
  assert.equal(computeBackoffDelayMs(3, AGENTOS.base, AGENTOS.cap, half), 2_000);
  assert.equal(computeBackoffDelayMs(4, AGENTOS.base, AGENTOS.cap, half), 4_000);
});

void test("ANDA-03, RT-04: every delay lies in [0, min(cap, base * 2^attempt)] under full jitter", () => {
  const draws = seededDraws(20_261_021);
  for (const { base, cap } of [ANDA, AGENTOS]) {
    for (let attempt = 0; attempt <= 60; attempt += 1) {
      const ceiling = Math.min(cap, base * 2 ** attempt);
      for (let i = 0; i < 50; i += 1) {
        const delay = computeBackoffDelayMs(attempt, base, cap, draws);
        assert.ok(delay >= 0, `delay ${String(delay)} went negative at attempt ${String(attempt)}`);
        assert.ok(delay <= ceiling, `delay ${String(delay)} exceeded ceiling ${String(ceiling)} at attempt ${String(attempt)}`);
      }
    }
  }
});

void test("ANDA-03, RT-04: delays never exceed the cap across many attempts and draws, including the endpoints", () => {
  const draws = seededDraws(7);
  const sources: Array<() => number> = [draws, () => 0, () => 1];
  for (const random of sources) {
    for (let attempt = 0; attempt <= 1_000; attempt += 1) {
      const delay = computeBackoffDelayMs(attempt, AGENTOS.base, AGENTOS.cap, random);
      assert.ok(Number.isFinite(delay), `delay must be finite at attempt ${String(attempt)}`);
      assert.ok(delay >= 0 && delay <= AGENTOS.cap, `delay ${String(delay)} outside [0, ${String(AGENTOS.cap)}] at attempt ${String(attempt)}`);
    }
  }
});

void test("ANDA-03, RT-04: an overflowing attempt clamps at the cap and a zero base never yields NaN", () => {
  const top = () => 1;
  assert.equal(computeBackoffDelayMs(10_000, ANDA.base, ANDA.cap, top), ANDA.cap);
  assert.equal(computeBackoffDelayMs(2_000_000, AGENTOS.base, AGENTOS.cap, top), AGENTOS.cap);
  assert.equal(computeBackoffDelayMs(10_000, 0, AGENTOS.cap, top), 0);
  assert.equal(computeBackoffDelayMs(10_000, 0, AGENTOS.cap, () => 0.5), 0);
});

void test("ANDA-03, RT-04: the random source is called exactly once per delay", () => {
  let calls = 0;
  const counting = () => {
    calls += 1;
    return 0.25;
  };
  computeBackoffDelayMs(3, AGENTOS.base, AGENTOS.cap, counting);
  computeBackoffDelayMs(0, ANDA.base, ANDA.cap, counting);
  assert.equal(calls, 2);
});

void test("ANDA-03, RT-04: a negative or fractional attempt is rejected, never turned into a delay", () => {
  const top = () => 1;
  for (const attempt of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => computeBackoffDelayMs(attempt, AGENTOS.base, AGENTOS.cap, top), RangeError, `attempt ${String(attempt)}`);
  }
});

void test("ANDA-03, RT-04: a base or cap that is negative or not finite is rejected", () => {
  const top = () => 1;
  assert.throws(() => computeBackoffDelayMs(1, -1, AGENTOS.cap, top), RangeError);
  assert.throws(() => computeBackoffDelayMs(1, Number.NaN, AGENTOS.cap, top), RangeError);
  assert.throws(() => computeBackoffDelayMs(1, AGENTOS.base, -1, top), RangeError);
  assert.throws(() => computeBackoffDelayMs(1, AGENTOS.base, Number.POSITIVE_INFINITY, top), RangeError);
});

void test("ANDA-03, RT-04: a random source outside [0, 1] or not a number is rejected", () => {
  for (const bad of [-0.1, 1.5, Number.NaN]) {
    assert.throws(
      () => computeBackoffDelayMs(1, AGENTOS.base, AGENTOS.cap, () => bad),
      RangeError,
      `draw ${String(bad)}`,
    );
  }
});

void test("ANDA-03, RT-04: loading backoff.ts in a fresh process prints nothing and exits 0", () => {
  const url = new URL("../../src/core/backoff.js", import.meta.url).href;
  const probe = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url)});`], {
    encoding: "utf8",
  });
  assert.equal(probe.status, 0, "importing backoff.ts must succeed on its own");
  assert.equal(probe.stdout, "", "importing backoff.ts must not write to stdout");
  assert.equal(probe.stderr, "", "importing backoff.ts must not write to stderr");
});
