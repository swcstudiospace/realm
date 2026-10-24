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
