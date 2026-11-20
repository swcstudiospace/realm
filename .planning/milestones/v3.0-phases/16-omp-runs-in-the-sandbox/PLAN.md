# Phase 16 — PLAN (consolidation)

Reused detail: `16-01-PLAN.md` (O1), `16-02-PLAN.md` (O2), `16-04-PLAN.md`
(O4, no requirement ID — support unit), `16-03-PLAN.md` (O3, human-needed).
Phase 12 plans `12-02-PLAN.md`/`12-03-PLAN.md` are the test-bed dependency
and are NOT rewritten. Each OMPX ID appears in exactly one plan below.

## Wave 1 — Host policy + lifetime (src/omp only)
- P16-01 [OMPX-02] files: `src/omp/plugin.ts`, `src/omp/tools.ts`,
  `test/omp/plugin.test.ts`, `test/omp/tools.test.ts`. Observable: five
  tools call daemon with frozen ToolCall; successful-read regression
  (Uint8Array/Buffer, digest/byte metadata) passes. IU, gap = read proof.
- P16-02 [OMPX-03] files: `src/omp/plugin.ts` (host-transition queue),
  `test/omp/plugin.test.ts`. Observable: same-mode drift reconciled;
  deferred setter after timeout/retry/shutdown/new session re-checked
  (generation/ownership); model bash → catalogue code. MC genuine gap.
- P16-03 [OMPX-04] files: `src/omp/plugin.ts`, `src/omp/extension.ts`,
  `test/omp/extension.test.ts`. Observable: same-name read/write replace
  natives both modes; restore only owned tools; mode published only after
  setter/readback success; disconnected registered write refuses (no host
  file) even advisory. IU/MC (restore/publication gap).

## Wave 2 — Consumer + production acceptance (test-only, disjoint)
- P16-04 [OMPX-05] files: `test/integration/production-driver.test.ts`,
  `test/support/production-live.ts`,
  `test/integration/production-live-helpers.test.ts`,
  `test/integration/omp-guard.test.ts`. Observable (live, human-needed):
  doubly-gated real Omp→daemon→driver→OpenShell→Podman write; identical
  host-root and `/workspace` bytes; paired admission/result audit lines.
  MC + LG: no live window approved; offline helpers only until then.

Wave 2 depends on Wave 1. O4 (`16-04-PLAN.md`) rides Wave 1 files in a
later wave per P16-D3 (shares `src/omp/plugin.ts`) and carries no OMPX ID.
HARN-03 is not a plan here — owner-blocked grey area (see CONTEXT.md).
