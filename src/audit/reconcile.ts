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
// This module reads no process state: the audit directory comes from the caller.

import { Buffer } from "node:buffer";
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { splitAuditLines } from "./anchor.js";
import { appendAudit, type ExecSummary } from "./log.js";

// A log has no rotation, so one file is read whole. A file over this size is skipped and counted as failed.
export const RECONCILE_MAX_FILE_BYTES = 256 * 1024 * 1024;

// Same rule as SAFE_SESSION_ID in src/audit/log.ts, which is not exported; this module takes the file stem
// as the session id, so the stem must pass it.
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const JSONL_SUFFIX = ".jsonl";

export interface ReconcileOptions {
  // The size above which a log is skipped. Defaults to RECONCILE_MAX_FILE_BYTES.
  readonly maxFileBytes?: number;
}

export interface ReconcileResult {
  // Log files that were read and counted.
  readonly files: number;
  // Reconciliation lines appended across all files.
  readonly appended: number;
  // Refused entries (a symlinked directory or file, a non-regular file, an unsafe name), files over the size
  // cap, files that could not be read, and files whose append failed.
  readonly failed: number;
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

// Reads one log whole, bounded by maxBytes, through a descriptor so the size check and the read see the same
// file. Returns undefined when the file is over the bound.
function readBounded(file: string, maxBytes: number): Uint8Array | undefined {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error("audit log is not a regular file");
    }
    if (stat.size > maxBytes) {
      return undefined;
    }
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function surplusByKey(content: Uint8Array): Map<string, Pending> {
  const counts = new Map<string, Pending>();
  for (const raw of splitAuditLines(content)) {
    const parsed = parseLine(raw);
    if (parsed === undefined) {
      continue;
    }
    const { phase, pending } = parsed;
    const isAdmission = phase === "admission";
    if (!isAdmission && phase !== "result" && phase !== "reconciliation") {
      continue;
    }
    const key = pairingKey(pending);
    const slot = counts.get(key) ?? pending;
    counts.set(key, slot);
    if (isAdmission) {
      slot.admissions += 1;
    } else {
      slot.closings += 1;
    }
  }
  return counts;
}

// Appends one reconciliation line per surplus admission of one log. `onAppended` is called after each line, so
// the caller's count is right even when a later append throws and stops this file.
function reconcileFile(stateDir: string, sessionId: string, content: Uint8Array, onAppended: () => void): void {
  for (const slot of surplusByKey(content).values()) {
    for (let missing = slot.admissions - slot.closings; missing > 0; missing -= 1) {
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
}

// Reconciles every `<stateDir>/audit/*.jsonl`. A missing audit directory is zero work. A failure on one file
// is counted in `failed` and does not stop the others.
export function reconcileAuditLogs(stateDir: string, options: ReconcileOptions = {}): ReconcileResult {
  const maxBytes = options.maxFileBytes ?? RECONCILE_MAX_FILE_BYTES;
  const dir = join(stateDir, "audit");
  let names: string[];
  try {
    const dirStat = lstatSync(dir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
      return { files: 0, appended: 0, failed: 1 };
    }
    names = readdirSync(dir).filter((name) => name.endsWith(JSONL_SUFFIX)).sort();
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return { files: 0, appended: 0, failed: 0 };
    }
    return { files: 0, appended: 0, failed: 1 };
  }

  let files = 0;
  let appended = 0;
  let failed = 0;
  for (const name of names) {
    const sessionId = name.slice(0, -JSONL_SUFFIX.length);
    const file = join(dir, name);
    try {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !SAFE_SESSION_ID.test(sessionId)) {
        failed += 1;
        continue;
      }
      const content = readBounded(file, maxBytes);
      if (content === undefined) {
        failed += 1;
        continue;
      }
      files += 1;
      reconcileFile(stateDir, sessionId, content, () => {
        appended += 1;
      });
    } catch {
      // A per-file failure (unreadable file, refused path, failed append) is counted, not fatal: the other
      // logs are still reconciled and the caller reports the count.
      failed += 1;
    }
  }
  return { files, appended, failed };
}
