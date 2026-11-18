---
phase: 28-remove-the-anda-bridge
plan: "03"
subsystem: anda-removal-docs
tags: [docs, anda, breaking-change, release-note, policy-reference, supersession]
requires: ["28-01", "28-02"]
provides:
  - "docs/integration/anda.md is deleted; docs/integration/anda-decision.md is a short superseded tombstone that names what was removed (the bridge, the andaUrl key, the two error codes, the degraded state and display.degraded, the anda-bridge doctor item, the anda.listener_failed log event), points to anda-replacement-research.md for the rationale and to tag v0.3.54 for the old files, and states that Realm never dials an Anda engine while Anda can still launch realm mcp"
  - "docs/policy-reference.md: the bridge and degraded rows are gone and a Retired keys paragraph quotes the migration sentence that RETIRED_KEYS holds, with the instruction to delete the key and the statement that nothing replaces it"
  - "README.md, AGENTS.md and the integration documents (acp, omp, openshell, hardening-plan, host-binaries, host-plugin-contract, omp-lifecycle-runbook, runtime-decision) and docs/checkpoint.md no longer describe the removed surface as current"
  - "The breaking-change note: the commit subjects carry the bang marker (feat(anda)!, feat(core)!, docs(anda)!) and the PR 138 body carries the release note and the config migration note"
affects: [docs/integration/anda.md, docs/integration/anda-decision.md, docs/policy-reference.md, README.md, AGENTS.md, docs/integration/runtime-decision.md]
key-files:
  created: []
  modified:
    - docs/integration/anda-decision.md
    - docs/policy-reference.md
    - README.md
    - AGENTS.md
    - docs/integration/acp.md
    - docs/integration/omp.md
    - docs/integration/openshell.md
    - docs/integration/runtime-decision.md
  deleted:
    - docs/integration/anda.md
decisions:
  - "D-28-08: delete the sourced note anda.md, supersede the decision note as a tombstone, mark dated receipts instead of rewriting them"
  - "D-28-09: the breaking-change note is the commit subjects plus the pull request body; no CHANGELOG or version edit by the PR (the release commit v0.4.3 generated its CHANGELOG entry, which lists the PR commit subjects with the bang marker)"
  - "D-28-10 and OQ-28-01: docs/specs/realm-spec.xml is not edited (the default of Phase 27's OQ-27-02); it still describes Anda"
  - "docs/integration/anda-replacement-research.md is not edited (Phase 27 owns it)"
requirements: [ANDAX-04, ANDAX-05]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Phase 28 Plan 03: Documents, closure checks and the breaking-change note Summary

Merged to main in PR 138 (merge commit `b7fc985`). This plan is the commit `8827afd` "docs(anda)!: retire the Anda documents, document the andaUrl and degraded-state removal (ANDAX-04, ANDAX-05)": 14 files changed, 41 insertions, 237 deletions. The whole PR is 101 files, 575 insertions, 3889 deletions. The release `v0.4.3` followed on main (`29d2f2f`); `v0.4.2` (`07c523d`) is the release commit that was already on main when the merge commit was made.

## What was done

- Task 1: `docs/integration/anda.md` deleted; `docs/integration/anda-decision.md` reduced to the superseded tombstone; `docs/policy-reference.md` lost the bridge and degraded rows and gained the Retired keys paragraph (config section, line 312 at the read); README, AGENTS.md, and the integration and checkpoint documents listed above were brought in line.
- Task 2: closure searches, the built-CLI smoke run and the gate set were run by the orchestrator on the PR head; the closure search output is not stored in the repository.
- Task 3: the pull request carried the breaking-change note. The PR title and body as submitted are in GitHub, not in the repository, and the closer did not read them.

## Observed

- Read of `origin/main` on 2026-11-17: `docs/integration/anda.md` does not exist; `docs/integration/anda-decision.md` opens "Anda decision note (superseded)" with the removed-items list above; `docs/policy-reference.md` holds the Retired keys paragraph with the sentence "andaUrl was removed in the 0.4 release line, with the Anda bridge: delete it from config.json", equal to the sentence in `src/runtime/config.ts`.
- Documents that still mention Anda on `origin/main`: `docs/integration/anda-replacement-research.md` (the rationale), `docs/integration/runtime-decision.md` (the Phase 27 decision record and the history rows), `docs/integration/mcp.md`, `docs/integration/hosts.md`, `docs/integration/project-session-contract.md`, `docs/integration/podman.md`, `docs/integration/hardening-plan.md`, `docs/integration/host-binaries.md`, `docs/integration/acp.md`, `docs/integration/omp.md`, `docs/integration/openshell.md`, `README.md`, `AGENTS.md` and `docs/specs/realm-spec.xml` (52 matches, unedited by decision). The closer did not classify each remaining mention as history, "Anda as an MCP client" or stale.
- The orchestrator ran the built CLI smoke on the PR head: with `andaUrl` in `config.json`, `realm status` exited 2 with the sentence and `realm doctor` printed it; without the key `status` worked. The evidence is not stored in the repository.
- CI on PR 138: the first run failed one export-usage gate; after commit `54b6b41` it was green (Verify on Node 22.x and 24.x, the docs site, the audit).

## Not verified here

- `npm run check:docs` and `npm run check:gates` were not run by the closer; the claim rests on CI of PR 138.
- The closure search output (the removed names in published documents) is not in the repository and was not repeated.
- `docs/specs/realm-spec.xml` still describes Anda (OQ-28-01, default no edit); the owner has not answered the question.
- The QUAL-01 silent-catch exceptions (a) and (b) in the requirement text, and the Anda rows of `.planning/PROJECT.md` (the opening description, the "bridge is removed in Phase 28" line, the Anda boundary row), still name the bridge. The orchestrator removes them in the closure pull request.
- The release note text lives in the PR body and in the generated `CHANGELOG.md`; the closer did not read the PR body.

## Deviations from plan

- The plan asked for two documentation commits, an optional fix commit, and a summary written in the PR; the PR carried one documents commit and the gate-data fix commit, and this summary was written afterwards by the closing step with the observations above.
