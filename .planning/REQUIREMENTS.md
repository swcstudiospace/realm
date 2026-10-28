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

- [x] **RT-01**: Podman container runs rootless from a digest-pinned image, is never privileged, drops all Linux capabilities and adds back only verified ones, uses a read-only root filesystem with tmpfs scratch space, sets CPU, memory, and PID limits, and mounts only the bound workspace and the realm state directory
- [x] **RT-02**: Prerequisite probe reports `PODMAN_MISSING` when Podman is absent and `PODMAN_MACHINE_DOWN` when a required machine is not running, with a human-readable reason
- [x] **RT-03**: OpenShell runs inside the container, and all agent execution is routed through it; no code path bypasses OpenShell
- [x] **RT-05**: Egress from the container is default-deny; only explicitly configured host and port pairs are allowed; IPv6 is disabled; host networking is rejected at config load; a request to a non-allowlisted host fails
- [x] **RT-06**: Host-to-daemon control channel is a user-only Unix socket (directory 0700, socket 0600) under the realm state directory, or a loopback port with a per-session token; neither the socket nor any Podman or Docker socket is mounted into the container
- [x] **RT-07**: Session record is written to disk before container creation, and records the realm id, session id, workspace root, state, container id, and control socket path, with no secrets
- [x] **RT-08**: On startup, orphaned containers (by realm label) and stale session records from a previous crash are reaped; a crash during `realm up` is reaped on the next start
- [x] **RT-09**: `realm down` removes every container carrying the realm label and returns the state to disconnected, leaving zero orphan containers

### Anda bridge (ANDA)

- [ ] **ANDA-01**: TypeScript client connects to Anda Engine components over the boundary confirmed by the Anda documentation, and the chosen boundary and its rationale are recorded in `docs/integration/anda-decision.md`
- [ ] **ANDA-02**: Connection performs a version handshake; a version mismatch fails with `ANDA_VERSION_MISMATCH`
- [ ] **ANDA-03**: Reconnection uses bounded exponential backoff with jitter; an unreachable bridge reports `ANDA_UNREACHABLE`, moves the state to degraded, and retries in the background
- [ ] **ANDA-04**: A Rust shim is added only if the documentation spike shows no TypeScript-reachable surface; if added, it is minimal, lives in `src/anda/native/`, has its own build, and is covered by contract tests from the TypeScript side

### Tool contract and dispatch (TOOL)

- [x] **TOOL-01**: Six tools (exec, read, write with lock, list, status, retry) are defined in one schema; every input is validated before any sandbox call; unknown keys are rejected with `SCHEMA_INVALID`
- [x] **TOOL-02**: Exec is argv-first; shell mode runs only when `policy.shellEnabled` is true and is otherwise rejected with `SHELL_NOT_ALLOWED`
- [x] **TOOL-03**: A single shared dispatcher applies schema validation, state check, lock check, and audit logging before every sandbox call
- [x] **TOOL-04**: Every tool call has a timeout; a timeout returns `TOOL_TIMEOUT`, and a bounded queue wait applies while the state is connecting
- [ ] **TOOL-05**: MCP server and ACP adapter both call the same dispatcher and hold no tool logic; the same call returns equivalent results through MCP and ACP
  Status: Partial (2026-10-28): MCP is live (scenario 6 ran exec, write and read through realm mcp against the live sandbox); ACP was not exercised live, so equivalent results through both surfaces are shown at unit level only.

### Audit and secrets (AUD)

- [x] **AUD-01**: Every tool call is appended to a JSONL audit log with secrets redacted before the append
- [x] **AUD-02**: No host environment variables or secrets are injected into the sandbox by default, and no secrets appear in the image, the repo, or logs

### Omp plugin (OMP)

- [x] **OMP-01**: On each Omp session start with realm configured, the plugin starts or attaches to the realm detached from the UI under a bounded startup budget; on budget overrun the state settles to disconnected with reason `STARTUP_BUDGET_EXCEEDED` and the session continues
- [x] **OMP-02**: Status indicator shows exactly one label, "realm active" or "realm disconnected", at launch and on every transition, using a text label plus a color cue, readable without color
- [x] **OMP-03**: Status tooltip shows the reason for the current state and the time of the last transition
- [x] **OMP-04**: A retry command moves disconnected or error to connecting, then to active or error
- [ ] **OMP-05**: When disconnected, the plugin reports it and applies the configured policy; it never silently falls back to unsandboxed file mutation
  Status: Partial (2026-10-28): the guard is unit-verified for write and edit. A live check needs a model call, and the model provider is out of quota. Paths that do not go through the extension are unproven.

### CLI and daemon (CLI)

- [x] **CLI-02**: With Podman missing, `realm up` reports disconnected with reason `PODMAN_MISSING` and exits without hanging
- [x] **CLI-03**: `realm doctor` lists each prerequisite (Podman, Podman version, machine state, OpenShell, AgentOS, Anda bridge, policy file, control channel) with its status and the fix for each failing item
- [x] **CLI-04**: Host config snippets exist under `docs/hosts/snippets/` for Omp, Muse Code, Claude Code, Grok Build, and Hermes Agent, each matching its host note in `docs/integration/hosts.md`

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

### Deferred on 2026-10-22, built in phase 9

- [x] **RT-04**: AgentOS is managed only through its supported API; a runner that exits while the session is active moves the session to error with `AGENTOS_CRASH_LOOP` within the health interval (10 s); one failed probe is terminal and there is no automatic restart; recovery is `realm down` then `realm up`, or the retry command
  Status: Complete (live 2026-10-28: suite scenario 8 and the Omp status item). Wording amended by owner decision of 2026-10-28 to match owner ruling N1 (no restart, no hysteresis; cited in `src/daemon/daemon.ts`). The original text, "a crash restarts with bounded backoff and reports `AGENTOS_CRASH_LOOP` after the maximum attempts", was deferred on 2026-10-22 and never implemented.
- [x] **CLI-01**: `realm up`, `realm down`, `realm status`, and `realm doctor` are available from a standalone CLI backed by a long-running local daemon
  Status: Complete (live 2026-10-28): up, down, status and doctor ran from the standalone CLI against the production stack with the long-running daemon. The 2026-10-22 deferral no longer applies: the driver is bound from the configured image.

## v2.0 Requirements

### Host adapters (HOST)

- [x] **HOST-01**: Claude Code and Grok Build share one plugin bundle (`adapters/claude-plugin`) whose manifest and MCP entry start `realm mcp`; each host's own validator accepts it
- [x] **HOST-02**: Muse Code, Hermes Agent, and Prime Agent each have an adapter bundle (`adapters/muse-code`, `adapters/hermes-agent`, `adapters/prime-agent`) and an MCP snippet, each accepted by that host's check in an isolated directory: the host's own validator where it has one (`MUSE_EXPERIMENTAL_PLUGINS=1 muse plugins validate` for Muse Code, `hermes plugins validate` for Hermes Agent), and for Prime Agent, which has no validator subcommand, an isolated project-local `prime-agent package install <repo>/adapters/prime-agent --local` followed by `prime-agent package list` (wording amended by owner decision, 2026-10-24)
- [x] **HOST-03**: No host configuration outside this repository is changed without explicit approval; the adapter bundles ship in the npm package and the pack check asserts each manifest

### Omp live verification (OMP-LIVE)

- [x] **OMP-LIVE-01**: A live Omp session loading the built extension with `-e` under an isolated profile attaches to the Realm daemon for the workspace (reinstated by the owner, 2026-10-25; verified live on the final build, 2026-10-28: the status item shows realm active)
- [x] **OMP-LIVE-02**: When the daemon cannot attach, the status item states disconnected with its reason, never active
- [x] **OMP-LIVE-03**: The retry command reattaches from disconnected in the same live session (reinstated by the owner, 2026-10-25; verified live on the final build, 2026-10-28: after realm down the item shows disconnected with REALM_NOT_ACTIVE, and the retry command returns it to active)
- [x] **OMP-LIVE-04**: Shutdown of the Omp session leaves the Realm daemon running (reinstated by the owner, 2026-10-25; verified live on the final build, 2026-10-28: the same daemon process still runs and reports active after Omp exits)

### Integrated UI (UI)

- [ ] **UI-01**: The Omp plugin starts on session launch and shows its realm state in the Omp UI status item without blocking the session (accepted limitation by owner decision, 2026-10-23: the status item appears at launch; a non-blocking check was not demonstrated, because get_state took about 6 s during the attach and the cause is not isolated; re-measured 2026-10-28: keystrokes echoed within 0.2 to 1.2 s through a 24 s cold attach on a loaded host, which bounds the stall but does not prove the loop is never blocked)

### Production isolation build (PRD)

- [x] **PRD-HOST-01**: The realm account runs its rootless Podman API as a user-manager unit with cgroup delegation, runc is configured for that account, `podman --remote info` reports rootless true, a 5.x version, and runtime runc, and CPU, memory, and PID limits are enforceable (Phase 9.1)
- [x] **PRD-HOST-02**: The rootless API, its unit, and linger survive a host reboot without a manual step (Phase 9.1)
- [x] **PRD-GW-01**: The realm gateway serves TLS with a server certificate and a client CA from the realm state directory, and the production profile never writes `disable_tls` (Phase 9.1)
- [x] **PRD-GW-02**: The realm gateway signs sandbox bearers with JWT keys (signing key, public key, and kid) held in the realm state directory with user-only permissions; no key value appears in the repository (Phase 9.1)
- [x] **PRD-GW-03**: The realm gateway's compute driver is the realm driver, and the driver's advertised name and resource admission acknowledgement match the gateway's expected policy (Phase 9.4)
- [x] **PRD-GW-04**: The realm gateway selects the built-in sandbox runtime as its isolation backend and renders no supervisor isolation-backend section (amended by owner decision, 2026-10-26: the registered realm backend was removed) (Phase 9.5)
- [ ] **PRD-DRV-01**: The realm compute driver serves ComputeDriver gRPC on a Unix socket in a 0700 directory with mode 0600, implementing GetCapabilities, ValidateSandboxCreate, CreateSandbox, GetSandbox, ListSandboxes, DeleteSandbox, WatchSandboxes, and EnsureWorkspace. AuthenticateSandbox is not advertised and returns UNIMPLEMENTED, because the gateway does not call it on the built-in path, and DeleteWorkspace refuses, because the driver never creates or removes the pinned workspace root. This amendment follows from the owner decisions of 2026-10-26 and 2026-10-27 and awaits the owner's confirmation (Phase 9.4)
- [x] **PRD-DRV-02**: ValidateSandboxCreate and CreateSandbox refuse, before any libpod call, a request whose image digest, CPU, memory, network mode, mounts, or capabilities differ from the realm profile (amended 2026-10-28: the create path carries no workload argv) (Phase 9.4)
- [x] **PRD-DRV-03**: StopSandbox and StartSandbox return the status decided in PD-08 and change no sandbox state (Phase 9.4)
- [x] **PRD-CTR-01**: CreateSandbox creates and starts a container whose PID 1 is the sandbox runtime (amended by owner decisions of 2026-10-26 and 2026-10-28: the idle init and the helper no longer exist), reads the kernel capability sets of its init process on the host, and verifies the hardening properties; when any property fails it removes the container and returns an error naming the property (Phase 9.3)
- [x] **PRD-CTR-02**: DeleteSandbox removes the sandbox's container and its launch and active state; afterwards no realm-labelled container for that sandbox exists (Phase 9.3)
- [x] **PRD-CTR-03**: The driver removes realm-labelled containers left by a previous generation before it accepts requests (Phase 9.3)
- [x] **PRD-CTR-04**: Containers carry the OpenShell labels that existing realm code reads (managed, sandbox name, and isolation role) (Phase 9.3)
- [x] **PRD-CTR-05**: The sandbox image is a derived image pinned by digest, contains the runtime, the AgentOS runner and probe, and the resolver file, and mounts no socket (amended 2026-10-28: the helper was removed) (Phase 9.3)
- [x] **PRD-ENF-01**: Superseded by owner decision, 2026-10-28: the runtime's own policy (Landlock, seccomp, no_new_privs) is the enforcement authority and the realm helper was removed, so the original wording (the helper applies no_new_privs, a Landlock ruleset, and a seccomp denylist) no longer applies (Phase 9.2)
- [x] **PRD-ENF-02**: Superseded by owner decision, 2026-10-28: the realm helper was removed with its image stages, so there is no helper to build or record; it stays recoverable from git history (Phase 9.2)
- [x] **PRD-ENF-03**: An in-sandbox probe shows, under the realm policy, that /tmp, /workspace and /dev/null are writable, /etc and /home are read-only, keyctl, add_key and request_key fail with EPERM, and the workload reports NoNewPrivs 1, Seccomp 2 and no capabilities (amended by owner decisions, 2026-10-26 and 2026-10-28; live in Phase 9.6)
- [x] **PRD-ISO-01**: Superseded by owner decision, 2026-10-26: the isolation backend is the upstream runtime on the built-in path, and the realm implements no IsolationBackend server (Phase 9.5)
- [x] **PRD-ISO-02**: Superseded by owner decision, 2026-10-26: the SandboxProtocol server is the upstream in-container runtime, and the realm implements none of its frames (Phase 9.5)
- [x] **PRD-ISO-03**: Superseded by owner decision, 2026-10-26: the runtime is PID 1 and starts the workload, and the realm starts its AgentOS runner as a managed exec child through OpenShell exec once the sandbox is Ready (Phase 9.5)
- [x] **PRD-ISO-04**: A 16 MiB file uploaded into the sandbox and downloaded again reads back byte for byte, with SHA-256 compared on both sides (amended by owner decision, 2026-10-26); the control and I/O frame limits belong to the upstream runtime and are not asserted here (Phase 9.5)
- [x] **PRD-ISO-05**: Egress is default-deny: the sandbox has no network interface, names answer synthetically from 198.18.0.0/15 and are never forwarded, a connection to a non-allowlisted host fails at connect time, an allowlisted host:port connects, and AAAA returns no data (amended 2026-10-28 on live evidence) (Phase 9.5)
- [x] **PRD-ISO-06**: Superseded by owner decision, 2026-10-26: the driver holds no sandbox handles on the built-in path (Phase 9.5)
- [x] **PRD-SUP-01**: The OpenShell supervisor's process placement and network path are recorded from a live attach, and RT-03 is judged against that record under PD-15 (Phase 9.5)
- [x] **PRD-LIB-01**: The gRPC runtime and loader are exact pins with their licence and audit recorded; the OpenShell protos the driver uses are vendored at a recorded revision with per-file digests and shipped in the package (Phase 9.4)
- [x] **PRD-TST-01**: Every module added in phases 9.1 to 9.5 has unit tests that run under `npm test` with no host dependency (Phase 9.6)
- [x] **PRD-TST-02**: A gated live suite (`test/integration/production-driver.test.ts`), skipped in CI and by default, runs six scenarios on the realm host: default-policy confinement with the workspace, runner probe, exit status, and 16 MiB transfer; an immediate down then up; an egress allowlist with the synthetic resolver; a wrong image digest; crash recovery after the daemon is killed; and MCP exec, write, and read (amended by owner decisions, 2026-10-26 and 2026-10-28) (Phase 9.6)
- [x] **PRD-TST-03**: `realm up`, `realm status`, and `realm down` pass on the production stack; `realm down` leaves zero realm containers; a wrong image digest makes `realm up` fail closed with no container left (Phase 9.6)
- [x] **PRD-OMP-01**: OMP-LIVE-01, OMP-LIVE-03, and OMP-LIVE-04 are verified live on the final build (reinstated by the owner on 2026-10-25, which supersedes PD-14) (Phase 9.6)
- [x] **PRD-DOC-01**: The integration docs and `AGENTS.md` match the production layout and evidence with no host path; `CHANGELOG.md` and package version fields are not edited (Phase 9.6)
- [x] **PRD-CLEAN-01**: Code that only the built-in driver path required is removed; no compatibility shim or fallback remains (Phase 9.6)

### Review-finding remediation (REM)

- [x] **REM-01**: The A10 boundary findings that are code defects are fixed with a regression test each: nested user namespaces and the mount family are denied by the seccomp profile, the create-time verifier asserts the added properties, the container spec bounds tmpfs size, swap and rlimits, the workspace scan refuses a mount on another device at create time (same-filesystem bind mounts are not detected), private and special egress literals are refused, atomic writes are pinned to the checked directory, audit lines are fsynced, and the credential deny list covers keys, certificates and registry tokens (Phase 9.7)
- [x] **REM-02**: Host binaries and the sandbox image have recorded provenance: an optional supervisor digest pin is enforced at start and at spawn, `realm doctor` reports host binary versions and digests and the ptrace scope, the image build gates its inputs and compiles the runner in the image, expected digests are committed with a verifier and a build command that reads them, and CI pins actions to commit SHAs with job timeouts and an explicit read-only permission for the verify job (the Pages workflow keeps its original permissions) (Phase 9.7)
- [x] **REM-03**: A runner that exits while the session is active moves the status to disconnected with AGENTOS_CRASH_LOOP within the health interval, so the label never says active for a dead runner; proven in the live suite and in the Omp status item (Phase 9.7)
- [x] **REM-04**: The live-gated requirements RT-02, RT-04, CLI-01, CLI-04, TOOL-03, TOOL-04, TOOL-05, OMP-01, OMP-02 and OMP-04 carry statuses that match their evidence, and the clauses that need a model call, an ACP session or an Anda engine are stated as the limit (Phase 9.7)
- [x] **REM-05**: Planning and integration records match the code: the stale bindRoot, 5.2, 5.4 and R7 rows, the AGENTS.md environment-read entry edges, and the RT-04 wording (Phase 9.7)

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
| FS-02 | Phase 2 | Partial (accepted approximation, confirmed by the owner 2026-10-23; rebind verified through the pinned root; check-to-use windows remain on the read and write paths; audit G-10) |
| FS-03 | Phase 2 | Complete |
| FS-04 | Phase 2 | Complete |
| FS-05 | Phase 2 | Complete |
| RT-01 | Phase 3 | Complete (live 2026-10-28: the create-time verifier passes on every live create; CapEff 0 and CapBnd 0; rootless Podman 5.7.1; digest-pinned image; limits enforced) |
| RT-02 | Phase 3 | Complete (live 2026-10-28: PODMAN_MISSING with no podman on PATH and PODMAN_MACHINE_DOWN with an empty XDG_RUNTIME_DIR, each exit 1 with a human-readable reason; no daemon and no control socket created) |
| RT-03 | Phase 3 | Complete on the built-in path (live 2026-10-28: the runtime is PID 1 and the runner and every exec run through OpenShell exec via the gateway and supervisor; no container-runtime exec route exists; PD-15 decided; wording not amended) |
| RT-04 | Phase 3 | Complete (live 2026-10-28: a runner exit moves the session to error with AGENTOS_CRASH_LOOP within the 10 s health interval, scenario 8 and the Omp status item; wording amended by owner decision 2026-10-28 to match ruling N1: no automatic restart) |
| RT-05 | Phase 4 | Complete (live 2026-10-28, scenario 3: default-deny, allowlisted host:port connects, non-allowlisted host fails with EACCES, IPv6 off; host networking rejected at config load by unit test) |
| RT-06 | Phase 6 | Complete |
| RT-07 | Phase 2 | Complete |
| RT-08 | Phase 4 | Complete (live 2026-10-28, scenario 5: after a SIGKILL of the daemon the next realm up reaps the leftover and reaches active with one sandbox) |
| RT-09 | Phase 3 | Complete (live 2026-10-28: realm down leaves zero containers, sandboxes, supervisors, state and secret directories in every live scenario) |
| ANDA-01 | Phase 3 | Partial (live-gated) |
| ANDA-02 | Phase 3 | Partial (live-gated) |
| ANDA-03 | Phase 3 | Partial (live-gated) |
| ANDA-04 | Phase 3 | Partial (live-gated) |
| TOOL-01 | Phase 2 | Complete |
| TOOL-02 | Phase 2 | Complete |
| TOOL-03 | Phase 4 | Complete (unit-verified; live 2026-10-28, scenario 6: exec, write and read dispatched through realm mcp against the live sandbox) |
| TOOL-04 | Phase 4 | Complete (live 2026-10-28, scenario 7: an exec past the per-call bound returns a retryable TOOL_TIMEOUT and the session stays usable; the bounded queue wait while connecting is unit-verified) |
| TOOL-05 | Phase 5 | Partial (MCP live 2026-10-28, scenario 6; ACP is unit-verified only, so equivalence through both surfaces is not shown live) |
| AUD-01 | Phase 2 | Complete |
| AUD-02 | Phase 2 | Complete |
| OMP-01 | Phase 5 | Complete (live 2026-10-28: the plugin attached and the item read realm active; the daemon survived Omp quitting; the daemon-side startup budget overrun settles to STARTUP_BUDGET_EXCEEDED, scenario 9; the plugin's own 200 s timer is unit-verified) |
| OMP-02 | Phase 5 | Complete (live 2026-10-28: one label at a time through connecting, active, error and disconnected; marker glyph and label read in a text pane; the colour cue was not captured) |
| OMP-03 | Phase 5 | Complete (accepted approximation, 2026-10-22: one status item, detail in its text; no tooltip API on this host) |
| OMP-04 | Phase 5 | Complete (live 2026-10-28: from error and from disconnected the retry command went to connecting and then active in the same Omp session) |
| OMP-05 | Phase 5 | Partial (unit-verified; live needs a model call, which is unavailable; paths outside the extension are unproven) |
| CLI-01 | Phase 6 | Complete (live 2026-10-28: up, down, status and doctor from the standalone CLI against the production stack, with the long-running daemon) |
| CLI-02 | Phase 6 | Complete |
| CLI-03 | Phase 6 | Complete |
| CLI-04 | Phase 6 | Complete (snippets exist and match their host notes; check:docs and check:pack exit 0; only the Omp host was driven live) |
| QUAL-01 | Phase 1 | Complete (amended 2026-10-22) |
| QUAL-02 | Phase 2 | Complete |
| QUAL-03 | Phase 7 | Complete |
| HOST-01 | Phase 8 | Complete (Claude Code validate passes with 2 warnings; Grok validate passes; MCP entry is realm mcp) |
| HOST-02 | Phase 8 | Complete (2026-10-24: Claude Code, Grok Build, Muse Code, and Hermes Agent validators pass in isolated homes; Prime Agent isolated install and list pass; wording amended by owner decision 2026-10-24) |
| HOST-03 | Phase 10 | Complete (audit 2026-10-28, 10-03-SUMMARY.md: no host configuration file in either account names this repository or the realm entry points; the five Claude Code backups that exist all date from the same day, were written by running Claude Code instances, and name nothing of this repository; check:pack asserts the six adapter manifests, the declared bin and Omp entries; the release itself, plan 04, stays held by the owner's ship hold) |
| OMP-LIVE-01 | Phase 9 | Complete (live 2026-10-28 on the final build: a live Omp TUI under an isolated profile with the built extension shows realm active; reinstated by the owner 2026-10-25) |
| OMP-LIVE-02 | Phase 9 | Complete (live 2026-10-23: disconnected with the daemon's own reason, never active; re-run 2026-10-24 on Podman 5.7.1: disconnected with SCHEMA_INVALID, never active) |
| OMP-LIVE-03 | Phase 9 | Complete (live 2026-10-28: after realm down the item shows disconnected with REALM_NOT_ACTIVE, and the retry command returns it to active in the same session; reinstated 2026-10-25) |
| OMP-LIVE-04 | Phase 9 | Complete (live 2026-10-28: after Omp exits the same daemon process is running and realm status reports active; reinstated 2026-10-25) |
| UI-01 | Phase 9 | Accepted limitation (owner decision 2026-10-23): status item at launch; re-measured 2026-10-28: keystrokes echoed within 0.2 to 1.2 s through a 24 s cold attach on a loaded host, which bounds the stall but does not prove non-blocking; the status stays the owner's call |
| PRD-HOST-01 | Phase 9.1 | Complete (live 2026-10-25: rootless true, Podman 5.7.1, runc; memory.max 1073741824, pids.max 512, cpu.max 200000 100000) |
| PRD-HOST-02 | Phase 9.1 | Complete (live 2026-10-25 reboot: linger, unit and socket back with no manual step; one self-recovered first-start reexec line) |
| PRD-GW-01 | Phase 9.1 | Complete (gateway-config tests; preflight exit 0; live under production TLS) |
| PRD-GW-02 | Phase 9.1 | Complete (private keys 0600 in 0700 directories; public key and kid 0644; no key value in the repository) |
| PRD-GW-03 | Phase 9.4 | Complete (admission tests; live "configured_driver=realm advertised_driver=realm", 2026-10-25) |
| PRD-GW-04 | Phase 9.5 | Complete as amended (owner decision 2026-10-26: built-in selection "openshell-sandbox", no registered backend; gateway-config tests) |
| PRD-DRV-01 | Phase 9.4 | Open: socket 0700/0600 verified live and in tests, AuthenticateSandbox UNIMPLEMENTED and not advertised, DeleteWorkspace refuses; the amendment follows from the owner decisions of 2026-10-26 and 2026-10-27 and awaits confirmation |
| PRD-DRV-02 | Phase 9.4 | Complete (unit-verified with a spy lifecycle that makes zero libpod calls; live: a wrong image digest fails closed at the driver's create.image gate with zero containers, 2026-10-28) |
| PRD-DRV-03 | Phase 9.4 | Complete, unit-verified (PD-08 over the wire); live the gateway answers before the driver, so the driver's refusal was not reached |
| PRD-CTR-01 | Phase 9.3 | Complete as amended (runtime is PID 1; per-property unit tests; live: the verifier passes on every create, CapEff 0 and CapBnd 0, 2026-10-28) |
| PRD-CTR-02 | Phase 9.3 | Complete (unit; live 2026-10-25; realm down leaves zero residue in every live scenario, 2026-10-28) |
| PRD-CTR-03 | Phase 9.3 | Complete (unit; live 2026-10-25; crash recovery after a SIGKILL of the daemon, live scenario 5, 2026-10-28) |
| PRD-CTR-04 | Phase 9.3 | Complete (create-body labels; unit; live 2026-10-25) |
| PRD-CTR-05 | Phase 9.3 | Complete as amended (digest-pinned derived image, no socket mount, no helper; live 2026-10-28) |
| PRD-ENF-01 | Phase 9.2 | Superseded (owner decision 2026-10-28: runtime policy is the enforcement authority; helper removed in commit c0a071b) |
| PRD-ENF-02 | Phase 9.2 | Superseded (owner decision 2026-10-28: no helper to build; recoverable at commit 497b63f) |
| PRD-ENF-03 | Phase 9.2 | Complete as amended (live 2026-10-28: /tmp, /workspace and /dev/null writable; /etc and /home read-only; keyctl, add_key and request_key EPERM; NoNewPrivs 1; Seccomp 2; scenario 1) |
| PRD-ISO-01 | Phase 9.5 | Superseded (owner decision 2026-10-26: the isolation backend is the upstream runtime) |
| PRD-ISO-02 | Phase 9.5 | Superseded (owner decision 2026-10-26: the SandboxProtocol server is the upstream runtime) |
| PRD-ISO-03 | Phase 9.5 | Superseded (owner decision 2026-10-26: the runtime is PID 1; the runner starts as a managed exec child once Ready) |
| PRD-ISO-04 | Phase 9.5 | Complete as amended (16 MiB upload and download byte-identical with SHA-256 on both sides, live scenario 1; frame limits are the upstream runtime's and are not asserted) |
| PRD-ISO-05 | Phase 9.5 | Complete as amended (live 2026-10-28, scenario 3: default-deny; synthetic answers from 198.18.0.0/15, never forwarded, confirmed by a packet capture; connect-time refusal; AAAA no data) |
| PRD-ISO-06 | Phase 9.5 | Superseded (owner decision 2026-10-26: the driver holds no handles on the built-in path) |
| PRD-SUP-01 | Phase 9.5 | Complete (host placement decided under PD-15, 2026-10-26, and observed live; the runner's exec child goes through OpenShell exec, not a container-runtime exec, so the no podman exec route decision stands) |
| PRD-LIB-01 | Phase 9.4 | Complete (exact pins grpc-js 1.14.6 and proto-loader 0.8.1; per-file proto digests; pack check; audit 0 vulnerabilities, 2026-10-25; two protos used only by the removed backend were removed on 2026-10-28) |
| PRD-TST-01 | Phase 9.6 | Complete, unit-verified (full gates at the final commit are recorded in the phase verification file) |
| PRD-TST-02 | Phase 9.6 | Complete (live 2026-10-28 at d2db549: 28 of 28 assertions across the six scenarios, and scenario 5 passed 3 of 3 more times alone; zero residue after each run; phase 9.7: nine scenarios, 31 of 31 assertions on the rebuilt image) |
| PRD-TST-03 | Phase 9.6 | Complete (live 2026-10-28: up, status and down; zero residue after down; a wrong image digest fails closed; scenarios 1, 2 and 4) |
| PRD-OMP-01 | Phase 9.6 | Complete (the owner's reinstatement of 2026-10-25 supersedes PD-14; the three checks were run live on the final build, 2026-10-28) |
| PRD-DOC-01 | Phase 9.6 | Complete (integration docs, AGENTS.md and README refreshed; check:docs passes; no host path; CHANGELOG and package version fields untouched) |
| PRD-CLEAN-01 | Phase 9.6 | Complete (the second sandbox and the workload command, the helper, the superseded v1.0 live bodies, and the protos used only by the removed backend were removed; defensive refusals such as AGENTOS_NOT_CONFIGURED are kept by design) |
| REM-01 | Phase 9.7 | Complete (see 09.7-VERIFICATION.md) |
| REM-02 | Phase 9.7 | Complete (see 09.7-VERIFICATION.md) |
| REM-03 | Phase 9.7 | Complete (live: suite scenario 8 and the Omp status item) |
| REM-04 | Phase 9.7 | Complete (statuses above; TOOL-05 and OMP-05 stay partial with their limits stated) |
| REM-05 | Phase 9.7 | Complete (see 09.7-VERIFICATION.md) |
