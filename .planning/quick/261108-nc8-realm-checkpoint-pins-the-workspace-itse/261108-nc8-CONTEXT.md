# QUICK-CP: `realm checkpoint` works for a project that was stopped with `realm down` (RES-04)

Owner decision, 2026-11-08 (recorded in this file as the source): `realm checkpoint create|restore --workspace <absolute path> --id <id>` must work for a project that was stopped with `realm down`. Chosen option: "Checkpoint pins the workspace itself": for a path under the configured workspace roots the command binds and verifies the pin the way `up` does, runs the library operation, and leaves nothing behind. The other two options (keep the registration after `down`; leave as documented) were rejected by the owner.

Design corrections made before planning (an independent review found two flaws in the first draft of this file; both are verified against the tree):

- The pin is held IN MEMORY for the command. The library takes the `WorkspaceEntry` inside its request and verifies it with `verifyWorkspaceEntry` (`src/session/checkpoint.ts` about lines 157-159 and 206-208); it never reads the registry file. So no registry entry is written and none is removed. That removes the race with a concurrent `up` (which writes an identical entry at `src/daemon/daemon.ts` about line 399 before its start) and the stale registration a crashed CLI would leave. The owner's "then removes the pin" is satisfied trivially: nothing persistent exists.
- A stopped project normally has NO daemon. A `down` that leaves no live session stops the daemon (`stopAfterReply`, `src/daemon/daemon.ts` about lines 367-368). The shipped rule "a daemon that cannot answer refuses with REALM_NOT_ACTIVE" would therefore still refuse the ordinary stopped-project case. But no daemon does NOT prove no sandbox: a crashed daemon leaves its container running until `down`. The proof for the daemon-less case must come from Podman.

## Problem at lane HEAD

`src/cli/checkpoint.ts` refuses with `REALM_UNBOUND` when `readWorkspaceEntry` returns null (about lines 135-137), and with `REALM_NOT_ACTIVE` when the daemon cannot answer (about lines 138-179). After `realm down` the registry entry is gone and the daemon is usually gone too. `docs/checkpoint.md` ("Stopped projects", about lines 81-85) and `docs/integration/runtime-decision.md` (open item, about line 529) say the behaviour is undecided.

## Facts (verified at lane HEAD; re-read the lines before editing, they can drift)

- `up` admits an unknown project through `resolveSelection` (`src/daemon/sessions.ts` about lines 89-108): `bindWorkspaceUnderPolicy(policy.workspaceRoots, selection.workspaceRoot)`, then `isInsideRoot(ceiling, pinned.realPath)` where the ceiling is `bindRoot(config.workspaceRoot)` (`src/daemon/daemon.ts` about line 292), then `sessionIdOfWorkspace(pinned.realPath)` must equal `selection.sessionId` (SCHEMA_INVALID otherwise). The daemon loads the policy with `loadPolicyFile(options.policyPath)` (`daemon.ts` about lines 259 and 290); the default path comes from `defaultPolicyPath(stateDir)` in `src/runtime/host-paths.ts`.
- `WorkspaceEntry` is `{ schema: 1, sessionId, workspaceRoot, dev, ino }` (`src/session/workspace-registry.ts` about lines 31-37). `writeWorkspaceEntry` builds it from a `PinnedRoot` and then writes it atomically.
- The daemon answers `status` for an unregistered project with `unboundSnapshot` (`daemon.ts` about line 630).
- The CLI's `sandboxRunning` predicate is the daemon's status call: any state other than `unbound` counts as running (`src/cli/checkpoint.ts` about lines 155-163). The library calls the predicate several times per operation (before the copy, before the first restore move, and in recovery), so every proof must be repeatable.
- Podman access: `LibpodClient(socketPath)` (`src/runtime/libpod-client.ts`), `inspectContainer(nameOrId)` resolves null for an absent container (about line 216); the host socket comes from `podmanSocketPath(env)` in `src/runtime/host-paths.ts`; the realm names a session's container `realmSandboxName(sessionId)` (`src/runtime/openshell.ts` about line 55). `src/daemon/daemon.ts` builds a client the same way (about line 1420).
- `src/daemon/client.ts`: read how `connectDaemon` and `client.status()` report a missing socket, a refused connection, a timeout and an error reply, before you decide how to tell "no daemon" from "daemon that did not answer".

## Required behaviour

1. **Existing registry entry:** unchanged. The entry is used as today; no new proof beyond today's daemon status call.
2. **No registry entry (the stopped project):** the CLI builds the `WorkspaceEntry` in memory. It loads the config and the policy through the loaders the daemon uses, binds the path under the policy roots and the ceiling exactly as `resolveSelection` does for an unknown session, checks the id, and constructs the entry from the bound `PinnedRoot`. Share ONE constructor with `writeWorkspaceEntry` (extract a `workspaceEntryOf(pinned, sessionId)` in `src/session/workspace-registry.ts` that both use), so the two cannot drift. Reuse `bindWorkspaceUnderPolicy`, `isInsideRoot`, `sessionIdOfWorkspace`; write no second copy of any rule. Refusals use the codes `up` uses: `POLICY_DENIED` for a path outside the roots, a symbolic link, a swapped directory or a path that does not resolve; `SCHEMA_INVALID` for an id mismatch. If the policy or config cannot be loaded, refuse; there is no unchecked pin.
3. **Proof that the sandbox is stopped** (the `sandboxRunning` predicate), in this order:
   - the daemon answers: state `unbound` is stopped; any other state is running (refuse `REALM_NOT_ACTIVE`), as today;
   - there is no daemon, and nothing else: the control socket is absent or refuses the connection. Then ask Podman for the container named `realmSandboxName(sessionId)` through `LibpodClient(podmanSocketPath(env)).inspectContainer(name)`. `null` means stopped. A container in ANY state means running (refuse `REALM_NOT_ACTIVE`). A Podman socket that cannot be resolved or reached, or an inspect that fails, means unproven: refuse `REALM_NOT_ACTIVE`;
   - a daemon that exists but did not answer (timeout, malformed or error reply, any other failure) is never "no daemon": refuse `REALM_NOT_ACTIVE`. If the client cannot tell a missing socket from a silent daemon, add the smallest typed signal to the client; do not match on message text.
   Every call of the predicate repeats its proof. Every Podman call is bounded by `withTimeout`.
4. After the operation nothing is cleaned up because nothing was created. Usage errors still change nothing. Exit codes and stdout shape are unchanged.
5. **Tests** (`node:test`, hermetic, behaviour not source text; extend the fakes in `test/cli/` and `test/session/`, add a seam to `CheckpointDeps` for the Podman inspect and for the policy and ceiling reads; no real Podman, no real daemon):
   - stopped project, no daemon, container absent: `create` succeeds; the registry holds NO entry for the project before or after (assert the file `workspaces/<id>.json` does not exist); `restore` puts the tree back;
   - no daemon, container present (running, and exited): refused `REALM_NOT_ACTIVE`, nothing written;
   - no daemon, Podman unreachable or inspect throws: refused `REALM_NOT_ACTIVE`, nothing written;
   - daemon present but silent (timeout) and daemon answering an error: refused, never treated as stopped, and Podman is NOT consulted;
   - daemon answers `unbound` for an unregistered project: proceeds, registry untouched;
   - a path outside the policy roots: `POLICY_DENIED`; a path outside the ceiling: `POLICY_DENIED`; an id mismatch: `SCHEMA_INVALID`; nothing written in any of them;
   - a workspace directory swapped between the bind and the copy is caught by the library's existing `verifyPinnedAt` (assert it with the in-memory entry);
   - an existing registry entry still works exactly as before (the shipped tests stay green unchanged unless one pinned "daemon absent refuses" for a project that has no entry; update only that one and say so in the SUMMARY).
6. **Docs in the same change:** rewrite `docs/checkpoint.md` "Stopped projects" (what happens, the three proofs, the refusals that remain, and that no registration is written); replace the open item in `docs/integration/runtime-decision.md` (about line 529) with the recorded decision, dated 2026-11-08, owner decision, with the design above (in-memory pin, daemon-less proof through Podman), and close the D19-9 open item; update any other statement of the limitation (`grep -rn "Checkpointing a stopped project" docs`). No host-local paths in any doc.

## Out of scope

`realm down`, the registry format, the daemon, the lock semantics, `CHANGELOG.md`, `package-lock.json`, `.github/**`, `release/**`, `docs/specs/realm-spec.xml`, and everything under `.planning/phases/`, `.planning/REQUIREMENTS.md` and `.planning/ROADMAP.md` (the records task owns them). Do not touch the live stack.
