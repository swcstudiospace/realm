# Phase 45 plan 45-04: resolution of OMPR-01, OMPR-06 and OI-11 — VOID (calibration)

Outcome of the window: **VOID (calibration)**. Three calibration controls
ran and all three were refused by rule V0 ("child scope could not be
verified"); zero controls were mechanically complete, so
`deriveBounds` is underivable and the verdict window was not run. Full
record: `45-MEASUREMENT.md` in this phase directory.

## status by the table of 45-CONTEXT D-45-12 (VOID row)

- OMPR-01: **carried**. No verdict exists, so the responsiveness question is
  unanswered; the VOID says nothing for or against the product.
- OMPR-06: **carried**. The paired comparison is VOID as well (zero valid
  pairs; the paired rule needs five), so the before/after change has no
  effect claim from this plan either.
- OI-11: **carried** (ledger line appended to
  `.planning/milestones/v5.0-phases/36-live-re-verification-of-v1-0-open-items/36-DISPOSITIONS.md`,
  Part C). The UI-01 evidence cell in `docs/integration/omp.md` cites the
  measurement paragraph; the status word stays the owner's call.

No row closes on VOID or on the hermetic probe alone. The stall probe of
plan 45-02 and the harness of plan 45-03 remain instruments, not evidence
for this outcome.

## The one finding this plan does make

The calibration produced a design finding, not a verdict: the shipped scope
verification (`verifyScopedChild`, plan 45-03) accepts only scope names of
the form `run-p<pid>-i<id>.scope`, while this host's user manager names
transient scopes `run-<32 hex>.scope`. Every scoped run is therefore
refused before its first probe. Any repeat of this window needs that harness
fix first; the fix is a harness-rule change and belongs to a replan, since
plan 45-04 forbids editing a harness rule. The frozen rule and the
calibration constants remain unset until a re-measured calibration freezes
them.

## The owner's options on VOID (no choice made here)

- (a) Retire OMPR-01 and OI-11 with a recorded reason: the host cannot yield
  a valid measurement (at present, deterministically, because of the scope
  name mismatch). Cost: the UI-01 detail of `docs/integration/omp.md` stays
  undemonstrated and the hermetic probe plus attribution remain the
  permanent instruments. What it would show: nothing new, by decision.
- (b) Repeat under the same frozen rule at a different time, as the realm
  account, with an evidence directory outside the repository. Cost: the
  harness fix plus another calibration window (~1 hour for the controls
  alone). What it would show: whether the scoped validity bounds can be
  derived on this host at all, and then a real verdict.
- (c) Repeat after the owner approves the root-assisted isolation (OD-45-1
  is approved in the frozen design; the default tier remains Branch S).
  Cost: a root-run preparation step per window and slower work for other
  users during the window. What it would show: the same verdict, under a
  `loaded, scoped` tier that is closer to isolated; it does not fix the
  scope-name refusal, which the harness fix must do first.
- (d) Ask other users to pause heavy work for the window (OD-45-3). Cost:
  coordination with other users. What it would show: the same verdict under
  lower contention; it likewise does not fix the scope-name refusal.

## Words for ROADMAP and REQUIREMENTS (text only, not edited here)

- Plan 45-04 is complete with outcome VOID (calibration). The plan lines for
  OMPV-04, OMPV-05 and OMPV-06 are ticked as executed; the progress row of
  the milestone is not updated by this plan (no ROADMAP edit here).
- OMPV-04: executed, derivation underivable (0 of 0 valid controls; three
  attempts refused V0). OMPV-05: executed to the VOID gate (verdict window
  not run). OMPV-06: resolution recorded here; OMPR-01, OMPR-06 and OI-11
  stay carried. No REQUIREMENTS row is edited by this plan.

Task 8 (the conditional fix) did not apply: there is no FINDING (no verdict
window ran, no cause exists), so no extension fix is claimed or attempted.
