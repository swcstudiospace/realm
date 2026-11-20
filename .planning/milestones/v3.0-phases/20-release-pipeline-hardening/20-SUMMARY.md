---
phase: 20-release-pipeline-hardening
subsystem: release-pipeline
requirements: [REL-01, REL-02, REL-03, REL-04]
metrics:
  completed: 2026-11-17
status: complete
---

# Phase 20 summary: release pipeline hardening

**Status: complete.** REL-01 to REL-04 are verified (REL-02 on the normal path). The history of the original 2026-11-02 lane work is superseded by the merged PRs below. See `20-VERIFICATION.md`.

## Plans

- `20-01-SUMMARY.md`: PRs 94 to 97 (rollback tag/SHA contract, 59 offline release tests, move to GitHub-hosted runners, wording fixes).
- `20-02-SUMMARY.md`: live release v0.3.30, attestation verification and test rollback.
- `20-03-SUMMARY.md`: joined P0 gate on `9710346` and closure.

## Outcome

- PR 94 (`9710346`): `rollback.yml` passes the peeled SHA; `pages.yml` verifies the tag/SHA pair through the GitHub API and requires default-branch dispatch.
- PR 95 (`25af138`): `scripts/release/release-cases.test.mjs`, 59 tests.
- PR 96 (`9ec64fa`): six jobs moved from the self-hosted `omega-ci` runner to `ubuntu-24.04`; `AGENTS.md` residual-limits wording. PR 97 (`339674c`): stale omega comments and release-state wording fixed.
- Live release v0.3.30 (run `43948862894`, commit `69e0fca`): build token Contents read only; publish token Actions, Attestations and Contents write; `gh attestation verify` exit 0 for tarball, `SHA256SUMS`, SBOM; `sha256sum -c` OK; Pages deployed.
- Test rollback run `43951066556` (tag `v0.3.30`, `docs_tag` `v0.3.29`) succeeded; Pages run `43951138913` built from `98184f293ed096b8b2e39c7c814d6649c9c0154c`; `v0.3.30` restored and Pages redeployed.
- Gate on `9710346`: all gates exit 0 (3094 tests, 3051 pass, 0 fail, 43 skip).

## Owner-accepted gaps

- G1: the repair path and draft/partial-release states were not run live; offline tests only.
- G2: `main` has no branch protection (TD-10, owner-held).

## Superseded

The earlier shared self-hosted runner isolation limit (T-20-05) no longer applies: jobs run on GitHub-hosted runners. Owner decisions: GitHub-hosted runners; merge once CI is green, no Greptile review.
