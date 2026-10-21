# Realm

## What This Is

Realm is the agent sandbox component of the USSR Stack (Ultrathink, Substrate, Swarm, Realm). It is a greenfield TypeScript project that runs an agent's execution and file mutations inside a locked-down sandbox: a digest-pinned rootless Podman container, running OpenShell, which runs AgentOS, reached from a TypeScript client that talks to Anda Engine components. It ships as three things: an Omp plugin that autostarts per session, a standalone CLI with a long-running local daemon, and MCP and ACP surfaces so other agent hosts (Muse Code, Claude Code, Grok Build, Hermes Agent, and others) use the same sandbox.

## Core Value

When an agent edits code, every file mutation either lands inside the realm under policy or fails closed, and the user can always see whether the realm is active or disconnected for the session. If everything else fails, this must hold: no silent unsandboxed mutation while the policy requires the realm.

## Requirements

### Validated

(None yet, ship to validate)

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
| Default policy mode is advisory with a visible warning; fail-closed is opt-in per project | Decided by the user. Resolves the spec's contradiction between ASSUMPTIONS/POLICY_MODE and GRACEFUL_DEGRADATION | — Pending (implementation) |
| Podman rootless as the only container engine in v1 | Spec ASSUMPTIONS and CONTAINER_LAYER_PODMAN | — Pending (implementation) |
| Chain is host CLI → Realm core → Podman container (digest-pinned) → OpenShell → AgentOS, with Anda reached from the TypeScript client | Spec LAYER_STACK and n1 minimal path | — Pending (Rivet, Podman, OpenShell, Anda doc gates) |
| One container per session | n4 recommendation; reversible; keeps locks in the daemon and reaping keyed to the session record | — Pending (confirm after doc gates) |
| Control channel is a user-only Unix socket (directory 0700, socket 0600) under the realm state directory; loopback with per-session token is the fallback | n4 recommendation; excludes other local users by filesystem permission | — Pending (confirm after doc gates) |
| Anda boundary: TypeScript client over the first documented Anda Engine surface, preferring socket JSON-RPC or HTTP; Rust shim only if no TypeScript-reachable surface is documented | n4 recommendation; decided by the documentation spike | — Pending (Anda spike, Phase 3) |
| AgentOS behind an ExecutionService interface; no actor design until Rivet docs are read | n3 default; AgentOS identity unresolved | — Pending (Rivet doc gate) |
| Vertical slice (up, down, status, doctor on core and runtime) proves the architecture first; plugin, MCP, ACP and locks follow | n1 recommendation; preset roadmap order keeps this sequence | — Pending (roadmap) |
| Omp host-native write/edit tools: disable in required mode (spec q4 recommendation) | Spec CLARIFICATIONS q4 is not decided by the user; recorded as an open question | — Pending (Omp doc gate) |
| Required mode gates writes only; reads stay available while disconnected | n5 default; spec q1 options considered | — Pending (confirm) |
| Podman-gated integration tests skip with a clear reason until Podman 5.x is installed | OpenShell docs require Podman 5.x; local Podman is 4.9.3; no package installs | — Pending (environment) |
| Node LTS with ESM for CLI and daemon; Bun unverified | Spec ASSUMPTIONS and n3 default | — Pending (host doc gate) |

---
*Last updated: 2026-10-21 after initialization (automatic mode, research skipped by preset)*
