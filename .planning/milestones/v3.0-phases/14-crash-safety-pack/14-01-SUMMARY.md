---
phase: 14
plan: 01
subsystem: runtime
tags: [crash-safety, temp-sweep, audit-reconciliation, durable-delete, cause-code, controller-retry, startup-notice, live-suite]
requires: []
provides:
  - "src/fs/temp-sweep.ts: sweepOrphanTempFiles removes exact orphan temp files older than 60 s, through a pinned directory descriptor (CRASH-01)"
  - "src/audit/reconcile.ts: reconcileAuditLogs and pairingKey append one AUDIT_OUTCOME_UNKNOWN reconciliation line per unmatched admission (CRASH-02)"
  - "src/session/store.ts: SessionStore.delete syncs the sessions directory (CRASH-03)"
  - "startup report, removal ids and daemon notice on status, up and down replies (CRASH-04)"
  - "src/tools/dispatch.ts causeCode on refused tool outcomes, passed by the daemon tool reply (CRASH-06)"
  - "src/lifecycle/controller.ts: one destroy-and-recreate of a recorded container that fails with OPENSHELL_START_FAILED (CRASH-07)"
affects: [src/daemon/daemon.ts, src/daemon/startup.ts, src/audit/log.ts, src/core/errors.ts, src/runtime/driver/grpc-status.ts, docs/integration/runtime-decision.md, docs/integration/omp.md, docs/integration/mcp.md, docs/integration/acp.md]
key-files:
  created:
    - src/fs/temp-sweep.ts
    - src/audit/reconcile.ts
    - test/fs/temp-sweep.test.ts
    - test/fs/atomic-write-sigkill.test.ts
    - test/audit/reconcile.test.ts
    - test/lifecycle/stale-container.test.ts
    - test/support/fsync-spy.ts
    - test/surfaces/daemon-equivalence.test.ts
  modified:
    - src/fs/atomic-write.ts
    - src/audit/log.ts
    - src/core/errors.ts
    - src/runtime/driver/grpc-status.ts
    - src/lifecycle/controller.ts
    - src/session/store.ts
    - src/tools/dispatch.ts
    - src/daemon/daemon.ts
    - src/daemon/client.ts
    - src/daemon/main.ts
    - src/runtime/sweep.ts
    - src/session/reap.ts
    - src/omp/plugin.ts
    - src/cli/main.ts
    - test/integration/production-driver.test.ts
    - test/support/production-live.ts
  removed: []
decisions:
  - "D-1401 sweep scope and match rule: implemented in src/fs/temp-sweep.ts (exact name pattern, regular file, owner uid, age bound, root device, pinned descriptor)"
  - "D-1402 sweep audit line before the unlink: implemented in src/fs/temp-sweep.ts; CLEANUP_FAILED second line on unlink failure"
  - "D-1403 reconciliation code AUDIT_OUTCOME_UNKNOWN (retryable false, gRPC INTERNAL): src/core/errors.ts, src/runtime/driver/grpc-status.ts, src/audit/reconcile.ts"
  - "D-1404 notice text carried on status, up and down replies, not in the tool contract or session record: src/daemon/daemon.ts"
  - "D-1405 optional onRemoved(id) on removeAllRealmContainers: src/runtime/sweep.ts"
  - "D-1406 TD-01 causeCode on the refused ToolOutcome: src/tools/dispatch.ts, src/daemon/daemon.ts, src/daemon/client.ts"
  - "D-1407 durable delete (WRITE_NOT_ATOMIC on sync failure): src/session/store.ts"
  - "D-1408 TD-04 destroy-and-recreate once per call: src/lifecycle/controller.ts"
  - "D-1409 startup order reap, sweep, reconciliation, report, gate: runStartupMaintenance (called from src/daemon/daemon.ts; the sweep call is at src/daemon/startup.ts)"
  - "D-1410 live assertion of the notice and destroyed id in scenario 5: test/integration/production-driver.test.ts, test/support/production-live.ts"
requirements: [CRASH-01, CRASH-02, CRASH-03, CRASH-04, CRASH-05, CRASH-06, CRASH-07]
metrics:
  tasks: 6
  commits: 2
  pull_requests: [11, 15, 60]
  completed: 2026-11-14
status: partial
---

# Phase 14 Plan 01: crash-safety pack (CRASH-01 to CRASH-07) Summary

The crash-safety code for CRASH-01 to CRASH-07 is on `origin/main`, built by PR #11 and PR #15. Test files for each requirement exist on main. The production live suite passed 37 of 37 in the run recorded in `<evidence>/phase14/14-live-main3.txt`. No requirement is verified by this summary: no tests, builds or gates were run for it, the scenario 5 notice assertion is not visible in the live log, and the phase verification file records `gaps_found`. Steps without cited passing evidence are marked NOT VERIFIED below.

Context: `14-CONTEXT.md` (D-1401 to D-1410), plan `14-01-PLAN.md` (lanes L1 to L6), research `14-RESEARCH.md`. Requirements are defined in `.planning/REQUIREMENTS.md` and success criteria in `.planning/ROADMAP.md` under Phase 14.

## Tasks (plan lanes)

The plan has no numbered tasks; the lanes below are its task units.

| Lane | Requirement | Commit (PR) | Implementation | Evidence status |
| ---- | ----------- | ----------- | -------------- | --------------- |
| L1 sweep library and real-SIGKILL tests | CRASH-01, CRASH-05 | 157ebfe (#11) | `src/fs/temp-sweep.ts`, `src/fs/atomic-write.ts` (`TEMP_NAME_PATTERN`), `test/fs/temp-sweep.test.ts`, `test/fs/atomic-write-sigkill.test.ts`, `docs/integration/omp-lifecycle-runbook.md` | Source and tests present on main. Test run NOT VERIFIED. |
| L2 reconciliation library and catalogue | CRASH-02 | 157ebfe (#11), 5719f81 (#15) | `src/audit/reconcile.ts` (new, extended in 5719f81), `src/audit/log.ts`, `src/core/errors.ts`, `src/runtime/driver/grpc-status.ts` | Source present on main. Test run NOT VERIFIED. Catalogue count 30 NOT VERIFIED. |
| L3 controller recovery and durable delete | CRASH-03, CRASH-07 | 157ebfe (#11) | `src/lifecycle/controller.ts`, `src/session/store.ts`, `test/lifecycle/stale-container.test.ts`, `test/session/store.test.ts`, `test/support/fsync-spy.ts` | Source and tests present on main. Test run NOT VERIFIED. |
| L4 cause code across the daemon | CRASH-06 | 157ebfe (#11) | `src/tools/dispatch.ts`, `src/daemon/daemon.ts` (tool case), `src/daemon/client.ts`, `test/surfaces/daemon-equivalence.test.ts`, `docs/integration/mcp.md`, `docs/integration/acp.md` | Source and tests present on main. Test run NOT VERIFIED. |
| L5 startup maintenance, reap log and notice | CRASH-02 (wiring), CRASH-04 | 5719f81 (#15) | `src/daemon/daemon.ts` (`runStartupMaintenance` call, notice in status), `src/daemon/main.ts`, `src/runtime/sweep.ts` (`onRemoved`), `src/session/reap.ts`, `src/omp/plugin.ts`, `src/cli/main.ts`; tests in `test/daemon/`, `test/runtime/sweep.test.ts`, `test/omp/plugin.test.ts`, `test/cli/cli.test.ts` | Source present on main. Test runs NOT VERIFIED. |
| L6 live proof | CRASH-04 | 5719f81 (#15) and 73c99e4 (#60) | `test/integration/production-driver.test.ts`, `test/support/production-live.ts`. #60 adds one line: scenario 5 asserts the destroyed-stray notice after the restart. | Live suite 37 of 37 (see Live evidence). Notice assertion not visible in the log: NOT VERIFIED. |
| Docs (after L5) | all | 157ebfe (#11), 5719f81 (#15) | `docs/integration/runtime-decision.md`, `docs/integration/omp.md`, `AGENTS.md`, `docs/integration/omp-lifecycle-runbook.md` | Docs check (`check:docs`) NOT VERIFIED. |

Deviation from the plan: lane L5 is described as owning `src/daemon/daemon.ts` with `runStartupMaintenance` in that file. On main the sweep call is in `src/daemon/startup.ts` (line 238) and `runStartupMaintenance` is called from `src/daemon/daemon.ts` (line 888).

## Commits and pull requests

- PR #11, commit `157ebfe`: lanes L1 to L4 and the Phase 14 docs. 34 files, 2816 insertions. Verified ancestor of `origin/main`.
- PR #15, commit `5719f81`: lane L5, the L6 scenario 5 assertions and docs. 23 files, 2350 insertions. Verified ancestor of `origin/main`.
- PR #60, merge `4386b9b`: adds commit `73c99e4` ("test(live): scenario 5 asserts the destroyed-stray notice after the restart"), 1 line in `test/integration/production-driver.test.ts`. The PR branch contains no other commit.
- Not Phase 14 requirement commits (none of CRASH-01 to CRASH-07): PR #57 (`0db410c`, `0abcb80`, free a stale gateway sandbox name before create), PR #58 (`2956b7a`, `95494ab`, delivered write with lost reply reported as unknown outcome), PR #65 (`87ad3e3`, live harness state root and per-scenario cleanup), PR #73 (`080d864`, `ef9f68a`, checkpoint symlink error code), PR #76 (`de7bafc`, `d46e322`, scenario 13 checkpoint cleanup in the live harness).
- The five commits cited in the old `14-SUMMARY.md` (`3f38269`, `8da6167`, `88046e6`, `9527f34`, `aa840a1`) are not ancestors of `origin/main` and are not relied on here.

## Requirement evidence

| Requirement | Implementation on main | Test files on main | Status |
| ----------- | ---------------------- | ------------------ | ------ |
| CRASH-01 | `src/fs/temp-sweep.ts` `sweepOrphanTempFiles`; runs at startup (`src/daemon/startup.ts:238`) | `test/fs/temp-sweep.test.ts` | Present. Behaviour NOT VERIFIED. |
| CRASH-02 | `src/audit/reconcile.ts` `reconcileAuditLogs`, `pairingKey` (line 111); `AUDIT_OUTCOME_UNKNOWN` in `src/core/errors.ts` | `test/audit/reconcile.test.ts` | Present. Behaviour NOT VERIFIED. |
| CRASH-03 | `src/session/store.ts` calls `syncDirectory` after the unlink (line 99) | `test/session/store.test.ts`, `test/support/fsync-spy.ts` | Present. Behaviour NOT VERIFIED. |
| CRASH-04 | notice on status, up and down in `src/daemon/daemon.ts` (line 299 comment, notice carried for daemon lifetime); `onRemoved` in `src/runtime/sweep.ts` | `test/daemon/main.test.ts`, `test/runtime/sweep.test.ts`, `test/omp/plugin.test.ts`, `test/cli/cli.test.ts`; live scenario 5 (`test/integration/production-driver.test.ts:660-665`) | Present. Live assertion of notice not visible in log: NOT VERIFIED. |
| CRASH-05 | four stages in `src/fs/atomic-write.ts` and the child-process SIGKILL tests | `test/fs/atomic-write-sigkill.test.ts` | Present. Behaviour NOT VERIFIED. |
| CRASH-06 | `causeCode` in `src/tools/dispatch.ts` (lines 97, 147, 289); daemon tool reply and client guard | `test/surfaces/daemon-equivalence.test.ts`, `test/tools/dispatch.test.ts` | Present. Behaviour NOT VERIFIED. |
| CRASH-07 | destroy-and-recreate once on `OPENSHELL_START_FAILED` in `src/lifecycle/controller.ts` (lines 157, 159, 264) | `test/lifecycle/stale-container.test.ts` | Present. Behaviour NOT VERIFIED. |

The phase verification file `14-VERIFICATION.md` (status `gaps_found`) lists the same five truths as `PRESENT_BEHAVIOR_UNVERIFIED`. Its open items: the literal live removal case for CRASH-04 (startup removal id, count and notice together on the current stack), the next-start wiring test for CRASH-01/02, and the owner-side reconciliation of the stale CRASH-04 wording in REQUIREMENTS.md.

## Live evidence

Source: `<evidence>/phase14/` on the realmlive host (read-only). The files record TAP output only: test names, pass or fail, and failure text. None records the commit under test.

- `14-live-main3.txt` (passing run): TAP, `# tests 37`, `# pass 37`, `# fail 0`, `# skipped 0`. Scenarios 5, 10 and 13 are `ok`. This is the run the phase relies on for the live suite passing on main. Scenario 5's notice assertion and the destroyed-id log line are not printed by the log: NOT VERIFIED for CRASH-04 acceptance item 6.
- `14-live-main2.txt`: `# pass 36`, `# fail 1`. Scenario 13 failed: `realm checkpoint create: exit 1; stdout "SCHEMA_INVALID"`. PR #76's commit body (`d46e322`) records the cause: the checkpoint lived in the shared host state root and was never removed, so a second run failed with SCHEMA_INVALID because EEXIST was mapped to SCHEMA_INVALID. PR #76 removes the checkpoint in a `test.after` hook. The passing run `14-live-main3.txt` is the one after that change; the log itself does not link to PR #76.
- `14-live-main.txt` (interrupted run): scenarios 1 to 7 are `not ok`. Each failure is `residue after realm down: the pinned workspace holds 2 entries: snapshot-delete.txt, snapshot-keep.txt`. The run ended with "Session terminated". Cause NOT VERIFIED. PR #65 (`41e890e`, "clean each scenario's own state and workspace files") is the related harness change; the log does not confirm it fixed this.
- Scenario 10, intermittent `AGENTOS_STOP_FAILED` after gateway restart: seen once, as reported by Main. NOT FOUND in any file under `<evidence>/phase14/` (case-insensitive search of all four files returns zero matches for `STOP_FAILED`/`AGENTOS_STOP`). Not reproduced in the passing run: scenario 10 is `ok` in `14-live-main3.txt`, and it is ✔ in `14-s10-repro.txt` (line 123). Scenario 10 is therefore NOT VERIFIED as a failure and is recorded only as Main's report.
- `14-s10-repro.txt`: all live scenarios 1 to 13 are ✔. The same file continues into a unit-test run (`ℹ tests 468`, `ℹ fail 191`) whose errors are `ERR_MODULE_NOT_FOUND` for a file under the `l14-main` tree. Not analysed; not a live result.

## Checks and verification

- Not run for this summary: tests, builds, typecheck, lint, `check:docs`, `check:gates`, `test:scripts`, `npm test`. Contract forbids them.
- Catalogue holds 30 codes: NOT VERIFIED (not counted; `test/core/errors.test.ts` asserts `CATALOGUE_SIZE`, value not checked).
- Four-stage real-SIGKILL tests and age/owner/pattern/symlink negative tests: NOT VERIFIED.
- Reconciliation once across two starts (SC2): NOT VERIFIED (`test/daemon/daemon.test.ts` plants the admission; no run recorded).
- Directory sync through the fsync spy (SC3, CRASH-03): NOT VERIFIED.
- Notice on `realm status`, Omp `ui.notify` and MCP/ACP diagnostics (CRASH-04): NOT VERIFIED beyond the scenario 5 source assertion.
- Same cause code over MCP, ACP and in process (SC4, CRASH-06): NOT VERIFIED.
- Controller retry to `active` with a new container id (SC5, CRASH-07): NOT VERIFIED.
- Live scenario 5 with the notice and log line on the production stack (SC6, D-1410): NOT VERIFIED from the logs; the scenario 5 pass itself is recorded in the 37 of 37 run.
- Frozen contracts: the plan lists the catalogue, audit line format, refused `ToolOutcome` and the control replies as the only touched contracts. Not checked in this summary.

## Remaining work

1. Run the named unit, daemon-path and docs gates on the integrated revision, per the owner's verification workflow.
2. Establish CRASH-04's literal live removal case with the current driver (startup removal id, count and notice in one live window), or get an owner-approved change to the acceptance text.
3. Confirm the scenario 10 failure against a log: the log named in the assignment is not in `<evidence>/phase14/`.
4. Reconcile the stale CRASH-04 wording in `.planning/REQUIREMENTS.md` through its owner. This summary does not edit it.
