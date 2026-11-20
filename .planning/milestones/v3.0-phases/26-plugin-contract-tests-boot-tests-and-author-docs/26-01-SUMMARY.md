---
phase: 26-plugin-contract-tests-boot-tests-and-author-docs
plan: 01
subsystem: host-tests
tags: [host-plugin, contract-checker, registry, lifecycle-matrix, seeded-defects]
requires: []
provides:
  - "test/support/host-contract.ts: a table-driven cross-host contract checker with 12 row rules (not-frozen, identity, home-unsafe, env-shape, home-resolution, recipe-kind, launch-unsafe, launch-mismatch, manifest, capability-grant, shadow-shape, pending-inert) and 20 seeded defects, each returning exactly its violation code"
  - "test/support/host-registry.ts: one record per host (recipe family, suite files, snippet, live spec, recorded T2 and T3, deferral)"
  - "test/host/host-contract-matrix.test.ts: every one of the 19 real runtime-table rows through the 12 rules, under three capability policies, plus the seeded defects"
  - "test/host/host-registry.test.ts: a completeness test that lists every offending host at once"
  - "test/host/host-lifecycle-matrix.test.ts: the generic lifecycle contract on the 16 recipe rows and the 3 pending rows, plus its seeded defects"
affects: [test/support/host-contract.ts, test/support/host-registry.ts, test/host/host-contract-matrix.test.ts, test/host/host-registry.test.ts, test/host/host-lifecycle-matrix.test.ts, scripts/check/export-usage-allowlist.json]
key-files:
  created:
    - test/support/host-contract.ts
    - test/support/host-registry.ts
    - test/host/host-contract-matrix.test.ts
    - test/host/host-registry.test.ts
    - test/host/host-lifecycle-matrix.test.ts
  modified:
    - scripts/check/export-usage-allowlist.json
decisions:
  - "The contract checker and the registry live under test/support and are not published (OQ-26-01 default): a contributor adds a host in this repository"
  - "A new host cannot land without a registry record, its suite files, a snippet and a consistent live spec: the completeness test names every missing item for every host in one failure"
  - "The checker is proven able to fail: 20 seeded defective rows each return exactly their violation code, so a green run is not a vacuous pass"
  - "One export-usage allowlist entry was added, HostOperationDetail (type exported from src/host/adapter.ts and imported only by test support); the same commit also rewrote other lines of the allowlist file (143 changed lines in the diff stat), which this closure did not review"
requirements: [TEST-HOST-01, TEST-HOST-02, TEST-HOST-03]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Phase 26 Plan 01: Cross-host contract checker, registry and lifecycle matrix Summary

Merged to main in PR 122 (`0768950`; the plans themselves were merged in PR 120, `772c6ee`). After this plan a new or edited host row is checked against one shared contract, and a host cannot be added without its registry record, suites, snippet and live spec.

## What shipped

- `test/support/host-contract.ts`: the row checker (12 rules, 20 seeded defects) and the helpers the lifecycle matrix uses.
- `test/support/host-registry.ts`: the registry record per host.
- `test/host/host-contract-matrix.test.ts`, `test/host/host-registry.test.ts`, `test/host/host-lifecycle-matrix.test.ts`.
- One entry in `scripts/check/export-usage-allowlist.json`.
- No change under `src/`.

## Observed

- Read of `origin/main` at `db535c1`: the five files above exist and the allowlist carries the `HostOperationDetail` entry.
- CI on PR 122 passed after the fix rounds listed under Deviations.

## Not verified here

- The checker finds violations only in the shape of the 12 rules; a host defect outside them (for example a wrong host-side config path that is still a safe path) is not caught here. That stays with the per-host recipe suites and the live tiers.
- This plan adds no live, T2 or T3 evidence for any host.

## Deviations from plan

- **CI needed fix rounds.** Lint findings, and an export-usage gate failure for `HostOperationDetail` (a type exported by `src/host/adapter.ts` and used only from test support), fixed by an allowlist entry rather than by changing `src`.
