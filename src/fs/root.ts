// Workspace root binding (D-22, D-29 step 1, F-9). This module owns only the bind
// step: it resolves a root with realpath, requires a directory, and returns the
// pinned root object that every other fs function takes. The walk lives in
// canonicalize.ts.

import { realpathSync, statSync, type Stats } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { makeRealmError } from "../core/errors.js";

export class PinnedRoot {
  readonly realPath: string;

  constructor(realPath: string) {
    this.realPath = realPath;
  }
}

// Binds a root. A root that cannot be resolved, is not a directory, or is not an
// absolute path fails with POLICY_DENIED (D-22).
export function bindRoot(path: string): PinnedRoot {
  if (!isAbsolute(path)) {
    throw makeRealmError("POLICY_DENIED");
  }
  const realPath = realpathOrDeny(path);
  if (!statOrDeny(realPath).isDirectory()) {
    throw makeRealmError("POLICY_DENIED");
  }
  return new PinnedRoot(realPath);
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
