---
phase: 18-per-project-sandboxes
plan: 05
subsystem: daemon
tags: [control-channel, selection, multi-project, client, cli, omp]
requires: ["18-01", "18-02"]
provides:
  - "parseControlSelection in src/daemon/channel.ts is the one control-selection validator; every refusal is SCHEMA_INVALID"
  - "selectionOf in src/daemon/client.ts is the one derivation of a selection in src/ (realpath plus sessionIdOfWorkspace)"
  - "connectDaemon(socketPath, selection) builds a client fixed to one selection; up() takes no argument and refuses a foreign sessionId"
affects: [src/daemon/channel.ts, src/daemon/client.ts, src/daemon/ensure.ts, src/cli/main.ts, src/omp/extension.ts, test/daemon, test/cli, test/omp, test/surfaces]
key-files:
  created: []
  modified:
    - src/daemon/channel.ts
    - src/daemon/client.ts
    - src/daemon/ensure.ts
    - src/cli/main.ts
    - src/omp/extension.ts
    - test/daemon/channel.test.ts
    - test/daemon/client.test.ts
    - test/daemon/ensure.test.ts
    - test/daemon/realm-daemon-fixture.test.ts
    - test/surfaces/daemon-equivalence.test.ts
    - test/cli/cli.test.ts
    - test/cli/mcp-attach.test.ts
    - test/omp/plugin.test.ts
    - test/omp/extension.test.ts
decisions:
  - "The validator checks shape only: it neither canonicalizes the path nor compares sessionId with the path. That check needs the daemon's pinned identity and is plan 06's."
  - "The client takes its selection at construction and validates it there, before any socket is opened. No client state is inferred from the socket or a previous up."
  - "DaemonClient gains no down() method. The CLI's session down is a selected down request sent through the CLI's send."
  - "The five real-daemon cases in test/daemon/client.test.ts and startRealDaemon are removed here; plan 06 reinstates the coverage in test/daemon/daemon.test.ts."
requirements: [MULTI-03]
metrics:
  tasks: 3
  commits: 1
  completed: 2026-11-02
status: committed; build and test runs NOT VERIFIED by this summary
---

# Phase 18 Plan 05 (unit S1): selected stateless control transport and its call sites (MULTI-03) Summary

Control requests that address a project now carry a `{ workspaceRoot, sessionId }` selection. The validator refuses a missing, malformed or extra-keyed selection with SCHEMA_INVALID. The client is built for one selection and sends only that selection, and closing one client leaves the others unchanged. The CLI and the Omp edge derive their selection with `selectionOf` from their own workspace. The commit is on main; this summary records what the code and the commit show and does not record a test run.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| T1 | selection envelope and its validator | 5b90aad | src/daemon/channel.ts, test/daemon/channel.test.ts |
| T2 | client holds one selection, sends it on every request, detaches on close | 5b90aad | src/daemon/client.ts, src/daemon/ensure.ts, test/daemon/client.test.ts, test/daemon/ensure.test.ts |
| T3 | CLI and Omp edge carry the selection of their workspace | 5b90aad | src/cli/main.ts, src/omp/extension.ts, test/cli/cli.test.ts, test/cli/mcp-attach.test.ts, test/omp/plugin.test.ts, test/omp/extension.test.ts, test/daemon/realm-daemon-fixture.test.ts, test/surfaces/daemon-equivalence.test.ts |

Commit 5b90aad (`feat(phase-18): selection-tagged control requests and per-client detach (MULTI-03, plan 05)`, 2026-11-02) is an ancestor of the audited head 4ad91be. Its 14 changed files are the 14 paths in the plan's `files_modified`.

## What was added

- `src/daemon/channel.ts`:
  - `ControlSelection` (`workspaceRoot`, `sessionId`), with `isWorkspaceRoot` (1 to 4096 characters, leading `/`), `hasExactKeys` and `selectionOfRecord` (lines 96 to 126). `sessionId` must pass `isSessionId` from `src/session/paths.ts`.
  - `parseControlSelection(method, params)` (lines 131 to 156). `up` takes exactly `{ workspaceRoot }`. `doctor` may have no params and returns `{ selection: null }`. Every other method, and `doctor` with params, takes `{ selection }` with no other key; `tool` also carries its `tool` key beside the selection. Every refusal throws `SCHEMA_INVALID`.
  - `selectionParams(selection)` (lines 159 to 161), which copies only the two fields onto the wire.
  - `CONTROL_METHODS`, the timeouts, `sendRequest` and the oversized-line path are unchanged.
- `src/daemon/client.ts`:
  - `selectionOf(workspaceRoot)` (lines 138 to 146). It calls `realpathSync`; a failure throws `POLICY_DENIED`.
  - `connectDaemon(socketPath, selection)` (lines 150 to 216). It runs `parseControlSelection` for the `up` shape and then the `status` shape before returning. `status`, `call` and `metrics` send the selection. `call` sends `{ tool, ...selected }`. `up()` sends `{ workspaceRoot }` only and refuses a reply whose `sessionId` differs from the constructed one (line 193). `close()` sets a flag on this client only.
  - `DaemonStatus` gains `sessionId`, which `isDaemonStatus` requires; `boundRoot` is kept.
- `src/daemon/ensure.ts`: `daemonAnswers(connect, selection)` calls `connect(socketPath, selection)`; its `status()` probe is unchanged.
- `src/cli/main.ts`: `ConnectDaemon` takes a selection. `runUp` calls `daemonAnswers(deps.connect, selectionOf(workspaceRoot))` and keeps `up` with `params: { workspaceRoot }`. `runDown`, `runMetrics` and `runStatus` send `params: { selection: selectionOf(workspaceRoot) }`. `runMcp` and `runAcp` construct with `selectionOf(workspaceRoot)` and call `client.up()` with no argument.
- `src/omp/extension.ts`: `attachDaemon` computes `selectionOf(workspaceRoot)` once, passes it to `daemonAnswers` and `connectDaemon`, and calls `client.up()`. Its refusal check on `status.boundRoot` is unchanged here (plan 10).
- Tests: the new MULTI-03 cases in `test/daemon/channel.test.ts` (lines 516 to 572 and the case at 572) and `test/daemon/client.test.ts` (lines 338 to 440, including `selectionOf` at 434). `test/daemon/ensure.test.ts` passes a selection to each `daemonAnswers` call (lines 239 to 276). The CLI, MCP, Omp and surface fixtures take the selection in their types and assert the sessionId of their own workspace.

## Verification

Checks performed for this summary (read-only; no tests, lint, typecheck or formatters were run, per the writer contract):

- Commit 5b90aad exists, is an ancestor of 4ad91be, and its 14 changed files match the plan's `files_modified` (commit stat).
- Validator rules, read at 4ad91be `src/daemon/channel.ts:96-161`: `up` exact-key and path shape; `doctor` absent params; exact `{ selection }` keys for the other methods; `isSessionId` on `sessionId`; length cap 4096 characters.
- Client, read at 4ad91be `src/daemon/client.ts:138-216`: `selectionOf` realpath and `POLICY_DENIED`; construction-time validation before any socket; `up` sends only `workspaceRoot` and checks the reply `sessionId`; `close()` sets only the local flag.
- Commit diff of `src/cli/main.ts`: `down`, `metrics` and `status` params carry `selectionOf(workspaceRoot)`; `runDoctor` is not touched by 5b90aad.
- Commit diff of `src/omp/extension.ts`: one `selectionOf` derivation passed to `daemonAnswers` and `connectDaemon`; `client.up()` takes no argument.
- Test case names for T1 and T2 are present in the files at the lines listed above, and the commit diff removes `startRealDaemon` and its five real-daemon cases from `test/daemon/client.test.ts`.

NOT VERIFIED:

- `npm run build && node --test dist/test/daemon/channel.test.js` (T1): not run; assertion content of each named case not read.
- `npm run build && node --test dist/test/daemon/client.test.js dist/test/daemon/ensure.test.js` (T2): not run; the request-line assertions for (a) to (g) are not read.
- `npm run build && node --test dist/test/cli/cli.test.js dist/test/cli/mcp-attach.test.js dist/test/omp/plugin.test.js dist/test/omp/extension.test.js` (T3): not run.
- The compile-only requirement for `test/daemon/realm-daemon-fixture.test.ts` and `test/surfaces/daemon-equivalence.test.ts`: not checked by a build in this summary.
- No evidence in the audit facts records a passing run of these commands for 5b90aad.

## Deviations from Plan

**1. [Plan vs code] `ensureSharedDaemon` takes a selection, not a workspace root**
- The plan said `ensureSharedDaemon` takes the workspace root. Commit 5b90aad gives it a `selection: ControlSelection` parameter, and `runMcp`, `runAcp` and `runUp` compute `selectionOf(workspaceRoot)` once and pass it. The derivation still happens in one place per caller; the behaviour is the same.

**2. [Audit line numbers] Validator lines differ from the audit facts**
- The audit facts cite `src/daemon/channel.ts:96-112` and `159-161`. At 4ad91be the type and helpers sit at 96 to 126, the validator body at 131 to 156, and `selectionParams` at 159 to 161. Later commits from plans 06 and 08 are in the same files, so line numbers here are as read at 4ad91be.

**3. [Plan scope] Daemon-side checks are not in this commit**
- `src/daemon/daemon.ts` is not in commit 5b90aad. The daemon's call to `parseControlSelection` and the pinned-root id check belong to plan 06 and are not part of this summary.

**4. [Plan scope] `runDoctor` is unchanged by this commit**
- The plan kept `runDoctor` unchanged in this wave. The commit diff confirms it. The optional doctor selection at HEAD belongs to plan 08.

**Total deviations:** 4, all of them plan-to-code wording or scope notes. No behaviour change against the plan's required rules was found in the code read.

## Issues Encountered

None recorded for this commit. The plan's stop rule (run each verify command as written, and stop at the first failure) applies to the executing agent; this writer ran no verify command.

## Known Stubs

None observed in the code read (`src/daemon/channel.ts:96-161`, `src/daemon/client.ts:138-216`, `src/daemon/ensure.ts`).

## Threat Flags

None identified. The validator refuses extra keys and relative or over-long roots. It does not canonicalize paths or compare ids, so the daemon's pinned-identity check (plan 06) is the control that binds `sessionId` to the root.

## Next Phase Readiness

- Plan 06 consumes `parseControlSelection` and returns `sessionId` in status and up replies. Its runtime assertions for `test/daemon/realm-daemon-fixture.test.ts` and `test/surfaces/daemon-equivalence.test.ts` are owned there.
- Plans 08 and 10 build on the call sites changed here (CLI behaviour, Omp refusal logic). The CLI doctor selection is plan 08.
- Before relying on this plan's behaviour, run the three verify commands above once after the phase's gates. This summary does not record that run.

---
*Phase: 18-per-project-sandboxes*
*Completed: 2026-11-02 (commit date of 5b90aad)*
