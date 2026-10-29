// Atomic replace (D-35, FS-05). The temp file sits beside the target, is verified
// through its descriptor (D-30), and is renamed over the target only after the prior
// content hash still matches. Any failure before the rename removes the temp file and
// leaves the target byte-identical. The stage hook is a test seam; production callers
// do not pass it.
//
// The parent directory is pinned (A10 F6). Node 22 has no renameat or unlinkat, so after the
// canonical check the directory is opened once and every later step (temp open, lstat and hash
// of the target, rename, cleanup unlink) acts through /proc/self/fd/<dirFd>/<name>. A directory
// or ancestor swapped for a symlink after the check cannot redirect those steps: they stay in
// the directory that was verified. The directory fsync uses the same descriptor. Linux is
// assumed, as in src/fs/root.ts; without /proc the write fails closed with PATH_ESCAPE.

import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fsyncSync,
  fstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { type ErrorCode, makeRealmError, RealmError } from "../core/errors.js";
import { lstatIfPresent, PROC_FD_DIR } from "./canonicalize.js";

export type AtomicWriteStage = "after-temp-write" | "after-fsync" | "before-rename" | "after-recheck";

export type StageHook = (stage: AtomicWriteStage) => void;

export interface AtomicWriteOptions {
  // SHA-256 hex of the content the caller observed, or null when the target was absent.
  readonly expectedPriorSha256: string | null;
  // Test seam. "after-recheck" fires after the pin and prior-hash re-check, immediately before the rename.
  readonly stageHook?: StageHook;
  // Overrides /proc/self/fd, as in canonicalize.ts. A missing directory fails closed with PATH_ESCAPE.
  readonly procFdDir?: string;
}

// Reported when the write did not complete. `replaced` is false when the target is
// still the original file. It is true only when the rename succeeded and the parent
// directory fsync then failed: the new content is in place but durability is not
// confirmed.
export class WriteNotAtomicError extends RealmError {
  readonly replaced: boolean;

  constructor(replaced: boolean, causeCode?: ErrorCode) {
    super("WRITE_NOT_ATOMIC", causeCode);
    this.replaced = replaced;
    this.message = replaced
      ? `${this.reason} The file was replaced, but durability is not confirmed.`
      : this.reason;
  }
}

const TEMP_FILE_MODE = 0o600;

// The one definition of the temp-file name. The writer builds names with tempFileName and the
// orphan sweep (temp-sweep.ts) recognises them with TEMP_NAME_PATTERN, so the two cannot drift.
// The suffix is always 16 lowercase hex digits.
export const TEMP_NAME_PATTERN = /^\.(.+)\.realm-tmp-[0-9a-f]{16}$/;

export function tempFileName(name: string): string {
  return `.${name}.realm-tmp-${randomBytes(8).toString("hex")}`;
}

export function sha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

// Hash of the regular file at path, or null when it is absent. A symlink or other
// non-regular file is PATH_ESCAPE.
export function observeSha256(path: string): string | null {
  return observeSha256Through(path, path);
}

// Hash of the regular file reached through viaPath, whose real path must be realPath. The two
// differ when viaPath goes through a pinned directory descriptor.
function observeSha256Through(
  viaPath: string,
  realPath: string,
  procFdDir: string = PROC_FD_DIR,
): string | null {
  const stats = lstatIfPresent(viaPath);
  if (stats === null) {
    return null;
  }
  if (!stats.isFile()) {
    throw makeRealmError("PATH_ESCAPE");
  }
  let fd: number;
  try {
    fd = openSync(viaPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    throw makeRealmError("PATH_ESCAPE");
  }
  try {
    verifyDescriptorThrough(fd, viaPath, realPath, procFdDir);
    return sha256Hex(readFileSync(fd));
  } finally {
    closeSync(fd);
  }
}

// Checks that an open descriptor is the regular file reached through viaPath and that the kernel
// names it realPath. Any mismatch, and a missing or unreadable /proc entry, is PATH_ESCAPE.
function verifyDescriptorThrough(
  fd: number,
  viaPath: string,
  realPath: string,
  procFdDir: string,
): void {
  if (!existsSync(procFdDir)) {
    throw makeRealmError("PATH_ESCAPE");
  }
  const opened = fstatSync(fd);
  if (!opened.isFile()) {
    throw makeRealmError("PATH_ESCAPE");
  }
  const named = lstatIfPresent(viaPath);
  if (named === null || opened.dev !== named.dev || opened.ino !== named.ino) {
    throw makeRealmError("PATH_ESCAPE");
  }
  if (readlinkOrEscape(join(procFdDir, String(fd))) !== realPath) {
    throw makeRealmError("PATH_ESCAPE");
  }
}

// Removes the temp file a failed write left behind. A failed removal is not thrown over the
// original failure. It returns CLEANUP_FAILED, which the caller keeps as the cause.
function removeTempFile(path: string): ErrorCode | undefined {
  try {
    rmSync(path, { force: true });
    return undefined;
  } catch {
    return "CLEANUP_FAILED";
  }
}

export function atomicWriteFile(
  targetPath: string,
  content: string | Uint8Array,
  options: AtomicWriteOptions,
): void {
  const dir = dirname(targetPath);
  const name = basename(targetPath);
  const procFdDir = options.procFdDir ?? PROC_FD_DIR;
  assertCanonicalDirectory(dir);
  const dirFd = pinDirectory(dir, procFdDir);
  try {
    replaceInPinnedDirectory(dir, dirFd, name, content, options, procFdDir);
    try {
      syncDirectoryFd(dirFd);
    } catch {
      throw new WriteNotAtomicError(true);
    }
  } finally {
    closeSync(dirFd);
  }
}

function replaceInPinnedDirectory(
  dir: string,
  dirFd: number,
  name: string,
  content: string | Uint8Array,
  options: AtomicWriteOptions,
  procFdDir: string,
): void {
  const through = (leaf: string): string => join(procFdDir, String(dirFd), leaf);
  const targetVia = through(name);
  const existing = lstatIfPresent(targetVia);
  if (existing !== null && !existing.isFile()) {
    throw makeRealmError("PATH_ESCAPE");
  }
  // Only permission bits carry over; setuid and setgid are never copied to the replacement.
  const mode = existing === null ? TEMP_FILE_MODE : existing.mode & 0o777;

  const tempName = tempFileName(name);
  const tempVia = through(tempName);
  let fd: number;
  try {
    fd = openSync(
      tempVia,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      TEMP_FILE_MODE,
    );
  } catch {
    throw new WriteNotAtomicError(false);
  }

  try {
    verifyDescriptorThrough(fd, tempVia, join(dir, tempName), procFdDir);
    fchmodSync(fd, mode);
    writeFileSync(fd, content);
    options.stageHook?.("after-temp-write");
    fsyncSync(fd);
    options.stageHook?.("after-fsync");
    options.stageHook?.("before-rename");
    assertDirectoryPinned(dirFd, dir, procFdDir);
    if (observeSha256Through(targetVia, join(dir, name), procFdDir) !== options.expectedPriorSha256) {
      throw makeRealmError("LOCK_CONFLICT");
    }
    options.stageHook?.("after-recheck");
    renameSync(tempVia, targetVia);
  } catch (error: unknown) {
    const cleanup = removeTempFile(tempVia);
    if (error instanceof RealmError) {
      if (cleanup === undefined) {
        throw error;
      }
      throw makeRealmError(error.code, cleanup);
    }
    throw new WriteNotAtomicError(false, cleanup);
  } finally {
    closeSync(fd);
  }
}

// The directory must be its own real path and must not be a symlink, so the temp file
// name created inside it resolves to the path the verification expects.
function assertCanonicalDirectory(dir: string): void {
  const stats = lstatIfPresent(dir);
  if (stats === null || !stats.isDirectory()) {
    throw makeRealmError("PATH_ESCAPE");
  }
  if (realpathOrEscape(dir) !== dir) {
    throw makeRealmError("PATH_ESCAPE");
  }
}

function realpathOrEscape(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    throw makeRealmError("PATH_ESCAPE");
  }
}

function readlinkOrEscape(path: string): string {
  try {
    return readlinkSync(path);
  } catch {
    throw makeRealmError("PATH_ESCAPE");
  }
}

// Opens the verified directory and proves the descriptor is that directory. O_NONBLOCK keeps a
// FIFO from blocking the open; O_DIRECTORY rejects a regular file. A failed open or check is
// PATH_ESCAPE. The caller closes the returned descriptor.
export function pinDirectory(dir: string, procFdDir: string): number {
  if (!existsSync(procFdDir)) {
    throw makeRealmError("PATH_ESCAPE");
  }
  let fd: number;
  try {
    fd = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NONBLOCK);
  } catch {
    throw makeRealmError("PATH_ESCAPE");
  }
  try {
    assertDirectoryPinned(fd, dir, procFdDir);
  } catch (error: unknown) {
    try {
      closeSync(fd);
    } catch {
      // The verification failure stays the error thrown. The close failure is kept as its cause.
      const code = error instanceof RealmError ? error.code : "PATH_ESCAPE";
      throw makeRealmError(code, "CLEANUP_FAILED");
    }
    throw error;
  }
  return fd;
}

// The descriptor must still be the directory at dir: same device and inode as the path, and the
// kernel names it dir. A directory or ancestor swapped after the pin fails here.
export function assertDirectoryPinned(dirFd: number, dir: string, procFdDir: string): void {
  const opened = fstatSync(dirFd);
  if (!opened.isDirectory()) {
    throw makeRealmError("PATH_ESCAPE");
  }
  const named = lstatIfPresent(dir);
  if (named === null || !named.isDirectory() || opened.dev !== named.dev || opened.ino !== named.ino) {
    throw makeRealmError("PATH_ESCAPE");
  }
  if (readlinkOrEscape(join(procFdDir, String(dirFd))) !== dir) {
    throw makeRealmError("PATH_ESCAPE");
  }
}

// Flushes a directory entry through an open directory descriptor. fstat is the check that the
// descriptor is a directory; anything else is PATH_ESCAPE.
export function syncDirectoryFd(fd: number): void {
  if (!fstatSync(fd).isDirectory()) {
    throw makeRealmError("PATH_ESCAPE");
  }
  fsyncSync(fd);
}

// Flushes the parent directory entry by path. O_DIRECTORY rejects a regular file and
// O_NONBLOCK keeps a FIFO from blocking the open; fstat is the final check that the
// descriptor is a directory. Any open failure or a non-directory is PATH_ESCAPE.
export function syncDirectory(dir: string): void {
  let fd: number;
  try {
    fd = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NONBLOCK);
  } catch {
    throw makeRealmError("PATH_ESCAPE");
  }
  try {
    syncDirectoryFd(fd);
  } finally {
    closeSync(fd);
  }
}
