import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenShellRunnerError } from "../../src/runtime/openshell.js";
import { TOOL_CALL_TIMEOUT_MS } from "../../src/tools/dispatch.js";
import {
  ADVISORY,
  WORKLOAD,
  makeHarness,
  nextTurn,
  refusal,
} from "../support/fake-tools.js";

// TOOL-04 queue wait and timeout proof (D-91). Every test drives the real
// ToolDispatcher over a real workspace and the real audit log with a fake
// OpenShell runner, so no process is started. The never-settling runner is
// covered through the runner's timed-out rejection, which is the signal the
// kill produces; the runner's kill deadline is asserted to sit strictly inside the
// 30-second TOOL_CALL_TIMEOUT_MS outer bound, because waiting that bound out is not a unit
// behavior.

void test("TOOL-04: a timed-out runner yields TOOL_TIMEOUT and the runner received its kill deadline (D-91)", async (t) => {
  const h = makeHarness(t);
  h.setRunner(() => Promise.reject(new OpenShellRunnerError("timed-out")));
  const outcome = await h.dispatcher.call({ exec: { argv: [...WORKLOAD] } });
  assert.deepEqual(outcome, refusal("exec", "TOOL_TIMEOUT", true));
  assert.equal(h.runs.length, 1);
  const runnerDeadline = h.runs[0]?.options.timeoutMs;
  assert.ok(typeof runnerDeadline === "number" && runnerDeadline > 0, "the runner kill deadline is positive");
  assert.ok(
    typeof runnerDeadline === "number" && runnerDeadline < TOOL_CALL_TIMEOUT_MS,
    "the runner kill deadline is strictly inside the outer bound",
  );
  assert.equal(h.runs[0]?.options.captureOutput, true);
  assert.deepEqual(h.phases(), ["admission", "result"]);
  assert.equal(h.auditLines()[1]?.["outcome"], "TOOL_TIMEOUT");
});

void test("TOOL-04: a call in connecting returns REALM_NOT_ACTIVE after the default toolQueueMs of 2000 (D-91)", async (t) => {
  assert.equal(ADVISORY.toolQueueMs, 2000, "the queue bound defaults to 2000");
  const h = makeHarness(t, { state: "connecting" });
  const started = Date.now();
  const outcome = await h.dispatcher.call({ exec: { argv: [...WORKLOAD] } });
  assert.deepEqual(outcome, refusal("exec", "REALM_NOT_ACTIVE", true));
  assert.ok(Date.now() - started >= 1500, "the call waited out the queue bound");
  assert.equal(h.runs.length, 0, "no execution after expiry");
  assert.deepEqual(h.phases(), [], "no audit line for a refused call");
  assert.equal(h.listeners(), 0, "expiry removed the queue listener");
});

void test("TOOL-04: a queued call proceeds at once when active is reached during the wait (D-91)", async (t) => {
  const h = makeHarness(t, { state: "connecting", policy: { ...ADVISORY, toolQueueMs: 5000 } });
  const pending = h.dispatcher.call({ exec: { argv: [...WORKLOAD] } });
  await nextTurn();
  h.machine.transition("active", "bridge up");
  const outcome = await pending;
  assert.equal(outcome.outcome, "done");
  assert.equal(h.runs.length, 1, "execution ran after the transition");
  assert.equal(h.listeners(), 0, "settling removed the queue listener");
  assert.deepEqual(h.phases(), ["admission", "result"]);
});

void test("TOOL-04: the timer is cleared on settle and degraded never waits (D-91)", async (t) => {
  const quick = makeHarness(t, { state: "connecting", policy: { ...ADVISORY, toolQueueMs: 60 } });
  const expired = await quick.dispatcher.call({ exec: { argv: [...WORKLOAD] } });
  assert.deepEqual(expired, refusal("exec", "REALM_NOT_ACTIVE", true));
  assert.equal(quick.listeners(), 0, "expiry removed the queue listener");

  const degraded = makeHarness(t, { state: "degraded" });
  const started = Date.now();
  const outcome = await degraded.dispatcher.call({ exec: { argv: [...WORKLOAD] } });
  assert.deepEqual(outcome, refusal("exec", "REALM_NOT_ACTIVE", true));
  assert.ok(Date.now() - started < 1000, "degraded returns at once");
  assert.equal(degraded.listeners(), 0, "degraded never subscribes");
  assert.equal(degraded.runs.length, 0);
});
