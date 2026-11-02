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

## Rulings, owner answers of 2026-11-02 (D18-2, binding)

Applied to the plan set at `96642c1`. The C7 values drafted in cycle 2 were replaced by the owner's values; the derivation formula is unchanged.

- C1: ratified by owner 2026-11-02 as drafted. Label in `18-01-PLAN.md`: `C1 identity. Engineering ruling, ratified by owner 2026-11-02, within the accepted D5(i).`
- C2: ratified by owner 2026-11-02 as drafted. Label in `18-01-PLAN.md`: `C2 containment. Engineering ruling, ratified by owner 2026-11-02: the explicit reading of MULTI-02.` Root equality plus descendants, as the existing helper does.
- C7: set by owner 2026-11-02, replacing the drafted values. `aggregateMemoryBytes = 4 * 1024 ** 3` (4 GiB, unchanged). `aggregateNanoCpus = 4_000_000_000`. `maxSessions = min(floor(4 GiB / 1 GiB), floor(4e9 / 2e9)) = 2`. Label in `18-01-PLAN.md`: `C7 aggregate bound. Set by owner 2026-11-02 (4 GiB, 4e9 nanoCpus, 2 sessions).`
- Propagated: `18-01-PLAN.md` (the C7 item, the truth and completion lines, the C6 label and the owner-ruling sentences), `18-03-PLAN.md` (truths, the T2 action and done-when, the host-evidence step), `18-12-PLAN.md` (the resource-bound section now says "the two sessions they admit").
- C6 remains an owner ruling (2026-11-02). C9 and the other items remain engineering decisions.

## Structural check, 2026-11-02

Command, run from the lane worktree root after the edits above, once per plan: `node ~/.claude/gsd-core/bin/gsd-tools.cjs query verify plan-structure .planning/phases/18-per-project-sandboxes/18-<NN>-PLAN.md`, for NN in 01 to 14 with 04b.

Result: 15 of 15 valid, `errors: []` on every plan.

Observation: every plan returns the warning `No <task> elements found` with `task_count: 0`. The tool does not parse the `### T<n>` task headings these plans use. The structural check therefore confirms frontmatter and section structure only; it does not count tasks. The task counts in the table above come from the cycle-2 reading of the headings.

## Warnings not fixed

- Plan 04: 14 files (warning band). Splitting it further breaks its own tests (see above).
- Plan 05: 14 files (unchanged from cycle 1).
- Plan 06: 10 files (unchanged from cycle 1).
- Plan 03, done-when: the case "halving `aggregateMemoryBytes` gives 2" no longer shows that the memory term binds. With the owner values the bound is `min(4, 2) = 2`, and halving memory gives `min(2, 2) = 2`. The assertion still passes if the memory term is ignored. A discriminating case needs a test design choice; it is not changed in this record.
- Plan 03, host-evidence step: the text says a lowered constant is "an engineering check, not an owner question". C7 is now owner-set, so any lowering of the owner values needs owner approval. The step is not changed in this record.
- Plan 01, C7 completion note: "if the host cannot hold two sessions, the constants are lowered in that same change" conflicts with the owner-set status for the same reason. Not changed in this record.

## Decisions still open

1. **D18-1 (owner): which set is execution-ready.** Answered by owner 2026-11-02: the execution set is the 15-plan set at `96642c1` (18-01 to 18-14, with 18-04b). Resolved.
2. **D18-2 (owner): ratify C1, C2 and C7.** Answered by owner 2026-11-02: C1 and C2 ratified as drafted; C7 set to 4 GiB, 4e9 nanoCpus, 2 sessions. Resolved.
3. **Phase 17 external gates** (plans 06, 09, 12 and 13 name Phase 17 plans 02 to 04): not re-checked in this cycle. This is the remaining named blocker for execution.
4. **Plan index in `18-CONTEXT.md`:** that file has no plan index, so none was updated. `18-CONTEXT.md` has no C1, C2 or C7 references. `ROADMAP.md` and `STATE.md` were not edited.
5. **`18-HELD-OWNER.md`** (lane B status note, 2026-11-02) still lists D18-1 and D18-2 as open. It is outside the listed set and was not edited.

## Execution readiness

Plan text: ready in the sense that the set is named, the rulings are resolved, and the structural check is valid on all 15 plans. Blocker: the Phase 17 external gates (plans 06, 09, 12, 13) have not been checked, and no gate has run. Plan 03's two open items above also need an owner decision before its tests can be trusted.

## Not run in this cycle

No `npm`, build, test, gate or `check:pack`. No push, fetch or `gh` write. No edits outside `.planning/phases/18-per-project-sandboxes/` in the lane worktree.

## Blocker fixes

Applied to plan text only; line numbers are the pre-edit lines, and each edit is one-for-one, so they are unchanged. This section supersedes the "not changed in this record" notes at lines 65 to 67.

- B1, `18-01-PLAN.md` line 81 (C7): the completion clause (constants lowered in the same change, plan 12 amends them) is replaced with "If the host cannot hold two sessions at these bounds, plan 03 reports BLOCKED; only the owner can change these values." Applied. Holds: C7 is owner-set on 2026-11-02.
- B1, `18-03-PLAN.md` line 67: the phrase "plan 12 amends C7 only on an owner decision" is deleted; the BLOCKED sentence is kept. Applied.
- B2, `18-06-PLAN.md` line 104, `tool` bullet: prefixed with "resolveSelection first (its refusals as in step (a) and (b)); then no entry gives REALM_NOT_ACTIVE; otherwise the existing call path." Applied. Holds: C4 (`18-01-PLAN.md` line 75) requires POLICY_DENIED for an outside selection before the no-session answer, and names `tool` among the four methods.
- B3, `18-01-PLAN.md` line 47, `18-04-PLAN.md` line 52, `18-13-PLAN.md` line 45: "no git command" now reads "no git command that writes (read-only git show, grep and diff are allowed)". Applied. `18-04-PLAN.md` line 67 and `18-13-PLAN.md` line 66 hold `git grep` in action or done-when text, with no standing rule on those lines; no edit needed.
- B3, `18-01-PLAN.md` line 91 (Verify): added `git diff --numstat HEAD -- docs/integration/runtime-decision.md`, which must report zero deleted lines. Applied. The byte-identity done-when at line 90 is now checked.
- B4, `18-03-PLAN.md` line 67: the numeric pass condition is added (`MemTotal` at least 4 GiB, that is 4194304 kB in `/proc/meminfo`, and online CPU count at least 4); any lower value is BLOCKED with the values read reported. "headroom" is removed; the executor never lowers constants. Applied. Open point for the owner: `MemTotal` reads below installed RAM, so a host with 4 GiB installed may read under 4194304 kB and be BLOCKED by this rule.
- B5, `18-06-PLAN.md` line 90, resolveSelection step (a): added "and require `sessionIdOfWorkspace(entry.pinned.realPath) === selection.sessionId`, otherwise `POLICY_DENIED`" after `verifyPinnedAt`. Applied. Holds: C2 (`18-01-PLAN.md` line 71) requires that later uses check the id against `sessionIdOfWorkspace` of the pinned realpath. Matching assertion added to T1 done-when item (g) at line 97. Applied.
- Optional, `18-12-PLAN.md` line 14 (external_gates): "Phase 17 edits these three documents" is corrected to "Phase 17 plan 04 edits omp.md and runtime-decision.md, not openshell.md". Applied. Verified against `17-04-PLAN.md` frontmatter (`files_modified`: omp.md, runtime-decision.md, hardening-plan.md, AGENTS.md) and its scope, which forbids editing openshell.md.

Observed, not edited:

- `18-12-PLAN.md` line 80 says the three documents are "shared" with Phase 17 plan 04. That overstates the overlap for the same reason; it is outside the cited location, so it was left as written.
- `18-06-PLAN.md` line 104, `status` bullet, cites "step (2) of `resolveSelection`"; the function has steps (a) and (b). Not a blocker, so not edited.
- The bare "no git command" rule in `18-02`, `18-03`, `18-09` to `18-12` is unchanged. None of those plans has a git-based check, so it does not conflict.
