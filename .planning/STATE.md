---
gsd_state_version: "1.0"
current_phase: 7
current_phase_name: Policy Reference and Security Review
status: "milestone v1.0 provisional: not complete; gap closure applied and re-audited; open decisions block completion"
stopped_at: "Awaiting decisions: AgentOS path (RT-04, CLI-01); QUAL-01 literal rule versus 10 residual catch sites; containment default (security review); OMP-03 wording. Then ship, licence, CI, README, and archive approval"
last_updated: "2026-10-22"
last_activity: 2026-10-22
last_activity_desc: "Gap closure after the v1.0 audit: G-03 to G-08 and G-10 closed; G-04 reduced to 10 residual catch sites; G-09 open; full gates green at 1113 tests (1104 pass, 9 skipped)"
state_head: c55056a
progress:
  total_phases: 7
  completed_phases: 6
  total_plans: 40
  completed_plans: 40
  percent: 86
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-22)

**Core value:** Every file mutation by an agent either lands inside the realm under policy or fails closed, and the user can always see whether the realm is active or disconnected.
**Current focus:** Milestone v1.0 (provisional name). Open decisions: the AgentOS path, the QUAL-01 rule, and the containment default.

## Current Position

Phase: 7 (Policy Reference and Security Review), executed; verification human_needed and deferred
Plan: phases 1-7 executed. Closure, traceability, audit, and gap-closure waves are on main (see Recorded commits).
Status: Not complete. Open: RT-04 and CLI-01 (no AgentOS driver is bound; the spike recommends no-go as designed). QUAL-01 (10 catch sites still drop or replace errors; the requirement forbids silent catch blocks). Accepted approximations: FS-02, OMP-03. Live-gated items are deferred as human verification.
Last activity: 2026-10-22 - gap closure and re-audit; gates green

Progress: [████████▓░] 86%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: N/A
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: none yet
- Trend: N/A

*Updated after each plan completion*

## Accumulated Context

### Decisions

Full log lives in PROJECT.md Key Decisions table. Recent decisions affecting current work:

- [Roadmap]: Fixed 7-phase order; vertical slice (up, down, status, doctor on core and runtime) before plugin, MCP, and ACP
- [Roadmap]: Podman-gated integration tests skip with a stated reason while Podman is below 5.x; no packages installed or upgraded
- [Roadmap]: Policy defaults to advisory mode; fail-closed is opt-in per project
- [2026-10-22 user decision]: Continue without live validation; resume deferred live checks with /gsd:verify-work on a Podman 5.x host
- [2026-10-22 user decision]: Anda consumes Realm over MCP (Anda boundary resolved as MCP consumer)
- [2026-10-22 user decision]: S-08 launch layering confirmed
- [2026-10-22 user decision]: Enterprise-Ready means repo conventions only, with no named external regime
- [2026-10-22 user decision]: AgentOS: spike an in-sandbox runner first. Result: no-go as designed (docs/integration/agentos.md, "Spike result")
- [2026-10-22 user decision]: The daemon owns sessions. Surfaces attach by connecting and calling the idempotent up. There is no attach or detach protocol; the sandbox persists until realm down (docs/integration/runtime-decision.md, "Closure decisions")
- [2026-10-22 user decision]: Phase 3 live items are deferred as human verification, as Phases 4 to 7 are. The milestone name v1.0 is provisional; archive still needs approval
- [2026-10-22 default, not answered]: Scope is roadmap phases only; a codebase-wide typed-lint pass is a follow-up
- [2026-10-22 default, not answered]: No new test framework; a blocked item pauses the run
- [2026-10-22 gap closure]: MCP and ACP keep the RealmError code and message; `realm acp` is the production ACP entry (TOOL-05)
- [2026-10-22 gap closure]: One state-directory resolver, readHostRuntime, serves the CLI, the daemon, and the Omp entry (CLI-01, RT-06, OMP-01)
- [2026-10-22 gap closure]: The Omp status is one item, refreshed on a 2 s bounded interval, and every timer clears on shutdown. There is no tooltip API on this host (OMP-02, OMP-03)
- [2026-10-22 gap closure]: The controller rebinds through verifyPinnedAt, which checks dev and ino and the /proc/self/fd real path, not a string path (FS-02, partial)
- [2026-10-22 gap closure]: Catalogue has 27 codes; new are MCP_INPUT_FAILED and CLEANUP_FAILED
- [2026-10-22 pending decision]: QUAL-01 rule. Fix the 10 residual catch sites, or amend the requirement with a named exception list (audit G-04)
- [2026-10-22 pending decision]: Containment default. Advisory is the recorded default. The security review (section 5.3, section 8 item 2) recommends fail-closed for containment deployments
- [2026-10-22 pending decision]: OMP-03 wording. Accept one status item with no tooltip, or require a tooltip (no host API)

### Pending Todos

Follow-ups (not started): ensure-expiry reason text (TOOL_TIMEOUT reads as a tool queue timeout); a state-directory log file for detached daemon startup errors; a client-side reply size cap; the recursive mkdir ancestor mode; deterministic ordering seams for the lifecycle timing tests (widened to 1 to 4 s windows on this loaded host); the Omp status-refresh cost check on a real host.

### Blockers/Concerns

- AgentOS: no driver is bound. The spike recommends no-go as designed (docs/integration/agentos.md). RT-04 and CLI-01 stay open until the path is decided.
- QUAL-01: 10 catch sites still drop or replace errors (audit G-04). 7 are deliberate and 3 are undocumented. The decision is pending.
- Containment default: decision pending (security review section 5.3).
- Host Podman is 4.9.3, below OpenShell's 5.x requirement. Podman-gated checks are deferred.
- Omp host write and edit interception is not documented (OQ-P5-02). The guard blocks writes while the policy mode is unknown; the guard residuals (audit G-09) stay open.
- The repo has no declared licence (release gate). The Anda licence conflict still blocks vendoring Anda code.
- Ship: ship.autoMerge is on, and origin is github.com/swcstudiospace/realm. Ship needs explicit approval before any PR or merge.

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Deferred Verification

Live or pending verifications deferred by evidence, most recent first:

| Phase | State | Resume |
|-------|-------|--------|
| 3 | verification_deferred_human | /gsd:verify-work 3 |
| 4 | verification_deferred_human | /gsd:verify-work 4 |
| 5 | verification_deferred_human | /gsd:verify-work 5 |
| 6 | verification_deferred_human | /gsd:verify-work 6 |
| 7 | verification_deferred_human | /gsd:verify-work 7 |

Detail, by phase: Phase 3 covers RT-01, RT-02, RT-03, RT-04, RT-09, and the live parts of ANDA-02 and ANDA-03 (host Podman 4.9.3 is below 5.x). Phase 4 has 5 live items. Phase 5 has 7 live items and limitations a to f. Phase 6 has 6 live items. Phase 7 has 5 human items.

## Pre-run snapshot and baseline (closure run)

- Snapshot (retroactive): HEAD a79e129, git status --porcelain with 0 entries. The first closure change is 72817e9, so the snapshot predates every change this run made.
- Baseline gates at a79e129, run before the first closure change: typecheck 0; lint 0; npm test 988 tests, 979 pass, 0 fail, 9 skipped (live-gated); build 0; test:integration 9 tests, all skipped (live-gated).
- Pre-existing changed files: none. The tree was clean.

## Session Continuity

Last session: 2026-10-22
Stopped at: gap closure applied and re-audited; the run waits for decisions on the AgentOS path, the QUAL-01 rule, the containment default, and the OMP-03 wording. Ship, licence, CI, README, and archive approvals follow.
Resume file: None. Next action on resume: apply the decisions, rerun the gates, rerun the audit for the changed rows, then request ship and archive approval.

Recorded commits (closure run): 72817e9 (private flag restored, engines >=22.13.0); 390f511 (causeCode and catalogue codes, host paths, lifecycle bound, root identity, exec margin); b6bc892 (daemon entry, AgentOS fail-closed, catalogue refusals, per-method control bounds); 8088159 (daemon owns sessions; tool method; daemon client; Omp and MCP attach); 4b1d4ab (smoke fixes: CLI probe, up and down exits, state-dir 0700); c55056a (traceability: requirements by evidence, spike facts, runtime config, Omp attach contract); plus the gap-closure commits (see git log).

Recorded commits (earlier): e949ad3, 53fc919, 26ab145 (phases 1 to 3); 6b28fa4 and 57d176c (phase 4); acc4ee1 and 4b757b3 (phase 5); 5f1384d, a0335c7, and a17db34 (phase 6); b7fad06 (phase 7); 464f0f2 and a79e129 (reconciliation).

## Reconciliation log

- 2026-10-22: STATE and ROADMAP reconciled to evidence for phases 1 to 7.
- 2026-10-22 closure: ROADMAP goals, scope, and acceptance criteria are unchanged. STATE is rewritten whole. The deferred table uses the GSD state names.
- 2026-10-22 closure: the ultrathink planning graph for this run had no repository facts (its wave plan was fallback text), so repository evidence was used instead.
- 2026-10-22 audit v1.0 (first pass): gaps_found; 23 satisfied, 21 partial, 2 open; gaps G-01 to G-10 recorded in .planning/v1.0-MILESTONE-AUDIT.md.
- 2026-10-22 gap closure: waves one and two closed G-03, G-05 to G-08, and G-10; G-04 reduced to the 10 residual sites; G-09 left open. Fixed in the run: a typecheck error in the daemon e2e test; a hang in the daemon test (scratch-dir cleanup order); three lifecycle timing windows widened on the loaded host; one CLI usage assertion changed from wording to behaviour.
- 2026-10-22 re-audit: overall gaps_found. QUAL-01 open. FS-02 and OMP-03 accepted approximations pending the OMP-03 decision. Full gates green: typecheck 0, lint 0, test 0 (1113 total, 1104 pass, 0 fail, 9 skipped), integration 0, build 0.
