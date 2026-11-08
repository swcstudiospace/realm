---
phase: 15
plan: 01
subsystem: policy
tags: [policy, fail-closed, doctor, tests]
requires: []
provides:
  - "test pin of the schema file's own mode default (fail-closed) and enum"
  - "test pin that loadPolicyFile equals loadPolicyFileDetailed().policy for no-file, default and explicit sources"
affects: [test/core/policy.schema.test.ts, test/core/policy.test.ts, test/cli/cli.test.ts]
key-files:
  created: []
  modified:
    - test/core/policy.schema.test.ts
    - test/core/policy.test.ts
    - test/cli/cli.test.ts
decisions:
  - "D4 / D-1501: the schema default is the only mode default; verified, no source edit needed"
requirements: [DEF-01, DEF-02]
metrics:
  tasks: 4
  commits: 2
  completed: 2026-11-08
plan_head_before: 17d03551d311796361af9cbc91ca745a0b291bc2
commits: 2
status: complete
actuals:
  tokens: 1200
  tasks: 4
  commits: 2
---

# Phase 15 Plan 01: Default policy mode fail-closed, reconcile and close Summary

The PR A code (84f335b) was already on the branch and correct; this plan pinned the schema default and loader provenance contract with tests and corrected one stale comment. No source file changed.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Pin the schema default and the loader's provenance contract | ea4d00d | test/core/policy.schema.test.ts, test/core/policy.test.ts |
| 2 | Confirm the four doctor policy-file outcomes | none (no edit needed) | src/doctor/checks.ts, test/doctor/checks.test.ts |
| 3 | Correct the CLI policy-reading comment, confirm no-daemon doctor reads the policy | 490783c | test/cli/cli.test.ts |
| 4 | Confirm daemon, compose, plugin fixtures and comments; final gates | none (no edit needed) | src/omp/plugin.ts and tests |

- Task 1: new test "D-1501: the schema file itself declares fail-closed as the only mode default" reads `src/core/policy.schema.json` (default, enum, and `validate("policy", {})` agreement); new test "D-1501: loadPolicyFile returns the policy that loadPolicyFileDetailed reports, for every mode source".
- Task 2: confirmed by reading `policyFileCheck` (absent/unset path warns, schema and POLICY_DENIED failures fail, explicit advisory warns with "this is not containment", fail-closed passes with "(the default; the file sets no mode)" when the key is absent) and by the nine `policy-file:` tests in `test/doctor/checks.test.ts`. All 56 tests in that file pass.
- Task 3: `localDoctorOptions` sets `policyPath: defaultPolicyPath(runtimeConfig.stateDir)`; the no-daemon branch returns exit code 0 (P15-O3); the two "realm doctor with no daemon" tests pass. The stale sentence "The CLI never reads the policy file" is replaced with a statement that the `up` path does not read it.
- Task 4: plugin comments (`src/omp/plugin.ts` lines 30 and 765) name fail-closed as the default and advisory as an explicit opt-in; fixtures that rely on advisory write `mode: "advisory"` explicitly; `requiredOptions` writes `mode: "fail-closed"`. daemon, compose and plugin tests: 191 pass, 0 fail.

## Verification

- `npm run typecheck`, `npm run build`: pass.
- `node --test` over policy.schema, policy, doctor/checks: pass (policy files and 56 doctor tests).
- `node --test --test-name-pattern="realm doctor with no daemon" dist/test/cli/cli.test.js`: 2 pass.
- `node --test` over daemon, compose, plugin tests: 191 pass, 0 fail.
- `npm run lint`: exit 0.

## Deviations from Plan

**1. [Line numbers] Plan line references are stale against HEAD 17d0355.** The plan was written at 1fa69c1. Task 3's comment is at `test/cli/cli.test.ts:671-672` (plan said 660-661); `src/cli/main.ts` `policyPath` is at line 502 (plan said 497); the daemon test fixtures use `mode: "advisory"` at several lines other than the plan's. Intent and content are unchanged; every acceptance criterion was verified against the tree.

Otherwise none - plan executed as written. Total deviations: 1 (documentation of drift only). Impact: none.

## Known Stubs

None.

## Threat Flags

None.

## Deferred Issues

None.

## Self-Check: PASSED

Commits ea4d00d and 490783c exist; `src/core/policy.schema.json`, `src/core/policy.ts`, `src/doctor/checks.ts` and `src/cli/main.ts` are unchanged by this plan.
