# Phase 9 Production Build: REQUIREMENTS Insert

Status: PENDING OWNER APPLICATION. The planner did not edit `.planning/REQUIREMENTS.md`. The shell guard blocked the ROADMAP edit as a protected-path mutation; the planner did not try to apply this file another way. Apply the two parts below to `.planning/REQUIREMENTS.md`:

1. Section: insert before the `## v2 Requirements (deferred)` heading, after the `### Integrated UI (UI)` section.
2. Traceability rows: append after the `| UI-01 | Phase 9 |` row.

RT-01, RT-03, and RT-05 are not changed by this insert. Their status moves only with the live evidence named in phase 9.6.

## 1. Section

### Production isolation build (PRD)

- [ ] **PRD-HOST-01**: The realm account runs its rootless Podman API as a user-manager unit with cgroup delegation, runc is configured for that account, `podman --remote info` reports rootless true, a 5.x version, and runtime runc, and CPU, memory, and PID limits are enforceable (Phase 9.1)
- [ ] **PRD-HOST-02**: The rootless API, its unit, and linger survive a host reboot without a manual step (Phase 9.1)
- [ ] **PRD-GW-01**: The realm gateway serves TLS with a server certificate and a client CA from the realm state directory, and the production profile never writes `disable_tls` (Phase 9.1)
- [ ] **PRD-GW-02**: The realm gateway signs sandbox bearers with JWT keys (signing key, public key, and kid) held in the realm state directory with user-only permissions; no key value appears in the repository (Phase 9.1)
- [ ] **PRD-GW-03**: The realm gateway's compute driver is the realm driver, and the driver's advertised name and resource admission acknowledgement match the gateway's expected policy (Phase 9.4)
- [ ] **PRD-GW-04**: The realm gateway registers the realm isolation backend with a unique name and an absolute unix socket endpoint (Phase 9.5)
- [ ] **PRD-DRV-01**: The realm compute driver serves ComputeDriver gRPC on a Unix socket in a 0700 directory with mode 0600, implementing GetCapabilities, ValidateSandboxCreate, CreateSandbox, GetSandbox, ListSandboxes, DeleteSandbox, WatchSandboxes, AuthenticateSandbox, EnsureWorkspace, and DeleteWorkspace (Phase 9.4)
- [ ] **PRD-DRV-02**: ValidateSandboxCreate and CreateSandbox refuse, before any libpod call, a request whose image digest, CPU, memory, network mode, mounts, capabilities, or workload argv differ from the realm profile (Phase 9.4)
- [ ] **PRD-DRV-03**: StopSandbox and StartSandbox return the status decided in PD-08 and change no sandbox state (Phase 9.4)
- [ ] **PRD-CTR-01**: CreateSandbox creates and starts a container whose only process is the idle init, reads the kernel capability sets of its init process on the host, and verifies the 14 hardening properties; when any property fails it removes the container and returns an error naming the property (Phase 9.3)
- [ ] **PRD-CTR-02**: DeleteSandbox removes the sandbox's container and its launch and active state; afterwards no realm-labelled container for that sandbox exists (Phase 9.3)
- [ ] **PRD-CTR-03**: The driver removes realm-labelled containers left by a previous generation before it accepts requests (Phase 9.3)
- [ ] **PRD-CTR-04**: Containers carry the OpenShell labels that existing realm code reads (managed, sandbox name, and isolation role) (Phase 9.3)
- [ ] **PRD-CTR-05**: The sandbox image is a derived image pinned by digest, contains the helper, and mounts no socket (Phase 9.3)
- [ ] **PRD-ENF-01**: The helper applies no_new_privs, then a Landlock ruleset at ABI 3 or higher, then a seccomp denylist, and exits non-zero before exec on any failure (Phase 9.2)
- [ ] **PRD-ENF-02**: The helper is built from committed source in a pinned builder, is statically linked, and its source and binary digests are recorded in the image record (Phase 9.2)
- [ ] **PRD-ENF-03**: An in-container probe shows the helper denies a `/tmp` write with EACCES, allows a `/workspace` write, returns EPERM for keyctl, and reports NoNewPrivs 1 and Seccomp 2 (Phase 9.2, live in Phase 9.6)
- [ ] **PRD-ISO-01**: The IsolationBackend server implements Describe and OpenBoundary; SuspendBoundary and ResumeBoundary follow PD-09; Describe advertises only implemented capabilities (Phase 9.5)
- [ ] **PRD-ISO-02**: The SandboxProtocol server implements, as frames on its Exchange and Mediate streams, DiscoverPolicy, Attach, Confirm, OpenMediation, StartAgent, AttachProcess, Wait, UpdateProviderEnvironment, Signal, Terminate, TerminateBoundary, Resize, Exec, LoopbackConnect, and AcceptNetwork in the state order Attached, Confirmed, Running, Terminated (Phase 9.5)
- [ ] **PRD-ISO-03**: No workload process starts before StartAgent, and at Confirm the only process in the container is the idle init (Phase 9.5)
- [ ] **PRD-ISO-04**: Control frames are at most 1 MiB and I/O payloads at most 64 KiB, and a 16 MiB stdin write reads back byte for byte (Phase 9.5)
- [ ] **PRD-ISO-05**: Egress is default-deny through mediation: the container has no network interface, DNS answers come only through Mediate for allowlisted names, AAAA queries are refused, and non-allowlisted hosts fail (Phase 9.5)
- [ ] **PRD-ISO-06**: After DeleteSandbox, every handle opened for that sandbox fails and changes no state (Phase 9.5)
- [ ] **PRD-SUP-01**: The OpenShell supervisor's process placement and network path are recorded from a live attach, and RT-03 is judged against that record under PD-15 (Phase 9.5)
- [ ] **PRD-LIB-01**: The gRPC runtime and loader are exact pins with their licence and audit recorded; the OpenShell protos are vendored at a recorded revision with per-file digests and shipped in the package (Phase 9.4)
- [ ] **PRD-TST-01**: Every module added in phases 9.1 to 9.5 has unit tests that run under `npm test` with no host dependency (Phase 9.6)
- [ ] **PRD-TST-02**: A gated live suite, skipped in CI, checks on the realm host the 14 hardening properties, the helper probe, the supervisor order, the 16 MiB round trip, exit status, non-root start, egress, and delete (Phase 9.6)
- [ ] **PRD-TST-03**: `realm up`, `realm status`, and `realm down` pass on the production stack; `realm down` leaves zero realm containers; a wrong image digest makes `realm up` fail closed with no container left (Phase 9.6)
- [ ] **PRD-OMP-01**: OMP-LIVE-01, OMP-LIVE-03, and OMP-LIVE-04 are re-run only if PD-14 reinstates them; otherwise their descoped status is kept (Phase 9.6)
- Outcome (2026-10-28): PD-14 option (b) was chosen on 2026-10-25, so the three items were re-run and passed live; REQUIREMENTS.md is authoritative for this requirement's wording and status.
- [ ] **PRD-DOC-01**: The integration docs and `AGENTS.md` match the production layout and evidence with no host path; `CHANGELOG.md` and package version fields are not edited (Phase 9.6)
- [ ] **PRD-CLEAN-01**: Code that only the built-in driver path required is removed; no compatibility shim or fallback remains (Phase 9.6)

## 2. Traceability rows

| PRD-HOST-01 | Phase 9.1 | Pending (plan 09.1-01) |
| PRD-HOST-02 | Phase 9.1 | Pending (owner-scheduled reboot) |
| PRD-GW-01 | Phase 9.1 | Pending |
| PRD-GW-02 | Phase 9.1 | Pending |
| PRD-GW-03 | Phase 9.4 | Pending |
| PRD-GW-04 | Phase 9.5 | Pending |
| PRD-DRV-01 | Phase 9.4 | Pending |
| PRD-DRV-02 | Phase 9.4 | Pending |
| PRD-DRV-03 | Phase 9.4 | Pending (depends on PD-08) |
| PRD-CTR-01 | Phase 9.3 | Pending |
| PRD-CTR-02 | Phase 9.3 | Pending |
| PRD-CTR-03 | Phase 9.3 | Pending |
| PRD-CTR-04 | Phase 9.3 | Pending |
| PRD-CTR-05 | Phase 9.3 | Pending |
| PRD-ENF-01 | Phase 9.2 | Pending |
| PRD-ENF-02 | Phase 9.2 | Pending |
| PRD-ENF-03 | Phase 9.2 | Pending (live in Phase 9.6) |
| PRD-ISO-01 | Phase 9.5 | Pending |
| PRD-ISO-02 | Phase 9.5 | Pending |
| PRD-ISO-03 | Phase 9.5 | Pending |
| PRD-ISO-04 | Phase 9.5 | Pending |
| PRD-ISO-05 | Phase 9.5 | Pending |
| PRD-ISO-06 | Phase 9.5 | Pending |
| PRD-SUP-01 | Phase 9.5 | Pending (depends on PD-15) |
| PRD-LIB-01 | Phase 9.4 | Pending |
| PRD-TST-01 | Phase 9.6 | Pending |
| PRD-TST-02 | Phase 9.6 | Pending |
| PRD-TST-03 | Phase 9.6 | Pending |
| PRD-OMP-01 | Phase 9.6 | Pending (depends on PD-14) |
| PRD-DOC-01 | Phase 9.6 | Pending |
| PRD-CLEAN-01 | Phase 9.6 | Pending |
