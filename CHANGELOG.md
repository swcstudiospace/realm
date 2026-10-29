# Changelog

This changelog follows Keep a Changelog 1.1.0, and the project follows Semantic Versioning. The release line rule is described in AGENTS.md under Versioning and release.

## [Unreleased]

## [0.3.6] - 2026-10-29

### Added
- feat(daemon): sweep and reconcile at start, log the reap and show a notice (phase 14, part 2) (#15) (5719f81)

## [0.3.5] - 2026-10-29

### Security
- security!: default the policy mode to fail-closed (phase 15, part 1) (#19) (84f335b)

## [0.3.4] - 2026-10-29

### Maintenance
- test: add property tests for the canonicalizer and the policy parser, with fast-check (phase 13, part C-props) (#17) (9ef8b04)

## [0.3.3] - 2026-10-29

### Added
- feat: add the crash-safety libraries, the lost-container retry and the daemon cause code (phase 14, part 1) (#11) (157ebfe)

## [0.3.2] - 2026-10-29

### Maintenance
- test: replace fixed-timeout waits with injected clocks, gates and a scaled-timeout helper (phase 13, part B) (#14) (15a3651)

## [0.3.1] - 2026-10-29

### Maintenance
- ci: audit production dependencies, add Dependabot and smoke the release tarball (phase 13, part A) (#12) (fe76536)

## [0.3.0] - 2026-10-29

### Documentation
- docs: start milestone v3.0 Containment by Default (#10) (6fe70ee)

## [0.2.3] - 2026-10-29

### Documentation
- docs(omp): record the lifecycle findings and add a runbook (#9) (b3e90e3)

## [0.2.2] - 2026-10-29

### Maintenance
- chore(milestone): archive milestone v2.0 and record its audit (#8) (be10b1e)

## [0.2.1] - 2026-10-29

### Fixed
- fix(omp): wait for a daemon that holds the socket instead of spawning over it (f70c236)
- fix(mcp): serve the legacy initialize era beside the modern one, with spec-shaped results and descriptors (edb28e5)
- fix(omp): tolerate the daemon's bind race the way the CLI does (b93d1d8)
- fix(acp): advertise the package version instead of 0.0.0 (8620576)

### Documentation
- docs: record the MCP protocol eras, the real-host evidence and the descriptor rule (6906676)
- docs(core): correct the error catalogue header count (4b52015)

### Maintenance
- test(mcp): pin the element type of the exec argv descriptor (8e22802)

## [0.2.0] - 2026-10-29

### Added
- feat(release): list the version files, omit planning commits and write release assets (943e15e)
- feat(driver): pin the host supervisor by digest and report host binaries and the ptrace scope in realm doctor (f8f368a)
- feat(hardening): deny nested user namespaces and the mount family, and verify 11 more container properties at create (7cc2765)
- feat(driver): run the in-container runtime as the main process, with no exec route (20a81b6)
- feat(driver): start the in-container runtime on the built-in path (217c157)
- feat(driver): advertise the isolation-backend capability and accept the configured backend only (7aa12d1)
- feat(isolation): accept the gateway's launch material and store it in the secret root (df29a10)
- feat(isolation): answer DiscoverPolicy as the supervisor's startup requires (835c385)
- feat(isolation): bind handles in OpenBoundary and pin the gateway identity (0d6e7ec)
- feat(gateway): render the supervisor isolation backend section (dbea9e8)
- feat(driver): start the isolation backend in the driver process (686244a)
- feat(isolation): verify the supervisor bearer and serve Attach (237d743)
- feat(isolation): bind handles to a sandbox and invalidate them on delete (f4c78ac)
- feat(isolation): add the isolation protocol protos and the backend skeleton (1228c0b)
- feat(driver): add the compute driver process entry (4c5b1da)
- feat(driver): serve the ComputeDriver over a user-only unix socket (fae17e2)
- feat(driver): implement the ComputeDriver service with profile-checked create (440fe97)
- feat(driver): add the pinned admission acknowledgement and the gRPC status table (184d5d1)
- feat(runtime): remove launch and active files on sandbox delete (ad6222c)
- feat(runtime): harden the container lifecycle for phase 9.3 (1f714ac)
- feat(sandbox): add the native enforcement helper and its image definition (497b63f)
- feat(runtime): render the production gateway profile with TLS and JWT tables (d54e051)
- feat(runtime): add the AgentOS sandbox driver and key sandboxes by OpenShell labels (0a5e208)
- feat: host adapter bundles, MCP startup fix, and opt-in devnet anchoring (H1) (b7e9e1c)

### Changed
- refactor(anchor): give AnchorError a catalogue error code (3b0c15d)
- refactor(driver): remove the vendored protos that only the registered backend used (05bf7c0)
- refactor(runtime): require the image ref on sandbox create and trim stale comments (10032c9)
- refactor(sandbox): remove the retired realm helper and its image stages (c0a071b)
- refactor(runtime): make the session sandbox the only sandbox and drop the workload command from the runtime config (2007997)
- refactor(isolation): remove the registered backend code the built-in path makes dead (edb1053)

### Fixed
- fix(ci): dispatch Pages when the tip of main is a release commit (2b468a7)
- fix(acp): serve the tool method as the spec-reserved _realm/tool and advertise it (86bcb36)
- fix(agentos): do not let a check made during the initial start hold the supervisor (17cba3f)
- fix(anchor): turn audit log read failures into a controlled AnchorError (c3a65d4)
- fix(agentos): make a failed probe terminal, as the amended RT-04 says (0813010)
- fix(driver): claim the socket before the startup sweep and refuse creates until it resolves (1c029bc)
- fix(control): let the up request outlast the default startup budget (993e294)
- fix(session): refuse a sandbox whose mounted root is not the policy-approved workspace (94b401d)
- fix(image): exit 2 for a copy failure that is not an absent file, and refuse bad arguments before podman runs (482ca81)
- fix(doctor): read the driver's supervisor pin exactly as the driver does (6faf200)
- fix(doctor): bound the host binary digest separately from the process probe (cac8420)
- fix(libpod): send rlimit types in the form the engine's REST API expects (074f28e)
- fix(driver): bound the gRPC shutdown so SIGTERM exits within a grace period (cce4438)
- fix(egress): refuse private and special IPv4 literals in every notation (363bcae)
- fix(daemon): move the session to error when the AgentOS runner dies (1f99c97)
- fix(fs): pin the atomic write's directory by descriptor, fsync audit lines and widen the credential deny list (45aa633)
- fix(driver): reclaim the state and secret directories of a sandbox whose container is gone (d2db549)
- fix(tools): run exec and write on an active session that has no Anda bridge configured (82e099e)
- fix(runtime): force-remove leftover realm containers within the sweep bound (3a16a46)
- fix(runtime): check the sandbox name length after the create-time configuration checks (abe8b86)
- fix(runtime): refuse a session whose sandbox name exceeds the gateway's 19 character limit (3faf43a)
- fix(runtime): give the slow libpod info call its own 30 second timeout (a20abd6)
- fix(sandbox): point the sandbox resolver at the runtime's DNS relay (4671467)
- fix(hardening): verify the keyring syscalls are denied from the container's OCI seccomp config (f33e9d9)
- fix(hardening): read the seccomp profile from HostConfig.SecurityOpt, where Podman 5.7.1 reports it (24c9fd1)
- fix(driver): run sandboxes under Podman's default seccomp profile with the keyring syscalls denied (87c6269)
- fix(runtime): allow /dev/null, /dev/zero and /dev/random in the sandbox policy (3d79800)
- fix(runtime): keep the AgentOS heartbeat in scratch space, not in the workspace (6af73ce)
- fix(daemon): bind a session's sandbox state to the driver's state root (61cce5c)
- fix(driver): hold a pinned root for every live container, including after a restart (cc99538)
- fix(core): raise the default startup budget to cover an AgentOS start (799b762)
- fix(driver): refuse a second live sandbox on the same pinned root (ceef799)
- fix(daemon): take the AgentOS sandbox image from the configured digest only (6fc3e58)
- fix(lifecycle): reach active without an Anda bridge when no andaUrl is configured (efe2503)
- fix(hardening): verify zero capability sets from the live process, not KernelCaps (9dc731e)
- fix(runtime): verify sandbox containers with one binding for the driver and the session (9a43f53)
- fix(driver): mount the pinned workspace root and never remove it on delete (4473535)
- fix(check): drop the removed workloadArgv key from the MCP smoke config (54a6928)
- fix(runtime): take the sandbox name from the session and close the stop and create races (d4d778e)
- fix(runtime): delete session sandboxes on stop and close the stop-during-create and overlapping-start gaps (e01dabd)
- fix(driver): disable IPv6 in the sandbox network namespace (57a7692)
- fix(runtime): start the AgentOS runner as a managed exec child after create (cc4fe6d)
- fix(driver): start the supervisor's SSH access on a socket outside every container mount (7902a48)
- fix(driver): set the runtime's low-port sysctl in the sandbox create body (b41889d)
- fix(image): allow the dynamic loader's own soname in the runtime dependency gate (d7caa03)
- fix(driver): stop refusing the built-path create at podman, and log the create refusals by check (6a8b56b)
- fix(driver): observe the supervisor's exit and make delete report what happened (7dda8f1)
- fix(isolation): remove the TLS keys once the listener is confirmed, and check the socket path limit (3ce4f7a)
- fix(driver): require launch material at create, not at validation (538c0ef)
- fix(isolation): match the gateway's launch-material encoding and log refusals by check (dfe3050)
- fix(driver): prefix sandbox names and accept an empty command (3606f4b)
- fix(driver): create the workspace and state directories before a sandbox create (8565dc8)
- fix(driver): advertise the package version as the extension implementation version (fa235c6)
- fix(runtime): close review minors for the phase 9.3 lifecycle (aea0d50)
- fix(runtime): verify the container's kernel capability sets instead of the literal cap-drop list (57690a8)
- fix(runtime): send libpod requests under the /_ping API version (4579214)
- fix(check): assert declared pack entries; clean mcp scratch on early failure (3d8fcb7)
- fix(release): sync the Hermes JSON manifest and stage adapter manifests (6c9aa50)
- fix(ci): run the Pages deploy after a superseded or skipped release plan (23e6257)
- fix(adapters): Muse Code and Hermes Agent bundles pass their validators (c816d36)
- fix(daemon): report a refused start with the daemon's own code (e8f93bd)
- fix(omp): take the host's (event, ctx) arguments in session_start (ef91b81)

### Security
- security(pages): grant each Pages job only what it calls and deploy only after a release (ef0f1a0)
- security(ci): keep the release token away from dependency and build code (7746e1a)

### Documentation
- docs: state the Pages dispatch rule as the code now implements it (7141b5e)
- docs: align the contributor docs and the support window with the release flow (d524d23)
- docs(legal): attribute the vendored Apache-2.0 material and ship its licence text (2e4e833)
- docs: record the review outcome, the final evidence and two late observations (278005a)
- docs: record the round-two fix, the pull request and the review rounds (2c401b5)
- docs: record the five fixes made in answer to the Greptile review of the pull request (7639cf0)
- docs: record the live evidence of 2026-10-28, the live-proof fixes and the final review dispositions (b227499)
- docs: record the phase 9.7 hardening, host binaries, image build and review dispositions (0d06c13)
- docs(integration): refresh the Omp runbook, the driver RPC status and the drifted references (3a4f139)
- docs(integration): record the accepted residual risks and the open review items of the production sandbox (40684e0)
- docs(integration): record the sandbox DNS relay's synthetic answers and the final-build evidence (fdd335b)
- docs: match the integration docs and AGENTS.md to the production stack (3a96585)
- docs(integration): record the OpenShell 0.1.5 CLI pin and the create-command finding (164b942)
- docs(integration): record the phase 9.4 call sites and limits (64de730)
- docs(integration): record the compute driver RPC table and the PD-08 default (e0887b5)
- docs(policy): record the workspace-root breadth residual (a563c83)
- docs(omp): record the OQ-P5-02 re-read and the Podman 5.7.1 live run (3762e60)
- docs: record the owner's 2026-10-23 decisions (f0202b0)
- docs: record the live Omp run, validator results, and refreshed host snippets (3822494)
- docs(omp): verified live-run procedure with expected results on this host (5f99e62)

### Maintenance
- test(driver): cover a zero shutdown grace and a socket that is already gone, and correct the close comment (1176449)
- build(sandbox): compile the runner in the image, gate every input and commit the expected digests (0a0f3fc)
- ci: pin actions to commit SHAs, add job timeouts and persist-credentials false (439f4f7)
- test(integration): add live scenarios for TOOL-04, RT-04 and OMP-01 to the gated production suite (afc3659)
- test(integration): add crash recovery and MCP exec to the production live suite (1915b22)
- test(integration): remove the live bodies the production live suite supersedes (82895d9)
- test(integration): download the live suite's transfer file from the sandbox workspace (2086281)
- test(runtime): keep the libpod timeout tests independent of host speed (9c9147a)
- test(lifecycle): freeze the controller clock in the create-interrupt and idempotent budget tests (403c1cc)
- test(runtime): freeze the controller clock in the startup-budget tests (22a30ce)
- test(integration): add the gated live suite for the production stack (f067b54)
- test(runtime): keep the startup-budget tests independent of host speed (f6bbea8)
- build(image): build the in-container runtime in a pinned bookworm builder with a glibc gate (14abfbc)
- build(lint): allow child_process in the two supervisor spawn modules (03c0382)
- build(pack): assert the isolation protos in the packed package (6c85e37)
- build(pack): assert the vendored driver protos in the packed package (9e93a21)
- build(driver): pin grpc packages exactly and vendor the compute driver protos (351c725)
- test: remove wording-pin tests and enable noUncheckedSideEffectImports (00daeaf)
- test: remove source-text pins of documentation wording (0b65719)
- chore(changelog): drop branch edits; the release job owns CHANGELOG.md (54c29d7)
- chore(site): ignore generated adapters pages (9015268)

## [0.1.3] - 2026-10-23

### Changed
- 00057 - CI: run all jobs on Omega CI runners (8510529)

## [0.1.2] - 2026-10-22

### Changed
- Archive milestone v1.0 with its audit and deferred verification (#4) (58d2daa)

## [0.1.1] - 2026-10-22

### Changed
- Add the GitHub Pages docs site built from the repository markdown (#3) (118499c)

## [0.1.0] - 2026-10-22

### Added

- Strict ESM TypeScript package with typecheck, lint, test, and build scripts (FOUND-01).
- Frozen shared contracts: six-state machine, typed error catalogue, tool, session-record, and policy schemas, with schema rejection tests (FOUND-02).
- Integration notes under `docs/integration/`, each citing its official URL and read date (FOUND-03).
- State machine that rejects disallowed transitions, one display-label mapping ("realm active" or "realm disconnected") with reason and transition time, and a typed event bus (CORE-01, CORE-02, CORE-04).
- Policy engine with advisory mode as the default and a visible warning, and fail-closed mode as an opt-in per project (CORE-03).
- Mutation gate on state `active` with a bounded queue wait, and idempotent lifecycle operations (CORE-05, CORE-06).
- Filesystem lockdown: root-allowlisted canonical paths that reject escapes with `PATH_ESCAPE`, credential-path denial, advisory write locks with content-hash re-check, and atomic writes that report `WRITE_NOT_ATOMIC` (FS-01, FS-03, FS-04, FS-05).
- User-only control socket: directory 0700, socket 0600 (RT-06).
- Session record written before container creation (RT-07).
- Redacted JSONL audit log, and no host environment injected into the sandbox (AUD-01, AUD-02).
- `realm up` reports `PODMAN_MISSING` and exits promptly when Podman is absent; `realm doctor` lists each prerequisite with its fix (CLI-02, CLI-03).
- Six tools behind one schema, with every input validated before any sandbox call; argv-first exec, with shell mode gated by policy (TOOL-01, TOOL-02).
- Suite taxonomy with Podman-gated skips, and the policy reference and security and supply-chain reviews in `docs/policy-reference.md` (QUAL-02, QUAL-03).
- Silent-catch rule for the codebase, with a named list of exceptions (QUAL-01, amended 2026-10-22).
- Omp status as one item that carries the reason and transition time in its text (OMP-03, accepted approximation: the host has no tooltip API).

Open items, not part of 0.1.0:

- RT-04 (in-sandbox AgentOS runner) and CLI-01 (`realm up` reaching active) are deferred to a follow-up milestone.
- `realm up` fails closed with `AGENTOS_NOT_CONFIGURED` until an AgentOS driver exists.
- Live verification is deferred to a host running Podman 5.x. The affected requirements are RT-01, RT-02, RT-03, RT-05, RT-08, RT-09, TOOL-03, TOOL-04, TOOL-05, OMP-01, OMP-02, OMP-04, OMP-05, CLI-04, ANDA-01, ANDA-02, ANDA-03, and ANDA-04.
- FS-02 (race-resistant path resolution) is a partial, accepted approximation that awaits confirmation.

### Changed

- Licence is AGPL-3.0-only (`LICENSE`, `NOTICE`).
- Release automation runs from CI: it computes the next version, syncs the version, generates the changelog and release notes, tags the release, and creates the GitHub release.
- Documentation is published as a GitHub Pages site.
