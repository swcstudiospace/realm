---
phase: 51-rapid-stop-then-up-repeat
verified: 2026-11-19
verdict: passed_with_accepted_limitations
status: passed
score: "0 of 4 requirements met (STOP-01 to STOP-04 NOT MET for F-41-1; outcome OTHER-FAILURE with new finding F-51-1; variant-c bar not reached, failure cap on dirty stops)"
ref: "origin/main 63bbc7e (window 2026-11-19 about 22:59:52 to 23:29:19 UTC, production stack, rootless Podman 5.7.1, Phase 46 harness reused unchanged)"
behavior_unverified: 1
overrides_applied: 0
---

# Phase 51 Verification: Rapid stop then up repeat (F-41-1)

Method: a read of the phase records against STOP-01 to STOP-04 and the success criteria of `51-CONTEXT.md` / `51-PLAN.md`, on 2026-11-19, at origin/main `63bbc7e`. No live step was run for this verification. The window is copied from `51-EVIDENCE.md` (evidence outside the repository).

## Requirements coverage

| Req | Status | Evidence |
| --- | --- | --- |
| STOP-01 | NOT MET | The frozen rule of 46-CONTEXT D-46-02 reads OTHER-FAILURE: 0 of 123 recorded ups failed, 0 with `OPENSHELL_START_FAILED` (so not REPRODUCED); 3 dirty stops with `failedTeardowns` 1 and AGENTOS_STOP_FAILED (so not NOT-REPRODUCED); the window did not end before the failures appeared (so not VOID). Variants a and b each reached the 50-consecutive bar (50/50 clean); variant c ended at its failure cap (3 dirty stops, 0 clean); control s ran 20/20 clean. A first launch with the wrong image (a stale config value) was stopped, kept aside and not counted; the window was rerun (51-EVIDENCE §6). 50-clean per variant was not reached for c. |
| STOP-02 | NOT MET | The cause of F-41-1 is not established; the `runtime-decision.md` INFERENCE paragraph stays an inference. The window instead records new finding F-51-1: a dirty stop (`failedTeardowns` 1, AGENTOS_STOP_FAILED) in every variant-c stop of this window (3 of 3), fast stops with no F-46-1 slow-stop signature, sandbox deletes successful; its cause is not established (the failed-step cause code was not captured, 51-EVIDENCE §4.3). F-51-1 is not folded into F-41-1. |
| STOP-03 | NOT MET | No fix is made for F-41-1 (no cause). The OTHER-FAILURE branch prescribes no fix, and none was made; the F-46-1 fix (10 s `containerConfirm` wait) was present in the build and unexercised (every stop completed well inside the request bound). |
| STOP-04 | NOT MET | Per-variant conditions met by a (50), b (50) and s (20): 0 `OPENSHELL_START_FAILED`, `failedTeardowns` 0 in every row, zero residue at the before/after snapshots. Not met for the run: 3 variant-c rows carry `failedTeardowns` 1. |

## Success criteria

1. 50 consecutive stop-then-up iterations per variant with no settle, or the hermetic pin: NOT MET for the bar — a and b reached 50 in one chain, c did not (failure cap); no hermetic pin was attempted because there was no failing up to discriminate (mechanism candidates M1–M5 NOT TESTED; M4 has evidence against it as a general mechanism: 3 dirty stops, 3 normal next ups, clean end state).
2. Cause established or F-41-1 carried with the evidence: carried — not reproduced in 123 ups on one host, one commit, a quiet host; cause not established (51-SUMMARY §"What the outcome claims and does not claim").
3. Fix or bound with every wait bounded, contract and catalogue unchanged: no fix (OTHER-FAILURE branch, correctly no fix).
4. ≥20 iterations with zero `OPENSHELL_START_FAILED`, `failedTeardowns` 0, zero residue; variant-c row-absent stop explained or recorded as a finding: per-variant met except the 3 dirty c rows; OBS-C did not recur (0 row-absent stops in 123) and the signal never landed in the daemon's startup window (`startupSeen` yes in all 3 c iterations), so the startup-window hypothesis was not exercised — the reading stays not established.

## What is not met, and what is only inferred

- F-41-1 was not reproduced in 123 ups (100 of them the 50-bars of a and b). That is not evidence it cannot occur: one host, one commit, variant c never reached its bar.
- F-51-1's cause is not established; why variant c stops failed here while the Phase 46 second window's 20 c stops were clean is not established (both windows single-host; load differs).
- The status notice was present on all 123 ups and `containersRemoved` 0 in all 123; the notice separates nothing.
- The first wrong-image launch was kept aside and not counted; the commit field of the harness summary reads unknown (the built copy had no git metadata), so the commit is recorded by the merge, not the harness (51-EVIDENCE §2).

## Verdict

passed_with_accepted_limitations. Zero of four STOP requirements met; F-41-1 is carried with the repeat evidence (never reproduced, cause not established). New finding F-51-1 is recorded, not folded into F-41-1. The phase is complete; no outcome is relabelled.
