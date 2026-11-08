# Workspace checkpoints (`realm checkpoint`)

A checkpoint is a full copy of a project's workspace tree, taken and restored on the host. Restore keeps the workspace root directory: it is the same directory afterwards, with the same device and inode. It replaces the entries under that directory with the entries of the checkpoint.

The command is RES-04 (decision D19-6 and D19-9, `docs/integration/runtime-decision.md`).

## Commands

```
realm checkpoint create --workspace <absolute dir> --id <checkpoint-id>
realm checkpoint restore --workspace <absolute dir> --id <checkpoint-id>
```

- Both flags are required. Each is given once, in either order.
- `--workspace` is an absolute path. It is resolved to its real path, so a symbolic link to the project names the same session as the project itself.
- `--id` must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`.

A usage error changes nothing. It is reported with exit code 2 when:

- a flag is missing, given twice, or unknown, or a word is extra;
- `--workspace` is relative;
- `--id` is outside the pattern above;
- the state directory cannot be resolved. The runtime config file must be present and valid. The message on stderr names the requirement.

## Output and exit codes

| Exit | Meaning | Output |
| --- | --- | --- |
| 0 | The checkpoint was created, or the workspace was restored. | One JSON line on stdout: `{"command":"create","checkpointId":"<checkpoint-id>","entries":<count>}`. `command` is `create` or `restore`. |
| 1 | A refusal. | The catalogue code on stdout, one line. The reason on stderr. |
| 2 | A usage error. | A usage message on stderr. Nothing is written. |

`entries` counts every path under the workspace root: files, directories and symbolic links. The root itself is not counted.

## Refusals

Each refusal is a catalogue code. The retry column is the catalogue's `retryable` value.

| Code | Retry | What it means |
| --- | --- | --- |
| `REALM_NOT_ACTIVE` | yes | The sandbox could not be proven stopped. The daemon cannot answer: the control socket is absent or refuses the connection for a project that still has a registry entry, or the daemon is silent, answers with an error or drops the connection, for example for a session that is still waiting to be hydrated after a daemon restart. Or, for a project with no registry entry, there is no daemon and Podman holds a container named `realm-<session id>` in any state, cannot be reached, or fails or exceeds its bound when asked. See [Stopped projects](#stopped-projects). The code is also what `realm up` gets when a checkpoint holds the session lock. A checkpoint is never refused with this code because of a lock. |
| `LOCK_CONFLICT` | yes | One of these holds. The sandbox is not in the unbound state, so it counts as running. A sandbox start holds the session's lock. Another checkpoint operation holds it. A snapshot saw a workspace entry change during the copy. See [Quiescence](#quiescence). |
| `POLICY_DENIED` | no | The workspace path does not resolve. Or, for a project with no registry entry, the path is outside the policy `workspaceRoots` or outside the configured workspace root. Or the workspace is not the directory that was pinned: it was moved, replaced, or reached through a link. Or the state directory lies inside the workspace root. Or the tree holds a special file. Or, on restore, the state directory is on a different filesystem from the workspace. |
| `SCHEMA_INVALID` | no | On create, the checkpoint id is already used. On restore, the checkpoint is unknown, its manifest cannot be read or is invalid, or its tree does not match its manifest. A restore refused for the last reason moves nothing. Or, for a project with no registry entry, the policy file cannot be loaded. |
| `PATH_ESCAPE` | no | On create, a symbolic link in the workspace resolves outside the workspace root. Links are never followed, so this refuses the create. |
| `WRITE_NOT_ATOMIC` | yes | A copy, scan or move failed for a reason outside the catalogue, for example a full disk or a permission error. Or a checkpoint directory could not be created. Or, on restore, the tree did not match its manifest after the move. In that case the tree is moved back. |
| `TOOL_TIMEOUT` | yes | A copy, scan or move step ran for more than five minutes. See [Limits](#limits). |
| `CLEANUP_FAILED` | no | Cleanup failed after the operation. See [Limits](#limits): exit 1 can follow completed work. |

## Quiescence

A checkpoint is taken or restored only while the workspace's sandbox is stopped, and no sandbox start runs at the same time.

- A sandbox in any daemon state other than unbound counts as running. That covers connecting, active, degraded, error and stopping. Both create and restore refuse it with `LOCK_CONFLICT`. Create checks the state before the copy and again after it. Restore checks it before the copy, after the copy, and after the entries move in.
- A sandbox start, `realm up` through its create or hydrate path, holds the session's checkpoint lock while it runs. The lock stays held until the start settles, including any start still in flight. A checkpoint that finds the lock held is refused with `LOCK_CONFLICT` at once. It does not wait.
- A checkpoint holds the same lock for its whole run. A start that finds it held is refused with `REALM_NOT_ACTIVE`. Retry the start after the checkpoint finishes.
- A host process that changes a file and then reverts it during a snapshot is refused with `LOCK_CONFLICT`. The snapshot records the device, inode, size, modification time and change time of every entry before the copy and again after it. A revert still moves the change time, so the difference is seen. These stamps are compared only between those two scans. They are not stored.

## What is captured

The workspace tree below the root: regular files with their content, directories, and symbolic links. Each entry's permission bits are recorded and restored. The root directory itself is not copied, and restore keeps it.

Nothing is filtered by content. The state directory, where the runtime keeps its secrets, is excluded by placement: the state root must lie outside the workspace root, and the library refuses otherwise. Any file inside the workspace is copied, including a credential kept there.

Restore replaces the workspace contents. The current entries under the root are moved aside, the checkpoint's entries move in, and the moved-aside entries are deleted once the restore commits. Anything created in the workspace after the checkpoint is lost.

## Where checkpoints live

```
<state-dir>/checkpoints/<session-id>/<checkpoint-id>/
    manifest.json      the entry list: path, type, mode, size, link target or SHA-256
    tree/              the copy of the workspace tree
```

- `<state-dir>` is the state directory from the runtime config.
- `<session-id>` is derived from the workspace's real path.
- The `checkpoints` directory, the session directory and each checkpoint directory have mode 0700. `manifest.json` has mode 0600.
- The state directory lies outside every workspace root, as above.

## Stopped projects

`realm down` removes the project's registration, and a stopped project usually has no daemon. Create and restore still work for it. When the workspace has no registry entry, the command pins the workspace itself, in memory, with the rules `realm up` applies to a project it has not seen:

- the real path must lie under the policy file's `workspaceRoots`, and inside the configured workspace root, or the command refuses with `POLICY_DENIED`;
- the session id must be the one the real path derives, or the command refuses with `SCHEMA_INVALID`;
- a policy file or runtime config that cannot be loaded refuses. A runtime config that cannot be loaded is a usage error, exit code 2.

The pin lives only for the command. Nothing is written to the registry and nothing is removed, so there is nothing to clean up, and a command that crashes leaves no registration behind. The library still verifies the pinned directory before every copy and move, so a directory swapped in after the pin is refused with `POLICY_DENIED`.

The sandbox is proven stopped before anything is written, and the proof is repeated on every check the library makes. In order:

1. The daemon answers, and the session's state is `unbound`.
2. There is no daemon, meaning the control socket is absent or refuses the connection, and Podman holds no container named `realm-<session id>`.
3. A daemon that exists but did not answer, because it timed out, replied with an error or dropped the connection, is never read as "no daemon". The command refuses with `REALM_NOT_ACTIVE` and does not ask Podman.

The refusals that remain: `REALM_NOT_ACTIVE` for a container in any state, a Podman that cannot be resolved or reached, an inspect that fails or exceeds its bound, or a silent daemon; `LOCK_CONFLICT` when a daemon answers with a state other than `unbound`; `POLICY_DENIED` outside the roots or the workspace root, through a link, or for a swapped directory; `SCHEMA_INVALID` for an id mismatch or a policy that cannot be loaded.

A project that still has a registry entry is handled as before: the daemon's status call is the only proof, and a daemon that is absent refuses with `REALM_NOT_ACTIVE`. A registration left behind with no daemon, for example by a crash, is therefore refused. Run `realm up` and then `realm down` to clear it, then retry.

## Limits

- **Hard links become separate files.** After a restore, each name that was a hard link is its own file with the same content.
- **Ownership, extended attributes and ACLs are not preserved.** Restored entries belong to the user who runs the command.
- **File times are not restored.** The library sets no times, and restored entries are new inodes.
- **Special files are refused.** A socket, named pipe or device file in the tree refuses the operation with `POLICY_DENIED`.
- **Symbolic links are recreated, not followed.** A link is recreated with its target text. A link whose target resolves outside the workspace root refuses create with `PATH_ESCAPE`.
- **A restore that crashes is recovered by the next operation.** The crash leaves a work directory named `.restore-<random>` in the session directory. The next create or restore for that session recovers it under the lock, after the sandbox check passes and before its own work.
- **A create that crashes keeps its id.** A crash before the manifest is written leaves the checkpoint directory without `manifest.json`. The library does not sweep it, so that id stays in use: create and restore for it refuse with `SCHEMA_INVALID`. Use a new id, or remove the directory by hand.
- **A temporary lock file is not swept.** A crash between writing the owner record and publishing the lock leaves a file named `.lock.tmp-<random>` in the session directory. No reader opens it, and the library does not remove it. It can be removed by hand.
- **The state directory must share the workspace's filesystem.** A restore refuses with `POLICY_DENIED` otherwise.
- **Each copy, scan or move step is bounded to five minutes.** A step that runs longer fails with `TOOL_TIMEOUT`. The command then waits for that step to finish before it removes a partial checkpoint or rolls back a restore. A step that never returns therefore also stops the command.
- **Exit 1 can follow completed work, with `CLEANUP_FAILED`.** Three cases:
  - The checkpoint lock could not be removed after the operation. The create or restore itself completed. Until this process exits, the lock still names it. After it exits, the next operation takes the lock over.
  - A restore committed, and its work directory could not be removed. The restore completed. The next operation removes the work directory.
  - A restore failed partway and its rollback could not put the original tree back in full. The restore did not complete. The work directory is kept, and the next operation recovers the original tree.
