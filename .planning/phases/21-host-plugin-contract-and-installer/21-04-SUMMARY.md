# Plan 21-04 summary: `realm host`, the host-plugins doctor item, documentation, packaging and gates

**Status:** implemented on branch `gsd/phase-21-exec4` (from `gsd/phase-21-exec3`); not committed by the worker. The worker did not build, lint or run the TypeScript test suites (the orchestrator does); only the repo gate scripts and the `scripts/check` unit tests listed below were run.

## What shipped

- `src/host/env.ts`: `hostEnvFrom(env)` (absolute `HOME`, absolute `PATH` entries, environment passed through) and `hostLogPath(stateDir)`.
- `src/cli/host.ts` and its dispatch in `src/cli/main.ts`: `realm host list|detect|status|install|uninstall`, strict argument parser (exit 2), catalogue refusals (exit 1, code on stdout, `<reason id>: <fixed text>` on stderr), file logger `<stateDir>/host.log` with stderr fallback. Test seams `CliDeps.hostRuntimes` and `CliDeps.hostAdaptersDir`. No `process.env` read.
- `src/doctor/host-checks.ts` and `src/doctor/checks.ts`: `CheckId` gains `host-plugins`, appended last by `runChecks` (so local and daemon doctor both carry it); reads receipts only.
- `docs/integration/host-plugin-contract.md` and a pointer section in `docs/integration/hosts.md`.
- `scripts/check/pack-smoke.mjs`: `HOST_MODULE_FILES`, `missingHostModuleFiles`, and a consumer probe that imports `host/runtimes.js` and `host/manifest.js`, asserts 19 hosts and builds each default manifest.
- Gates: `src/host` entry in `coverage-floors.json` seeded at 0 (raise it with `coverage.mjs --write`); 25 `src/host` exports added to `export-usage-allowlist.json` as D-1306 seams with specific reasons; `HOST_AUDIT_SESSION_ID` un-exported.
- Tests: `test/host/env.test.ts`, `test/cli/host.test.ts`, `test/doctor/host-checks.test.ts`, usage assertion in `test/cli/cli.test.ts`, the `host-plugins` id added to the four doctor and daemon expectation lists, pack-smoke and coverage script tests.

## Observed (worker)

- `node scripts/check/export-usage-gate.mjs`: 0 failing, 191 allowlisted, 0 stale. `module-size.mjs`, `host-paths.mjs`, `agents-sync.mjs`, `default-mode.mjs`, `gate-closure.mjs`: ok.
- `node --test scripts/check/pack-smoke.test.mjs scripts/check/coverage.test.mjs scripts/check/export-usage.test.mjs scripts/check/export-usage-gate.test.mjs`: all pass.

## Left for the parent

`npm run build`, the host, cli, doctor and daemon test files, `npx eslint .`, `npm run test`, `npm run test:coverage` then `node scripts/check/coverage.mjs --write` (raises the seeded `src/host` floor), `npm run check:pack`, and the CHANGELOG lines (release-owned, not written here).
