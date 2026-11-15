---
phase: 17-observability-and-tamper-evident-audit
verified: 2026-11-15
verdict: passed
status: passed
ref: origin/gsd/phase-17-fix cb03c81 (PR 86; base origin/main f8ae248; fix commits e06f7ac, e11a283, cb03c81)
supersedes: 17-VERIFICATION.md on origin/gsd/phase-17-05 (gaps_found; OBS-04 recovery blocker)
requirements: OBS-01, OBS-02, OBS-03, OBS-04
---

# Phase 17: Observability and tamper-evident audit: Final verification at cb03c81

**Goal:** An operator can read what happened from structured logs and counters, tell a gateway loss from a runner crash, and prove the audit log has not been edited.

**verdict: passed.** All four roadmap success criteria have evidence on `origin/gsd/phase-17-fix` cb03c81. OBS-04 recovery is judged against the owner's retry-only contract (accepted 2026-11-15). Under that contract the earlier recovery blocker is closed. The residuals in the last section do not change the verdict.

**Method.** Worktree at `origin/gsd/phase-17-fix` cb03c81. Static reads and greps only. No tests, lint, typecheck, build or formatters were run, and nothing was committed. Named tests are cited as existing evidence. Their pass results are not observed here. They rest on the operator records cited in each row. Host evidence files under `<home>/realm-evidence/phase17/` were not readable from this verifier's account. The host results below come from the owner-supplied record and from `docs/integration/openshell.md`, not from a re-read of the files.

## Scope checks

| Check | Result | Evidence |
| --- | --- | --- |
| Catalogue: one addition only (D5) | 30 codes at the pre-phase commit `a3f87df^`, 31 at HEAD. The added code is `OPENSHELL_GATEWAY_LOST`. | `src/core/errors.ts:40`, `:190-194` (ERROR_CODES diff) |
| No dependency added (OBS-02) | Dependency keys compared from `82e3928^` to HEAD: none added, none removed. The one change is `@rivet-dev/agentos-core` 0.4.4 to 0.4.7, an existing dependency. | `package.json` `dependencies` |
| No schema or session-record change in phase (D5) | No phase commit changes a schema value. `policy.schema.json` +1 line is `a7b765c` (2026-11-08, main-line policy work, not Phase 17). `src/contract/validate.ts` +14 is documentation only (`7314650`). | git history on `src/core/policy.schema.json`, `src/contract/validate.ts` |
| Debt markers in phase files | No `TBD`, `FIXME` or `XXX` in the audit, observe, runtime-supervisor, session-execution, daemon, CLI-audit, doctor and dispatch sources read. | grep of those paths |

## Goal Achievement: Roadmap Success Criteria

Criteria text: `.planning/ROADMAP.md` lines 473-476 at cb03c81.

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Each audit line carries `seq` and `prev` (sha256 of the previous line); `realm audit verify` passes an untouched file, including one with Phase 14 reconciliation lines; names the first broken line after an edit, removal or reorder; the chain head is recovered from the last line at startup (OBS-01). | VERIFIED | **Write:** `src/audit/log.ts:171-180` (`withChain` sets `seq` and `prev`); `src/audit/log.ts:139-169` (`writeAuditLine` re-reads the head from the file on every append, so no in-memory head survives a restart). **Head recovery:** `src/audit/chain.ts:121-135` (`readChainHead`, tail window of two 4 MiB chunks). **Verify:** `src/audit/chain.ts:307-452` (`verifyDescriptor`): `prev-mismatch`, `seq-gap`, `seq-regress`, `bad-chain-start`, `unchained-line`, `line-too-long`, and `tail-loss` against a pinned head. **Reconciliation lines are chained:** `src/audit/reconcile.ts:344-348` appends through `appendAudit`; `test/audit/chain.test.ts:530-551`. **Break naming:** `test/audit/chain.test.ts:480-503` (edit: `prev-mismatch` at line 3; delete: `seq-gap` at line 2; reorder: exit 1 at line 2). **CLI:** `src/cli/audit.ts:124-176` (`--file`, `--session`, `--head`, `--anchor`); `audit` is in `CLI_COMMANDS`, `src/cli/main.ts:49`. **Live:** scenario 5 asserts `realm audit verify` exits 0 after restart; the 2026-11-15 run on a796b34 passed 37 of 37 (`docs/integration/openshell.md:625`). |
| 2 | The daemon log is one JSON object per line with a level, the catalogue code in a fixed field and a correlation id per `up` and per tool call; a tool call's log line carries the same correlation id as its admission and result audit lines; `package.json` gains no dependency (OBS-02). | VERIFIED | **One JSON object per line, fixed keys:** `src/observe/logger.ts:1-8` (header), `:82-150` (`emit`, `formatLine` writes `ts`, `level`, `event`, then `code`). The logger never throws; a failing sink is counted (`droppedLines`, `:117`). **Level:** `REALM_LOG_LEVEL` is read only at the daemon entry (`src/daemon/main.ts:83`); `parseLogLevel` (`src/observe/logger.ts:179-186`) falls back to `info`, and the invalid value is warned (`src/daemon/main.ts:252`). **Correlation id per `up`:** `src/daemon/daemon.ts:575`, logged on `up.begin` with `correlationId` and `upId`. **Per tool call:** `src/daemon/daemon.ts:608`, logged on `tool.result`. **Join to audit lines:** `src/tools/dispatch.ts:142` builds the scope, `:264-271` spreads it into the admission and result audit entries; `src/observe/ids.ts:8`. **Failure line:** `daemon.failed` JSON, `src/daemon/main.ts:319`; `test/daemon/main.test.ts:826` asserts the `code` field. **No dependency:** see scope checks. **Live:** scenario 6 checks the write's `correlationId` in `audit/daemon.jsonl` (`openshell.md:625`). |
| 3 | Counters and timings for tool calls by outcome, state transitions and attach duration are read over the existing control socket, and a listing of the daemon's listening sockets shows no network listener (OBS-03). | VERIFIED | **Metrics:** `src/observe/metrics.ts:160` (`createMetrics`); tool calls by outcome `done`/`refused`/`failed` at `src/daemon/daemon.ts:619`, `:637`, `:649`; transitions at `src/daemon/sessions.ts:242`; attach duration at `src/daemon/daemon.ts:347`. **Over the control socket:** `metrics` method, `src/daemon/daemon.ts:674-679`; `CONTROL_METHODS` includes `metrics`, `src/daemon/channel.ts:17`; `realm metrics` client, `src/cli/main.ts:774`, `src/daemon/client.ts:206`. **No network listener:** the daemon's only server is a Unix-socket `createServer` (`src/daemon/daemon.ts:795`, `listen(socketPath)` at `:827`). `test/daemon/daemon.test.ts:1899-1938` reads `/proc/self/net/{tcp,tcp6,udp,udp6}` restricted to the daemon's own socket inodes and asserts none. **Live:** scenario 10 asserts no TCP or UDP listener and that `realm metrics` counts the gateway-lost code (`openshell.md:625`). |
| 4 | With the gateway killed, `realm status` and a probe test show the new gateway-or-driver-loss code and not `AGENTOS_CRASH_LOOP`, and every table, document and test that enumerates catalogue codes includes it (OBS-04). | VERIFIED (see residual R2 on one document) | **Code:** `src/core/errors.ts:40`, `:190-194` (reason and `retryable: true`); `src/runtime/driver/grpc-status.ts:39` (`UNAVAILABLE`); `test/core/errors.test.ts:43`, `:60`, `:89` (`CATALOGUE_SIZE = 31`), `:189-197`. **Probe classification:** `src/runtime/agentos.ts:328-342` (`classify`): gateway does not answer, or driver probe does not answer, gives `OPENSHELL_GATEWAY_LOST`; gateway answers and driver answers or has no configured socket gives `AGENTOS_CRASH_LOOP`. Probes: `src/runtime/agentos-driver.ts:447-452` (`gatewayAnswers`, `openshell status` under `GATEWAY_STATUS_TIMEOUT_MS`), `:457-462` (`driverAnswers`, `null` unless the socket path is absolute). **Probe test:** `test/daemon/daemon-health.test.ts:316-335` (runner gone, gateway silent: state and status reason are `OPENSHELL_GATEWAY_LOST`, not `AGENTOS_CRASH_LOOP`); `:337` (gateway answers: still `AGENTOS_CRASH_LOOP`). Supervisor cases: `test/runtime/agentos-supervisor.test.ts:472-575`, with a healthy check never asking the gateway at `:569`. **`realm status`:** the status reply carries the snapshot reason (`src/daemon/daemon.ts:566-570`), and `displayStatus` passes an `error` reason through unchanged (`src/core/status.ts`). **Doctor:** `src/doctor/checks.ts:654-677` names `OPENSHELL_GATEWAY_LOST` with its fix; `src/doctor/runtime-checks.ts:113-124`, `:242-256`. **Live:** scenario 10 passed on a796b34 and asserts `realm status` reports `OPENSHELL_GATEWAY_LOST`, never `AGENTOS_CRASH_LOOP` (`docs/integration/openshell.md:625`; `docs/integration/omp.md:183`). **Driver-only loss:** spike S17-b reports `realm status` `OPENSHELL_GATEWAY_LOST` about 10 s and 45 s after only the compute-driver unit stopped (`docs/integration/openshell.md:629-634`). Owner ruling O-e is ratified (`docs/integration/runtime-decision.md:248`, `17-CONTEXT.md:20`). **Enumerations:** see the table in the next section. |

**Score:** 4/4 roadmap success criteria verified. OBS-01 to OBS-04 are each covered by at least one criterion above. No criterion is UNCERTAIN and no behavior-dependent truth lacks a named test.

## OBS-04 judged under the owner's retry-only contract

**Contract (accepted 2026-11-15).** A held session stays in `error` with its code until the operator runs `realm down` and then `realm up`, or the retry command. No automatic restart exists (owner ruling N1). The contract is written at `src/runtime/agentos.ts:21-22` (recovery is `realm down` then `realm up`, or the retry command), and in the reason text at `src/core/errors.ts:190-194` ("restore the gateway, then retry"). The contract is recorded in `docs/integration/runtime-decision.md:393` ("a retry, or `realm down` then `realm up`, works once the gateway is back").

**Code behaviour under the contract.**
- A held supervisor makes no gateway, driver or alive call. `check()` returns the held code through `throwHeld` (`src/runtime/agentos.ts:345-352`). Pinned by the e11a283 assertions at `test/runtime/agentos-supervisor.test.ts:589-593` and the test at `:577`.
- An explicit `start()` clears the hold, so the next check probes again. Pinned by e11a283 at `test/runtime/agentos-supervisor.test.ts:596-597`.
- A failed `realm down` leaves the session in `stopping`; a repeated `destroy` resumes teardown (`src/lifecycle/controller.ts:531-536`, `:558-566`). This is the designed path that the host record shows.

**Host record (cited, not re-read here).** The owner's 2026-11-15 check (`<home>/realm-evidence/phase17/17-OBS04-retry-20261115-005732.txt`) records: after the driver was restarted, `realm down` returned `unbound` with exit 0, then `realm up` returned `active` with exit 0. The earlier `REALM_STOPPING` refusal came from a session left in `stopping` by the prior failed `down`, which matches `controller.ts:531-536`.

**Judgment.** Under the accepted contract, OBS-04 recovery is met: the held code persists until the operator's down/up, and the down/up path works once the driver is back. The earlier blocker (status staying `OPENSHELL_GATEWAY_LOST` after restore, with no retry evidence) is the designed retry-only behaviour and now has a live retry record. This verdict does not extend the contract to automatic recovery.

## Stop-failure cause fix (e06f7ac)

`src/runtime/session-execution.ts:382-390`. A failed AgentOS stop that carries its own `causeCode` now reports that cause in `causeCode`, instead of dropping it for the primary `AGENTOS_STOP_FAILED`. The cause chain is sound: the driver stop throws `AGENTOS_STOP_FAILED` with the cleanup code (`src/runtime/agentos-driver.ts:399`), the supervisor's `stop()` keeps it (`src/runtime/agentos.ts`, `stop()`), and `throwIfStopFailed` takes the first defined cause (`src/runtime/session-execution.ts:575-585`).

The deadline path is unchanged. `withTimeout` rejects with an error that has no `causeCode` (`src/core/timeout.ts`, `makeRealmError(code)`), so the fallback at `:388-389` still reports `causeCode: undefined`. The new test at `test/runtime/session-execution.test.ts` (added by e06f7ac at line 864, after the supervisor catalogue test) pins the kept-cause case. **Judgment: correct and in scope.** It is the operator-visible fix for the `AGENTOS_STOP_FAILED` on `realm down` seen in the S17-b run (`docs/integration/openshell.md:636`).

## Other fix commits

- **e11a283** (test only): pins the retry-only hold, described above. **Judgment: correct.**
- **cb03c81** (comment only, `src/runtime/agentos.ts`): states that a stop whose sandbox delete fails leaves the container stopped, and only `destroy` removes it. This matches `src/runtime/session-execution.ts` (stop does not remove) and `src/lifecycle/controller.ts:558-566`. **Judgment: correct.**

## Catalogue enumerations (criterion 4)

| File | Enumerates | Includes `OPENSHELL_GATEWAY_LOST` |
| --- | --- | --- |
| `src/core/errors.ts` | all 31 codes (`ERROR_CODES`, `ERROR_CATALOGUE`, header comment) | yes (`:40`, `:190`) |
| `src/runtime/driver/grpc-status.ts` | all 31 codes (gRPC map) | yes (`:39`) |
| `test/core/errors.test.ts` | all 31 codes (`EXPECTED_CODES`, retryable list) | yes (`:43`, `:60`, `:89`) |
| `docs/integration/runtime-decision.md` | Phase 17 table and the list of enumerating files | yes (`:391`) |
| `docs/integration/openshell.md`, `docs/integration/omp.md` | status and failure tables | yes |
| `AGENTS.md`, `CHANGELOG.md` | catalogue references | yes |
| `docs/specs/realm-spec.xml` | 20 of 31 codes in a dated design-record list (`:325`) | **no** (see R2) |
| `src/audit/*`, `src/omp/plugin.ts`, `test/audit/*`, `test/omp/plugin.test.ts` | single codes or refusal assertions, not catalogues | not applicable |

## Requirement traceability

| Requirement | Verdict | Basis |
| --- | --- | --- |
| OBS-01 | Met | Criterion 1; `src/audit/log.ts`, `src/audit/chain.ts`, `src/cli/audit.ts`, `src/audit/reconcile.ts`; anchor check `src/audit/chain.ts:549`, anchor publish `src/audit/anchor.ts:420` via `src/cli/anchor.ts:124` |
| OBS-02 | Met | Criterion 2; `src/observe/logger.ts`, `src/observe/ids.ts`, `src/daemon/main.ts`, `src/tools/dispatch.ts` |
| OBS-03 | Met | Criterion 3; `src/observe/metrics.ts`, `src/daemon/daemon.ts:674-679`, `test/daemon/daemon.test.ts:1899-1938` |
| OBS-04 | Met under the retry-only contract | Criterion 4 and the section above |

REQUIREMENTS.md still shows OBS-01 to OBS-04 unchecked and the OBS-04 row as "awaiting owner ratification". Ratification is recorded (`docs/integration/runtime-decision.md:248`, 2026-11-02), so that row is stale (R6). This report does not edit it.

## Behavioural evidence

- Named tests (listed above) exist in the tree. They were not executed here.
- Full hermetic suite: 3026 pass, 0 fail, 40 skipped on cb03c81, as stated in the owner's record for this verification. Not re-run here.
- Live: production suite on a796b34, 37 of 37 (scenarios 5, 6, 10), `docs/integration/openshell.md:625`. S17-b driver-only run, `docs/integration/openshell.md:629-638`.
- Behavior-dependent truths (state transition, hold, retry, cancellation): each is covered by a named test (supervisor and daemon-health tests for the hold, `agentos-supervisor.test.ts:577-611` for the held retry, `session-execution.test.ts` for the stop cause). None is left PRESENT_BEHAVIOR_UNVERIFIED.

## Residuals (none changes the verdict)

- **R1. Host retry evidence not re-read.** The 2026-11-15 retry file and the S17-b receipt are cited from the owner's record and `docs/integration/openshell.md`. The verifier's account could not read them. Owner should confirm the record matches.
- **R2. `docs/specs/realm-spec.xml` (`:325`) does not list `OPENSHELL_GATEWAY_LOST`.** Read literally, criterion 4 names every document that enumerates the codes, and this list is one. The document is a dated design-record list. It already omits 10 codes that predate this phase (`AGENTOS_NOT_CONFIGURED`, `AGENTOS_STOP_FAILED`, `AUDIT_OUTCOME_UNKNOWN`, `AUDIT_WRITE_FAILED`, `CLEANUP_FAILED`, `DAEMON_START_TIMEOUT`, `MCP_INPUT_FAILED`, `OPENSHELL_LABEL_AMBIGUOUS`, `PODMAN_UNSUPPORTED_VERSION`, `SANDBOX_NAME_IN_USE`). `docs/integration/runtime-decision.md` (Phase 17 section) names the enumerating files as `errors.ts`, `grpc-status.ts` and `errors.test.ts`, and this file is not one of them. The verdict treats R2 as out of scope. If the owner requires the record to stay complete, the fix is a one-line annotation or a list update; the verdict would then need to be re-issued.
- **R3. Driver-only loss needs an absolute `REALM_DRIVER_SOCKET`.** When the variable is unset or relative, `driverAnswers` is `null` and a driver-only loss reads `AGENTOS_CRASH_LOOP` (`src/runtime/agentos-driver.ts:457-462`; `docs/integration/runtime-decision.md:407`). Coverage limits (a) to (c) are recorded at `runtime-decision.md:403-405`.
- **R4. A failed `realm down` leaves the session in `stopping`.** `realm up` is refused with `REALM_STOPPING` until `down` is repeated (`src/lifecycle/controller.ts:531-536`). This is the designed behaviour, and the operator path is down, then up. The recovery steps in `docs/integration/omp.md` should say so explicitly.
- **R5. Audit tail edits need a pin.** A last-line edit with no `--head` or `--anchor` is not detectable by chain verification alone. A middle-line edit is named at its successor line by design (`src/audit/chain.ts:307-452`, commit 2aafd01), not at the edited line itself.
- **R6. Tracker drift.** `.planning/ROADMAP.md` line 191 is unchecked for Phase 17, and `.planning/REQUIREMENTS.md` lines 78-81 are unchecked. The OBS-02 and OBS-04 rows still list open decisions that are now ratified or recorded (`runtime-decision.md:240-250`). This is a closeout docs task, not a verification gap.
- **R7. Owner rulings not located.** `docs/integration/runtime-decision.md:250` says rulings O-f, O-g and O-h "are not decided here". O-g's code is closed (`src/tools/dispatch.ts:100`, `runtime-decision.md:129`), with its scope confirmation requested. O-f and O-h are not visible in this branch. None of them maps to a roadmap success criterion, so none is assessed here.
- **R8. Out-of-phase main-line change.** `a7b765c` (2026-11-08) changed `src/core/policy.schema.json`. It is on `origin/main` before this branch and is not Phase 17 work, so it is not counted against D5.

## Next actions

1. Owner to confirm R1 against the host records.
2. Owner to decide R2 (annotate or update `realm-spec.xml`) and R7 (O-f, O-h, O-g scope).
3. Closeout docs commit: tick OBS-01 to OBS-04 and the Phase 17 roadmap entry, update the OBS-02 and OBS-04 rows, and add the R4 operator note. This is not part of this verification.

---

_Verified: 2026-11-15_
_Verifier: Claude (gsd-verifier), read-only at cb03c81; report not committed_
