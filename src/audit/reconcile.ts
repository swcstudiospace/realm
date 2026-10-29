// Audit reconciliation (CRASH-02, D-1403). A call appends an admission line before it runs and a result
// line after it. A process that ends between the two leaves an admission with no result, and the log then
// says nothing about whether the call took effect. At the next daemon start this module appends one
// reconciliation line, with outcome AUDIT_OUTCOME_UNKNOWN, for each admission that has no closing line.
//
// Pairing counts, per key, the admission lines against the result and reconciliation lines. Order is not
// used: calls may overlap, so lines of two calls can interleave. The key is built by `pairingKey` alone, so
// the phase that adds a correlation id changes one function. Lines are appended only through `appendAudit`,
// which stays the single writer of the file. After an append the counts are equal, so a second run appends
// nothing.
//
// Single-owner precondition: run this before any dispatcher exists in the process, as the startup reaper
// does, because a call that is still running would otherwise be labelled unknown.
//
// Work bound: an optional absolute deadline (on an injectable clock) is checked between files, before every 1 MiB read and
// every 5000 lines of a scan, and before each append. A log whose scan is cut off gets no line (a partial count could label a
// call unknown that has its result line further on); it, and every log not reached, is reported as unfinished, and a later
// run finishes it. After a complete run the counts are equal, so a further run appends nothing.
//
// Progress: logs are taken newest modified first, and a small cache record (RECONCILE_PROGRESS_FILE) remembers the size and
// mtime of each log after it was completely checked, so a start with a small budget makes progress instead of re-reading the
// same old logs from byte zero every time. The record is a cache: deleting or corrupting it only costs one rescan.
//
// This module reads no process state: the audit directory comes from the caller.

import { Buffer } from "node:buffer";
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { atomicWriteFile, observeSha256 } from "../fs/atomic-write.js";
import { appendAudit, type ExecSummary } from "./log.js";

// A log has no rotation, so one file can be large. A file over this size is skipped and counted as failed.
export const RECONCILE_MAX_FILE_BYTES = 256 * 1024 * 1024;

// Same rule as SAFE_SESSION_ID in src/audit/log.ts, which is not exported; this module takes the file stem
// as the session id, so the stem must pass it.
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const JSONL_SUFFIX = ".jsonl";

export interface ReconcileOptions {
  // The size above which a log is skipped. Defaults to RECONCILE_MAX_FILE_BYTES.
  readonly maxFileBytes?: number;
  // The clock the deadline is read from, in milliseconds. Defaults to performance.now().
  readonly now?: () => number;
  // An absolute time on the `now` clock after which no further file or line of work starts. Absent: no limit.
  readonly deadline?: number;
  // Limits, each defaulting to its exported constant. A test passes small ones.
  readonly maxFiles?: number;
  readonly maxListedEntries?: number;
  readonly maxProgressBytes?: number;
  readonly maxProgressEntries?: number;
  readonly maxLineBytes?: number;
  // Writes the progress record: `content` to `target`, replacing it atomically. Defaults to the atomic writer. A test counts
  // calls through it.
  readonly writeRecord?: (target: string, content: string) => void;
}

export interface ReconcileResult {
  // Log files that were checked completely: scanned in this run, or skipped because the progress record says they are
  // unchanged since they were last checked completely.
  readonly files: number;
  // Reconciliation lines appended across all files.
  readonly appended: number;
  // Refused entries (a symlinked directory or file, a non-regular file, an unsafe name), files over the size
  // cap, files that could not be read, files whose append failed, and a failed write of the progress record.
  readonly failed: number;
  // Base names (no directory) of the logs the deadline left unfinished, including every log not reached. A later run
  // without the deadline finishes them.
  readonly unfinished: readonly string[];
  // True when no log is unfinished and the listing was complete.
  readonly complete: boolean;
  // How many of `files` were skipped without being read because the progress record matched their size and mtime.
  readonly skippedUnchanged: number;
  // True when the listing stopped at its entry bound (RECONCILE_MAX_LISTED_ENTRIES) or at the deadline, so logs may exist that
  // were not listed. They cannot be named, so they are not in `unfinished`. A start that hit RECONCILE_MAX_FILES is not this:
  // the logs it did not reach are listed in `unfinished`.
  readonly listingTruncated: boolean;
}

export interface PairingEntry {
  readonly tool: string;
  readonly path?: string | undefined;
  readonly execSummary?: unknown;
}

// The one place that decides which lines belong together. Admission, result and reconciliation lines of one
// call share it: `tool`, `path` for file tools, and `execSummary` for exec (present on both lines of a call).
export function pairingKey(entry: PairingEntry): string {
  return `${entry.tool}\0${entry.path ?? ""}\0${JSON.stringify(entry.execSummary ?? null)}`;
}

interface Pending {
  readonly tool: string;
  readonly path: string | undefined;
  readonly execSummary: ExecSummary | undefined;
  admissions: number;
  closings: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExecSummary(value: unknown): value is ExecSummary {
  if (!isRecord(value)) {
    return false;
  }
  const argv = value["argv"];
  if (argv !== undefined) {
    return Array.isArray(argv) && argv.every((arg: unknown) => typeof arg === "string");
  }
  return value["shell"] === true && typeof value["scriptBytes"] === "number" && typeof value["sha256"] === "string";
}

// One parsed line, or undefined when the line is ignorable: not JSON, not an object, no phase, or a field of
// the wrong type. A torn admission means nothing ran, because the admission is appended before execution.
function parseLine(bytes: Uint8Array): { readonly phase: string; readonly pending: Pending } | undefined {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const phase = value["phase"];
  const tool = value["tool"];
  const rawPath = value["path"];
  const rawExec = value["execSummary"];
  if (typeof phase !== "string" || typeof tool !== "string") {
    return undefined;
  }
  let path: string | undefined;
  if (typeof rawPath === "string") {
    path = rawPath;
  } else if (rawPath !== undefined) {
    return undefined;
  }
  let execSummary: ExecSummary | undefined;
  if (isExecSummary(rawExec)) {
    execSummary = rawExec;
  } else if (rawExec !== undefined) {
    return undefined;
  }
  return { phase, pending: { tool, path, execSummary, admissions: 0, closings: 0 } };
}

// Bytes read per step of a scan, and lines parsed between two deadline checks. The deadline is checked before every read and
// after every SCAN_CHECK_LINES lines, so the work between two checks is bounded by 1 MiB of reading and 5000 line parses.
export const SCAN_CHUNK_BYTES = 1024 * 1024;
export const SCAN_CHECK_LINES = 5000;

// A line longer than this is not held in memory: it is skipped, and the lines after it are still counted. No audit line is
// near this size (an exec argv is bounded by the OS argument limit), so a longer one is not a line the realm wrote.
export const RECONCILE_MAX_LINE_BYTES = 16 * 1024 * 1024;

// A log with more distinct (tool, path, exec) keys than this is refused like an over-sized one: the counts are held in memory.
export const RECONCILE_MAX_KEYS = 200_000;

type ScanOutcome =
  | { readonly kind: "over-cap" }
  | { readonly kind: "expired" }
  | {
      readonly kind: "done";
      readonly counts: Map<string, Pending>;
      // The size and mtime of the log read from the same descriptor after the last byte was read.
      readonly end: { readonly size: number; readonly mtimeMs: number };
    };

// Scans one log incrementally through a descriptor, so the size check and the reads see the same file. The file is read in
// SCAN_CHUNK_BYTES steps and never held whole (a line split across two steps is joined, up to maxLineBytes). A file over
// maxBytes, or with more than RECONCILE_MAX_KEYS keys, is "over-cap". When `expired()` turns true the scan stops with
// "expired" and returns no counts: a partial scan never yields a count.
function scanFile(file: string, maxBytes: number, maxLineBytes: number, expired: () => boolean): ScanOutcome {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error("audit log is not a regular file");
    }
    if (stat.size > maxBytes) {
      return { kind: "over-cap" };
    }
    const counts = new Map<string, Pending>();
    let tooManyKeys = false;
    // Read through a function: `tally` assigns the flag in a closure, which the compiler's flow analysis does not see.
    const keysExceeded = (): boolean => tooManyKeys;
    const tally = (raw: Uint8Array): void => {
      const parsed = parseLine(raw);
      if (parsed === undefined) {
        return;
      }
      const { phase, pending } = parsed;
      const isAdmission = phase === "admission";
      if (!isAdmission && phase !== "result" && phase !== "reconciliation") {
        return;
      }
      const key = pairingKey(pending);
      let slot = counts.get(key);
      if (slot === undefined) {
        if (counts.size >= RECONCILE_MAX_KEYS) {
          tooManyKeys = true;
          return;
        }
        slot = pending;
        counts.set(key, slot);
      }
      if (isAdmission) {
        slot.admissions += 1;
      } else {
        slot.closings += 1;
      }
    };
    const chunk = Buffer.allocUnsafe(SCAN_CHUNK_BYTES);
    // The start of a line that began in an earlier step, held until its newline arrives, and its length so far.
    let carry: Buffer[] = [];
    let carryBytes = 0;
    // True while the rest of an over-long line is being skipped.
    let skipping = false;
    let total = 0;
    let lines = 0;
    for (;;) {
      if (expired()) {
        return { kind: "expired" };
      }
      const read = readSync(fd, chunk, 0, SCAN_CHUNK_BYTES, null);
      if (read === 0) {
        break;
      }
      total += read;
      if (total > maxBytes) {
        return { kind: "over-cap" };
      }
      let start = 0;
      for (let i = 0; i < read; i += 1) {
        if (chunk[i] !== 0x0a) {
          continue;
        }
        const head = chunk.subarray(start, i);
        if (!skipping && carryBytes + head.length <= maxLineBytes) {
          tally(carry.length === 0 ? head : Buffer.concat([...carry, head]));
        }
        carry = [];
        carryBytes = 0;
        skipping = false;
        start = i + 1;
        lines += 1;
        if (keysExceeded()) {
          return { kind: "over-cap" };
        }
        if (lines % SCAN_CHECK_LINES === 0 && expired()) {
          return { kind: "expired" };
        }
      }
      if (start < read && !skipping) {
        carryBytes += read - start;
        if (carryBytes > maxLineBytes) {
          // Over-long: drop what is held and skip to the next newline.
          carry = [];
          carryBytes = 0;
          skipping = true;
        } else {
          // The step buffer is reused, so the unfinished line is copied out.
          carry.push(Buffer.from(chunk.subarray(start, read)));
        }
      }
    }
    if (carry.length > 0 && !skipping) {
      tally(Buffer.concat(carry));
    }
    if (keysExceeded()) {
      return { kind: "over-cap" };
    }
    const end = fstatSync(fd);
    return { kind: "done", counts, end: { size: end.size, mtimeMs: end.mtimeMs } };
  } finally {
    closeSync(fd);
  }
}

// Appends one reconciliation line per surplus admission of one completely scanned log. `onAppended` is called after each
// line, so the caller's count is right even when a later append throws and stops this file. The deadline is checked before
// each append: when it has expired the file is unfinished, and the next start appends the rest (its scan sees the lines
// written here as closings, so the lines of both starts together are the lines one complete run would have appended).
// Returns true when every surplus admission got its line.
function reconcileFile(
  stateDir: string,
  sessionId: string,
  counts: Map<string, Pending>,
  expired: () => boolean,
  onAppended: () => void,
): boolean {
  for (const slot of counts.values()) {
    for (let missing = slot.admissions - slot.closings; missing > 0; missing -= 1) {
      if (expired()) {
        return false;
      }
      appendAudit(stateDir, {
        sessionId,
        tool: slot.tool,
        outcome: "AUDIT_OUTCOME_UNKNOWN",
        phase: "reconciliation",
        ...(slot.path === undefined ? {} : { path: slot.path }),
        ...(slot.execSummary === undefined ? {} : { execSummary: slot.execSummary }),
      });
      onAppended();
    }
  }
  return true;
}

// The progress record: which logs were completely checked, and how they looked when they were. It is a cache. A log whose
// size and mtime equal its record was fully checked after its last change, so it is skipped without being read. Deleting
// the record, or a corrupt one, only costs one rescan. It is a dot file next to the logs and never ends in .jsonl, so it
// is not mistaken for a log, and its name is not a temp name, so the orphan sweep never touches it.
//
// The map lives in memory for the run and is written ONCE, when the run ends (complete, out of time, or after an error),
// and only if it changed. A kill in the middle of a run loses only that run's progress. The writer and the reader share one
// set of limits (MAX_PROGRESS_BYTES, MAX_PROGRESS_ENTRIES), so a record the writer produced is always one the reader accepts.
// The entry limit equals the listing bound (RECONCILE_MAX_LISTED_ENTRIES), so the record can hold every log one start can
// list. That matters for progress: when the record is smaller than the logs, the oldest scanned logs fall out of it and are
// scanned again (after every newer log) while logs older still might never be reached. 16 MiB holds 100 000 entries of
// ordinary session-id names (about 85 bytes each); names near the 134-character maximum would be cut to the newest.
export const RECONCILE_PROGRESS_FILE = ".reconciled.json";
export const MAX_PROGRESS_BYTES = 16 * 1024 * 1024;
export const MAX_PROGRESS_ENTRIES = 100_000;

// The directory is read entry by entry and every `*.jsonl` name is kept, up to RECONCILE_MAX_LISTED_ENTRIES entries (names and
// other entries alike, so a directory of junk cannot make the listing unbounded). A further entry makes the listing
// "truncated" and the result incomplete. RECONCILE_MAX_FILES is not a listing cap: it is the most logs one start SCANS (reads
// the content of), counted in newest-first order; the rest that need a scan are reported unfinished. Skipping a recorded log
// after its stat does not count.
export const RECONCILE_MAX_FILES = 10_000;
export const RECONCILE_MAX_LISTED_ENTRIES = 100_000;
const LIST_CHECK_EVERY = 256;

// A log file name, the shape of a record key. The stem is a safe session id.
const LOG_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.jsonl$/;

interface Checked {
  readonly size: number;
  readonly mtimeMs: number;
}

interface Progress {
  readonly checked: Map<string, Checked>;
  // False when the record exists but could not be used whole (unreadable, corrupt, wrong shape, over a limit, not a regular
  // file): the run then rewrites it, which heals it.
  readonly clean: boolean;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

// Reads up to `limit` bytes from the start of a descriptor. Returns undefined when the file is longer than the limit.
function readUpTo(fd: number, limit: number): Buffer | undefined {
  const buffer = Buffer.allocUnsafe(limit + 1);
  let total = 0;
  while (total <= limit) {
    const read = readSync(fd, buffer, total, limit + 1 - total, null);
    if (read === 0) {
      break;
    }
    total += read;
  }
  return total > limit ? undefined : buffer.subarray(0, total);
}

// The record, or an empty map when it is absent, unreadable, corrupt, over a limit or of the wrong shape: it is never an
// error, because the cost of an empty record is one rescan. The file is opened without following a link and read through the
// descriptor, at most maxBytes, so a symlink, a device, a huge file or a file that grows while it is read cannot hurt.
function readProgress(dir: string, maxBytes: number, maxEntries: number): Progress {
  const empty = (clean: boolean): Progress => ({ checked: new Map<string, Checked>(), clean });
  let text: string;
  try {
    const fd = openSync(join(dir, RECONCILE_PROGRESS_FILE), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.size > maxBytes) {
        return empty(false);
      }
      // At most the size the descriptor reported: a record that grew since is longer than that and is refused, so the buffer
      // is as large as the record, never as large as the limit.
      const bytes = readUpTo(fd, opened.size);
      if (bytes === undefined) {
        return empty(false);
      }
      text = bytes.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch (error: unknown) {
    // An absent record is a clean empty one. Any other failure to read it (a link, no permission) is an empty one that the
    // run rewrites: the logs are rescanned and the record is replaced.
    return empty(isMissing(error));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Corrupt content is an empty record, by design.
    return empty(false);
  }
  if (!isRecord(parsed)) {
    return empty(false);
  }
  const entries = Object.entries(parsed);
  if (entries.length > maxEntries) {
    return empty(false);
  }
  const checked = new Map<string, Checked>();
  let clean = true;
  for (const [name, value] of entries) {
    if (
      LOG_NAME.test(name) &&
      isRecord(value) &&
      typeof value["size"] === "number" &&
      Number.isFinite(value["size"]) &&
      typeof value["mtimeMs"] === "number" &&
      Number.isFinite(value["mtimeMs"])
    ) {
      checked.set(name, { size: value["size"], mtimeMs: value["mtimeMs"] });
    } else {
      clean = false;
    }
  }
  return { checked, clean };
}

// The text of the record: the entries for logs that still exist (when the listing was complete; `present` is undefined
// otherwise), newest modified first, cut to at most maxEntries entries and maxBytes bytes. The oldest are dropped first.
// `count` is the number of entries written.
function recordBody(
  checked: ReadonlyMap<string, Checked>,
  present: ReadonlySet<string> | undefined,
  maxEntries: number,
  maxBytes: number,
): { readonly text: string; readonly count: number } {
  const kept = [...checked].filter(([name]) => present === undefined || present.has(name));
  kept.sort((a, b) => {
    const byTime = b[1].mtimeMs - a[1].mtimeMs;
    if (byTime !== 0) {
      return byTime;
    }
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  const parts: string[] = [];
  let bytes = 2;
  for (const [name, entry] of kept) {
    if (parts.length >= maxEntries) {
      break;
    }
    const part = `${JSON.stringify(name)}:${JSON.stringify({ size: entry.size, mtimeMs: entry.mtimeMs })}`;
    const added = Buffer.byteLength(part, "utf8") + (parts.length > 0 ? 1 : 0);
    if (bytes + added > maxBytes) {
      break;
    }
    parts.push(part);
    bytes += added;
  }
  return { text: `{${parts.join(",")}}`, count: parts.length };
}

// The default writer of the record. A record that is not a regular file, or is larger than the limit, is removed first (a
// link is removed, never followed), so the atomic writer never has to hash an oversized or foreign file whole. A directory
// cannot be removed this way and makes the write fail, which the caller counts.
function writeRecordAtomically(maxBytes: number): (target: string, content: string) => void {
  return (target, content) => {
    let prior: string | null = null;
    try {
      const existing = lstatSync(target);
      if (existing.isFile() && existing.size <= maxBytes) {
        prior = observeSha256(target);
      } else {
        rmSync(target);
      }
    } catch (error: unknown) {
      if (!isMissing(error)) {
        throw error;
      }
    }
    atomicWriteFile(target, content, { expectedPriorSha256: prior });
  };
}

// Writes the record. Returns false when the write failed: a lost record is one rescan, so the caller counts it and goes on.
function persistProgress(dir: string, content: string, write: (target: string, content: string) => void): boolean {
  try {
    write(join(realpathSync(dir), RECONCILE_PROGRESS_FILE), content);
    return true;
  } catch {
    return false;
  }
}

interface Listing {
  readonly names: readonly string[];
  // True when the listing stopped at a limit or at the deadline, so logs may exist that were not listed.
  readonly truncated: boolean;
}

// The names of the logs (`*.jsonl`) of a directory, read entry by entry. Everything else in the directory (the record, its
// temp files, other files) is ignored here. The deadline is checked every LIST_CHECK_EVERY entries.
function listLogs(dir: string, maxEntries: number, expired: () => boolean): Listing {
  const names: string[] = [];
  const handle = opendirSync(dir);
  try {
    let entries = 0;
    for (;;) {
      if (entries > 0 && entries % LIST_CHECK_EVERY === 0 && expired()) {
        return { names, truncated: true };
      }
      const entry = handle.readSync();
      if (entry === null) {
        return { names, truncated: false };
      }
      entries += 1;
      if (entries > maxEntries) {
        return { names, truncated: true };
      }
      if (entry.name.endsWith(JSONL_SUFFIX)) {
        names.push(entry.name);
      }
    }
  } finally {
    handle.closeSync();
  }
}

// Orders ALL listed logs newest modified first, ties by name: a crash leaves unmatched admissions in the logs written last, so
// the logs that matter are reached first, changed or not, recorded or not. There is one ordering and no grouping by the
// progress record. The deadline is checked before each stat: logs not stat'ed before it expired are returned in `unreached`,
// in listing order. A log that cannot be examined sorts last and is counted when its turn comes.
function newestFirst(
  dir: string,
  names: readonly string[],
  expired: () => boolean,
): { readonly ordered: string[]; readonly unreached: string[] } {
  const stated: { readonly name: string; readonly mtimeMs: number }[] = [];
  const unreached: string[] = [];
  for (const [index, name] of names.entries()) {
    if (expired()) {
      unreached.push(...names.slice(index));
      break;
    }
    let mtimeMs = Number.NEGATIVE_INFINITY;
    try {
      mtimeMs = lstatSync(join(dir, name)).mtimeMs;
    } catch {
      // Counted when the loop reaches this log and its own lstat fails again.
    }
    stated.push({ name, mtimeMs });
  }
  stated.sort((a, b) => {
    const byTime = b.mtimeMs - a.mtimeMs;
    if (byTime !== 0 && !Number.isNaN(byTime)) {
      return byTime;
    }
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return { ordered: stated.map((entry) => entry.name), unreached };
}

function emptyResult(failed: number): ReconcileResult {
  return { files: 0, appended: 0, failed, unfinished: [], complete: true, skippedUnchanged: 0, listingTruncated: false };
}

// Reconciles every `<stateDir>/audit/*.jsonl`, newest modified first. A missing audit directory is zero work. A failure on one
// file is counted in `failed` and does not stop the others. With a deadline, a file whose scan or appends do not finish in time
// is listed in `unfinished` together with every file not reached, and `complete` is false. A log that was completely checked
// in an earlier run and has not changed since (same size and mtime, per the progress record) is not read again.
//
// Single-owner guarantee (why no append can race with the scan): the daemon runs this inside runStartupMaintenance, before
// its gate opens. Its control socket is bound first, so a second daemon on the same state directory fails with LOCK_CONFLICT
// before it reaches its own maintenance, and every connection waits on the gate, so no tool call reaches the dispatcher and no
// audit line is appended by this process while the scan runs.
export function reconcileAuditLogs(stateDir: string, options: ReconcileOptions = {}): ReconcileResult {
  const maxBytes = options.maxFileBytes ?? RECONCILE_MAX_FILE_BYTES;
  const maxFiles = options.maxFiles ?? RECONCILE_MAX_FILES;
  const maxListed = options.maxListedEntries ?? RECONCILE_MAX_LISTED_ENTRIES;
  const maxProgressBytes = options.maxProgressBytes ?? MAX_PROGRESS_BYTES;
  const maxProgressEntries = options.maxProgressEntries ?? MAX_PROGRESS_ENTRIES;
  const maxLineBytes = options.maxLineBytes ?? RECONCILE_MAX_LINE_BYTES;
  const writeRecord = options.writeRecord ?? writeRecordAtomically(maxProgressBytes);
  const now = options.now ?? (() => performance.now());
  const { deadline } = options;
  const expired = (): boolean => deadline !== undefined && now() >= deadline;
  const dir = join(stateDir, "audit");
  let listing: Listing;
  try {
    const dirStat = lstatSync(dir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
      return emptyResult(1);
    }
    listing = listLogs(dir, maxListed, expired);
  } catch (error: unknown) {
    return emptyResult(isMissing(error) ? 0 : 1);
  }
  const progress = readProgress(dir, maxProgressBytes, maxProgressEntries);
  const checked = progress.checked;
  const { ordered, unreached } = newestFirst(dir, listing.names, expired);
  // Entries of logs that are gone are dropped from the record, which needs a complete listing to know.
  const present = listing.truncated ? undefined : new Set(listing.names);
  let dirty = !progress.clean;

  let files = 0;
  let appended = 0;
  let failed = 0;
  let skippedUnchanged = 0;
  const unfinished: string[] = [];
  // Logs whose content was scanned so far, against maxFiles. A refused log (not a regular file, an unsafe name, over a limit)
  // is not counted: it is never recorded, so counting it would let a crowd of refused logs use the cap every start.
  let considered = 0;
  // Index of the log being handled, so an error that escapes the per-log guard still reports the rest as unfinished.
  let reached = 0;
  try {
    for (const [index, name] of ordered.entries()) {
      reached = index;
      if (expired()) {
        unfinished.push(...ordered.slice(index));
        break;
      }
      const sessionId = name.slice(0, -JSONL_SUFFIX.length);
      const file = join(dir, name);
      try {
        const stat = lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || !SAFE_SESSION_ID.test(sessionId)) {
          failed += 1;
          continue;
        }
        const prior = checked.get(name);
        if (prior !== undefined && prior.size === stat.size && prior.mtimeMs === stat.mtimeMs) {
          // A stat is cheap and bounded by the deadline and the listing bound, so a skip does not count against the cap.
          files += 1;
          skippedUnchanged += 1;
          continue;
        }
        if (considered >= maxFiles) {
          // The per-start cap on logs whose content is scanned is spent. This log is unfinished; the logs after it are still
          // stat'ed, so an unchanged recorded one is skipped and a changed one is unfinished too. Newest first means the
          // logs a crash touched last are the ones scanned, and the oldest unrecorded history is what waits.
          unfinished.push(name);
          continue;
        }
        const scanned = scanFile(file, maxBytes, maxLineBytes, expired);
        if (scanned.kind === "over-cap") {
          failed += 1;
          continue;
        }
        if (scanned.kind === "expired") {
          // Nothing is appended for a file whose scan did not finish: a partial count could label a call unknown that has
          // its result line further on. Nothing is recorded for it either.
          unfinished.push(...ordered.slice(index));
          break;
        }
        files += 1;
        considered += 1;
        const before = appended;
        const finished = reconcileFile(stateDir, sessionId, scanned.counts, expired, () => {
          appended += 1;
        });
        if (!finished) {
          unfinished.push(...ordered.slice(index));
          break;
        }
        // The log is recorded only when what was scanned is what the stat described (it did not change during the scan) and
        // nothing but this run's own appends changed it since. Measured after the appends, so the next run sees it unchanged.
        const after = lstatSync(file);
        const scannedWhatWasStatted = scanned.end.size === stat.size && scanned.end.mtimeMs === stat.mtimeMs;
        const changedOnlyByUs = appended > before || (after.size === stat.size && after.mtimeMs === stat.mtimeMs);
        if (scannedWhatWasStatted && changedOnlyByUs) {
          checked.set(name, { size: after.size, mtimeMs: after.mtimeMs });
          dirty = true;
        }
      } catch {
        // A per-file failure (unreadable file, refused path, failed append) is counted, not fatal: the other
        // logs are still reconciled and the caller reports the count.
        failed += 1;
      }
    }
  } catch {
    // An error outside the per-log guard (a throwing clock, say) ends the loop. It is counted, the logs from the current one
    // on are reported unfinished, and the counts so far and the record are kept.
    failed += 1;
    unfinished.push(...ordered.slice(reached));
  } finally {
    // One write of the record per run, whatever ended the run, and only when it changed, needs healing, or holds entries of
    // logs that are gone. A record that was read is within the limits, so an unchanged one needs no size check, and the body
    // (a sort and a serialization of every entry) is not built for it.
    const stale = present !== undefined && [...checked.keys()].some((name) => !present.has(name));
    if (dirty || stale) {
      const body = recordBody(checked, present, maxProgressEntries, maxProgressBytes);
      if (!persistProgress(dir, body.text, writeRecord)) {
        failed += 1;
      }
    }
  }
  unfinished.push(...unreached);
  const complete = unfinished.length === 0 && !listing.truncated;
  return { files, appended, failed, unfinished, complete, skippedUnchanged, listingTruncated: listing.truncated };
}
