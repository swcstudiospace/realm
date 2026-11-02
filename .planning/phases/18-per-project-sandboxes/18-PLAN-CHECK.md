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

## Round 3 fixes

Applied to plan text only, on `gsd/v3-integrate-wave2` from head `ebf55f3`. Line numbers are the pre-edit lines. No `npm`, build, test, gate, omp, container or daemon command was run; read-only git (`show --stat`) was used to check commit `9e6ed08`.

- B6, `18-06-PLAN.md` T2 `up` action (lines 101 to 102): gap confirmed; applied. `resolveSelection` step (a) reads `selection.sessionId` (line 90), but the `up` steps did not say where `up` gets it. Holds: `18-01-PLAN.md` line 75 (C4) says `up` carries `workspaceRoot` only and the daemon derives the id; `18-05-PLAN.md` line 77 says `up` carries `workspaceRoot` only, without the derivation. Applied: a new bullet after line 101 states that dispatch canonicalizes the path with `bindRoot` and builds `selection = { workspaceRoot: realPath, sessionId: sessionIdOfWorkspace(realPath) }` before step (2); the wire never carries a `sessionId` for `up`. Done-when T1 case (h) added after line 97: a re-up of a live project returns the existing handle, adds no second registry entry and creates no second handle.
- W-4, `18-03-PLAN.md` line 67: holds; the standing rule at line 40 says "no commit". Applied: "in the commit message body and in the handoff to the parent" becomes "in the handoff to the parent".
- W-S, `18-03-PLAN.md` line 74 (stop rule): holds; the B4 threshold (`MemTotal` at least 4 GiB, 4194304 kB; online CPUs at least 4) is at line 67, but the stop rule did not name it as a BLOCKED trigger. Applied: a new bullet after line 74.
- Observed-1, `18-12-PLAN.md` line 80: holds, with a narrower overlap. `17-04-PLAN.md` `files_modified` lists omp.md, runtime-decision.md, hardening-plan.md and AGENTS.md, and its line 87 forbids editing openshell.md. Only two of this plan's three documents are shared. Applied: line 80 names omp.md and runtime-decision.md as shared and openshell.md as not shared.
- Observed-2, `18-06-PLAN.md` line 104 (`status` bullet): holds; `resolveSelection` has steps (a) and (b). Applied: "step (2) of `resolveSelection`" becomes "steps (a) and (b) of `resolveSelection`".
- W-6, `18-12-PLAN.md` line 14 (external_gates): holds; the gate names Phase 17 plan 04 without a commit. `git show --stat 9e6ed08` shows it touches AGENTS.md, docs/integration/hardening-plan.md, docs/integration/omp.md and docs/integration/runtime-decision.md, the four `files_modified` of 17-04; it is listed at `17-VERIFICATION.md` line 120. Applied: line 14 names the commit and its four files.

The two "Observed, not edited" items at lines 100 and 101 are resolved by Observed-1 and Observed-2 above.

## Round 4 fixes

Applied to plan text only, on `gsd/v3-integrate-wave2` from head `56be821`. Line numbers are the pre-edit lines. No `npm`, build, test, gate, omp, container or daemon command was run. Read-only checks only: the cited source (`src/fs/root.ts`) and the cited plan text.

- W-1, `18-06-PLAN.md` T1 `up` step (6), line 104: holds. `AdmissionLedger.reserve` returns without change for an id already committed (`18-03-PLAN.md` line 55), so a second concurrent `up` for a new id gets `fresh` false. When the first probe fails, its release removes the id. The second probe then succeeds, and step (6) built a container with no held reservation; two further ids could then take the freed slots, so the bound was exceeded. Applied: step (6) calls `reserveAdmission` again when `isCommitted(id)` is false, and a refusal there releases nothing. New done-when case T1 (i) after line 98 covers two concurrent `up` calls with a failing first probe, two further ids and the bound.
- W-2, `18-06-PLAN.md` `status` bullet, line 106: holds. The outside-root and outside-ceiling refusal comes from step (b) only; step (a) runs only for a live entry and refuses a rename or swap. Applied: "steps (a) and (b) of `resolveSelection`" becomes "step (b) of `resolveSelection`". The `tool` clause still names steps (a) and (b) and is unchanged, because it covers rename refusals as well.
- W-8, `18-06-PLAN.md` T1 done-when item (g), line 97: holds. The item asserted call order through `verifyPinnedAt` "before any other step". Applied: item (g) now asserts an observable outcome. A directory renamed away, or with another directory swapped in at its path, makes `status`, `tool` and `down` with the old selection refuse with `POLICY_DENIED`, and the registry size, `ledger.committedCount()` and the session store's `list()` are equal before and after each refused call. The code supports this: `verifyPinnedAt` (`src/fs/root.ts` lines 63 to 78) refuses a device or inode mismatch, and `openDirectoryOrDeny` (lines 111 to 117) refuses a path that no longer opens.
- W1, `18-06-PLAN.md` frontmatter `files_modified`, after line 14: holds. Line 60 allows this plan to change `test/daemon/realm-daemon-fixture.test.ts` ("any change those assertions need is made here"). Applied: `test/daemon/realm-daemon-fixture.test.ts` added after `test/daemon/e2e.test.ts`.
- Observed, not edited:
  - `18-06-PLAN.md` T2 `Files` list, line 102, still omits `test/daemon/realm-daemon-fixture.test.ts`. W1 covers the frontmatter only, as the item asked.
  - `18-06-PLAN.md` step (6), line 104: "if an entry exists" does not say whether the entry is the one read at step (2) or read again. If it is the step (2) value, a request whose probe succeeds after a concurrent request for the same id has finished step (6) (registry entry set, reservation held) builds a second handle and overwrites the registry entry. Re-reading `registry.get(id)` at step (6) would close this. It is outside the four items, so it is left for the owner.

## Round 5 fixes

Applied to plan text only, on `gsd/v3-integrate-wave2` from head `8962b53`. Line numbers are the pre-edit lines. No `npm`, build, test, gate, omp, container or daemon command was run.

- Round 4 observed item, `18-06-PLAN.md` step (6), line 106: applied. Step (6) now re-reads `registry.get(id)` synchronously after the probe, with no `await` between that read and `registry.set`, and uses that read, not the step (2) read. A concurrent request that has already set the entry for the same id is therefore seen, and no second handle is built. The rest of step (6), including the `isCommitted` and `reserveAdmission` branch, is unchanged.
- New T1 done-when case (j), `18-06-PLAN.md` after line 100: added. It covers two concurrent `up` calls for one new id whose second call completes while the first probe is still held. It asserts the same `sessionId` and `boundRoot` in both replies, one `buildHandle` call, one registry entry, and one fake podman create.

## Round 6 fixes

Applied to plan text only, on `gsd/v3-integrate-wave2` from head `e036fac`. Line numbers are the pre-edit lines. No `npm`, build, test, gate, omp, container or daemon command was run.

- B1, `18-06-PLAN.md` T1 Action, after line 97: applied. `StartDaemonOptions.onAdmit?: (sessionId: string, fresh: boolean) => void` is a synchronous test-only seam, invoked immediately after `reserveAdmission` in step (4) of `up`, with no effect when absent.
- B1 case (i), `18-06-PLAN.md` line 100: applied. The order is now: hold probe call 1 until `onAdmit` reports X2's step (4) with `fresh` false; reject probe call 1; await X1's refusal; issue Y and Z; release probe call 2. Checked against `18-03-PLAN.md` line 55: the committed set includes `reserved`, so X2's `reserveAdmission` returns false while X1 holds the reservation. The asserted results are unchanged.
- W2 case (j), `18-06-PLAN.md` line 101: applied. The second `up` for Q is issued only after `onAdmit` reports the first request's step (4) with `fresh` true.
- W1, `18-06-PLAN.md` step (5), line 107: not edited, because the premise does not hold as the plan states it. The controller part holds: `controller.create` writes the record (`persist` with a null container id) at `src/lifecycle/controller.ts` line 240, before `createContainer` (line 244) and before its `issueCreate`. The step (5) claim "no container exists" does not hold in this interleaving: request R (`fresh` true) is held in its probe; request Q2 (`fresh` false) passes its probe, finds no registry entry at step (6), sees `isCommitted` true because R holds the reservation, and so builds and creates without a new reservation. If R's probe then fails, R releases, while a record and a container for the id exist. The recorded id keeps the count, but the release is not proven as written. Owner decision needed: either step (6) re-reserves on every create path, or step (5) releases only when no registry entry and no record exists for the id.
- W3, `18-06-PLAN.md` T2 Files, line 105: applied. `test/daemon/realm-daemon-fixture.test.ts` is added, matching the frontmatter and the Verify line.
- W4, `18-12-PLAN.md` line 14: applied. Phase 17 plan 05 is HELD-OWNER (`17-SUMMARY.md` line 16) and its `files_modified` (`17-05-PLAN.md`) names `openshell.md`, `omp.md` and `runtime-decision.md`, which this plan also edits. The ordering is stated: if 17-05 lands first, this plan re-reads those three files before editing.

## Round 7 fixes

Applied to plan text only, on `gsd/v3-integrate-wave2` from head `2fedd99`. No `npm`, build, test, gate, omp, container or daemon command was run.

- W1, `18-06-PLAN.md` step (5), line 108, from round 6: applied, as a narrower sentence. The premise was checked against `src/lifecycle/controller.ts` and the ledger definition. `create` writes the record (`persist` with a null container id) at line 240, before `createContainer` (line 244) and `issueCreate`; for a session with no recovery destroy pending, that write is in the call's first synchronous turn. A recovery destroy exists only after an earlier create already wrote a record for the id, so the id is counted in either case. `AdmissionLedger` counts `recordedIds: () => store.list()` (`18-03-PLAN.md` line 55), which lists every record file. A container for the id is therefore always counted through its record before it exists, so the step (5) release never frees a slot a container uses. The round 6 interleaving (request Q2 with `fresh` false creating while R's probe is held) is covered: Q2's record exists when R releases. The claim "no container exists" was false and is removed. Re-reserving on every create path was not needed for the bound and is not adopted.

## Round 8: per-id serialization

Applied to plan text only, on `gsd/v3-integrate-wave2` from head `fa98fcc`. No `npm`, build, test, gate, omp, container or daemon command was run. Line numbers are those of `18-06-PLAN.md` at `fa98fcc`; the new line is given after the arrow.

- Design item 1, lock: added bullet `withSessionLock<T>` to T1 Action after the `resolveSelection` bullet (line 91, insertion at 92). It is exported from `src/daemon/sessions.ts`, takes the lock after dispatch derives the id and before step (1) for `up`, before the first step for `down`, releases after the reply is computed, and takes no lock for `status`, `tool` or `metrics`. The no-separate-timeout sentence is one sentence. Applied.
- Design item 2, sufficiency: added bullet "Why the lock suffices" after the lock bullet (new line 93). It states that steps (2) to (6) run after every earlier request for the id, and that `fresh` is true only when this request's `reserveAdmission` created the reservation. Applied.
- Design item 3, step (4): unchanged, `const fresh = reserveAdmission(ledger, id)` (line 110). Applied as no edit.
- Design item 4, step (5): unchanged, including the release-safety sentence (line 110). Applied as no edit.
- Design item 5, step (6), line 108 to line 110: the re-read of `registry.get(id)`, the `ledger.isCommitted(id)` re-reserve clause and the sentence about a concurrent release were removed. Step (6) now uses the entry returned by `resolveSelection` in step (2), which is current under the lock. Create-on-entry and build-and-create-otherwise are unchanged. `settleFailedCreate` is now called with `fresh`. Applied.
- Design item 6, `settleFailedCreate`, line 93 to line 95: signature is now `(ledger, sessionId, handle, fresh)`. It calls `markUnproven` or `release` only when `fresh` is true, and changes nothing when it is false. Applied.
  - Judgment: `down` does not hold a reservation, so its failed-destroy branch (line 112 to line 114) now calls `ledger.markUnproven(id)` directly, not `settleFailedCreate`. This keeps the existing effect: `markUnproven` moves the id from `reserved` to `unproven` and the committed count is unchanged, as `18-03-PLAN.md` line 55 defines.
- Design item 7, `onAdmit`: removed the paragraph at line 98. No text in any plan refers to `onAdmit` now (grep of the 15 plans). Applied.
- Design item 8, done-when cases: case (i) at line 101 to line 102 is replaced (new line 102). Case (j) at line 102 is replaced (new line 103). Case (k) is added (new line 104). Each follows the shared context. Applied.
- Design item 9, cross-references: grep of all 15 plans for `onAdmit`, `reserveAdmission`, `settleFailedCreate`, `fresh`, `step (6)`, `re-reserv`, `isCommitted` and `unproven`. The only plan text with these references was `18-06-PLAN.md`. `18-03-PLAN.md` lines 24 and 55 describe `reserve`, `markUnproven` and `release` and remain correct. `18-01-PLAN.md` line 87 (C10) and the other plans contain no reference to the removed behaviour. No other plan was changed. Applied as no edit.
- Not edited: this section and the earlier round records keep their references to `onAdmit` and the earlier step (6) text, because they record what each round did.
- Acceptance check: `onAdmit` no longer appears in `18-06-PLAN.md`. `withSessionLock` is defined once, in T1, and used by `up` and `down`. `settleFailedCreate` changes the ledger only when `fresh` is true. Cases (i), (j) and (k) are as in the shared context.
