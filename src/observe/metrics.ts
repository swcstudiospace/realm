// In-memory counters for the daemon control socket (OBS-03). No I/O and no throw: a listener on the
// lifecycle event bus must not throw, or the publisher would rethrow into a transition. Every key
// comes from a closed set, so a caller cannot grow the snapshot with a path, a session id, or free text.

import type { ErrorCode } from "../core/errors.js";
import { ERROR_CODES } from "../core/errors.js";
import type { State } from "../core/states.js";
import { STATES } from "../core/states.js";
import { CONTROL_METHODS, type ControlMethod } from "../daemon/channel.js";

export const METRICS_SCHEMA = 1;
export const BUCKET_UPPER_BOUNDS_MS = [5, 25, 100, 500, 2_000, 10_000, 60_000, 300_000] as const;
export const TOOL_CALL_NAMES = ["exec", "read", "write", "list", "status", "retry", "unknown"] as const;
export const TOOL_CALL_OUTCOMES = ["done", "refused", "failed"] as const;

export type LoggedToolName = (typeof TOOL_CALL_NAMES)[number];
export type ToolCallOutcome = (typeof TOOL_CALL_OUTCOMES)[number];
export const PROBE_FAILED_REASON = "probe failed";
export type HealthFailureCode = ErrorCode | typeof PROBE_FAILED_REASON;

export interface Timing {
  readonly count: number;
  readonly sumMs: number;
  readonly maxMs: number;
  readonly bucketUpperBoundsMs: readonly number[];
  readonly bucketCounts: readonly number[];
}

export interface ControlRequestCount {
  readonly method: ControlMethod;
  readonly count: number;
  readonly refused: number;
}

export interface ToolCallCount {
  readonly tool: LoggedToolName;
  readonly outcome: ToolCallOutcome;
  readonly code?: ErrorCode;
  readonly count: number;
}

export interface TransitionCount {
  readonly from: State;
  readonly to: State;
  readonly count: number;
}

export interface HealthProbeFailureCount {
  readonly code: HealthFailureCode;
  readonly count: number;
}

export interface MetricsSnapshot {
  readonly schema: 1;
  readonly startedAt: string;
  readonly now: string;
  readonly uptimeMs: number;
  readonly controlRequests: readonly ControlRequestCount[];
  readonly toolCalls: readonly ToolCallCount[];
  readonly transitions: readonly TransitionCount[];
  readonly timings: { readonly attachMs: Timing; readonly toolCallMs: Timing };
  readonly healthProbeFailures: readonly HealthProbeFailureCount[];
  readonly logLinesDropped: number;
}

export interface Metrics {
  recordControl(method: string, refused: boolean): void;
  recordTool(tool: string, outcome: string, durationMs: number, code?: string): void;
  recordTransition(from: string, to: string): void;
  recordAttach(durationMs: number): void;
  recordHealthProbeFailure(code: string): void;
  setLogLinesDropped(count: number): void;
  snapshot(): MetricsSnapshot;
}

export interface MetricsOptions {
  readonly now: () => Date;
  readonly monotonicMs: () => number;
}

interface MutableTiming {
  count: number;
  sumMs: number;
  maxMs: number;
  bucketCounts: number[];
}

const METHODS: readonly string[] = CONTROL_METHODS;
const CODES: readonly string[] = ERROR_CODES;
const STATE_NAMES: readonly string[] = STATES;

function isMethod(value: string): value is ControlMethod {
  return METHODS.includes(value);
}

function isCode(value: string): value is ErrorCode {
  return CODES.includes(value);
}

function isHealthCode(value: string): value is HealthFailureCode {
  return value === PROBE_FAILED_REASON || isCode(value);
}

function isState(value: string): value is State {
  return STATE_NAMES.includes(value);
}

function isTool(value: string): value is LoggedToolName {
  return (TOOL_CALL_NAMES as readonly string[]).includes(value);
}

function isOutcome(value: string): value is ToolCallOutcome {
  return (TOOL_CALL_OUTCOMES as readonly string[]).includes(value);
}

function emptyTiming(): MutableTiming {
  return { count: 0, sumMs: 0, maxMs: 0, bucketCounts: BUCKET_UPPER_BOUNDS_MS.map(() => 0).concat(0) };
}

function finiteMs(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function observe(timing: MutableTiming, durationMs: number): void {
  const ms = finiteMs(durationMs);
  timing.count += 1;
  timing.sumMs += ms;
  if (ms > timing.maxMs) {
    timing.maxMs = ms;
  }
  for (let index = 0; index < BUCKET_UPPER_BOUNDS_MS.length; index += 1) {
    const bound = BUCKET_UPPER_BOUNDS_MS[index];
    if (bound !== undefined && ms <= bound) {
      const bucket = timing.bucketCounts[index];
      if (bucket !== undefined) {
        timing.bucketCounts[index] = bucket + 1;
      }
      return;
    }
  }
  const overflow = timing.bucketCounts[BUCKET_UPPER_BOUNDS_MS.length];
  if (overflow !== undefined) {
    timing.bucketCounts[BUCKET_UPPER_BOUNDS_MS.length] = overflow + 1;
  }
}

function freezeTiming(timing: MutableTiming): Timing {
  return {
    count: timing.count,
    sumMs: timing.sumMs,
    maxMs: timing.maxMs,
    bucketUpperBoundsMs: BUCKET_UPPER_BOUNDS_MS,
    bucketCounts: [...timing.bucketCounts],
  };
}

export function createMetrics(options: MetricsOptions): Metrics {
  const started = options.now();
  const startedMono = finiteMs(options.monotonicMs());
  const control = new Map<ControlMethod, { count: number; refused: number }>();
  const tools = new Map<string, { tool: LoggedToolName; outcome: ToolCallOutcome; code?: ErrorCode; count: number }>();
  const transitions = new Map<string, { from: State; to: State; count: number }>();
  const health = new Map<HealthFailureCode, number>();
  const attachMs = emptyTiming();
  const toolCallMs = emptyTiming();
  let logLinesDropped = 0;

  return {
    recordControl(method, refused) {
      if (!isMethod(method)) {
        return;
      }
      const row = control.get(method) ?? { count: 0, refused: 0 };
      row.count += 1;
      if (refused) {
        row.refused += 1;
      }
      control.set(method, row);
    },
    recordTool(tool, outcome, durationMs, code) {
      if (!isOutcome(outcome)) {
        return;
      }
      const name: LoggedToolName = isTool(tool) ? tool : "unknown";
      const catalogue = code !== undefined && isCode(code) ? code : undefined;
      const key = `${name}\u0000${outcome}\u0000${catalogue ?? ""}`;
      const row = tools.get(key) ?? { tool: name, outcome, ...(catalogue === undefined ? {} : { code: catalogue }), count: 0 };
      row.count += 1;
      tools.set(key, row);
      observe(toolCallMs, durationMs);
    },
    recordTransition(from, to) {
      if (!isState(from) || !isState(to)) {
        return;
      }
      const key = `${from}\u0000${to}`;
      const row = transitions.get(key) ?? { from, to, count: 0 };
      row.count += 1;
      transitions.set(key, row);
    },
    recordAttach(durationMs) {
      observe(attachMs, durationMs);
    },
    recordHealthProbeFailure(code) {
      if (!isHealthCode(code)) {
        return;
      }
      health.set(code, (health.get(code) ?? 0) + 1);
    },
    setLogLinesDropped(count) {
      logLinesDropped = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : logLinesDropped;
    },
    snapshot() {
      const at = options.now();
      return {
        schema: METRICS_SCHEMA,
        startedAt: started.toISOString(),
        now: at.toISOString(),
        uptimeMs: Math.round(finiteMs(options.monotonicMs()) - startedMono),
        controlRequests: [...control.entries()]
          .sort((left, right) => left[0].localeCompare(right[0]))
          .map(([method, row]) => ({ method, count: row.count, refused: row.refused })),
        toolCalls: [...tools.values()].sort((left, right) => {
          const byTool = left.tool.localeCompare(right.tool);
          if (byTool !== 0) {
            return byTool;
          }
          const byOutcome = left.outcome.localeCompare(right.outcome);
          return byOutcome !== 0 ? byOutcome : (left.code ?? "").localeCompare(right.code ?? "");
        }),
        transitions: [...transitions.values()].sort((left, right) => {
          const byFrom = left.from.localeCompare(right.from);
          return byFrom !== 0 ? byFrom : left.to.localeCompare(right.to);
        }),
        timings: { attachMs: freezeTiming(attachMs), toolCallMs: freezeTiming(toolCallMs) },
        healthProbeFailures: [...health.entries()]
          .sort((left, right) => left[0].localeCompare(right[0]))
          .map(([code, count]) => ({ code, count })),
        logLinesDropped,
      };
    },
  };
}
