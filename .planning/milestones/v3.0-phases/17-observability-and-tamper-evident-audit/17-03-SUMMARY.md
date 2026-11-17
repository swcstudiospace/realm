---
phase: 17
plan: 03
subsystem: test
tags: [test, live, observability, audit, correlation, requests-log]
requires: []
provides:
  - "test/support/production-live.ts exports requestLogLinesOf, parseJsonLine, unparsedLinesOf and auditLinesWithCorrelation"
  - "production live scenario 6 asserts the OBS-02 correlation join and that every requests.log line parses as JSON"
affects: [test/integration/production-driver.test.ts, test/support/production-live.ts, test/integration/production-live-helpers.test.ts]
key-files:
  created: []
  modified:
    - test/integration/production-driver.test.ts
    - test/support/production-live.ts
    - test/integration/production-live-helpers.test.ts
decisions:
  - "No new commit. The helpers and the scenario 6 join were already on main in 6ae7530; this summary records that and does not re-implement them"
  - "The scenario 6 join checks the audit file for exactly two records with the write's correlation id, one admission and one result, and runs realm audit verify --file on the same file"
requirements: [OBS-01, OBS-02, OBS-03, OBS-04]
metrics:
  tasks: 3
  commits: 0
  completed: 2026-11-15
status: complete
---

# Phase 17 Plan 03: live assertions for the audit correlation join and requests.log (OBS-01 to OBS-04) Summary

The live suite can now check the OBS-02 join from a `write` tool result in `requests.log` to its two audit lines in `audit/daemon.jsonl`, and that every `requests.log` line is JSON. The code was already on main (commit 6ae7530) when this plan was reconciled; no commit was made for this plan.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| T1 | helpers that read requests.log and the audit file, with named unit tests | 6ae7530 (on main, not new) | test/support/production-live.ts, test/integration/production-live-helpers.test.ts |
| T2 | scenario 6 asserts the correlation join and the JSON check | 6ae7530 (on main, not new) | test/integration/production-driver.test.ts |
| T3 | skip-path verification | none (verification only) | none |

## What was added

- `test/support/production-live.ts`: `requestLogLinesOf(stateDir)` (line 1278; returns `[]` for an absent file), `parseJsonLine` (1285; an explicit ok or reason result), `unparsedLinesOf` (1294; 1-based numbers of lines that are not JSON), and `auditLinesWithCorrelation(auditFile, correlationId)` (1314; the parsed records whose `correlationId` equals the argument, leaving out lines that are not JSON or not objects).
- `test/integration/production-live-helpers.test.ts`: named tests whose names contain `requestLogLinesOf` and `auditLinesWithCorrelation` (block at lines 635 to 688). They write fixture files to a temporary directory and cover an absent file, a line with no line end, an empty line, a line that is not JSON, and a line that is not an object.
- `test/integration/production-driver.test.ts`, scenario 6, inside `runMcpSession` after the `realm metrics` checks (lines 773 to 795), and before the modern-request section:
  - every `requests.log` line parses as JSON (`unparsedLinesOf` must be empty);
  - the last line with `event` `tool.result`, `tool` `write` and `outcome` `done` exists and has a string `correlationId`;
  - `audit/<session>.jsonl` holds exactly two records for that id, one with `phase` `admission` and one with `phase` `result`;
  - `realm audit verify --file` on the same audit file exits 0.
  The existing assertions in the scenario are unchanged. The commit's diff adds 27 lines to this file and removes none.
- The commit 6ae7530 diff for the three files is 153 insertions and 1 deletion. The deletion is a removed import (`rmSync`/`readFileSync` line in the helpers test), not an assertion.

## Scenario 5 (context for the plan's reconciliation note)

The plan's reconciliation described scenario 5 as asserting a destroyed container at startup. At HEAD, scenario 5 is the re-adoption version from a833ece (2026-11-08): the kept container is adopted and a stray is removed. The `audit verify --file` check and the `daemon.log` JSON check are in the same scenario (production-driver.test.ts around lines 667 to 683). Scenario 5 is not changed by this plan.

## Verification

| Step | Status | Evidence |
| ---- | ------ | -------- |
| T1 helpers exist, exported, with named tests | verified by reading the code | production-live.ts:1278, 1285, 1294, 1314; helpers test lines 635 to 688 |
| T1 named tests pass on the skip path | NOT VERIFIED | not run for this summary (contract: no tests). The orchestrator reports the hermetic suite at 191293b: 3025 pass, 0 fail, which is not the same selector |
| T2 join and JSON check present | verified by reading the code | production-driver.test.ts:773 to 795 |
| T2 join runs live and passes | verified only at scenario level | 17-05 T1 on commit a796b34 (which contains 6ae7530): production live 37 of 37 pass, scenario 6 ok (2026-11-15). Per-assertion counts are not recorded |
| T3 skip-path command at HEAD | NOT VERIFIED | not run for this summary; see the hermetic-suite line above |
| OBS-01 audit verify after the write | verified only at scenario level | scenario 6 step (d) in the 17-05 run on a796b34 |
| OBS-02 join and JSON check | verified only at scenario level | scenario 6 in the 17-05 run on a796b34 |
| OBS-03 metrics and listener checks | unchanged by this plan | existing scenario 6 and 10 assertions; live result from 17-05 |
| OBS-04 gateway-lost assertions | unchanged by this plan | existing scenario 10 assertions; live result from 17-05 |

## Deviations from Plan

**1. [Plan vs tree] No commit was made.** The plan expected new code. Commit 6ae7530 (already on main) contains the helpers, the named tests and the scenario 6 join. This summary records that instead.

**2. [History outside the plan] Commit 9cdbe8e is not part of plan 17-03.** It added live scenarios 5b and 5c and an `auditPairProblems` validator, and it changed `test/integration/omp-ompx05.test.ts`, which is not in this plan's `files_modified`. None of that content is at HEAD: `auditPairProblems` is not in `test/` or `src/`, `production-driver.test.ts` has no scenario 5b or 5c, and commit 6f18cb7 removed the `auditPairProblems` use from `omp-ompx05.test.ts`. This plan does not depend on 9cdbe8e's additions.

**Total deviations:** 2, both recorded above. No assertion was removed or changed by this plan.

## Issues Encountered

No code was run for this summary. Facts about the 17-05 live run and the hermetic suite come from the orchestrator and are cited as such.

## Known Stubs

None.

## Threat Flags

None. The helpers are plain file readers. They make no network or daemon call, and the scenario 6 join only reads `requests.log` and the session audit file under the scenario state directory.

## Next Phase Readiness

The live join and the JSON check ran as part of scenario 6 on a796b34 (17-05 T1). Phase 17 verification (`17-VERIFICATION.md`) should cite the 17-05 run for the live result and this summary for the code location. Any change to the `tool.result` or audit field names (`event`, `tool`, `outcome`, `correlationId`, `phase`) must update scenario 6 at the same time.

---
*Phase: 17-observability-and-tamper-evident-audit*
*Completed: 2026-11-15*
