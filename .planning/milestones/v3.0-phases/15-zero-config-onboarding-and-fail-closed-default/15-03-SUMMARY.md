---
phase: 15
plan: 03
subsystem: docs
tags: [docs, fail-closed, upgrading, doctor]
requires: ["15-01", "15-02"]
provides:
  - "README and policy-reference Upgrading text that names the doctor policy-file check and its exit-0 behaviour (D-1502, P15-O3)"
affects: [README.md, docs/policy-reference.md]
key-files:
  created: []
  modified:
    - README.md
    - docs/policy-reference.md
decisions:
  - "D-1502: both Upgrading paragraphs say realm doctor names the mode and source, warns for explicit advisory, and exits 0 whatever its checks report"
  - "AGENTS.md, site/content/index.md and the four docs/integration files were verified by the check:docs guard (27 files, no advisory-default claim) and left unchanged"
requirements: [DEF-01, DEF-02]
metrics:
  tasks: 3
  commits: 2
  completed: 2026-11-08
plan_head_before: 866d509a62c511983520c2edda1113fd20191b08
commits: 2
status: complete
actuals:
  tokens: 300
  tasks: 3
  commits: 2
---

# Phase 15 Plan 03: Fail-closed docs and Upgrading notes Summary

The README and `docs/policy-reference.md` Upgrading text now tells existing users that `realm doctor` names the mode and its source in its `policy-file` check, warns for an explicit `advisory`, and exits 0 whatever its checks report. Every other owned document already stated the fail-closed default, so it was left alone.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | README Upgrading paragraph (D-1502) | 5402dcb | README.md |
| 2 | policy-reference Upgrading subsection (D-1502) | 0643ad3 | docs/policy-reference.md |
| 3 | Verify remaining owned statements (no edit) | none (no edit needed) | AGENTS.md, site/content/index.md, docs/integration/* |

## Verification

- `npm run check:docs` exits 0: host paths ok, agents sync ok, `check:default-mode: 27 files scanned, no advisory-default claim`.
- The sentence "exits 0 whatever its checks report" appears once in each of README.md and docs/policy-reference.md.
- A grep for "advisory is the default", "default is advisory", "defaults to advisory" and "default advisory" across the owned set found nothing.

## Deviations from Plan

None. The plan was executed as written. The line numbers matched the tree.

## Known Stubs

None.

## Self-Check: PASSED
