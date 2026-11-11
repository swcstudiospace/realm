---
phase: quick-261108-nch
plan: 01
subsystem: release-scripts
status: complete
requirements: [REL-03, REL-04]
tags: [release, rollback, pages, changelog, tests]
commits:
  - 27c9782 test(release): cover rollback shell steps and changelog removal fixtures
files_modified:
  - scripts/release/rollback.test.mjs
  - scripts/release/changelog.test.mjs
---

# Phase quick-261108-nch Plan 01: Offline release-script coverage Summary

Test-only change. The checked-in `rollback.yml` and `pages.yml` run blocks now execute under bash with fake `git` and `gh` in the repository test suite (REL-03), and the changelog generator has real-git fixtures for rename, shared-file and revert-of-revert histories (REL-04).

## What was built

- `scripts/release/rollback.test.mjs` (new)
  - `readWorkflowRun(workflowText, stepName)` extracts a named step's `run: |` block from the YAML text with no YAML dependency. It throws when the step is missing, duplicated, has no run block, or the block still contains `${{`.
  - `runWorkflowStep(script, env, fixture)` runs a block with bash in a scratch directory. Fake `git` and `gh` come first on PATH and append each call's argv (0x1f-separated) to a record file. Unexpected argv exits 99.
  - Cases: a full valid rollback on `main` and `trunk` (exact ordered calls, validation before `release edit`); invalid and injected `TAG` and `DOCS_TAG` values; equal tags; a missing tag; a tag off the default branch; draft, prerelease and missing releases; the exact argv of the Mark and Dispatch steps run alone; Pages `source_ref` valid and invalid values; and the four `readWorkflowRun` guard cases. Every rejection asserts no `gh release edit` and no `gh workflow run` call, and that no `injected` file was created.
- `scripts/release/changelog.test.mjs`
  - `commitStaged(cwd, subject, body)` commits what the caller staged without re-adding files. `commit()` delegates to it, so existing tests are unchanged.
  - `assertTailPreserved(root)` checks the published `SEED_TAIL` at the end of `CHANGELOG.md` and exactly one `## [Unreleased]` heading.
  - Three fixtures: a real `git mv` rename with `git rm` and a `Removes:` trailer; a shared file where the removal only deletes the removed feature's line (`M shared.txt`, not a deletion); and feature, canonical `git revert`, then `git revert` of that revert. Each asserts the surviving entries through `generateChangelog()` and the preserved tail.

## Deviations and defects

- **No production defect.** `scripts/release/changelog.mjs` is unchanged. All three REL-04 fixtures produced the expected entries on the first run.
- **Fixture expectation corrected (test only).** The plan expected both subjects of the revert chain to start with `Revert "`. Current git words a revert of a revert as `Reapply "..."`, so the fixture asserts the body (`This reverts commit <sha>.`) of the newest commit and the `Revert "feat: add driver"` subject of the one below it. This is git's wording, not a generator issue.
- **Host startup files reordered PATH (test fix).** Under the default bash startup, the child shell moved the host `/usr/bin` ahead of the fake tools, so the real `gh` ran and returned HTTP 401. `rollback.test.mjs` starts bash with `--noprofile --norc`, which keeps the fake tools first. The child environment is still only `PATH`, the caller's env and the `FAKE_*` switches.

## Verification

Run from the pinned checkout under `heavy-slot-1.lock`:

| Command | Exit | Result |
|---|---|---|
| `node --test scripts/release/rollback.test.mjs scripts/release/changelog.test.mjs` | 0 | 69 pass, 0 fail |
| `npm run test:scripts` | 0 | 354 pass, 0 fail |
| `npm run typecheck` | 0 | clean |
| `npm run lint` | 0 | clean |
| `npm run check:gates` | 0 | gate closure: 4 modules, no violations; module size: 107 files, no violations |
| `npm run check:docs` | 1 | fails on `.planning/quick/261108-ovn-pin-the-in-place-truncation-branch-of-th/261108-ovn-CONTEXT.md:27`, which contains a host-local path. That file belongs to another task. Nothing in this task's files was flagged. |

The `check:docs` failure is outside this task's scope and was not edited. The owner of task 261108-ovn needs to replace that path with a placeholder.

## Scope and limits

- REL-03 is proven for local shell and argv behaviour only, against the checked-in workflow text with fake `git` and `gh`. The tests do not prove that GitHub executes these workflows, that `gh release view --jq` evaluates its expression, or that a rollback or Pages deployment works. Those remain owner-gated (L4).
- Files outside the two in-scope test files were not staged. `.planning/config.json` was left as it was.

## Self-Check: PASSED

- `scripts/release/rollback.test.mjs` and `scripts/release/changelog.test.mjs` exist and are committed as `27c9782`.
- `npm run test:scripts` passes (354/354), and the two touched files pass (69/69).
