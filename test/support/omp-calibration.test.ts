// The hermetic test of test/support/omp-calibration.ts (Phase 45, OMPV-04; 45-CONTEXT D-45-06 and D-45-08): the four calibrated constants
// were frozen by Phase 49 (Step 3) from 16 recorded scoped no-extension controls (all 16 mechanically valid and passing, digest below).
// The test pins the frozen values, the freeze date and digest, and the fact that decideVerdict now reads the frozen bounds. Pure: no
// process, no clock, no file, no host.

import assert from "node:assert/strict";
import { test } from "node:test";
import { CALIBRATED_BOUNDS, CALIBRATION_FREEZE } from "./omp-calibration.js";
import { type StallSet, type WindowObservation } from "./omp-contention.js";
import { type Bounds, decideVerdict, deriveBounds, runIndexOf, type RunObservation, TIER_SCOPED } from "./omp-verdict.js";
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

void test("OMPV-04 the four calibrated constants are frozen by Phase 49 from the recorded 2026-11-19 calibration", () => {
  assert.deepEqual(CALIBRATED_BOUNDS, {
    stallShareMax: 0.008853242320819113,
    runqShareMax: 0.00547431048269137,
    controlSelfMaxMs: 1000,
    controlSelfP95Ms: 500,
  });
  assert.deepEqual(CALIBRATION_FREEZE, { date: "2026-11-19", digest: "af0adf3076cc4df0613da6a448569e0e95011faec07d8a871a285266eeac247d" });
});

void test("OMPV-04 with the frozen bounds decideVerdict reads them: the PASS-shaped runs breach the frozen contention maxima, so the window is VOID for invalidity, not for being uncalibrated", () => {
  const verdict = decideVerdict(passShapedRuns(), CALIBRATED_BOUNDS);
  assert.equal(verdict.outcome, "VOID");
  assert.match(verdict.reason, /^0 valid runs/);
  assert.equal(verdict.quietClaim, false);
  // The same five runs are a PASS under any bounds that admit them: the refusal is the frozen maxima, not the runs.
  const admitting: Bounds = { stallShareMax: 0.5, runqShareMax: 0.5, controlSelfMaxMs: 1000, controlSelfP95Ms: 500 };
  assert.equal(decideVerdict(passShapedRuns(), admitting).outcome, "PASS");
});

void test("OMPV-04 the frozen bounds are four numbers, the stall share a number under the scoped tier", () => {
  const bounds: Bounds | null = CALIBRATED_BOUNDS;
  if (bounds !== null) {
    assert.equal(typeof bounds.runqShareMax, "number");
    assert.equal(typeof bounds.controlSelfMaxMs, "number");
    assert.equal(typeof bounds.controlSelfP95Ms, "number");
    assert.equal(typeof bounds.stallShareMax, "number");
  }
});

void test("OMPV-04 deriveBounds on zero valid controls (the recorded 2026-11-19 phase-45 calibration: three attempts, all refused V0) is underivable, and the Phase 49 freeze stands", () => {
  const derivation = deriveBounds([]);
  if (derivation.derivable) {
    assert.fail("deriveBounds over zero valid controls must be underivable");
  }
  assert.match(derivation.reason, /^0 of 0 calibration controls met the thresholds, fewer than 5$/);
  assert.notEqual(CALIBRATED_BOUNDS, null);
  assert.notEqual(CALIBRATION_FREEZE, null);
});
