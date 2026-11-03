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

## Libpod volume API (Phase 19, R2)

Read date: 2026-11-03 (ISO 8601). Scope: the four scratch-volume operations that `src/runtime/libpod-routes.ts` and `src/runtime/libpod-client.ts` use. This section records what the upstream Podman source says about each operation. It changes no code. The routes stay PROVISIONAL (D-48) until the gated integration suite runs them on a Podman 5.x host.

### Sources and read dates

The rendered API document returned no content, so the route facts come from the Podman source at the `v5.7.1` tag of the upstream repository (`github.com/containers/podman`). The swagger annotations in the register file are the upstream API description.

- S1: https://raw.githubusercontent.com/containers/podman/v5.7.1/pkg/api/server/register_volumes.go (route registration and swagger annotations). Read 2026-11-03.
- S2: https://raw.githubusercontent.com/containers/podman/v5.7.1/pkg/api/handlers/libpod/volumes.go (CreateVolume, InspectVolume, ListVolumes, RemoveVolume). Read 2026-11-03.
- S3: https://raw.githubusercontent.com/containers/podman/v5.7.1/pkg/domain/entities/types/volumes.go (VolumeCreateOptions, VolumeListReport, VolumeConfigResponse). Read 2026-11-03.
- S4: https://raw.githubusercontent.com/containers/podman/v5.7.1/libpod/define/volume_inspect.go (InspectVolumeData, the JSON fields of a volume). Read 2026-11-03.
- S5: https://raw.githubusercontent.com/containers/podman/v5.7.1/pkg/api/handlers/utils/errors.go (HTTP status per error class). Read 2026-11-03.
- S6: https://raw.githubusercontent.com/containers/podman/v5.7.1/pkg/errorhandling/errorhandling.go (error body JSON: `cause`, `message`, `response`). Read 2026-11-03.
- S7: https://raw.githubusercontent.com/containers/podman/v5.7.1/libpod/runtime_volume_common.go (NewVolume, the duplicate-name check, the in-use check of removeVolume; the in-use branch was only partly read). Read 2026-11-03.
- S8: https://raw.githubusercontent.com/containers/podman/v5.7.1/libpod/define/errors.go (ErrNoSuchVolume is "no such volume"; ErrVolumeExists is "volume already exists"; ErrVolumeBeingUsed is "volume is being used"). Read 2026-11-03.
- S9: https://raw.githubusercontent.com/containers/podman/v5.7.1/pkg/util/filters.go (parsing of the `filters` query parameter). Read 2026-11-03.
- S10: https://raw.githubusercontent.com/containers/podman/v5.7.1/pkg/domain/filters/volumes.go and https://raw.githubusercontent.com/containers/podman/v5.7.1/pkg/domain/infra/abi/volumes.go (label filter dispatch; VolumeList result type). Read 2026-11-03.
- S11: https://raw.githubusercontent.com/containers/common/main/pkg/filters/filters.go (MatchLabelFilters). Read 2026-11-03 on the main branch, not the pinned version (see O-7).
- S12: https://raw.githubusercontent.com/containers/podman/v5.0.0/pkg/api/server/register_volumes.go (route paths in Podman 5.0.0, read for drift). Read 2026-11-03.
- S13: https://raw.githubusercontent.com/containers/podman/v5.7.1/go.mod (the containers/common version that Podman 5.7.1 pins: `go.podman.io/common v0.66.1`). Read 2026-11-03.
- S14: https://docs.podman.io/en/latest/_static/api.html (the rendered Libpod API document). Read 2026-11-03. The body was empty, as on 2026-10-21, so no route is taken from it.

### Operations

a. Create a named volume (`createVolume`, `libpod-client.ts`).

- Method and path: `POST /v<api-version>/libpod/volumes/create` (S1). The code's route is `POST /libpod/volumes/create`, which matches once the versioned prefix is added.
- Query parameters: none.
- Request body: JSON decoded into `VolumeCreateOptions` (S3). The code sends `Name` (string) and `Labels` (object of string to string). The struct has no JSON tags, so the keys bind by Go field name [INFERENCE: standard `encoding/json` rule, not read on a fetched page].
- Response: 201 with the volume's inspect object (S2, S3). Any error from `NewVolume` is 500 (S2, S5), including a name already in use when `IgnoreIfExists` is false: that error wraps `ErrVolumeExists` and reads "volume with name X already exists: volume already exists" (S7, S8).
- Status codes on the route: 201 and 500 (S1). The swagger lists no 409 for this route.
- Difference from the code: the code maps 409 to `SANDBOX_NAME_IN_USE`. See O-1.

b. Inspect a named volume (`inspectVolume`).

- Method and path: `GET /v<api-version>/libpod/volumes/{name}/json` (S1). The code's route is `GET /libpod/volumes/{id}/json`. Match.
- Query parameters: none.
- Response: 200 with the volume inspect object (S2, S3). `Name` is a top-level field, because `VolumeConfigResponse` embeds `InspectVolumeData` and the embedded fields are promoted in JSON [INFERENCE: standard `encoding/json` rule].
- 404 for an absent volume: `VolumeNotFound` writes 404 for `ErrNoSuchVolume` (S5). The body is `{"cause", "message", "response"}`, with `cause` the root error text (S6), which is `no such volume` (S8).
- Other errors: 500 (S2, S5).
- The code reads `cause === "no such volume"` as absence and requires `Name === name` on 200. Both agree with S5, S6 and S8. Neither is verified against a live host.

c. List volumes with a label filter (`listVolumesByLabel`).

- Method and path: `GET /v<api-version>/libpod/volumes/json` (S1). Match.
- Query parameter `filters`: a JSON object of string to string array (S1). The code sends `{"label":["KEY=VALUE"]}`. S9 turns each entry into `label=KEY=VALUE`, then splits on the first `=`, so the filter value is `KEY=VALUE` (S9, S10). The label filter then splits on the first `=` again into key and value (S11).
- Matching (S11, main branch): a non-empty value must equal the label's value exactly. An empty value (`KEY=`) matches on the key alone, whatever the label's value.
- Response: 200 with a JSON array (S2, S10). Each element is a `VolumeListReport` (S3), so `Name` is a top-level field of each element.
- Other errors, including an unknown filter key: 500 (S2, S10, S5).
- The code requires 200 and a JSON array, and reads `Name` from each element. Both agree with the source.
- The swagger text (S1) documents the label filter as `label=<key>:<value>`, with a colon. The implementation splits on `=` (S9, S11). The code uses `=`. See O-2.

d. Remove a named volume (`removeVolume`).

- Method and path: `DELETE /v<api-version>/libpod/volumes/{name}` (S1). The code's route is `DELETE /libpod/volumes/{id}`. Match.
- Query parameters: `force` (boolean, default false, S1 and S2) and `timeout` (read by the handler, S2, but not in the swagger). The code sends neither, so `force` is false.
- Responses: 204 on success (S2). 404 when the volume is not found, with `ErrNoSuchVolume` (S2, S5). 409 when the runtime returns `ErrVolumeBeingUsed` (S2). 500 otherwise (S2, S5).
- The code treats 200 and 204 as success, and a 404 with cause `no such volume` as already removed. Any other status, including 409, is `SCHEMA_INVALID`, and the volume is never reported as removed. That matches the handler.
- The in-use check: with `force` false, the runtime refuses to remove a volume that still has dependents (S7). The lines that wrap that refusal in `ErrVolumeBeingUsed` were cut off in the read. See O-5.

### Differences from the code and open questions

The code was not changed. Each item below is an open question until it is confirmed on a live Podman 5.x host.

- O-1. Duplicate-name create. `createVolume` in `libpod-client.ts` maps 409 to `SANDBOX_NAME_IN_USE`, with the comment "A volume of that name already present is a 409". Podman 5.7.1 answers a duplicate name with 500, not 409 (S2, S5, S7), and the create route lists no 409 (S1). As written, the 500 reaches `expectStatus`, which throws `SCHEMA_INVALID` (`libpod-client.ts`, `expectStatus`), so the `SANDBOX_NAME_IN_USE` path is not reached for this case. Confirm on a live host. Do not change the code under this record.
- O-2. Label filter syntax. The swagger text (S1) says `label=<key>:<value>`. The implementation (S9, S11) splits on `=`, and so does the code. Open: whether the colon form is accepted at all. It is not tested.
- O-3. Empty label value. The doc comment of `listVolumesByLabel` says it returns volumes whose label has "exactly the given value". The client does not reject an empty value. With an empty value the filter is `KEY=`, which matches any volume carrying `KEY` (S11). Open: whether an empty value can reach the client. If it can, the result differs from the comment.
- O-4. Remove without `force`. The code sends no `force`, so Podman's default (false, S1 and S2) applies. This is consistent with the code's intent. The 409 path for an in-use volume is not confirmed. See O-5.
- O-5. In-use removal status. The source shows that the runtime refuses to remove a volume with dependents when `force` is false (S7), and that the handler sends 409 for `ErrVolumeBeingUsed` (S2). The wrapping lines were not fully read, so the status for an in-use volume is not confirmed. Open.
- O-6. Podman versions. The source read is at v5.7.1, the version the lane measured (`libpod-client.ts`, evidence note). The v5.0.0 register file (S12) shows the same paths and methods for create, exists, list, prune and the libpod inspect and remove routes. Podman 5.1 to 5.6 were not read. Open.
- O-7. Pinned label-filter source. Podman 5.7.1 pins `go.podman.io/common v0.66.1` (S13). The source at that tag could not be fetched (HTTP 404 at both the raw and the blob URLs), so S11 is the main branch. Open.
- O-8. Rendered API document. The rendered API document (S14) returned no content on 2026-11-03. The route facts rest on the upstream source. Open: the rendered swagger for 5.7.1 has not been read.
- O-9. No live check. None of the four operations has been run against a live Podman. The `cause` text, the 404 body, and the 409 in-use status are source-derived. The gated integration suite (S-09, `docs/integration/runtime-decision.md`) is the check.

Q5 above is not changed by this section. It still says the routes are unverified, which remains true for the live host.
