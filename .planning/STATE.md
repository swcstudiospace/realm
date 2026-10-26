---
gsd_state_version: "1.0"
milestone: v2.0
current_phase_name: Policy Reference and Security Review
status: In progress (milestone v2.0)
stopped_at: Run ut-mvlvx860 paused at phase 9 GREY_AREA_ACCEPTANCE (G1-G4) before PLAN; phase 8 closed on evidence; phase 10 and 11 outstanding
last_updated: "2026-10-24T04:25:01.406Z"
last_activity: 2026-10-23
last_activity_desc: Milestone v1.0 completed and archived
state_head: e79842ca820b5504ad81465550515ff234a9d143
progress:
  total_phases: 11
  completed_phases: 8
  total_plans: 1
  completed_plans: 40
current_phase: 7
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
- [Phase Pre-edit pause]: Pre-edit pause resolved by owner. (1) ROADMAP text rule amended for this run: phase 8-11 detail blocks derived from REQUIREMENTS, and the v1 reorganise through the sanctioned step; the audit allows those two changes plus status and progress fields. (2) Kickoff runs with tracker writes: Linear and Notion rows created or finished, Task status set to Implementing; duplicate risk with SPE-18512 to SPE-18519 accepted by owner. (3) Quality-bar scope: touched code, plus deletion of the wording-pin tests that AGENTS.md forbids in four files. — Owner answers at the pre-edit pause. Conflicts recorded: (a) spec serial phases versus kickoff parallel wave dispatch: writes stay serial and only read-only work runs in parallel; (b) ROADMAP text rule versus owner decisions: amended by decision (1); (c) kickoff Task status change versus the earlier Backlog decision: accepted by decision (2).
- [Phase Discovery]: Discovery (wave 2). Active milestone: v2.0. Remaining phases in ROADMAP order: 8, 9, 10, 11. Declared dependencies: none in ROADMAP (phases 8-11 have no detail blocks yet); default is ROADMAP order. Start HEAD: dcb11dc67e20da99d4c7901133a63af12820cfe4. Tree before this record:  M .planning/STATE.md  (only run-recorded STATE changes). Start copy: gsd-start-roadmap-2026-10-24.md, SHA-256 4785d11f1b1325c98a21357ffc89279adee60750067c5c159dfac7f32965d6b9 (kept outside the repo; recorded by name and hash only). Gate commands from package.json: typecheck, lint, build, test, test:integration, test:scripts, check:docs, check:gates, check:pack, check:mcp, and the site build. TODO sources: none in src, test, scripts, docs, or adapters, and no referenced TODO document. Status convention: checkbox lines and the ROADMAP progress rows. — Start record for the ultrathink run; resumes must verify this hash rather than rewrite it. Conflicts pre-recorded: serial phases versus parallel wave dispatch (writes serial); ROADMAP text rule amended by owner decision; kickoff tracker writes accepted by owner decision.
- [Phase Baseline]: Baseline (wave 3) at dcb11dc with Podman 4.9.3 on the default path: typecheck 0, lint 0, build 0, test 0 (1129 total, 1120 pass, 0 fail, 9 skipped), integration 0 (9 skipped), scripts 0 (80 pass), docs 0, gates 0, pack 0, mcp 0, site 0. The gate runs left the working tree unchanged. Raw logs are outside the repo. — Baseline captured before any edit, after the owner pre-edit answers. Integration is 9 skipped on Podman 4.9.3, matching the original baseline; the live 5.x gate needs the isolated runtime.
- [Phase Phase 8]: Phase 8 complete on evidence: HOST-01 and HOST-02 passed in the isolated validator logs (Claude Code with warnings, Grok valid, Muse valid, Hermes passed, Prime install and list exit 0). Phase artifacts CONTEXT, PLAN, SUMMARY, and VERIFICATION were written by hand for this run; VERIFICATION is an orchestrator evidence check, not a gsd-verifier run. Flagged for owner ratification. — Phase 8 records validated by evidence, not a discuss, plan, and execute cycle, per the owner closure decision.
- [Phase Phase 9]: Owner decision (phase 9 pause): fix the libpod route defect now as an accepted expansion of the active milestone. Scope: versioned libpod routes derived from the server's reported API version; a 404 counts as absence or success only when the body is Podman's no-such-container error; unit tests with a fake socket; a live check as the dedicated live user. — Accepted expansion into v1 runtime code, because the defect makes every libpod call fail on Podman 5.x. Recorded per the spec's pause rules.
- [Phase Phase 9 checkpoint]: Phase 9 libpod fix, in progress under the owner's accepted expansion. Verified on Podman 5.7.1: GET /_ping returns 200 with a Libpod-Api-Version header; a missing container returns 404 with a JSON body whose cause is 'no such container' (inspect and remove); an unknown route returns 404 with plain text 'Not Found'; the versioned paths return 200. Remaining steps, in order: (1) libpod-routes: matchLibpodRoute accepts only a /v<semver> prefix, and routeTarget takes the API version; (2) libpod-client: discover the version from /_ping and validate it, otherwise fail with SCHEMA_INVALID; cache it per client and prefix every route; exchange returns headers; inspect and remove accept a 404 only when the JSON cause is 'no such container'; (3) test/support/fake-libpod: answer /_ping with the version header, and give the 404 body its cause and response fields; (4) new unit tests for versioning, the plain 404 failing closed, and the cause 404 accepted; (5) typecheck, lint, unit tests, and build, all green before any further step; (6) rebuild the dedicated user's copy and rerun the daemon, expecting the reaper to pass; (7) record phase 9 evidence, then start phase 10. No source edits were made in this checkpoint. — Resume plan for the libpod fix (see the phase 9 decision in STATE for the verified facts and the ordered steps).
- [Phase Run start]: Ultrathink run for graph ut-mvlt86oy-3817dec5 on the v2.0 milestone: phases 9 to 11 outstanding; phase 8 complete on evidence. Defaults applied: unclear TODOs stay UNSCHEDULED; an AWAITING_USER phase holds later phases in its milestone unless ROADMAP documents independence; per-phase local commits, nothing pushed; accepted decisions recorded in STATE carry forward; the quality bar applies to produced code only; the full verification set runs at each phase exit and is diffed against the recorded baseline. Clarifications q1 to q4 are non-blocking and take their recommended defaults: bar for produced code, large TODOs left open, repository sources only, ask before upgrading. The planning pass's n7 wave plan is fallback content and unverified, so the wave plan is written from n1 to n6. Ship is not invoked: the owner's hold of 2026-10-24 stands, and the spec's own OUT_OF_SCOPE list excludes pull requests. — Start-of-run assumptions from the planning spec, recorded so later steps cite them rather than re-decide them.
- [Phase 7]: Phase 9 closed on evidence: libpod routes versioned from /_ping Libpod-Api-Version; live daemon on Podman 5.7.1 passes startup reaping; realm status disconnected with reason no workspace; OMP-LIVE-02 refreshed; OMP-LIVE-01/03/04 remain descoped; UI-01 accepted limitation

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
- Run ut-mvlvx860 paused at phase 9: open blockers B-001 to B-005 (AgentOS unbound, live image and workload, Anda Engine, Podman 5.x on PATH, Linear free-issue limit). Detail in the Run ut-mvlvx860 section of STATE.

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

Last session: 2026-10-24T04:25:00.949Z
Stopped at: Run ut-mvlvx860 paused at phase 9 GREY_AREA_ACCEPTANCE (G1-G4) before PLAN; phase 8 closed on evidence; phase 10 and 11 outstanding
Resume file: .planning/phases/09-live-omp-verification/09-CONTEXT.md

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

## Run ut-mvlvx860-9e2d5e0a (gsd-autonomous, 2026-10-24)

Status: PAUSED at GREY_AREA_ACCEPTANCE, phase 9, before PLAN. Resume instruction at the end of this section.

### Graph and tracking

- Graph ut-mvlvx860-9e2d5e0a. Spec: the session spec file, kept outside the repository. Notion Task https://app.notion.com/p/403bc1a0c7ae816bb29ac8d3ab9f8307?pvs=204 is set to Implementing. Session marked kicked off.
- Linear: tracking partial. The workspace free-issue limit refused every issue, so 0 Linear issues and 0 sub-issues exist. Notion rows were reused from the planner. Fail-open per kickoff; see B-005.

### Non-blocking defaults applied (not asked as blockers)

- q1 install gate: pause per host install (recommended).
- q2 codebases: this repository only.
- q3 quality bar: touched code only.
- q4 suspect decisions: raised at each phase's DISCUSS pause.
- k1 realm: this repository's product (package.json bin `realm`; AGENTS.md).
- k2 sessions: rootless Podman and the OpenShell gateway are required; no fallback engine (AGENTS.md; docs/integration/runtime-decision.md).

### Realm target and run path (repository evidence)

- Build and install: `npm ci`, `npm run build` (AGENTS.md Commands). CLI entry: dist/src/cli/main.js. Daemon entry: dist/src/daemon/main.js.
- Working definition (dev environment starts and the smoke check passes): met at baseline by `npm run check:mcp`, exit 0.
- User goal "realm up and running": not met. `realm up` fails closed with AGENTOS_NOT_CONFIGURED until an AgentOS driver is bound (AGENTS.md, Project). No live run was attempted in this pass. See B-001 and G1.

### Baseline (before any change; HEAD e79842c; clean tree; host clock 2026-10-24)

- npm ci 0; typecheck 0; lint 0; build 0; test 0 (1118 total, 1109 pass, 0 fail, 9 skipped); test:integration 0 (9 skipped, PODMAN_UNSUPPORTED_VERSION on Podman 4.9.3); test:scripts 0 (80 pass); check:docs 0; check:gates 0; check:pack 0; check:mcp 0; site build 0.
- Platform: Ubuntu 24.04.4, Linux 6.8.0-147-generic, x86_64. Node 24.18.0. gh 2.45.0. openshell 0.1.2. Podman 4.9.3 on PATH; Podman 5.7.1 at /usr/local/bin.
- Logs are kept outside the repository.

### Install log

- npm ci | project dependencies from package-lock.json | npm registry through the lockfile | project scope (node_modules) | reason: bootstrap | exit 0. No other install ran. Nothing global, no OS packages.

### Decision log

- D-001 [AUTO] The defaults above are applied. Reversal: edit them here and re-run DISCUSS for the affected phases.
- D-002 [AUTO] Skill() calls: this harness has no Skill() tool. Each phase command runs by reading its skill and executing it from the top-level loop, one at a time, with no nested phase command. Reversal: use a Skill() tool if one appears.
- D-003 [AUTO] ROADMAP detail blocks for phases 8 to 11 were added under the owner's 2026-10-24 amendment. Goals, criteria, membership, and order are unchanged. "Depends on" reads "Not stated in ROADMAP" because no dependency is stated. Written by hand because no GSD command adds detail blocks. Reversal: remove the blocks.
- D-004 [AUTO] Phase 8 is closed on its validator exit codes, all 0, under the owner's 2026-10-24 closure decision. An addendum is appended to its SUMMARY. Owner ratification is pending. Reversal: remove the addendum and the ROADMAP marker.
- D-005 [AUTO] Phase 9 DISCUSS is complete: CONTEXT written; locked USER decisions U-1 to U-4 not reopened; grey areas G1 to G4 raised at this pause. Reversal: none needed; artifact only.
- D-006 [AUTO] The v1 reorganise, owner-approved on 2026-10-24 as a sanctioned step, is deferred to phase 11 closeout. It affects only the milestone-complete dry run, and running it now would shrink ROADMAP for no current gain.
- D-007 [AUTO] Kickoff fails open on Linear. Notion rows are reused, the Task is set to Implementing, and the session is marked kicked off.
- D-008 [AUTO] Commit policy: one local commit per completed phase boundary, explicit paths only, nothing pushed.

Incident note, not a decision: while reading usage, I ran `state.signal-waiting` and `state.signal-resume` without arguments. They created and then removed `.planning/WAITING.json`. The tree was verified clean afterwards. Do not call gsd-tools state commands bare to read usage.

### Blocker log

- B-001 external decision (G1): AgentOS is unbound, so `realm up` refuses with AGENTOS_NOT_CONFIGURED. This blocks the phase 9 OMP-LIVE items and the user's goal of realm running. Open.
- B-002 external (G2): REALM_LIVE_IMAGE (digest-pinned) and REALM_LIVE_WORKLOAD are unset, and the dedicated user's rootless store holds no image. This blocks the 8 live container gates. Open.
- B-003 external (G3): the Anda Engine server is not installed (`anda` is Anda Bot 0.11.6), and licence conflict OQ-P3-11 is open. This blocks the ANDA live gates. Open.
- B-004 environment (G4): Podman 4.9.3 resolves first on PATH; Podman 5.7.1 is at /usr/local/bin. This blocks the live Podman gates and any realm run. Open.
- B-005 external tracker: Linear workspace free-issue limit. Blocks Linear rows only; non-blocking. Owner decision: upgrade, archive, or accept Notion-only tracking. Open.

### TODO triage

- User TODO list in the repository: not found. No TODO files exist. Checkbox lists exist only in verification reports under .planning. No TODO or FIXME markers exist in src, test, scripts, docs, adapters, tsconfig.json, or eslint.config.js.
- This run's tracker: 36 prior items (23 done, 13 blocked) plus 63 Linked-issues lines. The 63 lines close with their nodes. Each prior blocked item maps to phase 9, 10, or 11, or to B-001 to B-005, so none is dropped.
- Addressed this run: phase 8 closure, phase 9 DISCUSS, the phase 9 pause.
- Not addressed: the codebase-wide quality and pattern overhaul (q3 default; it needs its own approved milestone), and the Linear backlog (B-005).

### Pending questions (sent with this pause)

- G1 AgentOS binding and OMP-LIVE scope: (a) feasibility gate, then reinstate OMP-LIVE-01, -03, -04 on go [recommended]; (b) bind now and reinstate now; (c) keep deferred, phase 9 closes on OMP-LIVE-02 and UI-01 evidence; (d) change the runner design, which needs a spec amendment.
- G2 live gate inputs: (a) choose and pull a digest-pinned public base after registry approval [recommended]; (b) you supply the digest and workload; (c) keep the live container gates skipped.
- G3 Anda Engine: (a) install upstream locally for live tests only, not vendored [recommended]; (b) keep the ANDA live gates skipped; (c) you supply the binary.
- G4 Podman 5.x for realm runs: (a) put Podman 5.7.1 first on PATH for realm runs only, through the run environment [recommended]; (b) change the global PATH or profile; (c) keep Podman 4.9.3 and skip the live gates.

### Phase status (workflow view, init.phase-op)

- Phase 8: complete on evidence. CONTEXT, PLAN, SUMMARY, and VERIFICATION exist. Ratification pending.
- Phase 9: paused at GREY_AREA_ACCEPTANCE. CONTEXT exists; no PLAN.
- Phase 10: outstanding. Partial SUMMARY only; no CONTEXT, PLAN, or VERIFICATION. Release held by the ship hold.
- Phase 11: outstanding, not started. Needs phases 9 and 10 complete and an explicit owner --confirm.

### Resume instruction

- When the answers arrive, record each as a USER decision in this section, with IDs from D-009 onward. If G1 is (a), run the feasibility gate outside the repository and record its result. Then re-check GREY_AREA_ACCEPTANCE for anything still open, and run PLAN for phase 9.
- Phase 10 DISCUSS raises the ship-policy question: release, PR, and merge. Phase 11 needs explicit owner confirmation. ultrathink-ship stays uninvoked until the run is finished.

### Resume: USER answers received (2026-10-24)

- D-009 [USER] G1, bind AgentOS now. The feasibility gate is skipped at the owner's choice. The spike's blocker on 16 MiB writes (the sidecar crash takes down the embedding process) is accepted as a known risk, and the supervisor's crash-loop policy is the containment. The dependency lands only after the licence (Apache-2.0, from the registry), maintenance, and advisory checks are recorded in the phase 9 PLAN. Reversal: remove the dependency and the driver binding; the supervisor returns to unbound.
- D-010 [USER] Reinstate OMP-LIVE-01, -03, and -04 into v2.0 scope. This supersedes the 2026-10-23 descopes of OMP-LIVE-01 and -04 and the 2026-10-24 descope of OMP-LIVE-03, for these three items only. UI-01 stays an accepted limitation (2026-10-23). Reversal: a new USER decision descoping them.
- D-011 [USER] G2, choose and pull a pinned public base. The base is an official-library image with a shell and Node 24, pinned by digest, pulled into the dedicated user's rootless store. Its reference and digest are recorded here before any use. Reversal: remove the image; the live container gates return to skipped.
- D-012 [USER] G3, install the upstream Anda Engine locally for live ANDA tests only. Nothing is vendored and no repository dependency is added. Licence conflict OQ-P3-11 stays open and is recorded. Reversal: uninstall the built binary.
- D-013 [USER] G4, change the global PATH through the login profile so Podman 5.7.1 resolves before 4.9.3. This is a host-wide change at the owner's choice. Reversal: remove the profile line.
- D-014 [AUTO] The concrete AgentOS driver runs the AgentOS runner as the OpenShell sandbox workload. start, alive, and stop map onto the sandbox lifecycle through the existing runner port, and every call is bounded by callTimeoutMs. Reason: the port is the only control surface the supervisor allows (src/runtime/agentos.ts), and docs/integration/agentos.md and runtime-decision D073 place AgentOS inside the sandbox. Reversal: change the carrier; the port is unchanged.
- D-015 [AUTO] The spike's remaining conditions (the sidecar survives a 16 MiB write, sandbox exec keeps the pipe protocol with exit codes, and the sidecar starts non-root under Landlock and seccomp) are open risks. They are tested live in phase 9 EXECUTE and are not assumed. Reversal: none; this is a verification rule.
- D-016 [AUTO] Sandbox image for the AgentOS runner: a derived image built from the pinned base digest sha256:1200d815de24f8dcca745fbf7651d166034a35adbcad8860a8538ffff44f1420, with @rivet-dev/agentos-core 0.4.4 and the runner and probe scripts installed under /opt/realm. Reason: sandbox egress is default-deny, so the library cannot be installed inside the sandbox at start, and baking it in keeps the sandbox boundary. Reversal: remove the derived image; change the driver's imageRef. Not built yet.
- D-017 [AUTO] Anda target for the non-blocking detail of G3. The documented crate anda_engine_server 0.17.0 is a library with no binary target. Its upstream repository (commit b42da9388048b89cb50e04a4c04ac2952cdada43 at the time of the attempt) points to anda_cli, which is a client crate and cannot serve. Default applied: a small local harness binary built around the upstream engine library, outside the repository, not vendored, not redistributed. Reversal: uninstall the harness; the ANDA live gates return to skipped. The owner may override this default.
- D-018 [AUTO] The driver module reuses the existing OpenShell argv builders and error codes. No catalogue code is added: a new code is a public contract change and needs an owner decision. Reversal: delete the module and its test.

### Install log (run ut-mvlvx860)

- @rivet-dev/agentos-core 0.4.4 | npm registry | project dependency, exact pin, package.json and package-lock.json changed | `npm install --save-exact @rivet-dev/agentos-core@0.4.4` exit 0 | licence Apache-2.0 (package file); maintainers 3; last modified 2026-10-22 (registry); production audit `npm audit --omit=dev`, 0 advisories, exit 0 | reason: D-009.
- node:24-alpine, docker.io/library | rootless store of the dedicated user | digest sha256:1200d815de24f8dcca745fbf7651d166034a35adbcad8860a8538ffff44f1420, amd64 | `podman pull docker.io/library/node:24-alpine` exit 0 | reason: D-011.
- Login PATH | the root login profile, two marked lines (export PATH=/usr/local/bin:$PATH) | host profile change | reason: D-013. Verified: a login shell resolves podman to 5.7.1. Non-login interactive shells still resolve 4.9.3, which is the scope of D-013.
- npm ci | project, bootstrap | exit 0 (baseline).
- Anda Engine: nothing installed. The first build attempt stopped at the target question (D-017).

### Incident: root filesystem full (run ut-mvlvx860)

- During this phase the root filesystem reached 100% with 0 bytes free. A build subagent was writing at the time, and the first npm install and the first image pull both failed with "no space left on device". The filesystem recovered to 51G free after the build subagent was stopped. No run-owned data was deleted by the run.
- A CI-log scratch directory (3.3G, logs dated 2026-10-22 and 2026-10-23) is not run-owned. It was left untouched.
- Open finding: a build can fill the root filesystem. Builds in this run now carry an 8 GiB free-space guard.

### Work in progress (run ut-mvlvx860, phase 9 EXECUTE)

- Driver module and its unit tests: subagent AgentOsDriverImpl (two files, no gates run). Gates after it: typecheck, lint, test.
- Still to do: derived image (D-016) and its digest; the runner and probe scripts; wiring src/daemon/main.ts to pass the driver; the Anda harness (D-017); then live checks as the dedicated user for realm up, Omp attach, retry, and shutdown (OMP-LIVE-01, -03, -04); then the live integration gates with REALM_LIVE_IMAGE set to the digest reference; then SUMMARY, VERIFICATION, STATE, ROADMAP, and the local commit.

### Checkpoint (phase 9 EXECUTE, 2026-10-24)

- Verified: @rivet-dev/agentos-core 0.4.4 installed as an exact pin (licence Apache-2.0; production audit, 0 advisories; registry last modified 2026-10-22, three maintainers). Base digest pinned. Login PATH resolves Podman 5.7.1. The driver module and its 12 unit tests pass under node --test. The whole-tree typecheck and build exit 0.
- D-019 [AUTO, superseded]: the live store was assumed to be the dedicated user's rootless store. That was wrong; see the correction block below.
- Open lint on the two new files (gate is red): (1) D-99/C-5: src/runtime/agentos-driver.ts references buildExecArgv and OPENSHELL_BINARY directly, and only src/runtime/openshell.ts, src/tools/, and the shared runtime modules may do so. Fix: export one AgentOS sandbox argv builder from src/runtime/openshell.ts and import it in the driver. (2) test/runtime/agentos-driver.test.ts lines 68 and 69: unnecessary optional chaining. Fix: remove the optional chaining.
- Open design gap: buildCreateArgv has no image field. Fix: add an optional imageRef to SandboxCreateRequest and emit `--from <imageRef>` before the `--` separator. The session path is unchanged when imageRef is absent.
- Open verification: the gateway's PATH is not verified. OpenShell's Podman driver documents Podman 5.x. Check the gateway's PATH, and set it through the gateway environment file if it still resolves 4.9.3, before any live run.
- Resume order: (1) lint fix and the shared builder; re-run the driver tests and eslint on the two files. (2) Derived image: a Containerfile from the pinned base digest, with @rivet-dev/agentos-core 0.4.4 and the runner and probe installed under /opt/realm; build it in root's rootless store; record the reference and digest here. (3) Wire the driver in src/daemon/main.ts: policy file through the session policy writer, cpus and memory from the session constants, imageRef set to the derived digest. (4) Build and run every gate. (5) Live as root's rootless user: realm up, realm status, Omp attach, retry, and exit (OMP-LIVE-01, -03, -04). Disk guard 8 GiB before each build. (6) Live integration gates with REALM_LIVE_IMAGE set to the derived digest. (7) SUMMARY with exit codes, VERIFICATION, STATE, ROADMAP, and one local commit with explicit paths. Nothing pushed. (8) Phases 10 and 11 at their own gates; ultrathink-ship stays uninvoked until the run is finished.
- The Anda harness (D-017) is not started. The default stands unless the owner overrides it.

### Correction and pause (BLOCKER_RESOLUTION, 2026-10-24)

- Fact: Podman run as root is rootful. Both installed versions report rootless=false with the system graph root, which is the shared rootful store. The OpenShell gateway (root user unit) uses the system Podman API socket (podman.socket, active since 2026-10-20 22:29:29 UTC) and sets no container-host variable, so its sandbox images live in the shared rootful store.
- Fact: the dedicated user's rootless socket directory is empty. No rootless Podman service is running.
- Question (store): where the derived AgentOS image must live. Option A: build into the shared rootful store (one image added; reversible by removing it). Option B: point the gateway at the dedicated user's rootless socket through the gateway environment file, then restart the gateway; the shared store stays untouched, but the setting's effect must be verified first and the restart briefly interrupts the gateway. Option C: publish the derived image to a registry and reference it by digest (needs a registry and push credentials).
- Recommendation: B. It matches the documented rootless model and leaves the shared store untouched under the standing rule.
- Phase and step: phase 9 EXECUTE, after step 1 (lint fix and shared builder; complete: targeted 59 of 59, full unit 1135 total, 1126 pass, 0 fail, 9 skipped; npm run lint exit 0).
- Resume: step 2 (runner, probe, Containerfile, with no store writes) proceeds now. The image build and the live checks wait for the answer.
- Superseded: the resume order and the work-in-progress lines above that name root's rootless store or the dedicated user for live checks. The store answer decides those steps.
- check:docs failed on two host paths in this file (login profile and CI-log directory). Both were replaced with placeholders in this edit.

### Outcome of option B and new pause (BLOCKER_RESOLUTION, 2026-10-24)

- Attempted: a durable rootless Podman API unit for the dedicated user (linger on), OPENSHELL_PODMAN_SOCKET in the gateway environment file pointing at its socket, then a gateway restart.
- Verified: the driver honours the variable (the startup log names the path). The socket answered a rootless info call (rootless=true, Podman 5.7.1) through a remote client run as root.
- Blocked: the gateway process always runs in its own user namespace that maps only uid 0 (uid_map "0 0 1", checked before and after the change). Files owned by the dedicated user's uid are unmapped there, so the gateway gets Permission denied (os error 13) even with CAP_DAC_OVERRIDE. It can reach only root-owned resources, such as the system Podman socket it uses today.
- Rollback, verified: the gateway environment file this run created was removed; the gateway restarted (exit 0); openshell gateway info reports healthy; the driver connects with rootless=false (system socket, shared rootful store). The dedicated user's unit was stopped and removed, and linger was disabled (exit 0). The socket directory remains; it existed before this run.
- Consequence: option B is not viable. Any image the gateway uses must be reachable through a root-owned socket. The recommendation of B above is superseded.
- Question (store2): Option D: run a separate root-owned Podman API instance with its own storage root, outside the shared store, and point the gateway at its socket through the gateway environment file. The shared store stays untouched, but a new persistent rootful service is added and the gateway restart briefly interrupts it. Option A: build into the shared rootful store the gateway already uses; this writes to that store and is reversible by removing the image. Option defer: stop the live path here, finish the runner, probe, and tests, and record the live checks as blocked on the store decision.
- Recommendation: D.
- Phase and step: phase 9 EXECUTE, after step 1 (complete). The runner, probe, and Containerfile code can proceed for any answer. The image build and the live checks wait for it.

### Store decision D and service set-up (phase 9 EXECUTE, 2026-10-24)

- Answer: D (user, store2). A separate root-owned Podman API runs as a system service named realm-podman, with its own storage root and runtime directory. The shared store is not touched by this run.
- Verified: the service is active. A remote info call answers (rootless=false, storage under the service's state directory, Podman 5.7.1). The gateway was restarted with its environment file pointing at the service's socket (variable OPENSHELL_PODMAN_SOCKET). openshell gateway info reports healthy, and the driver connects (rootless=false, netavark). Exit codes: enable 0, gateway restart 0.
- Reversal: remove the gateway environment file this run created and restart the gateway; then stop and disable the realm-podman service.
- Next: pull the pinned base into the new store, build the derived image there through the service's socket, then run the live sandbox check.
- Phase and step: phase 9 EXECUTE, step 2 (derived image), now unblocked.

### Live sandbox results and new pause (BLOCKER_RESOLUTION, 2026-10-24)

- Image, verified: the derived image runs the runner and probe in a no-network container. The library creates a VM on the glibc base, the heartbeat is fresh after 2 s, and SIGTERM exits 0. Latest digest: sha256:24fa3734 (the sandbox user and the workspace paths are in it).
- Base change (D-020, AUTO, within the G2 delegation): the sidecar package at 0.4.4 ships only glibc Linux builds (npm: linux-x64-gnu, linux-arm64-gnu; no musl build, the musl package returns 404). The Alpine base therefore cannot load the library. The base is the official Node 24 slim image on glibc, pinned by digest.
- Image fixes found live: the shared policy document requires run_as_user "sandbox", so the image creates that user; the policy grants writes only under the workspace, so the heartbeat and the user's home live there.
- Shared defect, found live, not yet fixed: OpenShell 0.1.2 rejects the memory quantity "4g" (lowercase) and accepts "4G" or "4Gi". The session path builds its memory the same way (SANDBOX_MEMORY in session-execution.ts), so sessions would also fail to create. The fix is a small change to that constant plus its validation; it is pending.
- Blocker: the sandbox supervisor cannot reach the gateway. It logs "Sandbox Protocol connection lost; workload frozen pending authenticated recovery", then exits 1. The gateway listens on the loopback address, and a container cannot reach host loopback. Diagnostic sandboxes were removed; the separate service and the gateway are healthy.
- Question (gateway-reach): where the gateway must listen so sandboxes reach it. Option 1: bind the gateway to the Podman bridge address, which is local only and not public; point the OpenShell CLI endpoint and OPENSHELL_PODMAN_HOST_GATEWAY_IP at it; check the TLS name before the restart. Option 2: bind all interfaces; sandboxes and the CLI reach it, but so can any interface, including a public one; mTLS still applies; not recommended on this host. Option 3: defer the live path; finish code and tests; record the live checks as blocked on gateway reachability.
- Recommendation: option 1.
- Phase and step: phase 9 EXECUTE, live check. Lint, targeted tests (59 of 59), and the full unit suite are green from before these changes. Remaining after the answer: the memory fix, daemon wiring, the live checks, SUMMARY and VERIFICATION, the local commit.

### Gateway reach: option 1 checked, paused (BLOCKER_RESOLUTION, 2026-10-24)

- Checked read-only; nothing changed: the bind setting is OPENSHELL_BIND_ADDRESS (default loopback). The openshell network has subnet 10.89.1.0/24 with gateway 10.89.1.1. The gateway's server certificate names are host.openshell.internal, host.containers.internal, localhost, and the IP 127.0.0.1, not 10.89.1.1. The CLI has no server-name override flag; the registered endpoint is https://127.0.0.1:17670. The bridge address is not up on the host while no sandbox runs, so a gateway bound to it would fail at startup.
- Consequence: option 1 needs two more things: a name the certificate covers for the bridge address, and the bridge kept up.
- Question (gateway-names). Sub-option 1b (recommended): a hosts entry maps host.openshell.internal to the bridge address; the CLI endpoint is https://host.openshell.internal:17670; the gateway binds to the bridge address. The certificate already names that host, so no certificate change. Sub-option 1a: add the bridge address to the server certificate names through a gateway unit override that regenerates certificates with the extra name, then register the endpoint by the bridge address. Option 3 (defer) stands.
- Both sub-options need the bridge kept up, through a keep-alive container on the openshell network in the separate store.
- Phase and step: phase 9 EXECUTE, live check, paused. The gateway and the separate service are healthy on their current configuration.

### Bridge-name change applied; supervisor handshake still failing (phase 9 EXECUTE, 2026-10-24)

- Applied, option 1b: a keep-alive container on the openshell network (separate store) brings the bridge up at 10.89.1.1; a hosts line maps host.openshell.internal to that address; the gateway environment file sets OPENSHELL_BIND_ADDRESS and OPENSHELL_PODMAN_HOST_GATEWAY_IP to the bridge address (OPENSHELL_PODMAN_SOCKET unchanged); the CLI gateway is re-registered as a local mTLS gateway at https://host.openshell.internal:17670 and selected. Verified: the gateway is healthy through that endpoint, and its listener is on the bridge address, not loopback.
- Result: the sandbox still fails. The sandbox record shows Ready False (ContainerExited, exit code 1) and ConfigurationReady False (ConfigurationPending: waiting for effective configuration validation before workload activation). The supervisor never reports its configuration, so it cannot complete its handshake from inside the sandbox. The earlier "Sandbox Protocol connection lost" line is gone; now the supervisor is sent SIGTERM before confirmation.
- Reversal, if the owner chooses to defer: restore the hosts file from the backup taken before this change (scratch directory); set the gateway environment file to the single socket line; re-register the CLI gateway at https://127.0.0.1:17670 with --local and select it; restart the gateway; remove the keep-alive container realm-openshell-bridge from the separate store.
- Next, not started: find out why the supervisor cannot confirm from inside the sandbox (its own log at higher verbosity; whether the gateway's port is reachable from the sandbox network; the name the sandbox resolves for the gateway). Until that is known, the daemon wiring and the live checks stay blocked.
- Phase and step: phase 9 EXECUTE, live check, open. Ship stays held. No sandboxes are left.

### Supervisor handshake: cause located, owner decision needed (BLOCKER_RESOLUTION, 2026-10-24)

- Evidence: a container on the openshell network reaches the gateway over TCP on the bridge address. The gateway's TLS listener answers with a certificate-required alert, so it enforces client certificate verification on every connection. Sandboxes are given no client certificate (their mounts show only the workspace, the channel, and the supervisor binary). The supervisor cannot complete its TLS handshake, never reports its configuration, and is stopped before it confirms.
- Ruled out with evidence: the channel volume (the driver creates a sandbox-owned directory inside it); the supervisor binary's permissions (mode 755, root-owned, executable); the user-namespace mode (host mode changed nothing); a CA-only mount (the driver mounts nothing for a CA alone).
- Upstream, read but not tested: current OpenShell gives supervisors only the gateway CA and per-sandbox bearer tokens. The older Podman design gave every sandbox one shared client certificate, and upstream's security note says that lets root inside a sandbox act as a gateway user. The Podman supervisor-CA issue (#3781) concerns upstream egress, not this path; its fix (additional_ca_bundle, PR #3996) shipped in v0.1.5.
- Options. U: upgrade OpenShell past the repo's 0.1.2 pin (S-10) to the bearer-token supervisor design; this changes the pin and the installed binaries. M: keep 0.1.2 and configure the guest TLS bundle (CA, client certificate, key), so sandboxes receive a shared client certificate; not recommended for untrusted agent code. D: defer the live path.
- Recommendation: U, once the pin change is approved. M is not recommended.
- Host state: unchanged since the bridge change. The two test lines (user-namespace mode and CA-only) were removed and the gateway is healthy. No sandboxes are left.
- Phase and step: phase 9 EXECUTE, live check, paused.

### OpenShell 0.1.5 upgrade and the two-image contract (phase 9 EXECUTE, 2026-10-24)

- Owner decision U (supervisor auth). The upstream v0.1.5 release binaries (CLI, gateway, supervisor, x86_64) were downloaded and their published SHA-256 checksums verified. The 0.1.2 CLI and gateway binaries are kept in a scratch backup. The supervisor is installed in the gateway's helper directory. The repo still pins 0.1.2 (S-10): the pin, the drift checks, and their tests must be updated before any ship. Nothing is committed.
- Gateway configuration: a schema v2 TOML file (guest_tls_ca for the sandbox CA; the Podman driver table with socket path, network name, host gateway address, and grpc_endpoint=https://host.containers.internal:17670), selected through the gateway environment file, which also keeps its three earlier lines. The gateway is healthy on 0.1.5. A TLS handshake without a client certificate now succeeds, so the client-certificate requirement of 0.1.2 is gone.
- Finding: the driver auto-detected the sandbox's gRPC endpoint as loopback in 0.1.2 and 0.1.5 regardless of the bind address. The explicit grpc_endpoint fixes that. With it, the supervisor reports ConfigurationReady True (ConfigurationAccepted).
- Remaining blocker: the supervisor then logs "Sandbox Protocol connection lost; workload frozen pending authenticated recovery" and is stopped. Per-sandbox secrets are created (openshell-token, openshell-resolver, openshell-tls-ca), but only the resolver secret is attached to the sandbox container.
- Upstream 0.1.5 design (read in release notes and PRs, not yet checked against the source): on Podman the supervisor runs in its own container from supervisor_image, and the workload runs in a separate container with networking off, from sandbox_runtime_image, which carries the static sandbox binary. Credentials stay on the supervisor side.
- Next: read the 0.1.5 source at the release tag for the two image contracts (paths, entrypoints, what the driver expects in each), build both images from the release tarballs in the separate store, set supervisor_image and sandbox_runtime_image in the Podman table, and rerun the kept diagnostic. The derived AgentOS image then becomes the workload's image.
- Phase and step: phase 9 EXECUTE, live check, open. Ship stays held. Diagnostic sandboxes are cleaned up.

### Live sandbox path passes end to end (phase 9 EXECUTE, 2026-10-24)

- Result: create exit 0 with the derived image through --from; the in-sandbox probe reports a fresh runner heartbeat after 3 s (exit 0); delete exit 0. The runner runs inside the OpenShell sandbox under the supervisor's enforcement.
- What made it pass, in order: OpenShell 0.1.5 on the gateway; schema v2 gateway configuration with guest_tls_ca and the Podman driver table (socket, network, host gateway, grpc_endpoint=https://host.containers.internal:17670, image_pull_policy=never); the sandbox runtime and supervisor images built locally from the 0.1.5 release binaries, referenced by digest; the derived image's sandbox user and /workspace; the shared policy builder's read-only system paths (/usr, /bin, /lib, /lib64, /etc, /opt, /proc, /dev/urandom) and read-write paths (/workspace, /tmp), which the supervisor enforces with Landlock.
- Shared code changed for this: src/runtime/openshell.ts (read-only system paths and scratch paths in buildPolicyDocument); test/runtime/openshell-policy.test.ts (RT-03 pins the new contract). Build exit 0; targeted tests 72 of 72; eslint exit 0 on both files.
- Still open in phase 9: (1) the session memory quantity: SANDBOX_MEMORY in session-execution.ts still emits the lowercase g form that the 0.1.5 CLI rejects, so sessions would fail; the fix is pending. (2) Daemon wiring: src/daemon/main.ts passes the driver, with the derived image digest from the entry edge, the policy written through writePolicyDocument for the agentos session, and cpus and memory from the session constants. (3) realm up live, through the daemon. (4) Omp attach, retry, and shutdown (OMP-LIVE-01, -03, -04). (5) Integration gates with REALM_LIVE_IMAGE set to the derived digest. (6) The repo pin S-10 moves from 0.1.2 to 0.1.5, with the drift checks and their tests; the docs describe 0.1.5 already (OQ-P3-12). (7) SUMMARY, VERIFICATION, STATE, ROADMAP, and the local commit.
- Host state: the gateway runs OpenShell 0.1.5 on the schema v2 configuration, healthy. The separate root-owned Podman service is active. The keep-alive container for the bridge is running. The hosts line and the CLI endpoint point at the bridge name. The 0.1.2 binaries are kept in a scratch backup. Diagnostic sandboxes were deleted.
- Phase and step: phase 9 EXECUTE, live path verified once; the remaining items above are open. Ship stays held.

### Session memory fix and green unit suite (phase 9 EXECUTE, 2026-10-24)

- The OpenShell CLI refuses lowercase memory quantities (4g, 512m) and accepts the Gi, Mi, and G forms. SANDBOX_MEMORY on the session path now uses Gi. The integration gate, the doctor probe, and the argv, driver, and socket-path fixtures use the accepted forms. MEMORY_PATTERN accepts digits with an optional K, M, or G, and an optional i. test/runtime/openshell-memory.test.ts pins both sides.
- Full unit suite: 1136 total, 1127 pass, 0 fail, 9 skipped (baseline 1118 pass before this phase, plus 17 driver and argv tests and 1 memory test). npm run lint exit 0. npm run check:docs exit 0. Build exit 0.
- Remaining in phase 9: daemon wiring; realm up live through the daemon; Omp live checks (OMP-LIVE-01, -03, -04); integration gates with REALM_LIVE_IMAGE set to the derived digest; the S-10 pin bump to 0.1.5 with its drift checks; SUMMARY, VERIFICATION, STATE, ROADMAP; the local commit. Ship stays held.

### Daemon wiring and the live realm up result (phase 9 EXECUTE, 2026-10-24)

- Wiring, done: the daemon binds the AgentOS driver only when REALM_AGENTOS_IMAGE names a digest-pinned image (src/daemon/main.ts). Driver create has its own budget (180 s); probe and delete have 30 s; the supervisor's per-call budget is 200 s, above the create budget. The driver's timeouts are tested separately. Build exit 0; full unit suite 1138 total, 1129 pass, 0 fail, 9 skipped; npm run lint exit 0; npm run check:docs exit 0.
- Live realm up: the daemon starts; the policy and state checks pass; doctor passes every check except agentos (the daemon is down). realm up fails with OPENSHELL_START_FAILED before the AgentOS sandbox is created. The session record is state error with containerId null.
- Cause, reproduced by hand: the session's sandbox create succeeds (exit 0) and its container runs, but the container carries only OpenShell's openshell.ai labels. The io.realm.managed and io.realm.session labels are absent, so the realm's label lookup finds no container. This is OQ-P3-01 on OpenShell 0.1.5: the docs say that without the labels the create fails closed with OPENSHELL_START_FAILED.
- Decision needed (ownership key): (a) identify the session container by OpenShell's own labels or by the sandbox name realm-<sessionId>, and keep the realm's container id in its record; (b) keep the io.realm labels and move OpenShell to a version that applies them; (c) defer. Before deciding, check whether the reaper and the verifier rely on the io.realm labels.
- Host artifacts from the live attempt, all reversible: the realm config in the user config directory (owner-only); the state directory (mode 0700) with policy.json and the runtime policy files; the workspace directory; a runtime link directory that points the daemon's libpod socket at the separate service. Nothing is running, and no sandboxes or containers are left.
- Phase and step: phase 9 EXECUTE, live realm up, blocked on the ownership-key decision. Ship stays held.

### Ownership key decided: A (phase 9 EXECUTE, 2026-10-24)

- Decision (user, ownership-key): identify realm containers by OpenShell's own labels and the sandbox name. Live check (this run): an OpenShell 0.1.5 sandbox container carries openshell.ai/sandbox-name=realm-<sessionId>, openshell.managed=true, and openshell.ai/sandbox-id. It carries no io.realm labels.
- Consumers to change: runOpenShellCreate's session lookup, its ambiguity check, and the deadline lookup (src/runtime/openshell.ts), which use the sandbox name; the orphan sweep (src/runtime/sweep.ts), which starts from openshell.managed=true and keeps only sandbox names with the realm- prefix; the create argv, which drops the io.realm --label flags, since OpenShell does not apply them.
- Phase and step: phase 9 EXECUTE, implementation of the ownership key in progress; tests and the live realm up follow.

### Live realm up: read-only root decision (phase 9 EXECUTE, 2026-10-25)

- Done since the ownership decision: the realm finds the session's workload container by its sandbox-role label under the session's sandbox name, so the supervisor container of the same sandbox is excluded. The session create now passes the configured digest-pinned image (imageRef). The gateway's Podman driver sets the pids limit to the profile's 512 (sandbox_pids_limit). The AgentOS driver start was verified live here: start 1.1 s, stop ok.
- Live result: the session create and the AgentOS start succeed. The realm's hardening verifier then refuses the session container on its read-only-root check (src/runtime/hardening.ts). OpenShell 0.1.5's Podman driver creates the workload container with a writable root filesystem and offers no driver option to change it. Memory, cpu, network, privilege, pids, and image digest pass. The refused container is removed; no sandbox is left.
- Test state: full unit suite 1138 total, 1129 pass, 0 fail, 9 skipped. npm run lint exit 0. npm run check:docs exit 0.
- Decision needed (hardening, D-51). Option B: keep the read-only root requirement; realm sessions stay blocked until OpenShell exposes a read-only root option. Option A: relax the requirement for the OpenShell backend, with the controls already in place (Landlock writes limited to the workspace and /tmp, a non-root sandbox user, network none, pids 512, memory and cpu caps, not privileged). This changes a documented security property and needs your approval. Option C: defer.
- Recommendation: B until upstream support exists; A only with your approval.
- Phase and step: phase 9 EXECUTE, live realm up blocked on the read-only root decision. Ship stays held.

### Decision: read-only root, option B (user, phase 9 EXECUTE, 2026-10-25)

- Chosen: keep the read-only root requirement (D-51). Realm sessions stay blocked on OpenShell 0.1.5's Podman driver until it exposes a read-only root option.
- Consequence: live `realm up` and OMP-LIVE-01, -03, -04 (which run through realm up) stay open. They are not verified and must not be reported as passed.
- Next: confirm whether the AgentOS sandbox path applies the same hardening check; check upstream OpenShell for a read-only root option; S-10 pin bump; phase 9 artifacts; one local commit with explicit paths.

### Correction: hardening failures on OpenShell 0.1.5 (phase 9 EXECUTE, 2026-10-25)

- The option B decision assumed read-only root was the only failing check. That premise was incomplete: only six of fifteen checks had been inspected.
- Full verifier run on a live session container, created through the realm's create path with the binding SessionExecution builds. Failed: rootless, cap-drop, read-only-root, tmpfs, mounts.
  - rootless: the realm's Podman service is rootful (libpod info reports rootless false). The root-owned service decision (store2, option D) fails RT-01's rootless requirement by design.
  - cap-drop: the container keeps 11 capabilities (CAP_CHOWN through CAP_SYS_CHROOT), not ALL. No driver option found to change it.
  - read-only-root: writable root. No driver option found.
  - tmpfs: the only tmpfs is /run/openshell-supervisor-ca; the profile expects its own set. No driver option found.
  - mounts: the container's mounts are OpenShell's own (/.openshell/channel and the supervisor binary). The realm's workspace and state mounts are absent.
- Passing: privileged, cap-add, no-new-privileges, pids-limit (512 after the gateway change), memory, cpu, network-mode none, image-digest.
- AgentOS sandbox: the AgentOS driver has no hardening check. RT-01 applies to every running realm container, so the AgentOS sandbox is unverified and does not meet RT-01 today (writable root, OpenShell-owned mounts only).
- Consequence: option B cannot be met by one setting on OpenShell 0.1.5. Meeting RT-01 needs a different container path or a requirement change. Decision requested; see the next block.
- Test state unchanged: unit 1138 total, 1129 pass, 0 fail, 9 skipped; lint 0; check:docs 0.
- Phase and step: phase 9 EXECUTE, live realm up blocked; decision requested.

### Decision: container path rework (user, phase 9 EXECUTE, 2026-10-25)

- Chosen: rework the container path. RT-01 stays as written. The realm creates and hardens its own rootless container with OpenShell inside it (RT-03). Realm up stays down until the rework lands.
- Scope: replaces the OpenShell-managed sandbox path for sessions. Touches session create and start, the hardening binding, the AgentOS sandbox (non-compliant today), the rootful store2 Podman service (fails RT-01 rootless), and the phase 9 artifacts.
- Phase and step: phase 9 EXECUTE, rework feasibility first: OpenShell supervisor inside a realm-owned container; rootless Podman for the realm user.

### Feasibility: container path rework (phase 9 EXECUTE, 2026-10-25)

- OpenShell's supervisor runs the workload through an isolation backend. The built-in Linux backend needs a backend descriptor file that a compute driver writes. The standalone isolation-backend role refuses to start without it (--backend-descriptor-file is required), so OpenShell cannot run inside a realm-owned container on its built-in backend.
- OpenShell offers external isolation backends: the supervisor's registration file names an out-of-process backend endpoint, and the launch descriptor is opaque bytes that the backend validates. The contract (Sandbox Protocol 1.0, IsolationBackend gRPC) is present in the 0.1.5 supervisor binary. A realm-written backend would own the enforcement that the built-in backend provides now. No such backend exists in this repo; building one is a large, security-critical change.
- Rootless Podman: feasible for the realmlive account. Subuid and subgid ranges are present, and podman info reports Rootless=true with the 4.9.3 binary. The 5.x binary needs PATH. A runtime directory was created for the test (reversible host change). RT-01's rootless requirement is reachable without the rootful service.
- With RT-01 and RT-03 both kept as written, only an external isolation backend works. Dropping RT-03 (OpenShell off the session path) or relaxing RT-01 changes a requirement and needs owner approval.
- Phase and step: phase 9 EXECUTE, decision requested. The S-10 pin bump and the phase artifacts wait for the decision, since one option drops OpenShell from the session path.

### Decision: external isolation backend (user, phase 9 EXECUTE, 2026-10-25)

- Chosen: build an external isolation backend. RT-01 and RT-03 stay as written. The realm owns the enforcement (Landlock, seccomp) that OpenShell's built-in backend provides today.
- Scope: multi-phase and security-critical. Read the contract first (OpenShell isolation-backends docs and the isolation-backend-v8 example), then size the work breakdown before any build.
- Phase and step: phase 9 EXECUTE, contract reading. Realm up, OMP-LIVE-01, -03, -04, the S-10 pin bump, and the phase artifacts stay open.

### Phase 9 status and gates (phase 9 EXECUTE, 2026-10-25)

- Pin moved to OpenShell 0.1.5 in the doctor, the runtime comment, the tests, and the current-pin line of docs/integration/openshell.md. Historical records (spike notes, open-question rows) keep 0.1.2.
- Gates: npm test 1138 total, 1129 pass, 0 fail, 9 skipped. npm run lint exit 0. npm run check:docs exit 0.
- Summary written: .planning/phases/09-live-omp-verification/09-01-SUMMARY.md. No VERIFICATION file: the live gates are blocked, so no pass is claimed.
- Stray logs from manual checks removed from the repository root.
- Local commit on this branch with explicit paths. Never pushed.
- Phase and step: phase 9 partial. Next: owner approval to start the isolation-backend program at its go/no-go spike.

### Spike: isolation-backend go/no-go (phase 9 EXECUTE, 2026-10-25)

- Started, delegated to one agent (job IsolationSpike). Gates: G1 the gateway accepts an external compute driver; G2 a rootless realm container passes all fifteen hardening checks; G3 the supervisor attaches to a spike backend and the workload starts only after StartAgent; G4 Landlock and seccomp applied by a native helper; G5 teardown leaves no container.
- Scope and isolation: work stays outside the repository (under the spike's scratch directory). A separate spike gateway runs on loopback port 18771. The working gateway, the realm-podman service, and the realm state are not touched.
- Contract facts at start: ComputeDriver has 12 RPCs. GetCapabilities must return protocol 1.0 metadata and the openshell.compute.contract capability, and the gateway requires an exact resource_admission_policy match. OpenBoundary receives an opaque driver_descriptor from the trusted driver.
- Verdict: pending. Realm up stays blocked.

### Spike verdict, G1 and G2 (phase 9 EXECUTE, 2026-10-25)

- The delegated spike finished at G2. Its full report is outside the repository, in the phase 9 scratch area.
- G1 GO: the gateway connected to the spike driver, and sandbox create reached CreateSandbox.
- G2 NO-GO on one check: the spike's rootless realm container passes 13 of 14 hardening checks. cap-drop fails because Podman 5.7.1 records CapDrop as the 11-name expansion, not the literal ALL. The kernel shows every capability set empty.
- Corrections to earlier records: (1) the verifier has fourteen checks, not fifteen. (2) An OpenShell-created container's CapDrop lists the dropped set. The earlier statement that it keeps 11 capabilities was wrong. Its kernel sets CapInh, CapPrm, CapEff, CapBnd, and CapAmb are all zero, and libpod inspect reports EffectiveCaps and BoundingCaps as empty.
- Proposed verifier change, decision pending: require EffectiveCaps and BoundingCaps to be empty, and CapAdd empty, in place of the literal CapDrop ALL check.
- Host prerequisites for rootless realm containers, decision pending: the realmlive account's crun 1.14.1 fails every container start on this host (unknown version specified); runc works. Cgroup limits need a delegated cgroup; the user manager for realmlive is inactive, and linger would start it.
- G3 (supervisor attach to the realm backend), G4 (Landlock and seccomp), and G5 (teardown) have not been run.
- Incident: the CLI's gateway identity directory was rewritten at 07:34:43 with a CA that the gateway does not trust, so the CLI failed with BadSignature. The cause is not proven; the spike's last activity and my failed call fall in that window. Restored from the gateway's original client identity (dated 20:51), which verifies against the gateway CA. The CLI lists sandboxes again (exit 0). The replaced files are backed up in the phase 9 scratch area.
- Phase and step: phase 9 EXECUTE. Decisions requested: the cap-drop check, the host prerequisites, and whether to continue the spike at G3 to G5.

### Correction: cap-drop evidence source (phase 9 EXECUTE, 2026-10-25)

- My earlier statement that libpod inspect reports EffectiveCaps and BoundingCaps as empty was wrong. The libpod REST inspect has neither field, both while the container runs and at the realm's create-time inspect. The empty reading came from a CLI template: Go templates print a missing field as an empty list.
- The kernel is the evidence. Earlier, the capability sets of a running OpenShell-created container were all zero (CapInh, CapPrm, CapEff, CapBnd, CapAmb).
- Decision approved by the user: check the empty capability sets. Source: the host's /proc/<State.Pid>/status for the container's init process. The verifier takes this as evidence, and it fails closed when the evidence is missing.
- Spike agent informed: its G2 uses the same source.
- Refinement: libpod inspect carries EffectiveCaps and BoundingCaps, but both are null while the container runs and at create. They are not evidence. The earlier "absent" wording above is superseded by this line.
- Decision (user, 2026-10-25): the realm-owned driver starts the idle init at create and runs the kernel check at create, as the current realm flow does. No workload code runs before StartAgent.
- Implemented: the cap-drop check reads KernelCaps, the five capability sets read from the host's /proc status for State.Pid, and fails closed without them. The literal CapDrop ALL check and the profile's capDrop value are removed. Unit suite: 1143 total, 1134 pass, 0 fail, 9 skipped.

### Spike verdict, G1 to G5 (phase 9 EXECUTE, 2026-10-25)

- Round 3 result: GO on all five gates.
  - G1: the gateway reaches the external driver's CreateSandbox.
  - G2: a rootless realm container passes all fourteen checks with the idle init started at create (State.Pid present; five kernel sets zero; CapAdd empty).
  - G3: the supervisor attaches to the realm backend. The workload starts only after StartAgent; the RPC order is recorded in the spike report.
  - G4: Landlock (ABI 4), seccomp, and NoNewPrivs are applied inside the container. A /tmp write gets EACCES, a /workspace write succeeds, and keyctl gets EPERM. A control without the helper shows the /tmp write succeeds.
  - G5: sandbox delete leaves no container.
- Host: the spike reverted its prerequisites (linger off for realmlive, containers.conf removed, user manager stopped), with exit codes in its report. The realmlive account is back to its prior state.
- Scope limit: the spike used a dev-mode gateway (TLS disabled) on loopback. A production build needs the gateway's TLS and JWT configuration.
- Effort for a production build: about 3 to 4 engineer-weeks (estimate, not measured).
- Phase and step: phase 9 partial. Decision requested: approve the production build of the realm-owned driver and the isolation backend.
- Decision (user, 2026-10-25): plan the production build first, then build after approval. Planning is SDLC work and goes through the AgentSwarm orchestrator (a01-orchestrator). The plan is documents only: no code, no commits until approval, no push, and ship stays held.
- Phase and step: phase 9 partial. Planning the production build (realm-owned compute driver and isolation backend) through the swarm.

### Production build plan (phase 9 EXECUTE, 2026-10-25)

- Planned through the swarm (plan only). Documents under the phase 9 folder: CONTEXT, DECISIONS (PD-01 to PD-17), HOST-CHANGES (HC-01 to HC-13), RISKS (PR-01 to PR-17), ROADMAP-INSERT, REQUIREMENTS-INSERT, and six plans for phases 9.1 to 9.6. Nothing is applied. The orchestrator's roadmap edit was blocked by the shell guard, so the ROADMAP and REQUIREMENTS inserts wait for approval.
- Correction: PD-17 and HC-07, as first written, would have removed the CLI's live gateway identity. Corrected: keep it. No deletion is planned.
- Known conflict to resolve in 9.3 task 0: two node:24-alpine digests appear in the records (sha256:06d7 in the spike's inspect, sha256:1200d8 in D-016). D-020 already moved the base to node:24-bookworm-slim.
- Phase and step: phase 9 partial. Decision requested: approve PD-01 to PD-17 as recommended (PD-17 corrected), then apply the ROADMAP and REQUIREMENTS inserts.
- Plan approved (user, 2026-10-25): PD-01 to PD-17 as recommended, with PD-17 corrected. The ROADMAP and REQUIREMENTS inserts are applied. The swarm's first roadmap insert left a stray literal line and misplaced progress rows; both are fixed.
- Committed locally, with explicit paths: the planning documents and the six phase plans (09.1 to 09.6). No code.
- Phase and step: phase 9 partial. Next: build phase 9.1 (host prerequisites and production gateway) through the swarm, using plan 09.1-01. Host changes HC-01 to HC-03, HC-05, HC-06, and HC-08 apply in their phases, each with its checks. HC-07 is kept.
- Ship stays held. Nothing is pushed.

### Phase 9.1 status (phase 9.1 BUILD, 2026-10-25)

- Done with evidence: T1 baseline (ten digests and states, outside the repository); T2 runc in the realm account's containers configuration (rootless true, Podman 5.7.1, runtime /usr/bin/runc, read through the rootless API); T3 linger; T4 user unit realm-podman-api (active, enabled, socket owned by the account; first version failed on the socket's parent directory, fixed with RuntimeDirectory=podman); T5 soak (20 of 20 info calls, 10 of 10 profile-limited cycles, 0 orphans, kernel memory.max 1 GiB, pids.max 512, cpu.max 2 CPUs); T7 renderer and tests (11 of 11); T8 PKI under the realm state directory (0700 directory, 0600 keys; the local-mode copy kept out of the root configuration); T9 docs section.
- Gateway evidence: the gateway's own preflight accepted the rendered config (exit 0), run as the realm account.
- Boundary: all ten baseline digests unchanged, including the root CLI identity and the main gateway. The main gateway was not restarted.
- Open: T6, the owner-scheduled reboot. The phase does not close until it passes (PR-05). Observation to check at that time: one `failed to reexec` line at the first start (not seen in the soak window).
- Gates: typecheck exit 0; build exit 0; lint exit 0 (after one assertion fix); npm test 1145 pass, 0 fail, 9 skipped before the assertion-only edit, and the renderer file 11 of 11 after rebuild; check:docs exit 0.
- Host changes applied under HC-01, HC-02, HC-03 (owner confirmed), and HC-06 (approved under PD-03). Reverts are in the 9.1 summary.

### Phase 9.2 status (phase 9.2 BUILD, 2026-10-25)

- Built and tested: sandbox/realm-helper compiles with -Wall -Wextra -Werror; make check runs three native test binaries (all pass); the probe builds. The helper is static. A live smoke on the host: NoNewPrivs 1, Seccomp 2, a workspace write succeeds, and writes outside the workspace and to /tmp are blocked.
- Security gate (A10, read-only) returned CHANGES REQUIRED: six MAJOR and two MINOR findings. Fixes are in progress: denylist additions (clone flag filter, clone3 as ENOSYS, mount API, io_uring, others), capability drop, a non-root sandbox user, source digest verified in the builder, a digest-pinned gcc builder (replacing unpinned apt), the loader variable filter, narrowed workspace rights, root checks, and probe checks.
- Residual risks that move to phase 9.3: the workspace must be mounted noexec (Landlock EXECUTE is enforced only on execve). The runner must be placed under /usr or the state path, because Landlock denies execution elsewhere. The re-review must return PASS before the phase closes.
- Phase and step: phase 9.2 partial, fixes in progress. Phase 9.1 partial, awaiting T6.
- Phase 9.2 closing state (2026-10-25): the helper, native tests, probe, SECCOMP.md, and sandbox image definition are complete. make clean all check probe exits 0 with -Werror. The live run on this host shows all five capability sets zero, NoNewPrivs 1, Seccomp 2, a workspace write allowed, a write outside the workspace blocked, the null device writable, and user namespaces refused.
- Security gate: CHANGES REQUIRED on the first review; PASS WITH CONDITIONS C1 to C6 on the re-review. N1 and N2 were fixed after the re-review and are built and tested here. The conditions are owned by phases 9.3 and 9.6 and are listed in SECCOMP.md.
- Not verified on this host: the aarch64 compile (no cross toolchain); the image build; the in-container probe; the image-only checks (C4).
- Phase 9.1 closing state: partial, awaiting T6 (the owner-scheduled reboot). The owner must choose a window.
- Next: phase 9.3 (hardened container lifecycle and the image build under HC-08), applying C1, C2, C4, C5, and C6. The disk guard is 8 GiB free before each build.
- Commits: phases 9.1 and 9.2 are committed locally in two commits with explicit paths. Nothing is pushed. The ship hold stands.
- Owner decision (2026-10-25): reinstate OMP-LIVE-01, -03, and -04 into this build. This supersedes PD-14, which kept them descoped. They run in phase 9.6 (PRD-OMP-01) and need a live Omp session on the host.
- Owner decision (2026-10-25): reboot now to close phase 9.1 T6 (PR-05). Pre-reboot state is recorded in the realm state directory (t6-pre-reboot.txt). A root-only copy of the spike evidence is kept outside the repository.
- Phase and step: phase 9.1 T6, reboot starting. After the reboot: linger, the API unit and socket, the rootless and runc fields, one create-start-remove cycle, the failed-to-reexec journal check, and the main gateway's digests against the baseline.

### Run ut-mvnofqqm-1ab01b71 (gsd-autonomous orchestration, 2026-10-25)

- Spec: the session spec for this run (session 01a160c6, graph ut-mvnofqqm-1ab01b71). Kickoff ran `track complete`: Notion rows exist (7 nodes, 50 steps). Linear failed on the workspace free-issue limit (B-005, owner decision pending), and the skill fails open for it. The Notion Task is set to Implementing. The session is marked kicked-off.
- Preflight (n6) gates: ROADMAP readable and parseable (checkbox markers and Depends-on lines) PASS. Incomplete phases exist (9, 9.1 to 9.6, 10, 11) PASS. Current milestone v2.0 is the only milestone with incomplete phases PASS. .planning is writable and STATE reconciles to ROADMAP PASS. Git clean apart from this record PASS. Skills: the gsd-autonomous skill is loaded. This session exposes no Skill() tool, so each phase step is executed from its skill file and recorded here PASS (with that limit). Verification commands are declared in package.json (typecheck, lint, test, test:integration, test:scripts, check:docs, check:mcp, check:pack, check:gates) and in sandbox/realm-helper/Makefile PASS.
- Clarifications (all non-blocking). Q1 TODO scope: default accepted. The repository has no TODO files and no TODO markers. The TODO items are the ultrathink tracker rows (36 prior items: 23 done, 13 blocked) and blockers B-001 to B-005. Q2 commits: NOT the default. Assumption, stated here: one local commit per green phase with explicit paths and Conventional subjects, never pushed (the repository's commit_docs setting and the owner's standing rule). The owner may override. Q3 failure policy: default accepted, stop at the first FAILED phase. Q4 extra checks: the repository gates, plus the security gates the phase plans name.
- Phase 9.1 T6 (reboot) FAILED on the first attempt. The rootless API unit crash-looped (1251 restarts). Cause: the realm account's libpod database recorded its run root and temp directory under the account's xdg runtime directory, because it was created before linger existed, and the stored values override the config. Fix applied under HC-02 and HC-03: containers.conf sets tmp_dir and storage.conf sets runroot on tmpfs (under the runtime directory). The libpod database, its sidecars, and the stale xdg runtime directories were moved to a timestamped backup under the realm account's home (containers-runtime-backup-20261025T102555Z). That is reversible, and no container was known to the database. Images live in the graph root and were untouched. Verified: rootless true, Podman 5.7.1, runtime runc, run root on tmpfs, storage driver overlay, restart count stable. T6 stays open until a second reboot verifies the fix (owner approval requested).
- T0 (phase 9.3) resolved. The pinned base is the node 24 bookworm-slim index digest sha256:2dd9a4f7. Its repo digest matches, and it is amd64 linux. The alpine digest sha256:06d7 is not used (D-020).
- Recorded facts: /tmp is emptied at boot by the system tmp rule, so spike evidence is kept in a root-only evidence directory outside the repository.
- Phase and step: preflight done. Phase 9.3 is dispatched to the AgentSwarm orchestrator for execution under the approved plan. The ship hold stands, and nothing is pushed.
- Phase 9.3 (hardened container lifecycle) executed through the AgentSwarm orchestrator and verified by the lead on the committed tree. Commits 1f714ac (phase) and aea0d50 (review minors). Gates on that tree: typecheck 0, lint 0, check:docs 0, helper make clean all check probe 0, npm test 1220 total, 1211 pass, 0 fail, 9 skipped (live OpenShell suites need Podman 5.x on PATH).
- Live checks on the realm API (Podman 5.7.1, rootless, runc): acceptance 1 PASS (PID 1 is the idle helper; five kernel sets zero; no verifier failures), 6 PASS (labels found by both managed and sandbox-name keys), 7 PASS (image digest equals the inspect value; no socket mount), and 5 PASS (startup sweep removes an unstarted orphan). Acceptance 4 is partial: delete removes the container and the sandbox's state directory, and no launch or active file exists in 9.3. Those live checks ran before commit aea0d50, which the swarm states does not touch the create path; re-run in the 9.6 gated suite.
- Conditions: C1 PASS (workspace mount options noexec, nosuid, nodev). C2 PASS (runner under the usr tree). C4 PASS on the final image (worker threads, filesystem, and timers under the helper; NoNewPrivs 1, Seccomp 2, CapEff 0). C5 PASS. C6 PASS (no tty, not privileged; hidepid is a host residual).
- Final image in the realm store: localhost/realm-agentos:phase9-locked, digest sha256:30feeeea (full digest in the image labels), size 584 MB. Helper SHA-256 6ea2c1c9 (label io.realm.helper.sha256). Source digest a9b04463 (label io.realm.helper.source-sha256).
- Correction: the swarm reported that the realm runtime config image key was changed. It was not. The file still names the root-store image. The config switch belongs to the phase 9.6 cutover. This record and the verification document are corrected.
- Open decision (owner): launch and active files for acceptance 4. Options: keep their removal with phase 9.5 (recommended, amends the plan wording), or implement the removal now against a dedicated secret directory. Phase 9.3 is not marked complete in ROADMAP until the owner decides.
- Phase and step: phase 9.3 verified with a recorded gap pending decision. Next: phase 9.4 (compute driver gRPC) once the owner decides, plus the T6 reboot approval.
- 2026-10-25 closure record (run ut-mvnofqqm-1ab01b71): phase 9.1 complete. T6 reboot PASS: linger on for both accounts; the realm API unit recovered after one automatic restart; rootless true, Podman 5.7.1, runc; one create, start, inspect, and remove cycle passed with the kernel limits enforced (1 GiB, 512 PIDs, 2 CPUs); baseline digests 10 of 10 OK.
- Phase 9.3 complete, VERIFIED_WITH_GAPS. Live acceptance 1, 4, 5, 6, and 7 re-run after the reboot on the committed tree, PASS. C1 (noexec mount) and C6 (no tty, not privileged) verified live. Gaps, recorded and not blocking: acceptance 2 and 3 live (unit PASS); launch and active removal (unit PASS, decided by the owner, implemented in ad6222c, first live use in phase 9.5).
- Main gateway: its keep-alive bridge container did not return after the reboot (stale runroot; the unit crash-looped with no address on the openshell network). Recovery: the container was recreated on the same image, command, and network; the gateway is active and listening. Restart persistence is an open owner decision.
- Ship: ultrathink-ship was NOT invoked. Reasons: phases 9.4 to 11 are open; the ship config has autoMerge on, which would merge into main and fire the release job; this branch changes the CI workflow, which AGENTS.md requires a human to review; origin/main is 3 commits ahead.
- Decisions requested of the owner, answered 2026-10-25 (see the entry below). Approvals HC-04 and HC-05 are asked when phase 9.4 starts.
- Next: approvals HC-04 and HC-05, then phase 9.4. Phase 9.2 stays open until the phase 9.6 in-container probe.
- 2026-10-25 owner decisions (answered): (a) plan 09-01 closed for code and unit gates; OMP-LIVE-01, -03, and -04 run in phase 9.6, which clears PR-10 for phase 9.4. (b) autoMerge left on by the owner. The ship hold still stands: ultrathink-ship is not invoked until the run is finished and the owner decides. (c) Boot unit for the keep-alive bridge: root system unit realm-openshell-bridge.service (HC-07). Verified with systemd-analyze, enabled, and tested by a start: the bridge was recreated, address 10.89.1.1 present, main gateway active and listening on 17670 after 30 s. (d) Milestone close: .planning artifacts are archived.
- Still required before phase 9.4 starts: approval of HC-04 (driver user unit under the realm account) and HC-05 (realm gateway user unit with TLS and JWT from the realm state directory, on a loopback bind).
- Plan 09.4-01 status: PLANNED, NOT EXECUTED. It starts after the two approvals above.
- 2026-10-25 phase 9.4 closure (run ut-mvnofqqm-1ab01b71): complete, VERIFIED with limits carried to 9.5. Commits: 351c725 to bfb9a72 (driver code and documentation), fa235c6 (implementation version from the package manifest), 8565dc8 (workspace and state directories prepared before the lifecycle), 3606f4b and 64de730 (realm- name prefix, empty command accepted, call-site documentation), 9e93a21 (pack check asserts the six driver protos). Live: gateway connected under the production profile; create, get, list, and delete observed; named, prefixed, and auto-named creates verified; host units HC-04 and HC-05 applied with reverts.
- Limits carried to 9.5: the sandbox stays Provisioning until the supervisor reports; the PD-08 stop and start live observation; AuthenticateSandbox (UNIMPLEMENTED, not advertised).
- Next: phase 9.5 (isolation backend and sandbox protocol). Its task-1 evidence decides PD-15 (supervisor placement) and PD-10 (Landlock applier).
- 2026-10-26 phase 9.5 checkpoint (run ut-mvnofqqm-1ab01b71): waves 1, 1b, 1c, 1d, and 1e, and the decoder and validation fixes, are committed (1228c0b, f4c78ac, 69a3c37, 237d743, 686244a, dbea9e8, 0d6e7ec, 835c385, df29a10, 7aa12d1, dfe3050, 538c0ef), with all gates green. The pack check asserts the eight driver protos (6c85e37). Live: the realm gateway runs with the supervisor isolation section; the driver advertises the isolation-backend and launch-authentication capabilities; a sandbox create now succeeds through the gateway. Its launch material is stored at mode 0600 in the secret root, and the container runs the idle init. The sandbox stays Provisioning until a supervisor attaches.
- Launch material, by shape only: supervisor session and generation ids, a gateway token, a sandbox token, an SSH host key, and verification keys. The tokens and the key are secrets. They stay in the secret root and are never printed.
- Host changes for the checkpoint, within HC-04 and HC-05: the driver unit gained REALM_DRIVER_ISOLATION_SOCKET, REALM_DRIVER_ISOLATION_BACKEND_NAME, and REALM_DRIVER_GATEWAY_ID. The gateway configuration gained the supervisor section. The previous configuration file is kept beside it.
- Open for phase 9.5: T0 (the host supervisor run, with names-only evidence); the owner decisions PD-15 and PD-10 after T0; and tasks T3 to T9 (Confirm, StartAgent, exec, mediation, egress, DNS, frames). Suspend and resume stay UNIMPLEMENTED under PD-09.
- Ship: not invoked. The ship hold and the open phases stand.
- 2026-10-26 phase 9.5 T0 finding (read-only, from the v0.1.5 source): the compute driver, not the gateway, launches the host-side supervisor. The driver supplies the auth bundle (the supervisor part of the launch material), a delegated boundary launch (generated by the driver), the backend descriptor (opaque bytes that cross OpenBoundary unchanged), the isolation registrations, and the admitted backend name, which is the environment variable. The SandboxProtocol server (Attach, Confirm, StartAgent, Exchange, Mediate) is the in-container boundary runtime, openshell-sandbox (boundary_server.rs). The host supervisor connects to it. Consequence: a host-only T0 cannot reach Attach or Confirm. Confirm returning UNIMPLEMENTED aborts the supervisor before StartAgent, with no fallback.
- Risk for wave 1b: the driver's backend serves SandboxProtocol.Attach, but the source places that service in the in-container boundary. Attach placement must be re-checked against that topology before any live run.
- Open owner decision: (a) an in-container runtime in the image (PD-16 and HC-08), plus a transport from the host supervisor into the boundary, which changes the hardening surface and needs a new security review; or (b) a scope decision to pause or re-plan phase 9.5 and 9.6. Phase 9.5 is blocked until this is decided.
- Ship: still not invoked. The ship hold and the open phases stand.
- 2026-10-26 owner decision (phase 9.5): build the in-container runtime, and mirror the Docker reference driver. The supervisor starts on the built-in path (backend name openshell-sandbox, a runtime descriptor, and a unix socket in a shared directory). The runtime accepts only that backend name, and the registration rules reserve it, so the registered realm backend cannot reach the container directly. Wave 1 registered-backend code becomes dead and is removed in the wave that adds the built-in path.
- Hardening consequences to verify live: a read-write channel mount for the socket, bootstrap, and TLS files; a tmpfs for the runtime's CA material; a non-root container user equal to the workload identity; the sysctl and loopback DNS checks the runtime makes. Each is an A10 review item.
- 2026-10-26 phase 9.5 T0 (built-in path, live, on the sysctl commit b41889d): the sandbox reached Ready, with ConfigurationReady and Ready both true and the supervisor session connected. The in-container runtime is PID 1 (openshell-sandbox --bootstrap). The host supervisor runs as the realm account, spawned by the driver, with a unix socket to the runtime's control socket and loopback connections to the realm gateway. The workload process runs as uid 1001, with zero effective capabilities, NoNewPrivs 1, and seccomp mode 2. After startup the channel holds only control.sock: the runtime deleted the bootstrap, and the driver removed the TLS key and certificate once the listener was confirmed. Delete removed the container, the artifacts, the state, and the supervisor process.
- PD-08, live: the gateway refused stop on a Ready sandbox in its own state table, and accepted start on a Ready sandbox as a no-op. The driver's StopSandbox and StartSandbox refusal was therefore not reached live. Its unit test covers the refusal. A restart after failure would reach StartSandbox, which the driver refuses under PD-08; that consequence needs an owner decision.
- Open for phase 9.5: Landlock on the workload is not observed live, because the runtime logs at warn level only. The PD-10 and PD-15 decisions are pending. The plan tasks T3 to T9 are provided by the upstream runtime on the built-in path, so an amendment needs owner approval.
- Host changes for the live run, within HC-04 and HC-05: the driver unit gained the sandbox image digest, the gateway CA path and endpoint, and the supervisor binary path, and lost the registered-backend variables. The gateway configuration moved to the built-in selection, and the previous file is kept beside it.
- 2026-10-26 phase 9.5 closed on the amended plan (owner decisions): PD-15 host placement, as observed; PD-10 the runtime's own policy, with the realm helper retired from the workload path; T3 to T9 provided by the upstream runtime; PD-08 refusal kept for now. Live checks for Landlock, egress, frames, and restart move to phase 9.6. Record: .planning/phases/09.5-isolation-backend/09.5-01-VERIFICATION.md.
- Phase 9.6 is next. It needs the live Landlock check (via SSH access for exec or an info-level log), the egress and DNS tests, the frame tests, the PD-08 restart decision, the phase 9.2 in-container probe, the OMP-LIVE items with a live Omp session, realm up and down, and the cutover.
- 2026-10-26 phase 9.6 live findings (facts; commits 7902a48 and dad4399). (1) Exec works after the supervisor SSH socket fix (7902a48). An exec'd process runs as uid 1001, with NoNewPrivs 1 and seccomp mode 2 (six filters), and the workload exit status is propagated (7 observed). (2) Under the realm's rendered policy, /tmp and /workspace are writable, and /etc and /home are read-only (EROFS). The PRD-ENF-03 text that expects /tmp denied predates PD-10. (3) The CLI rejects piped stdin above 4 MiB, so the 16 MiB round trip needs the upload path. (4) IPv6 is enabled inside the sandbox (disable_ipv6 is 0, and ::1 is on lo), which fails RT-05. (5) The create command does not run: with --detach the marker never appears, and without it the CLI opens an interactive shell. The AgentOS runner therefore never starts, and realm up fails with OPENSHELL_START_FAILED. A runner started as a long-lived exec child writes its heartbeat, and the real probe exits 0. (6) The CLI receives only PATH, HOME, and XDG_RUNTIME_DIR, so the realm gateway is registered in the CLI's default config location. (7) /usr/local/bin/podman is 5.7.1, and /usr/bin/podman is 4.9.3, so the realm PATH must put /usr/local/bin first. (8) realm down exits 0, leaves zero containers and sandboxes, and stops the daemon. (9) The realm config image key is cut over to the production digest. Its workloadArgv still names /usr/bin/node and /opt/realm/workload.js, which the image lacks. The AgentOS path does not read it.
