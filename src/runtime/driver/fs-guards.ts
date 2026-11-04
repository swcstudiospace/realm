// Path guards shared by the driver's lifecycle and compute code. A refusal is always a catalogue code. No raw filesystem error and
// no path text leaves this module.

import { lstatSync, realpathSync, type Stats } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { makeRealmError, type ErrorCode } from "../../core/errors.js";

// True when child is parent or lies inside it. Both paths are already resolved. The separator is part of the match, so a
// sibling that shares a name prefix (/a/bc under /a/b) is not inside.
export function isInsideInclusive(parent: string, child: string): boolean {
  const prefix = parent.endsWith(sep) ? parent : parent + sep;
  return child === parent || child.startsWith(prefix);
}

// True when child is a strict descendant of parent. Both paths are already resolved. The root itself, a ../ escape and an
// absolute relative result are all false.
export function isStrictlyInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

// Refuses a target that does not lie strictly inside root. Both paths are resolved first, so a target spelled with ".."
// segments or a trailing separator is judged by where it actually lands.
export function assertStrictlyInside(target: string, root: string): void {
  if (!isStrictlyInside(resolve(root), resolve(target))) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// The real location of a path, with every symbolic link resolved. A path that cannot be resolved, including a missing one
// or a dangling link, is refused.
export function realPathOrRefuse(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// The lstat of a path, never following a final symbolic link. A missing path returns null. Any other failure is refused
// with failureCode.
export function lstatOrAbsent(path: string, failureCode: ErrorCode): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw makeRealmError(failureCode);
  }
}
