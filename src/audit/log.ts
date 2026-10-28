// Append-only audit log (D-42, AUD-01). Each tool call appends one JSON object per
// line to <stateDir>/audit/<sessionId>.jsonl. The entry is redacted as a whole before
// serialization, and the append is O_APPEND on the file itself, never a replace.
//
// This module imports core (error codes) only. It does not import the fs write
// composition: an audit line is appended to its own file, not replaced atomically.
//
// Format is one-way (D-42): Phase 7 review consumes these lines. Field names and
// meanings change only by agreement.

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { closeSync, constants, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import { makeRealmError, type ErrorCode } from "../core/errors.js";
import { redactString, redactValue } from "./redact.js";

export type AuditOutcome = "ok" | ErrorCode;

// An exec entry records argv after redaction. The shell form records only the
// script's UTF-8 byte length and its sha256, never the script text (D-42).
export type ExecSummary =
  | { readonly argv: readonly string[] }
  | { readonly shell: true; readonly scriptBytes: number; readonly sha256: string };

// The exec input shape, declared structurally so this module does not import the
// contract layer (D-20).
export type ExecShape =
  | { readonly argv: readonly string[] }
  | { readonly shell: true; readonly script: string };

// There is deliberately no content field: a write entry records the byte count and
// sha256 of what was written, never the written text.
// The stage a line records (D-89, D-90, D-107). A call writes an admission line before its
// execution and a result line after it. Optional: a line with no phase keeps the pre-stage shape.
export type AuditPhase = "admission" | "result";

export interface AuditEntryInput {
  readonly sessionId: string;
  readonly tool: string;
  readonly outcome: AuditOutcome;
  readonly phase?: AuditPhase;
  readonly path?: string;
  readonly bytes?: number;
  readonly sha256?: string;
  readonly execSummary?: ExecSummary;
}

export function summarizeExec(exec: ExecShape): ExecSummary {
  if ("argv" in exec) {
    return { argv: exec.argv.map((arg) => redactString(arg)) };
  }
  return {
    shell: true,
    scriptBytes: Buffer.byteLength(exec.script, "utf8"),
    sha256: createHash("sha256").update(exec.script, "utf8").digest("hex"),
  };
}

// Redacts the whole entry, then appends it as one line. The audit directory is
// created with mode 0700 on first use; the file is created or opened with mode
// 0600, and its mode is set to 0600 after open so a umask cannot widen it.
// The session id names the audit file, so it must be a safe file-name component. This is
// the same set the session store accepts (SESSION_ID_PATTERN in src/session/paths.ts).
// Duplicated here because this module imports core only (D-20). Anything else is
// SCHEMA_INVALID and nothing is written.
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function appendAudit(stateDir: string, input: AuditEntryInput): void {
  if (!SAFE_SESSION_ID.test(input.sessionId)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const entry = redactValue({
    at: new Date().toISOString(),
    sessionId: input.sessionId,
    tool: input.tool,
    outcome: input.outcome,
    phase: input.phase,
    path: input.path,
    bytes: input.bytes,
    sha256: input.sha256,
    execSummary: input.execSummary,
  });
  const line = Buffer.from(`${JSON.stringify(entry)}\n`, "utf8");

  try {
    writeAuditLine(stateDir, input.sessionId, line);
  } catch {
    throw makeRealmError("AUDIT_WRITE_FAILED");
  }
}

// Every failure of the write (directory, lstat check, open, chmod, write, fsync, close) is mapped to
// AUDIT_WRITE_FAILED by the caller. No raw Node error escapes this function. The failure does not
// say whether the line reached the file: a failed fsync, or a failed directory fsync, after a
// successful write reports AUDIT_WRITE_FAILED although the line is already in the file, so a caller
// must not blindly retry the append, because a retry would duplicate the line.
// The line is flushed with fsync before the descriptor closes. When this call created the log file,
// the audit directory is fsynced once after the line is durable, so the new directory entry, and the
// first line with it, is not lost to a crash after the call returned.
function writeAuditLine(stateDir: string, sessionId: string, line: Buffer): void {
  const dir = join(stateDir, "audit");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // lstat does not follow links: a symlinked audit directory is refused before any file is opened.
  const dirStat = lstatSync(dir);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
    throw new Error("audit directory is not a real directory");
  }
  const file = join(dir, `${sessionId}.jsonl`);
  const { fd, created } = openAuditFile(file);
  try {
    fchmodSync(fd, 0o600);
    let written = 0;
    while (written < line.length) {
      written += writeSync(fd, line, written, line.length - written);
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (created) {
    syncAuditDirectory(dir);
  }
}

// Opens the log for append. The first attempt uses O_EXCL, so success proves this call created the
// file and owes a directory fsync. EEXIST falls back to an open of the existing file, without
// O_CREAT, so a file removed in between fails the call instead of being created without that fsync.
// O_NONBLOCK: a FIFO at the audit path would otherwise block this write-only open until a reader
// appears. With it the open fails with ENXIO, which maps to AUDIT_WRITE_FAILED.
function openAuditFile(file: string): { readonly fd: number; readonly created: boolean } {
  const flags = constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  try {
    return { fd: openSync(file, flags | constants.O_CREAT | constants.O_EXCL, 0o600), created: true };
  } catch (error: unknown) {
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "EEXIST") {
      throw error;
    }
  }
  return { fd: openSync(file, flags), created: false };
}

// Flushes the audit directory entry. O_DIRECTORY rejects anything that is not a directory and
// O_NONBLOCK keeps a FIFO from blocking the open.
function syncAuditDirectory(dir: string): void {
  const dirFd = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NONBLOCK);
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
}
