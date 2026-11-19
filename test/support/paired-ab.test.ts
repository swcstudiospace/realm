// The always-running hermetic test of test/support/paired-ab.ts (Phase 44, OMPR-06; 44-CONTEXT D-44-07): every constant and every row of
// the frozen paired decision rule, before any paired run exists. Pure functions, no process, no clock, no file, no host.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ArmRun,
  decidePairs,
  GAIN_MEDIAN_SHARE,
  GAIN_MIN_MS,
  GAIN_PAIR_FRACTION,
  MAX_PAIR_ATTEMPTS,
  MIN_VALID_PAIRS,
  PAIR_ANSWER_TIMEOUT_MS,
  PAIR_LOAD_CEILING_PER_CPU,
  PAIR_LOAD_GAP_PER_CPU,
  PAIRED_LABEL,
  type PairInput,
  pairValid,
  parseSamplesCsv,
  REGRESS_PAIR_FRACTION,
  REPRODUCTION_MIN_MS,
  runMetrics,
  SERVING_CONTROL_WINDOW_MS,
  STALL_TOLERANCE_MS,
} from "./paired-ab.js";
import { PROBE_INTERVAL_MS, type ProbeSample, samplesCsv, samplesCsvWithPhase } from "./responsiveness.js";

// ---- Fixtures --------------------------------------------------------------------------------------------------------------------

// A probe every 250 ms from `from` to `to` inclusive, each answered after latency(sentAtMs) ms, or never when it returns undefined.
function ladder(from: number, to: number, latency: (sentAtMs: number) => number | undefined): ProbeSample[] {
  const samples: ProbeSample[] = [];
  for (let sentAtMs = from; sentAtMs <= to; sentAtMs += PROBE_INTERVAL_MS) {
    samples.push({ sentAtMs, latencyMs: latency(sentAtMs) });
  }
  return samples;
}

// The recorded shape of attempt 1 (E-44-02, E-44-03, E-44-04), rebuilt on a 250 ms grid: ready at 11 320 ms, the probes sent from 2500 ms
// answered together at 12 498 ms, then a stall that ends at about 13 900 ms (1403 ms for the probe sent at 12 500 ms).
const ATTEMPT_ONE_COLD: ProbeSample[] = [
  ...ladder(0, 2250, () => undefined),
  ...ladder(2500, 12_250, (t) => 12_498 - t),
  ...ladder(12_500, 37_500, (t) => (t <= 13_750 ? 13_903 - t : 14)),
];
// The control of the same attempt: ready at 8999 ms, first answer at 9394 ms (the probe sent at 9000 ms), then 20 ms answers.
const ATTEMPT_ONE_CONTROL: ProbeSample[] = [...ladder(0, 8750, () => undefined), { sentAtMs: 9000, latencyMs: 394 }, ...ladder(9500, 20_000, () => 20)];

// A synthetic run with the given X and S: the control is ready at 1000 and first answers at 1100 with a serving latency of 10 ms; the
// cold run is ready at 1000 and first answers at 1100 plus x, then one probe at the first answer with a latency of s plus 10 ms.
function syntheticArm(x: number, s: number, startLoadPerCpu = 0.5, mechanicsHeld = true): ArmRun {
  return {
    control: { samples: [{ sentAtMs: 1000, latencyMs: 100 }, { sentAtMs: 1200, latencyMs: 10 }], readyMs: 1000 },
    cold: { samples: [{ sentAtMs: 1000, latencyMs: 100 + x }, { sentAtMs: 1100 + x, latencyMs: s + 10 }], readyMs: 1000 },
    startLoadPerCpu,
    mechanicsHeld,
  };
}

function pair(pairNumber: number, before: ArmRun, after: ArmRun): PairInput {
  return { pair: pairNumber, before, after };
}

// A window from per-pair X and S lists, every pair valid.
function window(beforeX: readonly number[], afterX: readonly number[], beforeS?: readonly number[], afterS?: readonly number[]): PairInput[] {
  return beforeX.map((x, index) => pair(index + 1, syntheticArm(x, beforeS?.[index] ?? 0), syntheticArm(afterX[index] ?? 0, afterS?.[index] ?? 0)));
}

// ---- The constants ---------------------------------------------------------------------------------------------------------------

void test("OMPR-06 the constants are the frozen values of D-44-07", () => {
  assert.deepEqual(
    [MIN_VALID_PAIRS, MAX_PAIR_ATTEMPTS, PAIR_LOAD_CEILING_PER_CPU, PAIR_LOAD_GAP_PER_CPU, SERVING_CONTROL_WINDOW_MS, REPRODUCTION_MIN_MS, GAIN_MIN_MS, GAIN_PAIR_FRACTION, GAIN_MEDIAN_SHARE, STALL_TOLERANCE_MS, REGRESS_PAIR_FRACTION],
    [5, 10, 2.0, 0.5, 5000, 250, 250, 0.8, 0.5, 250, 0.2],
  );
  assert.equal(PAIR_ANSWER_TIMEOUT_MS, 10_000, "the answer timeout of the harness probe");
  assert.equal(PAIRED_LABEL, "loaded, paired");
});

// ---- parseSamplesCsv -------------------------------------------------------------------------------------------------------------

void test("OMPR-06 parseSamplesCsv is the inverse of samplesCsv and of samplesCsvWithPhase", () => {
  const samples: ProbeSample[] = [
    { sentAtMs: 0, latencyMs: undefined },
    { sentAtMs: 250, latencyMs: 9998 },
    { sentAtMs: 500, latencyMs: 0 },
    { sentAtMs: 750, latencyMs: undefined },
    { sentAtMs: 1000, latencyMs: 14 },
  ];
  assert.deepEqual(parseSamplesCsv(samplesCsv(samples)), samples);
  assert.deepEqual(parseSamplesCsv(samplesCsvWithPhase(samples, 600)), samples);
  assert.deepEqual(parseSamplesCsv(samplesCsv([])), []);
});

void test("OMPR-06 parseSamplesCsv refuses a malformed header or line", () => {
  assert.throws(() => parseSamplesCsv("sent,latency\n0,1\n"), /header/);
  assert.throws(() => parseSamplesCsv(""), /header/);
  assert.throws(() => parseSamplesCsv("sentAtMs,latencyMs\nx,1\n"), /malformed samples line 2/);
  assert.throws(() => parseSamplesCsv("sentAtMs,latencyMs\n0,-1\n"), /malformed samples line 2/);
  assert.throws(() => parseSamplesCsv("sentAtMs,latencyMs\n0\n"), /malformed samples line 2/);
  assert.throws(() => parseSamplesCsv("sentAtMs,latencyMs\n0,1,boot\n"), /malformed samples line 2/);
  assert.throws(() => parseSamplesCsv("sentAtMs,latencyMs,phase\n0,1\n"), /malformed samples line 2/);
  assert.throws(() => parseSamplesCsv("sentAtMs,latencyMs,phase\n0,1,later\n"), /malformed samples line 2/);
  assert.throws(() => parseSamplesCsv("sentAtMs,latencyMs\n0,1\n\n1,1\n"), /malformed samples line 3/);
});

// ---- runMetrics ------------------------------------------------------------------------------------------------------------------

void test("OMPR-06 runMetrics on the recorded shape of attempt 1 gives X 3104, X1 2321, X2 783", () => {
  const result = runMetrics({ samples: ATTEMPT_ONE_CONTROL, readyMs: 8999 }, { samples: ATTEMPT_ONE_COLD, readyMs: 11_320 });
  assert.equal(result.valid, true);
  assert.ok(result.valid);
  assert.equal(result.metrics.x, 3104);
  assert.equal(result.metrics.x1, 2321);
  assert.equal(result.metrics.x2, 783);
  // The cold stall after the first answer: 1403 ms at 12 500 ms; the control's serving window holds 20 ms answers.
  assert.equal(result.metrics.s, 1403 - 20);
});

void test("OMPR-06 X equals X1 plus X2 on every fixture", () => {
  const fixtures: [number, number, number, number][] = [
    [8999, 11_320, 100, 200],
    [10_121, 10_076, 400, 100],
    [13_011, 9000, 0, 3000],
    [0, 0, 50, 50],
  ];
  for (const [controlReady, coldReady, controlLag, coldLag] of fixtures) {
    const control = { samples: [{ sentAtMs: controlReady, latencyMs: controlLag }], readyMs: controlReady };
    const cold = { samples: [{ sentAtMs: coldReady, latencyMs: coldLag }], readyMs: coldReady };
    const result = runMetrics(control, cold);
    assert.ok(result.valid);
    assert.equal(result.metrics.x, result.metrics.x1 + result.metrics.x2);
  }
});

void test("OMPR-06 runMetrics reports a run without a first answer or a ready time as invalid, with no metrics", () => {
  const answered = { samples: [{ sentAtMs: 0, latencyMs: 10 }], readyMs: 0 };
  const silent = { samples: [{ sentAtMs: 0, latencyMs: undefined }], readyMs: 0 };
  assert.deepEqual(runMetrics(silent, answered), { valid: false, reason: "the control has no first answer" });
  assert.deepEqual(runMetrics(answered, silent), { valid: false, reason: "the cold run has no first answer" });
  assert.deepEqual(runMetrics({ ...answered, readyMs: undefined }, answered), { valid: false, reason: "the control has no ready time" });
  assert.deepEqual(runMetrics(answered, { ...answered, readyMs: undefined }), { valid: false, reason: "the cold run has no ready time" });
});

void test("OMPR-06 S: an unanswered cold probe after the first answer counts as the timeout, the control window is bounded, S is never below 0", () => {
  const control = {
    samples: [
      { sentAtMs: 1000, latencyMs: 100 },
      // Inside the serving window (first answer 1100, window to 6100 inclusive): 300 ms.
      { sentAtMs: 6100, latencyMs: 300 },
      // Past the window: ignored.
      { sentAtMs: 6101, latencyMs: 9000 },
    ],
    readyMs: 1000,
  };
  const cold = {
    samples: [
      { sentAtMs: 1000, latencyMs: 100 },
      { sentAtMs: 1100, latencyMs: undefined },
    ],
    readyMs: 1000,
  };
  const stalled = runMetrics(control, cold);
  assert.ok(stalled.valid);
  assert.equal(stalled.metrics.s, PAIR_ANSWER_TIMEOUT_MS - 300);
  const calm = runMetrics(control, { samples: [{ sentAtMs: 1000, latencyMs: 100 }, { sentAtMs: 1100, latencyMs: 5 }], readyMs: 1000 });
  assert.ok(calm.valid);
  assert.equal(calm.metrics.s, 0, "a cold stall smaller than the control's is not negative");
  // A probe sent before the cold first answer does not count even if it is slow.
  const early = runMetrics(control, { samples: [{ sentAtMs: 0, latencyMs: 1100 }, { sentAtMs: 1100, latencyMs: 20 }], readyMs: 1000 });
  assert.ok(early.valid);
  assert.equal(early.metrics.s, 0);
});

// ---- pairValid -------------------------------------------------------------------------------------------------------------------

void test("OMPR-06 pairValid: each of the four failures is its own case, with its reason", () => {
  const good = syntheticArm(1000, 0);
  assert.equal(pairValid(pair(1, good, good)).valid, true);
  const bad = pairValid(pair(1, syntheticArm(1000, 0, 0.5, false), good));
  assert.deepEqual(bad, { valid: false, reason: "the before run is not valid: the mechanics did not hold" });
  const silent: ArmRun = { ...good, control: { samples: [{ sentAtMs: 0, latencyMs: undefined }], readyMs: 0 } };
  assert.deepEqual(pairValid(pair(1, good, silent)), { valid: false, reason: "the after run is not valid: the control has no first answer" });
  const loaded = pairValid(pair(1, syntheticArm(1000, 0, 2.5), syntheticArm(1000, 0, 2.2)));
  assert.equal(loaded.valid, false);
  assert.ok(!loaded.valid);
  assert.match(loaded.reason, /before run started at 2\.5 load per cpu, above 2/);
  const loadedAfter = pairValid(pair(1, syntheticArm(1000, 0, 1.9), syntheticArm(1000, 0, 2.2)));
  assert.ok(!loadedAfter.valid);
  assert.match(loadedAfter.reason, /after run started at 2\.2 load per cpu, above 2/);
  const apart = pairValid(pair(1, syntheticArm(1000, 0, 0.1), syntheticArm(1000, 0, 1.2)));
  assert.ok(!apart.valid);
  assert.match(apart.reason, /start loads differ by 1\.10 load per cpu, more than 0\.5/);
});

void test("OMPR-06 pairValid: the load boundaries, 2.0 valid and 2.01 not, a gap of 0.5 valid and 0.51 not", () => {
  assert.equal(pairValid(pair(1, syntheticArm(1000, 0, 2.0), syntheticArm(1000, 0, 2.0))).valid, true);
  assert.equal(pairValid(pair(1, syntheticArm(1000, 0, 2.01), syntheticArm(1000, 0, 2.0))).valid, false);
  assert.equal(pairValid(pair(1, syntheticArm(1000, 0, 1.5), syntheticArm(1000, 0, 1.0))).valid, true);
  assert.equal(pairValid(pair(1, syntheticArm(1000, 0, 1.51), syntheticArm(1000, 0, 1.0))).valid, false);
});

// ---- decidePairs: one test per row, in the order of the table --------------------------------------------------------------------

void test("OMPR-06 decidePairs VOID: four valid pairs are not enough; invalid pairs are listed and never counted", () => {
  const four = window([1000, 1000, 1000, 1000], [0, 0, 0, 0]);
  const decision = decidePairs(four);
  assert.equal(decision.outcome, "VOID");
  assert.equal(decision.validPairs, 4);
  // A fifth pair that is invalid (loaded) does not make five.
  const withInvalid = decidePairs([...four, pair(5, syntheticArm(1000, 0, 3.0), syntheticArm(0, 0))]);
  assert.equal(withInvalid.outcome, "VOID");
  assert.equal(withInvalid.validPairs, 4);
  assert.equal(withInvalid.invalid.length, 1);
  assert.deepEqual(withInvalid.invalid.map((entry) => entry.pair), [5]);
  assert.match(withInvalid.invalid.map((entry) => entry.reason).join("; "), /load per cpu/);
  const none = decidePairs([]);
  assert.equal(none.outcome, "VOID");
  assert.equal(none.medians, null);
});

void test("OMPR-06 decidePairs refuses more than the maximum pair attempts", () => {
  const eleven = window(Array.from({ length: 11 }, () => 1000), Array.from({ length: 11 }, () => 0));
  assert.throws(() => decidePairs(eleven), /at most 10 pair attempts/);
  assert.doesNotThrow(() => decidePairs(eleven.slice(0, 10)));
});

void test("OMPR-06 decidePairs NOT-REPRODUCED: the BEFORE median at 250 does not reproduce, at 251 it does", () => {
  const flat = decidePairs(window([250, 250, 250, 250, 250], [0, 0, 0, 0, 0]));
  assert.equal(flat.outcome, "NOT-REPRODUCED");
  const reproduced = decidePairs(window([251, 251, 251, 251, 251], [0, 0, 0, 0, 0]));
  assert.equal(reproduced.outcome, "EFFECT");
});

void test("OMPR-06 decidePairs REGRESSION, condition 1: the median X(after) exceeds mB by more than 250", () => {
  const regress = decidePairs(window([1000, 1000, 1000, 1000, 1000], [1251, 1251, 1251, 1251, 1251]));
  assert.equal(regress.outcome, "REGRESSION");
  assert.match(regress.reason, /1251/);
  const edge = decidePairs(window([1000, 1000, 1000, 1000, 1000], [1250, 1250, 1250, 1250, 1250]));
  assert.equal(edge.outcome, "NO-EFFECT", "exactly 250 above is not a regression");
});

void test("OMPR-06 decidePairs REGRESSION, condition 2: the median S(after) exceeds the median S(before) by more than 250", () => {
  // Medians 100 and 400; the pair differences are +400, then -100 four times: one worse pair, which the pair condition allows for N of 5.
  const sBefore = [0, 100, 100, 500, 500];
  const sAfter = [400, 0, 0, 400, 400];
  const x = [1000, 1000, 1000, 1000, 1000];
  const decision = decidePairs(window(x, [500, 500, 500, 500, 500], sBefore, sAfter));
  assert.equal(decision.outcome, "REGRESSION");
  assert.match(decision.reason, /median serving stall/);
  // The same shape with the shift at 250 is not a regression.
  const edge = decidePairs(window(x, [500, 500, 500, 500, 500], sBefore, [350, 0, 0, 350, 350]));
  assert.equal(edge.outcome, "EFFECT");
});

void test("OMPR-06 decidePairs REGRESSION, condition 3: more than floor(0.2 N) pairs have S(after) worse by more than 250", () => {
  const x = [1000, 1000, 1000, 1000, 1000];
  const half = [500, 500, 500, 500, 500];
  // N of 5: the floor of one fifth is 1, so two worse pairs regress and one does not.
  const two = decidePairs(window(x, half, [0, 0, 0, 0, 0], [251, 251, 0, 0, 0]));
  assert.equal(two.outcome, "REGRESSION");
  assert.match(two.reason, /2 of 5 pairs/);
  const one = decidePairs(window(x, half, [0, 0, 0, 0, 0], [251, 0, 0, 0, 0]));
  assert.equal(one.outcome, "EFFECT");
  const exactly = decidePairs(window(x, half, [0, 0, 0, 0, 0], [250, 250, 0, 0, 0]));
  assert.equal(exactly.outcome, "EFFECT", "a stall worse by exactly 250 is within the tolerance");
});

void test("OMPR-06 decidePairs EFFECT: exactly the fraction needed, and not with one pair fewer", () => {
  const before = [500, 500, 500, 500, 500];
  // Four of five pairs gain exactly 250; the median gain 250 is exactly half of mB 500.
  const four = decidePairs(window(before, [250, 250, 250, 250, 500]));
  assert.equal(four.outcome, "EFFECT");
  assert.equal(four.validPairs, 5);
  const three = decidePairs(window(before, [250, 250, 250, 500, 500]));
  assert.equal(three.outcome, "NO-EFFECT");
});

void test("OMPR-06 decidePairs NO-EFFECT: mB reproduced and the gains fall short of half of mB", () => {
  // Four of five pairs gain 250, but mB is 600 and half of it is 300.
  const short = decidePairs(window([600, 600, 600, 600, 600], [350, 350, 350, 350, 600]));
  assert.equal(short.outcome, "NO-EFFECT");
  assert.match(short.reason, /4 of 5 pairs gained at least 250 ms/);
});

void test("OMPR-06 decidePairs precedence: NOT-REPRODUCED beats EFFECT, REGRESSION beats EFFECT", () => {
  // Every pair gains 250 (EFFECT-shaped) but mB is 250.
  assert.equal(decidePairs(window([250, 250, 250, 250, 250], [0, 0, 0, 0, 0])).outcome, "NOT-REPRODUCED");
  // Every pair gains 500 (EFFECT-shaped) but two pairs stall worse by 300.
  assert.equal(decidePairs(window([1000, 1000, 1000, 1000, 1000], [500, 500, 500, 500, 500], [0, 0, 0, 0, 0], [300, 300, 0, 0, 0])).outcome, "REGRESSION");
});

void test("OMPR-06 decidePairs medians: odd and even N", () => {
  const odd = decidePairs(window([900, 300, 500, 700, 1100], [0, 0, 0, 0, 0]));
  assert.equal(odd.medians?.before.x, 700);
  // N of 6: the median is the mean of the two middle values, 251 here, so the excess is reproduced.
  const even = decidePairs(window([250, 250, 250, 252, 252, 252], [0, 0, 0, 0, 0, 0]));
  assert.equal(even.medians?.before.x, 251);
  assert.equal(even.outcome, "EFFECT");
  // N of 6: ceil(0.8 * 6) = 5 pairs must gain; four do not, five do.
  const before = [600, 600, 600, 600, 600, 600];
  assert.equal(decidePairs(window(before, [300, 300, 300, 300, 600, 600])).outcome, "NO-EFFECT");
  assert.equal(decidePairs(window(before, [300, 300, 300, 300, 300, 600])).outcome, "EFFECT");
});

void test("OMPR-06 decidePairs result: the label, the quiet claim, the table and the descriptive medians", () => {
  const decision = decidePairs(window([1000, 1000, 1000, 1000, 1000], [400, 400, 400, 400, 400], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]));
  assert.equal(decision.label, "loaded, paired");
  assert.equal(decision.quietClaim, false);
  assert.equal(decision.rows.length, 5);
  assert.deepEqual(decision.rows[0], { pair: 1, before: { x: 1000, x1: 0, x2: 1000, s: 0 }, after: { x: 400, x1: 0, x2: 400, s: 0 }, gainMs: 600, stallChangeMs: 0 });
  assert.deepEqual(decision.medians, { before: { x: 1000, x1: 0, x2: 1000, s: 0 }, after: { x: 400, x1: 0, x2: 400, s: 0 } });
  const void_ = decidePairs(window([1000], [0]));
  assert.equal(void_.label, "loaded, paired");
  assert.equal(void_.quietClaim, false);
});
