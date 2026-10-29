# Phase 10 Summary: Docs, Packaging, and Release 0.2.0 (fix-now tier only)

Status: partial. Only the fix-now quality tier is done. The release steps (PR to main, merge, release 0.2.0, changelog entry for the release) are held by the owner ("keep the hold", 2026-10-24) and are not executed.

## Scope done
- Deleted four wording-pin targets. Each asserted regexes or text on documentation or source text, which AGENTS.md says to delete rather than re-pin:
  - `test/anda/boundary-decision.test.ts` (6 tests, decision-note wording)
  - `test/runtime/decision-note.test.ts` (10 tests, decision-note table wording)
  - `test/anda/no-shim.test.ts`: the second test (decision-note wording) and its unused `NOTE_PATH` constant; the filesystem test stays
  - `test/runtime/agentos-supervisor.test.ts`: the manifest test (package.json text match) and its now-unused imports and `PACKAGE_ROOT`
- `test/quality/suite-taxonomy.test.ts`: removed the deleted files from the anda bridge category and from the inventory.
- `tsconfig.json`: enabled `noUncheckedSideEffectImports` (zero hits).
- Not enabled: `erasableSyntaxOnly`. An earlier note recorded it as zero-hit, but it has two hits: constructor parameter properties at `test/omp/plugin.test.ts` lines 130 and 131. Enabling it needs a code change outside the approved zero-hit tier, so it is owner-gated.

## Commands and outcomes (clean dist, `rm -rf dist` first)
| Step | Outcome |
|---|---|
| typecheck | exit 0 |
| lint | exit 0 |
| build | exit 0 |
| unit (`npm test`) | 1118 total, 1109 pass, 0 fail, 9 skipped (was 1136 before the deletions: 18 wording-pin tests removed, all of which passed) |
| integration (default PATH, Podman 4.9.3) | 9 skipped, `PODMAN_UNSUPPORTED_VERSION` (expected below 5.x; the Podman 5.7.1 run is recorded in the Phase 9 summary) |
| scripts, docs, gates, pack, mcp, site | all exit 0 |

Stale-output check: a first run with the deleted files still in `dist` reported 1134 tests because `tsc` does not remove output for deleted sources. Removing `dist` and rebuilding gave the 1118 result above.

## Follow-ups
- Owner: decide whether to enable `erasableSyntaxOnly` by converting the two parameter properties in `test/omp/plugin.test.ts` to explicit fields.
- Owner: the release steps remain held. Changelog and version fields are not edited here (AGENTS.md PR policy).
