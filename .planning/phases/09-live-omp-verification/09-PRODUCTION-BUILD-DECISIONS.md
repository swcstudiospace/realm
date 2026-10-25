# Phase 9 Production Build: Decisions for the Owner

Status: OPEN. Each item is a decision the owner must make before the phase named in "Needed by" starts. The recommendation is the planner's default; it is applied only if the owner approves it. Nothing here is applied by this plan.

Numbering: `PD-` (production decision). Not the `D-` numbers in `.planning/STATE.md`.

## PD-01: Phase numbering

- Needed by: now (before any plan file is executed).
- (a) Decimal phases 9.1 to 9.6, inserted after phase 9 and before phase 10. Keeps phases 10 and 11 and every reference to them unchanged. **Recommended.** Cost: decimal phase numbers are unusual in this ROADMAP.
- (b) Renumber phases 10 and 11 to 15 and 16, and add phases 10 to 14. Clean numbering, but it breaks references in STATE.md, REQUIREMENTS.md, and the phase 10 and 11 blocks.
- (c) Re-plan phase 9 in place, with the production build as its first wave. Keeps one phase, but phase 9 then no longer matches its REQUIREMENTS block (OMP-LIVE) and its 09-01 plan.

## PD-02: Which gateway runs realm containers

- Needed by: 9.1.
- (a) A dedicated realm gateway instance: its own user unit, its own bind endpoint, its own state, and `compute_driver` set to the realm driver. The main gateway is not touched. **Recommended.** Cost: one more unit and one more endpoint in realm config.
- (b) Switch the main gateway's `compute_driver` from `podman` to the realm driver. Fewer units, but every sandbox the main gateway serves moves to the realm driver. Whether other consumers use the main gateway is not verified in this plan [INFERENCE: it is shared].
- (c) Run the driver inside the realm daemon process, with no gateway of its own. Rejected by the spike's gateway behaviour: the gateway connects to the driver at its own start, so the daemon must be up before the gateway and the two lifecycles couple.

## PD-03: Gateway TLS and JWT material

- Needed by: 9.1.
- (a) Generate with the gateway's own `generate-certs` command, with an explicit output directory under the realm account's state directory, and point `[openshell.gateway.tls]` and `[openshell.gateway.gateway_jwt]` at that directory. Files 0600, directory 0700. **Recommended.** The spike used this command. Cost: the default output directory must be overridden every time (the spike wrote to the root account's default location).
- (b) Certificates and key issued by an external CA, and a JWT key pair from the owner's own tooling. More control, more moving parts, no evidence yet.
- (c) Development mode (TLS disabled). **Rejected for production:** the realm profile must refuse `disable_tls`. It remains acceptable only in gated tests.

## PD-04: Account that owns the rootless Podman API

- Needed by: 9.1.
- (a) The dedicated rootless account (realmlive) with linger, a user-manager unit that has cgroup delegation, and a runc runtime set in that account's container configuration. **Recommended.** Meets RT-01's "rootless" wording. Already proven by the spike.
- (b) The rootful realm-podman service that the main gateway uses today. Rejected by the rootless check (the spike recorded this failure). It also violates RT-01 as written.

## PD-05: Where the compute driver process runs

- Needed by: 9.4.
- (a) A separate user unit under the realm account, started before the realm gateway. **Recommended.** Its life is independent of the daemon, which the gateway needs at its own start.
- (b) Inside the realm daemon. Fewer units, but the gateway cannot start unless the daemon is up, and daemon restarts drop the driver.

## PD-06: How the native helper is built and shipped

- Needed by: 9.2.
- (a) Source committed under `sandbox/realm-helper/`, built in a multi-stage Dockerfile whose builder and runtime bases are pinned by digest. The helper's source digest and binary digest are recorded in the image record. **Recommended.** Reviewable, reproducible from the repository, no extra toolchain outside the image.
- (b) A prebuilt binary committed or released with a checksum. Smaller build, but the binary cannot be reviewed from the repository and needs a signing or provenance decision of its own.
- (c) Rewrite the helper in Rust, reusing the spike's crates. Rejected: the repository is TypeScript only, and the spike's crates pull a large dependency graph into the build.

## PD-07: gRPC library and pin

- Needed by: 9.4 (the pin is chosen there, after the licence and advisory checks).
- (a) `@grpc/grpc-js` and `@grpc/proto-loader`, both exact pins, loading vendored `.proto` files at runtime. **Recommended.** No code-generation step, no new build tool. Licence and maintenance checks are required before the pin (not yet done).
- (b) Generated TypeScript from the protos with a code generator (for example a `buf` or `protoc` plugin). Type-safe stubs, but a new build step, a new tool to pin, and a generated-code review burden.
- No version is named in this plan. The version is chosen in 9.4 with the checks recorded in its SUMMARY.

## PD-08: StopSandbox and StartSandbox

- Needed by: 9.4.
- (a) Refuse both with an explicit status (`FAILED_PRECONDITION` or the gateway's equivalent, confirmed in 9.4), and advertise no capability that needs them. **Recommended.** A stopped sandbox would need a fresh verify and a fresh idle init, and nothing in this plan proves a restart preserves the fenced launch state.
- (b) Support stop and start by stopping and starting the container, then re-running the 14 checks on start. Needs a new test set and a rule for the launch files.
- (c) Support stop only, refuse start. Only useful if the gateway's flows are shown to call stop without start.
- Open: which gateway flows call these RPCs was not observed. 9.4 must record the call sites before the owner chooses.

## PD-09: Suspend and resume

- Needed by: 9.5.
- (a) Out of scope for v2.0. Return `UNIMPLEMENTED` on both RPCs, as the protos allow, and do not advertise `openshell.sandbox.suspend-resume`. **Recommended.** Keeps the scope bounded.
- (b) Implement by checkpointing the container. Rootless checkpoint support is not verified on this host. A large, unverified scope.

## PD-10: Who applies the workload's Landlock and seccomp policy

- Needed by: 9.5 (and the helper's policy input in 9.2).
- (a) The realm helper alone, as the spike proved. **Recommended for the default**, provided 9.5 shows the OpenShell supervisor does not apply a second, different policy to the same workload.
- (b) The OpenShell supervisor alone. Would remove the helper, but the supervisor's behaviour in this path is not verified.
- (c) Both. Defence in depth, but two policy sources can drift and disagree.
- The decision is made on evidence from 9.5's first task, not on this plan's assumption.

## PD-11: How the workload is started (exec)

- Needed by: 9.5.
- (a) The libpod REST exec API, over the same socket the driver already uses. **Recommended.** No `podman` binary needed on the process `PATH` (decision HC-09 becomes unnecessary for the driver).
- (b) The `podman exec` CLI, as the spike did. Simpler to write, but depends on the binary and `PATH` of the realm account, which is why the root login `PATH` change (D-013) exists.

## PD-12: How egress is enforced under `network: none`

- Needed by: 9.5.
- (a) Mediated egress through the SandboxProtocol (`OpenMediation`, `LoopbackConnect`, `AcceptNetwork`, and the DNS messages on `Mediate`), with the container having no network interface. **Recommended.** The protos define these paths, and RT-05's default-deny and IPv6-off rules are then properties of the container itself.
- (b) A network namespace with routing and an allowlist enforced by the host firewall. Needs host privilege or extra host firewall state not in this plan. Not verified.

## PD-13: Keep the second verification after create

- Needed by: 9.6.
- (a) Keep `verifyOrRemove` in `src/runtime/session-execution.ts` after the driver's own verify. **Recommended.** Defence in depth at the cost of one inspect per create. Both checks use `src/runtime/hardening.ts`.
- (b) Remove it, so the driver is the one verification point. Single authority, but a driver bug would not be caught by the caller.

## PD-14: OMP-LIVE items

- Needed by: 9.6.
- (a) Keep OMP-LIVE-01, -03, -04 descoped to the follow-up milestone, as the owner decided on 2026-10-23 and 2026-10-24. **Recommended.** The production build proves `realm up` and `realm down` (TST-03), which is what the descoped items needed.
- (b) Reinstate them into this build. Requires a live Omp session on the host and a running daemon, both of which 09-01 did not achieve.

## PD-15: Where the OpenShell supervisor runs (RT-03)

- Needed by: 9.5 (task 1 produces the evidence; the owner decides after it).
- (a) The supervisor runs inside the container. Requires the supervisor binary and its runtime in the sandbox image, and changes the image size and the hardening surface. Not verified.
- (b) The supervisor runs on the host, and every workload action goes through mediated calls into the container. RT-03's "all agent execution is routed through it" then holds only on the owner's reading of the wording. Needs owner acceptance.
- (c) The owner amends RT-03's wording. Only with owner approval (the owner kept RT-03 as written on 2026-10-25).
- Recommendation: decide from the evidence in 9.5 task 1. Do not amend RT-03 without approval.
- The OpenShell source tree's example isolation backend runs natively on the host (its README says so). That is evidence about the example only; it does not settle RT-03 for a container.

## PD-16: Sandbox image composition

- Needed by: 9.2 and 9.3.
- (a) One derived image holding the helper, the AgentOS runner, and the probe scripts, digest-pinned in config. **Recommended.** Amends D-016 (which named only the runner and probe scripts). One artifact to pin and scan.
- (b) Separate helper image and runner image. Two digests to pin and two supply-chain reviews.

## PD-17: Identity material under the root account's default configuration directory

- Needed by: 9.1. No removal is planned.
- Correction (2026-10-25): the directory that the spike's generate-certs wrote is the live gateway identity for the `openshell` CLI. Its client files were replaced at 07:45:31 with the gateway's original client identity, which the gateway trusts. Removing it would break the CLI. The earlier recommendation to remove it is withdrawn.
- (a) Keep the restored identity as it is, and record the restore in the host change list. **Recommended.**
- (b) Replace the CLI identity with one issued by the realm gateway's own CA in 9.1, once that gateway runs. Cost: the CLI fails until the swap is made, so the swap needs its own check.
- Host change HC-07 records the detail.
