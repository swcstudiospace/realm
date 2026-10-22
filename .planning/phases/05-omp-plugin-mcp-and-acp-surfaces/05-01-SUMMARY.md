---
phase: 05-omp-plugin-mcp-and-acp-surfaces
plan: 05-01
subsystem: composition
tags: [lifecycle, dispatcher, locktable, realm-handle, omp]

# Dependency graph
requires:
  - phase: 04-reaper-egress-guard-and-shared-dispatcher
    provides: ToolDispatcher with ToolDispatcherDeps, LifecycleController with LifecycleDeps, D-96 one-lock-table invariant
provides:
  - createRealmHandle factory plus RealmHandle type wiring RuntimeConfig and real adapters into one controller plus one dispatcher over a single LockTable
  - OMP-01/OMP-05 compose tests pinning unbound start, lock-table identity, both mode gates, single-entry structure, and the single-owner precondition
affects: [05-03-mcp-server, 05-04-acp-agent, 05-05-omp-plugin, 05-06-equivalence-and-no-logic-guard]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 4714
  tasks: 2
  commits: 0

# Tech tracking
tech-stack:
  added: []
  patterns: ["options-object factory over positional args (matches LifecycleDeps/ToolDispatcherDeps)", "static-guard test method copied from test/tools/no-bypass.test.ts"]

key-files:
  created: [src/realm/compose.ts, test/realm/compose.test.ts]
  modified: []

key-decisions:
  - "createRealmHandle takes a single CreateRealmHandleOptions object, matching the LifecycleDeps/ToolDispatcherDeps options-object convention"
  - "LockTable identity is asserted through named holder-field reads with reason comments, since neither frozen holder exposes its table and both are consumed, not reshaped"
  - "Advisory case uses a missing policy file (validated defaults); required case writes a minimal fail-closed policy file outside any workspace root"

patterns-established:
  - "Composition root holds no tool logic: only ToolDispatcher.call is the tool entry point; structural test pins the allowlist"
  - "Adapter-seam doubling only: FakeExecutionService, FakeBridge, fixed clock, stub runner; no Podman or OpenShell process in tests"

requirements-completed: [OMP-01, OMP-05]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "RealmHandle builds LifecycleController plus ToolDispatcher from RuntimeConfig with one shared LockTable; close() is idempotent and starts no process"
    requirement: "OMP-01"
    verification:
      - kind: unit
        ref: "test/realm/compose.test.ts#OMP-01: createRealmHandle starts unbound with reason no workspace and answers status through the shared mapping (P5-D7)"
        status: unknown
      - kind: unit
        ref: "test/realm/compose.test.ts#OMP-01: the controller and the dispatcher hold the same LockTable instance (P5-D15)"
        status: unknown
      - kind: unit
        ref: "test/realm/compose.test.ts#OMP-01: close() stops the session without starting a process and is safe to call twice (P5-D7)"
        status: unknown
    human_judgment: false
  - id: D2
    description: "Write through the handle dispatcher while non-active is refused in required mode and warns in advisory mode"
    requirement: "OMP-05"
    verification:
      - kind: unit
        ref: "test/realm/compose.test.ts#OMP-05: a write while non-active is refused in required mode and warns in advisory mode (P5-D6)"
        status: unknown
    human_judgment: false
  - id: D3
    description: "Structural pins: compose.ts reaches tools only through ToolDispatcher, and the factory doc comment states the single-owner precondition with Phase 6 as enforcer"
    requirement: "OMP-01"
    verification:
      - kind: unit
        ref: "test/realm/compose.test.ts#OMP-01: compose.ts reaches tools only through ToolDispatcher and names no guarded symbol or binary (P5-D7)"
        status: unknown
      - kind: unit
        ref: "test/realm/compose.test.ts#OMP-01: the factory doc comment states the single-owner precondition with Phase 6 as enforcer (P5-D7)"
        status: unknown
    human_judgment: false

# Metrics
duration: ~30min
completed: 2026-10-22
status: complete
---

# Phase 05 Plan 01: Composition Root Summary

**createRealmHandle wires RuntimeConfig plus real adapters into one LifecycleController and one ToolDispatcher sharing a single LockTable, with OMP-01/OMP-05 tests and structural pins**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-10-22
- **Completed:** 2026-10-22
- **Tasks:** 2
- **Files modified:** 2 (both created)

## Accomplishments

- `src/realm/compose.ts` exports `RealmHandle` (controller, dispatcher, idempotent `close()` over the controller stop path) and `createRealmHandle`, which loads `RuntimeConfig`, loads `Policy`, binds the workspace root, constructs exactly one `LockTable` shared by both holders, and constructs `SessionStore` over the config state directory. Reads no `process.env`.
- `test/realm/compose.test.ts` proves unbound start with reason `no workspace`, status through the shared `displayStatus` mapping, `LockTable` identity (`strictEqual`, not deep-equal), the required-refuse/advisory-warn write gate while non-active, idempotent `close()` with zero exec/bridge calls, and the single-entry structural pins plus the single-owner precondition wording.
- Threat mitigations T-05-01 (one shared table, identity assertion) and T-05-02 (adapters as arguments, no `process.env`) are implemented as specified.

## Task Commits

No per-task commits were made: this execution runs under wave orchestration where the orchestrator owns all commits between waves.

1. **Task 1: createRealmHandle with one shared LockTable (P5-D7, P5-D15)** - uncommitted (files: `src/realm/compose.ts`, `test/realm/compose.test.ts`)
2. **Task 2: Single-owner precondition and frozen-surface pins (P5-D7)** - uncommitted (files: `src/realm/compose.ts`, `test/realm/compose.test.ts`)

## Files Created/Modified

- `src/realm/compose.ts` - Composition root: `createRealmHandle` plus `RealmHandle`/`CreateRealmHandleOptions` types (P5-D7, P5-D15)
- `test/realm/compose.test.ts` - OMP-01 wiring and identity cases, OMP-05 mode-gate cases, single-entry structural pins

## Decisions Made

- Options-object factory signature (`CreateRealmHandleOptions`) rather than positional args, matching the `LifecycleDeps`/`ToolDispatcherDeps` convention the factory composes.
- `LockTable` identity asserted via named holder-field reads with one-line reason comments (unchecked-cast rule: named const plus reason), because neither frozen holder exposes its table and the plan forbids reshaping them.
- Advisory case uses a missing policy file (loader yields validated advisory defaults); required case writes `{"mode": "fail-closed"}` beside the fixture with empty workspace roots so the policy-outside-roots check cannot fire.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Test-authoring style friction (no functional impact): an early duplicate-import slip from a range edit was repaired immediately; tiny one-expression helpers were inlined and inline casts were converted to named consts with reason comments per the builtin style rules. No plan behavior changed.
- Disk-full (ENOSPC) blocked the first SUMMARY write attempt: the shared disk is at 100% with /tmp holding ~39G of other agents' scratch. No foreign files were touched; the write was retried once space allowed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plans 05-05 and 05-06 can compose against `createRealmHandle`/`RealmHandle` now; the factory signature is the P5-D7 seam they build on.
- Verification is orchestrator-owned: run `npx tsc -p tsconfig.json && node --test dist/test/realm/compose.test.js` in the gate wave (execution was forbidden from running it here, hence `unknown` coverage status above, not a test failure).

---
*Phase: 05-omp-plugin-mcp-and-acp-surfaces*
*Completed: 2026-10-22*
