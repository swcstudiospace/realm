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
// This module reads no process state: the audit directory comes from the caller.

import { Buffer } from "node:buffer";
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
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
}

export interface ReconcileResult {
  // Log files that were read and counted completely.
  readonly files: number;
  // Reconciliation lines appended across all files.
  readonly appended: number;
  // Refused entries (a symlinked directory or file, a non-regular file, an unsafe name), files over the size
  // cap, files that could not be read, and files whose append failed.
  readonly failed: number;
  // Base names (no directory) of the logs the deadline left unfinished, including every log not reached. A later run
  // without the deadline finishes them.
  readonly unfinished: readonly string[];
  // True when no log is unfinished.
  readonly complete: boolean;
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

type ScanOutcome =
  | { readonly kind: "over-cap" }
  | { readonly kind: "expired" }
  | { readonly kind: "done"; readonly counts: Map<string, Pending> };

// Scans one log incrementally through a descriptor, so the size check and the reads see the same file. The file is read in
// SCAN_CHUNK_BYTES steps and never held whole (a line split across two steps is joined). A file over maxBytes is "over-cap".
// When `expired()` turns true the scan stops with "expired" and returns no counts: a partial scan never yields a count.
function scanFile(file: string, maxBytes: number, expired: () => boolean): ScanOutcome {
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
      const slot = counts.get(key) ?? pending;
      counts.set(key, slot);
      if (isAdmission) {
        slot.admissions += 1;
      } else {
        slot.closings += 1;
      }
    };
    const chunk = Buffer.allocUnsafe(SCAN_CHUNK_BYTES);
    // The start of a line that began in an earlier step, held until its newline arrives.
    let carry: Buffer[] = [];
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
        tally(carry.length === 0 ? head : Buffer.concat([...carry, head]));
        carry = [];
        start = i + 1;
        lines += 1;
        if (lines % SCAN_CHECK_LINES === 0 && expired()) {
          return { kind: "expired" };
        }
      }
      if (start < read) {
        // The step buffer is reused, so the unfinished line is copied out.
        carry.push(Buffer.from(chunk.subarray(start, read)));
      }
    }
    if (carry.length > 0) {
      tally(Buffer.concat(carry));
    }
    return { kind: "done", counts };
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

// Reconciles every `<stateDir>/audit/*.jsonl`. A missing audit directory is zero work. A failure on one file
// is counted in `failed` and does not stop the others. With a deadline, a file whose scan or appends do not finish in time
// is listed in `unfinished` together with every file not reached, and `complete` is false.
export function reconcileAuditLogs(stateDir: string, options: ReconcileOptions = {}): ReconcileResult {
  const maxBytes = options.maxFileBytes ?? RECONCILE_MAX_FILE_BYTES;
  const now = options.now ?? (() => performance.now());
  const { deadline } = options;
  const expired = (): boolean => deadline !== undefined && now() >= deadline;
  const dir = join(stateDir, "audit");
  let names: string[];
  try {
    const dirStat = lstatSync(dir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
      return { files: 0, appended: 0, failed: 1, unfinished: [], complete: true };
    }
    names = readdirSync(dir).filter((name) => name.endsWith(JSONL_SUFFIX)).sort();
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return { files: 0, appended: 0, failed: 0, unfinished: [], complete: true };
    }
    return { files: 0, appended: 0, failed: 1, unfinished: [], complete: true };
  }

  let files = 0;
  let appended = 0;
  let failed = 0;
  const unfinished: string[] = [];
  for (const [index, name] of names.entries()) {
    if (expired()) {
      unfinished.push(...names.slice(index));
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
      const scanned = scanFile(file, maxBytes, expired);
      if (scanned.kind === "over-cap") {
        failed += 1;
        continue;
      }
      if (scanned.kind === "expired") {
        // Nothing is appended for a file whose scan did not finish: a partial count could label a call unknown that has
        // its result line further on.
        unfinished.push(...names.slice(index));
        break;
      }
      files += 1;
      const finished = reconcileFile(stateDir, sessionId, scanned.counts, expired, () => {
        appended += 1;
      });
      if (!finished) {
        unfinished.push(...names.slice(index));
        break;
      }
    } catch {
      // A per-file failure (unreadable file, refused path, failed append) is counted, not fatal: the other
      // logs are still reconciled and the caller reports the count.
      failed += 1;
    }
  }
  return { files, appended, failed, unfinished, complete: unfinished.length === 0 };
}
