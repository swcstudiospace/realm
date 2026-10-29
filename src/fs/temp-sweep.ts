// Orphan temp-file sweep (CRASH-01, D-1401, D-1402). A process killed between the temp write and
// the rename of atomicWriteFile leaves `.<name>.realm-tmp-<16 hex>` beside the target. This module
// removes such files, and only such files, under a list of roots.
//
// What it removes: a regular file whose name matches TEMP_NAME_PATTERN (the pattern the writer
// uses), owned by options.ownerUid, whose age is at least options.minAgeMs, on the root's device.
// What it never does: follow a symlink, enter a symlinked directory, enter a directory on another
// device, or read file content.
//
// Every directory is reached through a descriptor opened with O_NOFOLLOW|O_DIRECTORY and every
// later step acts through /proc/self/fd/<fd>/<name>, as atomic-write.ts does, so a directory
// swapped for a symlink during the walk cannot redirect the sweep. Without /proc the pin fails
// and the root is skipped.
//
// Each removal is audited BEFORE the unlink, so a deletion is never unrecorded. If the audit
// callback throws, the file is kept. The module reads no process state and no environment: the
// clock, the owner, the age bound and the audit sink are all injected.

import {
  closeSync,
  constants,
  type Dir,
  type Dirent,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  type Stats,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { assertDirectoryPinned, pinDirectory, TEMP_NAME_PATTERN } from "./atomic-write.js";
import { PROC_FD_DIR } from "./canonicalize.js";
import { bindRoot } from "./root.js";

// Directory entries buffered per read of a directory, so a huge directory is never held whole.
const DIR_READ_BATCH = 64;

// A file younger than this is never removed by the daemon-start sweep. A temp file lives for one
// write and one fsync, so the bound only has to exceed the longest legitimate write.
export const ORPHAN_TEMP_MIN_AGE_MS = 60_000;

export const DEFAULT_SWEEP_MAX_ENTRIES = 500_000;
export const DEFAULT_SWEEP_DEADLINE_MS = 15_000;

// One audit line. There is no `phase`, so the line keeps the pre-stage audit shape and is never
// mistaken for an admission. `outcome` is "ok" for the removal line and "CLEANUP_FAILED" for the
// second line written when the unlink then failed.
export interface TempSweepAuditEntry {
  readonly tool: "temp-sweep";
  readonly outcome: "ok" | "CLEANUP_FAILED";
  readonly path: string;
  readonly bytes: number;
}

export interface TempSweepOptions {
  // Current time in milliseconds since the epoch, as Date.now() returns it.
  readonly now: number;
  // Minimum age (now minus mtime) of a file to remove. Production passes ORPHAN_TEMP_MIN_AGE_MS.
  readonly minAgeMs: number;
  // Only files owned by this uid are removed. The caller supplies process.getuid().
  readonly ownerUid: number;
  // Appends one audit line. A throw keeps the file and counts it as skipped.
  readonly audit: (entry: TempSweepAuditEntry) => void;
  // Directory entries to examine before the walk stops with `truncated`. Default 500 000.
  readonly maxEntries?: number;
  // Wall budget in milliseconds. Default 15 000. The walk stops with `truncated` when it is spent.
  readonly deadlineMs?: number;
  // Overrides /proc/self/fd, as in atomic-write.ts.
  readonly procFdDir?: string;
}

export interface TempSweepRemoved {
  readonly path: string;
  readonly bytes: number;
}

// skipped: roots that could not be bound or pinned, subdirectories not entered (a symlink, another
// device, a failed open or check), and candidates kept because the audit callback threw.
// failed: unlinks that failed, directories that could not be read or a candidate that could not be
// examined, and a failed audit of the CLEANUP_FAILED line. Each failing step counts once.
// unfinishedRoots: the roots given to the call whose walk was cut off by a budget, in order, followed by every root not
// reached. Empty when `truncated` is false.
export interface TempSweepResult {
  readonly removed: readonly TempSweepRemoved[];
  readonly skipped: number;
  readonly failed: number;
  readonly truncated: boolean;
  readonly unfinishedRoots: readonly string[];
}

interface SweepState {
  readonly options: TempSweepOptions;
  readonly procFdDir: string;
  readonly maxEntries: number;
  readonly deadlineMs: number;
  readonly startedAt: number;
  readonly removed: TempSweepRemoved[];
  skipped: number;
  failed: number;
  truncated: boolean;
  entries: number;
}

// Sweeps every root. A root that does not bind is counted and skipped; it never aborts the sweep.
export function sweepOrphanTempFiles(roots: readonly string[], options: TempSweepOptions): TempSweepResult {
  const state: SweepState = {
    options,
    procFdDir: options.procFdDir ?? PROC_FD_DIR,
    maxEntries: options.maxEntries ?? DEFAULT_SWEEP_MAX_ENTRIES,
    deadlineMs: options.deadlineMs ?? DEFAULT_SWEEP_DEADLINE_MS,
    startedAt: performance.now(),
    removed: [],
    skipped: 0,
    failed: 0,
    truncated: false,
    entries: 0,
  };
  const unfinishedRoots: string[] = [];
  for (const root of roots) {
    if (sweepTruncated(state)) {
      unfinishedRoots.push(root);
      continue;
    }
    sweepRoot(root, state);
    if (sweepTruncated(state)) {
      unfinishedRoots.push(root);
    }
  }
  return {
    removed: state.removed,
    skipped: state.skipped,
    failed: state.failed,
    truncated: state.truncated,
    unfinishedRoots,
  };
}

// A function call, not a property read, so the compiler does not keep the narrowing from the check before sweepRoot ran.
function sweepTruncated(state: SweepState): boolean {
  return state.truncated;
}

function sweepRoot(root: string, state: SweepState): void {
  let realPath: string;
  let dev: number;
  let ino: number;
  try {
    const pinned = bindRoot(root);
    realPath = pinned.realPath;
    dev = pinned.dev;
    ino = pinned.ino;
  } catch {
    state.skipped += 1;
    return;
  }
  let fd: number;
  try {
    fd = pinDirectory(realPath, state.procFdDir);
  } catch {
    state.skipped += 1;
    return;
  }
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== dev || opened.ino !== ino) {
      state.skipped += 1;
      return;
    }
    walk(fd, realPath, dev, state);
  } catch {
    state.failed += 1;
  } finally {
    closeSync(fd);
  }
}

// Visits one directory held open as fd, whose real path is dirPath.
function walk(fd: number, dirPath: string, rootDev: number, state: SweepState): void {
  const viaDir = join(state.procFdDir, String(fd));
  let dir: Dir;
  try {
    dir = opendirSync(viaDir, { bufferSize: DIR_READ_BATCH });
  } catch {
    state.failed += 1;
    return;
  }
  try {
    // Both budgets are checked between reads, so a directory with millions of entries is never
    // loaded whole and the walk stops soon after a budget is spent.
    while (!state.truncated) {
      if (performance.now() - state.startedAt >= state.deadlineMs) {
        state.truncated = true;
        return;
      }
      let entry: Dirent | null;
      try {
        entry = dir.readSync();
      } catch {
        state.failed += 1;
        return;
      }
      if (entry === null) {
        return;
      }
      state.entries += 1;
      if (state.entries > state.maxEntries) {
        state.truncated = true;
        return;
      }
      if (entry.isDirectory()) {
        enterDirectory(viaDir, dirPath, entry.name, rootDev, state);
      } else if (entry.isFile() && TEMP_NAME_PATTERN.test(entry.name)) {
        considerFile(viaDir, dirPath, entry.name, state);
      }
    }
  } finally {
    dir.closeSync();
  }
}

// Opens the child with O_NOFOLLOW|O_DIRECTORY through the parent descriptor. A symlink fails the
// open and is never entered. The child must be on the root's device and must be the directory the
// kernel names childPath.
function enterDirectory(viaDir: string, dirPath: string, name: string, rootDev: number, state: SweepState): void {
  const childPath = join(dirPath, name);
  let fd: number;
  try {
    fd = openSync(
      join(viaDir, name),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    );
  } catch {
    state.skipped += 1;
    return;
  }
  try {
    let enter = false;
    try {
      assertDirectoryPinned(fd, childPath, state.procFdDir);
      enter = fstatSync(fd).dev === rootDev;
    } catch {
      enter = false;
    }
    if (!enter) {
      state.skipped += 1;
      return;
    }
    walk(fd, childPath, rootDev, state);
  } finally {
    closeSync(fd);
  }
}

function considerFile(viaDir: string, dirPath: string, name: string, state: SweepState): void {
  const { options } = state;
  const via = join(viaDir, name);
  let stats: Stats;
  try {
    stats = lstatSync(via);
  } catch {
    state.failed += 1;
    return;
  }
  if (!stats.isFile() || stats.uid !== options.ownerUid || options.now - stats.mtimeMs < options.minAgeMs) {
    return;
  }
  const path = join(dirPath, name);
  try {
    options.audit({ tool: "temp-sweep", outcome: "ok", path, bytes: stats.size });
  } catch {
    state.skipped += 1;
    return;
  }
  try {
    unlinkSync(via);
  } catch {
    state.failed += 1;
    try {
      options.audit({ tool: "temp-sweep", outcome: "CLEANUP_FAILED", path, bytes: stats.size });
    } catch {
      state.failed += 1;
    }
    return;
  }
  state.removed.push({ path, bytes: stats.size });
}
