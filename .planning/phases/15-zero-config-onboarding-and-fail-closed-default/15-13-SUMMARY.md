---
phase: 15
plan: 13
subsystem: cli
tags: [cli, init, doctor, fix, exit-codes, tests]
requires: ["15-11", "15-12"]
provides:
  - "test/cli/cli.test.ts asserts init exit codes, config-never-read, no daemon contact, and doctor --fix no-HOME refusal"
affects: [test/cli/cli.test.ts]
key-files:
  modified: [test/cli/cli.test.ts]
requirements: [ONB-01, ONB-02]
metrics:
  tasks: 2
  commits: 0
status: unverified
---

# Phase 15 Plan 13: CLI wiring tests for realm init and doctor --fix (ONB-01, ONB-02) Summary

The plan's tests are present in `test/cli/cli.test.ts` at HEAD. No run is recorded, so the plan's verify step is NOT VERIFIED.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | init dispatch and no-HOME tests | 0f141fe (combined) | test/cli/cli.test.ts:1394-1454 |
| 2 | dry-run and P15-O3 exit assertions | 0f141fe (combined) | test/cli/cli.test.ts:1378-1392, 1456-1467 |

## What was added (per PLAN Task 1 and Task 2)

- ONB-01 init test: usage exits 2 with empty stdout; full init exits 0 with one JSON line, `mode` `fail-closed` (D4); second run exits 1 with `SCHEMA_INVALID`; `configReads === 0`; `effects` `[]`.
- ONB-02 no-HOME test: `--fix` and `--fix --dry-run` exit 1 with `SCHEMA_INVALID`; stderr refusal `(unsafe-target)`; `stateDir` stays 0755; no `run`/`sessions`; `effects` `[]`.
- Dry-run lines added to the existing test at `:1378` (its title pre-dates 0f141fe).
- P15-O3 test: plain `doctor` exits 0 for `result: []` and for a `fail` check.

## Verification

- NOT RUN, by contract. No file in `/home/realmlive/realm-evidence/phase15/` is named `15-13*` or references these titles. The plan's `npm run build && node --test dist/test/cli/cli.test.js` has no recorded exit status.
- Source read only: `runInitCommand` (`src/cli/main.ts:667-681`) and init dispatch before config (`:700-702`) match Task 1. `runDoctorFix` (`:513-541`) passes `HOME` or `""`; `applySafeFixes` refuses empty home at `src/doctor/fix.ts:128`. `runDoctor` returns 0 locally (`:492-496`).
- Not traced: `failureFor` mapping `FixRefusal` to `SCHEMA_INVALID`.

## Deviations from Plan

1. Tests landed in 0f141fe, a combined `feat(onboard)` commit (Refs ONB-01, ONB-02) with 15-11/15-12 work. No 15-13 commit exists.
2. Line drift: `:1236`→`:1378`; dispatch `:680-682`→`:700-702`; `runInitCommand` `:657-671`→`:667-681`; `runDoctorFix` `:508-536`→`:513-541`; `fix.ts:124`→`:128`.
3. Additive assertions beyond plan (config file exists; refusal detail; no `run`/`sessions`). No plan assertion dropped.
4. Not applicable: omp 18.20.0; L-C POLICY_DENIED; L-C2 restore; P15-O4; keep-state residue.

## Not Verified

- The test run (build and `node --test`): no PASS or FAIL claimed.
- `failureFor` mapping for the no-HOME refusal.

---
*Phase: 15-zero-config-onboarding-and-fail-closed-default*
*Completed: 2026-11-13*
