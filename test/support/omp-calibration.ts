// The single home of the four calibrated constants of the Omp responsiveness window (Phase 45, OMPV-04; 45-CONTEXT D-45-06 and D-45-08):
// the scope stall share bound, the main thread run-queue share bound, the control self-inflicted maximum bound and the control
// self-inflicted 95th percentile bound. They were FROZEN by Phase 49 (Step 3) from 16 recorded scoped no-extension controls
// (all 16 mechanically valid and passing; the digest below names that calibration). decideVerdict of test/support/omp-verdict.ts reads
// them for every run validity and the verdict. A wrong bound is a finding and a replan, never an edit after a verdict is seen.
//
// Exports: CALIBRATED_BOUNDS, CALIBRATION_FREEZE.

import type { Bounds } from "./omp-verdict.js";

// The four bounds frozen from the recorded 2026-11-19 calibration (16 of 16 controls valid and passing).
export const CALIBRATED_BOUNDS: Bounds | null = {
  stallShareMax: 0.008853242320819113,
  runqShareMax: 0.00547431048269137,
  controlSelfMaxMs: 1000,
  controlSelfP95Ms: 500,
};

// When and against which calibration the bounds were frozen: the date and the digest (analyseCalibration of
// test/support/omp-window-analysis.ts) of the 16 recorded controls.
export const CALIBRATION_FREEZE: { readonly date: string; readonly digest: string } | null = {
  date: "2026-11-19",
  digest: "af0adf3076cc4df0613da6a448569e0e95011faec07d8a871a285266eeac247d",
};

