---
phase: 49-omp-calibration-repeat
verified: 2026-11-19
verdict: passed_with_accepted_limitations
status: passed
score: "1 of 1 requirements met (OMPV-04: CALIBRATED_BOUNDS frozen before the verdict run, digest af0adf3076cc4df0613da6a448569e0e95011faec07d8a871a285266eeac247d); OMPR-01, OMPR-06 and OI-11 closed on the FINDING with the 5 valid pairs the rule needs (D-49-1); paired effect NOT-REPRODUCED"
ref: "origin/main 63bbc7e (window 2026-11-19, omp 19.0.0, node v24.18.0, 8 CPUs)"
behavior_unverified: 1
overrides_applied: 0
---

# Phase 49 Verification: Omp calibration repeat

Method: a read of the phase records against OMPV-04 (carrying OMPR-01, OMPR-06 and OI-11) and the success criteria of `49-CONTEXT.md` / `49-PLAN.md`, on 2026-11-19, at origin/main `63bbc7e`. The hermetic claims are read from the plan summaries and the files they name; no live step was run for this verification. The calibration and verdict windows are copied from `49-MEASUREMENT.md` (evidence outside the repository). Labels throughout: loaded, scoped; `quietClaim` false.

## Requirements coverage

| Req | Status | Evidence |
| --- | --- | --- |
| OMPV-04 | MET | Alternating order is code (`controlFirst(runIndexOf(...))`, Phase 45) and the baseline bound was frozen before any verdict run: 16/16 calibration controls mechanically valid and passing, main thread busiest in all 16 (`49-MEASUREMENT.md` Part 1); frozen `stallShareMax` 0.008853242320819113, `runqShareMax` 0.00547431048269137, `controlSelfMaxMs` 1000, `controlSelfP95Ms` 500, `CALIBRATION_FREEZE` date 2026-11-19, digest `af0adf3076cc4df0613da6a448569e0e95011faec07d8a871a285266eeac247d`, pinned by `omp-calibration.test.ts`. Verdict window: 12 pair attempts, 24 arm runs, 15 valid, 5 valid pairs; `decideVerdict` = FINDING (named cause `unattributed`), `decidePairs` = NOT-REPRODUCED (median boot excess −794 ms against the 250 ms bound). The bracket-arithmetic step recorded no pre-fix failure: the six new hermetic cases in `omp-contention.test.ts` pass on the pre-fix tree, so `attributeInterval` was not changed (recorded as the finding it is, not a red-first fix). |
| OMPR-01, OMPR-06, OI-11 | CLOSED on the FINDING | `49-RESOLUTION.md` per D-49-1: OMPV-04 met on the frozen bound and the window outcome is FINDING with 5 valid pairs — the number the paired rule needs (MIN_VALID_PAIRS = 5) — so the three close on the FINDING, not on the hermetic probe and not on VOID. The close carries the evidence's actual content: every one of the 6 valid after-arm runs breaches on attach-window shortness (40 probes × 250 ms = 9749–9751 ms against the 10000 ms minimum) while self-inflicted latencies are low (17.8–96.8 ms max, 10.8–14.9 ms p95). The FINDING is shortness-driven, not latency-driven; the paired effect is NOT-REPRODUCED (no before/after effect between two runs of the same tree). UI-01 status stays the owner's call. |

## Success criteria

1. Feasibility re-stated before the verdict window, Branch S confirmed: met (`49-CALIBRATION.md`, P1–P12, no primitive regressed).
2. Bracket-arithmetic fix red-first: recorded as not-needed — the cases pass pre-fix, so there was nothing to fix red-first against; no source change, stated in `49-SUMMARY.md`.
3. Recalibration freezes `CALIBRATED_BOUNDS` before any verdict run: met (16/16, digest above).
4. Live window ends in exactly one of PASS/FINDING/NOT-REPRODUCED/VOID by the frozen code rule: met as FINDING (`decideVerdict`), with the paired rule NOT-REPRODUCED; tier, host facts, commit, Omp version and isolation recorded in the phase and `docs/integration/omp.md`; residue zero at every snapshot; secret search clean.
5. OMPR-01/06 + OI-11 read the outcome, never closed on VOID or the probe alone: met (closed on FINDING with the valid pairs the rule needs).

## What is not met, and what is only inferred

- The FINDING's named cause is `unattributed`; the short-window mechanism (40 × 250 ms = 9750 ms against a 10000 ms minimum) is a calculation over the records, not a product cause. Nothing about the product is claimed by the word FINDING alone.
- The paired NOT-REPRODUCED reads boot excess between two runs of the same frozen tree (no before-code tree exists in this phase); it is not a product-change effect (deviation stated in `49-SUMMARY.md`).
- The window driver's job bound cut the closing snapshot; it was taken immediately after and recorded as such (`49-SUMMARY.md` deviations).

## Verdict

passed_with_accepted_limitations. OMPV-04 is met on the frozen bound; OMPR-01, OMPR-06 and OI-11 are closed on the FINDING with the 5 valid pairs the rule needs, the short-window mechanism stated with the close. No requirement is labelled met by inference or on the hermetic probe alone.
