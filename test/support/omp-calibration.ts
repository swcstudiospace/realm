// The single home of the four calibrated constants of the Omp responsiveness window (Phase 45, OMPV-04; 45-CONTEXT D-45-06 and D-45-08):
// the scope stall share bound, the main thread run-queue share bound, the control self-inflicted maximum bound and the control
// self-inflicted 95th percentile bound. They are UNSET (null) until plan 45-04 freezes them from a recorded calibration; while they are
// unset decideVerdict of test/support/omp-verdict.ts returns VOID with the reason uncalibrated. The freeze is one change to this file and
// to test/support/omp-calibration.test.ts (the test then pins the frozen values), merged before the first verdict run and never edited
// after a verdict is seen: a wrong bound is a finding and a replan.
//
// Exports: CALIBRATED_BOUNDS, CALIBRATION_FREEZE.

import type { Bounds } from "./omp-verdict.js";

// The four bounds, or null while unset.
export const CALIBRATED_BOUNDS: Bounds | null = null;

// When and against which calibration the bounds were frozen: the date and the digest (calibrationDigest of
// test/support/omp-window-analysis.ts); null while unset.
export const CALIBRATION_FREEZE: { readonly date: string; readonly digest: string } | null = null;
