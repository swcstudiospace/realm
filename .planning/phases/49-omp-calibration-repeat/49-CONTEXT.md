# Phase 49: Omp calibration repeat - Context

**Gathered:** 2026-11-19, from `.planning/MILESTONE-CONTEXT.md` (D-v8-2), `.planning/REQUIREMENTS.md` v8.0 (OMPV-04; carried OMPR-01, OMPR-06, OI-11), `.planning/ROADMAP.md` Phase 49, `.planning/v7.0-MILESTONE-AUDIT.md`, `.planning/phases/45-omp-responsiveness-valid-measurement/` (`45-CONTEXT.md`, `45-DESIGN.md`, `45-FEASIBILITY.md`, `45-MEASUREMENT.md`, `45-VERIFICATION.md`).
**Status:** Planned (one plan, nothing executed).

## Phase Boundary

Phase 45 built the frozen measurement design (scoped-contention validity V0–V5, per-interval stall attribution, alternating control/cold order, decision table PASS/FINDING/NOT-REPRODUCED/VOID as code) and ended VOID (calibration) twice: `CALIBRATED_BOUNDS` was never frozen. Two blockers were recorded: (a) the scope-leaf check `run-p<pid>-i<id>.scope` rejected this host's `run-<32hex>.scope` (fixed post-hoc to `run-*.scope`); (b) `attributeInterval` "inconsistent readings" in 11 of 16 re-calibration attempts, with bracket arithmetic named as a candidate, cause not established. This phase fixes (b) red-first, recalibrates on this host, freezes `CALIBRATED_BOUNDS` before any verdict run, then runs one live window. Thresholds (max 1000 ms, p95 500 ms self-inflicted), the Phase 38 constants, and the decision table are unchanged. No extension fix unless the window ends FINDING naming the extension.

**Out of scope:** new thresholds, host isolation changes beyond re-stating the Phase 45 feasibility, UI-01 status (owner's call), any catalogue change.

## Decisions

- **D-49-1 (owner D-v8-2):** fix bracket arithmetic red-first; recalibrate; freeze; rerun live window; OMPV-04 with OMPR-01/06, OI-11 close only on PASS/FINDING with the valid pairs the rule needs, never on VOID or the hermetic probe alone.
- **D-49-2:** the fix is confined to `test/support/omp-window-analysis.ts` (`attributeInterval`) and its tests; no harness edit after a verdict is seen.
- **D-49-3:** calibration requires ≥5 passing controls (Phase 45 rule); fewer ends the phase VOID (calibration) honestly.
- **D-49-4:** live evidence kept outside the repository, cited by date; every number labelled (tier, host facts, commit, Omp version, isolation).
