---
phase: 20-release-pipeline-hardening
plan: "02"
subsystem: release-pipeline
tags: [live-release, attestation, pages, rollback]
requires: ["20-01"]
provides:
  - "Live release v0.3.30 (run 43948862894, commit 69e0fca): build job token Contents read only; publish job Actions/Attestations/Contents write"
  - "gh attestation verify exit 0 for tarball, SHA256SUMS and SBOM (gh 2.104.0); sha256sum -c OK; Pages deployed"
  - "Test rollback run 43951066556 (tag v0.3.30, docs_tag v0.3.29) succeeded; Pages run 43951138913 built from SHA 98184f293ed096b8b2e39c7c814d6649c9c0154c"
affects: [.planning/REQUIREMENTS.md, .planning/ROADMAP.md]
key-files:
  created:
    - .planning/phases/20-release-pipeline-hardening/20-02-SUMMARY.md
  modified: []
decisions:
  - "Owner: release jobs run on GitHub-hosted runners (ubuntu-24.04), not the self-hosted omega-ci runner (PR 96)"
  - "Owner: merge once CI is green, no Greptile review"
requirements: [REL-01, REL-02, REL-03]
metrics:
  completed: 2026-11-17
status: complete
---

# Phase 20 Plan 02: live release and rollback evidence Summary

The owner-approved live window produced the release, provenance and rollback evidence that phase 20 had left UNVERIFIED.

## Evidence

- **Release v0.3.30** (run `43948862894`, release commit `69e0fca`): the build job token has Contents read only; the publish job has Actions, Attestations and Contents write. `gh attestation verify` (gh 2.104.0) exits 0 for the tarball, `SHA256SUMS` and the SBOM. `sha256sum -c` is OK. Pages deployed.
- **Test rollback** (run `43951066556`, tag `v0.3.30`, `docs_tag` `v0.3.29`) succeeded. Pages run `43951138913` built from SHA `98184f293ed096b8b2e39c7c814d6649c9c0154c`. `v0.3.30` was then restored (`prerelease=false`) and Pages redeployed.
- **Pages environment denial:** a throwaway branch workflow was refused by `github-pages` environment protection (run `43889942123`); the branch policy is `main` only.

Evidence files are kept outside the repository.

## NOT VERIFIED

The repair path and draft/partial-release states were not run live (G1, owner-accepted; offline tests only).

## Deviations

The runner-isolation risk (T-20-05) was accepted for shared self-hosted runners in the plan; PR 96 superseded it by moving to GitHub-hosted runners.
