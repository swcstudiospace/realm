# Plan 49-01: Omp calibration repeat

**Phase:** 49-omp-calibration-repeat · **Requirements:** OMPV-04 (carries OMPR-01, OMPR-06, OI-11) · **Wave:** 1–3, serial (one live window; shared live lock).

**Files:** `test/support/omp-window-analysis.ts`, `test/support/omp-window-analysis.test.ts` (or the owning hermetic test), `test/support/omp-calibration.ts`, `test/support/omp-calibration.test.ts`, `test/support/omp-verdict.ts`, `test/integration/omp-responsiveness.test.ts` (read-only; gated), `docs/integration/omp.md`, `.planning/phases/49-omp-calibration-repeat/49-CALIBRATION.md`, `49-MEASUREMENT.md`, `49-RESOLUTION.md`.

## Steps

1. **Re-state feasibility (read-only).** Re-read `45-FEASIBILITY.md` and re-run the per-primitive probes (delegated cgroup/scope, `cpuset`, `cpu.pressure`, `taskset`, `/proc/PID/schedstat`, system pressure) as the window account; record what this host allows in `49-CALIBRATION.md`. Isolation envelope as Phase 45 (per-run scope); if a primitive regressed, the design falls back to run-queue attribution and says so.
2. **Bracket-arithmetic fix, red first.** Add hermetic cases to `omp-window-analysis.test.ts` that reproduce the "inconsistent readings" failure of `attributeInterval` (sleep residual below −5 ms on a bracketed interval; mixed busy/wait/sleep intervals; intervals whose bracket is too far). Show them failing on the current tree. Fix `attributeInterval` in `omp-window-analysis.ts` only (clamp only ≤5 ms rounding; larger negative residual stays an error, never silently clamped). No other harness file changes.
3. **Recalibration and freeze.** Run the calibration of the no-extension control on this host (recorded runs only): derive the four constants, set `CALIBRATED_BOUNDS` in `test/support/omp-calibration.ts` with `CALIBRATION_FREEZE` (date + digest) before any verdict run. Fewer than 5 passing controls → phase ends VOID (calibration); bounds stay null, pinned by `omp-calibration.test.ts`. No constant changes after a verdict.
4. **Live verdict window (BLOCKING, human).** Under the frozen design and bounds, run `test/integration/omp-responsiveness.test.ts` on the production stack: alternating control/cold order, scoped-contention validity V0–V5, per-interval attribution. Evidence outside the repository. Outcome is exactly one of PASS, FINDING (named cause), NOT-REPRODUCED, VOID by `decideVerdict` (`test/support/omp-verdict.ts`), unchanged.
5. **Record and resolve.** Write `49-MEASUREMENT.md` (tier-labelled numbers, host facts, commit, Omp version, isolation, residue zero) and `49-RESOLUTION.md`: OMPV-04 met on the frozen bound or carried with a stated tested reason; OMPR-01/06 and OI-11 close only on PASS/FINDING with the valid pairs the rule needs, never on VOID or the probe alone. Update `docs/integration/omp.md` to match.

## Checks

- `npm run build && node --test dist/test/support/omp-window-analysis.test.js dist/test/support/omp-calibration.test.js dist/test/support/omp-verdict.test.js` (hermetic, no Omp/Podman).
- Red-first proof: the new bracket cases fail on the pre-fix tree (recorded in the summary).
- Live window: exactly one decision-table outcome; residue zero (scopes, Omp processes, containers, daemons); no host-local path in committed files; secret search clean.
