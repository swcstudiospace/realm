---
gsd_state_version: "1.0"
status: In progress (milestone v2.0)
stopped_at: "Awaiting approvals: ship (PR and possible merge to main), licence, CI, README, archive, and confirmation of the FS-02 accepted approximation"
last_updated: "2026-10-22T19:59:15.667Z"
last_activity: 2026-10-22
last_activity_desc: Milestone v1.0 completed and archived
state_head: 08d9d19919e5676706184555de09683e9dddb2d5
progress:
  total_phases: 7
  completed_phases: 7
  total_plans: 40
  completed_plans: 40
  percent: 100
current_phase: 7
current_phase_name: Policy Reference and Security Review
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-22)

**Core value:** Every file mutation by an agent either lands inside the realm under policy or fails closed, and the user can always see whether the realm is active or disconnected.
**Current focus:** Milestone v2.0 (host adapters, live Omp verification, release 0.2.0) in progress on feat/realm-v2-0. Milestone v1.0 (provisional name), shipped fail-closed. The AgentOS sandbox runner is deferred to a follow-up milestone. Remaining items are approvals and live verification.

## Current Position

Phase: Milestone v2.0, phases 8 to 10 in progress; phase 9 narrowed to OMP-LIVE-02 and -03 (OMP-LIVE-01 and -04 descoped); phase 11 not started
Plan: —
Status: Paused for the owner: ship held; the v2.0 close needs phases 8 to 10 complete and an explicit owner confirmation
Last activity: 2026-10-23 — owner decisions recorded: FS-02 accepted, OMP-LIVE-01 and -04 descoped to a follow-up, ship held, Linear left in Backlog, UI-01 recorded as a limitation

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
- [2026-10-22 user decision]: AgentOS path: defer to a follow-up milestone. v1.0 ships fail-closed; RT-04 and CLI-01 are deferred
- [2026-10-22 user decision]: The daemon owns sessions. Surfaces attach by connecting and calling the idempotent up. There is no attach or detach protocol; the sandbox persists until realm down (docs/integration/runtime-decision.md, "Closure decisions")
- [2026-10-22 user decision]: Phase 3 live items are deferred as human verification, as Phases 4 to 7 are. The milestone name v1.0 is provisional; archive still needs approval
- [2026-10-22 user decision]: QUAL-01 amended with a named exception list (nine sites in eight exceptions; the rule is no silent catch blocks, except those exceptions)
- [2026-10-22 user decision]: Containment default stays advisory; fail-closed is the documented opt-in for containment deployments
- [2026-10-22 user decision]: OMP-03 accepted as an approximation: one status item, detail in its text, no tooltip API on this host
- [2026-10-22 default, not answered]: Scope is roadmap phases only; a codebase-wide typed-lint pass is a follow-up
- [2026-10-22 default, not answered]: No new test framework; a blocked item pauses the run
- [2026-10-22 gap closure]: MCP and ACP keep the RealmError code and message; `realm acp` is the production ACP entry (TOOL-05)
- [2026-10-22 gap closure]: One state-directory resolver, readHostRuntime, serves the CLI, the daemon, and the Omp entry (CLI-01, RT-06, OMP-01)
- [2026-10-22 gap closure]: The Omp status is one item, refreshed on a 2 s bounded interval, and every timer clears on shutdown (OMP-02, OMP-03)
- [2026-10-22 gap closure]: The controller rebinds through verifyPinnedAt, which checks dev and ino and the /proc/self/fd real path, not a string path (FS-02, partial)
- [2026-10-22 gap closure]: Catalogue has 27 codes; new are MCP_INPUT_FAILED and CLEANUP_FAILED

### Parked

- SWARM PARKED (2026-10-22): the AgentSwarm control plane (sibling checkout agent-swarm) is parked as a known issue, not fixed here. Its checkout reports one modified file (Cargo.lock) at HEAD d87bb8f. Swarm paths are not modified by this milestone. Realm wave 1 used the swarm task store only for leasing and signed assignments.

### Pending Todos

Open follow-ups: the AgentOS sandbox runner in the follow-up milestone (RT-04, CLI-01); deterministic ordering seams for the lifecycle timing tests (widened to 1 to 4 s windows on this loaded host); a containment-default migration note if the default ever changes; an Omp status-refresh cost check on a real host; the FS-02 confirmation. Fixed in the four-defect wave (2026-10-22): the ensure expiry code is DAEMON_START_TIMEOUT; the detached daemon's output goes to <stateDir>/daemon.log; client replies are capped at 1 MiB; missing ancestors of the state directory take the default mode. Known inconsistency, documented: up does not print the daemon log hint on a daemon refusal, while mcp and acp do.

### Blockers/Concerns

- Approvals: ship done (PRs #1 to #3 merged through ultrathink-ship, PR #4 archives v1.0; the ship CLI ran with --ignore-gsd while the GSD roadmap was incomplete); licence done (AGPL-3.0-only); CI done (verify and release on main, and the docs site built on pull requests); README done. FS-02 accepted approximation: confirmed by the owner on 2026-10-23 (refusal tests kept; the read and write check-to-use windows recorded in REQUIREMENTS).
- Host Podman is 4.9.3, below OpenShell's 5.x requirement. Podman-gated checks are deferred to a Podman 5.x host.
- v2.0 live Omp (OMP-LIVE-01 to 04, UI-01): OMP-LIVE-02 met on this host with the daemon's own reason. OMP-LIVE-01 and -04 are descoped to the follow-up milestone by the owner (2026-10-23): an active daemon needs Podman 5.x and an AgentOS driver. OMP-LIVE-03 is partial. UI-01 non-blocking is a stated limitation: get_state was delayed about 6 s during the attach, and the cause is not isolated.
- v2.0 host validators (HOST-01, HOST-02): Claude Code, Grok Build, Muse Code, and Hermes Agent pass their validators in isolated directories. Prime Agent has no validator; its isolated install and list pass. Hermes uses a portable package, so no Python shim is needed.
- v2.0 ship (HOST-03, release 0.2.0): held by the owner (2026-10-23) until the archived v1.0 gaps are verified on a Podman 5.x host. The last assess reported not done: the GSD roadmap counts 0 of 7, and archived v1.0 verifications are 03 and 06 gaps_found, 04, 05, and 07 human_needed. assess was not re-run in the 2026-10-23 pass: the ship CLI path was not located.
- Omp host write and edit interception is not documented (OQ-P5-02). The guard blocks writes while the policy mode is unknown. Audit G-09 part 5.4 stays open for this reason.
- The Anda licence conflict still blocks vendoring Anda code.
- Test timing: the lifecycle tests use wall-clock windows, widened to 1 to 4 s on this loaded host. Deterministic seams are a follow-up.

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| Requirement | RT-04: in-sandbox AgentOS runner | Deferred by user decision; spike says no-go as designed | 2026-10-22 | follow-up milestone |
| Requirement | CLI-01: realm up reaches active | Deferred by user decision; fails closed with AGENTOS_NOT_CONFIGURED | 2026-10-22 | follow-up milestone |

## Deferred Verification

Live or pending verifications deferred by evidence, most recent first:

| Phase | State | Resume |
|-------|-------|--------|
| 3 | verification_deferred_human | /gsd:verify-work 3 |
| 4 | verification_deferred_human | /gsd:verify-work 4 |
| 5 | verification_deferred_human | /gsd:verify-work 5 |
| 6 | verification_deferred_human | /gsd:verify-work 6 |
| 7 | verification_deferred_human | /gsd:verify-work 7 |

Detail, by phase: Phase 3 covers RT-01, RT-02, RT-03, RT-09, and the live parts of ANDA-02 and ANDA-03 (host Podman 4.9.3 is below 5.x). RT-04 is deferred, as recorded above. Phase 4 has 5 live items. Phase 5 has 7 live items and limitations a to f. Phase 6 has 6 live items. Phase 7 has 5 human items.

## Pre-run snapshot and baseline (closure run)

- Snapshot (retroactive): HEAD a79e129, git status --porcelain with 0 entries. The first closure change is 72817e9, so the snapshot predates every change this run made.
- Baseline gates at a79e129, run before the first closure change: typecheck 0; lint 0; npm test 988 tests, 979 pass, 0 fail, 9 skipped (live-gated); build 0; test:integration 9 tests, all skipped (live-gated).
- Pre-existing changed files: none. The tree was clean.

## Session Continuity

Last session: 2026-10-22
Stopped at: v2.0 blocked-item pass complete for everything reachable. The Omp status item was fixed and observed live; validators were run; snippets, runbook, changelog, and planning were refreshed. Commits are listed in git log on feat/realm-v2-0.
Resume file: None. Owner decisions 2026-10-23: FS-02 accepted; OMP-LIVE-01 and -04 descoped; ship held; Linear left in Backlog; UI-01 recorded as a limitation; Hermes trust untrusted kept. Next action on resume: phase 8 (HOST-02: Prime Agent has no validator) and phase 10 release decisions; the ship stays held until the archived items are verified on Podman 5.x.

Recorded commits (closure run): 72817e9 (private flag restored, engines >=22.13.0); 390f511 (causeCode and catalogue codes, host paths, lifecycle bound, root identity, exec margin); b6bc892 (daemon entry, AgentOS fail-closed, catalogue refusals, per-method control bounds); 8088159 (daemon owns sessions; tool method; daemon client; Omp and MCP attach); 4b1d4ab (smoke fixes: CLI probe, up and down exits, state-dir 0700); c55056a (traceability: requirements by evidence, spike facts, runtime config, Omp attach contract); a999c17 (audit gap closure: realm acp, refusal code mapping, one state-dir resolver, Omp status, pinned-root rebind, catch-site fixes, daemon server-failure stop); dd02034 (re-audit, planning, and docs); 54bc236 (MCP tool-call diagnostic); plus the decisions commit (see git log).

Recorded commits (earlier): e949ad3, 53fc919, 26ab145 (phases 1 to 3); 6b28fa4 and 57d176c (phase 4); acc4ee1 and 4b757b3 (phase 5); 5f1384d, a0335c7, and a17db34 (phase 6); b7fad06 (phase 7); 464f0f2 and a79e129 (reconciliation).

## Reconciliation log

- 2026-10-22: STATE and ROADMAP reconciled to evidence for phases 1 to 7.
- 2026-10-22 closure: ROADMAP goals, scope, and acceptance criteria are unchanged. STATE is rewritten whole. The deferred table uses the GSD state names.
- 2026-10-22 closure: the ultrathink planning graph for this run had no repository facts (its wave plan was fallback text), so repository evidence was used instead.
- 2026-10-22 audit v1.0 (first pass): gaps_found; 23 satisfied, 21 partial, 2 open; gaps G-01 to G-10 recorded in .planning/v1.0-MILESTONE-AUDIT.md.
- 2026-10-22 gap closure: fixes for G-03, G-05 to G-08, and G-10; G-04 reduced to nine sites in the named exceptions. Fixed in the run: a typecheck error in the daemon e2e test; a hang in the daemon test (scratch-dir cleanup order); three lifecycle timing windows widened on the loaded host; one CLI usage assertion changed from wording to behaviour; an unused parameter removed in the daemon test; an MCP tool-call defect now leaves a diagnostic.
- 2026-10-22 re-audit: overall gaps_found before decisions. QUAL-01 open; FS-02 and OMP-03 accepted approximations pending decisions.
- 2026-10-22 decisions: AgentOS deferred; QUAL-01 amended with the named exceptions; containment default kept advisory; OMP-03 accepted. A count correction: the first summary said 7 deliberate and 3 undocumented sites; the re-audit actually has 8 deliberate, 1 documented, and 1 undocumented (fixed). Gates at 54bc236: typecheck 0, lint 0, test 0 (1114 total, 1105 pass, 0 fail, 9 skipped), integration 0, build 0.
- 2026-10-23 v2.0 orchestration pass: phases 8 to 10 marked in progress with evidence; the live procedure in docs/integration/omp.md checked against omp --help; check:mcp exits 0 (fail-closed); blockers recorded here.

## Operator Next Steps

- Decided 2026-10-23: FS-02 accepted, OMP-LIVE-01 and -04 descoped, ship held, Linear left in Backlog. Remaining: archived v1.0 items on a Podman 5.x host, phases 8 to 10 completion, ultrathink-ship (held), and the v2.0 close (needs an explicit owner --confirm).
