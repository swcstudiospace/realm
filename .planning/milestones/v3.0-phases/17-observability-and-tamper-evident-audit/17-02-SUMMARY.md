---
phase: 17-observability-and-tamper-evident-audit
plan: 02
subsystem: daemon
tags: [observability, daemon, logging, lifecycle, control, audit-head, crash-path]
requires: []
provides:
  - "lifecycle.transition logs from, to, a catalogue code only, recoveredCode, persistCode and upId (T1)"
  - "control.request (debug) for every control line, including unrecognized ones; control.refused (warn) with its code (T2)"
  - "daemon.starting, daemon.listening, daemon.stopping and daemon.stopped, once per process; daemon.listening carries no socket path (T3)"
  - "audit.head emitted per session when its handle is created and destroyed, from audit/<sessionId>.jsonl (T4, superseded by owner ruling C6)"
  - "uncaughtException and unhandledRejection write one daemon.failed line and exit 1 (T5)"
affects: [src/daemon/daemon.ts, src/daemon/sessions.ts, src/daemon/main.ts, test/daemon/daemon.test.ts, test/daemon/main.test.ts, docs/integration/runtime-decision.md]
key-files:
  modified:
    - src/daemon/daemon.ts
    - src/daemon/sessions.ts
    - src/daemon/main.ts
    - test/daemon/daemon.test.ts
    - test/daemon/main.test.ts
decisions:
  - "T4 follows owner ruling C6 (2026-11-02, Phase 17 ruling O-d amended): audit.head is per session, not per daemon file, and is not emitted at daemon start or on signal shutdown"
  - "request and lifecycle lines stay in requests.log and the entry records in daemon.log; the owner ratified this split on 2026-11-02 (docs/integration/runtime-decision.md)"
  - "sessions.ts changed outside the plan's files_modified for T1 (upId); the owner approved that change on 2026-11-15"
requirements: [OBS-02]
metrics:
  tasks: 6
  commits: 2
  completed: 2026-11-15
status: complete
---

# Phase 17 Plan 02 (unit U4a-rest): daemon log events and the crash path (OBS-02) Summary

The daemon's lifecycle, control-request and crash-path log events are in place on `origin/main`. The per-session `audit.head` replaced the planned daemon-file `audit.head`, by owner ruling C6.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| T1 | `lifecycle.transition` on every state change | a74d7c7 (adds `upId`); base event already on main | src/daemon/sessions.ts, src/daemon/daemon.ts, test/daemon/daemon.test.ts |
| T2 | `control.request` and `control.refused` | 5028c9b (unrecognized lines); recognized-method path already on main | src/daemon/daemon.ts, test/daemon/daemon.test.ts |
| T3 | `daemon.starting`, `daemon.listening`, `daemon.stopping`, `daemon.stopped` | already on main; commit not identified | src/daemon/daemon.ts, test/daemon/daemon.test.ts |
| T4 | `audit.head` at startup and shutdown | superseded: per-session `audit.head` by owner ruling C6 (2afd9b5, a5ae315, 3cf9d64) | src/daemon/main.ts |
| T5 | Uncaught exception and unhandled rejection in the entry | already on main; commit not identified | src/daemon/main.ts, test/daemon/main.test.ts |
| T6 | Test expectations forced by the new lines | already on main; list of changed expectations not recorded in this unit's inputs | test/daemon/main.test.ts, test/daemon/daemon.test.ts |

Merged to `origin/main` via PR 82 (merge commit afd168a). Commits 5028c9b and a74d7c7 are ancestors of `origin/main`.

## What was added

- `lifecycle.transition` (info) is logged from the controller subscription in `src/daemon/sessions.ts` with `from`, `to`, `sessionId`, and `upId` when the up is known (`upIdOf`). `code` is taken only through `catalogueCode(event.reason)`; the free-text reason is never logged.
- `control.request` (debug, `method`) is logged for every control line. A line that names no known method or does not decode logs `method: "unrecognized"` (5028c9b). `control.refused` (warn, `method`, `code`) is logged when the reply carries an error. Request params, ids and causes are not logged.
- `daemon.starting` (`src/daemon/daemon.ts:269`), `daemon.stopping` (:517), `daemon.stopped` (:537, with `code` and `failedTeardowns` when relevant), and `daemon.listening` (:829, no fields).
- `audit.head` is emitted by `emitAuditHead(stateDir, sessionId, writeStderr)` in `src/daemon/main.ts:186-189`, with `sessionId`, `seq` and `lineSha256`, through the entry logger. It is called at `src/daemon/main.ts:110`. It reads `audit/<sessionId>.jsonl`, not `daemon.jsonl`, and it has no `line` field.
- `installFailureHandlers` (`src/daemon/main.ts:311`) registers `uncaughtException` and `unhandledRejection` (`FAILURE_EVENTS`, :316-317). Each writes one `daemon.failed` line through the entry logger, sets the exit code to 1, and exits.

## Verification

Checked by reading source, grepping the cited symbols, and checking git ancestry. The test selectors named in the plan were not run; the phase contract forbids test runs in this unit.

- T1: `sessions.ts:246-251` logs `lifecycle.transition`; the test at `test/daemon/daemon.test.ts:1352` is named for it.
- T2: `daemon.ts:695` and `:698` (unrecognized), `:725` and `:730` (recognized); tests at `test/daemon/daemon.test.ts:1386` and `:1424`.
- T3: call sites at the lines above; test at `test/daemon/daemon.test.ts:1448` covers the four events and the absence of a socket path in `daemon.listening`.
- T4: `test/daemon/main.test.ts:696` covers `audit.head` per session at create.
- T5: `test/daemon/main.test.ts:790` is named "uncaught".

## Deviations from Plan

**1. [Owner ruling C6] T4 superseded.** The plan emitted `audit.head` in `daemon.log` at startup and shutdown, from `daemon.jsonl`, with `line`. The shipped code emits it per session from `audit/<sessionId>.jsonl`, at handle creation and destruction, with `sessionId`, `seq` and `lineSha256`. Ruling O-d was amended by C6 on 2026-11-02 (`docs/integration/runtime-decision.md:481`, `:495`), and the owner chose the code's behaviour on 2026-11-15 (`:247`). The plan's stated check, a line equal to the `verifyAuditFile` head at startup, therefore does not apply as written.

**2. [Plan vs scope] `src/daemon/sessions.ts` changed for T1.** It was not in `files_modified`. The change adds `upId` through `upIdOf`. The owner approved it on 2026-11-15.

**3. [Open question 1] Log layout.** Request and lifecycle lines go to `requests.log`, not `daemon.log`. `docs/integration/runtime-decision.md:189` records the owner's ratification of 2026-11-02.

**4. [Open question 2] T4 dropped.** Answered by deviation 1.

**Total deviations:** 4.

## Known Gap

`audit.head` looks back at most 64 lines. If the last 64 lines of an audit file have no chain fields, neither `audit.head` nor `audit.unreadable` is logged. The daemon writes chained lines only, so this needs an altered file. `realm audit verify` is the authority in that case (`docs/integration/runtime-decision.md:249`). This is recorded as a gap, not fixed.

## Known Stubs

None.

## Threat Flags

None. The added lines carry ids, codes, states and digests; none carries a path, request params or the raw reason text.

## Next Phase Readiness

The per-session `audit.head` docs are merged (2afd9b5, a5ae315, 3cf9d64). Open question 3 (the crash path uses the `codeOf` fallback `SCHEMA_INVALID`, and exits inside the handler) needs owner confirmation; see Not Verified.

## Not Verified

- All plan verify commands (`node --test ...`): not run, per phase contract.
- T6: the list of changed test expectations and their reasons is not in this unit's inputs.
- T5 behaviour (exit code 1, the `codeOf` fallback, the fake-register contract): the handler and test names are confirmed, the assertions are not.
- Open question 3: no owner confirmation found in the inputs.

---
*Phase: 17-observability-and-tamper-evident-audit*
*Completed: 2026-11-15*

## Self-Check

Commit ancestry and the cited symbols and test names were checked by git and grep. Tests were not run.
