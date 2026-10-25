# Roadmap: Realm

## Overview

Realm moves from frozen contracts and documentation gates to a verified sandbox vertical slice, then to the host surfaces that expose it. Phase 1 freezes the shared contracts and the integration notes that gate every external dependency. Phase 2 builds the policy, state, and filesystem logic that needs no container. Phase 3 adds the rootless Podman container, OpenShell, AgentOS, and the Anda bridge behind the lifecycle controller. Phase 4 adds crash cleanup, default-deny egress, and the single tool dispatcher. Phase 5 exposes that dispatcher through the Omp plugin, MCP, and ACP. Phase 6 adds the standalone CLI, the daemon, and host packaging. Phase 7 documents the policy and records the security review before the first release.

Coverage: 46/46 v1 requirements mapped, each to exactly one phase. v2.0 adds 8 requirements (HOST-01..03, OMP-LIVE-01..04, UI-01), mapped to phases 8 to 10. The production isolation build adds 31 PRD requirements, mapped to phases 9.1 to 9.6.

## Phases

- [x] **Phase 1: Scaffold and Frozen Contracts** - Strict ESM package, test runner, frozen contracts, and integration gate notes — Complete (verification passed; tooling format gap noted)
- [x] **Phase 2: Policy, State, and Filesystem Lockdown** - Policy engine, state machine, event bus, path and write safety, audit redaction, session store, doctor core — Complete (verification passed)
- [x] **Phase 3: Container Runtime and Bridges** - Rootless Podman, OpenShell, AgentOS adapters, Anda bridge, and the lifecycle controller — Complete (verification passed with gated live items; live items deferred)
- [x] **Phase 4: Reaper, Egress Guard, and Shared Dispatcher** - Orphan reaping, default-deny egress, timeouts, and the single tool dispatcher — Complete (verification deferred: human)
- [x] **Phase 5: Omp Plugin, MCP, and ACP Surfaces** - Detached Omp autostart, status indicator, retry command, and MCP and ACP over one contract — Complete (verification deferred: human)
- [x] **Phase 6: CLI, Daemon, and Host Packaging** - realm up, down, status, doctor, control channel, and host config snippets — Complete (verification deferred: human — 06-VERIFICATION.md, 5/5 must-haves, 6 live items)
- [x] **Phase 7: Policy Reference and Security Review** - Policy reference, security review, and supply-chain review before first release — Complete (verification deferred: human — 07-VERIFICATION.md, 9/9 must-haves, 5 human items)
- [x] **Phase 8: Host Adapter Bundles** - Claude Code and Grok Build, Muse Code, Hermes Agent, Prime Agent, and Omp manifests, each checked by its host's own validator in an isolated directory (HOST-01, HOST-02)
- [ ] **Phase 9: Live Omp Verification** - A live Omp session attaches, reports a truthful disconnected status with its reason, retries, and leaves the daemon running on shutdown (OMP-LIVE-01 to OMP-LIVE-04, UI-01)
- [ ] **Phase 9.1: Host Prerequisites and Production Gateway** - Rootless realm-account runtime with delegated limits and a production TLS and JWT gateway (PRD-HOST-01, PRD-HOST-02, PRD-GW-01, PRD-GW-02)
- [ ] **Phase 9.2: Native Enforcement Helper** - Source-built static helper applying no_new_privs, Landlock, and seccomp, fail closed (PRD-ENF-01 to PRD-ENF-03)
- [ ] **Phase 9.3: Hardened Container Lifecycle** - Create, verify with the 14 checks, and remove the sandbox container; startup sweep (PRD-CTR-01 to PRD-CTR-05)
- [ ] **Phase 9.4: Compute Driver gRPC** - Realm-owned ComputeDriver server on a user-only socket; admission matches the gateway (PRD-DRV-01 to PRD-DRV-03, PRD-GW-03, PRD-LIB-01)
- [ ] **Phase 9.5: Isolation Backend and Sandbox Protocol** - No workload before StartAgent; mediated egress and DNS (PRD-ISO-01 to PRD-ISO-06, PRD-SUP-01, PRD-GW-04)
- [ ] **Phase 9.6: Integration, Live Proof, and Cutover** - Gated live suite, realm up and down proof, docs, clean cutover (PRD-TST-01 to PRD-TST-03, PRD-OMP-01, PRD-DOC-01, PRD-CLEAN-01)
- [ ] **Phase 10: Docs, Packaging, and Release 0.2.0** - Host docs and snippets, MCP smoke check, pack assertions for each bundle, changelog, PR to main, and release 0.2.0 (HOST-03)
- [ ] **Phase 11: Milestone v2.0 Close** - Milestone completion after a gsd-tools dry run, with scratch profiles and worktrees removed

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

**Plans**: 10 plans (waves 1-4)
Plans:
- [ ] 03-01-PLAN.md — wave 1 — backoff schedule plus BridgePort contract (ANDA-03, RT-04)
- [ ] 03-02-PLAN.md — wave 1 — version move, Podman probe, RuntimeConfig validation (RT-02, RT-01)
- [ ] 03-03-PLAN.md — wave 1 — Anda shape check, anda-decision and runtime-decision notes (ANDA-01, ANDA-04)
- [ ] 03-04-PLAN.md — wave 1 — closed libpod client and fake socket server (RT-03, RT-09)
- [ ] 03-05-PLAN.md — wave 2 — OpenShell argv, policy document, idempotent runner (RT-03)
- [ ] 03-06-PLAN.md — wave 2 — Anda bridge handshake and reconnect (ANDA-02, ANDA-03)
- [ ] 03-07-PLAN.md — wave 2 — AgentOS supervisor and hardening verifier (RT-04, RT-01)
- [ ] 03-08-PLAN.md — wave 3 — session execution, down sweep, no-bypass proof (RT-01, RT-03, RT-09, CORE-06)
- [ ] 03-09-PLAN.md — wave 3 — mutation gate, controller bridge wiring, caller migration (CORE-05, ANDA-03)
- [ ] 03-10-PLAN.md — wave 4 — doctor checks, Podman gate bodies, taxonomy (RT-02, RT-01, RT-03, RT-09, ANDA-02)

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

**Plans**: 7 plans (waves 1-4)
Plans:
**Wave 1**
- [ ] 04-01-PLAN.md — wave 1 — egress validator and renderer (RT-05)
- [ ] 04-02-PLAN.md — wave 1 — sweep move, store list, startup reaper (RT-08)

**Wave 2** *(blocked on Wave 1 completion)*
- [ ] 04-03-PLAN.md — wave 2 — OpenShell egress wiring, config refusals, exec argv, bounded capture types (RT-05)
- [ ] 04-04-PLAN.md — wave 2 — workspace handlers, audit phase field, no-bypass guard (TOOL-03)

**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 04-05-PLAN.md — wave 3 — bounded exec capture and egress plumbing in session-execution (TOOL-03)
- [ ] 04-06-PLAN.md — wave 3 — ToolDispatcher pipeline, queue and timeout, routing proof (TOOL-03, TOOL-04)

**Wave 4** *(blocked on Wave 3 completion)*
- [ ] 04-07-PLAN.md — wave 4 — gated live bodies, taxonomy, decision-note section (RT-05, RT-08, TOOL-03, TOOL-04)

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

### Phase 8: Host Adapter Bundles

**Goal:** Claude Code and Grok Build, Muse Code, Hermes Agent, Prime Agent, and Omp manifests, each checked by its host's own validator in an isolated directory.
**Depends on:** Not stated in ROADMAP; phases run in ROADMAP order
**Requirements:** HOST-01, HOST-02
**Success Criteria** (what must be TRUE):
  1. Claude Code and Grok Build share one plugin bundle (`adapters/claude-plugin`) whose manifest and MCP entry start `realm mcp`, and each host's own validator accepts it.
  2. Muse Code, Hermes Agent, and Prime Agent each have an adapter bundle (`adapters/muse-code`, `adapters/hermes-agent`, `adapters/prime-agent`) and an MCP snippet, each accepted by that host's check in an isolated directory: the host's own validator where it has one, and for Prime Agent an isolated project-local install and list.

**Plans**: TBD

### Phase 9: Live Omp Verification

**Goal:** A live Omp session attaches, reports a truthful disconnected status with its reason, retries, and leaves the daemon running on shutdown.
**Depends on:** Not stated in ROADMAP; phases run in ROADMAP order
**Requirements:** OMP-LIVE-01, OMP-LIVE-02, OMP-LIVE-03, OMP-LIVE-04, UI-01
**Success Criteria** (what must be TRUE):
  1. A live Omp session loading the built extension with `-e` under an isolated profile attaches to the Realm daemon for the workspace (OMP-LIVE-01).
  2. When the daemon cannot attach, the status item states disconnected with its reason, never active (OMP-LIVE-02).
  3. The retry command reattaches from disconnected in the same live session (OMP-LIVE-03).
  4. Shutdown of the Omp session leaves the Realm daemon running (OMP-LIVE-04).
  5. The Omp plugin starts on session launch and shows its realm state in the Omp UI status item without blocking the session (UI-01).

**Plans**: TBD

### Phase 9.1: Host Prerequisites and Production Gateway

**Goal:** The rootless realm account has a durable container runtime with delegated limits, and the realm gateway is configured with TLS and JWT. The main gateway and the root Podman service are unchanged.
**Mode:** production build (inserted after phase 9; decimal numbering, PD-01)
**Depends on:** Owner decisions PD-02, PD-03, PD-04, PD-17; host approvals HC-01 to HC-03 and HC-06
**Requirements:** PRD-HOST-01, PRD-HOST-02, PRD-GW-01, PRD-GW-02
**Success Criteria** (what must be TRUE):
  1. `podman --remote info` as the realm account reports rootless, a 5.x version, and runtime `runc` (PRD-HOST-01).
  2. A container with memory and PID limits starts under the delegated unit (PRD-HOST-01).
  3. Twenty `info` calls and ten create-start-remove cycles pass with no orphan (PR-05 soak).
  4. After an owner-scheduled reboot, linger, the unit, and the API work without a manual step (PRD-HOST-02).
  5. The rendered gateway configuration has TLS and JWT tables and no `disable_tls`; relative paths are refused (PRD-GW-01, PRD-GW-02).
  6. Key files are 0600 in a 0700 directory under the realm account's state directory; the main gateway's digests are unchanged.

**Plans**: 1 plan (09.1-01-PLAN.md)

### Phase 9.2: Native Enforcement Helper

**Goal:** A static helper, built from committed source, applies `no_new_privs`, Landlock, and seccomp, and fails closed before any workload runs. It also runs as PID 1 for the idle container.
**Mode:** production build
**Depends on:** Nothing for the source; image build in phase 9.3 (PD-06, PD-16)
**Requirements:** PRD-ENF-01, PRD-ENF-02, PRD-ENF-03
**Success Criteria** (what must be TRUE):
  1. The helper builds with `-Wall -Wextra -Werror` and no warning (PRD-ENF-01).
  2. Below Landlock ABI 3, `run` refuses and the program never executes (PRD-ENF-01).
  3. As PID 1, `idle` reaps children and exits 0 on SIGTERM (PR-08).
  4. The security gate records its verdict on the seccomp denylist (PRD-ENF-01).
  5. The image record carries the helper's SHA-256 and source digest (PRD-ENF-02).
  6. The in-container probe passes (EACCES on `/tmp`, writable `/workspace`, EPERM on `keyctl`, `NoNewPrivs` 1, `Seccomp` 2), with the control showing `/tmp` writable without the helper (PRD-ENF-03, live in phase 9.6).

**Plans**: 1 plan (09.2-01-PLAN.md)

### Phase 9.3: Hardened Container Lifecycle

**Goal:** The realm creates, verifies, and removes one hardened container per sandbox through the libpod API, using the existing 14-check verifier unchanged.
**Mode:** production build
**Depends on:** Phase 9.1 (runtime), phase 9.2 (helper binary), the digest confirmation in task T0
**Requirements:** PRD-CTR-01, PRD-CTR-02, PRD-CTR-03, PRD-CTR-04, PRD-CTR-05
**Success Criteria** (what must be TRUE):
  1. Create starts the container with the idle init only, reads its kernel capability sets, and verifies all 14 checks before returning (PRD-CTR-01).
  2. Mutating any one of the 14 properties makes create remove the container and name that property; no workload starts (PRD-CTR-01).
  3. `State.Pid` of 0 fails `cap-drop` closed (PR-06).
  4. Delete leaves no container and no launch or active files for the sandbox (PRD-CTR-02).
  5. A realm-labelled orphan is removed by the startup sweep before the driver accepts requests (PRD-CTR-03).
  6. Containers carry the labels that the existing label lookups read, and the image digest matches the libpod inspect value (PRD-CTR-04, PRD-CTR-05).

**Plans**: 1 plan (09.3-01-PLAN.md)

### Phase 9.4: Compute Driver gRPC

**Goal:** A realm-owned ComputeDriver gRPC server on a user-only socket lets the realm gateway create, list, and delete sandboxes, refusing any out-of-profile request before a libpod call.
**Mode:** production build
**Depends on:** Phase 9.3; plan 09-01 closed (PR-10); decisions PD-05, PD-07, PD-08
**Requirements:** PRD-DRV-01, PRD-DRV-02, PRD-DRV-03, PRD-GW-03, PRD-LIB-01
**Success Criteria** (what must be TRUE):
  1. The gateway logs that the realm driver connected under the production TLS and JWT configuration (PRD-GW-03, PR-02).
  2. `GetCapabilities` returns the pinned admission acknowledgement, the same on every call (PRD-GW-03).
  3. A create with a non-configured image digest returns INVALID_ARGUMENT and creates nothing (PRD-DRV-02).
  4. The socket directory is 0700 and the socket is 0600; a non-socket or foreign path is refused (PRD-DRV-01).
  5. Stop and start return the status decided in PD-08, with no state change (PRD-DRV-03).
  6. The packed artifact contains the vendored protos and their provenance; every new dependency is an exact pin with its licence and audit recorded (PRD-LIB-01).

**Plans**: 1 plan (09.4-01-PLAN.md)

### Phase 9.5: Isolation Backend and Sandbox Protocol

**Goal:** A realm-owned IsolationBackend and SandboxProtocol server lets the supervisor attach, confirm, and start a workload, with no workload before `StartAgent`, mediated egress and DNS, and bounded frames.
**Mode:** production build
**Depends on:** Phases 9.2, 9.3, 9.4; decisions PD-09, PD-10, PD-11, PD-12, PD-15
**Requirements:** PRD-ISO-01, PRD-ISO-02, PRD-ISO-03, PRD-ISO-04, PRD-ISO-05, PRD-ISO-06, PRD-SUP-01, PRD-GW-04
**Success Criteria** (what must be TRUE):
  1. The supervisor's placement and its network path are recorded from a live attach, and the owner decides PD-15 and PD-10 from that record (PRD-SUP-01).
  2. Replaying the spike's RPC order makes no exec call before `StartAgent` (PRD-ISO-03).
  3. A 16 MiB stdin write reads back byte for byte; frames over the limits are rejected (PRD-ISO-04).
  4. A DNS query outside the allowlist is refused, and an `AAAA` query is refused (PRD-ISO-05).
  5. A handle used after delete fails and changes no state (PRD-ISO-06).
  6. `Describe` advertises only implemented capabilities; suspend and resume follow PD-09; the gateway registers the backend with an absolute unix socket (PRD-ISO-01, PRD-GW-04).

**Plans**: 1 plan (09.5-01-PLAN.md)

### Phase 9.6: Integration, Live Proof, and Cutover

**Goal:** The production stack is proven on the realm host, `realm up` uses it and nothing else, the docs match it, and the OMP-LIVE decision is recorded. This closes the production build.
**Mode:** production build
**Depends on:** Phases 9.1 to 9.5; decisions PD-13, PD-14
**Requirements:** PRD-TST-01, PRD-TST-02, PRD-TST-03, PRD-OMP-01, PRD-DOC-01, PRD-CLEAN-01
**Success Criteria** (what must be TRUE):
  1. The gated live suite passes: 14 checks, helper probe, supervisor order, 16 MiB round trip, exit status, non-root start, egress allow and deny, IPv6 off, delete leaves none (PRD-TST-02, RT-05 evidence).
  2. `realm up`, `realm status` (active), and `realm down` (zero realm containers) pass live; a wrong digest fails closed with no container left (PRD-TST-03, RT-09 evidence).
  3. No code path that only the built-in driver required remains; no shim (PRD-CLEAN-01).
  4. `AGENTS.md` and the integration docs match the layout and the evidence, and `npm run check:docs` passes (PRD-DOC-01).
  5. The OMP-LIVE traceability rows match PD-14 and their evidence (PRD-OMP-01).
  6. RT-01, RT-03, and RT-05 status changes cite the live evidence; RT-03 is not amended without owner approval.

**Plans**: 1 plan (09.6-01-PLAN.md)

### Phase 10: Docs, Packaging, and Release 0.2.0

**Goal:** Host docs and snippets, MCP smoke check, pack assertions for each bundle, changelog, PR to main, and release 0.2.0.
**Depends on:** Not stated in ROADMAP; phases run in ROADMAP order
**Requirements:** HOST-03
**Success Criteria** (what must be TRUE):
  1. No host configuration outside this repository is changed without explicit approval, and the adapter bundles ship in the npm package with the pack check asserting each manifest (HOST-03).

Release 0.2.0 and the PR to main are held by the owner's ship hold (2026-10-24); this block does not authorize either.

**Plans**: TBD

### Phase 11: Milestone v2.0 Close

**Goal:** Milestone completion after a gsd-tools dry run, with scratch profiles and worktrees removed.
**Depends on:** Not stated in ROADMAP; phases run in ROADMAP order
**Requirements:** None mapped in REQUIREMENTS (milestone close)
**Success Criteria** (what must be TRUE):
  1. The gsd-tools milestone dry run completes before the milestone is completed.
  2. Scratch profiles and worktrees created for the milestone are removed.

**Plans**: TBD


## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Scaffold and Frozen Contracts | 5/5 | Complete (verification passed; tooling format gap noted) | - |
| 2. Policy, State, and Filesystem Lockdown | 6/6 | Complete (verification passed) | - |
| 3. Container Runtime and Bridges | 10/10 | Complete (verification passed with gated live items; live items deferred) | - |
| 4. Reaper, Egress Guard, and Shared Dispatcher | 7/7 | Complete (verification deferred: human) | - |
| 5. Omp Plugin, MCP, and ACP Surfaces | 6/6 | Complete (verification deferred: human) | - |
| 6. CLI, Daemon, and Host Packaging | 6/6 | Complete (verification deferred: human — 06-VERIFICATION.md, 5/5 must-haves, 6 live items) | - |
| 7. Policy Reference and Security Review | 3 units, no PLAN files | Complete (verification deferred: human — 07-VERIFICATION.md, 9/9 must-haves, 5 human items) | - |
| 8. Host Adapter Bundles | 1/1 | Complete (closed 2026-10-24 on validator exit codes; artifacts hand-written, pending owner ratification) | - |
| 9. Live Omp Verification | 0/3 | In progress: OMP-LIVE-02 met live; OMP-LIVE-03 partial; OMP-LIVE-01 and OMP-LIVE-04 descoped to the follow-up milestone (owner decision 2026-10-23); UI-01 non-blocking recorded as a stated limitation | - |
| 9.1. Host Prerequisites and Production Gateway | 0/1 | Partial: T1 to T5 and T7 to T9 complete with evidence; T6 owner-scheduled reboot pending | - |
| 9.2. Native Enforcement Helper | 0/1 | Partial: helper, native tests, probe, SECCOMP.md, and image definition complete; security gate PASS WITH CONDITIONS C1 to C6; image build in phase 9.3 | - |
| 9.3. Hardened Container Lifecycle | 0/1 | Planned (needs 9.1 and 9.2; digest confirmation T0) | - |
| 9.4. Compute Driver gRPC | 0/1 | Planned (needs 9.3; starts after plan 09-01 closes) | - |
| 9.5. Isolation Backend and Sandbox Protocol | 0/1 | Planned (needs 9.4; PD-15 evidence first) | - |
| 9.6. Integration, Live Proof, and Cutover | 0/1 | Planned (needs 9.1 to 9.5) | - |
| 10. Docs, Packaging, and Release 0.2.0 | 0/4 | In progress: host snippets, Omp runbook, changelog, and pack check (Hermes JSON manifests) done; release 0.2.0 held by the owner's ship hold | - |
| 11. Milestone v2.0 Close | 0/1 | Not started: phases 8 to 10 incomplete; gsd-tools dry run refuses (ROADMAP lists 7 unstarted phases); --force and --confirm not used | - |
