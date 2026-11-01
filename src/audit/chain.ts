// Hash chain for the audit log (OBS-01, D-1702). Each new line carries `seq` and `prev`.
// `prev` is the lowercase hex sha256 of the previous physical line's raw bytes, without
// the trailing newline. The first line of a new file uses 64 zeros. The head is read from
// the file tail on every append, so a restart needs no saved cursor.
//
// A pre-chain file has no marker line. The first chained line commits to the last legacy
// line only. A torn tail (no trailing newline, or a fragment that is not valid JSON) is
// closed by the writer and stays its own line; the next line hashes that fragment.
//
// The chain alone cannot see a log that was cut short or rewritten consistently from some
// line on. checkAuditFile adds two externally held pins, each "<seq>:<sha256>" of a chained
// line: a head (the newest line known at save time) and an anchor (an older line that must
// stay unchanged). A log shorter than the pin reports tail-loss (head) or shorter-log
// (anchor); a pinned line whose bytes changed reports prefix-changed at that line.

import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

export const AUDIT_LINE_MAX_BYTES = 4 * 1024 * 1024;
export const AUDIT_GENESIS_PREV = "0".repeat(64);

const TAIL_CHUNK_BYTES = 64 * 1024;
const SEQ_LOOKBACK_LINES = 64;
const HEX64 = /^[0-9a-f]{64}$/;
const CHECKPOINT = /^([1-9][0-9]*):([0-9a-f]{64})$/;

export interface ChainHead {
  readonly nextSeq: number;
  readonly prevHash: string;
  readonly needsNewline: boolean;
}

// The newest chained line verified by one pass: its seq, its 1-based physical line number,
// and the sha256 of its raw bytes (the value the next line's `prev` must equal).
export interface AuditHead {
  readonly seq: number;
  readonly line: number;
  readonly hash: string;
}

export type ChainBreakReason =
  | "bad-chain-start"
  | "unchained-line"
  | "seq-gap"
  | "seq-regress"
  | "prev-mismatch"
  | "line-too-long"
  | "prefix-changed"
  | "tail-loss"
  | "shorter-log";

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
  readonly head?: AuditHead;
  readonly broken?: ChainBreak;
}

// Typed outcome for a CLI: exit 0 = verified, 1 = the log is broken (line and reason name
// where), 2 = the check could not run (unreadable file or malformed checkpoint argument).
export type AuditCheckReason = ChainBreakReason | "bad-checkpoint" | "unreadable";

export interface AuditCheck {
  readonly ok: boolean;
  readonly exitCode: 0 | 1 | 2;
  readonly line?: number;
  readonly reason?: AuditCheckReason;
  readonly lines: number;
  readonly chainedLines: number;
  // Legacy lines before the chain start. They carry no seq and no checkpoint covers them.
  readonly unprotected: number;
  readonly tornTail: boolean;
  readonly head?: AuditHead;
}

export interface AuditCheckOptions {
  // "<seq>:<sha256>" saved from an earlier head. Detects tail loss and a changed head line.
  readonly head?: string;
  // "<seq>:<sha256>" of an older chained line. Detects a shorter log and a changed prefix.
  readonly anchor?: string;
}

export interface AuditCheckpoint {
  readonly seq: number;
  readonly hash: string;
}

interface Pin extends AuditCheckpoint {
  readonly missing: "tail-loss" | "shorter-log";
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
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
    HEX64.test(prev)
  );
}

// R3 (OBS-01): a broken link is reported at the SUCCESSOR line, the first line whose `prev`
// does not equal the sha256 of its predecessor. An edit to line N therefore surfaces as
// prev-mismatch on line N+1, not on N. A deletion surfaces as seq-gap on the line after the
// gap; a reorder as seq-gap or seq-regress on the line that arrives out of order. The
// successor rule is pinned by test/audit/chain.test.ts; do not move it to the edited line.
export function verifyAuditFile(file: string): VerifyAuditResult {
  return verifyWithPins(file, []);
}

// Verifies the chain and every pin in one pass. A pinned seq whose line hash differs
// reports prefix-changed at that anchored line (the chain check of its successor still
// runs first on any line that precedes it). A pin whose seq the log never reaches reports
// tail-loss or shorter-log at the last line present.
function verifyWithPins(file: string, pins: readonly Pin[]): VerifyAuditResult {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) {
      throw new Error("audit file is not a regular file");
    }
    return verifyDescriptor(fd, pins);
  } finally {
    closeSync(fd);
  }
}

function verifyDescriptor(fd: number, pins: readonly Pin[]): VerifyAuditResult {
  const unparsedLines: number[] = [];
  let lines = 0;
  let chainedLines = 0;
  let legacyLines = 0;
  let chainStarted = false;
  let lastSeq = 0;
  let prevRaw = AUDIT_GENESIS_PREV;
  let tornTail = false;
  let head: AuditHead | undefined;
  let broken: ChainBreak | undefined;
  let carry = Buffer.alloc(0);

  const pin = (seq: number, lineNo: number, line: Buffer): void => {
    for (const expected of pins) {
      if (expected.seq === seq && expected.hash !== sha256Hex(line)) {
        broken = { line: lineNo, reason: "prefix-changed" };
        return;
      }
    }
  };

  const accept = (seq: number, lineNo: number, line: Buffer): void => {
    lastSeq = seq;
    chainedLines += 1;
    head = { seq, line: lineNo, hash: sha256Hex(line) };
    pin(seq, lineNo, line);
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
        accept(parsed["seq"] as number, lineNo, line);
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
        accept(seq, lineNo, line);
      }
    }
    prevRaw = sha256Hex(line);
  };

  const done = (): VerifyAuditResult => {
    if (broken === undefined) {
      for (const expected of pins) {
        if (expected.seq > lastSeq) {
          broken = { line: lines, reason: expected.missing };
          break;
        }
      }
    }
    return resultOf(lines, chainedLines, legacyLines, unparsedLines, tornTail, broken, head);
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
          return done();
        }
        carry = Buffer.concat([carry, piece]);
        break;
      }
      const piece = chunk.subarray(offset, newline);
      const line = carry.length === 0 ? Buffer.from(piece) : Buffer.concat([carry, piece]);
      carry = Buffer.alloc(0);
      finish(line, false);
      if (broken !== undefined) {
        return done();
      }
      offset = newline + 1;
    }
  }
  if (carry.length > 0) {
    tornTail = true;
    finish(carry, true);
  }
  return done();
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
  head: AuditHead | undefined,
): VerifyAuditResult {
  return {
    ok: broken === undefined,
    lines,
    chainedLines,
    legacyLines,
    unparsedLines,
    tornTail,
    ...(head === undefined ? {} : { head }),
    ...(broken === undefined ? {} : { broken }),
  };
}

// Renders the head as the checkpoint text a caller stores: "<seq>:<sha256>".
export function formatAuditCheckpoint(head: AuditHead): string {
  return `${String(head.seq)}:${head.hash}`;
}

// Parses "<seq>:<sha256>". Undefined for any other shape or a seq beyond the safe integer range.
export function parseAuditCheckpoint(text: string): AuditCheckpoint | undefined {
  const match = CHECKPOINT.exec(text);
  if (match === null) {
    return undefined;
  }
  const seq = Number(match[1]);
  if (!Number.isSafeInteger(seq)) {
    return undefined;
  }
  return { seq, hash: match[2] ?? "" };
}

// Checks the chain, then the optional head and anchor pins, and returns a typed outcome.
// Malformed checkpoint text and an unreadable file are exit 2, never a verification verdict.
export function checkAuditFile(file: string, options: AuditCheckOptions = {}): AuditCheck {
  const pins: Pin[] = [];
  const sources: readonly [string | undefined, Pin["missing"]][] = [
    [options.head, "tail-loss"],
    [options.anchor, "shorter-log"],
  ];
  for (const [text, missing] of sources) {
    if (text === undefined) {
      continue;
    }
    const parsed = parseAuditCheckpoint(text);
    if (parsed === undefined) {
      return checkError("bad-checkpoint");
    }
    pins.push({ ...parsed, missing });
  }
  let result: VerifyAuditResult;
  try {
    result = verifyWithPins(file, pins);
  } catch {
    return checkError("unreadable");
  }
  const broken = result.broken;
  return {
    ok: broken === undefined,
    exitCode: broken === undefined ? 0 : 1,
    ...(broken === undefined ? {} : { line: broken.line, reason: broken.reason }),
    lines: result.lines,
    chainedLines: result.chainedLines,
    unprotected: result.legacyLines,
    tornTail: result.tornTail,
    ...(result.head === undefined ? {} : { head: result.head }),
  };
}

function checkError(reason: AuditCheckReason): AuditCheck {
  return { ok: false, exitCode: 2, reason, lines: 0, chainedLines: 0, unprotected: 0, tornTail: false };
}
