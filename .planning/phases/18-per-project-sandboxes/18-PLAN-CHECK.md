# Phase 18 plan check (GSD plan-checker record)

**Scope checked:** `18-01-PLAN.md` to `18-14-PLAN.md`, read with `18-CONTEXT.md` and `18-HELD-OWNER.md`.
**Base:** worktree `gsd/v3-runtime-wave2` at HEAD `9ab241f`. The checker commit `c3c6366` recorded these plans as revision 4, not execution-ready.
**Method:** the checker's dimensions (`gsd-plan-checker.md`), with read-only `grep` over `src/` and `test/` at this revision to confirm call sites, helper names and line references.

## Verdict

**BLOCKED.** One BLOCKER remains after repair cycle 1. It is not committed.

| Plan | Dimension | Severity | Required property | Evidence |
| --- | --- | --- | --- | --- |
| 18-04 | scope_sanity (Dimension 5) | BLOCKER | Each plan's `files_modified` stays below the blocker threshold of 15 files | Frontmatter lists 20 files (5 `src/`, 15 `test/`). Re-slicing needs at least three plans, which renumbers the set that D18-1 names as "the 14 plans on HEAD". This is an owner or planner decision, not a repair within the plan files. |

## Findings named in c3c6366

1. **Wave 3 fixture: closed.** Plans 04 and 05 share no file (set intersection of their frontmatter). Shared fixtures are now owned in wave order:
   - `test/daemon/realm-daemon-fixture.test.ts`: plan 05 (wave 3) edits call sites, compile only. Plan 06 (wave 4) is its runtime owner and verifies it (`18-05` and `18-06`).
   - `test/support/realm-daemon-fixture.ts`: plan 06 (wave 4) removes the literal `sess-harness` id. Plan 11 (wave 7) adds `selectionFor` and `connectFor` (`18-06` and `18-11`).
   - `test/surfaces/daemon-equivalence.test.ts`: plans 05, 06, 11 in that order.
   - Other cross-wave overlaps are serialized by `depends_on`: `src/daemon/daemon.ts` (04, 06, 09), `src/daemon/main.ts` and `test/daemon/daemon.test.ts` and `test/daemon/main.test.ts` (06, 09), `src/cli/main.ts` and `test/cli/*` (05, 08), `src/omp/extension.ts` and `test/omp/*` (05, 10), `test/runtime/sandbox-binding.test.ts` (04, 07).
2. **Live call sites: closed, with the following repairs.**
   - Plan 04: the enumeration already covers `test/runtime/session-execution.test.ts` lines 145 to 1503, including the loop at 643 to 657 (site 6) and the helper line 1237 (site 5). `ComputeDriver` importers (`test/runtime/driver/*`) are all in the frontmatter. `driver-lifecycle.test.ts` uses `DriverLifecycle`, not `ComputeDriver`, so it needs no change.
   - Plan 05: added the `daemonAnswers` sites in `test/daemon/ensure.test.ts` (206, 221, 230, 238, 242), the `ConnectDaemon` fakes at `test/cli/cli.test.ts:125` and `test/cli/mcp-attach.test.ts:148`, and the 18 remaining `connectDaemon` and six `client.up` sites in `test/daemon/client.test.ts`. Five real-daemon cases (322, 341, 360, 381, 399) are removed.
   - Plan 06: `daemon.test.ts` handle lines were stale. Corrected 966, 994, 1608 to 1005, 1033, 1647 (853 was already right). Added the six `buildDaemonHandle(options)` calls (240, 276, 291, 340, 374, 401), which need an explicit `sid(fixture.ws)` because `BuildDaemonHandleOptions` keeps `sessionId`. Also covers the literal at 270 and the `appendAudit` literal at 913.
   - Plan 09: line references for `daemon.test.ts` (511 to 523, 623 to 636) and `main.test.ts` (75 to 77, 148, 152, 387, 407, 442, 465) match this revision.
   - Plan 13: added the `sandboxExec` callers, `production-driver.test.ts:211` and `omp-ompx05.test.ts:241,243`.
   - Plan 08, 10, 11: callers enumerated by symbol and checked against the grep (`cli.test.ts` `ACTIVE_DAEMON_STATUS` at 778, `extension.test.ts` `ACTIVE_STATUS` at 17, `daemon-health.test.ts` nine sites).
3. **Stop rule: closed.** Every plan now has a bullet "Stop rule (plan-check finding 3, repair cycle 1)" stating that a failing or non-running check stops that plan at that task, starts no dependent plan, and is reported to the parent as BLOCKED. Plan 14 has a checkpoint form of the same rule.

## Other checks

- Requirement coverage (Dimension 1): MULTI-01 to MULTI-06 are each claimed by at least one plan's frontmatter, and the roadmap line 472 lists the same six IDs. Pass.
- Dependencies (Dimension 3): no cycles, no forward references. Every wave equals `max(deps)+1` except plan 10. It is in wave 6, while `max(deps)+1` is 5 (its deps are 05 and 06). This is ordering-safe, so it is INFO only.
- Scope reduction (Dimension 7b): no reduction language in the tasks. Matches on "skip gate" and "Rejected alternatives" are the gate and the rejected-option record, not omissions.
- Verify commands (Dimension: verify format): the `grep -c` gates return 0 at HEAD (`^## Per-project session contract`, `Resource bound (Phase 18, MULTI-06)`, `Status: implemented, unverified`), so none already passes. `scripts/check/host-paths.mjs`, `npm run typecheck`, `npm run check:docs` and `npm run build` exist.
- Context compliance (Dimension 7): the locked D5(i) and "explicit reading of containment" decisions are present in C2. The aggregate constants (C7) are engineering proposals and are listed below.

## Warnings not fixed

- Plan 05: 14 `files_modified` (warning band 10 to 14). Fixing this means splitting, which is the same re-slice as the BLOCKER.
- Plan 06: 10 `files_modified` (warning band), with two tasks of large text.

## Owner or planner decisions needed

1. **D18-1 (owner or planner):** re-slice plan 04 into plans of at most 14 files, which renumbers the set named in D18-1. Until then, no Phase 18 execution starts.
2. **D18-2 (owner):** ratify C1 (hash encoding), C2 (equality reading of containment) and C7 (aggregate constants 4 GiB and 8e9 nanoCpus, derived `maxSessions = 4`). These are engineering proposals in plan 01 and are the owner-open items in `18-HELD-OWNER.md`.
3. **Phase 17 external gates:** plans 06, 09, 12 and 13 name Phase 17 plans 02 to 04 as merged. `17-SUMMARY.md` exists. The per-plan merge state was not checked here.

## Files changed in this cycle (uncommitted)

All under `.planning/phases/18-per-project-sandboxes/`: `18-01` to `18-14-PLAN.md` (stop rules, fixture ownership, call-site enumerations, the 18-06 line and `buildDaemonHandle` corrections), and this file. No source, test or doc outside the phase directory was edited. No commit was made because the verdict is BLOCKED.
