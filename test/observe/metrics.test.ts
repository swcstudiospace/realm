import { test } from "node:test";
import assert from "node:assert/strict";
import { BUCKET_UPPER_BOUNDS_MS, PROBE_FAILED_REASON, createMetrics, isMetricsSnapshot } from "../../src/observe/metrics.js";

const CLOCK = new Date("2026-01-01T00:00:00.000Z");

function metrics(steps: number[] = [0]): ReturnType<typeof createMetrics> {
  let mono = 0;
  let wall = CLOCK.getTime();
  return createMetrics({
    now: () => new Date(wall),
    monotonicMs: () => {
      const value = steps[mono] ?? steps[steps.length - 1] ?? 0;
      mono += 1;
      wall += 1_000;
      return value;
    },
  });
}

void test("OBS-03: a snapshot starts empty and names when counting began", () => {
  const registry = createMetrics({ now: () => CLOCK, monotonicMs: () => 0 });
  const snap = registry.snapshot();
  assert.equal(snap.schema, 1);
  assert.equal(snap.startedAt, CLOCK.toISOString());
  assert.deepEqual(snap.controlRequests, []);
  assert.deepEqual(snap.toolCalls, []);
  assert.deepEqual(snap.transitions, []);
  assert.deepEqual(snap.healthProbeFailures, []);
  assert.equal(snap.logLinesDropped, 0);
  assert.equal(snap.timings.attachMs.count, 0);
  assert.deepEqual(snap.timings.toolCallMs.bucketUpperBoundsMs, BUCKET_UPPER_BOUNDS_MS);
  assert.equal(snap.timings.toolCallMs.bucketCounts.length, BUCKET_UPPER_BOUNDS_MS.length + 1);
});
void test("OBS-03: tool calls, attach duration, and probe failures stay inside the closed sets", () => {
  const registry = metrics([0, 40]);
  registry.recordTool("write", "done", 12);
  registry.recordTool("not-a-tool-name-that-must-not-be-kept", "refused", 3, "SCHEMA_INVALID");
  registry.recordTool("read", "failed", 600_000, "NOT_A_CODE");
  registry.recordTool("read", "sideways", 1);
  registry.recordAttach(40);
  registry.recordHealthProbeFailure("OPENSHELL_GATEWAY_LOST");
  registry.recordHealthProbeFailure(PROBE_FAILED_REASON);
  registry.recordHealthProbeFailure("free text");
  registry.recordControl("status", false);
  registry.recordControl("status", true);
  registry.recordControl("nope", false);
  registry.recordTransition("unbound", "active");
  registry.recordTransition("nope", "active");
  registry.setLogLinesDropped(2.9);
  const snap = registry.snapshot();
  assert.deepEqual(snap.toolCalls.map((row) => row.tool), ["read", "unknown", "write"]);
  assert.equal(snap.toolCalls.find((row) => row.tool === "unknown")?.code, "SCHEMA_INVALID");
  assert.equal(snap.toolCalls.find((row) => row.tool === "read")?.code, undefined);
  assert.equal(snap.timings.toolCallMs.count, 3);
  assert.equal(snap.timings.toolCallMs.bucketCounts[BUCKET_UPPER_BOUNDS_MS.length], 1);
  assert.equal(snap.timings.attachMs.count, 1);
  assert.equal(snap.timings.attachMs.maxMs, 40);
  assert.equal(snap.healthProbeFailures.length, 2);
  assert.equal(snap.healthProbeFailures.find((row) => row.code === "OPENSHELL_GATEWAY_LOST")?.count, 1);
  assert.equal(snap.healthProbeFailures.find((row) => row.code === PROBE_FAILED_REASON)?.count, 1);
  assert.deepEqual(snap.controlRequests, [{ method: "status", count: 2, refused: 1 }]);
  assert.deepEqual(snap.transitions, [{ from: "unbound", to: "active", count: 1 }]);
  assert.equal(snap.logLinesDropped, 2);
  assert.equal(JSON.stringify(snap).includes("not-a-tool"), false);
  assert.equal(JSON.stringify(snap).includes("free text"), false);
});

void test("OBS-03: a null tool row, an empty timing, or an extra key is not a metrics snapshot", () => {
  const snap = createMetrics({ now: () => CLOCK, monotonicMs: () => 0 }).snapshot();
  assert.equal(isMetricsSnapshot(snap), true);
  assert.equal(isMetricsSnapshot({ ...snap, toolCalls: [null] }), false);
  assert.equal(isMetricsSnapshot({ ...snap, timings: { attachMs: {}, toolCallMs: snap.timings.toolCallMs } }), false);
  assert.equal(isMetricsSnapshot({ ...snap, extra: 1 }), false);
  assert.equal(isMetricsSnapshot({ ...snap, uptimeMs: Number.NaN }), false);
});

void test("OBS-03: a saved snapshot does not change when another call is recorded", () => {
  const registry = createMetrics({ now: () => CLOCK, monotonicMs: () => 0 });
  registry.recordTool("write", "done", 1);
  registry.recordTransition("unbound", "active");
  const first = registry.snapshot();
  registry.recordTool("write", "done", 1);
  registry.recordTransition("unbound", "active");
  assert.equal(first.toolCalls[0]?.count, 1);
  assert.equal(first.transitions[0]?.count, 1);
  assert.equal(registry.snapshot().toolCalls[0]?.count, 2);
});
