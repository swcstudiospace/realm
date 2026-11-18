// The always-running hermetic test of the cold attach judge (33-03 Task 2; COLD-02, COLD-04): a passing timeline, and one violated rule per
// row. No process, no Podman, no network.

import assert from "node:assert/strict";
import { test } from "node:test";
import { HANDSHAKE_BOUND_MS, judgeColdTimeline, type ColdRefusal, type ColdTimeline } from "../support/cold-attach-probe.js";

const refusal = (overrides: Partial<ColdRefusal> = {}): ColdRefusal => ({ tool: "status", atMs: 1_500, code: "REALM_NOT_ACTIVE", retryable: true, isError: true, ...overrides });

const passing = (overrides: Partial<ColdTimeline> = {}): ColdTimeline => ({
  replyMs: { discover: 900, initialize: 910, toolsList: 930 },
  statusAtReply: "starting",
  refusals: [refusal(), refusal({ tool: "exec", atMs: 1_700 }), refusal({ atMs: 5_000 })],
  firstSuccessMs: 52_000,
  polls: 24,
  childExited: false,
  elapsedMs: 52_000,
  ...overrides,
});

function rejected(timeline: ColdTimeline): { readonly rule: string; readonly message: string } {
  const verdict = judgeColdTimeline(timeline);
  assert.ok(!verdict.pass, "the timeline must fail");
  return verdict;
}

void test("a cold timeline passes and lists the facts it established", () => {
  const verdict = judgeColdTimeline(passing());
  assert.ok(verdict.pass, "the passing timeline passes");
  assert.equal(verdict.facts.length, 4);
  assert.match(verdict.facts.join("\n"), /handshake replies at 900, 910 and 930 ms/);
  assert.match(verdict.facts.join("\n"), /first success at 52000 ms after 24 status polls/);
});

void test("a status that reported nothing at reply time is still a cold run", () => {
  assert.equal(judgeColdTimeline(passing({ statusAtReply: undefined })).pass, true);
});

void test("a late handshake reply fails the handshake-bound rule, and a missing one does too", () => {
  const late = rejected(passing({ replyMs: { discover: 900, initialize: HANDSHAKE_BOUND_MS + 1, toolsList: 930 } }));
  assert.equal(late.rule, "handshake-bound");
  assert.match(late.message, /handshake-bound/);
  assert.match(late.message, /initialize/);
  const atBound = judgeColdTimeline(passing({ replyMs: { discover: 900, initialize: HANDSHAKE_BOUND_MS, toolsList: 930 } }));
  assert.equal(atBound.pass, true, "a reply exactly at the bound is inside it");
  const missing = rejected(passing({ replyMs: { discover: 900, initialize: 910, toolsList: undefined } }));
  assert.equal(missing.rule, "handshake-bound");
  assert.match(missing.message, /tools\/list reply never arrived/);
});

void test("an active status at reply time fails the cold-start rule", () => {
  const verdict = rejected(passing({ statusAtReply: "active" }));
  assert.equal(verdict.rule, "cold-start");
  assert.match(verdict.message, /cold-start/);
  assert.match(verdict.message, /not cold/);
});

void test("no refusal at all fails the refusal-in-window rule", () => {
  const verdict = rejected(passing({ refusals: [] }));
  assert.equal(verdict.rule, "refusal-in-window");
  assert.match(verdict.message, /refusal-in-window/);
});

void test("a refusal with retryable false, another code, or no error flag fails the refusal-shape rule", () => {
  for (const bad of [refusal({ retryable: false }), refusal({ code: "POLICY_DENIED" }), refusal({ isError: false })]) {
    const verdict = rejected(passing({ refusals: [refusal(), bad] }));
    assert.equal(verdict.rule, "refusal-shape");
    assert.match(verdict.message, /refusal-shape/);
    assert.match(verdict.message, /REALM_NOT_ACTIVE with retryable true/);
  }
});

void test("a success not later than the last refusal, or no success, fails the success-after-refusal rule", () => {
  const before = rejected(passing({ firstSuccessMs: 4_000 }));
  assert.equal(before.rule, "success-after-refusal");
  assert.match(before.message, /success-after-refusal/);
  const equal = rejected(passing({ firstSuccessMs: 5_000 }));
  assert.equal(equal.rule, "success-after-refusal");
  const none = rejected(passing({ firstSuccessMs: undefined }));
  assert.equal(none.rule, "success-after-refusal");
  assert.match(none.message, /no call succeeded/);
});

void test("a child that exited fails the same-process rule", () => {
  const verdict = rejected(passing({ childExited: true }));
  assert.equal(verdict.rule, "same-process");
  assert.match(verdict.message, /same-process/);
});

void test("the first violated rule names the failure when several hold", () => {
  const verdict = rejected(passing({ replyMs: { discover: undefined, initialize: 910, toolsList: 930 }, statusAtReply: "active", childExited: true }));
  assert.equal(verdict.rule, "handshake-bound");
});
