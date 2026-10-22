# Phase 3: Container Runtime and Bridges - Context

**Gathered:** 2026-10-21
**Status:** Ready for planning
**Mode:** `--auto` (all gray areas auto-selected; each choice derived from `docs/specs/realm-spec.xml`, the settled user decisions S-07 to S-16 below, and the frozen Phase 1 and Phase 2 contracts. Decision IDs continue from Phase 2 (D-46 onward). Threat IDs use `T-03-xx`.)

<domain>
## Phase Boundary

Phase 3 delivers the runtime and bridge layer behind the lifecycle controller, and the first gate on file-mutating tools:

1. Prerequisite probe for Podman, the rootless Podman API socket, and the Podman version floor (RT-02).
2. A closed, typed libpod client over a Unix socket, with no exec route, and the session-container hardening profile plus its verifier (RT-01).
3. An OpenShell adapter that builds the pinned `sandbox create` argv, writes a deny-all network policy document, and is the only path by which agent workload code is started (RT-03).
4. An AgentOS supervisor behind an `AgentOsDriver` port, with bounded backoff and `AGENTOS_CRASH_LOOP` (RT-04).
5. A TypeScript HTTP client for Anda Engine with a shape handshake, reconnection with bounded exponential backoff and jitter, and state feed into the controller (ANDA-01, ANDA-02, ANDA-03, ANDA-04).
6. The lifecycle gate for file-mutating tools (CORE-05), `realm down` label sweep with zero orphans (RT-09), and the Phase 3 doctor checks that D-44 assigned to this phase.
7. Podman-gated integration bodies that skip with a stated reason on Podman 4.9.3 (`PODMAN_UNSUPPORTED_VERSION`).

Out of this phase (see `<deferred>`): the reaper and stale-record cleanup (RT-08, Phase 4); default-deny egress enforcement and the egress allowlist mapping (RT-05, Phase 4); the dispatcher, queue wait, and tool timeouts (TOOL-03, TOOL-04, Phase 4); any per-call `exec` through OpenShell (Phase 4, because no exec verb is in the pinned OpenShell set); creation of the control socket (RT-06, Phase 6); the CLI and daemon (Phase 6); host snippets; the Omp, MCP, and ACP surfaces (Phase 5).

**Verification boundary.** The local host runs Podman 4.9.3, below the 5.x that OpenShell's Podman driver requires, so no live container or OpenShell run is possible in this phase. Every behavior is tested against in-process fakes and a fake Unix-socket libpod server. Live behavior is written as gated suites that skip with a stated reason. A phase verification can therefore only report "unit-verified, live-gated". It must not report live verification.

</domain>

<spec_lock>
## Requirements Lock (source: `.planning/REQUIREMENTS.md` and `docs/specs/realm-spec.xml`)

Phase requirements: **CORE-05, RT-01, RT-02, RT-03, RT-04, RT-09, ANDA-01, ANDA-02, ANDA-03, ANDA-04** (10 IDs). Their text lives in `.planning/REQUIREMENTS.md` and is not restated here. No phase-level `*-SPEC.md` exists, so `spec_loaded = false`. Where a requirement's literal wording conflicts with a settled input, the settled input governs and the conflict is recorded in D-46 and D-47. The requirement text is not edited in this phase.

</spec_lock>

<decisions>
## Implementation Decisions

### Settled inputs (from the user; not reopened in this discussion)

- **S-07:** Policy default is **advisory** with a visible warning. **Fail-closed** is an opt-in per project. Host write tools (Omp built-in write and edit) are disabled only in required mode, which is Phase 5 (OMP-05). Phase 3 gates mutation through the controller (CORE-05); it does not touch host tools.
- **S-08:** Runtime layering. The **OpenShell gateway runs on the host, rootless**, and creates **one OpenShell sandbox per session** through its **Podman driver**. The **AgentOS library runs as the sandbox workload**. **Anda Engine runs as a separate service**, reached over HTTP from the TypeScript client. Nothing nests OpenShell inside the Realm container, and nothing runs privileged.
- **S-09:** Host Podman is **4.9.3**. The OpenShell Podman driver needs **Podman 5.x**. Live container and runtime integration tests stay gated with `PODMAN_UNSUPPORTED_VERSION`. Unit tests use a **fake Unix-socket HTTP server** that emulates the libpod routes. The verified route set is confirmed on a 5.x host through the gated integration suite. The local Podman install is not changed.
- **S-10:** OpenShell CLI is pinned to the locally verified **0.1.2** verbs: `sandbox create --name`, `--policy`, `--no-auto-providers`, `--no-keep`, `--detach`, `--env`, `--label`, `--provider`, `--cpu`, `--memory`, and a trailing `-- command`. The docs describe 0.1.5. The drift is recorded in the runtime decision note and re-verified on upgrade.
- **S-11:** AgentOS: the **library mode** inside the sandbox is primary. Its native sidecar requirement is unverified, so it is recorded as an open question. Hosted mode (Rivet engine and services images through Podman) is secondary and gated.
- **S-12:** Anda: a **TypeScript client over the Anda Engine HTTP API** (`POST /{id}`, CBOR or JSON, Bearer CWT or ICP envelope). **No Rust shim.** A version handshake runs on connect. Reconnection uses **bounded exponential backoff with jitter**, and the connection state feeds the state machine.
- **Carried from Phase 2 (S-02 to S-05, still in force):** one container per session; advisory locks live in the daemon, keyed by canonical path, with no daemon in Phase 3; the control channel is a user-only Unix socket and is not created in Phase 3; reaping keys off the session record and belongs to Phase 4.

### Requirement-text conflicts resolved by the settled inputs

- **D-46:** RT-03 and ROADMAP Phase 3 success criterion 3 say "OpenShell runs inside the container". S-08 places the OpenShell gateway on the host, and the Podman driver creates the sandbox container. The settled layering governs. RT-03's intent is kept: all agent execution is routed through OpenShell, and no code path bypasses it. This is proven by `test/runtime/openshell-routing.test.ts`: the only workload start is the OpenShell adapter argv, the libpod client has no exec method, and AgentOS is reached only through its supervisor. The requirement text is not edited here. The mismatch is reported to the user as a requirement-wording decision. **Reversibility:** costly. Every runtime module depends on this layering.

- **D-47:** RT-01's "running realm container" is the **session sandbox container created by the OpenShell Podman driver**. Realm does not create it, because S-08 assigns creation to OpenShell. Realm **verifies** it after create through libpod inspect against the hardening profile (D-51). A mismatch destroys the container and moves the session to `error` with `OPENSHELL_START_FAILED` and a reason that names the first failed property. No fallback to a Realm-created container is allowed without a new decision. **Reversibility:** costly.

- **D-48:** Gating. Every live test skips with a reason that names the code (`PODMAN_UNSUPPORTED_VERSION` on 4.9.3, `PODMAN_MISSING` when the binary is absent). The unit suite never depends on Podman. The libpod routes and their response fields are **provisional** (podman.md Q5: no route verified). They are isolated in one file, `src/runtime/libpod-routes.ts`, and marked provisional there. **Reversibility:** reversible, because the route file is the only place they live.

### Module layout (extends D-19; spec n2 with the Phase 2 amendments)

- **D-49:** New paths for Phase 3. Each file has one owner:
  - `src/core/backoff.ts`: pure bounded exponential backoff with full jitter. The random source and the sleep are injected. Shared by the Anda client and the AgentOS supervisor.
  - `src/core/ports.ts`: **add** a sibling interface `BridgePort` (connect, current state, change subscription, close). `ExecutionService` is unchanged (D-39 is frozen).
  - `src/runtime/config.ts`: `RuntimeConfig` type and load-time validation (D-52).
  - `src/runtime/podman-version.ts`: the version parser moved from `test/integration/podman-version.ts` (Phase 1 handed this move to Phase 3). Its unit test moves with it to `test/runtime/podman-version.test.ts`, and the imports in `test/integration/podman-gate.test.ts` are updated.
  - `src/runtime/podman-probe.ts`: the prerequisite probe (D-53).
  - `src/runtime/libpod-routes.ts` (provisional route table) and `src/runtime/libpod-client.ts` (closed client, D-54).
  - `src/runtime/hardening.ts`: the profile constant and `verifyInspect` (D-51).
  - `src/runtime/openshell.ts`: argv builder, policy document builder, and the bounded runner (D-55 to D-57).
  - `src/runtime/agentos.ts`: `AgentOsDriver` port and the supervisor (D-59, D-60).
  - `src/runtime/session-execution.ts`: the `ExecutionService` implementation that composes the above (D-67).
  - `src/anda/client.ts` (the bridge, `BridgePort` implementation) and `src/anda/shape.ts` (AppInformation shape check, D-61).
  - `src/lifecycle/mutation-gate.ts` (CORE-05, D-63).
  - `src/lifecycle/controller.ts`: extended (D-64, D-65). It is not replaced.
  - `src/doctor/checks.ts`: extended with the D-44 Phase 3 checks (D-69).
  - `test/support/fake-libpod.ts` (fake Unix-socket server emulating libpod), `test/support/fake-anda.ts` (fake HTTP server), `test/support/fake-bridge.ts` (in-memory `BridgePort`), `test/support/fake-agentos.ts` (in-memory `AgentOsDriver`), `test/support/fake-openshell.ts` (records argv and returns scripted results). Helpers only; they are not test files.
  - **Not created in Phase 3:** `src/anda/native/` (ANDA-04: no shim), `src/runtime/egress.ts` (Phase 4), `src/session/reap.ts` (Phase 4), `src/tools/` (Phase 4), `src/cli/` (Phase 6), any control socket code (Phase 6).
  - **Reversibility:** reversible (placement), except the port shapes, which are costly.

- **D-50:** Dependency direction, extending D-20. `core` imports nothing. `runtime` imports `core`, `contract`, `fs` (atomic replace for the policy document), and `session/paths`. `anda` imports `core` and `contract` only. `lifecycle` imports `core`, `session`, `fs`, and `contract`, and receives `ExecutionService`, `BridgePort`, and any other port through its deps; it does **not** import `runtime` or `anda`. The composition is wired by the caller, which is Phase 6. `doctor` may import `runtime` and `anda` for its probes. No module outside `lifecycle` imports `lifecycle`. **Reversibility:** reversible.

### Libpod client and hardening (RT-01, RT-03, RT-09)

- **D-51:** Hardening profile constant `HARDENING_PROFILE` in `src/runtime/hardening.ts`. The properties that `verifyInspect(profile, inspect)` checks on the session container are:
  - not privileged; rootless (from `info`, not inferred);
  - `CapDrop` is exactly `["ALL"]`, and `CapAdd` is empty (no capability is verified yet);
  - `no-new-privileges` is set;
  - read-only root filesystem, with tmpfs mounts at `/tmp` and `/run`;
  - PID limit 512, memory limit 1 GiB, CPU limit 2 CPUs (these are Claude's-discretion defaults, held in this one constant);
  - network mode `none` (RT-05 allowlist is Phase 4);
  - the image digest equals the pinned digest;
  - the mount set is exactly the canonical workspace root and the realm state directory. No mount path may be or contain `docker.sock` or `podman.sock`.

  `verifyInspect` returns an empty list on conformance, or the list of failed property names. Any unknown or missing field counts as a failure (fail closed). **Reversibility:** costly. The profile is the RT-01 contract.

- **D-52:** Image pinning and config (RT-01). `RuntimeConfig` requires `image` matching `^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$`. A tag-only reference is rejected at load with `SCHEMA_INVALID`. `andaUrl` must parse as an `http:` or `https:` URL with no userinfo. `workloadArgv` is a non-empty string array with no default. Phase 3 supplies no default image and no default workload; the caller and the gated suite provide them. `stateDir` and `workspaceRoot` are absolute. Numeric limits live only in `HARDENING_PROFILE` and in the Anda and AgentOS backoff defaults (D-59, D-62). **Reversibility:** reversible.

- **D-53:** Prerequisite probe (RT-02). `probePodman({ runCommand, connectSocket, env, timeoutMs })` takes injected I/O and is run in this order:
  1. Run `podman --version` as argv with no shell, a timeout of 5000 ms, and an explicit minimal host environment (`PATH`, `HOME`, `XDG_RUNTIME_DIR`). ENOENT, a non-zero exit, or a timeout gives `PODMAN_MISSING`.
  2. Parse the version with `podman-version.ts`. A major below 5, or output that does not parse, gives `PODMAN_UNSUPPORTED_VERSION`. The reason names the detected version and that OpenShell requires 5.x. Realm does not install or upgrade anything.
  3. Connect to the rootless API socket at `$XDG_RUNTIME_DIR/podman/podman.sock`. A refused connection, a missing socket, or a timeout gives `PODMAN_MACHINE_DOWN`. The reason gives the fix `systemctl --user start podman.socket`.

  On Linux, "machine" means the rootless API service (podman.md Q4). This mapping is recorded in the runtime note as an assumption (OQ-P3-13). The result is `{ ok: true, version }` or `{ ok: false, code, reason }`. `reason` comes from `ERROR_CATALOGUE`, with the specific detail appended. Probing stops at the first failure. **Reversibility:** reversible.

- **D-54:** Libpod client (`src/runtime/libpod-client.ts`) is a **closed class** over `node:http` with `socketPath`. Its public methods are exactly `info()`, `listContainersByLabel(key, value)`, `inspectContainer(id)`, `stopContainer(id, timeoutMs)`, and `removeContainer(id, { force })`. No public method takes a path, a method name, or a body from a caller. It has **no exec, attach, or start-exec method**, which is the structural RT-03 guard. Every request is raced against a timeout, and the socket is destroyed when the timeout fires. Route paths come only from `libpod-routes.ts` (D-48). Tests assert the method set by runtime key listing and the absence of any `exec` route string. **Reversibility:** costly.

### OpenShell adapter and policy document (RT-03, RT-05 preparation)

- **D-55:** OpenShell argv builder `buildCreateArgv(input)` returns exactly this sequence for one session, with no shell:
  `openshell sandbox create --name realm-<sessionId> --policy <policyPath> --no-auto-providers --no-keep --detach --label io.realm.managed=true --label io.realm.session=<sessionId> --cpu <cpus> --memory <memory> -- <workloadArgv...>`

  The builder never emits `--env` or `--provider`, because AUD-02 forbids host environment or credentials reaching the sandbox. Tests assert both absences, assert that the workload follows `--`, and assert the 0.1.2 verb list exactly. Semantics of `--no-keep` combined with `--detach` are documented only for 0.1.5 and are recorded as an open question (OQ-P3-12). **Reversibility:** costly. The verbs are pinned (S-10).

- **D-56:** Create is **idempotent by label** (CORE-06). Flow: (1) `listContainersByLabel` for `io.realm.session=<id>`. If a container exists, return its id and run nothing. (2) Otherwise run the create argv through the bounded runner. (3) Poll `listContainersByLabel` at 250 ms intervals until a container appears or the caller's deadline expires. Deadline expiry gives `OPENSHELL_START_FAILED`. A repeated create with a sandbox of the same name therefore never creates a second container. **Reversibility:** reversible.

- **D-57:** Policy document. `buildPolicyDocument(config)` returns a plain object that is written as **JSON** (valid YAML 1.2, so no YAML dependency is added; the gated suite confirms OpenShell accepts it, OQ-P3-15). It contains:
  - `version: 1`;
  - `filesystem_policy`: `read_only: []`, `read_write: ["/workspace"]` (the in-sandbox workspace path is a Realm convention, OQ-P3-02);
  - `landlock: { compatibility: "hard_requirement" }` (fail closed when Landlock is unavailable; the docs require ABI v3 for either mode);
  - `process: { run_as_user: "sandbox", run_as_group: "sandbox" }` (the docs reject root, so no root is requested);
  - `network_policies: {}`, which is deny-all egress by the documented default. The allowlist mapping is Phase 4 (RT-05). The docs' `binaries` key name is not recorded in the note, so no endpoint is written in Phase 3 (OQ-P3-16).

  The document is written with the atomic replace from `src/fs/atomic-write.ts` into `<stateDir>/runtime/<sessionId>.policy.json` with mode 0600. It holds no secret and no environment. **Reversibility:** costly, because the policy shape is a documented contract.

### AgentOS supervision (RT-04)

- **D-59:** `AgentOsDriver` port in `src/runtime/agentos.ts`: `start(): Promise<void>`, `alive(): Promise<boolean>`, `stop(): Promise<void>`. The supervisor owns restart policy:
  - a crash (`alive` false, or `start` rejects) restarts after a backoff from `src/core/backoff.ts` (base 500 ms, cap 8000 ms, full jitter);
  - **maximum consecutive attempts: 5**. The fifth consecutive failure holds the supervisor and throws `AGENTOS_CRASH_LOOP` (retryable, so an explicit retry can run again);
  - the consecutive counter resets after 60000 ms of continuous `alive`;
  - every driver call is raced against a timeout (QUAL-01).

  The concrete driver is **not** written in Phase 3, for two reasons. First, the library package `@rivet-dev/agentos-core` is not verified in its registry, and no dependency is added without that check (D-07 analogue, OQ-P3-06). Second, the in-sandbox channel between the host supervisor and the library process is not documented (OQ-P3-05). `session-execution.ts` takes the driver as a dependency, so the composition is complete and the gap is named. **Reversibility:** reversible.

- **D-60:** AgentOS lifecycle goes only through the supervisor, which uses the `AgentOsDriver` port and its supported library API. Nothing else starts or stops the AgentOS process. Hosted mode is not implemented (S-11). Native sidecar support stays an open question (OQ-P3-07).

### Anda bridge (ANDA-01, ANDA-02, ANDA-03, ANDA-04)

- **D-61:** Boundary and handshake. The bridge is a TypeScript HTTP client over Anda Engine (S-12). Phase 3 uses **only the documented anonymous route** `GET /.well-known/information`, which returns `AppInformation` (anda.md Q1, server README). It does not use `POST /{id}`, because the RPC body layout and credential format are undocumented (anda.md Q2, Q3). Credentials are therefore not needed in Phase 3. JSON only; no CBOR dependency is added.

  Anda documents **no protocol or engine version** on any route (anda.md Q4), so the **ANDA-02 "version handshake" is a shape handshake**. `shape.ts` checks that the body is a JSON object with `engines` as an array, `default_engine` as a string or null, and `start_time_ms` as a non-negative integer. Any mismatch gives `ANDA_VERSION_MISMATCH`. When Anda publishes a version surface, it replaces the shape check, and `anda-decision.md` records the change. This limitation is named in the decision note and in the phase report, not presented as a version check. **Reversibility:** reversible.

- **D-62:** Reconnection and states (ANDA-03). `AndaBridge` implements `BridgePort`:
  - `connect(deadlineMs)` runs one handshake, bounded by a per-attempt timeout of 2000 ms, and retries with `src/core/backoff.ts` (base 500 ms, cap 30000 ms, full jitter) until the deadline. Exhaustion gives `ANDA_UNREACHABLE`. A shape mismatch fails at once with `ANDA_VERSION_MISMATCH` and is not retried.
  - After a successful connect, a background loop probes at the same backoff schedule. A failure publishes `down` with `ANDA_UNREACHABLE` and keeps retrying in the background. A success publishes `up`.
  - `close()` cancels every timer and aborts any in-flight request. No timer survives close.
  - The bridge never changes the state machine itself. It publishes events, and the controller decides (D-65).

  **Reversibility:** reversible.

- **D-63 (CORE-05 gate).** `src/lifecycle/mutation-gate.ts` exposes `gateMutation(policy, state)`, a synchronous wrapper over `decideMutation` (D-23). It returns `{ outcome: "proceed" }`, `{ outcome: "proceed-with-warning", warning }`, or `{ outcome: "refused", code }`. `runGatedMutation(gate, fn)` runs `fn` only on proceed outcomes and returns the warning with the result. The gate **never waits**. Bounded queue wait is TOOL-04 (Phase 4), so a non-active call is decided in the same tick and cannot hang. The controller exposes `mutationGate()`, which reads the current state. The gate does not write audit entries; the dispatcher does that in Phase 4. **Reversibility:** reversible.

- **D-64 (controller state rules).** The controller gains a required `bridge: BridgePort` dependency. Every existing caller is migrated, including the Phase 2 controller and idempotency tests, through `test/support/fake-bridge.ts`. The transitions are:
  - Startup (create): after `exec.start`, call `bridge.connect(deadline)` inside the same startup budget. Success moves `connecting` to `active`. Exhaustion moves `connecting` to `error` with `ANDA_UNREACHABLE`. A mismatch moves it to `error` with `ANDA_VERSION_MISMATCH`. Both are retryable through the existing `error` to `connecting` edge, except that a mismatch is not retryable.
  - Bridge `down` while `active`: move to `degraded` with reason `ANDA_UNREACHABLE`. Bridge `up` while `degraded`: move to `active` with reason `anda reachable`. Bridge `mismatch` in `active` or `degraded`: move to `error` with reason `ANDA_VERSION_MISMATCH`.
  - Listener guard: a bridge event moves the state only when the current state is `active` or `degraded` (or `connecting`, for the startup path, which the create flow owns). In any other state the event is discarded by an explicit check, never by a caught throw. This avoids `REALM_INVALID_TRANSITION` from a background timer.
  - `probe()` remains exec-only. Probe never produces `degraded` from a container result. Degraded comes only from the bridge (Phase 2 D-38 said Phase 3 does this).
  - `stop()` closes the bridge before `exec.stop`, inside the existing teardown bound. `destroy()` also closes it.

  **Reversibility:** costly. The state transitions are user-visible through the two labels.

- **D-65 (controller and bridge contract).** The bridge emits `{ kind: "up" | "down" | "mismatch", code?, at }`. The controller subscribes once in create and unsubscribes in destroy. The listener is registered before the first handshake, so no event is lost. Events do not carry the response body or any credential.

- **D-66 (no shim, ANDA-04).** No `src/anda/native/` directory is created. `docs/integration/anda-decision.md` records the no-shim decision and its evidence: a documented HTTP surface exists, so ANDA-04's condition for a shim is not met. The Anda licence conflict recorded in `anda.md` Q6 is carried as an open item (OQ-P3-11). It does not block Phase 3, because no Anda code or dependency is added.

### Session execution composition and teardown (CORE-06, RT-07, RT-09)

- **D-67:** `src/runtime/session-execution.ts` implements `ExecutionService`:
  - `create({ idempotencyKey, workspaceRoot })` builds the hardened `RuntimeConfig` view, writes the policy document (D-57), runs the OpenShell create with label idempotency (D-56), resolves the container id, and runs the hardening verifier (D-51). A verification failure destroys the container and throws `OPENSHELL_START_FAILED`.
  - `start(containerId)` checks the container is running through `inspectContainer`. It starts nothing itself, because OpenShell starts the sandbox with `--detach`. A non-running container gives `OPENSHELL_START_FAILED`.
  - `probe(containerId)` gives `healthy` when the container is running and AgentOS `alive()` is true, and `unhealthy` otherwise.
  - `stop(containerId)` calls `stopContainer`.
  - `destroy(containerId)` calls `removeContainer(force)`.
  - Every method takes an injected `LibpodClient`, `OpenShellRunner`, and `AgentOsSupervisor`. None reads `process.env`.

  **Reversibility:** costly, because the controller depends on the port shape.

- **D-68:** `realm down` (RT-09) is a sweep. `removeAllRealmContainers(client)` lists every container with `io.realm.managed=true` and removes each one with `force`. It then lists again and fails if any remain, so the sweep proves zero orphans. Failure gives `REALM_STOPPING`, with the session left in `stopping`. A repeated call resumes. Containers without the realm label are never touched. The controller's session `destroy` removes that session's container, and the sweep covers any leftover. **Reversibility:** reversible.

### Doctor (D-44 Phase 3 registration; CLI-03 is Phase 6)

- **D-69:** D-44 said Phase 3 registers its items into the same runner. Phase 3 registers only items it can inspect truthfully:
  - `podman`: pass when `podman --version` gives 5.x or newer; fail with `PODMAN_MISSING` or `PODMAN_UNSUPPORTED_VERSION` and a fix for each.
  - `podman-service`: fail with `PODMAN_MACHINE_DOWN` and the `systemctl --user start podman.socket` fix when the socket refuses; pass otherwise.
  - `openshell`: runs `openshell sandbox create --help` and passes only when the output mentions each pinned flag (`--policy`, `--no-auto-providers`, `--no-keep`, `--detach`, `--label`, `--cpu`, `--memory`). A missing binary is a fail with the fix "install the OpenShell CLI at the pinned 0.1.2 verbs". A binary with other flags is a warn with the drift note.
  - `anda-bridge`: pass when `/.well-known/information` returns the shape (D-61); fail with `ANDA_UNREACHABLE` and the fix "start the Anda engine at the configured URL"; warn "not configured" when no URL is set.

  The AgentOS item is **not registered** in Phase 3, because no driver binding exists to inspect (D-59). The control-channel item stays with Phase 6. Each check returns `{ id, status, detail, fix }` as in D-44. **Reversibility:** reversible.

### Test suite taxonomy (QUAL-02; extends D-45)

- **D-70:** Test layout follows D-45 with new `runtime` and `anda` directories. Every Phase 3 requirement ID maps to at least one named test file:
  - `test/core/backoff.test.ts`: bounded exponential schedule, cap, full jitter with an injected random source, zero jitter at the boundary (ANDA-03, AgentOS backoff).
  - `test/runtime/podman-version.test.ts`: moved from `test/integration/`, unchanged assertions (RT-02 parse path).
  - `test/runtime/podman-probe.test.ts`: ENOENT gives `PODMAN_MISSING`; 4.9.3 gives `PODMAN_UNSUPPORTED_VERSION`; refused socket gives `PODMAN_MACHINE_DOWN`; 5.x with socket gives pass; human-readable reason on each (RT-02).
  - `test/runtime/config.test.ts`: tag-only image rejected; digest image accepted; `andaUrl` with userinfo rejected; empty `workloadArgv` rejected; relative paths rejected (RT-01, RT-05 precursor).
  - `test/runtime/libpod-client.test.ts`: closed method set by runtime key listing; no exec route string; timeout destroys the socket; fake server round trip (RT-03 guard, RT-09 support).
  - `test/runtime/hardening.test.ts`: each property in D-51 checked, a conforming inspect yields an empty list, a missing field fails closed (RT-01).
  - `test/runtime/openshell-argv.test.ts`: the exact pinned argv, the workload after `--`, no `--env`, no `--provider` (RT-03, AUD-02).
  - `test/runtime/openshell-policy.test.ts`: `version: 1`, `hard_requirement`, `run_as_user` not root, `network_policies` empty, JSON that parses, file mode 0600 (RT-03).
  - `test/runtime/openshell-routing.test.ts`: structural no-bypass: the session-execution workload start goes only through the OpenShell argv builder; the libpod client has no exec method; AgentOS starts only through the supervisor (RT-03, the D-46 guarantee).
  - `test/runtime/agentos-supervisor.test.ts`: restarts with bounded backoff; `AGENTOS_CRASH_LOOP` on the fifth consecutive failure; counter reset after stable window; timeout on a hung driver (RT-04).
  - `test/runtime/session-execution.test.ts`: create reuses the labelled container with no second create (CORE-06); verification failure destroys and gives `OPENSHELL_START_FAILED`; policy document written before create (RT-07 ordering).
  - `test/runtime/down-sweep.test.ts`: three labelled containers and one foreign container; after sweep no labelled container remains and the foreign one is untouched; repeated sweep is a no-op; a remaining container gives `REALM_STOPPING` (RT-09).
  - `test/lifecycle/mutation-gate.test.ts`: every state under both modes; synchronous return; warning text names the state; no wait (CORE-05).
  - `test/lifecycle/bridge-states.test.ts`: `active` to `degraded` on `down` with `ANDA_UNREACHABLE`; `degraded` to `active` on `up`; mismatch to `error`; startup exhaustion to `error`; events in disallowed states discarded without a throw (ANDA-03 state feed, CORE-05 non-hang).
  - `test/anda/handshake.test.ts`: fake server with correct shape gives connect; wrong shape gives `ANDA_VERSION_MISMATCH` with no retry; no credentials sent (ANDA-02).
  - `test/anda/reconnect.test.ts`: unreachable gives `ANDA_UNREACHABLE` and background retries with growing bounded delays; recovery publishes `up`; `close()` leaves no timer (ANDA-03).
  - `test/anda/boundary-decision.test.ts`: `docs/integration/anda-decision.md` exists and records the HTTP boundary, the shape-handshake limitation, the no-shim decision, and the licence conflict (ANDA-01).
  - `test/anda/no-shim.test.ts`: `src/anda/native/` does not exist; the decision note cites the documented HTTP surface (ANDA-04).
  - `test/doctor/runtime-checks.test.ts`: pass, warn, and fail outcomes for `podman`, `podman-service`, `openshell`, and `anda-bridge`, each with its fix; no AgentOS item registered (D-69).
  - `test/integration/podman-gate.test.ts` (extended in place): live bodies for RT-01 hardening, RT-03 routing, and RT-09 zero orphans. They run under `skip: gate` and skip on 4.9.3 with `PODMAN_UNSUPPORTED_VERSION` (RT-01, RT-03, RT-09).
  - `test/quality/suite-taxonomy.test.ts` (extended): adds `runtime` and `anda` to the category map, and asserts all 10 Phase 3 requirement IDs are cited by at least one test file (QUAL-02 category part).

  `test/support/*` files are helpers. They are exercised by the tests above and are not test files.

- **D-71:** No MCP or ACP test file is created in Phase 3 (Q-4 stands; Phase 5).

- **D-72:** The Phase 2 doctor test (`test/doctor/checks.test.ts`) asserts the three Phase 2 check IDs and that no Phase 3 name is registered. D-69 changes that registration on purpose, so its expected-ID list is migrated to the Phase 2 and Phase 3 checks. The absence assertion is narrowed to the AgentOS and control-channel names. This is a deliberate change, not an incidental edit. **Reversibility:** reversible.
- **D-73:** A relative `stateDir` or `workspaceRoot` in `RuntimeConfig` fails at load with `SCHEMA_INVALID`, the same mechanism D-22 uses for a relative policy root (a `SchemaInvalidError`). The Anda shape check (D-61) is hand-written code in `src/anda/shape.ts`. It adds no schema file and no ajv use. **Reversibility:** reversible.
- **D-74:** `test/integration/podman-gate.test.ts` keeps its own `execFile` probe, so the skip gate depends on no runtime module. The runtime probe (D-53) is tested separately in `test/runtime/podman-probe.test.ts`. The gate test imports only the parser from `src/runtime/podman-version.ts`. **Reversibility:** reversible.

### Claude's Discretion

- Exact helper names, internal splits inside a module, and the exact argument shape of `runCommand` and `connectSocket` injection.
- Test helper layout under `test/support/`.
- Number of plans and their wave grouping, subject to the file-ownership rule (each file has one owner per wave) and to the dependency order in `<canonical_refs>`.
- Exact warning and reason text beyond the frozen catalogue reasons, as long as the two display labels stay exact.
- Whether the probe's version and socket checks share one `Promise.all` or run in sequence (sequence is the default, because the first failure must short-circuit).

### Open questions (recorded; each has a default that the plan applies)

- **OQ-P3-01 (blocking the live proof, not the unit build):** Does OpenShell's Podman driver apply the `--label` values to the container it creates? Default: assume yes. If not, label lookup never finds the container, create times out to `OPENSHELL_START_FAILED`, and nothing is claimed. Gated suite decides.
- **OQ-P3-02:** Can the OpenShell driver bind-mount the workspace, and at what in-sandbox path? Default: `/workspace` (D-57). Gated.
- **OQ-P3-03:** How is the digest-pinned image reference passed to OpenShell? No image verb is in the pinned set. Default: the verifier (D-51) refuses any container whose image digest differs. Gated.
- **OQ-P3-04:** Does an OpenShell sandbox record persist after its container is removed? No sandbox delete verb is pinned. Default: Phase 3 removes containers only. Phase 4 reaper handles records.
- **OQ-P3-05 (blocks the concrete AgentOS driver):** No documented channel between the host supervisor and the AgentOS library process in the sandbox. Default: `AgentOsDriver` port only; no concrete binding. Reported as blocked.
- **OQ-P3-06 (blocks adding the AgentOS dependency):** `@rivet-dev/agentos-core` version, license, and Node floor are not verified in its registry. Default: no dependency added in Phase 3. Execution checks `npm view` read-only before any add.
- **OQ-P3-07:** Whether AgentOS library mode needs a native sidecar, and whether native ELF binaries run (agentos.md Q5). Default: recorded as open; library mode primary (S-11).
- **OQ-P3-08:** Confirm the flags in `podman run --help` against the local 4.9.3 binary (podman.md open question 1). Run it read-only, with no install or upgrade, and record the result in the runtime note.
- **OQ-P3-09:** Anda publishes no protocol version (anda.md Q4). Default: shape handshake (D-61). Recorded as a limitation.
- **OQ-P3-10:** Anda RPC body and credential format (anda.md Q2, Q3). Not needed in Phase 3. Blocks Phase 4 or 5 tool calls through Anda.
- **OQ-P3-11:** Anda licence conflict (anda.md Q6). Default: no Anda code or dependency added. Must be resolved before any is vendored.
- **OQ-P3-12:** OpenShell CLI drift: docs 0.1.5, pinned verbs 0.1.2 (S-10). Also the `--no-keep` with `--detach` semantics, documented only for 0.1.5. Default: pin 0.1.2 and gate.
- **OQ-P3-13:** On Linux, "Podman machine" is mapped to the rootless API socket (D-53). Default: this mapping, recorded.
- **OQ-P3-14:** Whether the OpenShell driver applies PID limit, read-only root, and capability drop. Default: the verifier (D-51) fails closed when it does not. Gated.
- **OQ-P3-15:** Whether OpenShell accepts the policy as JSON (valid YAML 1.2). Default: JSON. Gated.
- **OQ-P3-16:** The `binaries` key name and endpoint shape for `network_policies` (openshell.md Q3 does not record it). Default: no endpoints in Phase 3; Phase 4 maps the allowlist after reading the schema.

### Requirement text drift (reported, not edited)

- RT-03 and ROADMAP Phase 3 SC3 say "OpenShell runs inside the container". Settled S-08 contradicts it (D-46).
- RT-01 and ROADMAP Phase 3 SC2 describe a container Realm runs. Under S-08 Realm verifies a container that OpenShell creates (D-47).

Both are reported for a user decision. Neither is edited here.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product spec (source of truth; do not modify)
- `docs/specs/realm-spec.xml` §REALM_SANDBOX (CONTAINER_LAYER_PODMAN, RUNTIME_LAYER_OPENSHELL, AGENT_OS_LAYER, ANDA_ENGINE_BRIDGE, LIFECYCLE), §STATES, §GRACEFUL_DEGRADATION (FAILURE_CASES: "Anda bridge unreachable: degraded, with a retry in the background"; "AgentOS crashes: restart with backoff, then error"), §GRAPH_OF_THOUGHT n2 (module map), n3 (defaults), n4 (Anda boundary and control channel), n5 (failure modes), n6 (frozen contracts), n7 (doc gates).

### Planning state
- `.planning/REQUIREMENTS.md`: CORE-05, RT-01, RT-02, RT-03, RT-04, RT-09, ANDA-01 to ANDA-04 text, and the traceability table.
- `.planning/ROADMAP.md`: Phase 3 goal and five success criteria.
- `.planning/PROJECT.md`: constraints (ESM, strict, no host paths, no telemetry, no unverified dependency, no secrets).
- `.planning/STATE.md`: Phase 3 blockers (Anda boundary, Podman 4.9.3 versus 5.x).

### Integration notes (gates; read for the facts and open questions they record)
- `docs/integration/podman.md`: Q1 hardening flags (confirm on 4.9.3), Q2 limits, Q3 no egress allowlist, Q4 API socket (never mount it), Q5 libpod routes not verified.
- `docs/integration/openshell.md`: Q1 the Podman driver creates its own container, Q2 Podman 5.x minimum, Q3 policy schema, Q4 enforcement, Q5 `--policy`, Q7 TypeScript SDK (not used in Phase 3).
- `docs/integration/agentos.md`: Q1 library versus hosted, Q2 lifecycle API (`AgentOs.create`, `dispose`), Q5 native binaries not documented, Q8 hosted worker is Docker-based.
- `docs/integration/anda.md`: Q1 HTTP boundary and routes, Q2 RPC schema not documented, Q3 credentials not documented, Q4 no version surface, Q6 licence conflict.
- `docs/integration/hosts.md`: Node constraint behind `engines` (not changed in Phase 3).

### Prior phases (frozen; read before touching related code)
- `.planning/phases/01-scaffold-and-frozen-contracts/01-CONTEXT.md` (D-01..D-18) and `01-06-SUMMARY.md` (Podman gate and the helper move to `src/runtime/`).
- `.planning/phases/02-policy-state-and-filesystem-lockdown/02-CONTEXT.md` (D-19..D-45), `02-VERIFICATION.md` (what passed), and `02-REVIEW.md` (H-1 to H-2 fixed in the corrective pass; M-3 raw port errors leaving teardown).

### Frozen code (extend beside it; never edit the frozen tables)
- `src/core/states.ts` (six states, 13 allowed edges, `checkTransition`).
- `src/core/errors.ts` (22-code catalogue: the 20 spec codes plus `PODMAN_UNSUPPORTED_VERSION` and `AUDIT_WRITE_FAILED`; `ERROR_CATALOGUE`; `makeRealmError`). No code is added in Phase 3.
- `src/core/policy.schema.json`, `src/contract/tools.schema.json`, `src/contract/session-record.schema.json`, `src/contract/validate.ts`.
- `src/core/ports.ts` (`ExecutionService`; D-39 frozen; `BridgePort` is added beside it).
- `src/core/policy.ts` (`decideMutation`, D-23), `src/core/timeout.ts` (`withTimeout`), `src/core/events.ts`, `src/core/status.ts`.
- `src/lifecycle/controller.ts` (extended in D-64; its operation names are frozen).
- `src/fs/atomic-write.ts`, `src/fs/locks.ts`, `src/session/paths.ts`, `src/session/store.ts`.
- `test/integration/podman-gate.test.ts`, `test/integration/podman-version.ts`, `test/quality/suite-taxonomy.test.ts`, `test/support/fake-execution.ts`.

No external specs or ADRs beyond the above are referenced. `.planning/codebase/` does not exist for this repo.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/core/policy.ts`: `decideMutation(policy, state)` returns `allow`, `allow-with-warning`, or `deny`. D-63 wraps it and adds no new decision logic.
- `src/core/timeout.ts`: `withTimeout(promise, ms, code)`. Every new async boundary uses it, including the libpod client, the OpenShell runner, the Anda client, and the AgentOS driver calls.
- `src/fs/atomic-write.ts`: the atomic replace for the policy document (D-57).
- `src/session/paths.ts`: `resolveStateDir`, `controlSocketPath`. The runtime derives its `runtime/` directory from the state dir argument and never reads `process.env`.
- `src/core/backoff.ts` (new): reused by the Anda client and the AgentOS supervisor.
- `test/integration/podman-version.ts` and `test/integration/podman-gate.test.ts`: the parser and the gate, which Phase 3 moves and extends.

### Established Patterns
- Typed errors through `makeRealmError(code)` and `RealmError`. Never a raw error across a boundary (Phase 2 review M-3).
- Injected I/O for every module that touches the host or the network, so tests run with no environment. `FakeExecutionService` is the model.
- Idempotency keyed by session id (Phase 2 controller, fake execution).
- Test file per source file under `test/<dir>/`, with requirement IDs cited in test titles.

### Integration Points
- `src/lifecycle/controller.ts` gains the `BridgePort` dependency (D-64). Every caller is migrated, including the Phase 2 controller tests and `test/support/fake-execution.ts`.
- `src/doctor/checks.ts` gains the D-69 checks through the same runner. The Phase 2 doctor test's expected-ID assertion is migrated in Phase 3 (D-72). Its absence check for AgentOS and control-channel items is kept.
- The spec's WORKFLOW file names (`src/runtime/execution-service.ts`, `src/core/controller.ts`, `src/policy/`) are superseded by the Phase 2 layout (D-19). The Phase 2 names are used.

</code_context>

<specifics>
## Specific Ideas

- Keep every unverified fact in one file that says so (`libpod-routes.ts`, the OpenShell verb list in `openshell.ts`), so the 5.x gated pass has a single place to confirm or correct.
- The runtime note `docs/integration/runtime-decision.md` records: the layering (S-08) and its conflict with RT-01 and RT-03 wording (D-46, D-47); the Podman gate (S-09); the OpenShell pin and drift (S-10); the AgentOS mode choice (S-11); every OQ-P3 item with its default and the module it blocks.
- The Anda note `docs/integration/anda-decision.md` records: the HTTP boundary (S-12); the evidence (anda.md Q1 and the routes); the shape-handshake limitation (D-61); the no-shim decision (D-66); the licence conflict (OQ-P3-11).

</specifics>

<deferred>
## Deferred Ideas

- Reaping of orphan containers and stale session records on startup (RT-08): Phase 4.
- Default-deny egress enforcement and the allowlist mapping into OpenShell `network_policies` (RT-05): Phase 4. Phase 3 writes deny-all only.
- The single dispatcher, the bounded queue wait while connecting, and tool timeouts (TOOL-03, TOOL-04): Phase 4.
- Any per-call `exec` through OpenShell: Phase 4, after the sandbox exec verb is pinned and verified. No exec verb is in the pinned set.
- The control socket, its permissions, and the daemon that hosts the lock table (RT-06, S-03): Phase 6.
- `realm up`, `down`, `status`, `doctor` CLI wiring and the AgentOS doctor item (CLI-01, CLI-03): Phase 6.
- Host config snippets (CLI-04): Phase 6.
- Omp, MCP, and ACP surfaces, host write-tool removal (spec q4): Phase 5.
- Hosted AgentOS mode (S-11): secondary, gated; not built in Phase 3.
- A Rust shim (ANDA-04): not needed; revisit only if the documented HTTP surface is found to be insufficient.
- Anda RPC calls and credential production (OQ-P3-10): the phase that first calls `POST /{id}`.
- Teardown-timeout catalogue code (Q-1): stays unresolved. Phase 3 keeps `TEARDOWN_TIMEOUT_MS` = 5000 with `REALM_STOPPING`, so the Phase 2 mapping still applies.

### Reviewed Todos (not folded)
- None. No todos matched this phase.

</deferred>

*Context gathered: 2026-10-21*
</content>
