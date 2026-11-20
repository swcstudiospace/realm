# Phase 56: F-51-1 cause - Context

**Gathered:** 2026-11-20, from `.planning/MILESTONE-CONTEXT.md` (D-v9-3, Ordering and dependencies), `.planning/REQUIREMENTS.md` v9.0 (STOP-05..06), `.planning/ROADMAP.md` Phase 56, `.planning/phases/51-rapid-stop-then-up-repeat/` (`51-EVIDENCE.md` §4, `51-VERIFICATION.md`), `docs/integration/runtime-decision.md` (F-41-1 INFERENCE paragraph, Phase 41 teardown budget, F-46-1), `src/runtime/session-execution.ts`, `src/daemon/daemon.ts`, `src/daemon/teardown.ts`.
**Status:** Planned (one plan, nothing executed).

## Phase Boundary

Phase 51 found F-51-1: a dirty stop (`failedTeardowns` 1, `AGENTOS_STOP_FAILED`) in every variant-c stop of its window (3 of 3), fast stops with no F-46-1 slow-stop signature, sandbox deletes successful — but the failed-step cause code was not captured, so the cause is not established. This phase captures the failed-step cause code for every dirty stop in a live window, establishes the cause in `docs/integration/runtime-decision.md`, and fixes or bounds it with a 20-iteration clean run. Live window on the production stack; the shared live lock serialises it against Phases 57 and 58. Phase 59 is explicitly excluded: it is gated on the owner ratification of `53-DESIGN.md` (D-v9-6) and this phase writes no binding code.

**Out of scope:** F-41-1 and STOP-01 to STOP-04 (never reproduced; stay carried outside this milestone); folding F-51-1 into F-41-1; weakening teardown bounds or the no-orphan guarantee; any `src` file outside the daemon stop and start path (`src/runtime/session-execution.ts`, `src/daemon/`, `src/lifecycle/`).

## Decisions

- **D-56-1 (owner D-v9-3):** capture the failed-step cause code, establish the cause, fix or bound it with a 20-iteration clean run (STOP-05, STOP-06).
- **D-56-2:** a live window captures the failed step and its cause code for every dirty stop, with the timeline of daemon, gateway, driver, supervisor and Podman kept outside the repository; the outcome word is frozen before the run.
- **D-56-3:** if the capture cannot establish the cause, F-51-1 is carried with that evidence instead of claimed; a failed live step is recorded as failed, never relabelled as a pass.
- **D-56-4:** a fix never weakens teardown bounds or the no-orphan guarantee; every wait stays bounded and fail closed is kept.
