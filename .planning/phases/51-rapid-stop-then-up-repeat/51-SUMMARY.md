---
phase: 51-rapid-stop-then-up-repeat
plan: "01"
status: executed
requirements: [STOP-01, STOP-02, STOP-03, STOP-04]
---

# Plan 51-01 summary (the repeat window and its recording)

The repeat live window ran on 2026-11-19 (about 22:59:52 to 23:29:19 UTC; production stack, account `realmlive`, rootless Podman 5.7.1, shared live lock, the current main as merged, the Phase 46 harness reused unchanged). This summary and `51-EVIDENCE.md` are the recording half. The evidence files stay outside the repository; nothing here carries a path, an environment value, a token or a container id. This phase covers the live window (Plan step 2) and its branch (Plan step 3). No fix landed, so the verification window (Plan step 4) does not apply.

## Outcome (frozen rule of 46-CONTEXT D-46-02)

**OTHER-FAILURE.** 0 of 123 recorded ups failed, 0 with `OPENSHELL_START_FAILED`; 3 recorded stops had `daemon.stopped` `failedTeardowns` 1 with code AGENTOS_STOP_FAILED (all variant c, all at stop-mid-create). Variants a and b each reached the 50-consecutive bar in one chain (50 of 50 clean); variant c ended at its failure cap (3 dirty stops, 0 clean); the control s ran 20 of 20 clean. A first launch with the wrong image (a stale config value instead of the image the running driver was given) was stopped, kept aside and not counted; the window was rerun (see `51-EVIDENCE.md` section 6).

| Variant | Iterations | Clean | Failed (kind) | Ended |
| --- | --- | --- | --- | --- |
| a | 50 | 50 | 0 | target |
| b | 50 | 50 | 0 | target |
| c | 3 | 0 | 3 (dirty stop) | failure cap |
| s | 20 | 20 | 0 | target |

## What the outcome claims and does not claim

- F-41-1 (an up failing with OPENSHELL_START_FAILED after a stop) was not reproduced in 123 ups, 100 of them at the 50-consecutive bar, on a quiet host. That is not evidence that it cannot occur (one host, one commit, variant c never reached its bar). Its cause stays not established; the INFERENCE in the runtime decision record stays an inference. F-41-1 is carried.
- The new finding is F-51-1: a dirty stop (`failedTeardowns` 1, AGENTOS_STOP_FAILED) in every variant-c stop of this window (3 of 3), fast stops with no F-46-1 slow-stop signature, the sandbox deletes successful. Its cause record is `51-EVIDENCE.md` section 4; the cause is not established (the failed-step cause code was not captured). It is recorded as a new finding and not folded into F-41-1.
- The status notice was present on all 123 ups, and `containersRemoved` 0 in all 123; the notice separates nothing.
- The mechanism candidates M1 to M5 are marked NOT TESTED (no failing up to discriminate); M4 has evidence against it as a general mechanism (3 dirty stops, 3 normal next ups, clean end state).
- OBS-C (a variant c stop with no `daemon.stopped` row) did not recur: 0 row-absent stops in 123. The signal never landed in the daemon's startup window (`startupSeen` yes in all 3 c iterations), so the startup-window hypothesis was not exercised either; the reading stays not established.
- The F-46-1 fix (the 10 s container confirmation wait) was present in this build and unexercised: every stop completed well inside the request bound.

## Requirements

| Req | Status | Why |
| --- | --- | --- |
| STOP-01 | NOT MET | Neither a reproduction (0 start failures in 123 ups) nor 50 clean per variant (variant c 0 of 3, failure cap on dirty stops). |
| STOP-02 | NOT MET | The cause of F-41-1 is not established; the `runtime-decision.md` INFERENCE paragraph stays an inference. F-51-1's cause is likewise not established (section 4.3). |
| STOP-03 | NOT MET | No fix is made for F-41-1 (no cause). The OTHER-FAILURE branch prescribes no fix, and none was made. |
| STOP-04 | NOT MET | Per-variant conditions met by a (50), b (50) and s (20): 0 `OPENSHELL_START_FAILED`, `failedTeardowns` 0 in every row, zero residue at the before/after snapshots. Not met for the run: 3 variant-c rows carry `failedTeardowns` 1. |

## Not done as written

No count of 50 clean iterations in variant c exists, and no verification window (Plan step 4) ran, because no fix landed. Nothing was retried, dropped or relabelled: the variant-c stop was kept as a finding, not as a reproduction.
