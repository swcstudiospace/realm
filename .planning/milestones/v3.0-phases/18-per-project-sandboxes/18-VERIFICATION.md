---
phase: 18-per-project-sandboxes
verified: 2026-11-15
verdict: passed
status: passed
ref: gsd/phase-18-complete da0733a (on origin/gsd/phase-18-gaps 4ad91be)
supersedes: .planning/phases/18-per-project-sandboxes/18-VERIFICATION.md at 55832e6 (gaps_found, verified 2026-11-10)
---

# Phase 18: Per-project sandboxes: Re-verification at da0733a

**Goal:** Two projects under the configured roots each get their own active sandbox, workspace, audit file and lock table, and taking one down leaves the other running.

**verdict: passed.** All five roadmap success criteria for Phase 18 and requirements MULTI-01 to MULTI-06 have evidence on this tree. The live two-project scenario passed at 4ad91be (37 of 37). The tree differs from 4ad91be only by fourteen `.planning/` summary files, so the live result applies to the code on this tree. The previous report at 55832e6 (gaps_found) is superseded. Its gaps were the three partial plan gaps (18-06, 18-09, 18-11), which are closed on this branch, and the missing live two-project run, which has now passed.

**Method.** Worktree `<tmp>` at `gsd/phase-18-complete` da0733a. Static reads and greps of source, tests, docs and the phase summaries. The live TAP file was read, read-only, at `<home>/realm-evidence/phase14/14-live-main4-4ad91be.txt`. No tests, lint, typecheck, build, formatters or `check:docs` were run. Test results cited below come from that TAP file and from the phase summaries, not from a re-run. Nothing was committed. Line numbers are at da0733a.

## Goal Achievement: Roadmap Success Criteria

Criteria text: `.planning/ROADMAP.md` lines 486 to 494.

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | `docs/integration/runtime-decision.md` records one session per project workspace, superseding one session per daemon, in a commit that precedes the code that needs it (MULTI-01) | VERIFIED | Section "Per-project sessions (Phase 18, MULTI-01)" at `runtime-decision.md:444-473`; line 448 states the decision and names "one session per daemon" as superseded. Commit `0d299a0` (2026-10-30) records it. The contract section (`runtime-decision.md:475`, commit `4bfca1a`, 2026-11-02 21:00) precedes the first Phase 18 code, `86e5cc2` (2026-11-02 21:12), which introduces `sessionIdOfWorkspace` (`src/session/paths.ts:70`). All three are ancestors of HEAD. The fixed id `"daemon"` is absent from `src/daemon/main.ts`. |
| 2 | Two `realm up` calls from two project directories under the configured roots yield two active sandboxes `realm-<sessionId>` with distinct `/workspace` contents; a write in one is not visible in the other; the compute driver and gateway contract carry the workspace per sandbox (MULTI-02, MULTI-04, MULTI-05) | VERIFIED | Live: TAP `ok 11 - production live: two projects get their own sandboxes, workspaces and sessions, and down of one leaves the other active` (4ad91be). Scenario source `test/integration/production-driver.test.ts:1072-1170`: distinct session ids (`:1116`); exactly one `/workspace` mount per sandbox, each sourced from its own canonical project (`:1118-1126`); each sandbox reads its own marker (`:1128-1134`); a file written only in A is absent from B's sandbox and B's host directory (`:1136-1141`). Code: `up` reaches `admitUp` (`src/daemon/daemon.ts:360`), which resolves the selection (`:370`) before any reservation or probe. The sandbox name is `sandboxNameOfSession` (`src/session/paths.ts:80`, `realm-` + id). The driver resolves each sandbox's `/workspace` from its registry entry (`src/runtime/driver/compute-driver-create.ts:61-90`; ceiling check `:81`; pinned identity check `:84`). The binding is rw at `/workspace` (`src/runtime/driver/sandbox-binding.ts:18-31`). The driver's ceiling is `src/runtime/driver/compute-driver.ts:124-126`. |
| 3 | `realm down` for one project leaves the other active, and each session has its own record, pinned subdirectory, bind mount, audit file, lock table and status snapshot; unit tests cover the per-session pin (MULTI-03, MULTI-05) | VERIFIED | Live step (6) of `ok 11`, `production-driver.test.ts` after `:1141`: `down` of A removes its sandbox, its session record and its registry entry; `audit/<idA>.jsonl` is kept; B stays active and its sandbox still answers with B's marker. Teardown order in code: `daemon.ts:455` (`controller.destroy()`), `:461` (`removeWorkspaceEntry`), `:462` (`ledger.release`), `:463` (`registry.delete`). Per-session record: `recordFileName` (`src/session/paths.ts:29`). Per-session registry: `src/session/workspace-registry.ts` (`writeWorkspaceEntry`, `readWorkspaceEntry`, `removeWorkspaceEntry`). Per-session audit file: `<stateDir>/audit/<sessionId>.jsonl` (`src/audit/log.ts:2`). Per-session lock table: one `LockTable` per handle, shared by controller and dispatcher (`src/realm/compose.ts:66`, `:77-94`). Per-session status snapshot: `resolved.entry.handle.controller.snapshot()` in the `status` case (`daemon.ts`, `status` branch of `dispatch`). Unit tests for the per-session pin: `test/session/paths.test.ts:35-81` (aliases give one id; sandbox name fits the gateway limit), `test/session/workspace-registry.test.ts:56-105` (mode 0600 in 0700, five-field contract, mismatched id refused, wrong-mode directory refused with `POLICY_DENIED`), `test/daemon/daemon.test.ts` T1 (g) (renamed directory refused), T2 (f) and T2 (i) (per-session `session.destroy` audit line). |
| 4 | A directory outside every configured root is refused with `POLICY_DENIED` (MULTI-02) | VERIFIED | `src/daemon/sessions.ts:89-107` (`resolveSelection`): `bindWorkspaceUnderPolicy(policy.workspaceRoots, …)` (`src/fs/root.ts:45`) refuses a path outside the policy roots, and the configured ceiling check at `:99-102` throws `POLICY_DENIED`. `admitUp` calls `resolveTarget` (`daemon.ts:370`) before `reserveAdmission` (`:391`) and the probe (`:399`), so no state changes first. Test: `test/daemon/daemon.test.ts:2080-2091` (T1 (a): `up` for a directory outside every policy root is `POLICY_DENIED`, with no probe and no container created). CLI: `test/cli/cli.test.ts:1104-1110` (`status` to a path outside the roots prints `POLICY_DENIED`, exit 1) and `:1112-1130` (`status`, `metrics` and `down` each print `POLICY_DENIED` and send one request). |
| 5 | The aggregate memory and CPU commitment of concurrent sessions is bounded and documented, using existing configuration and no new catalogue code (MULTI-06) | VERIFIED (interpretation, see residual 4) | Constants `src/runtime/hardening.ts:53-56` (`aggregateMemoryBytes` 4 GiB, `aggregateNanoCpus` 4e9). Derivation `:115-125`: `min(floor(4 GiB / 1 GiB), floor(4e9 / 2e9)) = min(4, 2) = 2`. `MAX_CONCURRENT_SESSIONS` (`:131`) is the daemon's default `maxSessions` (`src/daemon/daemon.ts:238`). Refusal at the bound: `src/daemon/admission.ts:37-38`, `POLICY_DENIED`, before anything is recorded. No new catalogue code: `git diff 4bfca1a^ HEAD -- src/core/errors.ts` adds two comment lines and no code. Documented: `docs/integration/openshell.md:326-331`, and `runtime-decision.md:497` (C7). Tests: `test/runtime/hardening.test.ts:881-913` (bound is 2; memory and CPU terms each bind; aggregate fields are in the digested profile); `test/daemon/admission.test.ts:17-125` (a third reservation is refused and the count stays 2; a failed removal keeps its slot). |

## Requirements Coverage: MULTI-01 to MULTI-06

| Requirement | Criteria | Status | Evidence |
| --- | --- | --- | --- |
| MULTI-01 | 1 | SATISFIED | `runtime-decision.md:444-473`; commit order above. |
| MULTI-02 | 2, 4 | SATISFIED | Containment and identity: `src/daemon/sessions.ts:89-107`, `src/session/paths.ts:70-80`; equality reading ratified by owner (C2, `runtime-decision.md:487`); refusal test `daemon.test.ts:2080-2091`. |
| MULTI-03 | 3 | SATISFIED | Per-session record, registry, audit, lock table and snapshot (criterion 3); live `ok 11` step (6). |
| MULTI-04 | 2 | SATISFIED (see residual 5) | Driver per-sandbox `/workspace` from the registry entry (`src/runtime/driver/compute-driver-create.ts:61-90`); adoption re-verifies the same binding (`src/runtime/driver/lifecycle.ts:603-611`); selection on every project-addressed request (`src/daemon/channel.ts:93-160`). PRD-DRV-01 is not amended (`runtime-decision.md:470`). |
| MULTI-05 | 2, 3 | SATISFIED (live) | TAP `ok 11`, 4ad91be; scenario `production-driver.test.ts:1072-1170`. Surfaces: `test/surfaces/daemon-equivalence.test.ts` (two projects, offline). |
| MULTI-06 | 5 | SATISFIED (see residual 4) | `hardening.ts:53-56, 115-131`; `admission.ts:37-38`; `openshell.md:326-331`; `runtime-decision.md:497`. |

## Live Evidence

File: `<home>/realm-evidence/phase14/14-live-main4-4ad91be.txt`, read-only. TAP 13, with `# tests 37`, `# pass 37`, `# fail 0`, `# cancelled 0`, `# skipped 0`, `# todo 0`. Scenarios 1 to 13 pass, including the two-project scenario (`ok 11`). The file names the commit 4ad91be but records no commit inside it. Identity therefore rests on the file name and on the delta check: `git diff --name-only 4ad91be HEAD` lists only the fourteen `.planning/phases/18-per-project-sandboxes/` files.

## Residuals (not verdict-blocking)

1. **C5 lifecycle wording (owner decision open).** `runtime-decision.md:493` says a `down` that leaves no live session stops the daemon, and that a `down` of one project never stops it while another is live. Criterion 3 depends only on the second rule, which the live step (6) asserts. The owner's open point does not change any criterion.
2. **Plan 18-11 `down` wording (owner decision open).** `18-11-PLAN.md:39-40` and `18-11-SUMMARY.md` restrict project-local `down` to the CLI and selected control channel. MCP and Omp issuing `down` remains unverified. Roadmap criterion 3 names `realm down`, which is the CLI path, so this is not blocking.
3. **`.planning/REQUIREMENTS.md` not reconciled.** The MULTI checkboxes at lines 84 to 90 are still `[ ]`. Rows 209 to 214 still read "live acceptance open". Row 213 (MULTI-05) cites the second window that failed at first `up` with `OPENSHELL_START_FAILED`. The 4ad91be run supersedes that window. This report does not edit REQUIREMENTS.md; it needs a GSD workflow update.
4. **MULTI-06 wording.** The two aggregate constants live in the code profile `HARDENING_PROFILE` (`src/runtime/hardening.ts:53-56`), not in a user configuration key. C7 records this choice, and the owner set the values on 2026-11-02 (D18-2). No catalogue code was added. If "existing configuration" is read as user configuration only, MULTI-06 needs a fresh owner ruling.
5. **MULTI-04 gateway carriage.** The gateway request carries only the sandbox name. The driver resolves the workspace from the registry entry (C3, `runtime-decision.md:489`). C3 is an engineering decision, not owner-ratified, and it passed the plan check. C3 rejected a gateway workspace selector because the pinned CLI has no evidence for one.
6. **Live run not re-executed.** The 4ad91be result is taken from the TAP file. Code identity was checked by the delta above only.
7. **Lock table and status snapshot.** Per-session lock tables and snapshots are verified by code (`compose.ts:66`, `daemon.ts` `status` branch) and unit tests. The live file does not observe them separately.
8. **Phase 17 precondition.** `18-SUMMARY.md` records that the Phase 17 plan 03 scenario 6 and skip-path checks have not run (`17-VERIFICATION.md` rows T2 and T3). These are outside Phase 18's criteria.
9. **Owner decisions of 2026-11-08.** The `TOOL_TIMEOUT` text is kept. `startupBudgetMs` is capped at 200000. The seven pre-record commits `4bfca1a` to `e2baed6` stand. Human review remains required before merge (`18-HELD-OWNER.md`).
10. **Gates not run here.** The 4ad91be hermetic suite (3028 pass, 0 fail, 40 skipped) is as reported in the verification brief and was not re-run. The Phase 18 gate figures in `18-SUMMARY.md` are historical.

## Verdict

verdict: passed

All five roadmap success criteria, and requirements MULTI-01 to MULTI-06, have evidence on `gsd/phase-18-complete` da0733a. That evidence is the source at this commit and the live two-project scenario passed at 4ad91be (37 of 37). Residuals 1 to 10 are recorded. None of them leaves a criterion unmet.

_Verified: 2026-11-15_
_Verifier: Claude (gsd-verifier)_
