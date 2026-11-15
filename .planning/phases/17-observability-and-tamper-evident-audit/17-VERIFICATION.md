---
phase: 17-observability-and-tamper-evident-audit
verified: 2026-11-15
verdict: passed
status: passed
ref: gsd/phase-17-complete 78ea260 (origin/main ea07518, PR 86 merged; spec commit 78ea260 on top)
supersedes: 17-VERIFICATION.md at f522abd (verdict human_needed)
covered_files: [".planning/phases/17-observability-and-tamper-evident-audit/17-01-PLAN.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-01-SUMMARY.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-02-PLAN.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-02-SUMMARY.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-03-PLAN.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-03-SUMMARY.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-04-PLAN.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-04-SUMMARY.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-05-PLAN.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-05-SUMMARY.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-CONTEXT.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-SUMMARY.md", "docs/specs/realm-spec.xml", "src/runtime/agentos.ts", "src/runtime/session-execution.ts", "test/runtime/agentos-supervisor.test.ts", "test/runtime/session-execution.test.ts"]
covered_digest: "v3:sha256:f7cb52f4ba29e5dff275e3c501f3194932f2d8369800cf14cfee129eb25f9b11"
---

# Phase 17: Observability and tamper-evident audit: Re-verification at 78ea260

**Goal:** An operator can read what happened from structured logs and counters, tell a gateway loss from a runner crash, and prove the audit log has not been edited.

**verdict: passed.** All four roadmap success criteria are met on the committed tree. The three items left open by the previous report (H1 to H3) are resolved: H3 by merging PR 86, H2 by the owner's spec commit 78ea260, and H1 by the three host records read here together with the owner's account, under the retry-only contract of 2026-11-15.

**score:** 4 of 4 criteria VERIFIED. `behavior_unverified: 0`.

**Method.** Worktree `gsd/phase-17-complete` at 78ea260. Static reads and greps only. No tests, lint, typecheck, build or formatters were run, and nothing was committed. Named tests are cited for existence only; their pass results are not observed here. Live results are operator records. Host evidence was read read-only from `<home>/realm-evidence/phase17/`.

**Tree drift.** `git diff cb03c81 HEAD -- src test docs` changes only `docs/specs/realm-spec.xml` line 325. The tree therefore carries the code verified at cb03c81 (verdict passed) plus the spec line. The earlier drift, where the three fix commits were absent, is closed: `ea07518` (PR 86 merge) is an ancestor of HEAD and contains `e06f7ac`, `e11a283` and `cb03c81`.

## Resolution of the open items

- **H3 (tree scope): resolved.** The fix commits are merged and on this tree. `src/runtime/session-execution.ts:380-390` keeps a failed AgentOS stop's own `causeCode`. The matching test is `test/runtime/session-execution.test.ts:866` (RT-03, RT-01). The retry-only assertions are `test/runtime/agentos-supervisor.test.ts:577-596`: a held check makes no `gatewayAnswers`, `alive` or driver-socket call, and `start()` clears the hold.
- **H2 (spec code list): resolved.** `docs/specs/realm-spec.xml:325` now lists `OPENSHELL_GATEWAY_LOST`, per the owner decision recorded in 78ea260. Every other enumeration of the new code was checked: `src/core/errors.ts:40,190` (catalogue, 31 entries); `test/core/errors.test.ts:43,60,89` (`CATALOGUE_SIZE = 31`, the expected list includes the code); `docs/integration/runtime-decision.md:385-391` (Phase 17 catalogue extension table); `docs/integration/omp.md:183` (gateway-lost row).
- **H1 (down difference): resolved under the owner's contract.** The three records are in `<home>/realm-evidence/phase17/`:
  - `17-S17b-recheck-20261115-024230.txt` (checkout a796b34). `realm up` reached active at 02:42:52. The compute-driver unit was stopped at 02:42:53. The sandbox created at 02:42:50 stayed in phase Provisioning (the exec probe reports "not ready"). `realm status` read `OPENSHELL_GATEWAY_LOST` at about 10 s, about 45 s and after the driver restart, and did not recover. `realm down` exited 1 with `AGENTOS_STOP_FAILED`. The driver was then restored and residue was zero. This matches the owner's account: the driver stopped about 3 s after `up`, and the sandbox never became Ready.
  - `17-S17b-20261115-002232.txt` (a796b34). The same pattern: the driver was stopped about 1 s after `up` (00:22:55), the sandbox stayed in Provisioning, `realm status` read `OPENSHELL_GATEWAY_LOST`, and `realm down` failed with `AGENTOS_STOP_FAILED`.
  - `17-OBS04-retry-20261115-005732.txt` (checkout `l14-main`). The first `realm up` was refused with `REALM_STOPPING`. After a driver stop and restart, `realm down` exited 0 (unbound), `realm up` reached active at 00:58:22, a cleanup `down` exited 0, and residue was zero.
  - The two S17-b runs failed `down` with the sandbox never Ready. The retry's `down` succeeded after the driver was restored. The retry record does not show the sandbox phase before its `down`, so the difference rests on the owner's account, which is accepted.

## Goal Achievement: Roadmap Success Criteria

Criteria text: `.planning/ROADMAP.md` lines 473-476 at 78ea260.

| # | Criterion | Status | Evidence (static, 78ea260) |
| --- | --- | --- | --- |
| 1 | Each audit line carries `seq` and `prev`; `realm audit verify` passes an untouched file, including one with Phase 14 reconciliation lines; names the first broken line after a middle-line edit, removal or reorder; the chain head is recovered at startup (OBS-01). | VERIFIED | Carried forward: no change to `src/audit/` or its tests since cb03c81. Write at `src/audit/log.ts:151,173-174`; head recovery `src/audit/chain.ts:121` (`readChainHead`); verify break reasons at `src/audit/chain.ts:45-49` and `:367` (`bad-chain-start`). Reconciliation lines go through `appendAudit` (`src/audit/reconcile.ts:9`). CLI `src/cli/audit.ts:5`. Named tests exist; passes not observed here. |
| 2 | The daemon log is one JSON object per line with a level, the catalogue code in a fixed field and a correlation id per `up` and per tool call; a tool call's log line carries the same correlation id as its admission and result audit lines; `package.json` gains no dependency (OBS-02). | VERIFIED | Carried forward. `src/observe/logger.ts:61` (`createLogger`), `:179` (`parseLogLevel`). `src/tools/dispatch.ts:127-142` (`CallScope` with `correlationId`, `upId`); `src/audit/log.ts:82-88` writes both onto the audit line. Operator scenario 6 checks the correlation id in the daemon log (`docs/integration/openshell.md`). No new dependency in `package.json`. |
| 3 | Counters and timings for tool calls by outcome, state transitions and attach duration are read over the existing control socket, and a listing of the daemon's listening sockets shows no network listener (OBS-03). | VERIFIED | Carried forward. `src/observe/metrics.ts:59-70`; `src/daemon/daemon.ts:347` (`metrics.recordAttach`); `case "metrics"` at `src/daemon/daemon.ts:674`. The only `listen` in `src` is `src/daemon/daemon.ts:827`, on `socketPath` (grep of `src` confirmed). Named test `test/observe/metrics.test.ts:43`. |
| 4 | With the gateway killed, `realm status` and a probe test show the new gateway-or-driver-loss code and not `AGENTOS_CRASH_LOOP`, and every table, document and test that enumerates catalogue codes includes it (OBS-04). | VERIFIED | **Code (read on this tree):** `src/core/errors.ts:40,190`; `src/runtime/agentos.ts:159-175` (a held check throws the held code without probing); `src/runtime/agentos.ts:326-343` (`classify` asks the gateway first, asks the driver only when the gateway answers, and returns `OPENSHELL_GATEWAY_LOST` unless the driver answers). **Tests (existence):** `test/runtime/agentos-supervisor.test.ts:472-550,577`; `test/runtime/session-execution.test.ts:581-587`; `test/lifecycle/controller-health.test.ts:235`. **Live (operator records):** scenario 10 passed 37 of 37 at a796b34 (`docs/integration/openshell.md:625`; `14-live-main3.txt`). S17-b (a796b34, both runs) shows `realm status` reporting `OPENSHELL_GATEWAY_LOST` and not `AGENTOS_CRASH_LOOP`. **Enumerations:** all checked and listed under H2. |

**Score:** 4 of 4 criteria VERIFIED. `behavior_unverified: 0`. The behavior-dependent truths (hold, transition, correlation, store) each have a named test that exists. Their passes are not observed on this tree and rest on the operator records (R1).

## Residuals (not verdict-blocking)

1. **Named tests not executed (R1).** By contract, none was run. The retry-only assertions (`agentos-supervisor.test.ts:577-596`) and the cause-kept test (`session-execution.test.ts:866`) have not been observed passing on any build. Live results are from a796b34, which predates `e06f7ac`.
2. **Stop-cause fix not observed live (R2).** The S17-b `down` on a796b34 printed `AGENTOS_STOP_FAILED` with no cause. On this tree the cause `OPENSHELL_GATEWAY_LOST` is kept (`session-execution.ts:380-390`). This is by code reading only.
3. **Retry build identity (R3).** The retry record names checkout `l14-main` with no commit. The owner's contract accepts it.
4. **Spec list still partial (R4).** `docs/specs/realm-spec.xml:325` lists 21 of 31 catalogue codes. The 10 that predate Phase 17 are still absent. Criterion 4 requires only the new code, so this does not block the phase.
5. **Recovery after a failed `down` (R5).** The first `realm up` after a failed `down` is refused with `REALM_STOPPING` until `down` is repeated (`src/lifecycle/controller.ts:531-536`). The retry record confirms this. `docs/integration/omp.md` recovery steps should say so. Docs task only.
6. **Tracker drift (R6).** `.planning/ROADMAP.md:191` and `.planning/REQUIREMENTS.md:78-81` still leave OBS-01 to OBS-04 and Phase 17 unchecked. This is a closeout docs task, not a verification gap.
7. **Owner decision O-h open (R7).** `17-SUMMARY.md` lists whether `audit.head` is kept as open. No roadmap criterion depends on it.
8. **Retry-only hold (info).** A driver-only loss stays held after the driver returns (S17-b (d)). Recovery needs `down` then `up`. This is the owner's retry-only contract, and the held check now pins it in tests (R1).

## Verdict

verdict: passed

All four criteria have evidence on `gsd/phase-17-complete` 78ea260. H1, H2 and H3 are resolved as described above. Residuals 1 to 8 are recorded and do not change the verdict.

---

_Verified: 2026-11-15_
_Verifier: Claude (gsd-verifier), read-only at 78ea260; report not committed_
