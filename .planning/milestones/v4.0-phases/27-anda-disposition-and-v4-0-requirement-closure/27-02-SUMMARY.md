---
phase: 27-anda-disposition-and-v4-0-requirement-closure
plan: "02"
subsystem: carry-list-reconciliation
tags: [carry-list, fs-02, omp-05, ui-01, prd-drv-01, omp-docs, requirements]
requires: ["27-01"]
provides:
  - "27-DISPOSITIONS.md Part B: exactly one row each for FS-02 (Accepted limitation), OMP-05 (Complete), UI-01 (Accepted limitation) and PRD-DRV-01 (Open, pending the owner's confirmation OQ-27-01), each with evidence tier and date, the residual and the lift condition"
  - "27-DISPOSITIONS.md Part C: the record edits for REQUIREMENTS, PROJECT, ROADMAP and STATE and the three open owner questions OQ-27-01 to OQ-27-03"
  - "docs/integration/omp.md: dated supersession notes at four anchors (the OMP-05 status note under the requirements table, the Limits sentence, the 'Closing OMP-05 live' status update, the Phase 12 re-verification update) with the historical sentences kept"
  - ".planning/REQUIREMENTS.md and .planning/PROJECT.md carried the dispositions: ANDA-01 to ANDA-04 read Dropped (owner decision D-27-01), the OMP-05 box is ticked, FS-02 and UI-01 read Accepted limitation, PRD-DRV-01 reads Open pending the owner's confirmation, and the stale Anda licence line is gone from the out-of-scope list"
affects: [.planning/phases/27-anda-disposition-and-v4-0-requirement-closure/27-DISPOSITIONS.md, docs/integration/omp.md, .planning/REQUIREMENTS.md, .planning/PROJECT.md]
key-files:
  created: []
  modified:
    - .planning/phases/27-anda-disposition-and-v4-0-requirement-closure/27-DISPOSITIONS.md
    - docs/integration/omp.md
    - .planning/REQUIREMENTS.md
    - .planning/PROJECT.md
decisions:
  - "FS-02 is not upgraded: the requirement text (descriptor-relative opens with no-follow semantics) is unmet; the owner-confirmed approximation of 2026-10-23 stands and the QR-07 property tests add confidence only (OQ-27-03 default: text carried unchanged)"
  - "OMP-05 is Complete on the scripted-provider basis (HARN-04, owner decision D2, 2026-10-30): Omp 18.12.6's own write tool through the Realm plugin, not an LLM-driven run; paths that do not load the plugin are outside the claim"
  - "UI-01 stays an accepted limitation (owner decision 2026-10-23; re-measured 2026-10-28 as a measurement, not a proof of non-blocking); no repeat measurement is planned"
  - "PRD-DRV-01 is not closed: code and tests match the amended wording, and the only open item is the owner's confirmation (OQ-27-01); on a yes the orchestrator records Complete"
  - "Record edits to REQUIREMENTS and PROJECT were made as a hand-off list (Part C) and carried in the same pull request; ROADMAP and STATE are not changed by it"
requirements: [ANDAX-02]
metrics:
  tasks: 3
  completed: 2026-11-17
status: merged
---

# Phase 27 Plan 02: Reconcile the v2.0 carry list and hand off the record edits Summary

Merged to main in PR 133 (squash `4f136dc`, together with plan 27-01; documentation and planning records only). After this plan nothing in the v2.0 carry list is pending by omission: each item is Complete, an Accepted limitation, or Open for a stated reason with a named owner question, and each label cites a file, a test or a verification row with a date and a tier.

## What shipped

- `27-DISPOSITIONS.md` Part B (four rows):
  - FS-02: Accepted limitation. Resolve-then-verify with `O_NOFOLLOW` in `src/fs/canonicalize.ts`; the descriptor-relative requirement text is unmet and is not claimed.
  - OMP-05: Complete. The "checkbox is stale" contradiction is resolved: the carried-list box is ticked and the stale sentences in `omp.md` are annotated.
  - UI-01: Accepted limitation. Owner decision 2026-10-23; the 2026-10-28 re-measurement bounds the stall and does not prove non-blocking.
  - PRD-DRV-01: Open. Amended wording (socket directory 0700 and socket 0600; seven RPCs plus EnsureWorkspace served; AuthenticateSandbox not advertised and UNIMPLEMENTED; DeleteWorkspace refuses) is read in `src/runtime/driver/compute-driver.ts` and `src/runtime/driver/server.ts` and pinned by tests in `test/runtime/driver/driver-service.test.ts`; the owner has not confirmed the amendment.
- `27-DISPOSITIONS.md` Part C: the exact edits for REQUIREMENTS, PROJECT, ROADMAP and STATE, and the open owner questions OQ-27-01 (PRD-DRV-01 confirmation), OQ-27-02 (spec XML edit, default no edit) and OQ-27-03 (FS-02 reword, default carried unchanged).
- `docs/integration/omp.md`: four additive dated notes (2026-11-17, Phase 27, ANDAX-02); every historical OMP-05 sentence is kept; the Anda sentences in the same file are untouched (Phase 28).
- `.planning/REQUIREMENTS.md` and `.planning/PROJECT.md`: the Part C edits for them were carried in the same pull request (traceability rows ANDA-01 to ANDA-04 Dropped, OMP-05 Complete, FS-02 and UI-01 Accepted limitation, PRD-DRV-01 Open; the Anda bridge bullet moved to a dropped note in PROJECT).

## Observed

- Read of `origin/main` at `4f136dc` on 2026-11-17: Part B and Part C exist in `27-DISPOSITIONS.md`; `omp.md` has the four notes (the OMP-05 status note under the requirements table, the superseded Limits sentence, the 'Closing OMP-05 live' status update and the Phase 12 re-verification update); `REQUIREMENTS.md` traceability lists ANDA-01 to ANDA-04 as Dropped, OMP-05 as Complete, PRD-DRV-01 as Open and FS-02 and UI-01 as Accepted limitation; the `PROJECT.md` Active bullet reads "Dropped 2026-11-17 (owner decision D-27-01)".
- The diff of PR 133 touches eight files, all under `docs/`, `.planning/` or `AGENTS.md`; no file under `src`, `test` or `scripts` is in it.
- CI on PR 133 passed (Verify 22.x and 24.x, docs site, audit).

## Not verified here

- Nothing about PRD-DRV-01's behavior was run for this record; the code and test names were read, not executed, and the owner's confirmation (OQ-27-01) is outstanding. The requirement is Open and stays Open.
- OMP-05's guard and UI-01's keystroke timing were not re-run; both rest on the earlier recorded runs (Phase 12 evidence; the 2026-10-28 measurement).
- FS-02's `openat`-style closure was not investigated; the claim that Node 22 and 24 offer no descriptor-relative open is an [INFERENCE] recorded in the Phase 27 context.
- ANDAX-01 and ANDAX-02 still read unchecked and Planned in `.planning/REQUIREMENTS.md`, and `ROADMAP.md` and `STATE.md` were not part of the pull request: they are closed by the orchestrator's GSD commands after this verification (Part C items 4, 7 and 8).
- `MILESTONE-CONTEXT.md` still carries the stale wording "ANDA-01 to ANDA-04 (engine licence)" in its out-of-scope sentence; it was not edited.

## Deviations from plan

- The plan said it edits none of `REQUIREMENTS.md`, `PROJECT.md`, `ROADMAP.md` or `STATE.md` and only lists them in Part C. The merged pull request also changed `REQUIREMENTS.md` and `PROJECT.md` (the Part C edits applied), leaving `ROADMAP.md` and `STATE.md` for the orchestrator. The two edits were made by the orchestrator, as the plan intended for the records, in the same pull request instead of a later one.
