---
phase: 17-observability-and-tamper-evident-audit
verified: 2026-11-15
verdict: human_needed
status: human_needed
ref: gsd/phase-17-complete f522abd (origin/main f8ae248 plus planning commits; fix commits e06f7ac, e11a283, cb03c81 are NOT in this tree)
supersedes: 17-VERIFICATION.md at cb03c81 (origin/gsd/phase-17-fix, verdict passed)
covered_files: [".planning/phases/17-observability-and-tamper-evident-audit/17-01-PLAN.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-01-SUMMARY.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-02-PLAN.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-02-SUMMARY.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-03-PLAN.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-03-SUMMARY.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-04-PLAN.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-04-SUMMARY.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-05-PLAN.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-05-SUMMARY.md", ".planning/phases/17-observability-and-tamper-evident-audit/17-SUMMARY.md", "docs/integration/omp.md", "docs/integration/openshell.md", "docs/integration/runtime-decision.md", "docs/specs/realm-spec.xml", "package.json", "src/audit/anchor.ts", "src/audit/chain.ts", "src/audit/log.ts", "src/audit/reconcile.ts", "src/cli/anchor.ts", "src/cli/audit.ts", "src/cli/main.ts", "src/core/errors.ts", "src/daemon/channel.ts", "src/daemon/client.ts", "src/daemon/daemon.ts", "src/daemon/main.ts", "src/daemon/sessions.ts", "src/doctor/checks.ts", "src/doctor/runtime-checks.ts", "src/lifecycle/controller.ts", "src/observe/ids.ts", "src/observe/logger.ts", "src/observe/metrics.ts", "src/runtime/agentos-driver.ts", "src/runtime/agentos.ts", "src/runtime/driver/grpc-status.ts", "src/runtime/session-execution.ts", "src/tools/dispatch.ts", "test/audit/chain.test.ts", "test/core/errors.test.ts", "test/daemon/daemon.test.ts", "test/observe/metrics.test.ts", "test/runtime/agentos-supervisor.test.ts", "test/runtime/session-execution.test.ts"]
covered_digest: "v4:sha256:23ce3b867dee2b5e348192626d99ff0fc795c6ae38e651961c9e183b77b6c66d"
---

# Phase 17: Observability and tamper-evident audit: Re-verification at f522abd

**Goal:** An operator can read what happened from structured logs and counters, tell a gateway loss from a runner crash, and prove the audit log has not been edited.

**verdict: human_needed.** All four roadmap success criteria are met on this tree by static reading. Three owner decisions remain open (H1 to H3 below). H2 is graded WARNING because it turns on the literal wording of criterion 4. No item is a FAILED truth, so no criterion is blocked.

**score:** 3 of 4 criteria VERIFIED. Criterion 4 is VERIFIED for the probe and status path, with its catalogue-enumeration sub-clause at WARNING (H2). `behavior_unverified: 0`.

**Method.** Worktree at `gsd/phase-17-complete` f522abd. Static reads and greps only. No tests, lint, typecheck, build or formatters were run, and nothing was committed. Named tests are cited for existence only; their pass results are not observed here. Live results are operator records at checkout a796b34, not re-observed. Host evidence was read read-only from `<home>/realm-evidence/phase17/`.

**Tree drift against the earlier pass.** The earlier `passed` verdict covered `origin/gsd/phase-17-fix` cb03c81. This tree is `origin/main` f8ae248 plus planning commits and does not contain the three fix commits, which are not merged (PR 86). The difference is 22 lines in four files:

- `src/runtime/session-execution.ts:380-390`: a failed AgentOS stop keeps its own `causeCode`. This is not on the probe path.
- `src/runtime/agentos.ts`: a comment on `stop()` only.
- `test/runtime/agentos-supervisor.test.ts`: retry-only assertions added to the held-supervisor test (no gateway, driver or alive call while held).
- `test/runtime/session-execution.test.ts`: one test for the kept cause.

Code on every criterion path (audit, observe, daemon metrics, the held and classify path in `agentos.ts`, and the doctor probe mapping) is identical between this tree and cb03c81. The criteria therefore carry over. The retry-only assertions and the stop-cause fix do not.

## Goal Achievement: Roadmap Success Criteria

Criteria text: `.planning/ROADMAP.md` lines 473-476 at f522abd.

| # | Criterion | Status | Evidence (static, f522abd) |
| --- | --- | --- | --- |
| 1 | Each audit line carries `seq` and `prev`; `realm audit verify` passes an untouched file, including one with Phase 14 reconciliation lines; names the first broken line after a middle-line edit, removal or reorder; the chain head is recovered at startup (OBS-01). | VERIFIED | **Write:** `src/audit/log.ts:151` (head read on each append), `:173-174` (`seq` and `prev` written). **Head recovery:** `src/audit/chain.ts:121` (`readChainHead`). **Verify:** `src/audit/chain.ts:307` (`verifyDescriptor`); break reasons `bad-chain-start`, `unchained-line`, `seq-gap`, `seq-regress`, `prev-mismatch` at `:45-49`. **Reconciliation lines** go only through `appendAudit` (`src/audit/reconcile.ts:9`), so they are chained. **CLI:** `src/cli/audit.ts:5` (`realm audit verify [--file \| --session] [--head] [--anchor]`). Operator record: scenario 5 runs `realm audit verify` after restart and passes (`docs/integration/openshell.md`, re-run 2026-11-15 on a796b34). |
| 2 | The daemon log is one JSON object per line with a level, the catalogue code in a fixed field and a correlation id per `up` and per tool call; a tool call's log line carries the same correlation id as its admission and result audit lines; `package.json` gains no dependency (OBS-02). | VERIFIED | **Format:** `src/observe/logger.ts:61` (`createLogger`), `:138` (`formatLine`), `:50` (`droppedLines`), `:179` (`parseLogLevel`). **Correlation:** `src/tools/dispatch.ts:127-142` (`CallScope` carries `correlationId` and optional `upId`); `src/audit/log.ts:82-88` writes both onto the audit line. Operator record: scenario 6 checks the write's `correlationId` in `audit/daemon.jsonl` (`docs/integration/openshell.md`). **Dependencies:** the `dependencies` keys at `82e3928^` and HEAD are identical (`@grpc/grpc-js` 1.14.6, `@grpc/proto-loader` 0.8.1, `ajv` 8.20.0, and `@rivet-dev/agentos-core` 0.4.4 to 0.4.7, an existing key). None added. |
| 3 | Counters and timings for tool calls by outcome, state transitions and attach duration are read over the existing control socket, and a listing of the daemon's listening sockets shows no network listener (OBS-03). | VERIFIED | **Metrics:** `src/observe/metrics.ts:59-60` (tool calls, transitions), `:70` (`recordTool`); `src/daemon/daemon.ts:347` (`metrics.recordAttach`). **Over the control socket:** `case "metrics"` in `src/daemon/daemon.ts` (about `:674-679`). **No network listener:** `createServer` from `node:net` (`src/daemon/daemon.ts:13`, `:795`) with the only `listen` at `:827` on `socketPath`. A grep of `src/daemon`, `src/cli` and `src/observe` for `createServer` or `.listen(` finds nothing else. Named test: `test/observe/metrics.test.ts:43`. |
| 4 | With the gateway killed, `realm status` and a probe test show the new gateway-or-driver-loss code and not `AGENTOS_CRASH_LOOP`, and every table, document and test that enumerates catalogue codes includes it (OBS-04). | VERIFIED for probe and status; WARNING for the enumeration sub-clause (H2) | **Code:** `src/core/errors.ts:40` and `:190` (`OPENSHELL_GATEWAY_LOST` in the catalogue; 31 entries in `ERROR_CODES`); `src/runtime/driver/grpc-status.ts:39` (`UNAVAILABLE`). **Hold and classify:** `src/runtime/agentos.ts:159-175` (a held check throws the held code without probing); `:326-343` (`classify` asks the gateway first, asks the driver only if the gateway answers, and returns `OPENSHELL_GATEWAY_LOST` unless the driver answers). **Doctor:** `src/doctor/checks.ts:655-675` maps the probe's `OPENSHELL_GATEWAY_LOST` to a fail with `FIX_GATEWAY_LOST`. **Named tests (existence only):** `test/runtime/agentos-supervisor.test.ts:472, 503, 516, 537, 550, 651`; `test/runtime/session-execution.test.ts:581`; the held-keeps-code test at `:577`, without the retry-only assertions that cb03c81 adds. **Operator records:** scenario 10 (gateway killed) at a796b34, 37 of 37, checks `OPENSHELL_GATEWAY_LOST`, never `AGENTOS_CRASH_LOOP` (`docs/integration/openshell.md`). S17-b, driver-only loss, shows `realm status` with `OPENSHELL_GATEWAY_LOST` at about 10 s and 45 s (host record, below). **Enumeration:** the catalogue, the gRPC map and the test lists include the code. `docs/specs/realm-spec.xml:325` does not (H2). Other enumerators (`docs/integration/runtime-decision.md`, `errors.test.ts`) were not re-read this round. |

**Score:** 3 VERIFIED, 1 VERIFIED with WARNING (criterion 4). `behavior_unverified: 0`. Every behavior-dependent truth (hold, transition, correlation, store) has a named test that exists. None is left PRESENT_BEHAVIOR_UNVERIFIED. Their passes are not observed here and rest on the operator records.

## Retry-only evidence (OBS-04 recovery, owner contract 2026-11-15)

Both host files were read from `<home>/realm-evidence/phase17/`:

**`17-S17b-20261115-002232.txt`** (checkout a796b34, 2026-11-15 00:22:32Z; driver-only loss):

- (a) `openshell status` exits 0, with the compute-driver unit stopped, and reports `connected`.
- (b) The exec probe is INCONCLUSIVE: exit 1, sandbox `Provisioning`.
- (c) `realm status` reports `state: error`, `reason: OPENSHELL_GATEWAY_LOST`, at 00:22:58Z and again at 00:23:08Z.
- (d) After the unit restart and `openshell connected after 5 s`, `realm status` still reports `error` and `OPENSHELL_GATEWAY_LOST` (last transition 00:23:04.939Z). Recovery is not shown.
- `realm down` exits 1 with `AGENTOS_STOP_FAILED`. Residue after restore: 0 containers, 0 sandboxes.

This matches `docs/integration/openshell.md` (S17-b, items a to d) at HEAD.

**`17-OBS04-retry-20261115-005732.txt`** (checkout recorded as `l14-main (main build)`, 2026-11-15 00:57:32Z):

- The first `realm up` is refused with `REALM_STOPPING`, exit 1. The session was still in `stopping` from the S17-b failed `down`.
- The driver is stopped. `realm status` reports `stopping` (not the loss code). The driver is restarted, and `openshell connected after 5 s`. Status with no retry is still `stopping`.
- `realm down` exits 0 at 00:58:15Z, state `unbound`.
- `realm up`, the documented retry, exits 0 at 00:58:16Z. State is `active`, reason `container running`, at 00:58:22Z.
- Cleanup `down` exits 0. Restore completed; driver `active`; residue 0 containers, 0 sandboxes.

**What this supports:** under the retry-only contract, the operator's `down` then `up` returns `active` once the driver is back. The file shows this directly.

**What it does not show:**

- The retry run did not re-observe the loss code. Its status during the driver stop was `stopping`. The loss-code evidence is S17-b (c) and scenario 10.
- The build is not tied to a commit (`l14-main (main build)`), so it cannot be tied to this tree.
- The two `down` runs differ. S17-b's `down` after restart returned `AGENTOS_STOP_FAILED` (exit 1). The retry's `down` after restart returned exit 0. The record does not explain the difference.
- The retry-only contract text is not in the repository docs. It rests on the owner's statement.
- `docs/integration/openshell.md` (S17-b, item d) and `docs/integration/runtime-decision.md` (the S17-b paragraph) still say recovery is not shown. They predate the retry run and need a closeout update.

## Residuals and human decisions

- **H1 (owner, WARNING):** Confirm the retry run's build identity (`l14-main`, no commit), and accept that the loss code was not re-observed in that run. Explain or accept the `down` outcome difference between S17-b and the retry run.
- **H2 (owner, WARNING):** `docs/specs/realm-spec.xml:325` lists 20 of 31 catalogue codes in a wave-1 freeze instruction, and it does not include `OPENSHELL_GATEWAY_LOST`. Criterion 4 covers every document that enumerates codes, read literally. The list already omits 10 codes that predate this phase. Options: add the code, or annotate the line as historical.
- **H3 (owner):** Tree scope. Fix commits `e06f7ac`, `e11a283` and `cb03c81` (PR 86) are not in this tree. Decide whether the accepted tree includes them. Effect on this tree: the S17-b `realm down` returning `AGENTOS_STOP_FAILED` has no cause-preserving fix, and the retry-only assertions are not pinned by a test.
- **R1 (no verdict effect):** Named tests were not executed, by contract. Live results are the operator's records at a796b34, not this tree.
- **R2 (no verdict effect):** The first `realm up` after a failed `down` is refused with `REALM_STOPPING` until `down` is repeated (`src/lifecycle/controller.ts:531-536`). The retry record confirms this. `docs/integration/omp.md` recovery steps should say so.
- **R3 (tracker drift):** `.planning/ROADMAP.md:191` and `.planning/REQUIREMENTS.md:78-81` are still unchecked for OBS-01 to OBS-04 and Phase 17. This is a closeout docs task, not a verification gap.
- **R4 (no criterion mapped):** `17-SUMMARY.md` lists owner decision O-h (whether `audit.head` is kept) as open. No roadmap criterion depends on it.

## Next actions

1. Owner: decide H1, H2 and H3, and confirm the retry run's build identity.
2. Closeout docs commit (not part of this verification): update the S17-b and driver-recovery paragraphs in `docs/integration/openshell.md` and `docs/integration/runtime-decision.md` with the retry result; add the R2 note to `docs/integration/omp.md`; tick OBS-01 to OBS-04 and the Phase 17 roadmap entry.
3. If H3 is accepted as in scope, merge `origin/gsd/phase-17-fix` and re-run the verifier on the merged tree before closing.

---

_Verified: 2026-11-15_
_Verifier: Claude (gsd-verifier), read-only at f522abd; report not committed_
