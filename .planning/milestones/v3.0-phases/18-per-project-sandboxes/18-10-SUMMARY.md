---
phase: 18-per-project-sandboxes
plan: 10
subsystem: omp
tags: [omp, extension, plugin, daemon-attach, session-switch, multi-project]
requires: ["18-05", "18-06"]
provides:
  - "attachDaemon keeps a refused up's client only when status names the same session id and the same bound root as the selection"
  - "the Omp plugin handles session_switch and re-attaches only when the context names another working directory"
affects: [src/omp/extension.ts, src/omp/plugin.ts, test/omp/extension.test.ts, test/omp/plugin.test.ts, docs/integration/omp.md]
key-files:
  modified:
    - src/omp/extension.ts
    - src/omp/plugin.ts
    - test/omp/extension.test.ts
    - test/omp/plugin.test.ts
decisions:
  - "A session_switch payload is read defensively: without a working directory, or with the attached one, the attachment is kept (docs/integration/omp.md, row S2b)."
  - "The switch handler calls beginSession, which calls endSession first; this is the same end-then-attach path as session_start."
  - "The attached directory is stored on the session object as attachedCwd; no other state was added."
requirements: [MULTI-02, MULTI-03]
metrics:
  tasks: 2
  commits: 1
  audit_base: ea07518
  commit: e7c2cb6
status: complete_code_verified_tests_not_run
---

# Phase 18 Plan 10 (unit O1): the Omp surface checks the selection and follows a switch

The Omp attach refuses to keep a client whose status does not name the session and root it selected, and the plugin re-attaches when Omp switches to a session in another working directory. The audit records both changes on main in commit e7c2cb6; the source is present in this worktree. The tests were not run for this summary.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| T1 | attachDaemon checks the session id of a refused up | e7c2cb6 | src/omp/extension.ts, test/omp/extension.test.ts |
| T2 | a switch that changes the working directory re-attaches | e7c2cb6 | src/omp/plugin.ts, test/omp/plugin.test.ts |

## What was built

- `src/omp/extension.ts`, `attachDaemon(workspaceRoot)`: the selection comes from `selectionOf(workspaceRoot)` (plan 05). On a refused `up`, `client.status()` is read. The client is kept, and the refusal returned as `{ client, refusal }`, only when `status.boundRoot` equals `selection.workspaceRoot` and `status.sessionId` equals `selection.sessionId`. A status with no `boundRoot` (an older daemon) or no `sessionId` fails the same way. Otherwise the client closes and the refusal is rethrown. A dead status channel also closes the client and rethrows the up error.
- `src/omp/plugin.ts`, `session_switch` handler, registered after `session_start` with the same `pi.on` form: if a session is live, the context carries a string `cwd`, and that `cwd` differs from `live.attachedCwd`, it calls `beginSession(ctx)`. Otherwise it returns. `beginSession` calls `endSession()` first, then attaches. The `OmpExtensionApi.on` overload accepts `"session_switch"`, and the plugin header comment lists `session_switch`.
- `attachedCwd` is set from `ctx.cwd` in `beginSession`. The status item, tool-set refresh and timers are unchanged.

## Verification

Read in the worktree (code evidence, not a test run):

- `src/omp/extension.ts:65-76`: the refusal check compares `boundRoot` and `sessionId` against the selection; a missing field closes the client and rethrows. Verified.
- `src/omp/extension.ts:37-49`: `selectionOf` runs before `ensureDaemon` and before any socket is opened. The function body of `selectionOf` was not read in this pass, so the POLICY_DENIED rejection for a missing directory rests on the test named below, not on code read here.
- `src/omp/plugin.ts:8-10`: header comment lists `session_switch` and the no-directory keep rule. Verified.
- `src/omp/plugin.ts:78-79`: `OmpExtensionApi.on` overload for `session_switch`. Verified.
- `src/omp/plugin.ts:609-610, 647-656`: `beginSession` calls `endSession`; the switch handler's guard matches the plan's rule. Verified.
- `test/omp/plugin.test.ts:260, 273-274`: `FakePi.switchHandlers` and its `session_switch` branch. Verified.
- `test/omp/extension.test.ts:419`: `REGISTERED_EVENTS` is `session_start, session_switch, session_shutdown, tool_call`. Verified.
- `docs/integration/omp.md:126`: row S2b text (a switch to another directory re-attaches; the same directory or no directory keeps the attachment). Verified.

Test names present in the files (not run; see NOT VERIFIED):

- `test/omp/extension.test.ts:561` (MULTI-02): an attach sends `up` with the realpath, and the status and call requests carry `sessionIdOfWorkspace(...)`.
- `test/omp/extension.test.ts:584` (MULTI-03): a refused up whose status names another session closes the client and rethrows; no tool call reaches the daemon.
- `test/omp/extension.test.ts:608` (MULTI-03): a refused up whose status has no session id closes the client and rethrows.
- `test/omp/extension.test.ts:629` (MULTI-02): a missing directory is refused with POLICY_DENIED before any socket is opened.
- `test/omp/extension.test.ts:491`: a refused up whose daemon is bound to the session's own workspace keeps forwarding. The plan's T1(b) keep path is asserted here; the test body was not read in this pass.
- `test/omp/plugin.test.ts:2086` (plan 10 T2 (a)): a switch to another directory re-attaches with that directory and closes the previous client.
- `test/omp/plugin.test.ts:2100` (plan 10 T2 (b)): a switch that keeps the directory keeps the attachment.
- `test/omp/plugin.test.ts:2111` (plan 10 T2 (c)): a switch with no directory in its context keeps the attachment.

Not run, per the contract: `npm run build && node --test dist/test/omp/extension.test.js` and `npm run build && node --test dist/test/omp/plugin.test.js dist/test/omp/extension.test.js`. No live step ran.

## NOT VERIFIED

- Test execution: the two verify commands in the plan were not run, so no pass or fail result is recorded here.
- Plan T1(b), T1(d) and T2(d): the test bodies were not read, and the existing `session_start` tests were not compared with their pre-plan form.
- Host behaviour: the host's `session_switch` payload is not live-proven by this plan. The S2b row in `docs/integration/omp.md` is the only evidence cited for the host's switch event. The plan 14 checkpoint may observe it.

## Deviations from Plan

**1. [Plan text vs code] Switch path calls `beginSession`, not `endSession()` followed by a separate attach call**
- The plan said the handler ends the session "the way `session_start` does (`endSession()` followed by the same attach path)". `beginSession` already calls `endSession()` as its first step, so the switch handler makes one call, `beginSession(ctx)`, and gets the same end-then-attach order.

**Total deviations:** 1, a call-shape difference only; the behaviour matches the plan.

## Known Stubs

None.

## Threat Flags

None found in the changed files. The attach path adds no new socket, environment read or write route; it closes a client in more cases than before.

## Next Phase Readiness

Plan 11 (surface tests) and plan 14 (live checkpoint) can use `attachDaemon` and the `session_switch` handler as built. Any change to the status reply's `sessionId` or `boundRoot` fields must update the T1 check in `src/omp/extension.ts` and the refusal tests named above. The host's `session_switch` payload shape remains an open evidence item for plan 14.

---
*Phase: 18-per-project-sandboxes*
*Plan: 10 (unit O1)*
