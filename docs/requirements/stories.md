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

## US-111 — Realm start-error debug and clean start

As an operator, I want Realm to start cleanly in the configured workspace from a fresh build, so that sandbox work begins with 0 start failures.

- Requirement IDs: START-01 (fresh-build start), START-02 (stale workspaceRoot diagnostic), START-03 (module-load absence).
- Plan IDs: per-phase ship steps on branch gsd/close-harn03-crash04-next (no separate plan IDs).
- Estimate: 5 points. Dependencies: none.

## US-112 — Optional Omp plugin toggle

As an operator, I want the Omp plugin to include a persisted toggle that defaults on and turns the plugin off with 1 setting, so that plugin presence stays fully under operator control.

- Requirement IDs: PLUG-01 (default-on registration), PLUG-02 (off-path silence), PLUG-03 (persisted choice).
- Plan IDs: per-phase ship steps on branch gsd/close-harn03-crash04-next (no separate plan IDs).
- Estimate: 5 points. Dependencies: none.

## US-113 — Realm UI merged into the additional UI

As an operator, I want the Realm status to render inside the additional UI region, so that it no longer occupies the under-bar status area while keeping 1 truthful state.

- Requirement IDs: UI-01 (additional-region render), UI-02 (truthful state across 4 states), UI-03 (off-path silence).
- Plan IDs: per-phase ship steps on branch gsd/close-harn03-crash04-next (no separate plan IDs).
- Estimate: 5 points. Dependencies: none.

## US-114 — Production-grade quality bar on the release line

As a maintainer, I want the 8 standard gates to pass on the 0.9.x release line, so that the release line carries 0 known gate failures.

- Requirement IDs: QUAL-01 (8 gates exit 0), QUAL-02 (CI green on 2 Node versions), QUAL-03 (0 dependency drift).
- Plan IDs: per-phase ship steps on branch gsd/close-harn03-crash04-next (no separate plan IDs).
- Estimate: 8 points. Dependencies: none.

## US-115 — Phase 55: Omp plugin health check

As an operator, I want the Realm health check to report a missing or broken Omp plugin with 1 named remedy per failing case, so that plugin faults are diagnosable without reading source.

- Requirement IDs: HEALTH-01, HEALTH-02.
- Plan IDs: Phase 55 (hermetic parts merged; live evidence pending).
- Estimate: 5 points. Dependencies: none.

## US-116 — Phase 56: F-51-1 dirty-stop cause

As an operator, I want the F-51-1 dirty stop cause recorded with 1 cause code per dirty stop, so that every dirty stop has a named reason.

- Requirement IDs: STOP-05, STOP-06.
- Plan IDs: Phase 56 (hermetic parts merged; live window human-blocking).
- Estimate: 8 points. Dependencies: none.

## US-117 — Phase 57: HTIER-01 attribution retest

As an operator, I want a Grok Build session to be attributed grok-build in the audit log, so that both-file writes carry 1 true host attribution.

- Requirement IDs: HTIER-01.
- Plan IDs: Phase 57 (live retest human-blocking).
- Estimate: 5 points. Dependencies: none.

## US-118 — Phase 58: KIMV-02 recorder fix and rerun

As a maintainer, I want the wire recorder to log before forwarding, so that every response the recorder sees is retained in the wire log.

- Requirement IDs: KIMV-02.
- Plan IDs: Phase 58 (hermetic fix merged; live rerun human-blocking).
- Estimate: 5 points. Dependencies: none.

## US-119 — Phase 59: concurrent binding behind ratification

As a maintainer, I want concurrent binding to land only after owner ratification of 53-DESIGN, so that 0 code lands before the recorded gate passes.

- Requirement IDs: CBIND-01, CBIND-02, CBIND-03.
- Plan IDs: Phase 59 (planning merged; code gated on ratification).
- Estimate: 8 points. Dependencies: none.

## US-120 — Notion and Linear tracking through Notion

As a maintainer, I want 1 Notion page and 1 Linear issue plus 1 sub-issue per plan linked for each v9.0 phase, so that phase state is tracked in one place.

- Requirement IDs: TRK-01 (1 page per phase), TRK-02 (1 issue per phase, deduplicated), TRK-03 (bidirectional links).
- Plan IDs: phases 55, 56, 57, 58, 59 (plan counts follow the phase record).
- Estimate: 3 points. Dependencies: none.

## US-121 — Green-CI pull request merge to main

As a maintainer, I want the change to merge to main through 1 pull request with 11 template checks green, so that main carries 0 unreviewed merges.

- Requirement IDs: SHIP-01 (11 template checks exit 0), SHIP-02 (5 of 5 Greptile, 0 open), SHIP-03 (1 squash merge, 0 version edits).
- Plan IDs: per-phase ship steps on branch gsd/close-harn03-crash04-next (no separate plan IDs).
- Estimate: 3 points. Dependencies: none.
## US-122 — Ultrathink W1: stale verdict retires on tracker completion

As an autonomous planner operator, I want a finished tracker to retire the stale incomplete verdict on its own, so that the completion signal always matches the settled plan state.

- Requirement IDs: UTR-01 (stale-verdict retirement on completion), UTR-02 (not_ready preserved at 1 pending row).
- Plan IDs: W1, graph n4 SPE-36513 (ordered plan n7 SPE-36516).
- Estimate: 5 points. Dependencies: none.

## US-123 — Ultrathink W2: proceed answer survives reload

As an operator, I want a proceed answer to survive a session reload, so that a reloaded session continues without asking settled questions again.

- Requirement IDs: UTR-03 (ANSWER persistence before kickoff), UTR-04 (reload recovery with 0 re-asks).
- Plan IDs: W2, graph n4 SPE-36513 (ordered plan n7 SPE-36516).
- Estimate: 5 points. Dependencies: none.

## US-124 — Ultrathink W3: incomplete notice advises and continues

As an autonomous planner operator, I want an incomplete-plan notice that advises and continues, so that work moves forward with autonomy intact while the warning stays visible.

- Requirement IDs: UTR-05 (advisory notice, 0 manual proceed steps), UTR-06 (warning stays visible).
- Plan IDs: W3, graph n4 SPE-36513 (ordered plan n7 SPE-36516).
- Estimate: 3 points. Dependencies: none.

## US-125 — Tb559-be resume: signing waiver for BE and FE commits

As a maintainer, I want commits 90b18ce and 0d5032f to carry 1 recorded signing waiver each, so that the signed-commit check reports 0 failures from missing signatures.

- Requirement IDs: SIGN-01 (waiver per commit, 0 keys provisioned).
- Plan IDs: Tb559-be resume, Tb559-fe.
- Estimate: 3 points. Dependencies: none.

## US-126 — Tb559-be resume: preserve think commit and split pull requests

As a maintainer, I want commit c53a15c preserved on 1 branch and pull request 259 to hold 1 commit only, so that each pull request shows 1 change set.

- Requirement IDs: SPLIT-01 (c53a15c preserved on 1 branch), SPLIT-02 (pull request 259 holds 1 commit).
- Plan IDs: Tb559-be resume, Tb559-fe.
- Estimate: 3 points. Dependencies: none.

## US-127 — Tb559-be resume: extend host suite to 119 of 119

As a maintainer, I want the host suite to hold 119 of 119 tests passing with the partial-plan test converted to 1 advisory expectation, so that the suite proves the advisory path with 0 failures.

- Requirement IDs: TEST-01 (6th target file, line 454 conversion, fatal-path silence unchanged).
- Plan IDs: Tb559-be resume.
- Estimate: 5 points. Dependencies: none.

## US-128 — Tb559-be resume: gates, Linear, planning hashes, CAPT-09 record

As a maintainer, I want gate evidence, Linear updates, and hash checks to record 0 open gaps, so that the resume lands with 0 silent gaps.

- Requirement IDs: GATE-01 (named gate plans exit 0), LIN-01 (4 Linear issues updated), HASH-01 (2 planning hashes verified), CAPT-01 (CAPT-09 routed to A08).
- Plan IDs: Tb559-data, Tb559-fe, Tb559-be, Tb559-qa, Tb559-rev, Tb559-sec, build, rel, obs, docs.
- Estimate: 5 points. Dependencies: none.

## US-129 — SEC canary split in the boot-report test fixture

As a maintainer, I want the fake GitHub fixture in the boot report test to be assembled from 2 parts with 0 literal fixture strings, so that the scanner reports 0 secrets while the refusal tests keep passing.

- Requirement IDs: SECSPLIT-01 (fixture split into 2 concatenated parts at 1 test location), SECSPLIT-02 (scanner reports 0 literal fixture occurrences and the refusal tests report 0 echoes).
- Plan IDs: cffd9419 step 1, branch swarm/Tb559r-capt09.
- Estimate: 3 points. Dependencies: none.

## US-130 — Conditional merge of pull request 256

As a maintainer, I want pull request 256 to merge to main with local and CI green recorded and 0 fake review verdicts, so that main carries 1 docs change with 1 honest review record.

- Requirement IDs: MERGE256-01 (local gates and CI green recorded before merge), MERGE256-02 (1 merge to main 354f00a line through the ship flow with Greptile absence recorded and 0 fake 5 of 5 claims).
- Plan IDs: cffd9419 steps 2 and 3, branch swarm/Tb559r-capt09.
- Estimate: 3 points. Dependencies: none.

## US-131 — Round 3 gates, W3 matrix and Linear close-out

As a maintainer, I want round 3 gates and the W3 matrix to pass on the merged main tree, so that the resumed swarm task closes with 1 evidence trail and 4 closed Linear sub-issues.

- Requirement IDs: R3-01 (3 round 3 gates plus build, rel, obs, docs exit 0), W3M-01 (9 of 9 W3 checks green on the ultrathink stack), HASH-02 (2 planning hashes verified with 0 edits), LIN-02 (4 sub-issues closed only with passing gates), REP-01 (1 final report naming 2 ultrathink pull request states).
- Plan IDs: cffd9419 steps 4 and 5.
- Estimate: 5 points. Dependencies: none.
## US-132 — Measured quality baseline for the current branch

As a maintainer, I want a measured quality baseline recorded for the current branch, so that every quality claim traces to 1 gate result.

- Requirement IDs: QUALB-01 (8 gate exit codes recorded), QUALB-02 (3 coverage floors measured), QUALB-03 (audit exit plus dependency count recorded).
- Plan IDs: T5471 quality baseline (no separate plan IDs).
- Estimate: 5 points. Dependencies: none.

## US-133 — Programming-pattern ratchet with zero gate regressions

As a maintainer, I want programming patterns ratcheted to the recorded bar with 0 gate regressions, so that the codebase stays maintainable across releases.

- Requirement IDs: RATCHET-01 (0 suppression comments, 0 silent catches beyond 10 named exceptions), RATCHET-02 (8 of 8 gates exit 0 vs baseline), RATCHET-03 (0 modules over size ratchet).
- Plan IDs: T5471 quality ratchet (no separate plan IDs).
- Estimate: 8 points. Dependencies: none.

## US-134 — Linear blocker continuation with zero silent gaps

As a maintainer, I want every open Linear issue and sub-issue marked done with evidence or blocked with a named cause, so that programming continues with 0 silent gaps.

- Requirement IDs: LINB-01 (every open item carries 1 recorded state), LINB-02 (0 duplicate phase titles), LINB-03 (every blocked item names 1 cause, 1 owner action, 1 next step).
- Plan IDs: T5471 Linear continuation (no separate plan IDs).
- Estimate: 8 points. Dependencies: none.

## US-135 — Gate enforcement per risk class on the current branch

As a maintainer, I want review, quality, security and release gates enforced on the current branch, so that a release lands only on 4 green gate verdicts.

- Requirement IDs: GATEE-01 (4 of 4 gate verdicts present, most-restrictive wins), GATEE-02 (0 releases land on a red verdict), GATEE-03 (100% traceability for US-132 to US-135).
- Plan IDs: T5471 gate enforcement (no separate plan IDs).
- Estimate: 5 points. Dependencies: none.
