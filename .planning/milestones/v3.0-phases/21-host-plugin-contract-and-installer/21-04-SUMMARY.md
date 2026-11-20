---
phase: 21-host-plugin-contract-and-installer
plan: 04
subsystem: host-cli-doctor-docs
tags: [host, cli, doctor, docs, packaging, gates]
requires: ["21-02", "21-03"]
provides:
  - "realm host list|detect|status|install|uninstall with --dry-run and --config-home, no daemon needed"
  - "Doctor item host-plugins that reads receipts only"
  - "docs/integration/host-plugin-contract.md with the evidence limits, shipped in the package"
  - "Repo gates covering src/host: module size, export usage, host paths, coverage floor entry, pack smoke"
affects: [src/cli/main.ts, src/doctor/checks.ts, docs/integration/hosts.md, scripts/check/pack-smoke.mjs, scripts/check/coverage-floors.json, scripts/check/export-usage-allowlist.json]
key-files:
  created:
    - src/host/env.ts
    - src/cli/host.ts
    - src/doctor/host-checks.ts
    - docs/integration/host-plugin-contract.md
    - test/host/env.test.ts
    - test/cli/host.test.ts
    - test/doctor/host-checks.test.ts
  modified:
    - src/cli/main.ts
    - src/doctor/checks.ts
    - docs/integration/hosts.md
    - scripts/check/pack-smoke.mjs
    - scripts/check/pack-smoke.test.mjs
    - scripts/check/coverage-floors.json
    - scripts/check/coverage.test.mjs
    - scripts/check/export-usage-allowlist.json
decisions:
  - "The CLI hands host code its environment as a parameter; no process.env read outside the existing entry edge in src/cli/main.ts"
  - "The src/host coverage floor is seeded at 0 and was not raised before the merge (residual R1 in 21-VERIFICATION.md)"
  - "CHANGELOG lines are release-owned and were not written by this plan"
requirements: [HOST-07, HOST-08, HOST-09]
metrics:
  tasks: 4
  completed: 2026-11-17
status: merged
---

# Phase 21 Plan 04 Summary: `realm host`, the host-plugins doctor item, documentation, packaging and gates

Merged to main in PR 102 (squash `bf70847`) with plans 21-01 to 21-03. The first version of this file was written by the plan worker before integration; it is kept below with the worker's observations, and the integration result follows.

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

## Observed (worker, before integration)

- `node scripts/check/export-usage-gate.mjs`: 0 failing, 191 allowlisted, 0 stale. `module-size.mjs`, `host-paths.mjs`, `agents-sync.mjs`, `default-mode.mjs`, `gate-closure.mjs`: ok.
- `node --test scripts/check/pack-smoke.test.mjs scripts/check/coverage.test.mjs scripts/check/export-usage.test.mjs scripts/check/export-usage-gate.test.mjs`: all pass.

## Integration result

- The orchestrator reported a clean `npm run build` and clean `eslint` and 215 host, cli and doctor tests passing locally before PR 102 was opened.
- CI on the PR head passed: Verify on Node 22.x and 24.x (including the coverage floors and export-usage gates), the docs site build and the dependency audit.
- Read of `origin/main` at `bf70847`: `runHostCommand` (`src/cli/host.ts` l.304) is dispatched from `src/cli/main.ts` l.720 and `host` is in `CLI_COMMANDS`; `hostPluginsCheck` is appended by `runChecks` (`src/doctor/checks.ts` l.191); `HOST_MODULE_FILES` and the consumer probe are in `scripts/check/pack-smoke.mjs`; `docs/integration/hosts.md` points at the contract document.

## Not verified here

- Real runtime table entries keep recipe null, so `realm host install <host>` on a real host refuses as recipe-pending (POLICY_DENIED); the lifecycle is proven on fixture hosts in temporary homes only. Real recipes are Phases 24 and 25.
- The `src/host` coverage floor is 0, so the coverage gate passing says nothing about the host layer's actual coverage.
- The CHANGELOG lines were not written by this plan.
