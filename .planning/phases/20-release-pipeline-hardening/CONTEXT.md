# Phase 20 — Release pipeline hardening: CONTEXT (consolidation)

Canonical detail reused: `20-CONTEXT.md`, `20-01..20-03-PLAN.md`,
`20-SUMMARY.md`, `20-VERIFICATION.md`, Phase 13 research Part D.

## Goal
Least-privileged build/publish separation, verifiable normal+repair
provenance, manual rollback that really re-points docs to a known-good
release, and changelog filtering of later-removed features. Runs last,
after Phase 13 pipeline changes and runtime acceptance.

## Owner decisions D1–D6 relevance
- D6: owner signs off `.github/workflows/**`, `release/**`,
  `scripts/release/**`; each PR cites D6. Parent's gated-merge/test-release
  path is the current approval; A15 never merges/pushes/dispatches.
- D1: proposal 8 part D. D2–D5: no direct requirement here. TD-10
  repository settings stay owner's (job split/attestation only).

## Honest status
REL-01/02 implemented-unverified in open PR40 (head `cd87368`); actual
release-run permission/handoff logs and downloaded-subject attestation
proof are live-gated. REL-03 implemented with fake-gh local evidence
(12 validation cases); GitHub acceptance + PR#40 human review open.
REL-04 implemented (explicit `Removes:` relationships, multi-target,
canonical-revert-first); behavioral-history proof per P20 remains.
Never claim release/Pages proof from fake gh/git harnesses.

## Grey areas / decisions
- Do not rewrite/force PR40's branch; do not regenerate old published
  CHANGELOG to fabricate closure; no hard-coded historical SHAs.
- Job token separation ≠ separate OS users/ephemeral machines on shared
  self-hosted runners — record residual limits, no fabricated SLSA claim.
- QR-03 Finish/repair tarball smoke must land before mutation
  (coordinate single `ci.yml` owner with Phase 13).
- Rollback input must travel via env/data, never shell interpolation;
  deployed content (not dispatch success) is the proof.

## Success criteria (verbatim, REQUIREMENTS REL-01..04)
- REL-01: The release job is split into an unprivileged build job and a privileged publish job (owner decision D6)
- REL-02: A release carries a build provenance attestation that `gh attestation verify` accepts
- REL-03: A manual rollback workflow marks a release a prerelease and re-points the documentation; a test release is marked a prerelease by it
- REL-04: TD-08: the changelog generator filters commits of features that were later removed
