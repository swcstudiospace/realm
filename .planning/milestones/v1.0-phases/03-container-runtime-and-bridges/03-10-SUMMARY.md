# Plan 03-10 Summary: Doctor Phase 3 checks, gated live bodies, taxonomy

Status: done for the unit-verified scope. No live Podman, OpenShell, or Anda behaviour is claimed. The development host runs Podman 4.9.3, so every live body skips with PODMAN_UNSUPPORTED_VERSION and nothing in this phase exercised a real sandbox.

## Files changed

- `src/doctor/checks.ts`: four Phase 3 items (`podman`, `podman-service`, `openshell`, `anda-bridge`) appended after the Phase 2 three (D-69). No AgentOS or control-channel item. `runChecks` is async and runs the items in report order. New optional seams on `DoctorOptions` (`env`, `runCommand`, `connectSocket`, `fetchInformation`, `andaUrl`, `probeTimeoutMs`), each with a real default. The Podman probe runs at most once per call.
- `test/doctor/runtime-checks.test.ts` (new): 21 tests. Every seam is a fake, so no process runs and no socket opens.
- `test/doctor/checks.test.ts`: the 16 Phase 2 tests become async and await `runChecks`. The registry expectation is the seven IDs. The absence assertion narrows to `agentos|control`. No other assertion changed.
- `test/integration/podman-gate.test.ts`: the stale import now points at `../../src/runtime/podman-version.js`. Three gated live bodies: RT-01 (hardening of a created container), RT-03 (argv and session label), RT-09 (zero-orphan sweep).
- `test/quality/suite-taxonomy.test.ts`: the stale import is fixed. `runtime` and `anda` are added to the category directories and the category map. The 19 new Phase 3 test files are added to the D-45 list. A ten-ID coverage test sits beside the kept Phase 2 test.

## Tests

- `npx tsc -p tsconfig.json`: exit 0, no errors.
- `npx eslint` on the five owned `.ts` files: no issues.
- `node --test dist/test/doctor/checks.test.js dist/test/doctor/runtime-checks.test.js dist/test/integration/podman-gate.test.js dist/test/quality/suite-taxonomy.test.js`: 60 tests, 56 pass, 0 fail, 4 skipped. The skips are the Podman probe gate and the three live bodies, each reporting PODMAN_UNSUPPORTED_VERSION.

## Requirement evidence

- RT-02 (unit): podman and podman-service pass, fail, or warn with fixes. Raw command output and socket error text never reach a detail.
- RT-03 (unit): openshell passes on every pinned create flag, warns on drift and names the missing flag, and fails with the 0.1.2 install fix. It receives only the allowlisted environment. RT-03 live body: gated, not run.
- ANDA-02 (unit): anda-bridge passes on the AppInformation shape. It fails with ANDA_UNREACHABLE and the engine-URL fix, or with ANDA_VERSION_MISMATCH and the shape fix. It warns when no URL is set and contacts nothing. A URL with user information is refused without contact.
- RT-01 and RT-09: unit-verified in `hardening.test.ts`, `config.test.ts`, `libpod-client.test.ts` and `down-sweep.test.ts`. The gated live bodies in `podman-gate.test.ts` add a live check that has not run.
- The ten-ID taxonomy test passes against the named files.

## Deviations and defaults applied

- The `podman` item passes on PODMAN_MACHINE_DOWN, because that code is reached only after the version step has passed. The socket is reported by `podman-service`.
- `podman-service` warns, rather than passing, when the version step failed and the socket was never inspected. The plan said "passes otherwise", which I read as covering a reachable socket.
- The OpenShell pinned flag list is derived from `buildCreateArgv`, not copied. A drifted CLI produces a warn. A non-zero exit or a failure to start produces a fail.
- The Anda default fetch lives in `checks.ts`, because this plan may not edit `src/anda/`. It mirrors the bridge's request: anonymous GET, host and port from the URL, no path prefix, no credential. A reply above 64 KiB is reported as unreachable. The bridge reports the same case as a mismatch.
- The live bodies call `runOpenShellCreate` directly, not `SessionExecution`. The RT-09 body runs the production `removeAllRealmContainers` through a client scoped to the containers the test creates, so other realm-labelled containers on the host are untouched. No concrete AgentOS driver exists (OQ-P3-05, OQ-P3-06), so `start` cannot be exercised. Each live body also needs `REALM_LIVE_IMAGE` and `REALM_LIVE_WORKLOAD`, a rootless Podman API socket and an `openshell` CLI on PATH, and skips with a stated reason when any is missing.
- The ten-ID coverage test excludes the taxonomy file itself from its search. The Phase 2 test does not exclude it.
- The Phase 2 checks test in `test/doctor/checks.test.ts` injects fake seams (`env`, `runCommand`, `connectSocket`) for the Phase 3 items, so no process runs and no socket opens in it. Only the Phase 2 outcomes and the seven registered IDs are asserted there.

## Open items

- The OpenShell help output is assumed to be on stdout, and clap-style flag tokens are assumed. Confirm both on a real 0.1.2 install (OQ-P3-12).
- The three live bodies are unverified until a Podman 5.x host runs them with a digest-pinned image.
