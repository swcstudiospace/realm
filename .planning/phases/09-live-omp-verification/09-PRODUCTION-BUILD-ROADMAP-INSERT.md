# Phase 9 Production Build: ROADMAP Insert

Status: PENDING OWNER APPLICATION. The planner did not edit `.planning/ROADMAP.md`: the shell guard reported it as a protected path that needs human approval, and the edit was not applied. Nothing in the roadmap has changed yet. Apply the four parts below, in order, to `.planning/ROADMAP.md`:

1. Checklist lines: add after the `Phase 9: Live Omp Verification` checklist line, before `Phase 10`.
2. Detail blocks: add before the `### Phase 10: Docs, Packaging, and Release 0.2.0` heading.
3. Progress rows: add after the `9. Live Omp Verification` row of the Progress table.
4. Coverage sentence: append to the Coverage line of the Overview.

## 1. Checklist lines

- [ ] **Phase 9.1: Host Prerequisites and Production Gateway** - Rootless realm-account runtime with delegated limits and a production TLS and JWT gateway (PRD-HOST-01, PRD-HOST-02, PRD-GW-01, PRD-GW-02)
- [ ] **Phase 9.2: Native Enforcement Helper** - Source-built static helper applying no_new_privs, Landlock, and seccomp, fail closed (PRD-ENF-01 to PRD-ENF-03)
- [ ] **Phase 9.3: Hardened Container Lifecycle** - Create, verify with the 14 checks, and remove the sandbox container; startup sweep (PRD-CTR-01 to PRD-CTR-05)
- [ ] **Phase 9.4: Compute Driver gRPC** - Realm-owned ComputeDriver server on a user-only socket; admission matches the gateway (PRD-DRV-01 to PRD-DRV-03, PRD-GW-03, PRD-LIB-01)
- [ ] **Phase 9.5: Isolation Backend and Sandbox Protocol** - No workload before StartAgent; mediated egress and DNS (PRD-ISO-01 to PRD-ISO-06, PRD-SUP-01, PRD-GW-04)
- [ ] **Phase 9.6: Integration, Live Proof, and Cutover** - Gated live suite, realm up and down proof, docs, clean cutover (PRD-TST-01 to PRD-TST-03, PRD-OMP-01, PRD-DOC-01, PRD-CLEAN-01)

## 2. Detail blocks

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

## 3. Progress rows

| 9.1. Host Prerequisites and Production Gateway | 0/1 | Planned (blocked on PD-02, PD-03, PD-04, PD-17 and host approvals HC-01 to HC-03, HC-06) | - |
| 9.2. Native Enforcement Helper | 0/1 | Planned (source needs no decision; image build in phase 9.3) | - |
| 9.3. Hardened Container Lifecycle | 0/1 | Planned (needs 9.1 and 9.2; digest confirmation T0) | - |
| 9.4. Compute Driver gRPC | 0/1 | Planned (needs 9.3; starts after plan 09-01 closes) | - |
| 9.5. Isolation Backend and Sandbox Protocol | 0/1 | Planned (needs 9.4; PD-15 evidence first) | - |
| 9.6. Integration, Live Proof, and Cutover | 0/1 | Planned (needs 9.1 to 9.5) | - |

## 4. Coverage sentence

Append to the Coverage line in the Overview: "The production isolation build adds 31 PRD requirements, mapped to phases 9.1 to 9.6."
