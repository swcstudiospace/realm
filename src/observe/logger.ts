// Leveled JSON-line logger (OBS-02). One JSON object per line. The first keys are always
// ts, level, event, then code when present, then the other fields; a field can never
// override a reserved key. Every string value and every secret-looking key is redacted
// through the audit redactor. Logger methods never throw: they are called from event-bus
// listeners, so a failing sink is counted (droppedLines) and the line is lost.
//
// This module reads no environment: the daemon entry reads REALM_LOG_LEVEL and passes the
// raw value to parseLogLevel.

import type { ErrorCode } from "../core/errors.js";
import { REDACTED, SENSITIVE_KEY_PATTERN, redactString, redactValue } from "../audit/redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: readonly LogLevel[] = Object.freeze(["debug", "info", "warn", "error"] as const);

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = Object.freeze({ debug: 0, info: 1, warn: 2, error: 3 });

export interface LogSink {
  // Returns false when the line could not be written.
  write(line: string): boolean;
}

type FieldValue = string | number | boolean | null | readonly (string | number)[] | undefined;

// The reserved keys ts, level and event are excluded by type; `code` is typed ErrorCode.
export type LogFields = {
  code?: ErrorCode;
  ts?: never;
  level?: never;
  event?: never;
  [key: string]: FieldValue;
};

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
  // Lines lost to a failing sink or a failed serialization, shared with every child.
  droppedLines(): number;
}

export interface LoggerOptions {
  sink: LogSink;
  level: LogLevel;
  now: () => Date;
}

const RESERVED_KEYS: ReadonlySet<string> = new Set(["ts", "level", "event", "code"]);

export function createLogger(options: LoggerOptions): Logger {
  const counter = { dropped: 0 };
  return build(options, {}, counter);
}

function build(options: LoggerOptions, bound: Readonly<Record<string, unknown>>, counter: { dropped: number }): Logger {
  const threshold = LEVEL_RANK[options.level];
  const emit = (level: LogLevel, event: string, fields: LogFields | undefined): void => {
    if (LEVEL_RANK[level] < threshold) {
      return;
    }
    // QUAL-01 named exception (i): a catch that records the failure as counted state and
    // never throws. A logger is called from event-bus listeners and must not throw.
    try {
      const line = formatLine(options.now(), level, event, bound, fields);
      if (!options.sink.write(line)) {
        counter.dropped += 1;
      }
    } catch {
      counter.dropped += 1;
    }
  };
  return {
    debug: (event, fields) => { emit("debug", event, fields); },
    info: (event, fields) => { emit("info", event, fields); },
    warn: (event, fields) => { emit("warn", event, fields); },
    error: (event, fields) => { emit("error", event, fields); },
    child: (fields) => {
      try {
        return build(options, { ...bound, ...ownFields(fields) }, counter);
      } catch {
        // QUAL-01 named exception (i): copying fields must not throw. The child keeps the parent's fields.
        counter.dropped += 1;
        return build(options, bound, counter);
      }
    },
    droppedLines: () => counter.dropped,
  };
}

// Own enumerable fields without the reserved keys `ts`, `level` and `event`. `code` stays.
function ownFields(fields: LogFields | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (fields === undefined) {
    return out;
  }
  for (const key of Object.keys(fields)) {
    if (key === "ts" || key === "level" || key === "event") {
      continue;
    }
    out[key] = (fields as Record<string, unknown>)[key];
  }
  return out;
}

// The line is assembled by hand so the prefix order never depends on JS key ordering
// (integer-like keys would otherwise sort first).
function formatLine(
  at: Date,
  level: LogLevel,
  event: string,
  bound: Readonly<Record<string, unknown>>,
  fields: LogFields | undefined,
): string {
  const merged: Record<string, unknown> = { ...bound, ...ownFields(fields) };
  let line = `{"ts":${JSON.stringify(at.toISOString())},"level":${JSON.stringify(level)},"event":${JSON.stringify(redactString(event))}`;
  if (merged["code"] !== undefined) {
    line += `,"code":${JSON.stringify(redactValue(merged["code"]))}`;
  }
  for (const key of Object.keys(merged)) {
    if (RESERVED_KEYS.has(key)) {
      continue;
    }
    const value = merged[key];
    if (value === undefined) {
      continue;
    }
    const safeKey = redactString(key);
    const safeValue = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactValue(value);
    const text = JSON.stringify(safeValue);
    line += `,${JSON.stringify(safeKey)}:${text}`;
  }
  return `${line}}`;
}

const NOOP_LOGGER: Logger = Object.freeze({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => NOOP_LOGGER,
  droppedLines: () => 0,
});

export const nullLogger: Logger = NOOP_LOGGER;

// Pure: the caller reads the environment variable. Absent or empty means the default
// (info, valid); an unrecognised value means info and invalid, so the caller can warn once.
export function parseLogLevel(raw: string | undefined): { level: LogLevel; invalid: boolean } {
  if (raw === undefined || raw.trim() === "") {
    return { level: "info", invalid: false };
  }
  const value = raw.trim().toLowerCase();
  const found = LOG_LEVELS.find((level) => level === value);
  return found === undefined ? { level: "info", invalid: true } : { level: found, invalid: false };
}
