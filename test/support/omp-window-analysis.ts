// The recomputation of a window or of a calibration from its records and CSVs (Phase 45, OMPV-03 to OMPV-06; 45-CONTEXT D-45-06 to D-45-10).
// Pure: no file, no process, no clock; the caller reads the files and passes their text. The live tests write a record and four CSVs per arm
// run (the samples and the readings of the control and of the cold attach) and a record and two CSVs per calibration control; this module
// recomputes every number of a record from its CSVs with the same functions that built it, compares it with the number in the record (a
// difference is an error naming the field, never reconciled), and applies the decision code: the validity of each run, the verdict over
// the AFTER-arm runs, the paired decision over the pairs, and for a calibration the per-control table, the derived bounds and the digest
// plan 45-04 freezes them against. The hermetic test is test/support/omp-window-analysis.test.ts.
//
// Exports: WindowAttempt, AttemptRow, WindowAnalysis, CalibrationAttempt, CalibrationRow, CalibrationAnalysis, analyseWindow,
// analyseCalibration.

import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { observeWindow, type WindowObservation } from "./omp-contention.js";
import { type CalibrationRecord, parseReadingsCsv, type PartRecord, type RunRecord } from "./omp-arm-run.js";
import {
  type Arm,
  type Bounds,
  type BoundsDerivation,
  type CalibrationControl,
  decideVerdict,
  deriveBounds,
  mechanicalValidity,
  type RunObservation,
  runIndexOf,
  runValidity,
  type RunValidity,
  type ValidityInput,
  type Verdict,
} from "./omp-verdict.js";
import { type ArmRun, decidePairs, PAIR_ANSWER_TIMEOUT_MS, type PairedDecision, type PairInput, parseSamplesCsv, runMetrics } from "./paired-ab.js";
import { firstAnswerMs } from "./responsiveness-decision.js";
import type { ProbeSample } from "./responsiveness.js";

// ---- Recomputing one part --------------------------------------------------------------------------------------------------------

const OBSERVATION_FIELDS = ["raw", "self", "scopeStallShare", "runqShare", "coverage", "probeGapMaxMs", "stallSet"] as const;

// The observation of a part recomputed from its two CSVs, checked field by field against the record. A difference is an error.
function recomputePart(what: string, record: PartRecord, samples: readonly ProbeSample[], readingsCsv: string): WindowObservation {
  const observation = observeWindow({ samples, readings: parseReadingsCsv(readingsCsv), readyMs: record.readyMs ?? undefined, answerTimeoutMs: PAIR_ANSWER_TIMEOUT_MS });
  for (const field of OBSERVATION_FIELDS) {
    if (!isDeepStrictEqual(record[field], observation[field])) {
      throw new Error(`${what}: the ${field} of the record differs from the one recomputed from its CSVs`);
    }
  }
  const first = firstAnswerMs(samples) ?? null;
  if (record.firstAnswerMs !== first) {
    throw new Error(`${what}: the firstAnswerMs of the record (${String(record.firstAnswerMs)}) differs from the CSVs (${String(first)})`);
  }
  return observation;
}

function validityOf(input: ValidityInput, bounds: Bounds | null): RunValidity {
  return bounds === null ? mechanicalValidity(input) : runValidity(input, bounds);
}

// ---- A window --------------------------------------------------------------------------------------------------------------------

// One arm run as written by the live test: the record and the text of its four CSVs.
export interface WindowAttempt {
  readonly record: RunRecord;
  readonly controlSamplesCsv: string;
  readonly coldSamplesCsv: string;
  readonly controlReadingsCsv: string;
  readonly coldReadingsCsv: string;
}

export interface AttemptRow {
  readonly pair: number;
  readonly arm: Arm;
  readonly runIndex: number;
  // The validity recomputed with the supplied bounds (the mechanical rules only while they are null).
  readonly validity: RunValidity;
}

export interface WindowAnalysis {
  readonly verdict: Verdict;
  readonly paired: PairedDecision;
  readonly attempts: readonly AttemptRow[];
  // The pairs that have only one of their two arms; they count for nothing.
  readonly incompletePairs: readonly number[];
  readonly counts: { readonly attempts: number; readonly validRuns: number; readonly validPairs: number };
}

interface Recomputed {
  readonly observation: RunObservation;
  readonly arm: ArmRun;
}

function recomputeAttempt(attempt: WindowAttempt, bounds: Bounds | null): Recomputed {
  const { record } = attempt;
  const what = `pair ${String(record.pair)} ${record.arm}`;
  if (record.runIndex !== runIndexOf(record.pair, record.arm)) {
    throw new Error(`${what}: the runIndex of the record (${String(record.runIndex)}) is not the one of its pair and arm`);
  }
  const controlSamples = parseSamplesCsv(attempt.controlSamplesCsv);
  const coldSamples = parseSamplesCsv(attempt.coldSamplesCsv);
  const control = recomputePart(`${what}, control`, record.control, controlSamples, attempt.controlReadingsCsv);
  const cold = recomputePart(`${what}, cold`, record.cold, coldSamples, attempt.coldReadingsCsv);
  const controlRun = { samples: controlSamples, readyMs: record.control.readyMs ?? undefined };
  const coldRun = { samples: coldSamples, readyMs: record.cold.readyMs ?? undefined };
  const metrics = runMetrics(controlRun, coldRun);
  if (!isDeepStrictEqual(record.metrics, metrics.valid ? metrics.metrics : null)) {
    throw new Error(`${what}: the metrics of the record differ from the ones recomputed from its CSVs`);
  }
  if (!metrics.valid && record.mechanics) {
    throw new Error(`${what}: the record says the mechanics held but its CSVs have no metrics (${metrics.reason})`);
  }
  const observation: RunObservation = { arm: record.arm, pair: record.pair, runIndex: record.runIndex, tier: record.tier, refusal: record.refusal, mechanicsHeld: record.mechanics, control, cold };
  return { observation, arm: { control: controlRun, cold: coldRun, validity: validityOf(observation, bounds) } };
}

// The verdict, the paired decision and the list of attempts of a window, recomputed from its records and CSVs with the supplied bounds
// (null while they are unset: the verdict is then VOID, uncalibrated, and the validity is the mechanical rules only).
export function analyseWindow(attempts: readonly WindowAttempt[], bounds: Bounds | null): WindowAnalysis {
  const seen = new Set<string>();
  const recomputed = attempts.map((attempt) => {
    const key = `${String(attempt.record.pair)} ${attempt.record.arm}`;
    if (seen.has(key)) {
      throw new Error(`pair ${key} appears twice in the window`);
    }
    seen.add(key);
    return recomputeAttempt(attempt, bounds);
  });
  const rows: AttemptRow[] = recomputed.map(({ observation, arm }) => ({ pair: observation.pair, arm: observation.arm, runIndex: observation.runIndex, validity: arm.validity }));
  const pairNumbers = [...new Set(recomputed.map(({ observation }) => observation.pair))].sort((a, b) => a - b);
  const pairInputs: PairInput[] = [];
  const incompletePairs: number[] = [];
  for (const pair of pairNumbers) {
    const before = recomputed.find(({ observation }) => observation.pair === pair && observation.arm === "before");
    const after = recomputed.find(({ observation }) => observation.pair === pair && observation.arm === "after");
    if (before === undefined || after === undefined) {
      incompletePairs.push(pair);
    } else {
      pairInputs.push({ pair, before: before.arm, after: after.arm });
    }
  }
  const afterRuns = recomputed.filter(({ observation }) => observation.arm === "after").map(({ observation }) => observation).sort((a, b) => a.runIndex - b.runIndex);
  const verdict = decideVerdict(afterRuns, bounds);
  const paired = decidePairs(pairInputs);
  return {
    verdict,
    paired,
    attempts: rows,
    incompletePairs,
    counts: { attempts: rows.length, validRuns: rows.filter((row) => row.validity.valid).length, validPairs: paired.validPairs },
  };
}

// ---- A calibration ---------------------------------------------------------------------------------------------------------------

// One calibration control as written by the live test: the record and the text of its two CSVs.
export interface CalibrationAttempt {
  readonly record: CalibrationRecord;
  readonly samplesCsv: string;
  readonly readingsCsv: string;
}

export interface CalibrationRow {
  readonly attempt: number;
  // The mechanical validity recomputed; only valid controls enter the derivation, the count and the digest.
  readonly validity: RunValidity;
  readonly selfMaxMs: number;
  readonly selfP95Ms: number;
  readonly scopeStallShare: number | null;
  readonly runqShare: number | null;
  // The main thread's share of the process on-CPU time recomputed from the thread split; null when the control has no split.
  readonly mainShare: number | null;
  // Whether the thread whose id equals the pid carries the largest on-CPU share (a tie counts).
  readonly mainIsBusiest: boolean;
}

export interface CalibrationAnalysis {
  readonly controls: readonly CalibrationRow[];
  // How many of the mechanically valid controls have the main thread as their busiest thread (the freeze precondition of D-45-08).
  readonly mainBusiestCount: number;
  readonly validControls: number;
  readonly derivation: BoundsDerivation;
  // The sha256 of the canonical text of the mechanically valid controls, one line each in attempt order, so the freeze names the calibration.
  readonly digest: string;
}

function mainShareOf(what: string, record: PartRecord): { readonly share: number | null; readonly busiest: boolean } {
  const threads = record.threads;
  if (threads === null) {
    return { share: null, busiest: false };
  }
  const main = threads.tasks.find((task) => task.tid === threads.mainTid);
  if (main === undefined) {
    throw new Error(`${what}: the thread split has no task with the main thread id`);
  }
  const total = threads.tasks.reduce((sum, task) => sum + task.onCpuNs, 0);
  const share = total === 0 ? 0 : main.onCpuNs / total;
  if (share !== threads.mainShare) {
    throw new Error(`${what}: the mainShare of the record (${String(threads.mainShare)}) differs from the thread split (${String(share)})`);
  }
  return { share, busiest: threads.tasks.every((task) => task.onCpuNs <= main.onCpuNs) };
}

// The per-control table, the bounds derived from the valid controls and the digest of a calibration, recomputed from its records and CSVs.
export function analyseCalibration(attempts: readonly CalibrationAttempt[]): CalibrationAnalysis {
  const ordered = [...attempts].sort((a, b) => a.record.attempt - b.record.attempt);
  const seen = new Set<number>();
  const controls: CalibrationRow[] = [];
  const derived: CalibrationControl[] = [];
  const lines: string[] = [];
  let mainBusiestCount = 0;
  for (const { record, samplesCsv, readingsCsv } of ordered) {
    const what = `calibration control ${String(record.attempt)}`;
    if (seen.has(record.attempt)) {
      throw new Error(`${what} appears twice`);
    }
    seen.add(record.attempt);
    const samples = parseSamplesCsv(samplesCsv);
    const control = recomputePart(what, record.control, samples, readingsCsv);
    if (record.mechanics && record.control.readyMs === null) {
      throw new Error(`${what}: the record says the mechanics held but it has no ready time`);
    }
    const validity = mechanicalValidity({ tier: record.tier, refusal: record.refusal, mechanicsHeld: record.mechanics, control, cold: null });
    const main = mainShareOf(what, record.control);
    controls.push({ attempt: record.attempt, validity, selfMaxMs: control.self.maxMs, selfP95Ms: control.self.p95Ms, scopeStallShare: control.scopeStallShare, runqShare: control.runqShare, mainShare: main.share, mainIsBusiest: main.busiest });
    if (validity.valid && control.runqShare !== null) {
      derived.push({ tier: record.tier, self: control.self, scopeStallShare: control.scopeStallShare, runqShare: control.runqShare });
      if (main.busiest) {
        mainBusiestCount += 1;
      }
      lines.push([record.attempt, control.self.sent, control.self.maxMs, control.self.p95Ms, control.scopeStallShare ?? "null", control.runqShare, main.share ?? "null"].map(String).join(" "));
    }
  }
  const digest = createHash("sha256").update(`${lines.join("\n")}\n`).digest("hex");
  return { controls, mainBusiestCount, validControls: derived.length, derivation: deriveBounds(derived), digest };
}
