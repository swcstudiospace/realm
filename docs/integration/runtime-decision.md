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

Historical (superseded 2026-10-28): the `openshell 0.1.2` version and the trailing command form in the two OpenShell rows above are superseded. The pin is 0.1.5.

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
  - Superseded by `docs/integration/openshell.md` (one sandbox per session, named `realm-<sessionId>`, AgentOS as its workload, with no workload command). The pinned argv above is historical.
- The builder never emits `--env` or `--provider`, because AUD-02 forbids host environment or credentials reaching the sandbox. Both flags exist in 0.1.2 and are deliberately not used.
- **Drift.** The docs describe **0.1.5** (`openshell.md` version caveat). The local CLI is 0.1.2. The `--no-keep` combined with `--detach` semantics are documented only for 0.1.5 (OQ-P3-12).
- Default applied (OQ-P3-12): pin 0.1.2 and re-verify on upgrade. A future upgrade must re-read the matching documentation index and re-run `openshell sandbox create --help`.
- The 0.1.2 help also lists `--from` (a rootfs tar or a container image reference). It is not in the pinned argv, and this phase does not use it. Whether it accepts a digest-pinned reference is unverified, so it bears on OQ-P3-03 (recorded below).
- Historical (superseded 2026-10-28): the 0.1.2 pin, the `--no-keep` and `--detach` argv, and the trailing command form above no longer hold. The pin is 0.1.5 (`docs/integration/openshell.md`).
- The doctor's `openshell` check (D-69) greps this help for each pinned flag, so drift is caught at run time.

## AgentOS mode (S-11)

- **Library mode** (`@rivet-dev/agentos-core`, run in the sandbox) is **primary**. `agentos.md` Q1 and Q2 document `AgentOs.create` and `vm.dispose()`.
- **Hosted mode** (the `agentOS` Rivet Actor and worker images) is **secondary and gated**. `agentos.md` Q8 documents the hosted worker as Docker-based, with no Podman command. Hosted mode is not implemented in Phase 3 (D-60).
- Decision (2026-10-28): one sandbox per session, named `realm-<sessionId>`. The runtime's policy is the enforcement authority, and the retired realm helper is removed from the sandbox image (recover it from git history if ever needed). The AgentOS driver is bound (`src/runtime/agentos-driver.ts`); see `docs/integration/openshell.md`.

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
| OQ-P3-12 | OpenShell drift: docs 0.1.5, pinned verbs 0.1.2 (S-10). `--no-keep` with `--detach` is documented only for 0.1.5. Historical (superseded 2026-10-28): the pin is 0.1.5 and the create passes no `--no-keep`. | Pin 0.1.2 and gate. Re-verify on upgrade. | The argv builder in `src/runtime/openshell.ts` (D-55) and the live `--no-keep`/`--detach` lifecycle | Live-gated. Fails closed. |
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

## Phase 4: Reaper, Egress Guard, and Shared Dispatcher (D-100)

Phase 4 status: decided for Phase 4. Live behavior is unit-verified, live-gated. The RT-05 egress, RT-08 reaper, and TOOL-03 exec live bodies that this note once placed in `test/integration/podman-gate.test.ts` were removed on 2026-10-28; `test/integration/production-driver.test.ts` now carries the live egress, hardening, create, and down-sweep scenarios, a crash recovery scenario (RT-08: after the daemon is killed, the next `realm up` reaps the sandbox it left and reaches `active` with exactly one sandbox), and an MCP exec scenario (TOOL-03: `realm mcp` serves `exec`, `write` and `read` over stdio). Both are gated and have not been run live on this host. Nothing here is live-verified on this host.
Scope: the startup reaper (RT-08), the egress allowlist and its OpenShell rendering (RT-05), the shared dispatcher (TOOL-03, TOOL-04), and every open question OQ-P4-01 to OQ-P4-12 with its default.

### OQ-P3-16 resolution (D-82)

OQ-P3-16 is resolved for the fields Realm writes. Source: `https://docs.nvidia.com/openshell/v0.1.2/how-it-works/policies/schema.md`, read 2026-10-21 (the pinned CLI is 0.1.2, so the v0.1.2 index is used, not the v0.1.5 page). The page documents: `network_policies` as a map of rules; a rule with `name`, `endpoints` (list), and `binaries` (list); an endpoint with `host` and `port` or `ports`; a binary object with `path`; and that an empty `binaries` list matches no binary. Realm writes only `name`, `endpoints[].host`, `endpoints[].port`, and `binaries[].path` (D-78). The inspection and protocol fields are not used. Live acceptance of the rendered document stays gated (OQ-P4-02).

### Exec verb pin (D-93)

Phase 3 deferred exec because no exec verb was in the pinned OpenShell set. The local 0.1.2 CLI now shows `openshell sandbox exec` (read-only `--help` check, 2026-10-21). It lists `-n/--name`, `--workdir`, `--timeout`, `--tty/--no-tty`, `--no-login-shell`, and `--env` (which is never used). The `sandbox exec` verb and the four flags used in D-92 are added to the pinned set (S-10). Pinned argv (D-92): `openshell sandbox exec --name realm-<sessionId> --workdir /workspace --no-tty --no-login-shell -- <argv...>`. The live exec path stays gated (OQ-P4-04).

### IPv6 partial status (D-76)

RT-05 says "IPv6 is disabled". Realm does not create the container and cannot set its sysctls, so Realm cannot disable IPv6 directly. Phase 4 enforces what Realm can and reports the rest: (a) no IPv6 host or address appears in any rendered `network_policies` entry (D-80 refuses IPv6 literals); (b) the hardening verifier keeps `NetworkMode: none` (D-51), so the workload container has no interface and no IPv6 address; (c) whether the supervisor proxy blocks IPv6 egress is unverified and live-gated (OQ-P4-01). The unit suite reports RT-05 IPv6 as partially unit-verified.

### Single-owner precondition (D-87, OQ-P4-06)

`reapStartup` must run before any `LifecycleController` or `ToolDispatcher` exists in the process, and only one host daemon may own the state directory (S-19, Phase 6). Phase 4 has no cross-process owner check. A second host process could reap a live session. The reap precondition and the single-daemon rule in Phase 6 are the mitigation; until then this is an accepted residual risk (OQ-P4-06).

### Audit: two lines per call (D-90)

A dispatcher call writes two audit lines: an admission line before execution and a result line after. Both use the Phase 2 entry format (D-42) with one additive, optional field, `phase`, valued `admission` or `result`. Outcome alone cannot separate the two lines, because a successful call has outcome `ok` on both. Phase 7 review must read both lines of one call as one call.

### Open questions and defaults (OQ-P4-01 to OQ-P4-12)

| ID | Question | Default applied | Blocked module or phase | Status |
| --- | --- | --- | --- | --- |
| OQ-P4-01 | Does the OpenShell supervisor proxy block IPv6 egress, and does it enforce `network_policies` when the workload container has networking off? | Rely on the proxy and the rendered IPv4-only policy; the live property is gated. | Live egress proof in `test/integration/production-driver.test.ts` (RT-05, D-75) | Live-gated. Fails closed. |
| OQ-P4-02 | Does the OpenShell 0.1.2 gateway accept the D-78 document at `--policy` create? | The document as rendered. | Live acceptance of the policy document in `src/runtime/openshell.ts` | Live-gated. Fails closed. |
| OQ-P4-03 | The v0.1.2 page documents the endpoint fields Realm uses, but the inspection and protocol fields were read only in part. | Realm writes none of them. Re-verify on upgrade. | The rendered shape in `src/runtime/egress.ts` (D-78) | Recorded assumption. |
| OQ-P4-04 | Does `openshell sandbox exec --name realm-<id> --workdir /workspace --no-tty --no-login-shell` run against a gateway-created sandbox, and does the sandbox have `/bin/sh` for shell form? | The argv form is the tested path. The shell form (`/bin/sh -c`) is refused with `SHELL_NOT_ALLOWED` unless `policy.shellEnabled` is true (D-24), and the live suite does not turn that policy on. | The production live suite covers the argv form through the same exec form: scenario 1 runs `sh -c` with `openshell sandbox exec` directly, and scenario 6 runs `exec` through `realm mcp` and the daemon (TOOL-03, D-92). Gated; not run live on this host | Live-gated. Fails closed. |
| OQ-P4-05 | Does `sandbox exec` return the remote exit code through the CLI exit status? | Yes (the 0.1.2 help says "The CLI exits with the remote command's exit code"); the gated suite verifies it. | Exec result mapping in `src/runtime/session-execution.ts` (D-94) | Live-gated. Fails closed. |
| OQ-P4-06 | Reaping has no cross-process owner check. A second host process could reap a live session. | The reap precondition (D-87) and the single-daemon rule in Phase 6. | Phase 6 single-daemon control channel (RT-06) | Residual risk. Accepted in Phase 6. |
| OQ-P4-07 | A result-audit failure after a write has landed. | Return `AUDIT_WRITE_FAILED` to the caller and do not roll back. The caller must treat the outcome as unknown. | Dispatcher result stage in `src/tools/dispatch.ts` (D-89) | Decided. |
| OQ-P4-08 | The queue-wait error for advisory writes. | After the wait, advisory writes proceed with a warning; exec and required-mode writes return `REALM_NOT_ACTIVE`. | Dispatcher queue wait in `src/tools/dispatch.ts` (D-91) | Decided. |
| OQ-P4-09 | The value of `TOOL_CALL_TIMEOUT_MS` (30000). | The constant. Revisit only with a measured need, not as a policy key. | Dispatcher timeout in `src/tools/dispatch.ts` (D-91) | Decided. |
| OQ-P4-10 | Egress changes after create. | Fixed at create; changing it means destroy and recreate. Live `openshell policy set` is not used in Phase 4. | Session lifecycle after create (RT-05, D-81) | Decided. |
| OQ-P4-11 | Retry and status surface. | The dispatcher implements both (D-95); Phase 5 exposes `retry` through OMP-03. | Phase 5 OMP surface (TOOL-05, OMP-03) | Decided. Phase 5 exposes. |
| OQ-P4-12 | An allowlisted hostname that resolves to a private address is reachable under OpenShell's documented rule for exact hostnames. | Realm does not add `allowed_ips`, so the allowlist must contain only hosts the user intends to reach. | Egress allowlist review (RT-05, D-77) | Residual risk. Recorded. |

Superseded by `docs/integration/openshell.md`: `workloadArgv` is no longer a configuration key, and the sandbox has no workload command (one sandbox per session, named `realm-<sessionId>`).

## Catalogue extension (closure, 2026-10-22)

This section records an explicit contract extension to the error catalogue in `src/core/errors.ts`. The extension removes misleading code reuse. No existing code was renamed or removed. The catalogue now holds 25 codes. Three codes were added:

| Code | Retryable | What it replaces |
| --- | --- | --- |
| `AGENTOS_NOT_CONFIGURED` | false | `SCHEMA_INVALID`, which was used for a missing AgentOS driver. |
| `AGENTOS_STOP_FAILED` | true | `AGENTOS_CRASH_LOOP`, which was used for a stop failure. |
| `OPENSHELL_LABEL_AMBIGUOUS` | false | A per-instance reason override in `src/runtime/openshell.ts`. A later unit removes that override. |

Each new code now covers its own situation. The code it replaces keeps its own meaning and its catalogue entry is unchanged.

### Optional cause code (`causeCode`)

`RealmError` has an optional, readonly `causeCode` of type `ErrorCode`. It is present only when a cause is given. `makeRealmError(code, causeCode?)` takes it as an optional second argument, and one-argument calls behave as before.

- The cause is itself a catalogue code, so no raw runtime text can enter an error.
- The reason and the retryable flag always come from the primary `code`. `causeCode` never changes them.
- Example: `makeRealmError("OPENSHELL_START_FAILED", "PODMAN_MACHINE_DOWN")` gives code `OPENSHELL_START_FAILED`, `causeCode` `PODMAN_MACHINE_DOWN`, and the `OPENSHELL_START_FAILED` reason.

## Closure decisions (2026-10-22)

These decisions were recorded by the user on 2026-10-22. Each is checked against the source named in its line. Nothing in this section is a live host run.

- **Session owner.** The daemon owns sessions: the sandbox, the policy, and the session. Hosts attach to the daemon and do not own the sandbox (`src/omp/extension.ts`, `src/omp/plugin.ts`).
- **Attach.** A surface attaches by connecting to the control socket and calling `up`. `up` is idempotent (`src/daemon/client.ts`). There is no attach or detach protocol.
- **Lifetime.** The sandbox persists until `realm down`. A host shutdown closes that host's client and never sends `down` (`endSession`, `src/omp/plugin.ts`).
- **Grace-period detach.** The grace-period detach is deferred. It is recorded as a deviation from the spec.
- **Tool method.** The `tool` method carries `{ tool }`. Its reply is the tool outcome (`done` or `refused`) or a catalogue code (`src/daemon/client.ts`, `call` and `isToolOutcome`; `src/daemon/daemon.ts`, case `tool`).
- **Control line cap.** A control line is capped at 1 MiB (`MAX_CONTROL_LINE_BYTES`, `src/daemon/channel.ts`). An oversized request is refused unread with a null-id `SCHEMA_INVALID` reply, and the connection then closes (`oversizedLineReply`, `src/daemon/channel.ts`; `src/daemon/daemon.ts`).
- **Policy mode in replies.** `status` and `up` replies carry the policy mode, `advisory` or `fail-closed` (`DaemonStatus.mode`, `src/daemon/client.ts`).
- **Directory modes.** On a fresh start the state directory and the run directory are created at 0700. An existing run directory must be exactly 0700 and owned by the current user, or the call is `SCHEMA_INVALID` (`ensureSocketDir`, `src/daemon/channel.ts`).
- **Omp guard with unknown mode.** When the status read fails and no mode has been reported yet, the Omp guard blocks the host write. With a known advisory mode, the write proceeds with a warning (`src/omp/plugin.ts`, the fallback in `stateVerdict` and the status-failure path).


## Closure follow-ups (2026-10-22)

**Startup output.** A detached daemon's stdout and stderr go to `<stateDir>/daemon.log`. `startDetachedDaemon` and the CLI's `withDaemonLog` (`src/cli/main.ts`) open that file in append mode at mode 0600, set it to 0600 with `fchmodSync`, and close the parent's descriptor after the spawn returns. The stderr hint `realm: the daemon's startup output is in <path>` comes from `daemonLogHint`. `up` adds it when its ensure step throws or when its `up` request throws, which covers a transport failure. An `up` reply that carries an error or a non-active state does not add it; that refusal is written as `CODE: reason` alone. `mcp` and `acp` add it through `attachFailure` when their ensure step throws or when their `up` call throws, and a daemon error reply reaches that catch as a throw. `acp` does not add it when its `up` returns a state other than active or degraded; that refusal is written as `CODE: reason` alone. The log is never printed.

**Reply cap.** Replies from the daemon are capped at `MAX_CONTROL_LINE_BYTES` (1 MiB), as requests are. `readBounded` in `src/daemon/channel.ts` counts the bytes before the reply's newline. Past the cap it destroys the socket and rejects with `SCHEMA_INVALID`, and `sendRequest` passes that error through, so the client's `request` in `src/daemon/client.ts` rejects with `SCHEMA_INVALID`. The reply is never buffered past the cap.

**Ensure timeout.** `ensureDaemon` (`src/daemon/ensure.ts`) spawns at most once, then polls the probe until a daemon answers or its bound elapses. When the bound elapses it throws `DAEMON_START_TIMEOUT`. That code is retryable (`src/core/errors.ts`). Its reason reads: "The daemon did not answer on its control socket within the daemon start timeout after it was spawned."

**Directory modes.** `withDaemonLog` (`src/cli/main.ts`) creates the missing ancestors of the state directory with no mode argument, so they take the default mode, which the umask narrows. It then creates only the state directory, with `mkdirSync(stateDir, { recursive: true, mode: 0o700 })`. `ensureSocketDir` (`src/daemon/channel.ts`) applies the same rule on the daemon side: missing ancestors of the state directory are created at `DEFAULT_DIR_MODE` (0777), which the umask narrows, and only the state directory and its run directory are created at `RUN_DIR_MODE` (0700).
