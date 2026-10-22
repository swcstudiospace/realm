---
phase: 05-omp-plugin-mcp-and-acp-surfaces
plan: 05-03
subsystem: mcp
tags: [mcp, stdio, json-rpc, dispatcher, node-test]
requires:
  - phase: 05-omp-plugin-mcp-and-acp-surfaces
    provides: 05-CONTEXT.md decisions P5-D1 to P5-D15 and 05-02 mcp.md Q5 revision record
provides:
  - MCP stdio server with 2026-07-28 probe-plus-initialize handling (P5-D9)
  - Six-tool routing to ToolDispatcher.call with unchanged ToolCall maps (P5-D11)
  - Stdio-client-shaped end-to-end drive over the harness dispatcher (P5-D1)
  - P5-D11 static pin (surface calls no dispatcher member except call)
affects: [05-06 (equivalence and no-logic guards run this server against the ACP agent)]
actuals:
  tokens: 5200
  tasks: 3
  commits: 0
tech-stack:
  added: []
  patterns: [node-readline stdio framing, dispatcher-verbatim ToolOutcome replies, hang-guard race on server close]
key-files:
  created: [src/mcp/server.ts, test/mcp/server.test.ts]
  modified: []
key-decisions:
  - "Refusals ride as result envelopes carrying the verbatim ToolOutcome, so the catalogue code surfaces with no server-added decision"
  - "Malformed lines take no stdout reply (stderr only), keeping stdout purity total rather than envelope-shaped"
  - "Tool input schemas mirror the frozen tools.schema.json $defs as descriptions only; the dispatcher re-validates every call"
patterns-established:
  - "Surface-test hang guard: race server.closed against a 2s rejection, matching test/acp/agent.test.ts"
  - "Source-text pins for surface constraints (no dispatcher member except call, no label literals)"
requirements-completed: [TOOL-05]
coverage:
  - id: T1
    description: "Stdio framing with stdout purity, stderr-only diagnostics, and close-on-stdin-end"
    requirement: "TOOL-05"
    verification:
      - kind: unit
        ref: "test/mcp/server.test.ts#TOOL-05: a well-formed request yields exactly one newline-terminated JSON-RPC message on stdout"
        status: unknown
      - kind: unit
        ref: "test/mcp/server.test.ts#TOOL-05: malformed input and server logging go to stderr, never stdout"
        status: unknown
      - kind: unit
        ref: "test/mcp/server.test.ts#TOOL-05: closing stdin shuts the server down without hanging"
        status: unknown
    human_judgment: true
    rationale: "Executor is forbidden from running tests; the orchestrator gate runs the suite before any commit."
  - id: T2
    description: "Probe-plus-initialize handshake per Q5 with six-tool unchanged-map routing and code-faithful refusal envelopes"
    requirement: "TOOL-05"
    verification:
      - kind: unit
        ref: "test/mcp/server.test.ts#TOOL-05: each of the six tools routes to ToolDispatcher.call with the ToolCall map unchanged"
        status: unknown
      - kind: unit
        ref: "test/mcp/server.test.ts#TOOL-05: a dispatcher refusal surfaces the catalogue code in the reply envelope"
        status: unknown
      - kind: unit
        ref: "test/mcp/server.test.ts#TOOL-05: the surface calls no dispatcher member except call (P5-D11)"
        status: unknown
    human_judgment: true
    rationale: "Executor is forbidden from running tests; the orchestrator gate runs the suite before any commit."
  - id: T3
    description: "Stdio-client-shaped drive completes status and write calls with dispatcher-equal replies and the shared display label"
    requirement: "TOOL-05"
    verification:
      - kind: unit
        ref: "test/mcp/server.test.ts#TOOL-05: a stdio-client-shaped driver completes status and write calls end to end"
        status: unknown
      - kind: unit
        ref: "test/mcp/server.test.ts#TOOL-05: the status reply carries the shared displayStatus label, not a server-invented label"
        status: unknown
    human_judgment: true
    rationale: "Executor is forbidden from running tests; the orchestrator gate runs the suite before any commit."
duration: n/a
completed: 2026-10-22
status: complete
---

# Phase 05 Plan 03: MCP Stdio Server Summary

**Newline-delimited JSON-RPC 2.0 stdio server over the shared dispatcher: probe-plus-initialize handling, six-tool unchanged-map routing, and a client-shaped end-to-end drive, with no tool logic in the surface.**

## Performance

- **Duration:** not tracked by executor (plan constraints forbid running gates)
- **Started:** 2026-10-22
- **Completed:** 2026-10-22
- **Tasks:** 3
- **Files modified:** 2 created, 0 modified

## Accomplishments

- `src/mcp/server.ts` speaks newline-delimited JSON-RPC 2.0 over stdio with `node:readline` plus `JSON` only: one newline-terminated object per reply on stdout, all diagnostics on stderr, stop on stdin close, no new dependency (P5-D2)
- Answers `server/discover` and `initialize` with revision `2026-07-28`, stateless per request, exactly as `mcp.md` Q5 records (P5-D9)
- Exposes all six tools via `tools/list` plus `tools/call`, converts each request into the `ToolCall` map unchanged, returns `ToolDispatcher.call`'s `ToolOutcome` verbatim, and touches no dispatcher member except `call` (P5-D11)
- `test/mcp/server.test.ts` proves framing purity, both handshakes, six-tool unchanged routing in order, catalogue-faithful refusals, and a probe-first status-plus-write drive whose replies deep-equal the harness dispatcher's own outcomes with the shared `realm active` label

## Task Commits

No per-task commits were made by the executor: the assignment forbids all git commands and commits, and the orchestrator commits between waves.

1. **Task 1: stdio framing with stdout purity (P5-D2, P5-D9)** — uncommitted (orchestrator commits)
2. **Task 2: Revision handshake and six-tool routing over the dispatcher (P5-D9, P5-D11)** — uncommitted (orchestrator commits)
3. **Task 3: Stdio-client-shaped end-to-end drive (P5-D1, TOOL-05)** — uncommitted (orchestrator commits)

## Files Created/Modified

- `src/mcp/server.ts` - MCP stdio server (`createMcpServer`, `MCP_PROTOCOL_VERSION`, `MCP_TOOL_DESCRIPTORS`, `McpDispatcher` pick type); type-only dispatcher import, `call` is the sole member used
- `test/mcp/server.test.ts` - 10 TOOL-05 tests: framing purity (3), probe plus initialize (2), six-tool routing plus refusal plus P5-D11 source pin (3), client-shaped drive plus shared-label pin (2); in-memory PassThrough stdio, no real process

## Decisions Made

- Refusals ride as `result` envelopes carrying the verbatim `ToolOutcome`: the catalogue code surfaces by construction with no server-added mapping decision, and the deep-equal refusal test pins the exact shape.
- Malformed lines take no stdout reply at all (stderr diagnostic only): a `Parse error` envelope would still be stdout traffic for unparseable bytes, so total purity is the stronger and simpler rule.
- The `tools/call` argument cross is `{ [name]: args } as ToolCall` with validation deferred to the pipeline: the server checks only name membership and record shape, so schema authority stays in one place.
- `notifications/initialized` and other id-less messages are silently absorbed: JSON-RPC notifications take no reply, and answering one would break the one-reply-per-request shape the tests pin.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Two built-in style reminders fired on write (local `isRecord` guard, `new Promise` executor, real-timer hang guards). All three were left as written: the guard is the module's single canonical boundary check, `Promise.withResolvers` is not in the `ES2023` lib so it would fail typecheck, and the hang-guard race matches the established sibling pattern in `test/acp/agent.test.ts` while still awaiting the real `server.closed` signal.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 05-06 can run this server against the ACP agent over one `makeHarness` dispatcher for the outcome-equal equivalence proof; the `drive` helper pattern in `test/mcp/server.test.ts` shows the shape.
- The P5-D12 no-logic guard can extend its allowlist scan to `src/mcp/server.ts`: the module references none of the D-99 symbols and the P5-D11 source-pin test already proves the dispatcher-member half.
- Verification not run by executor (forbidden): orchestrator must run `npx tsc -p tsconfig.json && node --test dist/test/mcp/server.test.js` and grep the test titles for TOOL-05 per the plan's verification step.

---
*Phase: 05-omp-plugin-mcp-and-acp-surfaces*
*Completed: 2026-10-22*
