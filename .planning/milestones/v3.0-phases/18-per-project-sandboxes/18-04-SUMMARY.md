---
phase: 18-per-project-sandboxes
plan: 04
subsystem: runtime-driver
tags: [driver, sandbox, mount, workspace-registry, multi-project, refusal]
requires: ["18-01", "18-02"]
provides:
  - "CreateSandbox and ValidateSandboxCreate mount the directory named by the registry entry for the sandbox's id, resolved per sandbox, and no other directory"
  - "A missing, foreign, out-of-ceiling, mis-pinned or unprefixed sandbox name is refused with create.workspace before any libpod call, state write or secret write"
  - "Two projects under one driver ceiling can be created in one process; a second create for a live-bound directory is refused with create.pinned_root_held; a concurrent create under a name in flight is refused"
affects: [src/runtime/driver/compute-driver-create.ts, src/runtime/driver/compute-driver.ts, src/runtime/driver/main.ts, test/runtime/driver/, test/runtime/sandbox-binding.test.ts]
key-files:
  created: []
  modified:
    - src/runtime/driver/compute-driver.ts
    - src/runtime/driver/main.ts
    - test/runtime/driver/fakes.ts
    - test/runtime/driver/compute-driver.test.ts
    - test/runtime/driver/channel-artifacts.test.ts
    - test/runtime/driver/runtime-listener.test.ts
    - test/runtime/driver/supervisor-exit.test.ts
    - test/runtime/sandbox-binding.test.ts
    - test/runtime/driver/create-refusal.test.ts
    - test/runtime/driver/driver-main.test.ts
    - test/runtime/driver/driver-service.test.ts
    - test/runtime/driver/gateway-wire.test.ts
    - test/runtime/driver/launch-material.test.ts
    - test/runtime/driver/runtime-channel.test.ts
decisions:
  - "The mount is resolved per sandbox by resolveSandboxWorkspace, which reads the registry entry for the id in the name and returns the verified realPath; config.workspaceRoot is only the ceiling and is never mounted"
  - "The in-flight reservation stays keyed by sandbox name (reservedNames); the process-wide rootReserved flag and the one-pinned-root liveness check (pinnedRootHeld, holdsPinnedRoot) are removed in favour of a per-resolved-workspace liveness check (workspaceHeld, holdsWorkspace)"
  - "No second reservation key and no new refusal check name: a directory has one sandbox name under plan 01 C1, and the registry recomputed-id check (plan 02) refuses a copied entry"
  - "ValidateSandboxCreate shares planCreate with CreateSandbox, so validation refuses exactly what create refuses and writes nothing"
requirements: [MULTI-02, MULTI-04]
metrics:
  tasks: 1
  commits: 1
  files_changed: 14
  insertions: 717
  deletions: 475
  completed: 2026-11-02
plan_head_before: c7469dc
commits: 1
status: code_on_main_tests_not_rerun
actuals:
  tasks: 1
  commits: 1
---

# Phase 18 Plan 04: driver mount from the trusted registry (MULTI-02, MULTI-04) Summary

The driver now mounts, for each sandbox, the directory its workspace registry entry names, verified at create time, instead of one pinned workspace root shared by every sandbox. Code and test changes are on main in commit 276e64e. This audit read the code and the test bodies; it did not run the test or lint commands, so pass/fail of the new cases is NOT VERIFIED here.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| T1 | Resolve the sandbox's workspace from the registry, per sandbox | 276e64e | the 14 files in the plan frontmatter (matches `git show --stat 276e64e`) |

## What was added

- `ComputeDriverConfig.stateDir` (required, absolute). `src/runtime/driver/main.ts` passes `stateDir: roots.stateDir` beside `workspaceRoot: roots.workspaceRoot`.
- `resolveSandboxWorkspace(config, sandboxName, scope)`: requires the `realm-` prefix, takes the remainder as the session id, refuses with `create.workspace` if the id fails `isSessionId`, then reads the entry through `readWorkspaceEntry(config.stateDir, sessionId)`. It refuses when the entry is absent, lies outside the ceiling (`isInsideRoot(bindRoot(config.workspaceRoot), entry.workspaceRoot)`, equality accepted), or fails `verifyWorkspaceEntry`, and returns the verified `realPath`. At HEAD the entry read and verify live in `registeredWorkspaceOf` in `src/runtime/driver/compute-driver-create.ts`.
- `planCreate` builds the sandbox binding from the resolved directory and sets `spec.workspaceDir` from it. `ValidateSandboxCreate` and `CreateSandbox` both reach `planCreate`, so validation writes nothing.
- Reservation and liveness: `rootReserved` and `pinnedRootHeld` are removed. `reservedNames` (a `Set<string>`) is checked and set before the first await in `createSandbox` and cleared in `finally`. `workspaceHeld(scope, resolved)` checks live containers with `holdsWorkspace` (renamed from `holdsPinnedRoot`, now in `src/runtime/driver/compute-driver-output.ts`), per resolved directory, and keeps the `create.pinned_root_held` check name.
- `buildSandbox`'s `create.workspace` stage asserts `assertPinnedWorkspaceRoot(plan.spec.workspaceDir)`; `ensureWorkspace` keeps its ceiling check.
- Test fixtures: `driverConfig()` sets `stateDir` to a fresh directory; `writeSandboxWorkspaceEntry(config, workspaceDir)` in `test/runtime/driver/fakes.ts` creates the directory under the ceiling and writes its entry; the create-path tests name sandboxes by derived `realm-<id>` names.

## Verification

Verified by reading code and test bodies and by git metadata (no tests run):

- Commit 276e64e exists, is an ancestor of HEAD `4ad91be`, and changes exactly the 14 files listed in the plan's `files_modified`.
- In commit 276e64e, `compute-driver.ts` has `resolveSandboxWorkspace` (line 853) called from `planCreate` (line 941), `reservedNames` (line 300), `workspaceHeld` (line 741), and imports `readWorkspaceEntry` and `verifyWorkspaceEntry` from `src/session/workspace-registry.ts` (line 48). `rootReserved` and `pinnedRootHeld` are absent at HEAD.
- `src/runtime/driver/main.ts` line 101 passes `stateDir: roots.stateDir`.
- `grep` of `src/runtime/driver/` for `daemon/admission` returns no match (plan's C7 review step).
- Test bodies at HEAD in `test/runtime/driver/compute-driver.test.ts`, each by name and body:
  - (a) line 158: the created spec and the container mount name the registry directory.
  - (b) line 989: a missing entry, an entry outside the ceiling, and a directory replaced at the same path (device and inode mismatch) each refuse; `assertWorkspaceRefused` (line 1070) asserts no `listCalls`, no `inspectCalls`, no create, and no state or secret directory.
  - (c) line 721: two directories under one ceiling create on one driver; a third create for the first directory is refused with `REALM_INVALID_TRANSITION` while its container is live.
  - (d) line 707: two concurrent creates under one name; one fulfils and one is refused.
  - (e) line 1015: a copied entry under a second name is refused by the recomputed-id check.
  - (f) line 1026: `ValidateSandboxCreate` refuses a name with no entry, accepts one with a valid entry, and writes nothing.
  - (g) line 1037: `agent-1` (no prefix) and `realm-session.1` (fails `isSessionId`) refuse with `create.workspace`.
  - Driver-main `deepEqual` at `test/runtime/driver/driver-main.test.ts:105` carries `stateDir`.

NOT VERIFIED:

- The plan's verify command (`npm run build && node --test dist/test/runtime/driver/…`) was not run for this audit. Pass/fail of the cases above, and of the existing cases after their fixture changes, is therefore NOT VERIFIED.
- Lint, typecheck and the module-size gate for the 14 files were not run.

## Deviations from Plan

**1. [Plan path vs tree] Code moved after this commit.** The plan and audit name `src/runtime/driver/compute-driver.ts` for the new functions. At commit 276e64e they are there (lines 853 and 941). Commit 451414f (2026-11-04, "move compute-driver helpers into create, state and output modules") later moved `resolveSandboxWorkspace`, `registeredWorkspaceOf` and `planCreate` into `compute-driver-create.ts`, and `holdsWorkspace` into `compute-driver-output.ts`. At HEAD `4ad91be` the audit's line references (64-86, 153-169) refer to `src/runtime/driver/compute-driver-create.ts`. The audit's path `src/runtime/compute-driver-create.ts` is wrong; the correct path is `src/runtime/driver/compute-driver-create.ts`.

**2. [Plan vs code] Resolution split into two functions.** The plan describes one function. The code has `resolveSandboxWorkspace` (prefix, id and refusal) and `registeredWorkspaceOf` (read, ceiling, verify). A throw from the registry read or verify is recorded as a cause line with its code and then refused as `create.workspace`. The check name and the refusal behaviour match the plan.

**3. [Plan vs code] Stale comment left in refusal.ts.** `src/runtime/driver/refusal.ts:21` still says "No live sandbox of this driver still runs on the pinned root, and no other create holds it." for `create.pinned_root_held`. The plan's comment rewrite covers `compute-driver.ts`, not `refusal.ts`, and that file is not in `files_modified`. The wording is left as is; it describes a per-directory check in the old language.

**4. [Plan vs code] Adoption path unchanged.** `src/runtime/driver/lifecycle.ts:604` (`rebuildBinding`) also reads the registry entry by `workspaceStateDir` and checks the ceiling. The plan did not list `lifecycle.ts`, so it is unchanged here. Adopted sessions' registry entries are kept under Phase 19 (commit b3411bc, per the audit).

**5. [Plan text vs tree] Literal names remain in non-create fixtures.** The plan says `realm-session-1` and `realm-agent-1` are replaced in the tests that create sandboxes. Remaining literals: `test/runtime/driver/fakes.ts:354` (default `validSandbox` name), `test/runtime/driver/driver-service.test.ts:126` (StopSandbox/StartSandbox), `test/runtime/driver/runtime-channel.test.ts:37,51` (channel input). The create calls in `runtime-channel.test.ts` (line 103) and `compute-driver.test.ts` pass derived names. Whether any remaining literal reaches `planCreate` was not confirmed by a run: NOT VERIFIED.

**6. [Line drift] `driver-service.test.ts` CreateSandbox calls are at lines 143 and 155** (plan says 141 and 153). Content matches the plan's description.

**Total deviations:** 6; items 1 and 4 are plan-vs-tree corrections, item 3 is a comment the plan did not list.

## Known Stubs

None.

## Threat Flags

None. The driver refuses before any libpod call, state write or secret write for an unresolved name, and the refusal lines carry the check name and not the path.

## Next Phase Readiness

- Plan 04b (the session's own workspace bind, `SessionExecutionOptions.pinnedWorkspaceRoot` removal and the `defaultExec` spread in `src/daemon/seams.ts:183-186`) depends on this change.
- Plan 06 removes the daemon's own option and the `main.ts` pass once 04b lands.
- Plan 07's pin tests (`test/runtime/sandbox-binding.test.ts`) and the plan 13 live scenario depend on the per-sandbox mount behaviour; the live run (plan 14 checkpoint, 2026-11-15) reports 37/37 on 4ad91be, which this summary does not re-verify.

---
*Phase: 18-per-project-sandboxes*
*Completed: 2026-11-02 (commit 276e64e)*
