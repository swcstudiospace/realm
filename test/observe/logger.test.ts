// Logger and ids: line shape, level filter, reserved keys, injection, redaction, failure counting.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger, nullLogger, parseLogLevel, type LogFields, type LogSink } from "../../src/observe/logger.js";
import { isCorrelationId, newCorrelationId } from "../../src/observe/ids.js";

const FIXED = new Date("2026-10-29T12:00:00.000Z");

function recording(): { sink: LogSink; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    sink: {
      write(line) {
        lines.push(line);
        return true;
      },
    },
  };
}

void test("a line starts with ts, level, event, then code, then the other fields in order", () => {
  const { sink, lines } = recording();
  const log = createLogger({ sink, level: "debug", now: () => FIXED });
  log.info("tool.result", { correlationId: "abc", code: "PATH_ESCAPE", tool: "write", durationMs: 3 });
  assert.equal(lines.length, 1);
  assert.equal(
    lines[0],
    '{"ts":"2026-10-29T12:00:00.000Z","level":"info","event":"tool.result","code":"PATH_ESCAPE","correlationId":"abc","tool":"write","durationMs":3}',
  );
  assert.deepEqual(Object.keys(JSON.parse(lines[0]) as object).slice(0, 4), ["ts", "level", "event", "code"]);
});

void test("an integer-like field key cannot move ahead of the fixed prefix", () => {
  const { sink, lines } = recording();
  createLogger({ sink, level: "debug", now: () => FIXED }).info("x", { "7": "seven" });
  assert.ok((lines[0] ?? "").startsWith('{"ts":'));
});

void test("the level filter drops lines below the threshold", () => {
  const { sink, lines } = recording();
  const log = createLogger({ sink, level: "warn", now: () => FIXED });
  log.debug("a");
  log.info("b");
  log.warn("c");
  log.error("d");
  assert.deepEqual(
    lines.map((l) => (JSON.parse(l) as { event: string }).event),
    ["c", "d"],
  );
});

void test("reserved keys cannot be overridden by a field, even past the type", () => {
  const { sink, lines } = recording();
  const log = createLogger({ sink, level: "debug", now: () => FIXED });
  const hostile = { ts: "forged", level: "error", event: "daemon.failed", other: 1 } as unknown as LogFields;
  log.info("real.event", hostile);
  const parsed = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
  assert.equal(parsed["ts"], FIXED.toISOString());
  assert.equal(parsed["level"], "info");
  assert.equal(parsed["event"], "real.event");
  assert.equal(parsed["other"], 1);
});

void test("a value with a newline and a fake prefix stays inside one line", () => {
  const { sink, lines } = recording();
  const log = createLogger({ sink, level: "debug", now: () => FIXED });
  log.info("e", { note: '\n{"ts":"x","level":"error","event":"daemon.failed","code":"LOCK_CONFLICT"}' });
  assert.equal(lines.length, 1);
  const line = lines[0] ?? "";
  assert.equal(line.includes("\n"), false);
  assert.equal((JSON.parse(line) as { event: string }).event, "e");
});

void test("secret-shaped values and secret-looking keys are redacted", () => {
  const { sink, lines } = recording();
  const log = createLogger({ sink, level: "debug", now: () => FIXED });
  log.info("e", {
    header: "Authorization: Bearer abcdef0123456789",
    env: "API_KEY=hunter2hunter2",
    apiToken: "plain-looking-value",
    list: ["ok", "sk-abcdefghijklmnopqrstuvwxyz"],
  });
  const parsed = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
  assert.equal(String(parsed["header"]).includes("abcdef0123456789"), false);
  assert.equal(String(parsed["header"]).includes("[REDACTED]"), true);
  assert.equal(parsed["env"], "API_KEY=[REDACTED]");
  assert.equal(parsed["apiToken"], "[REDACTED]");
  assert.deepEqual(parsed["list"], ["ok", "[REDACTED]"]);
});

void test("a throwing sink never throws, and a false return and a throw are both counted", () => {
  let mode: "throw" | "false" | "ok" = "throw";
  const sink: LogSink = {
    write() {
      if (mode === "throw") {
        throw new Error("disk gone");
      }
      return mode === "ok";
    },
  };
  const log = createLogger({ sink, level: "debug", now: () => FIXED });
  log.info("a");
  mode = "false";
  log.info("b");
  mode = "ok";
  log.info("c");
  assert.equal(log.droppedLines(), 2);
});

void test("a clock that throws is counted, not thrown", () => {
  const log = createLogger({
    sink: recording().sink,
    level: "debug",
    now: () => {
      throw new Error("clock");
    },
  });
  log.info("a");
  assert.equal(log.droppedLines(), 1);
});

void test("child fields are carried, call fields win, and the drop counter is shared", () => {
  const { sink, lines } = recording();
  const root = createLogger({ sink, level: "debug", now: () => FIXED });
  const child = root.child({ sessionId: "daemon", tool: "read" });
  child.info("e", { tool: "write", n: 1 });
  const parsed = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
  assert.equal(parsed["sessionId"], "daemon");
  assert.equal(parsed["tool"], "write");
  const failing = createLogger({ sink: { write: () => false }, level: "debug", now: () => FIXED });
  failing.child({ a: 1 }).info("e");
  assert.equal(failing.droppedLines(), 1);
});

void test("nullLogger accepts everything and counts nothing", () => {
  nullLogger.error("e", { a: 1 });
  assert.equal(nullLogger.child({ a: 1 }), nullLogger);
  assert.equal(nullLogger.droppedLines(), 0);
});

void test("parseLogLevel: absent or empty is info and valid, a known level is kept, junk is info and invalid", () => {
  assert.deepEqual(parseLogLevel(undefined), { level: "info", invalid: false });
  assert.deepEqual(parseLogLevel(""), { level: "info", invalid: false });
  assert.deepEqual(parseLogLevel("DEBUG"), { level: "debug", invalid: false });
  assert.deepEqual(parseLogLevel("error"), { level: "error", invalid: false });
  assert.deepEqual(parseLogLevel("verbose"), { level: "info", invalid: true });
});

void test("child does not throw when a field getter throws, and later logs still emit", () => {
  const { sink, lines } = recording();
  const log = createLogger({ sink, level: "debug", now: () => FIXED });
  const fields: LogFields = {};
  Object.defineProperty(fields, "bad", {
    enumerable: true,
    get() {
      throw new Error("boom");
    },
  });
  const child = log.child(fields);
  child.info("still");
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.includes('"event":"still"'), true);
  assert.equal(log.droppedLines(), 1);
});

void test("correlation ids: fresh, unique, and accepted by the pattern", () => {
  const a = newCorrelationId();
  const b = newCorrelationId();
  assert.notEqual(a, b);
  assert.equal(isCorrelationId(a), true);
  assert.equal(isCorrelationId(""), false);
  assert.equal(isCorrelationId("a".repeat(65)), false);
  assert.equal(isCorrelationId("has space"), false);
  assert.equal(isCorrelationId("line\nbreak"), false);
  assert.equal(isCorrelationId(42), false);
});
