---
phase: 15
plan: 05
subsystem: daemon-spawn-env
tags: [spawn-env, allowlist, sentinel, tests, onboarding]
requires: ["15-01", "15-02", "15-03"]
provides:
  - "a unit test pinning the exact names and prefix daemonSpawnEnv keeps, and the names it refuses"
  - "a real-process test through runCli up with the default spawn: the child sees no sentinel and no stale REALM_DRIVER_SECRET_ROOT"
  - "the startDetachedDaemon and launchFilteredDaemon legs also assert the stale root is absent in the child"
affects: [test/daemon/spawn-env.test.ts]
key-files:
  created: []
  modified:
    - test/daemon/spawn-env.test.ts
decisions:
  - "The allowlist is held in one constant at the top of the test (ALLOWED_NAMES plus HOST_PIN_NAMES) so plan 15-06 changes one place when it removes the gateway names"
  - "No source file changed: src/daemon/spawn-env.ts, src/cli/main.ts and src/omp/extension.ts are verified as shipped"
requirements: [ONB-07]
metrics:
  tasks: 2
  commits: 2
  completed: 2026-11-08
plan_head_before: 84d63bc49464068c42f5c74a2a71987803506106
commits: 2
status: complete
actuals:
  tokens: 2600
  tasks: 2
  commits: 2
---

# Phase 15 Plan 05: allowlisted daemon environment proven on both start paths (ONB-07) Summary

The allowlisted daemon environment is now proven with real child processes on both start paths: `runCli up` with the default spawn, and `startDetachedDaemon`. A secret-shaped sentinel and a stale `REALM_DRIVER_SECRET_ROOT` reach neither child, and `daemonSpawnEnv`'s exact selection is pinned by a unit test. No source file changed.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Unit test of daemonSpawnEnv and staleSecretRoot on both legs | 7fa5b46 | test/daemon/spawn-env.test.ts |
| 2 | Real-process proof through runCli up with the default spawn | 7501c37 | test/daemon/spawn-env.test.ts |

## What was added

- `script()` also reports `staleSecretRoot` (`REALM_DRIVER_SECRET_ROOT`). The existing sentinel test assigns that variable to `process.env` for the `startDetachedDaemon` leg, and the source object for the `launchFilteredDaemon` leg already carried it, then asserts it is null on both.
- `daemonSpawnEnv keeps exactly the allowlisted names and the host-pin prefix`: sorted keys equal the allowlist plus the two host-pin names; `ANTHROPIC_API_KEY`, `AWS_SECRET_ACCESS_KEY`, the three `REALM_DRIVER_*_ROOT` names and an undefined-valued name are absent.
- `daemonSpawnEnv skips undefined values and returns a fresh object each call`.
- `ONB-07: a real daemon started by runCli up with the default spawn ...`: `runCli(["up", "--workspace", dir])` with no `spawn` override, injected config, passing Podman probe fakes, and a `connect` fake that always reports an absent socket. runCli spawns the probe entry once through `defaultSpawnDaemon`, times out (exit not 0), and the child's file shows sentinel null, stale root null, socket `/run/realm/driver.sock`.

## Verification

- `npm run typecheck`: pass.
- `npm run build && node --test dist/test/daemon/spawn-env.test.js dist/test/omp/extension.test.js`: 16 tests, 16 pass, 0 fail.
- `src/daemon/spawn-env.ts`, `src/cli/main.ts` and `src/omp/extension.ts` are unchanged (`git diff --name-only` over the plan's commits lists only `test/daemon/spawn-env.test.ts`).

## Deviations from Plan

**1. [Plan text vs tree] The allowlist has twelve names, not eleven, and the unit test lists them**
- **Found during:** Task 1
- **Issue:** The plan's exact-names test lists eleven names (ten exact plus the host-pin names). At HEAD the allowlist also holds `REALM_DRIVER_GATEWAY_CA` (commit e34da60), beside `REALM_DRIVER_GATEWAY_ENDPOINT`.
- **Fix:** The constant `ALLOWED_NAMES` includes `REALM_DRIVER_GATEWAY_CA`. Plan 15-06 removes both gateway names and edits that one constant.
- **Files modified:** test/daemon/spawn-env.test.ts
- **Commit:** 7fa5b46

**2. [Plan text vs tree] The stale root reaches the `startDetachedDaemon` leg through `process.env`**
- **Found during:** Task 1
- **Issue:** `startDetachedDaemon` reads `process.env`, not the test's source object, so asserting `staleSecretRoot` null on that leg is only meaningful if the test sets `REALM_DRIVER_SECRET_ROOT` there.
- **Fix:** Added it to the test's `restored`/`assigned` lists so it is set and restored around that leg.
- **Files modified:** test/daemon/spawn-env.test.ts
- **Commit:** 7fa5b46

**Total deviations:** 2 (tree-versus-plan reconciliations in test only). **Impact:** none on scope or behaviour.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None. The tests write only the fields the probe script chooses; no environment dump is printed.

## Self-Check: PASSED

- `test/daemon/spawn-env.test.ts` exists; commits 7fa5b46 and 7501c37 exist on the branch.
- Acceptance criteria: exact-names test asserts the sorted list and the six refused names; sentinel test asserts `staleSecretRoot` null on both legs; the runCli test passes no `spawn`; source files unchanged.
