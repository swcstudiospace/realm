---
phase: 18
plan: 04b
subsystem: runtime
tags: [sandbox, workspace-binding, session-execution, multi-project]
requires: ["18-01", "18-04"]
provides:
  - "SessionExecution.create binds the workspace the request names; the configured pin is no longer read by the session"
  - "A relative request workspaceRoot is refused with SCHEMA_INVALID before any libpod, OpenShell or policy call"
  - "The session's verifier still compares the inspected /workspace mount with the binding it built"
affects: [src/runtime/session-execution.ts, src/daemon/daemon.ts, test/runtime/session-execution.test.ts, test/runtime/openshell-routing.test.ts]
key-files:
  created: []
  modified:
    - src/runtime/session-execution.ts
    - src/daemon/daemon.ts
    - test/runtime/session-execution.test.ts
    - test/runtime/openshell-routing.test.ts
decisions:
  - "The session canonicalizes the request root with bindRoot(req.workspaceRoot).realPath (session-execution.ts:202) and refuses a path that is not an existing directory with POLICY_DENIED; the plan text bound req.workspaceRoot as given. The commit does not record this choice."
  - "Symlink and sibling/parent containment cases were removed from the session tests; the controller (plan 06) and the root tests (plan 07) own that check."
requirements: [MULTI-02]
metrics:
  tasks: 1
  commits: 1
  completed: 2026-11-02
plan_head_before: 5b90aad
commits: 1
status: complete
---

# Phase 18 Plan 04b: the session's own bind (MULTI-02)

`SessionExecution` no longer holds a configured pinned root. Each create builds its sandbox binding from the workspace the controller has already verified for that session, and the session's own verifier still refuses a container whose `/workspace` mount is a different directory.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| T1 | The session's bind is its own pin; the verifier is the cross-check | ff80844 | src/runtime/session-execution.ts, src/daemon/daemon.ts, test/runtime/session-execution.test.ts, test/runtime/openshell-routing.test.ts |

## What was added

- `src/runtime/session-execution.ts`: the `pinnedWorkspaceRoot` option, `requirePinnedWorkspaceRoot`, and `requireSameDirectory` (with its POLICY_DENIED refusal) are removed. `create` refuses a relative `req.workspaceRoot` with SCHEMA_INVALID, canonicalizes it with `bindRoot`, and passes the result to `sandboxBindingOf`. Secret-root, sandbox-state-root and sandbox-name-length checks are unchanged.
- `src/daemon/daemon.ts`: the one conditional spread of the removed option in `defaultExec` is deleted (1 line, hunk at old line 1031).
- `test/runtime/session-execution.test.ts`: `pinnedWorkspaceRoot` is removed from every fixture and case. The relative-root case now passes `relative/workspace` as the request's root. New or re-targeted cases cover: a request root that differs from the fixture pin is not refused by the session and yields a container mounted at that root; a `/workspace` mount of a directory other than the request root fails with OPENSHELL_START_FAILED and the container is removed; a sandbox name over the gateway limit still fails with SCHEMA_INVALID before any libpod call.
- `test/runtime/openshell-routing.test.ts`: the `pinnedWorkspaceRoot` property is removed; the fixture's `workspaceRoot` is passed in each request.

## Verification

Read-only checks on the tree at HEAD (`gsd/phase-18-complete`):

- `git show --stat ff80844`: 4 files, 41 insertions, 100 deletions, matching the plan's file list.
- `ff80844` is an ancestor of `origin/main` and of this branch. `276e64e` (plan 04) is an ancestor of `ff80844`, so the driver change landed before this one.
- `grep -rn pinnedWorkspaceRoot src test` returns 0 hits; `requireSameDirectory` and `requirePinnedWorkspaceRoot` return 0 hits.
- Test names at the plan's cited lines exist: sandbox-name length (test:300), relative root (test:679), other-root binding (test:720), mount mismatch (test:756).

Not run in this plan's record: the plan's verify command `npm run build && node --test dist/test/runtime/session-execution.test.js dist/test/runtime/openshell-routing.test.js`. No build, test or lint result for ff80844 is in the audit record, and this summary does not claim one.

## Deviations from Plan

**1. [Audit pointer] The removed `defaultExec` spread was in `src/daemon/daemon.ts`, not `src/daemon/seams.ts`**
- The commit diff removes the line from `daemon.ts`. `seams.ts:183-186` still holds the `secretRoot` and `sandboxStateRoot` spreads and no pinned spread.

**2. [Plan text vs code] The session canonicalizes the request root**
- The plan bound `req.workspaceRoot` directly. The code binds `bindRoot(req.workspaceRoot).realPath` (session-execution.ts:202). A path that does not exist as a directory is refused with POLICY_DENIED (the "requested workspace does not exist" case, test:~738).

**3. [Test name vs fixture] The "differs from another session's pinned directory" case uses no second session**
- The case creates `other-project` in the fixture base and passes it as the request root. It asserts one stored container mounted at that root. The name describes the old pin; the body does not create another session.

**4. [Plan review step vs tree] No plan-06 references remain**
- The plan expected `pinnedWorkspaceRoot` references left in `daemon.ts`, `main.ts` and `test/daemon/main.test.ts` for plan 06. At HEAD there are none, so plan 06's removals are already in this tree.

**Total deviations:** 4 (one audit pointer, one plan-vs-code canonicalization, one test naming, one tree-state note).

## Issues Encountered

None recorded in the audit.

## Known Stubs

None.

## Threat Flags

None. The change removes a check the controller already performs; the verifier's mount comparison is unchanged in shape.

## NOT VERIFIED

- The plan's build and `node --test` verify command: not run and no record of it (see Verification).
- That each named test passes: present in the code at the cited lines; pass/fail not observed.
- The verifier's `verifyOrRemove` call body beyond the binding line: not re-read in this summary.

## Next Phase Readiness

Plan 06 owns the controller refusal of a foreign root (`resolveSelection`) and the removal of the daemon's `pinnedWorkspaceRoot` options. Plan 07 covers the root alias and sibling cases this plan no longer checks.

---
*Phase: 18-per-project-sandboxes*
*Completed: 2026-11-02*
