# Phase 18 plan check (GSD plan-checker record, cycle 2)

**Scope checked:** `18-01-PLAN.md` to `18-14-PLAN.md` and `18-04b-PLAN.md`: 15 plans, on worktree `gsd/v3-runtime-wave2`, base commit `33a5699`.
**Method:** deterministic checks only, all read-only. `gsd-tools verify plan-structure` on every plan (15 of 15 valid, no errors). A frontmatter pass over every plan that applies Dimension 1 (requirement coverage), Dimension 3 (dependencies, waves, shared files) and Dimension 5 (scope sanity, thresholds from `gsd-plan-checker.md`): files warn at 10 and block at 15, tasks warn at 4 and block at 5. The LLM checker agent was not spawned from this lane, so Dimensions 2, 4, 6, 7, 7b, 8, 9, 10, 11 and 12 were not re-run in this cycle. Their cycle-1 results stand except where the re-slice changed a file list.

## Verdict

**No blocker.** The cycle-1 BLOCKER (plan 04 scope_sanity: 20 files) is closed by the re-slice below. Three warnings remain, all in the files warning band (10 to 14). None blocks execution.

## Plan set after the re-slice

| Plan | Wave | depends_on | files | tasks | Level |
| --- | --- | --- | --- | --- | --- |
| 01 | 1 | (none) | 1 | 1 | ok |
| 02 | 2 | 01 | 6 | 3 | ok |
| 03 | 2 | 01 | 4 | 2 | ok |
| 04 | 3 | 01, 02 | 14 | 1 | warning (files) |
| 05 | 3 | 01, 02 | 14 | 3 | warning (files) |
| 04b | 4 | 01, 04 | 4 | 1 | ok |
| 07 | 4 | 02, 04 | 2 | 2 | ok |
| 06 | 5 | 03, 04, 04b, 05 | 10 | 2 | warning (files) |
| 08 | 6 | 05, 06 | 3 | 2 | ok |
| 09 | 6 | 06 | 4 | 2 | ok |
| 10 | 6 | 05, 06 | 4 | 2 | ok |
| 11 | 7 | 06, 08, 09, 10 | 4 | 2 | ok |
| 12 | 8 | 07, 10, 11 | 3 | 2 | ok |
| 13 | 8 | 07, 11 | 4 | 2 | ok |
| 14 | 9 | 12, 13 | 0 | 0 | ok (checkpoint plan) |

Every wave equals `max(deps)+1`; no exception remains. No file appears in two plans of one wave. Every file shared across waves is ordered by a `depends_on` path. Requirements MULTI-01 to MULTI-06 are each claimed by at least one plan.

## Re-slice of plan 04

- **04 (driver mount from the registry, wave 3):** 14 files: `src/runtime/driver/compute-driver.ts`, `src/runtime/driver/main.ts`, and 12 driver tests (the fixture, the create-path tests, and `sandbox-binding.test.ts`, which is shared with plan 07).
- **04b (the session's own bind, wave 4, depends on 04):** 4 files: `src/runtime/session-execution.ts`, `src/daemon/daemon.ts` (the `defaultExec` spread only), `test/runtime/session-execution.test.ts`, `test/runtime/openshell-routing.test.ts`.
- **Moved to 02 (wave 2):** `src/runtime/config.ts` and `test/runtime/config.test.ts`, as a new T3 that adds `RuntimeRoots.stateDir`. The driver needs that field in wave 3, and plan 02 is the registry plan. Plan 02 is now 6 files. `test/runtime/config.test.ts` (lines 154 to 158) is the only whole-object `runtimeRootsOf` assertion; `test/cli/init.test.ts` reads fields only.
- **Why the driver side is one plan:** every driver test that creates a sandbox or builds a driver config must change in the same plan as the `planCreate` change, or that plan's own tests are red at its wave end. That side is 14 files, so it cannot be split further without that breakage.
- **Why 04b depends on 04:** the session stops checking the configured pin only after the driver resolves each mount from the registry. Reversed, a wave could end with the session binding a directory that the driver still mounts at `config.workspaceRoot`, and the verifier would refuse each such create.
- **Downstream changes:** plan 06 moves from wave 4 to wave 5 and depends on 04b, because both touch `src/daemon/daemon.ts`. Plans 08 and 09 move from wave 5 to wave 6. Plan 07 stays in wave 4 and depends on 04, which owns `sandbox-binding.test.ts`. Plan 10 is now at its expected wave 6.
- **Text updated for the new numbering:** 05 (plan 06 is wave 5), 06 (04b removes the spread; wave 5), 07 (parallel with 04b), 11 (plan 06 is wave 5), 12 (04b removes the session equality refusal).

## Rulings applied, pending owner ratification (D18-2)

Applied in `18-01-PLAN.md` as labels; no other text of the contract changed. C6 remains the only owner ruling.

- C1: `C1 identity. Engineering ruling, pending owner ratification, within the accepted D5(i).`
- C2: `C2 containment. Engineering ruling, pending owner ratification: the explicit reading of MULTI-02.` Root equality plus descendants, as the existing helper does.
- C7: `C7 aggregate bound. Engineering ruling, pending owner ratification (proposed values).` `aggregateMemoryBytes = 4 * 1024 ** 3`, `aggregateNanoCpus = 8_000_000_000`, `maxSessions = min(floor(4 GiB / 1 GiB), floor(8e9 / 2e9)) = 4`.

The contract truth and the completion note in 01 now name C1, C2 and C7 as engineering rulings pending owner ratification.

## Warnings not fixed

- Plan 04: 14 files (warning band). Splitting it further breaks its own tests (see above).
- Plan 05: 14 files (unchanged from cycle 1).
- Plan 06: 10 files (unchanged from cycle 1).

## Decisions still open

1. **D18-1 (owner): which set is execution-ready.** The set is now 15 plans (the 14 plans on HEAD plus 04b), not 14. The re-slice is the planner's decision; naming the execution-ready set remains the owner's.
2. **D18-2 (owner): ratify C1, C2 and C7** as recorded above.
3. **Phase 17 external gates** (plans 06, 09, 12 and 13 name Phase 17 plans 02 to 04): not re-checked in this cycle.
4. **Plan index in `18-CONTEXT.md`:** that file has no plan index, so none was updated. `ROADMAP.md` and `STATE.md` were not edited.

## Not run in this cycle

No `npm`, build, test, gate or `check:pack`. No push, fetch or `gh` write. No edits outside `.planning/phases/18-per-project-sandboxes/` in the lane worktree.
