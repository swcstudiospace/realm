# Phase 17 context: observability and tamper-evident audit

Status: planning (2026-10-29). Milestone v3.0, runtime lane, second phase (after Phase 14). Requirements OBS-01 to OBS-04 (`.planning/REQUIREMENTS.md`). Scope source: proposal 7 of `.planning/quick/261029-g7m-lifecycle-and-persistence-findings/IMPROVEMENT-PROPOSALS.md`, plus TD-05. The code facts below are cited from `17-RESEARCH.md` (a read-only research pass with file and line evidence and evidence labels); implementation agents read the sections their unit names.

## Baseline
`main` at the 0.3.3 release, with Phase 14 part 2 (the startup maintenance and the notice) in review. Units that touch `src/daemon/daemon.ts`, `src/audit/reconcile.ts` or `src/cli/main.ts` start after that pull request merges.

## Owner decisions that bind this phase
- D5 (2026-10-29): exactly one catalogue addition is approved here, for gateway or driver loss (TD-05). The count goes from 30 to 31. No other catalogue, policy-schema, session-record or tool-schema change is made; anything that needs one stops and is reported.
- D1 (all proposals) and the rules of `AGENTS.md` apply, including the rule that a new runtime decision is recorded in `docs/integration/runtime-decision.md` before its code.

## Decisions the orchestrator took on the owner's behalf (D1 and D5 authorize the phase; each is the research's recommended default, listed so the owner can overrule it)
- **P17-O1:** the verb `openshell status` joins the pinned OpenShell CLI verbs (`sandbox create|exec|delete`). It is the only discriminator between a dead gateway and a stale AgentOS heartbeat that does not match CLI error text. Recorded in `runtime-decision.md` before the code.
- **P17-O2:** the daemon's failure line `realm daemon: <CODE>` becomes the JSON event `daemon.failed`. The roadmap's success criterion says the daemon log is one JSON object per line; two formats would need two parsers. `src/daemon/ensure.ts` parses the JSON line.
- **P17-O3:** QUAL-01 gains a named exception (i): a catch that records a failure as counted state and never throws is allowed in the logger's sink path (`droppedLines`), because a throwing logger on an event-bus listener would throw out of a state transition.
- **P17-O4:** `REALM_LOG_LEVEL` is the one new environment variable, read only in `src/daemon/main.ts`, default `info`; an invalid value falls back to `info` with one warning.

## Locked decisions
- **D-1701 gateway code (OBS-04):** `OPENSHELL_GATEWAY_LOST`, `retryable: true`, gRPC `UNAVAILABLE`, reason "The OpenShell gateway, or the compute driver behind it, did not answer, so the sandbox cannot be reached; restore the gateway, then retry." Detection: `AgentOsDriver.gatewayAnswers()` runs `openshell status` (bounded by `GATEWAY_STATUS_TIMEOUT_MS`, 10 s); `AgentOsSupervisor.check()` classifies only on the failure path: runner gone or probe failed, then the gateway is asked, and the held code is `OPENSHELL_GATEWAY_LOST` when it does not answer, `AGENTOS_CRASH_LOOP` otherwise. `create`/`up` and the exec tool keep their codes. Coverage limits (driver-only loss, a missing gateway config, a runner that dies as the gateway returns, a TLS failure) are stated in the decision record.
- **D-1702 audit chain (OBS-01):** every audit line gains `seq` (integer, +1 per line of the chain) and `prev` (lowercase hex sha256 of the raw bytes of the previous physical line; 64 zeros for the first). The chain head is recovered statelessly from the file tail on each append (bounded by `AUDIT_LINE_MAX_BYTES`, 4 MiB); a pre-chain file continues without a marker line (the first chained line commits to the last legacy line; legacy lines are reported as unprotected); a torn tail is closed by the writer and the fragment stays a line of its own. `seq` and `prev` are added after redaction. `realm audit verify [--session <id> | --file <path>] [--anchor <record.json>] [--head <seq>:<sha256>]` reads files through a read-only, no-follow descriptor, names the first line whose link fails with a closed reason enum, and exits 0 only when every file verified. What the chain cannot detect (tail truncation without an anchor or head, an attacker who recomputes the chain, forged appended lines) is stated in the docs and never presented as secure.
- **D-1703 correlation id (OBS-02):** an optional `correlationId` (`/^[A-Za-z0-9_-]{1,64}$/`) on audit lines; `ToolDispatcher.call(raw, context?)` takes it and mints one when absent; the reconciler pairs by correlation id when a line carries one and by `(tool, path, execSummary)` otherwise. MCP, ACP and Omp results do not change (the tool contract is frozen).
- **D-1704 logger (OBS-02):** `src/observe/{logger,log-file,metrics,ids}.ts`, no dependency. One JSON object per line with the fixed prefix `ts`, `level`, `event`, then `code`; values are redacted; the logger never throws; the file sink opens `<stateDir>/daemon.log` itself (no-follow, 0600), rotates at 4 MiB to one `daemon.log.1`; the closed event list of the research; a failure before the state directory is known goes to a stderr sink with the same JSON shape.
- **D-1705 metrics (OBS-03):** a new control method `metrics` with a strict snapshot (schema 1, closed key sets, fixed histogram buckets, bounded memory), `realm metrics`, no network listener (a `/proc` listener test proves only the control socket is added). No new MCP/ACP tool, and the `status` reply is unchanged.
- **D-1706 pull requests:** A (gateway code), B (audit chain and `realm audit verify`), C0 (observe libraries, no consumers), C1 (daemon logging, correlation ids, failure-line cutover), C2 (metrics over the control socket), D (live evidence and the recorded spikes). A and C0 start at once; B, C1 and C2 start after Phase 14 part 2 merges; D is last.

## Frozen contracts touched
The error catalogue (one approved addition), the audit line format (additive fields), the control channel (one new method), the `daemon.log` failure line (cutover, P17-O2). Not touched: the tool schema, the session record, the policy schema, `ports` types.

## Acceptance (the ROADMAP success criteria)
1. Each audit line carries `seq` and `prev`; `realm audit verify` passes an untouched file and names the first broken line after an edit, a removal and a reorder, and the Phase 14 reconciliation lines are inside the chain (OBS-01).
2. The daemon log is one JSON object per line with a correlation id per `up` and per tool call that also appears in the admission and result audit lines (OBS-02).
3. `realm metrics` shows counters and timings over the control socket and no network listener exists (OBS-03).
4. A stopped gateway shows `OPENSHELL_GATEWAY_LOST`, not `AGENTOS_CRASH_LOOP`, in `realm status` and in a probe test (OBS-04); the live scenario 10 shows it on the real stack.

## Risks and stop conditions
See the risk table of `17-RESEARCH.md`. Stop and report instead of widening scope if: a second catalogue code seems necessary; `openshell status` does not exit non-zero when the gateway is down on the real stack (spike S17-a); the chain cannot be made to survive the reconciler and a torn tail together.
