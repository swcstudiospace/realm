---
phase: 26-plugin-contract-tests-boot-tests-and-author-docs
plan: 03
subsystem: docs
tags: [docs, author-guide, support-matrix, gaps-page]
requires: ["26-01", "26-02"]
provides:
  - "docs/integration/writing-a-host-plugin.md: how to add a host end to end (table row, recipe choice, manifest, capabilities, boot hook, conformance and recipe suites, evidence tiers, live-rehearsal gating, Enterprise checklist, PR gates)"
  - "docs/integration/host-support-matrix.md: a block generated from the runtime table, the registry and the live specs, compared by a test that can rewrite it"
  - "docs/integration/host-plugin-gaps.md: the Phase 21 to 25 unverified and residual items as rows with id, source, class, status, evidence and lift condition"
  - "test/support/host-support-matrix.ts, test/docs/host-support-matrix.test.ts, test/docs/host-docs.test.ts, test/docs/host-gaps.test.ts"
  - "links from docs/integration/host-plugin-contract.md, docs/integration/hosts.md and README.md"
affects: [docs/integration/writing-a-host-plugin.md, docs/integration/host-support-matrix.md, docs/integration/host-plugin-gaps.md, docs/integration/host-plugin-contract.md, docs/integration/hosts.md, README.md, test/support/host-support-matrix.ts, test/docs/host-support-matrix.test.ts, test/docs/host-docs.test.ts, test/docs/host-gaps.test.ts]
key-files:
  created:
    - docs/integration/writing-a-host-plugin.md
    - docs/integration/host-support-matrix.md
    - docs/integration/host-plugin-gaps.md
    - test/support/host-support-matrix.ts
    - test/docs/host-support-matrix.test.ts
    - test/docs/host-docs.test.ts
    - test/docs/host-gaps.test.ts
  modified:
    - docs/integration/host-plugin-contract.md
    - docs/integration/hosts.md
    - README.md
decisions:
  - "The generated matrix block is written by a test (opt-in, refused in CI) rather than by a script (OQ-26-03 default), because the renderer reads the compiled table and registry"
  - "The gaps page is a tracked table with a test that checks ids, sources, evidence paths and per-phase coverage, so a gap cannot be dropped silently"
  - "The guide tells a contributor to add a host in this repository; the conformance harness is not a public extension API (OQ-26-01 default)"
requirements: [TEST-HOST-07, TEST-HOST-08]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Phase 26 Plan 03: Author docs, support matrix and gaps page Summary

Merged to main in PR 123 (`db535c1`; the plans themselves were merged in PR 120, `772c6ee`). After this plan a contributor can follow one guide to add a host, the support matrix cannot drift from the table, and every open host gap is a tracked row.

## What shipped

- The three docs pages, the matrix renderer and the three docs tests listed above, and the doc links.
- No change under `src/`.

## Observed

- Read of `origin/main` at `db535c1`: the three pages and four support and test files exist; `docs/integration/host-plugin-gaps.md` carries 37 `GAP-` rows.
- CI on PR 123 passed.

## Not verified here

- The `src/host` coverage floor was ratcheted in the closure PR: `scripts/check/coverage-floors.json` now holds 95/93/98 (lines/branches/functions; measured 96.55/94.53/99.73 on 2026-11-17, floor = floor(measured) - 1) and GAP-21-04 is closed in the gaps page. The measurement ran on Node 24 locally while the gate leg is 22.x, and the local suite run had one unrelated timing failure under load (`a probe that never passes gives OPENSHELL_START_FAILED at the deadline`) that passes in CI.
- The pages describe the tiers that exist (T1 fixture, T2 host validator, T3 live). No new live, T2 or T3 evidence was produced in this phase, and every gap row marked open stays open.
- The docs site build and `check:docs` were CI gates of PR 123; they were not re-run for this closure.

## Deviations from plan

- **The coverage ratchet did not ride in this plan's PR.** The plan scheduled `coverage.mjs --write` here; it landed in the closure PR instead (see Not verified here).
