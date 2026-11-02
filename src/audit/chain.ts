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
// line on. checkAuditFile adds two externally held checks. A head pin, "<seq>:<sha256>" of
// the newest chained line known at save time, reports tail-loss when the log is shorter, and
// prefix-changed when that line's bytes differ. An anchor record (realm anchor, see
// anchor.ts) commits to the first lineCount lines by Merkle root; a shorter log reports
// shorter-log and a changed prefix reports prefix-changed. Lines past the anchored count pass.

import { createHash, type Hash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { AnchorError, newLeafHash, nodeHash, type AnchorMismatch, type AnchorRecord } from "./anchor.js";

export const AUDIT_LINE_MAX_BYTES = 4 * 1024 * 1024;
export const AUDIT_GENESIS_PREV = "0".repeat(64);

const READ_CHUNK_BYTES = 64 * 1024;
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
  | "tail-loss";

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

// Typed outcome for a CLI: exit 0 = verified, 1 = the log is broken (the line and reason name
// where a chain or head check failed; an anchor mismatch is in `anchor`), 2 = the check could
// not run (unreadable file or malformed checkpoint argument).
export type AuditCheckReason = ChainBreakReason | "bad-checkpoint" | "unreadable";

// Outcome of an anchor record check. ok false names the mismatch; the count and the file's
// line count let a caller report both.
export type AnchorCheck =
  | { readonly ok: true; readonly lines: number; readonly lineCount: number }
  | { readonly ok: false; readonly lines: number; readonly lineCount: number; readonly reason: AnchorMismatch };

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
  // Physical lines that are not JSON objects. Taken from the same pass as lines, chainedLines and head.
  readonly unparsedLines: readonly number[];
  readonly head?: AuditHead;
  // Present when an anchor record was given and the chain verified.
  readonly anchor?: AnchorCheck;
}

export interface AuditCheckOptions {
  // "<seq>:<sha256>" saved from an earlier head. Detects tail loss and a changed head line.
  readonly head?: string;
  // A realm anchor record (see anchor.ts). Detects a shorter log and a changed first lineCount lines.
  readonly anchor?: AnchorRecord;
}

export interface AuditCheckpoint {
  readonly seq: number;
  readonly hash: string;
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

// The newest chained line within the lookback, searched backward from lineEnd (the index of the newline that ends it, or the
// end of the window). Undefined when the lookback finds none.
function lastChainedLine(buf: Buffer, lineEnd: number, startsAtFile: boolean): { readonly seq: number; readonly bytes: Buffer } | undefined {
  let end = lineEnd;
  for (let seen = 0; seen < SEQ_LOOKBACK_LINES && end > 0; seen += 1) {
    const boundary = buf.lastIndexOf(0x0a, end - 1);
    // A window that starts mid-file must not parse the cut prefix as a record.
    if (boundary < 0 && !startsAtFile) {
      break;
    }
    const start = boundary < 0 ? 0 : boundary + 1;
    const bytes = buf.subarray(start, end);
    const seq = chainedSeq(bytes);
    if (seq !== undefined) {
      return { seq, bytes };
    }
    if (boundary < 0) {
      break;
    }
    end = boundary;
  }
  return undefined;
}

function nextSeqFromTail(buf: Buffer, lineEnd: number, startsAtFile: boolean): number {
  const last = lastChainedLine(buf, lineEnd, startsAtFile);
  return last === undefined ? 1 : last.seq + 1;
}

// The head of the chain read from the file tail alone: the newest chained line's seq and the sha256 of its raw bytes, the pair
// the full verifier reports, without its line count. A torn last line is not a complete line and is never the head. Undefined
// when the tail window holds no chained line. Throws when that line is longer than the bound.
export interface TailHead {
  readonly seq: number;
  readonly hash: string;
}

export function readTailHead(fd: number): TailHead | undefined {
  const size = fstatSync(fd).size;
  if (size === 0) {
    return undefined;
  }
  const physicalMax = AUDIT_LINE_MAX_BYTES + 1;
  const window = Math.min(size, physicalMax * 2);
  const start = size - window;
  const buf = Buffer.alloc(window);
  if (readSync(fd, buf, 0, window, start) !== window) {
    throw new Error("audit file tail could not be read");
  }
  const lineEnd = buf.lastIndexOf(0x0a);
  if (lineEnd < 0) {
    return undefined;
  }
  const last = lastChainedLine(buf, lineEnd, start === 0);
  if (last === undefined) {
    return undefined;
  }
  if (last.bytes.length > AUDIT_LINE_MAX_BYTES) {
    throw new Error("audit line exceeds the chain bound");
  }
  return { seq: last.seq, hash: sha256Hex(last.bytes) };
}

export type AuditHeadOutcome =
  | { readonly state: "absent" }
  | { readonly state: "none" }
  | { readonly state: "unreadable" }
  | { readonly state: "head"; readonly head: TailHead };

// The head of one audit file, for the daemon's startup and shutdown records. The file is opened read-only without following a
// symlink, as the verifier opens it. A missing file is absent. Never throws.
export function readAuditHead(file: string): AuditHeadOutcome {
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error: unknown) {
    const missing = error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
    return missing ? { state: "absent" } : { state: "unreadable" };
  }
  try {
    const head = readTailHead(fd);
    return head === undefined ? { state: "none" } : { state: "head", head };
  } catch {
    // The tail could not be read, or its line is over the bound. The caller logs audit.unreadable.
    return { state: "unreadable" };
  } finally {
    closeSync(fd);
  }
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

// Verifies the chain and the optional head pin in one pass. A pinned seq whose line hash differs
// reports prefix-changed at that line (the chain check of its successor still runs first on any
// line that precedes it). A pin whose seq the log never reaches reports tail-loss at the last
// line present.
function verifyWithPins(file: string, pins: readonly AuditCheckpoint[]): VerifyAuditResult {
  const fd = openRegularFile(file);
  try {
    return verifyDescriptor(fd, pins);
  } finally {
    closeSync(fd);
  }
}

// The fields a head-pin mismatch reports: the state at the pinned line, which is where a verifier that stopped at the
// first break would have stopped.
interface PinBreak {
  readonly lines: number;
  readonly chainedLines: number;
  readonly legacyLines: number;
  readonly tornTail: boolean;
  readonly head: AuditHead | undefined;
  readonly broken: ChainBreak;
}

// One pass over the file. Chain and line-bound breaks end the pass. A head-pin mismatch does not: the pass goes on so
// unparsedLines covers the same lines as the plain verifier, and the reported counts, head and break stay at the
// pinned line. Chain links are checked after a pin mismatch only to decide where the plain pass stops.
function verifyDescriptor(fd: number, pins: readonly AuditCheckpoint[]): VerifyAuditResult {
  const unparsedLines: number[] = [];
  let lines = 0;
  let chainedLines = 0;
  let legacyLines = 0;
  let chainStarted = false;
  let lastSeq = 0;
  let prevRaw = AUDIT_GENESIS_PREV;
  let tornTail = false;
  let head: AuditHead | undefined;
  let chainBreak: ChainBreak | undefined;
  let pinBreak: PinBreak | undefined;
  let carry = Buffer.alloc(0);

  const pin = (seq: number, lineNo: number, line: Buffer): void => {
    if (pinBreak !== undefined) {
      return;
    }
    for (const expected of pins) {
      if (expected.seq === seq && expected.hash !== sha256Hex(line)) {
        pinBreak = {
          lines: lineNo,
          chainedLines,
          legacyLines,
          tornTail,
          head,
          broken: { line: lineNo, reason: "prefix-changed" },
        };
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
      chainBreak = { line: lineNo, reason: "line-too-long" };
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
        chainBreak = { line: lineNo, reason: "bad-chain-start" };
      } else {
        chainStarted = true;
        accept(parsed["seq"] as number, lineNo, line);
      }
    } else if (parsed === undefined) {
      unparsedLines.push(lineNo);
    } else if (!chained) {
      chainBreak = { line: lineNo, reason: "unchained-line" };
    } else {
      const seq = parsed["seq"] as number;
      const prev = parsed["prev"] as string;
      if (seq !== lastSeq + 1) {
        chainBreak = { line: lineNo, reason: seq > lastSeq ? "seq-gap" : "seq-regress" };
      } else if (prev !== prevRaw) {
        chainBreak = { line: lineNo, reason: "prev-mismatch" };
      } else {
        accept(seq, lineNo, line);
      }
    }
    prevRaw = sha256Hex(line);
  };

  const done = (): VerifyAuditResult => {
    if (pinBreak !== undefined) {
      const pinned = pinBreak;
      return resultOf(
        pinned.lines,
        pinned.chainedLines,
        pinned.legacyLines,
        unparsedLines,
        pinned.tornTail,
        pinned.broken,
        pinned.head,
      );
    }
    let broken = chainBreak;
    if (broken === undefined) {
      for (const expected of pins) {
        if (expected.seq > lastSeq) {
          broken = { line: lines, reason: "tail-loss" };
          break;
        }
      }
    }
    return resultOf(lines, chainedLines, legacyLines, unparsedLines, tornTail, broken, head);
  };

  const chunk = Buffer.alloc(READ_CHUNK_BYTES);
  for (;;) {
    const read = readSync(fd, chunk, 0, READ_CHUNK_BYTES, null);
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
          chainBreak = { line: lines, reason: "line-too-long" };
          return done();
        }
        carry = Buffer.concat([carry, piece]);
        break;
      }
      const piece = chunk.subarray(offset, newline);
      const line = carry.length === 0 ? Buffer.from(piece) : Buffer.concat([carry, piece]);
      carry = Buffer.alloc(0);
      finish(line, false);
      if (chainBreak !== undefined) {
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

// Checks the chain, then the optional head pin, then the optional anchor record, and returns a typed outcome.
// The anchor is checked only once the chain verifies, so a broken chain names its own line. Malformed checkpoint
// text and an unreadable file are exit 2, never a verification verdict.
export function checkAuditFile(file: string, options: AuditCheckOptions = {}): AuditCheck {
  const pins: AuditCheckpoint[] = [];
  if (options.head !== undefined) {
    const parsed = parseAuditCheckpoint(options.head);
    if (parsed === undefined) {
      return checkError("bad-checkpoint");
    }
    pins.push(parsed);
  }
  let result: VerifyAuditResult;
  let anchor: AnchorCheck | undefined;
  try {
    result = verifyWithPins(file, pins);
    if (result.broken === undefined && options.anchor !== undefined) {
      anchor = checkAnchor(file, options.anchor, result.lines);
    }
  } catch {
    return checkError("unreadable");
  }
  const broken = result.broken;
  const ok = broken === undefined && (anchor === undefined || anchor.ok);
  return {
    ok,
    exitCode: ok ? 0 : 1,
    ...(broken === undefined ? {} : { line: broken.line, reason: broken.reason }),
    lines: result.lines,
    chainedLines: result.chainedLines,
    unprotected: result.legacyLines,
    unparsedLines: result.unparsedLines,
    tornTail: result.tornTail,
    ...(result.head === undefined ? {} : { head: result.head }),
    ...(anchor === undefined ? {} : { anchor }),
  };
}

type AnchoredPrefix =
  | { readonly complete: true; readonly root: string }
  | { readonly complete: false; readonly lines: number };

// Checks the record against the first lineCount lines. fileLines is the whole file's line count from the chain pass,
// which already read every line in bounded memory; the prefix scan stops at the anchored line, so only a file that
// ends first is read to its end.
function checkAnchor(file: string, record: AnchorRecord, fileLines: number): AnchorCheck {
  const fd = openRegularFile(file);
  try {
    const prefix = scanAnchoredPrefix(fd, record.lineCount);
    if (!prefix.complete) {
      return { ok: false, lines: prefix.lines, lineCount: record.lineCount, reason: "shorter-log" };
    }
    if (prefix.root !== record.rootSha256) {
      return { ok: false, lines: fileLines, lineCount: record.lineCount, reason: "prefix-changed" };
    }
    return { ok: true, lines: fileLines, lineCount: record.lineCount };
  } finally {
    closeSync(fd);
  }
}

// Streams the first lineCount lines into the anchor Merkle root, the same root anchor.ts merkleRoot gives for those
// lines. Fixed-size reads and a line hashed as its bytes arrive keep memory independent of file and line length; the
// scan returns at the anchored line.
function scanAnchoredPrefix(fd: number, lineCount: number): AnchoredPrefix {
  if (lineCount < 1) {
    throw new AnchorError("cannot anchor an empty audit log", "SCHEMA_INVALID");
  }
  const merkle = new StreamingMerkleRoot();
  const chunk = Buffer.alloc(READ_CHUNK_BYTES);
  let open: Hash | undefined;
  let lines = 0;
  for (;;) {
    const read = readSync(fd, chunk, 0, READ_CHUNK_BYTES, null);
    if (read === 0) {
      break;
    }
    let offset = 0;
    for (;;) {
      const newline = chunk.subarray(offset, read).indexOf(0x0a);
      const end = newline < 0 ? read : offset + newline;
      if (end > offset) {
        if (open === undefined) {
          open = newLeafHash();
        }
        open.update(chunk.subarray(offset, end));
      }
      if (newline < 0) {
        break;
      }
      merkle.add((open ?? newLeafHash()).digest());
      open = undefined;
      lines += 1;
      if (lines === lineCount) {
        return { complete: true, root: merkle.rootHex() };
      }
      offset = end + 1;
    }
  }
  if (open !== undefined) {
    merkle.add(open.digest());
    lines += 1;
  }
  return lines < lineCount ? { complete: false, lines } : { complete: true, root: merkle.rootHex() };
}

// Opens an audit file read-only through a no-follow, non-blocking open. Throws unless the target is a regular file.
function openRegularFile(file: string): number {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) {
      throw new Error("audit file is not a regular file");
    }
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  return fd;
}

// Incremental form of anchor.ts merkleRoot: the same leaf and node hashes, folded as leaves arrive. pending[level]
// holds a completed subtree of 2^level leaves that still waits for its right neighbour, so memory is one digest per
// tree level, not one per line.
class StreamingMerkleRoot {
  private readonly pending: (Buffer | undefined)[] = [];

  add(leaf: Buffer): void {
    let node = leaf;
    let level = 0;
    let left = this.pending[level];
    while (left !== undefined) {
      this.pending[level] = undefined;
      node = nodeHash(left, node);
      level += 1;
      left = this.pending[level];
    }
    this.pending[level] = node;
  }

  // Folds the pending subtrees from the lowest level up. A higher level holds earlier leaves, so it is the left
  // operand; an empty level contributes nothing, which is the promote-unpaired rule of merkleRoot.
  rootHex(): string {
    let root: Buffer | undefined;
    for (const node of this.pending) {
      if (node !== undefined) {
        root = root === undefined ? node : nodeHash(node, root);
      }
    }
    if (root === undefined) {
      throw new AnchorError("cannot anchor an empty audit log", "SCHEMA_INVALID");
    }
    return root.toString("hex");
  }
}

function checkError(reason: AuditCheckReason): AuditCheck {
  return {
    ok: false,
    exitCode: 2,
    reason,
    lines: 0,
    chainedLines: 0,
    unprotected: 0,
    tornTail: false,
    unparsedLines: [],
  };
}
