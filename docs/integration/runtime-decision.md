# Runtime decision note (Phase 3)

Status: decided for Phase 3. Not every item is verified. Each one is unit-verified, live-gated (a skipped suite that names its reason), partly observed, recorded as an assumption or limitation, Open, or Blocked. OQ-P3-04 and OQ-P3-07 are Open, OQ-P3-11 is Open, and OQ-P3-16 is Blocked. Nothing here is live-verified on this host.
Read date of external sources: 2026-10-21 (ISO 8601), as recorded in the integration notes.
Scope: the layering, the Podman gate, the OpenShell pin, the AgentOS mode, and every open question OQ-P3-01 to OQ-P3-16 with its default and the module it blocks.

## Host observations (read-only, 2026-10-21)

No install, upgrade, or socket change was made. Each check below is a read-only command.

| Check | Result |
| --- | --- |
| `podman --version` | `podman version 4.9.3` |
| `podman run --help` | Lists `--cap-drop`, `--security-opt`, `--read-only`, `--read-only-tmpfs`, `--tmpfs`, `--memory`/`-m`, `--cpus`, `--pids-limit` (help text default 2048), and `--network`. The help text does not state whether `no-new-privileges` is on by default, and it does not confirm that the value is accepted on 4.9.3. |
| `openshell --version` | `openshell 0.1.2` |
| `openshell sandbox create --help` | Lists `--name`, `--policy`, `--no-auto-providers`, `--no-keep`, `--detach`, `--label`, `--cpu`, `--memory`, `--env`, and `--provider`. The usage line shows the trailing `[-- <COMMAND>...]` form. |

## Layering (S-08) and requirement-wording conflicts (D-46, D-47)

Settled input S-08:

- The **OpenShell gateway runs on the host, rootless**.
- It creates **one OpenShell sandbox per session** through its **Podman driver**.
- The **AgentOS library runs as the sandbox workload**.
- **Anda Engine runs as a separate service**, reached over HTTP from the TypeScript client.
- Nothing nests OpenShell inside the Realm container, and nothing runs privileged.

Evidence: `docs/integration/openshell.md` Q1 records that the documented Podman driver creates its own sandbox container (driver table: "Its own container"), and that the gateway runs "Rootless containers on the gateway host". It does not document a launch inside an externally created container.

**Requirement-wording conflicts (reported, not edited).** The settled layering contradicts the following wording. Each is a requirement-wording decision for the user. The requirement text is not changed in Phase 3.

| Requirement or criterion | Wording | Resolution under S-08 |
| --- | --- | --- |
| RT-03 and ROADMAP Phase 3 SC3 | "OpenShell runs inside the container" | D-46: the gateway is on the host, and the Podman driver creates the sandbox container. RT-03's intent is kept: every agent workload start goes through OpenShell, and no path bypasses it. This is proven by `test/runtime/openshell-routing.test.ts`. |
| RT-01 and ROADMAP Phase 3 SC2 | A "running realm container" that Realm runs | D-47: the container is the session sandbox that OpenShell's Podman driver creates. Realm verifies it through libpod inspect against the hardening profile (D-51). A mismatch destroys the container and moves the session to `error` with `OPENSHELL_START_FAILED`. Realm creates no fallback container without a new decision. |

**Supersession.** The RT-01 and RT-03 wording that places the OpenShell gateway inside the Realm container is superseded by S-08 (D-46, D-47). Phase 3 does not edit the requirement text, and the layering above governs the implementation.

Reversibility: costly. Every runtime module depends on this layering.

## Podman gate (S-09)

- Host Podman is **4.9.3**. The OpenShell Podman driver requires **Podman 5.x** (`openshell.md` Q2).
- The prerequisite probe (D-53) gives `PODMAN_UNSUPPORTED_VERSION` for any major below 5. The reason names the detected version and that OpenShell requires 5.x.
- Realm does not install or upgrade Podman. The local install is not changed.
- Live container and runtime suites skip with `PODMAN_UNSUPPORTED_VERSION` on 4.9.3, and with `PODMAN_MISSING` when the binary is absent (D-48).
- Unit tests use the fake Unix-socket server (`test/support/fake-libpod.ts`) and never depend on Podman.
- Libpod routes are **provisional** (`podman.md` Q5: no route verified). They live only in `src/runtime/libpod-routes.ts`, marked provisional there.
- The "machine" mapping on Linux (OQ-P3-13) is recorded in section "Open questions" below.

## OpenShell pin (S-10)

- The CLI is pinned to the **0.1.2** verbs. Host observation above confirms each pinned flag is listed by `openshell sandbox create --help`.
- Pinned argv (D-55): `sandbox create --name realm-<sessionId> --policy <policyPath> --no-auto-providers --no-keep --detach --label io.realm.managed=true --label io.realm.session=<sessionId> --cpu <cpus> --memory <memory> -- <workloadArgv...>`.
- The builder never emits `--env` or `--provider`, because AUD-02 forbids host environment or credentials reaching the sandbox. Both flags exist in 0.1.2 and are deliberately not used.
- **Drift.** The docs describe **0.1.5** (`openshell.md` version caveat). The local CLI is 0.1.2. The `--no-keep` combined with `--detach` semantics are documented only for 0.1.5 (OQ-P3-12).
- Default applied (OQ-P3-12): pin 0.1.2 and re-verify on upgrade. A future upgrade must re-read the matching documentation index and re-run `openshell sandbox create --help`.
- The 0.1.2 help also lists `--from` (a rootfs tar or a container image reference). It is not in the pinned argv, and this phase does not use it. Whether it accepts a digest-pinned reference is unverified, so it bears on OQ-P3-03 (recorded below).
- The doctor's `openshell` check (D-69) greps this help for each pinned flag, so drift is caught at run time.

## AgentOS mode (S-11)

- **Library mode** (`@rivet-dev/agentos-core`, run in the sandbox) is **primary**. `agentos.md` Q1 and Q2 document `AgentOs.create` and `vm.dispose()`.
- **Hosted mode** (the `agentOS` Rivet Actor and worker images) is **secondary and gated**. `agentos.md` Q8 documents the hosted worker as Docker-based, with no Podman command. Hosted mode is not implemented in Phase 3 (D-60).
- The concrete `AgentOsDriver` is **not written** in Phase 3 (D-59). The port and supervisor exist, and `session-execution.ts` takes the driver as a dependency. The missing binding is OQ-P3-05 and the missing dependency is OQ-P3-06. Both are reported as blocked.
- The AgentOS doctor item is not registered (D-69), because no driver binding exists to inspect.

## Open questions and defaults (OQ-P3-01 to OQ-P3-16)

"Blocked" names the module or phase that the open item prevents from being claimed as done. "Live-gated" means the question is decided only by a gated suite on a host that supports it, and until then the code fails closed.

| ID | Question | Default applied | Blocked module or phase | Status |
| --- | --- | --- | --- | --- |
| OQ-P3-01 | Does the OpenShell Podman driver apply the `--label` values to the container it creates? | Assume yes. If not, label lookup finds nothing, create times out, and the result is `OPENSHELL_START_FAILED`. Nothing is claimed. | Live proof of label idempotency in `src/runtime/session-execution.ts` (D-56, CORE-06) | Live-gated. Fails closed. |
| OQ-P3-02 | Can the driver bind-mount the workspace, and at what in-sandbox path? | `/workspace` (D-57, a Realm convention). | Live proof of the policy's `read_write` path and the workspace mount in `src/runtime/openshell.ts` | Live-gated. Fails closed. |
| OQ-P3-03 | How is the digest-pinned image reference passed to OpenShell? The pinned set has no image verb. The 0.1.2 help lists `--from`, not in the pinned argv. | The verifier (D-51) refuses any container whose image digest differs from the pin. | `verifyInspect` image-digest property in `src/runtime/hardening.ts` (D-51); live create path in `src/runtime/session-execution.ts` | Live-gated. Fails closed. |
| OQ-P3-04 | Does an OpenShell sandbox record persist after its container is removed? No sandbox delete verb is pinned. | Phase 3 removes containers only. Phase 4 handles records. | Phase 4 reaper and stale-record cleanup (RT-08, `src/session/reap.ts`) | Open. Not a Phase 3 blocker. |
| OQ-P3-05 | No documented channel between the host supervisor and the AgentOS library process inside the sandbox. | `AgentOsDriver` port only. No concrete binding. | **Blocks the concrete AgentOS driver** (`src/runtime/agentos.ts` binding; RT-04 end-to-end) | Blocked. Reported, not claimed. |
| OQ-P3-06 | `@rivet-dev/agentos-core` version, licence, and Node floor are not verified in its registry. | No dependency added. Execution checks `npm view` read-only before any add. | **Blocks adding the AgentOS dependency** (`package.json`, the concrete driver) | Blocked. No dependency added. |
| OQ-P3-07 | Does AgentOS library mode need a native sidecar, and do native ELF binaries run (`agentos.md` Q5)? | Recorded as open. Library mode is primary (S-11). | AgentOS driver binding and any sandbox image that runs native binaries | Open. |
| OQ-P3-08 | Confirm the `podman run` flags against the local 4.9.3 binary. | Run read-only, with no install or upgrade. Result is in "Host observations" above. The flags exist. The `no-new-privileges` default and value acceptance are not confirmed by the help text. | `verifyInspect` checks in `src/runtime/hardening.ts` (D-51) against a real 4.9.3 container | Partly observed. The remaining flag behaviour is live-gated. |
| OQ-P3-09 | Anda publishes no protocol or engine version (`anda.md` Q4). | Shape handshake (D-61). Recorded as a limitation in `anda-decision.md`. | Any claim of a version match in `src/anda/shape.ts` and the ANDA-02 test | Limitation recorded. |
| OQ-P3-10 | Anda RPC body and credential format (`anda.md` Q2, Q3). | Not needed in Phase 3. No credentials are produced. | **Blocks the phase that first calls `POST /{id}`** (Phase 4 or 5 tool calls through Anda) | Blocked for that phase. |
| OQ-P3-11 | Anda licence conflict (`anda.md` Q6). | No Anda code or dependency added. | Any vendoring of Anda code. It does not block Phase 3. | Open. Must be resolved before vendoring. |
| OQ-P3-12 | OpenShell drift: docs 0.1.5, pinned verbs 0.1.2 (S-10). `--no-keep` with `--detach` is documented only for 0.1.5. | Pin 0.1.2 and gate. Re-verify on upgrade. | The argv builder in `src/runtime/openshell.ts` (D-55) and the live `--no-keep`/`--detach` lifecycle | Live-gated. Fails closed. |
| OQ-P3-13 | On Linux, "Podman machine" is mapped to the rootless API socket (`$XDG_RUNTIME_DIR/podman/podman.sock`). | This mapping, recorded here. A refused socket gives `PODMAN_MACHINE_DOWN` with the fix `systemctl --user start podman.socket`. | `src/runtime/podman-probe.ts` step 3 (D-53) | Recorded assumption. |
| OQ-P3-14 | Does the OpenShell driver apply the PID limit, read-only root, and capability drop? | The verifier (D-51) fails closed when it does not. | Live proof that `verifyInspect` passes on an OpenShell-created container (`src/runtime/hardening.ts`, `session-execution.ts`) | Live-gated. Fails closed. |
| OQ-P3-15 | Does OpenShell accept the policy written as JSON (valid YAML 1.2)? | JSON (D-57). No YAML dependency. | Live acceptance of the policy document in `src/runtime/openshell.ts` (`buildPolicyDocument`) | Live-gated. Fails closed. |
| OQ-P3-16 | The `binaries` key and endpoint shape for `network_policies` are not recorded in `openshell.md` Q3. | No endpoints in Phase 3. `network_policies` is deny-all. | **Blocks Phase 4 egress allowlist mapping** (RT-05, `src/runtime/egress.ts`) | Blocked for Phase 4. |

## Finding and naming decisions

- **F-P3-08 (runtime/ versus run/).** Policy files live under `<stateDir>/runtime/` (D-57). The control socket lives under `<stateDir>/run/control.sock` (`src/session/paths.ts`, `controlSocketPath`). The names differ on purpose, and nothing collides. Phase 6 keeps the control socket under `run/`. Phase 3 writes only under `runtime/`.

## Verification status

- **Unit-verified in Phase 3:** argv and policy shape (D-55, D-57), the libpod client method set (D-54), the probe mapping (D-53), config rules (D-52), and the lifecycle gates (D-63 to D-68). All run against in-process fakes and the fake libpod socket.
- **Live-gated (skip with a stated reason, fail closed):** OQ-P3-01, 02, 03, 12, 14, and 15. Live suites skip on 4.9.3 with `PODMAN_UNSUPPORTED_VERSION`.
- **Not claimed:** any live container, OpenShell sandbox, AgentOS run, or Anda RPC call. No Phase 3 report may say "live verified".
