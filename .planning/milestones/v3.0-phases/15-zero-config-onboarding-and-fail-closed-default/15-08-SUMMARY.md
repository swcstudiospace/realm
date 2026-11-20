---
phase: 15
plan: 08
subsystem: live-suite-helpers
tags: [live-suite, gate, runtime-roots, tests, onboarding]
requires: ["15-04"]
provides:
  - "hermetic tests of readLiveInputs: roots come from config.json, stale REALM_DRIVER_*_ROOT variables are ignored, omitted roots derive under stateDir"
  - "a test pinning the gate reason for a config that is valid JSON but refused by loadRuntimeConfig"
  - "a test pinning the scenario config.json (explicit roots) and a CLI environment with no driver root variable"
  - "the live suite header comment no longer names three driver roots as CLI inputs"
affects: [test/integration/production-live-helpers.test.ts, test/integration/production-driver.test.ts]
key-files:
  created: []
  modified:
    - test/integration/production-live-helpers.test.ts
    - test/integration/production-driver.test.ts
decisions:
  - "No change to test/support/production-live.ts: the shipped gate, readLiveInputs and createScenarioEnvironment matched the plan's intent and every new test passed against them"
  - "Fixtures use placeholder paths under /onb03 and a temporary directory for the config file; no host path appears in a test"
requirements: [ONB-03]
metrics:
  tasks: 2
  commits: 2
  completed: 2026-11-08
plan_head_before: 54deb09
commits: 2
status: complete
actuals:
  tokens: 2100
  tasks: 2
  commits: 2
---

# Phase 15 Plan 08: live suite gate and scenario config proven on the roots in config.json (ONB-03) Summary

Four hermetic `ONB-03:` tests now pin that the live suite derives its roots from the `REALM_LIVE_DRIVER_CONFIG` file through `runtimeRootsOf`, that a loader-refused config is a skip reason, and that each scenario writes explicit roots into its own `config.json` with no `REALM_DRIVER_*_ROOT` variable in the CLI environment. The stale header comment in the live file is corrected. The live suite was not run.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Hermetic tests of live inputs, loader-refused gate reason, scenario config | 3ac8949 | test/integration/production-live-helpers.test.ts |
| 2 | Correct the stale header comment in the live suite | 4cd8cc7 | test/integration/production-driver.test.ts |

## What was added

- `ONB-03: readLiveInputs takes the roots from the config file and ignores the stale driver variables`: explicit `secretRoot` and `sandboxStateRoot` in the file win; `REALM_DRIVER_*_ROOT` values of `/stale/...` appear in no returned string.
- `ONB-03: readLiveInputs derives the omitted secret and sandbox roots under stateDir`: `<stateDir>/secrets` and `<stateDir>/sandboxes`.
- `ONB-03: the gate names REALM_LIVE_DRIVER_CONFIG when the file is valid JSON that the loader refuses`: a non-digest-pinned image yields the `not a readable runtime config` reason.
- `ONB-03: a scenario config writes the explicit roots and the CLI environment carries no driver root variable`: the written `realm/config.json` deep-equals image, stateDir, workspaceRoot, secretRoot and sandboxStateRoot; the CLI environment keys contain none of the three root names.
- Header comment of `production-driver.test.ts` line 30 now says the scenario's `XDG_CONFIG_HOME` and `REALM_DRIVER_SOCKET` (when named), with the roots written into the scenario's own config.json. Code, tests and gate list are untouched.

## Verification

- `npm run typecheck`, `npm run build`: pass.
- `node --test dist/test/integration/production-live-helpers.test.js`: 67 tests, 67 pass, 0 fail; the four ONB-03 tests are in the output.
- `npm run lint`: clean. `npm run check:gates`: gate closure and module size, no violations.
- `grep "three driver roots" test/integration/production-driver.test.ts`: no match.
- `production-driver.test.js` was not run (live suite; plan 15-10).

## Deviations from Plan

**1. [Tree differs from plan numbers] Plan line numbers were from an older HEAD**
- The plan's `production-live.ts:475-495` / `:537-553` ranges are at `:485-` and `:532-` in the tree. `readLiveInputs`, `createScenarioEnvironment` and the gate already behaved as the plan describes, so no source change was needed. The plan's "no change expected" to `test/support/production-live.ts` held.

No other deviations.

## Known Stubs

None.

## Deferred Issues

None.

## Threat Flags

None.

## Self-Check: PASSED

- `test/integration/production-live-helpers.test.ts`, `test/integration/production-driver.test.ts`: present and modified.
- Commits 3ac8949 and 4cd8cc7 exist.
