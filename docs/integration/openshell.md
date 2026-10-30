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
- Device files in the realm policy: `/dev/null` is the one writable device, listed under `read_write`, because a denied write to it broke shell redirects such as `> /dev/null`. `/dev/urandom`, `/dev/zero` and `/dev/random` are listed under `read_only`, because reads of `/dev/zero` and `/dev/random` were denied. No other device and no `/dev` directory entry is granted.
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
- The realm account's rootless API runs as a user unit with `RuntimeDirectory=podman`, `Delegate=yes`, and `DelegateSubgroup=supervised`. Linger keeps it running after logout. The runtime is `runc`, set in the account's container configuration. The plan is `.planning/milestones/v2.0-phases/09.1-host-prerequisites-gateway/09.1-01-PLAN.md`.
- The realm gateway and its compute driver run as user units of the realm account (`realm-openshell-gateway` and `realm-compute-driver`; host changes HC-05 and HC-04), under the production TLS and JWT profile, and the production live suite drives that stack. The compute driver was built in phase 9.4 (`.planning/milestones/v2.0-phases/09-live-omp-verification/09-PRODUCTION-BUILD-DECISIONS.md`, PD-02 and PD-05).

## Compute driver RPC table (phase 9.4)

The realm compute driver implements `openshell.compute.v1.ComputeDriver` from the vendored protos in
`src/runtime/driver/proto/` (revision `c4688aa`, OpenShell 0.1.5; see `PROVENANCE.md`). The driver is its own process
(`src/runtime/driver/main.ts`) and listens on a unix socket in a 0700 directory, with the socket at 0600.

Startup order. The driver claims its socket first: when a live listener answers on the path, the new driver refuses with `LOCK_CONFLICT` and removes nothing; only a stale socket is removed. It then runs the startup sweep (every realm container and every sandbox's secret entries left by a previous generation) while the socket already accepts connections. Until the sweep has resolved, the lifecycle `create`, `delete` and `stop` and the compute driver's `CreateSandbox` refuse with `REALM_NOT_ACTIVE`, and the other RPCs only read or answer. A failed sweep closes the server and removes the socket.

| RPC | Driver behaviour | Refusal or status |
| --- | --- | --- |
| `GetCapabilities` | Reports the driver name, the default image, the portable CPU and memory limits, the `openshell.compute.contract` and `openshell.compute.launch-authentication` capabilities, and the pinned admission acknowledgement (`DRIVER_ADMISSION_ACKNOWLEDGEMENT`). A create carries no isolation backend selection, because the built-in runtime path needs none. | A gateway that requires an unknown capability: `INVALID_ARGUMENT`. |
| `AuthenticateSandbox` | Not offered. The driver does not advertise the capability (`SUPPORTED_CAPABILITIES` in `src/runtime/driver/compute-driver.ts` holds only `openshell.compute.contract` and `openshell.compute.launch-authentication`), and the handler for the RPC rejects with `UNIMPLEMENTED` ("sandbox authentication is not offered"). On the built-in runtime path the gateway does not call it: the isolation backend and the sandbox protocol are the upstream runtime's (owner decision, 2026-10-26), and the live capture below did not observe the call. | `UNIMPLEMENTED` |
| `ValidateSandboxCreate` | Runs the create checks below. No libpod call. | `INVALID_ARGUMENT` on any refusal. |
| `CreateSandbox` | Runs the create checks, stores the launch material, prepares the channel (a TLS identity for the runtime, and the runtime's bootstrap, descriptor and auth bundle, checked to agree before any libpod call), then `DriverLifecycle.create`. The create writes the bootstrap, descriptor and auth bundle, and checks the CA tmpfs and channel mount options, before the container starts. The sandbox runtime is the container's main process, `/usr/local/lib/realm/openshell-sandbox --bootstrap /run/openshell/channel/bootstrap.json`; there is no podman exec route (the libpod client has none). The realm starts its AgentOS runner as a managed `openshell sandbox exec` child after the create, through the OpenShell exec path: gateway to supervisor to runtime. After the container is verified, the driver waits until a TLS handshake with the runtime's listener completes on its control socket (trusting the CA certificate, under the leaf's server name), removes the runtime's `server.key`, and starts the host supervisor. The CA private key is removed once the leaf certificate is issued, and the CA certificate stays in the descriptor as its trust anchor. A supervisor that exits before the sandbox is Ready refuses the create. One that exits later stops the container and reports the sandbox not Ready, with reason `supervisor-exited`. Records the gateway's sandbox id, workspace and container name, under the gateway's name. | `INVALID_ARGUMENT` on refusal, including a state directory already present for the name, and a control socket path longer than 107 bytes; `ALREADY_EXISTS` when a container of the name exists and its state directory does not. |
| `GetSandbox` | Reads the labelled container and the registry entry, reporting the gateway's name. | `NOT_FOUND` when the driver does not hold the sandbox. |
| `ListSandboxes` | Lists, under the gateway's name, the sandboxes that have a registry entry and a labelled container. | none |
| `WatchSandboxes` | Sends every sandbox on connect, then each change, and each removal as a deleted event. Polls until the client cancels. | none |
| `StopSandbox` | Refused. Reads and changes no state (PD-08). | `FAILED_PRECONDITION` |
| `StartSandbox` | Refused. Reads and changes no state (PD-08). | `FAILED_PRECONDITION` |
| `DeleteSandbox` | Stops the host supervisor first (SIGTERM, then SIGKILL after a bounded wait), then runs `DriverLifecycle.delete`, then clears the registry. Idempotent. A name whose container another registered sandbox holds deletes nothing. | `deleted` is false for a sandbox that is already gone. |
| `EnsureWorkspace` | Checks the id and the pinned workspace root (`workspaceRoot` in `config.json`). Creates nothing. Refuses a root that is missing, a symbolic link, not a directory, relative, or not owned by the driver's account. | `INVALID_ARGUMENT` on refusal. |
| `DeleteWorkspace` | Always refused. After it checks the workspace id, the driver refuses with the transition code, because the driver never creates or removes the pinned workspace root (owner decision, 2026-10-27; `EnsureWorkspace` creates nothing either). Nothing is read or changed. | `FAILED_PRECONDITION`; `INVALID_ARGUMENT` for a malformed workspace id |

The `AuthenticateSandbox` and `DeleteWorkspace` rows follow from those two owner decisions (2026-10-26 and 2026-10-27). They are open for the owner to confirm.

The create checks refuse, before any libpod call, a request whose image is not the configured digest, whose CPU or memory
request or limit differs from the realm profile (2 CPUs, 1 GiB), that asks for a GPU, that carries a non-empty platform or
driver config, a user-namespace request, an isolation backend selection of any kind (the built-in path carries none), or an environment,
or whose argv holds an empty string.
The sandbox runtime is PID 1 whatever the argv: `spec.command` is checked for empty arguments and is not forwarded, as at HEAD.

CreateSandbox requires the gateway's launch authentication (`launch_authentication`) and refuses a create without it before any write. ValidateSandboxCreate accepts a create without it and checks any launch authentication that is present with the same rules. The driver decodes it with the gateway's
own rules (`src/runtime/driver/isolation/launch.ts`): one JSON document, with no byte order mark, no duplicate object key, no
lone surrogate escape, integers written as integers within the gateway's Rust ranges (a negative zero is not an integer), and
whitespace as Rust defines it.

Refusals are logged. Each refusal of the create checks and of the launch material writes one line to stderr:
`realm compute driver refused: rpc=<RPC> check=<check> code=<code>`. The RPC is `ValidateSandboxCreate` or `CreateSandbox`. The code is
`SCHEMA_INVALID` unless a state precondition names its own code, as `create.pinned_root_held` does with `REALM_INVALID_TRANSITION`. The check
names the rule that refused, such as `create.image` or `launch.gateway_id`; the full list is `REFUSAL_CHECKS` in
`src/runtime/driver/refusal.ts`. A line never carries a value, a path, a key or a token. `create.pinned_root_held` refuses a create while a
container of this driver is live on the pinned root: any readable state other than configured, created, exited or stopped counts, so stopping and removing hold too. The containers are read from the runtime under the driver's own
label, so a restarted driver refuses too. If the state or the mounts of a container cannot be read, the create is refused under the same
check with `SCHEMA_INVALID`, and the error of a catalogue code the lookup raised is passed on unchanged. The directory checks that a create runs
before the lifecycle write one line when they refuse with `SCHEMA_INVALID`, named by their check: `create.state_dir` (the state
directory must not exist), `create.secret_dir` (the secret directory must not exist) and `create.workspace` (the pinned workspace root must
be a real directory the driver owns). Any other error from these checks writes no line.

Stale directories. A state directory or secret directory that exists is an orphan when its sandbox's container is gone, and a create reclaims it instead of refusing it. This is the crash recovery case (live, 2026-10-28): the realm daemon is killed with SIGKILL, so the driver never ran its delete path, the startup sweep removes the leftover container, and the next create for the same name arrives while the crashed sandbox's directories are still on disk. The gateway calls CreateSandbox only for a name it holds no live sandbox for, and the pinned root allows one live sandbox, so a directory with no container behind it belongs to a sandbox that no longer exists. The check is cheap and runs first: if neither directory exists, the create makes no extra libpod call. If one does, the driver reclaims only when all three conditions hold: (1) libpod has no container of that name, where an inspect that fails counts as not proven gone; (2) the driver tracks no live container for the name, so the name is not in its set of containers it could not confirm removed, and no sandbox registered under another gateway name holds the container name; and (3) the driver holds no running supervisor for the name other than a stale handle, which condition 1 makes the handle of a dead sandbox, and which the driver stops and drops together with its registry entry. A create already in flight is excluded by the pinned-root reservation. The cleanup is the delete path of DeleteSandbox (the supervisor stop, the lifecycle delete of the state directory and the secret entries, and the registry entry), preceded by the check a create applies to a state directory, so a stale directory that holds a socket or a secret-named entry open to group or world is refused with `SCHEMA_INVALID`, as a symbolic link or an entry of the wrong kind in either directory is. A failure of the cleanup refuses the create with the catalogue code of the failing step, such as `CLEANUP_FAILED`, and writes one line under `create.state_dir` or `create.secret_dir` when the code is `SCHEMA_INVALID`; the line names no path. If any condition fails, the create is refused as before, under the same check, and nothing is removed. Then the create continues, and the absence checks pass.

Sandbox names. The gateway's name is used as given, and the container runs under the `realm-` prefixed name. A name that
already starts with `realm-` is unchanged. Any other name gets the prefix, and the prefixed name must pass the
container-name pattern and length rule (at most 128 characters). A name that fails is refused with `SCHEMA_INVALID`. The
container name, the state directory name and the sandbox-name label carry the prefixed name. The driver's registry maps
the gateway's name to it, so `GetSandbox`, `ListSandboxes`, `WatchSandboxes` and `DeleteSandbox` take and report the
gateway's name. Two names that give one container name, such as `x` and `realm-x`, cannot both be sandboxes: the second
create is refused, because the first sandbox's state directory exists.

Directories. A create prepares directories before the lifecycle runs. The workspace is the pinned root from `config.json` (`workspaceRoot`): the sandbox's `/workspace` is that root, bound read-write, and nothing is created under it. The state directory is created at 0700 under the state root, and it must not
already exist. The create also makes the sandbox's secret directory `<secretRoot>/<container name>` at 0700. It holds
`launch.json`, the channel directory (0700, with `bootstrap.json`, `server.crt`, `server.key` and `control.sock`),
`descriptor.json` and `auth.json` (all 0600), and the supervisor's exit-marker path. The driver removes `server.key` from the channel
directory once a TLS handshake with the runtime's listener completes, and removes the CA private key from the TLS work directory once
the leaf certificate is issued; the CA certificate stays in the descriptor as its trust anchor. If the create refuses after any of
these exist, the state directory and the secret entries this call made are removed. The workspace is left in place.
The state, secret and workspace roots come from `config.json` (`sandboxStateRoot`, `secretRoot`, `workspaceRoot`; omitted secret and sandbox-state roots are `<stateDir>/secrets` and `<stateDir>/sandboxes`). The daemon and the driver read that file. A stale `REALM_DRIVER_SECRET_ROOT`, `REALM_DRIVER_WORKSPACE_ROOT` or `REALM_DRIVER_STATE_ROOT` variable is ignored. The rendered gateway configuration does not set them.

Workspace root must equal the approved workspace. The sandbox mounts the pinned root at `/workspace`, while the file tools work in the workspace the policy approved. A session create (`src/runtime/session-execution.ts`) therefore refuses with `POLICY_DENIED`, before any libpod, OpenShell or policy-file call, unless `config.json` `workspaceRoot` and the policy-approved workspace are the same directory once both are resolved with `realpath`. A symbolic link to the same directory is the same directory. An operator who pinned a parent directory must pin the project directory instead; otherwise the sandbox could reach sibling projects the policy never approved.

The sandbox binding is one derivation, `sandboxBindingOf` (`src/runtime/driver/sandbox-binding.ts`). For a sandbox name it gives the workspace (the pinned root, mounted read-write at `/workspace`), the state directory `<state root>/<container name>` (mounted read-only at `/realm-state`), and the channel directory `<secret root>/<container name>/channel` (mounted read-write at `/run/openshell/channel`). The driver builds its create from it and verifies the container against it. The session's verifier takes the same binding. The state root and the workspace are the values `runtimeRootsOf` derived from `config.json`, not the root named in the create request. The sandbox state root is the directory the driver mounts per-sandbox state from (sandboxes live beneath it as `<root>/<name>`), not the realm state directory. The daemon and the driver read the same config file. A stale `REALM_DRIVER_STATE_ROOT`, `REALM_DRIVER_SECRET_ROOT` or `REALM_DRIVER_WORKSPACE_ROOT` variable is ignored. The session refuses a create when any derived root is missing or relative.

### Built-in runtime (phase 9.5)

- The driver serves the compute socket only.
- The three required variables are `REALM_DRIVER_GATEWAY_CA` (absolute readable PEM file), `REALM_DRIVER_SUPERVISOR_BINARY` (absolute executable file) and `REALM_DRIVER_GATEWAY_ENDPOINT` (https URL). The driver refuses to start with `SCHEMA_INVALID` when one is missing or invalid, and echoes no value.
- The sandbox image must contain `/usr/local/lib/realm/openshell-sandbox`.
- The runtime's user namespace maps the realm account to uid and gid 1001 (`podman` keep-id, `uid=1001,gid=1001`). Verified live (2026-10-28, scenario 1 of the production live suite): the workload's real, effective, saved and filesystem uid are all 1001.
- The rendered gateway configuration selects `isolation_backend = "openshell-sandbox"` in the `[openshell.drivers.<name>]` table and writes no `[[openshell.supervisor.isolation_backends]]` section.

### Host supervisor pin and doctor items (phase 9.7)

- `REALM_DRIVER_SUPERVISOR_SHA256` is optional: the lowercase hex sha256 of the host supervisor binary. When it is set, the driver refuses to start with `SCHEMA_INVALID` if the file's digest differs, and it re-hashes the file immediately before each supervisor spawn. The refusal names neither the digest nor the path. When it is unset, no digest check runs.
- What the pin covers. The digest is computed from the file at its path at config load and again immediately before the spawn. The file is then spawned by path, so a swap between the hash and the exec is not detected. The pin protects against drift and accidental or out-of-band replacement of the binary. It does not protect against a writer with the same uid: the supervisor file is owned by the realm account, and the sandbox runs as that uid.
- Two doctor items are appended after `agentos`. `host-binaries` reports `name version sha-prefix` for the supervisor, the `openshell` CLI, `openshell-gateway` and `podman`, and warns (never fails) on a missing binary or on a version, digest or path that differs from a recorded pin. Pins come from `REALM_HOST_PIN_<NAME>_SHA256`, `_VERSION` and `_PATH` in the doctor's environment; the names are `SUPERVISOR`, `OPENSHELL`, `OPENSHELL_GATEWAY` and `PODMAN`. A digest pin is valid only when it is exactly 64 lowercase hex characters, the form the driver accepts. The doctor does not lowercase a pin, and a pin in any other form makes `host-binaries` warn with the fix "a pin must be 64 lowercase hex characters" (an upper-case pin used to give a clean doctor and a driver that refuses to start). The digest of each binary has its own bound of 30 seconds (`hashTimeoutMs`), separate from the 5 second probe bound, because a cold read of the 106 MB gateway binary on a busy host once outlasted 5 seconds and made the item warn; a warm read passed. `kernel-hardening` warns when `kernel.yama.ptrace_scope` is 0 or unreadable (fix: set it to 1 or higher) and passes at 1 or more.
- One variable pins both. `REALM_DRIVER_SUPERVISOR_SHA256` is read by the driver and by the doctor. `REALM_HOST_PIN_SUPERVISOR_SHA256` overrides it for the doctor only. The doctor reads `REALM_DRIVER_SUPERVISOR_BINARY` from its own environment, so the supervisor line warns "not configured" where that variable is not set.
- `host-binaries` warns (never fails) when the supervisor is found but has no digest pin, with the fix "set REALM_DRIVER_SUPERVISOR_SHA256 to the sha256 shown above". The other three binaries still pass without a pin. The doctor has eleven items.
- Live run on the production stack (Podman 5.7.1, 2026-10-28). With no daemon, `realm doctor` ran its 11 local checks and exited 0. With a daemon answering, every check passed except `anda-bridge`, which warned because no engine URL is configured (expected), and `host-binaries`, which warned only because the daemon's environment carried no `REALM_DRIVER_SUPERVISOR_BINARY`, so the supervisor could not be located: with a daemon answering, the check reads the path from the environment of the process that answers. With the path and the pin in that environment, `host-binaries` passed and printed `supervisor 0.1.5 1b97e115b63b`, `openshell 0.1.5 446f766842d2`, `openshell-gateway 0.1.5 c8fa78fd49f2` and `podman 5.7.1 190c130ac5e3` (digest prefixes of 12 characters). `kernel-hardening` reported yama `ptrace_scope` 1.
- The pin is opt-in. Making it mandatory in production is an owner decision. The supervisor pin test reaches the forwarding code through the exported `runtimeHostOf` seam, not through a live create.
- The measured binaries and the procedure to record a pin are in `docs/integration/host-binaries.md`.

### Shutdown (phase 9.7)

- On SIGTERM or SIGINT the driver stops accepting new calls, lets open calls finish for up to 3 seconds (`SHUTDOWN_GRACE_MS` in `src/runtime/driver/server.ts`), cancels the calls that are still open, and removes its socket. The cancel is needed because the gateway's long-lived watch stream (`WatchSandboxes`) never ends by itself, so waiting for the open calls alone never finishes.
- Measured live (2026-10-28): before this change `systemctl restart` of the driver waited the full 90 second stop timeout and systemd then killed the driver. A normal restart now takes about 3.4 seconds.
- What a stop leaves behind: sandbox containers and their secret entries stay until the next driver start, whose startup sweep removes every realm container and every sandbox's secret entries. The host supervisors end when the driver's stdin pipes close. A create that was cancelled by the forced shutdown may still be finishing when the process exits; the next sweep removes whatever it left. This behaviour did not change; it was unwritten. A second signal during the grace falls to the default action, which ends the process without removing the socket, and the next start clears the stale socket.

### SSH socket (phase 9.6)

- The host supervisor's SSH socket is `ssh/ssh.sock` in the sandbox's secret directory. The supervisor creates the `ssh/` directory at 0700 and the socket at 0600. The driver passes the path as `--ssh-socket-path` and sets no environment variable for it.
- The socket sits outside every container mount. The secret directory is never bind-mounted. The channel mount holds only the runtime's bootstrap, certificate, key and control socket, and the `/run` and CA tmpfs mounts are separate. The socket is never under the channel directory or a tmpfs.
- A unix socket path holds at most 107 bytes. The driver checks the SSH socket path with the control socket path at create and refuses a sandbox name that makes either one longer, with `SCHEMA_INVALID`. Nothing is truncated.
- The driver does not set `OPENSHELL_SSH_SOCKET_SHARED`, which widens the socket to 0660. Shared mode is not used because the socket stays private to the host supervisor's user.
- The supervisor refuses to start with an SSH socket path and no SSH host key. The driver checks the key before it spawns the supervisor and refuses with `SCHEMA_INVALID`, naming no key material.
- `openshell sandbox exec` depends on this socket. Without it the exec fails with "SSH access is not configured for this supervisor".

### PD-08 (stop and start)

PD-08 default applied: `StopSandbox` and `StartSandbox` refuse with the gateway's precondition status
(`FAILED_PRECONDITION`) and change no sandbox state. The unit test covers the refusal.

Live state on the built-in path (phase 9.5 live run): the gateway refused a stop on a Ready sandbox in its own state table, and it accepted a start on a Ready sandbox as a no-op. In neither case did it call the driver, so the driver's refusal was not reached live. A restart after a failure would reach `StartSandbox`, which the driver refuses under PD-08. What the realm should do about that is an open owner decision: until it is made, a sandbox restarted by the gateway after a failure is refused by the driver.

### Observed call sites (phase 9.4, live)

Captured live on 2026-10-25 through the realm gateway, with debug spans on. One line per RPC, with the flow that caused it:

- At startup: `GetCapabilities` (driver.initialize), `WatchSandboxes`, `ListSandboxes` (reconcile).
- Create: `ValidateSandboxCreate`, then `CreateSandbox`. A refused create runs no `CreateSandbox`.
- Get: `GetSandbox`, polled while the sandbox is Provisioning.
- List: `ListSandboxes`.
- Delete: `DeleteSandbox`.
- Not reached (historical, 2026-10-25 capture, Provisioning phase): `StopSandbox` and `StartSandbox`. The gateway refused them in the Provisioning phase before calling the driver. The later state on the built-in path is under PD-08 above.
- Not observed: `EnsureWorkspace` (the gateway calls it only for provider credentials), `DeleteWorkspace`, `AuthenticateSandbox`. `AuthenticateSandbox` returns `UNIMPLEMENTED` and is not advertised; on the built-in path the gateway does not call it (see the RPC table above).

### Phase 9.4 limit

Phase 9.4 closed on its code and on the live checks it could reach. Historical: a sandbox stayed Provisioning (ConfigurationPending) in that capture, until the phase 9.5 supervisor reported its effective configuration, so the PD-08 stop and start calls were not reached then. See PD-08 above for the state on the built-in path, including the open owner decision. `AuthenticateSandbox` is not part of that: see the RPC table above.

## Runtime image build (phase 9.5, updated phase 9.7)

`sandbox/Dockerfile` has three stages: `runtime-builder`, `agentos-builder` and `runtime`. `runtime-builder` builds `/usr/local/lib/realm/openshell-sandbox`, the runtime the driver starts, from the upstream source and does not copy a host binary. `agentos-builder` compiles the AgentOS runner and probe from `package-lock.json` with `tsconfig.agentos.json` (source maps off). The image therefore no longer needs a host `npm run build`. A `.dockerignore` limits the build context to `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.agentos.json`, the two AgentOS sources and `sandbox/resolv.conf`.

- **Base.** `docker.io/library/rust:1.95.0-bookworm`, pinned by the digest of its OCI image index. The toolchain is 1.95.0, the channel in the upstream `rust-toolchain.toml` at the pinned commit. The base is bookworm, glibc 2.36.
- **Source.** `OPENSHELL_REVISION` names one full commit. The default is `bdb956f2cd65a635f1294fccf1d138d263bf650f`, tag `v0.1.5`. `OPENSHELL_TAG` (default `v0.1.5`) is recorded once in a Dockerfile comment after a manual `git ls-remote` check and only sets the `io.realm.openshell.tag` label: it is recorded once, not checked at build, and the build does not run `git ls-remote`. The stage fetches that commit at depth 1 from `https://github.com/NVIDIA/OpenShell`, fails unless `HEAD` equals the argument, checks the upstream toolchain channel, and removes the `.git` directory. An override names another commit. That build is unpinned: the gates still apply, but the commit has not been reviewed here.
- **Node base.** Node v24.22.1 on Debian 12 (bookworm slim), an amd64 single-platform manifest, pinned 2026-10-25.
- **Build.** `cargo build --locked --release -p openshell-sandbox`, using the source's own `Cargo.lock`. Crates come from crates.io at build time.
- **Lockfile gates.** The git-source gate runs before the build: it fails if `Cargo.lock` names a git-sourced crate, and it prints the lock's sha256. A registry-only gate runs after `cargo build`: it fails on any `Cargo.lock` source other than the crates.io registry. All 818 entries of the pinned lock are crates.io registry entries.
- **glibc gate.** The stage reads the `GLIBC_` version needs with `readelf` and fails when any is newer than `GLIBC_2.36`. It prints the highest version. A build of this commit on a glibc 2.39 host needs `GLIBC_2.38` and `GLIBC_2.39`, so a binary built that way cannot run in this image. That comparison comes from a local build, not from the image.
- **Dependency gate.** The stage fails unless the program interpreter is `/lib64/ld-linux-x86-64.so.2` and every needed library is in the glibc set, is `libgcc_s.so.1`, or is the dynamic loader's own soname `ld-linux-x86-64.so.2`. The runtime stage then runs `ldd` on the copied binary and fails on any `not found` line. That line also covers a GLIBC version that the image's glibc lacks.
- **Build arguments.** Required: `RUNTIME_SHA256`, `CARGO_LOCK_SHA256`, `AGENTOS_RUNNER_SHA256` and `AGENTOS_PROBE_SHA256`. Optional: `OPENSHELL_REVISION` and `OPENSHELL_TAG`. `RUNTIME_SHA256` must be 64 lowercase hex characters, like the other three digests.
- **Runner compile.** The runner and probe are compiled with `./node_modules/.bin/tsc`, so the stage never fetches a compiler.
- **Labels.** `org.opencontainers.image.title` and `org.opencontainers.image.source`, `io.realm.openshell.revision` and `io.realm.openshell.tag` (the upstream commit and tag), `io.realm.runtime.sha256`, `io.realm.runtime.revision`, `io.realm.cargo-lock.sha256`, `io.realm.agentos.runner.sha256` and `io.realm.agentos.probe.sha256`. The OCI revision, version and licenses labels are not set, because they would describe the upstream commit under the realm repository's source label. The gates fail unless each digest argument matches the file it names. They prove that the image holds the files whose digests were supplied. They do not compare those files with an external reference.
- **Network.** Build time only. The `runtime-builder` stage uses apt (`cmake`), the GitHub fetch and crates.io. The npm install steps use the npm registry. The image has no network at run time.
- **Architecture.** The gates expect x86-64. On another architecture the interpreter gate fails.
- **Packages.** The apt step installs only `cmake` 3.25.1-1. `git` 1:2.39.5-0+deb12u3 and `ca-certificates` 20230311+deb12u1 come from the pinned Rust base. `cmake` is needed by the `aws-lc-sys` build script. The dependencies of `cmake` still float in the bookworm archive; a `snapshot.debian.org` URL would pin them fully (recorded residual).
- **Debian 12.** Bookworm is on LTS support until 2028-06-30. Staying on the bookworm bases is the recorded default and the owner's decision.

To build the image:

1. Build `--target runtime-builder` and read the runtime and `Cargo.lock` digests it prints.
2. Build `--target agentos-builder` and read the runner and probe digests.
3. Record all four in `sandbox/expected-digests.json` (schema 1).
4. Run `npm run build:image`. Options: `--tag <ref>` (default `localhost/realm-agentos:build`), `--context <dir>` (default the repository root), `--expected <file>` (default `sandbox/expected-digests.json`) and `--podman <command>` (default `podman`). It reads and validates the digests file, then runs `podman build` with `RUNTIME_SHA256`, `CARGO_LOCK_SHA256`, `AGENTOS_RUNNER_SHA256`, `AGENTOS_PROBE_SHA256` and `OPENSHELL_REVISION` taken from that file. A rebuild whose binaries differ from the recorded digests therefore fails the Dockerfile's own gates. It then runs the same label and file verification as `npm run check:image-digests -- --image <tag>`. Exit codes: 0 clean; 1 verification findings; 2 bad arguments, an unreadable or malformed digests file, a build failure, or an image that cannot be read after the build.
5. To verify an existing image or directory without building, run `npm run check:image-digests -- --image <ref>` (or `-- --dir <dir>`). Exit codes: 0 match; 1 mismatch or missing file; 2 bad arguments (an `--image` value that starts with a dash is refused before podman runs), an image absent from local storage, an image that cannot be read, or an unreadable or malformed digests file. `--image` never pulls: it first checks that the image exists in local podman storage and exits 2 with a message when it does not. The verifier runs the image in a scratch container and copies the three files out of it. A file that podman reports absent from the image (`could not be found on container ... no such file or directory`) is a finding with exit 1. Any other copy failure, such as an unwritable destination or a podman error, exits 2 with `could not copy <name> out of the image` and no path or digest. When removing the scratch container fails the verifier prints `could not remove scratch container <id>` on stderr and keeps its findings and exit code.

Builder used for the verified build: Podman 5.7.1 with its buildah 1.42.2. The Dockerfile uses the BuildKit-style `RUN --mount=type=bind,from=<stage>` to read `Cargo.lock`, and that builder accepts it: the four final-stage digest checks printed OK.

Run `npm run build:image` and `npm run check:image-digests` as the account that owns the Podman storage. Measured 2026-10-28: when the wrapper ran as root with a podman command that switched to the realm account, the verifier's scratch directory belonged to root and `podman cp` could not write into it. At that time every copy failure was reported as a missing file (exit 1), although the same image verified with exit 0 as the realm account. That was fixed the same day: such a failure now exits 2 with `could not copy <name> out of the image`, and only a file that is really absent from the image is a finding. `build:image` also exits 2 with `build context not found` before it calls podman when `--context` is not a directory.

A later build that produces a different file fails its gate. CI does not build the image or run `build:image` or `check:image-digests`.

`sandbox/expected-digests.json` exists and records the digests of the verified build: the openshell commit, the `Cargo.lock` digest, the runtime, the runner and the probe. Reproducibility, measured 2026-10-28: a second independent build of the runtime from the pinned commit with the pinned `cmake` produced a binary with exactly the same sha256 as the first build (`b5f8bd5e16b34f564cbc9b6e68cfaec8459d56e2e4157c29b2cc231221514526`). The `Cargo.lock` sha256 is `07ba8e262eb3b66072484281db51bb371508359b8ad499a38aa60155ee74c263`. The build time of the Rust stage was about 21 minutes.

## Libpod request timeouts

- The libpod client bounds each request at 5 seconds (`requestTimeoutMs`, `DEFAULT_REQUEST_TIMEOUT_MS`). A timeout, like a transport failure, gives `PODMAN_MACHINE_DOWN`.
- The info request alone is bounded at 30 seconds (`infoTimeoutMs`, `DEFAULT_INFO_TIMEOUT_MS`). Both options must be positive integers; any other value is refused with `SCHEMA_INVALID`.
- Evidence (Podman 5.7.1, rootless API, 2026-10-28): `GET /libpod/info` took 4.4 to 5.9 seconds per call over six measurements, while listing containers took 1 to 23 ms. The API service runs `dpkg -S` on its own helper binaries to report package versions, and on a host with a large package database each lookup is slow. With the 5 second bound, info timed out about half the time and `realm up` failed intermittently with `PODMAN_MACHINE_DOWN`. The cause is the host, so the realm gives info a longer bound instead.
- `realm down` followed immediately by `realm up` works, because the libpod info call has its own 30 second bound and no longer times out at the 5 second request bound.
- Force removal and the startup sweep (RT-08, crash recovery). Evidence (live, 2026-10-28): after `realm up`, a `kill -9` of the daemon leaves the `realm-daemon` container running, the gateway's sandbox Ready, a stale control socket and a session record that still says active. The next `realm up` runs the startup sweep, which force-removes that container. It failed on the first attempt: the daemon logged `REALM_STOPPING` and the CLI reported `REALM_STOPPING` after about 11 seconds, and a moment later the container and the sandbox were gone. Cause: `DELETE /libpod/containers/{id}?force=true` carried no `timeout`, so Podman waited its default 10 seconds (SIGTERM, then SIGKILL) before it killed the running container. The request hit the 5 second request bound and the sweep's 10 second bound, the second listing still found the container, and the sweep refused to start with no session record deleted. The removal had only been late. A second `realm up` worked.
- A force removal now sends `timeout=2` (`FORCE_REMOVE_STOP_GRACE_SECONDS`): realm containers are disposable sandboxes, so Podman waits 2 seconds for a graceful exit and then kills. The request bound is the 5 second request bound plus that 2 second grace, the way a stop extends its bound by its grace. A non-force removal sends no `timeout` and keeps the 5 second bound. The sweep bounds each libpod call at 30 seconds (`SWEEP_CALL_TIMEOUT_MS`), so one removal on a loaded host is not cut off; the listing logic and the survivor check are unchanged, and a container that survives still gives `REALM_STOPPING`.

## Sandbox create hardening: sysctls

- The sandbox runtime needs `net.ipv4.ip_unprivileged_port_start` set to `0` in the sandbox network namespace. The Podman create body carries it as `sysctl`, together with the two IPv6 keys below, and no other sysctl is set there.
- The sysctl is per network namespace. The sandbox has no network, so only loopback is affected.
- The sandbox runtime checks the sysctl itself at startup and refuses to run when it is not `0`. That check is the fail-closed guard. It lives in the runtime, outside this repository, and this repository does not verify it.
- Podman 5.7.1 does not report sysctls in inspect, so the driver did not verify the sysctl there. Since phase 9.7 the verifier asserts the expected sysctls from the OCI config (see the verified properties section).
- Exposure is wider than the runtime needs. With the sysctl at `0`, any loopback port below 1024 becomes bindable, for the workload uid as well. This is referred to the A10 security review.
- IPv6 is disabled in the sandbox network namespace: `net.ipv6.conf.all.disable_ipv6` and `net.ipv6.conf.default.disable_ipv6` are both `1`. The sandbox has IPv4 loopback only, and `::1` is not configured on `lo`. RT-05 requires IPv6 off in the sandbox. Before this change the live sandbox had IPv6 on: `/proc/sys/net/ipv6/conf/all/disable_ipv6` read `0`, and `::1` was on `lo`.
- The driver did not verify the IPv6 keys at inspect either, for the same reason as the low-port sysctl above. Since phase 9.7 the verifier asserts the sysctls from the OCI config (see the verified properties section).

## Sandbox resolver

- The runtime image bakes `sandbox/resolv.conf` at `/etc/resolv.conf`. It holds one line, `nameserver 127.0.0.53`. The Dockerfile copies it root-owned and mode 0444 after the last `RUN` of the runtime stage.
- Why: the image's previous file named public resolvers (`1.1.1.1`, `1.0.0.1`), so no hostname ever resolved. Node connects to an allowlisted hostname failed with `EAI_AGAIN`, and so did connects to a non-allowlisted one.
- The create body sets `use_image_resolve_conf: true`, which makes the container use the image's file in every network mode. It sets no `dns_server`, because Podman refuses `dns_server` with network none.
- Podman generates no `resolv.conf` for network mode none: inspect reports an empty `ResolvConfPath`, and mountinfo shows no mount at `/etc/resolv.conf`. The image's file is therefore the only one the container sees.
- The runtime's DNS relay listens at `127.0.0.53:53`. It binds a port below 1024 in the sandbox namespace, so it needs the `net.ipv4.ip_unprivileged_port_start` sysctl described above.
- Live evidence (2026-10-28, rebuilt image, production stack, Podman 5.7.1, OpenShell 0.1.5): an image with this file, run under the production flags (network none, read-only) behind the realm gateway, with the realm-rendered policy allowing `1.1.1.1:443` and `example.com:443`. The allowed IP connected. A non-allowlisted IP failed with `EACCES`. The allowlisted hostname connected. A non-allowlisted hostname failed with `EACCES`. An IPv6 literal failed with `EACCES`.
- The resolver is synthetic. Every A query, including one for a made-up name and one for a `.invalid` name that no real resolver could answer, gets the next address from `198.18.0.0/15` (`.2`, `.3`, `.4`, `.5` in query order). The connection, not the lookup, is what is refused: policy is enforced at connect time on the name behind the synthetic address. Queries for names outside the allowlist are not forwarded. A host packet capture on ports 53 and 853 during these lookups showed zero DNS packets for the made-up name, the `.invalid` name and the denied host name, and packets for the allowed host name only, because the host supervisor resolves an allowed name when it makes the connection.
- Only A is answered. An AAAA lookup returns no data (`ENODATA`) and a TXT lookup returns not-implemented (`ENOTIMP`), for allowed and denied names alike.
- A sandbox can obtain an address in `198.18.0.0/15` for any name, so an application that logs resolved addresses sees these synthetic ones.
- The upstream Podman driver mounts a resolver file with the same content and sets `use_image_resolve_conf`. The upstream Docker driver sets `Dns` to `127.0.0.53`.
- The resolver file is part of the image, so the image-digest property covers it: a different resolver file is a different image digest.

## Sandbox create hardening: seccomp profile (phase 9.6)

Every sandbox container runs under a vendored seccomp profile: Podman's default profile with the keyring syscalls, the namespace syscalls and the mount family denied, and `ptrace` and two related syscalls denied in a separate rule (the transformations are listed below). The profile is vendored in `src/runtime/driver/seccomp-profile.ts`, written to a file by the driver, and named in the create request.

- **Why.** The keyring syscalls were reachable from the sandbox. Observed live: Podman's default profile lists `keyctl` as allowed, and the in-container runtime's own filters do not block it. A workload process described and read the realm account's user keyring by serial (the read returned zero keys). The sandbox and the realm account share one kernel uid under keep-id, so the workload sees the account's keyring. PRD-ENF-03 asks that `keyctl` return `EPERM`. The owner chose to close the exposure by vendoring the default profile without `keyctl` (2026-10-28).
- **Base.** `pkg/seccomp/seccomp.json` of the `containers/container-libs` repository, module `go.podman.io/common` v0.66.1, the version Podman 5.7.1 pins in its `go.mod`. Upstream commit `0799dfdfcbb09a08f4dac35365f8b25acd10caf0`. 17525 bytes, SHA-256 `886ae167646b7e5db381ecf7c31e6de720a8e8da15cf3202fe1f67f424af2b75`. Licence: Apache-2.0. Its default action is `SCMP_ACT_ERRNO` with errno 38 (`ENOSYS`).
- **Transformations (phase 9.7).** The upstream rules are kept, with these differences, listed in rule order:
  - The keyring deny: one explicit rule `{ names: [add_key, keyctl, request_key], action: SCMP_ACT_ERRNO, errnoRet: 1 }` (errno `EPERM`) right after the first upstream rule. The explicit rule is needed because the default errno is `ENOSYS`: removing `keyctl` alone would answer `ENOSYS`, not `EPERM`. `add_key` and `request_key` are not listed upstream, so they would fall to the default and answer `ENOSYS`; they are named in the rule so all three answer `EPERM`.
  - `unshare` and `setns`: `ERRNO` `EPERM`.
  - The mount family (`mount`, `umount`, `umount2`, `mount_setattr`, `move_mount`, `open_tree`, `pivot_root`, `fsconfig`, `fsmount`, `fsopen`, `fspick`): `ERRNO` `EPERM`.
  - `clone3`: `ERRNO` `ENOSYS`, so glibc falls back to `clone`.
  - A separate, droppable rule denies `ptrace`, `process_vm_writev` and `pidfd_getfd` with `EPERM`. `process_vm_readv` and `pidfd_open` stay allowed because the in-container runtime may need them.
  - The main allow rule has all those names removed. `setns` was also removed from the two capability-conditional rules, so exactly one rule names each syscall.
  - `clone` is allowed only through the upstream masked-equality rule (flags and the namespace-flag mask 2114060288 `== 0`, argument index 0 on x86-64 and arm64), so a `clone` with any `CLONE_NEW*` flag falls to the profile's default action (`ERRNO` with errno 38).
- **Why the isolation denials.** The container holds no capabilities, and a nested user namespace is the way to regain mount or namespace powers. Before this change only the host AppArmor restriction and Landlock stopped it.
- **Vendored profile.** 18615 bytes, 46 rules, SHA-256 `ed2525c01cd7377938a6027c64dda140c281a64b6937aaceac07fbb17b4885fa`. The upstream SHA-256 recorded above is unchanged. The module's header comment records the upstream project, version, licence, file, source digest and the transformations. The vendored file keeps upstream's tab formatting.
- **Delivery.** `installSeccompProfile` (`src/runtime/driver/seccomp-delivery.ts`) runs at the start of `startDriver`, before the driver's socket is bound and before any request is accepted. It writes the profile into a `seccomp` directory next to the driver socket, inside the socket's parent directory, which the driver already holds to mode 0700 and the account's ownership. The directory is mode 0700 and the file is mode 0600, written through the atomic write helper. The file is never a container mount source: a sandbox mounts only its workspace, its state directory and its channel directory, and the lifecycle refuses a workspace or state directory that holds a socket, which the driver's own socket in the same parent would be. The workload shares the account's kernel uid, so file permissions alone would not stop it; keeping the directory out of every mount does.
- **Name rule.** The file is named `realm-seccomp-<first 16 hex of the profile's SHA-256>.json`, here `realm-seccomp-ed2525c01cd73779.json`. The name carries the digest, so an existing file of that name with different content is tampering or damage, not an older version: the driver refuses to start (`SCHEMA_INVALID`, no path in the message) and does not overwrite it. A file of that name with the profile's content is left as it is, so a second start changes nothing. Delivery never deletes, so the previous profile's file, `realm-seccomp-123be34e33655dc4.json`, stays in the seccomp directory.
- **Other refusals.** The driver also refuses to start when the `seccomp` directory is a symbolic link, is not a directory, belongs to another account, or is writable by the group or others, and when the file is not a regular file owned by the account or is writable by the group or others.
- **Create body.** The libpod create body carries `seccomp_profile_path` with the absolute path of that file (Podman 5.7.1 accepts the field). A libpod client built without the path refuses every create, so no sandbox starts without the profile.
- **Verifier.** The property `seccomp-keyring` is in `HARDENING_PROPERTIES` (`src/runtime/hardening.ts`). It ignores `HostConfig.SecurityOpt`, the annotations and `Config.CreateCommand`, because an API-created container shows no `seccomp=` entry there. Its evidence is the container's OCI config, read before verification by `attachSeccompEvidence` (`src/runtime/seccomp-evidence.ts`) through the inspect's `OCIConfigPath`. The path must be absolute and must equal the inspect's `StaticDir` joined with `config.json` (the real inspect reports `OCIConfigPath` as `config.json` inside `StaticDir`, the container's `userdata` directory; a `..` segment in `StaticDir` is refused), so a forged inspect value cannot point the read at another file. The file is read through an injectable reader (`readOciConfig`, as `readProcStatus` is), by default a host read bounded to 1 MiB. The property passes only when `linux.seccomp` exists with default action `SCMP_ACT_ERRNO`, and for each of `keyctl`, `add_key` and `request_key` at least one rule lists it with action `SCMP_ACT_ERRNO` and `errnoRet` exactly 1, and no rule lists it with another action or another `errnoRet` (a missing `errnoRet` is not 1). Since phase 9.7 the create-time evidence check also requires the isolation denials (`ERRNO` `EPERM`) and `clone3` (`ERRNO` `ENOSYS`). Rules whose `names` is not an array, and non-string names, are ignored for matching. A missing or relative path, a path outside `StaticDir`, an unreadable, oversize or unparseable file attaches nothing, and the property fails closed. A daemon that cannot read the config file therefore refuses the create. An inbound `SeccompKeyringDenied` field from the engine is dropped before the read. Both verifiers run it: the driver's post-start check (`src/runtime/driver/lifecycle.ts`) and the session's `verifyOrRemove` (`src/runtime/session-execution.ts`). The hardening evidence digest covers the profile file name, so it changes with the profile.
- **Clone evidence (phase 9.7).** The create-time verdict also requires that every rule naming `clone` is `ALLOW` with exactly one masked-equality argument (index 0, mask 2114060288, second value 0; an omitted second value counts as 0), that no unconditional `clone` allow exists, and that the applied `defaultErrnoRet` is 38. A deny rule gated by an argument condition is not counted as a denial. The profile supports x86-64 and arm64 only, because the clone flags are argument 1 on s390 and s390x.
- **Re-sync on a Podman upgrade.** Fetch `pkg/seccomp/seccomp.json` of the `containers/common` version the new Podman pins in its `go.mod`. Apply the same transformations. Compare the result with the vendored profile: the text diff now includes the keyring, isolation, mount, `clone3` and ptrace rules, the names removed from the main allow rule and from the two capability-conditional rules, and whatever upstream changed. Update `src/runtime/driver/seccomp-profile.ts`, its recorded source digest, and the digests and file name in this section. Then re-run the seccomp tests (`test/runtime/driver/seccomp-profile.test.ts` and `test/runtime/driver/seccomp-delivery.test.ts`).
- **Observed (Podman 5.7.1, 2026-10-28; historical, the first profile with 25 rules and the keyring rule only).** A container created through the libpod API with `seccomp_profile_path` runs under the profile. Its OCI runtime config (`config.json`) holds `linux.seccomp` with default action `SCMP_ACT_ERRNO`, default errno 38, 25 rules including `{ names: [add_key, keyctl, request_key], action: SCMP_ACT_ERRNO, errnoRet: 1 }`, and allow rules for `landlock_create_ruleset`, `landlock_add_rule`, `landlock_restrict_self` and `seccomp`. A `keyctl` call inside that container returned `-1` with errno 1 (`EPERM`). Inspect does not show the profile for such a container: `HostConfig.SecurityOpt` is only `["no-new-privileges"]` and the annotation `io.podman.annotations.seccomp` is absent. Podman builds the `seccomp=<path>` entry of `SecurityOpt` from that annotation, and only the `podman` CLI sets it, so a container created by the CLI shows `seccomp=` and an API-created one does not.
- **Not claimed.** The verifier does not compare the whole profile with the vendored file: Podman filters and expands the rules by capability and architecture, so the applied rules are not the file's rules verbatim. The verdict covers the default action, the keyring syscalls, the isolation denials, `clone3` and the `clone` rules only (the first profile's verdict covered the three keyring syscalls and the default action only). The content guarantee for the rest rests on the digest-bearing file name and the driver's refusal to start on a file of that name with other content. The proof reads the config at create time only; it does not re-verify later.

## Sandbox create hardening: verified properties and workspace scan (phase 9.7)

- **Property list.** `HARDENING_PROPERTIES` goes from 15 to 26 names. The 11 new ones are `live-seccomp`, `live-no-new-privs`, `namespaces`, `devices`, `user`, `security-opt`, `memory-swap`, `ulimits`, `sysctls`, `masked-paths` and `readonly-paths`. They are asserted from the libpod inspect, the OCI `config.json` and the init process's `/proc` status.
- **What they assert.** Live `Seccomp` 2 and `NoNewPrivs` 1 in the init process's status. No host user, pid, ipc, uts or cgroup namespace. No devices. Memory swap equal to the memory limit. Rlimits: every profile rlimit (`nofile` 4096, `core` 0) appears exactly once with soft equal to hard equal to the limit. Entries of other types are tolerated, because the engine may add defaults such as `RLIMIT_NPROC`. A missing, duplicated or mis-valued profile type fails the `ulimits` property. The realm deliberately sets no `nproc`, because `RLIMIT_NPROC` counts per host uid and would be shared with the realm account's own processes, and the cgroup pids limit is the container-scoped bound. Sysctls: every profile key (`net.ipv4.ip_unprivileged_port_start` 0 and the two IPv6 keys) must be present with exactly its expected value. Extra keys are tolerated, because the engine may add defaults such as `net.ipv4.ping_group_range`. A missing or conflicting required key fails the `sysctls` property. User `1001:1001`. No `label=disable` or `unmask` in `SecurityOpt`. Podman's default masked and read-only paths present.
- **Rlimit type names (live lesson, 2026-10-28).** Podman's REST API takes a rlimit type without the `RLIMIT_` prefix and adds the prefix itself. The create body therefore sends `NOFILE` and `CORE`; inspect and the OCI config report `RLIMIT_NOFILE`, `RLIMIT_CORE` and the engine's own `RLIMIT_NPROC` default, which the verifier tolerates. A first run on the new stack sent the prefixed names, the engine turned them into `RLIMIT_RLIMIT_NOFILE`, runc refused the start (`wrong rlimit value: RLIMIT_RLIMIT_NOFILE`) and the driver failed closed: 7 of the 9 live scenarios failed, every one that needs a created sandbox, while the two that expect a failure passed. The mock-based unit tests had encoded the wrong names, so they could not catch it; only the live suite catches the engine's own naming. Run the live suite after any change to the create body.
- **Tmpfs.** Each tmpfs must carry `noexec`, `nosuid` and `nodev` and none of `exec`, `suid` or `dev`, and exactly one `size=` option whose value in bytes equals the profile size for its destination: 256m for `/tmp`, 16m for `/run` and 4m for the CA tmpfs (256m and 262144k compare equal). A size that is absent, repeated, tiny or huge fails.
- **Fail closed.** Unreadable evidence refuses the create.
- **Info cache.** libpod info is cached for 60 seconds per client, because it takes 4 to 6 seconds on the reference host (the Podman API runs package lookups; see the libpod request timeouts section).
- **Workspace.** The create-time scan also refuses a directory on another device than the workspace root (a nested mount) with `SCHEMA_INVALID`. It canonicalises the workspace root with `realpath` and runs at create only. A same-filesystem bind mount shares its parent's device and a file bind mount is not a directory, so the scan detects neither: this is recorded as a residual risk next to the post-start socket residual. Sockets or mounts created after the sandbox starts are an accepted, documented residual risk (owner decision, 2026-10-28), and there is no re-scan at `ListSandboxes`.

## CLI and gateway pin: 0.1.5 (verified 2026-10-26)

- The OpenShell CLI and gateway are 0.1.5. The realm's verbs were re-verified against that version on 2026-10-26.
- Create: `openshell sandbox create --name realm-<sessionId> --policy <path> --no-auto-providers --detach --cpu <n> --memory <size>`, with `--from <image>` for the configured image. The create passes no `--no-keep`, so the sandbox lasts until `realm down` deletes it.
- Exec: `openshell sandbox exec --name realm-<sessionId> --workdir /workspace --no-tty --no-login-shell -- <argv>`. The AgentOS runner and its probe use this form.
- Delete: `openshell sandbox delete realm-<sessionId>`.
- One sandbox per session. The session's create makes the only sandbox, `realm-<sessionId>` (the daemon's session is `daemon`, so its sandbox is `realm-daemon`), and AgentOS is its workload. Start runs the runner as a managed exec child in that sandbox and waits for its probe. No second sandbox is created. The sandbox image is the configured digest-pinned `image` (`config.image`), the only image source: no environment variable changes it.
- Sandbox name length: the OpenShell 0.1.5 gateway rejects a sandbox name longer than 19 characters (its constant `MAX_ROUTABLE_NAME_LEN`), so with the `realm-` prefix a session id is at most 13 characters. The limit is the gateway's, not the realm's. A create for a longer session id is refused with `SCHEMA_INVALID` before any libpod, OpenShell, or policy call. Live evidence (OpenShell 0.1.5, 2026-10-28): `openshell sandbox create --name realm-live-<uuid>` failed with "name exceeds maximum length (47 > 19)". The daemon's session id, `daemon`, fits.
- Stop path (phase 9.6): `stop` and `destroy` delete the session's sandbox `realm-<sessionId>`. It is deleted once: a repeated stop makes no second delete call. The session's sandbox name is known before the container step in three cases: the container id is a realm sandbox name; the container id is one this daemon's create returned (recorded when the create returns it); or the container's sandbox-name label, which inspect reads. The name is kept until its delete succeeds, so a `destroy` retried after a failed delete still deletes the sandbox, even once the container is gone. A libpod error in a container step, including an inspect that rejects, does not skip the delete when the name is known, and that libpod error is then the one reported. The record is held in memory by the daemon process, so it does not survive a restart.
- A stop or destroy that names a sandbox with a session create in flight waits for that create, stops and deletes the container it produced, and reports success only after the delete finishes; the create then fails with OPENSHELL_START_FAILED and is not reported as active. That wait is bounded by the stop deadline (15 s). If it expires, the stop still stops and deletes what it knows, then reports AGENTOS_STOP_FAILED with the catalogue reason, which says the sandbox delete may still be pending, and never reports success.
- Open items, not fixed in phase 9.6: (1) a container id this daemon did not create, after a restart, whose inspect rejects has no known name, so its sandbox delete is skipped. (2) A create still running when a stop's wait expires finishes later and nothing removes the container it produces. (3) The compute driver's `DriverLifecycle.delete` path, which the gateway `DeleteSandbox` RPC reaches, removes containers and secret directories through libpod and does not run `openshell sandbox delete`, so an OpenShell sandbox removed through that RPC is not deleted here.
- A create command is not run in 0.1.5. A create with `-- <command>` and `--detach` does not run the command, and the marker the command writes never appears. Without `--detach` the CLI opens an interactive shell. So the AgentOS runner never starts from create. The realm starts it as a long-lived `sandbox exec` child after create (`src/runtime/agentos-workload.ts`). Live evidence: a runner started by the exec form above and held open wrote its heartbeat within 20 s, and the probe with the same exec flags exited 0.
- The runner's heartbeat file lives in `/tmp` (the container's tmpfs scratch, granted read-write by the realm policy), never in the workspace, so the user's project receives no realm files.
- The AgentOS runner prints the fixed line `agentos runner failed` and exits 1 also on an uncaught exception or an unhandled rejection.
- The pinned workspace root must be empty of realm files after `realm down`. The heartbeat lives in scratch space, not in the workspace.
- Piped stdin is refused above 4 MiB. Move larger input with `openshell sandbox upload`.
- The CLI receives only `PATH`, `HOME` and `XDG_RUNTIME_DIR` (`OPENSHELL_ENV_NAMES`). The gateway is therefore registered in the CLI's default config location, under `HOME`, and no gateway setting travels in the environment.

## Production stack evidence (2026-10-28)

The live runs on the production stack (OpenShell 0.1.5 gateway, the Realm compute driver, rootless Podman 5.x) verified the following. The OMP-LIVE items and the live egress results are recorded in the phase verification file, not here.

- `realm up` reaches `active`, and `realm status` reports it.
- The in-sandbox runner probe passes.
- The workload runs as uid 1001 with CapEff 0, CapBnd 0, NoNewPrivs 1, seccomp mode 2, and IPv6 disabled.
- The realm policy holds: `/tmp`, `/workspace` and `/dev/null` are writable; `/etc` and `/home` are read-only; `/dev/zero`, `/dev/random` and `/dev/urandom` are readable.
- `keyctl`, `add_key` and `request_key` return EPERM, and the host account's keyring is not readable.
- The pinned workspace is bound and receives no realm files.
- A 16 MiB upload and download round trip is byte-identical (SHA-256 matches on both sides).
- A non-zero exit status is propagated.
- Egress is deny-all by default.
- With an allowlist, the allowed `host:port` connects. A non-allowlisted IP, a non-allowlisted host and an IPv6 literal fail to connect with `EACCES`. The connection is refused, not the lookup (verified on the rebuilt image, 2026-10-28).
- With an allowlist, an AAAA lookup returns no data (`ENODATA`) and a TXT lookup returns not-implemented (`ENOTIMP`), for allowed and denied names alike (verified on the rebuilt image, 2026-10-28).
- The sandbox resolver is synthetic and answers only A queries. Every A query, including one for a made-up name or a `.invalid` name, gets the next address from `198.18.0.0/15`. Policy is enforced at connect time on the name behind that address. A host packet capture on ports 53 and 853 showed zero DNS packets for a made-up name, a `.invalid` name and a denied host name, and packets for the allowed host name only, so a name outside the allowlist is never forwarded as a DNS query (verified on the rebuilt image, 2026-10-28).
- `realm down` leaves zero containers, sandboxes, supervisors and secret directories.
- A wrong image digest fails closed.
- The gated production live suite passes in full: nine scenarios, 31 of 31 assertions, exit 0, in 6.7 minutes (2026-10-28, rebuilt image; the stack and the history are under "Running the production live suite").

Decisions recorded with this evidence:

- One sandbox per session, named `realm-<sessionId>`.
- `active` needs no Anda bridge when no `andaUrl` is configured.
- One live sandbox per pinned root.
- The runtime's policy is the enforcement authority, and the retired realm helper is removed (recover it from git history if needed).

## Residual risks of the production sandbox (reviewed 2026-10-28)

Source: the final A10 boundary review of the production sandbox, plus live probes on this host (kernel 6.8, rootless Podman 5.x). The review read source and docs only and rated F1 and F2 as depending on host behaviour; the probes below settle them. Finding numbers F1 to F10 are the review's. Severities are the review's unless stated.

### Accepted by the owner (2026-10-28)

- A unix socket that a host process creates in the pinned workspace after the sandbox starts is reachable from the sandbox. Live: a host listener logged the connection. The host service sees the connection as the realm account. A workload that reaches a socket reaches whatever that host service grants the realm account. For the runtime's own control socket, the remaining exposure is pre-auth parser surface and connection-slot denial of service against the supervisor, not impersonation (A10 Q3, unprobed by the review; the live probe showed that a handshake without a client certificate is rejected).
- Landlock gains its unix-socket connect scope only with kernel 6.12. This host runs 6.8, so there is no mediation here. This corresponds to A10 F2 (Med) and F7.
- The create-time refusal of a workspace that already holds a socket stays, and since phase 9.7 so does the create-time refusal of a nested mount (a directory on a different device than the workspace root). They are the only checks; nothing stops a socket or mount created after the sandbox starts, and there is no re-scan at `ListSandboxes` (owner decision, 2026-10-28).
- Residual risk, recorded with the socket residual above: the nested-mount scan refuses a directory on another device only. A same-filesystem bind mount shares its parent's device and a file bind mount is not a directory, so neither is detected. The scan is create-time only.
- Operator rule: keep no sockets inside a pinned workspace root. That covers ssh ControlPath sockets, agent sockets, language-server sockets and other tool sockets.
- Revisit on kernel 6.12 or newer.

### Verified live and holding

- The runtime process is non-dumpable. Its `/proc` files are root-owned.
- A workload read of `/proc/1/environ`, `/proc/1/maps` and `/proc/1/mem` is denied.
- Historical (live probes before the phase 9.7 profile): `ptrace` attach, `process_vm_readv` and `pidfd_getfd` against the runtime returned EPERM, and `pidfd_open` returned ENOSYS, which was attributed to a filter. The profile now allows `pidfd_open` and `process_vm_readv`. The protection of the runtime's memory rests on the runtime being non-dumpable (verified live in phase 9.6) and on the host Yama setting.
- The host Yama `ptrace_scope` is 1. The non-dumpable property protects the runtime independently of it.
- A connection from the workload to the runtime's control socket is accepted. A TLS handshake without a client certificate is rejected. The session and the runtime stay up.
- Correction to the review: A10 F1 (Med, High if a probe were positive) is not High, because the probes are negative. The A10 F2 note that the connect to the control socket may succeed is right (it does), but the handshake is rejected. Refusing create when `ptrace_scope` is 0, the review's fix for F1, is not implemented. Phase 9.7 adds the `kernel-hardening` doctor warning instead.

### Not assumed to hold on other hosts

- Creating a user namespace is denied on this host (`kernel.apparmor_restrict_unprivileged_userns` is 1). The source of the denial (host AppArmor or the container filters) was not separated, so another host may allow it; the seccomp profile no longer relies on the host for this (phase 9.7).
- Historical (before phase 9.7): the vendored seccomp profile allowed `unshare` and `clone`, as Podman's default profile does, and a new user namespace was stopped only by the host AppArmor restriction and Landlock (A10 F4, Med). Phase 9.7 fixed it in the profile (see the seccomp section), so the denial no longer depends on the host.

### Sysctl

- `net.ipv4.ip_unprivileged_port_start` is 0 in the sandbox. Any sandbox process can bind loopback ports below 1024 inside the network-less sandbox. Low. The runtime requires it.

### A10 review findings and their status (updated phase 9.7)

Severities are the review's. The status is the state after phase 9.7.

| # | Sev | Finding | Status |
| --- | --- | --- | --- |
| F1 | Med | The runtime process is reachable by ptrace-class syscalls from the workload. The review's fix: refuse create when `ptrace_scope` is 0. | Mitigated: the `kernel-hardening` doctor warning (see the host supervisor pin and doctor section) and the separate seccomp deny group for `ptrace`, `process_vm_writev` and `pidfd_getfd`. Residual if `ptrace_scope` is 0. |
| F2 | Med | A unix-socket connect to the runtime's control socket is not mediated by Landlock on kernel 6.8. | Open: AF_UNIX connect is not mediated by Landlock on kernel 6.8. The runtime control socket needs a client certificate (live probe: a handshake without one is rejected). Post-start workspace sockets are the accepted residual above. |
| F3 | Med | Workspace planting: the workload runs as the host realm uid and can plant `.git/hooks`, `.git/config`, `.envrc`, `.vscode/tasks.json`, `package.json` scripts and symlinks that a host tool may run later. | Open by design; awaits owner acceptance. Operator rule: review those files and symlinks before running git or editor tooling in the workspace. The read-only mounts for `.git/hooks` and `.git/config` and the post-session diff the review suggested are not implemented. |
| F4 | Med | Nested user namespaces are not denied by the vendored seccomp profile. | Fixed by the profile's `unshare`, `setns`, mount-family, `clone3` and masked `clone` rules (see the seccomp section). |
| F5 | Low to Med | The verifier did not cover user namespaces, devices, masked paths, rlimits, the live `Seccomp` and `NoNewPrivs` fields, or the sysctls. | Fixed: 11 new properties (see the verified properties section). |
| F6 | Low | `atomic-write` can leave an empty 0600 file outside the root on a parent-swap race. | Fixed: the atomic write pins the parent directory by descriptor and rechecks it. A stage hook that runs after the pin re-check and a `procFdDir` option (as in `canonicalize.ts`) exist for tests only. |
| F7 | Low | The socket scan runs only at create and does not detect mounts under the workspace. | Fixed for nested mounts at create (a directory on another device than the workspace root is refused; same-filesystem bind mounts and file bind mounts are not detected). The post-start residual is accepted, and there is no re-scan at `ListSandboxes`. |
| F8 | Low | The egress allowlist accepts RFC1918 and CGNAT literals. | Fixed: private ranges are refused (see `docs/policy-reference.md`). The check is lexical; filtering of resolved addresses is the supervisor's. |
| F9 | Low | `/tmp` and `/run` lack `noexec` and a size; no ulimits, no swap limit, no disk quota. | Fixed except the disk quota, which stays open. |
| F10 | Info | The sticky bit on the CA tmpfs gives no protection against the same uid; the supervisor is unconfined. | Fixed except confining the supervisor, which stays open. |

## Supply chain findings (reviewed 2026-10-28, status updated phase 9.7)

Source: the A18 supply-chain review of the sandbox image and host binaries. It read files only and ran no scanner. The Finding, Minimal fix and Owner columns are the review's as recorded on 2026-10-28; the Status column is the state after phase 9.7. "Owner" means the finding needs an owner decision.

| # | Sev | Finding | Minimal fix | Owner | Status (phase 9.7) |
| --- | --- | --- | --- | --- | --- |
| 1 | High | `openshell-supervisor` runs on the host, handles launch secrets, and was built outside this repository. The driver checks only that `REALM_DRIVER_SUPERVISOR_BINARY` is an absolute executable file. No digest, build record or version check. | Build it from the pinned runtime commit in a Dockerfile target, commit its SHA-256, and have the driver compare it at start. | Yes: build in-repo or not, and who owns the host install. | Recorded in `docs/integration/host-binaries.md`, with an optional digest pin (`REALM_DRIVER_SUPERVISOR_SHA256`) and a doctor check. The pin is opt-in; making it mandatory in production and building the supervisor in-repo stay owner decisions. |
| 2 | High | The CLI, gateway (0.1.5) and Podman 5.7.1 have no recorded install source, digest or signature. | Add a host-binaries record (source URL, SHA-256, install date, version output) and a doctor check against it. | Yes: release channel and signature to trust. | Recorded in `docs/integration/host-binaries.md` (digests and versions; the install source and signature are unrecorded), with a doctor check that warns on drift from a recorded pin. The release channel and signature to trust stay an owner decision. |
| 3 | Med | Runtime trust is on first use. The expected `RUNTIME_SHA256` value is not committed. It is the one digest the review named that is still a build argument (`sandbox/Dockerfile`); the source is pinned by `OPENSHELL_REVISION` and the helper is retired. | Commit an expected-digests file, have the build read it, build twice and diff. | No | Fixed: `sandbox/expected-digests.json` records the digests of the verified build. `npm run build:image` reads and validates that file and passes its values as the build arguments, so a rebuild whose binaries differ from the recorded digests fails the Dockerfile's own gates, and it then runs the same label and file verification as `npm run check:image-digests -- --image <tag>`. Reproducibility, measured 2026-10-28: two independent builds of the runtime from the pinned commit gave the same sha256 (`b5f8bd5e16b34f564cbc9b6e68cfaec8459d56e2e4157c29b2cc231221514526`). Limits: CI does not build the image or run these checks, and the digests were recorded from one host and two independent builds. |
| 4 | Med | The AgentOS runner and probe are copied from the host `dist/`, which is gitignored and built by hand. | Compile in a Dockerfile stage from `package-lock.json`, or record and check SHA-256 labels. | No | Fixed: the runner and probe are compiled in the image's `agentos-builder` stage. |
| 5 | Med | Debian 12 is the base of both stages (Rust and Node); standard security support ended about 2026-06-10, with LTS to 2028-06-30 (inference from the Debian schedule). The Dockerfile records the tag and resolve date of the Rust base and does not record them for the Node base. | Record tag, resolve date and index digest for the Node base, and run the base-image policy check with an as-of date. | Yes: accept LTS or move to Debian 13 or a newer Rust base. | Owner decision, with a recorded default: stay on the bookworm bases (LTS support until 2028-06-30). The Node base is recorded: Node v24.22.1 on Debian 12 (bookworm slim), an amd64 single-platform manifest, pinned 2026-10-25. |
| 6 | Med | `apt-get install ca-certificates cmake git` is unpinned and hits the live archive. | Drop `git` if the base has it and pin `cmake`; long term use a dated snapshot archive or a prebuilt builder. | No | Fixed for cmake (pinned to 3.25.1-1; git and ca-certificates come from the pinned Rust base). The dependencies of cmake still float in the bookworm archive. |
| 7 | Med | CI uses `actions/checkout` and `actions/setup-node` by tag, not commit SHA. CI never builds the image: no CI image build, SBOM or signing. | Pin the actions to 40-hex SHAs; add an image-build job later. | No | Fixed: actions pinned to commit SHAs, job timeouts, explicit least-privilege permissions, and `persist-credentials: false` on every checkout, including the release checkout (the push step passes the token through its environment). |
| 8 | Low | `cargo build --locked` checks crate checksums but records nothing. Whether the upstream lock has git-sourced crates, which carry no checksum, was not checked. | Fail the build on any `source = "git+` entry in the lock and label the image with the lock's SHA-256. | No | Fixed: the lockfile gate. |
| 9 | Low | The source gate trusts a SHA-1 commit id. Nothing records that tag `v0.1.5` was verified against it. | Record the tag signature or a release tarball digest next to the pinned revision. | No | Recorded: the tag is recorded once in a Dockerfile comment after a manual `git ls-remote` check. The build does not run `git ls-remote`, so the tag is not checked at build. |
| 10 | Low | The seccomp profile is vendored with a recorded digest but tagged without a commit id, and no script regenerates it from upstream. The verifier checks only the default action and the three keyring syscalls, at create. | Record the upstream commit id; add a script or test that fetches, transforms and compares the digest. | No | Recorded: the upstream commit is `0799dfdfcbb09a08f4dac35365f8b25acd10caf0`, for `go.podman.io/common` v0.66.1 (see the seccomp section). No script regenerates the profile from upstream. |
| 11 | not recorded | The finding text is not recorded in this document. | not recorded | not recorded | Stale: the helper the finding concerned was removed. |
| 12 | not recorded | The finding text is not recorded in this document. | not recorded | not recorded | Fixed: `.dockerignore` and image labels. |
| 13 | not recorded | The finding text is not recorded in this document. | not recorded | not recorded | Recorded: there is no SBOM tooling for the sandbox image. The release job writes a CycloneDX SBOM of the npm package's production dependencies (`scripts/release/assets.mjs`). |

Findings 1 to 10 were recorded on 2026-10-28; 11 to 13 are listed with their phase 9.7 status only. Needing an owner decision among findings 1 to 10: 1, 2 and 5.

Pages workflow permissions (finding F9 of the supply-chain review; the table above numbers the findings as this document recorded them, and its row 9 is a different finding): applied, not yet exercised. `.github/workflows/pages.yml` sets permissions per job (build `contents: read` and `pages: read`; deploy `pages: write` and `id-token: write`), and it has no `push` trigger: the release job dispatches it after a release, and it can be run by hand. The narrowed set is proven only by the first deploy from `main`, because the `github-pages` environment accepts only `main`. The other CI changes of row 7 (commit-SHA pins, job timeouts, explicit verify permissions, `persist-credentials: false` on every checkout, including the release checkout (the push step passes the token through its environment)) are applied. Both workflow files need human review before merge.

Image distribution. The sandbox image is built locally and is not distributed. If it were pushed to a registry, the GNU grep and GNU Wget in `@rivet-dev/agentos-runtime-core` (the package has no licence file) would bring GPL source-offer obligations.

## Operator notes (phase 9.7)

- **A failed create has a fixed error text.** By design the driver reports a failed create with a fixed error text, so the cause is not in the caller's error. It is in the journal of the Podman API service, the `realm-podman-api` user unit of the realm account (`journalctl --user -u realm-podman-api`), where runc's own message appears. Example (2026-10-28): `wrong rlimit value: RLIMIT_RLIMIT_NOFILE`, from a create body that named its rlimit types with the prefix (see the verified properties section).
- **Podman event log pattern.** `podman events --since 10m --stream=false --filter container=realm-daemon`, run as the realm account, lists a container's events. A container that ran shows a `start` event between its `create` and its `remove`. A container that was created and removed with no `start` event was refused before it started. The failed rlimit create above looked like this (abridged to event type and container name):

  ```
  container create realm-daemon
  container remove realm-daemon
  ```

  Read the API service's journal for the reason.
- **Old seccomp profile files.** The driver's seccomp directory keeps the profile files of earlier generations; only the file whose name carries the current profile digest is used, so a stale file is inert but can mislead an operator reading the directory.

## Running the production live suite

`test/integration/production-driver.test.ts` runs the production stack end to end and checks by behaviour what the evidence above records. It is gated: without every prerequisite below the file skips, and each skipped scenario names the first missing one. A default `npm test` therefore skips it and reports the skips. The pure parts of the suite (probe output parsing, the polling helper, the `198.18.0.0/15` range check, the skip-reason selection, the daemon process finder's parsing of `ps` output, the MCP line framing and the JSON-RPC response matcher) have their own hermetic tests in `test/integration/production-live-helpers.test.ts`, which always run.

**Preconditions the operator provides.** The suite cannot check these, so a wrong host fails a scenario instead of skipping it.

- The OpenShell gateway and the Realm compute driver run under the realm account, with the same image and the same roots as the variables below.
- The `openshell` CLI has the realm gateway registered as its default. The suite gives the CLI only `PATH`, `HOME` and `XDG_RUNTIME_DIR`, as the realm does.
- The pinned workspace root is empty, and no other live sandbox holds it (one live sandbox per pinned root).
- The realm account's rootless Podman holds no other container. The residue check counts every container.

**Environment variables.** The gate checks them in this order and reports the first that is missing.

| Variable | Value |
| --- | --- |
| `REALM_LIVE_PRODUCTION` | `1`. An explicit operator opt-in. The test never sets it, and any other value skips the file. |
| `REALM_LIVE_IMAGE` | The digest-pinned image reference the running driver was given. |
| `REALM_LIVE_DRIVER_CONFIG` | Absolute path of the `config.json` the running driver reads. The secret, workspace and sandbox-state roots come from that file (`secretRoot`, `workspaceRoot`, `sandboxStateRoot`; omitted secret and sandbox-state roots are `<stateDir>/secrets` and `<stateDir>/sandboxes`). A stale `REALM_DRIVER_SECRET_ROOT`, `REALM_DRIVER_WORKSPACE_ROOT` or `REALM_DRIVER_STATE_ROOT` is ignored. `workspaceRoot` must also be the project directory the policy approves. |
| `XDG_RUNTIME_DIR` | The realm account's runtime directory. The rootless Podman API socket must be at `podman/podman.sock` under it. |

The gate also needs Podman 5.x and the `openshell` CLI on `PATH`, and the built CLI at `dist/src/cli/main.js`, so build first.

**Command.**

```sh
npm run build && node --test dist/test/integration/production-driver.test.js
```

Run the live file alone. `npm run test:integration` also runs it, but `node --test` runs the files of `dist/test/integration/*.test.js` in parallel, and this suite counts every container on the host, so a container created by another file running at the same time would make the residue check fail. The safe alternative is to serialise the files: `npm run build && node --test --test-concurrency=1 "dist/test/integration/*.test.js"`.

**What the suite touches.** It creates and removes only its own sandbox, `realm-daemon`, and its own temporary directories. Each scenario builds a fresh XDG config home with `realm/config.json` (the image, the pinned workspace root, the secret root, the sandbox state root, and a short temporary state directory so the control socket path stays under the 107-byte limit) and its own `policy.json` (the pinned workspace root only, plus `egressAllow` where the scenario needs it). It runs the built CLI through `execFile` on the current node binary, with `PATH`, `HOME` and `XDG_RUNTIME_DIR` from the test's environment and the scenario's `XDG_CONFIG_HOME`. The three root variables are not set; a stale one is ignored. Probes run as `openshell sandbox exec --name realm-daemon --workdir /workspace --no-tty --no-login-shell -- <argv>`, with an argv array and no shell.

**Cleanup.** Every scenario runs `realm down` in its cleanup, even when it failed. It then waits, polling for at most 90 s, for zero containers, zero `realm-*` sandboxes, no `realm-daemon` directory under the secret root or the sandbox state root, and an empty pinned workspace. A scenario fails if any of these remains. No secret value is printed: failures carry exit codes, error codes, names and clipped probe output.

**Scenarios.**

1. Default policy. `realm up` exits 0 and `realm status` reports `active`. Inside the sandbox: uid 1001; `CapEff` and `CapBnd` all zero; `NoNewPrivs` 1; `Seccomp` 2; IPv6 disabled; `/etc/resolv.conf` is exactly `nameserver 127.0.0.53`; writes to scratch space, `/workspace` and `/dev/null` succeed; writes to `/etc` and `/home` fail as read-only; `/dev/zero` and `/dev/random` are readable; `keyctl`, `add_key` and `request_key` fail with errno 1 (syscall numbers 250, 248 and 249, checked on x86-64 only and skipped with a stated reason elsewhere); the runner's heartbeat is in scratch space and the pinned workspace holds no `realm-agentos` directory; the AgentOS runner probe exits 0; `openshell sandbox exec -- sh -c 'exit 7'` exits 7; a file written in the sandbox's `/workspace` appears in the pinned root on the host and is removed afterwards; a 16 MiB random file uploaded with `openshell sandbox upload` and downloaded with `openshell sandbox download` is byte-identical (SHA-256 on the host before and after, and `sha256sum` in the sandbox), and is removed from the sandbox; a connection to `1.1.1.1:443` from the sandbox is refused. Then `realm down` exits 0 and the residue checks pass.
2. Immediate cycle. Right after scenario 1's down, `realm up` reaches `active` with no `PODMAN_MACHINE_DOWN` (the regression check for the 30 s libpod info bound). Then `realm down` and the residue checks.
3. Egress allowlist (`1.1.1.1:443` and `example.com:443`). The scenario first checks from the host that a TCP connection to `1.1.1.1:443` opens within 5 s, and skips with the reason that the host has no outbound connectivity if it does not. In the sandbox, with node: `1.1.1.1:443` connects; `8.8.8.8:443` fails with `EACCES`; `example.com:443` (family 4) connects; `example.org:443` fails with `EACCES`; the IPv6 literal `2606:4700:4700::1111:443` fails with `EACCES`; `dns.resolve6` for `example.com` returns `ENODATA`; `dns.resolve4` for a made-up name under `example.net` returns one address inside `198.18.0.0/15` (the range is asserted, not the address); `dns.resolveTxt` returns `ENOTIMP`. Then `realm down` and the residue checks.
4. Wrong image digest. A config whose image is `localhost/realm-agentos@sha256:` followed by 64 zeros: `realm up` exits non-zero with the reason `OPENSHELL_START_FAILED`, and no container exists afterwards. Then `realm down` and the residue checks.
5. Crash recovery (the live check for the startup reaper, RT-08). `realm up` reaches `active` with the default policy. The suite finds the daemon process that `realm up` started and asserts that exactly one exists, then sends it SIGKILL. It asserts that the daemon is gone and that the `realm-daemon` container is still there, which shows the crash left its sandbox behind. A second `realm up` must exit 0, and `realm status` must report `active` within 120 s. If it does not, the scenario fails carrying the CLI's reason code. The restarted daemon is a new process, and exactly one `realm-daemon` sandbox and exactly one `realm-daemon` container exist, so the next start reaped the leftovers and created the sandbox again. Then `realm down` and the residue checks. If a step after the kill fails, the test body runs one more `realm up` before it rethrows, because `realm down` with no daemon reports `already down` and reaps nothing. That extra `realm up` does not run if the scenario timeout fires first.
6. MCP exec (the live check for the shared dispatcher, TOOL-03). The suite starts `realm mcp --workspace <pinned root>` with the scenario's environment and talks newline-delimited JSON-RPC 2.0 over its stdio, with a bound on every response (60 s; the answer to `initialize` has 150 s, because `realm mcp` claims the workspace before it reads any input). It sends `initialize` and checks the protocol revision `2026-07-28`, the server info and `capabilities.tools`; sends the `notifications/initialized` notification, which takes no reply; and sends `tools/list`, which must name `exec`, `read`, `write`, `list`, `status` and `retry`. It waits for `realm status` to report `active`, then calls `exec` in argv form with `echo` and a random marker (exit code 0, the marker on stdout), and `exec` with `sh -c 'exit 3'` (exit code 3 reported in the result). It calls `write` with a fixed file name in the pinned root and content that holds a random token (the result reports the byte count and SHA-256 of the content), asserts that the file exists in the pinned root on the host with exactly that content, calls `read` and asserts the content comes back equal, and removes the file on the host. It closes the child's stdin, asserts that `realm mcp` exits 0 within 30 s, then runs `realm down` and the residue checks. The child is killed in cleanup if it is still running.
7. MCP exec timeout (the per-call bound of the shared dispatcher). With `realm mcp` started as in scenario 6 and the session active, the suite calls `exec` with `sleep 45`. The per-call bound is a constant 30 s (the exec runner's own deadline is 28 s) and has no parameter. The call must return a tool error with the code `TOOL_TIMEOUT` and `retryable` true, after between 25 and 40 s. The session must stay usable: a following `exec` of `echo ok` exits 0 with `ok` on stdout, `realm status` still reports `active`, and `realm mcp` exits 0 within 30 s of its stdin closing. Then `realm down` and the residue checks.
8. AgentOS runner exit. `realm up` reaches `active`. The suite kills the AgentOS runner inside the sandbox through the sandbox exec. Within 45 s (polled every 2 s; the daemon's health loop runs about every 10 s) `realm status` must report the state `error`, the reason `AGENTOS_CRASH_LOOP` and the label `realm disconnected`. Then `realm down` and the residue checks, and a new `realm up` must reach `active` with exactly one daemon process, followed by the final `realm down` and residue checks.
9. Startup budget (daemon side). The policy sets `startupBudgetMs` to 1, the smallest value the schema admits. `realm up` exits 1 with `STARTUP_BUDGET_EXCEEDED`, `realm status` reports the state `error`, the label `realm disconnected` and the reason `STARTUP_BUDGET_EXCEEDED`, and exactly one daemon process still runs, because the session continues after the expiry. Then `realm down` exits 0 and the residue checks pass. A create that outlives the expired budget may finish later and leave a container, so this scenario waits up to 180 s for the residue and runs one more `realm down` if it remains. It is registered last. It proves the daemon-side budget only: the Omp plugin's own 200 s startup timer is a constant, covered by unit tests and not by this suite, and the 230 s limit of the `up` control request (the 200 s default budget plus a 30 s margin) is not exercised here either.

**Result (2026-10-28, rebuilt image).** The nine scenarios passed 31 of 31 assertions, exit 0, in 6.7 minutes, against Podman 5.7.1 with runc, the hardened seccomp profile (nested user namespaces, the mount family and `clone3` denied) and the 26-property create-time verifier. The earlier result, six scenarios with 28 of 28 assertions, belonged to the previous image. A first run on the new stack failed every scenario that needs a created sandbox (7 of 9; the two that expect a failure passed) because of the rlimit type names described in the verified properties section; that was fixed before the passing run.

**Not in the suite.** The host packet capture on ports 53 and 853 (see the sandbox resolver section above) needs root and `tcpdump`, so it is recorded in this document and is not run by the suite. The suite exercises the tool contract through MCP only; the ACP surface was run live on the same stack on 2026-10-29 by a separate client (67 checks, 0 failed; `docs/integration/acp.md`). The Anda engine is not in scope. The Omp checks are not in the suite; they were run by hand (`docs/integration/omp.md`), and OMP-05 (the write and edit guard when disconnected) needs a model call and stays unproven live. The supervisor binary has no recorded source, and its digest pin is optional (`docs/integration/host-binaries.md`).
