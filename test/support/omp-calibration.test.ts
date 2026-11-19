// The hermetic test of test/support/omp-calibration.ts (Phase 45, OMPV-04; 45-CONTEXT D-45-06 and D-45-08): the four calibrated constants
// are unset until plan 45-04 freezes them, and while they are unset no verdict is possible. Plan 45-04 Task 4 is the only change allowed
// to this test, and it changes it to pin the frozen values and their derivation. Pure: no process, no clock, no file, no host.

import assert from "node:assert/strict";
import { test } from "node:test";
import { CALIBRATED_BOUNDS, CALIBRATION_FREEZE } from "./omp-calibration.js";
import { type StallSet, type WindowObservation } from "./omp-contention.js";
import { type Bounds, decideVerdict, runIndexOf, type RunObservation, TIER_SCOPED } from "./omp-verdict.js";
import { PROBE_INTERVAL_MS, type ProbeSample, summariseLatencies } from "./responsiveness.js";

const NO_STALL: StallSet = { count: 0, attributedCount: 0, onCpuMs: 0, runqMs: 0, sleepMs: 0, onCpuShare: 0, sleepShare: 0, cause: "none" };

function goodWindow(): WindowObservation {
  const samples: ProbeSample[] = Array.from({ length: 41 }, (_, index) => ({ sentAtMs: index * PROBE_INTERVAL_MS, latencyMs: 20 }));
  const summary = summariseLatencies(samples);
  return { raw: summary, self: summary, scopeStallShare: 0.01, runqShare: 0.01, coverage: 1, probeGapMaxMs: 250, stallSet: NO_STALL };
}

// Five runs that would be a PASS under any bounds that admit them.
function passShapedRuns(): RunObservation[] {
  return [1, 2, 3, 4, 5].map((pair) => ({ arm: "after", pair, runIndex: runIndexOf(pair, "after"), tier: TIER_SCOPED, refusal: null, mechanicsHeld: true, control: goodWindow(), cold: goodWindow() }));
}

void test("OMPV-04 the four calibrated constants are unset until plan 45-04 freezes them", () => {
  assert.equal(CALIBRATED_BOUNDS, null);
  assert.equal(CALIBRATION_FREEZE, null);
});

void test("OMPV-04 while the bounds are unset decideVerdict returns VOID, uncalibrated, on an otherwise PASS-shaped set of five runs", () => {
  const verdict = decideVerdict(passShapedRuns(), CALIBRATED_BOUNDS);
  assert.equal(verdict.outcome, "VOID");
  assert.match(verdict.reason, /^uncalibrated/);
  assert.equal(verdict.quietClaim, false);
  // The same five runs are a PASS under any bounds that admit them: the refusal is the unset state, not the runs.
  const admitting: Bounds = { stallShareMax: 0.5, runqShareMax: 0.5, controlSelfMaxMs: 1000, controlSelfP95Ms: 500 };
  assert.equal(decideVerdict(passShapedRuns(), admitting).outcome, "PASS");
});

void test("OMPV-04 the day the bounds are set they are four numbers, the stall share possibly null under the unscoped tier", () => {
  const bounds: Bounds | null = CALIBRATED_BOUNDS;
  if (bounds !== null) {
    assert.equal(typeof bounds.runqShareMax, "number");
    assert.equal(typeof bounds.controlSelfMaxMs, "number");
    assert.equal(typeof bounds.controlSelfP95Ms, "number");
    assert.ok(bounds.stallShareMax === null || typeof bounds.stallShareMax === "number");
  }
});
