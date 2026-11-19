// The hermetic pin of test/support/wire-timeline.ts (Phase 47, 47-CONTEXT D-47-03 to D-47-06): every class, every rule row and every
// constant, on plain arrays of events with marks. No file, process, clock or network except the one temporary log readWireTimeline reads.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { REALM_TOOL_NAMES } from "./host-live-session.js";
import {
  ABLATION_NAMES,
  ABLATION_RUNS_PER_NAME,
  ablationVerdict,
  attributeCause,
  classifyToolsList,
  FIXED_TIMEOUT_SPREAD,
  isReproCondition,
  parseReachPolls,
  parseRunRecord,
  nextStep,
  NARROWING_NOT_COLD_STACK,
  pollReached,
  REACH_POLL_MS,
  REACH_WINDOW_MS,
  readWireTimeline,
  REPRO_FAIL_THRESHOLD,
  REPRO_MAX_ATTEMPTS,
  REPRO_MIN_VALID,
  reproductionOutcome,
  runReached,
  SIX_TOOLS,
  STALL_MS,
  type AblationRun,
  type Controls,
  type ReproRun,
  type RunVerdict,
  type TimelineEvent,
} from "./wire-timeline.js";
import { summarizeRuns } from "./wire-timeline-run.js";

// ---- Builders ----------------------------------------------------------------------------------------------------------------

const HANDSHAKE: TimelineEvent[] = [
  { t: 10, kind: "request", dir: "host-to-realm", method: "initialize", id: 1 },
  { t: 12, kind: "response", dir: "realm-to-host", id: 1 },
  { t: 13, kind: "notification", dir: "host-to-realm", method: "notifications/initialized" },
];
const LIST_REQUEST: TimelineEvent = { t: 100, kind: "request", dir: "host-to-realm", method: "tools/list", id: 2 };
const hostEnd = (t: number): TimelineEvent => ({ t, kind: "lifecycle", event: "host-stdin-end" });
const signal = (t: number, name = "SIGTERM"): TimelineEvent => ({ t, kind: "lifecycle", event: "host-signal", signal: name });
const result = (t: number, toolNames: readonly string[] = SIX_TOOLS, id = 2): TimelineEvent => ({ t, kind: "response", dir: "realm-to-host", id, toolNames });
const error = (t: number, errorCode = -32000, id = 2): TimelineEvent => ({ t, kind: "response", dir: "realm-to-host", id, error: true, errorCode });
const childExit = (t: number, code: number): TimelineEvent => ({ t, kind: "lifecycle", event: "child-exit", exitCode: code });
const timeline = (...tail: TimelineEvent[]): TimelineEvent[] => [...HANDSHAKE, LIST_REQUEST, ...tail];

// Verdicts of the five classes at chosen marks, for the rules above them.
const answered = (): RunVerdict => classifyToolsList(timeline(result(150)));
const errored = (code = -32000): RunVerdict => classifyToolsList(timeline(error(150, code)));
const afterClose = (closeAfter: number, respondAfter: number): RunVerdict => classifyToolsList(timeline(hostEnd(100 + closeAfter), result(100 + respondAfter)));
const neverWritten = (exitAfter?: number): RunVerdict => classifyToolsList(timeline(...(exitAfter === undefined ? [] : [childExit(100 + exitAfter, 1)])));
// A stall: the client closed at 5 s and the response was written at 15 s.
const lateAnswer = (): RunVerdict => afterClose(5000, STALL_MS + 5000);
const noControls: Controls = { c1: [answered()], c2: [{ answered: true, ms: 3000 }], c3: [] };

// ---- 1. The constants --------------------------------------------------------------------------------------------------------

void test("the constants of D-47-04 to D-47-06 are pinned by value, and the names and the six tools are the live ones", () => {
  assert.equal(REPRO_MIN_VALID, 3);
  assert.equal(REPRO_MAX_ATTEMPTS, 5);
  assert.equal(REPRO_FAIL_THRESHOLD, 2);
  assert.equal(STALL_MS, 10_000);
  assert.equal(FIXED_TIMEOUT_SPREAD, 0.1);
  assert.equal(REACH_WINDOW_MS, 60_000);
  assert.equal(REACH_POLL_MS, 2000);
  assert.equal(ABLATION_RUNS_PER_NAME, 2);
  assert.deepEqual([...ABLATION_NAMES], ["XDG_CONFIG_HOME", "XDG_RUNTIME_DIR", "REALM_DRIVER_SOCKET"]);
  assert.deepEqual([...SIX_TOOLS], [...REALM_TOOL_NAMES], "the module repeats the six names; the live constant must agree");
  assert.equal(NARROWING_NOT_COLD_STACK, "not cold-stack timing");
});

// ---- 2. classifyToolsList ----------------------------------------------------------------------------------------------------

void test("NOT-REQUESTED: no tools/list request was logged, and a log without a handshake is not valid", () => {
  const verdict = classifyToolsList(HANDSHAKE);
  assert.equal(verdict.class, "NOT-REQUESTED");
  assert.equal(verdict.valid, true);
  assert.equal(classifyToolsList([]).valid, false);
  assert.equal(classifyToolsList([]).class, "NOT-REQUESTED");
});

void test("ANSWERED: a result with no host end, before the host end, and at exactly the host end mark; the sixTools sub-flag", () => {
  const plain = classifyToolsList(timeline(result(150)));
  assert.equal(plain.class, "ANSWERED");
  assert.equal(plain.sixTools, true);
  assert.equal(plain.L, 50);
  assert.equal(plain.G, undefined);
  assert.equal(plain.tHostEnd, undefined);
  assert.equal(classifyToolsList(timeline(result(150), hostEnd(160))).class, "ANSWERED");
  const exact = classifyToolsList(timeline(result(150), hostEnd(150)));
  assert.equal(exact.class, "ANSWERED", "a result at exactly the host end mark is not after it");
  assert.equal(exact.G, 50);
  assert.equal(classifyToolsList(timeline(result(150, ["exec", "list"]))).sixTools, false);
  assert.equal(classifyToolsList(timeline(result(150, []))).sixTools, false);
  assert.equal(classifyToolsList(timeline({ t: 150, kind: "response", dir: "realm-to-host", id: 2 })).sixTools, false, "a result with no names is not the six tools");
  assert.equal(classifyToolsList(timeline(result(150, [...SIX_TOOLS].reverse()))).sixTools, true, "the order of the names does not matter");
});

void test("ERROR: an error response no later than the host end keeps its numeric code", () => {
  const verdict = classifyToolsList(timeline(error(150, -32601), hostEnd(200)));
  assert.equal(verdict.class, "ERROR");
  assert.equal(verdict.errorCode, -32601);
  assert.equal(verdict.responseKind, "error");
  assert.equal(classifyToolsList(timeline(error(150, -32601), hostEnd(150))).class, "ERROR");
});

void test("WRITTEN-AFTER-CLOSE: a result and an error written after the host closed keep their kind, and L and G are computed", () => {
  const late = classifyToolsList(timeline(hostEnd(130), result(700)));
  assert.equal(late.class, "WRITTEN-AFTER-CLOSE");
  assert.equal(late.responseKind, "result");
  assert.equal(late.L, 600);
  assert.equal(late.G, 30);
  const lateError = classifyToolsList(timeline(hostEnd(130), error(700, -32000)));
  assert.equal(lateError.class, "WRITTEN-AFTER-CLOSE");
  assert.equal(lateError.responseKind, "error");
  assert.equal(lateError.errorCode, -32000);
  assert.equal(lateError.sixTools, undefined);
});

void test("NEVER-WRITTEN: no response for that id, with and without a child exit mark and code", () => {
  const without = classifyToolsList(timeline());
  assert.equal(without.class, "NEVER-WRITTEN");
  assert.equal(without.childExit, undefined);
  const exited = classifyToolsList(timeline(childExit(4000, 7)));
  assert.equal(exited.class, "NEVER-WRITTEN");
  assert.deepEqual(exited.childExit, { t: 4000, code: 7 });
  const killed = classifyToolsList(timeline({ t: 5000, kind: "lifecycle", event: "child-exit", signal: "SIGKILL" }));
  assert.deepEqual(killed.childExit, { t: 5000, signal: "SIGKILL" });
  assert.equal(classifyToolsList(timeline(result(150, SIX_TOOLS, 9))).class, "NEVER-WRITTEN", "a response to a different id never answers the request");
});

void test("the host end is the earliest of the stdin end and the first signal; a signal alone counts", () => {
  const signalOnly = classifyToolsList(timeline(signal(120), result(300)));
  assert.equal(signalOnly.class, "WRITTEN-AFTER-CLOSE");
  assert.equal(signalOnly.tHostEnd, 120);
  const both = classifyToolsList(timeline(hostEnd(180), signal(120), signal(400), result(300)));
  assert.equal(both.tHostEnd, 120);
  assert.equal(both.G, 20);
  const stdinFirst = classifyToolsList(timeline(signal(500), hostEnd(110), result(300)));
  assert.equal(stdinFirst.tHostEnd, 110);
});

void test("a log with no initialize and no server/discover is invalid and still classified; server/discover makes it valid; an invalid request line is flagged", () => {
  const bare = classifyToolsList([LIST_REQUEST, result(150)]);
  assert.equal(bare.valid, false);
  assert.equal(bare.class, "ANSWERED");
  const modern = classifyToolsList([{ t: 1, kind: "request", dir: "host-to-realm", method: "server/discover", id: 1 }, LIST_REQUEST, result(150)]);
  assert.equal(modern.valid, true);
  assert.equal(modern.invalidRequestLine, false);
  const flagged = classifyToolsList([...timeline(error(150)), { t: 14, kind: "other", dir: "host-to-realm", invalid: true }]);
  assert.equal(flagged.invalidRequestLine, true);
  assert.equal(flagged.class, "ERROR");
});

// ---- 3. reproductionOutcome --------------------------------------------------------------------------------------------------

const counted = (verdict: RunVerdict): ReproRun => ({ cold: true, condition: true, verdict });

void test("reproduction: three valid runs all ANSWERED with the six names is NOT-REPRODUCED", () => {
  const runs = [counted(answered()), counted(answered()), counted(answered())];
  const outcome = reproductionOutcome(runs);
  assert.equal(outcome.outcome, "NOT-REPRODUCED");
  assert.deepEqual([outcome.attempts, outcome.counted, outcome.failing], [3, 3, 0]);
  assert.equal(nextStep(runs), "stop");
});

void test("reproduction: two failing valid runs of any mix of classes is REPRODUCED, and the rule stops asking", () => {
  const runs = [counted(neverWritten()), counted(errored())];
  assert.equal(reproductionOutcome(runs).outcome, "REPRODUCED");
  assert.equal(nextStep(runs), "stop");
  assert.equal(reproductionOutcome([counted(afterClose(10, 600)), counted(classifyToolsList(HANDSHAKE))]).outcome, "REPRODUCED", "NOT-REQUESTED is a failing class too");
  assert.equal(reproductionOutcome([counted(answered()), counted(neverWritten()), counted(errored())]).outcome, "REPRODUCED");
  const fewSix = classifyToolsList(timeline(result(150, ["exec"])));
  assert.equal(reproductionOutcome([counted(fewSix), counted(fewSix)]).outcome, "REPRODUCED", "ANSWERED without the six names fails");
});

void test("reproduction: one failing run among three valid is INCONCLUSIVE and asks for more until the attempt limit", () => {
  const three = [counted(answered()), counted(neverWritten()), counted(answered())];
  assert.equal(reproductionOutcome(three).outcome, "INCONCLUSIVE");
  assert.equal(nextStep(three), "more");
  const five = [...three, counted(answered()), counted(answered())];
  assert.equal(reproductionOutcome(five).outcome, "INCONCLUSIVE");
  assert.equal(reproductionOutcome(five).attempts, REPRO_MAX_ATTEMPTS);
  assert.equal(nextStep(five), "stop");
  assert.equal(nextStep([counted(answered())]), "more");
  assert.equal(nextStep([]), "more");
  const twoValid = [counted(answered()), counted(answered())];
  assert.equal(reproductionOutcome(twoValid).outcome, "INCONCLUSIVE", "fewer than three valid runs, none failing");
});

void test("reproduction: no valid run is VOID", () => {
  assert.equal(reproductionOutcome([]).outcome, "VOID");
  assert.equal(reproductionOutcome([counted(classifyToolsList([]))]).outcome, "VOID");
});

void test("reproduction: a run that is not cold, not valid or not in the 2026-11-18 condition does not count, each reason named", () => {
  const runs: ReproRun[] = [
    { cold: false, condition: true, verdict: neverWritten() },
    { cold: true, condition: true, verdict: classifyToolsList([LIST_REQUEST]) },
    { cold: true, condition: false, verdict: neverWritten() },
    { cold: false, condition: false, verdict: classifyToolsList([]) },
    counted(answered()),
  ];
  const outcome = reproductionOutcome(runs);
  assert.deepEqual([outcome.attempts, outcome.counted, outcome.failing], [5, 1, 0]);
  assert.deepEqual(outcome.excluded, [
    { index: 0, reasons: ["not-cold"] },
    { index: 1, reasons: ["not-valid"] },
    { index: 2, reasons: ["not-2026-11-18-condition"] },
    { index: 3, reasons: ["not-cold", "not-valid", "not-2026-11-18-condition"] },
  ]);
  assert.equal(outcome.outcome, "INCONCLUSIVE");
});

void test("isReproCondition is true for all three names, no warm control and no diagnostic flag only", () => {
  const all = [...ABLATION_NAMES];
  assert.equal(isReproCondition({ restore: all, warm: false, diagnostic: false }), true);
  assert.equal(isReproCondition({ restore: [...all].reverse(), warm: false, diagnostic: false }), true);
  assert.equal(isReproCondition({ restore: all, warm: true, diagnostic: true }), false);
  assert.equal(isReproCondition({ restore: all, warm: false, diagnostic: true }), false);
  assert.equal(isReproCondition({ restore: all.slice(1), warm: false, diagnostic: true }), false);
  assert.equal(isReproCondition({ restore: [], warm: false, diagnostic: true }), false);
});

// ---- 4. attributeCause -------------------------------------------------------------------------------------------------------

void test("attribution: a reproduction that is not REPRODUCED has no attributed cause", () => {
  for (const outcome of ["NOT-REPRODUCED", "INCONCLUSIVE", "VOID"] as const) {
    assert.deepEqual(attributeCause(outcome, [], noControls), { cause: "NOT-ESTABLISHED", rule: null, reason: "the reproduction did not reproduce, so no cause is attributed" });
  }
});

void test("attribution rule 1: C1 not ANSWERED with the six names gives CLIENT, even when a failing run is an ERROR; a missing C1 is UNDETERMINED", () => {
  const badC1: Controls = { ...noControls, c1: [neverWritten()] };
  assert.equal(attributeCause("REPRODUCED", [errored()], badC1).cause, "CLIENT");
  assert.equal(attributeCause("REPRODUCED", [errored()], badC1).rule, 1);
  assert.equal(attributeCause("REPRODUCED", [neverWritten(), neverWritten()], { ...noControls, c1: [answered(), errored()] }).rule, 1, "any C1 run that fails");
  const missing = attributeCause("REPRODUCED", [errored()], { ...noControls, c1: [] });
  assert.equal(missing.cause, "UNDETERMINED");
  assert.equal(missing.narrowing, "control C1 is missing");
});

void test("attribution rule 2: an ERROR gives REALM-MCP with the code kept; an invalid request line turns it into CLIENT with the reason", () => {
  const realm = attributeCause("REPRODUCED", [errored(-32603), neverWritten()], noControls);
  assert.equal(realm.cause, "REALM-MCP");
  assert.equal(realm.rule, 2);
  assert.equal(realm.errorCode, -32603);
  const invalid = classifyToolsList([...timeline(error(150, -32700)), { t: 14, kind: "other", dir: "host-to-realm", invalid: true }]);
  const client = attributeCause("REPRODUCED", [invalid], noControls);
  assert.equal(client.cause, "CLIENT");
  assert.equal(client.rule, 2);
  assert.match(client.reason, /not valid JSON-RPC/);
});

void test("attribution rule 3: NEVER-WRITTEN with a child exit before tRequest plus STALL_MS gives REALM-MCP and keeps the exit", () => {
  const gone = attributeCause("REPRODUCED", [neverWritten(3000), neverWritten()], noControls);
  assert.equal(gone.cause, "REALM-MCP");
  assert.equal(gone.rule, 3);
  assert.deepEqual(gone.childExit, { t: 3100, code: 1 });
  const lateExit = attributeCause("REPRODUCED", [neverWritten(STALL_MS), neverWritten(STALL_MS + 1)], noControls);
  assert.notEqual(lateExit.rule, 3, "an exit at tRequest plus STALL_MS or later is not an early exit");
  assert.equal(attributeCause("REPRODUCED", [neverWritten(STALL_MS - 1)], noControls).rule, 3);
});

void test("attribution rule 4: every failing run WRITTEN-AFTER-CLOSE with L within STALL_MS and G below L gives CLIENT; two G values within the spread add the fixed timeout", () => {
  const fixed = attributeCause("REPRODUCED", [afterClose(5000, 5500), afterClose(5200, 5600)], noControls);
  assert.equal(fixed.cause, "CLIENT");
  assert.equal(fixed.rule, 4);
  assert.equal(fixed.fixedClientTimeoutMs, 5100);
  assert.match(fixed.reason, /fixed client timeout/);
  const apart = attributeCause("REPRODUCED", [afterClose(2000, 2500), afterClose(6000, 6500)], noControls);
  assert.equal(apart.cause, "CLIENT");
  assert.equal(apart.fixedClientTimeoutMs, undefined);
  assert.equal(attributeCause("REPRODUCED", [afterClose(5000, 5500), afterClose(5500, 6000)], noControls).fixedClientTimeoutMs, 5250, "10 percent of the larger value is inside the spread");
  assert.equal(attributeCause("REPRODUCED", [afterClose(5000, 5600), afterClose(5600, 6200)], noControls).fixedClientTimeoutMs, undefined, "more than 10 percent apart");
  const notEvery = attributeCause("REPRODUCED", [afterClose(5000, 5500), neverWritten()], noControls);
  assert.notEqual(notEvery.rule, 4, "a failing run of another class leaves the rule");
  assert.notEqual(attributeCause("REPRODUCED", [afterClose(5000, STALL_MS + 1)], noControls).rule, 4, "L above STALL_MS is a stall");
  assert.notEqual(attributeCause("REPRODUCED", [afterClose(5000, 4000)], noControls).rule, 4, "G must be below L");
});

void test("attribution rule 5: a stall with C2 answered within STALL_MS and every C3 run ANSWERED with the six names gives STACK", () => {
  const controls: Controls = { c1: [answered()], c2: [{ answered: true, ms: 4000 }], c3: [answered(), answered()] };
  const stack = attributeCause("REPRODUCED", [lateAnswer(), neverWritten()], controls);
  assert.equal(stack.cause, "STACK");
  assert.equal(stack.rule, 5);
  assert.equal(attributeCause("REPRODUCED", [neverWritten(), neverWritten()], controls).cause, "STACK", "NEVER-WRITTEN with the child still alive is a stall");
});

void test("attribution rule 5: a stall with a C3 run not answered gives UNDETERMINED with the narrowing text", () => {
  const controls: Controls = { c1: [answered()], c2: [{ answered: true, ms: 4000 }], c3: [answered(), neverWritten()] };
  const verdict = attributeCause("REPRODUCED", [lateAnswer(), lateAnswer()], controls);
  assert.equal(verdict.cause, "UNDETERMINED");
  assert.equal(verdict.rule, 5);
  assert.equal(verdict.narrowing, NARROWING_NOT_COLD_STACK);
});

void test("attribution rule 6 and the order: every other combination is UNDETERMINED, and a stall with C2 too slow or C3 missing is not STACK", () => {
  const slowC2: Controls = { c1: [answered()], c2: [{ answered: true, ms: STALL_MS + 1 }], c3: [answered()] };
  assert.equal(attributeCause("REPRODUCED", [lateAnswer(), lateAnswer()], slowC2).cause, "UNDETERMINED");
  assert.equal(attributeCause("REPRODUCED", [lateAnswer(), lateAnswer()], { ...noControls, c3: [] }).cause, "UNDETERMINED");
  assert.equal(attributeCause("REPRODUCED", [lateAnswer(), lateAnswer()], { ...noControls, c2: [{ answered: false }], c3: [answered()] }).cause, "UNDETERMINED");
  const other = attributeCause("REPRODUCED", [classifyToolsList(HANDSHAKE), classifyToolsList(HANDSHAKE)], noControls);
  assert.equal(other.cause, "UNDETERMINED");
  assert.equal(other.rule, 6);
  // The order: a failing C1 beats an ERROR (rule 1 before 2); an ERROR beats an early exit (2 before 3); an early exit beats rule 4.
  assert.equal(attributeCause("REPRODUCED", [errored(), neverWritten(1000)], noControls).rule, 2);
  assert.equal(attributeCause("REPRODUCED", [neverWritten(1000), afterClose(5000, 5500)], noControls).rule, 3);
});

void test("an attribution carries no message text: its reasons are fixed sentences", () => {
  const verdict = attributeCause("REPRODUCED", [errored(-32000)], noControls);
  assert.deepEqual(Object.keys(verdict).sort(), ["cause", "errorCode", "reason", "rule"]);
});

// ---- 5. ablationVerdict ------------------------------------------------------------------------------------------------------

const [CONFIG, RUNTIME, SOCKET] = ABLATION_NAMES as [string, string, string];
const reachedPolls = [{ atMs: 0, sandboxes: 0, containers: 0, attached: 0 }, { atMs: 2000, sandboxes: 1 }];
const emptyPolls = [{ atMs: 0, sandboxes: 0, containers: 0, attached: 0 }, { atMs: 2000, sandboxes: 0, containers: 0, attached: 0 }];
const run = (restore: readonly string[], reached: boolean, catalogueCodes: readonly string[] = []): AblationRun => ({ restore, polls: reached ? reachedPolls : emptyPolls, catalogueCodes });
const without = (name: string): string[] => ABLATION_NAMES.filter((other) => other !== name);
const sa = (reached = true): AblationRun[] => [run([...ABLATION_NAMES], reached), run([...ABLATION_NAMES], reached)];
const minus = (name: string, reached: boolean[], codes: string[] = []): AblationRun[] => reached.map((value) => run(without(name), value, codes));

void test("the reach predicate: a sandbox count, a container count or an attached boot report of at least one at any poll", () => {
  assert.equal(pollReached({}), false);
  assert.equal(pollReached({ sandboxes: 0, containers: 0, attached: 0 }), false);
  assert.equal(pollReached({ sandboxes: 1 }), true);
  assert.equal(pollReached({ containers: 2 }), true);
  assert.equal(pollReached({ attached: 1 }), true);
  assert.equal(runReached([]), false);
  assert.equal(runReached(emptyPolls), false);
  assert.equal(runReached([{ atMs: 0 }, { atMs: 2000, attached: 1 }, { atMs: 4000 }]), true, "any poll");
});

void test("ablation: NEEDED when SA reached and both minus-N runs did not; NOT-NEEDED when both did", () => {
  const runs = [...sa(), ...minus(CONFIG, [false, false]), ...minus(RUNTIME, [true, true]), ...minus(SOCKET, [false, false])];
  const verdict = ablationVerdict(runs);
  assert.equal(verdict.saReached, true);
  assert.deepEqual(
    verdict.perName.map((entry) => [entry.name, entry.verdict, entry.basis]),
    [
      [CONFIG, "NEEDED", "reach"],
      [RUNTIME, "NOT-NEEDED", "reach"],
      [SOCKET, "NEEDED", "reach"],
    ],
  );
});

void test("ablation: UNDETERMINED when the two minus-N runs disagree, when only one run exists, and when SA is not reached", () => {
  const split = ablationVerdict([...sa(), ...minus(CONFIG, [true, false]), ...minus(RUNTIME, [false]), ...minus(SOCKET, [])]);
  assert.deepEqual(
    split.perName.map((entry) => [entry.verdict, entry.basis, entry.runs]),
    [
      ["UNDETERMINED", "disagreement", 2],
      ["UNDETERMINED", "insufficient-runs", 1],
      ["UNDETERMINED", "insufficient-runs", 0],
    ],
  );
  const noSa = ablationVerdict([...sa(false), ...minus(CONFIG, [false, false], ["REALM_NOT_ACTIVE", "SCHEMA_INVALID"]), ...minus(RUNTIME, [true, true])]);
  assert.equal(noSa.saReached, false);
  assert.ok(noSa.perName.every((entry) => entry.verdict === "UNDETERMINED" && entry.basis === "fallback"));
  assert.deepEqual(noSa.perName[0]?.fallbackCodes, ["REALM_NOT_ACTIVE", "SCHEMA_INVALID"], "the codes of the minus-N runs");
  assert.equal(noSa.perName[1]?.fallbackCodes, undefined, "no code is recorded for a name whose runs show none");
  const sharedCode = ablationVerdict([run([...ABLATION_NAMES], false, ["REALM_NOT_ACTIVE"]), ...minus(CONFIG, [false, false], ["REALM_NOT_ACTIVE", "TOOL_TIMEOUT"])]);
  assert.deepEqual(sharedCode.perName[0]?.fallbackCodes, ["TOOL_TIMEOUT"], "a code that an SA run also shows does not name the missing variable");
  assert.equal(ablationVerdict([]).saReached, false, "no SA run is not reached");
  assert.equal(ablationVerdict([run([...ABLATION_NAMES], true), run([...ABLATION_NAMES], false)]).saReached, false, "every SA run must reach");
});

void test("ablation: S0 is a fact and never enters the per-name rule", () => {
  const base = [...sa(), ...minus(CONFIG, [false, false]), ...minus(RUNTIME, [true, true]), ...minus(SOCKET, [true, true])];
  const reachedS0 = ablationVerdict([...base, run([], true)]);
  const missedS0 = ablationVerdict([...base, run([], false)]);
  assert.equal(reachedS0.s0Reached, true);
  assert.equal(missedS0.s0Reached, false);
  assert.equal(ablationVerdict(base).s0Reached, undefined);
  assert.deepEqual(reachedS0.perName, missedS0.perName);
});

void test("the ablation text says needed for this non-default stack and names XDG_CONFIG_HOME specially", () => {
  const needed = ablationVerdict([...sa(), ...minus(CONFIG, [false, false]), ...minus(RUNTIME, [true, true]), ...minus(SOCKET, [true, true])]);
  assert.match(needed.text, /XDG_CONFIG_HOME needed for this non-default stack/);
  assert.match(needed.text, /XDG_CONFIG_HOME is relocated by the production scenario/);
  const none = ablationVerdict([...sa(), ...minus(CONFIG, [true, true]), ...minus(RUNTIME, [true, true]), ...minus(SOCKET, [true, true])]);
  assert.match(none.text, /no name is shown needed for this non-default stack/);
  assert.match(none.text, /XDG_CONFIG_HOME is relocated/);
});

// ---- 6. readWireTimeline -----------------------------------------------------------------------------------------------------

void test("readWireTimeline reads the recorder lines, and skips malformed, foreign and mark-less lines", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rlw-test-")));
  try {
    assert.deepEqual(readWireTimeline(join(dir, "absent.log")), []);
    const file = join(dir, "wire.log");
    writeFileSync(
      file,
      [
        "not json",
        "[]",
        JSON.stringify({ t: 1, dir: "sideways", kind: "request" }),
        JSON.stringify({ t: 2, dir: "host-to-realm", kind: "request", method: "initialize", id: 1, meta: true }),
        JSON.stringify({ dir: "host-to-realm", kind: "request", method: "ping", id: 7 }),
        JSON.stringify({ t: -1, dir: "host-to-realm", kind: "request", method: "ping", id: 7 }),
        JSON.stringify({ t: 1.5, dir: "host-to-realm", kind: "request", method: "ping", id: 7 }),
        JSON.stringify({ t: "3", dir: "host-to-realm", kind: "request", method: "ping", id: 7 }),
        JSON.stringify({ t: 4, dir: "realm-to-host", kind: "response", id: 1, error: true, errorCode: -32000 }),
        JSON.stringify({ t: 5, dir: "realm-to-host", kind: "response", id: 2, toolNames: ["a", 3] }),
        JSON.stringify({ t: 6, dir: "realm-to-host", kind: "response", id: 3, toolNames: ["exec"], error: false }),
        JSON.stringify({ t: 7, kind: "lifecycle", event: "host-stdin-end" }),
        JSON.stringify({ t: 8, kind: "lifecycle", event: "host-signal", signal: "SIGTERM" }),
        JSON.stringify({ t: 9, kind: "lifecycle", event: "child-exit", code: 3 }),
        JSON.stringify({ t: 10, kind: "lifecycle", event: "child-exit", code: null, signal: "SIGKILL" }),
        JSON.stringify({ t: 11, kind: "lifecycle", event: "unknown" }),
        JSON.stringify({ t: 12, dir: "host-to-realm", kind: "other", invalid: true }),
        JSON.stringify({ t: 13, dir: "host-to-realm", kind: "other", restored: ["A"] }),
        "",
      ].join("\n"),
    );
    assert.deepEqual(readWireTimeline(file), [
      { t: 2, kind: "request", dir: "host-to-realm", method: "initialize", id: 1, meta: true },
      { t: 4, kind: "response", dir: "realm-to-host", id: 1, error: true, errorCode: -32000 },
      { t: 5, kind: "response", dir: "realm-to-host", id: 2 },
      { t: 6, kind: "response", dir: "realm-to-host", id: 3, toolNames: ["exec"] },
      { t: 7, kind: "lifecycle", event: "host-stdin-end" },
      { t: 8, kind: "lifecycle", event: "host-signal", signal: "SIGTERM" },
      { t: 9, kind: "lifecycle", event: "child-exit", exitCode: 3 },
      { t: 10, kind: "lifecycle", event: "child-exit", signal: "SIGKILL" },
      { t: 12, kind: "other", dir: "host-to-realm", invalid: true },
      { t: 13, kind: "other", dir: "host-to-realm", restored: ["A"] },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- 7. The run record and the runner ----------------------------------------------------------------------------------------

void test("parseRunRecord and parseReachPolls accept the documented shapes and refuse a wrong type", () => {
  const record = { label: "all", restore: [...ABLATION_NAMES], warm: false, diagnostic: false, cold: true, elapsedMs: 18000, returned: true, exitCode: 0, catalogueCodes: ["REALM_NOT_ACTIVE"], control: "C1", extra: "dropped" };
  assert.deepEqual(parseRunRecord(record), { label: "all", restore: [...ABLATION_NAMES], warm: false, diagnostic: false, cold: true, elapsedMs: 18000, returned: true, exitCode: 0, catalogueCodes: ["REALM_NOT_ACTIVE"], control: "C1" });
  const minimal = parseRunRecord({ ...record, exitCode: undefined, control: undefined });
  assert.ok(minimal !== undefined && !("exitCode" in minimal) && !("control" in minimal), "an absent exit code and control stay absent");
  assert.equal(parseRunRecord({ ...record, control: "C9" }), undefined);
  assert.equal(parseRunRecord({ ...record, restore: ["A", 3] }), undefined);
  assert.equal(parseRunRecord({ ...record, cold: "yes" }), undefined);
  assert.equal(parseRunRecord([]), undefined);
  assert.deepEqual(parseReachPolls({ polls: [{ atMs: 0, sandboxes: 1, containers: "x" }, { sandboxes: 2 }, 5, { atMs: 2000, attached: 1 }] }), [{ atMs: 0, sandboxes: 1 }, { atMs: 2000, attached: 1 }]);
  assert.equal(parseReachPolls({}), undefined);
});

function wireLines(events: readonly object[]): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function runFolder(root: string, name: string, options: { readonly events?: readonly object[]; readonly record?: object; readonly polls?: readonly object[] }): void {
  const dir = join(root, name);
  mkdirSync(dir);
  writeFileSync(join(dir, "wire.log"), wireLines(options.events ?? []));
  if (options.record !== undefined) {
    writeFileSync(join(dir, "run.json"), JSON.stringify(options.record));
  }
  if (options.polls !== undefined) {
    writeFileSync(join(dir, "reach.json"), JSON.stringify({ polls: options.polls }));
  }
}

void test("summarizeRuns computes the classification, the reproduction, the attribution and the ablation from a directory, and the runner prints it", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rlw-run-")));
  try {
    const base = { warm: false, diagnostic: false, cold: true, elapsedMs: 18000, returned: true, exitCode: 0, catalogueCodes: [] as string[] };
    const sa = { ...base, label: "all", restore: [...ABLATION_NAMES] };
    const wire = (tail: object[]): object[] => [...HANDSHAKE, LIST_REQUEST, ...tail];
    runFolder(root, "01-sa", { events: wire([result(150)]), record: sa, polls: [{ atMs: 0, sandboxes: 1 }] });
    runFolder(root, "02-sa", { events: wire([error(150, -32603)]), record: sa, polls: [{ atMs: 0, containers: 1 }] });
    runFolder(root, "03-sa", { events: wire([]), record: sa, polls: [{ atMs: 0, attached: 1 }] });
    runFolder(root, "04-c1", { events: wire([result(150)]), record: { ...sa, control: "C1" } });
    runFolder(root, "05-c2", { record: { ...sa, control: "C2", elapsedMs: 3000 } });
    runFolder(root, "06-minus-config", { events: wire([result(150)]), record: { ...base, label: "minus-XDG_CONFIG_HOME", restore: ABLATION_NAMES.slice(1), diagnostic: true }, polls: [{ atMs: 0 }] });
    runFolder(root, "07-minus-config", { events: wire([result(150)]), record: { ...base, label: "minus-XDG_CONFIG_HOME", restore: ABLATION_NAMES.slice(1), diagnostic: true }, polls: [{ atMs: 0 }] });
    runFolder(root, "08-warm", { events: wire([result(150)]), record: { ...sa, warm: true, diagnostic: true } });
    runFolder(root, "09-broken", { events: [] });

    const summary = summarizeRuns(root);
    assert.deepEqual(summary.skipped, ["09-broken"]);
    assert.deepEqual(
      summary.runs.map((run) => [run.folder, run.verdict.class]),
      [
        ["01-sa", "ANSWERED"],
        ["02-sa", "ERROR"],
        ["03-sa", "NEVER-WRITTEN"],
        ["04-c1", "ANSWERED"],
        ["05-c2", "NOT-REQUESTED"],
        ["06-minus-config", "ANSWERED"],
        ["07-minus-config", "ANSWERED"],
        ["08-warm", "ANSWERED"],
      ],
    );
    assert.deepEqual([summary.reproduction.outcome, summary.reproduction.attempts, summary.reproduction.counted, summary.reproduction.failing], ["REPRODUCED", 3, 3, 2]);
    assert.equal(summary.nextStep, "stop");
    assert.equal(summary.cause.cause, "REALM-MCP");
    assert.equal(summary.cause.errorCode, -32603);
    assert.equal(summary.ablation.saReached, true);
    assert.deepEqual(
      summary.ablation.perName.map((entry) => [entry.name, entry.verdict, entry.basis]),
      [
        [ABLATION_NAMES[0], "NEEDED", "reach"],
        [ABLATION_NAMES[1], "UNDETERMINED", "insufficient-runs"],
        [ABLATION_NAMES[2], "UNDETERMINED", "insufficient-runs"],
      ],
    );

    const script = fileURLToPath(new URL("./wire-timeline-run.js", import.meta.url));
    const run = spawnSync(process.execPath, [script, root], { encoding: "utf8", env: {} });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), JSON.parse(JSON.stringify(summary)));
    assert.equal(spawnSync(process.execPath, [script, join(root, "absent")], { encoding: "utf8", env: {} }).status, 2);
    assert.equal(spawnSync(process.execPath, [script], { encoding: "utf8", env: {} }).status, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
