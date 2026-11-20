// Pure helper of the Omp responsiveness measurement (V1LIVE-01 / OI-11, 36-CONTEXT D-36-06): latency summary, quiet-host check,
// verdict and evidence text. test/integration/omp-responsiveness.test.ts sends `get_state` to an Omp session every probe interval
// and hands the samples to this module. Nothing here starts a process, reads a clock or the environment; the hermetic test is
// test/support/responsiveness.test.ts.
//
// Exports: PROBE_INTERVAL_MS, MAX_LATENCY_MS, P95_LATENCY_MS, MIN_PROBES, MIN_WINDOW_MS, BASELINE_WINDOW_MS, BASELINE_MIN_PROBES,
// QUIET_LOAD_PER_CPU, SECONDARY_HEADING, ProbeSample, LatencySummary, ResponsivenessBounds, HostLoad, RelativeSummary, CpuPressure,
// SecondaryParts, summariseLatencies, quietHost, latencyProblems, responsivenessProblems, samplesCsv, checkedReadyAtMs,
// samplesCsvWithPhase, relativeSummary, parsePressure, summaryText, summaryTextWithSecondary.

export const PROBE_INTERVAL_MS = 250;
export const MAX_LATENCY_MS = 1000;
export const P95_LATENCY_MS = 500;
export const MIN_PROBES = 40;
export const MIN_WINDOW_MS = 10_000;
export const BASELINE_WINDOW_MS = 10_000;
// The baseline needs fewer probes than the attach window (the baseline window is shorter than a cold attach).
export const BASELINE_MIN_PROBES = 30;
export const QUIET_LOAD_PER_CPU = 0.5;

// One probe: when it was sent (a monotonic number, in milliseconds) and how long its answer took, or undefined when it never came.
export interface ProbeSample {
  readonly sentAtMs: number;
  readonly latencyMs: number | undefined;
}

export interface LatencySummary {
  readonly sent: number;
  readonly answered: number;
  readonly unanswered: number;
  readonly maxMs: number;
  // The nearest-rank 50th percentile of the answered latencies.
  readonly medianMs: number;
  // The nearest-rank 95th percentile of the answered latencies.
  readonly p95Ms: number;
  // The longest interval between consecutive answer times, counted from the first send.
  readonly longestGapMs: number;
  // The first send to the last send.
  readonly windowMs: number;
}

// The nearest-rank percentile of an ascending list: the value at rank ceil(p * n). An empty list gives 0.
function nearestRank(ascending: readonly number[], fraction: number): number {
  if (ascending.length === 0) {
    return 0;
  }
  const rank = Math.max(1, Math.ceil(fraction * ascending.length));
  return ascending[Math.min(rank, ascending.length) - 1] ?? 0;
}

export function summariseLatencies(samples: readonly ProbeSample[]): LatencySummary {
  const latencies: number[] = [];
  const answerTimes: number[] = [];
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    first = Math.min(first, sample.sentAtMs);
    last = Math.max(last, sample.sentAtMs);
    if (sample.latencyMs !== undefined) {
      latencies.push(sample.latencyMs);
      answerTimes.push(sample.sentAtMs + sample.latencyMs);
    }
  }
  if (samples.length === 0) {
    return { sent: 0, answered: 0, unanswered: 0, maxMs: 0, medianMs: 0, p95Ms: 0, longestGapMs: 0, windowMs: 0 };
  }
  latencies.sort((a, b) => a - b);
  answerTimes.sort((a, b) => a - b);
  let longestGapMs = 0;
  let previous = first;
  for (const time of answerTimes) {
    longestGapMs = Math.max(longestGapMs, time - previous);
    previous = time;
  }
  return {
    sent: samples.length,
    answered: latencies.length,
    unanswered: samples.length - latencies.length,
    maxMs: latencies.at(-1) ?? 0,
    medianMs: nearestRank(latencies, 0.5),
    p95Ms: nearestRank(latencies, 0.95),
    longestGapMs,
    windowMs: last - first,
  };
}

// Whether the one-minute load per CPU is at most the ceiling. A cpu count below 1 counts as 1.
export function quietHost(load1: number, cpus: number, ceilingPerCpu: number): { readonly quiet: boolean; readonly perCpu: number } {
  const perCpu = load1 / Math.max(cpus, 1);
  return { quiet: perCpu <= ceilingPerCpu, perCpu };
}

export interface ResponsivenessBounds {
  readonly minProbes: number;
  readonly minWindowMs: number;
  readonly maxLatencyMs: number;
  readonly p95LatencyMs: number;
}

const DEFAULT_BOUNDS: ResponsivenessBounds = { minProbes: MIN_PROBES, minWindowMs: MIN_WINDOW_MS, maxLatencyMs: MAX_LATENCY_MS, p95LatencyMs: P95_LATENCY_MS };

// The latency sentences of a verdict: unanswered probes, the maximum and the 95th percentile. Empty when none applies. The verdict
// (responsivenessProblems) and the decision rule of test/support/responsiveness-decision.ts share this one definition.
export function latencyProblems(summary: LatencySummary, bounds: Partial<ResponsivenessBounds> = {}): string[] {
  const limit: ResponsivenessBounds = { ...DEFAULT_BOUNDS, ...bounds };
  const problems: string[] = [];
  if (summary.unanswered > 0) {
    problems.push(`${String(summary.unanswered)} of ${String(summary.sent)} probes were never answered`);
  }
  if (summary.maxMs > limit.maxLatencyMs) {
    problems.push(`the maximum latency was ${String(summary.maxMs)} ms, above ${String(limit.maxLatencyMs)} ms`);
  }
  if (summary.p95Ms > limit.p95LatencyMs) {
    problems.push(`the 95th percentile latency was ${String(summary.p95Ms)} ms, above ${String(limit.p95LatencyMs)} ms`);
  }
  return problems;
}

// The sentences that explain why a measurement does not pass; empty when it passes. `bounds` overrides the defaults per field (the
// baseline uses BASELINE_MIN_PROBES).
export function responsivenessProblems(summary: LatencySummary, bounds: Partial<ResponsivenessBounds> = {}): string[] {
  const limit: ResponsivenessBounds = { ...DEFAULT_BOUNDS, ...bounds };
  if (summary.sent === 0) {
    return ["no probe was sent, so nothing was measured"];
  }
  const problems: string[] = [];
  if (summary.sent < limit.minProbes) {
    problems.push(`only ${String(summary.sent)} probes were sent; at least ${String(limit.minProbes)} are needed`);
  }
  if (summary.windowMs < limit.minWindowMs) {
    problems.push(`the attach window was too short to be a measurement: ${String(summary.windowMs)} ms, at least ${String(limit.minWindowMs)} ms are needed`);
  }
  problems.push(...latencyProblems(summary, bounds));
  return problems;
}

// One CSV line per sample after a header; an unanswered probe has an empty latency.
export function samplesCsv(samples: readonly ProbeSample[]): string {
  const lines = ["sentAtMs,latencyMs"];
  for (const sample of samples) {
    lines.push(`${String(sample.sentAtMs)},${sample.latencyMs === undefined ? "" : String(sample.latencyMs)}`);
  }
  return `${lines.join("\n")}\n`;
}

// The ready time of a run, in milliseconds from process start: a finite, non-negative number, otherwise an error. The one definition the
// split at ready (responsiveness-decision.ts) and the phase column below share, so no caller can put every sample in the window by
// passing a ready time that is not one.
export function checkedReadyAtMs(readyAtMs: number): number {
  if (!Number.isFinite(readyAtMs) || readyAtMs < 0) {
    throw new Error(`the ready time must be a finite, non-negative number of milliseconds, got ${String(readyAtMs)}`);
  }
  return readyAtMs;
}

// samplesCsv with a third column: boot for a probe sent before the ready time, window for one sent at or after it (Phase 44, 44-CONTEXT
// D-44-03). The header is sentAtMs,latencyMs,phase.
export function samplesCsvWithPhase(samples: readonly ProbeSample[], readyAtMs: number): string {
  const ready = checkedReadyAtMs(readyAtMs);
  const lines = ["sentAtMs,latencyMs,phase"];
  for (const sample of samples) {
    lines.push(`${String(sample.sentAtMs)},${sample.latencyMs === undefined ? "" : String(sample.latencyMs)},${sample.sentAtMs < ready ? "boot" : "window"}`);
  }
  return `${lines.join("\n")}\n`;
}

// The heading of the control-relative section of the cold-attach text and of the record. It is a secondary reading, never a verdict.
export const SECONDARY_HEADING = "secondary, control-relative, not a verdict";

// The window's maximum and 95th percentile latency minus the reference's (the in-run baseline, or the paired control). There is no pass
// or fail member: this is a reading beside the verdict, and the verdict stays the absolute one (44-CONTEXT D-44-03).
export interface RelativeSummary {
  readonly label: string;
  readonly maxMs: number;
  readonly p95Ms: number;
}

export function relativeSummary(window: LatencySummary, reference: LatencySummary): RelativeSummary {
  return { label: SECONDARY_HEADING, maxMs: window.maxMs - reference.maxMs, p95Ms: window.p95Ms - reference.p95Ms };
}

// The "some" line of the CPU pressure file: how much of the last 10, 60 and 300 seconds some task waited for a CPU, in percent.
export interface CpuPressure {
  readonly avg10: number;
  readonly avg60: number;
  readonly avg300: number;
}

// Parses the text of the CPU pressure file (it reads no file). Null when there is no some line or one of its three averages is not a
// plain decimal number.
export function parsePressure(text: string): CpuPressure | null {
  const match = /^some\s+avg10=(\d+(?:\.\d+)?)\s+avg60=(\d+(?:\.\d+)?)\s+avg300=(\d+(?:\.\d+)?)(?:\s|$)/m.exec(text);
  if (match === null) {
    return null;
  }
  return { avg10: Number(match[1]), avg60: Number(match[2]), avg300: Number(match[3]) };
}

// A load average reading with the CPU count it was taken on.
export interface HostLoad {
  readonly label: string;
  readonly load1: number;
  readonly load5: number;
  readonly load15: number;
  readonly cpus: number;
}

function summaryLines(summary: LatencySummary): string[] {
  return [
    `probes sent: ${String(summary.sent)}`,
    `probes answered: ${String(summary.answered)}`,
    `probes unanswered: ${String(summary.unanswered)}`,
    `window: ${String(summary.windowMs)} ms`,
    `maximum latency: ${String(summary.maxMs)} ms`,
    `median latency: ${String(summary.medianMs)} ms`,
    `95th percentile latency: ${String(summary.p95Ms)} ms`,
    `longest gap between answers: ${String(summary.longestGapMs)} ms`,
  ];
}

function loadLines(loads: readonly HostLoad[]): string[] {
  return loads.map((load) => `load ${load.label}: ${load.load1.toFixed(2)} ${load.load5.toFixed(2)} ${load.load15.toFixed(2)} on ${String(load.cpus)} cpus`);
}

// A plain multi-line text with the counts, the latencies, the longest gap and the loads. No path and no environment value.
export function summaryText(label: string, summary: LatencySummary, loads: readonly HostLoad[]): string {
  return `${[`measurement: ${label}`, ...summaryLines(summary), ...loadLines(loads)].join("\n")}\n`;
}

// What the cold-attach text reports beside the verdict: the window from Omp ready (the verdict's samples), the uncorrected numbers over
// every sample from process start, the boot samples on their own, and the control-relative secondary reading.
export interface SecondaryParts {
  readonly readyAtMs: number;
  readonly window: LatencySummary;
  readonly all: LatencySummary;
  readonly boot: LatencySummary;
  // The time of the first answered probe over all samples, from process start; undefined when none was answered.
  readonly firstAnswerMs: number | undefined;
  readonly relative: RelativeSummary;
  // What the relative numbers are taken against, for the text only.
  readonly referenceLabel: string;
}

export function summaryTextWithSecondary(label: string, parts: SecondaryParts, loads: readonly HostLoad[]): string {
  const first = parts.firstAnswerMs === undefined ? "not seen" : `${String(parts.firstAnswerMs)} ms`;
  const lines = [
    `measurement: ${label}`,
    `corrected window, probes sent at or after Omp ready (${String(parts.readyAtMs)} ms from process start); the verdict reads these:`,
    ...summaryLines(parts.window),
    "uncorrected, every probe from process start:",
    ...summaryLines(parts.all),
    "boot samples, probes sent before Omp ready:",
    `probes sent: ${String(parts.boot.sent)}`,
    `probes answered: ${String(parts.boot.answered)}`,
    `probes unanswered: ${String(parts.boot.unanswered)}`,
    `first answer over all samples: ${first}`,
    `${parts.relative.label}:`,
    `maximum latency minus ${parts.referenceLabel}: ${String(parts.relative.maxMs)} ms`,
    `95th percentile latency minus ${parts.referenceLabel}: ${String(parts.relative.p95Ms)} ms`,
    ...loadLines(loads),
  ];
  return `${lines.join("\n")}\n`;
}
