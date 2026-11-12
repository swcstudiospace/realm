// The session lock of the checkpoint library (RES-04). A file, `.lock`, in the session's checkpoint directory names the
// owner that holds the session: its pid, its start time in clock ticks and the boot id. The lock is published whole. The
// owner record is written and synced to a temporary file in the same directory, then linked to the lock path with
// link(2). link fails with EEXIST when the lock exists, so the lock path either does not exist or already holds the full
// record. A crash before the link leaves only a temporary name, which no reader opens and which does not block a later
// acquisition.
//
// A lock is taken over only when its owner is provably gone (the pid is not alive, its start time differs, or the boot
// differs). A live or unprovable owner keeps the lock, and the caller is refused with LOCK_CONFLICT. A lock file that is
// not a regular file, empty or unreadable, as an older release could leave after a crash, is refused, not taken over.

import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";
import { type ErrorCode, makeRealmError, RealmError } from "../core/errors.js";
import { errnoOf, openVerified } from "../fs/canonicalize.js";
import { currentBootId, startTicksOf } from "./proc-identity.js";
import { checkpointSessionDirOf } from "./paths.js";

const LOCK_FILE = ".lock";
// A temporary owner record is named with this prefix in the session directory until it is linked to the lock.
const TEMP_PREFIX = ".lock.tmp-";
const LOCK_SCHEMA = 1;
const OWNER_FILE_MODE = 0o600;
// A stale lock is taken over at most this many times before the operation is refused.
const LOCK_TAKEOVER_ATTEMPTS = 3;
// Test seam: removes a lock file. A test replaces unlink to make a release fail, and restores unlinkSync afterwards.
export const lockRemoval: { unlink: (path: string) => void } = { unlink: unlinkSync };

// The owner recorded in the lock file. The start time is kept as its decimal text, as the file stores it.
interface OwnerRecord {
  readonly schema: typeof LOCK_SCHEMA;
  readonly pid: number;
  readonly startTicks: string;
  readonly bootId: string;
}

// Untrusted JSON read from disk. Each field is checked with typeof before it is used.
interface RawOwner {
  readonly schema?: unknown;
  readonly pid?: unknown;
  readonly startTicks?: unknown;
  readonly bootId?: unknown;
}

// Takes the session lock or refuses. Returns the lock path, which the caller releases.
export function acquireSessionLock(sessionDir: string): string {
  const lockPath = join(sessionDir, LOCK_FILE);
  refuseAfterFailedRelease(lockPath);
  for (let attempt = 0; attempt < LOCK_TAKEOVER_ATTEMPTS; attempt += 1) {
    if (publishLock(sessionDir, lockPath)) {
      return lockPath;
    }
    takeOverProvablyGone(lockPath);
  }
  throw makeRealmError("LOCK_CONFLICT");
}

// The release is returned, not thrown, so the caller decides: a warning after a commit, or the cause of the error it is
// already throwing. Nothing is thrown from a finally.
export function releaseSessionLock(
  lockPath: string,
): { readonly ok: true } | { readonly ok: false; readonly error: RealmError } {
  try {
    lockRemoval.unlink(lockPath);
    return { ok: true };
  } catch (error) {
    if (errnoOf(error) === "ENOENT") {
      return { ok: true };
    }
    return { ok: false, error: makeRealmError("CLEANUP_FAILED") };
  }
}

const SESSION_DIR_MODE = 0o700;

// Sandbox starts in this process that hold the session lock, by lock path. The lock file records one owner, this process, so a
// second start here cannot take it again; it shares the held file instead. The count rises for each start, and the file is
// released when the last start settles. A checkpoint in this process finds the file held, so it is refused with LOCK_CONFLICT
// exactly as one in another process is. Starts never hold the file while a checkpoint does.
const startHolders = new Map<string, number>();

// Starts whose release of the lock file failed, by lock path, with the catalogue code. See refuseAfterFailedRelease.
const failedReleases = new Map<string, ErrorCode>();

// Holds the session lock for a sandbox start. The lock is taken before fn runs. Its share is dropped once fn has settled and
// every start still in flight has settled, so a start that outlives its caller keeps the lock until it settles, and a checkpoint
// cannot run while the sandbox is still starting. The caller gets fn's outcome when fn settles. The share is taken once per
// process and shared by the starts in it. While a checkpoint holds the session, in this process or another, a start is refused
// with REALM_NOT_ACTIVE (retryable): a checkpoint is in progress, so the caller retries.
export async function withStartLock<T>(
  stateRoot: string,
  sessionId: string,
  fn: () => Promise<T>,
  inFlight: () => readonly Promise<unknown>[],
): Promise<T> {
  const sessionDir = checkpointSessionDirOf(stateRoot, sessionId);
  const lockPath = join(sessionDir, LOCK_FILE);
  const holders = startHolders.get(lockPath);
  if (holders === undefined) {
    acquireForStart(sessionDir);
  }
  startHolders.set(lockPath, (holders ?? 0) + 1);
  // fn is called here, before any await, so a timer it arms is armed before the caller's next step.
  const outcome = fn();
  // Registered before the caller can await outcome, so the share is dropped before the caller resumes.
  const release = (): void => {
    releaseWhenDrained(lockPath, inFlight);
  };
  void outcome.then(release, release);
  return await outcome;
}

// Takes the file lock for a start. The session directory is created when it is absent. A held lock is refused as
// REALM_NOT_ACTIVE, not LOCK_CONFLICT, because for a start the holder is a checkpoint in progress.
function acquireForStart(sessionDir: string): void {
  try {
    mkdirSync(sessionDir, { recursive: true, mode: SESSION_DIR_MODE });
  } catch {
    throw makeRealmError("WRITE_NOT_ATOMIC");
  }
  try {
    acquireSessionLock(sessionDir);
  } catch (error) {
    if (error instanceof RealmError && error.code === "LOCK_CONFLICT") {
      throw makeRealmError("REALM_NOT_ACTIVE");
    }
    throw error;
  }
}

// Releases the share once no start is in flight. A start still in flight is waited for, and the check runs again when it
// settles, since another start may have been issued meanwhile.
function releaseWhenDrained(lockPath: string, inFlight: () => readonly Promise<unknown>[]): void {
  const waiting = inFlight();
  if (waiting.length > 0) {
    // allSettled, not all: a rejected start settles too, so the share is still dropped and no rejection is left unhandled.
    void Promise.allSettled(waiting).then(() => {
      releaseWhenDrained(lockPath, inFlight);
    });
    return;
  }
  dropStartShare(lockPath);
}

// Drops one start's share. The file is released with the last share, and the count is cleared before the release, so a
// failed release leaves no stale count behind.
function dropStartShare(lockPath: string): void {
  const remaining = (startHolders.get(lockPath) ?? 0) - 1;
  if (remaining > 0) {
    startHolders.set(lockPath, remaining);
    return;
  }
  startHolders.delete(lockPath);
  // A start's release has no caller to report to: the start settles in the background. A failed release is recorded, so
  // the next acquisition is refused with the recorded code while the file still names this process.
  const release = releaseSessionLock(lockPath);
  if (release.ok) {
    failedReleases.delete(lockPath);
  } else {
    failedReleases.set(lockPath, release.error.code);
  }
}

// A failed release leaves the lock file naming this process. While that file names this process, an acquisition is
// refused with the recorded code, so the failure stays visible. The record is cleared once the file no longer names it.
function refuseAfterFailedRelease(lockPath: string): void {
  const code = failedReleases.get(lockPath);
  if (code === undefined) {
    return;
  }
  if (namesThisProcess(lockPath)) {
    throw makeRealmError(code);
  }
  failedReleases.delete(lockPath);
}

// Whether the lock file names this process. An absent file names no one. A file that cannot be read is refused as
// LOCK_CONFLICT.
function namesThisProcess(lockPath: string): boolean {
  const raw = readLockFile(lockPath);
  if (raw === undefined) {
    return false;
  }
  const owner = parseOwner(raw);
  const bootId = currentBootId();
  const startTicks = startTicksOf(process.pid);
  return (
    owner !== undefined &&
    bootId !== null &&
    startTicks !== undefined &&
    owner.pid === process.pid &&
    owner.startTicks === String(startTicks) &&
    owner.bootId === bootId
  );
}

// Reads the lock file through openVerified, on the real path of the lock. Returns undefined when the lock is absent, which
// is the meaning of ENOENT. A lock that is not a regular file, or that cannot be verified or read, is LOCK_CONFLICT.
// openVerified refuses a FIFO without blocking on it, so a FIFO at the lock path is refused rather than hanging the open.
function readLockFile(lockPath: string): string | undefined {
  let entry: Stats;
  try {
    entry = lstatSync(lockPath);
  } catch (error) {
    if (errnoOf(error) === "ENOENT") {
      return undefined;
    }
    throw makeRealmError("LOCK_CONFLICT");
  }
  // A symbolic link at the lock path is refused, not followed: its target is not the lock, and a take-over would move
  // the link aside. Only a regular file is read.
  if (!entry.isFile()) {
    throw makeRealmError("LOCK_CONFLICT");
  }
  let realPath: string;
  try {
    realPath = realpathSync(lockPath);
  } catch (error) {
    if (errnoOf(error) === "ENOENT") {
      return undefined;
    }
    throw makeRealmError("LOCK_CONFLICT");
  }
  let fd: number;
  try {
    fd = openVerified(realPath);
  } catch {
    // openVerified refuses every failed open as PATH_ESCAPE, so a lock removed after realpathSync lands here too.
    if (lockIsAbsent(lockPath)) {
      return undefined;
    }
    throw makeRealmError("LOCK_CONFLICT");
  }
  try {
    return readFileSync(fd, "utf8");
  } catch {
    throw makeRealmError("LOCK_CONFLICT");
  } finally {
    closeSync(fd);
  }
}

// Whether nothing exists at the lock path. Any other lstat failure is not absence.
function lockIsAbsent(lockPath: string): boolean {
  try {
    lstatSync(lockPath);
    return false;
  } catch (error) {
    return errnoOf(error) === "ENOENT";
  }
}

// Publishes the owner record at lockPath. Returns false when a lock already exists. The temporary name is removed on
// every path. A temporary name that cannot be removed refuses the acquisition with CLEANUP_FAILED; a lock this call
// published is released first, so a refused acquisition holds no lock.
function publishLock(sessionDir: string, lockPath: string): boolean {
  const tempPath = join(sessionDir, `${TEMP_PREFIX}${randomBytes(8).toString("hex")}`);
  let published: boolean;
  try {
    writeOwnerFile(tempPath, `${JSON.stringify(ownRecord())}\n`);
    published = linkLock(tempPath, lockPath);
  } catch (error) {
    throw operationError(error, removeTempFile(tempPath));
  }
  const removal = removeTempFile(tempPath);
  if (removal === undefined) {
    return published;
  }
  if (published) {
    const release = releaseSessionLock(lockPath);
    throw release.ok ? removal : operationError(removal, release.error);
  }
  throw removal;
}

// Creates the temporary owner file and syncs its content before it is linked.
function writeOwnerFile(path: string, text: string): void {
  let fd: number;
  try {
    fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, OWNER_FILE_MODE);
  } catch {
    throw makeRealmError("WRITE_NOT_ATOMIC");
  }
  try {
    writeFileSync(fd, text);
    fsyncSync(fd);
  } catch {
    throw makeRealmError("WRITE_NOT_ATOMIC");
  } finally {
    closeSync(fd);
  }
}

// link(2) of the synced owner file to the lock path. EEXIST means the lock is held.
function linkLock(tempPath: string, lockPath: string): boolean {
  try {
    linkSync(tempPath, lockPath);
    return true;
  } catch (error) {
    if (errnoOf(error) === "EEXIST") {
      return false;
    }
    throw makeRealmError("WRITE_NOT_ATOMIC");
  }
}

// The temporary name is removed once the lock is published or refused. An absent name is already removed. A name that
// cannot be removed is returned as CLEANUP_FAILED, and publishLock refuses the acquisition on it.
function removeTempFile(path: string): RealmError | undefined {
  try {
    unlinkSync(path);
    return undefined;
  } catch (error) {
    if (errnoOf(error) === "ENOENT") {
      return undefined;
    }
    return makeRealmError("CLEANUP_FAILED");
  }
}

// The error an operation throws. A failed cleanup is recorded as its cause; the primary code stays the operation's.
function operationError(error: unknown, cleanup: RealmError | undefined): RealmError {
  if (cleanup === undefined && error instanceof RealmError) {
    return error;
  }
  return makeRealmError(error instanceof RealmError ? error.code : "WRITE_NOT_ATOMIC", cleanup?.code);
}

// Removes an existing lock only when its owner is provably gone. A live or unprovable owner is LOCK_CONFLICT.
function takeOverProvablyGone(lockPath: string): void {
  const bootId = currentBootId();
  let seen: Stats;
  try {
    seen = lstatSync(lockPath);
  } catch (error) {
    if (errnoOf(error) === "ENOENT") {
      return;
    }
    throw makeRealmError("LOCK_CONFLICT");
  }
  // The lock was released between the failed link and this read. The caller tries again.
  const raw = readLockFile(lockPath);
  if (raw === undefined) {
    return;
  }
  const owner = parseOwner(raw);
  if (owner === undefined || bootId === null || !ownerProvablyGone(owner, bootId)) {
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
    // The moved file is not the lock that was read, so it goes back. EEXIST means the path was taken again: the
    // moved lock stays aside as the tombstone, for its owner to find. Any other failure keeps it there too, and is
    // refused as WRITE_NOT_ATOMIC, the code linkLock uses for a failed link.
    try {
      linkSync(tombstone, lockPath);
    } catch (error) {
      throw makeRealmError(errnoOf(error) === "EEXIST" ? "LOCK_CONFLICT" : "WRITE_NOT_ATOMIC");
    }
    unlinkSync(tombstone);
    throw makeRealmError("LOCK_CONFLICT");
  }
  unlinkSync(tombstone);
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
  return ticks !== undefined && String(ticks) !== owner.startTicks;
}

// Whether the pid names a live process. ESRCH proves it gone, and EPERM means it exists under another user. Any other
// failure leaves the owner unproven, so it is LOCK_CONFLICT, the code a take-over refuses with.
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = errnoOf(error);
    if (code === "ESRCH") {
      return false;
    }
    if (code === "EPERM") {
      return true;
    }
    throw makeRealmError("LOCK_CONFLICT");
  }
}

function ownRecord(): OwnerRecord {
  const startTicks = startTicksOf(process.pid);
  const bootId = currentBootId();
  if (startTicks === undefined || bootId === null) {
    throw makeRealmError("LOCK_CONFLICT");
  }
  return { schema: LOCK_SCHEMA, pid: process.pid, startTicks: String(startTicks), bootId };
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
