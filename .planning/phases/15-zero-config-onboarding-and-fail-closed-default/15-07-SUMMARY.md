---
phase: 15
plan: 07
subsystem: doctor-entry-wiring
tags: [doctor, cli, daemon, config, spawn-env, onboarding]
requires: ["15-04", "15-05", "15-06"]
provides:
  - "the daemon's doctor receives configPath and driverSocketPath from the daemon's entry environment"
  - "plain realm doctor with an absent or invalid config.json is one runtime-roots item that names the absence or the bad keys, exit 0"
  - "the CLI spawn environment is observed on the spawn call (ONB-07)"
affects: [src/daemon/main.ts, src/cli/main.ts]
key-files:
  created: []
  modified:
    - src/daemon/main.ts
    - src/cli/main.ts
    - test/cli/cli.test.ts
    - test/daemon/main.test.ts
decisions:
  - "The raw config value is kept beside the loaded one, so the doctor catch can describe the keys of a file that parsed but did not load"
  - "A location that cannot be resolved (no absolute XDG_CONFIG_HOME or HOME) is reported as config.json is absent"
  - "ENOENT and ENOTDIR both count as an absent file; any other lstat result is a present file that is not readable JSON"
requirements: [ONB-03, ONB-04, ONB-07]
metrics:
  tasks: 3
  commits: 3
  completed: 2026-11-08
plan_head_before: c2c755b0a208396a41f6848036520b6b40293266
commits: 3
status: complete
actuals:
  tokens: 4500
  tasks: 3
  commits: 3
---

# Phase 15 Plan 07: doctor and spawn wiring at the entry edges (ONB-03, ONB-04, ONB-07) Summary

Both entry edges now hand the doctor the paths it needs, and plain `realm doctor` tells a missing `config.json` apart from one that does not load. In the live case the orchestrator observed (a non-digest `image`), the doctor now says `image is absent or not a digest-pinned reference` instead of `runtime config is absent`.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | daemon passes configPath and driverSocketPath to its doctor | 42749a0 | src/daemon/main.ts, test/daemon/main.test.ts |
| 2 | plain doctor one-item report and its paths | 5b8b401 | src/cli/main.ts |
| 3 | spawn env and one-item config report asserted | 1514106 | test/cli/cli.test.ts |

## What was added

- `runDaemon` passes `doctorOptions: { configPath: resolveConfigPath(env), driverSocketPath? }` to `startDaemon`. `daemon.ts` spreads it into the doctor call and sets `runtimeConfig` after, so the daemon's doctor checks the file and socket it started with.
- `runCli` reads the config once into a raw value (`readFailed` records a throw) and loads it in a second step. For `doctor` with no words, `configProblemsOf` yields `["config.json is absent"]` (ENOENT/ENOTDIR or unresolvable location), `["config.json is not a readable JSON file"]` (present, unreadable), or `describeRuntimeConfigProblems(raw)` (`["config.json does not load"]` when that is empty). `runtimeChecks` gets those as `configProblems`. Exit stays 0; stderr is `realm doctor: config is absent or invalid; ran 1 local check`. Every other command keeps its exit-2 text; `doctor <words>` keeps exit 1.
- `localDoctorOptions` passes `configPath` and, when `REALM_DRIVER_SOCKET` is set, `driverSocketPath`.
- Tests: `SpawnCall` records `env`; `ONB-07` asserts the allowlisted spawn env (sentinel and stale root absent, `PATH` and `REALM_DRIVER_SOCKET` present); three `ONB-04` doctor tests (invalid config names `image` and leaks neither the `VALUE`/`s3cr3t` sentinel nor a path in stdout or stderr; absent config detail equals exactly `config.json is absent`; present non-JSON file); one `ONB-04` daemon test for the two doctor options.

## Verification

Each run through the heavy-slot lock: `npm run typecheck`, `npm run lint`, `npm run check:gates` (module size: 106 files, no violations), `npm run build` all exit 0. `node --test dist/test/cli/cli.test.js dist/test/daemon/main.test.js`: 82 tests, 82 pass, 0 fail, including the shipped exit-0 doctor pins.

## Deviations from Plan

**1. [Rule 2 - Missing critical] A daemon test was added in `test/daemon/main.test.ts`**
- The plan lists only `test/cli/cli.test.ts`, but Task 1's wiring had no assertion. One test pins `configPath` and `driverSocketPath` (set and unset) on the `startDaemon` options. Committed in 42749a0.

**2. [Plan text vs tree] Plan line references differ from the tree**
- `src/cli/main.ts` and `daemon.ts` line numbers moved; intent applied unchanged. The spawn env at the CLI edge already passed `daemonSpawnEnv`, as the plan said, so only the test was added.

**3. [Plan text vs tree] Task 3 step 5 did not apply**
- The no-config test (`realm doctor with no config returns the init check`) does not assert the old `runtime config is absent` detail, so no assertion changed. The new absent-file test pins the exact detail.

**4. [Addition] A third `ONB-04` test for a present file that is not readable JSON**
- Covers the `config.json is not a readable JSON file` branch the plan specified in Task 2.

**Total deviations:** 4, none beyond the plan's intent.

## Issues Encountered

A first edit call used a repo-relative path from the wrong checkout (the main checkout); the edit tool rejected it on the hash mismatch and nothing was written there. All edits landed in the pinned root.

## Known Stubs

None.

## Threat Flags

None. The one-item report names keys only; the new test asserts no value and no path in stdout or stderr.

## Next Phase Readiness

Plans 15-12 and 15-13 (`doctor --fix`) can rely on `localDoctorOptions` carrying `configPath` and `driverSocketPath`.

---
*Phase: 15-zero-config-onboarding-and-fail-closed-default*
*Completed: 2026-11-08*

## Self-Check: PASSED
