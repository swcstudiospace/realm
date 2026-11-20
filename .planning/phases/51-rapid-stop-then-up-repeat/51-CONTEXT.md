# Phase 51: Rapid stop then up repeat (F-41-1) - Context

**Gathered:** 2026-11-19, from `.planning/MILESTONE-CONTEXT.md` (D-v8-4), `.planning/REQUIREMENTS.md` v8.0 (STOP-01..04; finding F-41-1), `.planning/ROADMAP.md` Phase 51, `.planning/phases/46-rapid-stop-then-up/` (`46-CONTEXT.md`, `46-EVIDENCE.md`, `46-SECOND-WINDOW.md`, `46-VERIFICATION.md`), `docs/integration/runtime-decision.md` (F-41-1 INFERENCE paragraph).
**Status:** Planned (one plan, nothing executed).

## Phase Boundary

Phase 46 never reproduced F-41-1 (`realm up` immediately after stop of a daemon holding a sandbox of the same name failing with `OPENSHELL_START_FAILED`): windows ended OTHER-FAILURE (new finding F-46-1, fixed hermetically via `containerConfirm`) then VOID by the frozen rule (suspended variants, target 20 < 50). STOP-01..04 all NOT MET; the INFERENCE paragraph stays an inference. Per-variant 20/20 clean runs exist but do not meet the 50-per-variant bar. This phase reruns live to the bar, or pins the suspected mechanism hermetically and carries F-41-1 with that evidence.

**Out of scope:** F-46-1 reopening, teardown-bound changes beyond the named cause, catalogue/`daemon.stopped` contract changes.

## Decisions

- **D-51-1 (owner D-v8-4):** 50 consecutive stop-then-up iterations per variant (variants a–c + s as defined in Phase 46), no settle between iterations, also under CPU load; timeline of daemon request log, gateway, compute driver, supervisor, Podman kept outside the repository.
- **D-51-2:** if 50 per variant do not reproduce, record the non-reproduction and pin the suspected mechanism hermetically (a test that fails when the wait is removed); carry F-41-1 with that evidence — never claim a fix.
- **D-51-3:** a fix (only if reproduced) keeps every wait bounded, fail closed, no-orphan guarantee, `daemon.stopped` contract and 29-code catalogue unchanged; red-first hermetic test.
- **D-51-4:** after any fix, ≥20 consecutive iterations with zero `OPENSHELL_START_FAILED`, `failedTeardowns` 0 in every row, zero residue; the Phase 41 variant-c row-absent stop explained or recorded as a finding.
