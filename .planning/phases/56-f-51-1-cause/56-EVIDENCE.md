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

---

# Phase 56 closure (2026-11-22): emission added, window blocked, F-51-1 carried

**Scope of this section:** the v9.0 closure run. The hermetic record above stands; this section records the closure attempt's outcome. **F-51-1's cause is not established; STOP-05 and STOP-06 are carried, not met; no pass, clean run or fix is claimed.**

## 1. Product emission added (the capture gap closed in code)

Read-only check of the pre-change product confirmed the gap: `src/daemon/teardown.ts` kept only the first primary code (`codeOf`) and `src/daemon/daemon.ts` logged `daemon.stopped` with that `code` plus `failedTeardowns`. The in-process cause code computed by `throwIfStopFailed` (`src/runtime/session-execution.ts`) never reached the row.

Minimal additive change, confined to the two files the assignment allows:

- `src/daemon/teardown.ts`: `StopSessionsResult` carries `causeCode` — the first failed session's own `RealmError.causeCode` (the catalogue code the primary failure rests on, e.g. the failed step's code carried by `AGENTOS_STOP_FAILED`), `undefined` when the first failure carried no cause (the Phase 51 shape).
- `src/daemon/daemon.ts` (`closeEverything`): logs `causeCode` on `daemon.stopped` when present.

Bounds and guarantees unchanged: every wait stays under the same teardown bound, the no-orphan guarantee is untouched, the `failedTeardowns` count and the first failure code are unchanged, the error catalogue is unchanged. No failed-step *name* is emitted — the product records none, and this phase may edit only these two daemon files; `stopCauseOf` counts a row carrying `causeCode` as captured.

Contract check (read-only): `test/daemon/stop-bounds.test.ts` D1 asserts the exact key set of a clean `daemon.stopped` row; the emission adds a key only on failure with a cause, so D1 is unaffected. `daemon.test.ts` T2 reads only `code`/`failedTeardowns`. Orchestrator verifies by build/test.

## 2. Live capture window — blocked, not run (see 56-WINDOW.md)

Attempted 2026-11-22T18:58Z as `realmlive` under the shared live lock (free). The production gate cannot open: the account's `podman.socket` and `openshell-gateway.service` are inactive, `/run/user/5002/podman/podman.sock` is absent, no compute-driver unit exists for the account, and the running realm stack is root's under a mode-0700 state directory. No dirty stop was observed; no step or cause was captured. The window is recorded as **not run**, never as a pass.

## 3. Consequences

- `docs/integration/runtime-decision.md`: the F-51-1 note now records the emission, the blocked window, and the carry (Phase 51 inference still stands, not replaced).
- No fix in an owning module and no 20-iteration variant-c clean run: the cause is not established, so plan steps 3 (establish) and 4 (fix + clean run) remain open for a future window once the account's stack is up.
- F-51-1 (and STOP-05/STOP-06) stay carried outside this milestone's done set; F-41-1 and GAP-43-03/GAP-40-01 are untouched by this phase.
