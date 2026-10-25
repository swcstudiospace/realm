# Phase 9 summary: live OMP verification (plan 01)

Status: partial. The code and unit gates are green. Live `realm up` is blocked by the hardening profile on the OpenShell 0.1.5 path, and the owner has chosen an external isolation backend to meet the requirements as written. That program has not started.

## Delivered and verified

- AgentOS sandbox driver over the OpenShell CLI (`src/runtime/agentos-driver.ts`): start, alive, and stop, with a 180 s create budget and a 30 s call budget. Live on this host: start in 1.1 s, stop ok.
- Session lookup and the orphan sweep select containers by OpenShell's own labels and the sandbox name (`openshell.ai/sandbox-name`, `openshell.managed`, the `realm-` prefix). The workload is the container with `openshell.ai/isolation-role=sandbox`. Unit-tested.
- Session create passes the digest-pinned image with `--from`. Live: the create returns the workload container id in about 1.3 s.
- Exact dependency pins: `@rivet-dev/agentos-core` 0.4.4 and `ajv` 8.20.0 (Apache-2.0 and MIT).
- OpenShell pin moved from 0.1.2 to 0.1.5 in the doctor messages, the runtime comment, and the tests. The pinned create flags are listed by the 0.1.5 `sandbox create --help`.
- The gateway's Podman driver sets `sandbox_pids_limit = 512`, the hardening profile's value.

## Blocked and not verified

- Live `realm up`: the session container fails the hardening verifier on five of fifteen properties on OpenShell 0.1.5: `rootless` (the Podman service is rootful), `cap-drop` (11 capabilities kept), `read-only-root` (writable root), `tmpfs` (only the supervisor CA tmpfs), and `mounts` (only OpenShell's own mounts). The session fails closed; no sandbox is left behind.
- OMP-LIVE-01, OMP-LIVE-03, and OMP-LIVE-04 run through `realm up` and have not been run.
- The AgentOS sandbox has no hardening check. It does not meet RT-01 today (writable root, no workspace or state mounts). The path is off unless `REALM_AGENTOS_IMAGE` is set.

## Decision that governs the next step

- The owner chose to keep RT-01 and RT-03 as written. OpenShell's built-in isolation backend needs a descriptor that only a compute driver writes, so the only route is a realm-written external isolation backend.
- Scope of that program: a realm compute driver implementing `proto/compute_driver.proto` that provisions the hardened container and launch authentication; an isolation backend implementing `proto/isolation_backend.proto` and `proto/sandbox_protocol.proto` (Attach, Confirm, StartAgent, process I/O, network and DNS mediation); Landlock and seccomp enforcement from a digest-pinned native helper in the image; a rootless `realmlive` Podman setup; and live proof on this host.
- The contract was read; no backend code exists. The next gate is a go/no-go spike before any build.

## Gates

- `npm test`: 1138 total, 1129 pass, 0 fail, 9 skipped.
- `npm run lint`: exit 0.
- `npm run check:docs`: exit 0.
