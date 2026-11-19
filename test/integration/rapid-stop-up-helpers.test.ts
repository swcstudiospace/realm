// Hermetic tests for the pure helpers of the gated rapid stop-then-up live test (test/support/rapid-stop-up.ts): the gate, the
// variant and count parsing, the up classifier, the stop classifier, the chain state machine, the window outcome of 46-CONTEXT
// D-46-02, the timeline helpers and the closed-phrase evidence lines. This file always runs: it needs no gate variable, no
// Podman, no real sleep and no network, and it passes as a regular non-root user.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PodmanProbe } from "../../src/runtime/podman-version.js";
import type { StopRecord } from "../support/daemon-stop-live.js";
import type { ProductionGateInputs } from "../support/production-live.js";
import {
  CONTROL_ITERATIONS,
  MID_UP_DELAY_MS,
  TARGET_CLEAN_ITERATIONS,
  chainStartEvidenceLine,
  recordChainStartFailure,
  chainStep,
  classifyStop,
  classifyUp,
  controlDecision,
  evidenceLine,
  failureKindsOf,
  iterationEvidenceLine,
  lateSupervisors,
  mergeTimeline,
  newChainState,
  parseIterations,
  parseMaxFailures,
  parseRapidVariants,
  rapidSkipReason,
  pidsOfListing,
  reapRemovedAfter,
  startupRowsOf,
  startupSeenAt,
  summaryOf,
  supervisorLifespans,
  targetOf,
  timelineAround,
  windowOutcome,
  type ChainAction,
  type ChainState,
  type IterationOutcome,
  type IterationRecord,
  type RapidVariant,
  type StopClass,
  type TimelineEvent,
  type UpOutcome,
  type UpRun,
  type VariantEnd,
  type VariantResult,
} from "../support/rapid-stop-up.js";

const CLI_PATH = "dist/src/cli/main.js";
const PODMAN_5: PodmanProbe = { kind: "output", stdout: "podman version 5.7.1\n" };

// A host where every prerequisite of the production gate and of the rapid test holds.
function openInputs(extraEnv: Record<string, string | undefined> = {}, overrides: Partial<ProductionGateInputs> = {}): ProductionGateInputs {
  const env: Record<string, string | undefined> = {
    REALM_LIVE_PRODUCTION: "1",
    REALM_LIVE_IMAGE: `localhost/realm-agentos@sha256:${"a".repeat(64)}`,
    REALM_LIVE_DRIVER_CONFIG: "/driver-config.json",
    REALM_DRIVER_SOCKET: "/run-user/realm/driver.sock",
    XDG_RUNTIME_DIR: "/run-user",
    PATH: "/bin",
    REALM_LIVE_RAPID: "1",
    REALM_RAPID_EVIDENCE_DIR: "/evidence",
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

// ---- A. rapidSkipReason ---------------------------------------------------------------------------------------------------

void test("rapidSkipReason lets the test run when every prerequisite holds", () => {
  assert.equal(rapidSkipReason(openInputs()), false);
});

void test("rapidSkipReason names the production gate's reason first, whatever else is missing", () => {
  const reason = String(rapidSkipReason(openInputs({ REALM_LIVE_PRODUCTION: undefined, REALM_LIVE_RAPID: undefined })));
  assert.match(reason, /REALM_LIVE_PRODUCTION=1 is not set/);
});

void test("rapidSkipReason needs REALM_LIVE_RAPID exactly 1", () => {
  for (const value of [undefined, "", "0", "true", "yes", " 1", "11"]) {
    const reason = String(rapidSkipReason(openInputs({ REALM_LIVE_RAPID: value })));
    assert.match(reason, /REALM_LIVE_RAPID=1 is not set/, `value ${JSON.stringify(value)}`);
  }
});

void test("rapidSkipReason needs an absolute path to an existing evidence directory, and names the variable not the value", () => {
  for (const value of [undefined, "relative/dir", "/missing"]) {
    const reason = String(rapidSkipReason(openInputs({ REALM_RAPID_EVIDENCE_DIR: value })));
    assert.match(reason, /REALM_RAPID_EVIDENCE_DIR is not an absolute path to an existing directory/);
    assert.ok(value === undefined || !reason.includes(value), "the reason carries no value");
  }
});

void test("rapidSkipReason refuses an invalid variant list and names the variable", () => {
  for (const value of ["a,x", "a,,b", "A", "abc", ","]) {
    assert.match(String(rapidSkipReason(openInputs({ REALM_RAPID_VARIANTS: value }))), /REALM_RAPID_VARIANTS is not a comma list/, value);
  }
  for (const value of [undefined, "", "a", "a,b,c,s", "s"]) {
    assert.equal(rapidSkipReason(openInputs({ REALM_RAPID_VARIANTS: value })), false, String(value));
  }
});

void test("rapidSkipReason does not require the unit variables", () => {
  assert.equal(rapidSkipReason(openInputs({ REALM_LIVE_DRIVER_UNIT: undefined, REALM_RAPID_GATEWAY_UNIT: undefined })), false);
});

// ---- B. Parsing -----------------------------------------------------------------------------------------------------------

void test("parseRapidVariants: absent or blank gives a, b, c; a list is deduplicated and ordered a, b, c, s", () => {
  assert.deepEqual(parseRapidVariants(undefined), { ok: true, variants: ["a", "b", "c"] });
  assert.deepEqual(parseRapidVariants(""), { ok: true, variants: ["a", "b", "c"] });
  assert.deepEqual(parseRapidVariants("  "), { ok: true, variants: ["a", "b", "c"] });
  assert.deepEqual(parseRapidVariants("s,a,a"), { ok: true, variants: ["a", "s"] });
  assert.deepEqual(parseRapidVariants(" c , b "), { ok: true, variants: ["b", "c"] });
  assert.deepEqual(parseRapidVariants("a,b,c,s"), { ok: true, variants: ["a", "b", "c", "s"] });
});

void test("parseRapidVariants: an unknown letter or an empty element makes the whole value invalid", () => {
  for (const value of ["d", "a,d", "a,", ",a", "a,,c", "ab", "a;b"]) {
    assert.deepEqual(parseRapidVariants(value), { ok: false }, value);
  }
});

void test("parseIterations: 1 to 50, default 50, out of range clamped, decimal or text gives the default", () => {
  assert.equal(parseIterations(undefined), 50);
  assert.equal(parseIterations(""), 50);
  assert.equal(parseIterations("20"), 20);
  assert.equal(parseIterations(" 7 "), 7);
  assert.equal(parseIterations("0"), 1);
  assert.equal(parseIterations("51"), 50);
  assert.equal(parseIterations("9999"), 50);
  assert.equal(parseIterations("2.5"), 50);
  assert.equal(parseIterations("-3"), 50);
  assert.equal(parseIterations("many"), 50);
});

void test("parseMaxFailures: 1 to 5, default 3, out of range clamped, decimal or text gives the default", () => {
  assert.equal(parseMaxFailures(undefined), 3);
  assert.equal(parseMaxFailures("1"), 1);
  assert.equal(parseMaxFailures("5"), 5);
  assert.equal(parseMaxFailures("0"), 1);
  assert.equal(parseMaxFailures("6"), 5);
  assert.equal(parseMaxFailures("2.5"), 3);
  assert.equal(parseMaxFailures("x"), 3);
});

void test("the constants are the numbers of 46-CONTEXT D-46-01 and D-46-02", () => {
  assert.equal(TARGET_CLEAN_ITERATIONS, 50);
  assert.equal(CONTROL_ITERATIONS, 20);
  assert.equal(MID_UP_DELAY_MS, 3000);
});

void test("targetOf: a, b and c run to the chosen count, the control to its own count capped by it", () => {
  assert.equal(targetOf("a", 50), 50);
  assert.equal(targetOf("c", 12), 12);
  assert.equal(targetOf("s", 50), 20);
  assert.equal(targetOf("s", 5), 5);
});

void test("controlDecision: named runs; the default list runs it only after a failure; a list without it never runs it", () => {
  assert.deepEqual(controlDecision("a,s", 0), { run: true, reason: "named-in-list" });
  assert.deepEqual(controlDecision(undefined, 0), { run: false, reason: "no-failure-in-abc" });
  assert.deepEqual(controlDecision("", 2), { run: true, reason: "failure-in-abc" });
  assert.deepEqual(controlDecision("a,b", 3), { run: false, reason: "not-named-in-list" });
  assert.deepEqual(controlDecision("a,q", 3), { run: false, reason: "variant-list-invalid" });
});

// ---- C. classifyUp --------------------------------------------------------------------------------------------------------

function upRun(overrides: Partial<UpRun> = {}): UpRun {
  return { exitCode: 0, timedOut: false, stdout: "", stderr: "", ...overrides };
}

void test("classifyUp: exit 0 is ok", () => {
  assert.deepEqual(classifyUp(upRun({ stdout: '{"state":"active"}\n' }), ""), { kind: "ok", notice: false });
});

void test("classifyUp: a non-zero exit with OPENSHELL_START_FAILED is start-failed, with no cause when the output carries none", () => {
  const run = upRun({ exitCode: 1, stdout: "OPENSHELL_START_FAILED\n", stderr: "OpenShell failed to start inside the session container.\n" });
  assert.deepEqual(classifyUp(run, ""), { kind: "start-failed", causeCode: undefined, notice: false });
});

void test("classifyUp: start-failed carries the first other catalogue code of the output as the cause", () => {
  const run = upRun({ exitCode: 1, stdout: "OPENSHELL_START_FAILED\n", stderr: "SANDBOX_NAME_IN_USE\n" });
  assert.deepEqual(classifyUp(run, ""), { kind: "start-failed", causeCode: "SANDBOX_NAME_IN_USE", notice: false });
  const json = upRun({ exitCode: 1, stdout: '{"error":{"code":"OPENSHELL_START_FAILED","causeCode":"PODMAN_MISSING"}}\n' });
  assert.deepEqual(classifyUp(json, ""), { kind: "start-failed", causeCode: "PODMAN_MISSING", notice: false });
});

void test("classifyUp: any other catalogue code is other-failure with that code, never start-failed", () => {
  const run = upRun({ exitCode: 1, stdout: "REALM_STOPPING\n", stderr: "The realm is stopping.\n" });
  assert.deepEqual(classifyUp(run, ""), { kind: "other-failure", code: "REALM_STOPPING", notice: false });
});

void test("classifyUp: a non-zero exit with no catalogue code is other-failure with no code", () => {
  assert.deepEqual(classifyUp(upRun({ exitCode: 1, stdout: "boom\n", stderr: "OPENSHELL went wrong\n" }), ""), {
    kind: "other-failure",
    code: undefined,
    notice: false,
  });
  assert.deepEqual(classifyUp(upRun({ exitCode: undefined, stdout: "", stderr: "" }), ""), { kind: "other-failure", code: undefined, notice: false });
});

void test("classifyUp: text that only resembles a code is not a code", () => {
  const run = upRun({ exitCode: 1, stdout: "NOT_A_CODE OPENSHELL_START_FAILED_LATER\n" });
  assert.equal(classifyUp(run, "").kind, "other-failure");
});

void test("classifyUp: a call killed at its bound is a timeout, whatever its output says", () => {
  assert.deepEqual(classifyUp(upRun({ exitCode: undefined, timedOut: true, stdout: "OPENSHELL_START_FAILED\n" }), ""), { kind: "timeout", notice: false });
});

void test("classifyUp: the notice is a boolean taken from the up output or the status text, and the text is never kept", () => {
  const withNotice = '{"notice":"a previous daemon sandbox was destroyed"}';
  const fromUp = classifyUp(upRun({ stdout: withNotice }), "");
  const fromStatus = classifyUp(upRun(), withNotice);
  assert.deepEqual(fromUp, { kind: "ok", notice: true });
  assert.deepEqual(fromStatus, { kind: "ok", notice: true });
  assert.deepEqual(classifyUp(upRun({ exitCode: 1, stdout: "OPENSHELL_START_FAILED\n" }), withNotice), { kind: "start-failed", causeCode: undefined, notice: true });
  assert.deepEqual(classifyUp(upRun(), "not json"), { kind: "ok", notice: false });
});

void test("classifyUp returns no text beyond a catalogue code name", () => {
  const outcome = classifyUp(upRun({ exitCode: 1, stdout: "OPENSHELL_START_FAILED /home/x/secret token=abcd\n", stderr: "/var/lib/realm\n" }), "");
  const text = JSON.stringify(outcome);
  assert.ok(!text.includes("/"), text);
  assert.ok(!text.includes("token"), text);
});

// ---- D. classifyStop ------------------------------------------------------------------------------------------------------

const SIGNAL = Date.parse("2026-11-19T10:00:00.000Z");

function row(event: "daemon.stopping" | "daemon.stopped", offsetMs: number, extra: Record<string, unknown> = {}): StopRecord {
  const ts = new Date(SIGNAL + offsetMs).toISOString();
  return { event, ts, row: { event, ts, ...extra } };
}

void test("classifyStop: stopping then stopped with failedTeardowns 0 and no code is clean", () => {
  assert.deepEqual(classifyStop([row("daemon.stopping", 5), row("daemon.stopped", 900, { failedTeardowns: 0 })], SIGNAL, null), { kind: "clean" });
});

void test("classifyStop: failedTeardowns above 0 is dirty, with the count", () => {
  assert.deepEqual(classifyStop([row("daemon.stopping", 5), row("daemon.stopped", 900, { failedTeardowns: 2 })], SIGNAL, null), {
    kind: "dirty",
    failedTeardowns: 2,
    code: undefined,
    stoppingSeen: true,
  });
});

void test("classifyStop: a code is dirty, a catalogue code kept by name and any other string as unlisted", () => {
  const withCode = (code: string): StopClass => classifyStop([row("daemon.stopping", 5), row("daemon.stopped", 900, { failedTeardowns: 0, code })], SIGNAL, null);
  assert.deepEqual(withCode("AGENTOS_STOP_FAILED"), { kind: "dirty", failedTeardowns: 0, code: "AGENTOS_STOP_FAILED", stoppingSeen: true });
  assert.deepEqual(withCode("/some/path"), { kind: "dirty", failedTeardowns: 0, code: "unlisted", stoppingSeen: true });
});

void test("classifyStop: a stopped row with no stopping row before it is not clean", () => {
  assert.deepEqual(classifyStop([row("daemon.stopped", 900, { failedTeardowns: 0 })], SIGNAL, null), {
    kind: "dirty",
    failedTeardowns: 0,
    code: undefined,
    stoppingSeen: false,
  });
});

void test("classifyStop: a stopped row with no numeric failedTeardowns is dirty with an unreadable count", () => {
  assert.deepEqual(classifyStop([row("daemon.stopping", 5), row("daemon.stopped", 900, {})], SIGNAL, null), {
    kind: "dirty",
    failedTeardowns: null,
    code: undefined,
    stoppingSeen: true,
  });
});

void test("classifyStop: no stopped row is row-absent, with whether a stopping row was there and whether startup was seen", () => {
  assert.deepEqual(classifyStop([], SIGNAL, null), { kind: "row-absent", stoppingSeen: false, startupSeen: null });
  assert.deepEqual(classifyStop([row("daemon.stopping", 5)], SIGNAL, true), { kind: "row-absent", stoppingSeen: true, startupSeen: true });
  assert.deepEqual(classifyStop([], SIGNAL, false), { kind: "row-absent", stoppingSeen: false, startupSeen: false });
});

void test("classifyStop: an unreadable request log is log-unreadable", () => {
  assert.deepEqual(classifyStop(undefined, SIGNAL, null), { kind: "log-unreadable" });
});

void test("classifyStop: rows stamped before the signal belong to an earlier stop", () => {
  const earlier = [row("daemon.stopping", -5000), row("daemon.stopped", -4000, { failedTeardowns: 0 })];
  assert.deepEqual(classifyStop(earlier, SIGNAL, null), { kind: "row-absent", stoppingSeen: false, startupSeen: null });
});

void test("classifyStop: the last stopped row of the window decides", () => {
  const records = [row("daemon.stopping", 5), row("daemon.stopped", 100, { failedTeardowns: 1 }), row("daemon.stopped", 200, { failedTeardowns: 0 })];
  assert.deepEqual(classifyStop(records, SIGNAL, null), { kind: "clean" });
});

// ---- E. The chain state machine -------------------------------------------------------------------------------------------

const UP_OK: UpOutcome = { kind: "ok", notice: false };
const START_FAILED: UpOutcome = { kind: "start-failed", causeCode: undefined, notice: true };

function cleanOutcome(): IterationOutcome {
  return { up: UP_OK, active: true, execOk: true, stop: { kind: "clean" } };
}

void test("failureKindsOf: a clean iteration has no kind", () => {
  assert.deepEqual(failureKindsOf(cleanOutcome()), []);
});

void test("failureKindsOf: every way to fail, with the up first and the stop last", () => {
  const base = cleanOutcome();
  assert.deepEqual(failureKindsOf({ ...base, up: START_FAILED, active: false, execOk: false }), ["start-failed"]);
  assert.deepEqual(failureKindsOf({ ...base, up: { kind: "other-failure", code: "REALM_STOPPING", notice: false }, active: false, execOk: false }), ["other-failure"]);
  assert.deepEqual(failureKindsOf({ ...base, up: { kind: "timeout", notice: false }, active: false, execOk: false }), ["timeout"]);
  assert.deepEqual(failureKindsOf({ ...base, active: false, execOk: false }), ["not-active"]);
  assert.deepEqual(failureKindsOf({ ...base, execOk: false }), ["exec-failed"]);
  assert.deepEqual(failureKindsOf({ ...base, stop: { kind: "dirty", failedTeardowns: 1, code: undefined, stoppingSeen: true } }), ["dirty-stop"]);
  assert.deepEqual(failureKindsOf({ ...base, stop: { kind: "row-absent", stoppingSeen: false, startupSeen: false } }), ["row-absent"]);
  assert.deepEqual(failureKindsOf({ ...base, stop: { kind: "log-unreadable" } }), ["log-unreadable"]);
  assert.deepEqual(failureKindsOf({ ...base, up: START_FAILED, active: false, execOk: false, stop: { kind: "dirty", failedTeardowns: 1, code: undefined, stoppingSeen: true } }), [
    "start-failed",
    "dirty-stop",
  ]);
});

void test("failureKindsOf: a daemon that did not exit is a stop-timeout, and an iteration whose up never ran is never clean", () => {
  const notRun: UpOutcome = { kind: "not-run", notice: false };
  assert.deepEqual(failureKindsOf({ up: notRun, active: false, execOk: false, stop: { kind: "not-exited" } }), ["stop-timeout"]);
  assert.deepEqual(failureKindsOf({ up: notRun, active: false, execOk: false, stop: { kind: "clean" } }), ["other-failure"]);
  const step = chainStep(newChainState("a", 5, 3), { up: notRun, active: false, execOk: false, stop: { kind: "not-exited" } });
  assert.equal(step.action, "restart-chain");
  assert.deepEqual(step.state.failures, [{ iteration: 1, kinds: ["stop-timeout"] }]);
  assert.equal(windowOutcome([{ variant: "a", state: step.state, ended: "host" }]).outcome, "OTHER-FAILURE");
});

void test("failureKindsOf: a failing realm down after a variant c iteration is a failure of its own kind, kept and counted, never a host stop", () => {
  const base = cleanOutcome();
  assert.deepEqual(failureKindsOf({ ...base, down: { kind: "ok", notice: false } }), []);
  const failedDown: UpOutcome = { kind: "other-failure", code: "AGENTOS_STOP_FAILED", notice: false };
  assert.deepEqual(failureKindsOf({ ...base, down: failedDown }), ["down-failed"]);
  assert.deepEqual(failureKindsOf({ ...base, down: { kind: "timeout", notice: false } }), ["down-failed"]);
  const step = chainStep(newChainState("c", 5, 3), { ...base, down: failedDown });
  assert.equal(step.action, "restart-chain");
  assert.deepEqual(step.state.failures, [{ iteration: 1, kinds: ["down-failed"] }]);
  assert.equal(windowOutcome([{ variant: "c", state: step.state, ended: "host" }]).outcome, "OTHER-FAILURE");
});

void test("recordChainStartFailure: a failed settled first up is kept and counted, resets the consecutive count, and is never a reproduction", () => {
  let state = newChainState("b", 20, 2);
  state = chainStep(state, cleanOutcome()).state;
  assert.equal(state.consecutiveClean, 1);
  const first = recordChainStartFailure(state);
  assert.equal(first.action, "restart-chain");
  assert.equal(first.state.consecutiveClean, 0);
  assert.equal(first.state.iterations, 1, "a chain start failure is not an iteration");
  assert.equal(first.state.cleanIterations, 1);
  assert.deepEqual(first.state.failures, [{ iteration: 1, kinds: ["chain-start-failed"] }]);
  const second = recordChainStartFailure(first.state);
  assert.equal(second.action, "variant-done-failed");
  assert.equal(second.state.failures.length, 2);
  // Even when the settled up failed with OPENSHELL_START_FAILED, the window reads OTHER-FAILURE, never REPRODUCED.
  const window = windowOutcome([{ variant: "b", state: first.state, ended: "host" }]);
  assert.equal(window.outcome, "OTHER-FAILURE");
  assert.equal(window.counts[0]?.startFailed, 0);
});

void test("chainStartEvidenceLine: the up kind, its codes and whether the session reached active, in closed phrases", () => {
  assert.equal(
    chainStartEvidenceLine("b", 1, { kind: "start-failed", causeCode: undefined, notice: false }, false),
    "variant=b chain=1 stage=chain-start result=failed up=start-failed upCode=none upCause=none active=no",
  );
  assert.equal(
    chainStartEvidenceLine("a", 2, { kind: "other-failure", code: "REALM_STOPPING", notice: false }, false),
    "variant=a chain=2 stage=chain-start result=failed up=other-failure upCode=REALM_STOPPING upCause=none active=no",
  );
  assert.equal(chainStartEvidenceLine("a", 3, { kind: "ok", notice: false }, false), "variant=a chain=3 stage=chain-start result=failed up=ok upCode=none upCause=none active=no");
});

void test("chainStep: a clean iteration continues until the consecutive count reaches the target, then the variant is done clean", () => {
  let state = newChainState("a", 3, 3);
  const actions: ChainAction[] = [];
  for (let index = 0; index < 3; index += 1) {
    const step = chainStep(state, cleanOutcome());
    state = step.state;
    actions.push(step.action);
  }
  assert.deepEqual(actions, ["continue", "continue", "variant-done-clean"]);
  assert.equal(state.consecutiveClean, 3);
  assert.equal(state.cleanIterations, 3);
  assert.equal(state.iterations, 3);
  assert.deepEqual(state.failures, []);
});

void test("chainStep: a failure is kept with its kinds, resets the consecutive count and asks for a new chain", () => {
  let state = newChainState("a", 10, 3);
  state = chainStep(state, cleanOutcome()).state;
  state = chainStep(state, cleanOutcome()).state;
  const step = chainStep(state, { ...cleanOutcome(), up: START_FAILED, active: false, execOk: false });
  assert.equal(step.action, "restart-chain");
  assert.equal(step.state.consecutiveClean, 0);
  assert.equal(step.state.cleanIterations, 2);
  assert.equal(step.state.iterations, 3);
  assert.deepEqual(step.state.failures, [{ iteration: 3, kinds: ["start-failed"] }]);
});

void test("chainStep: the failure cap ends the variant and every failure stays in the list", () => {
  let state = newChainState("b", 50, 2);
  const failing: IterationOutcome = { ...cleanOutcome(), execOk: false };
  const first = chainStep(state, failing);
  assert.equal(first.action, "restart-chain");
  state = first.state;
  const second = chainStep(state, failing);
  assert.equal(second.action, "variant-done-failed");
  assert.deepEqual(second.state.failures, [
    { iteration: 1, kinds: ["exec-failed"] },
    { iteration: 2, kinds: ["exec-failed"] },
  ]);
});

void test("chainStep: a dirty stop and a row-absent stop are never clean and never a reproduction", () => {
  for (const stop of [
    { kind: "dirty", failedTeardowns: 1, code: undefined, stoppingSeen: true },
    { kind: "dirty", failedTeardowns: 0, code: "AGENTOS_STOP_FAILED", stoppingSeen: true },
    { kind: "row-absent", stoppingSeen: false, startupSeen: false },
    { kind: "row-absent", stoppingSeen: true, startupSeen: null },
    { kind: "log-unreadable" },
  ] as const satisfies readonly StopClass[]) {
    const step = chainStep(newChainState("a", 5, 3), { ...cleanOutcome(), stop });
    assert.equal(step.state.cleanIterations, 0);
    assert.equal(step.state.consecutiveClean, 0);
    assert.equal(step.state.failures.length, 1);
    assert.ok(!(step.state.failures[0]?.kinds ?? []).includes("start-failed"));
    assert.equal(step.action, "restart-chain");
    const window = windowOutcome([{ variant: "a", state: step.state, ended: "host" }]);
    assert.equal(window.outcome, "OTHER-FAILURE");
  }
});

// Feeds a list of outcomes to chainStep from a fresh state, returning the final state and every action.
function run(variant: RapidVariant, target: number, cap: number, outcomes: readonly IterationOutcome[]): { readonly state: ChainState; readonly actions: readonly ChainAction[] } {
  let state = newChainState(variant, target, cap);
  const actions: ChainAction[] = [];
  for (const outcome of outcomes) {
    const step = chainStep(state, outcome);
    state = step.state;
    actions.push(step.action);
  }
  return { state, actions };
}

function repeat(count: number, outcome: IterationOutcome): readonly IterationOutcome[] {
  return Array.from({ length: count }, () => outcome);
}

function endOf(actions: readonly ChainAction[]): VariantEnd {
  const last = actions.at(-1);
  return last === "variant-done-clean" ? "target" : last === "variant-done-failed" ? "failure-cap" : "host";
}

function resultOf(variant: RapidVariant, outcomes: readonly IterationOutcome[], target = TARGET_CLEAN_ITERATIONS, cap = 3): VariantResult {
  const { state, actions } = run(variant, target, cap, outcomes);
  return { variant, state, ended: endOf(actions) };
}

void test("scripted chain: 49 clean, one start-failed at iteration 50, then 50 clean is REPRODUCED and the consecutive count was reset", () => {
  const failing: IterationOutcome = { ...cleanOutcome(), up: START_FAILED, active: false, execOk: false };
  const first = run("a", 50, 3, [...repeat(49, cleanOutcome()), failing]);
  assert.equal(first.actions.at(-1), "restart-chain");
  assert.equal(first.state.consecutiveClean, 0);
  assert.equal(first.state.cleanIterations, 49);
  assert.equal(first.state.iterations, 50);

  const whole = run("a", 50, 3, [...repeat(49, cleanOutcome()), failing, ...repeat(50, cleanOutcome())]);
  assert.equal(whole.actions.at(-1), "variant-done-clean");
  assert.equal(whole.actions.filter((action) => action === "restart-chain").length, 1);
  assert.equal(whole.state.consecutiveClean, 50);
  assert.equal(whole.state.iterations, 100);
  assert.deepEqual(whole.state.failures, [{ iteration: 50, kinds: ["start-failed"] }]);

  const clean = (variant: RapidVariant): VariantResult => resultOf(variant, repeat(50, cleanOutcome()));
  const window = windowOutcome([{ variant: "a", state: whole.state, ended: "target" }, clean("b"), clean("c")]);
  assert.equal(window.outcome, "REPRODUCED");
  assert.deepEqual(
    window.counts.map((count) => [count.variant, count.iterations, count.clean, count.consecutiveClean, count.failures, count.startFailed]),
    [
      ["a", 100, 99, 50, 1, 1],
      ["b", 50, 50, 50, 0, 0],
      ["c", 50, 50, 50, 0, 0],
    ],
  );
});

void test("scripted chain: 50 clean iterations in each of a, b and c with no failure is NOT-REPRODUCED", () => {
  const results = (["a", "b", "c"] as const).map((variant) => resultOf(variant, repeat(50, cleanOutcome())));
  for (const result of results) {
    assert.equal(result.ended, "target");
    assert.equal(result.state.consecutiveClean, 50);
  }
  const window = windowOutcome(results);
  assert.equal(window.outcome, "NOT-REPRODUCED");
  assert.deepEqual(window.counts.map((count) => count.failures), [0, 0, 0]);
});

// ---- F. windowOutcome -----------------------------------------------------------------------------------------------------

function cleanResult(variant: RapidVariant): VariantResult {
  return resultOf(variant, repeat(50, cleanOutcome()));
}

function failedResult(variant: RapidVariant, outcome: IterationOutcome, cleanBefore = 10): VariantResult {
  return resultOf(variant, [...repeat(cleanBefore, cleanOutcome()), outcome]);
}

void test("windowOutcome: any start-failed in any variant is REPRODUCED, even beside other failures", () => {
  const startFailed: IterationOutcome = { ...cleanOutcome(), up: START_FAILED, active: false, execOk: false };
  const dirty: IterationOutcome = { ...cleanOutcome(), stop: { kind: "dirty", failedTeardowns: 1, code: undefined, stoppingSeen: true } };
  assert.equal(windowOutcome([cleanResult("a"), cleanResult("b"), failedResult("c", startFailed)]).outcome, "REPRODUCED");
  assert.equal(windowOutcome([failedResult("a", dirty), cleanResult("b"), failedResult("c", startFailed)]).outcome, "REPRODUCED");
  assert.equal(windowOutcome([cleanResult("a"), cleanResult("b"), cleanResult("c"), failedResult("s", startFailed)]).outcome, "REPRODUCED");
  const both: IterationOutcome = { ...startFailed, stop: { kind: "row-absent", stoppingSeen: false, startupSeen: false } };
  assert.equal(windowOutcome([failedResult("a", both)]).outcome, "REPRODUCED");
});

void test("windowOutcome: a failure of any other kind and no start-failed is OTHER-FAILURE", () => {
  const cases: readonly IterationOutcome[] = [
    { ...cleanOutcome(), up: { kind: "other-failure", code: "REALM_STOPPING", notice: false }, active: false, execOk: false },
    { ...cleanOutcome(), up: { kind: "timeout", notice: false }, active: false, execOk: false },
    { ...cleanOutcome(), active: false, execOk: false },
    { ...cleanOutcome(), execOk: false },
    { ...cleanOutcome(), stop: { kind: "dirty", failedTeardowns: 3, code: undefined, stoppingSeen: true } },
    { ...cleanOutcome(), stop: { kind: "row-absent", stoppingSeen: false, startupSeen: true } },
    { ...cleanOutcome(), stop: { kind: "log-unreadable" } },
  ];
  for (const outcome of cases) {
    assert.equal(windowOutcome([cleanResult("a"), cleanResult("b"), failedResult("c", outcome)]).outcome, "OTHER-FAILURE", JSON.stringify(outcome));
  }
});

void test("windowOutcome: a failure in the control alone keeps the window from NOT-REPRODUCED", () => {
  const execFailed: IterationOutcome = { ...cleanOutcome(), execOk: false };
  assert.equal(windowOutcome([cleanResult("a"), cleanResult("b"), cleanResult("c"), failedResult("s", execFailed)]).outcome, "OTHER-FAILURE");
});

void test("windowOutcome: a, b and c at 50 clean with no failure is NOT-REPRODUCED, and a control that stopped for a host reason does not void it", () => {
  assert.equal(windowOutcome([cleanResult("a"), cleanResult("b"), cleanResult("c")]).outcome, "NOT-REPRODUCED");
  const hostControl: VariantResult = { variant: "s", state: run("s", 20, 3, repeat(4, cleanOutcome())).state, ended: "host" };
  assert.equal(windowOutcome([cleanResult("a"), cleanResult("b"), cleanResult("c"), hostControl]).outcome, "NOT-REPRODUCED");
});

void test("windowOutcome: anything else is VOID", () => {
  const partial = (variant: RapidVariant, count: number): VariantResult => ({ variant, state: run(variant, 50, 3, repeat(count, cleanOutcome())).state, ended: "host" });
  // A variant stopped for a host reason with fewer than 50 clean and no failure.
  assert.equal(windowOutcome([cleanResult("a"), cleanResult("b"), partial("c", 49)]).outcome, "VOID");
  // A variant that did not run at all.
  assert.equal(windowOutcome([cleanResult("a"), cleanResult("b")]).outcome, "VOID");
  assert.equal(windowOutcome([]).outcome, "VOID");
  // A target below 50 cannot give NOT-REPRODUCED, whatever the clean count reached.
  const reduced = (variant: RapidVariant): VariantResult => resultOf(variant, repeat(20, cleanOutcome()), 20);
  assert.equal(windowOutcome([cleanResult("a"), cleanResult("b"), reduced("c")]).outcome, "VOID");
  // The control alone is no window.
  assert.equal(windowOutcome([cleanResult("s")]).outcome, "VOID");
});

void test("windowOutcome: a failure beats a host stop, and the counts are kept per variant", () => {
  const execFailed: IterationOutcome = { ...cleanOutcome(), execOk: false };
  const result = failedResult("b", execFailed, 4);
  const window = windowOutcome([{ ...result, ended: "host" }]);
  assert.equal(window.outcome, "OTHER-FAILURE");
  assert.deepEqual(window.counts, [{ variant: "b", iterations: 5, clean: 4, consecutiveClean: 0, failures: 1, startFailed: 0, ended: "host" }]);
});

// ---- G. The timeline ------------------------------------------------------------------------------------------------------

void test("mergeTimeline sorts by time and keeps the order of the sources at the same millisecond", () => {
  const driver: TimelineEvent[] = [
    { source: "driver", atMs: 30, event: "journal-line" },
    { source: "driver", atMs: 10, event: "journal-line", detail: "first" },
  ];
  const daemon: TimelineEvent[] = [
    { source: "daemon", atMs: 10, event: "stopping-row" },
    { source: "daemon", atMs: 20, event: "stopped-row" },
  ];
  const merged = mergeTimeline([daemon, driver]);
  assert.deepEqual(
    merged.map((event) => `${event.source}@${String(event.atMs)}`),
    ["daemon@10", "driver@10", "daemon@20", "driver@30"],
  );
  assert.deepEqual(mergeTimeline([]), []);
  assert.deepEqual(mergeTimeline([[], []]), []);
});

void test("timelineAround keeps the events from before to after the centre, both ends included", () => {
  const events: TimelineEvent[] = [100, 150, 200, 250, 300, 350].map((atMs) => ({ source: "x", atMs, event: "journal-line" }));
  assert.deepEqual(
    timelineAround(events, 250, 50, 50).map((event) => event.atMs),
    [200, 250, 300],
  );
  assert.deepEqual(timelineAround(events, 250, 0, 0).map((event) => event.atMs), [250]);
  assert.deepEqual(timelineAround(events, 1000, 10, 10), []);
});

void test("supervisorLifespans gives each pid its first and last sighting, in pid order", () => {
  const spans = supervisorLifespans([
    { atMs: 100, pids: [30, 10] },
    { atMs: 200, pids: [10] },
    { atMs: 300, pids: [10, 20] },
    { atMs: 400, pids: [] },
  ]);
  assert.deepEqual(spans, [
    { pid: 10, firstMs: 100, lastMs: 300 },
    { pid: 20, firstMs: 300, lastMs: 300 },
    { pid: 30, firstMs: 100, lastMs: 100 },
  ]);
  assert.deepEqual(supervisorLifespans([]), []);
});

void test("supervisorLifespans does not depend on the order of the samples", () => {
  const spans = supervisorLifespans([
    { atMs: 300, pids: [10] },
    { atMs: 100, pids: [10] },
  ]);
  assert.deepEqual(spans, [{ pid: 10, firstMs: 100, lastMs: 300 }]);
});

void test("lateSupervisors names the pids still seen after the daemon's exit and after the next up started", () => {
  const spans = [
    { pid: 10, firstMs: 100, lastMs: 500 },
    { pid: 20, firstMs: 100, lastMs: 1500 },
    { pid: 30, firstMs: 100, lastMs: 900 },
    { pid: 40, firstMs: 1200, lastMs: 2000 },
  ];
  assert.deepEqual(lateSupervisors(spans, 1000, 1100), { afterDaemonExit: [20], afterNextUpStart: [20] });
  assert.deepEqual(lateSupervisors(spans, 400, 1000), { afterDaemonExit: [10, 20, 30], afterNextUpStart: [20] });
  assert.deepEqual(lateSupervisors([], 1, 2), { afterDaemonExit: [], afterNextUpStart: [] });
  assert.deepEqual(lateSupervisors(spans, 5000, 5000), { afterDaemonExit: [], afterNextUpStart: [] });
});

void test("lateSupervisors does not count a supervisor first seen after the daemon's exit: it belongs to the new sandbox", () => {
  const spans = [{ pid: 40, firstMs: 1200, lastMs: 2000 }];
  assert.deepEqual(lateSupervisors(spans, 1000, 1100), { afterDaemonExit: [], afterNextUpStart: [] });
  assert.deepEqual(lateSupervisors([{ pid: 41, firstMs: 1000, lastMs: 2000 }], 1000, 1100), { afterDaemonExit: [41], afterNextUpStart: [41] });
});

void test("pidsOfListing reads the leading pid of each line and ignores any other line", () => {
  assert.deepEqual(pidsOfListing(" 1234 Thu Nov 19 10:00:00 2026 supervisor\n5678 Thu Nov 19 10:00:01 2026 supervisor\n"), [1234, 5678]);
  assert.deepEqual(pidsOfListing("42"), [42]);
  assert.deepEqual(pidsOfListing("\nnot a pid\n0 zero\n-7 negative\n"), []);
  assert.deepEqual(pidsOfListing(""), []);
});

// ---- G2. The startup rows -------------------------------------------------------------------------------------------------

function startupLine(offsetMs: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ event: "daemon.startup", ts: new Date(SIGNAL + offsetMs).toISOString(), ...extra });
}

void test("startupRowsOf reads the daemon.startup rows with their time and the removed-container count", () => {
  const text = [
    "not json",
    startupLine(-3000, { containersRemoved: 0 }),
    JSON.stringify({ event: "daemon.stopping", ts: new Date(SIGNAL).toISOString() }),
    startupLine(500, { containersRemoved: 2 }),
    startupLine(900, {}),
    JSON.stringify({ event: "daemon.startup", ts: "not a date" }),
    JSON.stringify([1, 2]),
    "",
  ].join("\n");
  assert.deepEqual(startupRowsOf(text), [
    { atMs: SIGNAL - 3000, containersRemoved: 0 },
    { atMs: SIGNAL + 500, containersRemoved: 2 },
    { atMs: SIGNAL + 900, containersRemoved: null },
  ]);
  assert.deepEqual(startupRowsOf(""), []);
});

void test("startupSeenAt: true only when a startup row was written at or before the signal (OBS-C)", () => {
  const rows = startupRowsOf([startupLine(-100, { containersRemoved: 0 }), startupLine(200, { containersRemoved: 1 })].join("\n"));
  assert.equal(startupSeenAt(rows, SIGNAL), true);
  assert.equal(startupSeenAt(rows, SIGNAL - 100), true);
  assert.equal(startupSeenAt(rows, SIGNAL - 101), false);
  assert.equal(startupSeenAt([], SIGNAL), false);
});

void test("reapRemovedAfter: the removed-container count of the first startup row after the given time, or null", () => {
  const rows = startupRowsOf([startupLine(-100, { containersRemoved: 0 }), startupLine(200, { containersRemoved: 2 }), startupLine(900, { containersRemoved: 5 })].join("\n"));
  assert.equal(reapRemovedAfter(rows, SIGNAL), 2);
  assert.equal(reapRemovedAfter(rows, SIGNAL - 1000), 0);
  assert.equal(reapRemovedAfter(rows, SIGNAL + 900), null);
  assert.equal(reapRemovedAfter(startupRowsOf(startupLine(200, {})), SIGNAL), null);
  assert.equal(reapRemovedAfter([], SIGNAL), null);
});

// ---- H. Evidence lines ----------------------------------------------------------------------------------------------------

void test("evidenceLine renders numbers, booleans, null and closed names, in the order given", () => {
  assert.equal(
    evidenceLine({ variant: "a", iteration: 7, stopMs: 1234, notice: true, startupSeen: false, code: null, kinds: "start-failed+dirty-stop", up: "start-failed" }),
    "variant=a iteration=7 stopMs=1234 notice=yes startupSeen=no code=none kinds=start-failed+dirty-stop up=start-failed",
  );
  assert.equal(evidenceLine({}), "");
});

void test("evidenceLine refuses a path, a colon, a slash, a backslash and an id", () => {
  const bad = [
    "/etc/passwd",
    "a/b",
    "a\\b",
    "C:\\x",
    "host:/path",
    "key: value",
    "has space",
    "1abc",
    "",
    "a".repeat(64),
    "0123456789abcdef".repeat(4),
    "abcdef012345",
    "ID.0123456789ab",
  ];
  for (const value of bad) {
    assert.throws(() => evidenceLine({ detail: value }), RangeError, JSON.stringify(value));
  }
});

void test("evidenceLine refuses a key that is not a plain word and a number that is not finite", () => {
  assert.throws(() => evidenceLine({ "bad key": 1 }), RangeError);
  assert.throws(() => evidenceLine({ "a/b": 1 }), RangeError);
  assert.throws(() => evidenceLine({ n: Number.NaN }), RangeError);
  assert.throws(() => evidenceLine({ n: Number.POSITIVE_INFINITY }), RangeError);
});

function record(overrides: Partial<IterationRecord> = {}): IterationRecord {
  return {
    variant: "a",
    chain: 1,
    iteration: 4,
    up: UP_OK,
    interruptedUp: undefined,
    down: undefined,
    active: true,
    execOk: true,
    stop: { kind: "clean" },
    stopMs: 812,
    gapToUpMs: 40,
    upMs: 9100,
    containersRemoved: null,
    startupSeen: null,
    lateAfterExit: 0,
    lateAfterNextUp: 0,
    loadBefore: 0.25,
    loadAfter: 0.5,
    kinds: [],
    ...overrides,
  };
}

void test("iterationEvidenceLine: a clean iteration is one closed-phrase line", () => {
  assert.equal(
    iterationEvidenceLine(record()),
    "variant=a chain=1 iteration=4 result=clean kinds=none up=ok upCode=none upCause=none interruptedUp=none down=none downCode=none active=yes execOk=yes stop=clean failedTeardowns=none stopCode=none stoppingSeen=none startupSeen=none notice=no containersRemoved=none stopMs=812 gapToUpMs=40 upMs=9100 lateAfterExit=0 lateAfterNextUp=0 loadBefore=0.25 loadAfter=0.5",
  );
});

void test("iterationEvidenceLine: a start-failed iteration under variant c keeps the cause, the notice, the startup state and the interrupted up", () => {
  const line = iterationEvidenceLine(
    record({
      variant: "c",
      up: { kind: "start-failed", causeCode: "SANDBOX_NAME_IN_USE", notice: true },
      interruptedUp: { kind: "other-failure", code: "REALM_STOPPING", notice: false },
      active: false,
      execOk: false,
      stop: { kind: "row-absent", stoppingSeen: false, startupSeen: false },
      containersRemoved: 1,
      startupSeen: false,
      lateAfterExit: 1,
      lateAfterNextUp: 1,
      kinds: ["start-failed", "row-absent"],
    }),
  );
  assert.match(line, /result=failed kinds=start-failed\+row-absent up=start-failed upCode=none upCause=SANDBOX_NAME_IN_USE interruptedUp=other-failure/);
  assert.match(line, /stop=row-absent failedTeardowns=none stopCode=none stoppingSeen=no startupSeen=no notice=yes containersRemoved=1/);
  assert.match(line, /lateAfterExit=1 lateAfterNextUp=1/);
});

void test("iterationEvidenceLine: a dirty stop keeps the failed-teardown count and the code, and an other-failure up its code", () => {
  const line = iterationEvidenceLine(
    record({
      up: { kind: "other-failure", code: "REALM_STOPPING", notice: false },
      active: false,
      execOk: false,
      stop: { kind: "dirty", failedTeardowns: 2, code: "unlisted", stoppingSeen: true },
      kinds: ["other-failure", "dirty-stop"],
    }),
  );
  assert.match(line, /up=other-failure upCode=REALM_STOPPING upCause=none/);
  assert.match(line, /stop=dirty failedTeardowns=2 stopCode=unlisted stoppingSeen=yes startupSeen=none/);
});

void test("iterationEvidenceLine: startupSeen is recorded for every stop that observes it, a clean one included", () => {
  assert.match(iterationEvidenceLine(record({ variant: "c", startupSeen: true })), /stop=clean failedTeardowns=none stopCode=none stoppingSeen=none startupSeen=yes/);
  assert.match(iterationEvidenceLine(record({ variant: "c", startupSeen: false })), /stop=clean .* startupSeen=no /);
});

void test("iterationEvidenceLine: a failing realm down after a variant c iteration keeps its code", () => {
  const line = iterationEvidenceLine(
    record({ variant: "c", down: { kind: "other-failure", code: "AGENTOS_STOP_FAILED", notice: false }, kinds: ["down-failed"] }),
  );
  assert.match(line, /result=failed kinds=down-failed .* down=other-failure downCode=AGENTOS_STOP_FAILED active=yes/);
});

void test("iterationEvidenceLine: unobserved figures are none, never a number", () => {
  const line = iterationEvidenceLine(record({ stopMs: null, gapToUpMs: null, upMs: null, lateAfterExit: null, lateAfterNextUp: null, loadBefore: null, loadAfter: null }));
  assert.match(line, /stopMs=none gapToUpMs=none upMs=none lateAfterExit=none lateAfterNextUp=none loadBefore=none loadAfter=none$/);
});

void test("summaryOf renders the outcome word and the counts per variant", () => {
  const window = windowOutcome([cleanResult("a"), cleanResult("b"), failedResult("c", { ...cleanOutcome(), execOk: false }, 7)]);
  assert.equal(
    summaryOf(window),
    [
      "outcome=OTHER-FAILURE",
      "variant=a iterations=50 clean=50 consecutiveClean=50 failures=0 startFailed=0 ended=target",
      "variant=b iterations=50 clean=50 consecutiveClean=50 failures=0 startFailed=0 ended=target",
      "variant=c iterations=8 clean=7 consecutiveClean=0 failures=1 startFailed=0 ended=host",
      "",
    ].join("\n"),
  );
});

void test("summaryOf renders every outcome word", () => {
  for (const outcome of ["REPRODUCED", "OTHER-FAILURE", "NOT-REPRODUCED", "VOID"] as const) {
    assert.equal(summaryOf({ outcome, counts: [] }), `outcome=${outcome}\n`);
  }
});
