---
phase: quick-261108-nci
plan: 01
subsystem: ci
tags: [github-actions, least-privilege, cherry-pick, QR-08, D-1308]
requires: []
provides:
  - "mutation job token scoped to contents: read only (actions: write removed)"
affects: [.github/workflows/mutation.yml]
key-files:
  modified:
    - .github/workflows/mutation.yml
decisions:
  - "Applied PR #47 commit 33dd980 with git cherry-pick -x so authorship and provenance are preserved."
  - "Human review is required before merge because the change touches .github/workflows/**. Nothing was merged or pushed."
metrics:
  tasks: 3
  commits: 1
  files_changed: 1
status: complete
---

# Phase quick-261108-nci Plan 01: Drop actions write from the mutation workflow Summary

Least-privilege token for the scheduled mutation job: `actions: write` removed from the mutation job's `permissions:` block via a provenance-preserving cherry-pick of `33dd980`.

## Result

- Cherry-pick commit: `9e2142f` ("ci(mutation): drop unneeded actions write permission"), carrying the original author and the `(cherry picked from commit 33dd980eff4837727c76ceb86e3a169f07451c60)` trailer.
- `git cherry-pick -x 33dd980` applied cleanly on the first attempt. No conflict resolution was needed and the cherry-pick was not aborted.
- `git show --stat HEAD`: exactly one file, `.github/workflows/mutation.yml`, `1 file changed, 1 deletion(-)`, zero insertions.
- The only hunk (`@@ -21,7 +21,6 @@`) removes `      actions: write` from the mutation job's `permissions:` block.
- Resulting permissions:
  - Top-level: `permissions: contents: read` (unchanged).
  - Mutation job: `permissions: contents: read` only.
- `.planning/config.json` is still ` M` (unstaged) and was not touched by this task. `git diff --cached --name-only` was empty before and after the cherry-pick.

## Verification

| Check | Command | Result |
|---|---|---|
| actionlint with out-of-repo config declaring `omega-ci` | `actionlint -config-file <tmp> .github/workflows/mutation.yml` | exit 0, no findings. The temp config was created with `mktemp` and removed afterwards. |
| typecheck | `npm run typecheck` (under `heavy-slot-1.lock`) | exit 0 |
| lint | `npm run lint` (under `heavy-slot-1.lock`) | exit 0 |
| module-size and gates | `npm run check:gates` (under `heavy-slot-1.lock`) | exit 0 |
| docs scan | `npm run check:docs` (under `heavy-slot-1.lock`) | exit 0 |

The workflow change is YAML-only, so no test files were touched or needed to run.

## Review and merge status

- `.github/workflows/**` requires human review before merge (AGENTS.md). This change has not been reviewed by a human yet.
- Nothing was merged or pushed by this task. The commit exists only on the integration lane branch.
- This SUMMARY was written but not committed. Per the orchestrator notes, the orchestrator commits docs artifacts.

## Deviations from Plan

None. The plan's Task 3 said to commit the SUMMARY. The orchestrator notes and constraints say docs artifacts are committed by the orchestrator, so the SUMMARY was left uncommitted. The orchestrator notes take precedence.

## Self-Check: PASSED

- FOUND: `.github/workflows/mutation.yml` has no `actions: write`.
- FOUND: commit `9e2142f` is the single-line cherry-pick of `33dd980`.
- FOUND: gates typecheck, lint, check:gates and check:docs all exited 0.
