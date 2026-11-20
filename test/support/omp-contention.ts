// The contention readings of the Omp responsiveness measurement and the attribution of every stall interval (Phase 45, OMPV-03;
// 45-CONTEXT D-45-05). Pure: no process, no clock, no environment, no file; the live test reads the files and the clock and hands the
// text and the numbers to this module. The hermetic test is test/support/omp-contention.test.ts.
//
// D-45-05 in words. The harness takes a reading at every probe send and at every answer arrival: the cumulative "some" total of the
// scope's CPU pressure (microseconds) and the on-CPU and run-queue nanoseconds of the Omp main thread. For one probe, from its send to
// its answer (an unanswered probe counts as the answer timeout), the two readings that bracket the interval give on-CPU milliseconds,
// run-queue milliseconds and sleep milliseconds (the span minus the first two). The self-inflicted latency of a probe is its raw latency
// minus its run-queue milliseconds, never below zero: time spent waiting for a CPU that other tenants held is not Omp's own stall. The
// verdict reads the self-inflicted latency with the thresholds of test/support/responsiveness.ts, which this module never touches; the raw
// latency stays recorded as the secondary measure and still separates PASS from NOT-REPRODUCED. A probe whose interval is not bracketed
// by two readings is unattributed: it keeps its raw latency (the conservative reading) and lowers the coverage figure.
//
// The stall set of a run is the window probes whose self-inflicted latency exceeds P95_LATENCY_MS; its cause is on-cpu when the on-CPU
// share of the set's summed intervals is at least CAUSE_SHARE_MIN, sleep when the sleep share is, mixed otherwise (a tie at exactly
// the minimum for both reads on-cpu, the order of the sentence), none for an empty set and unattributed when every probe of the set is
// unattributed.
//
// Exports: ATTRIBUTION_COVERAGE_MIN, PROBE_DRIVER_GAP_MAX_MS, CAUSE_SHARE_MIN, BRACKET_SLACK_MS, SLEEP_ROUNDING_MS, ProcSchedstat,
// PressureTotals, PressureTotalsFile, ContentionReading, Attribution, SelfSamples, WindowShares, StallCause, StallSet, WindowObservation,
// parseSchedstat, parsePressureTotals, scopeDirOf, attributeInterval, selfSamples, windowShares, stallSet, maxProbeGapMs, observeWindow.

import { posix } from "node:path";
import { checkedReadyAtMs, type LatencySummary, P95_LATENCY_MS, type ProbeSample, summariseLatencies } from "./responsiveness.js";

// At least this share of the window probes is attributed, or the run is not valid (rule V5).
export const ATTRIBUTION_COVERAGE_MIN = 0.9;
// No gap between consecutive probe sends in a window exceeds this: three probe intervals (rule V2, the harness itself was not starved).
export const PROBE_DRIVER_GAP_MAX_MS = 750;
// The share of the stall set's intervals that decides its cause.
export const CAUSE_SHARE_MIN = 0.5;
// A bracketing reading further than this from the interval end does not bracket it.
export const BRACKET_SLACK_MS = 50;
// A residual or an excess of at most this many milliseconds is rounding of the integer millisecond clock, not an inconsistent reading.
export const SLEEP_ROUNDING_MS = 5;

const NS_PER_MS = 1_000_000;

// ---- Parsers ---------------------------------------------------------------------------------------------------------------------

// The three fields of /proc/PID/task/TID/schedstat: nanoseconds on CPU, nanoseconds waiting on a run queue, and the slice count.
export interface ProcSchedstat {
  readonly onCpuNs: number;
  readonly runqNs: number;
  readonly slices: number;
}

export function parseSchedstat(text: string): ProcSchedstat {
  const match = /^(\d+) (\d+) (\d+)\n?$/.exec(text);
  if (match === null) {
    throw new Error(`malformed schedstat line: ${JSON.stringify(text)}`);
  }
  return { onCpuNs: Number(match[1]), runqNs: Number(match[2]), slices: Number(match[3]) };
}

// One line of a pressure file.
export interface PressureTotals {
  readonly avg10: number;
  readonly avg60: number;
  readonly avg300: number;
  // The cumulative stall time in microseconds.
  readonly totalUs: number;
}

export interface PressureTotalsFile {
  readonly some: PressureTotals;
  readonly full: PressureTotals | null;
}

const PRESSURE_LINE = /^(some|full) avg10=(\d+(?:\.\d+)?) avg60=(\d+(?:\.\d+)?) avg300=(\d+(?:\.\d+)?) total=(\d+)$/;

// Parses the text of a cgroup or system pressure file (it reads no file): the some line and the full line when present. Null when the
// some line is missing or a some or full line has a field that is not numeric.
export function parsePressureTotals(text: string): PressureTotalsFile | null {
  let some: PressureTotals | null = null;
  let full: PressureTotals | null = null;
  for (const line of text.split("\n")) {
    if (line === "") {
      continue;
    }
    const match = PRESSURE_LINE.exec(line);
    if (match === null) {
      return null;
    }
    const totals: PressureTotals = { avg10: Number(match[2]), avg60: Number(match[3]), avg300: Number(match[4]), totalUs: Number(match[5]) };
    if (match[1] === "some") {
      some = totals;
    } else {
      full = totals;
    }
  }
  return some === null ? null : { some, full };
}

// The cgroup directory of a process from the text of /proc/PID/cgroup and the cgroup mount root: the mount root joined with the path of
// the unified-hierarchy line (the one that begins 0::). It is an error when that line is absent, when the path is only the root or ends
// with a deleted marker, or when the path has a dot-dot segment.
export function scopeDirOf(procCgroupText: string, mountRoot: string): string {
  const line = procCgroupText.split("\n").find((candidate) => candidate.startsWith("0::"));
  if (line === undefined) {
    throw new Error("the process has no unified-hierarchy cgroup line");
  }
  const path = line.slice("0::".length);
  if (path === "/" || path === "") {
    throw new Error("the process is in the root cgroup, not in a scope");
  }
  if (path.endsWith(" (deleted)")) {
    throw new Error(`the cgroup of the process was deleted: ${JSON.stringify(path)}`);
  }
  if (path.split("/").includes("..")) {
    throw new Error(`the cgroup path has a dot-dot segment: ${JSON.stringify(path)}`);
  }
  return posix.join(mountRoot, path);
}

// ---- Readings and the attribution of one interval --------------------------------------------------------------------------------

// One reading: the harness monotonic time in milliseconds from the probe origin, the scope's some total in microseconds (null under
// Branch N or when the file was unreadable), and the Omp main thread's on-CPU and run-queue nanoseconds.
export interface ContentionReading {
  readonly atMs: number;
  readonly scopeSomeTotalUs: number | null;
  readonly mainOnCpuNs: number;
  readonly mainRunqNs: number;
}

export type Attribution =
  | { readonly attributed: true; readonly onCpuMs: number; readonly runqMs: number; readonly sleepMs: number }
  | { readonly attributed: false };

// Splits the interval from fromMs to toMs into on-CPU, run-queue and sleep time from the latest reading at or before fromMs and the
// earliest at or after toMs (the readings in time order). A bracket that is absent, or further than BRACKET_SLACK_MS from the interval
// end, leaves the interval unattributed. The split covers the span the two readings actually cover; sleep is that span minus the first
// two. A residual at most SLEEP_ROUNDING_MS below zero is rounding and is clamped; a larger one, or a counter that went backwards by more than the rounding,
// is an inconsistent reading error and is never silently clamped.
export function attributeInterval(readings: readonly ContentionReading[], fromMs: number, toMs: number): Attribution {
  let first: ContentionReading | undefined;
  let last: ContentionReading | undefined;
  for (const reading of readings) {
    if (reading.atMs <= fromMs) {
      first = reading;
    }
    if (last === undefined && reading.atMs >= toMs) {
      last = reading;
    }
  }
  if (first === undefined || last === undefined || fromMs - first.atMs > BRACKET_SLACK_MS || last.atMs - toMs > BRACKET_SLACK_MS) {
    return { attributed: false };
  }
  const spanMs = last.atMs - first.atMs;
  const onCpuNs = last.mainOnCpuNs - first.mainOnCpuNs;
  const runqNs = last.mainRunqNs - first.mainRunqNs;
  // Two readings stamped within a millisecond of each other can be taken in the other order; a counter that goes back by at most the
  // rounding is that, and reads as no time. A larger regression is an inconsistent reading.
  if (onCpuNs < -SLEEP_ROUNDING_MS * NS_PER_MS || runqNs < -SLEEP_ROUNDING_MS * NS_PER_MS) {
    throw new Error(`inconsistent readings: a thread counter went backwards between ${String(first.atMs)} ms and ${String(last.atMs)} ms`);
  }
  const onCpuMs = Math.max(0, onCpuNs) / NS_PER_MS;
  const runqMs = Math.max(0, runqNs) / NS_PER_MS;
  const sleepMs = spanMs - onCpuMs - runqMs;
  if (sleepMs < -SLEEP_ROUNDING_MS) {
    throw new Error(`inconsistent readings: ${String(onCpuMs + runqMs)} ms of thread time in a span of ${String(spanMs)} ms (${String(first.atMs)} to ${String(last.atMs)} ms)`);
  }
  return { attributed: true, onCpuMs, runqMs, sleepMs: Math.max(0, sleepMs) };
}

export interface SelfSamples {
  // Every input sample with its latency replaced by the self-inflicted latency, kept as answered so summariseLatencies can read it.
  readonly samples: readonly ProbeSample[];
  // The attribution of each probe, parallel to the samples.
  readonly attributions: readonly Attribution[];
  // Attributed probes over all probes; 1 for an empty list.
  readonly coverage: number;
}

// The self-inflicted latency of every window sample: its raw latency (an unanswered probe counts as answerTimeoutMs) minus its run-queue
// milliseconds, never below zero. An unattributed probe keeps its raw latency.
export function selfSamples(samples: readonly ProbeSample[], readings: readonly ContentionReading[], answerTimeoutMs: number): SelfSamples {
  const attributions: Attribution[] = [];
  const out: ProbeSample[] = [];
  for (const sample of samples) {
    const raw = sample.latencyMs ?? answerTimeoutMs;
    const attribution = attributeInterval(readings, sample.sentAtMs, sample.sentAtMs + raw);
    attributions.push(attribution);
    out.push({ sentAtMs: sample.sentAtMs, latencyMs: attribution.attributed ? Math.max(0, raw - attribution.runqMs) : raw });
  }
  const attributed = attributions.filter((attribution) => attribution.attributed).length;
  return { samples: out, attributions, coverage: samples.length === 0 ? 1 : attributed / samples.length };
}

// ---- Shares over a window --------------------------------------------------------------------------------------------------------

export interface WindowShares {
  // The scope's some stall share, 0 to 1; null when a total is null or fewer than two readings lie in the window.
  readonly scopeStallShare: number | null;
  // The main thread's run-queue share, 0 to 1; null when fewer than two readings lie in the window.
  readonly runqShare: number | null;
}

function checkedShare(amount: number, elapsedMs: number, unitPerMs: number, what: string): number {
  if (amount < 0) {
    throw new Error(`inconsistent readings: the ${what} counter went backwards inside the window`);
  }
  const share = amount / (elapsedMs * unitPerMs);
  if (share > 1) {
    if ((share - 1) * elapsedMs > SLEEP_ROUNDING_MS) {
      throw new Error(`inconsistent readings: the ${what} share is ${String(share)}, above 1 by more than rounding`);
    }
    return 1;
  }
  return share;
}

// The stall shares of the window from fromMs to toMs (inclusive), from the first and the last reading inside it.
export function windowShares(readings: readonly ContentionReading[], fromMs: number, toMs: number): WindowShares {
  const inside = readings.filter((reading) => reading.atMs >= fromMs && reading.atMs <= toMs);
  const first = inside[0];
  const last = inside.at(-1);
  if (first === undefined || last === undefined || inside.length < 2 || last.atMs <= first.atMs) {
    return { scopeStallShare: null, runqShare: null };
  }
  const elapsedMs = last.atMs - first.atMs;
  const runqShare = checkedShare(last.mainRunqNs - first.mainRunqNs, elapsedMs, NS_PER_MS, "run-queue");
  if (inside.some((reading) => reading.scopeSomeTotalUs === null) || first.scopeSomeTotalUs === null || last.scopeSomeTotalUs === null) {
    return { scopeStallShare: null, runqShare };
  }
  return { scopeStallShare: checkedShare(last.scopeSomeTotalUs - first.scopeSomeTotalUs, elapsedMs, 1000, "scope stall"), runqShare };
}

// ---- The stall set ---------------------------------------------------------------------------------------------------------------

export type StallCause = "on-cpu" | "sleep" | "mixed" | "none" | "unattributed";

export interface StallSet {
  // The probes whose self-inflicted latency exceeds P95_LATENCY_MS, and how many of them are attributed.
  readonly count: number;
  readonly attributedCount: number;
  readonly onCpuMs: number;
  readonly runqMs: number;
  readonly sleepMs: number;
  // The on-CPU and sleep shares of the set's summed intervals (0 when nothing is attributed).
  readonly onCpuShare: number;
  readonly sleepShare: number;
  readonly cause: StallCause;
}

// `samples` are the self-inflicted samples and `attributions` their attributions, parallel.
export function stallSet(samples: readonly ProbeSample[], attributions: readonly Attribution[]): StallSet {
  if (samples.length !== attributions.length) {
    throw new Error(`stallSet needs one attribution per sample: ${String(samples.length)} samples, ${String(attributions.length)} attributions`);
  }
  let count = 0;
  let attributedCount = 0;
  let onCpuMs = 0;
  let runqMs = 0;
  let sleepMs = 0;
  for (const [index, sample] of samples.entries()) {
    if ((sample.latencyMs ?? 0) <= P95_LATENCY_MS) {
      continue;
    }
    count += 1;
    const attribution = attributions[index];
    if (attribution?.attributed === true) {
      attributedCount += 1;
      onCpuMs += attribution.onCpuMs;
      runqMs += attribution.runqMs;
      sleepMs += attribution.sleepMs;
    }
  }
  const total = onCpuMs + runqMs + sleepMs;
  const onCpuShare = total === 0 ? 0 : onCpuMs / total;
  const sleepShare = total === 0 ? 0 : sleepMs / total;
  let cause: StallCause;
  if (count === 0) {
    cause = "none";
  } else if (attributedCount === 0) {
    cause = "unattributed";
  } else if (onCpuShare >= CAUSE_SHARE_MIN) {
    cause = "on-cpu";
  } else if (sleepShare >= CAUSE_SHARE_MIN) {
    cause = "sleep";
  } else {
    cause = "mixed";
  }
  return { count, attributedCount, onCpuMs, runqMs, sleepMs, onCpuShare, sleepShare, cause };
}

// The largest difference between consecutive send times; 0 for fewer than two samples.
export function maxProbeGapMs(samples: readonly ProbeSample[]): number {
  const sends = samples.map((sample) => sample.sentAtMs).sort((a, b) => a - b);
  let largest = 0;
  for (let index = 1; index < sends.length; index += 1) {
    largest = Math.max(largest, (sends[index] ?? 0) - (sends[index - 1] ?? 0));
  }
  return largest;
}

// ---- One window, observed --------------------------------------------------------------------------------------------------------

// Everything the validity rules and the verdict read about one window (the cold window, or the control's serving window).
export interface WindowObservation {
  readonly raw: LatencySummary;
  readonly self: LatencySummary;
  readonly scopeStallShare: number | null;
  readonly runqShare: number | null;
  readonly coverage: number;
  readonly probeGapMaxMs: number;
  readonly stallSet: StallSet;
}

// The window of a run: the probes sent at or after the ready frame (readyMs undefined: no ready frame, an empty window). The live test
// builds the record with this function and the analysis recomputes it from the CSVs with the same one, so the two cannot differ.
export function observeWindow(input: {
  readonly samples: readonly ProbeSample[];
  readonly readings: readonly ContentionReading[];
  readonly readyMs: number | undefined;
  readonly answerTimeoutMs: number;
}): WindowObservation {
  const { readyMs } = input;
  const window = readyMs === undefined ? [] : input.samples.filter((sample) => sample.sentAtMs >= checkedReadyAtMs(readyMs));
  const self = selfSamples(window, input.readings, input.answerTimeoutMs);
  let fromMs = Number.POSITIVE_INFINITY;
  let toMs = Number.NEGATIVE_INFINITY;
  for (const sample of window) {
    fromMs = Math.min(fromMs, sample.sentAtMs);
    toMs = Math.max(toMs, sample.sentAtMs + (sample.latencyMs ?? input.answerTimeoutMs));
  }
  const shares = window.length === 0 ? { scopeStallShare: null, runqShare: null } : windowShares(input.readings, fromMs, toMs);
  return {
    raw: summariseLatencies(window),
    self: summariseLatencies(self.samples),
    scopeStallShare: shares.scopeStallShare,
    runqShare: shares.runqShare,
    coverage: self.coverage,
    probeGapMaxMs: maxProbeGapMs(window),
    stallSet: stallSet(self.samples, self.attributions),
  };
}
