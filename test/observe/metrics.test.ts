import { test } from "node:test";
import assert from "node:assert/strict";
import { ERROR_CODES } from "../../src/core/errors.js";
import { BOOT_REPORT_HOSTS, HOST_BOOT_PHASES, HOST_BOOT_TRANSPORTS } from "../../src/host/boot-report.js";
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
  assert.equal(snap.logLinesFallback, 0);
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
  registry.setLogLinesFallback(3.7);
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
  assert.equal(snap.logLinesFallback, 3);
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

interface Observation {
  hostId: string;
  transport: string;
  phase: string;
  code: string | null;
  durationMs: number;
}

function observation(over: Partial<Observation> = {}): Observation {
  return { hostId: "claude", transport: "mcp", phase: "attached", code: null, durationMs: 10, ...over };
}

void test("BOOT-06: host boot reports count per closed-vocabulary row and sort by host, transport, phase, code", () => {
  const registry = createMetrics({ now: () => CLOCK, monotonicMs: () => 0 });
  registry.recordHostBoot(observation());
  registry.recordHostBoot(observation());
  registry.recordHostBoot(observation({ hostId: "omp", transport: "extension" }));
  registry.recordHostBoot(observation({ phase: "refused", code: "POLICY_DENIED" }));
  registry.recordHostBoot(observation({ phase: "refused", code: "PODMAN_MISSING" }));
  registry.recordHostBoot(observation({ transport: "acp" }));
  registry.recordHostBoot(observation({ hostId: "unlabelled" }));
  const rows = registry.snapshot().hostBoot ?? [];
  assert.deepEqual(rows, [
    { hostId: "claude", transport: "acp", phase: "attached", count: 1 },
    { hostId: "claude", transport: "mcp", phase: "attached", count: 2 },
    { hostId: "claude", transport: "mcp", phase: "refused", code: "PODMAN_MISSING", count: 1 },
    { hostId: "claude", transport: "mcp", phase: "refused", code: "POLICY_DENIED", count: 1 },
    { hostId: "omp", transport: "extension", phase: "attached", count: 1 },
    { hostId: "unlabelled", transport: "mcp", phase: "attached", count: 1 },
  ]);
});

void test("BOOT-06: an unknown host, transport, phase or code is ignored", () => {
  const registry = createMetrics({ now: () => CLOCK, monotonicMs: () => 0 });
  registry.recordHostBoot(observation({ hostId: "/home/user/secret" }));
  registry.recordHostBoot(observation({ transport: "stdio" }));
  registry.recordHostBoot(observation({ phase: "started" }));
  registry.recordHostBoot(observation({ phase: "failed", code: "NOT_A_CODE" }));
  const snap = registry.snapshot();
  assert.deepEqual(snap.hostBoot, []);
  assert.equal(snap.timings.hostBootMs?.count, 0);
  assert.equal(JSON.stringify(snap).includes("secret"), false);
});

void test("BOOT-06: at most 256 distinct rows are kept, and an existing row still counts past the cap", () => {
  const registry = createMetrics({ now: () => CLOCK, monotonicMs: () => 0 });
  let sent = 0;
  for (const hostId of BOOT_REPORT_HOSTS) {
    for (const transport of HOST_BOOT_TRANSPORTS) {
      for (const code of ERROR_CODES) {
        registry.recordHostBoot(observation({ hostId, transport, phase: "failed", code, durationMs: 1 }));
        sent += 1;
      }
    }
  }
  assert.ok(sent > 256);
  const full = registry.snapshot();
  assert.equal(full.hostBoot?.length, 256);
  const first = full.hostBoot.[0];
  assert.ok(first !== undefined);
  registry.recordHostBoot(observation({ hostId: first.hostId, transport: first.transport, phase: first.phase, code: first.code ?? null }));
  const after = registry.snapshot();
  assert.equal(after.hostBoot?.length, 256);
  assert.equal(after.hostBoot.[0].count, first.count + 1);
  assert.equal(after.timings.hostBootMs?.count, sent + 1);
});

void test("BOOT-06: hostBootMs observes only attached, refused and failed, in the shared buckets", () => {
  const registry = createMetrics({ now: () => CLOCK, monotonicMs: () => 0 });
  for (const phase of HOST_BOOT_PHASES) {
    registry.recordHostBoot(observation({ phase, code: phase === "attached" || phase === "reattached" || phase === "closed" ? null : "POLICY_DENIED", durationMs: 40 }));
  }
  const timing = registry.snapshot().timings.hostBootMs;
  assert.equal(timing?.count, 3);
  assert.equal(timing.sumMs, 120);
  assert.equal(timing.maxMs, 40);
  assert.deepEqual(timing.bucketUpperBoundsMs, BUCKET_UPPER_BOUNDS_MS);
  assert.equal(registry.snapshot().hostBoot?.length, HOST_BOOT_PHASES.length);
});

void test("BOOT-06: a snapshot validates with the host-boot pair, without it, and refuses a half or malformed pair", () => {
  const registry = createMetrics({ now: () => CLOCK, monotonicMs: () => 0 });
  registry.recordHostBoot(observation());
  registry.recordHostBoot(observation({ phase: "failed", code: "POLICY_DENIED" }));
  const snap = registry.snapshot();
  assert.equal(isMetricsSnapshot(snap), true);
  assert.equal(isMetricsSnapshot(JSON.parse(JSON.stringify(snap)) as unknown), true);

  const timings = snap.timings;
  const hostBootMs = timings.hostBootMs;
  const bare: Record<string, unknown> = {
    ...snap,
    timings: { attachMs: timings.attachMs, toolCallMs: timings.toolCallMs },
  };
  Reflect.deleteProperty(bare, "hostBoot");
  assert.equal(isMetricsSnapshot(bare), true, "an older daemon emits neither key");
  assert.equal(isMetricsSnapshot({ ...bare, hostBoot: [] }), false, "hostBoot without hostBootMs");
  assert.equal(isMetricsSnapshot({ ...bare, timings }), false, "hostBootMs without hostBoot");
  assert.equal(isMetricsSnapshot({ ...snap, hostBoot: [null] }), false);
  assert.equal(isMetricsSnapshot({ ...snap, hostBoot: "rows" }), false);
  assert.equal(isMetricsSnapshot({ ...snap, hostBoot: [{ hostId: "claude", transport: "mcp", phase: "attached" }] }), false, "no count");
  assert.equal(isMetricsSnapshot({ ...snap, hostBoot: [{ hostId: "claude", transport: "mcp", phase: "attached", count: Number.NaN }] }), false);
  assert.equal(isMetricsSnapshot({ ...snap, hostBoot: [{ hostId: "nobody", transport: "mcp", phase: "attached", count: 1 }] }), false);
  assert.equal(isMetricsSnapshot({ ...snap, hostBoot: [{ hostId: "claude", transport: "stdio", phase: "attached", count: 1 }] }), false);
  assert.equal(isMetricsSnapshot({ ...snap, hostBoot: [{ hostId: "claude", transport: "mcp", phase: "started", count: 1 }] }), false);
  assert.equal(isMetricsSnapshot({ ...snap, hostBoot: [{ hostId: "claude", transport: "mcp", phase: "failed", code: "NOPE", count: 1 }] }), false);
  assert.equal(isMetricsSnapshot({ ...snap, hostBoot: [{ hostId: "claude", transport: "mcp", phase: "attached", count: 1, extra: 1 }] }), false);
  assert.equal(isMetricsSnapshot({ ...snap, timings: { ...timings, hostBootMs: {} } }), false);
  assert.equal(isMetricsSnapshot({ ...snap, timings: { ...timings, hostBootMs: { ...hostBootMs, count: Number.NaN } } }), false);
  assert.equal(isMetricsSnapshot({ ...snap, timings: { ...timings, extraMs: hostBootMs } }), false);
});

void test("BOOT-06: controlRequests shows host-boot after recordControl", () => {
  const registry = createMetrics({ now: () => CLOCK, monotonicMs: () => 0 });
  registry.recordControl("host-boot", false);
  registry.recordControl("host-boot", true);
  assert.deepEqual(registry.snapshot().controlRequests, [{ method: "host-boot", count: 2, refused: 1 }]);
});
