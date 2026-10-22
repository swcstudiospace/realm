// Workspace root binding (D-22, D-29 step 1, F-9). This module owns only the bind
// step: it resolves a root with realpath, requires a directory, and returns the
// pinned root object that every other fs function takes. The walk lives in
// canonicalize.ts.

import { closeSync, constants, fstatSync, openSync, readlinkSync, realpathSync, statSync, type Stats } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { makeRealmError } from "../core/errors.js";

// The directory that names an open descriptor's path on Linux. Without it, assertPinnedAt fails closed.
const PROC_FD_DIR = "/proc/self/fd";

export class PinnedRoot {
  readonly realPath: string;
  // The device and inode of the directory at bind time. verifyPinnedAt compares them to detect a
  // directory replaced after it was pinned.
  readonly dev: number;
  readonly ino: number;

  constructor(realPath: string, dev: number, ino: number) {
    this.realPath = realPath;
    this.dev = dev;
    this.ino = ino;
  }
}

// Binds a root. A root that cannot be resolved, is not a directory, or is not an
// absolute path fails with POLICY_DENIED (D-22).
export function bindRoot(path: string): PinnedRoot {
  if (!isAbsolute(path)) {
    throw makeRealmError("POLICY_DENIED");
  }
  const realPath = realpathOrDeny(path);
  const stats = statOrDeny(realPath);
  if (!stats.isDirectory()) {
    throw makeRealmError("POLICY_DENIED");
  }
  return new PinnedRoot(realPath, stats.dev, stats.ino);
}

// Binds a requested workspace under the policy (D-22). The requested path must be absolute
// and canonicalize. Every policy root must canonicalize too, even when an earlier one already
// contains the request. The canonical request must then lie inside at least one canonical
// policy root. Anything else fails with POLICY_DENIED.
export function bindWorkspaceUnderPolicy(
  policyRoots: readonly string[],
  requested: string,
): PinnedRoot {
  const root = bindRoot(requested);
  const roots = policyRoots.map((entry) => bindRoot(entry));
  if (roots.some((policyRoot) => isInsideRoot(policyRoot, root.realPath))) {
    return root;
  }
  throw makeRealmError("POLICY_DENIED");
}

// Returns the pinned root when requested names the same directory now, and throws POLICY_DENIED
// otherwise. The path is opened once, and the descriptor answers both questions: its device and
// inode must be the pinned ones, and the path /proc names for that descriptor must be the pinned
// real path. A directory swapped in at the path fails the first test. A pinned directory that
// moved and is reached through a link fails the second, because the real path no longer names it.
// Without /proc the second test cannot run, so the check fails closed.
export function verifyPinnedAt(pinned: PinnedRoot, requested: string): PinnedRoot {
  if (!isAbsolute(requested)) {
    throw makeRealmError("POLICY_DENIED");
  }
  const fd = openDirectoryOrDeny(requested);
  try {
    const stats = fstatSync(fd);
    if (stats.dev !== pinned.dev || stats.ino !== pinned.ino) {
      throw makeRealmError("POLICY_DENIED");
    }
    if (readlinkOrDeny(`${PROC_FD_DIR}/${fd}`) !== pinned.realPath) {
      throw makeRealmError("POLICY_DENIED");
    }
  } finally {
    closeSync(fd);
  }
  return pinned;
}

// True when the absolute real path equals the root or lies below it. The check is
// on path segments, so a sibling such as "<root>2" is outside the root.
export function isInsideRoot(root: PinnedRoot, candidate: string): boolean {
  const rel = relative(root.realPath, candidate);
  if (rel === "") {
    return true;
  }
  if (isAbsolute(rel)) {
    return false;
  }
  return rel.split(sep)[0] !== "..";
}

function realpathOrDeny(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    throw makeRealmError("POLICY_DENIED");
  }
}

function statOrDeny(path: string): Stats {
  try {
    return statSync(path);
  } catch {
    throw makeRealmError("POLICY_DENIED");
  }
}

function openDirectoryOrDeny(path: string): number {
  try {
    return openSync(path, constants.O_RDONLY | constants.O_DIRECTORY);
  } catch {
    throw makeRealmError("POLICY_DENIED");
  }
}

function readlinkOrDeny(path: string): string {
  try {
    return readlinkSync(path);
  } catch {
    throw makeRealmError("POLICY_DENIED");
  }
}
