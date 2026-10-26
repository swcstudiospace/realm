# NVIDIA OpenShell: launch model, policy model and open conflicts

Gate note for FOUND-03 (decisions D-16, D-17, D-18). Blocks `src/runtime/openshell.ts` (Phase 3).

Read date: 2026-10-21 (ISO 8601).

## Official URLs read

- https://docs.nvidia.com/openshell/latest/llms.txt (documentation index for "Latest")
- https://docs.nvidia.com/openshell/latest/about/overview.md (overview and protection layers)
- https://docs.nvidia.com/openshell/latest/about/architecture.md (control plane, sandbox boundary, drivers)
- https://docs.nvidia.com/openshell/latest/about/installation.md (installation, Podman driver prerequisites)
- https://docs.nvidia.com/openshell/latest/how-it-works/gateways/overview.md (gateway runtimes and Podman driver)
- https://docs.nvidia.com/openshell/latest/how-it-works/policies/overview.md (sandbox policy sections and sources)
- https://docs.nvidia.com/openshell/latest/how-it-works/policies/schema.md (policy schema reference)
- https://docs.nvidia.com/openshell/latest/security/best-practices.md (security controls and defaults)
- https://docs.nvidia.com/openshell/latest/sdk/typescript.md (TypeScript SDK)

## Version caveat and conflict

The pages read show "Latest (v0.1.5)". The official pages do not state the host CLI version. An unverified check reported the host CLI as 0.1.2 from `openshell sandbox create --help`. That CLI was not run again in this phase, so the mismatch is recorded, not resolved. Phase 3 must pin one version and read the matching documentation index (`/v0.1.x/llms.txt`), which the pages list.

## Spec questions and sourced answers

### Q1. How OpenShell launches inside the container

Answer: OpenShell's own gateway launches each sandbox. It does not run inside a container that Realm creates.

From the Architecture page: "When you create a sandbox, its **compute driver** provisions a **workload** and a separate **supervisor**, establishes their protected channel, and builds the isolation boundary; the **supervisor** confirms that boundary before starting the **agent**."

The driver table on the same page gives the Podman row as: "Its own container | Authenticated Unix socket on a driver-owned volume | Workload container has networking turned off." From the Gateway overview: the Podman runtime runs "Rootless containers on the gateway host."

Not documented: launching OpenShell inside a container that an external tool (such as Realm) creates and owns. The spec's layer stack (Podman container, then OpenShell inside it, then AgentOS) does not match the documented model, in which the Podman driver creates the sandbox container itself. This is a conflict for Phase 3 to resolve (see the open questions).

### Q2. Podman driver prerequisites

From the Installation page, the requirements table: "Podman | Linux with Podman 5.x, cgroups v2, and an active Podman user socket." The Gateway overview adds a systemd user unit for Podman gateways: `systemctl --user status openshell-gateway`.

The host Podman is 4.9.3, which is below the documented 5.x minimum. The OpenShell Podman driver is therefore not supported on the current host, per the documentation. This is a Phase 3 blocker (also recorded in STATE.md).

### Q3. Policy model

From the Policy Schema reference:

- A policy is YAML of at most 4 MiB. "OpenShell rejects a policy that contains unknown fields or duplicate keys." `version: 1` is required.
- Top-level sections and when each takes effect:

| Section | Takes effect | Enforced by |
| --- | --- | --- |
| `filesystem_policy` | Startup | Landlock LSM in the kernel |
| `landlock` | Startup | Sandbox runtime |
| `process` | Startup | Docker and Podman, when they create the sandbox |
| `network_policies` | Live | Sandbox network proxy |
| `network_middlewares` | Live | Sandbox network proxy |

- `filesystem_policy`: `read_only` and `read_write` lists. Each path must be absolute, must not contain `..`, must be at most 4096 bytes, and "`read_write` cannot contain `/`." A policy can list at most 256 paths. Paths not listed are inaccessible.
- `landlock`: `compatibility` is `best_effort` (default) or `hard_requirement`. "In either mode, a sandbox requires a kernel with Landlock ABI v3 or later."
- `process`: `run_as_user` and `run_as_group` take `sandbox` or a numeric ID from 1 to 4294967294. "OpenShell rejects root."
- `network_policies`: a map of which binaries can reach which endpoints. Endpoint rules have `host`, `port`, optional `protocol` (`rest`, `mcp`, `tcp`), `access`, `rules` and `deny_rules`.

Source precedence when several policies exist: a global policy, then the sandbox's saved policy (where `--policy` at creation takes precedence over `OPENSHELL_SANDBOX_POLICY`), then a policy in the sandbox image, then the default policy.

### Q4. What OpenShell enforces

From the Architecture and Best Practices pages:

- Filesystem: Landlock LSM, locked at sandbox creation.
- Process: seccomp BPF and privilege drop (`setuid`/`setgid`), locked at sandbox creation.
- Network: CONNECT proxy and the OPA policy engine. Hot-reloadable at runtime.
- Credentials: provider credentials resolve "only at profile-authorized endpoints."

Deny-by-default egress: "All egress denied. Only endpoints listed in `network_policies` can receive traffic." The proxy resolves DNS after policy allows the connection and "rejects undeclared internal destinations." Loopback, link-local and unspecified addresses are "always blocked regardless of `allowed_ips`."

Static controls: "OpenShell locks static controls at sandbox creation and requires destroying and recreating the sandbox to change them." Dynamic controls change with `openshell policy update` or `openshell policy set`.

The spec's open question on DNS and egress enforcement (spec n5 item 4) is answered by this: the proxy enforces egress by policy, and DNS is resolved by the supervisor.

### Q5. Applying a policy at creation

From the Policy Overview: "`--policy` takes precedence over `OPENSHELL_SANDBOX_POLICY`." The Best Practices page says: "Apply statically at creation (`--policy`) or dynamically (`openshell policy update` for incremental changes, `openshell policy set` for full replacement)." The `--policy` flag is documented on the policy pages. The other `sandbox create` flags (`--name`, `--no-auto-providers`, the `--` argv form) are not documented in the pages read, so they are not confirmed here.

### Q6. Gateway and CLI surface

From the Installation and Gateway pages: `openshell status`, `openshell gateway add <url> --local --name <name>`, `openshell gateway list`, `openshell gateway info`, `openshell gateway remove <name>`, and `openshell sandbox create`. `openshell-gateway config preflight --path <file>` checks a gateway config. The page references schema version 2 for the gateway config. The TOML table name is not confirmed in the pages read.

### Q7. TypeScript SDK

From the TypeScript SDK page:

- Package: `@nvidia/openshell-sdk`. It "requires Node.js 20.3 or later." It is "currently distributed through GitHub Packages." The install configures the `@nvidia` scope in the project `.npmrc` to `https://npm.pkg.github.com` and authenticates with a GitHub token. No token is recorded in this note.
- Connect: `OpenShellClient.connect({ gateway, oidcToken })`, with `client.health()` to verify connectivity.
- Sandbox: `client.sandbox.create`, `waitReady`, `exec`, `delete`, `waitDeleted`, and `watchLogs`.

The package name was confirmed against this page.

### Q8. Sandbox identity and credentials

From the Architecture page: "The sandbox holds only the gateway's public key, so it can verify the token but can never create one." The agent "holds nothing worth stealing: no gateway signing key, no gateway JWT, and no provider credentials." "If the **supervisor** disconnects, the **sandbox** freezes the agent."

### Q9. Network isolation of the workload container

Documented for the Podman driver: "Workload container has networking turned off." Egress is then only through the supervisor's protected channel, as described in Q4.

### Q10. Image pinning

Not documented in the pages read. Pinning runtime images by digest is not confirmed for OpenShell images: no page read confirms or refutes that practice. The Security page links an SBOM verification guide for published images, which was not fetched.

## Answers not in the docs (D-18 default)

- Launch inside an external container: not documented (see Q1).
- Image digest pinning: not documented (see Q10).
- Sandbox image format for Realm: not documented in the pages read.

## Open questions for Phase 3

1. Launch model. The documented Podman driver creates its own sandbox container. The spec requires OpenShell inside a Realm-owned Podman container. Choose one, or record the spec as needing an update. Do not assume nested launch.
2. Podman version. The Podman driver needs Podman 5.x, and the host has 4.9.3. D-05 forbids changing the host in Phase 1. Phase 3 must decide whether to upgrade, use a different driver, or defer.
3. OpenShell version. Pin one release (the docs show v0.1.5; the unverified host CLI check reported 0.1.2) and read the matching index.
4. The gateway TOML table and the `sandbox create` flags beyond `--policy` are not on the pages read. Confirm them from the pinned version before use.

## Module blocked

`src/runtime/openshell.ts`, until the launch model (Q1) and the Podman version (Q2) are decided.

## Phase 3 resolution

Recorded in `docs/integration/runtime-decision.md` (S-08, S-10, OQ-P3-01 to OQ-P3-04, OQ-P3-12, OQ-P3-15, OQ-P3-16). Summary:

- Launch (Q1): the gateway runs on the host, and the Podman driver creates the sandbox container. The RT-01 and RT-03 wording conflicts are recorded in the runtime note (D-46, D-47) and not edited.
- Podman (Q2): host 4.9.3 is below 5.x, so the Podman driver path is live-gated.
- Version (caveat): pinned to 0.1.5 (S-10). The host CLI is 0.1.5, and its `sandbox create --help` lists every pinned flag. The earlier drift (OQ-P3-12, a 0.1.2 pin against 0.1.5 docs) is resolved by the upgrade.
- Policy (Q3): written as JSON (D-57, OQ-P3-15). No network endpoint is written (OQ-P3-16).

## Production gateway profile (phase 9.1)

- `src/runtime/gateway-config.ts` renders the realm gateway TOML. The output always has `[openshell.gateway.tls]` and `[openshell.gateway.gateway_jwt]`, never `disable_tls`, and it refuses relative paths and any path that would need TOML escaping.
- The gateway's TLS and JWT material comes from `openshell-gateway generate-certs --output-dir <pki dir>`. The layout is the one `realmGatewayPkiPaths` returns: `ca.crt`, `server/tls.{crt,key}`, `client/tls.{crt,key}`, and `jwt/{signing.pem,public.pem,kid}`. The pki directory is mode 0700, and the key files are mode 0600.
- Local mode also copies client material to `$XDG_CONFIG_HOME/openshell/gateways/openshell/mtls/`. Run the command with `XDG_CONFIG_HOME` set to a directory the realm owns, so the material never reaches another account's configuration. Remove that copy afterwards.
- The realm account's rootless API runs as a user unit with `RuntimeDirectory=podman`, `Delegate=yes`, and `DelegateSubgroup=supervised`. Linger keeps it running after logout. The runtime is `runc`, set in the account's container configuration. The plan is `.planning/phases/09.1-host-prerequisites-gateway/09.1-01-PLAN.md`.
- The realm gateway does not run yet. Its compute driver is built in phase 9.4 (`.planning/phases/09-live-omp-verification/09-PRODUCTION-BUILD-DECISIONS.md`, PD-02 and PD-05).

## Compute driver RPC table (phase 9.4)

The realm compute driver implements `openshell.compute.v1.ComputeDriver` from the vendored protos in
`src/runtime/driver/proto/` (revision `c4688aa`, OpenShell 0.1.5; see `PROVENANCE.md`). The driver is its own process
(`src/runtime/driver/main.ts`) and listens on a unix socket in a 0700 directory, with the socket at 0600.

| RPC | Driver behaviour | Refusal or status |
| --- | --- | --- |
| `GetCapabilities` | Reports the driver name, the default image, the portable CPU and memory limits, the `openshell.compute.contract` and `openshell.compute.launch-authentication` capabilities, and the pinned admission acknowledgement (`DRIVER_ADMISSION_ACKNOWLEDGEMENT`). A create carries no isolation backend selection, because the built-in runtime path needs none. | A gateway that requires an unknown capability: `INVALID_ARGUMENT`. |
| `AuthenticateSandbox` | Not offered. The driver does not advertise sandbox authentication. Moves to phase 9.5. | `UNIMPLEMENTED` |
| `ValidateSandboxCreate` | Runs the create checks below. No libpod call. | `INVALID_ARGUMENT` on any refusal. |
| `CreateSandbox` | Runs the create checks, stores the launch material, prepares the channel (a TLS identity for the runtime, and the runtime's bootstrap, descriptor and auth bundle, checked to agree before any libpod call), then `DriverLifecycle.create`, which writes the bootstrap, descriptor and auth bundle before the container starts. After the container is verified it starts the sandbox runtime inside it (a detached exec of `/usr/local/lib/realm/openshell-sandbox --bootstrap`), waits for the runtime's control socket, and starts the host supervisor. Records the gateway's sandbox id, workspace and container name, under the gateway's name. | `INVALID_ARGUMENT` on refusal, including a state directory already present for the name; `ALREADY_EXISTS` when a container of the name exists and its state directory does not. |
| `GetSandbox` | Reads the labelled container and the registry entry, reporting the gateway's name. | `NOT_FOUND` when the driver does not hold the sandbox. |
| `ListSandboxes` | Lists, under the gateway's name, the sandboxes that have a registry entry and a labelled container. | none |
| `WatchSandboxes` | Sends every sandbox on connect, then each change, and each removal as a deleted event. Polls until the client cancels. | none |
| `StopSandbox` | Refused. Reads and changes no state (PD-08). | `FAILED_PRECONDITION` |
| `StartSandbox` | Refused. Reads and changes no state (PD-08). | `FAILED_PRECONDITION` |
| `DeleteSandbox` | Stops the host supervisor first (SIGTERM, then SIGKILL after a bounded wait), then runs `DriverLifecycle.delete`, then clears the registry. Idempotent. A name whose container another registered sandbox holds deletes nothing. | `deleted` is false for a sandbox that is already gone. |
| `EnsureWorkspace` | Creates `<workspaceRoot>/<workspace>` at 0700 when missing. Refuses a symbolic link or a path that resolves outside the root. | `INVALID_ARGUMENT` on refusal. |
| `DeleteWorkspace` | Removes an empty workspace directory. A workspace that still holds files is left in place. | `FAILED_PRECONDITION` when files remain. |

The create checks refuse, before any libpod call, a request whose image is not the configured digest, whose CPU or memory
request or limit differs from the realm profile (2 CPUs, 1 GiB), that asks for a GPU, that carries a non-empty platform or
driver config, a user-namespace request, an isolation backend selection of any kind (the built-in path carries none), or an environment,
or whose argv holds an empty string.
An empty argv is accepted: the sandbox is created idle, and the command is not forwarded before phase 9.5.

CreateSandbox requires the gateway's launch authentication (`launch_authentication`) and refuses a create without it before any write. ValidateSandboxCreate accepts a create without it and checks any launch authentication that is present with the same rules. The driver decodes it with the gateway's
own rules (`src/runtime/driver/isolation/launch.ts`): one JSON document, with no byte order mark, no duplicate object key, no
lone surrogate escape, integers written as integers within the gateway's Rust ranges (a negative zero is not an integer), and
whitespace as Rust defines it.

Refusals are logged. Each refusal of the create checks and of the launch material writes one line to stderr:
`realm compute driver refused: rpc=<RPC> check=<check> code=SCHEMA_INVALID`. The RPC is `ValidateSandboxCreate` or `CreateSandbox`. The check
names the rule that refused, such as `create.image` or `launch.gateway_id`; the full list is `REFUSAL_CHECKS` in
`src/runtime/driver/refusal.ts`. A line never carries a value, a path, a key or a token. The directory checks that a create
runs before the lifecycle (the state directory and the secret directory must not exist, and the workspace must be a
directory) refuse with `SCHEMA_INVALID` and write no line yet.

Sandbox names. The gateway's name is used as given, and the container runs under the `realm-` prefixed name. A name that
already starts with `realm-` is unchanged. Any other name gets the prefix, and the prefixed name must pass the
container-name pattern and length rule (at most 128 characters). A name that fails is refused with `SCHEMA_INVALID`. The
container name, the state directory name and the sandbox-name label carry the prefixed name. The driver's registry maps
the gateway's name to it, so `GetSandbox`, `ListSandboxes`, `WatchSandboxes` and `DeleteSandbox` take and report the
gateway's name. Two names that give one container name, such as `x` and `realm-x`, cannot both be sandboxes: the second
create is refused, because the first sandbox's state directory exists.

Directories. A create prepares directories before the lifecycle runs. The workspace is created at 0700 if it is
absent, by the rule `EnsureWorkspace` uses. The state directory is created at 0700 under the state root, and it must not
already exist. The create also makes the sandbox's secret directory `<secretRoot>/<container name>` at 0700. It holds
`launch.json`, the channel directory (0700, with `bootstrap.json`, `server.crt`, `server.key` and `control.sock`),
`descriptor.json` and `auth.json` (all 0600), and the supervisor's exit-marker path. If the create refuses after any of
these exist, the state directory and the secret entries this call made are removed. The workspace is left in place.
The state root and the workspace root are set in the driver's environment for the realm account. The rendered gateway
configuration does not set them.

### Built-in runtime (phase 9.5)

- The driver serves the compute socket only.
- The three required variables are `REALM_DRIVER_GATEWAY_CA` (absolute readable PEM file), `REALM_DRIVER_SUPERVISOR_BINARY` (absolute executable file) and `REALM_DRIVER_GATEWAY_ENDPOINT` (https URL). The driver refuses to start with `SCHEMA_INVALID` when one is missing or invalid, and echoes no value.
- The sandbox image must contain `/usr/local/lib/realm/openshell-sandbox`.
- The runtime's user namespace maps the realm account to uid and gid 1001 (`podman` keep-id, `uid=1001,gid=1001`). This is not yet verified on a live host.
- The rendered gateway configuration selects `isolation_backend = "openshell-sandbox"` in the `[openshell.drivers.<name>]` table and writes no `[[openshell.supervisor.isolation_backends]]` section.

### PD-08 (stop and start)

PD-08 default applied: `StopSandbox` and `StartSandbox` refuse with the gateway's precondition status
(`FAILED_PRECONDITION`) and change no sandbox state. The call-site evidence below shows the gateway does not reach them
in phase 9.4, so their live observation moves to phase 9.5.

### Observed call sites (phase 9.4, live)

Captured live on 2026-10-25 through the realm gateway, with debug spans on. One line per RPC, with the flow that caused it:

- At startup: `GetCapabilities` (driver.initialize), `WatchSandboxes`, `ListSandboxes` (reconcile).
- Create: `ValidateSandboxCreate`, then `CreateSandbox`. A refused create runs no `CreateSandbox`.
- Get: `GetSandbox`, polled while the sandbox is Provisioning.
- List: `ListSandboxes`.
- Delete: `DeleteSandbox`.
- Not reached: `StopSandbox` and `StartSandbox`. The gateway refuses them in the Provisioning phase before calling the driver. They move to phase 9.5.
- Not observed: `EnsureWorkspace` (the gateway calls it only for provider credentials), `DeleteWorkspace`, `AuthenticateSandbox`. `AuthenticateSandbox` returns `UNIMPLEMENTED` and is not advertised; it moves to phase 9.5.

### Phase 9.4 limit

Phase 9.4 closes on its code and on the live checks it can reach. A sandbox stays Provisioning (ConfigurationPending) until
the phase 9.5 supervisor reports its effective configuration. The PD-08 stop and start observation, and
`AuthenticateSandbox`, move to phase 9.5 with it.
