# Phase 14 context: crash-safety pack

Status: planning (2026-10-29). Milestone v3.0, runtime lane, first phase. Requirements CRASH-01 to CRASH-07 (`.planning/REQUIREMENTS.md`). Scope source: proposal 4 of `.planning/quick/261029-g7m-lifecycle-and-persistence-findings/IMPROVEMENT-PROPOSALS.md`. The code facts below are cited from `14-RESEARCH.md` (a read-only research pass over the code, with line numbers and evidence labels); the planner and the implementation agents read it.

## Baseline
`main` at the release that carries the milestone start (0.3.0). CI is green on Node 22 and 24. The unit suite before any change is the one that release shipped; nothing is run locally before the first change except what the orchestrator records in the verification file.

## Owner decisions that bind this phase
- D5 (2026-10-29): one catalogue addition is approved here, for audit reconciliation, because no existing code fits (`AUDIT_WRITE_FAILED` says the call did not run). The count goes from 29 to 30. Phase 17 adds the second approved code (TD-05), so the count assertions must be written so that the next edit is one line.
- D1 (all proposals) and the rules of `AGENTS.md` apply. No other catalogue, policy-schema, session-record or tool-schema change is made. Anything that needs one stops and is reported.

## Locked decisions (the planner's calls, each recommended by the research)
- **D-1401 sweep scope:** the sweep covers `policy.workspaceRoots`, `<stateDir>/sessions` and `<stateDir>/runtime`, with no skip list. A root that lies inside an earlier root is dropped. It removes only regular files named exactly `.<name>.realm-tmp-<16 lowercase hex>`, owned by the daemon's uid, older than `ORPHAN_TEMP_MIN_AGE_MS` (60 000 ms), on the root's device, reached through a pinned directory descriptor and never through a symlink. Wall budget 15 s, entry cap 500 000; a hit sets `truncated`. The writer and the sweeper share one exported `TEMP_NAME_PATTERN` so they cannot drift.
- **D-1402 sweep audit:** one audit line per removal, written before the unlink: `tool: "temp-sweep"`, outcome `ok`, `path`, `bytes`, no `phase`. If the audit append throws, the file is kept and counted. If the unlink then fails, a second line with the existing code `CLEANUP_FAILED`.
- **D-1403 reconciliation:** new code `AUDIT_OUTCOME_UNKNOWN`, `retryable: false`, gRPC status `INTERNAL`, reason "The process ended before this call's result was recorded; whether the call took effect is unknown." A new audit `phase` value `"reconciliation"`. Pairing counts admission lines against result and reconciliation lines per key `(tool, path, execSummary)` through one exported `pairingKey`, so Phase 17 can swap it for the correlation id. Lines are appended only through `appendAudit`. A torn last line (no trailing newline) is closed with a newline inside `writeAuditLine`. Files over 256 MiB are skipped and counted.
- **D-1404 notice:** an optional `notice` string on the daemon `status`, `up` and `down` replies, added only when the startup reap destroyed something and kept for the daemon's lifetime (no consume-on-read, because Omp's attach calls `up` before `status`). It is not in the tool contract, the snapshot or the session record. Omp shows it once per attach through `ui.notify`; `realm status` prints it with the JSON; `realm mcp` and `realm acp` write it to diagnostics. Text: `A previous daemon's sandbox was destroyed at startup: <n> container(s), <m> session record(s). Files in the workspace were kept; state outside it was lost.`
- **D-1405 container ids:** `removeAllRealmContainers` gains an optional `onRemoved(id)` callback; its return type and the other callers do not change.
- **D-1406 TD-01:** the refused `ToolOutcome` variant gains an optional `causeCode`; the dispatcher passes the caught error's cause; the daemon's `tool` error reply carries it. The shapes seen over the daemon and in process are not unified in this phase; that is recorded as a candidate owner decision.
- **D-1407 durable delete:** `SessionStore.delete` syncs the sessions directory after the unlink; a sync failure is a `RealmError` with `WRITE_NOT_ATOMIC`.
- **D-1408 TD-04:** when the recorded container's start fails with `OPENSHELL_START_FAILED` and no create ran in this call, `create` destroys that container once, clears the recorded id, and creates again, once per call. No other code triggers it; `AGENTOS_CRASH_LOOP` keeps the container. The change lives in one private method.
- **D-1409 startup order:** reap, then the temp sweep, then audit reconciliation, then the report, then `openGate()`. A sweep or reconciliation failure is reported and never aborts the start. The block is one function, `runStartupMaintenance`, because Phases 17 and 19 edit it.
- **D-1410 live proof:** scenario 5 of the production live suite (the daemon is killed and restarted) also asserts that `realm status` after the restart carries the notice and that the destroyed container id is in the daemon log.

## Frozen contracts touched
Error catalogue (+1 code); the audit line format (a new `phase` value and a new `tool` value, both additive); the refused `ToolOutcome` variant (an optional field); the control `status`/`up`/`down` replies (an optional field, like `mode` before it). Not touched: the `ExecutionService` port, the session-record schema, `tools.schema.json`, the display mapping, the state table, `docs/specs/realm-spec.xml`.

## Acceptance (the ROADMAP success criteria, made testable)
1. For each of the four stages a real-SIGKILL test leaves the original bytes intact and one orphan temp file, and the sweep removes it with an audit line; the age bound, owner, pattern and no-symlink rules each have a negative test.
2. A planted admission with no result gets exactly one reconciliation line at the next start and none at the second.
3. `SessionStore.delete` syncs the directory (observed through an fsync spy); the startup reap is logged with the container ids and counts; the notice reaches `realm status`, the Omp status flow and the MCP and ACP attach diagnostics.
4. A daemon-path test shows the same refusal cause code over MCP and ACP as in process.
5. A controller test with the recorded container removed reaches `active` on retry with a new container id.
6. The live suite scenario 5 shows the notice and the log line on the production stack.

## Risks and stop conditions
- The sweep deletes by name pattern in the user's workspace. The match is exact and conservative (D-1401); a user file literally named like an orphan older than 60 s is removed by design (the requirement accepts this).
- Phase 19 rewrites `reapStartup` and the report; Phase 17 replaces the stderr line with its logger; Phase 18 changes what a root is. Keep `runStartupMaintenance`, `sweepOrphanTempFiles(roots)`, the report object and `pairingKey` as the stable seams.
- Stop and report instead of widening scope if: a second catalogue code seems necessary; the `notice` cannot be carried without a tool-contract change; the live suite shows the reap destroying something other than this run's container.
