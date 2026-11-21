# Phase 56: F-51-1 cause — hermetic evidence (2026-11-21)

**Scope of this record:** plan step 1 only (hermetic). The live capture window of plan step 2 is BLOCKING-human and no live result is claimed here.

## 1. Capture-gap status

**Gap confirmed in the harness as Phase 51 left it.** `test/support/rapid-stop-up.ts` (`classifyStop`) and `test/support/daemon-stop-live.ts` (`stoppedVerdictOf`, `stopRecordsOf`) read only the `daemon.stopped` row's `failedTeardowns` and primary `code`. For the three dirty stops of 51-EVIDENCE §4 that yields `failedTeardowns=1, code=AGENTOS_STOP_FAILED` with no failed-step or cause code — the Phase 51 gap (51-EVIDENCE §4.3). Variants a, b, c and the settled control s are unchanged.

**Product side (read-only check, no src edited):** `src/daemon/teardown.ts` keeps only the first primary code (`codeOf`) and `src/daemon/daemon.ts` logs `daemon.stopped` with that `code` plus `failedTeardowns`. The in-process cause code computed by `throwIfStopFailed` (`src/runtime/session-execution.ts`) never reaches the `daemon.stopped` row, and no failed-step name exists in the row. The harness therefore cannot capture a cause code from product output until the product emits one; this phase makes no src change to do so.

## 2. What the harness now captures (added, hermetic)

New pure helper `stopCauseOf` in `test/support/rapid-stop-up.ts` (section D2), reading the same stop window as `classifyStop`:

- `causeCode`: the row's `causeCode` field when it is a catalogue code (`"unlisted"` when present but not a catalogue code, `undefined` when absent).
- `failedStep`: the row's `failedStep` (or `step`) field when it holds a closed step name.
- `captured`: false when the row carries neither — the Phase 51 shape. Such a dirty stop is counted as **not captured**, never assumed to have no cause.

Already present (reused, not changed): `stopRecordsOf`, `stoppedVerdictOf`, `classifyStop`, the iteration evidence line (`stopCode`, `failedTeardowns`), the timeline merge (`mergeTimeline`, `timelineAround`) and supervisor lifespans, with the timeline of daemon, gateway, compute driver, supervisor and Podman kept outside the repository as the plan requires.

## 3. Live capture window (plan step 2) — BLOCKING-human

**BLOCKING-human (production stack + shared live lock).** Not run in this task: it needs the production stack as the window account under the shared live lock (`realm-evidence/live.lock`), serialised against Phases 57 and 58. Until that window runs, every dirty stop's failed step and cause code remain uncaptured, F-51-1's cause is **not established**, and no pass, clean-run or fix claim is made (plan steps 3 and 4 are likewise pending).

## 4. Checks

Gates, formatters, tests and builds were skipped per the assignment; the orchestrator verifies. No `src/` file was edited.
