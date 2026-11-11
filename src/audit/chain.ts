// Hash chain for the audit log (OBS-01, D-1702). Each new line carries `seq` and `prev`.
// `prev` is the lowercase hex sha256 of the previous physical line's raw bytes, without
// the trailing newline. The first line of a new file uses 64 zeros. The head is read from
// the file tail on every append, so a restart needs no saved cursor.
//
// A pre-chain file has no marker line. The first chained line commits to the last legacy
// line only. A torn tail (no trailing newline, or a fragment that is not valid JSON) is
// closed by the writer and stays its own line; the next line hashes that fragment.

import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { basename, extname } from "node:path";
import { ANCHOR_RECORD_VERSION, merkleRoot, type AnchorRecord } from "./anchor.js";
import { isSessionId } from "../session/paths.js";

export const AUDIT_LINE_MAX_BYTES = 4 * 1024 * 1024;
export const AUDIT_GENESIS_PREV = "0".repeat(64);

const TAIL_CHUNK_BYTES = 64 * 1024;
const SEQ_LOOKBACK_LINES = 64;
const HEX64 = /^[0-9a-f]{64}$/;

export interface ChainHead {
  readonly nextSeq: number;
  readonly prevHash: string;
  readonly needsNewline: boolean;
}

export type ChainBreakReason =
  | "bad-chain-start"
  | "unchained-line"
  | "seq-gap"
  | "seq-regress"
  | "prev-mismatch"
  | "line-too-long"
  | "shorter-than-anchor"
  | "anchor-root-mismatch"
  | "shorter-than-head"
  | "head-mismatch";

export interface ChainBreak {
  readonly line: number;
  readonly reason: ChainBreakReason;
}

// `seq` here is a 1-based PHYSICAL line position, not the JSON record's chain seq.
// This makes a printed head reusable across legacy prefixes and torn fragments.
export interface AuditCheckpointHead {
  readonly seq: number;
  readonly lineSha256: string;
}

export interface VerifyAuditOptions {
  readonly head?: AuditCheckpointHead;
  readonly anchor?: AnchorRecord;
  readonly sessionId?: string;
}

export interface VerifyAuditResult {
  readonly ok: boolean;
  readonly lines: number;
  readonly chainedLines: number;
  readonly legacyLines: number;
  readonly unparsedLines: readonly number[];
  readonly tornTail: boolean;
  readonly chainStartLine: number | null;
  readonly head: AuditCheckpointHead | null;
  readonly anchor?: { readonly ok: boolean; readonly lineCount: number };
  readonly broken?: ChainBreak;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseAuditHead(value: string): AuditCheckpointHead | undefined {
  const match = /^([1-9][0-9]*):([0-9a-f]{64})$/.exec(value);
  if (match === null || match[0] !== value) {
    return undefined;
  }
  const seq = Number(match[1]);
  const lineSha256 = match[2];
  return Number.isSafeInteger(seq) && lineSha256 !== undefined ? { seq, lineSha256 } : undefined;
}

// Parse the record itself (the `record` member of anchor's dry-run output), never a
// signature or a claim about its origin. Authenticating the supplied checkpoint is
// the operator's responsibility; verification makes no network request.
export function parseAuditAnchor(value: unknown): AnchorRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const { version, sessionId, lineCount, rootSha256, createdAt } = record;
  if (
    Object.keys(record).length !== 5 ||
    version !== ANCHOR_RECORD_VERSION ||
    typeof sessionId !== "string" || !isSessionId(sessionId) || sessionId.trim() !== sessionId ||
    typeof lineCount !== "number" || !Number.isSafeInteger(lineCount) || lineCount < 1 ||
    typeof rootSha256 !== "string" || rootSha256.length !== 64 || !HEX64.test(rootSha256) ||
    typeof createdAt !== "string"
  ) {
    return undefined;
  }
  const time = new Date(createdAt);
  if (Number.isNaN(time.getTime()) || time.toISOString() !== createdAt) {
    return undefined;
  }
  return { version, sessionId, lineCount, rootSha256, createdAt };
}

// Reads the chain head from an already-open descriptor. A physical line is the JSON
// bytes plus its newline, so the tail window is one byte larger than the JSON bound.
// A second line is included so a torn fragment cannot hide the last complete seq.
// Throws when the last physical line is longer than the bound, so the caller never
// hashes a partial tail.
export function readChainHead(fd: number): ChainHead {
  const size = fstatSync(fd).size;
  if (size === 0) {
    return { nextSeq: 1, prevHash: AUDIT_GENESIS_PREV, needsNewline: false };
  }
  const physicalMax = AUDIT_LINE_MAX_BYTES + 1;
  const window = Math.min(size, physicalMax * 2);
  const start = size - window;
  const buf = Buffer.alloc(window);
  if (readSync(fd, buf, 0, window, start) !== window) {
    throw new Error("audit file tail could not be read");
  }
  const needsNewline = buf[buf.length - 1] !== 0x0a;
  const end = needsNewline ? buf.length : buf.length - 1;
  const boundary = end === 0 ? -1 : buf.lastIndexOf(0x0a, end - 1);
  if (boundary < 0 && start > 0) {
    throw new Error("audit line exceeds the chain bound");
  }
  const lineStart = boundary < 0 ? 0 : boundary + 1;
  const lastLine = buf.subarray(lineStart, end);
  if (lastLine.length > AUDIT_LINE_MAX_BYTES) {
    throw new Error("audit line exceeds the chain bound");
  }
  return {
    nextSeq: nextSeqFromTail(buf, end, start === 0),
    prevHash: sha256Hex(lastLine),
    needsNewline,
  };
}

function nextSeqFromTail(buf: Buffer, lineEnd: number, startsAtFile: boolean): number {
  let end = lineEnd;
  for (let seen = 0; seen < SEQ_LOOKBACK_LINES && end > 0; seen += 1) {
    const boundary = buf.lastIndexOf(0x0a, end - 1);
    // A window that starts mid-file must not parse the cut prefix as a record.
    if (boundary < 0 && !startsAtFile) {
      break;
    }
    const start = boundary < 0 ? 0 : boundary + 1;
    const seq = chainedSeq(buf.subarray(start, end));
    if (seq !== undefined) {
      return seq + 1;
    }
    if (boundary < 0) {
      break;
    }
    end = boundary;
  }
  return 1;
}

function chainedSeq(line: Uint8Array): number | undefined {
  const parsed = parseObject(line);
  if (parsed === undefined || !isChained(parsed)) {
    return undefined;
  }
  return parsed["seq"] as number;
}

function parseObject(line: Uint8Array): Record<string, unknown> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(line).toString("utf8"));
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function isChained(record: Record<string, unknown>): boolean {
  const seq = record["seq"];
  const prev = record["prev"];
  return (
    typeof seq === "number" &&
    Number.isInteger(seq) &&
    seq >= 1 &&
    seq <= Number.MAX_SAFE_INTEGER &&
    typeof prev === "string" &&
    prev.length === 64 && HEX64.test(prev)
  );
}

export function verifyAuditFile(file: string, options: VerifyAuditOptions = {}): VerifyAuditResult {
  const stem = basename(file, extname(file));
  const sessionId = options.sessionId ?? (isSessionId(stem) && stem.trim() === stem ? stem : "file");
  if (!isSessionId(sessionId) || sessionId.trim() !== sessionId) {
    throw new TypeError("invalid audit session id");
  }
  if (options.head !== undefined && (
    !Number.isSafeInteger(options.head.seq) || options.head.seq < 1 ||
    options.head.lineSha256.length !== 64 || !HEX64.test(options.head.lineSha256)
  )) {
    throw new TypeError("invalid retained audit head");
  }
  if (options.anchor !== undefined && (
    parseAuditAnchor(options.anchor) === undefined || options.anchor.sessionId !== sessionId
  )) {
    throw new TypeError("invalid audit anchor or session mismatch");
  }
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) {
      throw new Error("audit file is not a regular file");
    }
    return verifyDescriptor(fd, options);
  } finally {
    closeSync(fd);
  }
}

function verifyDescriptor(fd: number, options: VerifyAuditOptions): VerifyAuditResult {
  const unparsedLines: number[] = [];
  let lines = 0;
  let chainedLines = 0;
  let legacyLines = 0;
  let chainStarted = false;
  let lastSeq = 0;
  let prevRaw = AUDIT_GENESIS_PREV;
  let tornTail = false;
  let broken: ChainBreak | undefined;
  let carry = Buffer.alloc(0);
  let chainStartLine: number | null = null;
  let headLine = 0;
  let retainedHash: string | undefined;
  let anchor: VerifyAuditResult["anchor"];
  const anchoredLines: Uint8Array[] = [];
  const checkpoint = options.anchor;

  const result = (atEof: boolean): VerifyAuditResult => {
    if (atEof && broken === undefined) {
      if (checkpoint !== undefined && lines < checkpoint.lineCount) {
        anchor = { ok: false, lineCount: checkpoint.lineCount };
        broken = { line: lines + 1, reason: "shorter-than-anchor" };
      } else if (anchor?.ok === false) {
        broken = { line: checkpoint?.lineCount ?? lines, reason: "anchor-root-mismatch" };
      }
      if (broken === undefined && options.head !== undefined) {
        if (lines < options.head.seq) {
          broken = { line: lines + 1, reason: "shorter-than-head" };
        } else if (retainedHash !== options.head.lineSha256) {
          broken = { line: options.head.seq, reason: "head-mismatch" };
        }
      }
    }
    return {
      ok: broken === undefined,
      lines, chainedLines, legacyLines, chainStartLine, unparsedLines, tornTail,
      head: headLine === 0 ? null : { seq: headLine, lineSha256: prevRaw },
      ...(broken === undefined ? {} : { broken }),
      ...(anchor === undefined ? {} : { anchor }),
    };
  };

  const finish = (line: Buffer, atEof: boolean): void => {
    if (line.length === 0 && atEof && !tornTail) {
      return;
    }
    lines += 1;
    const lineNo = lines;
    if (line.length > AUDIT_LINE_MAX_BYTES) {
      broken = { line: lineNo, reason: "line-too-long" };
      return;
    }
    const parsed = parseObject(line);
    const chained = parsed !== undefined && isChained(parsed);
    if (!chainStarted) {
      if (!chained) {
        if (parsed === undefined) {
          unparsedLines.push(lineNo);
        } else {
          legacyLines += 1;
        }
      } else if (!acceptChainStart(parsed, lineNo, prevRaw)) {
        broken = { line: lineNo, reason: "bad-chain-start" };
      } else {
        chainStarted = true;
        chainStartLine = lineNo;
        lastSeq = parsed["seq"] as number;
        chainedLines += 1;
      }
    } else if (parsed === undefined) {
      unparsedLines.push(lineNo);
    } else if (!chained) {
      broken = { line: lineNo, reason: "unchained-line" };
    } else {
      const seq = parsed["seq"] as number;
      const prev = parsed["prev"] as string;
      if (seq !== lastSeq + 1) {
        broken = { line: lineNo, reason: seq > lastSeq ? "seq-gap" : "seq-regress" };
      } else if (prev !== prevRaw) {
        broken = { line: lineNo, reason: "prev-mismatch" };
      } else {
        lastSeq = seq;
        chainedLines += 1;
      }
    }
    prevRaw = sha256Hex(line);
    headLine = lineNo;
    if (lineNo === options.head?.seq) {
      retainedHash = prevRaw;
    }
    if (checkpoint !== undefined && lineNo <= checkpoint.lineCount) {
      anchoredLines.push(line);
      if (lineNo === checkpoint.lineCount) {
        anchor = {
          ok: Buffer.from(merkleRoot(anchoredLines)).toString("hex") === checkpoint.rootSha256,
          lineCount: checkpoint.lineCount,
        };
        anchoredLines.length = 0;
      }
    }
  };

  // Until the anchored prefix is consumed, keep chunk-backed views alive for the
  // existing public Merkle API. No JSON reserialization, duplicate hash algorithm,
  // second file read, or per-line copy. Afterwards reuse the single read buffer.
  let chunk = Buffer.alloc(TAIL_CHUNK_BYTES);
  for (;;) {
    const read = readSync(fd, chunk, 0, TAIL_CHUNK_BYTES, null);
    if (read === 0) {
      break;
    }
    let offset = 0;
    while (offset < read) {
      const newlineAt = chunk.indexOf(0x0a, offset);
      const newline = newlineAt >= read ? -1 : newlineAt;
      if (newline < 0) {
        const piece = chunk.subarray(offset, read);
        if (carry.length + piece.length > AUDIT_LINE_MAX_BYTES) {
          lines += 1;
          broken = { line: lines, reason: "line-too-long" };
          tornTail = true;
          return result(false);
        }
        carry = Buffer.concat([carry, piece]);
        break;
      }
      const piece = chunk.subarray(offset, newline);
      const line = carry.length === 0 ? piece : Buffer.concat([carry, piece]);
      carry = Buffer.alloc(0);
      finish(line, false);
      if (broken !== undefined) {
        return result(false);
      }
      offset = newline + 1;
    }
    if (checkpoint !== undefined && lines < checkpoint.lineCount) {
      chunk = Buffer.alloc(TAIL_CHUNK_BYTES);
    }
  }
  if (carry.length > 0) {
    tornTail = true;
    finish(carry, true);
  }
  return result(true);
}

function acceptChainStart(record: Record<string, unknown>, lineNo: number, prevRaw: string): boolean {
  const expected = lineNo === 1 ? AUDIT_GENESIS_PREV : prevRaw;
  return record["seq"] === 1 && record["prev"] === expected;
}

