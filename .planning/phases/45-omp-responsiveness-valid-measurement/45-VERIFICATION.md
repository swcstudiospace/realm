---
phase: 45-omp-responsiveness-valid-measurement
verified: 2026-11-19
verdict: passed_with_accepted_limitations
status: passed
score: "5 of 6 requirements met (OMPV-01, OMPV-02, OMPV-03, OMPV-05, OMPV-06); OMPV-04 NOT met: no baseline validity bound was frozen (CALIBRATED_BOUNDS null after two calibration windows), so no verdict window ran"
ref: "origin/main 3160320 (PRs 231, 232, 233; calibration windows 2026-11-19)"
behavior_unverified: 2
overrides_applied: 0
---

# Phase 45 Verification: Omp responsiveness, a measurement that can yield a valid verdict

Method: a read of the phase records against the requirement statements OMPV-01 to OMPV-06 and the success criteria of `45-CONTEXT.md` / `45-DESIGN.md`, on 2026-11-19, at origin/main `3160320`. The hermetic claims are read from the plan summaries and the files they name; no live step was run for this verification. The two live calibration windows are copied from `45-MEASUREMENT.md` (evidence outside the repository). Labels throughout: loaded, scoped; `quietClaim` false.

## Requirements coverage

| Req | Status | Evidence |
| --- | --- | --- |
| OMPV-01 | MET | `45-FEASIBILITY.md` (dated, per-primitive command/read, P1–P10) and `45-DESIGN.md` frozen from it before any verdict run; `45-01-SUMMARY.md` (Branch S, wrapper argv pinned by value, frozen constants table with four calibration-pending constants unset). |
| OMPV-02 | MET | `test/support/stall-probe.ts`, `test/omp/attach-stall.test.ts` (real extension attach path, scripted socket/latencies, no Omp/Podman; red-first seeded cases kept verbatim; same verdict under a CPU burner in all 40 loops). Deviations recorded: confirmed (min-of-5) rule and 100 ms bound under approved deviation; stop-rule 50 ms exceeded by 64.63 ms and reported. Per `45-RESOLUTION.md` / D-45-12 this probe alone closes none of OMPR-01, OMPR-06, OI-11. |
| OMPV-03 | MET as harness code | `test/support/omp-contention.ts`, `omp-verdict.ts`, `omp-arm-run.ts`, `omp-window-analysis.ts` (scoped pressure + schedstat validity V0–V5, per-interval attribution, thresholds 1000/500 ms unchanged, constants pinned by hermetic tests). Limitation carried: the shipped scope-leaf check `run-p<pid>-i<id>.scope` rejected this host's `run-<32hex>.scope` (first calibration 0/3, all V0); fixed post-hoc to `run-*.scope` and held live in the re-calibration (0 V0 in 16 attempts). |
| OMPV-04 | NOT MET | Alternating order is code (`controlFirst(runIndexOf(...))`). But the baseline bound was never frozen: first calibration underivable 0 of 0; re-calibration after the scope-leaf fix: 5 mechanically complete of 12 targeted (of 16 attempts), 2 passing of 5 needed, digest `04e52c28…`, `CALIBRATED_BOUNDS` / `CALIBRATION_FREEZE` stay null (pinned by `omp-calibration.test.ts`). The remaining blocker is the `attributeInterval` "inconsistent readings" mechanics failure in 11 of 16 attempts, cause not established, not edited (plan forbade post-number harness edits). Verdict window not run; paired comparison VOID (0 valid pairs). |
| OMPV-05 | MET (VOID outcome) | `45-MEASUREMENT.md` Parts 1, 1b, 2: the window ends VOID (calibration) by the frozen rule; tiers, host facts (8 CPUs, omp 19.0.0, node v24.18.0), commits and isolation recorded in the phase and `docs/integration/omp.md`; residue zero (2 scopes before/after, 0 Omp processes); secret search clean. No number is cited from an earlier phase as this phase's measurement. |
| OMPV-06 | MET (carried honestly) | `45-RESOLUTION.md`: OMPR-01, OMPR-06, OI-11 all carried per D-45-12 VOID row; owner's options (a)–(d) written, no choice made; UI-01 status untouched; 36-DISPOSITIONS.md OI-11 ledger line appended (Carried). Task 8 (conditional extension fix) did not apply — no FINDING, nothing claimed. |

## Success criteria

1. Feasibility + frozen design before any verdict run: met (OMPV-01).
2. Hermetic stall probe, red first, load-invariant verdict: met (OMPV-02).
3. Scoped-contention validity, attribution, alternating order, unchanged thresholds, code-pinned constants: met as code (OMPV-03); the frozen baseline bound was not reached (OMPV-04 not met).
4. Live window ends in one of PASS/FINDING/NOT-REPRODUCED/VOID with tier-labelled numbers: met as VOID (OMPV-05).
5. OMPR-01/06 + OI-11 read the outcome, never closed on VOID or the probe alone: met (OMPV-06).

## What is not met, and what is only inferred

- OMPV-04 is not met: no frozen bound, no verdict window, no valid pairs. OMPR-01, OMPR-06 and OI-11 stay carried.
- The "inconsistent readings" mechanics failure (11/16) is not root-caused; `attributeInterval` bracket arithmetic, the scope wrapper under load, and host properties remain candidates, not a finding.
- The re-calibration ran as root from the worktree (no `realm` account on this host), not as the realm account from a separate copy; the scrubbed environment, settle and serialization were as written. The deviation is stated in `45-MEASUREMENT.md`, not hidden.
- Voice of the window: [INFERENCE] nothing about the product is claimed by VOID.

## Verdict

passed_with_accepted_limitations. Five of six requirements met; OMPV-04 not met and carried. The phase is complete with outcome VOID (calibration); no requirement is labelled met on VOID or on the hermetic probe alone.
