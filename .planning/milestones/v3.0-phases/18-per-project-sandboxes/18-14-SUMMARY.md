---
phase: 18-per-project-sandboxes
plan: 14
subsystem: live-verification
tags: [live, checkpoint, production-suite, multi-project, sandboxes]
requires: ["18-12", "18-13"]
provides:
  - "Live production suite on commit 4ad91be: 37 tests, 37 pass, 0 fail, 0 skipped, including the two-project scenario"
  - "Host restored after the run: 0 containers, 0 sandboxes, empty workspace"
affects: [.planning/phases/18-per-project-sandboxes/18-SUMMARY.md, .planning/REQUIREMENTS.md]
key-files:
  created:
    - .planning/phases/18-per-project-sandboxes/18-14-SUMMARY.md
  modified: []
decisions:
  - "The plan's checkpoint was run as an owner-approved live window on 2026-11-15, not by a subagent; this summary records the outcome and marks each plan step by what the cited evidence shows"
  - "Steps the audit facts do not record (individual realm up/status/mount checks, derived session ids, account name, mount sources) are NOT VERIFIED here, not inferred from the suite result"
requirements: [MULTI-04, MULTI-05]
metrics:
  tasks: 1
  commits: 0
  completed: 2026-11-15
plan_head_before: 4ad91be
commits: 0
status: approved-partial-evidence
actuals:
  tokens: 0
  tasks: 1
  commits: 0
---

# Phase 18 Plan 14: live checkpoint for the per-project runtime (MULTI-04, MULTI-05) Summary

The owner-approved live run on commit 4ad91be passed the production live suite (37 of 37, including the two-project scenario) and left the host restored. The plan's individual CLI steps and evidence fields are only partly recorded; the rest is marked NOT VERIFIED below.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | human-verify checkpoint: live run on the commit under test | none | none (evidence held in the handoff, not committed) |

## What was verified

- Commit under test: `4ad91be` exists on the worktree HEAD (`test(daemon): key the MULTI-03 leftover registry entry by its workspace (phase 18 gap fix)`). Verified by `git show`.
- Scenario gate: `test/integration/production-driver.test.ts:1072` is the "production live: two projects" test; it is gated by `skip: gate`. The 37-pass result with 0 skipped shows the gate was open for this run. The test asserts the two session ids differ (line 1116) and that down of one leaves the other active (test title).
- Helper derivation: `test/support/production-live.ts:429-433` derives each project's session id and sandbox name through the daemon's `sessionIdOfWorkspace` and `sandboxNameOfSession`.
- Live result (audit facts, evidence file `<home>/realm-evidence/phase14/14-live-main4-4ad91be.txt`): 37 tests, 37 pass, 0 fail, 0 skipped. Two-project scenario ok.
- Residue (audit facts): after the run, host restored, 0 containers, 0 sandboxes, empty workspace.
- Failures: none recorded, so no catalogue code applies and no failing plan needs re-running.

## NOT VERIFIED

- Precondition 1 (Phase 17 plan 05 met, or owner decision to run Phase 18 alone): the audit records owner approval on 2026-11-15 but not which option the owner chose.
- Precondition 2 (parent verification of the commit: typecheck, lint, unit tests of plans 02 to 11, docs checker): not in the audit facts; this summary does not claim it.
- Precondition 3 (`realmlive` stack: rootless Podman 5.x, gateway and compute driver units, `config.json` with `workspaceRoot` and matching policy `workspaceRoots`): not recorded in the audit facts.
- Precondition 4 (shared live lock taken, no other live run): not recorded.
- Plan step 1 (two `marker.txt` project directories), steps 2 and 3 (`realm up` and `realm status` per project, exit 0, `active`, `p` plus 12 hex session ids): not recorded as separate observations.
- Plan step 4 (sandboxes `realm-<idA>` and `realm-<idB>` each with one `/workspace` mount from its own project directory): not recorded.
- Plan step 6 (`realm down` of A leaves B `active` and B's marker readable) and step 7 (`realm down` of B leaves no residue): the scenario's own assertions cover the first, and the post-run host state covers the second, but the standalone CLI observations are not recorded.
- Evidence fields: account name, the two derived session ids and the observed mount sources are not in the audit facts. The commit hash and the scenario result line are recorded.

## Deviations from Plan

**1. [Plan vs record] The plan's steps are not all recorded individually**
- The plan lists seven CLI and inspection steps plus the scenario. The audit facts record only the suite result and the post-run host state. The unrecorded steps are marked NOT VERIFIED above rather than assumed from the suite.

**2. [Plan vs record] The evidence file sits under a `phase14` directory**
- The path is `<home>/realm-evidence/phase14/14-live-main4-4ad91be.txt`. The file name carries the commit; the directory name is as recorded in the audit and is not changed here.

**Total deviations:** 2, both record-completeness notes.

## Consequences of the outcome

- The plan's resume signal is `approved` with the evidence named in the plan. The owner approved on 2026-11-15, and the audit records the suite result that the plan names as the scenario result. The parent should move MULTI-04 and MULTI-05 to implemented-verified only after it confirms the NOT VERIFIED evidence fields (account, session ids, mount sources) against the evidence file.
- No file was edited by this plan. Documentation of the outcome is a parent step.

## Issues Encountered

None recorded.

## Known Stubs

None.

## Threat Flags

None. The summary gives no mount source paths and no secret values; host paths are shown only as `<home>` placeholders.

## Next Phase Readiness

The live evidence for the per-project runtime exists for commit 4ad91be. Phase 18's parent verification (`18-SUMMARY.md`, `18-VERIFICATION.md`) should cite this summary for MULTI-04 and MULTI-05, and list the NOT VERIFIED items above as open until they are recorded.

---
*Phase: 18-per-project-sandboxes*
*Completed: 2026-11-15*
