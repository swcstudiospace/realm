// The always-running hermetic test of test/support/omp-verdict.ts (Phase 45, OMPV-03, OMPV-04 and OMPV-05; 45-CONTEXT D-45-06 to D-45-09):
// every constant, every validity rule with its boundary, the derivation of the calibrated bounds, the order rule, the cause table and
// every row of the verdict table, before any live run exists. Pure functions: no process, no clock, no file, no host.

import assert from "node:assert/strict";
import { test } from "node:test";
import { type StallCause, type StallSet, type WindowObservation } from "./omp-contention.js";
import {
  BOUND_ROUND_MS,
  type Arm,
  type Bounds,
  CALIBRATION_MAX_ATTEMPTS,
  CALIBRATION_MIN_PASSING,
  CALIBRATION_TARGET_RUNS,
  type CalibrationControl,
  causeOfRun,
  CONTENTION_QUANTILE,
  CONTROL_BOUND_CAP_FACTOR,
  CONTROL_BOUND_QUANTILE,
  controlFirst,
  decideVerdict,
  deriveBounds,
  FINDING_MIN_BREACH_RUNS,
  mechanicalValidity,
  MIN_VERDICT_RUNS,
  nearestRankOf,
  type RunCause,
  type RunObservation,
  runIndexOf,
  runValidity,
  TIER_SCOPED,
  TIER_UNSCOPED,
  type Tier,
  type ValidityInput,
  windowCause,
} from "./omp-verdict.js";
import { type LatencySummary, PROBE_INTERVAL_MS, type ProbeSample, summariseLatencies } from "./responsiveness.js";

// ---- Fixtures --------------------------------------------------------------------------------------------------------------------

// 41 probes 250 ms apart (a window of exactly 10 s) whose 39th latency in ascending order, the nearest-rank 95th percentile, is p95Ms and
// whose largest is maxMs (at least p95Ms); every other probe answers in 20 ms.
function shaped(maxMs: number, p95Ms: number, probes = 41): LatencySummary {
  const samples: ProbeSample[] = [];
  for (let index = 0; index < probes; index += 1) {
    const latencyMs = index === probes - 1 ? maxMs : index >= probes - 3 ? p95Ms : 20;
    samples.push({ sentAtMs: index * PROBE_INTERVAL_MS, latencyMs });
  }
  return summariseLatencies(samples);
}

const GOOD = shaped(20, 20);

const NO_STALL: StallSet = { count: 0, attributedCount: 0, onCpuMs: 0, runqMs: 0, sleepMs: 0, onCpuShare: 0, sleepShare: 0, cause: "none" };

function stallOf(cause: StallCause): StallSet {
  return { count: 3, attributedCount: cause === "unattributed" ? 0 : 3, onCpuMs: 0, runqMs: 0, sleepMs: 0, onCpuShare: 0, sleepShare: 0, cause };
}

function windowOf(overrides: Partial<WindowObservation> = {}): WindowObservation {
  return { raw: GOOD, self: GOOD, scopeStallShare: 0.1, runqShare: 0.1, coverage: 1, probeGapMaxMs: 250, stallSet: NO_STALL, ...overrides };
}

// The four calibrated bounds of the fixtures (the real ones are unset until plan 45-04).
const BOUNDS: Bounds = { stallShareMax: 0.3, runqShareMax: 0.3, controlSelfMaxMs: 1200, controlSelfP95Ms: 600 };

function inputOf(overrides: Partial<ValidityInput> = {}): ValidityInput {
  return { tier: TIER_SCOPED, refusal: null, mechanicsHeld: true, control: windowOf(), cold: windowOf(), ...overrides };
}

function runOf(index: number, overrides: Partial<RunObservation> = {}): RunObservation {
  return { arm: "after", pair: index, runIndex: runIndexOf(index, "after"), tier: TIER_SCOPED, refusal: null, mechanicsHeld: true, control: windowOf(), cold: windowOf(), ...overrides };
}

// A cold window that exceeds the thresholds on its self-inflicted latency, with the given stall cause.
function breachingCold(cause: StallCause): WindowObservation {
  const bad = shaped(1500, 700);
  return windowOf({ raw: bad, self: bad, stallSet: stallOf(cause) });
}

function fiveGood(): RunObservation[] {
  return [1, 2, 3, 4, 5].map((index) => runOf(index));
}

// ---- The constants ---------------------------------------------------------------------------------------------------------------

void test("OMPV-04 the fixed constants are pinned by value", () => {
  assert.deepEqual(
    [MIN_VERDICT_RUNS, CALIBRATION_TARGET_RUNS, CALIBRATION_MAX_ATTEMPTS, CALIBRATION_MIN_PASSING, CONTROL_BOUND_QUANTILE, CONTENTION_QUANTILE, BOUND_ROUND_MS, CONTROL_BOUND_CAP_FACTOR, FINDING_MIN_BREACH_RUNS],
    [5, 12, 16, 5, 0.9, 0.75, 50, 3, 1],
  );
});

void test("OMPV-03 the two tier labels are pinned", () => {
  assert.equal(TIER_SCOPED, "loaded, scoped");
  assert.equal(TIER_UNSCOPED, "loaded, unscoped");
});

// ---- The order rule --------------------------------------------------------------------------------------------------------------

void test("OMPV-04 runIndexOf and controlFirst: pairs 1 to 12, both arms, pinned", () => {
  const table: (readonly [pair: number, before: number, after: number])[] = [
    [1, 1, 2],
    [2, 4, 3],
    [3, 5, 6],
    [4, 8, 7],
    [5, 9, 10],
    [6, 12, 11],
    [7, 13, 14],
    [8, 16, 15],
    [9, 17, 18],
    [10, 20, 19],
    [11, 21, 22],
    [12, 24, 23],
  ];
  for (const [pair, before, after] of table) {
    assert.equal(runIndexOf(pair, "before"), before, `pair ${String(pair)} before`);
    assert.equal(runIndexOf(pair, "after"), after, `pair ${String(pair)} after`);
    assert.equal(controlFirst(before), before % 2 === 1);
    assert.equal(controlFirst(after), after % 2 === 1);
  }
  assert.equal(controlFirst(1), true);
  assert.equal(controlFirst(2), false);
});

void test("OMPV-04 over any four consecutive run indexes each arm has seen control-first and cold-first once", () => {
  for (let start = 1; start <= 21; start += 1) {
    const seen = { before: new Set<boolean>(), after: new Set<boolean>() };
    for (let pair = 1; pair <= 12; pair += 1) {
      for (const arm of ["before", "after"] as const) {
        const index = runIndexOf(pair, arm);
        if (index >= start && index < start + 4) {
          seen[arm].add(controlFirst(index));
        }
      }
    }
    assert.deepEqual([seen.before.size, seen.after.size], [2, 2], `window starting at ${String(start)}`);
  }
});

void test("OMPV-04 runIndexOf and controlFirst refuse an invalid pair, run index or arm", () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => runIndexOf(bad, "before"), /pair number/);
    assert.throws(() => controlFirst(bad), /run index/);
  }
  // A value the type forbids, to show the runtime refusal.
  const sideways = "sideways" as Arm;
  assert.throws(() => runIndexOf(1, sideways), /before or after/);
});

// ---- Run validity ----------------------------------------------------------------------------------------------------------------

void test("OMPV-03 a run with no failing rule is valid", () => {
  assert.deepEqual(mechanicalValidity(inputOf()), { valid: true });
  assert.deepEqual(runValidity(inputOf(), BOUNDS), { valid: true });
});

void test("OMPV-03 V0: a refusal text refuses the run, a lost scope reading refuses it under the scoped tier only", () => {
  const refused = mechanicalValidity(inputOf({ refusal: "scope command failed" }));
  assert.deepEqual(refused, { valid: false, rule: "V0", reason: "refused: scope command failed" });
  const lostScope = mechanicalValidity(inputOf({ cold: windowOf({ scopeStallShare: null }) }));
  assert.ok(!lostScope.valid && lostScope.rule === "V0" && /scope pressure reading of the cold window was lost/.test(lostScope.reason));
  const lostControl = mechanicalValidity(inputOf({ control: windowOf({ scopeStallShare: null }) }));
  assert.ok(!lostControl.valid && lostControl.rule === "V0" && /control window/.test(lostControl.reason));
  assert.deepEqual(mechanicalValidity(inputOf({ tier: TIER_UNSCOPED, cold: windowOf({ scopeStallShare: null }), control: windowOf({ scopeStallShare: null }) })), { valid: true });
  const lostRunq = mechanicalValidity(inputOf({ tier: TIER_UNSCOPED, cold: windowOf({ runqShare: null }) }));
  assert.ok(!lostRunq.valid && lostRunq.rule === "V0" && /run-queue reading/.test(lostRunq.reason));
});

void test("OMPV-03 V1: mechanics that did not hold fail the run, and no lost reading preempts it", () => {
  const failed = mechanicalValidity(inputOf({ mechanicsHeld: false }));
  assert.deepEqual(failed, { valid: false, rule: "V1", reason: "the mechanics of the arm test did not hold" });
  const noWindow = mechanicalValidity(inputOf({ mechanicsHeld: false, cold: windowOf({ scopeStallShare: null, runqShare: null }) }));
  assert.ok(!noWindow.valid && noWindow.rule === "V1");
});

void test("OMPV-03 V2: a probe-driver gap of 750 ms in either window is valid, 751 ms is not", () => {
  assert.equal(mechanicalValidity(inputOf({ cold: windowOf({ probeGapMaxMs: 750 }), control: windowOf({ probeGapMaxMs: 750 }) })).valid, true);
  const cold = mechanicalValidity(inputOf({ cold: windowOf({ probeGapMaxMs: 751 }) }));
  assert.ok(!cold.valid && cold.rule === "V2" && /cold window/.test(cold.reason) && /751 ms/.test(cold.reason));
  const control = mechanicalValidity(inputOf({ control: windowOf({ probeGapMaxMs: 751 }) }));
  assert.ok(!control.valid && control.rule === "V2" && /control window/.test(control.reason));
});

void test("OMPV-03 V5: an attribution coverage of 0.9 is valid, below it is not", () => {
  assert.equal(mechanicalValidity(inputOf({ cold: windowOf({ coverage: 0.9 }) })).valid, true);
  const low = mechanicalValidity(inputOf({ cold: windowOf({ coverage: 0.89 }) }));
  assert.ok(!low.valid && low.rule === "V5" && /0\.89/.test(low.reason));
});

void test("OMPV-03 V5 on a calibration control reads its own window (it has no cold window)", () => {
  assert.equal(mechanicalValidity(inputOf({ cold: null, control: windowOf({ coverage: 0.9 }) })).valid, true);
  const low = mechanicalValidity(inputOf({ cold: null, control: windowOf({ coverage: 0.5 }) }));
  assert.ok(!low.valid && low.rule === "V5");
});

void test("OMPV-03 V3: the scope stall share at its bound is valid and just above it is not, in each window", () => {
  assert.equal(runValidity(inputOf({ cold: windowOf({ scopeStallShare: 0.3 }), control: windowOf({ scopeStallShare: 0.3 }) }), BOUNDS).valid, true);
  const cold = runValidity(inputOf({ cold: windowOf({ scopeStallShare: 0.31 }) }), BOUNDS);
  assert.ok(!cold.valid && cold.rule === "V3" && /scope stall share of the cold window was 0\.31, above 0\.3/.test(cold.reason));
  const control = runValidity(inputOf({ control: windowOf({ scopeStallShare: 0.31 }) }), BOUNDS);
  assert.ok(!control.valid && control.rule === "V3" && /control window/.test(control.reason));
});

void test("OMPV-03 V3: the main thread run-queue share at its bound is valid and just above it is not, in each window", () => {
  assert.equal(runValidity(inputOf({ cold: windowOf({ runqShare: 0.3 }), control: windowOf({ runqShare: 0.3 }) }), BOUNDS).valid, true);
  const cold = runValidity(inputOf({ cold: windowOf({ runqShare: 0.31 }) }), BOUNDS);
  assert.ok(!cold.valid && cold.rule === "V3" && /run-queue share of the cold window was 0\.31/.test(cold.reason));
  const control = runValidity(inputOf({ control: windowOf({ runqShare: 0.31 }) }), BOUNDS);
  assert.ok(!control.valid && control.rule === "V3" && /control window/.test(control.reason));
});

void test("OMPV-03 V3 under the unscoped tier skips the stall share and keeps the run-queue share; a scoped run with no stall bound fails", () => {
  const unscoped = inputOf({ tier: TIER_UNSCOPED, cold: windowOf({ scopeStallShare: null }), control: windowOf({ scopeStallShare: null }) });
  assert.equal(runValidity(unscoped, { ...BOUNDS, stallShareMax: null }).valid, true);
  const heavy = runValidity({ ...unscoped, cold: windowOf({ scopeStallShare: null, runqShare: 0.31 }) }, { ...BOUNDS, stallShareMax: null });
  assert.ok(!heavy.valid && heavy.rule === "V3");
  const noBound = runValidity(inputOf(), { ...BOUNDS, stallShareMax: null });
  assert.ok(!noBound.valid && noBound.rule === "V3" && /no stall share bound/.test(noBound.reason));
});

void test("OMPV-03 V4: the control self-inflicted maximum at its bound is valid and above it is not; likewise the 95th percentile", () => {
  assert.equal(runValidity(inputOf({ control: windowOf({ self: shaped(1200, 600) }) }), BOUNDS).valid, true);
  const max = runValidity(inputOf({ control: windowOf({ self: shaped(1201, 600) }) }), BOUNDS);
  assert.ok(!max.valid && max.rule === "V4" && /maximum was 1201 ms, above 1200 ms/.test(max.reason));
  const p95 = runValidity(inputOf({ control: windowOf({ self: shaped(1200, 601) }) }), BOUNDS);
  assert.ok(!p95.valid && p95.rule === "V4" && /95th percentile was 601 ms, above 600 ms/.test(p95.reason));
});

void test("OMPV-03 the first failed rule in the order V0, V1, V2, V5, V3, V4 is the one reported", () => {
  const everything = inputOf({
    refusal: "scope command failed",
    mechanicsHeld: false,
    cold: windowOf({ probeGapMaxMs: 900, coverage: 0.1, scopeStallShare: 0.9, runqShare: 0.9 }),
    control: windowOf({ self: shaped(5000, 5000) }),
  });
  const rules: string[] = [];
  let current: ValidityInput = everything;
  const steps: Partial<ValidityInput>[] = [{ refusal: null }, { mechanicsHeld: true }, { cold: windowOf({ coverage: 0.1, scopeStallShare: 0.9, runqShare: 0.9 }) }, { cold: windowOf({ scopeStallShare: 0.9, runqShare: 0.9 }) }, { cold: windowOf() }];
  for (const step of [{}, ...steps]) {
    current = { ...current, ...step };
    const validity = runValidity(current, BOUNDS);
    rules.push(validity.valid ? "valid" : validity.rule);
  }
  assert.deepEqual(rules, ["V0", "V1", "V2", "V5", "V3", "V4"]);
});

void test("OMPV-03 no validity rule reads a load average: the inputs carry none and an extra load field changes nothing", () => {
  const keys = [...Object.keys(inputOf()), ...Object.keys(windowOf())];
  assert.deepEqual(keys.filter((key) => /load/i.test(key)), []);
  const withLoad = { ...inputOf(), loadPerCpu: 99, startLoadPerCpu: 99 };
  assert.deepEqual(runValidity(withLoad, BOUNDS), { valid: true });
});

// ---- nearestRankOf ---------------------------------------------------------------------------------------------------------------

void test("OMPV-04 nearestRankOf is the value at rank ceil(q n) of the ascending order", () => {
  assert.equal(nearestRankOf([5, 1, 3], 0.5), 3);
  assert.equal(nearestRankOf([10, 20, 30, 40], 0.75), 30);
  assert.equal(nearestRankOf(Array.from({ length: 12 }, (_, index) => index + 1), 0.9), 11);
  assert.equal(nearestRankOf(Array.from({ length: 11 }, (_, index) => index + 1), 0.9), 10);
  assert.equal(nearestRankOf(Array.from({ length: 12 }, (_, index) => index + 1), 0.75), 9);
  assert.equal(nearestRankOf(Array.from({ length: 11 }, (_, index) => index + 1), 0.75), 9);
  assert.equal(nearestRankOf([7], 0.9), 7);
  assert.throws(() => nearestRankOf([], 0.9), /empty list/);
});

// ---- deriveBounds ----------------------------------------------------------------------------------------------------------------

function controlOf(maxMs: number, p95Ms: number, stall: number | null = 0.1, runq = 0.1, tier: Tier = TIER_SCOPED): CalibrationControl {
  return { tier, self: shaped(maxMs, p95Ms), scopeStallShare: stall, runqShare: runq };
}

// n controls that all meet the thresholds, with shares 0.01 * i (i from 1) and small latencies.
function passingControls(n: number): CalibrationControl[] {
  return Array.from({ length: n }, (_, index) => controlOf(100 + index, 50, 0.01 * (index + 1), 0.01 * (index + 1)));
}

void test("OMPV-04 deriveBounds: 12 controls that pass at small values give the thresholds and the 75th percentile shares", () => {
  const derived = deriveBounds(passingControls(12));
  assert.ok(derived.derivable);
  // The nearest-rank 90th percentile of 12 values is the 11th, the 75th the 9th.
  assert.deepEqual(derived.bounds, { stallShareMax: 0.09, runqShareMax: 0.09, controlSelfMaxMs: 1000, controlSelfP95Ms: 500 });
  assert.deepEqual([derived.passing, derived.total], [12, 12]);
});

void test("OMPV-04 deriveBounds: 11 controls, the rank arithmetic written out (the 10th for the 90th percentile, the 9th for the 75th)", () => {
  const controls = Array.from({ length: 11 }, (_, index) => controlOf(1000, 40 * (index + 1), 0.01 * (index + 1), 0.02 * (index + 1)));
  // 95th percentile maxima (ascending) 40, 80, ..., 440; ceil(0.9 * 11) = 10, the 10th is 400; max(500, 400) stays 500.
  const derived = deriveBounds(controls);
  assert.ok(derived.derivable);
  assert.equal(derived.bounds.controlSelfP95Ms, 500);
  assert.equal(derived.bounds.controlSelfMaxMs, 1000);
  assert.equal(derived.bounds.stallShareMax, 0.09);
  assert.equal(derived.bounds.runqShareMax, 0.18);
});

void test("OMPV-04 deriveBounds: the 90th percentile of the maxima of all controls lifts the maximum bound to 1350", () => {
  const controls = [...Array.from({ length: 10 }, () => controlOf(500, 50)), controlOf(1301, 50), controlOf(1301, 50)];
  const derived = deriveBounds(controls);
  assert.ok(derived.derivable);
  assert.equal(derived.bounds.controlSelfMaxMs, 1350);
  assert.equal(derived.passing, 10);
});

void test("OMPV-04 deriveBounds: the 95th percentile bound rounds up to 50 and lifts above 500", () => {
  const controls = [...Array.from({ length: 10 }, () => controlOf(900, 100)), controlOf(1200, 551), controlOf(1200, 551)];
  const derived = deriveBounds(controls);
  assert.ok(derived.derivable);
  assert.equal(derived.bounds.controlSelfP95Ms, 600);
});

void test("OMPV-04 deriveBounds: a maximum bound at exactly 3000 is allowed, over it (3050) is underivable", () => {
  const edge = deriveBounds([...Array.from({ length: 10 }, () => controlOf(500, 50)), controlOf(3000, 50), controlOf(3000, 50)]);
  assert.ok(edge.derivable);
  assert.equal(edge.bounds.controlSelfMaxMs, 3000);
  const over = deriveBounds([...Array.from({ length: 10 }, () => controlOf(500, 50)), controlOf(3001, 50), controlOf(3001, 50)]);
  assert.ok(!over.derivable);
  assert.match(over.reason, /control maximum bound would be 3050 ms, above the cap of 3000 ms/);
});

void test("OMPV-04 deriveBounds: a 95th percentile bound at exactly 1500 is allowed, over it (1550) is underivable", () => {
  const edge = deriveBounds([...Array.from({ length: 10 }, () => controlOf(500, 50)), controlOf(2000, 1500), controlOf(2000, 1500)]);
  assert.ok(edge.derivable);
  assert.equal(edge.bounds.controlSelfP95Ms, 1500);
  const over = deriveBounds([...Array.from({ length: 10 }, () => controlOf(500, 50)), controlOf(2000, 1501), controlOf(2000, 1501)]);
  assert.ok(!over.derivable);
  assert.match(over.reason, /95th percentile bound would be 1550 ms, above the cap of 1500 ms/);
});

void test("OMPV-04 deriveBounds: 4 passing controls of 12 are underivable, 5 of 12 are derivable", () => {
  const failing = (count: number): CalibrationControl[] => Array.from({ length: count }, () => controlOf(1200, 50));
  const four = deriveBounds([...passingControls(4), ...failing(8)]);
  assert.ok(!four.derivable);
  assert.match(four.reason, /4 of 12 calibration controls met the thresholds, fewer than 5/);
  const five = deriveBounds([...passingControls(5), ...failing(7)]);
  assert.ok(five.derivable);
  assert.equal(five.bounds.controlSelfMaxMs, 1200);
  assert.equal(five.passing, 5);
});

void test("OMPV-04 deriveBounds: the share bounds are read from the passing controls only", () => {
  const controls = [...passingControls(5), controlOf(1200, 50, 0.9, 0.9)];
  const derived = deriveBounds(controls);
  assert.ok(derived.derivable);
  // The passing shares are 0.01 .. 0.05; the 75th percentile is the 4th.
  assert.deepEqual([derived.bounds.stallShareMax, derived.bounds.runqShareMax], [0.04, 0.04]);
});

void test("OMPV-04 deriveBounds: a null stall share is skipped; all null is underivable when scoped and a null bound when unscoped", () => {
  const some = deriveBounds([...passingControls(5), controlOf(100, 50, null)]);
  assert.ok(some.derivable);
  assert.equal(some.bounds.stallShareMax, 0.04);
  const scoped = deriveBounds(Array.from({ length: 5 }, () => controlOf(100, 50, null)));
  assert.ok(!scoped.derivable);
  assert.match(scoped.reason, /no passing calibration control has a scope stall share/);
  const unscoped = deriveBounds(Array.from({ length: 5 }, () => controlOf(100, 50, null, 0.1, TIER_UNSCOPED)));
  assert.ok(unscoped.derivable);
  assert.equal(unscoped.bounds.stallShareMax, null);
});

void test("OMPV-04 deriveBounds: an empty list is underivable, controls of two tiers are refused", () => {
  const none = deriveBounds([]);
  assert.ok(!none.derivable);
  assert.match(none.reason, /0 of 0 calibration controls/);
  assert.throws(() => deriveBounds([...passingControls(5), controlOf(100, 50, null, 0.1, TIER_UNSCOPED)]), /one tier/);
});

// ---- The cause table -------------------------------------------------------------------------------------------------------------

void test("OMPV-05 causeOfRun: omp-own when the same run's control also fails the thresholds, before any stall cause", () => {
  const run = runOf(1, { cold: breachingCold("on-cpu"), control: windowOf({ self: shaped(1100, 100) }) });
  assert.equal(causeOfRun(run), "omp-own");
});

void test("OMPV-05 causeOfRun: on-cpu is extension-on-cpu, sleep is extension-wait, mixed and unattributed are unattributed", () => {
  assert.equal(causeOfRun(runOf(1, { cold: breachingCold("on-cpu") })), "extension-on-cpu");
  assert.equal(causeOfRun(runOf(1, { cold: breachingCold("sleep") })), "extension-wait");
  assert.equal(causeOfRun(runOf(1, { cold: breachingCold("mixed") })), "unattributed");
  assert.equal(causeOfRun(runOf(1, { cold: breachingCold("unattributed") })), "unattributed");
});

void test("OMPV-05 causeOfRun: a latency breach with an empty stall set is an inconsistency error; a shortness-only breach is unattributed", () => {
  const bad = shaped(1500, 700);
  assert.throws(() => causeOfRun(runOf(1, { cold: windowOf({ raw: bad, self: bad, stallSet: NO_STALL }) })), /inconsistent observation/);
  const short = shaped(20, 20, 30);
  assert.equal(causeOfRun(runOf(1, { cold: windowOf({ raw: short, self: short, stallSet: NO_STALL }) })), "unattributed");
});

void test("OMPV-05 windowCause: the cause shared by more than half of the breaching runs, else mixed", () => {
  const split: RunCause[] = ["extension-on-cpu", "extension-on-cpu", "extension-wait", "extension-wait"];
  assert.equal(windowCause(split), "mixed");
  assert.equal(windowCause(["extension-on-cpu", "extension-on-cpu", "extension-on-cpu", "extension-wait"]), "extension-on-cpu");
  assert.equal(windowCause(["omp-own"]), "omp-own");
  assert.equal(windowCause([]), "mixed");
});

// ---- decideVerdict: one test per row, in the order of the table ------------------------------------------------------------------

void test("OMPV-05 decideVerdict VOID uncalibrated: five PASS-shaped valid runs with unset bounds give VOID", () => {
  const verdict = decideVerdict(fiveGood(), null);
  assert.equal(verdict.outcome, "VOID");
  assert.match(verdict.reason, /^uncalibrated/);
  assert.equal(verdict.quietClaim, false);
  assert.deepEqual(verdict.runs, []);
});

void test("OMPV-05 decideVerdict VOID: 4 valid runs are not enough, 5 are; invalid runs count for nothing even when they breach", () => {
  const four = fiveGood().slice(0, 4);
  const voided = decideVerdict(four, BOUNDS);
  assert.equal(voided.outcome, "VOID");
  assert.match(voided.reason, /^4 valid runs, fewer than 5/);
  assert.equal(decideVerdict(fiveGood(), BOUNDS).outcome, "PASS");
  const invalidBreach = runOf(5, { cold: windowOf({ ...breachingCold("on-cpu"), scopeStallShare: 0.9 }) });
  const withInvalid = decideVerdict([...four, invalidBreach], BOUNDS);
  assert.equal(withInvalid.outcome, "VOID");
  assert.equal(withInvalid.validRuns, 4);
  const last = withInvalid.runs.at(-1)?.validity;
  assert.ok(last !== undefined && !last.valid && last.rule === "V3");
});

void test("OMPV-05 decideVerdict PASS: no valid run breaches on the self-inflicted or the raw summary", () => {
  const verdict = decideVerdict(fiveGood(), BOUNDS);
  assert.equal(verdict.outcome, "PASS");
  assert.equal(verdict.validRuns, 5);
  assert.equal(verdict.windowCause, null);
  assert.equal(verdict.tier, TIER_SCOPED);
  assert.equal(verdict.quietClaim, false);
  assert.match(verdict.reason, /5 valid runs/);
});

void test("OMPV-05 decideVerdict FINDING: one valid breaching run is enough (0 breaching is PASS), with its cause", () => {
  const runs = [...fiveGood().slice(0, 4), runOf(5, { cold: breachingCold("on-cpu") })];
  const verdict = decideVerdict(runs, BOUNDS);
  assert.equal(verdict.outcome, "FINDING");
  assert.equal(verdict.windowCause, "extension-on-cpu");
  assert.match(verdict.reason, /1 of 5 valid runs exceed the thresholds on the self-inflicted latency; window cause extension-on-cpu/);
  const row = verdict.runs[4];
  assert.deepEqual([row?.breach, row?.cause, row?.selfMaxMs, row?.selfP95Ms, row?.stallCause], ["self", "extension-on-cpu", 1500, 700, "on-cpu"]);
});

void test("OMPV-05 decideVerdict NOT-REPRODUCED: a raw-only breach on a valid run, with no self-inflicted breach", () => {
  const raw = shaped(2000, 700);
  const runs = [...fiveGood().slice(0, 4), runOf(5, { cold: windowOf({ raw }) })];
  const verdict = decideVerdict(runs, BOUNDS);
  assert.equal(verdict.outcome, "NOT-REPRODUCED");
  assert.match(verdict.reason, /1 of 5 exceed them on the raw latency/);
  assert.equal(verdict.runs[4]?.breach, "raw");
  assert.equal(verdict.runs[4].cause, null);
});

void test("OMPV-05 decideVerdict: five valid runs that all breach on raw only are NOT-REPRODUCED", () => {
  const raw = shaped(2000, 700);
  const verdict = decideVerdict([1, 2, 3, 4, 5].map((index) => runOf(index, { cold: windowOf({ raw }) })), BOUNDS);
  assert.equal(verdict.outcome, "NOT-REPRODUCED");
  assert.equal(verdict.validRuns, 5);
});

void test("OMPV-05 decideVerdict precedence: a self-inflicted breach and a raw breach in one window is FINDING", () => {
  const raw = shaped(2000, 700);
  const runs = [runOf(1, { cold: windowOf({ raw }) }), runOf(2, { cold: breachingCold("sleep") }), ...fiveGood().slice(2, 5)];
  const verdict = decideVerdict(runs, BOUNDS);
  assert.equal(verdict.outcome, "FINDING");
  assert.equal(verdict.windowCause, "extension-wait");
});

void test("OMPV-05 decideVerdict: the window cause is the majority cause of the breaching runs, mixed on a 2 of 4 split", () => {
  const four = (causes: readonly StallCause[]): RunObservation[] => causes.map((cause, index) => runOf(index + 1, { cold: breachingCold(cause) }));
  const majority = decideVerdict([...four(["on-cpu", "on-cpu", "on-cpu", "sleep"]), runOf(5)], BOUNDS);
  assert.equal(majority.windowCause, "extension-on-cpu");
  const split = decideVerdict([...four(["on-cpu", "on-cpu", "sleep", "sleep"]), runOf(5)], BOUNDS);
  assert.equal(split.windowCause, "mixed");
  assert.deepEqual(split.runs.map((row) => row.cause), ["extension-on-cpu", "extension-on-cpu", "extension-wait", "extension-wait", null]);
});

void test("OMPV-05 decideVerdict lists an invalid run with its first failed rule and counts it for nothing", () => {
  const runs = [...fiveGood(), runOf(6, { mechanicsHeld: false })];
  const verdict = decideVerdict(runs, BOUNDS);
  assert.equal(verdict.outcome, "PASS");
  assert.equal(verdict.validRuns, 5);
  const invalid = verdict.runs[5]?.validity;
  assert.ok(invalid !== undefined && !invalid.valid && invalid.rule === "V1");
  assert.equal(verdict.runs[5]?.breach, null);
});

void test("OMPV-05 decideVerdict result: the table row, the tier label and the fixed quiet claim", () => {
  const verdict = decideVerdict(fiveGood(), BOUNDS);
  assert.deepEqual(verdict.runs[0], { runIndex: 2, arm: "after", pair: 1, validity: { valid: true }, rawMaxMs: 20, rawP95Ms: 20, selfMaxMs: 20, selfP95Ms: 20, stallCause: "none", breach: null, cause: null });
  assert.equal(verdict.quietClaim, false);
  const unscoped = decideVerdict([1, 2, 3, 4, 5].map((index) => runOf(index, { tier: TIER_UNSCOPED, cold: windowOf({ scopeStallShare: null }), control: windowOf({ scopeStallShare: null }) })), { ...BOUNDS, stallShareMax: null });
  assert.equal(unscoped.tier, TIER_UNSCOPED);
  assert.equal(unscoped.outcome, "PASS");
  assert.throws(() => decideVerdict([runOf(1), runOf(2, { tier: TIER_UNSCOPED })], BOUNDS), /one tier/);
  assert.equal(decideVerdict([], BOUNDS).tier, null);
});
