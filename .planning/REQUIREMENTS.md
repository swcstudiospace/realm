# Requirements: Realm

**Defined:** 2026-10-21
**Core Value:** Every file mutation by an agent either lands inside the realm under policy or fails closed, and the user can always see whether the realm is active or disconnected.
**Source:** `docs/specs/realm-spec.xml` (SCOPE, CONSTRAINTS, REALM_SANDBOX, OMP_PLUGIN, HOST_INTEGRATIONS, STATES, SECURITY_AND_VALIDATION, GRACEFUL_DEGRADATION, ACCEPTANCE_CRITERIA). Research was skipped by preset answer; the spec is the requirement basis.

All v1 requirements are hypotheses until shipped and verified.

## v1 Requirements

### Foundation (FOUND)

- [x] **FOUND-01**: Repo is a single ESM TypeScript package at the repo root in strict mode, with typecheck, lint, test, and build scripts that run with no suppressed errors
- [x] **FOUND-02**: Frozen shared contracts exist before parallel work: state table (`src/core/states.ts`), typed error catalogue (`src/core/errors.ts`), tool schema (`src/contract/tools.schema.json`), session-record schema (`src/contract/session-record.schema.json`), policy schema (`src/core/policy.schema.json`)
- [x] **FOUND-03**: Each external dependency (Rivet/AgentOS, Podman, NVIDIA OpenShell, Anda, Omp plugin and status API, MCP, ACP, host runtimes) has an integration note under `docs/integration/` citing its official URL and read date, and no integration module is written before its note exists

### Core (CORE)

- [x] **CORE-01**: State machine models unbound, connecting, active, degraded, error, and stopping, and rejects every disallowed transition with `REALM_INVALID_TRANSITION`; tests cover every allowed and every rejected transition
- [x] **CORE-02**: Exactly one of two display labels, "realm active" or "realm disconnected", is derived from the internal state in one mapping shared by CLI, plugin, and tests, with a reason and a last-transition time
- [x] **CORE-03**: Policy engine defaults to advisory mode (visible warning); fail-closed mode is an opt-in per project; policy keys cover workspace roots, credential allowlist, egress allowlist, `shellEnabled` (default false), `startupBudgetMs`, and `toolQueueMs`
- [x] **CORE-04**: Typed event bus publishes every state transition with its reason
- [x] **CORE-05**: Lifecycle controller gates every file-mutating tool on state `active`; in required mode a non-active state returns a structured error; in advisory mode the write proceeds with a visible warning; a tool call in a non-active state never hangs
- [x] **CORE-06**: Every lifecycle operation (create, start, health probe, attach, detach, stop, destroy) is idempotent

### Filesystem lockdown (FS)

- [x] **FS-01**: Every path is canonicalized against a workspace-root allowlist, resolving symlinks, and any path that escapes the root is rejected with `PATH_ESCAPE`
- [ ] **FS-02**: Path resolution is race-resistant: components are opened relative to a pinned root descriptor with no-follow semantics, so a symlink swapped between check and open is rejected
- [x] **FS-03**: Credential-shaped paths (SSH keys, cloud credential files, `.env` files) are denied by default with `CREDENTIAL_PATH_DENIED`, and a configurable allowlist can permit specific paths
- [x] **FS-04**: Per-file advisory write locks keyed by canonical path; a write that conflicts with a held lock fails with `LOCK_CONFLICT` and leaves the file unchanged; realm writes re-check content hash before rename
- [x] **FS-05**: Writes are atomic: temp file in the same directory, fsync, then rename; an interrupted write before rename leaves the original file intact and reports `WRITE_NOT_ATOMIC`

### Runtime sandbox (RT)

- [ ] **RT-01**: Podman container runs rootless from a digest-pinned image, is never privileged, drops all Linux capabilities and adds back only verified ones, uses a read-only root filesystem with tmpfs scratch space, sets CPU, memory, and PID limits, and mounts only the bound workspace and the realm state directory
- [ ] **RT-02**: Prerequisite probe reports `PODMAN_MISSING` when Podman is absent and `PODMAN_MACHINE_DOWN` when a required machine is not running, with a human-readable reason
- [ ] **RT-03**: OpenShell runs inside the container, and all agent execution is routed through it; no code path bypasses OpenShell
- [ ] **RT-05**: Egress from the container is default-deny; only explicitly configured host and port pairs are allowed; IPv6 is disabled; host networking is rejected at config load; a request to a non-allowlisted host fails
- [x] **RT-06**: Host-to-daemon control channel is a user-only Unix socket (directory 0700, socket 0600) under the realm state directory, or a loopback port with a per-session token; neither the socket nor any Podman or Docker socket is mounted into the container
- [x] **RT-07**: Session record is written to disk before container creation, and records the realm id, session id, workspace root, state, container id, and control socket path, with no secrets
- [ ] **RT-08**: On startup, orphaned containers (by realm label) and stale session records from a previous crash are reaped; a crash during `realm up` is reaped on the next start
- [ ] **RT-09**: `realm down` removes every container carrying the realm label and returns the state to disconnected, leaving zero orphan containers

### Anda bridge (ANDA)

- [ ] **ANDA-01**: TypeScript client connects to Anda Engine components over the boundary confirmed by the Anda documentation, and the chosen boundary and its rationale are recorded in `docs/integration/anda-decision.md`
- [ ] **ANDA-02**: Connection performs a version handshake; a version mismatch fails with `ANDA_VERSION_MISMATCH`
- [ ] **ANDA-03**: Reconnection uses bounded exponential backoff with jitter; an unreachable bridge reports `ANDA_UNREACHABLE`, moves the state to degraded, and retries in the background
- [ ] **ANDA-04**: A Rust shim is added only if the documentation spike shows no TypeScript-reachable surface; if added, it is minimal, lives in `src/anda/native/`, has its own build, and is covered by contract tests from the TypeScript side

### Tool contract and dispatch (TOOL)

- [x] **TOOL-01**: Six tools (exec, read, write with lock, list, status, retry) are defined in one schema; every input is validated before any sandbox call; unknown keys are rejected with `SCHEMA_INVALID`
- [x] **TOOL-02**: Exec is argv-first; shell mode runs only when `policy.shellEnabled` is true and is otherwise rejected with `SHELL_NOT_ALLOWED`
- [ ] **TOOL-03**: A single shared dispatcher applies schema validation, state check, lock check, and audit logging before every sandbox call
- [ ] **TOOL-04**: Every tool call has a timeout; a timeout returns `TOOL_TIMEOUT`, and a bounded queue wait applies while the state is connecting
- [ ] **TOOL-05**: MCP server and ACP adapter both call the same dispatcher and hold no tool logic; the same call returns equivalent results through MCP and ACP

### Audit and secrets (AUD)

- [x] **AUD-01**: Every tool call is appended to a JSONL audit log with secrets redacted before the append
- [x] **AUD-02**: No host environment variables or secrets are injected into the sandbox by default, and no secrets appear in the image, the repo, or logs

### Omp plugin (OMP)

- [ ] **OMP-01**: On each Omp session start with realm configured, the plugin starts or attaches to the realm detached from the UI under a bounded startup budget; on budget overrun the state settles to disconnected with reason `STARTUP_BUDGET_EXCEEDED` and the session continues
- [ ] **OMP-02**: Status indicator shows exactly one label, "realm active" or "realm disconnected", at launch and on every transition, using a text label plus a color cue, readable without color
- [x] **OMP-03**: Status tooltip shows the reason for the current state and the time of the last transition
- [ ] **OMP-04**: A retry command moves disconnected or error to connecting, then to active or error
- [ ] **OMP-05**: When disconnected, the plugin reports it and applies the configured policy; it never silently falls back to unsandboxed file mutation

### CLI and daemon (CLI)

- [x] **CLI-02**: With Podman missing, `realm up` reports disconnected with reason `PODMAN_MISSING` and exits without hanging
- [x] **CLI-03**: `realm doctor` lists each prerequisite (Podman, Podman version, machine state, OpenShell, AgentOS, Anda bridge, policy file, control channel) with its status and the fix for each failing item
- [ ] **CLI-04**: Host config snippets exist under `docs/hosts/snippets/` for Omp, Muse Code, Claude Code, Grok Build, and Hermes Agent, each matching its host note in `docs/integration/hosts.md`

### Quality and documentation (QUAL)

- [x] **QUAL-01**: Every async boundary has a timeout; every error is typed with a machine-readable code and a human-readable reason; the silent-catch rule is amended as below
  Amended by decision: no silent catch blocks exist, except the named exceptions below. Each exception keeps the failure as recorded state or a retry, or fails closed, as stated.
  - (a) `src/anda/client.ts`, `deliver`: a listener throw or rejection leaves the event undelivered for the monitor to retry (2 sites).
  - (b) `src/anda/client.ts`, `stamp`: a clock failure leaves the transition undelivered and unstamped for retry.
  - (c) `src/lifecycle/controller.ts`, `stop`: a stop failure is recovered by the fallback destroy, which succeeds; the stop error is not kept.
  - (d) `src/lifecycle/controller.ts`, `probe`: a probe error is not recorded when a stop already owns the session; the stop's outcome is the session state (documented in the code).
  - (e) `src/omp/plugin.ts`, `attach`: a late rejection from a superseded attempt; the current attempt reports its own outcome.
  - (f) `src/omp/plugin.ts`, `attach`: a late rejection after the attach budget; the budget error is what the status reports.
  - (g) `src/daemon/channel.ts`, and `daemon.ts` `dispatchLine`: a malformed control line whose id cannot be recovered gets no reply; the socket closes. The rule is in the channel comment and in the phase 06 summary.
  - (h) `src/audit/redact.ts`: a value that fails redaction becomes the REDACTED sentinel (fail-closed by design).
- [x] **QUAL-02**: Test suite includes unit tests, state-machine tests, contract tests for MCP and ACP, path and symlink tests, schema-rejection tests, audit-redaction tests, and integration tests that run only when Podman is present and skip with a stated reason otherwise
- [x] **QUAL-03**: Policy reference documents every policy key; security review and dependency and supply-chain review are recorded before the first release

### Deferred to a follow-up milestone

- [ ] **RT-04**: AgentOS is managed only through its supported API; a crash restarts with bounded backoff and reports `AGENTOS_CRASH_LOOP` after the maximum attempts
  Status: Deferred to a follow-up milestone (2026-10-22): no AgentOS driver is bound; realm up fails closed with AGENTOS_NOT_CONFIGURED; the spike recommends no-go as designed (docs/integration/agentos.md).
- [ ] **CLI-01**: `realm up`, `realm down`, `realm status`, and `realm doctor` are available from a standalone CLI backed by a long-running local daemon
  Status: Deferred to a follow-up milestone (2026-10-22): no AgentOS driver is bound; realm up fails closed with AGENTOS_NOT_CONFIGURED; the spike recommends no-go as designed (docs/integration/agentos.md).

## v2.0 Requirements

### Host adapters (HOST)

- [ ] **HOST-01**: Claude Code and Grok Build share one plugin bundle (`adapters/claude-plugin`) whose manifest and MCP entry start `realm mcp`; each host's own validator accepts it
- [ ] **HOST-02**: Muse Code, Hermes Agent, and Prime Agent each have an adapter bundle (`adapters/muse-code`, `adapters/hermes-agent`, `adapters/prime-agent`) and an MCP snippet, each accepted by that host's own validator in an isolated directory
- [ ] **HOST-03**: No host configuration outside this repository is changed without explicit approval; the adapter bundles ship in the npm package and the pack check asserts each manifest

### Omp live verification (OMP-LIVE)

- [ ] **OMP-LIVE-01**: A live Omp session loading the built extension with `-e` under an isolated profile attaches to the Realm daemon for the workspace
- [ ] **OMP-LIVE-02**: When the daemon cannot attach, the status item states disconnected with its reason, never active
- [ ] **OMP-LIVE-03**: The retry command reattaches from disconnected in the same live session
- [ ] **OMP-LIVE-04**: Shutdown of the Omp session leaves the Realm daemon running

### Integrated UI (UI)

- [ ] **UI-01**: The Omp plugin starts on session launch and shows its realm state in the Omp UI status item without blocking the session

## v2 Requirements (deferred)

- **V2-01**: macOS support through Podman machine, verified on a matching Podman machine version
- **V2-02**: One container per workspace granularity with cross-session lock leases and refcounted reaping
- **V2-03**: Per-subagent container isolation built on the existing lock and session model

## Out of Scope

- Building Ultrathink, Substrate, or Swarm — Realm provides seams only; siblings are separate products
- Substrate memory interface or any GSD-Core change — not part of Realm
- Multi-tenant or cloud-hosted realm — v1 is a local single-user sandbox
- Porting the C# OmpOS implementation or Grok Bot variant code — behavioral reference only, no code copied
- UI beyond the status indicator and retry command — explicit spec boundary
- Windows-native support — out of scope unless the session says otherwise
- Container engines other than Podman — Podman is the only v1 engine
- Model tuning or prompt changes — not a Realm concern

## Traceability

Filled by the roadmap. Each v1 requirement maps to exactly one phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Complete |
| FOUND-02 | Phase 1 | Complete |
| FOUND-03 | Phase 1 | Complete |
| CORE-01 | Phase 2 | Complete |
| CORE-02 | Phase 2 | Complete |
| CORE-03 | Phase 2 | Complete |
| CORE-04 | Phase 2 | Complete |
| CORE-05 | Phase 3 | Complete |
| CORE-06 | Phase 2 | Complete |
| FS-01 | Phase 2 | Complete |
| FS-02 | Phase 2 | Partial (accepted approximation; rebind verified through the pinned root, but path canonicalization remains; audit G-10) (pending the user's confirmation of the accepted approximation) |
| FS-03 | Phase 2 | Complete |
| FS-04 | Phase 2 | Complete |
| FS-05 | Phase 2 | Complete |
| RT-01 | Phase 3 | Partial (live-gated) |
| RT-02 | Phase 3 | Partial (live-gated) |
| RT-03 | Phase 3 | Partial (live-gated) |
| RT-04 | Phase 3 | Deferred to a follow-up milestone (2026-10-22): no AgentOS driver is bound; realm up fails closed with AGENTOS_NOT_CONFIGURED; the spike recommends no-go as designed (docs/integration/agentos.md) |
| RT-05 | Phase 4 | Partial (live-gated) |
| RT-06 | Phase 6 | Complete |
| RT-07 | Phase 2 | Complete |
| RT-08 | Phase 4 | Partial (live-gated) |
| RT-09 | Phase 3 | Partial (live-gated) |
| ANDA-01 | Phase 3 | Partial (live-gated) |
| ANDA-02 | Phase 3 | Partial (live-gated) |
| ANDA-03 | Phase 3 | Partial (live-gated) |
| ANDA-04 | Phase 3 | Partial (live-gated) |
| TOOL-01 | Phase 2 | Complete |
| TOOL-02 | Phase 2 | Complete |
| TOOL-03 | Phase 4 | Partial (live-gated) |
| TOOL-04 | Phase 4 | Partial (live-gated) |
| TOOL-05 | Phase 5 | Partial (live-gated) |
| AUD-01 | Phase 2 | Complete |
| AUD-02 | Phase 2 | Complete |
| OMP-01 | Phase 5 | Partial (live-gated) |
| OMP-02 | Phase 5 | Partial (live-gated) |
| OMP-03 | Phase 5 | Complete (accepted approximation, 2026-10-22: one status item, detail in its text; no tooltip API on this host) |
| OMP-04 | Phase 5 | Partial (live-gated) |
| OMP-05 | Phase 5 | Partial (live-gated) |
| CLI-01 | Phase 6 | Deferred to a follow-up milestone (2026-10-22): no AgentOS driver is bound; realm up fails closed with AGENTOS_NOT_CONFIGURED; the spike recommends no-go as designed (docs/integration/agentos.md) |
| CLI-02 | Phase 6 | Complete |
| CLI-03 | Phase 6 | Complete |
| CLI-04 | Phase 6 | Partial (live-gated) |
| QUAL-01 | Phase 1 | Complete (amended 2026-10-22) |
| QUAL-02 | Phase 2 | Complete |
| QUAL-03 | Phase 7 | Complete |
| HOST-01 | Phase 8 | Pending |
| HOST-02 | Phase 8 | Pending |
| HOST-03 | Phase 10 | Pending |
| OMP-LIVE-01 | Phase 9 | Pending |
| OMP-LIVE-02 | Phase 9 | Pending |
| OMP-LIVE-03 | Phase 9 | Pending |
| OMP-LIVE-04 | Phase 9 | Pending |
| UI-01 | Phase 9 | Pending |
