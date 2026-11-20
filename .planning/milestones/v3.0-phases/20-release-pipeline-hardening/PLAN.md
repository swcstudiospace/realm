# Phase 20 — PLAN (consolidation)

Reused detail: `20-01..20-03-PLAN.md`; implementation source is PR40
(`ci/release-build-publish-split`, head `cd87368`) cherry-picked per
`20-SUMMARY.md`. Each REL ID appears in exactly one plan below.

## Wave 1 — Build/publish split + provenance (ci.yml, serialize with P13-03)
- P20-01 [REL-01] files: `.github/workflows/ci.yml` (release jobs),
  `docs/integration/openshell.md` (job documentation). Observable: build
  job `contents: read`; publish job privileged, downloads artifacts only,
  runs no npm install/build/pack. IU in PR40; real release-run logs LG.
- P20-02 [REL-02] files: `.github/workflows/ci.yml` (attest/upload steps),
  `scripts/release/changelog.mjs` (asset set only — serialize with P20-04).
  Observable: `actions/attest-build-provenance` over tarball/SHA256SUMS/SBOM
  (+ milestone files) before tag push; draft→upload→check→undraft;
  published-incomplete assets fail. IU; `gh attestation verify` on
  downloaded subjects LG.

## Wave 2 — Rollback + changelog (disjoint workflows/scripts)
- P20-03 [REL-03] files: `.github/workflows/rollback.yml`,
  `.github/workflows/pages.yml`, `test/workflows/rollback.test.mjs`.
  Observable: `docs_tag` validated (format, ancestry, published
  non-prerelease) before any change; tag marked prerelease; Pages builds
  `source_ref` tag content; inputs via env only. IU; live rollback +
  deployed-content proof LG.
- P20-04 [REL-04] files: `scripts/release/changelog.mjs`,
  `scripts/release/changelog.test.mjs`. Observable: multi-commit
  non-revert removal filtered via `Removes:` relationships; mixed-path,
  rename, same-title-unrelated, revert-of-revert and previously-shipped
  removal histories behave correctly; published CHANGELOG untouched.
  IU (P20 behavioral histories remain).

Depends on Phase 13 (13→20). No release/tag/dispatch/merge by any
specialist; parent/authorized operator owns P20 execution.
