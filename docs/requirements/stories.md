# User Stories — v3.0 Containment by Default (Outstanding Phases)

Backlog for phases 12, 13, 14, 16, 17, 18, 19, 20 and the milestone-close and ship-tracking stories. Lane execution order is an A01 scheduling constraint (Omp 12 → 16; runtime 14 → 17 → 18 → 19; pipeline 13 → 20). Each story is verifiable on its own acceptance criteria; scheduling order does not couple the stories.

## US-101 — Phase 12: scripted harness and enforcement spike

As an operator, I want one gated command that drives a local Omp through a scripted model provider with no credentials, so that I can observe how a model-issued file write behaves in each policy mode without a live model.

- Requirement IDs: HARN-01, HARN-02, HARN-03, HARN-04, OMPX-01, OMP-05 (closes via HARN-04 per D2).
- Plan IDs: 12-01-PLAN.md, 12-02-PLAN.md, 12-03-PLAN.md.
- Estimate: 8 points. Dependencies: none.

## US-102 — Phase 13: quality ratchet

As a maintainer, I want dependency, coverage, packaging and mutation checks that fail in CI, so that a regression in a security-relevant path is never shipped on a green signal alone.

- Requirement IDs: QR-01, QR-02, QR-03, QR-04, QR-05, QR-06, QR-07, QR-08.
- Plan IDs: 13-01-PLAN.md.
- Estimate: 8 points. Dependencies: none.

## US-103 — Phase 14: crash safety

As an operator, I want a killed daemon to leave no unrecorded debris and no silent sandbox loss, so that every admission line receives exactly one recorded outcome.

- Requirement IDs: CRASH-01, CRASH-02, CRASH-03, CRASH-04, CRASH-05, CRASH-06, CRASH-07.
- Plan IDs: 14-01-PLAN.md.
- Estimate: 8 points. Dependencies: none.

## US-104 — Phase 16: Omp runs in the sandbox

As a model author, I want file mutations and commands to execute through Realm tools inside the sandbox by default, so that a host write path is gone or refused when fail-closed needs the realm.

- Requirement IDs: OMPX-02, OMPX-03, OMPX-04, OMPX-05.
- Plan IDs: 16-01-PLAN.md, 16-02-PLAN.md, 16-03-PLAN.md, 16-04-PLAN.md.
- Estimate: 8 points. Dependencies: none.

## US-105 — Phase 17: observability and audit integrity

As an operator, I want structured logs, counters and a hash-chained audit log, so that I can tell a gateway loss from a runner crash and prove that no line was edited, deleted or reordered.

- Requirement IDs: OBS-01, OBS-02, OBS-03, OBS-04.
- Plan IDs: 17-01-PLAN.md, 17-02-PLAN.md, 17-03-PLAN.md, 17-04-PLAN.md, 17-05-PLAN.md.
- Estimate: 8 points. Dependencies: none.

## US-106 — Phase 18: per-project sandboxes

As a developer with two projects, I want one session, one sandbox, one audit file and one lock table per project workspace, so that taking one project down leaves the other active and no write leaks across projects.

- Requirement IDs: MULTI-01, MULTI-02, MULTI-03, MULTI-04, MULTI-05, MULTI-06.
- Plan IDs: 18-01-PLAN.md, 18-02-PLAN.md, 18-03-PLAN.md, 18-04-PLAN.md, 18-04b-PLAN.md, 18-05-PLAN.md, 18-06-PLAN.md, 18-07-PLAN.md, 18-08-PLAN.md, 18-09-PLAN.md, 18-10-PLAN.md, 18-11-PLAN.md, 18-12-PLAN.md, 18-13-PLAN.md, 18-14-PLAN.md.
- Estimate: 8 points. Dependencies: none.

## US-107 — Phase 19: resume and checkpoint

As an operator, I want a daemon restart to re-adopt a healthy sandbox and to restore a workspace from a snapshot, so that sandbox state and workspace content survive a crash without a second container.

- Requirement IDs: RES-01, RES-02, RES-03, RES-04, RES-05.
- Plan IDs: 19-01-PLAN.md.
- Estimate: 8 points. Dependencies: none.

## US-108 — Phase 20: release hardening

As a maintainer, I want a release built without privilege, attested for provenance and reversible by one workflow, so that a published artifact carries verifiable provenance and a withdrawn release stops serving as the documented version.

- Requirement IDs: REL-01, REL-02, REL-03, REL-04.
- Plan IDs: 20-01-PLAN.md, 20-02-PLAN.md, 20-03-PLAN.md.
- Estimate: 8 points. Dependencies: none.

## US-109 — Milestone audit, complete, cleanup

As a maintainer, I want a final audit that records every v3.0 requirement as satisfied, carried or superseded, so that closing the 0.3.x milestone leaves no silent gap.

- Requirement IDs: all 52 v3.0 IDs in the traceability matrix (HARN, QR, CRASH, ONB, DEF, OMPX, OBS, MULTI, RES, REL); Phase 15 IDs ONB-01..ONB-07 and DEF-01..DEF-02 are recorded as complete and are not re-verified here.
- Plan IDs: milestone audit, `milestone complete`, cleanup per the GSD workflow (no phase-plan IDs).
- Estimate: 5 points. Dependencies: none.

## US-110 — PR, ship and Linear tracking flow

As a maintainer, I want every phase to land through one gated pull-request flow with one Linear issue per phase, so that a merge is never made on a red check and no duplicate Linear issue exists for a phase.

- Requirement IDs: cross-cutting — gates typecheck, lint, test, build, check:docs, check:gates, check:pack, check:mcp; Greptile 5 of 5; CI green; protected-path human review; version and CHANGELOG ownership by the release job.
- Plan IDs: per-phase ship steps (no separate plan IDs).
- Estimate: 5 points. Dependencies: none.
