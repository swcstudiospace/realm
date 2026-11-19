# Realm

## What This Is

Realm is the agent sandbox component of the USSR Stack (Ultrathink, Substrate, Swarm, Realm). It is a greenfield TypeScript project that runs an agent's execution and file mutations inside a locked-down sandbox: a digest-pinned rootless Podman container, running OpenShell, which runs AgentOS, reached from a TypeScript client that talks to Anda Engine components. It ships as three things: an Omp plugin that autostarts per session, a standalone CLI with a long-running local daemon, and MCP and ACP surfaces so other agent hosts (Muse Code, Claude Code, Grok Build, Hermes Agent, and others) use the same sandbox.

## Core Value

When an agent edits code, every file mutation either lands inside the realm under policy or fails closed, and the user can always see whether the realm is active or disconnected for the session. If everything else fails, this must hold: no silent unsandboxed mutation while the policy requires the realm.

## Current State

Shipped: **v7.0 Carried findings closure** (2026-11-19, release line 0.7.x), and milestone v8.0 is in progress. Earlier: v6.0 (2026-11-19, 0.6.x), v5.0 (2026-11-18, 0.5.x), v4.0 (2026-11-18, 0.4.x), v3.0 (2026-11-17, 0.3.x) and v2.0 (2026-10-29, releases 0.2.0 to 0.2.3; `CHANGELOG.md` and the GitHub releases). The supported-version statement is in `SECURITY.md` (the latest release line). The record is in `.planning/milestones/`: for example `v6.0-ROADMAP.md`, `v6.0-REQUIREMENTS.md`, `v6.0-MILESTONE-AUDIT.md` and `v6.0-phases/`, and the same set for v2.0 to v5.0 (`v2.0-INTEGRATION-CHECK.md` for v2.0); v7.0 is `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `.planning/v7.0-MILESTONE-AUDIT.md` and `.planning/phases/45-48/`.

What exists, and what was verified live on the production stack (the realm account: rootless Podman 5.7.1, the OpenShell 0.1.5 gateway, the Realm compute driver): `realm up`, `down`, `status`, `doctor`, `mcp` and `acp`; the Omp plugin; adapter bundles for Claude Code, Grok Build, Muse Code, Hermes Agent, Prime Agent and Omp. The MCP server serves both protocol eras, and Claude Code and Grok Build connect to it (connection checks, 2026-10-29). The nine-scenario production live suite passes 31 of 31 on the installed 0.2.1. Releases carry `SHA256SUMS` and a CycloneDX SBOM, and the documentation site deploys from the release job.

Verified only as far as a connection and a scripted run: no LLM-driven tool call has run through any host. A scripted OpenAI-compatible provider drove Omp's own `write` tool through the guard in both modes (2026-10-29), and the findings show that Omp's own tools do not run in the sandbox: the extension registers no tool and only gates `write` and `edit`.

## Current Milestone: v8.0 Shared sandboxes and durable recovery

**Goal:** The eight requirements v7.0 carried get a retest with corrected instruments (Omp calibration, Grok harness fix, stop windows, kimi cause), and two owner-approved (HITL) design phases sketch the shared-sandbox steps: concurrent binding and durable snapshots.

**Target features:**

- Omp calibration repeat (Phase 49): the bracket-arithmetic fix, then a recalibration that can freeze `CALIBRATED_BOUNDS`, resolving OMPV-04 with OMPR-01, OMPR-06 and OI-11 carried honestly
- Grok harness fix and production re-run (Phase 50): create `<grok-home>/.grok` in `productionOverrides` as plan 48-02 owns the wiring, then the live Grok attach and production tier (HTIER-01, HTIER-04; GAP-48-03)
- Rapid stop then up repeat (Phase 51): F-41-1 in fresh windows with the iteration bar met or pins the suspected mechanism hermetically (STOP-01 to STOP-04)
- Legacy kimi cause (Phase 52): the GAP-43-03 cause established or narrowed with a tested reason (KIMV-02)
- Concurrent binding design (Phase 53, HITL owner-approved scope): a frozen design for concurrent binding of sandboxes, with owner decisions settled before code (CBIND-01 to CBIND-02)
- Snapshots design (Phase 54, HITL owner-approved scope): a frozen design for durable workspace snapshots built on the RES-04 checkpoint mechanism, with owner decisions settled before code (SNAP-01 to SNAP-02)

The owner decisions of 2026-11-19 (v8.0 scope; HITL approval of the concurrent-binding and snapshots design phases) are recorded in `.planning/MILESTONE-CONTEXT.md`. The requirement IDs are in `.planning/REQUIREMENTS.md` and the phases (49 to 54) in `.planning/ROADMAP.md`. The ship-flow `--enforce` confirmation of DEBT-03 remains owner-side configuration; carried.

**Carried, not in this milestone** (reasons and owners: `.planning/v7.0-MILESTONE-AUDIT.md`): GAP-48-02/04 (Prime Agent blockers, except as the Grok re-run touches them), GAP-40-01 (accepted-residual unless the Grok re-run produces a live audit line), FS-02 (accepted limitation), UI-01 status (the owner's call; Phase 49 supplies evidence only), Anda items, DEBT-03 ship-flow `--enforce` (unchanged). Owner decisions still open: none blocking; the HITL design decisions of Phases 53 and 54 are taken at their phase discussions and recorded in `MILESTONE-CONTEXT.md`.

## Last Milestone: v7.0 Carried findings closure (shipped 2026-11-19)

**Result:** v7.0 shipped on 2026-11-19 (release line 0.7.x, phases 45 to 48, 11 of 19 requirements ticked Complete; audit `.planning/v7.0-MILESTONE-AUDIT.md`, passed with accepted limitations). Phase 45 ended VOID twice (no frozen bound; OMPR-01/06 + OI-11 stay carried). Phase 46 never reproduced F-41-1 (no STOP met; new finding F-46-1 fixed hermetically). Phase 47 reran the legacy kimi production tier, did not reproduce it (KIMV-02 carried), and recorded which environment names are needed (GAP-43-01 accepted-residual with the manual workaround). Phase 48 promoted Muse Code to `proven`, named Prime Agent's blocker B-48-02, and recorded Grok Build's production failure as a harness defect (GAP-48-03).

**What shipped:**

- Omp responsiveness repeat (Phase 45): feasibility record, hermetic stall probe, scoped harness with attribution — but both calibration windows ended VOID (5/16 counted, 2 passing of 5 needed), so `CALIBRATED_BOUNDS` stays null and no verdict window ran. OMPR-01, OMPR-06 and OI-11 stay carried
- Rapid stop then up (Phase 46): three live windows (OTHER-FAILURE, VOID, VOID) never saw `OPENSHELL_START_FAILED` in 51 immediate ups; F-41-1 stays carried, cause not established. New finding F-46-1 (slow libpod container stop vs a 7 s bound) fixed with a 10 s `containerConfirm` wait (teardown 70 s), red-first, live support weak
- Legacy kimi (Phase 47): kimi-cli 1.51.0 rerun 3/3 ANSWERED but NOT-REPRODUCED and over the test's own bound; cause NOT-ESTABLISHED, GAP-43-03 narrowed. Ablation: `XDG_CONFIG_HOME` + `XDG_RUNTIME_DIR` needed, `REALM_DRIVER_SOCKET` not, no reference expansion — GAP-43-01 accepted-residual with the manual workaround (OD-47-1)
- Host tiers (Phase 48): Muse Code `proven` (cold production pass 1.4.24); Prime Agent blocked B-48-02; Grok Build failed at install on a harness defect (GAP-48-03), validator matrix Outcome A passed but the live audit line is open; GAP-40-01 stays accepted-residual

**Carried, not closed by v7.0:** OMPR-01, OMPR-06, OI-11 (Phase 45 VOID); F-41-1 (never reproduced); GAP-43-03 (open, narrowed); GAP-40-01 + GAP-48-01/03 (Grok live audit + production tier); GAP-48-02/04; FS-02, UI-01, Anda items, DEBT-03 ship-flow `--enforce` (unchanged). Reasons and owners: `.planning/v7.0-MILESTONE-AUDIT.md`.

The owner decisions of 2026-11-19 are recorded in `.planning/MILESTONE-CONTEXT.md`; the v6.0 context is archived at `.planning/milestones/v6.0-MILESTONE-CONTEXT.md`. The requirement IDs (OMPV, STOP, KIMV, HTIER) are in `.planning/REQUIREMENTS.md` and the phases (45 to 48) in `.planning/ROADMAP.md`. The ship-flow `--enforce` confirmation of DEBT-03 is not in this milestone (owner-side configuration; carried).

## Previous Milestone: v6.0 Responsiveness, exec kill proof, host ids and evidence debt (shipped 2026-11-19)


**Result:** v6.0 shipped on 2026-11-19 (release line 0.6.x, phases 38 to 44, 17 of 19 requirements ticked Complete; audit `milestones/v6.0-MILESTONE-AUDIT.md`, passed with accepted limitations). OMPR-01 is carried (not met) and OMPR-06 is partial. The next milestone, v7.0, started the same day by a pull request that set the next minor in `release/milestone.json`.

**What shipped:**

- Omp responsiveness (Phases 38 and 44): the quiet-host window ended VOID (six attempts, one valid run), so OMPR-01 stays not met and OI-11 stays `Carried (no quiet slot)`. By the owner's decision of 2026-11-19 on the loaded evidence, the harness reads the verdict from Omp's ready frame, the daemon launch moved out of the CLI (the extension's value imports 98 to 43) and the attach starts one turn later, fail closed kept; the paired loaded A/B window ended VOID (3 valid pairs of 5), so no effect is claimed (OMPR-06 partial). `src/omp/plugin.ts` is at the 1000-line module ceiling
- Timed-out exec kill proof (Phase 39): a real defect (F-3), a timed-out exec's process tree kept running because the sandbox denies a group kill; every dispatcher exec is now wrapped by an in-sandbox bash `/proc`-sweep watchdog, shown live (tree dead about 3 s after the `TOOL_TIMEOUT` reply)
- Host ids (Phase 40): Muse Code, Prime Agent and Grok Build have host ids and recipes (22 host ids) and attach under the enforce default; GAP-34-01 closed; validator tier only, no production tier, and a Grok Build session that loads the shared Claude files stays attributed `claude` (GAP-40-01)
- Daemon teardown (Phase 41): the slow stop explained (stage bounds summed past the 30 s bound) and bounded, 10 live stops; finding F-41-1 (a start failure after a rapid stop) carried
- Evidence debt (Phase 42): the whole suite as uid 5002 (5542 tests, 0 failures), the breaking-change marker guard (46 tests) and its CI workflow (merged on the owner's review of the exact head); the ship-flow enforce run is unconfirmed (DEBT-03 partial)
- Kimi (Phase 43): Kimi Code 2.6.3 passed all tiers cold; the legacy kimi-cli 1.51.0 production tier failed (cause not established, GAP-43-01 to GAP-43-03)

**v7.0 candidates (taken into v7.0, Phases 45 to 48):** the Omp responsiveness repeat with a harness fix (OMPR-01, OMPR-06, OI-11); F-41-1; the legacy kimi CLI and GAP-43-01; GAP-40-01 and production tiers for Muse Code, Prime Agent and Grok Build. The ship-flow `--enforce` confirmation (DEBT-03) was not ticked and stays carried.

The owner decisions of 2026-11-18 and 2026-11-19 are recorded in `.planning/milestones/v6.0-MILESTONE-CONTEXT.md` and `.planning/milestones/v6.0-MILESTONE-AUDIT.md`; the v5.0 context is archived at `.planning/milestones/v5.0-MILESTONE-CONTEXT.md` and the decisions D1 to D6 of v3.0 (2026-10-29) at `.planning/milestones/v3.0-MILESTONE-CONTEXT.md`. The requirement IDs (OMPR, EXEC, HOSTID, TEAR, DEBT, KIMI) are archived in `.planning/milestones/v6.0-REQUIREMENTS.md` and the phases (38 to 44) in `.planning/milestones/v6.0-ROADMAP.md`.

**Carried, not closed by v6.0** (reasons and owners: `milestones/v2.0-MILESTONE-AUDIT.md`, `milestones/v6.0-MILESTONE-AUDIT.md`): OMPR-01 (the quiet-host Omp cold-attach measurement, Phase 38 VOID) and OMPR-06 (the paired loaded window, Phase 44 VOID), both accepted by the owner on completing v6.0; FS-02 (race-resistant path resolution is an accepted limitation, Phase 27 disposition of 2026-11-17; the property tests of Phase 13 add confidence only), ANDA-01 to ANDA-04 (dropped by owner decision D-27-01, 2026-11-17), PRD-DRV-01 (complete: the owner confirmed its amendment on 2026-11-17) and UI-01 (an accepted limitation; Phase 36 recorded a loaded-host Omp cold-attach run that failed its thresholds, Phase 44 a paired loaded window that ended VOID, and the status stays the owner's call). Owner decisions still open: the product-spec amendment for RT-04, the Podman probe classification, A10 F2 and F3 and the policy file integrity rule (R6), the supply-chain items for the trust channel, install sources and holding the openshell package, the TD-10 repository settings, and the removal of the rollback and builder-cache images. Tech debt outside this milestone: TD-02 (a coordination note in Phase 15) and TD-06.

**Taken into v7.0:** OMPR-01 and OMPR-06 (with OI-11) are taken into Phase 45 (OMPV-01 to OMPV-06); they close only on a valid verdict, never on a VOID outcome or on the hermetic probe alone. F-41-1 is Phase 46 (STOP), GAP-43-01 and GAP-43-03 are Phase 47 (KIMV), and GAP-40-01 is Phase 48 (HTIER).

## Requirements

### Validated

- **FOUND-01**: strict ESM package; typecheck, lint, test and build exit 0. Evidence: `.planning/milestones/v1.0-phases/01-scaffold-and-frozen-contracts/01-VERIFICATION.md`
- **FOUND-02**: frozen contracts and schema rejection. Evidence: `test/core/states.test.ts`, `test/core/policy.schema.test.ts`, `test/contract/tools.schema.test.ts`, `test/contract/session-record.schema.test.ts`
- **FOUND-03**: integration notes with official URL and read date. Evidence: `docs/integration/*.md`
- **CORE-01**: state machine and rejected transitions. Evidence: `test/core/state-machine.test.ts`, `test/core/states.test.ts`
- **CORE-02**: one display-label mapping with reason and transition time. Evidence: `test/core/status.test.ts`
- **CORE-03**: advisory default, fail-closed opt-in, policy keys. Evidence: `test/core/policy.test.ts`, `test/core/fail-closed.test.ts`
- **CORE-04**: typed event bus with transition reasons. Evidence: `test/core/events.test.ts`
- **CORE-05**: mutation gate on state active; bounded queue wait. Evidence: `test/lifecycle/mutation-gate.test.ts`, `test/tools/queue-timeout.test.ts`
- **CORE-06**: idempotent lifecycle operations. Evidence: `test/lifecycle/idempotent.test.ts`
- **FS-01**: root-allowlisted canonical paths, PATH_ESCAPE. Evidence: `test/fs/canonicalize.test.ts`, `test/fs/root.test.ts`
- **FS-03**: credential-path denial. Evidence: `test/fs/deny-credentials.test.ts`
- **FS-04**: advisory write locks and content-hash re-check. Evidence: `test/fs/lock.test.ts`, `test/fs/write.test.ts`
- **FS-05**: atomic writes, WRITE_NOT_ATOMIC. Evidence: `test/fs/atomic-write.test.ts`
- **RT-06**: user-only control socket. Evidence: `test/daemon/channel.test.ts`, `test/doctor/control-channel.test.ts`; closure smoke run (commit 4b1d4ab, state-dir 0700)
- **RT-07**: session record written before container creation. Evidence: `test/session/store.test.ts`
- **AUD-01**: redacted JSONL audit append. Evidence: `test/audit/log.test.ts`, `test/audit/redaction.test.ts`
- **AUD-02**: no host environment injected into the sandbox. Evidence: `test/lifecycle/no-host-env.test.ts`
- **CLI-02**: realm up with Podman missing reports PODMAN_MISSING and exits promptly. Evidence: `test/cli/cli.test.ts`, `test/daemon/e2e.test.ts`
- **CLI-03**: doctor lists each prerequisite with its fix. Evidence: `test/doctor/checks.test.ts`, `test/doctor/runtime-checks.test.ts`; closure smoke run (doctor runs its 9 checks)
- **QUAL-02**: suite taxonomy with Podman-gated skip. Evidence: `test/quality/suite-taxonomy.test.ts`, `test/integration/podman-gate.test.ts`
- **QUAL-03**: policy reference and reviews. Evidence: `docs/policy-reference.md`, `.planning/milestones/v1.0-phases/07-policy-reference-and-security-review/07-SECURITY-REVIEW.md`, `.planning/milestones/v1.0-phases/07-policy-reference-and-security-review/07-SUPPLY-CHAIN-REVIEW.md`
- **TOOL-01**: six tools in one schema; every input validated before any sandbox call. Evidence: `test/contract/tools.schema.test.ts`, `test/contract/tool-input-gate.test.ts`, `test/tools/dispatch.test.ts`
- **TOOL-02**: argv-first exec; shell mode gated by policy. Evidence: `test/contract/exec-policy.test.ts`, `test/contract/tools.schema.test.ts`
- **QUAL-01**: amended by user decision (2026-10-22) with a named silent-catch exception list; typed codes and causes elsewhere. Evidence: `test/lifecycle/teardown-failures.test.ts`, `test/fs/canonicalize.test.ts`, `test/fs/atomic-write.test.ts`; exception list in `.planning/v1.0-MILESTONE-AUDIT.md` section 6
- **OMP-03**: one status item with the reason and transition time in its text (accepted approximation, 2026-10-22; no tooltip API on this host). Evidence: `test/omp/plugin.test.ts`

### Active

The v1 requirement set lives in `.planning/REQUIREMENTS.md` (REQ-IDs grouped by category). The summary below is the scope the spec asks for:

- [ ] Frozen shared contracts: six-state machine, typed error catalogue, tool, session-record and policy schemas
- [ ] Policy engine (advisory default, fail-closed opt-in), state machine, typed event bus, controller
- [ ] Filesystem lockdown: root-allowlisted canonical paths, credential-path deny, advisory write locks, atomic writes
- [ ] Podman rootless, OpenShell and AgentOS runtime adapters with hardening, gated integration tests
- Dropped 2026-11-17 (owner decision D-27-01): the Anda Engine TypeScript bridge with version handshake and bounded backoff with jitter; the bridge was removed in Phase 28 (merged 2026-11-17, release 0.4.x)
- [ ] Orphan reaper, default-deny egress guard, single shared tool dispatcher
- [ ] Omp plugin: detached autostart under a startup budget, status indicator (realm active / realm disconnected), retry command
- [ ] MCP server and ACP adapter over one tool contract. Superseded 2026-10-29: TOOL-05 was proven live (REQUIREMENTS.md).
- [ ] Standalone CLI: realm up, down, status, doctor; host config snippets
- [ ] Integration notes per documentation source, policy reference, security review
- [ ] Unit, state-machine, contract, and Podman-gated integration tests
- [ ] v3.0 (2026-10-29): the eight proposals above, tracked as the v3.0 requirement set in `.planning/REQUIREMENTS.md` (HARN, OMPX, DEF, ONB, CRASH, OBS, MULTI, RES, QR and REL IDs)

**Milestone status (2026-10-22):** complete and archived under `.planning/milestones/`. v1.0 is fail-closed: RT-04 and CLI-01 are deferred to a follow-up milestone, and `realm up` refuses with `AGENTOS_NOT_CONFIGURED` until an AgentOS driver exists. QUAL-01 is amended by user decision with a named exception list (2026-10-22). OMP-03 is accepted as an approximation: one status item, detail in its text, no tooltip API on this host (2026-10-22). FS-02 is a Partial accepted approximation that awaits the user's confirmation. The live-gated items are deferred to human verification on a Podman 5.x host: RT-01, RT-02, RT-03, RT-05, RT-08, RT-09, TOOL-03, TOOL-04, TOOL-05, OMP-01, OMP-02, OMP-04, OMP-05, CLI-04, ANDA-01, ANDA-02, ANDA-03, ANDA-04. Superseded 2026-10-29: TOOL-05 was proven live (REQUIREMENTS.md). The milestone name v1.0 is provisional for the 0.1.x release line.

### Out of Scope

- Building Ultrathink, Substrate, or Swarm. Realm provides seams only. Reason: sibling products; Realm must not depend on any sibling to run.
- Implementing the Substrate memory interface or any GSD-Core changes. Reason: not part of Realm.
- Multi-tenant or cloud-hosted realm. Reason: local single-user sandbox in v1.
- Porting the C# OmpOS implementation or the Grok Bot variant code. Reason: behavioral reference only; no code copied.
- Any UI beyond the status indicator and the retry command. Reason: explicit spec boundary.
- Windows-native support. Reason: out of scope unless the session says otherwise.
- macOS support in v1 (Podman machine path unverified). Reason: Linux is the only verified target; macOS is a later CI matrix item.
- Tuning or prompt changes for any model. Reason: not a Realm concern.
- Per-subagent container isolation. Reason: the lock and session model is designed so it can be added later, nothing more in v1.
- Podman engines other than Podman. Reason: Podman is the only supported container engine in v1.

## Context

- Realm is the fourth component of the USSR Stack. The three siblings are Ultrathink (agent reasoning augmentation), Substrate (unified memory interface for live sessions), and Swarm (subagent chat multithreading for GSD-Core). Realm exposes seams for them but does not implement them.
- Authoritative product spec: `docs/specs/realm-spec.xml` (source of truth; changed only on an explicit owner instruction: the Anda bridge statements were retired on 2026-11-18, Phase 37). It contains SCOPE, CONSTRAINTS, REALM_SANDBOX, OMP_PLUGIN, HOST_INTEGRATIONS, STATES, SECURITY_AND_VALIDATION, GRACEFUL_DEGRADATION, WORKFLOW, ACCEPTANCE_CRITERIA, OUT_OF_SCOPE, ASSUMPTIONS, AMBIGUITIES, and a graph-of-thought decomposition (nodes n1 to n8).
- Prior art (behavioral reference only, no code copied unless supplied in-session): a C# implementation for OmpOS, and a variant in production in the Grok Bot application for Omega Prime.
- External dependencies, each to be read from official docs and recorded under `docs/integration/` with URL and read date before integration code is written: Rivet (AgentOS), Podman, NVIDIA OpenShell, the Omp plugin and status API, the MCP specification, the ACP specification, and the Node or Bun constraints of each host. Anda was a listed dependency until its bridge was removed in v4.0 (D-27-01); Anda may still consume Realm as an MCP client over stdio.
- Local environment observed at initialization: Podman 4.9.3 is installed; OpenShell documentation requires Podman 5.x, so Podman-dependent integration tests are gated and skip with a clear reason until 5.x is present. No packages are installed or upgraded by this project's planning.
- Repository state at initialization: git initialized on branch `main`, remote `origin` set to the Realm GitHub repository. Nothing is pushed or fetched by planning work.
- Ambiguities carried from the spec (see REQUIREMENTS.md and STATE.md for handling): the "ultrathink orchestrate workflowz" prefix is treated as framing only; the unexpanded skill argument is treated as no argument; AgentOS identity (Rivet actor service versus separate product) is resolved by reading Rivet docs; Anda consumption is resolved by the Anda documentation spike.

## Constraints

- **Language and runtime**: TypeScript in strict mode, ESM modules, single package at the repo root; Node LTS for the CLI and daemon; Omp plugin, MCP and ACP per their hosts. Bun is unverified and not assumed. Basis: spec ASSUMPTIONS and preset answers.
- **Container runtime**: Podman rootless is the default and only container engine in v1; no root and no privileged containers; no host Docker or Podman socket mounted into the container. Basis: spec CONTAINER_LAYER_PODMAN.
- **Platform**: Linux is the primary and only verified v1 target. macOS (via Podman machine) and Windows are out of v1 scope unless verified later. Basis: spec PLATFORM_CONSTRAINTS and preset answer.
- **Security boundary**: Fail closed on policy violations; never let file-mutating tools run outside the realm when the active policy requires it; no host secrets injected into the sandbox by default; no secrets in the repo, images, or logs. Basis: spec SYSTEM_ROLE and SECURITY_AND_VALIDATION.
- **Privacy**: no telemetry that sends data off-machine. Basis: spec HARD_LIMITS.
- **Quality**: public APIs typed and documented; every async boundary has a timeout; errors typed with a machine-readable code and a human-readable reason; no silent catch blocks. Basis: spec CONSTRAINTS QUALITY.
- **Verification-first documentation**: no integration code is written from memory; each module waits for its documentation gate file. Unverified items are recorded as open questions, not facts. Basis: spec NO_INVENTED_FACTS and n7.
- **Repository hygiene**: the repo is public. No host-local absolute home-directory paths and no secrets in any committed file. Basis: preset constraint.
- **Scope of changes**: only the `agent-realm` repository is modified; no other repository is touched. Basis: spec HARD_LIMITS.
- **Dependencies**: no package, library, or version is added without verification in its registry or documentation. Basis: spec NO_INVENTED_FACTS.
- **Planning constraints**: this initialization does not run tests, lint, typecheck, or formatters. Local commits are limited to `.planning/` and the project instruction file generated by the workflow. Nothing is pushed. Basis: preset constraint.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Default policy mode is advisory with a visible warning; fail-closed is opt-in per project | Decided by the user. Resolves the spec's contradiction between ASSUMPTIONS/POLICY_MODE and GRACEFUL_DEGRADATION | Implemented. Superseded 2026-10-29 (owner decision D4, v3.0): the default becomes fail-closed and advisory is the explicit opt-in |
| Podman rootless as the only container engine in v1 | Spec ASSUMPTIONS and CONTAINER_LAYER_PODMAN | — Pending (implementation) |
| Chain is host CLI → Realm core → Podman container (digest-pinned) → OpenShell → AgentOS, with Anda reached from the TypeScript client | Spec LAYER_STACK and n1 minimal path | Confirmed 2026-10-22 (S-08): the OpenShell gateway runs on the host and its Podman driver creates the session container (runtime-decision.md, D-46, D-47) |
| One container per session | n4 recommendation; reversible; keeps locks in the daemon and reaping keyed to the session record | Implemented |
| Control channel is a user-only Unix socket (directory 0700, socket 0600) under the realm state directory; loopback with per-session token is the fallback | n4 recommendation; excludes other local users by filesystem permission | Implemented |
| Anda boundary: TypeScript client over the first documented Anda Engine surface, preferring socket JSON-RPC or HTTP; Rust shim only if no TypeScript-reachable surface is documented | n4 recommendation; decided by the documentation spike | Phase 3: TypeScript client over the Anda HTTP API, no shim (anda-decision.md). Decided 2026-10-22: Anda consumes Realm over MCP (P5-D1, anda-decision.md section 7) |
| AgentOS behind an ExecutionService interface; no actor design until Rivet docs are read | n3 default; AgentOS identity unresolved | — Pending (Rivet doc gate) |
| Vertical slice (up, down, status, doctor on core and runtime) proves the architecture first; plugin, MCP, ACP and locks follow | n1 recommendation; preset roadmap order keeps this sequence | — Pending (roadmap) |
| Omp host-native write/edit tools: disable in required mode (spec q4 recommendation) | Spec CLARIFICATIONS q4 is not decided by the user; recorded as an open question | Decided 2026-10-29 (owner decision D3, v3.0): in fail-closed mode the extension may remove or block the built-in `write`, `edit` and `bash` by the mechanism the Phase 12 spike proves; if the API cannot enforce removal, fail-closed stays a guard and the docs say so |
| Required mode gates writes only; reads stay available while disconnected | n5 default; spec q1 options considered | — Pending (confirm) |
| Podman-gated integration tests skip with a clear reason until Podman 5.x is installed | OpenShell docs require Podman 5.x; local Podman is 4.9.3; no package installs | — Pending (environment) |
| Node LTS with ESM for CLI and daemon; Bun unverified | Spec ASSUMPTIONS and n3 default | — Pending (host doc gate) |
| The daemon owns sessions; surfaces attach through the control socket | User decision, 2026-10-22 (STATE.md). Surfaces attach by calling the idempotent `up`; there is no attach or detach protocol | Decided 2026-10-22. Extended 2026-10-29 (owner decision D5, v3.0): the daemon holds one session per project workspace, recorded in `docs/integration/runtime-decision.md` in Phase 18 |
| Containment default: advisory is the recorded default | Security review (07-SECURITY-REVIEW.md, section 5.3 and section 8, item 2) recommends fail-closed for containment deployments | Superseded 2026-10-29 (owner decision D4, v3.0): fail-closed is the default; advisory is the documented opt-in for users who accept host writes while the realm is disconnected (it was the default under user decision 2026-10-22) |
| AgentOS path after the no-go spike | User decision, 2026-10-22; spike recommends no-go as designed (docs/integration/agentos.md) | Deferred to a follow-up milestone (2026-10-22). v1.0 fails closed with AGENTOS_NOT_CONFIGURED until a driver exists |
| QUAL-01 silent-catch rule | Nine residual catch sites in eight named exceptions (audit section 6); user decision, 2026-10-22 | Amended 2026-10-22: the rule now names its exceptions |
| OMP-03 tooltip wording | The host offers no tooltip API (P5-D5); user decision, 2026-10-22 | Accepted as an approximation 2026-10-22: one status item, detail in its text |
| Startup reaper re-adopts a surviving sandbox that passes the hardening verifier; the scratch volume joins the mount list | Owner decision D5 (2026-10-29): the "remove everything" reaper discards a running sandbox and its state after a daemon crash (`ABRUPT-END-PERSISTENCE-FINDINGS.md`) | Approved 2026-10-29; recorded in `docs/integration/runtime-decision.md` in Phase 19, superseding the exact form of D-84, D-86, RT-08 and the RT-01 mount list |
| Error catalogue grows by a code for gateway or driver loss (TD-05) and, if no existing code fits, one for audit reconciliation | Owner decision D5 (2026-10-29): the catalogue is a frozen contract, so additions are approved by name | Approved 2026-10-29; implemented in Phases 14 and 17 |
| Owner sign-off for changes under `.github/workflows`, `release` and `scripts/release` needed by v3.0 | Owner decision D6 (2026-10-29): `AGENTS.md` requires human review for those paths | Signed off 2026-10-29; each such pull request cites D6; repository settings (TD-10) stay the owner's |

---
*Last updated: 2026-11-19 after starting milestone v8.0*
