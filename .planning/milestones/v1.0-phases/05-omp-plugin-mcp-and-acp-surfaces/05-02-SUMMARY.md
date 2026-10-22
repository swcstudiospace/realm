---
phase: 05-omp-plugin-mcp-and-acp-surfaces
plan: 05-02
subsystem: docs
tags: [mcp, acp, omp, anda, doc-test, node-test]
requires:
  - phase: 05-omp-plugin-mcp-and-acp-surfaces
    provides: 05-CONTEXT.md decisions P5-D1 to P5-D15 and OQ-P5-01 default names
provides:
  - MCP Q5 revision record (2026-07-28, probe plus initialize)
  - ACP v1 plus realm/tool Realm-extension record
  - Omp Q1-Q4 verified API names with URLs and read dates, Q4 OPEN carried
  - Anda-over-MCP path in anda.md and anda-decision.md
  - Exact-string doc pins in test/docs/phase5-notes.test.ts
affects: [05-03 (MCP server codes against mcp.md Q5), 05-04 (ACP agent codes against acp.md Q5), 05-05 (Omp plugin codes against omp.md Q1-Q4)]
actuals:
  tokens: 3000
  tasks: 3
  commits: 0
tech-stack:
  added: []
  patterns: [doc-decision pins assert exact cited strings, section-scoped note assertions]
key-files:
  created: [test/docs/phase5-notes.test.ts]
  modified: [docs/integration/mcp.md, docs/integration/acp.md, docs/integration/omp.md, docs/integration/anda.md, docs/integration/anda-decision.md]
key-decisions:
  - "Q5 carries 2026-07-28 as the only revision string so the no-other-revision pin holds"
  - "ctx.ui.setStatus signature stays upstream-sourced; official pages do not document it"
  - "Q4 stays OPEN; setActiveTools removal and tool_call block are not proven enforcement"
patterns-established:
  - "Exact-string doc pins: assert cited literals plus URL and ISO read date per answer"
requirements-completed: [TOOL-05, OMP-01, OMP-02, OMP-03, OMP-04, OMP-05]
coverage:
  - id: D1
    description: "mcp.md Q5 records 2026-07-28 with server/discover probe plus initialize handling and no other revision string"
    requirement: "TOOL-05"
    verification:
      - kind: unit
        ref: "test/docs/phase5-notes.test.ts#TOOL-05: mcp.md Q5 records revision 2026-07-28"
        status: unknown
    human_judgment: true
    rationale: "Executor is forbidden from running tests; the orchestrator gate runs the suite before any commit."
  - id: D2
    description: "acp.md records protocol generation v1 with the realm/tool Realm extension marked not standard ACP"
    requirement: "TOOL-05"
    verification:
      - kind: unit
        ref: "test/docs/phase5-notes.test.ts#TOOL-05: acp.md records protocol generation v1"
        status: unknown
    human_judgment: true
    rationale: "Executor is forbidden from running tests; the orchestrator gate runs the suite before any commit."
  - id: D3
    description: "omp.md Q1-Q4 name only verified APIs with source URL plus read date per answer; Q4 stays OPEN"
    requirement: "OMP-01"
    verification:
      - kind: unit
        ref: "test/docs/phase5-notes.test.ts#OMP-01: omp.md Q4 stays OPEN"
        status: unknown
    human_judgment: true
    rationale: "Executor is forbidden from running tests; the orchestrator gate runs the suite before any commit."
  - id: D4
    description: "anda.md and anda-decision.md record that Anda consumes Realm over MCP with the Q5 evidence"
    requirement: "TOOL-05"
    verification:
      - kind: unit
        ref: "test/docs/phase5-notes.test.ts#TOOL-05: anda.md and anda-decision.md record that Anda consumes Realm over MCP"
        status: unknown
    human_judgment: true
    rationale: "Executor is forbidden from running tests; the orchestrator gate runs the suite before any commit."
duration: n/a
completed: 2026-10-22
status: complete
---

# Phase 05 Plan 02: Integration Decision Records Summary

**MCP revision handling, ACP v1 plus realm/tool extension, and Omp API names verified against the official pages, all pinned by exact-string doc tests.**

## Performance

- **Duration:** not tracked by executor (plan constraints forbid running gates)
- **Started:** 2026-10-22
- **Completed:** 2026-10-22
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- omp.md Q1-Q4 verified against https://omp.sh/docs/extension-authoring and https://omp.sh/docs/hooks (read 2026-10-22); setStatus signature stays upstream-sourced, Q4 OPEN carried
- mcp.md Q5 records revision 2026-07-28 with server/discover probe plus initialize handshake and no other revision string
- acp.md Q5 records protocol generation v1 with clientInfo/agentInfo plus the realm/tool Realm extension (not standard ACP)
- anda.md Q5 and anda-decision.md record that Anda consumes Realm over MCP with mcp.md Q5 evidence
- test/docs/phase5-notes.test.ts pins every cited string so an invented revision, version, or API name fails the suite

## Task Commits

No per-task commits were made by the executor: the assignment forbids all git commands and commits, and the orchestrator commits between waves.

1. **Task 1: Verify Omp ExtensionAPI names** — uncommitted (orchestrator commits)
2. **Task 2: Record MCP Q5, ACP version plus extension, and the Anda MCP path** — uncommitted (orchestrator commits)
3. **Task 3: Doc-decision pins with exact cited strings** — uncommitted (orchestrator commits)

## Files Created/Modified

- `test/docs/phase5-notes.test.ts` - 8 exact-string pin tests (TOOL-05 x4, OMP-01 x4); reads notes as text, starts no process, touches no network
- `docs/integration/omp.md` - Phase 5 verification pass table plus per-answer verification lines in Q1-Q4 with official URLs and 2026-10-22 read date
- `docs/integration/mcp.md` - Q5 decision record (P5-D9)
- `docs/integration/acp.md` - Q5 decision record (P5-D10)
- `docs/integration/anda.md` - Q5 Phase 5 direction (P5-D1)
- `docs/integration/anda-decision.md` - Section 7 Phase 5 direction (P5-D1), revisit triggers renumbered to 8

## Decisions Made

- Q5 carries `2026-07-28` as its only revision string: the 2024-11-05 caveat is referenced by pointer to Q1 (no literal), so the no-other-revision pin holds.
- `ctx.ui.setStatus(key, text)` stays upstream-sourced (OQ-P5-01): the official omp.sh pages name status/widgets only in prose; the exact signature comes from upstream hooks.md.
- Q4 stays OPEN (OQ-P5-01, OQ-P5-02): neither official page documents that `setActiveTools` removal or a `tool_call` block provably enforces required mode; plan 05-05 codes fail-closed.
- `restrictToolNames` / `setActiveToolsByName` are SDK-session mechanisms (upstream sdk.md), not a plugin mechanism; recorded as such in Q4.

## Deviations from Plan

None - plan executed exactly as written. (The mid-run full-disk ENOSPC was environmental and transient: space recovered on its own; one duplicated paragraph from the recovery was removed inline, leaving no content change.)

## Issues Encountered

- Disk filled to 100% mid-task, failing one edit with ENOSPC. While investigating, usage dropped to 95% (23G free) on its own. Retried the edit, removed a duplicated paragraph caused by the stale-hash recovery. No files lost; no cleanup of other agents' files performed.
- The `edit` tool once inserted a literal `*** End Patch` marker line into acp.md; removed it with a CUT in the next call. Verified the region reads clean.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plans 05-03 (MCP server), 05-04 (ACP agent), and 05-05 (Omp plugin) can code against these notes: revision, version, method name, and API names are pinned by `test/docs/phase5-notes.test.ts`.
- Blocker for 05-05 awareness: Q4 OPEN — the `tool_call` block plus residual-risk statement from OQ-P5-02 still needs its proving test in plan 05-05.
- Verification not run by executor (forbidden): orchestrator must run `npx tsc -p tsconfig.json && node --test dist/test/docs/phase5-notes.test.js` and grep the test titles for TOOL-05 and OMP-01 per the plan's verification step.

---
*Phase: 05-omp-plugin-mcp-and-acp-surfaces*
*Completed: 2026-10-22*
