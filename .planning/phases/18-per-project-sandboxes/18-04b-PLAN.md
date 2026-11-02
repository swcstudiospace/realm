---
phase: 18-per-project-sandboxes
plan: 04b
type: execute
wave: 4
depends_on: ["18-01", "18-04"]
files_modified:
  - src/runtime/session-execution.ts
  - src/daemon/daemon.ts
  - test/runtime/session-execution.test.ts
  - test/runtime/openshell-routing.test.ts
autonomous: true
requirements: [MULTI-02]
external_gates: []
must_haves:
  truths:
    - "SessionExecution.create no longer reads a configured pinned root; its bind is the session's own pinned path, and the verifier compares the inspected mount with that path."
    - "A create whose workspaceRoot is not absolute is refused with SCHEMA_INVALID before any libpod call, and the session no longer refuses a request because it names a directory other than its own pin."
  artifacts:
    - "src/runtime/session-execution.ts"
  key_links:
    - "session-execution sandboxBindingOf is called with the request's workspaceRoot, which the controller has verified against the session pin."
    - "Plan 04 lands first: the driver resolves each sandbox's mount from the registry, so no wave ends with the session binding a directory that the driver still mounts at its configured root."
---

# Phase 18 plan 04b (unit D2): the session's own bind

## Reconciliation against the code (read-only, 2026-11-02)

- `src/runtime/session-execution.ts`: `SessionExecutionOptions.pinnedWorkspaceRoot`, `requirePinnedWorkspaceRoot`, and `requireSameDirectory(req.workspaceRoot, pinnedWorkspaceRoot)`, the create-time refusal this plan removes; `sandboxBindingOf({ workspaceRoot: pinnedWorkspaceRoot, … })` in `create`. The verifier `verifyOrRemove` compares the inspect with the binding (`src/runtime/hardening.ts`, `isMountOf`).
- Ordering: the driver (plan 04) resolves each sandbox's mount from the registry before this plan removes the session's own check of the configured pin. A wave that ended with the session accepting a directory the driver still mounted at `config.workspaceRoot` would have the verifier refuse each such create, so the driver lands first.

## Scope and ownership

Owns the four files listed. Its signature change is the removal of `SessionExecutionOptions.pinnedWorkspaceRoot`. Its consumers are, closed: `src/runtime/session-execution.ts`, `src/daemon/daemon.ts` (`defaultExec`, the one conditional spread), `test/runtime/session-execution.test.ts` and `test/runtime/openshell-routing.test.ts`. Plan 06 owns the other daemon consumers (`BuildDaemonHandleOptions`, `StartDaemonOptions`), `src/daemon/main.ts` and `test/daemon/main.test.ts`. The controller verifies the pin before it calls create, and this plan removes only the session's second check of the same pin. The mount authority is contract C3 of `docs/integration/runtime-decision.md`.

Owner rules: no live step (no `REALM_LIVE_*`, no container, no gateway), no build or test run inside the replan, no git command, no commit.

## Requirement mapping

| Requirement | Tasks | Evidence required |
| --- | --- | --- |
| MULTI-02 | T1 | The session's bind is its own pin; a driver that mounts another directory fails the session verifier |

## Tasks

### T1. The session's bind is its own pin; the verifier is the cross-check
- Files: `src/runtime/session-execution.ts`, `src/daemon/daemon.ts` (the one spread at `defaultExec` only), `test/runtime/session-execution.test.ts`, `test/runtime/openshell-routing.test.ts`
- Action: in `session-execution.ts`, delete the option `pinnedWorkspaceRoot` from `SessionExecutionOptions`, delete `requirePinnedWorkspaceRoot`, and delete `requireSameDirectory` and its call. In `create(req)`, refuse with `SCHEMA_INVALID` when `req.workspaceRoot` is not an absolute path, then build the binding with `sandboxBindingOf({ workspaceRoot: req.workspaceRoot, stateRoot: sandboxStateRoot, secretRoot }, sandbox)`. The controller has already verified the pin before calling create, so the session takes the path it is given. Keep `requireSecretRoot`, `requireSandboxStateRoot` and the sandbox-name length check. Keep the verifier call and the binding it compares with unchanged in shape. In `src/daemon/daemon.ts`, delete the one conditional spread of the removed option in `defaultExec` (line 1032), so the daemon compiles in this wave.
  Test sites in `test/runtime/session-execution.test.ts`, each at HEAD; line 1449 (`pinnedRoot`) is a `RealmHandle` option and is not changed. (1) Line 92, a comment about the pinned workspace: rewritten to say the workspace is a real directory that the request names. (2) Lines 145 and 156, in the `fixture()` helper: delete the `pinnedWorkspaceRoot: workspaceRoot` property of each `SessionExecution` options object. (3) Lines 346 (case "phase 9.6"), 449 (case "RT-04, D-18"), 811 (case "F5"), 1161 (case "N5"), 1340 (case "B-3"), and 1503 (case "RT-03, RT-04, D-18"): delete the property from each options object. (4) Line 632 (case "C2: a create with no secret root") and line 674 (case "C2: a create with no sandbox state root"): delete the property; each case keeps its own refusal. (5) Line 1237, the `sessionExecWith` helper: delete the property. (6) Lines 643 to 657 (case "C2: a create with no pinned workspace root, or a relative one"): rewritten as "C2: a create whose requested workspaceRoot is relative is refused with SCHEMA_INVALID before any libpod or OpenShell call", looping over `["relative/workspace"]` and passing the value as the request's `workspaceRoot`; the undefined-pin branch and the option are deleted. (7) The case "C2: a create whose request names another root is refused with POLICY_DENIED" (about line 694): replaced by done-when (a) below. The refusal of a foreign root moves to the controller (plan 06 T1, done-when (a) and (b)). (8) The case "C2: a create whose approved workspace is a sibling of the pinned root is refused, and one that is the parent of the pinned root is refused" (line 706): deleted. The session no longer decides containment; the daemon's `resolveSelection` refuses siblings and parents (plan 06 T1), and the root cases of plan 07 T1 (c) cover the sibling name. (9) The case "C2: a create whose requested workspace is a symlink to the pinned root is accepted..." (line 728): re-targeted to call create with `workspaceRoot: f.workspaceRoot`, because the controller passes the realpath; the symlink is removed here, and alias identity is tested at the root level by plan 07 T1 (a). (10) The case "C2: a container mounted at the request path instead of the pinned root fails the mounts property..." (line 737): re-targeted so that the create uses `workspaceRoot: f.workspaceRoot`, and the inspected Mounts source is a different directory, `requestRoot`; the `mounts` property then fails and the container is removed, and the existing assertions stay. The comment on line 92 and the name of each re-targeted case are updated to match. In `test/runtime/openshell-routing.test.ts`, delete the `pinnedWorkspaceRoot: join(base, "workspace")` property at line 86; the fixture's `workspaceRoot` is passed in each request.
- Done when: `test/runtime/session-execution.test.ts` (a) asserts that a create with a `workspaceRoot` that differs from the pinned directory of another session is not refused by the session itself and produces a binding whose workspace is the request's root (the fake verifier then decides); (b) asserts that the fake inspect reporting a mount of a different directory than the request's root fails `verifyOrRemove` with `OPENSHELL_START_FAILED` and the container is removed through the existing cleanup path; (c) asserts that a relative `req.workspaceRoot` throws `SCHEMA_INVALID` before the fake libpod and runner record any call; (d) the sandbox-name length refusal still holds. Existing cases that depended on `pinnedWorkspaceRoot` are updated as listed above; no case expectation is weakened.
- Verify: `npm run build && node --test dist/test/runtime/session-execution.test.js dist/test/runtime/openshell-routing.test.js`

## Sequence and gates

- Depends on plan 01 (contract) and plan 04 (the driver resolves each sandbox's mount from the registry first). Wave 4, in parallel with plan 07 (different files). Plan 06 depends on this plan.
- This plan removes the one conditional spread of the removed option at `defaultExec` in `src/daemon/daemon.ts`, so the daemon compiles in this wave. Plan 06 (wave 5) removes the daemon's own option and the `main.ts` pass, in the same wave as the `StartDaemonOptions` change and its consumers.
- Review step (executor, read-only): confirm by `grep` that `src/runtime/session-execution.ts` no longer reads a pinned root, and that the remaining `pinnedWorkspaceRoot` references in `src/` and `test/` are plan 06's (`src/daemon/daemon.ts` `BuildDaemonHandleOptions` and `StartDaemonOptions`, `src/daemon/main.ts`, `test/daemon/main.test.ts`).
- Stop rule (plan-check finding 3, repair cycle 1): run each verify command and done-when check as written. If one exits non-zero, cannot run, or asserts a different value, stop this plan at that task, make no further edits in it, start no dependent plan, and report the failing command, the test name and the catalogue code or output line to the parent as BLOCKED. Never skip, narrow, or re-run a failing check until it passes.
