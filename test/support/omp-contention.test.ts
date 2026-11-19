// The always-running hermetic test of test/support/omp-contention.ts (Phase 45, OMPV-03; 45-CONTEXT D-45-05): the readings parsers, the
// attribution of every stall interval, the self-inflicted samples, the window shares, the stall set and the probe-driver gap, before any
// live run exists. Pure functions: no process, no clock, no file, no host.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ATTRIBUTION_COVERAGE_MIN,
  attributeInterval,
  BRACKET_SLACK_MS,
  CAUSE_SHARE_MIN,
  type Attribution,
  type ContentionReading,
  maxProbeGapMs,
  observeWindow,
  parsePressureTotals,
  parseSchedstat,
  PROBE_DRIVER_GAP_MAX_MS,
  scopeDirOf,
  selfSamples,
  SLEEP_ROUNDING_MS,
  stallSet,
  type StallSet,
  windowShares,
} from "./omp-contention.js";
import { MAX_LATENCY_MS, MIN_PROBES, MIN_WINDOW_MS, P95_LATENCY_MS, PROBE_INTERVAL_MS, parsePressure, type ProbeSample } from "./responsiveness.js";

// ---- Fixtures --------------------------------------------------------------------------------------------------------------------

const MS = 1_000_000;

function reading(atMs: number, onCpuMs: number, runqMs: number, scopeSomeTotalUs: number | null = null): ContentionReading {
  return { atMs, scopeSomeTotalUs, mainOnCpuNs: onCpuMs * MS, mainRunqNs: runqMs * MS };
}

// Two readings that bracket [0, 1000] ms with the given on-CPU and run-queue milliseconds in between.
function span(onCpuMs: number, runqMs: number): ContentionReading[] {
  return [reading(0, 0, 0), reading(1000, onCpuMs, runqMs)];
}

function attributed(attribution: Attribution): { readonly onCpuMs: number; readonly runqMs: number; readonly sleepMs: number } {
  assert.ok(attribution.attributed, "the interval is attributed");
  return { onCpuMs: attribution.onCpuMs, runqMs: attribution.runqMs, sleepMs: attribution.sleepMs };
}

// ---- The constants ---------------------------------------------------------------------------------------------------------------

void test("OMPV-03 the constants of the attribution are pinned by value", () => {
  assert.deepEqual([ATTRIBUTION_COVERAGE_MIN, PROBE_DRIVER_GAP_MAX_MS, CAUSE_SHARE_MIN, BRACKET_SLACK_MS, SLEEP_ROUNDING_MS], [0.9, 750, 0.5, 50, 5]);
});

void test("OMPV-03 guard: the verdict thresholds this module must never touch keep their values", () => {
  assert.deepEqual([MAX_LATENCY_MS, P95_LATENCY_MS, PROBE_INTERVAL_MS, MIN_PROBES, MIN_WINDOW_MS], [1000, 500, 250, 40, 10_000]);
});

// ---- parseSchedstat --------------------------------------------------------------------------------------------------------------

void test("OMPV-03 parseSchedstat reads three non-negative integers, a trailing newline allowed", () => {
  assert.deepEqual(parseSchedstat("75058095 5481493 5\n"), { onCpuNs: 75_058_095, runqNs: 5_481_493, slices: 5 });
  assert.deepEqual(parseSchedstat("0 0 0"), { onCpuNs: 0, runqNs: 0, slices: 0 });
});

void test("OMPV-03 parseSchedstat refuses two fields, a sign, a non-number and an empty string, naming the line", () => {
  for (const bad of ["1 2", "1 2 3 4", "-1 2 3", "+1 2 3", "1 x 3", "1.5 2 3", "", "\n", "1  2 3", " 1 2 3"]) {
    assert.throws(() => parseSchedstat(bad), { message: `malformed schedstat line: ${JSON.stringify(bad)}` }, bad);
  }
});

// ---- parsePressureTotals ---------------------------------------------------------------------------------------------------------

void test("OMPV-03 parsePressureTotals reads the some line and the full line with their totals", () => {
  const text = "some avg10=1.25 avg60=0.50 avg300=0.10 total=123456\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=789\n";
  assert.deepEqual(parsePressureTotals(text), {
    some: { avg10: 1.25, avg60: 0.5, avg300: 0.1, totalUs: 123_456 },
    full: { avg10: 0, avg60: 0, avg300: 0, totalUs: 789 },
  });
  assert.deepEqual(parsePressureTotals("some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n"), { some: { avg10: 0, avg60: 0, avg300: 0, totalUs: 0 }, full: null });
});

void test("OMPV-03 parsePressureTotals is null without a some line or with a field that is not numeric", () => {
  assert.equal(parsePressureTotals(""), null);
  assert.equal(parsePressureTotals("full avg10=0.00 avg60=0.00 avg300=0.00 total=1\n"), null);
  assert.equal(parsePressureTotals("some avg10=x avg60=0.00 avg300=0.00 total=1\n"), null);
  assert.equal(parsePressureTotals("some avg10=0.00 avg60=0.00 avg300=0.00 total=-1\n"), null);
  assert.equal(parsePressureTotals("some avg10=0.00 avg60=0.00 avg300=0.00\n"), null);
  assert.equal(parsePressureTotals("some avg10=0.00 avg60=0.00 avg300=0.00 total=1\nfull avg10=0.00 avg60=0.00 avg300=oops total=1\n"), null);
});

void test("OMPV-03 the existing parsePressure of responsiveness.ts is not edited: it still reads the averages of the same file", () => {
  assert.deepEqual(parsePressure("some avg10=1.25 avg60=0.50 avg300=0.10 total=123456\n"), { avg10: 1.25, avg60: 0.5, avg300: 0.1 });
});

// ---- scopeDirOf ------------------------------------------------------------------------------------------------------------------

void test("OMPV-03 scopeDirOf joins the mount root and the path of the unified-hierarchy line", () => {
  const text = "12:cpu:/legacy\n0::/user.slice/user-1000.slice/user@1000.service/app.slice/run-p1-i2.scope\n";
  assert.equal(scopeDirOf(text, "/sys/fs/cgroup"), "/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/app.slice/run-p1-i2.scope");
  assert.equal(scopeDirOf("0::/a.scope", "/sys/fs/cgroup/"), "/sys/fs/cgroup/a.scope");
});

void test("OMPV-03 scopeDirOf is an error without the line, in the root, deleted, or with a dot-dot segment", () => {
  assert.throws(() => scopeDirOf("1:name=systemd:/x\n", "/sys/fs/cgroup"), /no unified-hierarchy cgroup line/);
  assert.throws(() => scopeDirOf("0::/\n", "/sys/fs/cgroup"), /root cgroup/);
  assert.throws(() => scopeDirOf("0::/a.scope (deleted)\n", "/sys/fs/cgroup"), /deleted/);
  assert.throws(() => scopeDirOf("0::/a/../b.scope\n", "/sys/fs/cgroup"), /dot-dot/);
});

// ---- attributeInterval -----------------------------------------------------------------------------------------------------------

void test("OMPV-03 attributeInterval: a busy interval (900 of 1000 ms on CPU)", () => {
  assert.deepEqual(attributed(attributeInterval(span(900, 0), 0, 1000)), { onCpuMs: 900, runqMs: 0, sleepMs: 100 });
});

void test("OMPV-03 attributeInterval: a run-queue-only interval (800 of 1000 ms waiting)", () => {
  assert.deepEqual(attributed(attributeInterval(span(0, 800), 0, 1000)), { onCpuMs: 0, runqMs: 800, sleepMs: 200 });
});

void test("OMPV-03 attributeInterval: a sleeping interval (nothing on CPU, nothing waiting)", () => {
  assert.deepEqual(attributed(attributeInterval(span(0, 0), 0, 1000)), { onCpuMs: 0, runqMs: 0, sleepMs: 1000 });
});

void test("OMPV-03 attributeInterval: a mixed interval", () => {
  assert.deepEqual(attributed(attributeInterval(span(300, 200), 0, 1000)), { onCpuMs: 300, runqMs: 200, sleepMs: 500 });
});

void test("OMPV-03 attributeInterval uses the latest reading at or before the start and the earliest at or after the end", () => {
  const readings = [reading(0, 0, 0), reading(100, 10, 0), reading(200, 20, 0), reading(900, 500, 0), reading(1000, 520, 0), reading(1100, 600, 0)];
  assert.deepEqual(attributed(attributeInterval(readings, 150, 950)), { onCpuMs: 510, runqMs: 0, sleepMs: 390 });
});

void test("OMPV-03 attributeInterval: the span is the one the two readings actually cover", () => {
  const readings = [reading(0, 0, 0), reading(1100, 100, 100)];
  assert.deepEqual(attributed(attributeInterval(readings, 30, 1070)), { onCpuMs: 100, runqMs: 100, sleepMs: 900 });
});

void test("OMPV-03 attributeInterval: a bracket 50 ms away holds, 51 ms away does not", () => {
  const readings = [reading(0, 0, 0), reading(1000, 100, 0)];
  assert.equal(attributeInterval(readings, 50, 950).attributed, true);
  assert.equal(attributeInterval(readings, 51, 950).attributed, false);
  assert.equal(attributeInterval(readings, 50, 949).attributed, false);
});

void test("OMPV-03 attributeInterval: an empty reading list, one that does not reach the end, and equal from and to", () => {
  assert.deepEqual(attributeInterval([], 0, 1000), { attributed: false });
  assert.deepEqual(attributeInterval([reading(0, 0, 0)], 0, 1000), { attributed: false });
  assert.deepEqual(attributeInterval([reading(500, 0, 0)], 400, 1000), { attributed: false });
  assert.deepEqual(attributed(attributeInterval([reading(500, 7, 3)], 500, 500)), { onCpuMs: 0, runqMs: 0, sleepMs: 0 });
});

void test("OMPV-03 attributeInterval: a residual of 5 ms below zero is rounding and is clamped, 6 ms is an inconsistent reading error", () => {
  assert.deepEqual(attributed(attributeInterval(span(600, 405), 0, 1000)), { onCpuMs: 600, runqMs: 405, sleepMs: 0 });
  assert.throws(() => attributeInterval(span(600, 406), 0, 1000), /inconsistent readings/);
  assert.throws(() => attributeInterval([reading(0, 10, 0), reading(1000, 3, 0)], 0, 1000), /counter went backwards/);
  // A counter that goes back by at most the rounding (two readings taken in the other order within a millisecond) reads as no time.
  assert.deepEqual(attributed(attributeInterval([reading(0, 10, 0), reading(1000, 5, 0)], 0, 1000)), { onCpuMs: 0, runqMs: 0, sleepMs: 1000 });
});

// ---- selfSamples -----------------------------------------------------------------------------------------------------------------

// The shape of the recorded attempt 1 of Phase 38: a probe answered after 9906 ms and ten probes unanswered at 10 000 ms, with 9000 ms
// of the first interval in the run queue and half of the later time waiting for a CPU.
function attemptOne(): { readonly samples: ProbeSample[]; readonly readings: ContentionReading[] } {
  const samples: ProbeSample[] = [{ sentAtMs: 0, latencyMs: 9906 }];
  for (let index = 0; index < 10; index += 1) {
    samples.push({ sentAtMs: 10_000 + index * PROBE_INTERVAL_MS, latencyMs: undefined });
  }
  const readings: ContentionReading[] = [reading(0, 0, 0), reading(9906, 0, 9000)];
  for (let atMs = 9950; atMs <= 22_300; atMs += 50) {
    const sinceMs = atMs - 9906;
    readings.push(reading(atMs, 0.3 * sinceMs, 9000 + 0.5 * sinceMs));
  }
  return { samples, readings };
}

void test("OMPV-03 selfSamples on the shape of Phase 38 attempt 1: 906 ms for the slow probe, not zero for the unanswered ones", () => {
  const { samples, readings } = attemptOne();
  const result = selfSamples(samples, readings, 10_000);
  assert.equal(result.samples[0]?.latencyMs, 906);
  for (const sample of result.samples.slice(1)) {
    assert.ok(sample.latencyMs !== undefined && sample.latencyMs > 0, "an unanswered probe is kept as an answered sample with a self latency that is not zero");
    assert.equal(sample.latencyMs, 5000);
  }
  assert.equal(result.coverage, 1);
  assert.equal(result.attributions.length, samples.length);
});

void test("OMPV-03 selfSamples with no run-queue time gives the raw numbers, an unanswered probe at the answer timeout", () => {
  const { samples } = attemptOne();
  const readings = [reading(0, 0, 0)];
  for (let atMs = 50; atMs <= 22_300; atMs += 50) {
    readings.push(reading(atMs, 0.3 * atMs, 0));
  }
  readings.push(reading(9906, 0.3 * 9906, 0));
  readings.sort((a, b) => a.atMs - b.atMs);
  const result = selfSamples(samples, readings, 10_000);
  assert.equal(result.samples[0]?.latencyMs, 9906);
  assert.deepEqual(new Set(result.samples.slice(1).map((sample) => sample.latencyMs)), new Set([10_000]));
});

void test("OMPV-03 selfSamples: an unattributed probe keeps its raw latency and lowers the coverage; an empty list has coverage 1", () => {
  const samples: ProbeSample[] = [{ sentAtMs: 0, latencyMs: 800 }, { sentAtMs: 5000, latencyMs: 600 }];
  const readings = [reading(0, 0, 0), reading(800, 0, 700)];
  const result = selfSamples(samples, readings, 10_000);
  assert.deepEqual(result.samples.map((sample) => sample.latencyMs), [100, 600]);
  assert.deepEqual(result.attributions.map((attribution) => attribution.attributed), [true, false]);
  assert.equal(result.coverage, 0.5);
  assert.equal(selfSamples([], readings, 10_000).coverage, 1);
});

void test("OMPV-03 selfSamples never goes below zero", () => {
  const result = selfSamples([{ sentAtMs: 0, latencyMs: 400 }], [reading(0, 0, 0), reading(400, 0, 402)], 10_000);
  assert.equal(result.samples[0]?.latencyMs, 0);
});

// ---- windowShares ----------------------------------------------------------------------------------------------------------------

void test("OMPV-03 windowShares: the stall share from the totals and the run-queue share from the thread", () => {
  const readings = [reading(0, 0, 0, 0), reading(1000, 100, 100, 300_000), reading(2000, 200, 400, 600_000)];
  assert.deepEqual(windowShares(readings, 0, 2000), { scopeStallShare: 0.3, runqShare: 0.2 });
  assert.deepEqual(windowShares(readings, 1000, 2000), { scopeStallShare: 0.3, runqShare: 0.3 });
});

void test("OMPV-03 windowShares: a null total or fewer than two readings in the window gives a null stall share", () => {
  const readings = [reading(0, 0, 0, 0), reading(1000, 100, 100, null), reading(2000, 200, 400, 600_000)];
  assert.deepEqual(windowShares(readings, 0, 2000), { scopeStallShare: null, runqShare: 0.2 });
  assert.deepEqual(windowShares(readings, 1500, 2500), { scopeStallShare: null, runqShare: null });
  assert.deepEqual(windowShares([], 0, 1000), { scopeStallShare: null, runqShare: null });
});

void test("OMPV-03 windowShares: a share above 1 by more than rounding is an inconsistent reading error, within rounding it reads 1", () => {
  assert.throws(() => windowShares([reading(0, 0, 0, 0), reading(2000, 0, 0, 3_000_000)], 0, 2000), /inconsistent readings/);
  assert.throws(() => windowShares([reading(0, 0, 0, 0), reading(2000, 0, 2100, 0)], 0, 2000), /inconsistent readings/);
  assert.equal(windowShares([reading(0, 0, 0, 0), reading(2000, 0, 0, 2_003_000)], 0, 2000).scopeStallShare, 1);
  assert.throws(() => windowShares([reading(0, 0, 0, 500), reading(2000, 0, 0, 100)], 0, 2000), /went backwards/);
});

// ---- stallSet --------------------------------------------------------------------------------------------------------------------

function onSet(parts: readonly (readonly [selfMs: number, onCpuMs: number, runqMs: number, sleepMs: number] | null)[]): StallSet {
  const samples: ProbeSample[] = parts.map((part, index) => ({ sentAtMs: index * 250, latencyMs: part === null ? 700 : part[0] }));
  const attributions: Attribution[] = parts.map((part) => (part === null ? { attributed: false } : { attributed: true, onCpuMs: part[1], runqMs: part[2], sleepMs: part[3] }));
  return stallSet(samples, attributions);
}

void test("OMPV-03 stallSet: on-CPU time carries the set (0.6 on CPU)", () => {
  const set = onSet([[600, 500, 100, 100], [700, 400, 100, 300], [100, 0, 0, 100]]);
  assert.equal(set.count, 2);
  assert.equal(set.attributedCount, 2);
  assert.deepEqual([set.onCpuMs, set.runqMs, set.sleepMs], [900, 200, 400]);
  assert.equal(set.onCpuShare, 0.6);
  assert.equal(set.cause, "on-cpu");
});

void test("OMPV-03 stallSet: sleep carries the set", () => {
  const set = onSet([[600, 100, 0, 700]]);
  assert.equal(set.cause, "sleep");
  assert.ok(set.sleepShare >= CAUSE_SHARE_MIN);
});

void test("OMPV-03 stallSet: neither on-CPU nor sleep reaches 0.5 reads mixed", () => {
  const set = onSet([[600, 400, 300, 300]]);
  assert.equal(set.cause, "mixed");
  assert.deepEqual([set.onCpuShare, set.sleepShare], [0.4, 0.3]);
});

void test("OMPV-03 stallSet: a tie at exactly 0.5 for both reads on-cpu", () => {
  const set = onSet([[600, 500, 0, 500]]);
  assert.deepEqual([set.onCpuShare, set.sleepShare], [0.5, 0.5]);
  assert.equal(set.cause, "on-cpu");
});

void test("OMPV-03 stallSet: the bound is the 500 ms threshold (500 is not in the set, 501 is), an empty set is none", () => {
  assert.equal(onSet([[500, 500, 0, 0]]).count, 0);
  assert.equal(onSet([[500, 500, 0, 0]]).cause, "none");
  assert.equal(onSet([[501, 501, 0, 0]]).count, 1);
  assert.equal(onSet([]).cause, "none");
});

void test("OMPV-03 stallSet: a set of only unattributed probes is unattributed; unattributed probes add no time to a mixed set", () => {
  const unattributed = onSet([null, null]);
  assert.equal(unattributed.cause, "unattributed");
  assert.deepEqual([unattributed.count, unattributed.attributedCount, unattributed.onCpuMs], [2, 0, 0]);
  const some = onSet([null, [600, 500, 0, 100]]);
  assert.deepEqual([some.count, some.attributedCount, some.cause], [2, 1, "on-cpu"]);
});

void test("OMPV-03 stallSet refuses samples and attributions of different length", () => {
  assert.throws(() => stallSet([{ sentAtMs: 0, latencyMs: 1 }], []), /one attribution per sample/);
});

// ---- maxProbeGapMs ---------------------------------------------------------------------------------------------------------------

void test("OMPV-03 maxProbeGapMs: the largest difference between consecutive sends, 0 for fewer than two samples", () => {
  assert.equal(maxProbeGapMs([]), 0);
  assert.equal(maxProbeGapMs([{ sentAtMs: 5, latencyMs: 1 }]), 0);
  assert.equal(
    maxProbeGapMs([{ sentAtMs: 0, latencyMs: 1 }, { sentAtMs: 250, latencyMs: 1 }, { sentAtMs: 1100, latencyMs: undefined }, { sentAtMs: 1350, latencyMs: 1 }]),
    850,
  );
});

// ---- observeWindow ---------------------------------------------------------------------------------------------------------------

void test("OMPV-03 observeWindow reads the probes sent at or after the ready time and nothing before it", () => {
  const samples: ProbeSample[] = [
    { sentAtMs: 0, latencyMs: undefined },
    { sentAtMs: 1000, latencyMs: 100 },
    { sentAtMs: 1250, latencyMs: 700 },
    { sentAtMs: 1500, latencyMs: 100 },
  ];
  const readings = [reading(1000, 0, 0, 0), reading(1100, 50, 0, 10_000), reading(1250, 60, 0, 20_000), reading(1500, 300, 50, 200_000), reading(1600, 400, 50, 250_000), reading(1950, 500, 100, 300_000)];
  const observation = observeWindow({ samples, readings, readyMs: 1000, answerTimeoutMs: 10_000 });
  assert.equal(observation.raw.sent, 3);
  assert.equal(observation.self.sent, 3);
  assert.equal(observation.raw.maxMs, 700);
  assert.equal(observation.probeGapMaxMs, 250);
  assert.equal(observation.coverage, 1);
  assert.ok(observation.scopeStallShare !== null && observation.runqShare !== null);
  assert.equal(observation.stallSet.cause, "on-cpu");
});

void test("OMPV-03 observeWindow with no ready time is an empty window", () => {
  const observation = observeWindow({ samples: [{ sentAtMs: 0, latencyMs: 5 }], readings: [], readyMs: undefined, answerTimeoutMs: 10_000 });
  assert.equal(observation.raw.sent, 0);
  assert.equal(observation.coverage, 1);
  assert.equal(observation.scopeStallShare, null);
  assert.equal(observation.stallSet.cause, "none");
  assert.throws(() => observeWindow({ samples: [{ sentAtMs: 0, latencyMs: 5 }], readings: [], readyMs: -1, answerTimeoutMs: 10_000 }), /ready time/);
});
