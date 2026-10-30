// In-memory metrics registry (OBS-03). Pure: no I/O, no timers, never throws (it is called
// from event-bus listeners). Every key is drawn from a closed set, so memory is bounded
// whatever the callers pass: an unknown tool name is counted as "unknown", a value outside
// the closed sets is dropped. Nothing is persisted; counters start at daemon start.

import { ERROR_CODES, type ErrorCode } from "../core/errors.js";
import { STATES, type State } from "../core/states.js";

export const METRICS_SCHEMA = 1;

export const METRIC_CONTROL_METHODS = ["status", "up", "down", "doctor", "tool", "metrics"] as const;
export type MetricControlMethod = (typeof METRIC_CONTROL_METHODS)[number];

export const METRIC_TOOLS = ["exec", "read", "write", "list", "status", "retry"] as const;
export type MetricTool = (typeof METRIC_TOOLS)[number] | "unknown";

export const TOOL_OUTCOMES = ["done", "refused", "failed"] as const;
export type ToolOutcome = (typeof TOOL_OUTCOMES)[number];

export const TIMING_BUCKET_BOUNDS_MS: readonly number[] = Object.freeze([5, 25, 100, 500, 2000, 10000, 60000, 300000]);
const BUCKET_COUNT = TIMING_BUCKET_BOUNDS_MS.length + 1;

export interface Timing {
  count: number;
  sumMs: number;
  maxMs: number;
  bucketUpperBoundsMs: readonly number[];
  bucketCounts: readonly number[];
}

export interface MetricsSnapshot {
  schema: 1;
  startedAt: string;
  now: string;
  uptimeMs: number;
  controlRequests: { method: MetricControlMethod; count: number; refused: number }[];
  toolCalls: { tool: MetricTool; outcome: ToolOutcome; code?: ErrorCode; count: number }[];
  transitions: { from: State; to: State; count: number }[];
  timings: { attachMs: Timing; toolCallMs: Timing };
  healthProbeFailures: { code: ErrorCode; count: number }[];
  logLinesDropped: number;
}

export interface Metrics {
  controlRequest(method: string, refused: boolean): void;
  toolCall(tool: string, outcome: ToolOutcome, code: ErrorCode | undefined, durationMs: number): void;
  transition(from: State, to: State): void;
  attach(durationMs: number): void;
  healthProbeFailure(code: ErrorCode): void;
  snapshot(): MetricsSnapshot;
}

export interface MetricsOptions {
  now: () => Date;
  monotonicMs: () => number;
  // Reads the logger's dropped-line counter at snapshot time.
  droppedLines?: () => number;
}

interface TimingState {
  count: number;
  sumMs: number;
  maxMs: number;
  buckets: number[];
}

const newTiming = (): TimingState => ({ count: 0, sumMs: 0, maxMs: 0, buckets: new Array<number>(BUCKET_COUNT).fill(0) });

function record(timing: TimingState, durationMs: number): void {
  const ms = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  timing.count += 1;
  timing.sumMs += ms;
  timing.maxMs = Math.max(timing.maxMs, ms);
  let index = TIMING_BUCKET_BOUNDS_MS.findIndex((bound) => ms <= bound);
  if (index < 0) {
    index = BUCKET_COUNT - 1;
  }
  timing.buckets[index] = (timing.buckets[index] ?? 0) + 1;
}

function view(timing: TimingState): Timing {
  return {
    count: timing.count,
    sumMs: timing.sumMs,
    maxMs: timing.maxMs,
    bucketUpperBoundsMs: [...TIMING_BUCKET_BOUNDS_MS],
    bucketCounts: [...timing.buckets],
  };
}

function oneOf<T extends string>(list: readonly T[], value: unknown): T | undefined {
  return list.find((item) => item === value);
}

export function createMetrics(options: MetricsOptions): Metrics {
  const startedAt = options.now();
  const startedMono = options.monotonicMs();
  const control = new Map<MetricControlMethod, { count: number; refused: number }>();
  const tools = new Map<string, { tool: MetricTool; outcome: ToolOutcome; code: ErrorCode | undefined; count: number }>();
  const transitions = new Map<string, { from: State; to: State; count: number }>();
  const probes = new Map<ErrorCode, number>();
  const attachMs = newTiming();
  const toolCallMs = newTiming();

  return {
    controlRequest(method, refused) {
      const known = oneOf(METRIC_CONTROL_METHODS, method);
      if (known === undefined) {
        return;
      }
      const row = control.get(known) ?? { count: 0, refused: 0 };
      row.count += 1;
      if (refused) {
        row.refused += 1;
      }
      control.set(known, row);
    },
    toolCall(tool, outcome, code, durationMs) {
      const outcomeKnown = oneOf(TOOL_OUTCOMES, outcome);
      if (outcomeKnown === undefined) {
        return;
      }
      const name: MetricTool = oneOf(METRIC_TOOLS, tool) ?? "unknown";
      const codeKnown = oneOf(ERROR_CODES, code);
      const key = `${name}|${outcomeKnown}|${codeKnown ?? ""}`;
      const row = tools.get(key) ?? { tool: name, outcome: outcomeKnown, code: codeKnown, count: 0 };
      row.count += 1;
      tools.set(key, row);
      record(toolCallMs, durationMs);
    },
    transition(from, to) {
      const fromKnown = oneOf(STATES, from);
      const toKnown = oneOf(STATES, to);
      if (fromKnown === undefined || toKnown === undefined) {
        return;
      }
      const key = `${fromKnown}>${toKnown}`;
      const row = transitions.get(key) ?? { from: fromKnown, to: toKnown, count: 0 };
      row.count += 1;
      transitions.set(key, row);
    },
    attach(durationMs) {
      record(attachMs, durationMs);
    },
    healthProbeFailure(code) {
      const known = oneOf(ERROR_CODES, code);
      if (known === undefined) {
        return;
      }
      probes.set(known, (probes.get(known) ?? 0) + 1);
    },
    snapshot() {
      const at = options.now();
      const dropped = options.droppedLines?.() ?? 0;
      return {
        schema: METRICS_SCHEMA,
        startedAt: startedAt.toISOString(),
        now: at.toISOString(),
        uptimeMs: Math.max(0, options.monotonicMs() - startedMono),
        controlRequests: METRIC_CONTROL_METHODS.flatMap((method) => {
          const row = control.get(method);
          return row === undefined ? [] : [{ method, count: row.count, refused: row.refused }];
        }),
        toolCalls: [...tools.values()].map((row) =>
          row.code === undefined
            ? { tool: row.tool, outcome: row.outcome, count: row.count }
            : { tool: row.tool, outcome: row.outcome, code: row.code, count: row.count },
        ),
        transitions: [...transitions.values()].map((row) => ({ from: row.from, to: row.to, count: row.count })),
        timings: { attachMs: view(attachMs), toolCallMs: view(toolCallMs) },
        healthProbeFailures: [...probes.entries()].map(([code, count]) => ({ code, count })),
        logLinesDropped: Number.isSafeInteger(dropped) && dropped > 0 ? dropped : 0,
      };
    },
  };
}

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Exactly the required keys plus any of the optional ones; nothing else.
function keysMatch(value: Rec, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((k) => keys.includes(k)) && keys.every((k) => required.includes(k) || optional.includes(k));
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isMs = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isIso = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

function isTiming(value: unknown): boolean {
  if (!isRec(value) || !keysMatch(value, ["count", "sumMs", "maxMs", "bucketUpperBoundsMs", "bucketCounts"])) {
    return false;
  }
  const bounds = value["bucketUpperBoundsMs"];
  const counts = value["bucketCounts"];
  return (
    isCount(value["count"]) &&
    isMs(value["sumMs"]) &&
    isMs(value["maxMs"]) &&
    Array.isArray(bounds) &&
    bounds.length === TIMING_BUCKET_BOUNDS_MS.length &&
    bounds.every((bound, i) => bound === TIMING_BUCKET_BOUNDS_MS[i]) &&
    Array.isArray(counts) &&
    counts.length === BUCKET_COUNT &&
    counts.every(isCount)
  );
}

function everyRow(value: unknown, check: (row: Rec) => boolean): boolean {
  return Array.isArray(value) && value.every((row: unknown) => isRec(row) && check(row));
}

// Strict: rejects extra and missing fields at every level, a wrong type, and any value
// outside the closed sets. The client uses it to validate the daemon's reply.
export function isMetricsSnapshot(value: unknown): value is MetricsSnapshot {
  if (
    !isRec(value) ||
    !keysMatch(value, [
      "schema",
      "startedAt",
      "now",
      "uptimeMs",
      "controlRequests",
      "toolCalls",
      "transitions",
      "timings",
      "healthProbeFailures",
      "logLinesDropped",
    ])
  ) {
    return false;
  }
  const timings = value["timings"];
  return (
    value["schema"] === METRICS_SCHEMA &&
    isIso(value["startedAt"]) &&
    isIso(value["now"]) &&
    isMs(value["uptimeMs"]) &&
    isCount(value["logLinesDropped"]) &&
    everyRow(
      value["controlRequests"],
      (row) =>
        keysMatch(row, ["method", "count", "refused"]) &&
        oneOf(METRIC_CONTROL_METHODS, row["method"]) !== undefined &&
        isCount(row["count"]) &&
        isCount(row["refused"]),
    ) &&
    everyRow(
      value["toolCalls"],
      (row) =>
        keysMatch(row, ["tool", "outcome", "count"], ["code"]) &&
        (oneOf(METRIC_TOOLS, row["tool"]) !== undefined || row["tool"] === "unknown") &&
        oneOf(TOOL_OUTCOMES, row["outcome"]) !== undefined &&
        (row["code"] === undefined || oneOf(ERROR_CODES, row["code"]) !== undefined) &&
        isCount(row["count"]),
    ) &&
    everyRow(
      value["transitions"],
      (row) =>
        keysMatch(row, ["from", "to", "count"]) &&
        oneOf(STATES, row["from"]) !== undefined &&
        oneOf(STATES, row["to"]) !== undefined &&
        isCount(row["count"]),
    ) &&
    isRec(timings) &&
    keysMatch(timings, ["attachMs", "toolCallMs"]) &&
    isTiming(timings["attachMs"]) &&
    isTiming(timings["toolCallMs"]) &&
    everyRow(
      value["healthProbeFailures"],
      (row) => keysMatch(row, ["code", "count"]) && oneOf(ERROR_CODES, row["code"]) !== undefined && isCount(row["count"]),
    )
  );
}
