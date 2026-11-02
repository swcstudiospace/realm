# Phase 17 verification: observability and tamper-evident audit

Date: 2026-11-02. Tree: `gsd/v3-autonomous` at `652919a`. Phase 17 span: the 103 commits after the Phase 14 part 2 merge `5719f81`. Source of acceptance: `17-CONTEXT.md` (locked decisions D-1701 to D-1706, P17-O1 to P17-O4, acceptance items 1 to 4), the requirement texts OBS-01 to OBS-04 in `REQUIREMENTS.md`, and plans `17-01` to `17-05`.

**Status: human_needed.** Phase 17 is not passed. The automated evidence supports OBS-01, OBS-03, and the gateway-loss path of OBS-04. Open items:

1. Live scenarios 5, 6 and 10, and spike S17-b, have not run. Every live item is human-needed. None is marked passed.
2. D-1701 lists driver-only loss as a coverage limit. The committed code classifies driver-only loss as `OPENSHELL_GATEWAY_LOST` through a socket probe that no live run has exercised. An owner decision is needed (O-e below).
3. D-1704, as amended on 2026-11-02, says the rotation rule applies to each file. `daemon.log` does not rotate (O-f below).
4. Owner decisions O-a to O-h are open.

No requirement is checked in `REQUIREMENTS.md`. This record does not edit `STATE.md`, `ROADMAP.md` or `REQUIREMENTS.md`, and it runs no build, test, or live step.

## Automated evidence

Reported by the parent for this tree; not rerun here.

| Command | Result |
|---|---|
| `npm run build` | pass |
| `npm test` | 2534 tests, 2501 pass, 0 fail, 0 cancelled, 33 skipped |
| `npx eslint` on the changed TypeScript files | pass |
| `npm run check:docs` | pass |

Read-only checks made for this record: `git log` and `git show --stat` for the commits listed under Commits; grep and read of each file and line cited below; the names and assertions of each test cited. The cited tests were read, not executed.

Docs checks (plan 17-04): none of `realm daemon: <CODE>`, `startupLine`, `not yet observed live` or `does not call them yet` occurs in `docs/integration/` or `AGENTS.md`. The remaining "pending" and "partial" wording (`docs/integration/omp.md:167`, `docs/integration/openshell.md:561`, `docs/integration/runtime-decision.md:338`) is accurate, because the live re-runs have not happened.

## Requirements

| Requirement | Status | Evidence (file:line) | Gap or limit |
|---|---|---|---|
| OBS-01 | Automated: pass. Live: human-needed (scenario 5) | Append path `src/audit/log.ts:75-104`, `:146-152` (head read, torn-tail newline), `:166-177` (`seq` and `prev` added after redaction), `:147-150` (oversize refused). Head from file tail, bounded: `src/audit/chain.ts:118-146`. Streaming verifier with a closed reason enum: `chain.ts:43-51`, pass at `:239-382`, successor rule `:203-207`. CLI: `src/cli/audit.ts:119-164` (exit 0 or 1 from the verdict, 2 for usage), unreadable or non-regular file is exit 1 (`:247-300`), matching research line 100. Reconciliation lines are chained: `src/audit/reconcile.ts:315-322`. Anchor and head pin: `chain.ts:431-487`, `:492-532`. Hash definitions shared (plan 17-01 T1, T2): `src/audit/anchor.ts:30-31`, `:59`, `:64`; `chain.ts:19` imports them; no prefix constant remains in `chain.ts`. Tests: `test/audit/chain.test.ts:45-517` (seq and prev, torn tail, legacy, edit, deletion, reorder at `:133`, CLI exit codes at `:173`, anchor and pin, every prefix of a 40-line file at `:433`), `test/audit/log.test.ts:448` (oversize), `test/audit/chain.test.ts:539` (over-bound tail). | `merkleRootOfLeaves` is not exported (`anchor.ts:100`), though plan 17-01 T1 named it as an export. No consumer needs it: a plan deviation, not a defect. Verifier reason names differ from the research (plan 17-01 open question). |
| OBS-02 | Automated: partial. Live: human-needed (scenarios 5 and 6) | Leveled logger, one JSON object per line, fixed prefix `ts`, `level`, `event`, `code`: `src/observe/logger.ts:110-136`; level parse `:151-158`. Values and secret keys redacted (`logger.ts:118-133`, `src/audit/redact.ts:35`). Never throws: `logger.ts:60-74` (QUAL-01 exception (i), `REQUIREMENTS.md:135`). File sink, `O_NOFOLLOW`, 0600, rotation to `.1` at 4 MiB: `src/observe/log-file.ts:14`, `:48-49`, `:53-60`, `:162-166`. Correlation id per `up`: `src/daemon/daemon.ts:486`, `:493-518`; per tool call: `daemon.ts:530`, passed to the dispatcher at `:533`, used on admission and result audit lines at `src/tools/dispatch.ts:118-137`, `:139-146`, `:247-272`. Events: `lifecycle.transition` `daemon.ts:348-357`; `control.request` (debug) and `control.refused` (warn, code only) `:607-613`; `daemon.starting` `:273`, `daemon.stopping` `:424`, `daemon.stopped` `:440`, `daemon.listening` `:686` (no fields); `up.begin`, `up.end` `:493-518`; `tool.result` `:538-571`; `health.probe_failed` `:327-335`. Entry records: `src/daemon/main.ts:148-164` (`daemon.startup`), `:169-175` (`audit.head`, at startup `:108` and shutdown `:116`), `:305-307` (`daemon.failed`), `:276-288` (uncaught handlers, installed in `main` at `:266`). `REALM_LOG_LEVEL` read only at `main.ts:182`; invalid value gives one `daemon.log-level` warn (`:201-203`). Failure line: `src/daemon/ensure.ts:92`, `:135-150` (JSON parse, LOCK_CONFLICT excluded). Tests: `test/daemon/daemon.test.ts:889` (one correlation id on both audit lines), `:1014`, `:1042`, `:1080`; `test/daemon/main.test.ts:516`, `:549`, `:582` (uncaught, with a RealmError and a plain Error); `test/observe/logger.test.ts:23-168`; `test/audit/reconcile.test.ts:274`; `test/tools/dispatch.test.ts:307`. No new dependency: `package.json` changed only its version and one script since `5719f81`. | (1) `daemon.log` does not rotate. The amended D-1704 says the rotation rule applies to each file. The file sink opens only `requests.log` (`src/daemon/main.ts:183`). `daemon.log` is opened by the CLI spawn (`src/cli/main.ts:320`) and never rotated; `src/daemon/ensure.ts:74-75` gives the reason. Owner decision O-f. (2) `daemon.log-level` warn is emitted (`main.ts:201-203`) but no test checks the emitted line; only `parseLogLevel` is tested (`logger.test.ts:143`). (3) Malformed and unknown-method control lines return before any log or metric (`daemon.ts:596-605`). Plan 17-02 T2 expected "a refused method" to produce `control.refused`; these do not. (4) The `up` id appears on log lines (`upId`) but on no audit line; audit lines carry tool-call ids only. Owner decision O-g. |
| OBS-03 | Automated: pass. Live: human-needed (scenarios 6 and 10) | Control method `metrics`: `src/daemon/channel.ts:17`, timeout `:50`; handler `src/daemon/daemon.ts:581-584`; recorded per request `:610`. Snapshot: `src/observe/metrics.ts:11-14` (schema 1, fixed buckets, closed names and outcomes), `:157-240` (maps keyed only by closed sets, so no path or session id can enter), validator `:290` (`isMetricsSnapshot`). Counters: tool calls by outcome `metrics.ts:180-191`; transitions `:192-200` (from `daemon.ts:349`); attach duration `:201-203` (from `daemon.ts:490`); probe failures `:204-209`. `realm metrics`: `src/cli/main.ts:47` (command list), `:434-445` (absent daemon gives `REALM_NOT_ACTIVE`, exit 1). No network listener: the daemon creates one server, a Unix socket (`daemon.ts:652`, `:684`). Tests: `test/daemon/daemon.test.ts:1489` (metrics over the control socket), `:1564` (`/proc` tables; only the Unix socket is added), `test/observe/metrics.test.ts:21-78`, `test/cli/cli.test.ts:369`. No tool exposes metrics: `src/tools`, `src/mcp` and `src/acp` contain no reference. Status reply: Phase 17 added no field; the only status-reply change in the range (`boundRoot`) came from `ea486f4`, a Phase 16 commit. | Naming only: a tool error is `failed` in metrics (`daemon.ts:565`) and `error` in the log (`:566-571`). |
| OBS-04 | Automated: pass for the gateway path; partial for driver-only loss (owner decision O-e). Live: human-needed (scenario 10, spike S17-b) | Catalogue: `src/core/errors.ts:40` and `:188-192` (reason text equals D-1701; `retryable: true`). Thirty-one codes: `test/core/errors.test.ts:89`. gRPC `UNAVAILABLE`: `src/runtime/driver/grpc-status.ts:39`. Gateway probe: `src/runtime/agentos-driver.ts:35` (10 s bound), `:311-318`; argv `src/runtime/openshell.ts:227-229`. Classification only on the failure path: `src/runtime/agentos.ts:159-185` (healthy path asks nothing more, `:171-184`), `hold` `:286-297`, `classify` `:301-315` (gateway asked first, `:302`; code `:311-312`). Fifth-failure `AGENTOS_CRASH_LOOP` unchanged (`:263-266`). Tests: `test/runtime/agentos-supervisor.test.ts:425` (runner gone, gateway silent, gives LOST), `:456`, `:469`, `:490` (probe false: CRASH_LOOP while gateway answers, LOST while it does not), `:503`, `:604`; `test/daemon/daemon-health.test.ts:298` (state and status reply show LOST, not CRASH_LOOP); `test/lifecycle/controller-health.test.ts:170`, `:205`; `test/doctor/control-channel.test.ts:261`; `test/core/errors.test.ts:189`; `test/runtime/session-execution.test.ts:547`. `exec`, `create` and `up` keep their codes (classification exists only in `check`; `docs/integration/runtime-decision.md:343`). | Driver-only loss. D-1701 (`17-CONTEXT.md:19`) lists "driver-only loss" among the coverage limits. The code does classify it: when the gateway answers and the compute-driver socket does not, the held code is LOST (`agentos.ts:305-312`; `agentos-driver.ts:111-113`, `:323-328`). Commits `a24cdc2` and `76a5dc0` cite an "owner ruling, OBS-04"; no ratification appears in the planning files of this tree. `runtime-decision.md:338` says driver loss is covered by the socket probe, "authored and not run live"; `REQUIREMENTS.md:207` says the driver-only observation is "still live-gated". Scenario 10 stops only the gateway unit (`test/integration/production-driver.test.ts:897`), so no live scenario exercises the driver probe. |

## Locked decisions

| Decision | Status | Evidence | Note |
|---|---|---|---|
| D-1701 gateway code | Partial | As OBS-04. Gateway path matches the locked text. | Driver-only classification extends the locked text (O-e). |
| D-1702 audit chain | Pass (automated) | As OBS-01. `seq` and `prev` as locked; `AUDIT_LINE_MAX_BYTES` 4 MiB (`chain.ts:21`); exit codes per research line 100. | Live scenario 5 not run. |
| D-1703 correlation id | Pass (automated) | `correlationId` `log.ts:51`, `:79`; minted when absent `dispatch.ts:128`; reconciler pairs by id `reconcile.ts:93-98`. `isCorrelationId` `observe/ids.ts:10`. | `log.ts:109-120` stores a SHA-256 for a caller id that redaction would rewrite. The daemon passes only minted UUIDs (`daemon.ts:530`), so no current effect. The `up` id is not on audit lines (O-g). |
| D-1704 logger (amended) | Partial | Routing as amended: request and lifecycle lines to `requests.log` (`daemon.ts:271-273`, `main.ts:183`); `daemon.log` for start, failure and `audit.head` (`main.ts:135-146`). File sink, 0600, `O_NOFOLLOW`, never throws, `droppedLines` (`logger.ts:89`). | The rotation rule applies to `daemon.log` in the amended text and is not implemented (O-f). The locked text says the file sink opens `daemon.log`; under the amended routing it opens `requests.log`, so the text needs a matching amendment. |
| D-1705 metrics | Pass (automated) | As OBS-03. Strict snapshot, closed sets, bounded memory, `/proc` listener test, no tool. | Live counts pending (scenarios 6 and 10). |
| D-1706 pull requests | Not verifiable from this tree | Every Phase 17 unit is in branch history after `5719f81` (for example `c898823`, `2aafd01`, `82e3928`, `2e48073`, `0ecd784`, `a24cdc2`, `1829d4f`). The tree does not record PR merge order. Unit D is not run. | Process record, not code. |
| P17-O1 `openshell status` verb | Pass | `src/runtime/openshell.ts:227-229`; `AGENTS.md:103`; `runtime-decision.md:330`. | |
| P17-O2 failure line as `daemon.failed` | Pass | `src/daemon/ensure.ts:92`, `:135-150`; `src/daemon/main.ts:305-307`; migrated tests (plan 17-02 completion list). | |
| P17-O3 logger counts failures (QUAL-01 (i), (j)) | Pass | `src/observe/logger.ts:60-74`; `src/observe/log-file.ts:95-98`, `:140-145`, `:181-189`, `:196-208`; `REQUIREMENTS.md:135-136`. | |
| P17-O4 `REALM_LOG_LEVEL` | Pass (automated) | Read only at `src/daemon/main.ts:182`; default `info` (`logger.ts:151-158`); allowlisted in `src/daemon/spawn-env.ts:17`. | No test checks the warn line (gap 2 under OBS-02). |

## Acceptance items (`17-CONTEXT.md`)

1. Each audit line carries `seq` and `prev`; verify names the broken line; reconciliation inside the chain (OBS-01): automated pass; scenario 5 **human-needed**.
2. Daemon log JSON with a correlation id matching the admission and result lines (OBS-02): automated partial (rotation, unlogged refusals); scenario 6 **human-needed**.
3. `realm metrics` over the control socket, no network listener (OBS-03): automated pass; scenarios 6 and 10 **human-needed**.
4. `OPENSHELL_GATEWAY_LOST`, not `AGENTOS_CRASH_LOOP`, on a stopped gateway (OBS-04): automated pass for the gateway path; scenario 10 **human-needed**; driver half open (O-e, S17-b).

## Plan units

| Unit | Status | Evidence and note |
|---|---|---|
| 17-01 T1 shared hashes | Done, one deviation | `334c1ad`; `anchor.ts:30-31`, `:59`, `:64`; `merkleRootOfLeaves` not exported (`:100`). |
| 17-01 T2 chain imports hashes | Done | `chain.ts:19`; no prefix constant. |
| 17-01 T3 oversize and over-bound tests | Done | `2640681`; `log.test.ts:448`; `chain.test.ts:539`. The mapping to `AUDIT_WRITE_FAILED` already existed (`log.ts:96-103`); no production change. |
| 17-02 T1 `lifecycle.transition` | Done | `daemon.ts:348-357`; `daemon.test.ts:1014`. |
| 17-02 T2 `control.request` and `control.refused` | Done, with a gap | `daemon.ts:607-613`; malformed and unknown-method refusals not logged (`:596-605`). |
| 17-02 T3 daemon lifecycle lines | Done | `daemon.ts:273`, `:424`, `:440`, `:686`; `daemon.test.ts:1080`. `daemon.starting` precedes `runStartupMaintenance` (`:715`). |
| 17-02 T4 `audit.head` | Done | `main.ts:108`, `:116`, `:169-175`; `main.test.ts:516`, `:549`. |
| 17-02 T5 uncaught handler | Done | `main.ts:276-288`; `main.test.ts:582`. |
| 17-02 T6 changed test expectations | Not checked | Completion list not in the tree. |
| 17-03 T1 log-reading helpers | Done | `test/support/production-live.ts:1186`, `:1222`; `test/integration/production-live-helpers.test.ts:631` onward. |
| 17-03 T2 scenario 6 correlation join | Written, not run | `test/integration/production-driver.test.ts:701-722`. |
| 17-03 T3 skip-path check | Not run by this record | |
| 17-04 T1 to T5 docs | Done | Stale-string checks above; `AGENTS.md:71`, `:103`, `:155`; `hardening-plan.md:97`; `runtime-decision.md:219-223`, `:320-343`; `omp.md:128`, `:167`. |
| 17-05 T1 to T4 live and records | Not run | Human-needed (below). |

## Live and human-needed steps (not run)

| Step | Covers | Assertions in code | Status |
|---|---|---|---|
| Scenario 5 | OBS-01, OBS-02 | `test/integration/production-driver.test.ts:535`; audit verify exit 0 at `:614-617`; JSON `daemon.log` lines and `daemon.startup` at `:611-612`. | Written, gated on `REALM_LIVE_PRODUCTION`; not run; not approved. |
| Scenario 6 | OBS-02, OBS-03 | `:742`; metrics at `:692-699`; write `tool.result` correlation id on two audit lines and JSON `requests.log` at `:701-722`. | Written; not run; not approved. |
| Scenario 10 | OBS-03, OBS-04 | `:897-953`; `OPENSHELL_GATEWAY_LOST` and no `AGENTOS_CRASH_LOOP` (`:939`); listeners (`:921`); metrics count (`:952-953`). | Written; not run; not approved. |
| Spike S17-b (driver-only stop) | OBS-04 driver half | Plan 17-05 T2: four observations. | Not run; decides O-e. |
| Plan 17-05 T3 and T4 records | docs | After the runs above. | Not run. |

The live assertions are written and gated on `REALM_LIVE_PRODUCTION` (`production-driver.test.ts:9`). This record did not set that variable. The owner holds the window and plans to batch Phase 17 with Phase 18.

Earlier live results are not Phase 17 evidence for this tree. Spike S17-a is recorded (`docs/integration/openshell.md:559`). The ten-scenario run of 2026-10-30 predates the 2026-11-01 and 2026-11-02 commits (`openshell.md`, plan 17-03). Scenario 5 PASS on 2026-11-02, recorded in the Phase 14 record, is the CRASH-04 step, not Phase 17 evidence.

## Owner decisions (open)

- **O-a. `audit.head` scan cost.** `src/daemon/main.ts:107` says the scan runs on the event loop. `checkAuditFile` (`src/audit/chain.ts:431-464`) streams the whole session file synchronously at startup and at shutdown. The only bound is the per-line limit; there is no file-size cap.
- **O-b. Unreadable audit file gives no diagnostic.** `main.ts:171-172` logs nothing when `head` is undefined, which covers a missing file, an unreadable file, and a file with no chained line.
- **O-c. Crash stack not logged.** `main.ts:299-307` logs only the code. A non-`RealmError` maps to `SCHEMA_INVALID` (plan 17-02 open question 3).
- **O-d. `audit.head` covers only the daemon's own session file.** `main.ts:170` names `daemon.jsonl` only.
- **O-e. Driver-only loss (D-1701).** Decide one of: (a) ratify the socket probe as coverage, and amend D-1701's coverage-limit text and `runtime-decision.md:338` to match; or (b) restore the coverage limit and remove the driver probe from the held-code path. Either way, S17-b must decide the live behaviour before the record is closed. Code: `src/runtime/agentos.ts:301-315`, `src/runtime/agentos-driver.ts:111-113`, `:323-328`.
- **O-f. `daemon.log` rotation (D-1704 amended).** Either implement rotation for `daemon.log` (with a fix for `daemonStartFailureSince` and the unlinked-inode reason in `src/daemon/ensure.ts:74-75`), or record that `daemon.log` is exempt.
- **O-g. `up` correlation id and the verifier reason names.** Confirm that the OBS-02 join is required for tool calls only, so the `up` id needs no audit line. Confirm the verifier reason names, which differ from the research (plan 17-01).
- **O-h. Plan 17-02 open question 2.** `audit.head` is a research element, not a locked decision. It is kept; the owner may drop T4. Question 1 (`requests.log`) is resolved by ratification (`025175b`).

## Gaps and limits

- Plan items not met, for remediation outside the owner decisions: (1) malformed and unknown-method control refusals are not logged or counted (`daemon.ts:596-605`); (2) the `daemon.log-level` warn has no test; (3) `merkleRootOfLeaves` is not exported (`anchor.ts:100`); (4) the tool-error outcome name differs between metrics and log.
- Not verified: test execution (the parent reported the gate results); plan 17-02 T6 expectation changes; the PR merge order for D-1706; anything live.
- Reading of OBS-02: "the daemon's log" is read as `requests.log` plus `daemon.log`, per the amended routing.

## Commits

| Unit | Commits (date) |
|---|---|
| Gateway code, D-1701, OBS-04 | `a3f87df` part 1 (10-30); `5a68eea` (11-01); `76a5dc0` (11-01); `a24cdc2` (11-01) |
| Audit chain, D-1702, OBS-01 | `c898823` (10-30); `2aafd01` (11-01); `1fa8f1b` (11-01); `d91deb0` (11-01); `59804f5` (11-02); `334c1ad` (11-02); `2640681` (11-02); `1fa6c98` (11-02) |
| Observe libraries, D-1704, C0 | `82e3928` (10-30) |
| Daemon logging and correlation, D-1703, C1 | `f27e70e` (10-30); `50fe21f` (10-30); `2e48073` (11-01); `7e122b3` (10-30); `1829d4f` (11-02) |
| Metrics, D-1705, C2 | `0ecd784` (10-30) |
| Live assertions, D (not run) | `5292d2c` (10-30); `6ae7530` (11-02); `652919a` (11-02) |
| Docs and planning | `0d299a0` (10-30); `39445b0` (11-02); `9e6ed08` (11-02); `025175b` (11-02, ratifies D-1704 routing); `6cece62` (11-02) |

## Addendum: gaps closed after this record was written

- daemon.log rotation under the amended D-1704 (verifier gap for OBS-02): closed by `a044d12`. The entry writer now uses the rotating file sink for `<stateDir>/daemon.log`, with stderr only as the fallback for a line the sink refuses. The regression test "a failed start writes daemon.failed to <stateDir>/daemon.log" passes (test/daemon/main.test.ts).
- Malformed and unknown-method control refusals not logged (verifier gap for OBS-02): closed by `757a6b2`. They log `control.refused` at warn with method `unrecognized` and the catalogue code. The regression test "an unknown control method is refused as a warn with method unrecognized" passes (test/daemon/daemon.test.ts). The client's method text is never logged.
- Phase 14 `startupReapLineFor` gap: closed at code level by `652919a`; the live re-run is still needed.

Still open: O-e (D-1701 driver-only probe, owner ratification), O-a (audit.head scan cost), O-b (unreadable audit file diagnostic), O-c (crash stack not logged), O-d (audit.head covers only the daemon's own session file), O-g and O-h. Live items remain human-needed; none has run.

## Owner rulings (2026-11-02)

The owner ruled on O-a to O-e on 2026-11-02. Each ruling is recorded as a dated amendment in `17-CONTEXT.md` (D-1701 and D-1704) and in `docs/integration/runtime-decision.md`. The code change for O-a and O-b follows in the commit titled "fix(audit): read the audit head from the file tail (OBS-02)". The text above is unchanged.

| Item | Outcome |
| --- | --- |
| O-a. `audit.head` cost | Ruled: the head is read from the file tail only. It carries `sessionId`, `seq` and `lineSha256`, with no `line` field. The read is bounded to two 4 MiB windows, so its cost no longer grows with the file size. Code change in the commit above. |
| O-b. unreadable audit file | Ruled: an audit file that exists but cannot be read logs `audit.unreadable` (warn, reason `unreadable`) to `<stateDir>/daemon.log` through the entry writer, at startup and at shutdown. A missing file and a file with no chained line log nothing. Code change in the commit above. |
| O-c. crash stack | Ruled: accepted as a trade-off. An uncaught failure logs only the catalogue code (`daemon.failed`); stacks are not logged, by the privacy rule. No code change. |
| O-d. `audit.head` scope | Ruled: documented as is. `audit.head` covers only the daemon's own session file, `audit/daemon.jsonl`. No code change. |
| O-e. driver-only loss (D-1701) | Ruled: ratified and amended. Driver-only loss is classified as `OPENSHELL_GATEWAY_LOST` when the driver's socket probe fails. The probe runs on the supervisor's failure path (`src/runtime/agentos.ts`, `src/runtime/agentos-driver.ts`). Driver-only loss is removed from the D-1701 coverage limits. No code change. |

O-f, O-g and O-h are not covered by these rulings and remain open. The rulings do not close the live items: scenarios 5, 6 and 10 and spike S17-b have not run, and this addendum claims no live result.

Amendment (2026-11-02, later the same day): the owner answered the Phase 18 question on `audit.head` with per-session heads, as Phase 18 plan C6 has it. That amends the O-d row above (documented as is) for each session's audit file, `<stateDir>/audit/<sessionId>.jsonl`. The daemon's own file keeps its head. This amendment is recorded in `.planning/STATE.md` and in the Phase 18 contract (plan 01).
