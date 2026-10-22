---
phase: 05-omp-plugin-mcp-and-acp-surfaces
plan: 05-06
subsystem: testing
tags: [tool-05, mcp, acp, omp, equivalence, static-guard, taxonomy]

# Dependency graph
requires:
  - phase: 05-omp-plugin-mcp-and-acp-surfaces
    provides: MCP stdio server (plan 05-03) and ACP adapter (plan 05-04) as the two halves under comparison
provides:
  - TOOL-05 outcome-equivalence proof across MCP and ACP on one dispatcher (P5-D13)
  - P5-D12 static no-tool-logic guard over src/mcp/, src/acp/, src/omp/
  - Phase 5 taxonomy coverage for all six Phase 5 requirement IDs (QUAL-02 carry)
affects: [phase-6-cli-and-daemon, verify-work, ship-gate]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 4600
  tasks: 2
  commits: 0

# Tech tracking
tech-stack:
  added: []
  patterns: [outcome-equal comparison after test-edge envelope stripping, grep-source static guard mirroring no-bypass.test.ts]

key-files:
  created: [test/surfaces/equivalence.test.ts, test/surfaces/no-logic.test.ts]
  modified: [test/quality/suite-taxonomy.test.ts]

key-decisions:
  - "Each comparison pair shares one makeHarness dispatcher; the required-mode refusal uses a second REQUIRED/degraded harness both surfaces share"
  - "The dispatcher-only-through-call check anchors on the dispatcher receiver so the plugin's legitimate controller access (handle.controller.snapshot/mutationGate) is not flagged"
  - "Dispatcher-internal forbid-list covers deps shapes, timeout constant, and stage helpers; controller method names are excluded because the Omp plugin legitimately uses them"

patterns-established:
  - "Surface comparison: drive both surfaces over in-memory stdio against one dispatcher, strip only JSON-RPC ids / realm-tool wrappers at the test edge, deep-equal ToolOutcome payloads"

requirements-completed: [TOOL-05]

# Coverage metadata (#1602) — verification status is unknown: this ticket forbids
# running tests/typecheck; the orchestrator runs gates and commits.
coverage:
  - id: D1
    description: "Same-call outcome-equal ToolOutcome payloads through MCP and ACP for all six tools plus both refusal cases on one dispatcher"
    requirement: "TOOL-05"
    verification:
      - kind: unit
        ref: "test/surfaces/equivalence.test.ts#TOOL-05: the same ToolCall for each of the six tools returns outcome-equal payloads through MCP and ACP on one dispatcher (P5-D13)"
        status: unknown
      - kind: unit
        ref: "test/surfaces/equivalence.test.ts#TOOL-05: a schema-invalid call and a required-mode non-active write refuse outcome-equal with the same catalogue code on both surfaces (P5-D13)"
        status: unknown
    human_judgment: true
    rationale: "Executor could not run the suite per ticket constraints; orchestrator gates must confirm green"
  - id: D2
    description: "Static guard proving no surface file references tool internals and spawn( stays in session-execution.ts, with a self-testing planted violation"
    requirement: "TOOL-05"
    verification:
      - kind: unit
        ref: "test/surfaces/no-logic.test.ts"
        status: unknown
    human_judgment: true
    rationale: "Executor could not run the suite per ticket constraints; orchestrator gates must confirm green"
  - id: D3
    description: "Taxonomy cites TOOL-05 and OMP-01 to OMP-05 from named test files with earlier phases intact"
    requirement: "TOOL-05"
    verification:
      - kind: unit
        ref: "test/quality/suite-taxonomy.test.ts#all 6 Phase 5 requirement IDs lead the title of a test in a named D-45 test file (QUAL-02, Phase 5)"
        status: unknown
    human_judgment: true
    rationale: "Executor could not run the suite per ticket constraints; orchestrator gates must confirm green"

# Metrics
duration: unknown
completed: 2026-10-22
status: complete
---

# Phase 05 Plan 06: Surface Equivalence and No-Logic Guard Summary

**Same ToolCall through MCP and ACP returns outcome-equal payloads on one dispatcher, a static guard proves the three surfaces hold no tool logic, and the taxonomy cites all six Phase 5 IDs.**

## Performance

- **Duration:** unknown (executed inline; no wall-clock tracking per ticket constraints)
- **Started:** 2026-10-22
- **Completed:** 2026-10-22
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `test/surfaces/equivalence.test.ts`: outcome-equal comparison for all six tools plus a schema-invalid refusal and a required-mode non-active write refusal, each pair sharing one `makeHarness` dispatcher with envelope stripping at the test edge only (P5-D13)
- `test/surfaces/no-logic.test.ts`: P5-D12 static guard in the D-99 grep-source style — zero-tolerance D-99 symbol and dispatcher-internal checks over `src/mcp/`, `src/acp/`, `src/omp/`, dispatcher-only-through-`call` check, `spawn(` single-site check, and a planted-violation self-test
- `test/quality/suite-taxonomy.test.ts`: realm, mcp, acp, omp, surfaces, and docs category entries plus a `PHASE_5_REQUIREMENT_IDS` leading-title check mirroring the Phase 4 check (QUAL-02 carry)

## Task Commits

No commits made — this ticket forbids git operations; the orchestrator runs gates and commits.

1. **Task 1: MCP-versus-ACP outcome equivalence on one dispatcher (P5-D13)** — uncommitted
2. **Task 2: No-tool-logic static guard plus taxonomy coverage (P5-D12)** — uncommitted

## Files Created/Modified

- `test/surfaces/equivalence.test.ts` (new) — TOOL-05 outcome-equal comparison across MCP and ACP on one dispatcher (P5-D13); envelope stripping in-test only, both surfaces untouched
- `test/surfaces/no-logic.test.ts` (new) — P5-D12 static guard over the three surfaces plus `spawn(` single-site proof and self-test
- `test/quality/suite-taxonomy.test.ts` (extended) — Phase 5 category entries, seven new D45 files, `PHASE_5_REQUIREMENT_IDS` list and leading-title check

## Decisions Made

- Each comparison pair shares one `makeHarness` dispatcher: the six tools and the schema-invalid refusal run MCP-then-ACP sequentially against one advisory/active harness; the required-mode write refusal runs against a second REQUIRED/degraded harness both surfaces share. Sequential same-content writes are idempotent (`WriteOutcome` is `{sha256, bytes, warning}`), so in-place order does not break outcome equality.
- The dispatcher-only-through-`call` check anchors on the `dispatcher` receiver (`/dispatcher\s*\.\s*(\w+)/`), so the Omp plugin's legitimate controller access (`handle.controller.snapshot/mutationGate/events/create`) is not flagged while any `dispatcher.<other>` is.
- The dispatcher-internal forbid-list (`ToolDispatcherDeps`, `DispatcherController`, `TOOL_CALL_TIMEOUT_MS`, `runSandboxExec`, `withTimeout`, `appendAudit`, `summarizeExec`, `waitLeavingConnecting`, `checkExecPolicy`, `refuseRetryIn`) excludes controller method names (`snapshot`, `mutationGate`, `events`, `create`) because the plugin legitimately uses them; all ten were verified absent from the three surface files before pinning the list.

## Deviations from Plan

None - plan executed exactly as written. No surface module was edited (P5-D11 holds); the guard adds no allowlist entry for any spawn site or guarded-symbol referrer (P5-D12 prohibition holds — both checks are zero-tolerance).

## Issues Encountered

- A transient `grep` provider error (`socket connection closed`) on one verification query; retried with a narrower pattern and confirmed dispatcher access shapes. No code impact.
- Built-in style reminders fired for `setTimeout` and `new Promise` in the equivalence driver and for tiny helpers in the guard; all mirror the exact methods the plan mandates copying (`test/mcp/server.test.ts` close-guard, executor-form promises required by lib ES2023 per ticket constraints, `no-bypass.test.ts` grep-source helpers). Left as written.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 5 contract proof is authored: orchestrator gates (`npx tsc -p tsconfig.json && node --test dist/test/surfaces/equivalence.test.js dist/test/surfaces/no-logic.test.js dist/test/quality/suite-taxonomy.test.js`) must confirm green before verify-work.
- Known risk for the gate run: the equivalence test drives MCP-then-ACP sequentially on one stateful dispatcher; if the gate shows an order-dependent mismatch, the fix is per-case fresh harnesses (one dispatcher per comparison pair is still "one dispatcher" per comparison).

---
*Phase: 05-omp-plugin-mcp-and-acp-surfaces*
*Completed: 2026-10-22*
