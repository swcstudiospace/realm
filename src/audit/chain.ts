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
  | "line-too-long";

export interface ChainBreak {
  readonly line: number;
  readonly reason: ChainBreakReason;
}

export interface VerifyAuditResult {
  readonly ok: boolean;
  readonly lines: number;
  readonly chainedLines: number;
  readonly legacyLines: number;
  readonly unparsedLines: readonly number[];
  readonly tornTail: boolean;
  readonly broken?: ChainBreak;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Reads the chain head from an already-open descriptor. Throws when the last physical
// line is longer than AUDIT_LINE_MAX_BYTES, so the caller never hashes a partial tail.
export function readChainHead(fd: number): ChainHead {
  const size = fstatSync(fd).size;
  if (size === 0) {
    return { nextSeq: 1, prevHash: AUDIT_GENESIS_PREV, needsNewline: false };
  }
  const window = Math.min(size, AUDIT_LINE_MAX_BYTES);
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
  return {
    nextSeq: nextSeqFromTail(buf, end),
    prevHash: sha256Hex(lastLine),
    needsNewline,
  };
}

function nextSeqFromTail(buf: Buffer, lineEnd: number): number {
  let end = lineEnd;
  for (let seen = 0; seen < SEQ_LOOKBACK_LINES && end > 0; seen += 1) {
    const boundary = buf.lastIndexOf(0x0a, end - 1);
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
    HEX64.test(prev)
  );
}

export function verifyAuditFile(file: string): VerifyAuditResult {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) {
      throw new Error("audit file is not a regular file");
    }
    return verifyDescriptor(fd);
  } finally {
    closeSync(fd);
  }
}

function verifyDescriptor(fd: number): VerifyAuditResult {
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
  };

  const chunk = Buffer.alloc(TAIL_CHUNK_BYTES);
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
          return resultOf(lines, chainedLines, legacyLines, unparsedLines, true, broken);
        }
        carry = Buffer.concat([carry, piece]);
        break;
      }
      const piece = chunk.subarray(offset, newline);
      const line = carry.length === 0 ? Buffer.from(piece) : Buffer.concat([carry, piece]);
      carry = Buffer.alloc(0);
      finish(line, false);
      if (broken !== undefined) {
        return resultOf(lines, chainedLines, legacyLines, unparsedLines, false, broken);
      }
      offset = newline + 1;
    }
  }
  if (carry.length > 0) {
    tornTail = true;
    finish(carry, true);
  }
  return resultOf(lines, chainedLines, legacyLines, unparsedLines, tornTail, broken);
}

function acceptChainStart(record: Record<string, unknown>, lineNo: number, prevRaw: string): boolean {
  const expected = lineNo === 1 ? AUDIT_GENESIS_PREV : prevRaw;
  return record["seq"] === 1 && record["prev"] === expected;
}

function resultOf(
  lines: number,
  chainedLines: number,
  legacyLines: number,
  unparsedLines: readonly number[],
  tornTail: boolean,
  broken: ChainBreak | undefined,
): VerifyAuditResult {
  return {
    ok: broken === undefined,
    lines,
    chainedLines,
    legacyLines,
    unparsedLines,
    tornTail,
    ...(broken === undefined ? {} : { broken }),
  };
}
