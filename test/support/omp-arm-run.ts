// The live half of one Omp arm run, kept testable (Phase 45, OMPV-03 and OMPV-04; 45-CONTEXT D-45-03, D-45-05 and D-45-06): the scope
// wrapper, the contention sampler, the thread split, the check that the sampled process is the scoped Omp and not the wrapper, the
// readings CSV, and the record of one run. Nothing here starts a process: the process id, the file reader and the clock are injected, so the
// hermetic test (test/support/omp-arm-run.test.ts) runs on a fake child and a fake /proc. The live test reads real files through
// createFsReader and hands the readers in. node:fs is imported only for that one reader.
//
// The scope (D-45-03). Every Omp process of a window runs through `systemd-run --user --scope --quiet --collect --`, so Omp, the daemon the
// extension starts and anything either starts share one fresh cgroup with the default CPU weight. The scope is identical for both arms and
// both parts of a run, and nothing in it is tuned (no weight, no quota, no pinning): it is a measurement boundary, never a performance
// lever. scopedWrap has one seam, `isolation`, an argv prefix put before the scope command, for a root-assisted CPU step the owner
// approved for the windows (OD-45-1: a cpuset or taskset prefix); the default is none. DESIGN_BRANCH is provisional: 45-DESIGN.md is not
// frozen until plan 45-01 runs the feasibility window, and the branch, the argv and the file names below follow 45-CONTEXT until it is.
//
// Readings. The scope's cumulative "some" pressure total is read from cpu.pressure in the scope's cgroup directory; the main thread's
// on-CPU and run-queue nanoseconds from /proc/PID/task/PID/schedstat. A file that cannot be read is a refusal with a closed phrase, never a
// silent skip. The run record holds numbers, booleans and closed phrases only (the thread command names of the split are the one
// exception: they name threads, not paths): no path, no environment value, no secret.
//
// Exports: DESIGN_BRANCH, SCOPE_RUNNER_ARGV, CGROUP_MOUNT, REFUSAL_PHRASES, HOST_READING_LABELS, ScopeBranch, Refusal, HostReadingLabel,
// ProcReader, ReadResult, ContentionSampler, ThreadTask, ThreadSplit, ThreadSplitResult, ScopeCheck, HostReading, PartRecord, RunRecord,
// CalibrationRecord, PartParts, RunRecordParts, CalibrationParts, createFsReader, scopedWrap, tierOfBranch, createContentionSampler,
// readThreadSplit, verifyScopedChild, readingsCsv, parseReadingsCsv, buildRunRecord, buildCalibrationRecord.

import { readdirSync, readFileSync } from "node:fs";
import {
  type ContentionReading,
  observeWindow,
  parsePressureTotals,
  type PressureTotalsFile,
  type ProcSchedstat,
  parseSchedstat,
  scopeDirOf,
  type WindowObservation,
} from "./omp-contention.js";
import {
  type Arm,
  type Bounds,
  controlFirst,
  mechanicalValidity,
  runIndexOf,
  runValidity,
  type RunValidity,
  TIER_SCOPED,
  TIER_UNSCOPED,
  type Tier,
  type ValidityInput,
  type ValidityRule,
} from "./omp-verdict.js";
import { PAIR_ANSWER_TIMEOUT_MS, PAIRED_LABEL, runMetrics, type RunMetrics } from "./paired-ab.js";
import type { CpuPressure, ProbeSample } from "./responsiveness.js";
import { firstAnswerMs } from "./responsiveness-decision.js";

export type ScopeBranch = "S" | "N";

// The branch of the design: S (a scope is obtained and its pressure file is read). Provisional until 45-DESIGN.md is frozen.
export const DESIGN_BRANCH: ScopeBranch = "S";

// The scope command, ending with the double dash. Nothing is tuned: no property, no weight, no quota.
export const SCOPE_RUNNER_ARGV: readonly string[] = ["systemd-run", "--user", "--scope", "--quiet", "--collect", "--"];

// The mount point of the unified cgroup hierarchy.
export const CGROUP_MOUNT = "/sys/fs/cgroup";

// The closed phrases of a refusal (rule V0).
export const REFUSAL_PHRASES = [
  "scope command failed",
  "child scope could not be verified",
  "sampled process is the wrapper",
  "scope pressure file unreadable",
  "thread schedstat unreadable",
  "task list unreadable",
  "child has no process id",
] as const;
export type Refusal = (typeof REFUSAL_PHRASES)[number];

// The labels of the descriptive host readings (the system pressure and the load per CPU, recorded and never a validity input).
export const HOST_READING_LABELS = ["start", "between", "end"] as const;
export type HostReadingLabel = (typeof HOST_READING_LABELS)[number];

// What the sampler and the checks read of the world: the text of a file and the entries of a directory. A read that fails throws.
export interface ProcReader {
  readText(path: string): string;
  listDir(path: string): readonly string[];
}

// The reader of the live test: the real files.
export function createFsReader(): ProcReader {
  return { readText: (path) => readFileSync(path, "utf8"), listDir: (path) => readdirSync(path) };
}

// The argv prefix for one branch: the scope command for S, nothing for N, then nothing else. `isolation` is put before it (the seam for the
// root-assisted CPU step of OD-45-1) and is empty by default.
export function scopedWrap(branch: ScopeBranch, isolation: readonly string[] = []): readonly string[] {
  switch (branch) {
    case "S":
      return [...isolation, ...SCOPE_RUNNER_ARGV];
    case "N":
      return [...isolation];
    default:
      throw new Error(`the scope branch must be S or N, got ${String(branch satisfies never)}`);
  }
}

export function tierOfBranch(branch: ScopeBranch): Tier {
  return branch === "S" ? TIER_SCOPED : TIER_UNSCOPED;
}

// ---- The sampler -----------------------------------------------------------------------------------------------------------------

export type ReadResult =
  | { readonly ok: true; readonly reading: ContentionReading }
  | { readonly ok: false; readonly refusal: Refusal; readonly label: string };

export interface ContentionSampler {
  // One reading stamped with the clock; a file that cannot be read is a refusal result, never a skipped reading.
  read(label: string): ReadResult;
  // The kept readings in time order (a stable sort: readings stamped alike keep the order they were taken in).
  readings(): readonly ContentionReading[];
  // The first refusal any read met, or null.
  refusal(): Refusal | null;
}

export function createContentionSampler(options: {
  readonly pid: number;
  // The scope's cgroup directory, or null under Branch N.
  readonly scopeDir: string | null;
  readonly reader: ProcReader;
  // The milliseconds from the probe origin, as an integer (the probe samples use the same clock).
  readonly nowMs: () => number;
}): ContentionSampler {
  const kept: ContentionReading[] = [];
  let firstRefusal: Refusal | null = null;
  const refuse = (refusal: Refusal, label: string): ReadResult => {
    firstRefusal ??= refusal;
    return { ok: false, refusal, label };
  };
  return {
    read(label) {
      const atMs = options.nowMs();
      let scopeSomeTotalUs: number | null = null;
      if (options.scopeDir !== null) {
        let totals: PressureTotalsFile | null;
        try {
          totals = parsePressureTotals(options.reader.readText(`${options.scopeDir}/cpu.pressure`));
        } catch {
          return refuse("scope pressure file unreadable", label);
        }
        if (totals === null) {
          return refuse("scope pressure file unreadable", label);
        }
        scopeSomeTotalUs = totals.some.totalUs;
      }
      let schedstat: ProcSchedstat;
      try {
        schedstat = parseSchedstat(options.reader.readText(`/proc/${String(options.pid)}/task/${String(options.pid)}/schedstat`));
      } catch {
        return refuse("thread schedstat unreadable", label);
      }
      const reading: ContentionReading = { atMs, scopeSomeTotalUs, mainOnCpuNs: schedstat.onCpuNs, mainRunqNs: schedstat.runqNs };
      kept.push(reading);
      return { ok: true, reading };
    },
    readings: () => [...kept].sort((a, b) => a.atMs - b.atMs),
    refusal: () => firstRefusal,
  };
}

// ---- The thread split ------------------------------------------------------------------------------------------------------------

export interface ThreadTask {
  readonly tid: number;
  readonly comm: string;
  readonly onCpuNs: number;
  readonly runqNs: number;
}

export interface ThreadSplit {
  // The thread id of the main thread (the process id).
  readonly mainTid: number;
  // Every task of the process, the one with the most on-CPU time first.
  readonly tasks: readonly ThreadTask[];
  // The main thread's share of the process on-CPU time (0 when the process has none).
  readonly mainShare: number;
}

export type ThreadSplitResult = { readonly ok: true; readonly split: ThreadSplit } | { readonly ok: false; readonly refusal: Refusal };

// The on-CPU and run-queue time of every task of the process now alive (a thread that ended before the read has left no time to read, and
// a task that vanishes between the listing and its read is left out). Refuses when the task directory cannot be listed or the main
// thread cannot be read.
export function readThreadSplit(pid: number, reader: ProcReader): ThreadSplitResult {
  const dir = `/proc/${String(pid)}/task`;
  let entries: readonly string[];
  try {
    entries = reader.listDir(dir);
  } catch {
    return { ok: false, refusal: "task list unreadable" };
  }
  const tasks: ThreadTask[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    try {
      const stat = parseSchedstat(reader.readText(`${dir}/${entry}/schedstat`));
      tasks.push({ tid: Number(entry), comm: reader.readText(`${dir}/${entry}/comm`).trim(), onCpuNs: stat.onCpuNs, runqNs: stat.runqNs });
    } catch {
      // The task ended between the listing and the read; the main thread is checked below.
      continue;
    }
  }
  const main = tasks.find((task) => task.tid === pid);
  if (main === undefined) {
    return { ok: false, refusal: "thread schedstat unreadable" };
  }
  tasks.sort((a, b) => b.onCpuNs - a.onCpuNs || a.tid - b.tid);
  const total = tasks.reduce((sum, task) => sum + task.onCpuNs, 0);
  return { ok: true, split: { mainTid: pid, tasks, mainShare: total === 0 ? 0 : main.onCpuNs / total } };
}

// ---- The scope check -------------------------------------------------------------------------------------------------------------

export type ScopeCheck = { readonly ok: true; readonly scopeDir: string } | { readonly ok: false; readonly refusal: Refusal };

// The check before the first probe that the process the sampler will read is Omp in its own scope: its command name is not the wrapper
// (systemd-run replaces itself with the command, so a wrapper still running means the sampler would read the wrapper) and its cgroup leaf is a
// transient scope unit: a run-*.scope leaf. Two shapes are observed in the wild: run-p<pid>-i<id>.scope (the pid-encoded name the harness
// was written against) and run-<32hex>.scope, seen live as run-r<32hex>.scope (systemd 255's random transient name; see 45-MEASUREMENT.md).
// Any run-*.scope leaf is therefore accepted: the pid itself is still the thing verified (its comm and its cgroup are read for pid), and
// when expectedScopeDir is given the directory must match it exactly. The scope directory is returned for the sampler.
export function verifyScopedChild(pid: number, expectedScopeDir: string | null, reader: ProcReader): ScopeCheck {
  let comm: string;
  let cgroup: string;
  try {
    comm = reader.readText(`/proc/${String(pid)}/comm`).trim();
    cgroup = reader.readText(`/proc/${String(pid)}/cgroup`);
  } catch {
    return { ok: false, refusal: "child scope could not be verified" };
  }
  if (comm === "systemd-run") {
    return { ok: false, refusal: "sampled process is the wrapper" };
  }
  let scopeDir: string;
  try {
    scopeDir = scopeDirOf(cgroup, CGROUP_MOUNT);
  } catch {
    return { ok: false, refusal: "child scope could not be verified" };
  }
  const leaf = scopeDir.slice(scopeDir.lastIndexOf("/") + 1);
  const isRunScopeLeaf = /^run-.+\.scope$/.test(leaf);
  if (!isRunScopeLeaf || (expectedScopeDir !== null && scopeDir !== expectedScopeDir)) {
    return { ok: false, refusal: "child scope could not be verified" };
  }
  return { ok: true, scopeDir };
}

// ---- The readings CSV ------------------------------------------------------------------------------------------------------------

const READINGS_HEADER = "atMs,scopeSomeTotalUs,mainOnCpuNs,mainRunqNs";

export function readingsCsv(readings: readonly ContentionReading[]): string {
  const lines = [READINGS_HEADER];
  for (const reading of readings) {
    lines.push(`${String(reading.atMs)},${reading.scopeSomeTotalUs === null ? "" : String(reading.scopeSomeTotalUs)},${String(reading.mainOnCpuNs)},${String(reading.mainRunqNs)}`);
  }
  return `${lines.join("\n")}\n`;
}

// The inverse of readingsCsv. A malformed header or line is an error.
export function parseReadingsCsv(text: string): ContentionReading[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  const header = lines.shift();
  if (header !== READINGS_HEADER) {
    throw new Error(`the readings header is not ${READINGS_HEADER}: ${JSON.stringify(header)}`);
  }
  return lines.map((line, index) => {
    const match = /^(\d+),(\d*),(\d+),(\d+)$/.exec(line);
    if (match === null) {
      throw new Error(`malformed readings line ${String(index + 2)}: ${JSON.stringify(line)}`);
    }
    return { atMs: Number(match[1]), scopeSomeTotalUs: match[2] === "" ? null : Number(match[2]), mainOnCpuNs: Number(match[3]), mainRunqNs: Number(match[4]) };
  });
}

// ---- The run record --------------------------------------------------------------------------------------------------------------

// One descriptive host reading: the system CPU pressure and the one-minute load per CPU at a moment of the run. Never a validity input.
export interface HostReading {
  readonly label: HostReadingLabel;
  readonly pressure: CpuPressure | null;
  readonly loadPerCpu: number | null;
}

// A window observation with the facts of its part: the ready time, the first answer, and the thread split read at the end of the window.
export interface PartRecord extends WindowObservation {
  readonly readyMs: number | null;
  readonly firstAnswerMs: number | null;
  readonly threads: ThreadSplit | null;
}

export interface RunRecord {
  readonly label: typeof PAIRED_LABEL;
  readonly tier: Tier;
  readonly quietClaim: false;
  readonly arm: Arm;
  readonly pair: number;
  readonly runIndex: number;
  readonly controlFirst: boolean;
  readonly startedAtEpochMs: number;
  readonly branch: ScopeBranch;
  readonly refusal: Refusal | null;
  // Whether the mechanics held and the record is complete (the control answered, realm active was reached, the session answered a
  // command, both ready times and first answers were seen).
  readonly mechanics: boolean;
  readonly control: PartRecord;
  readonly cold: PartRecord;
  readonly host: readonly HostReading[];
  readonly metrics: RunMetrics | null;
  // The validity of the run by D-45-06, and whether the four calibrated bounds were applied (false before the freeze: V3 and V4 not read).
  readonly validity: { readonly valid: boolean; readonly rule: ValidityRule | null; readonly boundsApplied: boolean };
}

// The samples, the readings and the facts of one part of a run, as the live test has them.
export interface PartParts {
  readonly samples: readonly ProbeSample[];
  readonly readings: readonly ContentionReading[];
  readonly readyMs: number | undefined;
  readonly threads: ThreadSplit | null;
}

export interface RunRecordParts {
  readonly arm: Arm;
  readonly pair: number;
  readonly branch: ScopeBranch;
  readonly startedAtEpochMs: number;
  readonly refusal: Refusal | null;
  readonly mechanicsHeld: boolean;
  readonly control: PartParts;
  readonly cold: PartParts;
  readonly host: readonly HostReading[];
  // The four calibrated bounds, null while they are unset.
  readonly bounds: Bounds | null;
}

function partRecord(parts: PartParts): PartRecord {
  const observation = observeWindow({ samples: parts.samples, readings: parts.readings, readyMs: parts.readyMs, answerTimeoutMs: PAIR_ANSWER_TIMEOUT_MS });
  return { ...observation, readyMs: parts.readyMs ?? null, firstAnswerMs: firstAnswerMs(parts.samples) ?? null, threads: parts.threads };
}

function validityOf(input: ValidityInput, bounds: Bounds | null): RunValidity {
  return bounds === null ? mechanicalValidity(input) : runValidity(input, bounds);
}

function summariseValidity(validity: RunValidity, bounds: Bounds | null): RunRecord["validity"] {
  return { valid: validity.valid, rule: validity.valid ? null : validity.rule, boundsApplied: bounds !== null };
}

// The record of one arm run. The windows, shares, coverage, stall set and metrics are computed here from the samples and the readings by
// the same functions the analysis uses to recompute them from the CSVs, so a record and its CSVs cannot disagree.
export function buildRunRecord(parts: RunRecordParts): RunRecord {
  const runIndex = runIndexOf(parts.pair, parts.arm);
  const tier = tierOfBranch(parts.branch);
  const control = partRecord(parts.control);
  const cold = partRecord(parts.cold);
  const metrics = runMetrics({ samples: parts.control.samples, readyMs: parts.control.readyMs }, { samples: parts.cold.samples, readyMs: parts.cold.readyMs });
  const mechanics = parts.mechanicsHeld && metrics.valid;
  const validity = validityOf({ tier, refusal: parts.refusal, mechanicsHeld: mechanics, control, cold }, parts.bounds);
  return {
    label: PAIRED_LABEL,
    tier,
    quietClaim: false,
    arm: parts.arm,
    pair: parts.pair,
    runIndex,
    controlFirst: controlFirst(runIndex),
    startedAtEpochMs: parts.startedAtEpochMs,
    branch: parts.branch,
    refusal: parts.refusal,
    mechanics,
    control,
    cold,
    host: parts.host,
    metrics: metrics.valid ? metrics.metrics : null,
    validity: summariseValidity(validity, parts.bounds),
  };
}

// The record of one calibration control (Omp with no extension, scoped, probed as the live control is): no cold part, validity by the
// mechanical rules only (the bounds are what the calibration derives).
export interface CalibrationRecord {
  readonly tier: Tier;
  readonly quietClaim: false;
  readonly attempt: number;
  readonly startedAtEpochMs: number;
  readonly branch: ScopeBranch;
  readonly refusal: Refusal | null;
  readonly mechanics: boolean;
  readonly control: PartRecord;
  readonly host: readonly HostReading[];
  readonly validity: { readonly valid: boolean; readonly rule: ValidityRule | null };
}

export interface CalibrationParts {
  readonly attempt: number;
  readonly branch: ScopeBranch;
  readonly startedAtEpochMs: number;
  readonly refusal: Refusal | null;
  // The control answered and its ready frame was seen.
  readonly mechanicsHeld: boolean;
  readonly control: PartParts;
  readonly host: readonly HostReading[];
}

export function buildCalibrationRecord(parts: CalibrationParts): CalibrationRecord {
  const tier = tierOfBranch(parts.branch);
  const control = partRecord(parts.control);
  const mechanics = parts.mechanicsHeld && control.readyMs !== null && control.firstAnswerMs !== null;
  const validity = mechanicalValidity({ tier, refusal: parts.refusal, mechanicsHeld: mechanics, control, cold: null });
  return {
    tier,
    quietClaim: false,
    attempt: parts.attempt,
    startedAtEpochMs: parts.startedAtEpochMs,
    branch: parts.branch,
    refusal: parts.refusal,
    mechanics,
    control,
    host: parts.host,
    validity: { valid: validity.valid, rule: validity.valid ? null : validity.rule },
  };
}
