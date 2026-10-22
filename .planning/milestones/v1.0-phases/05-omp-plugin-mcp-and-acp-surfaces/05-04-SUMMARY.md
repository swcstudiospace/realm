---
phase: 05-omp-plugin-mcp-and-acp-surfaces
plan: 05-04
subsystem: infra
tags: [acp, stdio, json-rpc, dispatcher, node-test]

# Dependency graph
requires:
  - phase: 04-reaper-egress-guard-and-shared-dispatcher
    provides: ToolDispatcher.call as the only tool entry point plus makeHarness test fakes
  - phase: 05-omp-plugin-mcp-and-acp-surfaces/05-02
    provides: docs/integration/acp.md Q5 recording v1 plus the realm/tool extension
provides:
  - ACP v1 stdio agent speaking protocolVersion 1 over newline-delimited JSON-RPC with the realm/tool Realm extension routing all six tools to ToolDispatcher.call
affects: [05-omp-plugin-mcp-and-acp-surfaces/05-06, TOOL-05 equivalence proof, ACP live acceptance]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 4800
  tasks: 3
  commits: 0

# Tech tracking
tech-stack:
  added: []
  patterns: [injected-stdio-streams, event-driven-test-waiters, envelope-then-dispatch]

key-files:
  created: [src/acp/agent.ts, test/acp/agent.test.ts]
  modified: []

key-decisions:
  - "realm/tool params envelope is { tool: ToolCall }; the embedded map crosses to dispatcher.call unchanged"
  - "JSON-RPC result of realm/tool is the ToolOutcome itself, so refusal codes surface with no adapter-added mapping"
  - "Batch arrays are rejected and sequential per-line handling keeps one reply line per request line"
  - "Tests wait on stream data events with per-test timeout guards; no wall-clock sleeps"

patterns-established:
  - "Surface modules import the dispatcher type only and call nothing but call (P5-D11)"
  - "Stdio surfaces take injected streams plus a log sink defaulting to stderr; stdout carries only protocol messages"

requirements-completed: [TOOL-05]

# Coverage metadata (#1602) — verification NOT run here: shared constraints forbid
# running tests/typecheck, so every status is unknown and verify-work routes each
# deliverable to the orchestrator gates.
coverage:
  - id: D1
    description: "ACP v1 initialize over stdio with the never-batched lifecycle rule and stderr-only diagnostics"
    requirement: "TOOL-05"
    verification:
      - kind: unit
        ref: "test/acp/agent.test.ts#TOOL-05: a v1 initialize request gets a protocolVersion 1 reply on one line with stderr-only diagnostics"
        status: unknown
      - kind: unit
        ref: "test/acp/agent.test.ts#TOOL-05: initialize, session/new, and session/prompt equivalents are never packed into one batch line"
        status: unknown
      - kind: unit
        ref: "test/acp/agent.test.ts#TOOL-05: closing stdin shuts the adapter down without hanging"
        status: unknown
    human_judgment: false
  - id: D2
    description: "realm/tool extension routing all six ToolCall maps unchanged with faithful catalogue-code refusals and unknown-method rejection"
    requirement: "TOOL-05"
    verification:
      - kind: unit
        ref: "test/acp/agent.test.ts#TOOL-05: a realm/tool request carrying each of the six ToolCall maps routes to ToolDispatcher.call with the map unchanged"
        status: unknown
      - kind: unit
        ref: "test/acp/agent.test.ts#TOOL-05: a dispatcher refusal surfaces the catalogue code in the realm/tool reply without adapter-added logic"
        status: unknown
      - kind: unit
        ref: "test/acp/agent.test.ts#TOOL-05: a request naming any other tool method is rejected without reaching the dispatcher"
        status: unknown
    human_judgment: false
  - id: D3
    description: "Session lifecycle drive with dispatcher-equal outcomes over in-memory stdio"
    requirement: "TOOL-05"
    verification:
      - kind: unit
        ref: "test/acp/agent.test.ts#TOOL-05: initialize then realm/tool status then realm/tool write complete in order over in-memory stdio"
        status: unknown
      - kind: unit
        ref: "test/acp/agent.test.ts#TOOL-05: the status outcome carries the shared displayStatus label, not an adapter-invented label"
        status: unknown
      - kind: unit
        ref: "test/acp/agent.test.ts#TOOL-05: a required-mode refusal over the lifecycle drive equals the dispatcher's own refusal"
        status: unknown
    human_judgment: false

# Metrics
duration: single-session
completed: 2026-10-22
status: complete
---

# Phase 05 Plan 04: ACP v1 Stdio Adapter Summary

**ACP v1 stdio agent with the realm/tool Realm extension routing all six ToolCall maps unchanged to ToolDispatcher.call, covered by nine TOOL-05 cases over in-memory streams**

## Performance

- **Duration:** single execution session (no wall-clock tracking; verification gates owned by orchestrator)
- **Started:** 2026-10-22
- **Completed:** 2026-10-22
- **Tasks:** 3
- **Files modified:** 2 (both created)

## Accomplishments

- `src/acp/agent.ts`: v1 `initialize` with at-or-below negotiation, newline-delimited JSON-RPC framing, stdout-only protocol bytes, stderr diagnostics, batch rejection, unknown-method rejection before dispatch, and `realm/tool` carrying the ToolCall map unchanged to `dispatcher.call`
- `test/acp/agent.test.ts`: nine TOOL-05 cases — v1 reply shape, never-batched lifecycle lines, close-on-stdin-end, six-tool unchanged routing, code-faithful refusals, unknown-method rejection, ordered lifecycle drive with dispatcher-equal outcomes, shared displayStatus label, required-mode refusal equality
- No new npm dependency; package.json untouched

## Task Commits

No commits were made in this execution: the shared constraints for this assignment forbid git commands, so per-task commits are owned by the orchestrator. Task-to-file mapping for the orchestrator to commit:

1. **Task 1: v1 initialize over stdio with the batch rule (P5-D3, P5-D10)** — `src/acp/agent.ts` (framing, initialize, batch rule, lifecycle) + `test/acp/agent.test.ts` (initialize, batch, close cases)
2. **Task 2: realm/tool extension carrying the six tools (P5-D10, P5-D11)** — `src/acp/agent.ts` (realm/tool branch) + `test/acp/agent.test.ts` (six-tool routing, refusal, rejection cases)
3. **Task 3: Session lifecycle drive with dispatcher-equal outcomes (TOOL-05)** — `test/acp/agent.test.ts` only (drive, label, required-mode refusal cases; adapter module unchanged)

## Files Created/Modified

- `src/acp/agent.ts` — ACP v1 stdio agent; parses envelopes, answers initialize, routes realm/tool to ToolDispatcher.call; holds no tool logic
- `test/acp/agent.test.ts` — Nine TOOL-05 cases driving the adapter over PassThrough streams against makeHarness

## Decisions Made

- `realm/tool` params envelope is `{ tool: ToolCall }` (plan discretion: exact envelope layout, carrying the whole map unchanged). The reply `result` is the ToolOutcome itself, so refusals surface catalogue codes with no adapter-added mapping.
- Batch arrays received on a line are rejected with `-32600`; sequential per-line handling guarantees one reply line per request line, which is what the never-batched test asserts.
- Version negotiation: any integer `protocolVersion >= 1` selects 1 (highest supported at or below the request); lower or non-integer values get `-32602`.
- Tests wait on stream `data` events via registered waiters with per-test `timeout: 10_000` guards; no wall-clock sleeps. `new Promise` executor form is used because the tsconfig lib (ES2023) predates `Promise.withResolvers` (ES2024).
- The module-local `isRecord` guard follows the existing `src/runtime/hardening.ts` / `src/runtime/libpod-client.ts` precedent for parsing untrusted boundary bytes (stdin JSON, daemon replies).

## Deviations from Plan

None - plan executed exactly as written. No auto-fixes, no architectural changes, no new files beyond the two the plan names.

## Threat Flags

None beyond the plan's threat register. Implementation notes for the mapped mitigations:

- T-05-07 (mitigate): only `realm/tool` reaches `dispatcher.call`, and the embedded map is passed as received; unknown methods, malformed lines, and batch arrays are rejected before any dispatch. Proven by the unknown-method/malformed-line case asserting zero dispatcher calls.
- T-05-08 (accept): lifecycle messages are never batched; each request line yields exactly one reply line in order. Proven by the three-line batch-rule case and the ordered lifecycle drive.

## Issues Encountered

None. Typecheck and tests were not run here (shared constraints forbid it); the orchestrator runs `npx tsc -p tsconfig.json && node --test dist/test/acp/agent.test.js` plus the TOOL-05 title grep as gates.

## Stub Tracking

No stubs. No hardcoded empty values, placeholders, TODOs, or unwired data sources in either file.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for plan 05-06 equivalence proof: the adapter returns the dispatcher's own ToolOutcome values, so MCP/ACP outcome equality compares directly after transport-envelope stripping.
- Ready for the P5-D12 static no-logic guard: `src/acp/agent.ts` references no guarded symbol and calls no dispatcher member except `call`.
- Live ACP client acceptance remains live-gated (OQ-P5-03), consistent with the phase verification boundary.

---
*Phase: 05-omp-plugin-mcp-and-acp-surfaces*
*Completed: 2026-10-22*
