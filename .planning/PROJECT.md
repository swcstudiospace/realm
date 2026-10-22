# Realm

## What This Is

Realm is the agent sandbox component of the USSR Stack (Ultrathink, Substrate, Swarm, Realm). It is a greenfield TypeScript project that runs an agent's execution and file mutations inside a locked-down sandbox: a digest-pinned rootless Podman container, running OpenShell, which runs AgentOS, reached from a TypeScript client that talks to Anda Engine components. It ships as three things: an Omp plugin that autostarts per session, a standalone CLI with a long-running local daemon, and MCP and ACP surfaces so other agent hosts (Muse Code, Claude Code, Grok Build, Hermes Agent, and others) use the same sandbox.

## Core Value

When an agent edits code, every file mutation either lands inside the realm under policy or fails closed, and the user can always see whether the realm is active or disconnected for the session. If everything else fails, this must hold: no silent unsandboxed mutation while the policy requires the realm.

## Requirements

### Validated

- **FOUND-01**: strict ESM package; typecheck, lint, test and build exit 0. Evidence: `.planning/phases/01-scaffold-and-frozen-contracts/01-VERIFICATION.md`
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
- **QUAL-03**: policy reference and reviews. Evidence: `docs/policy-reference.md`, `.planning/phases/07-policy-reference-and-security-review/07-SECURITY-REVIEW.md`, `.planning/phases/07-policy-reference-and-security-review/07-SUPPLY-CHAIN-REVIEW.md`
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
- [ ] Anda Engine TypeScript bridge with version handshake and bounded backoff with jitter
- [ ] Orphan reaper, default-deny egress guard, single shared tool dispatcher
- [ ] Omp plugin: detached autostart under a startup budget, status indicator (realm active / realm disconnected), retry command
- [ ] MCP server and ACP adapter over one tool contract
- [ ] Standalone CLI: realm up, down, status, doctor; host config snippets
- [ ] Integration notes per documentation source, policy reference, security review
- [ ] Unit, state-machine, contract, and Podman-gated integration tests

**Milestone status (2026-10-22):** complete and archived under `.planning/milestones/`. v1.0 is fail-closed: RT-04 and CLI-01 are deferred to a follow-up milestone, and `realm up` refuses with `AGENTOS_NOT_CONFIGURED` until an AgentOS driver exists. QUAL-01 is amended by user decision with a named exception list (2026-10-22). OMP-03 is accepted as an approximation: one status item, detail in its text, no tooltip API on this host (2026-10-22). FS-02 is a Partial accepted approximation that awaits the user's confirmation. The live-gated items are deferred to human verification on a Podman 5.x host: RT-01, RT-02, RT-03, RT-05, RT-08, RT-09, TOOL-03, TOOL-04, TOOL-05, OMP-01, OMP-02, OMP-04, OMP-05, CLI-04, ANDA-01, ANDA-02, ANDA-03, ANDA-04. The milestone name v1.0 is provisional for the 0.1.x release line.

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
- Authoritative product spec: `docs/specs/realm-spec.xml` (read-only source of truth; do not modify). It contains SCOPE, CONSTRAINTS, REALM_SANDBOX, OMP_PLUGIN, HOST_INTEGRATIONS, STATES, SECURITY_AND_VALIDATION, GRACEFUL_DEGRADATION, WORKFLOW, ACCEPTANCE_CRITERIA, OUT_OF_SCOPE, ASSUMPTIONS, AMBIGUITIES, and a graph-of-thought decomposition (nodes n1 to n8).
- Prior art (behavioral reference only, no code copied unless supplied in-session): a C# implementation for OmpOS, and a variant in production in the Grok Bot application for Omega Prime.
- External dependencies, each to be read from official docs and recorded under `docs/integration/` with URL and read date before integration code is written: Rivet (AgentOS), Podman, NVIDIA OpenShell, Anda, the Omp plugin and status API, the MCP specification, the ACP specification, and the Node or Bun constraints of each host.
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
| Default policy mode is advisory with a visible warning; fail-closed is opt-in per project | Decided by the user. Resolves the spec's contradiction between ASSUMPTIONS/POLICY_MODE and GRACEFUL_DEGRADATION | Implemented |
| Podman rootless as the only container engine in v1 | Spec ASSUMPTIONS and CONTAINER_LAYER_PODMAN | — Pending (implementation) |
| Chain is host CLI → Realm core → Podman container (digest-pinned) → OpenShell → AgentOS, with Anda reached from the TypeScript client | Spec LAYER_STACK and n1 minimal path | Confirmed 2026-10-22 (S-08): the OpenShell gateway runs on the host and its Podman driver creates the session container (runtime-decision.md, D-46, D-47) |
| One container per session | n4 recommendation; reversible; keeps locks in the daemon and reaping keyed to the session record | Implemented |
| Control channel is a user-only Unix socket (directory 0700, socket 0600) under the realm state directory; loopback with per-session token is the fallback | n4 recommendation; excludes other local users by filesystem permission | Implemented |
| Anda boundary: TypeScript client over the first documented Anda Engine surface, preferring socket JSON-RPC or HTTP; Rust shim only if no TypeScript-reachable surface is documented | n4 recommendation; decided by the documentation spike | Phase 3: TypeScript client over the Anda HTTP API, no shim (anda-decision.md). Decided 2026-10-22: Anda consumes Realm over MCP (P5-D1, anda-decision.md section 7) |
| AgentOS behind an ExecutionService interface; no actor design until Rivet docs are read | n3 default; AgentOS identity unresolved | — Pending (Rivet doc gate) |
| Vertical slice (up, down, status, doctor on core and runtime) proves the architecture first; plugin, MCP, ACP and locks follow | n1 recommendation; preset roadmap order keeps this sequence | — Pending (roadmap) |
| Omp host-native write/edit tools: disable in required mode (spec q4 recommendation) | Spec CLARIFICATIONS q4 is not decided by the user; recorded as an open question | — Pending (Omp doc gate) |
| Required mode gates writes only; reads stay available while disconnected | n5 default; spec q1 options considered | — Pending (confirm) |
| Podman-gated integration tests skip with a clear reason until Podman 5.x is installed | OpenShell docs require Podman 5.x; local Podman is 4.9.3; no package installs | — Pending (environment) |
| Node LTS with ESM for CLI and daemon; Bun unverified | Spec ASSUMPTIONS and n3 default | — Pending (host doc gate) |
| The daemon owns sessions; surfaces attach through the control socket | User decision, 2026-10-22 (STATE.md). Surfaces attach by calling the idempotent `up`; there is no attach or detach protocol | Decided 2026-10-22 |
| Containment default: advisory is the recorded default | Security review (07-SECURITY-REVIEW.md, section 5.3 and section 8, item 2) recommends fail-closed for containment deployments | Keep advisory as the default (user decision 2026-10-22); fail-closed is the documented opt-in for containment deployments |
| AgentOS path after the no-go spike | User decision, 2026-10-22; spike recommends no-go as designed (docs/integration/agentos.md) | Deferred to a follow-up milestone (2026-10-22). v1.0 fails closed with AGENTOS_NOT_CONFIGURED until a driver exists |
| QUAL-01 silent-catch rule | Nine residual catch sites in eight named exceptions (audit section 6); user decision, 2026-10-22 | Amended 2026-10-22: the rule now names its exceptions |
| OMP-03 tooltip wording | The host offers no tooltip API (P5-D5); user decision, 2026-10-22 | Accepted as an approximation 2026-10-22: one status item, detail in its text |

---
*Last updated: 2026-10-22 after initialization (automatic mode, research skipped by preset)*
