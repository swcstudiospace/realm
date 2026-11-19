---
phase: 46-rapid-stop-then-up
verified: 2026-11-19
verdict: passed_with_accepted_limitations
status: passed
score: "0 of 4 requirements met for F-41-1 (STOP-01, STOP-02, STOP-03, STOP-04 all NOT MET as written); new finding F-46-1 is fixed hermetically with weak live support; all four phases' live windows are recorded with outcome VOID/OTHER-FAILURE per the frozen rule"
ref: "origin/main 3160320 (plan 46-03 fix ea04e1c; windows 2026-11-19)"
behavior_unverified: 3
overrides_applied: 0
---

# Phase 46 Verification: Rapid stop then up (F-41-1)

Method: a read of the phase records against STOP-01 to STOP-04 and the success criteria of `46-CONTEXT.md`, on 2026-11-19, at origin/main `3160320`. No live step was run for this verification. Live counts are copied from `46-EVIDENCE.md` (sections 1–9) and `46-SECOND-WINDOW.md` (evidence outside the repository). `repo hygiene`: no window file or path enters the repository.

## Requirements coverage

| Req | Status | Evidence |
| --- | --- | --- |
| STOP-01 | NOT MET | The frozen rule needs 50 consecutive clean iterations per variant for NOT-REPRODUCED, or a reproduction. First window (profile `0.7.1`): OTHER-FAILURE — 0 of 51 ups with `OPENSHELL_START_FAILED`; variants a 43 (40 clean, 3 dirty stops), b 8 (5 clean, 3 dirty stops), c 0 recorded (harness aborted on a failing post-iteration `realm down`), s not run; longest consecutive run 39. Verification window (plan 46-04): VOID — variant a 20/20 clean, b halted at the settled chain start, c/s not run; one `OPENSHELL_START_FAILED` at that settled start, not a stop-then-up iteration, hence not a reproduction. Second window: VOID — b 20/20, c 20/20, s 20/20 clean (60 stops, 0 rows absent, `failedTeardowns` 0), but variant a not run and target 20 < 50. F-41-1 was never reproduced and the 50-iteration non-reproduction condition was never reached. Carried. |
| STOP-02 | NOT MET (for F-41-1) | The cause of F-41-1 is not established; the `docs/integration/runtime-decision.md` INFERENCE paragraph stays an inference for F-41-1. What the phase does establish is the cause of the new finding F-46-1 (`AGENTOS_STOP_FAILED` at ~13 s in 6/51 stops): an occasional slow libpod container stop (7–12 s) exceeding the 7 s request bound, with `containerStep` reporting the step as failed without re-reading the container (INFERENCE with named support; the failed-step cause code was not captured — no file carries it). The b chain-start failure in the verification window is [INFERENCE] a libpod request of the driver's create missing its 5 s bound during a Podman stall on the loaded host; the failing step and cause code are not established (the daemon log was removed before being read). M1–M5 stay NOT TESTED for F-41-1. |
| STOP-03 | NOT MET (for F-41-1) | No fix is made for F-41-1 (no cause). The F-46-1 fix is real but separate: new `containerConfirm` stage (10 s, poll 500 ms), teardown bound 60→70 s, `down` client bound 75→85 s; `daemon.stopped` contract and 29-code catalogue unchanged; red-first `test/runtime/container-stop-confirm.test.ts` (2 fail on the unfixed tree, all pass with the fix). Limits stated: it is only exercised when a libpod stop request misses the 7 s bound; neither verification window exercised it (pre-delete ≤6.3 s in window 2, ≤5.8 s in b of window 3); at the first window's 6/51 rate the chance of 20 clean stops is ~8%, a weak sign. Live support: weak and unproven. Fail-closed beyond 17 s (7+10) is kept. |
| STOP-04 | NOT MET (VOID by the frozen rule) | Per-variant the 20-iteration conditions are met: window 2 variant a 20/20 (0 `OPENSHELL_START_FAILED`, 20/20 `failedTeardowns` 0 rows, zero residue at three snapshots); second window b 20/20 and c 20/20 (60/60 rows `failedTeardowns` 0, zero `OPENSHELL_START_FAILED` in the whole evidence, zero residue at both snapshots). But the frozen rule (D-46-02) makes every window VOID (suspended variants, target 20 < 50), and the plan's rule meets STOP-04 only if all four conditions hold and the window is not VOID. The variant-c row-absent stop (OBS-C) did not recur (0/52 in window 1, 0/20 in window 3) and stays not established — never exercised in the startup window. The `chain-start-failed` harness change (plan 46-04, kept/counted, never a reproduction) is recorded, not a product claim. |

## Success criteria

1. Live loop with 50 consecutive or reproduction: NOT MET (STOP-01).
2. Cause in `runtime-decision.md` in place of the INFERENCE paragraph, with timestamps and cause code: NOT MET for F-41-1 (STOP-02); F-46-1 cause recorded instead.
3. Fix or bound with explicit timeouts, fail-closed, no-orphan, contract unchanged, red-first test: PARTIAL — the F-46-1 bound exists and is red-first proven (STOP-03 does not cover F-41-1, so not met as written).
4. ≥20 consecutive iterations with zero `OPENSHELL_START_FAILED`, zero `failedTeardowns`, zero residue; variant-c row explained: PER-VARIANT MET, WINDOW VOID → NOT MET (STOP-04).

## What is not met, and what is only inferred

- F-41-1 stays carried, not reproduced, cause not established. No success is claimed over it.
- The slow Podman container stop (9/52 stops, 7–12 s vs typical ~3 s) has no established reason; the host was loaded by other work and load was not isolated.
- E-46-09 (SIGTERM during startup) was not exercised (the single variant-c signal came after the startup report) — not confirmed, not refuted.
- Windows 2 and 3 were run on heavily loaded hosts (load averages up to ~71 on 8 CPUs); a quieter host might separate load from defect, but that window was not run.

## Verdict

passed_with_accepted_limitations. The phase is complete: the harness, three live windows and the OTHER-FAILURE fix for the new finding F-46-1 are recorded honestly; all four STOP requirements are NOT MET for F-41-1 and F-41-1 stays carried.
