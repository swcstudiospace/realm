---
phase: 15
plan: 14
subsystem: docs
tags: [docs, init, doctor-fix, omp-runbook, onboarding]
requires: ["15-11", "15-12"]
provides:
  - "omp.md runbook steps 2-3 use realm init; policy.json is not hand-written"
  - "policy-reference.md: ## realm init and ## realm doctor --fix"
  - "AGENTS.md layout names cli/init.ts and fix.ts"
requirements: [ONB-01, ONB-02]
metrics:
  tasks: 3
  commits: "1, shared: 0f141fe"
status: complete
verification: "Read at HEAD. check:docs NOT RUN; no evidence file."
---

# Phase 15 Plan 14: docs for realm init and realm doctor --fix (ONB-01, ONB-02) Summary

The Omp runbook, policy reference and AGENTS.md layout describe the shipped `realm init` and `realm doctor --fix`. No live run is part of this plan.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | runbook steps 2-3 use realm init | 0f141fe | docs/integration/omp.md |
| 2 | policy reference: init and doctor --fix | 0f141fe | docs/policy-reference.md |
| 3 | AGENTS.md layout entries | 0f141fe | AGENTS.md |

## What was added

- `omp.md:196` step 2: `init --image <digest pin> --workspace --state-dir`; init writes config and `policy.json` (`fail-closed`). Plan Task 1.
- `omp.md:197` step 3: "Do not write policy.json by hand". Hunk `@@ -193,8 +193,8 @@` changes only steps 2-3.
- `policy-reference.md:337` `## realm init`, `:359` `## realm doctor --fix` (34 insertions, 0 deletions). Plan Task 2.
- `AGENTS.md:58` (cli/init.ts), `:75` (fix.ts). Plan Task 3.

## Verification

- Read at HEAD: each H2 heading appears once; `main.js init` at omp.md:196.
- Code the docs cite, read at HEAD: `init.ts:506` policy text; `init.ts:205` mode check; `init.ts:236` 107-byte limit; `init.ts:342,358` 0700; `init.ts:402,405` 0600; `main.ts:717` "run realm init"; `package.json:60` check:docs.
- NOT VERIFIED: `npm run check:docs` and the plan's grep counts were not run; no evidence file records an exit code. Steps 1 and 4-8 unchanged rests on the diff hunk only.

## Deviations from Plan

1. Plan line refs drifted: `init.ts:478-479` is now `:506`; `main.ts:693` is now `:717`. Text checked, not numbers.
2. No per-plan commit: 0f141fe also carries 15-11 to 15-13 code.
3. Not applicable: omp 18.20.0 vs 18.12.6, L-C POLICY_DENIED, L-C2 restore, P15-O4. No live step ran.

## Stubs, Threat Flags, Next Steps

None for stubs and threat flags; runbook uses placeholders only. Plan 15-14 is PASS only after a recorded exit 0 for `npm run check:docs`.

---
*Phase: 15-zero-config-onboarding-and-fail-closed-default*
*Completed: 2026-11-13*
