import { test } from "node:test";
import assert from "node:assert/strict";
import type { State } from "../../src/core/states.js";
import { displayStatus, STATUS_LABELS, type StatusSnapshot } from "../../src/core/status.js";

const AT = "2026-10-21T09:30:00.000Z";

// Pinned literal labels (D-27). The test does not derive them from the code.
const ACTIVE_LABEL = "realm active";
const DISCONNECTED_LABEL = "realm disconnected";

// [state, snapshot reason, expected label, expected display reason]
const EXPECTED: ReadonlyArray<readonly [State, string, string, string]> = [
  ["unbound", "stale reason", DISCONNECTED_LABEL, "no workspace"],
  ["connecting", "stale reason", DISCONNECTED_LABEL, "connecting"],
  ["active", "bound", ACTIVE_LABEL, "bound"],
  ["error", "PODMAN_MISSING", DISCONNECTED_LABEL, "PODMAN_MISSING"],
  ["stopping", "user stop", DISCONNECTED_LABEL, "stopping"],
];

function snapshot(state: State, reason: string): StatusSnapshot {
  return { state, reason, lastTransitionAt: AT };
}

void test("CORE-02: the two frozen label strings are pinned", () => {
  assert.equal(STATUS_LABELS.active, "realm active");
  assert.equal(STATUS_LABELS.disconnected, "realm disconnected");
});

void test("CORE-02: each of the five states maps to exactly one of the two labels with a reason and time, and no other key", () => {
  assert.equal(EXPECTED.length, 5, "every state has a row");
  for (const [state, reason, label, displayReason] of EXPECTED) {
    assert.deepEqual(
      displayStatus(snapshot(state, reason)),
      { label, reason: displayReason, lastTransitionAt: AT },
      `state ${state}`,
    );
  }
});

void test("CORE-02: a snapshot reason and transition time pass through for active and error", () => {
  const active = displayStatus({ state: "active", reason: "bound", lastTransitionAt: "2026-01-02T03:04:05.000Z" });
  assert.equal(active.reason, "bound");
  assert.equal(active.lastTransitionAt, "2026-01-02T03:04:05.000Z");
  const error = displayStatus({ state: "error", reason: "STARTUP_BUDGET_EXCEEDED", lastTransitionAt: AT });
  assert.equal(error.reason, "STARTUP_BUDGET_EXCEEDED");
  assert.equal(error.lastTransitionAt, AT);
});
