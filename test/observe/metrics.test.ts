// Metrics registry: counts, buckets, memory bound, snapshot shape and the strict validator.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMetrics, isMetricsSnapshot, TIMING_BUCKET_BOUNDS_MS, type Metrics } from "../../src/observe/metrics.js";
import { ERROR_CODES, type ErrorCode } from "../../src/core/errors.js";

function make(dropped = 0): Metrics {
  let mono = 1000;
  return createMetrics({
    now: () => new Date("2026-10-29T12:00:00.000Z"),
    monotonicMs: () => (mono += 250),
    droppedLines: () => dropped,
  });
}

const firstCode = ERROR_CODES[0] as ErrorCode;

void test("counts control requests, tool calls, transitions, probe failures and dropped lines", () => {
  const m = make(3);
  m.controlRequest("tool", false);
  m.controlRequest("tool", true);
  m.controlRequest("metrics", false);
  m.toolCall("write", "done", undefined, 10);
  m.toolCall("write", "done", undefined, 10);
  m.toolCall("write", "refused", firstCode, 1);
  m.transition("unbound", "connecting");
  m.transition("unbound", "connecting");
  m.healthProbeFailure(firstCode);
  const s = m.snapshot();
  assert.deepEqual(s.controlRequests, [
    { method: "tool", count: 2, refused: 1 },
    { method: "metrics", count: 1, refused: 0 },
  ]);
  assert.deepEqual(s.toolCalls, [
    { tool: "write", outcome: "done", count: 2 },
    { tool: "write", outcome: "refused", code: firstCode, count: 1 },
  ]);
  assert.deepEqual(s.transitions, [{ from: "unbound", to: "connecting", count: 2 }]);
  assert.deepEqual(s.healthProbeFailures, [{ code: firstCode, count: 1 }]);
  assert.equal(s.logLinesDropped, 3);
  assert.equal(s.schema, 1);
  assert.equal(s.startedAt, "2026-10-29T12:00:00.000Z");
  assert.ok(s.uptimeMs > 0);
});

void test("timings fall into the fixed buckets, with an overflow bucket", () => {
  const m = make();
  for (const ms of [0, 5, 6, 100, 300000, 300001, Number.NaN, -4]) {
    m.attach(ms);
  }
  m.toolCall("exec", "done", undefined, 26);
  const { attachMs, toolCallMs } = m.snapshot().timings;
  assert.deepEqual(attachMs.bucketUpperBoundsMs, [...TIMING_BUCKET_BOUNDS_MS]);
  assert.equal(attachMs.count, 8);
  // 0, 5, NaN->0, -4->0 are <=5; 6 <=25; 100 <=100; 300000 <=300000; 300001 overflows.
  assert.deepEqual(attachMs.bucketCounts, [4, 1, 1, 0, 0, 0, 0, 1, 1]);
  assert.equal(attachMs.maxMs, 300001);
  assert.equal(attachMs.sumMs, 5 + 6 + 100 + 300000 + 300001);
  assert.deepEqual(toolCallMs.bucketCounts, [0, 0, 1, 0, 0, 0, 0, 0, 0]);
});

void test("junk tool names, codes, methods and states cannot grow the registry", () => {
  const m = make();
  const baseline = (() => {
    m.toolCall("junk", "failed", undefined, 1);
    return m.snapshot().toolCalls.length;
  })();
  for (let i = 0; i < 10_000; i += 1) {
    m.toolCall(`/path/${String(i)}/${String(Math.random())}`, "failed", undefined, i);
    m.toolCall(`t${String(i)}`, "refused", `JUNK_${String(i)}` as ErrorCode, i);
    m.controlRequest(`method-${String(i)}`, true);
    m.transition(`s${String(i)}` as never, "active");
    m.healthProbeFailure(`JUNK_${String(i)}` as ErrorCode);
  }
  const s = m.snapshot();
  // failed/unknown, refused/unknown (junk code dropped): two rows, plus nothing else.
  assert.equal(baseline, 1);
  assert.equal(s.toolCalls.length, 2);
  assert.equal(s.controlRequests.length, 0);
  assert.equal(s.transitions.length, 0);
  assert.equal(s.healthProbeFailures.length, 0);
  assert.ok(s.toolCalls.every((row) => row.tool === "unknown"));
});

void test("real catalogue codes are bounded by the catalogue", () => {
  const m = make();
  for (let i = 0; i < 10_000; i += 1) {
    m.toolCall("exec", "failed", ERROR_CODES[i % ERROR_CODES.length], 1);
  }
  assert.equal(m.snapshot().toolCalls.length, ERROR_CODES.length);
});

void test("a snapshot is accepted by isMetricsSnapshot, also after a JSON round trip", () => {
  const m = make();
  m.controlRequest("up", false);
  m.toolCall("read", "refused", firstCode, 7);
  m.attach(12);
  const s = m.snapshot();
  assert.equal(isMetricsSnapshot(s), true);
  assert.equal(isMetricsSnapshot(JSON.parse(JSON.stringify(s))), true);
  assert.equal(isMetricsSnapshot(make().snapshot()), true);
});

void test("isMetricsSnapshot rejects an extra field, a missing field and a wrong type at several levels", () => {
  const m = make();
  m.toolCall("read", "refused", firstCode, 7);
  const good = JSON.parse(JSON.stringify(m.snapshot())) as Record<string, unknown>;
  type Json = Record<string, unknown>;
  const sub = (v: Json, key: string): Json => v[key] as Json; // shape known: built from a snapshot above
  const first = (v: Json, key: string): Json => (v[key] as Json[])[0] as Json; // same
  const clone = (): Json => JSON.parse(JSON.stringify(good)) as Json;
  const reject = (mutate: (v: Json) => void): void => {
    const v = clone();
    mutate(v);
    assert.equal(isMetricsSnapshot(v), false);
  };
  reject((v) => (v["extra"] = 1));
  reject((v) => delete v["logLinesDropped"]);
  reject((v) => (v["logLinesDropped"] = "0"));
  reject((v) => (v["schema"] = 2));
  reject((v) => (v["now"] = "not a date"));
  reject((v) => (first(v, "toolCalls")["extra"] = true));
  reject((v) => delete first(v, "toolCalls")["count"]);
  reject((v) => (first(v, "toolCalls")["tool"] = "rm"));
  reject((v) => (first(v, "toolCalls")["code"] = "NOT_A_CODE"));
  reject((v) => (sub(sub(v, "timings"), "attachMs")["bucketCounts"] = [1, 2]));
  reject((v) => ((sub(sub(v, "timings"), "toolCallMs")["bucketUpperBoundsMs"] as number[])[0] = 6));
  reject((v) => (sub(v, "timings")["extra"] = {}));
  reject((v) => (v["transitions"] = [{ from: "nowhere", to: "active", count: 1 }]));
  reject((v) => (v["healthProbeFailures"] = [{ code: firstCode, count: -1 }]));
  reject((v) => (v["controlRequests"] = [{ method: "shell", count: 1, refused: 0 }]));
  for (const bad of [null, undefined, 3, "x", [], {}]) {
    assert.equal(isMetricsSnapshot(bad), false);
  }
  assert.equal(isMetricsSnapshot(good), true);
});
