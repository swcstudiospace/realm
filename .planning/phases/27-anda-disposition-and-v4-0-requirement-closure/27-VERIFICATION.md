---
phase: 27-anda-disposition-and-v4-0-requirement-closure
verified: 2026-11-17
verdict: passed
status: passed
score: "2/2 requirements covered (ANDAX-01, ANDAX-02); records and documentation only; the dispositions rest on repository files read on 2026-11-17 and on CI of PR 133, not on a build, test or live run by the verifier; 6 items outside the evidence reach, listed as behavior_unverified (PRD-DRV-01 stays Open)"
ref: "origin/main 4f136dc (PR 133 squash: plans 27-01 and 27-02)"
behavior_unverified: 6
overrides_applied: 0
covered_files:
  - ".planning/phases/27-anda-disposition-and-v4-0-requirement-closure/27-CONTEXT.md"
  - ".planning/phases/27-anda-disposition-and-v4-0-requirement-closure/27-01-PLAN.md"
  - ".planning/phases/27-anda-disposition-and-v4-0-requirement-closure/27-01-SUMMARY.md"
  - ".planning/phases/27-anda-disposition-and-v4-0-requirement-closure/27-02-PLAN.md"
  - ".planning/phases/27-anda-disposition-and-v4-0-requirement-closure/27-02-SUMMARY.md"
  - ".planning/phases/27-anda-disposition-and-v4-0-requirement-closure/27-DISPOSITIONS.md"
  - "docs/integration/runtime-decision.md"
  - "docs/integration/anda-decision.md"
  - "docs/integration/anda-replacement-research.md"
  - "docs/integration/omp.md"
  - "AGENTS.md"
  - ".planning/REQUIREMENTS.md"
  - ".planning/PROJECT.md"
  - ".planning/MILESTONE-CONTEXT.md"
  - "src/anda/client.ts"
  - "src/anda/shape.ts"
  - "src/fs/canonicalize.ts"
  - "src/runtime/driver/compute-driver.ts"
  - "test/anda/no-shim.test.ts"
  - "test/runtime/driver/driver-service.test.ts"
---

# Phase 27 Verification: Anda disposition and v4.0 requirement closure

Method: read-only read of the repository at `4f136dc` on 2026-11-17 (existence and content of the key files listed in `covered_files`, the Part A, Part B and Part C text of `27-DISPOSITIONS.md`, the tail section and open-question rows of `docs/integration/runtime-decision.md`, the banners of the two Anda notes, the `AGENTS.md` settled bullet, the four notes in `docs/integration/omp.md`, the traceability rows of `.planning/REQUIREMENTS.md` and the `.planning/PROJECT.md` carry paragraph), a check that every full repository path cited in `27-DISPOSITIONS.md` exists, and the CI result of PR 133 (Verify 22.x and 24.x, docs site, audit: green). The verifier did not run the build, lint, tests or the docs gates. Phase 27 changes no code: the PR 133 diff is eight files, all under `docs/`, `.planning/` or `AGENTS.md`.

Owner decisions of 2026-11-17 recorded in this phase: D-27-01 drop the Anda bridge entirely (breaking, no shim); D-27-02 MCP over stdio stays; D-27-03 a capability-token spike is included (Phase 30); D-27-04 local single-user only; D-27-05 release line 0.4.x with a breaking-change signal. They are recorded in `docs/integration/runtime-decision.md`, section "Anda bridge removal (Phase 27, ANDAX-01, 2026-11-17)".

## Requirements coverage

| Req | Statement | Status | Evidence |
| --- | --- | --- | --- |
| ANDAX-01 | Every Anda requirement and open question (ANDA-01 to ANDA-04, OQ-P3-09 to OQ-P3-11, the PRD-DRV-01 carry notes) is dispositioned by a recorded owner decision of 2026-11-17: the bridge is removed and the replacement research is the rationale | SATISFIED as a record | `docs/integration/runtime-decision.md` (the tail section with D-27-01 to D-27-05; the OQ-P3-09 and OQ-P3-10 rows read "Closed: superseded by removal", OQ-P3-11 "Closed: moot, not resolved"; the S-08 Anda bullet carries the superseded marker); `docs/integration/anda-decision.md` (superseded banner and disposition table, Phase 3 sections kept as history); `docs/integration/anda-replacement-research.md` (status "adopted on 2026-11-17 as the rationale of D-27-01", section 10 with the owner's answers); `27-DISPOSITIONS.md` Part A (12 rows, each with a D-27-07 label and cited evidence); `AGENTS.md` (the settled bullet cites D-27-01 and the section) |
| ANDAX-02 | The v2.0 carry list is reconciled: FS-02, OMP-05, PRD-DRV-01 and UI-01 have an evidence-cited disposition (complete, accepted limitation, or still open with a reason) | SATISFIED as a record, with one item Open by design | `27-DISPOSITIONS.md` Part B: FS-02 Accepted limitation, OMP-05 Complete, UI-01 Accepted limitation, PRD-DRV-01 Open (owner confirmation OQ-27-01 pending); `docs/integration/omp.md` (four dated supersession notes; historical sentences kept); `.planning/REQUIREMENTS.md` (traceability rows and the Carried from v2.0 list updated; ANDA-01 to ANDA-04 Dropped); `.planning/PROJECT.md` (carry paragraph and the dropped Anda bullet) |

"Satisfied as a record" means the disposition exists with its evidence and the labels are no stronger than that evidence. It does not mean the underlying behavior was run: ANDAX-02 allows an item to stay open with a stated reason, and PRD-DRV-01 does.

## Key facts checked

- Part A has twelve rows (ANDA-01 to ANDA-04; OQ-P3-09, OQ-P3-10, OQ-P3-11; the Phase 3 re-verification items 9, 10, 11 and 18; the PRD-DRV-01 pairing notes; the stale out-of-scope line; the QUAL-01 exceptions; the superseded Phase 3 decisions). The cited `src` and `test` files (`src/anda/client.ts`, `src/anda/shape.ts`, `test/anda/no-shim.test.ts`, `src/lifecycle/controller.ts`) exist.
- Part B has exactly one row each for FS-02, OMP-05, UI-01 and PRD-DRV-01. FS-02 is not upgraded (requirement text unmet; owner-confirmed approximation of 2026-10-23); PRD-DRV-01 is not closed.
- The `AGENTS.md` settled bullet no longer says Realm reaches Anda over HTTP. The Layout bullet still lists `anda/` (line 73) and is Phase 28's to change (D-27-06, D-27-09); the bullet carries the transitional note that the module `src/anda` remains until Phase 28 merges.
- Part C records the exact edits for `REQUIREMENTS.md`, `PROJECT.md`, `ROADMAP.md` and `STATE.md`. `REQUIREMENTS.md` and `PROJECT.md` carry them; the `ROADMAP.md` Phase 27 line and `STATE.md` were not in the PR 133 diff.
- The OQ rows, banners and notes are additive: the Phase 3 sections of `anda-decision.md` and the archived milestone files are not edited.

## behavior_unverified

1. **PRD-DRV-01 is not closed.** The amended wording (socket directory 0700, socket 0600; GetCapabilities, ValidateSandboxCreate, CreateSandbox, GetSandbox, ListSandboxes, DeleteSandbox, WatchSandboxes and EnsureWorkspace served; AuthenticateSandbox not advertised and UNIMPLEMENTED; DeleteWorkspace refuses) awaits the owner's confirmation (OQ-27-01). The code and test names were read, not run. Not to be claimed Complete until the owner confirms.
2. **The decision rests on a recorded owner statement.** D-27-01 to D-27-05 were read from the planning records and the decision section; the verifier did not hear the owner and nothing in the decision was run.
3. **The Anda code still exists.** `src/anda/client.ts`, `src/anda/shape.ts` and the `test/anda` tests (handshake, listener-diagnostic, no-shim, reconnect) are in the tree on `4f136dc`; the `andaUrl` key, the `ANDA_` codes, the `anda-bridge` doctor check and the `degraded` state are still live code. `AGENTS.md` says the bridge is removed with a transitional note. Their removal (ANDAX-03 to ANDAX-05) is Phase 28 and is not claimed here.
4. **OQ-27-02 and OQ-27-03 stay at their defaults.** No edit of `docs/specs/realm-spec.xml` (the spec still names the Anda layering, `ANDA_ENGINE_BRIDGE` and the `degraded` state; recorded as R-27-02); FS-02's text is carried unchanged rather than reworded. Neither is answered by the owner.
5. **Stale wording remains in `MILESTONE-CONTEXT.md`.** Its out-of-scope sentence still reads "ANDA-01 to ANDA-04 (engine licence)". Part A marks the line stale; no file of the pull request changes `MILESTONE-CONTEXT.md`.
6. **The verifier's own checks.** The docs gates (`check:docs`, `agents-sync`, `host-paths`) were not re-run for this report; they rest on CI of PR 133. OMP-05's guard run, UI-01's timing and FS-02's descriptor-relative open were not re-run; those rows rest on earlier recorded evidence (Phase 12 verification, the 2026-10-28 measurement, the owner decision of 2026-10-23).

Deferred, not unverified: the removal of the bridge code, the codes, the `degraded` state, the doctor check and the tests (Phase 28); the capability-token spike (Phase 30); boot rehearsals (Phase 31).

## Residuals (not verdict-blocking)

- **R1: planning bookkeeping.** `.planning/REQUIREMENTS.md` still shows ANDAX-01 and ANDAX-02 unchecked and Planned in its traceability table, `ROADMAP.md` shows the Phase 27 checkbox open and `STATE.md` has not recorded D-27-01 to D-27-05 or the open questions OQ-27-01 and OQ-27-02. Part C items 4, 7 and 8 assign these to the orchestrator, through GSD commands, after this verification.
- **R2: R-27-01 and R-27-02 stand.** The repository cannot show that no operator outside the audited hosts has an `andaUrl` configured (the mitigation is Phase 28's refusal message and the release note), and the product spec still names the bridge until the owner directs an edit.
- **R3: QUAL-01 exceptions (a) and (b)** still name `src/anda/client.ts`; Phase 28 removes them with the file.
- **R4: licence.** OQ-P3-11 is closed as moot with no legal determination; it reopens only if a later decision vendors Anda code.

## Verdict

passed: the decision record, the two superseded notes, the adopted research note, the `AGENTS.md` bullet, the 12-row Part A, the 4-row Part B, the `omp.md` notes and the REQUIREMENTS and PROJECT carry edits exist on `main` at `4f136dc`, every cited full path exists, and CI on PR 133 passed. Nothing in the phase is FAILED. The six items above are not proven and must not be claimed beyond what is stated; in particular PRD-DRV-01 is Open and the Anda code is still present until Phase 28.
