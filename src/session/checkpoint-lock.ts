// The session lock of the checkpoint library (RES-04). A file, `.lock`, in the session's checkpoint directory names the
// owner that holds the session: its pid, its start time in clock ticks and the boot id. The lock is published whole. The
// owner record is written and synced to a temporary file in the same directory, then linked to the lock path with
// link(2). link fails with EEXIST when the lock exists, so the lock path either does not exist or already holds the full
// record. A crash before the link leaves only a temporary name, which no reader opens and which does not block a later
// acquisition.
//
// A lock is taken over only when its owner is provably gone (the pid is not alive, its start time differs, or the boot
// differs). A live or unprovable owner keeps the lock, and the caller is refused with LOCK_CONFLICT. A lock file that is
// empty or unreadable, as an older release could leave after a crash, is refused, not taken over.

import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";
import { makeRealmError } from "../core/errors.js";
import { errnoOf } from "../fs/canonicalize.js";
import { currentBootId, startTicksOf } from "./proc-identity.js";

const LOCK_FILE = ".lock";
// A temporary owner record is named with this prefix in the session directory until it is linked to the lock.
const TEMP_PREFIX = ".lock.tmp-";
const LOCK_SCHEMA = 1;
const OWNER_FILE_MODE = 0o600;
// A stale lock is taken over at most this many times before the operation is refused.
const LOCK_TAKEOVER_ATTEMPTS = 3;

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
  for (let attempt = 0; attempt < LOCK_TAKEOVER_ATTEMPTS; attempt += 1) {
    if (publishLock(sessionDir, lockPath)) {
      return lockPath;
    }
    takeOverProvablyGone(lockPath);
  }
  throw makeRealmError("LOCK_CONFLICT");
}

export function releaseSessionLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch (error) {
    if (errnoOf(error) !== "ENOENT") {
      throw makeRealmError("CLEANUP_FAILED");
    }
  }
}

// Publishes the owner record at lockPath. Returns false when a lock already exists. The temporary name is removed on
// every path.
function publishLock(sessionDir: string, lockPath: string): boolean {
  const tempPath = join(sessionDir, `${TEMP_PREFIX}${randomBytes(8).toString("hex")}`);
  try {
    writeOwnerFile(tempPath, `${JSON.stringify(ownRecord())}\n`);
    return linkLock(tempPath, lockPath);
  } finally {
    removeTempFile(tempPath);
  }
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

// The temporary name is removed once the lock is published or refused. A file that cannot be removed holds no lock and
// no reader opens a temporary name, so its failure does not fail an acquisition that already succeeded.
function removeTempFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Already gone, or left behind. Either way it is never read as a lock.
  }
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
    // The lock was released between the failed link and this read. The caller tries again.
    if (errnoOf(error) === "ENOENT") {
      return;
    }
    throw makeRealmError("LOCK_CONFLICT");
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
