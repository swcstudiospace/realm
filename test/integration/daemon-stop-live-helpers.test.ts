// Hermetic tests for the pure helpers of the gated live test of the daemon stop (test/support/daemon-stop-live.ts): the gate, the
// repeat and variant parsing, the reader of the daemon's stop records, the stage timeline, the verdict and the evidence text.
// This file always runs and starts nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PodmanProbe } from "../../src/runtime/podman-version.js";
import type { ProductionGateInputs } from "../support/production-live.js";
import {
  DEFAULT_REPEATS,
  MAX_REPEATS,
  NEAR_STOP_MS,
  containerStateOf,
  daemonStopSkipReason,
  evidenceLineOf,
  evidenceText,
  iterationVerdict,
  loadPerCpu,
  loadWorkers,
  parseRepeats,
  parseVariants,
  stageTimeline,
  stopRecordsOf,
  stoppedVerdictOf,
  type ContainerSample,
  type IterationRecord,
  type IterationResult,
  type StageTimeline,
} from "../support/daemon-stop-live.js";

const CLI_PATH = "dist/src/cli/main.js";
const PODMAN_5: PodmanProbe = { kind: "output", stdout: "podman version 5.7.1\n" };

// A host where every prerequisite of the production gate and of the stop test holds.
function openInputs(extraEnv: Record<string, string | undefined> = {}, overrides: Partial<ProductionGateInputs> = {}): ProductionGateInputs {
  const env: Record<string, string | undefined> = {
    REALM_LIVE_PRODUCTION: "1",
    REALM_LIVE_IMAGE: `localhost/realm-agentos@sha256:${"a".repeat(64)}`,
    REALM_LIVE_DRIVER_CONFIG: "/driver-config.json",
    REALM_DRIVER_SOCKET: "/run-user/realm/driver.sock",
    XDG_RUNTIME_DIR: "/run-user",
    PATH: "/bin",
    REALM_LIVE_STOP: "1",
    REALM_STOP_EVIDENCE_DIR: "/evidence",
    ...extraEnv,
  };
  const defined: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      defined[key] = value;
    }
  }
  return {
    env: defined,
    podman: PODMAN_5,
    isSocket: (path) => path === "/run-user/podman/podman.sock" || path === "/run-user/realm/driver.sock",
    onPath: (name) => name === "openshell",
    exists: () => true,
    isDirectory: (path) => path === "/evidence",
    readConfig: () =>
      JSON.stringify({
        image: `localhost/realm-agentos@sha256:${"b".repeat(64)}`,
        stateDir: "/var/lib/realm/state",
        workspaceRoot: "/srv/workspace",
      }),
    cliPath: CLI_PATH,
    ...overrides,
  };
}

// ---- daemonStopSkipReason --------------------------------------------------------------------------------------------------

void test("daemonStopSkipReason lets the test run when every prerequisite holds", () => {
  assert.equal(daemonStopSkipReason(openInputs()), false);
});

void test("daemonStopSkipReason names the production gate's reason first, whatever else is missing", () => {
  const reason = String(daemonStopSkipReason(openInputs({ REALM_LIVE_PRODUCTION: undefined, REALM_LIVE_STOP: undefined })));
  assert.match(reason, /REALM_LIVE_PRODUCTION=1 is not set/);
});

void test("daemonStopSkipReason names REALM_LIVE_STOP when only the opt-in is missing, and accepts only the exact value 1", () => {
  for (const value of [undefined, "", "0", "true", "11", " 1"]) {
    const reason = String(daemonStopSkipReason(openInputs({ REALM_LIVE_STOP: value })));
    assert.match(reason, /REALM_LIVE_STOP=1 is not set/, String(value));
  }
});

void test("daemonStopSkipReason names REALM_STOP_EVIDENCE_DIR when it is missing, relative or not an existing directory", () => {
  for (const value of [undefined, "", "relative/dir", "/not-a-directory"]) {
    const reason = String(daemonStopSkipReason(openInputs({ REALM_STOP_EVIDENCE_DIR: value })));
    assert.match(reason, /REALM_STOP_EVIDENCE_DIR is not an absolute path to an existing directory/, String(value));
  }
});

void test("daemonStopSkipReason names REALM_LIVE_STOP_VARIANTS last, when the list holds an unknown letter", () => {
  const reason = String(daemonStopSkipReason(openInputs({ REALM_LIVE_STOP_VARIANTS: "a,d" })));
  assert.match(reason, /REALM_LIVE_STOP_VARIANTS is not a comma list over a, b and c/);
  assert.equal(daemonStopSkipReason(openInputs({ REALM_LIVE_STOP_VARIANTS: "b,c" })), false);
});

void test("daemonStopSkipReason names a variable and never its value", () => {
  const reason = String(daemonStopSkipReason(openInputs({ REALM_STOP_EVIDENCE_DIR: "relative-secret-dir" })));
  assert.equal(reason.includes("relative-secret-dir"), false);
});

// ---- parseRepeats and parseVariants ----------------------------------------------------------------------------------------

void test("parseRepeats gives the default when the value is absent, blank, a decimal or a word", () => {
  for (const raw of [undefined, "", "  ", "2.5", "many", "-3", "1e1"]) {
    assert.equal(parseRepeats(raw), DEFAULT_REPEATS, String(raw));
  }
});

void test("parseRepeats reads a whole number in range", () => {
  assert.equal(parseRepeats("1"), 1);
  assert.equal(parseRepeats(" 7 "), 7);
  assert.equal(parseRepeats("20"), 20);
});

void test("parseRepeats clamps a whole number out of range, it does not default it", () => {
  assert.equal(parseRepeats("0"), 1);
  assert.equal(parseRepeats("21"), MAX_REPEATS);
  assert.equal(parseRepeats("500"), MAX_REPEATS);
});

void test("parseVariants defaults to all three letters", () => {
  assert.deepEqual(parseVariants(undefined), { ok: true, variants: ["a", "b", "c"] });
  assert.deepEqual(parseVariants("  "), { ok: true, variants: ["a", "b", "c"] });
});

void test("parseVariants reads a list, once per letter and in the order a, b, c", () => {
  assert.deepEqual(parseVariants("c, a"), { ok: true, variants: ["a", "c"] });
  assert.deepEqual(parseVariants("b,b"), { ok: true, variants: ["b"] });
});

void test("parseVariants makes the whole value invalid on an unknown letter or an empty element", () => {
  for (const raw of ["a,d", "d", "a,,b", "ab", "A"]) {
    assert.deepEqual(parseVariants(raw), { ok: false }, raw);
  }
});

// ---- stopRecordsOf and stoppedVerdictOf ------------------------------------------------------------------------------------

const SINCE = "2026-11-18T10:00:00.000Z";

void test("stopRecordsOf keeps the stopping and stopped rows at or after the time, in file order", () => {
  const text = [
    JSON.stringify({ ts: "2026-11-18T09:59:59.999Z", level: "info", event: "daemon.stopped", failedTeardowns: 1, code: "REALM_STOPPING" }),
    JSON.stringify({ ts: SINCE, level: "info", event: "daemon.stopping" }),
    JSON.stringify({ ts: "2026-11-18T10:00:01.000Z", level: "info", event: "tool.call" }),
    JSON.stringify({ ts: "2026-11-18T10:00:02.500Z", level: "info", event: "daemon.stopped", failedTeardowns: 0 }),
  ].join("\n");
  const records = stopRecordsOf(text, SINCE);
  assert.deepEqual(records.map((record) => record.event), ["daemon.stopping", "daemon.stopped"]);
  assert.equal(records[1]?.ts, "2026-11-18T10:00:02.500Z");
});

void test("stopRecordsOf ignores a partial last line, a line that is not JSON, a non-object and a row with no parsable ts", () => {
  const text = [
    "not json at all",
    "42",
    "[1,2]",
    JSON.stringify({ ts: "nonsense", event: "daemon.stopped", failedTeardowns: 0 }),
    JSON.stringify({ event: "daemon.stopped", failedTeardowns: 0 }),
    JSON.stringify({ ts: "2026-11-18T10:00:03.000Z", event: "daemon.stopped", failedTeardowns: 0 }),
    '{"ts":"2026-11-18T10:00:04.000Z","event":"daemon.sto',
  ].join("\n");
  const records = stopRecordsOf(text, SINCE);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.ts, "2026-11-18T10:00:03.000Z");
});

void test("stopRecordsOf refuses a since time that is not a date", () => {
  assert.throws(() => stopRecordsOf("", "yesterday"), RangeError);
});

void test("stoppedVerdictOf reads a stopped row with a code and one without", () => {
  assert.deepEqual(stoppedVerdictOf({ failedTeardowns: 1, code: "REALM_STOPPING" }), { failedTeardowns: 1, code: "REALM_STOPPING" });
  assert.deepEqual(stoppedVerdictOf({ failedTeardowns: 0 }), { failedTeardowns: 0, code: undefined });
});

void test("stoppedVerdictOf refuses a row with no numeric failedTeardowns, and ignores a code that is not a string", () => {
  assert.equal(stoppedVerdictOf({ code: "REALM_STOPPING" }), undefined);
  assert.equal(stoppedVerdictOf({ failedTeardowns: "0" }), undefined);
  assert.equal(stoppedVerdictOf({ failedTeardowns: Number.NaN }), undefined);
  assert.deepEqual(stoppedVerdictOf({ failedTeardowns: 0, code: 7 }), { failedTeardowns: 0, code: undefined });
});

// ---- containerStateOf and stageTimeline ------------------------------------------------------------------------------------

void test("containerStateOf reads absent, running, stopping and stopped containers", () => {
  assert.deepEqual(containerStateOf(""), { present: false, running: false });
  assert.deepEqual(containerStateOf("\n  \n"), { present: false, running: false });
  assert.deepEqual(containerStateOf("running\n"), { present: true, running: true });
  assert.deepEqual(containerStateOf("Stopping\n"), { present: true, running: true });
  assert.deepEqual(containerStateOf("exited\n"), { present: true, running: false });
  assert.deepEqual(containerStateOf("exited\nrunning\n"), { present: true, running: true });
});

const MARKS = { signal: 1_000_000, stopping: 1_000_020, stopped: 1_005_020, exit: 1_005_400 };

void test("stageTimeline reads the figures from the samples and the marks", () => {
  const samples: ContainerSample[] = [
    { atMs: 100, present: true, running: true },
    { atMs: 360, present: true, running: true },
    { atMs: 2_900, present: true, running: false },
    { atMs: 3_150, present: false, running: false },
    { atMs: 3_400, present: false, running: false },
  ];
  assert.deepEqual(stageTimeline(samples, MARKS), {
    stopMs: 5_400,
    logMs: 5_000,
    containerStoppedMs: 2_900,
    containerGoneMs: 3_150,
    largestGapMs: 2_540,
  });
});

void test("stageTimeline gives null for every figure the data cannot give, never zero", () => {
  const timeline = stageTimeline([], { signal: 5, stopping: null, stopped: null, exit: null });
  assert.deepEqual(timeline, { stopMs: null, logMs: null, containerStoppedMs: null, containerGoneMs: null, largestGapMs: null });
});

void test("stageTimeline gives a null gap for one sample, null stop figures for a container that never stopped, and null log time with one log mark", () => {
  const timeline = stageTimeline([{ atMs: 10, present: true, running: true }], { ...MARKS, stopped: null });
  assert.equal(timeline.largestGapMs, null);
  assert.equal(timeline.containerStoppedMs, null);
  assert.equal(timeline.containerGoneMs, null);
  assert.equal(timeline.logMs, null);
  assert.equal(timeline.stopMs, 5_400);
});

void test("stageTimeline counts an absent container as not running", () => {
  const timeline = stageTimeline([{ atMs: 50, present: false, running: false }], MARKS);
  assert.equal(timeline.containerStoppedMs, 50);
  assert.equal(timeline.containerGoneMs, 50);
});

// ---- iterationVerdict ------------------------------------------------------------------------------------------------------

const QUICK: StageTimeline = { stopMs: 4_000, logMs: 3_500, containerStoppedMs: 1_000, containerGoneMs: 2_000, largestGapMs: 300 };

function good(overrides: Partial<IterationResult> = {}): IterationResult {
  return {
    timeline: QUICK,
    stopped: { failedTeardowns: 0, code: undefined },
    exitedInBound: true,
    containerGone: true,
    sandboxGone: true,
    residueProblems: [],
    followUpActive: undefined,
    ...overrides,
  };
}

void test("iterationVerdict passes variants a and b on a clean stop", () => {
  for (const variant of ["a", "b"] as const) {
    assert.deepEqual(iterationVerdict(variant, good()), { pass: true, reason: undefined, near: false });
  }
});

void test("iterationVerdict fails variant a with the first failing reason, as a fixed string", () => {
  assert.equal(iterationVerdict("a", good({ exitedInBound: false })).reason, "the daemon did not exit within the bound");
  assert.equal(iterationVerdict("a", good({ stopped: undefined })).reason, "daemon.stopped was not written with a numeric failedTeardowns");
  assert.equal(
    iterationVerdict("a", good({ stopped: { failedTeardowns: 1, code: "REALM_STOPPING" } })).reason,
    "daemon.stopped reported failed teardowns",
  );
  assert.equal(
    iterationVerdict("b", good({ stopped: { failedTeardowns: 0, code: "AGENTOS_STOP_FAILED" } })).reason,
    "daemon.stopped carried a code",
  );
  assert.equal(iterationVerdict("a", good({ containerGone: false })).reason, "the session's container was still present after the exit");
  assert.equal(iterationVerdict("a", good({ sandboxGone: false })).reason, "the gateway still lists the session's sandbox");
  assert.equal(iterationVerdict("a", good({ residueProblems: ["1 container(s) remain"] })).reason, "residue remained after the stop");
  assert.equal(iterationVerdict("a", good({ residueProblems: ["x"] })).pass, false);
});

void test("iterationVerdict reports the first reason when several fail", () => {
  const verdict = iterationVerdict(
    "a",
    good({ stopped: { failedTeardowns: 1, code: "REALM_STOPPING" }, containerGone: false, residueProblems: ["x"] }),
  );
  assert.equal(verdict.reason, "daemon.stopped reported failed teardowns");
});

void test("iterationVerdict judges variant c only by the exit bound and the follow-up up", () => {
  const observed = good({ stopped: { failedTeardowns: 1, code: "REALM_STOPPING" }, containerGone: false, residueProblems: ["x"], followUpActive: true });
  assert.deepEqual(iterationVerdict("c", observed), { pass: true, reason: undefined, near: false });
  assert.equal(iterationVerdict("c", good({ stopped: undefined, followUpActive: true })).pass, true);
  assert.equal(iterationVerdict("c", good({ followUpActive: false })).reason, "the follow-up up did not reach active");
  assert.equal(iterationVerdict("c", good({ followUpActive: undefined })).reason, "the follow-up up did not reach active");
  assert.equal(iterationVerdict("c", good({ exitedInBound: false, followUpActive: true })).reason, "the daemon did not exit within the bound");
});

void test("iterationVerdict sets the near flag above 30 s and never lets it fail an iteration", () => {
  const slow = (stopMs: number | null): IterationResult => good({ timeline: { ...QUICK, stopMs } });
  assert.equal(iterationVerdict("a", slow(NEAR_STOP_MS)).near, false);
  assert.deepEqual(iterationVerdict("a", slow(NEAR_STOP_MS + 1)), { pass: true, reason: undefined, near: true });
  assert.equal(iterationVerdict("a", slow(null)).near, false);
});

// ---- load and evidence -----------------------------------------------------------------------------------------------------

void test("loadWorkers is the CPU count, at least one", () => {
  assert.equal(loadWorkers(8), 8);
  assert.equal(loadWorkers(0), 1);
  assert.equal(loadWorkers(2.7), 2);
  assert.equal(loadWorkers(Number.NaN), 1);
});

void test("loadPerCpu divides the one-minute load by the CPU count to two decimals, and is null for unusable figures", () => {
  assert.equal(loadPerCpu(3, 4), 0.75);
  assert.equal(loadPerCpu(1, 3), 0.33);
  assert.equal(loadPerCpu(1, 0), null);
  assert.equal(loadPerCpu(Number.NaN, 4), null);
});

function record(overrides: Partial<IterationRecord> & Pick<IterationRecord, "variant" | "iteration">): IterationRecord {
  return {
    verdict: { pass: true, reason: undefined, near: false },
    timeline: QUICK,
    stopped: { failedTeardowns: 0, code: undefined },
    loadBefore: 0.1,
    loadAfter: 0.2,
    ...overrides,
  };
}

void test("evidenceLineOf is one JSON line of figures with no path, no environment value and no container id", () => {
  const line = evidenceLineOf(record({ variant: "a", iteration: 2 }));
  assert.equal(line.includes("\n"), false);
  assert.deepEqual(JSON.parse(line), {
    variant: "a",
    iteration: 2,
    pass: true,
    reason: null,
    near: false,
    stopMs: 4_000,
    logMs: 3_500,
    containerStoppedMs: 1_000,
    containerGoneMs: 2_000,
    largestGapMs: 300,
    failedTeardowns: 0,
    code: null,
    loadBefore: 0.1,
    loadAfter: 0.2,
  });
});

void test("evidenceLineOf writes nulls for a missing row and a failing reason", () => {
  const line = evidenceLineOf(
    record({ variant: "c", iteration: 1, stopped: undefined, verdict: { pass: false, reason: "the follow-up up did not reach active", near: false } }),
  );
  const parsed = JSON.parse(line) as Record<string, unknown>;
  assert.equal(parsed["failedTeardowns"], null);
  assert.equal(parsed["code"], null);
  assert.equal(parsed["reason"], "the follow-up up did not reach active");
});

void test("evidenceText reports per variant the counts, the stopMs range, the near count, the histograms and the load", () => {
  const text = evidenceText([
    record({ variant: "a", iteration: 1, timeline: { ...QUICK, stopMs: 4_000 } }),
    record({ variant: "a", iteration: 2, timeline: { ...QUICK, stopMs: 6_000 } }),
    record({
      variant: "a",
      iteration: 3,
      timeline: { ...QUICK, stopMs: 31_000 },
      verdict: { pass: false, reason: "daemon.stopped reported failed teardowns", near: true },
      stopped: { failedTeardowns: 1, code: "REALM_STOPPING" },
    }),
    record({ variant: "c", iteration: 1, stopped: undefined, timeline: { ...QUICK, stopMs: null }, loadBefore: null, loadAfter: null }),
  ]);
  assert.match(text, /variant a: 3 iteration\(s\), 2 pass/);
  assert.match(text, /stopMs: min 4000, median 6000, max 31000/);
  assert.match(text, /near \(> 30000 ms\): 1/);
  assert.match(text, /failedTeardowns: 0=2, 1=1/);
  assert.match(text, /code: none=2, REALM_STOPPING=1/);
  assert.match(text, /load per CPU before\/after: 0\.1\/0\.2 0\.1\/0\.2 0\.1\/0\.2/);
  assert.match(text, /variant c: 1 iteration\(s\), 1 pass/);
  assert.match(text, /stopMs: none observed/);
  assert.match(text, /failedTeardowns: none=1/);
  assert.equal(text.includes("variant b"), false);
});

void test("evidenceText takes the mean of the two middle stop times as the median of an even count", () => {
  const text = evidenceText([
    record({ variant: "b", iteration: 1, timeline: { ...QUICK, stopMs: 1_000 } }),
    record({ variant: "b", iteration: 2, timeline: { ...QUICK, stopMs: 4_000 } }),
  ]);
  assert.match(text, /median 2500/);
});

void test("evidenceText of no records is empty text", () => {
  assert.equal(evidenceText([]), "\n");
});
