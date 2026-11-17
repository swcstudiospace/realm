---
phase: 14-crash-safety-pack
verified: 2026-11-14
verdict: passed
status: passed
ref: origin/main 06a3e40 (PR 77 merged; code identical to de7bafc outside .planning)
supersedes: <report> (de7bafc)
---

# Phase 14: Crash-safety pack: Re-verification at 06a3e40

**Goal:** A daemon or process killed at any point leaves no unrecorded debris, no silent loss of a sandbox, and no audit admission without an outcome.

**verdict: passed.** All five roadmap success criteria (`.planning/ROADMAP.md` l.400-410) have code and test evidence on `origin/main` 06a3e40. Live evidence: 37 of 37 TAP tests pass. Residuals below are non-blocking.

**Method.** Worktree `<tmp>/wt-p14v` at `origin/main` 06a3e40, branch `gsd/phase-14-verify-main`. Static reads and greps only. No tests, lint, typecheck, build or formatters were run by this verifier. Nothing was committed. Line numbers are at 06a3e40.

**Code parity with the hermetic run.** `git diff 06a3e40 de7bafc -- . ':!.planning'` is empty, and `de7bafc` is an ancestor of `06a3e40`. The 13 files that differ are planning files only. The hermetic suite and the live log therefore cover the code on this tree (see Residual 4 on attribution).

## Goal Achievement: Roadmap Success Criteria

### 1. Temp-file stages, SIGKILL, sweep (CRASH-01, CRASH-05): VERIFIED

Code:
- `src/fs/atomic-write.ts:34` stage type `AtomicWriteStage` (`after-temp-write`, `after-fsync`, `before-rename`, `after-recheck`).
- `src/fs/atomic-write.ts:68` `TEMP_NAME_PATTERN = /^\.(.+)\.realm-tmp-[0-9a-f]{16}$/s`; `:71` `tempFileName` builds the name from 8 random bytes (16 hex digits).
- `src/fs/atomic-write.ts:203`, `:205`, `:206`, `:211` stage hooks, all before `renameSync` at `:212`.
- `src/fs/temp-sweep.ts:45` `ORPHAN_TEMP_MIN_AGE_MS = 60_000`; `:267` removes only `isFile()` entries matching `TEMP_NAME_PATTERN`; `:276-285` directories are opened with `O_NOFOLLOW|O_DIRECTORY`, so symlinks are not entered; `:321` `lstatSync` on the candidate; `:326-327` regular-file, owner and age checks; `:330` `audit({ tool: "temp-sweep", outcome: "ok", ... })` before `:339` `unlinkSync`.
- `src/daemon/startup.ts:238-240` the startup sweep passes `minAgeMs: ORPHAN_TEMP_MIN_AGE_MS`; the sweep runs after the reap (`:153`) and before the gate opens (`:1-4`, `:40-42`).

Tests:
- `test/fs/atomic-write-sigkill.test.ts:20` `STAGES` lists the four stages; `:31` the child calls `process.kill(process.pid, "SIGKILL")` from the stage hook; `:79-84` one test per stage asserting `signal === "SIGKILL"`; `:88-100` original bytes intact, exactly one orphan, and the sweep removes it with one `temp-sweep` audit line; `:114` no-kill control; `:125` production age bound keeps a fresh orphan.
- `test/fs/temp-sweep.test.ts:65` aged exact-pattern file removed, audited while still present (before the unlink); `:106` younger file kept; `:117` non-pattern names kept; `:151` symlink named like a temp file not followed; `:166` symlinked directory not entered; `:251` other-device directory not entered (skips off CI, Residual 3).
- `test/daemon/daemon.test.ts:697-731` `startDaemon` removes both aged orphans, keeps a non-orphan file, and reports both before serving.

### 2. Admission without result gets one reconciliation line; second start appends none (CRASH-02): VERIFIED

Code:
- `src/audit/reconcile.ts:1-4` the reconciler appends one line for each admission with no closing line.
- `src/audit/reconcile.ts:347-348` the appended line has `outcome: "AUDIT_OUTCOME_UNKNOWN"` and `phase: "reconciliation"`, so it is marked as a reconciliation, not an execution result.
- `src/audit/log.ts:39` `AuditPhase = "admission" | "result" | "reconciliation"`.
- `src/core/errors.ts:39` and `:186` `AUDIT_OUTCOME_UNKNOWN` is an existing catalogue code, so no catalogue addition was needed.
- `src/daemon/startup.ts:278` the reconciler runs at startup, before serving.

Tests:
- `test/audit/reconcile.test.ts:78` an admission with no result gets exactly one reconciliation line.
- `test/audit/reconcile.test.ts:126` a second run appends nothing (`appended: 0`, log bytes unchanged).
- `test/audit/reconcile.test.ts:188` the reconciliation line carries `AUDIT_OUTCOME_UNKNOWN`.
- `test/daemon/daemon.test.ts:711` plants an admission line with no result (see Residual 1); `:731` asserts exactly one reconciliation line after `startDaemon`.

### 3. Directory sync on delete; reap log; status-read notice (CRASH-03, CRASH-04): VERIFIED

Code:
- `src/session/store.ts:17` imports `syncDirectory` from `src/fs/atomic-write.ts`. `:90-105` `delete` unlinks the record (`:97`) and then calls `syncDirectory(realPath)` (`:99`); a failure is re-thrown as `RealmError` or mapped to `WriteNotAtomicError`.
- `src/fs/atomic-write.ts:311-323` `syncDirectory` opens the directory with `O_DIRECTORY` and fsyncs it.
- `src/daemon/startup.ts:296-299` the reap report carries `containersRemoved`, `recordsDeleted`, `containerIds` and `removedCauses`.
- `src/daemon/main.ts:107` `onStartup` calls `emitStartup`; `:158-166` the `daemon.startup` log line carries `containerIds` and `recordsDeleted`.
- `src/daemon/startup.ts:448-456` `startupNoticeOf` builds the notice: container count and session-record count.
- `src/daemon/daemon.ts:299-308` the notice is kept for the daemon's lifetime and returned on every status and down reply (`statusResult`, `src/daemon/seams.ts:78-83`); `:900` set from the startup report.
- `src/omp/plugin.ts:432-434` each attach calls `ctx.ui.notify` with the status notice.

Tests:
- `test/session/store.test.ts:116-129` delete of an existing record fsyncs the sessions directory after the unlink; `:143` a failing directory fsync on delete is `WRITE_NOT_ATOMIC`.
- `test/daemon/main.test.ts:275` the start's report is written as one `daemon.startup` stderr line with the container ids and the record count.
- `test/daemon/daemon.test.ts:993` the `up` reply carries the startup notice when the reap destroyed a container; `:763-768` the notice is kept across reads.
- `test/omp/plugin.test.ts:526-539` an attach whose status carries a notice shows it through `ui.notify` once.

### 4. Daemon-path equivalence for refusal cause codes over MCP and ACP (CRASH-06): VERIFIED

Code:
- `src/mcp/protocol.ts:107-108` MCP result carries `causeCode` in `structuredContent` when the refusing error has one.
- `src/acp/agent.ts:98-99` ACP error data carries `causeCode`.

Tests:
- `test/surfaces/daemon-equivalence.test.ts:195-217` a refusal with `causeCode: "PODMAN_MACHINE_DOWN"` yields the same `code`, `retryable`, `hasCause` and `causeCode` in process over MCP, in process over ACP, over the daemon over MCP, and over the daemon over ACP.
- `test/surfaces/daemon-equivalence.test.ts:219` a refusal without a cause carries no `causeCode` on any of the four paths.

### 5. Stale container retry reaches `active` with a new container (CRASH-07): VERIFIED

Code:
- `src/lifecycle/controller.ts:262-272` the create path recovers the recorded container only when the failure is `OPENSHELL_START_FAILED` (`PORT_FAILURE_CODE`, `:36`); other failures go to `failCreate` unchanged.
- `src/lifecycle/controller.ts:912-919` `recoverStaleContainer` destroys the stale container, clears the record before the new create, and creates one new container.

Tests:
- `test/lifecycle/stale-container.test.ts:76` "TD-04: a removed container is destroyed and replaced on retry, reaching active": the container is removed behind the controller's back, the probe moves the session to `error`, `create()` returns `active` (`:82`), with a new id (`:85`), two creates and two destroys.

Caveat: this test is tagged TD-04, not CRASH-07. No test or source file in the tree carries the `CRASH-07` tag (`grep -rn CRASH-07 src test` is empty). See Residual 2.

## Live Evidence

File: `<home>/realmlive/realm-evidence/phase14/14-live-main3.txt` (read-only).

- TAP footer: `# tests 37`, `# pass 37`, `# fail 0`, `# cancelled 0`, `# skipped 0`, `# todo 0`.
- 14 top-level scenarios, 37 test cases including nested subtests.
- The log has no commit SHA. Attribution to `de7bafc` is by file name and date only.
- Scenarios directly relevant to this phase: `ok 5` (daemon killed, next `realm up` keeps the sandbox and destroys a stray container, the startup reap path, criterion 3), `ok 10` (stopped gateway is `OPENSHELL_GATEWAY_LOST`). `ok 12` is a container whose pids limit no longer matches its profile, destroyed and recreated at next start; it is not the removed-container path of criterion 5. The log does not exercise criteria 1, 2 or 4 directly.

## Hermetic Suite

Run by the orchestrator on `de7bafc` (not re-run here): 3025 pass, 0 fail, 40 skipped. The skips include the cross-device sweep case off CI (Residual 3).

## Residuals (non-blocking)

1. **Criterion 2 crash is simulated.** `test/daemon/daemon.test.ts:711` writes the admission line directly with `appendAudit` rather than killing a process. The reconciliation logic and the second-start idempotency are covered by `test/audit/reconcile.test.ts:78` and `:126`. Criterion 2's text does not require a kill.
2. **Criterion 5 is tagged TD-04.** `test/lifecycle/stale-container.test.ts:76` and `src/lifecycle/controller.ts:912` carry TD-04; no `CRASH-07` tag exists. Behaviour matches the criterion.
3. **Cross-device sweep skips off CI by design (Q0-015).** `test/fs/temp-sweep.test.ts:238` skips the cross-device case when `/dev/shm` is not a second device outside CI; `:228` fails it on CI.
4. **Live log attribution.** `14-live-main3.txt` has no commit SHA. Attribution to `de7bafc` relies on file name and date, and `de7bafc` and `06a3e40` have identical code outside `.planning`.

## Verdict

verdict: passed

All five criteria have code and test evidence on `origin/main` 06a3e40. Residuals 1 to 4 are recorded; none changes the verdict.
