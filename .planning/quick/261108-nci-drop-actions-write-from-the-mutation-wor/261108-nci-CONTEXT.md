# Quick task M: drop the unneeded `actions: write` permission from the mutation workflow (QR-08, D-1308)

## Decision (owner, 2026-11-08)

Drop it. PR #47's commit `33dd980` ("ci(mutation): drop unneeded actions write permission") removes one line from `.github/workflows/mutation.yml`: the mutation job makes no GitHub API calls, so `actions: write` is not needed and the job keeps `contents: read`. The owner chose to apply it on the integration lane. The change still needs human review before merge (`.github/workflows/**`); nothing is merged by this task.

## Locked decisions

- Apply the commit with `git cherry-pick -x 33dd980` so authorship and provenance are preserved. The object is in the shared repository store (it lives on branch `feat/v3-qr-release`). If the cherry-pick conflicts, resolve it to exactly one deleted line (`actions: write` under the job's `permissions:`) and nothing else.
- Confirm the resulting `.github/workflows/mutation.yml` has top-level `permissions: contents: read`, the job `permissions: contents: read` only, and no other change.
- If `actionlint` is installed, run it on the file with a temporary config that declares the self-hosted label `omega-ci` (the config stays outside the repository); if it is not installed, say so in the SUMMARY and do not install anything.

## Files in scope

`.github/workflows/mutation.yml` only.

## Execution notes

- This is the one task allowed to touch `.github/workflows/**`, and only for that one line.
- Do not edit CHANGELOG.md, package.json, package-lock.json or `release/**`. `.planning/config.json` has an uncommitted orchestrator change: never stage it.
