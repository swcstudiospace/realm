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
| `CreateSandbox` | Runs the create checks, stores the launch material, prepares the channel (a TLS identity for the runtime, and the runtime's bootstrap, descriptor and auth bundle, checked to agree before any libpod call), then `DriverLifecycle.create`. The create writes the bootstrap, descriptor and auth bundle, and checks the CA tmpfs and channel mount options, before the container starts. The sandbox runtime is the container's main process, `/usr/local/lib/realm/openshell-sandbox --bootstrap /run/openshell/channel/bootstrap.json`; there is no exec route. After the container is verified, the driver waits until a TLS handshake with the runtime's listener completes on its control socket (trusting the CA certificate, under the leaf's server name), removes the runtime's `server.key`, and starts the host supervisor. The CA private key is removed once the leaf certificate is issued, and the CA certificate stays in the descriptor as its trust anchor. A supervisor that exits before the sandbox is Ready refuses the create. One that exits later stops the container and reports the sandbox not Ready, with reason `supervisor-exited`. Records the gateway's sandbox id, workspace and container name, under the gateway's name. | `INVALID_ARGUMENT` on refusal, including a state directory already present for the name, and a control socket path longer than 107 bytes; `ALREADY_EXISTS` when a container of the name exists and its state directory does not. |
| `GetSandbox` | Reads the labelled container and the registry entry, reporting the gateway's name. | `NOT_FOUND` when the driver does not hold the sandbox. |
| `ListSandboxes` | Lists, under the gateway's name, the sandboxes that have a registry entry and a labelled container. | none |
| `WatchSandboxes` | Sends every sandbox on connect, then each change, and each removal as a deleted event. Polls until the client cancels. | none |
| `StopSandbox` | Refused. Reads and changes no state (PD-08). | `FAILED_PRECONDITION` |
| `StartSandbox` | Refused. Reads and changes no state (PD-08). | `FAILED_PRECONDITION` |
| `DeleteSandbox` | Stops the host supervisor first (SIGTERM, then SIGKILL after a bounded wait), then runs `DriverLifecycle.delete`, then clears the registry. Idempotent. A name whose container another registered sandbox holds deletes nothing. | `deleted` is false for a sandbox that is already gone. |
| `EnsureWorkspace` | Checks the id and the pinned workspace root (`REALM_DRIVER_WORKSPACE_ROOT`). Creates nothing. Refuses a root that is missing, a symbolic link, not a directory, relative, or not owned by the driver's account. | `INVALID_ARGUMENT` on refusal. |
| `DeleteWorkspace` | Refused. The pinned workspace root is never removed, empty or not, and nothing is read or changed. | `FAILED_PRECONDITION` |

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

Sandbox names. The gateway's name is used as given, and the container runs under the `realm-` prefixed name. A name that
already starts with `realm-` is unchanged. Any other name gets the prefix, and the prefixed name must pass the
container-name pattern and length rule (at most 128 characters). A name that fails is refused with `SCHEMA_INVALID`. The
container name, the state directory name and the sandbox-name label carry the prefixed name. The driver's registry maps
the gateway's name to it, so `GetSandbox`, `ListSandboxes`, `WatchSandboxes` and `DeleteSandbox` take and report the
gateway's name. Two names that give one container name, such as `x` and `realm-x`, cannot both be sandboxes: the second
create is refused, because the first sandbox's state directory exists.

Directories. A create prepares directories before the lifecycle runs. The workspace is the pinned root, `REALM_DRIVER_WORKSPACE_ROOT`: the sandbox's `/workspace` is that root, bound read-write, and nothing is created under it. The state directory is created at 0700 under the state root, and it must not
already exist. The create also makes the sandbox's secret directory `<secretRoot>/<container name>` at 0700. It holds
`launch.json`, the channel directory (0700, with `bootstrap.json`, `server.crt`, `server.key` and `control.sock`),
`descriptor.json` and `auth.json` (all 0600), and the supervisor's exit-marker path. The driver removes `server.key` from the channel
directory once a TLS handshake with the runtime's listener completes, and removes the CA private key from the TLS work directory once
the leaf certificate is issued; the CA certificate stays in the descriptor as its trust anchor. If the create refuses after any of
these exist, the state directory and the secret entries this call made are removed. The workspace is left in place.
The state, secret and workspace roots are set in the driver's environment for the realm account. The rendered gateway
configuration does not set them.

The sandbox binding is one derivation, `sandboxBindingOf` (`src/runtime/driver/sandbox-binding.ts`). For a sandbox name it gives the workspace (the pinned root, mounted read-write at `/workspace`), the state directory `<state root>/<container name>` (mounted read-only at `/realm-state`), and the channel directory `<secret root>/<container name>/channel` (mounted read-write at `/run/openshell/channel`). The driver builds its create from it and verifies the container against it. The session's verifier takes the same binding, with the state root the driver is given as `REALM_DRIVER_STATE_ROOT`, and its workspace is the pinned root from `REALM_DRIVER_WORKSPACE_ROOT`, not the root named in the create request. `REALM_DRIVER_STATE_ROOT` is the directory the driver mounts per-sandbox state from (sandboxes live beneath it as `<root>/<name>`), not the realm state directory. The daemon and the driver must be given the same three roots: `REALM_DRIVER_STATE_ROOT`, `REALM_DRIVER_SECRET_ROOT` and `REALM_DRIVER_WORKSPACE_ROOT`. The session refuses a create when any of the three is missing or relative.

### Built-in runtime (phase 9.5)

- The driver serves the compute socket only.
- The three required variables are `REALM_DRIVER_GATEWAY_CA` (absolute readable PEM file), `REALM_DRIVER_SUPERVISOR_BINARY` (absolute executable file) and `REALM_DRIVER_GATEWAY_ENDPOINT` (https URL). The driver refuses to start with `SCHEMA_INVALID` when one is missing or invalid, and echoes no value.
- The sandbox image must contain `/usr/local/lib/realm/openshell-sandbox`.
- The runtime's user namespace maps the realm account to uid and gid 1001 (`podman` keep-id, `uid=1001,gid=1001`). This is not yet verified on a live host.
- The rendered gateway configuration selects `isolation_backend = "openshell-sandbox"` in the `[openshell.drivers.<name>]` table and writes no `[[openshell.supervisor.isolation_backends]]` section.

### SSH socket (phase 9.6)

- The host supervisor's SSH socket is `ssh/ssh.sock` in the sandbox's secret directory. The supervisor creates the `ssh/` directory at 0700 and the socket at 0600. The driver passes the path as `--ssh-socket-path` and sets no environment variable for it.
- The socket sits outside every container mount. The secret directory is never bind-mounted. The channel mount holds only the runtime's bootstrap, certificate, key and control socket, and the `/run` and CA tmpfs mounts are separate. The socket is never under the channel directory or a tmpfs.
- A unix socket path holds at most 107 bytes. The driver checks the SSH socket path with the control socket path at create and refuses a sandbox name that makes either one longer, with `SCHEMA_INVALID`. Nothing is truncated.
- The driver does not set `OPENSHELL_SSH_SOCKET_SHARED`, which widens the socket to 0660. Shared mode is not used because the socket stays private to the host supervisor's user.
- The supervisor refuses to start with an SSH socket path and no SSH host key. The driver checks the key before it spawns the supervisor and refuses with `SCHEMA_INVALID`, naming no key material.
- `openshell sandbox exec` depends on this socket. Without it the exec fails with "SSH access is not configured for this supervisor".

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

## Runtime image build (phase 9.5)

`sandbox/Dockerfile` builds `/usr/local/lib/realm/openshell-sandbox`, the runtime the driver starts, in a `runtime-builder` stage. The stage builds the upstream source itself and does not copy a host binary.

- **Base.** `docker.io/library/rust:1.95.0-bookworm`, pinned by the digest of its OCI image index. The toolchain is 1.95.0, the channel in the upstream `rust-toolchain.toml` at the pinned commit. The base is bookworm, glibc 2.36.
- **Source.** `OPENSHELL_REVISION` names one full commit. The default is `bdb956f2cd65a635f1294fccf1d138d263bf650f`, tag `v0.1.5`. The stage fetches that commit at depth 1 from `https://github.com/NVIDIA/OpenShell`, fails unless `HEAD` equals the argument, checks the upstream toolchain channel, and removes the `.git` directory. An override names another commit. That build is unpinned: the gates still apply, but the commit has not been reviewed here.
- **Build.** `cargo build --locked --release -p openshell-sandbox`, using the source's own `Cargo.lock`. Crates come from crates.io at build time.
- **glibc gate.** The stage reads the `GLIBC_` version needs with `readelf` and fails when any is newer than `GLIBC_2.36`. It prints the highest version. A build of this commit on a glibc 2.39 host needs `GLIBC_2.38` and `GLIBC_2.39`, so a binary built that way cannot run in this image. That comparison comes from a local build, not from the image.
- **Dependency gate.** The stage fails unless the program interpreter is `/lib64/ld-linux-x86-64.so.2` and every needed library is in the glibc set, is `libgcc_s.so.1`, or is the dynamic loader's own soname `ld-linux-x86-64.so.2`. The runtime stage then runs `ldd` on the copied binary and fails on any `not found` line. That line also covers a GLIBC version that the image's glibc lacks.
- **Labels.** The runtime stage records `io.realm.runtime.sha256` from the `RUNTIME_SHA256` build argument. The gate fails unless that value matches the copied binary. It records `io.realm.runtime.revision` from `OPENSHELL_REVISION`. The gate proves that the image holds the binary whose digest was supplied. It does not compare that binary with an external reference.
- **Network.** Build time only. The `runtime-builder` stage uses apt (`git`, `cmake`), the GitHub fetch and crates.io. The runtime stage's `npm ci` already used the npm registry. The image has no network at run time.
- **Architecture.** The gates expect x86-64. On another architecture the interpreter gate fails.
- **Packages.** `cmake` is needed by the `aws-lc-sys` build script. The apt packages come from the Debian bookworm archive and are not pinned to a version.

To build the image, first build `--target runtime-builder` to read the sha256 the stage prints. Then build the full image with `--build-arg RUNTIME_SHA256=<that digest>`. A later build that produces a different binary fails the runtime gate.

## Sandbox create hardening: sysctls

- The sandbox runtime needs `net.ipv4.ip_unprivileged_port_start` set to `0` in the sandbox network namespace. The Podman create body carries it as `sysctl`, together with the two IPv6 keys below, and no other sysctl is set there.
- The sysctl is per network namespace. The sandbox has no network, so only loopback is affected.
- The sandbox runtime checks the sysctl itself at startup and refuses to run when it is not `0`. That check is the fail-closed guard. It lives in the runtime, outside this repository, and this repository does not verify it.
- Podman 5.7.1 does not report sysctls in inspect, so the driver does not verify the sysctl there.
- Exposure is wider than the runtime needs. With the sysctl at `0`, any loopback port below 1024 becomes bindable, for the workload uid as well. This is referred to the A10 security review.
- IPv6 is disabled in the sandbox network namespace: `net.ipv6.conf.all.disable_ipv6` and `net.ipv6.conf.default.disable_ipv6` are both `1`. The sandbox has IPv4 loopback only, and `::1` is not configured on `lo`. RT-05 requires IPv6 off in the sandbox. Before this change the live sandbox had IPv6 on: `/proc/sys/net/ipv6/conf/all/disable_ipv6` read `0`, and `::1` was on `lo`.
- The driver does not verify the IPv6 keys at inspect either, for the same reason as the low-port sysctl above.

## Sandbox resolver

- The runtime image bakes `sandbox/resolv.conf` at `/etc/resolv.conf`. It holds one line, `nameserver 127.0.0.53`. The Dockerfile copies it root-owned and mode 0444 after the last `RUN` of the runtime stage.
- Why: the image's previous file named public resolvers (`1.1.1.1`, `1.0.0.1`), so no hostname ever resolved. Node connects to an allowlisted hostname failed with `EAI_AGAIN`, and so did connects to a non-allowlisted one.
- The create body sets `use_image_resolve_conf: true`, which makes the container use the image's file in every network mode. It sets no `dns_server`, because Podman refuses `dns_server` with network none.
- Podman generates no `resolv.conf` for network mode none: inspect reports an empty `ResolvConfPath`, and mountinfo shows no mount at `/etc/resolv.conf`. The image's file is therefore the only one the container sees.
- The runtime's DNS relay listens at `127.0.0.53:53`. It binds a port below 1024 in the sandbox namespace, so it needs the `net.ipv4.ip_unprivileged_port_start` sysctl described above.
- Live evidence (2026-10-28, production stack, Podman 5.7.1, OpenShell 0.1.5): an image with this file, run under the production flags (network none, read-only) behind the realm gateway, with the realm-rendered policy allowing `1.1.1.1:443` and `example.com:443`. The allowed IP connected. A non-allowlisted IP failed with `EACCES`. The allowlisted hostname connected, with DNS going through the relay. A non-allowlisted hostname failed with `EACCES`. An IPv6 literal failed with `EACCES`. An AAAA lookup returned `ENODATA`.
- The upstream Podman driver mounts a resolver file with the same content and sets `use_image_resolve_conf`. The upstream Docker driver sets `Dns` to `127.0.0.53`.
- The resolver file is part of the image, so the image-digest property covers it: a different resolver file is a different image digest.

## Sandbox create hardening: seccomp profile (phase 9.6)

Every sandbox container runs under Podman's default seccomp profile with the three keyring syscalls denied with `EPERM`. The profile is vendored in `src/runtime/driver/seccomp-profile.ts`, written to a file by the driver, and named in the create request.

- **Why.** The keyring syscalls were reachable from the sandbox. Observed live: Podman's default profile lists `keyctl` as allowed, and the in-container runtime's own filters do not block it. A workload process described and read the realm account's user keyring by serial (the read returned zero keys). The sandbox and the realm account share one kernel uid under keep-id, so the workload sees the account's keyring. PRD-ENF-03 asks that `keyctl` return `EPERM`. The owner chose to close the exposure by vendoring the default profile without `keyctl` (2026-10-28).
- **Base.** `pkg/seccomp/seccomp.json` of the `containers/container-libs` repository, module `go.podman.io/common` v0.66.1, the version Podman 5.7.1 pins in its `go.mod`. 17525 bytes, SHA-256 `886ae167646b7e5db381ecf7c31e6de720a8e8da15cf3202fe1f67f424af2b75`. Licence: Apache-2.0. Its default action is `SCMP_ACT_ERRNO` with errno 38 (`ENOSYS`).
- **The one transformation.** `keyctl` is removed from the rule that allows it, and one explicit rule `{ names: [add_key, keyctl, request_key], action: SCMP_ACT_ERRNO, errnoRet: 1 }` (errno `EPERM`) is added right after the first upstream rule. The explicit rule is needed because the default errno is `ENOSYS`: removing `keyctl` alone would answer `ENOSYS`, not `EPERM`. `add_key` and `request_key` are not listed upstream, so they would fall to the default and answer `ENOSYS`; they are named in the rule so all three answer `EPERM`. Every other rule is upstream's. The vendored file keeps upstream's tab formatting, so a text diff against the upstream file shows only these two changes.
- **Vendored profile.** 17727 bytes, SHA-256 `123be34e33655dc4a32d108b05529f1b3562a109be95ba12ea95727d69aed759`. The module's header comment records the upstream project, version, licence, file, source digest and the transformation.
- **Delivery.** `installSeccompProfile` (`src/runtime/driver/seccomp-delivery.ts`) runs at the start of `startDriver`, before the driver's socket is bound and before any request is accepted. It writes the profile into a `seccomp` directory next to the driver socket, inside the socket's parent directory, which the driver already holds to mode 0700 and the account's ownership. The directory is mode 0700 and the file is mode 0600, written through the atomic write helper. The file is never a container mount source: a sandbox mounts only its workspace, its state directory and its channel directory, and the lifecycle refuses a workspace or state directory that holds a socket, which the driver's own socket in the same parent would be. The workload shares the account's kernel uid, so file permissions alone would not stop it; keeping the directory out of every mount does.
- **Name rule.** The file is named `realm-seccomp-<first 16 hex of the profile's SHA-256>.json`, here `realm-seccomp-123be34e33655dc4.json`. The name carries the digest, so an existing file of that name with different content is tampering or damage, not an older version: the driver refuses to start (`SCHEMA_INVALID`, no path in the message) and does not overwrite it. A file of that name with the profile's content is left as it is, so a second start changes nothing.
- **Other refusals.** The driver also refuses to start when the `seccomp` directory is a symbolic link, is not a directory, belongs to another account, or is writable by the group or others, and when the file is not a regular file owned by the account or is writable by the group or others.
- **Create body.** The libpod create body carries `seccomp_profile_path` with the absolute path of that file (Podman 5.7.1 accepts the field). A libpod client built without the path refuses every create, so no sandbox starts without the profile.
- **Verifier.** The property `seccomp-keyring` is in `HARDENING_PROPERTIES` (`src/runtime/hardening.ts`). It ignores `HostConfig.SecurityOpt`, the annotations and `Config.CreateCommand`, because an API-created container shows no `seccomp=` entry there. Its evidence is the container's OCI config, read before verification by `attachSeccompEvidence` (`src/runtime/seccomp-evidence.ts`) through the inspect's `OCIConfigPath`. The path must be absolute and must equal the inspect's `StaticDir` joined with `config.json` (the real inspect reports `OCIConfigPath` as `config.json` inside `StaticDir`, the container's `userdata` directory; a `..` segment in `StaticDir` is refused), so a forged inspect value cannot point the read at another file. The file is read through an injectable reader (`readOciConfig`, as `readProcStatus` is), by default a host read bounded to 1 MiB. The property passes only when `linux.seccomp` exists with default action `SCMP_ACT_ERRNO`, and for each of `keyctl`, `add_key` and `request_key` at least one rule lists it with action `SCMP_ACT_ERRNO` and `errnoRet` exactly 1, and no rule lists it with another action or another `errnoRet` (a missing `errnoRet` is not 1). Rules whose `names` is not an array, and non-string names, are ignored for matching. A missing or relative path, a path outside `StaticDir`, an unreadable, oversize or unparseable file attaches nothing, and the property fails closed. A daemon that cannot read the config file therefore refuses the create. An inbound `SeccompKeyringDenied` field from the engine is dropped before the read. Both verifiers run it: the driver's post-start check (`src/runtime/driver/lifecycle.ts`) and the session's `verifyOrRemove` (`src/runtime/session-execution.ts`). The hardening evidence digest covers the profile file name, so it changes with the profile.
- **Re-sync on a Podman upgrade.** Fetch `pkg/seccomp/seccomp.json` of the `containers/common` version the new Podman pins in its `go.mod`. Apply the same transformation. Compare the result with the vendored profile: the text diff should be the `keyctl` removal, the added rule, and whatever upstream changed. Update `src/runtime/driver/seccomp-profile.ts`, its recorded source digest, and the digests and file name in this section. Then re-run the seccomp tests (`test/runtime/driver/seccomp-profile.test.ts` and `test/runtime/driver/seccomp-delivery.test.ts`).
- **Observed (Podman 5.7.1, 2026-10-28).** A container created through the libpod API with `seccomp_profile_path` runs under the profile. Its OCI runtime config (`config.json`) holds `linux.seccomp` with default action `SCMP_ACT_ERRNO`, default errno 38, 25 rules including `{ names: [add_key, keyctl, request_key], action: SCMP_ACT_ERRNO, errnoRet: 1 }`, and allow rules for `landlock_create_ruleset`, `landlock_add_rule`, `landlock_restrict_self` and `seccomp`. A `keyctl` call inside that container returned `-1` with errno 1 (`EPERM`). Inspect does not show the profile for such a container: `HostConfig.SecurityOpt` is only `["no-new-privileges"]` and the annotation `io.podman.annotations.seccomp` is absent. Podman builds the `seccomp=<path>` entry of `SecurityOpt` from that annotation, and only the `podman` CLI sets it, so a container created by the CLI shows `seccomp=` and an API-created one does not.
- **Not claimed.** The verifier does not compare the whole profile with the vendored file: Podman filters and expands the rules by capability and architecture, so the applied rules are not the file's rules verbatim. The verdict covers the three keyring syscalls and the default action only. The content guarantee for the rest rests on the digest-bearing file name and the driver's refusal to start on a file of that name with other content. The proof reads the config at create time only; it does not re-verify later.

## CLI and gateway pin: 0.1.5 (verified 2026-10-26)

- The OpenShell CLI and gateway are 0.1.5. The realm's verbs were re-verified against that version on 2026-10-26.
- Create: `openshell sandbox create --name realm-<sessionId> --policy <path> --no-auto-providers --detach --cpu <n> --memory <size>`, with `--from <image>` for the configured image. The create passes no `--no-keep`, so the sandbox lasts until `realm down` deletes it.
- Exec: `openshell sandbox exec --name realm-<sessionId> --workdir /workspace --no-tty --no-login-shell -- <argv>`. The AgentOS runner and its probe use this form.
- Delete: `openshell sandbox delete realm-<sessionId>`.
- One sandbox per session. The session's create makes the only sandbox, `realm-<sessionId>` (the daemon's session is `daemon`, so its sandbox is `realm-daemon`), and AgentOS is its workload. Start runs the runner as a managed exec child in that sandbox and waits for its probe. No second sandbox is created. The sandbox image is the configured digest-pinned `image` (`config.image`), the only image source: no environment variable changes it.
- Stop path (phase 9.6): `stop` and `destroy` delete the session's sandbox `realm-<sessionId>`. It is deleted once: a repeated stop makes no second delete call. The session's sandbox name is known before the container step in three cases: the container id is a realm sandbox name; the container id is one this daemon's create returned (recorded when the create returns it); or the container's sandbox-name label, which inspect reads. The name is kept until its delete succeeds, so a `destroy` retried after a failed delete still deletes the sandbox, even once the container is gone. A libpod error in a container step, including an inspect that rejects, does not skip the delete when the name is known, and that libpod error is then the one reported. The record is held in memory by the daemon process, so it does not survive a restart.
- A stop or destroy that names a sandbox with a session create in flight waits for that create, stops and deletes the container it produced, and reports success only after the delete finishes; the create then fails with OPENSHELL_START_FAILED and is not reported as active. That wait is bounded by the stop deadline (15 s). If it expires, the stop still stops and deletes what it knows, then reports AGENTOS_STOP_FAILED with the catalogue reason, which says the sandbox delete may still be pending, and never reports success.
- Open items, not fixed in phase 9.6: (1) a container id this daemon did not create, after a restart, whose inspect rejects has no known name, so its sandbox delete is skipped. (2) A create still running when a stop's wait expires finishes later and nothing removes the container it produces. (3) The compute driver's `DriverLifecycle.delete` path, which the gateway `DeleteSandbox` RPC reaches, removes containers and secret directories through libpod and does not run `openshell sandbox delete`, so an OpenShell sandbox removed through that RPC is not deleted here.
- A create command is not run in 0.1.5. A create with `-- <command>` and `--detach` does not run the command, and the marker the command writes never appears. Without `--detach` the CLI opens an interactive shell. So the AgentOS runner never starts from create. The realm starts it as a long-lived `sandbox exec` child after create (`src/runtime/agentos-workload.ts`). Live evidence: a runner started by the exec form above and held open wrote its heartbeat within 20 s, and the probe with the same exec flags exited 0.
- The runner's heartbeat file lives in `/tmp` (the container's tmpfs scratch, granted read-write by the realm policy), never in the workspace, so the user's project receives no realm files.
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
- With an allowlist, the allowed `host:port` connects, and a non-allowlisted host and an IPv6 literal fail (verified live on 2026-10-28).
- With an allowlist, AAAA returns no data (verified live on 2026-10-28).
- `realm down` leaves zero containers, sandboxes, supervisors and secret directories.
- A wrong image digest fails closed.

Decisions recorded with this evidence:

- One sandbox per session, named `realm-<sessionId>`.
- `active` needs no Anda bridge when no `andaUrl` is configured.
- One live sandbox per pinned root.
- The runtime's policy is the enforcement authority, and the retired realm helper is removed (recover it from git history if needed).
