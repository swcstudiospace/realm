---
phase: 56-f-51-1-cause
plan: "01"
status: executed
requirements: [STOP-05, STOP-06]
---

# Plan 56-01 summary (F-51-1 cause: attempted, not established, carried with the evidence)

**Verdict: NOT ESTABLISHED.** F-51-1 is carried.

The cause of F-51-1 — a dirty stop (`failedTeardowns` 1, `AGENTOS_STOP_FAILED`) in every variant-c stop of the Phase 51 window (3 of 3: 0.4 s, 7.4 s, 7.4 s) — cannot be established from the Phase 51 recorded evidence, and the cause-identifying capture the plan's Step 1 requires does not exist in the current tree: the product drops the teardown cause before any log row, and the harness has no field to record it. This summary is the static half of the plan (Steps 1 and 3). The live capture window of Step 2 (BLOCKING, human, production stack as the window account under the shared live lock) was not run — and a live run from this worktree today would reproduce the Phase 51 gap: it would record `AGENTOS_STOP_FAILED` with no failed step and no cause code, because nothing in the daemon writes either. The next phase's prerequisite is therefore stated, not waived: close the two capture gaps, then run the live window (section "Carry conditions").

## What the Phase 51 evidence establishes (OBSERVED, 51-EVIDENCE §4)

- All 3 dirty stops were variant c (signal sent 3 s after `realm up` started, mid-create), with both `daemon.stopping` and `daemon.stopped` rows present (row-absent 0 of 123). The next up after each reached active with one exec; residue was 0/0/0/0.
- Stops took 0.4–7.4 s, far inside every stage bound (15 s `AGENTOS_STOP_DEADLINE_MS` and `SANDBOX_DELETE_DEADLINE_MS`; 70 s-class teardown bound, `TEARDOWN_TIMEOUT_MS = SESSION_END_WORST_CASE_MS + margin`, `src/runtime/teardown-stages.ts`, `src/lifecycle/bounds.ts:14`): not a bound expiry.
- First window: both gateway sandbox deletes completed successfully (status 200, 80 ms). No slow-container-stop signature (no Podman poll-failure line in the driver journal, which accompanied every F-46-1 failed stop). The F-46-1 fix (10 s `CONTAINER_END_CONFIRM_MS` wait) was present and unexercised.
- No failed-step cause code exists in any file of the window (51-EVIDENCE §4.1/§4.3). The timelines kept outside the repository do not name a step either.

## What the stop-path code proves about the record (READ, verified against this tree)

The failing call is `daemon closeEverything` → `stopSessions` (`src/daemon/teardown.ts`) → `LifecycleController.stop` → `teardownContainer` (`src/lifecycle/controller.ts:687-695`, `Promise.all` of the `exec.stop`, `reclaimPendingCreate` and `reclaimPendingStart` branches) → `SessionExecution.endSession` (`src/runtime/session-execution.ts:310-316`), which runs, in turn: `settleCreatesFor`, the AgentOS stop (`stopAgentOs`), the container inspect-then-stop step (`containerStep`) and the sandbox delete (`deleteSessionSandbox`), and `throwIfStopFailed` (626-640) reports the first failed step's cause code under the primary `AGENTOS_STOP_FAILED`. The cause is intact in-process at that throw. It is then destroyed twice before it could be recorded:

1. `stopSessions` catches the error and keeps only `codeOf(error)` (`src/daemon/sessions.ts:201-203`), which is the primary code; `error.causeCode` is discarded (`src/daemon/teardown.ts:25-30`).
2. `daemon.stopped` is logged as `{ code: failure, failedTeardowns }` (`src/daemon/daemon.ts:559-561`) — no `causeCode` field, no failed-step field. The shutdown failure path likewise writes "one line carrying only a catalogue code" (`src/daemon/main.ts:73-74`).

And the harness cannot recover what the product dropped: `stoppedVerdictOf` reads only `failedTeardowns` and `code` (`test/support/daemon-stop-live.ts:121-127`), `StopClass.dirty` carries `failedTeardowns` and `code` but no cause field (`test/support/rapid-stop-up.ts:191-194`), and the iteration evidence line emits no such field. The gap is therefore in the product first, the harness second.

The cause-code-only capture the Phase 51 plan proposed is also insufficient by itself: two of the four `endSession` steps can fail with no cause code and no step identity on the error — the settle wait (`STEP_FAILED` when `waited.settled` is false, 310-316/321-343), the sandbox delete (`STEP_FAILED` when the delete fails, 438-444), and the AgentOS stop timeout (bare `AGENTOS_STOP_FAILED` → `causeCode` undefined in `stopAgentOs`, 423-433); `requireSandbox` likewise refuses with no cause (644-650). Naming the step is required, not only its cause.

## What remains possible (READ)

Excluded by the recorded numbers: bound expiry (all stops ≤ 7.4 s; every stage bound is ≥ 10 s, the settle wait alone needs a full 15.0 s to report unsettled); the sandbox delete for the first stop (both deletes observed 200/80 ms); the F-46-1 slow-stop shape (no poll-failure line). Not excludable from this record: the AgentOS (supervisor/driver) stop step; the container inspect-then-stop step (fast-rejected request); the sandbox delete in stops 2–3 (no per-stop delete outcome was recorded there). The orphan-failure paths (`reclaimPendingCreate` 865-887, `adoptOrphan` 1004-1017) and `stopStarted` (911-924) flatten causes to codes via `portFailureCode`, so a failure arriving through them would arrive codeless and step-less even if the product logged causes. Because `teardownContainer` runs its branches concurrently under `Promise.all`, the recorded row cannot identify which branch threw. No step is named; no mechanism is claimed (numerical fits to the 7.4 s stops were not pursued past this point — they would be speculation).

## Requirements

| Req | Status | Why |
| --- | --- | --- |
| STOP-05 | NOT MET as established; CARRIED per D-56-3 | The cause is not established. The capture cannot establish it: the failed step and its cause code were not recorded in Phase 51 and are not capturable from the request log today (product drops `causeCode` before logging; harness parses none; two steps carry no cause in-process). F-51-1 stays with this evidence, unrelabeled. It is not folded into F-41-1 (different shape: an up failing with `OPENSHELL_START_FAILED`, never seen in 123 ups). No pass is claimed. |
| STOP-06 | NOT MET | No fix or bound was made (there is no cause to fix), and no 20-iteration clean verification run exists. Teardown bounds and the no-orphan guarantee were not weakened by this plan (nothing changed in `src`). |

## Carry conditions (what a future phase must do before claiming a cause)

1. **Product capture (hermetic, red-first).** Carry the cause code and a failed-step name through `stopSessions` into the `daemon.stopped` row (additive fields; the 29-code catalogue is unchanged — step names and cause values are not codes). The contract tests must be updated deliberately, not silently unedited.
2. **Harness capture.** Parse both fields in `stoppedVerdictOf`/`classifyStop`, record them per dirty stop, and count a dirty stop without them as not captured, never assumed (Plan Step 1).
3. **Live window (BLOCKING, human).** Variant c, immediate stop-then-up on the production stack as the window account under the shared live lock, outcome word frozen before the run. This phase did not run it.
4. Only then: fix red-first in the owning module with every wait bounded, and a ≥ 20 consecutive variant-c clean run with `failedTeardowns` 0 and zero residue (Plan Step 4).

## Attempts and checks

- Read in full: `51-EVIDENCE.md` §4 (plus §§1–3 for the failing-stop facts and frozen outcome), `51-SUMMARY.md`, `51-VERIFICATION.md`, `56-PLAN.md`, `56-CONTEXT.md`, and the whole stop path in this tree: `src/daemon/daemon.ts:549-582` (closeEverything), `src/daemon/teardown.ts`, `src/daemon/sessions.ts:200-203`, `src/lifecycle/controller.ts` (stop/teardownContainer/reclaim/stopStarted/teardownCall), `src/runtime/session-execution.ts` (endSession, settleCreatesFor, containerStep, containerEnded, stopAgentOs, deleteSessionSandbox, throwIfStopFailed, requireSandbox), `src/runtime/agentos.ts:190-205` (supervisor stop), `src/runtime/agentos-driver.ts:347-410` (driver stop/runStop), `src/runtime/teardown-stages.ts` and `src/daemon/main.ts:52-54` (bounds: 15 s, 2 s, 15 s, 10 s, 180 s, 30 s). Stop-path files are unchanged since the Phase 51 build (2879c35 → HEAD `c679e31`: no diff in the six files), so the reading covers the build that produced the evidence.
- Live-stack reachability was probed, not used: rootless Podman 5.7.1 and a podman socket exist for the `realmlive` account, but no user D-Bus (`No medium found`), so autostarted units cannot be managed, and the plan designates the capture window BLOCKING human work under the shared lock. No live command was run against the production stack; no live run is claimed.
- Hermetic: `npm ci`, `npm run build` (exit 0). `node --test dist/test/integration/rapid-stop-up-helpers.test.js dist/test/integration/daemon-stop-live-helpers.test.js` — 104 passed, 0 failed.
- No source, test, contract, or catalogue file was changed by this plan; `src` is untouched. Worktree `git status` is clean apart from this file (plus build output, ignored).

## Note for the verifier

The only repo change of this phase is this summary. `docs/integration/runtime-decision.md` should gain the F-51-1 carried entry (Plan Step 3) recording this verdict and the two capture gaps; it was not written here because this assignment scoped the work to the summary.
