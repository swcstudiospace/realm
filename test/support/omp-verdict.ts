// The run validity, the derivation of the calibrated bounds, the order rule, the cause table and the verdict table of the Omp
// responsiveness window (Phase 45, OMPV-03, OMPV-04 and OMPV-05; 45-CONTEXT D-45-06 to D-45-09). Pure: no process, no clock, no
// environment, no file. The live tests measure and write records; test/support/omp-window-analysis.ts recomputes a window from its
// records and this module decides. The hermetic test is test/support/omp-verdict.test.ts.
//
// Run validity, D-45-06 in words. A run counts only when every rule holds; the first failed rule, in the order V0, V1, V2, V5, V3, V4,
// is the recorded reason, and an invalid run is recorded and counted as nothing. V0, refusal: the scope was obtained (or the run is
// declared unscoped) and every reading was readable; a refusal text, or under the scoped tier a lost scope reading, is a refusal. V1,
// mechanics: the mechanics of the arm test held. V2, probe driver health: no gap between consecutive probe sends in the cold window or
// in the control window exceeds PROBE_DRIVER_GAP_MAX_MS. V5, attribution coverage: at least ATTRIBUTION_COVERAGE_MIN of the window probes
// are attributed. V3, scoped contention, for the cold window and for the control serving window: the scope's some stall share is at most
// stallShareMax (skipped under the unscoped tier, which the record says) and the main thread's run-queue share is at most runqShareMax.
// V4, baseline validity: the control's self-inflicted serving maximum is at most controlSelfMaxMs and its 95th percentile at most
// controlSelfP95Ms. No rule reads a load average: the host load describes the host, not the Omp tree. mechanicalValidity is V0, V1, V2
// and V5 (what a calibration control can be asked); runValidity adds V3 and V4 with the four calibrated bounds.
//
// The four calibrated constants (stallShareMax, runqShareMax, controlSelfMaxMs, controlSelfP95Ms) live only in omp-calibration.ts, unset
// until plan 45-04 freezes them from a recorded calibration before the first verdict run; they are never changed after a verdict is
// seen. While they are unset decideVerdict returns VOID with the reason uncalibrated. deriveBounds is the derivation: a calibration
// control meets the thresholds when responsivenessProblems of its self-inflicted serving summary is empty; fewer than
// CALIBRATION_MIN_PASSING of them is underivable; the maximum bound is the larger of 1000 and the nearest-rank 90th percentile of the
// serving maxima of all given controls, rounded up to a multiple of BOUND_ROUND_MS, the 95th percentile bound likewise with 500; a bound
// above CONTROL_BOUND_CAP_FACTOR times its threshold is underivable; the two share bounds are the nearest-rank 75th percentile of the
// shares among the controls that met the thresholds.
//
// Order rule, D-45-07: the run index of an arm run is 2 * (pair - 1) plus 1 for the first arm of the pair and plus 2 for the second, the
// first arm being before for an odd pair and after for an even pair; the control runs first inside a run when its run index is odd.
//
// Verdict table, D-45-09, over the valid AFTER-arm runs, the first row that holds: VOID when the bounds are unset (uncalibrated) or when
// fewer than MIN_VERDICT_RUNS runs are valid; FINDING when at least FINDING_MIN_BREACH_RUNS valid runs have a non-empty
// responsivenessProblems over their self-inflicted window summary; NOT-REPRODUCED when no valid run breaches on the self-inflicted
// summary and at least one breaches on its raw summary; PASS otherwise. Cause table of a breaching run: omp-own when the same run's
// control self-inflicted serving summary also fails the thresholds, otherwise extension-on-cpu when the stall set is on-CPU,
// extension-wait when it is sleep, unattributed when it is mixed or unattributed; the window cause is the cause shared by more than half
// of the breaching runs, else mixed. Every result carries quietClaim false: no outcome says a quiet host was measured.
//
// Labels: every number carries one of the two tier labels below; "isolated" needs the root-assisted step and is not coded here.
//
// Exports: MIN_VERDICT_RUNS, CALIBRATION_TARGET_RUNS, CALIBRATION_MAX_ATTEMPTS, CALIBRATION_MIN_PASSING, CONTROL_BOUND_QUANTILE,
// CONTENTION_QUANTILE, BOUND_ROUND_MS, CONTROL_BOUND_CAP_FACTOR, FINDING_MIN_BREACH_RUNS, TIER_SCOPED, TIER_UNSCOPED, Tier, Arm,
// ValidityRule, RunValidity, ValidityInput, RunObservation, Bounds, CalibrationControl, BoundsDerivation, RunCause, WindowCause,
// VerdictOutcome, VerdictRun, Verdict, nearestRankOf, runIndexOf, controlFirst, mechanicalValidity, runValidity, deriveBounds,
// causeOfRun, windowCause, decideVerdict.

import { ATTRIBUTION_COVERAGE_MIN, PROBE_DRIVER_GAP_MAX_MS, type StallCause, type WindowObservation } from "./omp-contention.js";
import { latencyProblems, type LatencySummary, MAX_LATENCY_MS, P95_LATENCY_MS, responsivenessProblems } from "./responsiveness.js";

export const MIN_VERDICT_RUNS = 5;
export const CALIBRATION_TARGET_RUNS = 12;
export const CALIBRATION_MAX_ATTEMPTS = 16;
export const CALIBRATION_MIN_PASSING = 5;
export const CONTROL_BOUND_QUANTILE = 0.9;
export const CONTENTION_QUANTILE = 0.75;
export const BOUND_ROUND_MS = 50;
export const CONTROL_BOUND_CAP_FACTOR = 3;
export const FINDING_MIN_BREACH_RUNS = 1;

// The isolation tiers of this harness (45-CONTEXT D-45-01): a per-run scope with no CPU reservation, and the fallback with no scope.
export const TIER_SCOPED = "loaded, scoped";
export const TIER_UNSCOPED = "loaded, unscoped";
export type Tier = typeof TIER_SCOPED | typeof TIER_UNSCOPED;

export type Arm = "before" | "after";

export type ValidityRule = "V0" | "V1" | "V2" | "V3" | "V4" | "V5";
export type RunValidity = { readonly valid: true } | { readonly valid: false; readonly rule: ValidityRule; readonly reason: string };

// What the validity rules read of one run. `cold` is null for a calibration control (it has no cold part).
export interface ValidityInput {
  readonly tier: Tier;
  // The closed phrase of a refusal, or null.
  readonly refusal: string | null;
  readonly mechanicsHeld: boolean;
  readonly control: WindowObservation;
  readonly cold: WindowObservation | null;
}

export interface RunObservation extends ValidityInput {
  readonly arm: Arm;
  readonly pair: number;
  readonly runIndex: number;
  readonly cold: WindowObservation;
}

// The four calibrated constants. stallShareMax is null only under the unscoped tier, where the scope has no pressure file.
export interface Bounds {
  readonly stallShareMax: number | null;
  readonly runqShareMax: number;
  readonly controlSelfMaxMs: number;
  readonly controlSelfP95Ms: number;
}

// ---- The nearest-rank percentile -------------------------------------------------------------------------------------------------

// The nearest-rank percentile of a list: the value at rank ceil(quantile * n) of the ascending order. The list must not be empty.
export function nearestRankOf(values: readonly number[], quantile: number): number {
  const ascending = [...values].sort((a, b) => a - b);
  const rank = Math.min(ascending.length, Math.max(1, Math.ceil(quantile * ascending.length - 1e-9)));
  const value = ascending[rank - 1];
  if (value === undefined) {
    throw new Error("the nearest rank of an empty list is not defined");
  }
  return value;
}

// ---- The order rule --------------------------------------------------------------------------------------------------------------

const ARMS: readonly string[] = ["before", "after"];

function checkedPair(pair: number): number {
  if (!Number.isInteger(pair) || pair < 1) {
    throw new Error(`the pair number must be an integer of at least 1, got ${String(pair)}`);
  }
  return pair;
}

// The run index of one arm of one pair (1 for the first arm of pair 1, then 2, 3, ...).
export function runIndexOf(pair: number, arm: Arm): number {
  const firstArm: Arm = checkedPair(pair) % 2 === 1 ? "before" : "after";
  if (!ARMS.includes(arm)) {
    throw new Error(`the arm must be before or after, got ${arm}`);
  }
  return 2 * (pair - 1) + (arm === firstArm ? 1 : 2);
}

// Whether the control runs before the cold attach inside the run of this index: true for an odd index.
export function controlFirst(runIndex: number): boolean {
  if (!Number.isInteger(runIndex) || runIndex < 1) {
    throw new Error(`the run index must be an integer of at least 1, got ${String(runIndex)}`);
  }
  return runIndex % 2 === 1;
}

// ---- Run validity ----------------------------------------------------------------------------------------------------------------

function fail(rule: ValidityRule, reason: string): RunValidity {
  return { valid: false, rule, reason };
}

// The windows a run has, each with the name its reasons use: the cold window first, then the control serving window.
function windowsOf(input: ValidityInput): (readonly [name: string, window: WindowObservation])[] {
  return input.cold === null ? [["control window", input.control]] : [["cold window", input.cold], ["control window", input.control]];
}

// V0, V1, V2 and V5, in that order. A lost reading is a V0 refusal and is read only when the mechanics held (a run that never reached
// its window has no readings to lose, and V1 is the first failed rule there).
export function mechanicalValidity(input: ValidityInput): RunValidity {
  if (input.refusal !== null) {
    return fail("V0", `refused: ${input.refusal}`);
  }
  if (!input.mechanicsHeld) {
    return fail("V1", "the mechanics of the arm test did not hold");
  }
  const windows = windowsOf(input);
  for (const [name, window] of windows) {
    if (input.tier === TIER_SCOPED && window.scopeStallShare === null) {
      return fail("V0", `refused: the scope pressure reading of the ${name} was lost`);
    }
    if (window.runqShare === null) {
      return fail("V0", `refused: the run-queue reading of the ${name} was lost`);
    }
  }
  for (const [name, window] of windows) {
    if (window.probeGapMaxMs > PROBE_DRIVER_GAP_MAX_MS) {
      return fail("V2", `the probe driver left a gap of ${String(window.probeGapMaxMs)} ms between sends in the ${name}, above ${String(PROBE_DRIVER_GAP_MAX_MS)} ms`);
    }
  }
  // The coverage of the cold window; a calibration control has no cold window, so its own window stands in.
  const covered = input.cold ?? input.control;
  if (covered.coverage < ATTRIBUTION_COVERAGE_MIN) {
    return fail("V5", `${String(covered.coverage)} of the window probes are attributed, below ${String(ATTRIBUTION_COVERAGE_MIN)}`);
  }
  return { valid: true };
}

// The whole validity: the mechanical rules, then V3 for each window and V4 for the control, with the four calibrated bounds.
export function runValidity(input: ValidityInput, bounds: Bounds): RunValidity {
  const mechanical = mechanicalValidity(input);
  if (!mechanical.valid) {
    return mechanical;
  }
  for (const [name, window] of windowsOf(input)) {
    if (input.tier === TIER_SCOPED) {
      if (bounds.stallShareMax === null) {
        return fail("V3", "the scoped tier has no stall share bound");
      }
      if (window.scopeStallShare !== null && window.scopeStallShare > bounds.stallShareMax) {
        return fail("V3", `the scope stall share of the ${name} was ${String(window.scopeStallShare)}, above ${String(bounds.stallShareMax)}`);
      }
    }
    if (window.runqShare !== null && window.runqShare > bounds.runqShareMax) {
      return fail("V3", `the main thread run-queue share of the ${name} was ${String(window.runqShare)}, above ${String(bounds.runqShareMax)}`);
    }
  }
  const control = input.control.self;
  if (control.maxMs > bounds.controlSelfMaxMs) {
    return fail("V4", `the control self-inflicted maximum was ${String(control.maxMs)} ms, above ${String(bounds.controlSelfMaxMs)} ms`);
  }
  if (control.p95Ms > bounds.controlSelfP95Ms) {
    return fail("V4", `the control self-inflicted 95th percentile was ${String(control.p95Ms)} ms, above ${String(bounds.controlSelfP95Ms)} ms`);
  }
  return { valid: true };
}

// ---- The derivation of the calibrated bounds -------------------------------------------------------------------------------------

// One mechanically valid calibration control.
export interface CalibrationControl {
  readonly tier: Tier;
  readonly self: LatencySummary;
  readonly scopeStallShare: number | null;
  readonly runqShare: number;
}

export type BoundsDerivation =
  | { readonly derivable: true; readonly bounds: Bounds; readonly passing: number; readonly total: number }
  | { readonly derivable: false; readonly reason: string };

function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step - 1e-9) * step;
}

export function deriveBounds(controls: readonly CalibrationControl[]): BoundsDerivation {
  const total = controls.length;
  const passing = controls.filter((control) => responsivenessProblems(control.self).length === 0);
  if (passing.length < CALIBRATION_MIN_PASSING) {
    return { derivable: false, reason: `${String(passing.length)} of ${String(total)} calibration controls met the thresholds, fewer than ${String(CALIBRATION_MIN_PASSING)}` };
  }
  const tiers = new Set(controls.map((control) => control.tier));
  const tier = passing[0]?.tier;
  if (tiers.size !== 1 || tier === undefined) {
    throw new Error("the calibration controls must all carry one tier");
  }
  const maxBound = Math.max(MAX_LATENCY_MS, roundUpTo(nearestRankOf(controls.map((control) => control.self.maxMs), CONTROL_BOUND_QUANTILE), BOUND_ROUND_MS));
  const p95Bound = Math.max(P95_LATENCY_MS, roundUpTo(nearestRankOf(controls.map((control) => control.self.p95Ms), CONTROL_BOUND_QUANTILE), BOUND_ROUND_MS));
  if (maxBound > CONTROL_BOUND_CAP_FACTOR * MAX_LATENCY_MS) {
    return { derivable: false, reason: `the control maximum bound would be ${String(maxBound)} ms, above the cap of ${String(CONTROL_BOUND_CAP_FACTOR * MAX_LATENCY_MS)} ms` };
  }
  if (p95Bound > CONTROL_BOUND_CAP_FACTOR * P95_LATENCY_MS) {
    return { derivable: false, reason: `the control 95th percentile bound would be ${String(p95Bound)} ms, above the cap of ${String(CONTROL_BOUND_CAP_FACTOR * P95_LATENCY_MS)} ms` };
  }
  const runqShareMax = nearestRankOf(passing.map((control) => control.runqShare), CONTENTION_QUANTILE);
  const stallShares = passing.flatMap((control) => (control.scopeStallShare === null ? [] : [control.scopeStallShare]));
  let stallShareMax: number | null = null;
  if (tier === TIER_SCOPED) {
    if (stallShares.length === 0) {
      return { derivable: false, reason: "no passing calibration control has a scope stall share, so the scoped bound has no basis" };
    }
    stallShareMax = nearestRankOf(stallShares, CONTENTION_QUANTILE);
  }
  return { derivable: true, bounds: { stallShareMax, runqShareMax, controlSelfMaxMs: maxBound, controlSelfP95Ms: p95Bound }, passing: passing.length, total };
}

// ---- The cause table -------------------------------------------------------------------------------------------------------------

export type RunCause = "omp-own" | "extension-on-cpu" | "extension-wait" | "unattributed";
export type WindowCause = RunCause | "mixed";

// The cause of a run that breaches on its self-inflicted window summary.
export function causeOfRun(run: RunObservation): RunCause {
  if (responsivenessProblems(run.control.self).length > 0) {
    return "omp-own";
  }
  const cause: StallCause = run.cold.stallSet.cause;
  switch (cause) {
    case "on-cpu":
      return "extension-on-cpu";
    case "sleep":
      return "extension-wait";
    case "mixed":
    case "unattributed":
      return "unattributed";
    case "none":
      // A latency breach always has a probe above the 95th percentile threshold, so its stall set is never empty. Only a shortness
      // problem (too few probes, a short window) can breach with an empty set; it names no stall and stays unattributed.
      if (latencyProblems(run.cold.self).length > 0) {
        throw new Error(`run ${String(run.runIndex)} breaches on latency but has an empty stall set: an inconsistent observation`);
      }
      return "unattributed";
  }
}

// The cause shared by more than half of the breaching runs, else mixed (also for an empty list: nothing is shared).
export function windowCause(causes: readonly RunCause[]): WindowCause {
  const counts = new Map<RunCause, number>();
  for (const cause of causes) {
    counts.set(cause, (counts.get(cause) ?? 0) + 1);
  }
  for (const [cause, count] of counts) {
    if (count > causes.length / 2) {
      return cause;
    }
  }
  return "mixed";
}

// ---- The verdict table -----------------------------------------------------------------------------------------------------------

export type VerdictOutcome = "PASS" | "FINDING" | "NOT-REPRODUCED" | "VOID";

export interface VerdictRun {
  readonly runIndex: number;
  readonly arm: Arm;
  readonly pair: number;
  readonly validity: RunValidity;
  readonly rawMaxMs: number;
  readonly rawP95Ms: number;
  readonly selfMaxMs: number;
  readonly selfP95Ms: number;
  readonly stallCause: StallCause;
  // The thresholds exceeded on the self-inflicted summary, on the raw summary only, or not at all; null for an invalid run.
  readonly breach: "self" | "raw" | null;
  // The cause of a run that breaches on its self-inflicted summary; null otherwise.
  readonly cause: RunCause | null;
}

export interface Verdict {
  readonly outcome: VerdictOutcome;
  // One line that names the numbers the rule used.
  readonly reason: string;
  readonly runs: readonly VerdictRun[];
  readonly validRuns: number;
  // The tier of the runs; null when there are none.
  readonly tier: Tier | null;
  // The cause of a FINDING; null for every other outcome.
  readonly windowCause: WindowCause | null;
  readonly quietClaim: false;
}

function tierOf(runs: readonly RunObservation[]): Tier | null {
  const tiers = new Set(runs.map((run) => run.tier));
  if (tiers.size > 1) {
    throw new Error("the runs of one window must all carry one tier");
  }
  return runs[0]?.tier ?? null;
}

// The verdict of the window from its AFTER-arm run observations and the four calibrated bounds (null while they are unset).
export function decideVerdict(runs: readonly RunObservation[], bounds: Bounds | null): Verdict {
  const tier = tierOf(runs);
  const base = { tier, quietClaim: false } as const;
  if (bounds === null) {
    return { ...base, outcome: "VOID", reason: "uncalibrated: the four calibrated constants are not frozen, so no verdict is possible", runs: [], validRuns: 0, windowCause: null };
  }
  const rows: VerdictRun[] = [];
  const valid: RunObservation[] = [];
  const selfBreaches: RunObservation[] = [];
  let rawBreaches = 0;
  for (const run of runs) {
    const validity = runValidity(run, bounds);
    const row = { runIndex: run.runIndex, arm: run.arm, pair: run.pair, validity, rawMaxMs: run.cold.raw.maxMs, rawP95Ms: run.cold.raw.p95Ms, selfMaxMs: run.cold.self.maxMs, selfP95Ms: run.cold.self.p95Ms, stallCause: run.cold.stallSet.cause };
    if (!validity.valid) {
      rows.push({ ...row, breach: null, cause: null });
      continue;
    }
    valid.push(run);
    if (responsivenessProblems(run.cold.self).length > 0) {
      selfBreaches.push(run);
      rows.push({ ...row, breach: "self", cause: causeOfRun(run) });
    } else if (responsivenessProblems(run.cold.raw).length > 0) {
      rawBreaches += 1;
      rows.push({ ...row, breach: "raw", cause: null });
    } else {
      rows.push({ ...row, breach: null, cause: null });
    }
  }
  const common = { ...base, runs: rows, validRuns: valid.length };
  if (valid.length < MIN_VERDICT_RUNS) {
    return { ...common, outcome: "VOID", reason: `${String(valid.length)} valid runs, fewer than ${String(MIN_VERDICT_RUNS)}: no verdict`, windowCause: null };
  }
  if (selfBreaches.length >= FINDING_MIN_BREACH_RUNS) {
    const cause = windowCause(rows.flatMap((row) => (row.cause === null ? [] : [row.cause])));
    return { ...common, outcome: "FINDING", reason: `${String(selfBreaches.length)} of ${String(valid.length)} valid runs exceed the thresholds on the self-inflicted latency; window cause ${cause}`, windowCause: cause };
  }
  if (rawBreaches > 0) {
    return { ...common, outcome: "NOT-REPRODUCED", reason: `no valid run exceeds the thresholds on the self-inflicted latency; ${String(rawBreaches)} of ${String(valid.length)} exceed them on the raw latency`, windowCause: null };
  }
  return { ...common, outcome: "PASS", reason: `${String(valid.length)} valid runs, none exceeds the thresholds on the self-inflicted or the raw latency`, windowCause: null };
}
