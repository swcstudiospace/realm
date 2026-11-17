---
phase: 22-omp-plugin-on-boot
plan: 02
subsystem: omp-install-recipe
tags: [omp, host, installer, shim, bundle-copy, refusals]
requires: ["21-03", "21-04"]
provides:
  - "adapters/omp/index.js: the Omp extension shim with one token, @realm:extension-url@, expanded at install time to the file URL of the built extension"
  - "The omp entry of HOST_RUNTIMES with a bundle-copy recipe writing <agent dir>/extensions/realm/index.js, and a plugin-link conflict probe"
  - "Install refusals extension-unbuilt, already-loaded and unsupported-path, each POLICY_DENIED, each before any write"
affects: [adapters/omp/index.js, src/host/types.ts, src/host/runtimes.ts, src/host/recipe.ts, src/host/adapter.ts, scripts/check/pack-smoke.mjs, test/host/omp-recipe.test.ts, test/host/adapter.test.ts, test/host/runtimes.test.ts, test/cli/host.test.ts]
key-files:
  created:
    - adapters/omp/index.js
    - test/host/omp-recipe.test.ts
  modified:
    - src/host/types.ts
    - src/host/runtimes.ts
    - src/host/recipe.ts
    - src/host/adapter.ts
    - scripts/check/pack-smoke.mjs
    - scripts/check/pack-smoke.test.mjs
    - test/host/runtimes.test.ts
    - test/host/adapter.test.ts
    - test/cli/host.test.ts
decisions:
  - "The shim is one file that imports the built extension by an absolute file URL embedded as a JSON string literal, so there is one extension and one set of tools whichever route loads it"
  - "A package root whose path holds a backslash is refused as unsupported-path rather than written into a shim Node cannot import; no new error code is added, every refusal maps to POLICY_DENIED"
  - "A plugin link (omp plugin install) and the shim are alternatives: install refuses with already-loaded when the link exists"
requirements: [OMPB-04, OMPB-05]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Phase 22 Plan 02: Omp install recipe and shim Summary

Merged to main in PR 106 (squash `819014d`). Omp is the first host with a real recipe: `realm host install omp` writes one shim file, records a receipt and refuses unsafe states without writing.

## What shipped

- `adapters/omp/index.js` (shipped in the package): a default-export function that `await import(...)`s the built extension and calls its factory with the host API object it was given. The token `@realm:extension-url@` is replaced at install time; any other `@realm:` token in a bundle file is `SCHEMA_INVALID`.
- `src/host/runtimes.ts` gives only the `omp` entry a recipe (`bundle-copy`, source `omp`, dest `extensions/realm`); the other 18 hosts still refuse as recipe-pending. `src/host/adapter.ts` expands the token from the validated manifest entry (`dist/src/omp/extension.js`), runs the preflights, and reports the plugin-link conflict in detection.
- `src/host/recipe.ts` adds the refusal reasons `extension-unbuilt`, `already-loaded` and `unsupported-path`, all mapped to `POLICY_DENIED` with fixed text. `unsupported-path` covers a package root containing a backslash.
- `scripts/check/pack-smoke.mjs` (and its test) cover the shipped shim.
- `test/host/omp-recipe.test.ts` runs the lifecycle on a fixture host (install, idempotent re-install, `--dry-run`, uninstall owning only what the receipt owns), the refusals, foreign content, drift and symlink cases, and a real import of the installed shim against a stub extension.

## Observed

- Read of `origin/main` at `4dfefff`: `adapters/omp/index.js` holds the single token; `src/host/recipe.ts` lists `extension-unbuilt`, `already-loaded` and `unsupported-path` mapped to `POLICY_DENIED`; `src/host/adapter.ts` throws `HostRefusal("extension-unbuilt")`, `HostRefusal("already-loaded")` and `HostRefusal("unsupported-path")`.
- Live rehearsal 2026-11-17 (Omp 18.22.0): `realm host install omp --dry-run` then `install` wrote exactly one file under `extensions/realm/`; `status` reported installed; uninstall left the profile byte-identical. See 22-03-SUMMARY.md and 22-VERIFICATION.md.
- CI on the PR head passed (Verify Node 22.x and 24.x, docs site build, dependency audit).

## Not verified here

- The `already-loaded` refusal against a link created by a real `omp plugin install` was not exercised; the offline tests create the link path on a fixture host.
- Windows or any path with a backslash on a real Windows host: only the refusal logic is tested, not a Windows install.

## Deviations from plan

None recorded by the closer.
