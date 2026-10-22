import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Policy } from "../../src/contract/validate.js";
import { decideMutation } from "../../src/core/policy.js";
import { STATES, type State } from "../../src/core/states.js";
import { bindWorkspaceUnderPolicy } from "../../src/fs/root.js";
import { gateMutation, runGatedMutation } from "../../src/lifecycle/mutation-gate.js";
import { LifecycleController } from "../../src/lifecycle/controller.js";
import { SessionStore } from "../../src/session/store.js";
import { FakeBridge } from "../support/fake-bridge.js";
import { FakeExecutionService } from "../support/fake-execution.js";

const ADVISORY: Policy = {
  mode: "advisory",
  workspaceRoots: [],
  credentialAllow: [],
  egressAllow: [],
  shellEnabled: false,
  startupBudgetMs: 10000,
  toolQueueMs: 2000,
};

const FAIL_CLOSED: Policy = { ...ADVISORY, mode: "fail-closed" };

// Pinned literal table (D-23). The test does not read the table under test.
const NON_ACTIVE_CODES: Readonly<Record<Exclude<State, "active">, string>> = {
  unbound: "REALM_UNBOUND",
  connecting: "REALM_NOT_ACTIVE",
  degraded: "REALM_NOT_ACTIVE",
  error: "REALM_NOT_ACTIVE",
  stopping: "REALM_STOPPING",
};

const NON_ACTIVE_STATES = Object.keys(NON_ACTIVE_CODES) as Exclude<State, "active">[];

void test("CORE-05: active proceeds under both modes with no warning and runs the mutation", () => {
  for (const policy of [ADVISORY, FAIL_CLOSED]) {
    assert.deepEqual(gateMutation(policy, "active"), { outcome: "proceed" });
    assert.deepEqual(runGatedMutation(gateMutation(policy, "active"), () => 7), {
      outcome: "done",
      value: 7,
      warning: null,
    });
  }
});

void test("CORE-05: advisory proceeds with a warning that names every non-active state", () => {
  for (const state of NON_ACTIVE_STATES) {
    const gate = gateMutation(ADVISORY, state);
    assert.equal(gate.outcome, "proceed-with-warning", `state ${state}`);
    assert.match(gate.warning, new RegExp(state), `warning names ${state}`);
    assert.match(gate.warning, /advisory policy/, `warning states the advisory policy for ${state}`);
  }
});

void test("CORE-05: fail-closed refuses every non-active state with its exact deny code", () => {
  for (const state of NON_ACTIVE_STATES) {
    assert.deepEqual(gateMutation(FAIL_CLOSED, state), { outcome: "refused", code: NON_ACTIVE_CODES[state] }, `state ${state}`);
  }
});

void test("CORE-05: every state in both modes is decided, and the gate adds no decision logic over decideMutation", () => {
  for (const policy of [ADVISORY, FAIL_CLOSED]) {
    for (const state of STATES) {
      const decision = decideMutation(policy, state);
      const gate = gateMutation(policy, state);
      if (decision.decision === "allow") {
        assert.deepEqual(gate, { outcome: "proceed" }, `${policy.mode} ${state}`);
      } else if (decision.decision === "allow-with-warning") {
        assert.deepEqual(gate, { outcome: "proceed-with-warning", warning: decision.warning }, `${policy.mode} ${state}`);
      } else {
        assert.deepEqual(gate, { outcome: "refused", code: decision.code }, `${policy.mode} ${state}`);
      }
    }
  }
});

void test("CORE-05: runGatedMutation returns the advisory warning together with the result", () => {
  const gate = gateMutation(ADVISORY, "degraded");
  const result = runGatedMutation(gate, () => "written");
  assert.equal(result.outcome, "done");
  assert.equal(result.value, "written");
  assert.ok(result.warning !== null && /degraded/.test(result.warning));
});

void test("CORE-05: runGatedMutation never runs the mutation on a refusal and returns the deny code", () => {
  let ran = 0;
  const result = runGatedMutation(gateMutation(FAIL_CLOSED, "connecting"), () => {
    ran += 1;
    return "written";
  });
  assert.equal(ran, 0);
  assert.deepEqual(result, { outcome: "refused", code: "REALM_NOT_ACTIVE" });
});

void test("CORE-05: the gate returns synchronously, never a Promise, and schedules no timer", (t: TestContext) => {
  const timers = t.mock.method(globalThis, "setTimeout");
  for (const policy of [ADVISORY, FAIL_CLOSED]) {
    for (const state of STATES) {
      const gate = gateMutation(policy, state);
      const result = runGatedMutation(gate, () => state);
      assert.equal("then" in gate, false, `gate ${policy.mode} ${state}`);
      assert.equal("then" in result, false, `result ${policy.mode} ${state}`);
    }
  }
  assert.equal(timers.mock.callCount(), 0);
});

void test("CORE-05: the controller gate reads the current state, so a refused write never reaches the port", async (t: TestContext) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-mutation-gate-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const workspace = join(base, "workspace");
  mkdirSync(workspace);
  const exec = new FakeExecutionService();
  const bridge = new FakeBridge();
  const controller = new LifecycleController({
    sessionId: "session-gate",
    policy: { ...ADVISORY, mode: "fail-closed", workspaceRoots: [workspace] },
    pinnedRoot: bindWorkspaceUnderPolicy([workspace], workspace),
    store: new SessionStore(join(base, "state")),
    exec,
    bridge,
    clock: () => new Date("2026-10-21T09:30:00.000Z"),
  });

  assert.deepEqual(controller.mutationGate(), { outcome: "refused", code: "REALM_UNBOUND" });
  await controller.create(workspace);
  assert.deepEqual(controller.mutationGate(), { outcome: "proceed" });
  bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
  assert.deepEqual(controller.mutationGate(), { outcome: "refused", code: "REALM_NOT_ACTIVE" });
  assert.equal(exec.callCount("probe"), 0);
});
