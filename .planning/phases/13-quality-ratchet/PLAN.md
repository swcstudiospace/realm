# Phase 13 — PLAN (consolidation)

Reused detail: `13-01-PLAN.md` (existing split) — this consolidation assigns
every QR ID to exactly one plan below; on conflict this file wins for
assignment, the sub-plan wins for file-level detail. Waves are file-disjoint;
orchestrator verifies (no gates run by this author).

## Wave 1 — CI supply chain (disjoint from Wave 2 scripts)
- P13-01 [QR-01] files: `.github/workflows/ci.yml`, `.github/dependabot.yml`
  (audit job only; see P13-02 for dependabot content). Observable: audit job
  runs `npm audit --omit=dev --audit-level=high`, in release `needs`.
  Status: IU — needs exact audit-job CI log (P13A).
- P13-02 [QR-02] files: `.github/dependabot.yml`. Observable: covers
  github-actions (root) + npm (root, `site/`), weekly, prefixes ci/build.
  Status: IU configuration; settings excluded.

## Wave 2 — Pack + coverage + exports (scripts/check, disjoint)
- P13-03 [QR-03] files: `scripts/check/pack-smoke.mjs`,
  `scripts/check/pack-smoke.test.mjs`, `.github/workflows/ci.yml`
  (release smoke step only — serialize with P13-01). Observable: removing
  any one of the four adapter files from a scratch tarball extraction →
  exit 1 naming it; Finish/repair smoke on versioned tarball pre-mutation.
  Status: MC Finish path fixed in `75631f4`, IU; needs real 4-negative runs.
- P13-04 [QR-04] files: `scripts/check/coverage.mjs`,
  `scripts/check/coverage.test.mjs`, `scripts/check/coverage-floors.json`,
  `.github/workflows/ci.yml` (coverage step only). Observable: raised-floor
  run exits 1 with BELOW metric on real lcov; committed floors exit 0.
  Status: IU + host evidence; CI provenance open.
- P13-05 [QR-06] files: `scripts/check/export-usage.mjs`,
  `scripts/check/export-usage.test.mjs`, plus per-directory src/test
  seams (≤5 files per PR slice). Observable: `--list --class self-only|
  test-only` inventories retained; shipped exports removed per disposition.
  Status: IU — inventory/disposition unverified, no blind re-removal.

## Wave 3 — Time, properties, mutation (disjoint test/support + workflows)
- P13-06 [QR-05] files: `test/support/timing.ts`,
  `test/support/fake-execution.ts`, `test/runtime/libpod-client.test.ts`,
  `test/lifecycle/idempotent.test.ts`. Observable: no fixed waits in those
  tests; CPU-quota container run passes with named skips (P13C). IU.
- P13-07 [QR-07] files: `package.json`, `package-lock.json`,
  `test/fs/canonicalize.property.test.ts`, `test/core/policy.property.test.ts`,
  `test/support/property.ts`. Observable: properties in `npm test`;
  deliberate canonicalizer break fails ≥1 (history 3/11 → restore 11/11). IU.
- P13-08 [QR-08] files: `.github/workflows/mutation.yml`,
  `scripts/mutation/run.mjs`, `scripts/mutation/run.test.mjs`. Observable:
  scheduled, non-blocking, artifact-only; covers src/fs, policy, redact;
  permission per D-1308 `contents: read`. IU; run artifact open.

Dependency: Wave 3 P13-08 after P13-01 (ci.yml owner coordination with
Phase 20). All CI/Podman/live claims are parent-verified only.
