// The always-running hermetic test of test/support/responsiveness.ts (V1LIVE-01): pure functions, no process, no clock, no host.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASELINE_MIN_PROBES,
  checkedReadyAtMs,
  type LatencySummary,
  latencyProblems,
  MAX_LATENCY_MS,
  MIN_PROBES,
  MIN_WINDOW_MS,
  P95_LATENCY_MS,
  parsePressure,
  PROBE_INTERVAL_MS,
  type ProbeSample,
  QUIET_LOAD_PER_CPU,
  quietHost,
  relativeSummary,
  responsivenessProblems,
  samplesCsv,
  samplesCsvWithPhase,
  SECONDARY_HEADING,
  summariseLatencies,
  summaryText,
  summaryTextWithSecondary,
} from "./responsiveness.js";

// A passing summary, for a case to change one field of.
const PASSING: LatencySummary = { sent: 50, answered: 50, unanswered: 0, maxMs: 300, medianMs: 40, p95Ms: 120, longestGapMs: 400, windowMs: 12_000 };

void test("V1LIVE-01 the constants are the bounds of the plan", () => {
  assert.deepEqual([PROBE_INTERVAL_MS, MAX_LATENCY_MS, P95_LATENCY_MS, MIN_PROBES, MIN_WINDOW_MS, BASELINE_MIN_PROBES, QUIET_LOAD_PER_CPU], [250, 1000, 500, 40, 10_000, 30, 0.5]);
});

void test("V1LIVE-01 the percentile is the nearest rank on a known list, and the median is the nearest rank 50", () => {
  const samples: ProbeSample[] = [];
  for (let i = 1; i <= 20; i += 1) {
    // Latencies 1..20 ms, sent in a shuffled order: the summary sorts.
    samples.push({ sentAtMs: i * 250, latencyMs: ((i * 7) % 20) + 1 });
  }
  const summary = summariseLatencies(samples);
  assert.equal(summary.sent, 20);
  assert.equal(summary.answered, 20);
  assert.equal(summary.maxMs, 20);
  assert.equal(summary.medianMs, 10, "rank ceil(0.5 * 20) = 10");
  assert.equal(summary.p95Ms, 19, "rank ceil(0.95 * 20) = 19");
  const odd = summariseLatencies([10, 30, 20].map((latencyMs, index) => ({ sentAtMs: index * 250, latencyMs })));
  assert.equal(odd.medianMs, 20);
  assert.equal(odd.p95Ms, 30);
});

void test("V1LIVE-01 an empty list gives zeros and never divides by zero", () => {
  assert.deepEqual(summariseLatencies([]), { sent: 0, answered: 0, unanswered: 0, maxMs: 0, medianMs: 0, p95Ms: 0, longestGapMs: 0, windowMs: 0 });
  const unanswered = summariseLatencies([{ sentAtMs: 5, latencyMs: undefined }]);
  assert.deepEqual([unanswered.sent, unanswered.answered, unanswered.unanswered, unanswered.p95Ms, unanswered.maxMs], [1, 0, 1, 0, 0]);
});

void test("V1LIVE-01 an unanswered sample counts as unanswered and is not in the percentile", () => {
  const summary = summariseLatencies([
    { sentAtMs: 0, latencyMs: 10 },
    { sentAtMs: 250, latencyMs: undefined },
    { sentAtMs: 500, latencyMs: 30 },
  ]);
  assert.deepEqual([summary.sent, summary.answered, summary.unanswered], [3, 2, 1]);
  assert.equal(summary.maxMs, 30);
  assert.equal(summary.p95Ms, 30);
  assert.equal(summary.windowMs, 500);
});

void test("V1LIVE-01 the longest gap is measured between answer times, counted from the first send", () => {
  // Answers arrive at 100, 150 and 2150 ms: the gaps are 100 (first send to first answer), 50 and 2000.
  const gap = summariseLatencies([
    { sentAtMs: 0, latencyMs: 100 },
    { sentAtMs: 50, latencyMs: 100 },
    { sentAtMs: 150, latencyMs: 2000 },
  ]);
  assert.equal(gap.longestGapMs, 2000);
  const early = summariseLatencies([
    { sentAtMs: 1000, latencyMs: 900 },
    { sentAtMs: 1250, latencyMs: 700 },
  ]);
  assert.equal(early.longestGapMs, 900, "the first send to the first answer counts");
});

void test("V1LIVE-01 a passing summary has no problems; a short window and too few probes are each reported", () => {
  assert.deepEqual(responsivenessProblems(PASSING), []);
  const short = responsivenessProblems({ ...PASSING, windowMs: 9_999 });
  assert.equal(short.length, 1);
  assert.match(String(short[0]), /attach window was too short to be a measurement/);
  const few = responsivenessProblems({ ...PASSING, sent: 39, answered: 39 });
  assert.equal(few.length, 1);
  assert.match(String(few[0]), /only 39 probes were sent; at least 40/);
  assert.deepEqual(responsivenessProblems({ ...PASSING, sent: 40, answered: 40, windowMs: 10_000 }), []);
  assert.deepEqual(responsivenessProblems({ ...PASSING, sent: 30, answered: 30 }, { minProbes: BASELINE_MIN_PROBES }), [], "the baseline bound of 30 probes");
  assert.equal(responsivenessProblems({ ...PASSING, sent: 29, answered: 29 }, { minProbes: BASELINE_MIN_PROBES }).length, 1);
  assert.deepEqual(responsivenessProblems(summariseLatencies([])), ["no probe was sent, so nothing was measured"]);
});

void test("V1LIVE-01 an unanswered probe, a maximum of 1001 ms and a 95th percentile above 500 ms each fail on their own", () => {
  const unanswered = responsivenessProblems({ ...PASSING, answered: 49, unanswered: 1 });
  assert.equal(unanswered.length, 1);
  assert.match(String(unanswered[0]), /1 of 50 probes were never answered/);
  assert.deepEqual(responsivenessProblems({ ...PASSING, maxMs: 1000 }), []);
  const slow = responsivenessProblems({ ...PASSING, maxMs: 1001 });
  assert.equal(slow.length, 1);
  assert.match(String(slow[0]), /maximum latency was 1001 ms/);
  assert.deepEqual(responsivenessProblems({ ...PASSING, p95Ms: 500 }), []);
  const p95 = responsivenessProblems({ ...PASSING, p95Ms: 501 });
  assert.equal(p95.length, 1);
  assert.match(String(p95[0]), /95th percentile latency was 501 ms/);
  assert.equal(responsivenessProblems({ ...PASSING, windowMs: 1, sent: 3, answered: 0, unanswered: 3, maxMs: 2000, p95Ms: 900 }).length, 5);
  assert.deepEqual(responsivenessProblems({ ...PASSING, maxMs: 1500 }, { maxLatencyMs: 2000 }), []);
});

void test("V1LIVE-01 quietHost passes at 0.5 load per cpu, fails above it, and counts zero cpus as one", () => {
  assert.deepEqual(quietHost(4, 8, 0.5), { quiet: true, perCpu: 0.5 });
  assert.equal(quietHost(4.01, 8, 0.5).quiet, false);
  assert.equal(quietHost(12, 8, 0.5).quiet, false);
  assert.deepEqual(quietHost(0.4, 0, 0.5), { quiet: true, perCpu: 0.4 });
  assert.equal(quietHost(0.6, 0, 0.5).quiet, false);
});

void test("V1LIVE-01 samplesCsv has a header and one line per sample, and summaryText names the counts and loads", () => {
  const samples: ProbeSample[] = [
    { sentAtMs: 0, latencyMs: 12 },
    { sentAtMs: 250, latencyMs: undefined },
  ];
  assert.equal(samplesCsv(samples), "sentAtMs,latencyMs\n0,12\n250,\n");
  assert.equal(samplesCsv([]), "sentAtMs,latencyMs\n");
  const text = summaryText("baseline (loaded)", summariseLatencies(samples), [{ label: "before", load1: 12, load5: 14.6, load15: 11.8, cpus: 8 }]);
  assert.match(text, /^measurement: baseline \(loaded\)\n/);
  assert.match(text, /probes sent: 2\n/);
  assert.match(text, /probes unanswered: 1\n/);
  assert.match(text, /maximum latency: 12 ms\n/);
  assert.match(text, /load before: 12\.00 14\.60 11\.80 on 8 cpus\n/);
});

// The exact output strings of the verdict, pinned so that sharing the latency conditions with the decision rule (latencyProblems) is
// proven behavior-neutral: the strings, their order and their count are what the cold-attach test asserts on.
void test("V1LIVE-01 responsivenessProblems pins its exact strings, one condition at a time", () => {
  assert.deepEqual(responsivenessProblems({ ...PASSING, sent: 39, answered: 39 }), ["only 39 probes were sent; at least 40 are needed"]);
  assert.deepEqual(responsivenessProblems({ ...PASSING, windowMs: 9_999 }), ["the attach window was too short to be a measurement: 9999 ms, at least 10000 ms are needed"]);
  assert.deepEqual(responsivenessProblems({ ...PASSING, answered: 47, unanswered: 3 }), ["3 of 50 probes were never answered"]);
  assert.deepEqual(responsivenessProblems({ ...PASSING, maxMs: 1001 }), ["the maximum latency was 1001 ms, above 1000 ms"]);
  assert.deepEqual(responsivenessProblems({ ...PASSING, p95Ms: 501 }), ["the 95th percentile latency was 501 ms, above 500 ms"]);
  assert.deepEqual(responsivenessProblems({ ...PASSING, sent: 30, answered: 30 }, { minProbes: BASELINE_MIN_PROBES, minWindowMs: 9_750 }), []);
  assert.deepEqual(responsivenessProblems({ ...PASSING, windowMs: 9_000 }, { minWindowMs: 9_750 }), ["the attach window was too short to be a measurement: 9000 ms, at least 9750 ms are needed"]);
});

void test("V1LIVE-01 responsivenessProblems pins its combination: shortness first, then unanswered, maximum and 95th percentile", () => {
  assert.deepEqual(responsivenessProblems({ sent: 3, answered: 0, unanswered: 3, maxMs: 2000, medianMs: 0, p95Ms: 900, longestGapMs: 0, windowMs: 1 }), [
    "only 3 probes were sent; at least 40 are needed",
    "the attach window was too short to be a measurement: 1 ms, at least 10000 ms are needed",
    "3 of 3 probes were never answered",
    "the maximum latency was 2000 ms, above 1000 ms",
    "the 95th percentile latency was 900 ms, above 500 ms",
  ]);
  assert.deepEqual(responsivenessProblems({ ...PASSING, answered: 49, unanswered: 1, maxMs: 9_868, p95Ms: 8_910 }), [
    "1 of 50 probes were never answered",
    "the maximum latency was 9868 ms, above 1000 ms",
    "the 95th percentile latency was 8910 ms, above 500 ms",
  ]);
  assert.deepEqual(responsivenessProblems({ sent: 0, answered: 0, unanswered: 0, maxMs: 0, medianMs: 0, p95Ms: 0, longestGapMs: 0, windowMs: 0 }), ["no probe was sent, so nothing was measured"]);
});

void test("V1LIVE-01 latencyProblems is the latency half of the verdict and has no shortness condition", () => {
  assert.deepEqual(latencyProblems({ ...PASSING, sent: 3, windowMs: 1 }), []);
  assert.deepEqual(latencyProblems({ ...PASSING, answered: 49, unanswered: 1, maxMs: 1001, p95Ms: 501 }), [
    "1 of 50 probes were never answered",
    "the maximum latency was 1001 ms, above 1000 ms",
    "the 95th percentile latency was 501 ms, above 500 ms",
  ]);
  assert.deepEqual(latencyProblems({ ...PASSING, maxMs: 1500 }, { maxLatencyMs: 2000 }), []);
  assert.deepEqual(latencyProblems({ sent: 0, answered: 0, unanswered: 0, maxMs: 0, medianMs: 0, p95Ms: 0, longestGapMs: 0, windowMs: 0 }), []);
});

void test("Phase 44 samplesCsvWithPhase marks a probe sent before the ready time boot and one at or after it window", () => {
  const samples: ProbeSample[] = [
    { sentAtMs: 0, latencyMs: undefined },
    { sentAtMs: 499, latencyMs: 700 },
    { sentAtMs: 500, latencyMs: 20 },
    { sentAtMs: 750, latencyMs: 15 },
  ];
  assert.equal(samplesCsvWithPhase(samples, 500), "sentAtMs,latencyMs,phase\n0,,boot\n499,700,boot\n500,20,window\n750,15,window\n");
  assert.equal(samplesCsvWithPhase([], 500), "sentAtMs,latencyMs,phase\n");
  assert.equal(samplesCsv(samples), "sentAtMs,latencyMs\n0,\n499,700\n500,20\n750,15\n", "samplesCsv is unchanged");
});

void test("Phase 44 a ready time that is not a finite, non-negative number is an error", () => {
  assert.equal(checkedReadyAtMs(0), 0);
  assert.equal(checkedReadyAtMs(11_320), 11_320);
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
    assert.throws(() => checkedReadyAtMs(bad), /finite, non-negative/);
    assert.throws(() => samplesCsvWithPhase([], bad), /finite, non-negative/);
  }
});

void test("Phase 44 relativeSummary is the window minus the reference, labelled, with no verdict member", () => {
  const window: LatencySummary = { ...PASSING, maxMs: 1403, p95Ms: 705 };
  const reference: LatencySummary = { ...PASSING, maxMs: 1001, p95Ms: 512 };
  const relative = relativeSummary(window, reference);
  assert.deepEqual(relative, { label: "secondary, control-relative, not a verdict", maxMs: 402, p95Ms: 193 });
  assert.equal(relative.label, SECONDARY_HEADING);
  assert.deepEqual(Object.keys(relative).sort(), ["label", "maxMs", "p95Ms"]);
  assert.ok(!("verdict" in relative) && !("pass" in relative) && !("passed" in relative));
  assert.equal(relativeSummary(reference, window).maxMs, -402, "a window faster than the reference reads negative, not as a pass");
});

void test("Phase 44 parsePressure reads the some line and nothing else", () => {
  const text = "some avg10=47.90 avg60=32.01 avg300=36.53 total=123456789\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n";
  assert.deepEqual(parsePressure(text), { avg10: 47.9, avg60: 32.01, avg300: 36.53 });
  assert.deepEqual(parsePressure("some avg10=0.00 avg60=0.00 avg300=0.00 total=0"), { avg10: 0, avg60: 0, avg300: 0 });
  assert.equal(parsePressure(""), null);
  assert.equal(parsePressure("full avg10=1.00 avg60=1.00 avg300=1.00 total=0\n"), null, "no some line");
  assert.equal(parsePressure("some avg10=x avg60=32.01 avg300=36.53 total=1\n"), null);
  assert.equal(parsePressure("some avg10=47.90 avg60=NaN avg300=36.53 total=1\n"), null);
  assert.equal(parsePressure("some avg10=47.90 avg60=32.01\n"), null, "a missing field");
});

void test("Phase 44 summaryTextWithSecondary reports the corrected window, the uncorrected numbers, the boot samples and the labelled secondary section", () => {
  const text = summaryTextWithSecondary(
    "cold attach",
    {
      readyAtMs: 11_320,
      window: { ...PASSING, maxMs: 1403, p95Ms: 705 },
      all: { ...PASSING, sent: 151, answered: 141, unanswered: 10, maxMs: 9906, p95Ms: 8213 },
      boot: { ...PASSING, sent: 45, answered: 35, unanswered: 10 },
      firstAnswerMs: 12_498,
      relative: { label: SECONDARY_HEADING, maxMs: 402, p95Ms: 193 },
      referenceLabel: "the in-run baseline",
    },
    [{ label: "before the baseline", load1: 1.99, load5: 1.5, load15: 1, cpus: 8 }],
  );
  assert.match(text, /^measurement: cold attach\n/);
  assert.match(text, /corrected window, probes sent at or after Omp ready \(11320 ms from process start\)/);
  assert.match(text, /uncorrected, every probe from process start:\nprobes sent: 151\nprobes answered: 141\nprobes unanswered: 10\n/);
  assert.match(text, /maximum latency: 9906 ms/);
  assert.match(text, /boot samples, probes sent before Omp ready:\nprobes sent: 45\n/);
  assert.match(text, /first answer over all samples: 12498 ms/);
  assert.match(text, /secondary, control-relative, not a verdict:\nmaximum latency minus the in-run baseline: 402 ms\n95th percentile latency minus the in-run baseline: 193 ms\n/);
  assert.match(text, /load before the baseline: 1\.99 1\.50 1\.00 on 8 cpus\n$/);
  assert.ok(!/pass/i.test(text.split("secondary")[1] ?? ""), "the secondary section never says pass");
  const none = summaryTextWithSecondary("x", { readyAtMs: 1, window: PASSING, all: PASSING, boot: PASSING, firstAnswerMs: undefined, relative: relativeSummary(PASSING, PASSING), referenceLabel: "r" }, []);
  assert.match(none, /first answer over all samples: not seen\n/);
});
