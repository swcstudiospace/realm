// Pure helper of the Omp responsiveness measurement (V1LIVE-01 / OI-11, 36-CONTEXT D-36-06): latency summary, quiet-host check,
// verdict and evidence text. test/integration/omp-responsiveness.test.ts sends `get_state` to an Omp session every probe interval
// and hands the samples to this module. Nothing here starts a process, reads a clock or the environment; the hermetic test is
// test/support/responsiveness.test.ts.
//
// Exports: PROBE_INTERVAL_MS, MAX_LATENCY_MS, P95_LATENCY_MS, MIN_PROBES, MIN_WINDOW_MS, BASELINE_WINDOW_MS, BASELINE_MIN_PROBES,
// QUIET_LOAD_PER_CPU, ProbeSample, LatencySummary, ResponsivenessBounds, HostLoad, summariseLatencies, quietHost,
// responsivenessProblems, samplesCsv, summaryText.

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

// One CSV line per sample after a header; an unanswered probe has an empty latency.
export function samplesCsv(samples: readonly ProbeSample[]): string {
  const lines = ["sentAtMs,latencyMs"];
  for (const sample of samples) {
    lines.push(`${String(sample.sentAtMs)},${sample.latencyMs === undefined ? "" : String(sample.latencyMs)}`);
  }
  return `${lines.join("\n")}\n`;
}

// A load average reading with the CPU count it was taken on.
export interface HostLoad {
  readonly label: string;
  readonly load1: number;
  readonly load5: number;
  readonly load15: number;
  readonly cpus: number;
}

// A plain multi-line text with the counts, the latencies, the longest gap and the loads. No path and no environment value.
export function summaryText(label: string, summary: LatencySummary, loads: readonly HostLoad[]): string {
  const lines = [
    `measurement: ${label}`,
    `probes sent: ${String(summary.sent)}`,
    `probes answered: ${String(summary.answered)}`,
    `probes unanswered: ${String(summary.unanswered)}`,
    `window: ${String(summary.windowMs)} ms`,
    `maximum latency: ${String(summary.maxMs)} ms`,
    `median latency: ${String(summary.medianMs)} ms`,
    `95th percentile latency: ${String(summary.p95Ms)} ms`,
    `longest gap between answers: ${String(summary.longestGapMs)} ms`,
  ];
  for (const load of loads) {
    lines.push(`load ${load.label}: ${load.load1.toFixed(2)} ${load.load5.toFixed(2)} ${load.load15.toFixed(2)} on ${String(load.cpus)} cpus`);
  }
  return `${lines.join("\n")}\n`;
}
