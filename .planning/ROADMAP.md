# Roadmap: Realm

## Overview

Realm moves from frozen contracts and documentation gates to a verified sandbox vertical slice, then to the host surfaces that expose it. Phase 1 freezes the shared contracts and the integration notes that gate every external dependency. Phase 2 builds the policy, state, and filesystem logic that needs no container. Phase 3 adds the rootless Podman container, OpenShell, AgentOS, and the Anda bridge behind the lifecycle controller. Phase 4 adds crash cleanup, default-deny egress, and the single tool dispatcher. Phase 5 exposes that dispatcher through the Omp plugin, MCP, and ACP. Phase 6 adds the standalone CLI, the daemon, and host packaging. Phase 7 documents the policy and records the security review before the first release.

Milestone v3.0, Containment by Default, makes the sandbox the place where a model's file mutations and commands run by default, and makes the sandbox and its files survive crashes and be observable. It has nine phases, 12 to 20, in three lanes that share no mutable state and may run in parallel; inside a lane the order is strict. The Omp lane (12, 15, 16) proves by a scripted-provider harness what Omp's extension API can enforce, adds zero-config onboarding with fail-closed as the default policy mode, and registers Realm's tools in Omp so that its built-in `write`, `edit` and `bash` are replaced or blocked in fail-closed mode. The runtime lane (14, 17, 18, 19) adds crash safety, a tamper-evident audit log with structured logs and metrics, one sandbox per project, and resume and checkpoint. The pipeline lane (13, 20) adds the quality and supply-chain ratchet, then splits and hardens the release job. Live runs on the shared realm stack are serialized, because the startup reap is account-wide.

Coverage: 46/46 v1 requirements mapped, each to exactly one phase. v2.0 adds 8 requirements (HOST-01..03, OMP-LIVE-01..04, UI-01), mapped to phases 8 to 10. The production isolation build adds 31 PRD requirements, mapped to phases 9.1 to 9.6. v3.0 adds 52 requirements (HARN, QR, CRASH, ONB, DEF, OMPX, OBS, MULTI, RES, REL) mapped to phases 12 to 20.

## Milestones

- 🗄 **v1.0 provisional** — Phases 1 to 7 (archived in `milestones/`)
- 🗄 **v2.0 Host Adapters, Live Verification and Production Isolation** — Phases 8 to 11 (shipped as releases 0.2.0 and 0.2.1 on 2026-10-29; archived in `milestones/`)
- 🚧 **v3.0 Containment by Default** — Phases 12 to 20 (in progress, release line 0.3.x)

## Phases

<details>
<summary>🗄 v1.0 provisional, phases 1 to 7: ARCHIVED (full record in milestones/v1.0-ROADMAP.md and milestones/v1.0-phases)</summary>

- [x] **Phase 1: Scaffold and Frozen Contracts** - Strict ESM package, test runner, frozen contracts, and integration gate notes — Complete (verification passed; tooling format gap noted)
- [x] **Phase 2: Policy, State, and Filesystem Lockdown** - Policy engine, state machine, event bus, path and write safety, audit redaction, session store, doctor core — Complete (verification passed)
- [x] **Phase 3: Container Runtime and Bridges** - Rootless Podman, OpenShell, AgentOS adapters, Anda bridge, and the lifecycle controller — Complete (verification passed with gated live items; live items deferred)
- [x] **Phase 4: Reaper, Egress Guard, and Shared Dispatcher** - Orphan reaping, default-deny egress, timeouts, and the single tool dispatcher — Complete (verification deferred: human)
- [x] **Phase 5: Omp Plugin, MCP, and ACP Surfaces** - Detached Omp autostart, status indicator, retry command, and MCP and ACP over one contract — Complete (verification deferred: human)
- [x] **Phase 6: CLI, Daemon, and Host Packaging** - realm up, down, status, doctor, control channel, and host config snippets — Complete (verification deferred: human — 06-VERIFICATION.md, 5/5 must-haves, 6 live items)
- [x] **Phase 7: Policy Reference and Security Review** - Policy reference, security review, and supply-chain review before first release — Complete (verification deferred: human — 07-VERIFICATION.md, 9/9 must-haves, 5 human items)

</details>

<details>
<summary>🗄 v1.0 provisional, phases 1 to 7: ARCHIVED (detail blocks kept here for reference; full record in milestones/v1.0-ROADMAP.md)</summary>

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

</details>

<details>
<summary>🗄 v2.0 Host Adapters, Live Verification and Production Isolation, phases 8 to 11: ARCHIVED (full record in milestones/v2.0-ROADMAP.md and milestones/v2.0-phases; audit in milestones/v2.0-MILESTONE-AUDIT.md)</summary>

- [x] **Phase 8: Host Adapter Bundles** - Claude Code and Grok Build, Muse Code, Hermes Agent, Prime Agent, and Omp manifests, each checked by its host's own validator in an isolated directory (HOST-01, HOST-02)
- [x] **Phase 9: Live Omp Verification** - A live Omp session attaches, reports a truthful disconnected status with its reason, retries, and leaves the daemon running on shutdown (OMP-LIVE-01 to OMP-LIVE-04, UI-01) — Complete (2026-10-28: OMP-LIVE-01 to -04 met live on the final build; UI-01 is a recorded limitation)
- [x] **Phase 9.1: Host Prerequisites and Production Gateway** - Rootless realm-account runtime with delegated limits and a production TLS and JWT gateway (PRD-HOST-01, PRD-HOST-02, PRD-GW-01, PRD-GW-02) — Complete (2026-10-25: T1 to T9 evidence; T6 reboot PASS)
- [x] **Phase 9.2: Native Enforcement Helper** - Source-built static helper applying no_new_privs, Landlock, and seccomp, fail closed (PRD-ENF-01 to PRD-ENF-03) — Superseded (owner decision 2026-10-28: the runtime's own policy is the enforcement authority and the helper was removed; recoverable at commit 497b63f; PRD-ENF-03 met live as amended)
- [x] **Phase 9.3: Hardened Container Lifecycle** - Create, verify with the 14 checks, and remove the sandbox container; startup sweep (PRD-CTR-01 to PRD-CTR-05) — Complete, VERIFIED_WITH_GAPS (live acceptance 1, 4, 5, 6, 7 PASS on the committed tree; acceptance 2 and 3 unit-verified, live NOT RUN)
- [x] **Phase 9.4: Compute Driver gRPC** - Realm-owned ComputeDriver server on a user-only socket; admission matches the gateway (PRD-DRV-01 to PRD-DRV-03, PRD-GW-03, PRD-LIB-01) — Complete, VERIFIED (2026-10-25: gateway connected live; limits carried to 9.5: Ready state, PD-08 live, AuthenticateSandbox)
- [x] **Phase 9.5: Isolation Backend and Sandbox Protocol** - No workload before StartAgent; mediated egress and DNS (PRD-ISO-01 to PRD-ISO-06, PRD-SUP-01, PRD-GW-04) — Complete on the amended built-in path (owner, 2026-10-26); live checks for Landlock, egress, frames, and restart move to 9.6
- [x] **Phase 9.6: Integration, Live Proof, and Cutover** - Gated live suite, realm up and down proof, docs, clean cutover (PRD-TST-01 to PRD-TST-03, PRD-OMP-01, PRD-DOC-01, PRD-CLEAN-01) — Complete (2026-10-28: six live scenarios 28 of 28 at d2db549; OMP-LIVE-01, -03, -04 verified live; PRD-DRV-01 amendment and the review findings await owner decisions)
- [x] **Phase 9.7: Review-Finding Remediation** - A10 boundary and A18 supply-chain findings fixed or recorded, truthful status when the runner dies, live-gated requirements closed (REM-01 to REM-05) — Complete (2026-10-28: nine live scenarios 31 of 31 on the rebuilt image; three defects found by the live proof were fixed; the RT-04 wording was amended by the owner to match ruling N1; the other owner decisions are listed in 09.7-VERIFICATION.md)
- [x] **Phase 10: Docs, Packaging, and Release 0.2.0** - Host docs and snippets, MCP smoke check, pack assertions for each bundle, changelog, PR to main, and release 0.2.0 (HOST-03), completed 2026-10-29
- [x] **Phase 11: Milestone v2.0 Close** - Milestone completion after a gsd-tools dry run, with scratch profiles and worktrees removed — Complete (2026-10-29: the audit found and fixed five defects in the released build, release 0.2.1; the milestone was completed with eight requirements carried)

</details>

### 🚧 v3.0 Containment by Default (In Progress)

**Milestone Goal:** A model working through Omp does its file mutations and commands inside the sandbox by default; the sandbox and its files survive crashes; an operator can see what happened, prove the audit log is intact, and ship with provenance and a rollback path.

- [ ] **Phase 12: Scripted-provider harness and Omp enforcement spike** - A gated harness drives a live Omp through a scripted provider in three cases, the spike answers what the extension API can enforce, and OMP-05 is recorded complete on that evidence (HARN-01..04, OMPX-01)
- [ ] **Phase 13: Quality ratchet** - Dependency audit and Dependabot, pack checks, coverage floors, de-flaked timing tests, property tests, and a scheduled mutation run (QR-01..08)
- [ ] **Phase 14: Crash-safety pack** - Orphan temp-file sweep, audit reconciliation, durable record deletion, a visible reap, real-SIGKILL tests, the cause code across the daemon, and retry after a lost container (CRASH-01..07)
- [ ] **Phase 15: Zero-config onboarding and fail-closed default** - `realm init`, `doctor --fix`, driver roots in `config.json`, an allowlisted daemon environment, a verified Omp install path, and fail-closed as the default policy mode (ONB-01..07, DEF-01..02)
- [ ] **Phase 16: Omp runs in the sandbox** - Realm's tools are registered in Omp, and in fail-closed mode the built-in `write`, `edit` and `bash` are removed or blocked by the mechanism the spike proved (OMPX-02..05)
- [ ] **Phase 17: Observability and tamper-evident audit** - A hash-chained audit log with `realm audit verify`, structured logs with correlation ids, counters over the control socket, and a distinct code for gateway or driver loss (OBS-01..04)
- [ ] **Phase 18: Per-project sandboxes** - One session, sandbox, audit file and lock table per project workspace under the configured roots (MULTI-01..06)
- [ ] **Phase 19: Resume and checkpoint** - A surviving sandbox that passes the hardening verifier is re-adopted after a daemon restart, a session-owned scratch volume, and workspace snapshot and restore (RES-01..05)
- [ ] **Phase 20: Release pipeline hardening** - Unprivileged build job and privileged publish job, build provenance attestation, a rollback workflow, and a changelog filter for removed features (REL-01..04)

## Phase Details

<details>
<summary>🗄 v2.0 Host Adapters, Live Verification and Production Isolation, phases 8 to 11: ARCHIVED (detail blocks kept here for reference; full record in milestones/v2.0-ROADMAP.md)</summary>

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
  1. The gated live suite passes its six scenarios: default-policy confinement with the workspace bind, runner probe, exit status, and 16 MiB round trip; immediate down then up; egress allow and deny with a synthetic resolver and IPv6 off; a wrong digest; crash recovery; and MCP exec, write, and read; `realm down` leaves no residue (PRD-TST-02, RT-05 evidence).
  2. `realm up`, `realm status` (active), and `realm down` (zero realm containers) pass live; a wrong digest fails closed with no container left (PRD-TST-03, RT-09 evidence).
  3. No code path that only the built-in driver required remains; no shim (PRD-CLEAN-01).
  4. `AGENTS.md` and the integration docs match the layout and the evidence, and `npm run check:docs` passes (PRD-DOC-01).
  5. The OMP-LIVE traceability rows match the owner's reinstatement of 2026-10-25 and the live evidence of 2026-10-28 (PRD-OMP-01).
  6. RT-01, RT-03, and RT-05 status changes cite the live evidence; RT-03 is not amended without owner approval.

**Plans**: 1 plan (09.6-01-PLAN.md), executed; see 09.6-01-SUMMARY.md and 09.6-VERIFICATION.md

### Phase 9.7: Review-Finding Remediation

**Goal:** Every finding of the A10 boundary review and the A18 supply-chain review, and every defect found while closing the live-gated requirements, is fixed with a regression test or recorded with its reason. The session label tells the truth when the AgentOS runner dies, and the host binaries and the sandbox image carry recorded provenance.
**Mode:** production build (inserted after phase 9.6; decimal numbering)
**Depends on:** Phase 9.6
**Requirements:** REM-01, REM-02, REM-03, REM-04, REM-05
**Success Criteria** (what must be TRUE):
  1. The seccomp profile denies nested user namespaces and the mount family, the create-time verifier asserts the added properties, and the spec bounds tmpfs size, swap and rlimits; each has a unit test and the live suite still passes (REM-01).
  2. Egress literals in private and special ranges are refused, atomic writes are pinned to the checked directory, audit lines are fsynced, the credential list covers keys, certificates and registry tokens, and the workspace scan refuses a mount on another device at create time (same-filesystem bind mounts are not detected) (REM-01).
  3. The supervisor digest pin refuses a changed binary at start and at spawn, `realm doctor` reports binary versions and digests and the ptrace scope, and the host binary record exists (REM-02).
  4. The image build gates its inputs (pinned cmake, no git-sourced crates, runner compiled in the image, committed expected digests, a verifier script, and a build command that reads the digests), and CI pins actions to commit SHAs with job timeouts and an explicit read-only permission for the verify job; the Pages workflow keeps its original permissions (REM-02).
  5. A runner that exits while the session is active moves the status to disconnected with AGENTOS_CRASH_LOOP within the health interval, proven live (REM-03).
  6. RT-02, RT-04, CLI-01, CLI-04, TOOL-03, TOOL-04, TOOL-05, OMP-01, OMP-02 and OMP-04 carry evidence-based statuses, with TOOL-04, OMP-01 and the RT-04 behaviour proven in the live suite; the RT-04 wording was amended by the owner on 2026-10-28 to match ruling N1; TOOL-05 (ACP) and OMP-05 (model call) stay partial with their limits stated (REM-04).
  7. Planning and integration records match the code: the stale bindRoot, 5.2, 5.4 and R7 rows, the AGENTS.md entry-edge list, and the RT-04 wording (REM-05).

**Plans**: 1 plan (09.7-01-PLAN.md), executed; see 09.7-01-SUMMARY.md and 09.7-VERIFICATION.md

### Phase 10: Docs, Packaging, and Release 0.2.0

**Goal:** Host docs and snippets, MCP smoke check, pack assertions for each bundle, changelog, PR to main, and release 0.2.0.
**Depends on:** Not stated in ROADMAP; phases run in ROADMAP order
**Requirements:** HOST-03
**Success Criteria** (what must be TRUE):
  1. No host configuration outside this repository is changed without explicit approval, and the adapter bundles ship in the npm package with the pack check asserting each manifest (HOST-03).

The owner lifted the ship hold on 2026-10-28 for one pull request with autoMerge off. On 2026-10-29 the owner superseded that: an automatic merge to main was authorised and the review of the five reserved files was delegated to the run (recorded in 10-04-PLAN.md). Pull request 6 was merged by the ship flow as merge commit 550a41f, and the release job on main produced v0.2.0 (release commit 84d937c).

**Plans**: 4 plans, all done. 10-01 (fix-now quality tier) and 10-02 (triage and milestone audit pass 1); 10-03 (HOST-03 audit and ship paperwork), see 10-03-PLAN.md and 10-03-SUMMARY.md; 10-04 (reserved-file review, PR to main, review loop, merge, release 0.2.0), see 10-04-PLAN.md, 10-04-RESERVED-FILES.md and 10-04-SUMMARY.md. The phase record is 10-VERIFICATION.md.

### Phase 11: Milestone v2.0 Close

**Goal:** Milestone completion after a gsd-tools dry run, with scratch profiles and worktrees removed.
**Depends on:** Not stated in ROADMAP; phases run in ROADMAP order
**Requirements:** None mapped in REQUIREMENTS (milestone close)
**Success Criteria** (what must be TRUE):
  1. The gsd-tools milestone dry run completes before the milestone is completed.
  2. Scratch profiles and worktrees created for the milestone are removed.

**Plans**: 1 plan (11-01-PLAN.md). Its reorganisation, roadmap analysis, dry run and cleanup inventory were done on 2026-10-28 (11-01-SUMMARY.md). The milestone audit, the completion and the cleanup were done on 2026-10-29: see milestones/v2.0-MILESTONE-AUDIT.md and 11-VERIFICATION.md.

</details>

### Phase 12: Scripted-provider harness and Omp enforcement spike

**Goal:** A live Omp, driven by a scripted model provider with no credentials, shows what the Realm extension does with a model-issued `write` in each mode, and the extension API's enforcement limits are known and recorded.
**Depends on:** Nothing (first phase of the Omp lane; parallel with the runtime and pipeline lanes)
**Requirements:** HARN-01, HARN-02, HARN-03, HARN-04, OMPX-01
**Success Criteria** (what must be TRUE):
  1. One command runs the harness against the built extension and a local Omp and passes; it starts an isolated Omp profile, a loopback OpenAI-compatible stub with a scripted sequence (one `write` tool call, then a final message), and Omp over RPC pipes with no pseudo-terminal, credentials or tokens, and it records the Omp version (HARN-01, HARN-03).
  2. The three cases pass: advisory mode with the realm down shows the notice and the file exists; fail-closed mode with the realm down blocks the call with `REALM_NOT_ACTIVE` and the file does not exist; with the realm active the call proceeds (HARN-02).
  3. A capture of the run shows no network call outside loopback, and without Omp, Podman or the gate variable the command skips with the missing prerequisite named, as the production live suite does (HARN-03).
  4. `docs/integration/omp.md` records, with the Omp version, whether `registerTool` tools reach the model, whether `setActiveTools` removes `write`, `edit` and `bash` and is enforced at execution, and whether `registerFileWriteFallback` can redirect a write; OQ-P5-01 and OQ-P5-02 are closed or restated from that finding (OMPX-01).
  5. The OMP-05 row in `.planning/REQUIREMENTS.md` reads complete, and its basis states that the run is scripted through Omp's own `write` tool and is not LLM-driven (HARN-04).

**Notes:** Owner decision D2 (2026-10-29): when the harness passes live, the scripted-provider evidence closes OMP-05, with that basis stated. The finding of the OMPX-01 spike gates Phase 16 (owner decision D3). Live runs on the shared realm stack are serialized, because the startup reap is account-wide.

**Plans**: TBD

### Phase 13: Quality ratchet

**Goal:** Regressions in dependencies, coverage, packaging and the security-relevant path and policy logic fail in CI or in a scheduled run before they ship, and the test suite no longer fails under load.
**Depends on:** Nothing (pipeline lane; Phase 20 follows it because both change the CI workflow)
**Requirements:** QR-01, QR-02, QR-03, QR-04, QR-05, QR-06, QR-07, QR-08
**Success Criteria** (what must be TRUE):
  1. `ci.yml` runs `npm audit --omit=dev --audit-level=high`, and `.github/dependabot.yml` exists and covers `github-actions` and `npm` for the repository root and for `site/` (QR-01, QR-02).
  2. `pack-smoke` fails when a host snippet or the prime-agent `MCP.md` or `SKILL.md` is missing from the tarball, and the release job reruns `check:pack` on the release tarball after the version sync (QR-03).
  3. `npm run test:coverage` prints the Node test runner's coverage output, and CI fails when coverage in `src/fs`, `src/core` or `src/tools` falls below its recorded floor, shown by a run against a lowered coverage; the dead exports found with that output are removed and the frozen error catalogue is unchanged (QR-04, QR-06).
  4. The libpod TTL cache test and the idempotent lifecycle test use an injected fake clock, the 21 `{ timeout: 10_000 }` caps under `test/acp` and the other fixed waits use the shared scaled-timeout helper in `test/support`, and the full suite passes in a CPU-limited container (QR-05).
  5. `fast-check` properties for the path canonicalizer (no result escapes the root for random `..`, symlink, NUL, doubled-slash and unicode inputs) and the policy parser (round trip, unknown keys rejected) run in `npm test`, a deliberately broken canonicalizer fails at least one of them, and a scheduled non-blocking workflow runs mutation testing over `src/fs`, `src/core/policy.ts` and `src/audit/redact.ts` (QR-07, QR-08).

**Notes:** Each change under `.github/workflows/**` and `release/**` cites owner decision D6 in its pull request body. The `fast-check` dev dependency carries the justification, licence check and maintenance check that `CONTRIBUTING.md` requires. The property tests add confidence only; FS-02 keeps its status, which is the owner's call.

**Plans**: TBD

### Phase 14: Crash-safety pack

**Goal:** A daemon or process killed at any point leaves no unrecorded debris, no silent loss of a sandbox, and no audit admission without an outcome.
**Depends on:** Nothing (runtime lane, first phase)
**Requirements:** CRASH-01, CRASH-02, CRASH-03, CRASH-04, CRASH-05, CRASH-06, CRASH-07
**Success Criteria** (what must be TRUE):
  1. For each of the four stages (`after-temp-write`, `after-fsync`, `before-rename`, `after-recheck`), a real-SIGKILL test leaves the original bytes intact and one orphan temp file, and the next startup sweep removes it with an audit line; the sweep removes only regular files named `.<name>.realm-tmp-<16 lowercase hex>` older than the stated bound, never follows a symlink, and leaves every other dotfile (CRASH-01, CRASH-05).
  2. A crash test that leaves an admission line without a result line gets exactly one reconciliation line at the next start, marked as a reconciliation and not an execution result, and a second start appends none (CRASH-02).
  3. `SessionStore.delete` syncs the sessions directory, shown through the directory-sync helper of `src/fs/atomic-write.ts`; the startup reap logs the container ids removed and the number of records deleted, and the next attach shows a status-read notice (CRASH-03, CRASH-04).
  4. The daemon-path equivalence test beside `test/surfaces/equivalence.test.ts` shows the same refusal cause code over MCP and over ACP as in process (CRASH-06).
  5. A controller test with the recorded container removed reaches `active` on retry from the error state, with a new container, and not `OPENSHELL_START_FAILED` (CRASH-07).

**Notes:** CRASH-02 uses an existing catalogue code if one fits; otherwise the one catalogue addition that owner decision D5 allows, with every table, document and test that enumerates codes updated in the same pull request. Phase 17 follows because its hash chain must cover the reconciliation lines. Live runs on the shared realm stack are serialized, because the startup reap is account-wide.

**Plans**: TBD

### Phase 15: Zero-config onboarding and fail-closed default

**Goal:** A new user on a Podman 5.x host reaches an active sandbox with `realm init` and `realm up` and no manual edit, and a policy that says nothing about its mode contains the agent.
**Depends on:** Nothing (Omp lane; it follows Phase 12 only for scheduling)
**Requirements:** ONB-01, ONB-02, ONB-03, ONB-04, ONB-05, ONB-06, ONB-07, DEF-01, DEF-02
**Success Criteria** (what must be TRUE):
  1. On a clean host with Podman 5.x, `realm init` followed by `realm up` reaches active with no manual file edit; `init` writes the `config.json` and `policy.json` templates, creates the state directory with mode 0700, refuses to overwrite an existing file, and takes the image digest as an argument or from `release/` and never invents one (ONB-01).
  2. `realm doctor` fails with a named check and a fix when a driver root is unset, relative or mode-wrong, or when the driver socket or the gateway is unreachable, and a unit test covers each check; `realm doctor --fix` on a state directory with mode 0755 changes it to 0700, a second run changes nothing, dry-run changes nothing, and a symlinked directory is refused (ONB-02, ONB-04).
  3. The secret, workspace and state roots are read from `config.json` with a default under `stateDir`, the `REALM_DRIVER_SECRET_ROOT`, `REALM_DRIVER_WORKSPACE_ROOT` and `REALM_DRIVER_STATE_ROOT` variables are gone (the driver's other `REALM_DRIVER_*` variables are unchanged), and the driver and the daemon read the same source; a test shows a sentinel environment variable does not reach the daemon started by `startDetachedDaemon` or by the CLI's spawn (ONB-03, ONB-07).
  4. A policy file with no `mode` loads as fail-closed, the schema default and the loader agree, advisory needs the explicit value, and the policy reference, README, Omp notes, doctor output and `init` templates state the fail-closed default; a search of the documents finds none that calls advisory the default, and every test that relied on the old default states its mode or asserts the new one (DEF-01, DEF-02).
  5. `omp plugin install` is run live under an isolated profile and the result is recorded in `docs/hosts/snippets/omp.md`, and `README.md` carries the install steps and a quickstart transcript of `init`, `up`, `status` and `down` captured on a real Podman 5.x host (ONB-05, ONB-06).

**Notes:** Owner decision D4 (2026-10-29) flips the default `mode` from `advisory` to `fail-closed`, superseding the earlier decision to keep advisory as the default; the schema default, the loader, `docs/policy-reference.md`, the README, the Omp notes, the doctor output, the `init` templates and every test that relied on the old default change together in one clean cutover. The driver launcher lives outside the repository (TD-02), so moving the roots into `config.json` is coordinated with whoever launches the driver, or the driver and the daemon will disagree. Live runs on the shared realm stack are serialized, because the startup reap is account-wide.

**Plans**: TBD

### Phase 16: Omp runs in the sandbox

**Goal:** A model working through Omp does its file mutations and commands through Realm's tools in the sandbox, and in fail-closed mode its built-in host `write`, `edit` and `bash` are gone or refused.
**Depends on:** Phase 12 (the harness test bed and the enforcement answer) and Phase 15 (the fail-closed default and the roots in `config.json`); Omp lane
**Requirements:** OMPX-02, OMPX-03, OMPX-04, OMPX-05
**Success Criteria** (what must be TRUE):
  1. The extension registers `exec`, `read`, `write`, `list` and `status` as Omp tools, each calling the daemon client with the frozen `ToolCall` shape; `retry` stays the `realm-retry` command, no `glob` tool exists, and the frozen tool schema tests pass unchanged (OMPX-02).
  2. In fail-closed mode the built-in `write`, `edit` and `bash` are removed or blocked by the mechanism the Phase 12 spike proved, the `tool_call` guard stays as a backstop, and a model-issued `bash` call is refused with a catalogue code; where the spike shows the API cannot enforce removal, the status text and the docs say fail-closed is a guard and not containment (OMPX-03).
  3. In advisory mode the Realm tools are registered, the built-in tools stay available, and the existing notice shows (OMPX-04).
  4. In the Phase 12 harness with the realm active, a model-issued write through the registered tool lands in the sandbox's `/workspace` and appears in the host root, and the audit log holds an admission line and a result line for it (OMPX-05).

**Notes:** Owner decision D3 (2026-10-29) permits removal or blocking of the built-ins only by the mechanism the Phase 12 spike proves; the spike answer decides whether criterion 2 reads as containment or as a guard. Live runs on the shared realm stack are serialized, because the startup reap is account-wide.

**Plans**: TBD

### Phase 17: Observability and tamper-evident audit

**Goal:** An operator can read what happened from structured logs and counters, tell a gateway loss from a runner crash, and prove the audit log has not been edited.
**Depends on:** Phase 14 (reconciliation lines must be covered by the hash chain); runtime lane. Phase 17 deliberately precedes Phase 18: the session id is a log field and a file-name component from the start, and Phase 18 completes the per-project naming (MULTI-03), because structured logs and metrics make the multi-session and adoption work diagnosable.
**Requirements:** OBS-01, OBS-02, OBS-03, OBS-04
**Success Criteria** (what must be TRUE):
  1. Each audit line carries `seq` and `prev` (the sha256 of the previous line); `realm audit verify` passes an untouched file, including one with Phase 14 reconciliation lines, and names the first broken line after a middle line is edited, removed or reordered; the chain head is recovered from the last line at startup (OBS-01).
  2. The daemon log is one JSON object per line with a level, the catalogue code in a fixed field and a correlation id per `up` and per tool call; a tool call's log line carries the same correlation id as its admission and result audit lines; `package.json` gains no dependency (OBS-02).
  3. Counters and timings for tool calls by outcome, state transitions and attach duration are read over the existing control socket, and a listing of the daemon's listening sockets shows no network listener (OBS-03).
  4. With the gateway killed, `realm status` and a probe test show the new gateway-or-driver-loss code and not `AGENTOS_CRASH_LOOP`, and every table, document and test that enumerates catalogue codes includes it (OBS-04).

**Notes:** Owner decision D5 allows the one catalogue addition for gateway or driver loss (TD-05); any other catalogue change needs a reason recorded in the phase context. The design of OBS-01 covers the Merkle anchor and the reconciliation lines of Phase 14. Live runs on the shared realm stack are serialized, because the startup reap is account-wide.

**Plans**: TBD

### Phase 18: Per-project sandboxes

**Goal:** Two projects under the configured roots each get their own active sandbox, workspace, audit file and lock table, and taking one down leaves the other running.
**Depends on:** Phase 17 (the session id is already a log field and file-name component); runtime lane
**Requirements:** MULTI-01, MULTI-02, MULTI-03, MULTI-04, MULTI-05, MULTI-06
**Success Criteria** (what must be TRUE):
  1. `docs/integration/runtime-decision.md` records one session per project workspace, superseding one session per daemon, in a commit that precedes the code that needs it (MULTI-01).
  2. Two `realm up` calls from two project directories under the configured roots yield two active sandboxes `realm-<sessionId>` with distinct `/workspace` contents; a write in one is not visible in the other; the compute driver and the gateway contract carry the workspace per sandbox, with PRD-DRV-01 handled only as far as this needs (MULTI-02, MULTI-04, MULTI-05).
  3. `realm down` for one project leaves the other active, and each session has its own record, pinned subdirectory, bind mount, audit file, lock table and status snapshot; unit tests cover the per-session pin (MULTI-03, MULTI-05).
  4. A directory outside every configured root is refused with `POLICY_DENIED` (MULTI-02).
  5. The aggregate memory and CPU commitment of concurrent sessions is bounded and documented, using existing configuration and no new catalogue code (MULTI-06).

**Notes:** The runtime decision (owner decision D5, item i) is recorded first, before any code that needs it. Live runs on the shared realm stack are serialized, because the startup reap is account-wide.

**Plans**: TBD

### Phase 19: Resume and checkpoint

**Goal:** A daemon crash or restart no longer destroys a good sandbox or its files, and an operator can keep scratch data and roll a workspace back to a snapshot.
**Depends on:** Phase 18 (adoption is per session) and Phase 14 (the orphan sweep and audit reconciliation run before adoption); runtime lane
**Requirements:** RES-01, RES-02, RES-03, RES-04, RES-05
**Success Criteria** (what must be TRUE):
  1. `docs/integration/runtime-decision.md` records the reaper decision and the RT-01 mount-list amendment for the scratch volume in a commit that precedes the code that needs them (RES-01).
  2. A live scenario kills the daemon and restarts it, and the same container id is active with its `/workspace` content intact and no second container exists (RES-02, RES-05).
  3. A container that fails the create-time hardening verifier, and a container with no record, are removed at startup, and both outcomes are logged (RES-02, RES-05).
  4. A file written to the session-owned scratch volume beyond `/workspace` survives a daemon restart and is gone after `realm down` (RES-03, RES-05).
  5. The snapshot and restore commands return a modified workspace to its prior content byte for byte, using the mechanism (copy, reflink or filesystem snapshot) that a recorded spike chose (RES-04, RES-05).

**Notes:** Owner decision D5, items ii and iii: the startup reaper re-adopts a running container that passes the hardening verifier and removes what cannot be proven good, superseding the "remove everything" form of D-84, D-86 and RT-08 while keeping the no-orphan guarantee in a precise form, and RT-01's mount list gains the scratch volume. Both are recorded before the code. Live runs on the shared realm stack are serialized, because the startup reap is account-wide.

**Plans**: TBD

### Phase 20: Release pipeline hardening

**Goal:** A release is built without privilege, carries a verifiable provenance attestation, can be marked a prerelease by one workflow, and has a changelog that omits features that were removed.
**Depends on:** Phase 13 (both change the CI workflow); pipeline lane, scheduled last because it changes the release path that every earlier pull request ships through
**Requirements:** REL-01, REL-02, REL-03, REL-04
**Success Criteria** (what must be TRUE):
  1. The release workflow has an unprivileged build job and a separate publish job, and the write permissions and the publishing steps are only in the publish job, as shown by reading the workflow and by a release run (REL-01).
  2. `gh attestation verify` accepts a release artifact produced by the new workflow (REL-02).
  3. Running the manual rollback workflow on a test release marks it a prerelease and re-points the documentation (REL-03).
  4. A test over `scripts/release/changelog.mjs` shows that the commits of a feature that was later removed are absent from the generated changelog (REL-04).

**Notes:** Owner decision D6 (2026-10-29) signs off the changes under `.github/workflows/**`, `release/**` and `scripts/release/**`; each pull request cites D6 in its body, and human review before merge still applies (`AGENTS.md`). The repository settings of TD-10 (secret scanning, push protection, branch protection, `sha_pinning_required`) stay the owner's and cannot be changed from the repository; only the job split and the attestation are in this phase. The attestation is unverified until a release built by the new workflow exists.

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 9.1 → 9.2 → 9.3 → 9.4 → 9.5 → 9.6 → 9.7 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20

Milestone v3.0 phases (12 to 20) run in three parallel lanes that share no mutable state: Omp 12, 15, 16; runtime 14, 17, 18, 19; pipeline 13, 20. The Depends on line of each phase governs; the numeric order above is the default sequence when one worker runs them all. Live runs on the shared realm stack take a lock and run one at a time.

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
| 9. Live Omp Verification | 3/3 | Complete (2026-10-28): plan 09-01 closed for code and unit gates on 2026-10-25; OMP-LIVE-01, -03, and -04 were run live on the final build in phase 9.6 (owner decision 2026-10-25, reinstating them from the 2026-10-23 descope); OMP-LIVE-02 met live earlier; UI-01 non-blocking recorded as a stated limitation | - |
| 9.1. Host Prerequisites and Production Gateway | 1/1 | Complete (2026-10-25): T1 to T9 with evidence; T6 reboot PASS; the main gateway's keep-alive bridge was restored after the reboot and is persistent through boot unit HC-07 | - |
| 9.2. Native Enforcement Helper | 1/1 | Complete (superseded 2026-10-28): the helper was built and gated in 2026-10-25, then removed by owner decision; enforcement is the runtime policy plus the vendored seccomp profile, proven live in phase 9.6 | - |
| 9.3. Hardened Container Lifecycle | 1/1 | Complete, VERIFIED_WITH_GAPS (2026-10-25): live acceptance 1, 4, 5, 6, 7 PASS after the reboot; acceptance 2 and 3 unit-verified, live NOT RUN; launch and active removal unit-verified | - |
| 9.4. Compute Driver gRPC | 1/1 | Complete, VERIFIED (2026-10-25): gateway connected live; create, get, list, and delete observed; limits carried to 9.5 (Ready state, PD-08 stop and start live, AuthenticateSandbox) | - |
| 9.5. Isolation Backend and Sandbox Protocol | 1/1 | Complete on the amended built-in path (2026-10-26): live T0 reached Ready with the runtime as PID 1 and the host supervisor connected; PD-15 host placement and PD-10 runtime policy decided; live checks moved to 9.6 | - |
| 9.6. Integration, Live Proof, and Cutover | 1/1 | Complete (2026-10-28): six live scenarios 28 of 28 at d2db549 (crash recovery 3 of 3 more times); Omp checks verified live; gates green (1635 pass, 0 fail, 7 skipped); owner decisions listed in the verification file | - |
| 9.7. Review-Finding Remediation | 1/1 | Complete (2026-10-28): the A10 and A18 findings fixed or recorded; four defects found by the live proof fixed (rlimit REST names, driver shutdown, doctor digest bound, verifier exit-2 classification); nine live scenarios 31 of 31 on the rebuilt image, twice (the second on the final installed build); gates at the closing code commit: 1828 tests, 1818 pass, 0 fail, 10 skipped, test:scripts 109 of 109. Pull request 6 (2026-10-29): Greptile 0, 4, then 5 of 5 over three rounds (six findings, all fixed; one was a regression from an earlier fix), CI green; on the PR head 2c401b5: 1843 tests, 1833 pass, 0 fail, 10 skipped, test:scripts 109 of 109, live suite 31 of 31 on that exact build. The RT-04 wording was amended by the owner to match ruling N1 and the other owner decisions are listed in 09.7-VERIFICATION.md | - |
| 10. Docs, Packaging, and Release 0.2.0 | 4/4 | Complete (2026-10-29): plans 10-01 to 10-03 done, HOST-03 complete; 10-04: the reserved files were reviewed by four independent lanes plus an adversarial review and a release rehearsal and upgraded (10-04-RESERVED-FILES.md), TOOL-05 was proven live, pull request 6 was merged through the ship flow with a merge commit (550a41f) after Greptile gave 5 of 5 on its final head, the release job published v0.2.0 (84d937c) with checksums and an SBOM, Pages deployed, and the released tarball passed the live suite on the production stack (31 of 31) | 2026-10-29 |
| 11. Milestone v2.0 Close | 1/1 | Complete (2026-10-29): the milestone audit ran against the built and installed product and found five defects the records had marked complete (the MCP server could not be used from Claude Code, its tool results and an exec descriptor did not match the revision and the Anthropic API, both agent surfaces advertised 0.0.0, and the Omp attach probe), all fixed in pull request 7 and released as 0.2.1 (31 of 31 on the live suite); `milestone complete v2.0 --confirm` then archived the milestone with eight requirements carried (FS-02, ANDA-01 to 04, OMP-05, PRD-DRV-01 open; UI-01 an accepted limitation) | 2026-10-29 |
| 12. Scripted-provider harness and Omp enforcement spike | 0/TBD | Not started | - |
| 13. Quality ratchet | 0/TBD | Not started | - |
| 14. Crash-safety pack | 0/TBD | Not started | - |
| 15. Zero-config onboarding and fail-closed default | 0/TBD | Not started | - |
| 16. Omp runs in the sandbox | 0/TBD | Not started | - |
| 17. Observability and tamper-evident audit | 0/TBD | Not started | - |
| 18. Per-project sandboxes | 0/TBD | Not started | - |
| 19. Resume and checkpoint | 0/TBD | Not started | - |
| 20. Release pipeline hardening | 0/TBD | Not started | - |
