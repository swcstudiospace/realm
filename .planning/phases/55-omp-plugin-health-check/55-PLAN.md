# Plan 55-01: Omp plugin health check

**Phase:** 55-omp-plugin-health-check · **Requirements:** HEALTH-01..02 · **Wave:** 1, hermetic-first (no live window for the core; a live proof runs inside a Phase 56 to 58 window or its own). Phase 59 is explicitly excluded (gated on D-v9-6).

**Files:** `src/doctor/checks.ts` (new check; enumerating surface), `src/doctor/checks-host.ts` or `src/doctor/host-checks.ts` (only if the check belongs there), `test/doctor/checks.test.ts` and the enumerating test file(s) beside them (same pull request), doctor docs that list the checks, `docs/integration/omp-lifecycle-runbook.md` (new section), `.planning/phases/55-omp-plugin-health-check/55-WINDOW.md` (only if a live proof runs).

## Steps

1. **Record the Omp seams.** Read `docs/integration/omp.md` and the Omp plugin surface: what Omp exposes about its own install and health (shim path, receipt, live session markers) and which of those the existing doctor probes already read. Record what the check can read on injected fakes; anything Omp does not expose is reported as warn or fail with its fix, never guessed.
2. **Add the check (red first).** Add the Omp plugin health check to the doctor check list in `src/doctor/checks.ts`, reading only through injected probes with a timeout on every read. Outcomes: pass (installed and healthy); warn or fail with fix text for each failing case (not installed, wrong version, not loaded). The check is read-only: it installs, removes or repairs nothing except through the existing `doctor --fix` rules. Enumerating hermetic tests over injected fakes pin every outcome; the enumerating tests and the doctor docs update in the same pull request.
3. **Runbook section (HEALTH-02).** In `docs/integration/omp-lifecycle-runbook.md`, add a section mapping each failing doctor outcome from step 2 to its remedy steps, with a dated evidence receipt for each remedy; no step signals a process the operator did not start, and no host-local absolute path appears in committed files.
4. **Live proof (optional, not for the core).** If a live proof is run, it runs inside a Phase 56 to 58 window or its own on the shared live lock, and the evidence is kept outside the repository and cited by date in `55-WINDOW.md`. A failed live step is recorded as failed, never relabelled as a pass.

## Checks

- Hermetic: the new enumerating tests pass on injected fakes for every outcome (pass, not installed, wrong version, not loaded); `npm run build` and `npm run lint` on changed files.
- Read-only proof: a test or run shows the check writes nothing, changes no file and spawns no repair; `doctor --fix` behaviour is unchanged.
- Coverage: the new check appears in the check list, the enumerating tests and the doctor docs in the same pull request; the error catalogue stays at 29 codes.
- Catalogue and contracts: no new dependency without the `CONTRIBUTING.md` justification, licence and maintenance checks; strict TypeScript, `RealmError` with catalogue codes, no silent catch, no suppression comments.
