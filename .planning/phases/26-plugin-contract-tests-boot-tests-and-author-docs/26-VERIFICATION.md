---
phase: 26-plugin-contract-tests-boot-tests-and-author-docs
verified: 2026-11-17
verdict: passed
status: passed
score: "8/8 requirements covered (TEST-HOST-01 to TEST-HOST-08) on fixture and in-process evidence; 3 plans merged (PRs 122, 121, 123) after the plans (PR 120); no change under src; no new live, T2 or T3 evidence; 4 claims outside the evidence reach, listed as behavior_unverified"
ref: "origin/main db535c1 (PR 120 plans 772c6ee; PR 122 0768950; PR 121 7ced16a; PR 123 db535c1); coverage ratchet and GAP-21-04 closure in the closure PR)"
behavior_unverified: 4
overrides_applied: 0
covered_files:
  - ".planning/phases/26-plugin-contract-tests-boot-tests-and-author-docs/26-CONTEXT.md"
  - ".planning/phases/26-plugin-contract-tests-boot-tests-and-author-docs/26-01-PLAN.md"
  - ".planning/phases/26-plugin-contract-tests-boot-tests-and-author-docs/26-01-SUMMARY.md"
  - ".planning/phases/26-plugin-contract-tests-boot-tests-and-author-docs/26-02-PLAN.md"
  - ".planning/phases/26-plugin-contract-tests-boot-tests-and-author-docs/26-02-SUMMARY.md"
  - ".planning/phases/26-plugin-contract-tests-boot-tests-and-author-docs/26-03-PLAN.md"
  - ".planning/phases/26-plugin-contract-tests-boot-tests-and-author-docs/26-03-SUMMARY.md"
  - "docs/integration/host-plugin-gaps.md"
  - "docs/integration/host-support-matrix.md"
  - "docs/integration/writing-a-host-plugin.md"
  - "test/cli/stdio-host-matrix.test.ts"
  - "test/docs/host-docs.test.ts"
  - "test/docs/host-gaps.test.ts"
  - "test/docs/host-support-matrix.test.ts"
  - "test/host/boot-conformance.test.ts"
  - "test/host/boot-driver-conformance.test.ts"
  - "test/host/host-contract-matrix.test.ts"
  - "test/host/host-lifecycle-matrix.test.ts"
  - "test/host/host-registry.test.ts"
  - "test/integration/host-boot-matrix.test.ts"
  - "test/support/boot-matrix-rig.ts"
  - "test/support/host-boot-mutants.ts"
  - "test/support/host-contract.ts"
  - "test/support/host-registry.ts"
  - "test/support/host-support-matrix.ts"
  - "test/support/reference-boot-hook.ts"
  - "test/support/stdio-world.ts"
---

# Phase 26 Verification: Plugin contract tests, boot tests and author docs

Method: read-only read of the repository at `db535c1` (existence and content of the key files below, the coverage floor file and the gaps page), plus the CI results of the four PRs as reported by the orchestrator. The verifier did not run the build, lint or tests. The code of this phase was written by agents without local compilation; CI was the gate and needed several fix rounds (lint, an export-usage gate failure, and the two-session cap of the daemon). Phase 26 changes tests, test support and docs only: no file under `src/` changed.

## Requirements coverage

| Req | Statement | Status | Evidence |
| --- | --- | --- | --- |
| TEST-HOST-01 | A table-driven contract checker runs the 19 table rows through the row rules; seeded defective rows each return exactly their violation code | SATISFIED on fixtures | `test/support/host-contract.ts` (12 rules, 20 seeded defects), `test/host/host-contract-matrix.test.ts`; CI passed on PR 122 |
| TEST-HOST-02 | A registry with one record per host and a completeness test that lists every offending host at once | SATISFIED | `test/support/host-registry.ts`, `test/host/host-registry.test.ts` |
| TEST-HOST-03 | A generic lifecycle contract on the 16 recipe rows and the 3 pending rows, with seeded defects | SATISFIED on fixtures | `test/host/host-lifecycle-matrix.test.ts` |
| TEST-HOST-04 | The conformance harness fails on a seeded defect in each of nine cases, each with its declared failing set, over the 18 drivers | SATISFIED, with a caveat | six new reference faults in `test/support/reference-boot-hook.ts`, three production-driver decorators in `test/support/host-boot-mutants.ts`, `test/host/boot-conformance.test.ts`, `test/host/boot-driver-conformance.test.ts`. The declared failing sets were predicted by reading and then adjusted to CI results |
| TEST-HOST-05 | A scripted boot matrix over the 18 ids and both transports | SATISFIED on fixtures | `test/cli/stdio-host-matrix.test.ts`, `test/support/stdio-world.ts` |
| TEST-HOST-06 | A real in-process daemon matrix (no Podman) over the 18 ids | SATISFIED, wall time not measured on CI | `test/integration/host-boot-matrix.test.ts`, `test/support/boot-matrix-rig.ts`; the first CI run failed for all 18 hosts (the daemon admits `MAX_CONCURRENT_SESSIONS = 2` sessions and the rig held three) and passed once the anchor session was removed |
| TEST-HOST-07 | The author guide and a generated support matrix compared by a test; links from the contract page, `hosts.md` and the README | SATISFIED | `docs/integration/writing-a-host-plugin.md`, `docs/integration/host-support-matrix.md`, `test/support/host-support-matrix.ts`, `test/docs/host-support-matrix.test.ts`, `test/docs/host-docs.test.ts`; the link additions are in the PR 123 diff stat (README, contract page, `hosts.md`) |
| TEST-HOST-08 | A tracked gaps page verified by a test; the `src/host` coverage floor ratcheted | SATISFIED | `docs/integration/host-plugin-gaps.md` (37 `GAP-` rows) and `test/docs/host-gaps.test.ts` exist (PR 123). In the closure PR `scripts/check/coverage-floors.json` holds `src/host` 95/93/98 (lines/branches/functions; measured 96.55/94.53/99.73 on 2026-11-17, floor = floor(measured) - 1) and the GAP-21-04 row is closed. The floor was measured on Node 24 locally while the gate leg is 22.x (see the coverage ratchet note below the list) |

Verdict: passed. Every requirement has its tests and docs on main and CI green; the coverage ratchet of TEST-HOST-08 rides in the closure PR. The unverified items below bound what the verdict means.

## Delivered changes

- PR 120 (`772c6ee`): the phase context and the three plans, TEST-HOST-01 to TEST-HOST-08 registered.
- PR 122 (`0768950`, plan 26-01): checker, registry, the three test files and the `HostOperationDetail` export-usage allowlist entry.
- PR 121 (`7ced16a`, plan 26-02): mutants, stdio world, rig, the stdio and real-daemon matrices.
- PR 123 (`db535c1`, plan 26-03): the three docs pages, the renderer and three docs tests, the links.

## behavior_unverified

1. The declared failing set of each harness mutant was predicted by reading and then adjusted to CI results; it documents observed behavior and was not derived independently.
2. The wall time of `test/integration/host-boot-matrix.test.ts` on CI was not measured (81 s on a loaded local machine). The plan says to split the file by transport above 60 s (OQ-26-05); no split was made.
3. No new live, T2 (host validator) or T3 evidence exists for any host. The matrices exercise fixture and in-process worlds; that a real host reads Realm's entry and starts it is unchanged from Phase 25.
4. The row rules and the lifecycle contract catch defects of their own shapes only; a defect outside them (a safe but wrong host-side path, a host that ignores the file) is not caught by these tests.

Coverage ratchet note (not counted above, it is recorded evidence with a stated limit): The `src/host` floor 95/93/98 was measured on Node 24 locally while the coverage gate leg runs Node 22.x, so the gate's own number may differ slightly; the margin of one point under the measured value is the only allowance. The local suite run behind that measurement had one unrelated timing failure under load, `a probe that never passes gives OPENSHELL_START_FAILED at the deadline`, which passes in CI.

## Open items carried

- OQ-26-01 (publish the harness as a package), OQ-26-02 (mutation campaign for `src/host`), OQ-26-03 (matrix block by test or script) and OQ-26-05 (split of the boot matrix by transport) keep their plan defaults; none was decided by the owner in this phase.
- Every GAP row marked open on the gaps page stays open.
