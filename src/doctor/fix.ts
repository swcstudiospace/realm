// The safe subset of realm doctor --fix (ONB-02). It creates the state directory, and its run and sessions directories, when they are
// missing, and sets the state directory to mode 0700. Nothing else changes. Every path is observed before anything is written, so a
// symbolic link, or a path that is not a directory, is refused with SCHEMA_INVALID and the disk is left as it was. With dryRun the same
// actions are returned and nothing is written. A second run finds nothing to do.

import { closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, type Stats } from "node:fs";
import { join } from "node:path";
import { makeRealmError } from "../core/errors.js";
import { sessionsDirOf } from "../session/paths.js";

const PRIVATE_DIR_MODE = 0o700;
const PERMISSION_BITS = 0o777;

// One change the fix made, or would make with dryRun. A create-directory action names a directory that is missing. A set-mode action
// names a directory whose permission bits are not mode, and previousMode is what they were.
export type FixAction =
  | { readonly kind: "create-directory"; readonly path: string; readonly mode: number }
  | { readonly kind: "set-mode"; readonly path: string; readonly previousMode: number; readonly mode: number };

// Applies the safe subset to the state directory and returns the actions in the order they are taken. With dryRun true the list is the
// same and nothing is created or changed.
export function applySafeFixes(stateDir: string, dryRun: boolean): readonly FixAction[] {
  const actions = planSafeFixes(stateDir);
  if (!dryRun) {
    for (const action of actions) {
      applyAction(action);
    }
  }
  return actions;
}

// Every path is observed first, so a refusal happens before the first write.
function planSafeFixes(stateDir: string): FixAction[] {
  const actions: FixAction[] = [];
  const state = observeDirectory(stateDir);
  if (state === undefined) {
    actions.push({ kind: "create-directory", path: stateDir, mode: PRIVATE_DIR_MODE });
  } else if ((state.mode & PERMISSION_BITS) !== PRIVATE_DIR_MODE) {
    actions.push({ kind: "set-mode", path: stateDir, previousMode: state.mode & PERMISSION_BITS, mode: PRIVATE_DIR_MODE });
  }
  for (const path of [join(stateDir, "run"), sessionsDirOf(stateDir)]) {
    if (observeDirectory(path) === undefined) {
      actions.push({ kind: "create-directory", path, mode: PRIVATE_DIR_MODE });
    }
  }
  return actions;
}

// lstat, so a link is seen as a link and never followed. Undefined when the path is absent. A symbolic link, a path that is not a
// directory, and any other failure are refused.
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
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return stats;
}

// Creates or re-modes one directory. The mode is changed through a descriptor opened with O_NOFOLLOW, so a link swapped in after the
// plan is refused rather than followed. Any failure is refused with SCHEMA_INVALID, and the raw error text is not copied.
function applyAction(action: FixAction): void {
  try {
    if (action.kind === "create-directory") {
      mkdirSync(action.path, { mode: action.mode });
    }
    const fd = openSync(action.path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      if ((fstatSync(fd).mode & PERMISSION_BITS) !== action.mode) {
        fchmodSync(fd, action.mode);
      }
    } finally {
      closeSync(fd);
    }
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
}
