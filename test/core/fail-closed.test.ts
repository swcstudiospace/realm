import { test } from "node:test";
import assert from "node:assert/strict";
import type { Policy } from "../../src/contract/validate.js";
import { decideMutation } from "../../src/core/policy.js";
import type { State } from "../../src/core/states.js";

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

test("CORE-03: active allows a mutation under advisory and under fail-closed", () => {
  assert.deepEqual(decideMutation(ADVISORY, "active"), { decision: "allow" });
  assert.deepEqual(decideMutation(FAIL_CLOSED, "active"), { decision: "allow" });
});

test("CORE-03: advisory allows every non-active state with a warning that names the state", () => {
  for (const state of NON_ACTIVE_STATES) {
    const decision = decideMutation(ADVISORY, state);
    assert.equal(decision.decision, "allow-with-warning", `state ${state}`);
    assert.ok(decision.decision === "allow-with-warning");
    assert.match(decision.warning, new RegExp(state), `warning names ${state}`);
    assert.match(decision.warning, /advisory policy/, `warning states the advisory policy for ${state}`);
  }
});

test("CORE-03: fail-closed denies every non-active state with its exact code", () => {
  for (const state of NON_ACTIVE_STATES) {
    assert.deepEqual(
      decideMutation(FAIL_CLOSED, state),
      { decision: "deny", code: NON_ACTIVE_CODES[state] },
      `state ${state}`,
    );
  }
});
