---
phase: 20-release-pipeline-hardening
verified: 2026-11-17
verdict: passed
status: passed
score: 4/4 requirements verified (REL-02 normal path)
ref: origin/main after PR 94 to PR 97 (merges 9710346, 25af138, 9ec64fa, 339674c); live release v0.3.30 at 69e0fca
behavior_unverified: 0
overrides_applied: 2
overrides:
  - must_have: "The repair path and draft/partial-release states run live (G1)"
    reason: "Not exercised live; covered offline by scripts/release/release-cases.test.mjs (59 tests). A live run can be added later"
    accepted_by: "owner"
    accepted_at: "2026-11-17"
  - must_have: "main has branch protection (G2)"
    reason: "Residual risk accepted; TD-10 is owner-held"
    accepted_by: "owner"
    accepted_at: "2026-11-17"
covered_files:
  - ".github/workflows/rollback.yml"
  - ".github/workflows/pages.yml"
  - ".github/workflows/ci.yml"
  - ".github/workflows/mutation.yml"
  - "scripts/release/release-cases.test.mjs"
  - "AGENTS.md"
---

# Phase 20 verification: release pipeline hardening

Source of acceptance: `20-CONTEXT.md` and `.planning/REQUIREMENTS.md` REL-01 to REL-04. Evidence files are kept outside the repository. This supersedes the 2026-11-02 `gaps_found` report, whose live items are now closed.

## Gate runs

Joined P0 gate on `9710346`: typecheck, lint, test (3094 tests, 3051 pass, 0 fail, 43 skip), test:scripts, check:docs, check:gates, build, check:pack, check:mcp and npm audit all exit 0.

## Requirements

- **REL-01 (build and publish split): verified.** Live release v0.3.30 (run `43948862894`, commit `69e0fca`): build job token Contents read only; publish job Actions, Attestations and Contents write.
- **REL-02 (attestation `gh attestation verify` accepts): verified (normal path).** `gh attestation verify` (gh 2.104.0) exit 0 for the tarball, `SHA256SUMS` and the SBOM; `sha256sum -c` OK; Pages deployed.
- **REL-03 (rollback to known-good docs): verified.** Test rollback run `43951066556` (tag `v0.3.30`, `docs_tag` `v0.3.29`) succeeded; Pages run `43951138913` built from SHA `98184f293ed096b8b2e39c7c814d6649c9c0154c`; `v0.3.30` then restored (`prerelease=false`) and Pages redeployed. `rollback.yml` passes the peeled SHA and `pages.yml` verifies the tag/SHA pair through the GitHub API before checkout (PR 94).
- **REL-04 (features removed without revert): verified.** Changelog tests and the 59 release-cases tests (PR 95) pass.

## Runner and environment

PR 96 moved six jobs in `ci.yml`, `mutation.yml`, `pages.yml` and `rollback.yml` from the self-hosted `omega-ci` runner to `ubuntu-24.04`; PR 97 fixed the stale wording. The earlier shared self-hosted runner risk (T-20-05) is superseded. A throwaway branch workflow was refused by `github-pages` environment protection (run `43889942123`); the branch policy is `main` only.

## Owner-accepted items

- **G1.** The repair path and draft/partial-release states were not exercised live; covered offline only.
- **G2.** `main` has no branch protection (TD-10, owner-held).
