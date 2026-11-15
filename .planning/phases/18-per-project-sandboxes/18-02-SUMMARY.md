---
phase: 18-per-project-sandboxes
plan: 02
subsystem: session
tags: [identity, workspace-registry, runtime-roots, multi-project, contract-C1, contract-C3]
requires: ["18-01"]
provides:
  - "sessionIdOfWorkspace: the one id derivation from a canonical project path (p + 12 hex of SHA-256)"
  - "sandboxNameOfSession: realm-<id>, refused above the 19-character gateway limit"
  - "workspace registry: write, read, remove, list and verify one entry at <stateDir>/workspaces/<id>.json"
  - "RuntimeRoots.stateDir, the fourth value both the driver and the daemon derive from config.json"
affects: [18-04 driver, 18-05 channel, 18-06 daemon, 18-07, 18-10, 18-11, 18-13]
key-files:
  created:
    - src/session/workspace-registry.ts
    - test/session/paths.test.ts
    - test/session/workspace-registry.test.ts
  modified:
    - src/session/paths.ts
    - src/runtime/config.ts
    - test/runtime/config.test.ts
decisions:
  - "The id is 'p' + the first 12 lowercase hex characters of SHA-256 over the UTF-8 canonical path (contract C1, owner-confirmed 2026-11-02). The sandbox name is realm-p<12 hex>, 19 characters."
  - "sandboxNameOfSession restates the 19-character limit as a local constant and does not import src/runtime/openshell.ts; the test imports GATEWAY_SANDBOX_NAME_MAX_LENGTH and asserts the two agree."
  - "Registry directory mode 0700 and file mode 0600 are enforced; a directory at another mode is POLICY_DENIED and a symbolic link at the directory or file name is refused (PATH_ESCAPE)."
  - "The registry reader is the single place a sandbox id is turned into an entry; the host-path decision is taken in the driver (plan 04), not here."
requirements: [MULTI-02, MULTI-04, MULTI-05]
metrics:
  tasks: 3
  commits: 1
  files_created: 3
  files_modified: 3
status: code-present; tests-not-run-in-this-summary
actuals:
  commit: 86e5cc2
  wave: 2
---

# Phase 18 plan 02 (unit I1): canonical identity and the workspace registry Summary

Commit 86e5cc2 adds the one session-id derivation from a canonical project path, the per-project workspace registry that the driver will read to turn a sandbox name back into a host path, and the `stateDir` field on `RuntimeRoots`. No daemon, driver or CLI behaviour changes in this commit.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| T1 | one id function from a canonical workspace path | 86e5cc2 | src/session/paths.ts, test/session/paths.test.ts |
| T2 | the workspace registry: write, read, verify one entry | 86e5cc2 | src/session/workspace-registry.ts, test/session/workspace-registry.test.ts |
| T3 | RuntimeRoots carries the state directory | 86e5cc2 | src/runtime/config.ts, test/runtime/config.test.ts |

All three tasks landed in the single commit 86e5cc2 (`feat(phase-18): session identity, workspace registry and runtime stateDir (MULTI-02, MULTI-04, plan 02)`; 6 files, 518 insertions, 3 deletions).

## What was added

- `src/session/paths.ts` (at 86e5cc2: constants 38-45, `sessionIdOfWorkspace` 49-54, `sandboxNameOfSession` 59-64, path check after them): `WORKSPACE_SESSION_PREFIX = "p"`, `WORKSPACE_ID_HEX_LENGTH = 12`, `sessionIdOfWorkspace(canonicalPath)` (refuses a path that is not absolute and normalized, or that has a trailing separator other than `/`, with `SCHEMA_INVALID`), and `sandboxNameOfSession(sessionId)` (refuses an id outside `isSessionId` or a name over 19 characters, with `SCHEMA_INVALID`).
- `src/session/workspace-registry.ts` (179 lines at 86e5cc2): `workspaceRegistryDirOf`, `WorkspaceEntry` (exactly `schema`, `sessionId`, `workspaceRoot`, `dev`, `ino`), `writeWorkspaceEntry` (refuses an id that is not the id of the pinned real path; creates the directory at 0700, refuses a directory at another mode or a link; writes through `atomicWriteFile` with `expectedPriorSha256`), `readWorkspaceEntry` (refuses a file whose id does not match its name, whose `workspaceRoot` does not derive that id, or whose field set or types are wrong), `removeWorkspaceEntry`, `listWorkspaceEntryIds` (names only; no file is opened), and `verifyWorkspaceEntry` (re-pins `workspaceRoot` against the stored `dev` and `ino` through `verifyPinnedAt`; a moved or replaced directory is `POLICY_DENIED`).
- `src/runtime/config.ts` (at 86e5cc2: `RuntimeRoots.stateDir` at line 27, `runtimeRootsOf` at 93-103): `runtimeRootsOf` returns `stateDir: config.stateDir` as a fourth field. No other field is added, and the comment names the state directory as the fourth shared value.
- Tests at 86e5cc2 (names as written in the files):
  - `test/session/paths.test.ts`: 7 cases (lines 35-79): aliases of one directory give one id; different directories give different ids; id is prefix plus 12 hex, matches `isSessionId`, has length 13; sandbox name fits the gateway limit and `GATEWAY_SANDBOX_NAME_MAX_LENGTH` equals 19 (the only import from `src/runtime/openshell.ts`, in the test); `sandboxNameOfSession` refuses a bad id; `sessionIdOfWorkspace` refuses a relative path, a trailing separator and dot segments; `/` is accepted.
  - `test/session/workspace-registry.test.ts`: 15 cases (lines 55-207): round trip at 0600 in a 0700 directory; exactly five fields; write under a foreign id is `SCHEMA_INVALID` and writes nothing; a registry directory at another mode is `POLICY_DENIED`; an entry renamed to another session's file name is `SCHEMA_INVALID`; a moved `workspaceRoot` is `POLICY_DENIED` from `verifyWorkspaceEntry`; a directory replaced at the path by rename-aside is `POLICY_DENIED`; a symbolic link at the entry name is `PATH_ESCAPE` and the outside file is not read; `workspaceRoot` naming another directory is `SCHEMA_INVALID`; schema not 1 and an extra field are `SCHEMA_INVALID`; absent entry and absent directory read as null; remove of an absent id is a no-op; list ignores non-`.json` names, directories and bad stems and sorts the rest; list of an absent directory is empty.
  - `test/runtime/config.test.ts` (lines 152-160): the whole-object expectation of `runtimeRootsOf` includes `stateDir: "/var/lib/realm/state"`, and a separate assertion checks `runtimeRootsOf(config).stateDir === config.stateDir`. The other expectations in the test are unchanged in the commit diff.

## Verification

- Code and test presence at 86e5cc2: VERIFIED by `git show` of the six files at that commit (names of all 15 registry tests, 7 paths tests and the config expectation read; rename-aside test body at lines 114-124 read; `sessionIdOfWorkspace`, `sandboxNameOfSession`, the write, read and verify functions read).
- Mode bits: VERIFIED in code. `TEMP_FILE_MODE = 0o600` in `src/fs/atomic-write.ts:63`, and the registry directory check `(mode & 0o777) !== 0o700` in `assertPrivateDirectory` (workspace-registry.ts, 128-138).
- The 19-character agreement: VERIFIED in test source (`paths.test.ts`, the "two limits agree" case).
- Test pass results: NOT VERIFIED. The plan's verify commands (`npm run build && node --test dist/test/session/paths.test.js`, `... workspace-registry.test.js`, `... config.test.js`) were not run for this summary, and the audit gives no run record for 18-02.
- Downstream use of `sessionIdOfWorkspace` by plans 04, 05, 06, 07, 10, 11, 13: NOT VERIFIED in this summary; not re-audited here.
- The plan's claim that `test/cli/init.test.ts` reads `RuntimeRoots` fields only: NOT VERIFIED (not opened).

## Deviations and notes

**1. [Plan wording vs code] Identity is checked at verify time, not at read time.**
- The plan's first truth says a read of an entry whose "id, path or identity" does not match fails with `SCHEMA_INVALID` or `POLICY_DENIED`.
- At 86e5cc2, `readWorkspaceEntry` refuses a mismatched id (file name vs `sessionId`) and a `workspaceRoot` that does not derive the id, both `SCHEMA_INVALID`. It does not compare `dev` and `ino`. That comparison, and the moved or replaced path check, happen in `verifyWorkspaceEntry` and return `POLICY_DENIED`. The driver (plan 04) must call both.

**2. [Plan vs code] Sandbox limit restated, not imported.**
- `sandboxNameOfSession` uses a local `SANDBOX_NAME_MAX_LENGTH = 19`, following the comment at paths.ts 41-43, so `paths.ts` does not depend on `src/runtime/openshell.ts`. The test asserts the two values agree.

**3. [Extra coverage] Tests beyond the plan's done-when list.**
- The symbolic-link case (`PATH_ESCAPE`), the schema and extra-field cases, and the list and remove cases were added. They do not change the required behaviour.

**4. [Branch drift after 86e5cc2, not 18-02 work] Later commits changed the same files.**
- `5ddc95e` (lint fix, 2 lines in `test/session/workspace-registry.test.ts`).
- `c9a59d5` (phase 19, +21 lines in `src/session/paths.ts`).
- `835fb9c` (checkpoint, `src/session/workspace-registry.ts` +25/-9, adds `workspaceEntryOf` at HEAD:40, and +12 test lines).
- `7bb6316` (phase 15-04, `src/runtime/config.ts` +102 and `test/runtime/config.test.ts` +97; overlap refusal and `describeRuntimeConfigProblems`).
- Line numbers above are from 86e5cc2. The audit's ranges (`src/session/paths.ts:59-93`, `src/session/workspace-registry.ts:33-186`, `src/runtime/config.ts:23-28, 138-149`) are from main ea07518 and are kept as audit references only. Claims about current content of these files are not made here.

## Issues Encountered

None recorded for this plan. No test was run in writing this summary.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. The registry directory and entries are mode 0700 and 0600, a link at either name is refused, and a moved or replaced workspace is refused by the pin check.

## Next Phase Readiness

- Plan 04 (driver) imports `sessionIdOfWorkspace`, `sandboxNameOfSession`, `readWorkspaceEntry`, `verifyWorkspaceEntry` and `RuntimeRoots.stateDir`. It must call `verifyWorkspaceEntry` as well as `readWorkspaceEntry`, because the identity check is there (deviation 1).
- Plan 06 (daemon) imports the write, remove and list functions.
- The test run that the plan's verify commands specify is still to be done by the main agent.

---
*Phase: 18-per-project-sandboxes*
*Plan: 02 (unit I1)*
*Commit: 86e5cc2*
