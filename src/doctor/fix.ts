// The safe subset of realm doctor --fix (ONB-02). It creates the state directory, and its run and sessions directories, when they are
// missing, and sets the state directory to mode 0700. Nothing else changes. Every path that can be observed before a write is observed
// first, so a symbolic link, a path that is not a directory, and a directory the current user does not own are refused with
// SCHEMA_INVALID and the disk is left as it was. The filesystem root, the home directory, the workspace root and every ancestor of the
// workspace are never a state directory. With dryRun the same actions are returned and nothing is written. A second run finds nothing
// to do.

import { chmodSync, lstatSync, mkdirSync, realpathSync, type Stats } from "node:fs";
import { basename, dirname, join, parse, resolve, sep } from "node:path";
import { makeRealmError } from "../core/errors.js";
import { sessionsDirOf } from "../session/paths.js";

const PRIVATE_DIR_MODE = 0o700;
const PERMISSION_BITS = 0o777;
// Owner read and search: the bits a directory needs before its children can be listed.
const READ_SEARCH_BITS = 0o500;

// The home directory and the workspace root. They are passed in, so nothing here reads the environment.
export interface ProtectedLocations {
  readonly home: string;
  readonly workspace: string;
}

// One change the fix made, or would make with dryRun. A create-directory action names a directory that is missing. A set-mode action
// names a directory whose permission bits are not mode, and previousMode is what they were.
export type FixAction =
  | { readonly kind: "create-directory"; readonly path: string; readonly mode: number }
  | { readonly kind: "set-mode"; readonly path: string; readonly previousMode: number; readonly mode: number };

// Applies the safe subset to the state directory and returns the actions in the order they are taken. With dryRun true the list is the
// same and nothing is created or changed. A dry run over a directory the owner cannot read yet reports only its repair, because its
// children cannot be observed until the repair is made.
export function applySafeFixes(stateDir: string, dryRun: boolean, locations: ProtectedLocations): readonly FixAction[] {
  const target = normalizeStateDir(stateDir);
  refuseProtectedTarget(target, locations);
  refuseUnsafeSpelling(target);

  const current = observeDirectory(target);
  const stateActions = planStateMode(target, current);
  const readable = current === undefined || (current.mode & READ_SEARCH_BITS) === READ_SEARCH_BITS;
  const observed = readable ? planChildren(target) : undefined;
  if (dryRun) {
    return [...stateActions, ...(observed ?? [])];
  }
  for (const action of stateActions) {
    applyAction(action);
  }
  const children = observed ?? planChildren(target);
  for (const action of children) {
    applyAction(action);
  }
  return [...stateActions, ...children];
}

// The spelling used for every check and every write. Trailing separators are removed, so "dir/" is the path "dir". The root keeps its
// separator.
function normalizeStateDir(stateDir: string): string {
  const trimmed = stateDir.replace(/\/+$/, "");
  return trimmed === "" && stateDir.startsWith(sep) ? sep : trimmed;
}

// Compared in canonical form, so a symbolic link in a parent path does not hide a protected location.
function refuseProtectedTarget(target: string, locations: ProtectedLocations): void {
  const canonical = canonicalPath(target);
  const home = canonicalPath(locations.home);
  const workspace = canonicalPath(locations.workspace);
  const isRoot = parse(canonical).root === canonical;
  const isHomeOrWorkspace = canonical === home || canonical === workspace;
  const isAncestorOfWorkspace = workspace.startsWith(`${canonical}${sep}`);
  if (isRoot || isHomeOrWorkspace || isAncestorOfWorkspace) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// The final component must be a name. A final "." and any ".." are refused. The kernel resolves them through a symbolic link that lstat
// and O_NOFOLLOW do not see, and join collapses ".." lexically, so the checked path and the written path would name different places.
function refuseUnsafeSpelling(target: string): void {
  const names = target.split(sep);
  const last = names[names.length - 1];
  if (last === undefined || last === "" || last === "." || names.includes("..")) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// The real path of path, or of its longest existing ancestor with the missing rest appended.
function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch (error: unknown) {
    const parent = dirname(absolute);
    const notFound = typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
    if (!notFound || parent === absolute) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return join(canonicalPath(parent), basename(absolute));
  }
}

function planStateMode(target: string, current: Stats | undefined): FixAction[] {
  if (current === undefined) {
    return [{ kind: "create-directory", path: target, mode: PRIVATE_DIR_MODE }];
  }
  const mode = current.mode & PERMISSION_BITS;
  return mode === PRIVATE_DIR_MODE ? [] : [{ kind: "set-mode", path: target, previousMode: mode, mode: PRIVATE_DIR_MODE }];
}

function planChildren(target: string): FixAction[] {
  const actions: FixAction[] = [];
  for (const path of [join(target, "run"), sessionsDirOf(target)]) {
    if (observeDirectory(path) === undefined) {
      actions.push({ kind: "create-directory", path, mode: PRIVATE_DIR_MODE });
    }
  }
  return actions;
}

// lstat, so a link is seen as a link and never followed. Undefined when the path is absent. A symbolic link, a path that is not a
// directory, a directory another user owns, and any other failure are refused.
function observeDirectory(path: string): Stats | undefined {
  let stats: Stats;
  try {
    stats = lstatSync(path);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (stats.isSymbolicLink() || !stats.isDirectory() || stats.uid !== process.getuid?.()) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return stats;
}

// Creates a missing directory, then sets its mode. The umask can leave a new directory with fewer bits than requested, so the mode is
// always set and then checked.
function applyAction(action: FixAction): void {
  if (action.kind === "create-directory") {
    try {
      mkdirSync(action.path, { mode: action.mode });
    } catch {
      throw makeRealmError("SCHEMA_INVALID");
    }
  }
  repairMode(action.path, action.mode);
}

// Sets the permission bits of a directory the current user owns, then checks that they took. The change is made by path, because a
// directory whose mode lacks read or search permission cannot be opened to be changed through a descriptor. The path is observed just
// before the change and again just after it, so a symbolic link, a directory another user owns, or a mode that did not take is refused.
// Known race: the check and the chmod are separate system calls, so a link swapped in between is followed by the chmod. The window is
// accepted because it is confined to the owner's own directory. Swapping that path needs write access to its parent, and the only
// change made is to the mode of a directory the current user owns.
function repairMode(path: string, mode: number): void {
  const before = observeDirectory(path);
  if (before === undefined) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if ((before.mode & PERMISSION_BITS) !== mode) {
    try {
      chmodSync(path, mode);
    } catch {
      throw makeRealmError("SCHEMA_INVALID");
    }
  }
  const after = observeDirectory(path);
  if (after === undefined || (after.mode & PERMISSION_BITS) !== mode) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}
