// The local safe subset of realm doctor --fix (ONB-02, D-1507): state, run and sessions only.
// Preflight every target before writing. Pin existing directories with O_DIRECTORY|O_NOFOLLOW,
// check their identity and owner, and change modes with fchmod only. Missing leaves are created
// through the pinned parent's /proc/self/fd path. No path-based chmod fallback is permitted.
// Unreadable directories and umasks that prevent opening new directories fail closed; the
// operator must restore owner read/search access before retrying. Dry-run never mutates disk.

import { closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, realpathSync, type Stats } from "node:fs";
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { RealmError } from "../core/errors.js";
import { sessionsDirOf } from "../session/paths.js";

const PRIVATE_DIR_MODE = 0o700;
const PERMISSION_BITS = 0o7777;
const OWNER_READ_SEARCH = 0o500;
const PROC_FD_DIR = "/proc/self/fd";

export interface ProtectedLocations {
  readonly home: string;
  readonly workspace: string;
}

export type FixAction =
  | { readonly kind: "create-directory"; readonly path: string; readonly mode: number }
  | { readonly kind: "set-mode"; readonly path: string; readonly previousMode: number; readonly mode: number };

type RefusalDetail = "unsafe-target" | "symlink" | "not-a-directory" | "foreign-owner" | "unreadable-directory" | "changed-directory" | "unsafe-umask" | "filesystem-error";

// A catalogue error plus fixed, non-runtime detail. Already-applied actions are retained if a
// later write fails; callers must not report that a partial repair changed nothing.
export class FixRefusal extends RealmError {
  constructor(
    readonly path: string,
    readonly detail: RefusalDetail,
    readonly applied: readonly FixAction[] = [],
  ) {
    super("SCHEMA_INVALID");
    this.name = "FixRefusal";
  }
}

export interface SafeFixOptions {
  // Deterministic race seam, matching the filesystem modules' boundary hooks. No production caller supplies it.
  readonly stageHook?: (stage: "before-open" | "before-apply" | "before-chmod", path: string) => void;
}

interface PinnedDirectory {
  readonly path: string;
  readonly fd: number;
  readonly stats: Stats;
}

// Every observable refusal is decided before the first write. There is no rollback of changes
// if a later filesystem operation fails; FixRefusal.applied reports that case honestly.
export function applySafeFixes(
  stateDir: string,
  dryRun: boolean,
  locations: ProtectedLocations,
  options: SafeFixOptions = {},
): readonly FixAction[] {
  const target = normalizeStateDir(stateDir);
  const pins = new Map<string, PinnedDirectory>();
  const applied: FixAction[] = [];
  try {
    const paths = [target, join(target, "run"), sessionsDirOf(target)];
    for (const path of paths) refuseProtectedTarget(path, locations);
    const parent = dirname(target);
    const parentStats = observeDirectory(parent, false);
    if (parentStats === undefined) throw new FixRefusal(target, "unsafe-target");
    pins.set(parent, pinDirectory(parent, parentStats, options));
    const actions: FixAction[] = [];
    let stateExists = false;
    for (const path of paths) {
      // A missing state directory has no children to observe yet.
      const current: Stats | undefined = path === target || stateExists ? observeDirectory(path, true) : undefined;
      if (path === target) stateExists = current !== undefined;
      if (current === undefined) {
        actions.push({ kind: "create-directory", path, mode: PRIVATE_DIR_MODE });
      } else {
        pins.set(path, pinDirectory(path, current, options));
        const mode = current.mode & PERMISSION_BITS;
        if (mode !== PRIVATE_DIR_MODE) actions.push({ kind: "set-mode", path, previousMode: mode, mode: PRIVATE_DIR_MODE });
      }
    }
    // mkdir applies umask before an fd can be opened. Read Linux's proc status without
    // changing the process-wide mask; process.umask() would write it twice and race threads.
    // Do not create an unreadable leaf and then follow its path to chmod it, even as root.
    if (actions.some((action) => action.kind === "create-directory")) {
      const mask = /^Umask:[\t ]+([0-7]{4})[\t ]*$/m.exec(readFileSync("/proc/self/status", "utf8"))?.[1];
      if (mask === undefined || (Number.parseInt(mask, 8) & OWNER_READ_SEARCH) !== 0) {
        throw new FixRefusal(target, "unsafe-umask");
      }
    }
    for (const pin of pins.values()) verifyPin(pin);
    if (!dryRun) {
      for (const action of actions) {
        options.stageHook?.("before-apply", action.path);
        // Validate the whole pinned chain before each mutation, not just the leaf.
        for (const pin of pins.values()) verifyPin(pin);
        applyAction(action, pins, options, applied);
      }
    }
    return actions;
  } catch (error: unknown) {
    if (error instanceof FixRefusal) throw new FixRefusal(error.path, error.detail, applied);
    throw new FixRefusal(target, "filesystem-error", applied);
  } finally {
    for (const pin of pins.values()) closeSync(pin.fd);
  }
}

function normalizeStateDir(stateDir: string): string {
  const target = stateDir.replace(/\/+$/, "") || sep;
  const names = target.split(sep);
  if (!isAbsolute(stateDir) || names.includes(".") || names.includes("..") || resolve(target) !== target) {
    throw new FixRefusal(stateDir, "unsafe-target");
  }
  return target;
}

// Canonical comparisons also protect targets spelled through a home/workspace alias. The
// descriptor checks below separately refuse symlinked ancestors rather than traversing them.
function refuseProtectedTarget(target: string, locations: ProtectedLocations): void {
  if (!isAbsolute(locations.home) || !isAbsolute(locations.workspace)) throw new FixRefusal(target, "unsafe-target");
  const canonical = canonicalPath(target);
  const home = canonicalPath(locations.home);
  const workspace = canonicalPath(locations.workspace);
  if (
    parse(canonical).root === canonical || canonical === home || canonical === workspace ||
    workspace.startsWith(`${canonical}${sep}`) || canonical.startsWith(`${workspace}${sep}`)
  ) {
    throw new FixRefusal(target, "unsafe-target");
  }
}

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch (error: unknown) {
    const parent = dirname(absolute);
    if (!isMissing(error) || parent === absolute) throw new FixRefusal(path, "unsafe-target");
    return join(canonicalPath(parent), basename(absolute));
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function observeDirectory(path: string, requireOwner: boolean): Stats | undefined {
  let stats: Stats;
  try {
    stats = lstatSync(path);
  } catch (error: unknown) {
    if (isMissing(error)) return undefined;
    throw new FixRefusal(path, "filesystem-error");
  }
  if (stats.isSymbolicLink()) throw new FixRefusal(path, "symlink");
  if (!stats.isDirectory()) throw new FixRefusal(path, "not-a-directory");
  if (requireOwner && stats.uid !== process.getuid?.()) throw new FixRefusal(path, "foreign-owner");
  if (requireOwner && (stats.mode & OWNER_READ_SEARCH) !== OWNER_READ_SEARCH) {
    throw new FixRefusal(path, "unreadable-directory");
  }
  return stats;
}

function pinDirectory(path: string, observed: Stats, options: SafeFixOptions): PinnedDirectory {
  options.stageHook?.("before-open", path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const pin = { path, fd, stats: observed };
    verifyPin(pin);
    return pin;
  } catch (error: unknown) {
    closeSync(fd);
    throw error;
  }
}

function verifyPin(pin: PinnedDirectory): void {
  const opened = fstatSync(pin.fd);
  const named = lstatSync(pin.path);
  if (
    !opened.isDirectory() || !named.isDirectory() || named.isSymbolicLink() ||
    opened.dev !== pin.stats.dev || opened.ino !== pin.stats.ino || opened.uid !== pin.stats.uid ||
    named.dev !== opened.dev || named.ino !== opened.ino || named.uid !== opened.uid ||
    realpathSync(pin.path) !== pin.path || readlinkSync(join(PROC_FD_DIR, String(pin.fd))) !== pin.path
  ) {
    throw new FixRefusal(pin.path, "changed-directory");
  }
}

function applyAction(action: FixAction, pins: Map<string, PinnedDirectory>, options: SafeFixOptions, applied: FixAction[]): void {
  let pin = pins.get(action.path);
  if (action.kind === "create-directory") {
    const parent = pins.get(dirname(action.path));
    if (parent === undefined) throw new FixRefusal(action.path, "unsafe-target");
    verifyPin(parent);
    const through = join(PROC_FD_DIR, String(parent.fd), basename(action.path));
    // Non-recursive mkdir is no-clobber: a concurrent leaf creation is a refusal.
    mkdirSync(through, { mode: action.mode });
    // The directory now exists, so record it before any later open or check can fail.
    applied.push(action);
    const observed = observeDirectory(action.path, true);
    if (observed === undefined) throw new FixRefusal(action.path, "changed-directory");
    pin = pinDirectory(action.path, observed, options);
    pins.set(action.path, pin);
  }
  if (pin === undefined) throw new FixRefusal(action.path, "changed-directory");
  verifyPin(pin);
  const before = fstatSync(pin.fd);
  if (before.uid !== process.getuid?.()) throw new FixRefusal(action.path, "foreign-owner");
  if ((before.mode & PERMISSION_BITS) !== action.mode) {
    options.stageHook?.("before-chmod", action.path);
    fchmodSync(pin.fd, action.mode);
  }
  const after = fstatSync(pin.fd);
  if (after.uid !== before.uid || (after.mode & PERMISSION_BITS) !== action.mode) {
    throw new FixRefusal(action.path, "changed-directory");
  }
  if (action.kind === "set-mode") applied.push(action);
  verifyPin(pin);
}
