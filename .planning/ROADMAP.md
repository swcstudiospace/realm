# Roadmap: Realm

## Overview

Realm moves from frozen contracts and documentation gates to a verified sandbox vertical slice, then to the host surfaces that expose it. Phase 1 freezes the shared contracts and the integration notes that gate every external dependency. Phase 2 builds the policy, state, and filesystem logic that needs no container. Phase 3 adds the rootless Podman container, OpenShell, AgentOS, and the Anda bridge behind the lifecycle controller. Phase 4 adds crash cleanup, default-deny egress, and the single tool dispatcher. Phase 5 exposes that dispatcher through the Omp plugin, MCP, and ACP. Phase 6 adds the standalone CLI, the daemon, and host packaging. Phase 7 documents the policy and records the security review before the first release.

Coverage: 46/46 v1 requirements mapped, each to exactly one phase.

## Phases

- [ ] **Phase 1: Scaffold and Frozen Contracts** - Strict ESM package, test runner, frozen contracts, and integration gate notes
- [ ] **Phase 2: Policy, State, and Filesystem Lockdown** - Policy engine, state machine, event bus, path and write safety, audit redaction, session store, doctor core
- [ ] **Phase 3: Container Runtime and Bridges** - Rootless Podman, OpenShell, AgentOS adapters, Anda bridge, and the lifecycle controller
- [ ] **Phase 4: Reaper, Egress Guard, and Shared Dispatcher** - Orphan reaping, default-deny egress, timeouts, and the single tool dispatcher
- [ ] **Phase 5: Omp Plugin, MCP, and ACP Surfaces** - Detached Omp autostart, status indicator, retry command, and MCP and ACP over one contract
- [ ] **Phase 6: CLI, Daemon, and Host Packaging** - realm up, down, status, doctor, control channel, and host config snippets
- [ ] **Phase 7: Policy Reference and Security Review** - Policy reference, security review, and supply-chain review before first release

## Phase Details

### Phase 1: Scaffold and Frozen Contracts
**Goal:** The repo is a strict ESM TypeScript package with working quality scripts, and every shared contract and integration gate exists before any module code is written.
**Mode:** mvp
**Depends on:** Nothing (first phase)
**Requirements:** FOUND-01, FOUND-02, FOUND-03, QUAL-01
**Success Criteria** (what must be TRUE):
  1. A developer can run the typecheck, lint, test, and build scripts on the ESM strict-mode package, and each one completes with no suppressed errors.
  2. The state table, typed error catalogue, tool schema, session-record schema, and policy schema exist at their specified paths, and contract tests show each schema rejecting a sample invalid input.
  3. Integration notes exist under `docs/integration/` for agentos.md, podman.md, openshell.md, anda.md, omp.md, mcp.md, acp.md, and hosts.md, each citing its official URL and read date, and no integration module exists in the repo without its note.
  4. Every async boundary in the scaffold has a timeout, every error carries a machine-readable code and a human-readable reason, and no silent catch blocks exist.
**Plans**: TBD

### Phase 2: Policy, State, and Filesystem Lockdown
**Goal:** Policy, the six-state machine, the event bus, filesystem safety, audit redaction, the session store, and the doctor core all work and are tested with no container present.
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** CORE-01, CORE-02, CORE-03, CORE-04, CORE-06, FS-01, FS-02, FS-03, FS-04, FS-05, RT-07, TOOL-01, TOOL-02, AUD-01, AUD-02, QUAL-02
**Success Criteria** (what must be TRUE):
  1. State-machine tests cover every allowed and every rejected transition among unbound, connecting, active, degraded, error, and stopping, and each rejected transition returns `REALM_INVALID_TRANSITION`.
  2. The state displays as exactly one of "realm active" or "realm disconnected" from one shared mapping, and every transition publishes an event carrying its reason and last-transition time.
  3. Policy defaults to advisory mode, fail-closed is set per project, `shellEnabled` defaults to false so shell-mode exec is rejected with `SHELL_NOT_ALLOWED`, and tool inputs with unknown keys are rejected with `SCHEMA_INVALID`.
  4. A path that escapes a workspace root, including through a symlink, is rejected with `PATH_ESCAPE`; a credential-shaped path is rejected with `CREDENTIAL_PATH_DENIED` unless the allowlist permits it; a write blocked by a held advisory lock fails with `LOCK_CONFLICT` and leaves the file unchanged; an interrupted atomic write leaves the original file intact and reports `WRITE_NOT_ATOMIC`.
  5. Repeating any lifecycle operation (create, start, health probe, attach, detach, stop, destroy) against the fake runtime returns the same state without duplicating resources, and audit log entries are redacted with no host secrets or environment variables present.
**Plans**: TBD

### Phase 3: Container Runtime and Bridges
**Goal:** Realm runs a rootless, hardened Podman container with OpenShell and AgentOS, reaches Anda through the bridge, and gates file-mutating tools through the lifecycle controller.
**Mode:** mvp
**Depends on:** Phase 2
**Requirements:** CORE-05, RT-01, RT-02, RT-03, RT-04, RT-09, ANDA-01, ANDA-02, ANDA-03, ANDA-04
**Success Criteria** (what must be TRUE):
  1. A file-mutating tool call in a non-active state returns a structured error in required mode, proceeds with a visible warning in advisory mode, and never hangs in either mode.
  2. The prerequisite probe reports `PODMAN_MISSING` or `PODMAN_MACHINE_DOWN` with a human-readable reason, and a running realm container is rootless, digest-pinned, non-privileged, has all capabilities dropped except verified ones, uses a read-only root filesystem with tmpfs scratch space, enforces CPU, memory, and PID limits, and mounts only the bound workspace and the realm state directory.
  3. All agent execution runs through OpenShell inside the container, and AgentOS is managed only through its supported API, restarting with bounded backoff and reporting `AGENTOS_CRASH_LOOP` after the maximum attempts.
  4. The TypeScript Anda client completes a version handshake, a mismatch fails with `ANDA_VERSION_MISMATCH`, and an unreachable bridge reports `ANDA_UNREACHABLE`, moves the state to degraded, and retries in the background with bounded exponential backoff and jitter; the chosen boundary is recorded in `docs/integration/anda-decision.md`.
  5. `realm down` removes every container carrying the realm label and returns the state to disconnected with zero orphan containers, and Podman-gated integration tests skip with a stated reason while Podman is below 5.x (the local Podman 4.9.3 install is not changed).
**Plans**: TBD

### Phase 4: Reaper, Egress Guard, and Shared Dispatcher
**Goal:** Crashed sessions leave nothing behind, the container can reach only allowlisted hosts, and every tool call passes through one dispatcher.
**Mode:** mvp
**Depends on:** Phase 3
**Requirements:** RT-05, RT-08, TOOL-03, TOOL-04
**Success Criteria** (what must be TRUE):
  1. After a crash during `realm up`, the next start reaps containers carrying the realm label and stale session records, and no orphaned container remains.
  2. From inside the container, a request to a non-allowlisted host fails, only configured host and port pairs succeed, IPv6 is disabled, and a configuration that requests host networking is rejected at config load.
  3. Every tool call passes schema validation, state check, lock check, and audit logging in the single shared dispatcher before any sandbox call is made.
  4. A tool call that exceeds its timeout returns `TOOL_TIMEOUT`, and a call made while the state is connecting waits no longer than the bounded queue wait before it is returned.
**Plans**: TBD

### Phase 5: Omp Plugin, MCP, and ACP Surfaces
**Goal:** Omp sessions autostart the realm within a startup budget and show its state, and MCP and ACP expose the same tool logic through the shared dispatcher.
**Mode:** mvp
**Depends on:** Phase 4
**Requirements:** TOOL-05, OMP-01, OMP-02, OMP-03, OMP-04, OMP-05
**Success Criteria** (what must be TRUE):
  1. On each Omp session start with realm configured, the plugin starts or attaches to the realm detached from the UI within `startupBudgetMs`; on overrun the state settles to disconnected with reason `STARTUP_BUDGET_EXCEEDED` and the session continues.
  2. The Omp status indicator shows exactly one label, "realm active" or "realm disconnected", at launch and on every transition, using a text label and a color cue that is readable without color, and its tooltip shows the current reason and the time of the last transition.
  3. The retry command moves disconnected or error to connecting, and then to active or error.
  4. While disconnected, a file write is refused in required mode or proceeds with a visible warning in advisory mode; no file mutation is silently performed outside the realm.
  5. The same tool call returns equivalent results through MCP and through ACP, verified by contract tests, and neither the MCP server nor the ACP adapter contains tool logic.
**Plans**: TBD

### Phase 6: CLI, Daemon, and Host Packaging
**Goal:** Developers run `realm up`, `down`, `status`, and `doctor` from a standalone CLI backed by a long-running local daemon, and each supported host has a config snippet.
**Mode:** mvp
**Depends on:** Phase 5
**Requirements:** RT-06, CLI-01, CLI-02, CLI-03, CLI-04
**Success Criteria** (what must be TRUE):
  1. A developer runs `realm up`, then `realm status` reports realm active, and `realm down` returns the status to realm disconnected, all through the standalone CLI and its long-running local daemon.
  2. With Podman missing, `realm up` reports disconnected with reason `PODMAN_MISSING` and exits without hanging.
  3. `realm doctor` lists Podman, Podman version, machine state, OpenShell, AgentOS, the Anda bridge, the policy file, and the control channel, each with its status and the fix for every failing item.
  4. The host-to-daemon control channel is a user-only Unix socket (directory 0700, socket 0600) under the realm state directory, and neither that socket nor any Podman or Docker socket is visible inside the container.
  5. Config snippets exist under `docs/hosts/snippets/` for Omp, Muse Code, Claude Code, Grok Build, and Hermes Agent, and each matches its host note in `docs/integration/hosts.md`.
**Plans**: TBD

### Phase 7: Policy Reference and Security Review
**Goal:** Every policy key is documented and the security and supply-chain reviews are recorded before the first release.
**Mode:** mvp
**Depends on:** Phase 6
**Requirements:** QUAL-03
**Success Criteria** (what must be TRUE):
  1. The policy reference documents every policy key (workspace roots, credential allowlist, egress allowlist, mode, `shellEnabled`, `startupBudgetMs`, `toolQueueMs`) with its default value and its effect.
  2. A security review and a dependency and supply-chain review are recorded in the repo, and both are complete before the first release is cut.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Scaffold and Frozen Contracts | 0/TBD | Not started | - |
| 2. Policy, State, and Filesystem Lockdown | 0/TBD | Not started | - |
| 3. Container Runtime and Bridges | 0/TBD | Not started | - |
| 4. Reaper, Egress Guard, and Shared Dispatcher | 0/TBD | Not started | - |
| 5. Omp Plugin, MCP, and ACP Surfaces | 0/TBD | Not started | - |
| 6. CLI, Daemon, and Host Packaging | 0/TBD | Not started | - |
| 7. Policy Reference and Security Review | 0/TBD | Not started | - |
