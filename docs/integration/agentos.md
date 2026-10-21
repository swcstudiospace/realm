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
