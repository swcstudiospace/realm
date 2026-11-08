---
phase: 15
plan: 04
subsystem: runtime-config
tags: [config, roots, overlap, doctor, onboarding]
requires: ["15-01", "15-02", "15-03"]
provides:
  - "loadRuntimeConfig refuses an explicit secretRoot or sandboxStateRoot that overlaps the other explicit root or the workspaceRoot (lexical, SCHEMA_INVALID)"
  - "describeRuntimeConfigProblems(input) returning fixed, value-free, key-named phrases for the doctor (plans 15-06 and 15-07)"
  - "tests pinning the driver config-home resolution and the daemon-start overlap refusal"
affects: [src/runtime/config.ts]
key-files:
  created: []
  modified:
    - src/runtime/config.ts
    - test/runtime/config.test.ts
    - test/daemon/main.test.ts
    - test/runtime/driver/driver-main.test.ts
decisions:
  - "D-1504: roots come only from config.json through runtimeRootsOf; the overlap rule compares explicit secretRoot, sandboxStateRoot and workspaceRoot only, never stateDir and never derived defaults"
  - "The loader and describeRuntimeConfigProblems share the predicates (isImageReference, isAbsolutePathValue, isAndaUrl, overlapProblems), so the rules are not duplicated"
  - "The live layout (private roots as explicit siblings under stateDir, workspace elsewhere) still loads; pinned by a dedicated test"
requirements: [ONB-03]
metrics:
  tasks: 3
  commits: 3
  completed: 2026-11-08
plan_head_before: b2803b87bb8bc84bd08cf650222c2a6ded13a924
commits: 3
status: complete
actuals:
  tokens: 5200
  tasks: 3
  commits: 3
---

# Phase 15 Plan 04: roots in config.json (ONB-03) Summary

`loadRuntimeConfig` now refuses an explicit `secretRoot` or `sandboxStateRoot` that equals, contains or lies inside the other explicit root or the `workspaceRoot`, and `describeRuntimeConfigProblems` names each failing key with a fixed phrase that carries no value.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Lexical overlap refusal and key-level problem description | 7bb6316 | src/runtime/config.ts, test/runtime/config.test.ts |
| 2 | Daemon start refuses an overlapping explicit root before startDaemon | 067e448 | test/daemon/main.test.ts |
| 3 | Driver config-home resolution and root names absent from DRIVER_ENV | 05312cd | test/runtime/driver/driver-main.test.ts |

## Verification

`npm run typecheck && npm run build && node --test dist/test/runtime/config.test.js dist/test/runtime/driver/driver-main.test.js dist/test/daemon/main.test.js` (run through the heavy-slot lock): exit 0, 90 tests, 0 failures. All new tests carry the `ONB-03:` prefix.

Acceptance: `rootsOverlap` and `describeRuntimeConfigProblems` appear in `src/runtime/config.ts`; the only new import is `relative` and `sep` from `node:path`; `src/daemon/main.ts` and `src/runtime/driver/main.ts` are unchanged.

## Deviations from Plan

**1. [Orchestrator note 7a] Extra live-layout test.** Added `ONB-03: a layout with the private roots as siblings under stateDir and the workspace elsewhere loads` using generic `/srv/realm/acct/...` paths. The plan's rule as written does not reject that layout (stateDir is not compared), so no conflict arose.

**2. [Tree differs from plan line numbers] Task 2 reference lines.** The shipped daemon root tests sit at `test/daemon/main.test.ts:424-467` (plan said 361-406), and the RealmError test the new test copies is at `:487`. The plan's intent was unchanged. The new test asserts return 1, an empty start-call list, exactly one `SCHEMA_INVALID` stderr entry, and no stderr line containing the workspace path.

**3. [Task 3 seam] `configPathRead` helper.** The two config-home tests share a small local helper in the test file that records the path passed to the `readConfig` seam; the plan described the seam inline in each test.

**Total deviations:** 3 minor, none behavioural. **Impact:** none on scope.

## Known Stubs

None.

## Threat Flags

None. The loader reads no environment and touches no filesystem; problem phrases are fixed text and echo no input.

## Self-Check: PASSED

Commits 7bb6316, 067e448 and 05312cd exist on `gsd/v3-integrate-p19`; `src/runtime/config.ts` and the three test files are modified as listed.
