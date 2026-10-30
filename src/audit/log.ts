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
import { AUDIT_GENESIS_PREV, AUDIT_LINE_MAX_BYTES, readChainHead, type ChainHead } from "./chain.js";
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
// The stage a line records (D-89, D-90, D-107, D-1403). A call writes an admission line before its
// execution and a result line after it. A reconciliation line is written at the next daemon start for an
// admission that never got a result line: its outcome is AUDIT_OUTCOME_UNKNOWN (src/audit/reconcile.ts).
// Optional: a line with no phase keeps the pre-stage shape.
export type AuditPhase = "admission" | "result" | "reconciliation";

export interface AuditEntryInput {
  readonly sessionId: string;
  readonly tool: string;
  readonly outcome: AuditOutcome;
  readonly phase?: AuditPhase;
  readonly path?: string;
  readonly bytes?: number;
  readonly sha256?: string;
  readonly execSummary?: ExecSummary;
  // Optional join key (D-1703). Present on admission and result lines of one call.
  readonly correlationId?: string;
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
const CORRELATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function appendAudit(stateDir: string, input: AuditEntryInput): void {
  if (!SAFE_SESSION_ID.test(input.sessionId)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const correlationId = durableCorrelationId(input.correlationId);
  const redacted = redactValue({
    at: new Date().toISOString(),
    sessionId: input.sessionId,
    correlationId,
    tool: input.tool,
    outcome: input.outcome,
    phase: input.phase,
    path: input.path,
    bytes: input.bytes,
    sha256: input.sha256,
    execSummary: input.execSummary,
  });
  if (typeof redacted !== "object" || redacted === null || Array.isArray(redacted)) {
    throw makeRealmError("SCHEMA_INVALID");
  }

  try {
    writeAuditLine(stateDir, input.sessionId, redacted as Record<string, unknown>);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "RealmError") {
      throw error;
    }
    throw makeRealmError("AUDIT_WRITE_FAILED");
  }
}

// A correlation id that redaction would rewrite fails the reader's pattern, and the
// reconciler then skips the whole line. Store a stable hash instead, so admission and
// result still pair and an unfinished call is still visible.
function durableCorrelationId(id: string | undefined): string | undefined {
  if (id === undefined) {
    return undefined;
  }
  if (!CORRELATION_ID.test(id)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (redactString(id) === id) {
    return id;
  }
  return createHash("sha256").update(id, "utf8").digest("hex");
}

// Every failure of the write (directory, lstat check, open, chmod, write, fsync, close, tail read) is mapped to
// AUDIT_WRITE_FAILED by the caller. No raw Node error escapes this function. The failure does not
// say whether the line reached the file: a failed fsync, or a failed directory fsync, after a
// successful write reports AUDIT_WRITE_FAILED although the line is already in the file, so a caller
// must not blindly retry the append, because a retry would duplicate the line.
// The line is flushed with fsync before the descriptor closes. When this call created the log file,
// the audit directory is fsynced once after the line is durable, so the new directory entry, and the
// first line with it, is not lost to a crash after the call returned.
// A crash in the middle of an earlier append can leave a last line with no newline. The next line would
// be glued onto it and neither would parse, so an existing, non-empty file whose last byte is not a
// newline gets a newline prefix, written in the same call as the line (D-1403). The same tail read
// recovers seq and prev (D-1702). A line longer than AUDIT_LINE_MAX_BYTES is refused.
function writeAuditLine(stateDir: string, sessionId: string, fields: Record<string, unknown>): void {
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
    const head = created ? { nextSeq: 1, prevHash: AUDIT_GENESIS_PREV, needsNewline: false } : readHead(file);
    const text = JSON.stringify(withChain(fields, head));
    if (Buffer.byteLength(text, "utf8") > AUDIT_LINE_MAX_BYTES) {
      throw new Error("audit line exceeds the chain bound");
    }
    const line = Buffer.from(`${text}\n`, "utf8");
    const payload = head.needsNewline ? Buffer.concat([Buffer.from("\n", "utf8"), line]) : line;
    let written = 0;
    while (written < payload.length) {
      written += writeSync(fd, payload, written, payload.length - written);
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (created) {
    syncAuditDirectory(dir);
  }
}

function withChain(fields: Record<string, unknown>, head: ChainHead): Record<string, unknown> {
  const out = Object.create(null) as Record<string, unknown>;
  out["seq"] = head.nextSeq;
  out["prev"] = head.prevHash;
  for (const key of Object.keys(fields)) {
    const value = fields[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function readHead(file: string): ChainHead {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    return readChainHead(fd);
  } finally {
    closeSync(fd);
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
