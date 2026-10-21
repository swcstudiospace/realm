# Podman (rootless): hardening flags, resource limits and egress evidence

Gate note for FOUND-03 (decisions D-05, D-16, D-17, D-18). Blocks `src/runtime/podman.ts` (Phase 3).

Read date: 2026-10-21 (ISO 8601).

Local Podman on the development host is version 4.9.3. Per D-05 that install is not changed, and no system package is installed or upgraded in Phase 1.

## Version caveat

The pages read are the Podman documentation at `docs.podman.io/en/latest/`. They are not stamped with a Podman version. The flags below are therefore sourced from the "latest" man pages, not from a 4.9.3 man page. Every flag and default must be confirmed against the 4.9.3 man pages before Phase 3 relies on it. Phase 1 does not run `podman` to check, because D-05 forbids changing the local install and the phase has no Podman work.

The OpenShell documentation requires Podman 5.x for its Podman compute driver (see openshell.md). This is a blocker for any design that uses OpenShell's Podman driver on the 4.9.3 host.

## Official URLs read

- https://docs.podman.io/en/latest/ (documentation index; links the Commands and Reference pages)
- https://docs.podman.io/en/latest/Commands.html (command index; links each man page)
- https://docs.podman.io/en/latest/markdown/podman-run.1.html (`podman run` options)
- https://docs.podman.io/en/latest/markdown/podman-system-service.1.html (`podman system service`, the REST API service)
- https://docs.podman.io/en/latest/Reference.html (API reference index; links the API document)
- https://docs.podman.io/en/latest/_static/api.html (Libpod API document; the fetched body was empty, so no route was verified from it)

## Spec questions and sourced answers

### Q1. Rootless hardening flags

From the `podman run` man page (latest):

- `--cap-drop`: "Drop these capabilities from the default podman capability set, or `all` to drop all capabilities."
- `--security-opt`: the option `no-new-privileges` is documented as: "Disable container processes from gaining additional privileges through the `execve(2)` system call (e.g. via setuid or setgid bits, or via file capabilities)." Other `--security-opt` values are `label=...`, `mask=...`, `unmask=...`, and `seccomp=...`.
- `--read-only`: "Mount the container's root filesystem as read-only." `--read-only-tmpfs` (default true) mounts "a read-write tmpfs on */dev*, */dev/shm*, */run*, */tmp*, and */var/tmp*" when the root filesystem is read-only.
- `--tmpfs=fs`: "Create a tmpfs mount."
- `--userns=mode`: sets the user namespace mode. The rootless modes listed are `keep-id`, `nomap`, and `auto`. The man page notes that `--userns=auto` depends on subordinate ID ranges in the host's subuid and subgid files.

Not documented in the pages read: a `--privileged` default (the page is not read for it), and whether `--security-opt no-new-privileges` is on by default.

### Q2. Resource limits

From the `podman run` man page:

- Memory: `--memory`, `-m` ("Memory limit"), with units b, k, m or g. `--memory-swap` sets memory plus swap.
- CPU: `--cpus=number`. "The default is *0.0* which means no limit." It is shorthand for `--cpu-period` and `--cpu-quota`.
- Processes: `--pids-limit=limit`. "The default is **2048** on systems that support 'pids' cgroup controller." `-1` means unlimited.

The man page notes that some systems do not allow non-root users to change resource limits, and links a troubleshooting page. Whether the rootless runtime enforces these limits on the 4.9.3 host is not documented in the pages read.

### Q3. Egress control

Documented: `--network none`. The `--network` man page lists `none`: "Create a network namespace for the container but do not configure network interfaces for it, thus the container has no network connectivity."

Not documented: an allow-list of host and port pairs for egress, DNS filtering, or any proxy in the Podman pages read. Podman can give a container no network at all. It has no per-destination egress rule in these pages. Realm's default-deny egress (spec `NETWORK_POLICY`) therefore cannot come from Podman alone. Either the container has no network at all, or a separate control (for example OpenShell's policy, see openshell.md) must provide the allow-list.

### Q4. Control socket and the Podman API

From the `podman system service` man page:

- The command "creates a listening service that answers API calls for Podman." It is "usually executed in systemd services" on Linux.
- Socket default: rootless "is `unix://$XDG_RUNTIME_DIR/podman/podman.sock`." Rootful is `unix:///run/podman/podman.sock`.
- Systemd socket activation is supported. Start the user socket with `systemctl --user start podman.socket`.
- `podman system service --time 0 unix:///var/run/mypodman.sock` runs "with no inactivity timeout."
- Security: "the API grants full access to all Podman functionality, and thus allows arbitrary code execution as the user running the API, with no ability to limit or audit this access." Access is controlled by file permissions on the socket, so "only the user running the service will be able to access it."
- Access from a container: "mount the socket as a volume" and "run the container with `--security-opt label=disable`."

Consequence for Realm: the socket must never be mounted into a session container. The spec already requires this (`CONTAINER_LAYER_PODMAN`), and the documentation confirms that mounting it gives arbitrary code execution as the host user.

### Q5. Libpod REST routes

Not verified. No Libpod route is confirmed from a documentation page: the official API document `_static/api.html` returned an empty body when fetched. The routes must be checked against the 4.9.3 API before Phase 3 uses them.

### Q6. macOS and Podman machine

Not documented in the pages read. The `podman system service` page says the command "is not available when the Podman command is executed directly on a Windows or macOS host." Machine behaviour is out of scope for v1 (spec, Linux only), so no answer is needed here.

## Answers not in the docs (D-18 default)

- Egress allow-list: not documented. Realm defaults to no network (`--network none`) and treats any allow-list as an OpenShell or proxy concern.
- Libpod routes: not verified (see Q5).
- Hardening defaults on 4.9.3: not confirmed (see the version caveat).

## Open questions for Phase 3

1. Confirm every flag in Q1 and Q2 against the 4.9.3 man pages, including `--cap-drop`, `--security-opt no-new-privileges`, `--read-only`, `--pids-limit` and `--memory`.
2. Confirm the Libpod routes from the 4.9.3 API document before the adapter uses them.
3. Decide how Realm enforces default-deny egress when Podman has only `--network none` (see openshell.md Q4 for the OpenShell network proxy).
4. The OpenShell Podman driver requires Podman 5.x. Decide whether Phase 3 uses the Podman driver on a host that is currently 4.9.3 (D-05 forbids changing it in Phase 1).

## Module blocked

`src/runtime/podman.ts`, until the flags and routes are confirmed against the 4.9.3 man pages and API.

## Phase 3 resolution

Recorded in `docs/integration/runtime-decision.md` (S-09, OQ-P3-08, OQ-P3-13). Host Podman 4.9.3 is below the 5.x floor, so live suites skip with `PODMAN_UNSUPPORTED_VERSION`. A read-only `podman run --help` on 4.9.3 lists the hardening and limit flags (Q1, Q2). Its help text does not confirm the `no-new-privileges` default, so that item stays live-gated. Libpod routes (Q5) remain unverified and are kept in `src/runtime/libpod-routes.ts` (D-48).
