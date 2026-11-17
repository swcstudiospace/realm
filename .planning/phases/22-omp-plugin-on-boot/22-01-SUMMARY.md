---
phase: 22-omp-plugin-on-boot
plan: 01
subsystem: omp-plugin-on-boot-contract
tags: [omp, host, boot-hook, conformance, reattach]
requires: ["21-02"]
provides:
  - "src/omp/plugin.ts consumes every boot bound, code list, re-attach rule and jitter function from src/host/boot.ts; src/omp/reattach.ts is deleted"
  - "createRealmPlugin(pi, options) returning a RealmPluginHandle with a readable view, plus options.bounds and options.onAttach; registerRealmPlugin kept as a thin wrapper"
  - "test/support/omp-boot-hook.ts: a HostBootHookFactory that drives the real Omp plugin through an in-memory Omp host API"
  - "test/omp/boot-conformance.test.ts: the Phase 21 conformance cases C1 to C9 run against the real Omp plugin"
affects: [src/omp/plugin.ts, src/host/boot.ts, test/host/boot.test.ts, test/omp/plugin.test.ts, test/support/omp-boot-hook.ts, test/omp/boot-conformance.test.ts, scripts/check/export-usage-allowlist.json]
key-files:
  created:
    - test/support/omp-boot-hook.ts
    - test/omp/boot-conformance.test.ts
  modified:
    - src/omp/plugin.ts
    - src/host/boot.ts
    - test/host/boot.test.ts
    - test/omp/plugin.test.ts
    - test/support/host-boot-conformance.ts
    - scripts/check/export-usage-allowlist.json
  deleted:
    - src/omp/reattach.ts
decisions:
  - "Omp becomes the reference consumer of src/host/boot.ts: the duplicated Omp constants and the parity block in test/host/boot.test.ts are deleted, and the test 'src/host/boot.ts imports nothing from src/omp' is kept"
  - "Guard decisions, status strings, tool-set reconciliation and the fail-closed default are unchanged; the only edits to pre-existing Omp tests are import lines (test/omp/plugin.test.ts takes its bound constants from BOOT_BOUNDS)"
requirements: [OMPB-01, OMPB-02, OMPB-03]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Phase 22 Plan 01: Omp plugin on the boot contract Summary

Merged to main in PR 106 (squash `819014d`, with plans 22-02 and 22-03). The Omp plugin stops being a second copy of the boot rules and becomes the first real consumer of the Phase 21 boot-hook port.

## What shipped

- `src/omp/plugin.ts` imports the bounds, link-lost and retryable code predicates, the re-attach sub-state table, the jitter function and the fail-closed tool-name verdict from `src/host/boot.ts`. `src/omp/reattach.ts` no longer exists, and the bound constants (`STARTUP_BUDGET_MS`, `GUARD_STATUS_BUDGET_MS`, `STATUS_POLL_MS`) are no longer exported from `src/omp`; the Omp unit test now defines them locally from `BOOT_BOUNDS`.
- `createRealmPlugin` returns a `RealmPluginHandle` with the registered tools and a read-only `view()`; `RealmPluginOptions` gains `bounds` and `onAttach` (reported after a settled attach is painted, never for a superseded one). `registerRealmPlugin` remains as a thin wrapper, so the extension edge is unchanged by this plan.
- `test/support/omp-boot-hook.ts` is a `HostBootHookFactory` over an in-memory Omp host API; `test/omp/boot-conformance.test.ts` runs `defineBootConformance` against it, so the real plugin is held to cases C1 to C9 and the Omp-specific bound-override tests.
- The parity assertions between `src/omp` and `src/host/boot.ts` are deleted from `test/host/boot.test.ts`; the reference hook and its four mutants (`test/host/boot-conformance.test.ts`) are untouched.
- `scripts/check/export-usage-allowlist.json` loses the entries this plan made stale.

## Observed

- Read of `origin/main` at `4dfefff` (which contains `819014d`): `src/omp/reattach.ts` is absent; `src/omp/plugin.ts` imports from `../host/boot.js` and says in its header that every bound and rule lives there; `test/omp/boot-conformance.test.ts`, `test/support/omp-boot-hook.ts` and `createRealmPlugin` with `onAttach` exist.
- CI on the PR head passed: Verify on Node 22.x and 24.x, the docs site build and the dependency audit.

## Not verified here

- The pass counts of `test/omp/boot-conformance.test.ts` and the mutant outcomes were not re-run for this summary; they rest on the CI result above.

## Deviations from plan

None recorded by the closer. The plan's non-goals held: no guard, status text or tool-set change, no production `bootHook` (Phase 23), no new error code.
