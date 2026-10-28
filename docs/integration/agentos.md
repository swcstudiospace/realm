# AgentOS (Rivet): identity, lifecycle API and open questions

Gate note for FOUND-03 (decisions D-16, D-17, D-18). Blocks `src/runtime/agentos.ts` (Phase 3).

Read date: 2026-10-21 (ISO 8601).

## Official URLs read

- https://rivet.dev/docs/ (Rivet documentation root, the D-17 starting point; lists agentOS as an Actor type)
- https://rivet.dev/docs/debugging/ (Management API for Actors over HTTP)
- https://rivet.dev/agentos/docs/ (agentOS introduction; names the hosted and library modes)
- https://rivet.dev/agentos/docs/quickstart/ (Quickstart, Library)
- https://rivet.dev/agentos/docs/quickstart-hosted/ (Quickstart, Hosted)
- https://rivet.dev/agentos/docs/hosted-api/ (Hosted HTTP API reference)
- https://rivet.dev/agentos/docs/self-hosting/ (Self-Hosting, Hosted)
- https://rivet.dev/agentos/docs/security-model/ (Security Model)
- https://rivet.dev/actors/docs/lifecycle/ (Rivet Actor lifecycle hooks)

## Spec questions and sourced answers

### Q1. Is AgentOS a Rivet Actor service or a separate product?

Answer: both, as two packaging modes of the same agentOS project. Each mode has a different lifecycle and a different owner of the VM.

- Hosted mode is a Rivet Actor. The agentOS introduction says: "Hosted: the prebuilt `agentOS` Rivet Actor gives each VM a durable ID, versioned configuration, replayable output, and expiring previews, controlled from `@rivet-dev/agentos` or plain HTTP." The Rivet documentation root lists "agentOS" as one of its Actor types, with the description "A filesystem, shell, and network for code you did not write."
- Library mode is not an Actor. The introduction says: "Library: `@rivet-dev/agentos-core` runs VMs inside your Node.js backend. Your application owns the VM's lifecycle, persistence, and access to host resources." The Library quickstart describes it as "Ephemeral, runs until `dispose()` or process exit."

The comparison table in the Quickstart (Hosted) is the source for the two columns: Hosted is "Durable, sleeps when idle unless a process is running", and Library is "Ephemeral, runs until `dispose()` or process exit".

Realm's `src/runtime/agentos.ts` must pick one mode before Phase 3. This note does not pick one. Per D-18, the default where the docs leave the choice open is an `ExecutionService` interface with no actor design, so the mode is not fixed here.

### Q2. Lifecycle API (supported surface only)

Library mode (`@rivet-dev/agentos-core`), from the Library quickstart:

- `AgentOs.create(options)` creates a VM. `vm.dispose()` ends it.
- `vm.filesystem.writeFile(path, data)` and `vm.filesystem.readFile(path)` read and write files.
- `vm.software.install({ type: "url", url, expectedDigest })` installs a package. The quickstart states that packages "are verified against their digest before their commands appear on `/opt/agentos/bin`."
- `database: { type: "sqlite_file", path }` and `rootFilesystem: { type: "native", plugin: { id: "chunked_sqlite", config: {} } }` store the root filesystem in SQLite. The default is in memory.

Hosted mode (`agentOS` Actor), from the Hosted HTTP API:

- Create: `PUT /actors?namespace={namespace}` with `Authorization: Bearer`, body `{ "name": "agentOS", "key": "...", "runner_name_selector": "services", "crash_policy": "sleep" }`. The response is `{ "actor": { "actor_id": "..." }, "created": true }`.
- Actions: `POST /gateway/{vm_id}/action/v1.{group}.{action}` with header `x-rivet-token`, body `{ "args": [input] }`, response `{ "output": result }`.
- VM group actions: `v1.vm.status` reports "the active generation, applied config revision, package readiness, lifecycle state, and recent issues." `v1.vm.restart` "stops the active VM, waits for bounded shutdown, and starts a new generation from the latest desired config."
- The `vm.shutdown` event carries a `reason` of `"sleep"`, `"destroy"` or `"error"`.

Destroy: not documented in the pages read. The VM group in the Hosted HTTP API lists only `status` and `restart`, so no `v1.vm.destroy` or `v1.vm.stop` action is documented. The Rivet Actor lifecycle page describes a "Destroy command" and an `onDestroy` hook, but it gives no HTTP route. The Management API page lists no DELETE route, so no actor DELETE route is documented in the pages read, and none is recorded here.

### Q3. Network and host-capability policy

Answer: deny by default. The Security Model states: "Network access and host capabilities require explicit policy." In the Library API, a `permissions` object sets `network: { default: "deny", rules: [...] }`, where each rule has `mode`, `operations` and `patterns`. The Hosted-mode egress policy is not documented in the pages read. The Library Permissions and Resource Limits pages are linked from the Library quickstart but were not fetched.

### Q4. Security boundary

Answer, from the Security Model: "agentOS is in beta and is still undergoing security review." "Guest JavaScript executes in V8; WASM and Python use their managed executors." "The security boundary is **sidecar/runtime to executor**." The host is trusted for its own configuration, and the executor is untrusted. "Guest operations reach the host only through the sidecar's policy-enforcing interfaces."

### Q5. Native binaries and Linux userland

Not documented. The introduction says "Run isolated Linux-compatible VMs with agentOS Core," and the Security Model names V8, WASM and Python executors. Neither page says whether native ELF binaries run, so native binary support is recorded as an open risk.

### Q6. Node requirement for the library package

Not documented. The Library quickstart installs with `npm install @rivet-dev/agentos-core` and states no Node version. The Hosted quickstart's client snippet also states none.

### Q7. Contract version and stability

From the Hosted HTTP API: "The contract is currently `agentos-sdk.dev/v1alpha1`, major `1`." The package exports `AGENTOS_API_VERSION`, `AGENTOS_CONTRACT_MAJOR`, `AGENTOS_CONTRACT_HASH` and `AGENTOS_CAPABILITIES`. The Security Model and the Hosted API both state the product is beta.

### Q8. Self-hosting and container runtime

From the Self-Hosting page: the control plane runs as the `rivetdev/engine` image and the worker as `rivetdev/services:0.2.0`, both started with Docker. The worker connects to a pool named `services`. The page gives no Podman command, so running the hosted worker under Podman is not documented. Realm's Podman-only rule (spec `CONTAINER_RUNTIME`) is therefore not supported by a sourced command for hosted mode.

## Answers not in the docs (D-18 default applies)

- Actor design for Realm: not documented, and not needed. The `ExecutionService` interface is the D-18 default.
- Destroy route: not documented (see Q2).
- Native binary support: not documented (see Q5).
- Node floor for the library in a container: not documented (see Q6).

## Open questions for Phase 3

1. Hosted or library mode for `src/runtime/agentos.ts`. Hosted needs the Rivet control plane and a Docker-based worker image. Library needs a Node.js process, and its supported Node version is not documented.
2. If library mode runs inside a Realm-managed Podman container, the Node floor for that container is not documented.
3. Destroy and stop routes for hosted mode.
4. Whether `v1.vm.restart` can serve as the Realm restart path under the "stop, then start" lifecycle the spec requires.

## Module blocked

`src/runtime/agentos.ts`, until Phase 3 records the mode choice and the destroy route, or confirms the `ExecutionService` default.

## Phase 3 resolution

Recorded in `docs/integration/runtime-decision.md` (S-11, OQ-P3-05, OQ-P3-06, OQ-P3-07). Summary:

- Mode (Q1, Q2): library mode is primary and runs as the sandbox workload. Hosted mode is secondary and gated. Its worker is Docker-based (Q8).
- Driver: Phase 3 defines the `AgentOsDriver` port and the supervisor only. It has no concrete binding and no `@rivet-dev/agentos-core` dependency. The in-sandbox channel (OQ-P3-05) and the package check (OQ-P3-06) are blocked. Historical (superseded 2026-10-28): the driver is now bound from the configured digest-pinned image (`src/runtime/agentos-driver.ts`) and the runner runs in the sandbox as a managed `sandbox exec` child (`docs/integration/openshell.md`).
- Native binaries (Q5): still open (OQ-P3-07).
- Destroy route (Q2): still undocumented for hosted mode, so Phase 3 makes no hosted call.

## Spike result (closure, 2026-10-22)

Scope: a feasibility spike of `@rivet-dev/agentos-core` as the in-sandbox runner (S-11, library mode). The spike ran in `<spike-dir>`, outside this repository. That directory is not committed. The spike edited nothing under the repository and created no OpenShell sandbox, Podman container, or gateway. Host: Linux 6.8.0-147-generic x64, Node v24.18.0, Podman 4.9.3, OpenShell CLI 0.1.2. Full notes: `<spike-dir>/SPIKE.md` (not committed).

Docs read on 2026-10-22: https://rivet.dev/agentos/docs/ (introduction) and https://rivet.dev/agentos/docs/quickstart/ (Quickstart, Library).

### Package facts (verified)

| Fact | Value | Command or source |
| --- | --- | --- |
| Version | `0.4.3` (latest) | `npm view @rivet-dev/agentos-core version` |
| Licence | Apache-2.0 | `npm view @rivet-dev/agentos-core@0.4.3 license` |
| Declared `engines` | none on `agentos-core` | `npm view @rivet-dev/agentos-core@0.4.3 engines --json` returns no field |
| Runtime dependencies | `@rivet-dev/agentos-runtime-core` and `@rivet-dev/agentos-runtime-sidecar`, both 0.4.3, plus the other packages in `dependencies` | `npm view @rivet-dev/agentos-core@0.4.3 dependencies --json` |
| Sidecar wrapper | `@rivet-dev/agentos-runtime-sidecar@0.4.3`, `engines.node >=20` | `npm view @rivet-dev/agentos-runtime-sidecar@0.4.3 engines` (SPIKE.md section 1) |
| linux-x64 native package | `@rivet-dev/agentos-runtime-sidecar-linux-x64-gnu@0.4.3`, `os: linux`, `cpu: x64`, `libc: glibc`, Apache-2.0 | `npm view @rivet-dev/agentos-runtime-sidecar-linux-x64-gnu@0.4.3` (SPIKE.md section 1) |
| Sidecar binary | ELF 64-bit x86-64, dynamically linked, 143.6 MB installed | `ls -la` and `file` on `node_modules/@rivet-dev/agentos-runtime-sidecar-linux-x64-gnu/agentos-native-sidecar` (SPIKE.md sections 1 and 5) |
| Install footprint | 121 packages, `node_modules` 487 MB | `npm install --save-exact @rivet-dev/agentos-core@0.4.3` in `<spike-dir>` (SPIKE.md section 1) |
| Licence scan | No copyleft licence in the 121 `package.json` licence fields | Script over installed `package.json` files (SPIKE.md section 1) |

### Behaviour observed on this host

| Behaviour | Result | Evidence |
| --- | --- | --- |
| Create, exec, file write and read, dispose | Worked. The quickstart call `process.exec` with `output.capture: "all"` returned exit 0 and `hello`. | `smoke.out.json`, `probe.out.json` (SPIKE.md section 2) |
| `process.exec` with an object argument | Did not run as the task assumed. It returned exit 127. `process.exec` takes a command string. The object form is the `action` of `vm.cron.schedule`. | `probe.out.json` S1, `probe2.out.json` S1b (SPIKE.md section 2) |
| Outbound network | Denied by default: `EACCES ... blocked by network.http policy`. Allowed for `example.com` with a `network` allow rule. Other hosts were not tested. | `probe3.out.json` C1, C3, C4 |
| Loopback | Works, host-side and guest-side. | `probe3.out.json` C2 |
| Guest identity | `uid=1000(agentos)` | `probe.out.json` D identity |
| Reported resources | Guest `MemTotal` 131072 kB (128 MiB), one CPU, root filesystem 65536 1K blocks (64 MiB). These are the values the guest reports. Enforcement was not measured. | `probe.out.json` D memory, cpu, filesystem |
| Process registry | Capped at 1024. The next spawn fails. Killed processes stay listed. | `probe8-procs.mjs` terminal output (SPIKE.md section 3) |
| SQLite persistence | Write, dispose, reopen, and read worked. | `probe5-sqlite.mjs` (SPIKE.md section 2) |
| Cron | Schedule, list, and cancel worked. | `probe6-cron.mjs` (SPIKE.md section 2) |
| Payload, 4 MiB write and read | Worked. | `probe3.out.json` (SPIKE.md section 3) |
| Payload, 8 MiB write alone | Worked. | SPIKE.md section 3 (`probe4-case.mjs`) |
| Payload, 8 MiB read | Refused with `ERR_AGENTOS_TERMINAL_RESPONSE_LIMIT`. | SPIKE.md section 3 (`probe4-case.mjs`) |
| Payload, 16 MiB write | The sidecar process exits with `SidecarProcessExited`. The embedding Node process then exits 1 on an unhandled `Error: write EPIPE`. Reproduced twice. | `probe3.out.json`, `probe4.err.txt` (SPIKE.md section 3) |
| Guest binary format | `/opt/agentos/bin/cat` starts with `\0asm`, which is WebAssembly, not ELF. One binary was checked. | `probe2.out.json` B1 (SPIKE.md section 3) |
| Host channel | The library spawns the sidecar as a child process with four stdio pipes. The fourth, fd 3, is the control stream. It is not a socket or a port. | `dist/native-client.js` and `dist/process.js` in `@rivet-dev/agentos-runtime-core` (SPIKE.md section 4) |

Timings are single-run observations and are not benchmarks.

### Podman prerequisite

The OpenShell Podman driver requires Podman 5.x (`openshell.md` Q2). The host has Podman 4.9.3 (`podman --version`). The OpenShell Podman path was not run on this host.

### Unverified

1. OpenShell 0.1.2 `sandbox exec` as a transport: stdin, binary framing, close semantics, and exit codes were not run. The help text is the only evidence (OQ-P4-04, OQ-P4-05).
2. Whether the library runs its sidecar without the fd 3 control pipe, and what sets `globalThis._childProcessSpawnStart`.
3. Whether the sidecar and the Node runner start under OpenShell Landlock and seccomp as a non-root user.
4. The cause of the 16 MiB crash, whether `runtime.protocol.maxTerminalBytes` avoids it, and whether the host can catch `EPIPE`.
5. The read ceiling between 4 MiB (ok) and 8 MiB (refused), and the default of the configured knob.
6. Enforcement of memory, CPU, heap, CPU-time, and process limits.
7. Reaping: exited processes are not evicted from the registry, and `dispose()` after kill-and-reap was not tested.
8. The default outbound allowlist. Only `example.com` was tested.
9. `vm.software.install` and its digest check.
10. Node 20 and 22 on the host, and the arm64 sidecar package.
11. The licences of the Rust crates compiled into the sidecar binary.
12. Native ELF binary support (OQ-P3-07). Only one guest binary was checked, and it is WebAssembly.
13. Hosted mode was not evaluated.
14. Security. The spike did not review security. The Security Model states that agentOS is in beta and is undergoing security review.
15. The cause of the `EACCES` on loopback port 1.

### Recommendation

No-go for the in-sandbox runner as designed. Three blockers:

1. A 16 MiB write takes down the sidecar and the embedding process.
2. No verified control channel into an OpenShell sandbox. The OpenShell 0.1.2 help does not show that `sandbox exec` carries the library's pipe protocol. Live exec stays gated (OQ-P4-04, OQ-P4-05), and OQ-P3-05 stays blocked. Historical (superseded 2026-10-28): the pin is 0.1.5, and the runner runs as a `sandbox exec` child (`docs/integration/openshell.md`).
3. The host has Podman 4.9.3, below the 5.x the OpenShell Podman driver requires.

Revisit as go with conditions only if: (a) a live OpenShell 0.1.2 run on Podman 5.x shows the sidecar protocol survives `sandbox exec` or a relay, with exit codes; (b) the crash is avoided by configuration or fixed upstream, and the embedding process survives a sidecar exit; (c) the sidecar starts under the OpenShell Landlock and seccomp policy as a non-root user; (d) the guest gaps listed above are accepted for Realm's workloads. Historical (superseded 2026-10-28): the 0.1.2 pin no longer holds; the pin is 0.1.5.

Status: the recommendation is pending the user's decision on the AgentOS path after the spike. This section does not record that decision. No live run of the Realm runner has been made. Historical (superseded 2026-10-28): the "recommendation pending" status no longer holds; the AgentOS driver is bound and the runner runs in the sandbox (`docs/integration/openshell.md`).

