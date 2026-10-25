# Phase 9 summary: live OMP verification (plan 01)

Status: closed for code and unit gates on 2026-10-25 (owner decision). The three live checks, OMP-LIVE-01, OMP-LIVE-03, and OMP-LIVE-04, move to phase 9.6, which delivers `realm up`. The production build uses the realm-owned driver in place of the built-in path (phases 9.1 to 9.6).

## Delivered and verified

- AgentOS sandbox driver over the OpenShell CLI (`src/runtime/agentos-driver.ts`): start, alive, and stop, with a 180 s create budget and a 30 s call budget. Live on this host: start in 1.1 s, stop ok.
- Session lookup and the orphan sweep select containers by OpenShell's own labels and the sandbox name (`openshell.ai/sandbox-name`, `openshell.managed`, the `realm-` prefix). The workload is the container with `openshell.ai/isolation-role=sandbox`. Unit-tested.
- Session create passes the digest-pinned image with `--from`. Live: the create returns the workload container id in about 1.3 s.
- Exact dependency pins: `@rivet-dev/agentos-core` 0.4.4 and `ajv` 8.20.0.
- OpenShell pin moved from 0.1.2 to 0.1.5 in the doctor messages, the runtime comment, the tests, and the current-pin line of `docs/integration/openshell.md`.
- The gateway's Podman driver sets `sandbox_pids_limit = 512`, the hardening profile's value.
- Cap-drop (RT-01) reads kernel evidence. The check takes the five capability sets (CapInh, CapPrm, CapEff, CapBnd, CapAmb) of the container's init process from the host's `/proc/<State.Pid>/status`, and it requires all five to be zero and CapAdd to be empty. It fails closed when the evidence is missing. The literal `CapDrop ["ALL"]` comparison is removed, because Podman 5.7.1 records an 11-name expansion. Live on an OpenShell-created container: all five sets are zero.

## Blocked and not verified

- Live `realm up` on the built-in driver: the create-time verifier fails `rootless` (the Podman service is rootful), `read-only-root` (no driver option), `tmpfs` (OpenShell's tmpfs set), and `mounts` (OpenShell's own mounts). `cap-drop` passes. The session fails closed, and no sandbox is left.
- OMP-LIVE-01, OMP-LIVE-03, and OMP-LIVE-04 run through `realm up` and have not been run. The owner moved them to phase 9.6 on 2026-10-25, reinstating them from the 2026-10-23 descope.
- The AgentOS sandbox has no hardening check. It does not meet RT-01 today (writable root, no workspace or state mounts). The path is off unless `REALM_AGENTOS_IMAGE` is set.

## Realm-owned driver (isolation backend) spike

- Decision (owner): keep RT-01 and RT-03 as written. Build a realm-owned container driver and an external isolation backend, because OpenShell's built-in backend needs a descriptor only a compute driver writes.
- G1, gateway accepts the external driver: GO. The gateway reaches the driver's CreateSandbox.
- G2, rootless realm container passes all fourteen checks: on the spike's evidence, all fourteen pass once the idle init runs. The owner decided to start the idle init at create and run the kernel check there. The spike has been asked to re-run G2 on that order.
- G3, supervisor attaches to the backend and the workload starts only after StartAgent: pending.
- G4, Landlock and seccomp applied by a native helper: pending.
- G5, teardown leaves no container: pending.
- Effort for a production build: about 3 to 4 engineer-weeks, an estimate that has not been measured.

## Gates (last full unit run, before the lint-only fix)

- `npm test`: 1143 total, 1134 pass, 0 fail, 9 skipped. After the lint fix, the two affected test files pass 82 of 82.
- `npm run lint`: exit 0.
- `npm run check:docs`: exit 0.

## Closure (2026-10-25)

- Plan 09-01 is closed for its code and unit gates (driver and daemon wiring in 0a5e208). Phase 9.4 may start: this is PR-10.
- Carried into phase 9.6: OMP-LIVE-01, OMP-LIVE-03, and OMP-LIVE-04, run through `realm up` with a live Omp session. Phase 9 stays open until they run.
- Spike items: G3 (supervisor attaches; workload starts only after StartAgent) moves to phase 9.5. G4 (native helper) is built in phase 9.2, with its live probe in 9.6. G5 (teardown leaves no container) passed in phase 9.3, acceptance 4.
