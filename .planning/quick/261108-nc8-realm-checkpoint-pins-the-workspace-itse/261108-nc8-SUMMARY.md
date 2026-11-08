---
phase: quick-261108-nc8
plan: 01
subsystem: checkpoint
tags: [RES-04, checkpoint, stopped-project, daemon-absent]
status: complete
requirements: [RES-04]
key-files:
  modified:
    - src/daemon/channel.ts
    - src/session/workspace-registry.ts
    - src/cli/checkpoint.ts
    - src/cli/main.ts
    - test/daemon/channel.test.ts
    - test/session/workspace-registry.test.ts
    - test/cli/cli.test.ts
    - docs/checkpoint.md
    - docs/integration/runtime-decision.md
  created:
    - test/cli/checkpoint-stopped.test.ts
commits:
  - 835fb9c feat(checkpoint): add the typed no-daemon signal and the shared workspace entry constructor
  - 455671a feat(checkpoint): pin a stopped project in memory for realm checkpoint (RES-04)
---

# Quick 261108-nc8: realm checkpoint pins a stopped project in memory

`realm checkpoint create|restore` now works for a project stopped with `realm down`: the command pins the workspace itself, in memory, and writes and removes no registry file.

## What changed

- `src/daemon/channel.ts`: exported `DaemonAbsentError extends RealmError` (code `REALM_NOT_ACTIVE`, no cause). `dial` throws it only for an errno `ENOENT` or `ECONNREFUSED` from the socket. A dial timeout stays `TOOL_TIMEOUT`, and a peer that closes before replying stays a plain `REALM_NOT_ACTIVE`. No message text is matched, and no caller of the client changes.
- `src/session/workspace-registry.ts`: exported `workspaceEntryOf(pinned, sessionId)`. `writeWorkspaceEntry` calls it first, before touching disk, so the write path and the CLI build the same value.
- `src/cli/checkpoint.ts`:
  - `pinStoppedProject(selection, policy, ceiling)` reuses `bindWorkspaceUnderPolicy`, `isInsideRoot` and `workspaceEntryOf`, which are the rules `resolveSelection` applies for `up`.
  - With no registry entry the command loads the policy (`defaultPolicyPath(stateDir)`), binds the configured workspace root and pins before the daemon is connected. Any failure there is a refusal. A registered project takes today's path with no policy read and no Podman call.
  - The `sandboxRunning` predicate repeats its proof on every call. An answering daemon decides (`unbound` is stopped). `DaemonAbsentError` for an in-memory entry sends the question to Podman through the libpod inspect of `realm-<session id>`, bounded by `withTimeout` (`PODMAN_PROOF_TIMEOUT_MS`). Only `null` is stopped. Every other status failure, and `DaemonAbsentError` for a registered entry, refuses `REALM_NOT_ACTIVE` without consulting Podman. The `daemonSilent` flag became `proofFailed`.
- `src/cli/main.ts`: `CliDeps` gained the optional `readPolicy` and `inspectContainer` seams.
- Docs: `docs/checkpoint.md` ("Stopped projects" rewritten, the `REALM_UNBOUND` row removed, the `REALM_NOT_ACTIVE`, `POLICY_DENIED` and `SCHEMA_INVALID` rows extended, and a note that a leftover registration with no daemon is refused and that `realm up` then `realm down` clears it). `docs/integration/runtime-decision.md`: the open item is replaced by decision 7 of D19-9, dated 2026-11-08, an owner decision, with the two rejected designs.

## Tests

- `test/daemon/channel.test.ts`: missing socket and a regular file at the path yield `DaemonAbsentError` (still a `RealmError` with `REALM_NOT_ACTIVE`); a silent peer is `TOOL_TIMEOUT` and a peer that drops the connection is a plain `REALM_NOT_ACTIVE`, neither being `DaemonAbsentError`. The dial-timeout case is not tested directly: a connect to a listening unix socket completes at once, so a deterministic dial timeout needs a seam that does not exist. The code path is a RealmError from `dialWithin` and cannot satisfy the errno test.
- `test/session/workspace-registry.test.ts`: `workspaceEntryOf` equals what a write stores, touches no disk, and refuses a mismatched id with `SCHEMA_INVALID`.
- `test/cli/checkpoint-stopped.test.ts` (new, hermetic, real directories and library): stopped create and restore with no registry file before or after; unbound answer; active answer (`LOCK_CONFLICT`); container running and exited; inspect throws; inspect exceeds its bound (mock timers); Podman socket unresolvable and unreachable (default inspector); silent, error-reply and dropped daemon with zero Podman calls; path outside the policy roots and outside the workspace root; id mismatch through `pinStoppedProject`; policy and config that cannot load; directory swapped after the pin (`snapshotWorkspace` with the in-memory entry gives `POLICY_DENIED`); and `runCli` wiring of the new seams.

## Deviations from Plan

### Shipped test updated (as the plan prescribed)

`test/cli/cli.test.ts`, "a workspace with no session is refused with REALM_UNBOUND and nothing is written", became "an unregistered workspace under a policy with no workspace roots is refused with POLICY_DENIED and nothing is written". Its fixture has no policy file, so the default `workspaceRoots` is empty and an unregistered project is now `POLICY_DENIED`. The nothing-written and `connects === 0` assertions are kept. No other shipped test changed.

No other deviations. No registry file is written or removed anywhere in the new path. The existing-entry path is unchanged.

## Verification run (through the heavy-slot lock)

- `npm run build`: exit 0.
- `node --test` on `dist/test/daemon/channel.test.js`, `client.test.js`, `session/workspace-registry.test.js`, `session/checkpoint.test.js`, `cli/cli.test.js` and `cli/checkpoint-stopped.test.js`: 162 tests, 162 pass, 0 fail.
- `npm run typecheck`: exit 0. `npm run lint`: exit 0. `npm run check:gates`: exit 0 (gate closure and module size, no ceiling touched). `npm run check:docs`: exit 0.
- Not run: the full suite, which the orchestrator runs. `export-usage-gate.mjs` is not part of `check:gates`; `pinStoppedProject` and `PODMAN_PROOF_TIMEOUT_MS` are exported for the test and are not on its allowlist, so that gate would list them as test-only if it is turned on.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-nc8-01 to T-nc8-04 are mitigated and covered by the tests above.

## Self-Check: PASSED

Files exist and both commits are on the lane branch (835fb9c, 455671a).
