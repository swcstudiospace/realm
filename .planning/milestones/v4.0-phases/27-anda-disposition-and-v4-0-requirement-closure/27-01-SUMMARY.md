---
phase: 27-anda-disposition-and-v4-0-requirement-closure
plan: "01"
subsystem: decision-record
tags: [anda, decision-record, supersession, owner-decision, docs]
requires: []
provides:
  - "docs/integration/runtime-decision.md ends with the section 'Anda bridge removal (Phase 27, ANDAX-01, 2026-11-17)': D-27-01 to D-27-05 as owner decisions, a supersession table, what stays, the catalogue and state-machine statement, and the accepted residuals R-27-01 and R-27-02; recorded before any code is removed"
  - "The open-question rows OQ-P3-09 and OQ-P3-10 read 'Closed: superseded by removal (D-27-01, 2026-11-17)' and OQ-P3-11 reads 'Closed: moot, not resolved (D-27-01, 2026-11-17)', each keeping its old status as history; the S-08 Anda bullet carries a dated superseded marker"
  - "docs/integration/anda-decision.md opens with a superseded banner and a disposition table; the Phase 3 sections stay as history"
  - "docs/integration/anda-replacement-research.md has its status line changed to 'adopted on 2026-11-17 as the rationale of D-27-01' and a section 10 with the owner's answers to the five questions of its section 9"
  - "AGENTS.md: the settled Anda bullet rewritten to the removal decision (D-27-01, Phase 28 executes, MCP over stdio stays, F4 window wording)"
  - "27-DISPOSITIONS.md Part A: 12 rows covering ANDA-01 to ANDA-04, OQ-P3-09 to OQ-P3-11, the four open Phase 3 re-verification items, the PRD-DRV-01 pairing notes, the stale out-of-scope line, the QUAL-01 exceptions and the superseded Phase 3 decisions"
affects: [docs/integration/runtime-decision.md, docs/integration/anda-decision.md, docs/integration/anda-replacement-research.md, AGENTS.md, .planning/phases/27-anda-disposition-and-v4-0-requirement-closure/27-DISPOSITIONS.md]
key-files:
  created:
    - .planning/phases/27-anda-disposition-and-v4-0-requirement-closure/27-DISPOSITIONS.md
  modified:
    - docs/integration/runtime-decision.md
    - docs/integration/anda-decision.md
    - docs/integration/anda-replacement-research.md
    - AGENTS.md
decisions:
  - "D-27-01 (owner, 2026-11-17): drop the Anda bridge entirely as a breaking change, with no replacement and no compatibility shim; Phase 28 executes the removal"
  - "D-27-02 (owner): MCP over stdio stays the connection mechanism; P5-D1 survives in its first half only (Anda may consume Realm as an MCP client; Realm never dials Anda)"
  - "D-27-03 (owner): a capability-token spike is included (Phase 30); production code only if the recorded decision is build"
  - "D-27-04 (owner): local single-user only; no remote or multi-user Realm in v4.0"
  - "D-27-05 (owner): release line 0.4.x with a breaking-change commit subject so the 0.4.0 notes show it"
  - "The decision is recorded in the repository before the code change (decision first, removal in Phase 28); no file under src or test changes in this plan"
  - "OQ-P3-11 (licence conflict) is closed as moot, not resolved: no legal determination is made"
requirements: [ANDAX-01]
metrics:
  tasks: 4
  completed: 2026-11-17
status: merged
---

# Phase 27 Plan 01: Record the Anda removal decision and disposition every Anda item Summary

Merged to main in PR 133 (squash `4f136dc`, plans 27-01 and 27-02 together; documentation and planning records only). After this plan the repository records, in the place the rest of the docs point at, that the Anda bridge is removed (D-27-01 to D-27-05), the two Anda decision notes say so at the top, and every open Anda requirement, question and verification item has a status label and cited evidence.

## What shipped

- `docs/integration/runtime-decision.md`: the tail section "Anda bridge removal (Phase 27, ANDAX-01, 2026-11-17)" with D-27-01 to D-27-05, the supersession table (including the product-spec passages that name the bridge, `ANDA_ENGINE_BRIDGE` and `degraded`, left unedited by default, OQ-27-02), what stays (`src/core/backoff.ts` and `src/core/timeout.ts`, the doctor's other items, the status label `active`), the statement that Phase 28 removes `ANDA_UNREACHABLE`, `ANDA_VERSION_MISMATCH` and `degraded`, and the accepted residuals R-27-01 (no way to show that no outside operator has an `andaUrl` set) and R-27-02 (the spec still names the bridge). The three open-question rows and the S-08 Anda bullet carry the dated supersession text.
- `docs/integration/anda-decision.md`: a superseded banner and a disposition table above the Phase 3 sections, which are history. The file says the `src/anda` module still exists until Phase 28.
- `docs/integration/anda-replacement-research.md`: adopted as the rationale (status line) and section 10 (owner decisions mapped to the five questions of section 9). The evidence text and read dates are not changed.
- `AGENTS.md`: the settled bullet that said Realm reaches Anda over HTTP now names the removal, D-27-01, the recording section, the Phase 28 execution and that MCP over stdio stays (D-27-02).
- `.planning/phases/27-anda-disposition-and-v4-0-requirement-closure/27-DISPOSITIONS.md` Part A: twelve disposition rows using only the 27-CONTEXT D-27-07 labels (Dropped, Closed: superseded by removal, Closed: moot not resolved, plus hand-offs to Phase 28).

## Observed

- Read of `origin/main` at `4f136dc` on 2026-11-17: the section "Anda bridge removal" exists in `docs/integration/runtime-decision.md` with D-27-01 to D-27-05; the OQ-P3-09, OQ-P3-10 and OQ-P3-11 rows carry the Closed text; the S-08 line carries the superseded marker; `anda-decision.md` opens with `Status: superseded on 2026-11-17`; the research note's status line says adopted and it has `## 10. Owner decisions (2026-11-17)`; the settled `AGENTS.md` bullet cites D-27-01.
- Every repository path cited in `27-DISPOSITIONS.md` as a full path exists (existence check made by the closer against the tree).
- CI on PR 133 passed: Verify on Node 22.x and 24.x, the docs site and the audit.

## Not verified here

- The wording of the decision rests on the owner's statements of 2026-11-17 as recorded in the milestone start; the closer did not hear them and did not re-ask. Nothing in the decision was run.
- Whether the docs gates (`check:docs`, `agents-sync`) passed locally on the head was not re-run by the closer; the claim rests on CI of PR 133.
- The `src/anda` module and `test/anda` tests still exist in the tree (`client.ts`, `shape.ts`; the handshake, listener-diagnostic, no-shim and reconnect tests). `AGENTS.md` says the bridge is removed and carries a transitional note; that is deliberate until Phase 28 merges, and the Project paragraph and the Layout bullet of `AGENTS.md` still describe `anda/`.
- Open owner questions at their defaults, not answered: OQ-27-02 (no edit of `docs/specs/realm-spec.xml`; the divergence is recorded as R-27-02) and OQ-27-03 (FS-02 text carried unchanged). No legal determination was made for the Anda licence conflict (OQ-P3-11 is closed as moot).

## Deviations from plan

- None found in the merged files. The plan listed "no other planning record changes"; the orchestrator updated `REQUIREMENTS.md` and `PROJECT.md` in the same pull request through the Part C hand-off of plan 27-02 (see its summary).
