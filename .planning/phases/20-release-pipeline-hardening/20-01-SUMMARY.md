---
phase: 20-release-pipeline-hardening
plan: "01"
subsystem: release-pipeline
tags: [rollback, pages, release-cases, runner]
requires: []
provides:
  - "rollback.yml passes the peeled tag SHA (PR 94, merge 9710346)"
  - "pages.yml verifies the tag/SHA pair via the GitHub API before checkout and requires default-branch dispatch (PR 94)"
  - "scripts/release/release-cases.test.mjs: 59 tests (PR 95, merge 25af138)"
  - "Six jobs moved from the self-hosted omega-ci runner to ubuntu-24.04 (PR 96, merge 9ec64fa); stale omega wording fixed (PR 97, merge 339674c)"
affects: [.planning/REQUIREMENTS.md, .planning/ROADMAP.md]
key-files:
  created:
    - .planning/phases/20-release-pipeline-hardening/20-01-SUMMARY.md
  modified: []
decisions:
  - "Owner: release jobs run on GitHub-hosted runners (ubuntu-24.04), not the self-hosted omega-ci runner (PR 96)"
  - "Owner: merge once CI is green, no Greptile review"
requirements: [REL-03, REL-04]
metrics:
  completed: 2026-11-17
status: complete
---

# Phase 20 Plan 01: rollback hardening and runner move Summary

PRs 94 to 97 merged the paired tag/SHA rollback contract, the offline release test matrix and the move to GitHub-hosted runners.

## What changed

- **PR 94 (merge `9710346`).** `rollback.yml` passes the peeled SHA of the known-good tag to Pages. `pages.yml` verifies the tag/SHA pair through the GitHub API before checkout and requires a dispatch from the default branch.
- **PR 95 (merge `25af138`).** `scripts/release/release-cases.test.mjs` adds 59 offline tests for the release, repair, draft and partial-release states.
- **PR 96 (merge `9ec64fa`).** Six jobs in `ci.yml`, `mutation.yml`, `pages.yml` and `rollback.yml` moved from the self-hosted `omega-ci` runner to `ubuntu-24.04`. `AGENTS.md` residual-limits wording updated.
- **PR 97 (merge `339674c`).** Stale omega comments and the `AGENTS.md` release-state wording fixed.

## Evidence

Joined P0 gate on `9710346`: typecheck, lint, test (3094 tests, 3051 pass, 0 fail, 43 skip), test:scripts, check:docs, check:gates, build, check:pack, check:mcp and npm audit all exit 0. Run logs are kept outside the repository.

## NOT VERIFIED

The repair path and draft/partial-release states were not exercised live; they are covered offline by the release-cases tests (gap G1, owner-accepted).

## Deviations

The original plan recorded shared self-hosted runner limits (T-20-05). The owner moved the jobs to GitHub-hosted runners, so that text is superseded.
