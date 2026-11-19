// The frozen decision rule of the paired loaded A/B of the Omp cold attach (Phase 44, OMPR-06; 44-CONTEXT D-44-06 and D-44-07). Pure: no
// process, no clock, no environment, no file. The paired arm test of test/integration/omp-responsiveness.test.ts measures one arm of one
// pair and writes a record and two samples files; this module turns the samples and the ready times of a window into the metrics of each
// run, the validity of each pair and the outcome of the window. The hermetic test is test/support/paired-ab.test.ts.
//
// The rule is frozen. It was written, tested and merged before any paired number existed, and no constant or row below is edited after
// one does: a wrong rule is a finding and a replan, never a silent edit.
//
// Per run (all times in ms from process start of that run), from its control run (Omp with no extension) and its cold run (Omp with the
// extension): X is the cold first answer minus the control first answer (the boot excess); X1 is cold ready minus control ready (the
// before-ready part); X2 is the cold after-ready lag minus the control after-ready lag, so X equals X1 plus X2; S is the serving stall:
// the largest cold latency among probes sent at or after the cold first answer (an unanswered probe counts as the answer timeout) minus
// the largest control latency among probes sent from the control first answer to SERVING_CONTROL_WINDOW_MS after it, never below 0.
//
// A pair is valid when both runs are valid by the run validity of D-45-06 of 45-CONTEXT (test/support/omp-verdict.ts: scoped contention and
// run-queue delay of the Omp tree, never the host load average, which is not read here) and both have metrics. The first failed condition
// is the reason: the before run, then the after run, each naming its failed rule.
//
// The outcome of the window, over its N valid pairs, with mB the median of X over the BEFORE runs and the gain of a pair X(before) minus
// X(after); the first row that holds, in this order:
//   VOID            N is below MIN_VALID_PAIRS.
//   NOT-REPRODUCED  mB is at most REPRODUCTION_MIN_MS: the BEFORE build did not show the excess, so no improvement can be measured.
//   REGRESSION      the median X(after) exceeds mB by more than GAIN_MIN_MS; or the median S(after) exceeds the median S(before) by more than
//                   STALL_TOLERANCE_MS; or more than floor(REGRESS_PAIR_FRACTION * N) pairs have S(after) above S(before) by more than
//                   STALL_TOLERANCE_MS.
//   EFFECT          at least ceil(GAIN_PAIR_FRACTION * N) pairs have a gain of at least GAIN_MIN_MS, and the median gain is at least
//                   GAIN_MEDIAN_SHARE of mB.
//   NO-EFFECT       none of the above.
// No outcome claims a quiet host or closes OI-11: every result carries the fixed label PAIRED_LABEL and a quietClaim that is always false.
//
// Exports: constants (MIN_VALID_PAIRS, MAX_PAIR_ATTEMPTS, SERVING_CONTROL_WINDOW_MS, REPRODUCTION_MIN_MS, GAIN_MIN_MS, GAIN_PAIR_FRACTION,
// GAIN_MEDIAN_SHARE, STALL_TOLERANCE_MS, REGRESS_PAIR_FRACTION, PAIR_ANSWER_TIMEOUT_MS, PAIRED_LABEL), types (RunInput, RunMetrics,
// RunMetricsResult, ArmRun, PairInput, PairValidity, PairOutcome, PairRow, ArmMedians, PairedDecision), parseSamplesCsv, runMetrics,
// pairValid, decidePairs.
//
// Phase 45 (45-CONTEXT D-45-10): the pair validity predicate stopped reading the load average (finding F-44-01) and reads the run validity
// of both arms; PAIR_LOAD_CEILING_PER_CPU, PAIR_LOAD_GAP_PER_CPU and the load fields of ArmRun are removed, and MAX_PAIR_ATTEMPTS is 12.
// The metrics X, X1, X2 and S and the outcome table are unchanged.

import { firstAnswerMs } from "./responsiveness-decision.js";
import type { RunValidity } from "./omp-verdict.js";
import type { ProbeSample } from "./responsiveness.js";

export const MIN_VALID_PAIRS = 5;
export const MAX_PAIR_ATTEMPTS = 12;
// The control's serving window after its first answer.
export const SERVING_CONTROL_WINDOW_MS = 5000;
// One probe interval: the BEFORE arm must show at least this median excess for an effect to be measurable.
export const REPRODUCTION_MIN_MS = 250;
export const GAIN_MIN_MS = 250;
export const GAIN_PAIR_FRACTION = 0.8;
export const GAIN_MEDIAN_SHARE = 0.5;
export const STALL_TOLERANCE_MS = 250;
export const REGRESS_PAIR_FRACTION = 0.2;
// The answer timeout of the harness probe (an unanswered probe counts as this latency in S).
export const PAIR_ANSWER_TIMEOUT_MS = 10_000;
// The only label a paired number carries. It is never a quiet-host measurement.
export const PAIRED_LABEL = "loaded, paired";

// The tolerance for a product like 0.8 * 5 that lands a hair off an integer.
const EPSILON = 1e-9;

// One run's samples with the time of its ready frame from process start (undefined when the frame was not seen).
export interface RunInput {
  readonly samples: readonly ProbeSample[];
  readonly readyMs: number | undefined;
}

export interface RunMetrics {
  readonly x: number;
  readonly x1: number;
  readonly x2: number;
  readonly s: number;
}

export type RunMetricsResult = { readonly valid: true; readonly metrics: RunMetrics } | { readonly valid: false; readonly reason: string };

// Splits the lines of a samples CSV (samplesCsv or samplesCsvWithPhase) back into samples. A malformed header or line is an error.
export function parseSamplesCsv(text: string): ProbeSample[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  const header = lines.shift();
  if (header !== "sentAtMs,latencyMs" && header !== "sentAtMs,latencyMs,phase") {
    throw new Error(`the samples header is not sentAtMs,latencyMs[,phase]: ${JSON.stringify(header)}`);
  }
  const columns = header === "sentAtMs,latencyMs" ? 2 : 3;
  return lines.map((line, index) => {
    const fields = line.split(",");
    const sent = fields[0] ?? "";
    const latency = fields[1] ?? "";
    const phase = fields[2];
    const phaseOk = columns === 2 || phase === "boot" || phase === "window";
    if (fields.length !== columns || !/^\d+$/.test(sent) || !/^(\d+)?$/.test(latency) || !phaseOk) {
      throw new Error(`malformed samples line ${String(index + 2)}: ${JSON.stringify(line)}`);
    }
    return { sentAtMs: Number(sent), latencyMs: latency === "" ? undefined : Number(latency) };
  });
}

// The largest latency among the samples sent in [fromMs, toMs] (toMs optional: no upper bound). An unanswered probe counts as
// unansweredMs, or is skipped when that is undefined. Zero when no sample qualifies.
function largestLatency(samples: readonly ProbeSample[], fromMs: number, toMs: number | undefined, unansweredMs: number | undefined): number {
  let largest = 0;
  for (const sample of samples) {
    if (sample.sentAtMs < fromMs || (toMs !== undefined && sample.sentAtMs > toMs)) {
      continue;
    }
    const latency = sample.latencyMs ?? unansweredMs;
    if (latency !== undefined && latency > largest) {
      largest = latency;
    }
  }
  return largest;
}

// The metrics of one run from its control and its cold run, or the reason it has none: a missing first answer or ready time in either
// part makes the run invalid.
export function runMetrics(control: RunInput, cold: RunInput): RunMetricsResult {
  const controlFirst = firstAnswerMs(control.samples);
  if (controlFirst === undefined) {
    return { valid: false, reason: "the control has no first answer" };
  }
  const coldFirst = firstAnswerMs(cold.samples);
  if (coldFirst === undefined) {
    return { valid: false, reason: "the cold run has no first answer" };
  }
  if (control.readyMs === undefined) {
    return { valid: false, reason: "the control has no ready time" };
  }
  if (cold.readyMs === undefined) {
    return { valid: false, reason: "the cold run has no ready time" };
  }
  const x = coldFirst - controlFirst;
  const x1 = cold.readyMs - control.readyMs;
  const x2 = coldFirst - cold.readyMs - (controlFirst - control.readyMs);
  const coldServing = largestLatency(cold.samples, coldFirst, undefined, PAIR_ANSWER_TIMEOUT_MS);
  const controlServing = largestLatency(control.samples, controlFirst, controlFirst + SERVING_CONTROL_WINDOW_MS, undefined);
  return { valid: true, metrics: { x, x1, x2, s: Math.max(0, coldServing - controlServing) } };
}

// One arm of one pair: its control and cold runs and the run validity of D-45-06 (a refusal, the mechanics, the probe driver, the scoped
// contention, the baseline and the attribution coverage), computed from the arm's readings by test/support/omp-verdict.ts.
export interface ArmRun {
  readonly control: RunInput;
  readonly cold: RunInput;
  readonly validity: RunValidity;
}

export interface PairInput {
  readonly pair: number;
  readonly before: ArmRun;
  readonly after: ArmRun;
}

export type PairValidity =
  | { readonly valid: true; readonly before: RunMetrics; readonly after: RunMetrics }
  | { readonly valid: false; readonly reason: string };

function armProblem(arm: ArmRun, name: string): string | undefined {
  if (!arm.validity.valid) {
    return `the ${name} run is not valid by ${arm.validity.rule}: ${arm.validity.reason}`;
  }
  const metrics = runMetrics(arm.control, arm.cold);
  return metrics.valid ? undefined : `the ${name} run is not valid: ${metrics.reason}`;
}

// Whether the pair counts, and its metrics when it does. The first failed condition is the reason: the BEFORE run, then the AFTER run.
export function pairValid(input: PairInput): PairValidity {
  const beforeProblem = armProblem(input.before, "before");
  if (beforeProblem !== undefined) {
    return { valid: false, reason: beforeProblem };
  }
  const afterProblem = armProblem(input.after, "after");
  if (afterProblem !== undefined) {
    return { valid: false, reason: afterProblem };
  }
  // Both arms passed armProblem, so both have metrics.
  const before = runMetrics(input.before.control, input.before.cold);
  const after = runMetrics(input.after.control, input.after.cold);
  if (!before.valid || !after.valid) {
    throw new Error("a pair passed its validity checks but has no metrics");
  }
  return { valid: true, before: before.metrics, after: after.metrics };
}

export type PairOutcome = "VOID" | "NOT-REPRODUCED" | "REGRESSION" | "EFFECT" | "NO-EFFECT";

export interface PairRow {
  readonly pair: number;
  readonly before: RunMetrics;
  readonly after: RunMetrics;
  // X(before) minus X(after).
  readonly gainMs: number;
  // S(after) minus S(before).
  readonly stallChangeMs: number;
}

export interface ArmMedians {
  readonly x: number;
  readonly x1: number;
  readonly x2: number;
  readonly s: number;
}

export interface PairedDecision {
  readonly outcome: PairOutcome;
  // One line that names the numbers the rule used.
  readonly reason: string;
  readonly label: typeof PAIRED_LABEL;
  readonly quietClaim: false;
  readonly validPairs: number;
  readonly rows: readonly PairRow[];
  readonly invalid: readonly { readonly pair: number; readonly reason: string }[];
  // Descriptive, not gating; null when there is no valid pair.
  readonly medians: { readonly before: ArmMedians; readonly after: ArmMedians } | null;
}

// The median of a non-empty list: the middle value, or the mean of the two middle values for an even count.
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

function armMedians(metrics: readonly RunMetrics[]): ArmMedians {
  return { x: median(metrics.map((m) => m.x)), x1: median(metrics.map((m) => m.x1)), x2: median(metrics.map((m) => m.x2)), s: median(metrics.map((m) => m.s)) };
}

// The outcome of the window from its pair attempts, in the order they ran. Invalid pairs are listed with their reasons and counted for
// nothing; every valid pair is counted. More than MAX_PAIR_ATTEMPTS attempts is an error.
export function decidePairs(pairs: readonly PairInput[]): PairedDecision {
  if (pairs.length > MAX_PAIR_ATTEMPTS) {
    throw new Error(`a window makes at most ${String(MAX_PAIR_ATTEMPTS)} pair attempts, got ${String(pairs.length)}`);
  }
  const rows: PairRow[] = [];
  const invalid: { pair: number; reason: string }[] = [];
  for (const input of pairs) {
    const validity = pairValid(input);
    if (validity.valid) {
      rows.push({ pair: input.pair, before: validity.before, after: validity.after, gainMs: validity.before.x - validity.after.x, stallChangeMs: validity.after.s - validity.before.s });
    } else {
      invalid.push({ pair: input.pair, reason: validity.reason });
    }
  }
  const n = rows.length;
  const base: Pick<PairedDecision, "label" | "quietClaim" | "validPairs" | "rows" | "invalid"> = { label: PAIRED_LABEL, quietClaim: false, validPairs: n, rows, invalid };
  if (n < MIN_VALID_PAIRS) {
    return { ...base, outcome: "VOID", reason: `${String(n)} valid pairs, fewer than ${String(MIN_VALID_PAIRS)}: no effect claim`, medians: n === 0 ? null : { before: armMedians(rows.map((r) => r.before)), after: armMedians(rows.map((r) => r.after)) } };
  }
  const before = armMedians(rows.map((r) => r.before));
  const after = armMedians(rows.map((r) => r.after));
  const medians = { before, after };
  const mB = before.x;
  if (mB <= REPRODUCTION_MIN_MS) {
    return { ...base, medians, outcome: "NOT-REPRODUCED", reason: `the median boot excess of the before runs is ${String(mB)} ms, at most ${String(REPRODUCTION_MIN_MS)} ms over ${String(n)} valid pairs` };
  }
  const worseStall = rows.filter((r) => r.stallChangeMs > STALL_TOLERANCE_MS).length;
  const worseLimit = Math.floor(REGRESS_PAIR_FRACTION * n + EPSILON);
  if (after.x - mB > GAIN_MIN_MS) {
    return { ...base, medians, outcome: "REGRESSION", reason: `the median boot excess of the after runs is ${String(after.x)} ms, above the before median ${String(mB)} ms by more than ${String(GAIN_MIN_MS)} ms` };
  }
  if (after.s - before.s > STALL_TOLERANCE_MS) {
    return { ...base, medians, outcome: "REGRESSION", reason: `the median serving stall of the after runs is ${String(after.s)} ms, above the before median ${String(before.s)} ms by more than ${String(STALL_TOLERANCE_MS)} ms` };
  }
  if (worseStall > worseLimit) {
    return { ...base, medians, outcome: "REGRESSION", reason: `${String(worseStall)} of ${String(n)} pairs have a serving stall worse by more than ${String(STALL_TOLERANCE_MS)} ms, above the limit ${String(worseLimit)}` };
  }
  const gained = rows.filter((r) => r.gainMs >= GAIN_MIN_MS).length;
  const gainedNeeded = Math.ceil(GAIN_PAIR_FRACTION * n - EPSILON);
  const medianGain = median(rows.map((r) => r.gainMs));
  const numbers = `${String(gained)} of ${String(n)} pairs gained at least ${String(GAIN_MIN_MS)} ms (${String(gainedNeeded)} needed), median gain ${String(medianGain)} ms against a before median ${String(mB)} ms`;
  if (gained >= gainedNeeded && medianGain >= GAIN_MEDIAN_SHARE * mB) {
    return { ...base, medians, outcome: "EFFECT", reason: numbers };
  }
  return { ...base, medians, outcome: "NO-EFFECT", reason: numbers };
}
