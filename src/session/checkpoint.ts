// Workspace checkpoints (RES-04, D19-6). A checkpoint is a full copy of a workspace tree plus a manifest.json that
// records, for each entry, its relative path, type, mode, size, link target (links) and sha256 (files). The manifest
// is the content identity. A snapshot is also refused when any entry's device, inode, size, mtime or ctime changed
// between the scan before the copy and the scan after it, so a host writer that changes and reverts a file during the
// copy is seen. The stamps are never stored: restored files get new inodes.
//
// The workspace is identified only by the session's registry entry (workspace-registry.ts). Its directory is verified
// against the pinned identity before the copy, after it, and before any move.
//
// Cross-process lock. Every public operation takes the session lock first (checkpoint-lock.ts): a file, `.lock`, in the
// session's checkpoint directory. It is published whole, so it is never seen empty. Its content records the owner: pid,
// start time in clock ticks and the boot id. A lock is taken over only when its owner is provably gone (the pid is not
// alive, its start time differs, or the boot differs). A live or unprovable owner keeps the lock, and the operation is
// refused with LOCK_CONFLICT. Under the lock the operation recovers the session's leftover work directories, then runs,
// then releases the lock. The sweep never runs without the lock.
//
// A step still running past its bound keeps the lock, the tree and the work directory for recovery. Cleanup waits for
// that step under the bound and never acts while the step may still write.
//
// A restore keeps the workspace root directory (its device and inode never change), moves the root's entries aside into
// a backup, writes a backed-up marker, moves the staged entries in, writes a committed marker, and deletes the backup. A
// crash before the committed marker is undone by recovery. Without the backed-up marker, recovery moves the backup's
// originals back. With it, every root entry is a staged entry, so recovery sets those aside before the originals return.
//
// Documented limits: a hard link becomes a separate file. Content is not filtered, so the state root must lie outside
// the workspace root; a root that holds the state directory is refused. A lock file that is empty or unreadable is
// refused, not taken over, so it needs manual removal.

import { createHash, randomBytes } from "node:crypto";
import { constants, createReadStream, type BigIntStats, type Stats } from "node:fs";
import {
  type FileHandle,
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { type ErrorCode, makeRealmError, RealmError } from "../core/errors.js";
import { withTimeout } from "../core/timeout.js";
import { errnoOf } from "../fs/canonicalize.js";
import { isInsideRoot, type PinnedRoot, verifyPinnedAt } from "../fs/root.js";
import { acquireSessionLock, releaseSessionLock } from "./checkpoint-lock.js";
import { checkpointDirOf, checkpointSessionDirOf, checkpointsDirOf } from "./paths.js";
import { verifyWorkspaceEntry, type WorkspaceEntry } from "./workspace-registry.js";

// Each copy, scan and move runs under this bound. A workspace tree can be large, so a copy of it on a loaded disk can
// take minutes; five minutes allows that. A hung filesystem call still fails the operation rather than holding the
// sandbox's stop open indefinitely.
const CHECKPOINT_OP_TIMEOUT_MS = 300_000;
const PRIVATE_DIR_MODE = 0o700;
const MODE_BITS = 0o7777;
const MANIFEST_SCHEMA = 1;
const MANIFEST_FILE = "manifest.json";
const TREE_DIR = "tree";
const STAGE_DIR = "stage";
const BACKUP_DIR = "backup";
const COMMITTED_FILE = "committed";
const BACKED_UP_FILE = "backed-up";
const WORK_DIR_PREFIX = ".restore-";
const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface ManifestEntry {
  readonly path: string;
  readonly type: "file" | "directory" | "symlink";
  readonly mode: number;
  // Byte length for a file or a link (the target's length); zero for a directory.
  readonly size: number;
  readonly linkTarget?: string;
  readonly sha256?: string;
}

export interface CheckpointManifest {
  readonly schema: 1;
  readonly entries: readonly ManifestEntry[];
}

// The result of a committed operation. A cleanup that failed after the commit is a warning, one per failure, naming the
// stable code and the path. It is empty when every cleanup succeeded.
export interface CheckpointResult {
  readonly manifest: CheckpointManifest;
  readonly warnings: readonly string[];
}

// Answers whether the sandbox that owns the session is running. It is called under the lock, before the first copy or
// move, and again after the copy or restore. A predicate that throws leaves the state unknown, so the operation is refused.
export type SandboxRunning = (sessionId: string) => boolean | Promise<boolean>;

export interface CheckpointScope {
  // The session's registry entry. Its directory is verified against the pinned identity before the copy, after it, and
  // before any move. The session id comes from the entry.
  readonly entry: WorkspaceEntry;
  readonly stateRoot: string;
  readonly sandboxRunning: SandboxRunning;
}

export interface SnapshotRequest extends CheckpointScope {
  readonly checkpointId: string;
}

export interface RestoreRequest extends CheckpointScope {
  readonly checkpointId: string;
  // Test seam. Awaited inside the bounded step of each move, before its rename. A throw aborts the restore, and the tree is
  // rolled back. A promise that never settles hits the step bound.
  readonly beforeMove?: (entryName: string) => void | Promise<void>;
  // Test seam. Removes the work directory after the commit, in place of rm. A rejection is reported as a warning.
  readonly removeWorkDir?: (workDir: string) => Promise<void>;
}

// The step most recently started, and whether a step has run past its bound and is still running. A failure can leave a
// step running after its bound has expired, so cleanup waits for it, under the same bound, before it touches the tree, the
// work directory or the lock. A wait that expires leaves the operation stuck: cleanup then keeps everything for recovery.
interface Steps {
  pending: Promise<unknown> | undefined;
  stuck: boolean;
}

// The names moved aside and moved in, in order. A name is logged before its move starts, so rollback can find a move
// that completed after its bound expired. Rollback moves back only the entries that are actually present.
interface MovedNames {
  readonly movedOut: string[];
  readonly movedIn: string[];
}

// A scan of a tree. The stamps hold, per relative path, the device, inode, size, mtime and ctime. The root is "".
interface Scan {
  readonly entries: ManifestEntry[];
  readonly stamps: Map<string, string>;
}

// Untrusted JSON read from disk. Each field is checked with typeof before it is used.
interface RawManifest {
  readonly schema?: unknown;
  readonly entries?: unknown;
}

interface RawEntry {
  readonly path?: unknown;
  readonly type?: unknown;
  readonly mode?: unknown;
  readonly size?: unknown;
  readonly linkTarget?: unknown;
  readonly sha256?: unknown;
}

export async function snapshotWorkspace(request: SnapshotRequest): Promise<CheckpointResult> {
  try {
    return await takeSnapshot(request);
  } catch (error) {
    throw asRealmError(error, "WRITE_NOT_ATOMIC");
  }
}

export async function restoreWorkspace(request: RestoreRequest): Promise<CheckpointResult> {
  try {
    return await restoreFromCheckpoint(request);
  } catch (error) {
    throw asRealmError(error, "WRITE_NOT_ATOMIC");
  }
}

async function takeSnapshot(request: SnapshotRequest): Promise<CheckpointResult> {
  const { entry, stateRoot } = request;
  const checkpointDir = checkpointDirOf(stateRoot, entry.sessionId, request.checkpointId);
  const pinned = verifyWorkspaceEntry(entry);
  await refuseStateInsideRoot(pinned, stateRoot);
  await ensureSessionDir(stateRoot, entry.sessionId);
  const lockPath = acquireSessionLock(checkpointSessionDirOf(stateRoot, entry.sessionId));
  const steps: Steps = { pending: undefined, stuck: false };
  return settleUnderLock(lockPath, steps, () => snapshotLocked(request, pinned, checkpointDir, steps));
}

async function snapshotLocked(
  request: SnapshotRequest,
  pinned: PinnedRoot,
  checkpointDir: string,
  steps: Steps,
): Promise<CheckpointResult> {
  const { entry, stateRoot, sandboxRunning } = request;
  await requireSandboxStopped(sandboxRunning, entry.sessionId);
  await recoverSession(stateRoot, entry.sessionId, pinned, entry.workspaceRoot, steps);
  // The reservation runs outside the try below: a collision must not remove the checkpoint that already holds the id.
  await reserveCheckpointDir(checkpointDir);
  try {
    const before = await bounded(steps, scanTree(pinned.realPath, pinned));
    const treeDir = join(checkpointDir, TREE_DIR);
    await makePrivateDir(treeDir);
    await bounded(steps, copyTree(pinned.realPath, treeDir));
    verifyPinnedAt(pinned, entry.workspaceRoot);
    await requireSandboxStopped(sandboxRunning, entry.sessionId);
    const after = await bounded(steps, scanTree(pinned.realPath, pinned));
    if (!sameEntries(before.entries, after.entries) || !sameStamps(before.stamps, after.stamps)) {
      throw makeRealmError("LOCK_CONFLICT");
    }
    const manifest: CheckpointManifest = { schema: MANIFEST_SCHEMA, entries: before.entries };
    await writeFile(join(checkpointDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    return { manifest, warnings: [] };
  } catch (error) {
    throw await undoSnapshot(error, checkpointDir, steps);
  }
}

// A failed snapshot removes its partial checkpoint. A step still running keeps it, since the step may still write there.
async function undoSnapshot(error: unknown, checkpointDir: string, steps: Steps): Promise<RealmError> {
  const stuck = await quiesce(steps);
  if (stuck !== undefined) {
    return stuck;
  }
  const removal = await tryRemove(removeDir, checkpointDir);
  return removal === undefined ? asRealmError(error, "WRITE_NOT_ATOMIC") : withCleanupCause(error, removal);
}

async function restoreFromCheckpoint(request: RestoreRequest): Promise<CheckpointResult> {
  const { entry, stateRoot } = request;
  const checkpointDir = checkpointDirOf(stateRoot, entry.sessionId, request.checkpointId);
  const pinned = verifyWorkspaceEntry(entry);
  await refuseStateInsideRoot(pinned, stateRoot);
  // A checkpoint is immutable once written, so it is read before the lock; a missing one is refused here.
  const stored = await readCheckpoint(checkpointDir);
  const lockPath = acquireSessionLock(checkpointSessionDirOf(stateRoot, entry.sessionId));
  const steps: Steps = { pending: undefined, stuck: false };
  return settleUnderLock(lockPath, steps, () => restoreLocked(request, pinned, checkpointDir, stored, steps));
}

async function restoreLocked(
  request: RestoreRequest,
  pinned: PinnedRoot,
  checkpointDir: string,
  stored: CheckpointManifest,
  steps: Steps,
): Promise<CheckpointResult> {
  const { entry, stateRoot, sandboxRunning } = request;
  await requireSandboxStopped(sandboxRunning, entry.sessionId);
  await recoverSession(stateRoot, entry.sessionId, pinned, entry.workspaceRoot, steps);

  // The work directory sits beside the checkpoints, outside the root. It holds the staged copy and the backup.
  const workDir = join(
    checkpointSessionDirOf(stateRoot, entry.sessionId),
    `${WORK_DIR_PREFIX}${randomBytes(8).toString("hex")}`,
  );
  const stage = join(workDir, STAGE_DIR);
  const backup = join(workDir, BACKUP_DIR);
  const moved: MovedNames = { movedOut: [], movedIn: [] };
  try {
    await makePrivateDir(workDir);
    if ((await stat(workDir)).dev !== pinned.dev) {
      throw makeRealmError("POLICY_DENIED");
    }
    await makePrivateDir(stage);
    await makePrivateDir(backup);
    await bounded(steps, copyTree(join(checkpointDir, TREE_DIR), stage));
    verifyPinnedAt(pinned, entry.workspaceRoot);
    await requireSandboxStopped(sandboxRunning, entry.sessionId);
    const staged = await bounded(steps, scanTree(stage));
    if (!sameEntries(staged.entries, stored.entries)) {
      // A checkpoint whose content differs from its manifest is corrupt. Nothing has moved yet.
      throw makeRealmError("SCHEMA_INVALID");
    }
    await swapEntries(request, pinned, workDir, stored, steps, moved);
    await writeFile(join(workDir, COMMITTED_FILE), "", { flag: "wx" });
  } catch (error) {
    throw await undoRestore(error, pinned.realPath, workDir, moved, steps);
  }

  // The restored manifest matched and the commit marker is written, so the moved-aside originals are no longer needed.
  // The restore has committed, so a failed removal is a warning, not an error: the next operation removes the directory.
  const removal = await tryRemove(request.removeWorkDir ?? removeDir, workDir);
  return { manifest: stored, warnings: removal === undefined ? [] : [`${removal.code}: ${workDir}`] };
}

// Undoes a failed restore. Once every step has settled, the moved entries go back and the work directory is removed. A
// rollback that fails throws, and the work directory is then kept for recovery.
async function undoRestore(
  error: unknown,
  root: string,
  workDir: string,
  moved: MovedNames,
  steps: Steps,
): Promise<RealmError> {
  const stuck = await quiesce(steps);
  if (stuck !== undefined) {
    return stuck;
  }
  if (moved.movedOut.length > 0 || moved.movedIn.length > 0) {
    await rollback(root, workDir, moved, steps);
  }
  const removal = await tryRemove(removeDir, workDir);
  return removal === undefined ? asRealmError(error, "WRITE_NOT_ATOMIC") : withCleanupCause(error, removal);
}

// Runs body under the session lock, then releases the lock. A failed body has undone its own work when it throws. The lock
// is released only once no step is still running. A step still running keeps the lock, with the tree and the work
// directory, for recovery, and the operation fails with TOOL_TIMEOUT. A failed release after a commit is a warning. A failed
// release of a failed operation becomes the cause of its error, so it never masks that error.
async function settleUnderLock(
  lockPath: string,
  steps: Steps,
  body: () => Promise<CheckpointResult>,
): Promise<CheckpointResult> {
  let result: CheckpointResult;
  try {
    result = await body();
  } catch (error) {
    const stuck = await quiesce(steps);
    if (stuck !== undefined) {
      throw stuck;
    }
    const release = releaseSessionLock(lockPath);
    throw release.ok ? asRealmError(error, "WRITE_NOT_ATOMIC") : withCleanupCause(error, release.error);
  }
  const release = releaseSessionLock(lockPath);
  return release.ok
    ? result
    : { manifest: result.manifest, warnings: [...result.warnings, `${release.error.code}: ${lockPath}`] };
}

// Recovers the work directories that a crashed operation left in the session's directory. Runs under the lock. A
// work directory with the committed marker holds a finished restore, so only its leftovers are removed. Otherwise the
// original tree returns first, and then the work directory is removed.
async function recoverSession(
  stateRoot: string,
  sessionId: string,
  pinned: PinnedRoot,
  workspaceRoot: string,
  steps: Steps,
): Promise<void> {
  const sessionDir = checkpointSessionDirOf(stateRoot, sessionId);
  const workNames = (await readdir(sessionDir)).filter((name) => name.startsWith(WORK_DIR_PREFIX)).sort();
  if (workNames.length === 0) {
    return;
  }
  verifyPinnedAt(pinned, workspaceRoot);
  for (const name of workNames) {
    const workDir = join(sessionDir, name);
    const committed = await presentAt(join(workDir, COMMITTED_FILE));
    if (!committed) {
      await returnOriginalTree(workDir, pinned.realPath, steps);
    }
    await bounded(steps, rm(workDir, { recursive: true, force: true }));
  }
}

// A crash leaves the original entries in the backup, and some restored entries in the root. Without the backed-up marker,
// phase A was not finished and no restored entry is in the root, so a root entry is set aside only when its name is also
// a backed-up original. With the marker, phase A had finished, so every root entry is a staged entry, and all of them are
// set aside into the stage. Then every backed-up original moves back.
async function returnOriginalTree(workDir: string, root: string, steps: Steps): Promise<void> {
  const backup = join(workDir, BACKUP_DIR);
  const stage = join(workDir, STAGE_DIR);
  const backedUp = (await presentAt(backup)) ? await readdir(backup) : [];
  const allBackedUp = await presentAt(join(workDir, BACKED_UP_FILE));
  if (!allBackedUp && backedUp.length === 0) {
    return;
  }
  await mkdir(stage, { recursive: true, mode: PRIVATE_DIR_MODE });
  for (const name of await readdir(root)) {
    if (allBackedUp || backedUp.includes(name)) {
      await bounded(steps, rename(join(root, name), join(stage, name)));
    }
  }
  // The marker goes before any original moves back: once an original is in the root, the root holds more than staged
  // entries, and a marker left in place would make the next recovery set that original aside.
  await bounded(steps, removeBackedUpMarker(workDir));
  for (const name of backedUp) {
    await bounded(steps, rename(join(backup, name), join(root, name)));
  }
}

async function swapEntries(
  request: RestoreRequest,
  pinned: PinnedRoot,
  workDir: string,
  stored: CheckpointManifest,
  steps: Steps,
  moved: MovedNames,
): Promise<void> {
  const stage = join(workDir, STAGE_DIR);
  const backup = join(workDir, BACKUP_DIR);
  for (const name of (await readdir(pinned.realPath)).sort()) {
    // A name is logged before its move starts, so rollback can find a move that completed after its bound expired.
    moved.movedOut.push(name);
    await bounded(steps, moveEntry(request.beforeMove, name, join(pinned.realPath, name), join(backup, name)));
  }
  // Every root entry is in the backup now. The marker is durable before the first move into the root, so a crash after
  // this point leaves a marker that means the root holds only staged entries.
  await bounded(steps, writeBackedUpMarker(workDir));
  for (const name of (await readdir(stage)).sort()) {
    moved.movedIn.push(name);
    await bounded(steps, moveEntry(request.beforeMove, name, join(stage, name), join(pinned.realPath, name)));
  }
  await requireSandboxStopped(request.sandboxRunning, request.entry.sessionId);
  const restored = await bounded(steps, scanTree(pinned.realPath, pinned));
  if (!sameEntries(restored.entries, stored.entries)) {
    throw makeRealmError("WRITE_NOT_ATOMIC");
  }
}

// One move of swapEntries, run as a bounded step. The seam runs inside the step, so a seam that never settles hits
// the step bound.
async function moveEntry(
  beforeMove: RestoreRequest["beforeMove"],
  name: string,
  from: string,
  to: string,
): Promise<void> {
  await beforeMove?.(name);
  await rename(from, to);
}

// Moves back every entry that was moved: the staged entries first, newest first, then the originals. The original tree
// returns when this succeeds. A failure keeps the work directory, which still holds the original entries, for recovery.
// A step past its bound keeps its TOOL_TIMEOUT code, so the caller keeps the lock and the work directory.
async function rollback(root: string, workDir: string, moved: MovedNames, steps: Steps): Promise<void> {
  const stage = join(workDir, STAGE_DIR);
  const backup = join(workDir, BACKUP_DIR);
  const stagedBack: [from: string, to: string][] = [...moved.movedIn]
    .reverse()
    .map((name): [string, string] => [join(root, name), join(stage, name)]);
  const originalsBack: [from: string, to: string][] = [...moved.movedOut]
    .reverse()
    .map((name): [string, string] => [join(backup, name), join(root, name)]);
  try {
    for (const [from, to] of stagedBack) {
      await moveIfPresent(from, to, steps);
    }
    // Once an original is back in the root, the root holds more than staged entries, so the marker must be gone first.
    await bounded(steps, removeBackedUpMarker(workDir));
    for (const [from, to] of originalsBack) {
      await moveIfPresent(from, to, steps);
    }
  } catch (error) {
    if (error instanceof RealmError && error.code === "TOOL_TIMEOUT") {
      throw error;
    }
    // The original tree is not back in full, so the work directory is kept for recovery.
    throw makeRealmError("CLEANUP_FAILED", "WRITE_NOT_ATOMIC");
  }
}

async function moveIfPresent(from: string, to: string, steps: Steps): Promise<void> {
  if (await presentAt(from)) {
    await bounded(steps, rename(from, to));
  }
}

// Whether a path exists. Only a missing path counts as absent; any other failure to look is refused as
// WRITE_NOT_ATOMIC, so a rollback never skips a move it could not check.
async function presentAt(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errnoOf(error) === "ENOENT") {
      return false;
    }
    throw asRealmError(error, "WRITE_NOT_ATOMIC");
  }
}

// Writes the backed-up marker and makes it durable: the file is synced, then its directory. Nothing moves into the root
// until this returns.
async function writeBackedUpMarker(workDir: string): Promise<void> {
  const handle = await open(join(workDir, BACKED_UP_FILE), "wx", 0o600);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDir(workDir);
}

// Removes the backed-up marker and makes the removal durable. Recovery reads the marker as "every root entry came from
// the stage", so the marker is gone before any original moves back into the root.
async function removeBackedUpMarker(workDir: string): Promise<void> {
  const marker = join(workDir, BACKED_UP_FILE);
  if (!(await presentAt(marker))) {
    return;
  }
  await rm(marker);
  await syncDir(workDir);
}

// Flushes a directory's entries to disk, so a file created or removed in it survives a crash.
async function syncDir(dir: string): Promise<void> {
  const handle = await open(dir, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// ---- Shared helpers --------------------------------------------------------------------------------------------------

// The state root must lie outside the workspace root. A checkpoint of a root that holds the state directory would copy
// the state directory, and any secrets or OpenShell files in it, into the checkpoint.
async function refuseStateInsideRoot(pinned: PinnedRoot, stateRoot: string): Promise<void> {
  if (isInsideRoot(pinned, await realpathOfNearest(stateRoot))) {
    throw makeRealmError("POLICY_DENIED");
  }
}

async function ensureSessionDir(stateRoot: string, sessionId: string): Promise<void> {
  const sessionDir = checkpointSessionDirOf(stateRoot, sessionId);
  await mkdir(sessionDir, { recursive: true, mode: PRIVATE_DIR_MODE });
  await chmod(checkpointsDirOf(stateRoot), PRIVATE_DIR_MODE);
  await chmod(sessionDir, PRIVATE_DIR_MODE);
}

// Creating the checkpoint directory without its parents is the reservation. It fails when the id is already taken.
async function reserveCheckpointDir(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: PRIVATE_DIR_MODE });
  } catch (error) {
    throw makeRealmError(errnoOf(error) === "EEXIST" ? "SCHEMA_INVALID" : "WRITE_NOT_ATOMIC");
  }
  try {
    await chmod(path, PRIVATE_DIR_MODE);
  } catch (error) {
    const removal = await tryRemove(removeDir, path);
    throw removal === undefined ? asRealmError(error, "WRITE_NOT_ATOMIC") : withCleanupCause(error, removal);
  }
}

async function makePrivateDir(path: string): Promise<void> {
  await mkdir(path, { mode: PRIVATE_DIR_MODE });
  await chmod(path, PRIVATE_DIR_MODE);
}

// A predicate that fails leaves the sandbox state unknown. The daemon cannot answer, so it is refused with REALM_NOT_ACTIVE.
async function requireSandboxStopped(sandboxRunning: SandboxRunning, sessionId: string): Promise<void> {
  let running: boolean;
  try {
    running = await sandboxRunning(sessionId);
  } catch {
    throw makeRealmError("REALM_NOT_ACTIVE");
  }
  if (running) {
    throw makeRealmError("LOCK_CONFLICT");
  }
}

// Every copy, scan and move passes through here. The step is recorded so that cleanup can wait for it.
function bounded<T>(steps: Steps, work: Promise<T>): Promise<T> {
  steps.pending = work;
  return withTimeout(work, CHECKPOINT_OP_TIMEOUT_MS, "TOOL_TIMEOUT");
}

// Waits, under the bound, for the step most recently started to settle. Cleanup touches the tree, the work directory and
// the lock only after this returns undefined. A step still running at expiry makes the operation stuck: from then on the
// tree, the work directory and the lock stay in place for recovery, and TOOL_TIMEOUT is returned.
async function quiesce(steps: Steps): Promise<RealmError | undefined> {
  if (steps.stuck) {
    return makeRealmError("TOOL_TIMEOUT");
  }
  if (steps.pending === undefined) {
    return undefined;
  }
  try {
    // A step's outcome already reached its caller through bounded(), or the caller had already failed with its timeout, so
    // only the step's settling is awaited here.
    await withTimeout(steps.pending.then(() => undefined, () => undefined), CHECKPOINT_OP_TIMEOUT_MS, "TOOL_TIMEOUT");
    return undefined;
  } catch (error) {
    steps.stuck = true;
    return asRealmError(error, "TOOL_TIMEOUT");
  }
}

// Removes a directory. A failure is returned as CLEANUP_FAILED, never thrown, so the caller decides whether it is a warning
// after a commit or the cause of the error it already throws.
async function tryRemove(remove: (path: string) => Promise<void>, path: string): Promise<RealmError | undefined> {
  try {
    await remove(path);
    return undefined;
  } catch {
    return makeRealmError("CLEANUP_FAILED");
  }
}

function removeDir(path: string): Promise<void> {
  return rm(path, { recursive: true, force: true });
}

// The operation's own error, with a failed cleanup recorded as its cause. The primary code stays the operation's.
function withCleanupCause(error: unknown, cleanup: RealmError): RealmError {
  return makeRealmError(asRealmError(error, "WRITE_NOT_ATOMIC").code, cleanup.code);
}

function asRealmError(error: unknown, code: ErrorCode): RealmError {
  return error instanceof RealmError ? error : makeRealmError(code);
}

// The real path of the nearest existing ancestor, with the missing tail appended. A link target that does not exist yet
// is still resolved through any link above it.
async function realpathOfNearest(path: string): Promise<string> {
  const missing: string[] = [];
  let existing = path;
  for (;;) {
    try {
      return join(await realpath(existing), ...missing);
    } catch {
      const parent = dirname(existing);
      if (parent === existing) {
        return path;
      }
      missing.unshift(basename(existing));
      existing = parent;
    }
  }
}

// Walks a tree and returns its manifest, sorted by path, with the per-entry stamps. Special files are refused. When
// containment is given, a link whose target resolves outside the root is refused. Links are never followed.
async function scanTree(treePath: string, containment?: PinnedRoot): Promise<Scan> {
  const out: Scan = { entries: [], stamps: new Map() };
  out.stamps.set("", stampOf(await lstat(treePath, { bigint: true })));
  await scanDirectory(treePath, "", containment, out);
  out.entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

async function scanDirectory(dir: string, prefix: string, containment: PinnedRoot | undefined, out: Scan): Promise<void> {
  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name);
    const relPath = prefix === "" ? name : `${prefix}/${name}`;
    const info = await lstat(path, { bigint: true });
    out.stamps.set(relPath, stampOf(info));
    const mode = Number(info.mode) & MODE_BITS;
    const size = Number(info.size);
    if (info.isDirectory()) {
      out.entries.push({ path: relPath, type: "directory", mode, size: 0 });
      await scanDirectory(path, relPath, containment, out);
    } else if (info.isFile()) {
      out.entries.push({ path: relPath, type: "file", mode, size, sha256: await hashFile(path) });
    } else if (info.isSymbolicLink()) {
      const target = await readlink(path);
      const resolved = await realpathOfNearest(resolve(dirname(path), target));
      if (containment !== undefined && !isInsideRoot(containment, resolved)) {
        throw makeRealmError("PATH_ESCAPE");
      }
      out.entries.push({ path: relPath, type: "symlink", mode, size, linkTarget: target });
    } else {
      throw makeRealmError("POLICY_DENIED");
    }
  }
}

function stampOf(info: BigIntStats): string {
  return `${String(info.dev)}:${String(info.ino)}:${String(info.size)}:${String(info.mtimeNs)}:${String(info.ctimeNs)}`;
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream: AsyncIterable<Buffer> = createReadStream(path);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

// Copies a tree entry by entry. Links are recreated with their target text, never followed. A directory is created
// private, filled, and then given its real mode, so a read-only directory never blocks its own contents.
async function copyTree(source: string, destination: string): Promise<void> {
  for (const name of (await readdir(source)).sort()) {
    const from = join(source, name);
    const to = join(destination, name);
    const info = await lstat(from);
    if (info.isDirectory()) {
      await makePrivateDir(to);
      await copyTree(from, to);
      await chmod(to, info.mode & MODE_BITS);
    } else if (info.isFile()) {
      await copyFile(from, to, constants.COPYFILE_EXCL);
      await chmod(to, info.mode & MODE_BITS);
    } else if (info.isSymbolicLink()) {
      await symlink(await readlink(from), to);
    } else {
      throw makeRealmError("POLICY_DENIED");
    }
  }
}

function sameEntries(a: readonly ManifestEntry[], b: readonly ManifestEntry[]): boolean {
  return a.length === b.length && a.every((entry, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      entry.path === other.path &&
      entry.type === other.type &&
      entry.mode === other.mode &&
      entry.size === other.size &&
      entry.linkTarget === other.linkTarget &&
      entry.sha256 === other.sha256
    );
  });
}

function sameStamps(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  return a.size === b.size && [...a].every(([path, stamp]) => b.get(path) === stamp);
}

// Reads the checkpoint's two entries before the lock, each under the operation bound. A missing entry is absent; any other
// failure is refused with a typed error, never dropped.
async function readCheckpoint(checkpointDir: string): Promise<CheckpointManifest> {
  const text = await withTimeout(
    readManifestText(join(checkpointDir, MANIFEST_FILE)),
    CHECKPOINT_OP_TIMEOUT_MS,
    "TOOL_TIMEOUT",
  );
  const tree = await withTimeout(
    lstatIfPresent(join(checkpointDir, TREE_DIR)),
    CHECKPOINT_OP_TIMEOUT_MS,
    "TOOL_TIMEOUT",
  );
  if (text === undefined || tree === undefined || !tree.isDirectory()) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return parseManifest(text);
}

// Reads a manifest without blocking on a special file. The open is non-blocking and never follows a link, so a FIFO, a
// device or a socket returns at once and is refused by fstat before any read. A link is refused at the open. The descriptor
// is closed on every path. A missing manifest is undefined.
async function readManifestText(path: string): Promise<string | undefined> {
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (isAbsent(error)) {
      return undefined;
    }
    throw makeRealmError(isNonRegularOpenError(error) ? "POLICY_DENIED" : "SCHEMA_INVALID");
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      throw makeRealmError("POLICY_DENIED");
    }
    return await handle.readFile("utf8");
  } catch (error: unknown) {
    throw asRealmError(error, "SCHEMA_INVALID");
  } finally {
    await closeHandle(handle);
  }
}

// An open that fails on a path which is not a regular file: a link (ELOOP under O_NOFOLLOW), or a socket or a device with
// no driver (ENXIO). Both are refused with the non-regular-file code scanTree uses.
function isNonRegularOpenError(error: unknown): boolean {
  const code = errnoOf(error);
  return code === "ELOOP" || code === "ENXIO";
}

// A path that does not exist, or whose parent is not a directory, is absent rather than a failure.
function isAbsent(error: unknown): boolean {
  const code = errnoOf(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

async function lstatIfPresent(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error: unknown) {
    if (isAbsent(error)) {
      return undefined;
    }
    throw makeRealmError("SCHEMA_INVALID");
  }
}

async function closeHandle(handle: FileHandle): Promise<void> {
  try {
    await handle.close();
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// A manifest read from disk is untrusted. Every path must stay inside the tree, so a restore cannot write outside it.
function parseManifest(text: string): CheckpointManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (typeof value !== "object" || value === null) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const { schema, entries } = value as RawManifest;
  if (schema !== MANIFEST_SCHEMA || !Array.isArray(entries)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return { schema: MANIFEST_SCHEMA, entries: entries.map(parseEntry) };
}

function parseEntry(value: unknown): ManifestEntry {
  if (typeof value !== "object" || value === null) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const { path, type, mode, size, linkTarget, sha256 } = value as RawEntry;
  if (typeof path !== "string" || !isSafeRelativePath(path)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (typeof mode !== "number" || !Number.isInteger(mode) || mode < 0 || mode > MODE_BITS) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (typeof size !== "number" || !Number.isInteger(size) || size < 0) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (type === "file") {
    if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256) || linkTarget !== undefined) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return { path, type, mode, size, sha256 };
  }
  if (type === "symlink") {
    if (typeof linkTarget !== "string" || sha256 !== undefined) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return { path, type, mode, size, linkTarget };
  }
  if (type === "directory" && size === 0 && linkTarget === undefined && sha256 === undefined) {
    return { path, type, mode, size };
  }
  throw makeRealmError("SCHEMA_INVALID");
}

function isSafeRelativePath(path: string): boolean {
  if (path === "" || path.startsWith("/")) {
    return false;
  }
  return path
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== ".." && !segment.includes("\0"));
}
