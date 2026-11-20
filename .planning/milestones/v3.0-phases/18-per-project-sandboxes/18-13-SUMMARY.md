---
phase: 18-per-project-sandboxes
plan: 13
subsystem: test
tags: [live-tests, two-projects, derived-sandbox-names, multi-tenancy, skipped-by-default]
requires: ["18-07", "18-11"]
provides:
  - "test/integration/production-driver.test.ts: scenario 'production live: two projects get their own sandboxes, workspaces and sessions, and down of one leaves the other active', gated by productionSkipReason"
  - "test/support/production-live.ts: sessionIdFor and sandboxNameFor derive each workspace's session id and sandbox name; realmCliWithWorkspace runs status and down with --workspace"
  - "Live suites name no fixed daemon session, sandbox or audit file (realm-daemon, audit/daemon.jsonl, DAEMON_SESSION_ID, DAEMON_SANDBOX_NAME removed from the four files)"
affects: [test/support/production-live.ts, test/integration/production-live-helpers.test.ts, test/integration/production-driver.test.ts, test/integration/omp-ompx05.test.ts, 18-14]
key-files:
  created: []
  modified:
    - test/support/production-live.ts
    - test/integration/production-live-helpers.test.ts
    - test/integration/production-driver.test.ts
    - test/integration/omp-ompx05.test.ts
decisions:
  - "The scenario computes every expected name with sandboxNameOfSession(sessionIdOfWorkspace(realpath(...))); no name is copied from a fixture"
  - "down takes a workspace (default: the pinned root), so the two-project cleanup can run down for each project"
  - "realmCliWithWorkspace refuses any command other than status and down, because up takes --workspace through realmCli"
requirements: [MULTI-04, MULTI-05]
metrics:
  tasks: 2
  commits: 1
  completed: 2026-11-03
commits: 1
status: complete
---

# Phase 18 Plan 13: the two-project live scenario, written and not run (MULTI-04, MULTI-05) Summary

The two-project live scenario and the derived-name helpers are authored in one commit (b18b20e). The scenario is skipped by the existing gate in a default run. Nothing in this plan ran the scenario; the live run is plan 14.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| T1 | two-project scenario, skip-gated | b18b20e | test/integration/production-driver.test.ts |
| T2 | derived names, residue helpers, existing suites migrated | b18b20e | test/support/production-live.ts, test/integration/production-live-helpers.test.ts, test/integration/production-driver.test.ts, test/integration/omp-ompx05.test.ts |

Both tasks landed in one commit, not one per task.

## What was added

- `test/support/production-live.ts:429-435`: `sessionIdFor(workspaceRoot)` and `sandboxNameFor(workspaceRoot)` compute `sessionIdOfWorkspace(realpathSync(...))` and `sandboxNameOfSession` of it. The fixed `DAEMON_SESSION_ID` and `DAEMON_SANDBOX_NAME` exports are gone. `realmCliWithWorkspace` (`:638-648`) appends `--workspace <workspace>` for `status` and `down` only.
- `test/integration/production-driver.test.ts:1072`: the scenario, with `{ skip: gate }`. `gate` is `productionSkipReason(...)` at `:131`. Its steps:
  1. `realm up --workspace A` exits 0; `status` reports `active` with `sessionId` equal to A's derived id.
  2. `realm up --workspace B` exits 0; `status` reports `active` with B's id; the two ids differ.
  3. Each derived sandbox has exactly one mount at `/workspace`, sourced from its own project's realpath; the two sources differ.
  4. `cat /workspace/marker.txt` in each sandbox returns that project's bytes.
  5. `only-in-a.txt` written in A's sandbox is absent in B's sandbox and in B's project directory on the host.
  6. `down --workspace A` removes A's sandbox containers and sandboxes, session record and registry entry, and keeps `audit/<idA>.jsonl`; B's `status` is `active`; B's sandbox still reads B's marker.
  7. `t.after` runs `down` for both projects, removes the directories and the scenario root, and waits for residue of the two derived names only.
- `test/integration/production-live-helpers.test.ts:694-703`: a case that `sandboxNameFor` equals the derived name and is at most 19 characters.
- `test/integration/omp-ompx05.test.ts:135-136`: the session id and sandbox name come from `sessionIdFor` and `sandboxNameFor` of the suite's own workspace. The audit-file comments at `:9` and `:291` now name `<session id>`, not `daemon.jsonl`.
- `test/integration/production-driver.test.ts`: the upload, download, container and residue assertions use the derived name of the suite's own workspace. The `exec` helper calls `sandboxExec` with `sessionIdFor` of its workspace.

## Verification

Checked by reading the code and history in this lane. Nothing was run.

- VERIFIED: b18b20e is an ancestor of the worktree head (4ad91be) and of origin/main. Its stat lists exactly the four files in `files_modified`.
- VERIFIED: the scenario name begins "production live: two projects" and uses `{ skip: gate }` (`production-driver.test.ts:1072`, gate at `:131`).
- VERIFIED: steps 1 to 7 exist in the code as described above.
- VERIFIED: a grep for `realm-daemon[^-]`, `audit/daemon.jsonl`, `DAEMON_SANDBOX_NAME` and `DAEMON_SESSION_ID` over the four named files returned no match. `omp-guard.test.ts` was not checked, because it is outside the plan's files.
- VERIFIED: the helper test asserts the 19-character bound (`production-live-helpers.test.ts:697-699`).
- NOT VERIFIED: `npm run typecheck`, the plan's verify command. It was not run, per this lane's contract.
- NOT VERIFIED here: the live run of the scenario. The audit facts record plan 14's run on 4ad91be: 37 tests, 37 pass, including the two-project scenario. Evidence `<home>/realm-evidence/phase14/14-live-main4-4ad91be.txt`. That file is not readable from this worktree, so this summary cites the audit facts only.

## Deviations from Plan

**1. Single commit for both tasks.** Both tasks landed in b18b20e. The plan did not say one commit per task.

**2. Line references.** The audit cited `production-live.ts:429-433`. The definitions span `429-435`.

**3. Recorded live results disagree.** `.planning/REQUIREMENTS.md:213` and `18-11-SUMMARY.md` record an earlier live window that failed at the first `up` with `OPENSHELL_START_FAILED`. The audit facts record plan 14's pass on 4ad91be. This summary does not reconcile them, and it edits no other file. The owner should check whether the failed window predates 4ad91be, then update REQUIREMENTS.md.

**Total deviations:** 3. None changed behavior; item 3 is an open record question.

## Issues Encountered

None in the code. The plan's stop rule was not triggered, because no verify command was run in this lane.

## Known Stubs

None.

## Threat Flags

None. The scenario reads mounts and runs `cat` and `sh` through the realm's own exec argv. It writes only into the test's temporary project directories.

## Next Phase Readiness

Plan 14 is the only consumer that runs this code, under the owner's live window and the shared live lock. Any new live suite must use `sessionIdFor` and `sandboxNameFor`, not the removed fixed names.

---
*Phase: 18-per-project-sandboxes*
*Completed: 2026-11-03*

## Self-Check: PASSED (code and history checks only; typecheck and live run not performed in this lane)
