// Atomic replace (D-35, FS-05). The temp file sits beside the target, is verified
// through its descriptor (D-30), and is renamed over the target only after the prior
// content hash still matches. Any failure before the rename removes the temp file and
// leaves the target byte-identical. The stage hook is a test seam; production callers
// do not pass it.

import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { type ErrorCode, makeRealmError, RealmError } from "../core/errors.js";
import { lstatIfPresent, openVerified, verifyDescriptor } from "./canonicalize.js";

export type AtomicWriteStage = "after-temp-write" | "after-fsync" | "before-rename";

export type StageHook = (stage: AtomicWriteStage) => void;

export interface AtomicWriteOptions {
  // SHA-256 hex of the content the caller observed, or null when the target was absent.
  readonly expectedPriorSha256: string | null;
  readonly stageHook?: StageHook;
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

export function sha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

// Hash of the regular file at path, or null when it is absent. A symlink or other
// non-regular file is PATH_ESCAPE.
export function observeSha256(path: string): string | null {
  const stats = lstatIfPresent(path);
  if (stats === null) {
    return null;
  }
  if (!stats.isFile()) {
    throw makeRealmError("PATH_ESCAPE");
  }
  const fd = openVerified(path);
  try {
    return sha256Hex(readFileSync(fd));
  } finally {
    closeSync(fd);
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
  assertCanonicalDirectory(dir);

  const existing = lstatIfPresent(targetPath);
  if (existing !== null && !existing.isFile()) {
    throw makeRealmError("PATH_ESCAPE");
  }
  // Only permission bits carry over; setuid and setgid are never copied to the replacement.
  const mode = existing === null ? TEMP_FILE_MODE : existing.mode & 0o777;

  const tempPath = join(dir, `.${name}.realm-tmp-${randomBytes(8).toString("hex")}`);
  let fd: number;
  try {
    fd = openSync(
      tempPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      TEMP_FILE_MODE,
    );
  } catch {
    throw new WriteNotAtomicError(false);
  }

  try {
    verifyDescriptor(fd, tempPath);
    fchmodSync(fd, mode);
    writeFileSync(fd, content);
    options.stageHook?.("after-temp-write");
    fsyncSync(fd);
    options.stageHook?.("after-fsync");
    options.stageHook?.("before-rename");
    if (observeSha256(targetPath) !== options.expectedPriorSha256) {
      throw makeRealmError("LOCK_CONFLICT");
    }
    renameSync(tempPath, targetPath);
  } catch (error: unknown) {
    const cleanup = removeTempFile(tempPath);
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

  try {
    syncDirectory(dir);
  } catch {
    throw new WriteNotAtomicError(true);
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

// Flushes the parent directory entry after a rename. O_DIRECTORY rejects a regular file and
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
    if (!fstatSync(fd).isDirectory()) {
      throw makeRealmError("PATH_ESCAPE");
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
