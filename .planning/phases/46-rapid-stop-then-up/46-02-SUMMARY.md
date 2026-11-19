---
phase: 46-rapid-stop-then-up
plan: "02"
status: executed
requirements: [STOP-01, STOP-02]
---

# Plan 46-02 summary (the live window and its recording)

The live window ran on 2026-11-19 (owner and orchestrator, production stack, account `realmlive`, rootless Podman 5.7.1, shared live lock, the plan 46-01 harness merged into main). This summary and `46-EVIDENCE.md` are the recording half. The evidence files stay outside the repository; nothing here carries a path, an environment value, a token or a container id.

## Outcome (frozen rule of 46-CONTEXT D-46-02)

**OTHER-FAILURE.** 0 of 51 recorded ups failed, 0 with `OPENSHELL_START_FAILED`; 6 recorded stops had `daemon.stopped` `failedTeardowns` 1 with code AGENTOS_STOP_FAILED (variant a 3 of 43, variant b 3 of 8). Variants a and b ended at the failure cap (3). Variant c recorded no iteration (one ran and was not counted: the harness aborted on the post-iteration `realm down`, which also returned AGENTOS_STOP_FAILED). The control s did not run (window halted). No variant reached 50 consecutive clean iterations (longest run 39).

| Variant | Iterations | Clean | Failed (kind) | Ended |
| --- | --- | --- | --- | --- |
| a | 43 | 40 | 3 (dirty stop) | failure cap |
| b | 8 | 5 | 3 (dirty stop) | failure cap |
| c | 0 recorded | 0 | 0 | harness abort |
| s | not run | none | none | skipped |

## What the outcome claims and does not claim

- F-41-1 (an up failing with OPENSHELL_START_FAILED after a stop) was not reproduced in 51 ups. That is not evidence that it cannot occur (one host, one commit, a synthetic and an unrelated load, variants c and s never completed). Its cause stays not established; the INFERENCE in the runtime decision record stays an inference. F-41-1 is carried.
- The status notice that the Phase 41 record cited was present on all 51 ups, clean ones included; it does not separate a failed run from a clean one.
- The new finding is F-46-1: AGENTOS_STOP_FAILED after about 13 s in 6 of 51 stops (and one variant c stop). Its cause record is `46-EVIDENCE.md` section 4, its fix is in the plan 46-03 summary.
- The mechanism candidates M1 to M5 are marked NOT TESTED (no failing up to discriminate); M4 has evidence against it as a general mechanism (6 dirty stops, 6 normal next ups, clean end state).
- OBS-C (a variant c stop with no `daemon.stopped` row) did not recur, and E-46-09 (a SIGTERM during startup) was not exercised: the one variant c signal came after the daemon's startup report.

## Harness defect found by the window

A failing post-iteration `realm down` in variant c is treated as a host stop (a chain abort). A product code from `down` is a finding, so it must be a failure kind that is counted and kept. This is why variant c has no count. It is corrected in the plan 46-03 change set (the failure kind `down-failed`, counted and kept, with a hermetic case); the harness daemon exit bound was raised to 100 s in the same change set because the teardown bound rose to 70 s.

## Not done as written

No count of 50 clean iterations per variant exists; no variant c or control result exists. The window was halted by the harness abort and the failure cap, which are recorded as such, not relabelled.
