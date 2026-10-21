# Plan 03-02 Summary: Podman version parser, prerequisite probe, RuntimeConfig validation

Status: done for the unit-verified scope. Live Podman behaviour is not verified (host Podman is 4.9.3; no live call in this plan).

## Changes

- `src/runtime/podman-version.ts`: the version parser moved from `test/integration/podman-version.ts` with its bodies unchanged. Header rewritten: the I/O now lives in `podman-probe.ts` (D-53). Old file deleted, no re-export (RT-02).
- `src/runtime/podman-probe.ts`: `probePodman({ runCommand, connectSocket, env, timeoutMs })` with injected I/O. Steps run in order and stop at the first failure: (1) `podman --version` as argv with no shell and a minimal environment (`PATH`, `HOME`, `XDG_RUNTIME_DIR` only); (2) version gate through the moved parser; (3) dial of `$XDG_RUNTIME_DIR/podman/podman.sock`. Reasons are the `ERROR_CATALOGUE` text plus the specific detail. Raw stdout and raw socket error text are never copied into a reason (RT-02, D-53).
- `src/runtime/config.ts`: `RuntimeConfig` type and `loadRuntimeConfig(input: unknown)`, hand-written with no schema and no ajv (RT-01, D-52, D-73). Image must be digest-pinned. `andaUrl` must be `http:` or `https:` with no userinfo. `workloadArgv` is a non-empty array of non-empty strings and is copied. `stateDir` and `workspaceRoot` must be absolute. Unknown keys are rejected. All violations give `SCHEMA_INVALID`.
- `test/runtime/podman-version.test.ts` (moved; only the import changed), `test/runtime/podman-probe.test.ts`, `test/runtime/config.test.ts`.
- Deleted: `test/integration/podman-version.ts` and `test/integration/podman-version.test.ts` (the move source). Their compiled output under `dist/` was removed as well.

## Tests

- `node --test dist/test/runtime/podman-version.test.js dist/test/runtime/podman-probe.test.js dist/test/runtime/config.test.js`: 40 pass, 0 fail, 0 skipped.
- Probe: ENOENT, non-zero exit and timeout give `PODMAN_MISSING`; 4.9.3 and unparseable output give `PODMAN_UNSUPPORTED_VERSION` naming the version and the 5.x need; refused, missing and unresponsive sockets, and an unset `XDG_RUNTIME_DIR`, give `PODMAN_MACHINE_DOWN` with the `systemctl --user start podman.socket` fix; 5.x with a socket passes; probing stops at the first failure; the version command receives only the three permitted environment names; raw error text is not echoed.
- Config: digest image accepted; tag-only and malformed digests rejected; userinfo (including `:@`) rejected; non-http(s) and unparseable URLs rejected; empty or malformed argv rejected; relative paths rejected; missing and unknown keys rejected; argv copied.
- `npx eslint` on the six owned files: clean.
- `npx tsc -p tsconfig.json`: exit 2. No error comes from an owned file. The errors are in `test/integration/podman-gate.test.ts` and `test/quality/suite-taxonomy.test.ts` (both still import the deleted parser path; owned by plan 03-10) and `test/runtime/libpod-client.test.ts` (a sibling plan's in-progress file).

## Requirement evidence

- RT-02: parser and probe tests above (unit-verified). The probe is not yet wired into the doctor or the gate; plan 03-10 does that.
- RT-01: config tests above (unit-verified). The hardening verifier is a separate plan.

## Deviations and defaults applied

- `andaUrl` is optional in `RuntimeConfig`. D-69 needs a "not configured" state for the doctor, so an absent key is accepted and the loaded config omits it. When present it is validated.
- `loadRuntimeConfig` rejects unknown keys (fail closed). The plan did not specify this.
- The deleted `test/integration/podman-version.test.ts` is outside this plan's `files_modified`. It was deleted as the move source, because it would otherwise import a missing module.
- Relative paths give `SCHEMA_INVALID` (D-73, resolves F-P3-02), not `POLICY_DENIED`.
- No real `runCommand` or `connectSocket` implementation is provided here. Those are injected; the doctor wiring (plan 03-10) supplies them.

## Open items for other plans

- `test/integration/podman-gate.test.ts` (plan 03-10) must import from `../../src/runtime/podman-version.js`.
- `test/quality/suite-taxonomy.test.ts` must import from `../../src/runtime/podman-version.js`. Its `D45_FILES` list also needs the new runtime test files.
