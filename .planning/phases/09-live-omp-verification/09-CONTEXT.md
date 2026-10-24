# Phase 9 Context: Live Omp Verification

Status: DISCUSS complete. Paused at GREY_AREA_ACCEPTANCE before PLAN. Run: ut-mvlvx860-9e2d5e0a (gsd-autonomous). Hand-written by the orchestrator; flagged for owner ratification.

## Goal (ROADMAP)

A live Omp session attaches, reports a truthful disconnected status with its reason, retries, and leaves the daemon running on shutdown.

## Requirements and status (REQUIREMENTS.md)

| ID | Status | Basis |
|---|---|---|
| OMP-LIVE-01 | Descoped to follow-up | Owner decision 2026-10-23; no AgentOS driver bound |
| OMP-LIVE-02 | Complete | Live 2026-10-23: disconnected with the daemon's reason, never active. Re-run 2026-10-24 after the libpod fix: disconnected, reason "no workspace", never active. The REQUIREMENTS traceability text still cites SCHEMA_INVALID and is stale |
| OMP-LIVE-03 | Descoped to follow-up | Owner decision 2026-10-24; no active daemon on this host |
| OMP-LIVE-04 | Descoped to follow-up | Owner decision 2026-10-23; no daemon survives on this host |
| UI-01 | Accepted limitation | Owner decision 2026-10-23; status item at launch, non-blocking not demonstrated |

## Locked decisions (USER; not reopened in this phase)

- U-1 (2026-10-22): AgentOS deferred to a follow-up milestone. `realm up` fails closed with AGENTOS_NOT_CONFIGURED.
- U-2 (2026-10-23): OMP-LIVE-01 and OMP-LIVE-04 descoped; UI-01 accepted as a limitation.
- U-3 (2026-10-24): OMP-LIVE-03 descoped; the ship hold stands.
- U-4 (2026-10-24, accepted expansion): the libpod route fix at 4579214 is in scope for this milestone.

## Evidence gathered for the decision (read-only, this run)

- AgentOS library: `@rivet-dev/agentos-core` version 0.4.4, licence Apache-2.0, read from the npm registry 2026-10-24. Not installed in this repository: there is no `node_modules/@rivet-dev`.
- Spike blockers (docs/integration/agentos.md, 2026-10-22): a 16 MiB write takes down the sidecar and the embedding process; no verified control channel into an OpenShell sandbox; host Podman below 5.x (now available). The spike's revisit conditions (a) to (d) are listed in that note.
- Host runtime: OpenShell CLI 0.1.2, gateway connected at 127.0.0.1:17670 over mTLS. Podman 5.7.1 is installed at /usr/local/bin; /usr/bin/podman 4.9.3 resolves first on PATH.
- Rootless image store for the dedicated live user: empty. No base image is present, so REALM_LIVE_IMAGE cannot be satisfied from local storage alone.
- Anda Engine server: not installed. The `anda` command on PATH is Anda Bot 0.11.6, not the engine. Licence conflict OQ-P3-11 is open.

## Grey areas awaiting acceptance (DECISION_GATES: GREY_AREA_ACCEPTANCE)

- G1, AgentOS binding and OMP-LIVE scope. Triggers: a change to the ROADMAP requirement set, a new runtime dependency, and an architecture choice. Options:
  - (a) Feasibility gate first: run the spike's revisit conditions live on Podman 5.7.1 outside the repository. Reinstate OMP-LIVE-01, -03, and -04 only on go. [recommended]
  - (b) Bind AgentOS now and reinstate OMP-LIVE now, accepting the known sidecar crash risk.
  - (c) Keep AgentOS deferred. OMP-LIVE-01, -03, and -04 stay descoped; phase 9 closes on OMP-LIVE-02 and UI-01 evidence.
  - (d) Change the runner design: OpenShell sandbox exec without AgentOS. Requires a spec amendment to D-46 and D-47 and to the RT-04 and CLI-01 wording.
- G2, live gate inputs. Triggers: an external image and a registry pull. Options:
  - (a) Choose a minimal public base, pin it by digest, and pull it after registry approval. [recommended]
  - (b) You supply the digest-pinned image and the workload argv.
  - (c) Keep the live container gates skipped (8 skips stand).
- G3, Anda Engine. Triggers: third-party software and an open licence conflict (OQ-P3-11). Options:
  - (a) Install the upstream engine server locally for live ANDA tests only. Nothing is vendored and no repository dependency is added. [recommended]
  - (b) Keep the ANDA live gates skipped.
  - (c) You supply the engine binary.
- G4, Podman 5.x on PATH for realm runs. Triggers: a change to the host's active runtime, which INSTALL_RULES pauses. Options:
  - (a) Put Podman 5.7.1 first on PATH only for realm runs, through the run environment. Reversible; no system change. [recommended]
  - (b) Change the global PATH or the shell profile.
  - (c) Keep Podman 4.9.3; the live gates stay skipped.

## Out of scope for this phase unless accepted

- Changing daemon startup behaviour, any release step, any locked USER decision, and any codebase-wide quality pass.

## Resume

When the answers arrive: record each as a USER decision with its ID in STATE. Then, for G1 option (a), run the feasibility gate outside the repository and record its result. Then re-enter GREY_AREA_ACCEPTANCE for anything the answers leave open, and only then run PLAN for phase 9.
