// Workspace root binding (D-22, D-29 step 1, F-9). This module owns only the bind
// step: it resolves a root with realpath, requires a directory, and returns the
// pinned root object that every other fs function takes. The walk lives in
// canonicalize.ts.

import { realpathSync, statSync, type Stats } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { makeRealmError } from "../core/errors.js";

export class PinnedRoot {
  readonly realPath: string;
  // The device and inode of the directory at bind time. assertSameRoot compares them to
  // detect a directory replaced after it was pinned.
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

// Throws POLICY_DENIED when current is not the directory pinned earlier. A different device or
// inode means the directory at the path was replaced after it was pinned.
export function assertSameRoot(pinned: PinnedRoot, current: PinnedRoot): void {
  if (pinned.dev !== current.dev || pinned.ino !== current.ino) {
    throw makeRealmError("POLICY_DENIED");
  }
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
