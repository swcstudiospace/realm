---
phase: 15
plan: 02
subsystem: docs-guard
tags: [docs, guard, fail-closed, tests]
requires: []
provides:
  - "test that package.json scripts.check:docs runs scripts/check/default-mode.mjs"
  - "test that the repository's own documents pass the default-mode guard (runs under npm run test:scripts)"
affects: [scripts/check/default-mode.test.mjs]
key-files:
  created: []
  modified:
    - scripts/check/default-mode.test.mjs
decisions:
  - "D-1503: guard scan lists verified against the decision; scripts/check/default-mode.mjs and package.json unchanged"
requirements: [DEF-02]
metrics:
  tasks: 2
  commits: 1
  completed: 2026-11-08
plan_head_before: 7aa759d3abcb91f9c3a660c49a4a7db9fe3f2527
commits: 1
status: complete
actuals:
  tokens: 250
  tasks: 2
  commits: 1
---

# Phase 15 Plan 02: Docs guard against the old default claim Summary

The default-mode guard already existed and was wired into `check:docs`; this plan added the two missing tests so removing the wiring, or a document asserting advisory is the default, fails `npm run test:scripts` and not only `check:docs`. The guard is wording enforcement, not containment.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Test the check:docs wiring and the repository tree against the guard | 3ec9398 | scripts/check/default-mode.test.mjs |
| 2 | Confirm the check:docs wiring and the guard's exit behaviour (no source edit) | none (no edit needed) | package.json |

- Task 1: added `readFileSync` import and two tests, "check:docs runs the default-mode guard (D-1503)" (reads `package.json`, asserts `scripts["check:docs"]` contains `node scripts/check/default-mode.mjs`) and "the repository's own documents pass the guard (D-1503)" (`runCheck([])` over the real tree, code 0 with the finding lines as the assertion message, output matches `no advisory-default claim`). `scripts/check/default-mode.mjs` is untouched.
- Task 2: `package.json` `check:docs` ends with `node scripts/check/default-mode.mjs`; the guard sets `process.exitCode` from `runCheck` (`default-mode.mjs:278-282`). `npm run check:docs` output: `host paths: ok`, `agents sync: ok`, `check:default-mode: 27 files scanned, no advisory-default claim`.

## Verification

- `node --test scripts/check/default-mode.test.mjs`: 20 tests, 20 pass, 0 fail.
- `grep -c "^test(" scripts/check/default-mode.test.mjs`: 20.
- `npm run check:docs`: exit 0, guard summary line present.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None.

## Deferred Issues

None.

## Self-Check: PASSED

Commit 3ec9398 exists; `scripts/check/default-mode.test.mjs` contains both new test names; `scripts/check/default-mode.mjs` and `package.json` are unchanged by this plan.
