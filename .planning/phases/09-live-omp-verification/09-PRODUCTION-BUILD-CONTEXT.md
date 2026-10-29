# Phase 9 Production Build: Context

Status: PLAN ONLY (2026-10-25). No product code, no tests, no commits, no push, no PR. Ship is on hold (owner, 2026-10-24); this plan does not lift it.

Companion documents in this directory:

- `09-PRODUCTION-BUILD-DECISIONS.md`: decisions the owner must make (PD-01 to PD-17).
- `09-PRODUCTION-BUILD-HOST-CHANGES.md`: every host change, its approval status, and its revert.
- `09-PRODUCTION-BUILD-RISKS.md`: risks, mitigations, and the claim each one tests.
- `09-PRODUCTION-BUILD-ROADMAP-INSERT.md` and `09-PRODUCTION-BUILD-REQUIREMENTS-INSERT.md`: the ROADMAP and REQUIREMENTS text to apply. Both files are pending owner application; the planner did not edit `.planning/ROADMAP.md` or `.planning/REQUIREMENTS.md`.
- Per-phase plans: `.planning/phases/09.1-host-prerequisites-gateway/`, `09.2-native-enforcement-helper/`, `09.3-hardened-container-lifecycle/`, `09.4-compute-driver/`, `09.5-isolation-backend/`, `09.6-integration-live-proof/`.

## Why this build exists

`realm up` is blocked on the live host. The OpenShell 0.1.5 built-in Podman driver creates the session container, and Realm's create-time verifier (`src/runtime/hardening.ts`, 14 properties) rejects it on four properties:

| Property | Why the built-in driver fails it |
|---|---|
| rootless | The Podman service it uses is rootful |
| read-only-root | The driver has no option for it |
| tmpfs | OpenShell's tmpfs set, not the profile's |
| mounts | OpenShell's own mounts, not the two the profile allows |

`cap-drop` now reads kernel evidence (`KernelCaps`, commit `57690a8`) and passes. The owner decision is to keep RT-01 and RT-03 as written. The built-in backend needs a descriptor that only a compute driver writes, so the build replaces the compute driver and adds a realm-owned isolation backend.

## Evidence base

Source: the phase 9 isolation-backend spike, round 3 report (kept outside the repository; not reproduced here). Host: Ubuntu 24.04, kernel 6.8, x86_64. OpenShell 0.1.5 installed. Podman 5.7.1 used through its REST API, with the `runc` runtime (crun 1.14.1 fails on this host).

| Gate | Verdict | What it proved | What it did not prove |
|---|---|---|---|
| G1 | GO | The gateway accepts an external compute driver and sends it `CreateSandbox` | Admission-policy mismatch path; `ValidateSandboxCreate` calls were not logged |
| G2 | GO | A rootless container passes all 14 checks after the idle init starts inside `CreateSandbox` and before any workload runs | Other Podman versions; restart; more than one sandbox |
| G3 | GO | Supervisor RPC order: `Describe`, `OpenBoundary`, `DiscoverPolicy`, `Describe`, `OpenBoundary`, `Attach`, `Confirm`, `OpenMediation`, `StartAgent`, `AttachProcess`, `Wait`, `UpdateProviderEnvironment` x2. At `Confirm` only PID 1 (the idle init) runs | Where the supervisor process runs (RT-03); DNS and egress; frame sizes; suspend and resume |
| G4 | GO | Landlock ABI 4, seccomp, and `no_new_privs` applied inside the container by a native helper. `/tmp` write gets EACCES, `/workspace` write succeeds, `keyctl` gets EPERM. A control without the helper writes `/tmp` | The seccomp list was not reviewed; the helper is not PID 1 under load; no signal or zombie tests |
| G5 | GO | `sandbox delete` leaves no container; the secret directory's launch and active files are removed | Delete during a live workload; orphan sweep after a crash |

Spike limits, stated plainly: one workload, a dev-mode gateway (TLS disabled) on loopback, `network: none`, no egress test, no 16 MiB test (open condition D-015 in `.planning/STATE.md`). The spike's effort estimate of 3 to 4 engineer-weeks is an estimate that has not been measured.

## What is verified and what is not

Verified in the repository today (read at plan time):

- `src/runtime/hardening.ts` defines 14 properties (`HARDENING_PROPERTIES`). `cap-drop` reads `KernelCaps`, and the profile constants are frozen there.
- `src/runtime/session-execution.ts` runs `runOpenShellCreate` and then `verifyOrRemove` on every create; `start` and `probe` call the AgentOS supervisor.
- `src/runtime/libpod-client.ts` has `info`, `listContainersByLabel`, `inspectContainer`, `stopContainer`, `removeContainer`. It has no create, start, or exec method.
- `src/runtime/openshell.ts` defines the OpenShell labels (`openshell.managed`, `openshell.ai/sandbox-name`, `openshell.ai/isolation-role`) and the workspace path `/workspace`.
- `src/runtime/sweep.ts` removes every realm-labelled container.
- `src/daemon/main.ts` is the daemon entry; the phase 9 plan (09-01) wires the AgentOS driver there.
- The OpenShell protos (`compute_driver.proto`, `isolation_backend.proto`, `sandbox_protocol.proto`) define the RPC surfaces used in this plan. Their headers say the API is EXPERIMENTAL and may change incompatibly.
- Gateway config fields (from the OpenShell 0.1.5 source): `[openshell.gateway.tls]` (`cert_path`, `key_path`, `client_ca_path`), `[openshell.gateway.gateway_jwt]` (`signing_key_path`, `public_key_path`, `kid_path`), `[openshell.drivers.<name>]`, and `[[openshell.supervisor.isolation_backends]]` (`name`, `endpoint = { kind = "unix", socket_path = ... }`).
- The current main gateway uses `compute_driver = "podman"`. This plan does not change it.

Not verified (each one is a planned test, not a claim):

- Production gateway behaviour with TLS and JWT on. (PR-02)
- Where the OpenShell supervisor process runs relative to the container. The protos say only that the supervisor is the client of the isolation backend. (PD-15, PR-03)
- Egress under `network: none` through mediation, DNS mediation, IPv6 off. (PR-04)
- Behaviour across a host reboot with linger on. One unexplained `failed to reexec: Permission denied` appeared once after linger and did not reproduce in three later runs. (PR-05)
- Whether the OpenShell supervisor applies its own Landlock policy to the workload. (PD-10)
- Which compute RPCs the gateway calls for stop, start, and watch flows. Only create and delete were observed. (PD-08)
- The licence and advisory status of the gRPC packages. Not checked in this planning pass; checked in phase 9.4 before the pin.
- Which node:24-alpine digest is the pinned value. The spike's inspect shows one digest (sha256:06d7…), and decision D-016 names another (sha256:1200d8…). Resolved in phase 9.3 task T0 before any configuration is written.

## Phase map

Insert after phase 9 and before phase 10 (decimal numbering, PD-01).

```text
9 (OMP-LIVE items wait on 9.6)
9.1 host prerequisites and production gateway ─┐
9.2 native enforcement helper ─────────────────┤ (9.1 and 9.2 run in parallel: disjoint files)
                                               ▼
9.3 hardened container lifecycle (needs 9.1 runtime and 9.2 helper in the image)
                                               ▼
9.4 compute driver gRPC server (needs 9.3; starts only after 09-01 closes)
                                               ▼
9.5 isolation backend and sandbox protocol (needs 9.4 for launch metadata)
                                               ▼
9.6 integration, live proof, docs, cutover, OMP-LIVE decision
                                               ▼
10 docs, packaging, release 0.2.0 (still held by ship hold)
11 milestone close
```

## Requirements

Thirty-one new requirements, family `PRD`, are written in `09-PRODUCTION-BUILD-REQUIREMENTS-INSERT.md` for the owner to apply to `.planning/REQUIREMENTS.md` under v2.0. The planner did not apply it (the shell guard blocked the ROADMAP edit as a protected-path mutation). Each maps to exactly one phase. RT-01, RT-03, and RT-05 are unchanged and remain the acceptance targets; the PRD requirements are the means.

## Repository rules that bind every phase

From `AGENTS.md` and the repo:

- Strict TypeScript, `node:test`, exact dependency pins, no suppression comments, no `process.env` outside entry edges.
- Errors use the catalogue in `src/core/errors.ts`. A new code is a public contract change and needs an owner decision (D-018). Phases map to existing codes; any new code is listed as a decision.
- Podman runs rootless only. No privileged container, no Podman or Docker socket in any container, the control socket is 0700 and 0600.
- Human review before merge for `.github/workflows/**`, `release/**`, `scripts/release/**`, `LICENSE`, `NOTICE`. Any CI change in phase 9.2 or 9.6 needs that review.
- PRs never edit `CHANGELOG.md` or package version fields.
- Layout changes update `AGENTS.md` in the same PR (new `sandbox/` and `src/runtime/driver/` directories).
- `.planning` and `docs/` must contain no host paths. `npm run check:docs` rejects `/root`, `/tmp`, `/home`, and `/Users` prefixes. These plan documents use repo-relative paths and the realm account name only.
- Gates per phase: `npm run typecheck`, `npm test`, `npm run lint`, `npm run check:docs`. From phase 9.4 on, `npm run check:pack`, because protos and the helper ship in the package. Live gates are env-gated like the existing `REALM_LIVE_*` gates, skipped in CI, and their evidence is recorded in the phase VERIFICATION file.

## Repository file map (new and changed)

| Path | Phase | Change |
|---|---|---|
| `src/runtime/gateway-config.ts` (+ test) | 9.1 | New. Renders the production gateway TOML from config; refuses `disable_tls` |
| `sandbox/Dockerfile`, `sandbox/realm-helper/*` | 9.2 | New. Pinned multi-stage build of the native helper |
| `src/runtime/libpod-client.ts`, `libpod-routes.ts` | 9.3 | Add create, start, and exec methods and their routes |
| `src/runtime/driver/lifecycle.ts` (+ test) | 9.3 | New. Create, verify, remove, and startup sweep |
| `src/runtime/driver/compute-driver.ts`, `server.ts` (+ tests) | 9.4 | New. ComputeDriver gRPC service and socket server |
| `src/runtime/driver/proto/` | 9.4 | New. Vendored OpenShell protos with a provenance file and digests |
| `package.json`, `package-lock.json` | 9.4 | Exact gRPC pins; `files` gains the vendored protos |
| `src/runtime/driver/isolation/*` (+ tests) | 9.5 | New. IsolationBackend and SandboxProtocol servers |
| `src/runtime/driver/main.ts` (new) | 9.4 | Driver entry edge (PD-05). The daemon `src/daemon/main.ts` is not changed by this build |
| `src/runtime/session-execution.ts` | 9.6 | Post-create verify kept (PD-13); create path reviewed |
| `src/runtime/hardening.ts` | none | Reused unchanged; a change is a re-plan |
| `docs/integration/openshell.md`, `hardening-plan.md`, `runtime-decision.md` | 9.1, 9.6 | Evidence and production configuration |
| `AGENTS.md` | 9.6 | Layout update |
| `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` | this plan, pending owner application | PRD requirements and phase blocks (insert files above) |

## Out of scope for this plan

- Any change to the main gateway, the root Podman service, or the root account's configuration (unless a decision in `09-PRODUCTION-BUILD-DECISIONS.md` is approved).
- Releasing 0.2.0, merging a PR, or lifting the ship hold.
- Changing RT-01, RT-03, RT-05, or the hardening profile values.
- Anda Engine (D-017) and the AgentOS sidecar conditions (D-015), except where a phase names them.
