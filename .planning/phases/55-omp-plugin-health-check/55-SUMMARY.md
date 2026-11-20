# Phase 55: Omp plugin health check — Summary

**Date:** 2026-11-20 · **Requirements:** HEALTH-01, HEALTH-02 · **Status:** core implemented hermetic-first, no live window.

## What was built

`realm doctor` ends with a new `omp-plugin` item (after `capability-tokens`, so every earlier position is unchanged).
It reports whether the Omp extension is installed, current and loaded, read-only and bounded like every other doctor
probe:

- **pass:** installed and loaded (live session count, no fix).
- **warn, not installed:** no shim receipt; fix names `realm host install omp` after `npm run build`.
- **warn, not the current build:** drifted shim or a missing/unreadable imported entry; fix names rebuild plus
  repair (`realm host install omp`) or removal and reinstall.
- **warn, not loaded:** installed and current, no live marker; fix names starting an Omp session.
- **warn, unreadable markers:** names only a count, inspect fix.
- **fail:** probe failed or timed out, catalogue code only (`TOOL_TIMEOUT`, a receipt `PATH_ESCAPE`, `SCHEMA_INVALID`
  for anything else), never throws, never carries probe error text or a path.

## What the check can and cannot read (plan step 1, recorded)

Omp exposes no dedicated health/status API for a plugin (`docs/integration/omp.md` Q3, "not documented"), so the
check reads only Realm's own seams — the shim receipt under `<stateDir>/hosts/omp.receipt.json`, the recorder
status of the files it names (which yields `present`/`missing`/`unreadable` for the imported entry), and the
presence markers under `<stateDir>/hosts/omp-active/`. The plugin-link route (`omp plugin install <checkout>`)
writes no receipt, so the item reads it as not installed; the runbook verifies that route with `omp plugin list
--json` and `omp plugin doctor` instead, rather than the check guessing.

## Files

- `src/doctor/omp-checks.ts` (new): the check, its reading type and the injectable probe seam, plus the header
  record of the seams above.
- `src/doctor/checks.ts`: `omp-plugin` check id (appended last), the `ompPlugin?` injectable doctor option, wiring
  in `runChecks`, re-export of the probe types. `doctor --fix` untouched; the error catalogue stays at 29 codes.
- `test/doctor/omp-checks.test.ts` (new): enumerating hermetic tests over injected fakes for every outcome (pass,
  not installed, wrong version, not loaded, unreadable markers, timeout, catalogue and non-catalogue throws), plus
  default-probe cases against a fixture host installed by the real installer engine — pass with a live marker,
  not-installed with no receipt, not-loaded with no marker, gone entry as wrong-version — and a read-only proof
  (state-directory tree identical before and after the check). One case pins the runChecks position last.
- Enumerating lists updated in the same change: `test/doctor/checks.test.ts`, `test/doctor/host-checks.test.ts`,
  `test/doctor/capability-checks.test.ts`, `test/doctor/control-channel.test.ts`,
  `test/doctor/runtime-checks.test.ts`, `test/daemon/e2e.test.ts`,
  `test/integration/enforce-default.test.ts`.
- `docs/integration/omp-lifecycle-runbook.md`: new section "Doctor `omp-plugin` item: remedy for each outcome"
  mapping every outcome to remedy steps with a dated evidence receipt (2026-11-20), including the fresh-install
  case and the dangling-plugin-link case. No step signals a process the operator did not start, and no host-local
  absolute path appears in the committed files.
- `docs/hosts/snippets/omp.md` (doctor section) and `docs/integration/omp.md` (Reporting): describe the new item
  and point at the runbook section.

## Checks to run (main agent)

- `node --test` over the built doctor tests (`dist/test/doctor/omp-checks.test.js`,
  `checks.test.js`, `host-checks.test.js`, `capability-checks.test.js`, `control-channel.test.js`,
  `runtime-checks.test.js`) and the daemon e2e / enforce-default integration cases that pin the last item.
- `npm run build` and `npm run lint` on the changed files; docs checks (`npm run check:docs` or the repo's docs
  gate) for the runbook, snippet and omp.md edits.

## Not done, and why

- **Live proof:** none run. The plan makes it optional and outside the core; a live proof runs in a Phase 56–58
  window or its own, with evidence kept outside the repository and cited in `55-WINDOW.md`. No `55-WINDOW.md` was
  created. The dangling-link remedy is recorded as an operator procedure; no live dangling-link run is claimed.

## Limits

- The item covers the shim route only (see seams above); link-only installs read as not installed by design.
- A live marker proves a process loaded the plugin and settled an attach, not sandbox health (`realm status`) and
  not containment.
