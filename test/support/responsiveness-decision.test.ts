// The always-running hermetic test of test/support/responsiveness-decision.ts (Phase 38, 38-CONTEXT D-38-02 and D-38-03): the frozen
// constants and every row of both tables. Pure functions, no process, no clock, no host.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BOOT_EXCESS_MAX_MS,
  bootExcessMs,
  classifyRun,
  CONTROL_MAX_WINDOW_MS,
  CONTROL_MIN_WINDOW_MS,
  decideWindow,
  firstAnswerMs,
  MAX_ATTEMPTS,
  MIN_VALID_RUNS,
  type RunCase,
  servingProblems,
  startupOrder,
} from "./responsiveness-decision.js";
import { MAX_LATENCY_MS, MIN_PROBES, MIN_WINDOW_MS, P95_LATENCY_MS, PROBE_INTERVAL_MS, type ProbeSample, responsivenessProblems, summariseLatencies } from "./responsiveness.js";

// A probe every 250 ms from process start: `count` probes, each answered after `latency(index)` ms, or never when it returns undefined.
function ladder(count: number, latency: (index: number) => number | undefined): ProbeSample[] {
  return Array.from({ length: count }, (_, index) => ({ sentAtMs: index * PROBE_INTERVAL_MS, latencyMs: latency(index) }));
}

// 60 probes over 14.75 s, every one answered in 20 ms: passes the verdict with a first answer at 20 ms.
const PASSING = ladder(60, () => 20);
const CONTROL: readonly [number, ...number[]] = [500];

void test("Phase 38 the constants of the rule are frozen", () => {
  assert.equal(MIN_VALID_RUNS, 3);
  assert.equal(MAX_ATTEMPTS, 6);
  assert.equal(BOOT_EXCESS_MAX_MS, 250);
  assert.equal(BOOT_EXCESS_MAX_MS, PROBE_INTERVAL_MS, "one probe interval");
  assert.equal(CONTROL_MIN_WINDOW_MS, 12_000);
  assert.equal(CONTROL_MAX_WINDOW_MS, 60_000);
  assert.deepEqual([PROBE_INTERVAL_MS, MAX_LATENCY_MS, P95_LATENCY_MS, MIN_PROBES, MIN_WINDOW_MS], [250, 1000, 500, 40, 10_000], "the verdict constants the rule re-reads");
});

void test("Phase 38 firstAnswerMs is the smallest send time plus latency among the answered probes, and undefined when none was answered", () => {
  assert.equal(
    firstAnswerMs([
      { sentAtMs: 0, latencyMs: 900 },
      { sentAtMs: 250, latencyMs: 100 },
      { sentAtMs: 500, latencyMs: 10 },
    ]),
    350,
    "the probe sent at 250 ms is answered first, at 350 ms",
  );
  assert.equal(firstAnswerMs([{ sentAtMs: 0, latencyMs: undefined }, { sentAtMs: 250, latencyMs: 7 }]), 257);
  assert.equal(firstAnswerMs([{ sentAtMs: 0, latencyMs: undefined }]), undefined);
  assert.equal(firstAnswerMs([]), undefined);
});

void test("Phase 38 servingProblems reads only the probes sent at or after the first answer", () => {
  // Probes at 0 and 250 ms are answered at 2000 ms (boot); one probe at 500 ms is never answered (boot time, but sent before 2000).
  const boot: ProbeSample[] = [
    { sentAtMs: 0, latencyMs: 2000 },
    { sentAtMs: 250, latencyMs: 1750 },
    { sentAtMs: 500, latencyMs: undefined },
  ];
  assert.deepEqual(servingProblems(boot), [], "nothing was sent at or after the first answer");
  const afterBoot = ladder(40, (i) => (i === 0 ? undefined : 10)).map((sample) => ({ ...sample, sentAtMs: sample.sentAtMs + 2000 }));
  assert.equal(servingProblems([...boot, ...afterBoot]).length, 1, "an unanswered probe sent at the first answer is a serving problem; the boot-time one is not");
  assert.deepEqual(servingProblems(ladder(40, (i) => (i === 3 ? 1001 : 10))), ["the maximum latency was 1001 ms, above 1000 ms"]);
  assert.deepEqual(servingProblems(ladder(40, () => 10)), []);
  assert.deepEqual(servingProblems(ladder(5, () => undefined)), ["no probe was answered, so Omp never served"]);
  assert.deepEqual(servingProblems([]), ["no probe was answered, so Omp never served"]);
});

void test("Phase 38 servingProblems counts an unanswered later probe and a slow 95th percentile", () => {
  const later = [...ladder(30, () => 10), { sentAtMs: 9000, latencyMs: undefined }];
  assert.equal(servingProblems(later).length, 1);
  assert.match(String(servingProblems(later)[0]), /1 of 30 probes were never answered/, "the first answer is at 10 ms, so the probe sent at 0 ms is out and the 29 later ones and the unanswered one are in");
  // The first probe answers at 10 ms; six of the next 39 take 600 ms: 15 percent of the serving probes, so the 95th percentile is 600 ms.
  const slowTail = ladder(40, (i) => (i === 0 || i > 6 ? 10 : 600));
  const problems = servingProblems(slowTail);
  assert.deepEqual(problems, ["the 95th percentile latency was 600 ms, above 500 ms"]);
});

void test("Phase 38 bootExcessMs is the cold first answer minus the largest control first answer", () => {
  assert.equal(bootExcessMs(900, [500, 650, 600]), 250);
  assert.equal(bootExcessMs(100, [500]), -400);
  assert.equal(bootExcessMs(undefined, [500]), undefined);
  assert.equal(bootExcessMs(900, []), undefined);
});

void test("Phase 38 startupOrder places ready and the realm status paints, and says whether ready came first", () => {
  const status = (text: string, key = "realm"): Record<string, unknown> => ({ type: "extension_ui_request", id: "u", method: "setStatus", statusKey: key, statusText: text });
  const frames = [{ type: "response", id: "a" }, { type: "ready" }, status("connecting"), status("other", "not-realm"), { type: "extension_ui_request", method: "notify", message: "m" }, status("active")];
  assert.deepEqual(startupOrder(frames, [5, 40, 60, 70, 80, 90]), { readyMs: 40, firstRealmStatusMs: 60, lastRealmStatusMs: 90, readyFirst: true });
  assert.deepEqual(startupOrder([status("connecting"), { type: "ready" }], [10, 20]), { readyMs: 20, firstRealmStatusMs: 10, lastRealmStatusMs: 10, readyFirst: false });
  assert.deepEqual(startupOrder([status("connecting")], [10]), { readyMs: undefined, firstRealmStatusMs: 10, lastRealmStatusMs: 10, readyFirst: undefined });
  assert.deepEqual(startupOrder([{ type: "ready" }], [10]), { readyMs: 10, firstRealmStatusMs: undefined, lastRealmStatusMs: undefined, readyFirst: undefined });
  assert.deepEqual(startupOrder([], []), { readyMs: undefined, firstRealmStatusMs: undefined, lastRealmStatusMs: undefined, readyFirst: undefined });
  assert.equal(startupOrder([status("not realm", "other"), { type: "notify" }], [1, 2]).firstRealmStatusMs, undefined, "frames that are not realm setStatus frames are ignored");
  assert.throws(() => startupOrder([{ type: "ready" }], []), /one arrival time per frame/);
  assert.throws(() => startupOrder([], [1]), /one arrival time per frame/);
});

void test("Phase 38 classifyRun: a passing verdict is the case pass", () => {
  const run = classifyRun(PASSING, CONTROL);
  assert.equal(run.case, "pass");
  assert.deepEqual(run.verdict, []);
  assert.equal(run.firstAnswerMs, 20);
  assert.equal(run.bootExcessMs, -480);
  assert.deepEqual(run.servingProblems, []);
});

void test("Phase 38 classifyRun: only shortness problems is the case short-window", () => {
  // 30 probes over 7.25 s, all answered in 20 ms: too few probes and too short a window, no latency problem.
  const samples = ladder(30, () => 20);
  const run = classifyRun(samples, CONTROL);
  assert.equal(run.case, "short-window");
  assert.equal(run.verdict.length, 2);
  assert.deepEqual(run.verdict, responsivenessProblems(summariseLatencies(samples)));
});

void test("Phase 38 classifyRun: a latency problem that persists after the first answer is the case serving-stall", () => {
  // Fast first answer, then a 2 s stall on one probe in the middle of the attach.
  const samples = ladder(60, (i) => (i === 20 ? 2000 : 20));
  const run = classifyRun(samples, CONTROL);
  assert.equal(run.case, "serving-stall");
  assert.ok(run.servingProblems.length > 0);
  assert.ok(run.verdict.length > 0);
});

void test("Phase 38 classifyRun: a stall only before the first answer, over the control by more than 250 ms, is the case boot-delay", () => {
  // The first probe waits 1.5 s, then every probe is answered in 20 ms: the first answer is at 270 ms (the probe sent at 250 ms).
  const samples = ladder(60, (i) => (i === 0 ? 1500 : 20));
  const run = classifyRun(samples, [10]);
  assert.equal(run.case, "boot-delay");
  assert.equal(run.bootExcessMs, 260);
  assert.deepEqual(run.servingProblems, []);
  assert.equal(run.firstAnswerMs, 270, "the probe sent at 250 ms is answered at 270 ms, before the first probe's 1500 ms");
  assert.equal(classifyRun(samples, CONTROL).case, "own-boot", "a control that answered at 500 ms leaves no excess");
});

void test("Phase 38 classifyRun: the boot excess boundary is 250 ms (own-boot) and 251 ms (boot-delay)", () => {
  // The first five probes (sent at 0 to 1000 ms) are all answered at 1500 ms; the probe sent at 1250 ms is answered at 1270 ms, the
  // first answer of all, and every later probe in 20 ms. The maximum of 1500 ms fails the verdict; nothing fails after the first answer.
  const samples = ladder(60, (i) => (i < 5 ? 1500 - i * PROBE_INTERVAL_MS : 20));
  const first = firstAnswerMs(samples);
  assert.equal(first, 1270);
  assert.deepEqual(servingProblems(samples), []);
  assert.ok(responsivenessProblems(summariseLatencies(samples)).length > 0);
  const atBoundary = classifyRun(samples, [1020]);
  assert.equal(atBoundary.bootExcessMs, 250);
  assert.equal(atBoundary.case, "own-boot");
  const over = classifyRun(samples, [1019]);
  assert.equal(over.bootExcessMs, 251);
  assert.equal(over.case, "boot-delay");
  const faster = classifyRun(samples, [1370]);
  assert.equal(faster.bootExcessMs, -100);
  assert.equal(faster.case, "own-boot");
});

void test("Phase 38 classifyRun: the largest of several control first answers is the control", () => {
  const samples = ladder(60, (i) => (i < 5 ? 1500 - i * PROBE_INTERVAL_MS : 20));
  const run = classifyRun(samples, [400, 1100, 700]);
  assert.equal(run.bootExcessMs, 170, "1270 minus the largest, 1100");
  assert.equal(run.case, "own-boot");
  assert.equal(classifyRun(samples, [400]).case, "boot-delay", "the smaller control alone would give an excess of 870 ms");
});

void test("Phase 38 classifyRun: when shortness and latency problems are both present the latency decides", () => {
  // 30 probes (short), one of them stalled for 2 s after the first answer.
  const samples = ladder(30, (i) => (i === 10 ? 2000 : 20));
  const run = classifyRun(samples, CONTROL);
  assert.ok(run.verdict.some((line) => line.includes("only 30 probes")), "a shortness problem is present");
  assert.equal(run.case, "serving-stall");
  const boot = classifyRun(ladder(30, (i) => (i === 0 ? 1500 : 20)), [10]);
  assert.equal(boot.case, "boot-delay");
});

void test("Phase 38 classifyRun: no answered probe at all is a serving-stall, and no probe at all is short-window", () => {
  const none = classifyRun(ladder(60, () => undefined), CONTROL);
  assert.equal(none.case, "serving-stall");
  assert.equal(none.firstAnswerMs, undefined);
  assert.equal(none.bootExcessMs, undefined);
  assert.deepEqual(none.servingProblems, ["no probe was answered, so Omp never served"]);
  assert.equal(classifyRun([], CONTROL).case, "short-window");
});

void test("Phase 38 decideWindow: fewer than three valid runs is VOID", () => {
  assert.equal(MIN_VALID_RUNS, 3);
  assert.equal(decideWindow([]).outcome, "VOID");
  assert.equal(decideWindow(["pass"]).outcome, "VOID");
  assert.equal(decideWindow(["pass", "pass"]).outcome, "VOID", "MIN_VALID_RUNS minus one");
  assert.equal(decideWindow(["boot-delay", "serving-stall"]).outcome, "VOID", "two failing valid runs are still fewer than three");
  assert.equal(decideWindow(["pass", "pass", "pass"]).outcome, "PASS", "MIN_VALID_RUNS");
  assert.match(decideWindow(["pass", "own-boot"]).reason, /^2 valid runs \(pass, own-boot\): fewer than 3 valid runs/);
});

void test("Phase 38 decideWindow: three passing runs are PASS", () => {
  const decision = decideWindow(["pass", "pass", "pass"]);
  assert.equal(decision.outcome, "PASS");
  assert.equal(decision.reason, "3 valid runs (pass, pass, pass): every case is pass");
});

void test("Phase 38 decideWindow: a serving-stall or a boot-delay among the runs is CODE", () => {
  assert.equal(decideWindow(["pass", "boot-delay", "pass"]).outcome, "CODE");
  assert.equal(decideWindow(["serving-stall", "pass", "pass"]).outcome, "CODE");
  assert.equal(decideWindow(["serving-stall", "boot-delay", "serving-stall"]).outcome, "CODE");
  assert.equal(decideWindow(["pass", "pass", "boot-delay"]).reason, "3 valid runs (pass, pass, boot-delay): boot-delay fired, so the extension path is the finding");
});

void test("Phase 38 decideWindow: CODE takes precedence over HARNESS", () => {
  const decision = decideWindow(["own-boot", "serving-stall", "short-window"]);
  assert.equal(decision.outcome, "CODE");
  assert.match(decision.reason, /serving-stall fired/);
  assert.equal(decideWindow(["own-boot", "own-boot", "boot-delay"]).outcome, "CODE");
});

void test("Phase 38 decideWindow: an own-boot or a short-window with no extension case is HARNESS", () => {
  assert.equal(decideWindow(["own-boot", "pass", "pass"]).outcome, "HARNESS");
  assert.equal(decideWindow(["pass", "short-window", "pass"]).outcome, "HARNESS");
  assert.equal(decideWindow(["own-boot", "short-window", "own-boot"]).outcome, "HARNESS");
  assert.equal(decideWindow(["pass", "pass", "short-window"]).reason, "3 valid runs (pass, pass, short-window): short-window fired and no extension case, so the window is the finding");
});

void test("Phase 38 decideWindow: more than three valid runs are all counted", () => {
  const four: RunCase[] = ["pass", "pass", "pass", "pass"];
  assert.equal(decideWindow(four).outcome, "PASS");
  assert.equal(decideWindow([...four, "boot-delay"]).outcome, "CODE", "a late failing valid run is not discarded");
  assert.equal(decideWindow(["pass", "pass", "pass", "own-boot"]).outcome, "HARNESS");
  assert.match(decideWindow(four).reason, /^4 valid runs/);
});
