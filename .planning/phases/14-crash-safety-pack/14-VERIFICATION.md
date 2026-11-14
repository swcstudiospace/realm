---
phase: 14-crash-safety-pack
verified: 2026-11-14T21:00:37Z
status: passed
score: 5/5 roadmap success criteria verified
behavior_unverified: 0
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/phases/14-crash-safety-pack/14-01-PLAN.md
  - .planning/phases/14-crash-safety-pack/14-01-SUMMARY.md
  - .planning/phases/14-crash-safety-pack/14-SUMMARY.md
  - src/acp/agent.ts
  - src/audit/log.ts
  - src/audit/reconcile.ts
  - src/cli/main.ts
  - src/core/errors.ts
  - src/daemon/channel.ts
  - src/daemon/daemon.ts
  - src/daemon/main.ts
  - src/daemon/startup.ts
  - src/fs/atomic-write.ts
  - src/fs/temp-sweep.ts
  - src/lifecycle/controller.ts
  - src/mcp/protocol.ts
  - src/omp/plugin.ts
  - src/session/store.ts
  - test/audit/reconcile.test.ts
  - test/daemon/daemon.test.ts
  - test/daemon/main.test.ts
  - test/fs/atomic-write-sigkill.test.ts
  - test/fs/temp-sweep.test.ts
  - test/integration/production-driver.test.ts
  - test/lifecycle/stale-container.test.ts
  - test/omp/plugin.test.ts
  - test/session/store.test.ts
  - test/surfaces/daemon-equivalence.test.ts
covered_digest: "v4:sha256:184d1bb33a89e8d33b168d46dd38c004a9b6121b9e004384c3f3a738be59aab4"
---

# Phase 14: Crash-safety pack: Verification at de7bafc

**Goal:** A daemon or process killed at any point leaves no unrecorded debris, no silent loss of a sandbox, and no audit admission without an outcome.

**verdict: passed.** All five roadmap success criteria (`.planning/ROADMAP.md` Phase 14, l.400-410) have code and test evidence on `de7bafc` (= `origin/main` tip). Live evidence: 37 of 37 TAP tests pass. Residuals are non-blocking and listed below.

**Method.** Worktree `<tmp>/wt-p14-sum`, HEAD `de7bafc`. Static reads and greps only. The cited anchors were re-read in the worktree with `sed` and `grep`. No tests, lint, typecheck, build or formatters were run by this verifier. Nothing was committed. Test evidence is the orchestrator's full hermetic suite on `de7bafc`: 3025 pass, 0 fail. That suite covers the six test files cited here (see Residual 4). Digest: `gsd-tools query verification.fingerprint` (v4), run from the worktree root over the declared files above; PLAN and SUMMARY files in the phase directory are added by the tool.

## Goal Achievement: Roadmap Success Criteria

### 1. Temp-file stages, SIGKILL, sweep (CRASH-01, CRASH-05): VERIFIED

Code:
- `src/fs/atomic-write.ts:34` stage type (`after-temp-write`, `after-fsync`, `before-rename`, `after-recheck`).
- `src/fs/atomic-write.ts:68` `TEMP_NAME_PATTERN = /^\.(.+)\.realm-tmp-[0-9a-f]{16}$/s`; `:71` temp name generation.
- `src/fs/atomic-write.ts:203`, `:205`, `:206`, `:211` stage hooks; all precede `renameSync` at `:212`.
- `src/fs/temp-sweep.ts:45` `ORPHAN_TEMP_MIN_AGE_MS = 60_000`; `:267` removes only `isFile()` entries matching the pattern; `:276-285` directories opened with `O_NOFOLLOW|O_DIRECTORY`; `:321` `lstatSync`, with regular-file, owner and age checks; `:330` `audit({ tool: "temp-sweep", outcome: "ok", ... })` before unlink.

Tests:
- `test/fs/atomic-write-sigkill.test.ts:31` child calls `process.kill(process.pid, "SIGKILL")` from the stage hook; `:79-80` one test per stage; `:84` asserts `signal === "SIGKILL"`. Asserts original bytes intact, one orphan, and that the sweep removes it with an audit line.
- `test/fs/atomic-write-sigkill.test.ts:114` control (no kill, no orphan); `:125` production age bound keeps a fresh orphan.
- `test/fs/temp-sweep.test.ts:65` aged exact-pattern file removed and audited; `:106` younger file kept; `:117` non-pattern names kept; `:151` symlink named like a temp file not followed; `:166` symlinked directory not entered.
- `test/daemon/daemon.test.ts:697` `startDaemon` sweeps aged orphans in the workspace root and sessions dir before serving.

Caveat: `test/fs/temp-sweep.test.ts:251` (other-device directory) is skipped off CI under Q0-015 (`:180-201`). It is not a stated criterion.

### 2. Admission without result gets one reconciliation line; second start appends none (CRASH-02): VERIFIED

Code:
- `src/audit/reconcile.ts:347-348` appends `outcome: "AUDIT_OUTCOME_UNKNOWN"` and `phase: "reconciliation"`, so the line is not an execution result; `:683` `reconcileAuditLogs`.
- `src/audit/log.ts:36-39` `AuditPhase = "admission" | "result" | "reconciliation"`.
- `src/core/errors.ts:39`, `:186-189` `AUDIT_OUTCOME_UNKNOWN` catalogue entry (`retryable: false`).
- `src/daemon/startup.ts:278` runs `reconcileAuditLogs` before serving.

Tests:
- `test/audit/reconcile.test.ts:78` admission with no result gets exactly one reconciliation line; `:126` second run appends nothing.
- `test/daemon/daemon.test.ts:697-781` `startDaemon` reconciles and reports before serving; `:730` one reconciliation line with `AUDIT_OUTCOME_UNKNOWN`; `:780` second start reports `auditLinesReconciled === 0`.

Caveat: the daemon test writes the admission line directly and comments that the writer "was killed in between" (`:710`). No test produces the orphan admission by killing a process. See Residual 1.

### 3. Durable delete, reap log, status notice (CRASH-03, CRASH-04): VERIFIED

Code:
- `src/session/store.ts:17` imports `syncDirectory`; `:90-104` `delete` unlinks the record, then calls `syncDirectory(realPath)` at `:99`; a failure maps to `WriteNotAtomicError` (`:104`).
- `src/fs/atomic-write.ts:311` `syncDirectory`.
- `src/daemon/startup.ts:296-299` the report carries `containersRemoved`, container ids, `recordsDeleted` and `removedCauses`.
- `src/daemon/main.ts:158` `emitStartup` logs the `daemon.startup` line.
- `src/daemon/startup.ts:448` `startupNoticeOf` builds the "destroyed at startup" notice; `src/daemon/daemon.ts:302`, `:900` hold it for the daemon's lifetime.
- `src/omp/plugin.ts:432-434` each attach calls `ctx.ui.notify(attached.status.notice)`; `src/cli/main.ts:557` CLI diagnostics.

Tests:
- `test/session/store.test.ts:116` delete fsyncs the sessions directory after the unlink; `:143` failing directory fsync is `WRITE_NOT_ATOMIC`.
- `test/daemon/main.test.ts:275` the start's report is written as one stderr line with the container ids and counts.
- `test/daemon/daemon.test.ts:766` notice asserted on status, on repeated status and on `down`.
- `test/omp/plugin.test.ts:526` an attach whose status carries a notice shows it once through `ui.notify`.
- Live: `test/integration/production-driver.test.ts:596` (production live 5) asserts the restarted daemon's `daemon.startup` names the stray container id and `realm status` shows the notice. `ok 5` passes in the live log.

### 4. Same refusal cause code over MCP and ACP, in process and over the daemon (CRASH-06): VERIFIED

Code:
- `src/daemon/channel.ts:77-79` `ControlError` carries `code` and optional `causeCode`.
- `src/mcp/protocol.ts:107` and `src/acp/agent.ts:98` surface `causeCode` on the MCP and ACP error payloads.

Tests:
- `test/surfaces/daemon-equivalence.test.ts:195-217` cause code `PODMAN_MACHINE_DOWN` under `OPENSHELL_START_FAILED` agrees across in-process MCP, in-process ACP, MCP over the daemon and ACP over the daemon.
- `test/surfaces/daemon-equivalence.test.ts:219-230` a refusal without a cause carries no `causeCode` on any of the four paths.

Caveat: the dispatcher answer is scripted. The test proves that the surfaces and the daemon transport agree on the code. It does not prove where a real cause code originates.

### 5. Retry after lost container reaches `active`, not `OPENSHELL_START_FAILED` (CRASH-07): VERIFIED

Code:
- `src/lifecycle/controller.ts:263-272` recovery applies only to the recorded container, with no create in this call, and only for `OPENSHELL_START_FAILED`; the recovery call is at `:272`.
- `src/lifecycle/controller.ts:912` (TD-04 comment) and `:919` `recoverStaleContainer`: destroy the stale container, clear the record, create one new container.

Tests:
- `test/lifecycle/stale-container.test.ts:76-93` container removed behind the controller's back; the probe moves state to `error` with `OPENSHELL_START_FAILED`; `create()` on retry returns `active` with a new container id (`:85` `assert.notEqual(newId, oldId)`), with two creates and two destroys.

Caveat: this test is tagged TD-04, not CRASH-07. See Residual 2.

## Live Evidence

File: `<home>/realmlive/realm-evidence/phase14/14-live-main3.txt` (read-only).

- TAP footer: `# tests 37`, `# pass 37`, `# fail 0`, `# cancelled 0`, `# skipped 0`, `# todo 0`.
- 14 top-level scenarios (`ok 1` through `ok 14`), 37 test cases including nested subtests.
- The log has no commit SHA. Attribution to `de7bafc` is by file name and date only.
- Its predecessor `14-live-main2.txt` reported 36 pass and 1 fail. That run is superseded.
- Live coverage is limited to criterion 3 (`ok 5`). The live log does not exercise criteria 1, 2, 4 or 5 directly.

## Residuals (non-blocking)

1. Criterion 2's crash is simulated by writing the admission line directly (`test/daemon/daemon.test.ts:710`), not by a killed process. The reconciliation logic and the second-start idempotency are covered. The phase summary lists "real-SIGKILL tests", but criterion 2's text does not require a kill. A real-SIGKILL admission test would close that gap if the phase summary is read as a requirement.
2. Criterion 5's test is tagged TD-04 (`test/lifecycle/stale-container.test.ts:76`), not CRASH-07, and no test carries the CRASH-07 tag. Tagging it would make the traceability direct.
3. The cross-device sweep case (`test/fs/temp-sweep.test.ts:251`) skips off CI by design (Q0-015).
4. The six cited test files were not executed by this verifier: `test/fs/atomic-write-sigkill.test.ts`, `test/fs/temp-sweep.test.ts`, `test/audit/reconcile.test.ts`, `test/session/store.test.ts`, `test/surfaces/daemon-equivalence.test.ts`, `test/lifecycle/stale-container.test.ts`. Their test evidence is the orchestrator's full hermetic suite on `de7bafc` (3025 pass, 0 fail).
5. The live log has no commit SHA (see Live Evidence).

---

_Verified: 2026-11-14T21:00:37Z_
_Verifier: Claude (gsd-verifier)_
