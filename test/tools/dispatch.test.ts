import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import type { ErrorCode } from "../../src/core/errors.js";
import type { State } from "../../src/core/states.js";
import { createEventBus } from "../../src/core/events.js";
import { gateMutation } from "../../src/lifecycle/mutation-gate.js";
import { type DispatcherController, ToolDispatcher, type ToolOutcome } from "../../src/tools/dispatch.js";
import {
  ADVISORY,
  REQUIRED,
  SESSION,
  WORKLOAD,
  makeHarness,
  refusal,
  type Harness,
} from "../support/fake-tools.js";

// TOOL-03 six-stage pipeline proof (D-88, D-89). Every test drives the real
// ToolDispatcher over a real workspace, real locks, and the real audit log.
// The only fake is the OpenShell runner, which starts no process. Refusals
// are compared with the refusal() helper, so the retryable flag is always the
// catalogue value for the code.

function stagesOf(h: Harness): string[] {
  return h.observations.map((observation) => observation.stage);
}

function expectDone(outcome: ToolOutcome, tool: string): void {
  assert.equal(outcome.outcome, "done");
  if (outcome.tool !== tool) {
    assert.fail(`expected a done ${tool}`);
  }
}

void test("TOOL-03: an exec runs schema, state, admission, execution, and result in order (D-89)", async (t) => {
  const h = makeHarness(t);
  const outcome = await h.dispatcher.call({ exec: { argv: [...WORKLOAD] } });
  assert.deepEqual(outcome, {
    outcome: "done",
    tool: "exec",
    value: { exitCode: 0, stdout: "", stderr: "", truncated: false },
  });
  assert.deepEqual(stagesOf(h), ["snapshot", "runner"]);
  assert.deepEqual(h.observations[0]?.phases, [], "the state check reads no audit line");
  assert.deepEqual(h.observations[1]?.phases, ["admission"], "admission is written before execution");
  assert.deepEqual(h.phases(), ["admission", "result"]);
  assert.equal(h.runs.length, 1);
});

void test("TOOL-03: a write runs schema, state, lock, admission, execution, and result in order (D-89)", async (t) => {
  const h = makeHarness(t);
  const outcome = await h.dispatcher.call({ write: { path: "doc.txt", content: "updated" } });
  expectDone(outcome, "write");
  assert.deepEqual(stagesOf(h).slice(0, 3), ["snapshot", "gate", "lock"]);
  assert.ok(
    stagesOf(h).every((stage) => stage === "snapshot" || stage === "gate" || stage === "lock"),
    "a write reaches no other stage",
  );
  const locks = h.observations.filter((observation) => observation.stage === "lock");
  assert.ok(locks.length >= 1, "the lock stage probes the path lock");
  assert.deepEqual(locks[0]?.phases, [], "the pre-check runs before admission");
  assert.ok(
    locks.some((observation) => observation.phases.includes("admission")),
    "the authoritative acquire runs after admission",
  );
  assert.deepEqual(h.phases(), ["admission", "result"]);
  assert.equal(h.doc(), "updated");
});

void test("TOOL-03: read, list, and status run with no gate and no lock probe, between admission and result lines (D-89)", async (t) => {
  const h = makeHarness(t);
  const read = await h.dispatcher.call({ read: { path: "doc.txt", maxBytes: 1024 } });
  expectDone(read, "read");
  const list = await h.dispatcher.call({ list: { path: ".", depth: 1 } });
  expectDone(list, "list");
  const status = await h.dispatcher.call({ status: {} });
  expectDone(status, "status");
  if (status.outcome !== "done" || status.tool !== "status") {
    assert.fail("expected a done status");
  }
  assert.equal(status.value.snapshot.state, "active");
  assert.equal(status.value.display.degraded, false);
  assert.deepEqual(stagesOf(h), ["snapshot"], "only status reads the state");
  assert.deepEqual(h.phases(), ["admission", "result", "admission", "result", "admission", "result"]);
});

void test("TOOL-03: a retry in error recreates from the bound root between admission and result (D-95)", async (t) => {
  const h = makeHarness(t, { state: "error" });
  const outcome = await h.dispatcher.call({ retry: {} });
  expectDone(outcome, "retry");
  assert.deepEqual(stagesOf(h), ["snapshot", "snapshot", "create"], "the pre-check and the decision point each read the state");
  assert.deepEqual(h.observations[1]?.phases, ["admission"], "the decision point reads inside the admitted window");
  assert.deepEqual(h.creates, [h.root.realPath]);
  assert.deepEqual(h.phases(), ["admission", "result"]);
});

void test("TOOL-03: a schema failure has zero side effects and reaches no later stage (D-89)", async (t) => {
  const h = makeHarness(t);
  const outcome = await h.dispatcher.call({ nope: true });
  assert.deepEqual(outcome, refusal(null, "SCHEMA_INVALID", false));
  assert.deepEqual(h.observations, [], "schema runs before the state check");
  assert.deepEqual(h.phases(), []);
  assert.equal(h.runs.length, 0);
  assert.deepEqual(h.creates, []);
  assert.equal(h.doc(), "original");
});

void test("TOOL-03: SHELL_NOT_ALLOWED precedes the state check (D-89)", async (t) => {
  const h = makeHarness(t, { state: "degraded" });
  const outcome = await h.dispatcher.call({ exec: { shell: true, script: "echo hi" } });
  assert.deepEqual(outcome, refusal("exec", "SHELL_NOT_ALLOWED", false));
  assert.deepEqual(h.observations, [], "the shell form never reaches the state check");
  assert.deepEqual(h.phases(), []);
  assert.equal(h.runs.length, 0);
});

void test("TOOL-03: a malformed argv is refused before any admission line (D-89)", async (t) => {
  const h = makeHarness(t);
  const outcome = await h.dispatcher.call({ exec: { argv: [""] } });
  assert.deepEqual(outcome, refusal("exec", "SCHEMA_INVALID", false));
  assert.deepEqual(h.phases(), []);
  assert.equal(h.runs.length, 0);
});

void test("TOOL-03: an admission failure runs no execution (D-89, S-21)", async (t) => {
  const h = makeHarness(t, { stateDir: (base) => join(base, "ws", "doc.txt") });
  const outcome = await h.dispatcher.call({ exec: { argv: [...WORKLOAD] } });
  assert.deepEqual(outcome, refusal("exec", "AUDIT_WRITE_FAILED", true));
  assert.equal(h.runs.length, 0, "the runner never ran");
  assert.equal(h.doc(), "original");
});

void test("TOOL-03: exec is refused unless active, in both modes (D-89, D-109)", async (t) => {
  const cases: ReadonlyArray<{ readonly state: State; readonly code: ErrorCode; readonly retryable: boolean }> = [
    { state: "unbound", code: "REALM_UNBOUND", retryable: false },
    { state: "degraded", code: "REALM_NOT_ACTIVE", retryable: true },
    { state: "error", code: "REALM_NOT_ACTIVE", retryable: true },
    { state: "stopping", code: "REALM_STOPPING", retryable: false },
  ];
  for (const policy of [ADVISORY, REQUIRED]) {
    for (const kase of cases) {
      const h = makeHarness(t, { state: kase.state, policy });
      const outcome = await h.dispatcher.call({ exec: { argv: [...WORKLOAD] } });
      assert.deepEqual(outcome, refusal("exec", kase.code, kase.retryable), `${kase.state} in ${policy.mode}`);
      assert.equal(h.runs.length, 0, "no execution outside active");
      assert.deepEqual(h.phases(), [], "no audit line for a refused call");
    }
  }
});

void test("TOOL-03: a write in degraded under advisory policy proceeds with a warning (D-98)", async (t) => {
  const h = makeHarness(t, { state: "degraded" });
  const outcome = await h.dispatcher.call({ write: { path: "doc.txt", content: "advisory" } });
  expectDone(outcome, "write");
  if (outcome.outcome !== "done" || outcome.tool !== "write") {
    assert.fail("expected a done write");
  }
  assert.equal(typeof outcome.value.warning, "string");
  assert.equal(h.doc(), "advisory");
  assert.deepEqual(h.phases(), ["admission", "result"]);
});

void test("TOOL-03: a write in degraded under required policy is refused with no audit line (D-98)", async (t) => {
  const h = makeHarness(t, { state: "degraded", policy: REQUIRED });
  const outcome = await h.dispatcher.call({ write: { path: "doc.txt", content: "blocked" } });
  assert.deepEqual(outcome, refusal("write", "REALM_NOT_ACTIVE", true));
  assert.equal(h.doc(), "original");
  assert.deepEqual(h.phases(), [], "the gate refuses before admission");
});

void test("TOOL-03: retry follows the state, returning the snapshot except from error, unbound, and stopping (D-95)", async (t) => {
  for (const state of ["connecting", "active", "degraded"] as const) {
    const h = makeHarness(t, { state });
    const outcome = await h.dispatcher.call({ retry: {} });
    expectDone(outcome, "retry");
    if (outcome.outcome !== "done" || outcome.tool !== "retry") {
      assert.fail(`expected a done retry in ${state}`);
    }
    assert.equal(outcome.value.state, state);
    assert.deepEqual(h.creates, [], `no create in ${state}`);
  }
  const unbound = makeHarness(t, { state: "unbound" });
  assert.deepEqual(await unbound.dispatcher.call({ retry: {} }), refusal("retry", "REALM_UNBOUND", false));
  assert.deepEqual(unbound.phases(), []);
  const stopping = makeHarness(t, { state: "stopping" });
  assert.deepEqual(await stopping.dispatcher.call({ retry: {} }), refusal("retry", "REALM_STOPPING", false));
  assert.deepEqual(stopping.phases(), []);
});

void test("TOOL-03: the dispatcher consults the shared lock table, so a path another owner holds is LOCK_CONFLICT (D-96)", async (t) => {
  const h = makeHarness(t);
  const target = join(h.root.realPath, "doc.txt");
  const handle = h.locks.acquire(target, "other-owner");
  try {
    const outcome = await h.dispatcher.call({ write: { path: "doc.txt", content: "blocked" } });
    assert.deepEqual(outcome, refusal("write", "LOCK_CONFLICT", true));
    assert.equal(h.doc(), "original");
    assert.deepEqual(h.phases(), [], "the lock probe refuses before admission");
  } finally {
    h.locks.release(handle);
  }
  const retry = await h.dispatcher.call({ write: { path: "doc.txt", content: "after release" } });
  assert.equal(retry.outcome, "done");
  assert.equal(h.doc(), "after release");
});

// Builds a dispatcher over the harness's real machine, lock table, and bound root. Its first state read is
// the retry pre-check. The machine then takes the given transitions, so the state moves between the
// pre-check and the audited decision point. The creates it runs are recorded.
function dispatcherMovingAfterPrecheck(
  h: Harness,
  moves: readonly State[],
): { readonly dispatcher: ToolDispatcher; readonly creates: string[] } {
  const creates: string[] = [];
  let reads = 0;
  const controller: DispatcherController = {
    events: createEventBus(),
    snapshot: () => {
      reads += 1;
      const snapshot = h.machine.snapshot();
      if (reads === 1) {
        for (const next of moves) {
          h.machine.transition(next, "moved after the pre-check");
        }
      }
      return snapshot;
    },
    mutationGate: () => gateMutation(ADVISORY, h.machine.snapshot().state, true),
    bridgeAttached: () => true,
    create: (workspaceRoot) => {
      creates.push(workspaceRoot);
      return Promise.resolve(h.machine.snapshot());
    },
  };
  const dispatcher = new ToolDispatcher({
    sessionId: SESSION,
    boundRoot: h.root,
    policy: ADVISORY,
    controller,
    locks: h.locks,
    stateDir: h.stateDir,
    runOpenShell: () => Promise.reject(new Error("retry never runs the runner")),
  });
  return { dispatcher, creates };
}

void test("TOOL-03: an unrecognized tool name is refused with SCHEMA_INVALID before any stage, with no create and no audit line (D-89, H-03)", async (t) => {
  for (const call of [{ create: {} }, { delete: {} }, { RETRY: {} }]) {
    const h = makeHarness(t, { state: "error" });
    const outcome = await h.dispatcher.call(call);
    assert.deepEqual(outcome, refusal(null, "SCHEMA_INVALID", false));
    assert.deepEqual(h.observations, [], "no stage runs");
    assert.equal(h.auditText(), "", "no audit line is written");
    assert.deepEqual(h.creates, [], "no create runs, even in error");
    assert.equal(h.runs.length, 0, "the runner never runs");
    assert.equal(h.doc(), "original");
  }
});

void test("TOOL-03: retry decides on the state current at its decision point, not the pre-check read (D-95, M-01)", async (t) => {
  const cases: ReadonlyArray<{
    readonly start: State;
    readonly moves: readonly State[];
    readonly end: State;
    readonly recreates: boolean;
  }> = [
    { start: "error", moves: ["connecting", "active"], end: "active", recreates: false },
    { start: "active", moves: ["error"], end: "error", recreates: true },
  ];
  for (const kase of cases) {
    const h = makeHarness(t, { state: kase.start });
    const { dispatcher, creates } = dispatcherMovingAfterPrecheck(h, kase.moves);
    const outcome = await dispatcher.call({ retry: {} });
    if (outcome.outcome !== "done" || outcome.tool !== "retry") {
      assert.fail(`expected a done retry from ${kase.start}`);
    }
    assert.equal(outcome.value.state, kase.end, `${kase.start} then ${kase.end}: the reported state`);
    assert.deepEqual(
      creates,
      kase.recreates ? [h.root.realPath] : [],
      `${kase.start} then ${kase.end}: create runs only when the decision-point state is error`,
    );
    assert.deepEqual(h.phases(), ["admission", "result"]);
  }
});
