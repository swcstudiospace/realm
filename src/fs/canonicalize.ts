// Path canonicalization and descriptor verification (D-29, D-30, FS-01, FS-02).
//
// The walk runs one segment at a time with lstat. Symlinks are expanded here, at most
// MAX_SYMLINK_HOPS times, and the final real path must lie inside the pinned root.
// Node 22 has no openat, so the open is resolve-then-verify: open with O_NOFOLLOW,
// then compare the descriptor with lstat of the real path and with the target that
// /proc/self/fd names. Linux only. Where /proc/self/fd is unavailable, verification
// fails closed with PATH_ESCAPE (F-8); it is never skipped.

import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readlinkSync,
  type Stats,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { makeRealmError } from "../core/errors.js";
import { isInsideRoot, type PinnedRoot } from "./root.js";

export const MAX_SYMLINK_HOPS = 40;

export const PROC_FD_DIR = "/proc/self/fd";

export interface FoundPath {
  readonly status: "found";
  readonly realPath: string;
}

// The walk reached a segment that does not exist. `nearest` is the deepest real path
// reached; `missing` lists the segments that do not exist below it. A write may create
// the target only when `missing` has exactly one segment.
export interface AbsentPath {
  readonly status: "absent";
  readonly nearest: string;
  readonly missing: readonly string[];
}

export type CanonicalPath = FoundPath | AbsentPath;

export interface CanonicalizeOptions {
  // "write" refuses a symlink at the final segment (D-34 step 1).
  readonly mode?: "read" | "write";
}

export interface OpenOptions {
  // Invoked after the path is resolved and before it is opened (D-30). Production
  // callers do not pass it; the race test drives it.
  readonly onResolveBoundary?: (realPath: string) => void;
  // Overrides /proc/self/fd. A missing directory makes verification fail closed.
  readonly procFdDir?: string;
}

export interface OpenedFile {
  readonly status: "found";
  readonly fd: number;
  readonly realPath: string;
}

export function errnoOf(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

// lstat that reports a missing path as null. Any other failure cannot be verified,
// so it fails closed with PATH_ESCAPE.
export function lstatIfPresent(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error: unknown) {
    const code = errnoOf(error);
    if (code === "ENOENT" || code === "ENOTDIR") {
      return null;
    }
    throw makeRealmError("PATH_ESCAPE");
  }
}

export function canonicalize(
  root: PinnedRoot,
  relPath: string,
  options: CanonicalizeOptions = {},
): CanonicalPath {
  if (isAbsolute(relPath)) {
    throw makeRealmError("PATH_ESCAPE");
  }
  const writing = options.mode === "write";
  const queue = relPath.split("/");
  const missing: string[] = [];
  let current = root.realPath;
  let hops = 0;

  for (let segment = queue.shift(); segment !== undefined; segment = queue.shift()) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (missing.length > 0) {
        missing.pop();
      } else {
        current = dirname(current);
      }
      continue;
    }
    if (missing.length > 0) {
      missing.push(segment);
      continue;
    }
    const next = join(current, segment);
    const stats = lstatIfPresent(next);
    if (stats === null) {
      missing.push(segment);
      continue;
    }
    if (stats.isSymbolicLink()) {
      if (writing && queue.length === 0) {
        throw makeRealmError("PATH_ESCAPE");
      }
      hops += 1;
      if (hops > MAX_SYMLINK_HOPS) {
        throw makeRealmError("PATH_ESCAPE");
      }
      const target = readlinkOrEscape(next);
      // An absolute target restarts the walk at the filesystem root. The containment
      // check below decides whether the final path is acceptable.
      if (isAbsolute(target)) {
        current = "/";
      }
      queue.unshift(...target.split("/"));
      continue;
    }
    current = next;
  }

  if (missing.length > 0) {
    if (!isInsideRoot(root, join(current, ...missing))) {
      throw makeRealmError("PATH_ESCAPE");
    }
    return { status: "absent", nearest: current, missing: [...missing] };
  }
  if (!isInsideRoot(root, current)) {
    throw makeRealmError("PATH_ESCAPE");
  }
  return { status: "found", realPath: current };
}

// Checks that an open descriptor is the regular file at realPath (D-30). A descriptor that
// is not a regular file, any mismatch, and any missing or unreadable /proc entry is PATH_ESCAPE.
// A named FIFO reports its own path through /proc/self/fd, so the readlink comparison alone
// does not reject a FIFO swapped in at realPath; the file-type check does.
export function verifyDescriptor(fd: number, realPath: string, procFdDir: string = PROC_FD_DIR): void {
  if (!existsSync(procFdDir)) {
    throw makeRealmError("PATH_ESCAPE");
  }
  const opened = fstatSync(fd);
  if (!opened.isFile()) {
    throw makeRealmError("PATH_ESCAPE");
  }
  const named = lstatIfPresent(realPath);
  if (named === null || opened.dev !== named.dev || opened.ino !== named.ino) {
    throw makeRealmError("PATH_ESCAPE");
  }
  if (readlinkOrEscape(join(procFdDir, String(fd))) !== realPath) {
    throw makeRealmError("PATH_ESCAPE");
  }
}

// Opens a resolved real path with O_NOFOLLOW and O_NONBLOCK, then verifies the descriptor.
// O_NONBLOCK keeps a swapped-in FIFO from blocking the open: the open returns at once and
// verification refuses the non-regular file. Every open failure is PATH_ESCAPE: a symlink
// swapped in after resolution fails with ELOOP, and an unverifiable path is treated as
// escaping. The caller closes the returned fd.
export function openVerified(realPath: string, procFdDir: string = PROC_FD_DIR): number {
  let fd: number;
  try {
    fd = openSync(realPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    throw makeRealmError("PATH_ESCAPE");
  }
  try {
    verifyDescriptor(fd, realPath, procFdDir);
  } catch (error: unknown) {
    closeSync(fd);
    throw error;
  }
  return fd;
}

// The production open path: canonicalize in read mode, run the resolve-to-open hook,
// then open with verification. The caller closes the returned fd when found.
export function openCanonical(
  root: PinnedRoot,
  relPath: string,
  options: OpenOptions = {},
): OpenedFile | AbsentPath {
  const resolved = canonicalize(root, relPath, { mode: "read" });
  if (resolved.status === "absent") {
    return resolved;
  }
  options.onResolveBoundary?.(resolved.realPath);
  const fd = openVerified(resolved.realPath, options.procFdDir);
  return { status: "found", fd, realPath: resolved.realPath };
}

function readlinkOrEscape(path: string): string {
  try {
    return readlinkSync(path);
  } catch {
    throw makeRealmError("PATH_ESCAPE");
  }
}
