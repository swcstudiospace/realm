# 54-DESIGN.md — Durable Snapshots (SNAP-01, SNAP-02)

**Date:** 2026-11-19 · **Phase:** 54-snapshots-design · **Status:** frozen design, owner decisions D-54-H1… recorded below · **Scope:** design only, no code, no `src` change.

Read against: `src/session/checkpoint.ts` (RES-04), `src/session/checkpoint-lock.ts`, `src/cli/checkpoint.ts`, `src/session/paths.ts`, `src/session/reap.ts`, RES-03 (scratch volume, `docs/integration/runtime-decision.md`).

### Owner decisions (HITL gate, step 3)

D-54-H1… are recorded here as the owner-approved picks that freeze SNAP-01..02. Where a question had live alternatives (D-54-2 candidates), the table states the alternatives considered and the pick, so a later implementation phase cannot silently re-litigate them.

| ID | Question | Alternatives considered | Pick |
| --- | --- | --- | --- |
| D-54-H1 | Snapshot identity | (a) Named, retained checkpoint: checkpoint id + manifest sha256 digest, stored under the existing per-session checkpoint directory. (b) New content-addressed store with deduplication. | **(a)**. A snapshot *is* a retained RES-04 checkpoint with a human-chosen id and a recorded manifest digest. No new store, no dedup, no second copy path. |
| D-54-H2 | Retention bound | (a) Unbounded retention (checkpoints kept until `realm down` / manual removal). (b) Count bound (e.g. newest N per session, LRU). (c) Size/age bound. | **(a) for this design**, with the contract change in §3.3 making retention explicit: retention policy is named in the contract, default `keep-all-until-session-destroyed`, and any future bound is a policy field, not a lifecycle side effect. A count/size bound is deferred to a later owner decision because it would delete user data implicitly. |
| D-54-H3 | Scratch volume inclusion | (a) Include `/scratch` (RES-03 named volume) in the snapshot. (b) Exclude it. | **(b) Exclude.** A snapshot covers the workspace tree only — the same tree `snapshotWorkspace` copies. The scratch volume is ephemeral session state (RES-03), owned by the container lifecycle; copying it would duplicate Podman volume state into the state directory and break the no-orphan guarantee (§3.2). A user who needs scratch content can copy it into the workspace before snapshotting. |
| D-54-H4 | Restore vs live sandbox | (a) Restore only when the sandbox is provably stopped (current RES-04 predicate). (b) Restore under a live sandbox with in-flight writes quiesced. | **(a)**. Restore reuses the existing stopped-sandbox proof (daemon state + Podman container absence, `src/cli/checkpoint.ts` + `SandboxRunning` predicate) unchanged. Restoring under a live sandbox would race the workload's writes and is not designed here. |
| D-54-H5 | Durability level | (a) Best-effort (a snapshot may be lost in a crash). (b) Crash-durable (survives daemon restart and host crash). | **(b)**. The guarantees in §2 are design commitments, not aspirations. |

---

## 1. Snapshot contents (SNAP-01a)

A snapshot is a retained RES-04 checkpoint: `<stateDir>/checkpoints/<sessionId>/<checkpointId>/` containing:

- `tree/` — a byte-for-byte copy of the workspace root's entries at snapshot time (files, directories, symlinks recreated with their target text, never followed; hard links become separate files; special files — FIFO/socket/device — are refused, not copied).
- `manifest.json` — the content identity, schema 1 (`MANIFEST_SCHEMA`), sorted by relative path. Per entry: relative `path`, `type` (file/dir/link), `mode` (permission bits), `size` (files), `linkTarget` (links), `sha256` (files). The manifest is written **last** and is the point of no return: a directory without a readable manifest is an incomplete snapshot and is never treated as a valid one (§2).
- Durable identity recorded alongside the checkpoint: the checkpoint id (safe session-id character set, enforced by `isSessionId`/`checkpointDirOf` in `src/session/paths.ts`) and the manifest's sha256 digest, surfaced by the CLI (§3.3) so a snapshot can be verified without re-copying the tree.

**Excluded:** the realm state directory itself (a snapshot of a workspace whose root contains the state directory is refused outright — `refuseStateInsideRoot` in `src/session/checkpoint.ts` — so state, secrets and OpenShell files can never be copied into a checkpoint), the scratch volume (D-54-H3), container/sandbox state, audit logs, and the session lock file (`.lock`). File timestamps (mtime/ctime/inode) are comparison stamps only, never stored: restored files get new inodes, and restore does not promise timestamp fidelity.

## 2. Durability guarantee (SNAP-01b) and restore semantics (SNAP-01c)

### What survives

A committed snapshot (manifest written and synced) survives a daemon restart and a host crash, under the existing RES-04 mechanism:

- Every file is copied with exclusive creation and its mode set after the copy; directory creation is private (0o700) until filled, then set to its real mode.
- The manifest is written last (§1), so a crash mid-copy leaves a directory with no manifest — a partial, removed under the lock before the id can be re-reserved (`removePartialCheckpoint`).
- Markers are durable: the restore's `backed-up` marker is written and synced (file sync, then directory sync) before any entry moves into the workspace root, and the `committed` marker is written after the swap. A crash before `committed` is undone by recovery on the next locked operation (`recoverSession`): originals in `backup/` are moved back, staged entries set aside. A crash after `committed` keeps the restored tree and removes only leftovers. Directory fsync (`syncDir`) makes entry creation/removal durable, not just file content.
- The cross-process session lock (`.lock`, owner pid + start ticks + boot id, `src/session/checkpoint-lock.ts`) serialises every snapshot and restore; takeover only when the owner is provably gone, a live or unprovable owner refuses with `LOCK_CONFLICT`. A stale non-regular/empty/unreadable lock is refused, never taken over — it needs manual removal. Journal semantics follow from the markers, not from any new journal format.

**Not guaranteed:** a snapshot operation whose step outlives its 5-minute bound (`CHECKPOINT_OP_TIMEOUT_MS`) holds the lock, tree and work directory for recovery and fails with `TOOL_TIMEOUT`; the partial is kept, not deleted, because the step may still be writing. Lost or corrupted manifest/tree bytes on disk are detected (sha256 per file, manifest parse validation, safe-relative-path checks) and refused, not silently repaired.

### Restore semantics (SNAP-01c)

Restore is a **byte-for-byte return** to the snapshot's content (RES-04 semantics, D-54-H4 for the stopped-sandbox precondition):

- The workspace root directory is never replaced: its device and inode are unchanged before, during and after restore. Entries move aside into `backup/`, staged entries move in, `committed` is written, then the backup is deleted. Files are verified against the registry entry (workspace identity, `verifyWorkspaceEntry`) before the copy, after it, and before any move; a host writer that changes and reverts a file during the copy is detected by the pre/post scan stamps and the snapshot is refused.
- Restored links are recreated with their recorded target text; links whose target resolves outside the root are refused on scan. Hard links are not preserved (they become separate files). Permissions are restored from the manifest mode; ownership and timestamps are not.
- A failed restore rolls back to the original tree via `rollback` (staged entries out, originals back); a rollback failure keeps the work directory for recovery.
- Cleanup that fails after the commit is a warning (one per failure, `CLEANUP_FAILED`), the exit code stays 0 — the restore already committed.

## 3. Composition (SNAP-02)

### 3.1 Composition with RES-04

A snapshot is not a new code path. It is a retained, named RES-04 checkpoint:

- **Create** = `snapshotWorkspace` (`src/session/checkpoint.ts`) with the chosen checkpoint id. The id directory is the reservation (created without parents — fails if taken); the manifest is the commit point. No new snapshot function is introduced.
- **Restore** = `restoreWorkspace` with the same id, under the same per-session lock, with the same stopped-sandbox predicate (`SandboxRunning`, proved by the CLI across the daemon state and, daemonless, the Podman container/label proof in `src/cli/checkpoint.ts`).
- **Retention** = the checkpoint directory lives until the session is destroyed or the user removes it explicitly. There is no snapshot-specific reaper, no GC pass, and no second store to orphan (§3.2, D-54-H2).

An implementation that needs to list snapshots simply lists `<stateDir>/checkpoints/<sessionId>/` and reads each `manifest.json` — no manifest index file is added, so there is no index to corrupt.

### 3.2 Scratch volume and the no-orphan guarantee

- **Scratch (RES-03):** excluded (D-54-H3). The `/scratch` named Podman volume is container-lifecycle state, created before the container and removed after it (`src/runtime/driver/lifecycle.ts`). It is never copied into `tree/`, never referenced by `manifest.json`, and never restored. This keeps the snapshot a pure workspace-tree artefact and keeps Podman volume state out of the state directory.
- **No-orphan guarantee:** snapshot directories live under `<stateDir>/checkpoints/`, outside every workspace root and never inside a container mount. Three consequences are designed now:
  1. Snapshot directories are never adopted as containers or sandboxes: the startup reap (`src/session/reap.ts`) matches containers by session record + container id and label, and acts only on Podman containers; it never enumerates the state directory's subdirectories as candidates, so a checkpoint directory cannot be reaped as a realm container, and a checkpoint's files cannot be adopted as a session record.
  2. Snapshot directories are never adopted as workspace roots: workspace identity is derived by realpath + registry entry (`sessionIdOfWorkspace`), and the state-inside-root refusal means a checkpoint can never sit inside a workspace it snapshots.
  3. The reap's session-record deletion does not touch `<stateDir>/checkpoints/`: deleting a session record does not delete its checkpoints (retention, D-54-H2), and destroying a session is the only operation that may remove a session's checkpoint directory — as an explicit step, not as reap fallout.

### 3.3 Code surfaces, contract changes, migration

**Code surfaces** (for a future implementation phase; none edited here):

- `src/session/checkpoint.ts` — reuse `snapshotWorkspace`/`restoreWorkspace`, `recoverSession`, the manifest schema, and the marker discipline unchanged. The only addition would be a read-only `listSnapshots`/`readSnapshotIdentity` helper (list session dir, parse manifests, return id + digest) if the CLI needs it; no change to copy/restore internals.
- `src/cli/checkpoint.ts` — extend the existing `realm checkpoint` command with a listing verb (e.g. `realm checkpoint list --workspace <path>`) returning id + manifest digest per snapshot, under the same argument parsing (usage errors change nothing), the same pinned-entry mechanism, and the same stopped-sandbox proof where required. `create`/`restore` keep their current shapes.
- `src/session/paths.ts` — no new path helpers needed; `checkpointSessionDirOf`/`checkpointDirOf` already cover the layout. A `snapshotsDirOf` alias is explicitly *not* introduced.

**Contract changes** (additive only; no existing field changes meaning):

- A retention policy field in the runtime/policy contract (e.g. `snapshots.retention: "keep-until-session-destroyed"`), defaulting to D-54-H2's pick. Any future count/size bound would be a new value of this field, introduced by its own owner decision.
- CLI output for `list` (id, manifest sha256, entry count) as a new subcommand shape; `create`/`restore` output unchanged.
- **No compatibility shims:** no alias command, no deprecated verb, no dual-store reader, no fallback to a second layout. The `manifest.json` schema stays at 1; if a future snapshot needs a field the schema cannot carry, the schema version bumps and old manifests are refused with the existing catalogue codes, not translated.

**Migration note:** none required for existing checkpoints — retained checkpoints created by RES-04 are already valid snapshots under D-54-H1 (same directory, same manifest, same digest). A user with existing checkpoint ids simply lists them. Nothing is renamed, moved, or re-encoded.

## 4. Explicitly not designed here

Implementation, tests, live proof, catalogue changes, any `src`/`test` edit, and any behaviour change. A dependent implementation phase needs its own owner decision after this freeze, and must implement §3.3 within the D-54-H1… picks: named retained checkpoints under the session lock, workspace-only contents, byte-for-byte restore with the stopped-sandbox precondition, scratch excluded, no-orphan layout preserved.
