// Workspace checkpoints (RES-04, D19-6). A checkpoint is a full copy of a workspace tree plus a manifest.json that
// records, for each entry, its relative path, type, mode, size, link target (links) and sha256 (files). The manifest
// is the content identity. A snapshot is also refused when any entry's device, inode, size, mtime or ctime changed
// between the scan before the copy and the scan after it, so a host writer that changes and reverts a file during the
// copy is seen. The stamps are never stored: restored files get new inodes.
//
// The workspace is identified only by the session's registry entry (workspace-registry.ts). Its directory is verified
// against the pinned identity before the copy, after it, and before any move.
//
// Cross-process lock. Every public operation takes the session lock first: a file, `.lock`, in the session's checkpoint
// directory, created with O_EXCL. Its content records the owner: pid, start time in clock ticks (field 22 of
// /proc/<pid>/stat) and the boot id. A lock is taken over only when its owner is provably gone (the pid is not alive,
// its start time differs, or the boot differs). A live or unprovable owner keeps the lock, and the operation is refused
// with LOCK_CONFLICT. Under the lock the operation recovers the session's leftover work directories, then runs, then
// releases the lock. The sweep never runs without the lock.
//
// A restore keeps the workspace root directory (its device and inode never change), moves the root's entries aside into
// a backup, moves the staged entries in, writes a committed marker, and deletes the backup. A crash before the marker is
// undone by recovery, which moves the backup's originals back and discards the staged copy.
//
// Documented limits: a hard link becomes a separate file. Content is not filtered, so the state root must lie outside
// the workspace root; a root that holds the state directory is refused. A lock file that is empty or unreadable is
// refused, not taken over, so it needs manual removal.

import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  createReadStream,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
  type BigIntStats,
  type Stats,
} from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
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
const WORK_DIR_PREFIX = ".restore-";
const LOCK_FILE = ".lock";
const LOCK_SCHEMA = 1;
// A stale lock is taken over at most this many times before the operation is refused.
const LOCK_TAKEOVER_ATTEMPTS = 3;
const BOOT_ID_FILE = "/proc/sys/kernel/random/boot_id";
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
  // Test seam. Called before each move during a restore. A throw aborts the restore, and the tree is rolled back.
  readonly beforeMove?: (entryName: string) => void;
}

// The step most recently started. A failure can leave a step running after its bound has expired, so cleanup and
// rollback wait for that step before they touch the tree.
interface Steps {
  pending: Promise<unknown> | undefined;
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

// The owner recorded in the lock file.
interface OwnerRecord {
  readonly schema: 1;
  readonly pid: number;
  readonly startTicks: string;
  readonly bootId: string;
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

interface RawOwner {
  readonly schema?: unknown;
  readonly pid?: unknown;
  readonly startTicks?: unknown;
  readonly bootId?: unknown;
}

export async function snapshotWorkspace(request: SnapshotRequest): Promise<CheckpointManifest> {
  try {
    return await takeSnapshot(request);
  } catch (error) {
    throw asRealmError(error, "WRITE_NOT_ATOMIC");
  }
}

export async function restoreWorkspace(request: RestoreRequest): Promise<CheckpointManifest> {
  try {
    return await restoreFromCheckpoint(request);
  } catch (error) {
    throw asRealmError(error, "WRITE_NOT_ATOMIC");
  }
}

async function takeSnapshot(request: SnapshotRequest): Promise<CheckpointManifest> {
  const { entry, stateRoot } = request;
  const checkpointDir = checkpointDirOf(stateRoot, entry.sessionId, request.checkpointId);
  const pinned = verifyWorkspaceEntry(entry);
  await refuseStateInsideRoot(pinned, stateRoot);
  await ensureSessionDir(stateRoot, entry.sessionId);
  const lockPath = acquireSessionLock(checkpointSessionDirOf(stateRoot, entry.sessionId));
  try {
    return await snapshotLocked(request, pinned, checkpointDir);
  } finally {
    releaseSessionLock(lockPath);
  }
}

async function snapshotLocked(
  request: SnapshotRequest,
  pinned: PinnedRoot,
  checkpointDir: string,
): Promise<CheckpointManifest> {
  const { entry, stateRoot, sandboxRunning } = request;
  const steps: Steps = { pending: undefined };
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
    return manifest;
  } catch (error) {
    await steps.pending?.catch(() => undefined);
    await rm(checkpointDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function restoreFromCheckpoint(request: RestoreRequest): Promise<CheckpointManifest> {
  const { entry, stateRoot } = request;
  const checkpointDir = checkpointDirOf(stateRoot, entry.sessionId, request.checkpointId);
  const pinned = verifyWorkspaceEntry(entry);
  await refuseStateInsideRoot(pinned, stateRoot);
  // A checkpoint is immutable once written, so it is read before the lock; a missing one is refused here.
  const stored = await readCheckpoint(checkpointDir);
  const lockPath = acquireSessionLock(checkpointSessionDirOf(stateRoot, entry.sessionId));
  try {
    return await restoreLocked(request, pinned, checkpointDir, stored);
  } finally {
    releaseSessionLock(lockPath);
  }
}

async function restoreLocked(
  request: RestoreRequest,
  pinned: PinnedRoot,
  checkpointDir: string,
  stored: CheckpointManifest,
): Promise<CheckpointManifest> {
  const { entry, stateRoot, sandboxRunning } = request;
  const steps: Steps = { pending: undefined };
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
    await swapEntries(request, pinned, stage, backup, stored, steps, moved);
    await writeFile(join(workDir, COMMITTED_FILE), "", { flag: "wx" });
  } catch (error) {
    await steps.pending?.catch(() => undefined);
    if (moved.movedOut.length > 0 || moved.movedIn.length > 0) {
      await rollback(pinned.realPath, stage, backup, moved, steps);
    }
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  // The restored manifest matched and the commit marker is written, so the moved-aside originals are no longer needed.
  try {
    await rm(workDir, { recursive: true, force: true });
  } catch {
    throw makeRealmError("CLEANUP_FAILED");
  }
  return stored;
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
    const committed = (await lstat(join(workDir, COMMITTED_FILE)).catch(() => undefined)) !== undefined;
    if (!committed) {
      await returnOriginalTree(workDir, pinned.realPath, steps);
    }
    await bounded(steps, rm(workDir, { recursive: true, force: true }));
  }
}

// A crash leaves the original entries in the backup, and some restored entries in the root. A restored entry that shares
// a name with a backed-up original is set aside into the stage. Then every backed-up original moves back.
async function returnOriginalTree(workDir: string, root: string, steps: Steps): Promise<void> {
  const backup = join(workDir, BACKUP_DIR);
  const stage = join(workDir, STAGE_DIR);
  const backedUp = await readdir(backup).catch((): string[] => []);
  if (backedUp.length === 0) {
    return;
  }
  await mkdir(stage, { recursive: true, mode: PRIVATE_DIR_MODE });
  for (const name of await readdir(root)) {
    if (backedUp.includes(name)) {
      await bounded(steps, rename(join(root, name), join(stage, name)));
    }
  }
  for (const name of backedUp) {
    await bounded(steps, rename(join(backup, name), join(root, name)));
  }
}

async function swapEntries(
  request: RestoreRequest,
  pinned: PinnedRoot,
  stage: string,
  backup: string,
  stored: CheckpointManifest,
  steps: Steps,
  moved: MovedNames,
): Promise<void> {
  for (const name of (await readdir(pinned.realPath)).sort()) {
    request.beforeMove?.(name);
    moved.movedOut.push(name);
    await bounded(steps, rename(join(pinned.realPath, name), join(backup, name)));
  }
  for (const name of (await readdir(stage)).sort()) {
    request.beforeMove?.(name);
    moved.movedIn.push(name);
    await bounded(steps, rename(join(stage, name), join(pinned.realPath, name)));
  }
  await requireSandboxStopped(request.sandboxRunning, request.entry.sessionId);
  const restored = await bounded(steps, scanTree(pinned.realPath, pinned));
  if (!sameEntries(restored.entries, stored.entries)) {
    throw makeRealmError("WRITE_NOT_ATOMIC");
  }
}

// Moves back every entry that was moved, newest first. The original tree returns when this succeeds. A failure keeps
// the work directory, which still holds the original entries, for recovery.
async function rollback(root: string, stage: string, backup: string, moved: MovedNames, steps: Steps): Promise<void> {
  const undo: [from: string, to: string][] = [
    ...[...moved.movedIn].reverse().map((name): [string, string] => [join(root, name), join(stage, name)]),
    ...[...moved.movedOut].reverse().map((name): [string, string] => [join(backup, name), join(root, name)]),
  ];
  try {
    for (const [from, to] of undo) {
      if ((await lstat(from).catch(() => undefined)) !== undefined) {
        await bounded(steps, rename(from, to));
      }
    }
  } catch {
    // The original tree is not back in full, so the work directory is kept for recovery.
    throw makeRealmError("CLEANUP_FAILED", "WRITE_NOT_ATOMIC");
  }
}

// ---- Session lock ----------------------------------------------------------------------------------------------------

// Takes the session lock or refuses. Returns the lock path, which the caller releases.
function acquireSessionLock(sessionDir: string): string {
  const lockPath = join(sessionDir, LOCK_FILE);
  const text = `${JSON.stringify(ownRecord())}\n`;
  for (let attempt = 0; attempt < LOCK_TAKEOVER_ATTEMPTS; attempt += 1) {
    if (createLockFile(lockPath, text)) {
      return lockPath;
    }
    takeOverProvablyGone(lockPath);
  }
  throw makeRealmError("LOCK_CONFLICT");
}

// O_EXCL creates the lock. Returns false when a lock already exists.
function createLockFile(lockPath: string, text: string): boolean {
  let fd: number;
  try {
    fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch (error) {
    if (errnoOf(error) === "EEXIST") {
      return false;
    }
    throw makeRealmError("WRITE_NOT_ATOMIC");
  }
  try {
    writeSync(fd, text);
  } catch {
    closeSync(fd);
    unlinkSync(lockPath);
    throw makeRealmError("WRITE_NOT_ATOMIC");
  }
  closeSync(fd);
  return true;
}

// Removes an existing lock only when its owner is provably gone. A live or unprovable owner is LOCK_CONFLICT.
function takeOverProvablyGone(lockPath: string): void {
  const bootId = currentBootId();
  let seen: Stats;
  let raw: string;
  try {
    seen = lstatSync(lockPath);
    raw = readFileSync(lockPath, "utf8");
  } catch (error) {
    // The lock was released between the failed create and this read. The caller tries again.
    if (errnoOf(error) === "ENOENT") {
      return;
    }
    throw makeRealmError("LOCK_CONFLICT");
  }
  const owner = parseOwner(raw);
  if (owner === undefined || bootId === undefined || !ownerProvablyGone(owner, bootId)) {
    throw makeRealmError("LOCK_CONFLICT");
  }
  // Move the lock aside before removing it. Another process may have replaced the lock since it was read, so the moved
  // file must still be the inode that was read. Otherwise the moved lock is put back and the take-over is refused.
  const tombstone = `${lockPath}.stale-${randomBytes(8).toString("hex")}`;
  try {
    renameSync(lockPath, tombstone);
  } catch (error) {
    if (errnoOf(error) === "ENOENT") {
      return;
    }
    throw makeRealmError("LOCK_CONFLICT");
  }
  if (lstatSync(tombstone).ino !== seen.ino) {
    let restored: boolean;
    try {
      linkSync(tombstone, lockPath);
      restored = true;
    } catch {
      // The path was taken again, so the moved lock stays aside as the tombstone, for its owner to find.
      restored = false;
    }
    if (restored) {
      unlinkSync(tombstone);
    }
    throw makeRealmError("LOCK_CONFLICT");
  }
  unlinkSync(tombstone);
}

function releaseSessionLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch (error) {
    if (errnoOf(error) !== "ENOENT") {
      throw makeRealmError("CLEANUP_FAILED");
    }
  }
}

// The owner is provably gone when its boot differs, its pid is not alive, or its start time differs (the pid was reused).
// A live process whose start time cannot be read is unprovable, so it counts as live.
function ownerProvablyGone(owner: OwnerRecord, bootId: string): boolean {
  if (owner.bootId !== bootId) {
    return true;
  }
  if (!processAlive(owner.pid)) {
    return true;
  }
  const ticks = startTicksOf(owner.pid);
  return ticks !== undefined && ticks !== owner.startTicks;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists under another user.
    return errnoOf(error) === "EPERM";
  }
}

function ownRecord(): OwnerRecord {
  const startTicks = startTicksOf(process.pid);
  const bootId = currentBootId();
  if (startTicks === undefined || bootId === undefined) {
    throw makeRealmError("LOCK_CONFLICT");
  }
  return { schema: LOCK_SCHEMA, pid: process.pid, startTicks, bootId };
}

// Field 22 of /proc/<pid>/stat is the start time in clock ticks. The command name sits in parentheses and may hold
// spaces, so the fields are counted after the last ")". The first field after it is field 3, so field 22 is index 19.
function startTicksOf(pid: number): string | undefined {
  try {
    const text = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    return text.slice(text.lastIndexOf(")") + 2).split(" ")[19];
  } catch {
    return undefined;
  }
}

function currentBootId(): string | undefined {
  try {
    const id = readFileSync(BOOT_ID_FILE, "utf8").trim();
    return id === "" ? undefined : id;
  } catch {
    return undefined;
  }
}

function parseOwner(text: string): OwnerRecord | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const { schema, pid, startTicks, bootId } = value as RawOwner;
  if (schema !== LOCK_SCHEMA || typeof pid !== "number" || !Number.isInteger(pid) || pid < 1) {
    return undefined;
  }
  if (typeof startTicks !== "string" || !/^\d+$/.test(startTicks)) {
    return undefined;
  }
  if (typeof bootId !== "string" || bootId === "") {
    return undefined;
  }
  return { schema: LOCK_SCHEMA, pid, startTicks, bootId };
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
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
    throw asRealmError(error, "WRITE_NOT_ATOMIC");
  }
}

async function makePrivateDir(path: string): Promise<void> {
  await mkdir(path, { mode: PRIVATE_DIR_MODE });
  await chmod(path, PRIVATE_DIR_MODE);
}

// A predicate that fails leaves the sandbox state unknown. That is the gateway not answering, so it is refused.
async function requireSandboxStopped(sandboxRunning: SandboxRunning, sessionId: string): Promise<void> {
  let running: boolean;
  try {
    running = await sandboxRunning(sessionId);
  } catch {
    throw makeRealmError("OPENSHELL_GATEWAY_LOST");
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

async function readCheckpoint(checkpointDir: string): Promise<CheckpointManifest> {
  const text = await readFile(join(checkpointDir, MANIFEST_FILE), "utf8").catch(() => undefined);
  const tree = await lstat(join(checkpointDir, TREE_DIR)).catch(() => undefined);
  if (text === undefined || tree === undefined || !tree.isDirectory()) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return parseManifest(text);
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
