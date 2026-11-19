// The always-running hermetic test of test/support/omp-window-analysis.ts (Phase 45, OMPV-03 to OMPV-06; 45-CONTEXT D-45-06 to D-45-10): a
// window and a calibration are recomputed from synthetic records and CSVs, every outcome is reached, and a record that disagrees with its
// CSVs is an error naming the field. Pure: no process, no clock, no file, no host.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCalibrationRecord, buildRunRecord, type PartParts, readingsCsv, type RunRecord, type ThreadSplit } from "./omp-arm-run.js";
import type { ContentionReading } from "./omp-contention.js";
import { analyseCalibration, analyseWindow, type CalibrationAttempt, type WindowAttempt } from "./omp-window-analysis.js";
import { type Arm, type Bounds, TIER_SCOPED } from "./omp-verdict.js";
import { type ProbeSample, samplesCsvWithPhase } from "./responsiveness.js";

// ---- Fixtures --------------------------------------------------------------------------------------------------------------------

const BOUNDS: Bounds = { stallShareMax: 0.3, runqShareMax: 0.3, controlSelfMaxMs: 1000, controlSelfP95Ms: 500 };

// One probe of a part that stalls: sent at atMs, answered after latencyMs, with the thread spending the interval on CPU or waiting in the
// run queue.
interface Stall {
  readonly atMs: number;
  readonly latencyMs: number;
  readonly kind: "on-cpu" | "runq";
}

// The probes every 250 ms from 0 to 11 250 ms (boot until 1000, ready at 1000, 20 ms answers) with the stall's probe slowed.
function samplesFor(stall: Stall | null): ProbeSample[] {
  const samples: ProbeSample[] = [];
  for (let sentAtMs = 0; sentAtMs <= 11_250; sentAtMs += 250) {
    const latencyMs = stall !== null && sentAtMs === stall.atMs ? stall.latencyMs : sentAtMs < 1000 ? undefined : sentAtMs === 1000 ? 100 : 20;
    samples.push({ sentAtMs, latencyMs });
  }
  return samples;
}

// Readings every 10 ms: a steady 10 percent on CPU, 5 percent run queue and 5 percent scope stall, and over the stall's interval all of the
// time on CPU or all of it waiting in the run queue.
function readingsFor(stall: Stall | null): ContentionReading[] {
  const readings: ContentionReading[] = [];
  let onCpuNs = 0;
  let runqNs = 0;
  let totalUs = 0;
  for (let atMs = 0; atMs <= 24_000; atMs += 10) {
    readings.push({ atMs, scopeSomeTotalUs: totalUs, mainOnCpuNs: onCpuNs, mainRunqNs: runqNs });
    const inside = stall !== null && atMs >= stall.atMs && atMs < stall.atMs + stall.latencyMs;
    if (inside && stall.kind === "on-cpu") {
      onCpuNs += 10_000_000;
      totalUs += 500;
    } else if (inside) {
      runqNs += 10_000_000;
      totalUs += 10_000;
    } else {
      onCpuNs += 1_000_000;
      runqNs += 500_000;
      totalUs += 500;
    }
  }
  return readings;
}

function partFor(stall: Stall | null, threads: ThreadSplit | null = null): PartParts {
  return { samples: samplesFor(stall), readings: readingsFor(stall), readyMs: 1000, threads };
}

interface AttemptOptions {
  readonly coldStall?: Stall | null;
  readonly mechanicsHeld?: boolean;
  readonly refusal?: RunRecord["refusal"];
  readonly bounds?: Bounds | null;
}

function attemptOf(pair: number, arm: Arm, options: AttemptOptions = {}): WindowAttempt {
  const control = partFor(null);
  const cold = partFor(options.coldStall ?? null);
  const record = buildRunRecord({
    arm,
    pair,
    branch: "S",
    startedAtEpochMs: 1,
    refusal: options.refusal ?? null,
    mechanicsHeld: options.mechanicsHeld ?? true,
    control,
    cold,
    host: [],
    bounds: options.bounds === undefined ? BOUNDS : options.bounds,
  });
  return {
    record,
    controlSamplesCsv: samplesCsvWithPhase(control.samples, 1000),
    coldSamplesCsv: samplesCsvWithPhase(cold.samples, 1000),
    controlReadingsCsv: readingsCsv(control.readings),
    coldReadingsCsv: readingsCsv(cold.readings),
  };
}

// Both arms of pairs 1 to count, all good.
function goodWindow(count: number): WindowAttempt[] {
  return Array.from({ length: count }, (_, index) => [attemptOf(index + 1, "before"), attemptOf(index + 1, "after")]).flat();
}

const ON_CPU_STALL: Stall = { atMs: 3000, latencyMs: 1500, kind: "on-cpu" };
const RUNQ_STALL: Stall = { atMs: 3000, latencyMs: 1500, kind: "runq" };

// ---- analyseWindow ---------------------------------------------------------------------------------------------------------------

void test("OMPV-05 analyseWindow PASS: five valid pairs, no breach, the counts and the paired decision", () => {
  const analysis = analyseWindow(goodWindow(5), BOUNDS);
  assert.equal(analysis.verdict.outcome, "PASS");
  assert.equal(analysis.verdict.validRuns, 5);
  assert.deepEqual(analysis.counts, { attempts: 10, validRuns: 10, validPairs: 5 });
  assert.equal(analysis.attempts.length, 10);
  assert.ok(analysis.attempts.every((row) => row.validity.valid));
  // The BEFORE build shows no boot excess in these synthetic runs, so the paired rule reads NOT-REPRODUCED (its own table, unchanged).
  assert.equal(analysis.paired.outcome, "NOT-REPRODUCED");
  assert.equal(analysis.paired.quietClaim, false);
  assert.deepEqual(analysis.incompletePairs, []);
});

void test("OMPV-05 analyseWindow FINDING with a named cause: an on-CPU stall of the AFTER cold window is extension-on-cpu", () => {
  const attempts = [...goodWindow(4), attemptOf(5, "before"), attemptOf(5, "after", { coldStall: ON_CPU_STALL })];
  const analysis = analyseWindow(attempts, BOUNDS);
  assert.equal(analysis.verdict.outcome, "FINDING");
  assert.equal(analysis.verdict.windowCause, "extension-on-cpu");
  const row = analysis.verdict.runs.find((run) => run.breach === "self");
  assert.deepEqual([row?.pair, row?.selfMaxMs, row?.cause, row?.stallCause], [5, 1500, "extension-on-cpu", "on-cpu"]);
});

void test("OMPV-05 analyseWindow NOT-REPRODUCED: a stall that was run-queue delay breaches the raw summary only", () => {
  const attempts = [...goodWindow(4), attemptOf(5, "before"), attemptOf(5, "after", { coldStall: RUNQ_STALL })];
  const analysis = analyseWindow(attempts, BOUNDS);
  assert.equal(analysis.verdict.outcome, "NOT-REPRODUCED");
  const row = analysis.verdict.runs.find((run) => run.breach === "raw");
  // The stalled probe has no self-inflicted time; the largest self-inflicted latency left is the slow first answer less its 5 percent run queue.
  assert.deepEqual([row?.pair, row?.rawMaxMs, row?.selfMaxMs], [5, 1500, 95]);
});

void test("OMPV-05 analyseWindow VOID: four valid pairs are not enough for the verdict or the paired decision", () => {
  const analysis = analyseWindow(goodWindow(4), BOUNDS);
  assert.equal(analysis.verdict.outcome, "VOID");
  assert.match(analysis.verdict.reason, /^4 valid runs, fewer than 5/);
  assert.equal(analysis.paired.outcome, "VOID");
  assert.deepEqual(analysis.counts, { attempts: 8, validRuns: 8, validPairs: 4 });
});

void test("OMPV-04 analyseWindow: an invalid run is listed with its first failed rule and counts for nothing, a pair with it is not valid", () => {
  const attempts = [...goodWindow(5), attemptOf(6, "before", { refusal: "scope command failed" }), attemptOf(6, "after")];
  const analysis = analyseWindow(attempts, BOUNDS);
  const refused = analysis.attempts.find((row) => row.pair === 6 && row.arm === "before");
  assert.ok(refused !== undefined && !refused.validity.valid && refused.validity.rule === "V0");
  assert.equal(analysis.counts.validRuns, 11);
  assert.equal(analysis.counts.validPairs, 5);
  assert.equal(analysis.verdict.validRuns, 6);
  assert.deepEqual(analysis.paired.invalid.map((entry) => entry.pair), [6]);
  assert.match(analysis.paired.invalid[0]?.reason ?? "", /^the before run is not valid by V0/);
});

void test("OMPV-04 analyseWindow with unset bounds: the verdict is VOID uncalibrated and the validity is the mechanical rules only", () => {
  const analysis = analyseWindow(goodWindow(5), null);
  assert.equal(analysis.verdict.outcome, "VOID");
  assert.match(analysis.verdict.reason, /^uncalibrated/);
  assert.ok(analysis.attempts.every((row) => row.validity.valid));
  // The paired decision is the Phase 44 table over the pairs the mechanical rules admit.
  assert.equal(analysis.paired.validPairs, 5);
});

void test("OMPV-06 analyseWindow: a pair with one arm is incomplete and counts for nothing; the same pair and arm twice is an error", () => {
  const analysis = analyseWindow([...goodWindow(5), attemptOf(6, "before")], BOUNDS);
  assert.deepEqual(analysis.incompletePairs, [6]);
  assert.equal(analysis.counts.validPairs, 5);
  assert.throws(() => analyseWindow([attemptOf(1, "before"), attemptOf(1, "before")], BOUNDS), /appears twice/);
});

void test("OMPV-03 analyseWindow: a record number that disagrees with its CSV is an error naming the field, never reconciled", () => {
  const attempt = attemptOf(1, "after");
  const lied = { ...attempt, record: { ...attempt.record, cold: { ...attempt.record.cold, coverage: 0.5 } } };
  assert.throws(() => analyseWindow([lied], BOUNDS), /pair 1 after, cold: the coverage of the record differs/);
  const shares = { ...attempt, record: { ...attempt.record, control: { ...attempt.record.control, runqShare: 0.001 } } };
  assert.throws(() => analyseWindow([shares], BOUNDS), /pair 1 after, control: the runqShare of the record differs/);
  const metrics = { ...attempt, record: { ...attempt.record, metrics: { x: 1, x1: 0, x2: 0, s: 0 } } };
  assert.throws(() => analyseWindow([metrics], BOUNDS), /metrics of the record differ/);
  const swapped = { ...attempt, coldSamplesCsv: attempt.coldSamplesCsv.replace("1250,20,window", "1250,900,window") };
  assert.throws(() => analyseWindow([swapped], BOUNDS), /pair 1 after, cold: the raw of the record differs/);
  const index = { ...attempt, record: { ...attempt.record, runIndex: 9 } };
  assert.throws(() => analyseWindow([index], BOUNDS), /runIndex of the record \(9\)/);
  const first = { ...attempt, record: { ...attempt.record, cold: { ...attempt.record.cold, firstAnswerMs: 1 } } };
  assert.throws(() => analyseWindow([first], BOUNDS), /firstAnswerMs of the record/);
});

void test("OMPV-03 analyseWindow: a record that says the mechanics held while its CSVs have no metrics is an error", () => {
  const attempt = attemptOf(1, "before");
  const empty = { ...attempt, controlSamplesCsv: "sentAtMs,latencyMs,phase\n0,,boot\n" };
  assert.throws(() => analyseWindow([empty], BOUNDS), /differ from the ones recomputed|differs from the one recomputed|firstAnswerMs/);
});

void test("OMPV-03 analyseWindow carries the tier label of the records into the verdict", () => {
  const analysis = analyseWindow(goodWindow(5), BOUNDS);
  assert.equal(analysis.verdict.tier, TIER_SCOPED);
  assert.equal(analysis.verdict.quietClaim, false);
});

// ---- analyseCalibration ----------------------------------------------------------------------------------------------------------

function threadsOf(mainOnCpuNs: number, otherOnCpuNs: number): ThreadSplit {
  const total = mainOnCpuNs + otherOnCpuNs;
  return {
    mainTid: 100,
    tasks: mainOnCpuNs >= otherOnCpuNs
      ? [{ tid: 100, comm: "omp", onCpuNs: mainOnCpuNs, runqNs: 1 }, { tid: 101, comm: "pool", onCpuNs: otherOnCpuNs, runqNs: 1 }]
      : [{ tid: 101, comm: "pool", onCpuNs: otherOnCpuNs, runqNs: 1 }, { tid: 100, comm: "omp", onCpuNs: mainOnCpuNs, runqNs: 1 }],
    mainShare: mainOnCpuNs / total,
  };
}

interface ControlOptions {
  readonly stall?: Stall | null;
  readonly threads?: ThreadSplit | null;
  readonly refusal?: CalibrationAttempt["record"]["refusal"];
}

function controlAttempt(attempt: number, options: ControlOptions = {}): CalibrationAttempt {
  const control = partFor(options.stall ?? null, options.threads === undefined ? threadsOf(800, 200) : options.threads);
  const record = buildCalibrationRecord({ attempt, branch: "S", startedAtEpochMs: 1, refusal: options.refusal ?? null, mechanicsHeld: true, control, host: [] });
  return { record, samplesCsv: samplesCsvWithPhase(control.samples, 1000), readingsCsv: readingsCsv(control.readings) };
}

// A control that exceeds the thresholds on its own (an on-CPU stall of 1200 ms inside its serving window): valid mechanically, never passing.
const OWN_STALL: Stall = { atMs: 3000, latencyMs: 1200, kind: "on-cpu" };

void test("OMPV-04 analyseCalibration: twelve controls derive bounds, the busiest-thread count, the table and a stable digest", () => {
  const attempts = Array.from({ length: 12 }, (_, index) => controlAttempt(index + 1));
  const analysis = analyseCalibration(attempts);
  assert.equal(analysis.controls.length, 12);
  assert.equal(analysis.validControls, 12);
  assert.equal(analysis.mainBusiestCount, 12);
  assert.ok(analysis.derivation.derivable);
  assert.deepEqual(analysis.derivation.bounds.controlSelfMaxMs, 1000);
  assert.equal(analysis.derivation.bounds.controlSelfP95Ms, 500);
  assert.ok(analysis.derivation.bounds.stallShareMax !== null && Math.abs(analysis.derivation.bounds.stallShareMax - 0.05) < 1e-9);
  assert.ok(Math.abs(analysis.derivation.bounds.runqShareMax - 0.05) < 1e-9);
  assert.deepEqual(analysis.controls[0], {
    attempt: 1,
    validity: { valid: true },
    selfMaxMs: 95,
    selfP95Ms: 19,
    scopeStallShare: analysis.controls[0]?.scopeStallShare,
    runqShare: analysis.controls[0]?.runqShare,
    mainShare: 0.8,
    mainIsBusiest: true,
  });
  assert.match(analysis.digest, /^[0-9a-f]{64}$/);
  assert.equal(analyseCalibration(attempts).digest, analysis.digest);
  // The order of the inputs does not matter: the lines are in attempt order.
  assert.equal(analyseCalibration([...attempts].reverse()).digest, analysis.digest);
});

void test("OMPV-04 analyseCalibration: the digest changes when one number changes", () => {
  const attempts = Array.from({ length: 12 }, (_, index) => controlAttempt(index + 1));
  const changed = attempts.map((attempt, index) => (index === 6 ? controlAttempt(7, { stall: { atMs: 3000, latencyMs: 300, kind: "on-cpu" } }) : attempt));
  assert.notEqual(analyseCalibration(changed).digest, analyseCalibration(attempts).digest);
  const shareChanged = attempts.map((attempt, index) => (index === 3 ? controlAttempt(4, { threads: threadsOf(600, 400) }) : attempt));
  assert.notEqual(analyseCalibration(shareChanged).digest, analyseCalibration(attempts).digest);
});

void test("OMPV-04 analyseCalibration: four passing controls of twelve are underivable", () => {
  const attempts = [...Array.from({ length: 4 }, (_, index) => controlAttempt(index + 1)), ...Array.from({ length: 8 }, (_, index) => controlAttempt(index + 5, { stall: OWN_STALL }))];
  const analysis = analyseCalibration(attempts);
  assert.ok(!analysis.derivation.derivable);
  assert.match(analysis.derivation.reason, /4 of 12 calibration controls met the thresholds, fewer than 5/);
  assert.equal(analysis.validControls, 12);
});

void test("OMPV-04 analyseCalibration: a control whose main thread is not the busiest is counted, and a refused control is left out", () => {
  const attempts = [
    ...Array.from({ length: 10 }, (_, index) => controlAttempt(index + 1)),
    controlAttempt(11, { threads: threadsOf(100, 900) }),
    controlAttempt(12, { refusal: "scope command failed" }),
    controlAttempt(13, { threads: null }),
  ];
  const analysis = analyseCalibration(attempts);
  assert.equal(analysis.controls.length, 13);
  assert.equal(analysis.validControls, 12);
  assert.equal(analysis.mainBusiestCount, 10);
  assert.equal(analysis.controls[10]?.mainIsBusiest, false);
  assert.equal(analysis.controls[12]?.mainShare, null);
  const refused = analysis.controls[11]?.validity;
  assert.ok(refused !== undefined && !refused.valid && refused.rule === "V0");
});

void test("OMPV-03 analyseCalibration: a record that disagrees with its CSV, or with its thread split, is an error naming the field", () => {
  const attempt = controlAttempt(1);
  const lied = { ...attempt, record: { ...attempt.record, control: { ...attempt.record.control, self: { ...attempt.record.control.self, maxMs: 5 } } } };
  assert.throws(() => analyseCalibration([lied]), /calibration control 1: the self of the record differs/);
  const split = threadsOf(800, 200);
  const badSplit = { ...attempt, record: { ...attempt.record, control: { ...attempt.record.control, threads: { ...split, mainShare: 0.5 } } } };
  assert.throws(() => analyseCalibration([badSplit]), /the mainShare of the record \(0\.5\) differs/);
  assert.throws(() => analyseCalibration([attempt, attempt]), /appears twice/);
});
