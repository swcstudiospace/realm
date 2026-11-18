// The memory probe of EVID-02 (35-02, D-35-03): can a process that is the same uid as a capability-token holder, is not root and
// is not an ancestor of the holder read the token, or the signing key, out of the holder's memory, and what does it learn from
// the holder's environment? The module holds the pure parts (specification parsing, maps parsing, chunk scanning, token-shape
// search, report building, the verdict rule) and the thin I/O around them (the reads of /proc/PID, the detached starter, the
// descendant control holder).
//
// Read-only by construction: files are opened with the read flag, and the module contains no ptrace call, no signal to a target
// and no write to a proc file. The only child it ever starts is the control holder of arm D, the starter of the detached probe
// and, through the starter, the probe itself.
//
// Redaction is structural: a report has typed fields only (numbers, booleans, short words, errno names, 8-hex-character digest
// prefixes and the decoded public claims of a token), so no function here can place a needle or a candidate text in a report.
// Needles travel on standard input, never on a command line or in a file.

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { closeSync, existsSync, openSync, readFileSync, readSync } from "node:fs";
import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { mintToken, TOKEN_CAPABILITIES } from "../../src/capability/token.js";
import { boundedWait, pollUntil } from "./timing.js";

// ---------------------------------------------------------------------------------------------------------------------------
// Constants.

export const CHUNK_BYTES = 1_048_576;
// D-35-03 names 512 bytes, which covers a Latin-1 token of the 512-character channel bound but not the same token in UTF-16LE
// (1024 bytes). The overlap is therefore 1280 bytes: the longest candidate this module reads (600 characters, 1200 bytes in
// UTF-16LE) and the longest needle it accepts (1024 bytes) both fit inside it, so a hit that starts in the owned part of a chunk
// always lies inside that chunk. A larger overlap only widens the coverage of the frozen design.
export const OVERLAP_BYTES = 1280;
export const STRIDE_BYTES = CHUNK_BYTES - OVERLAP_BYTES;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const DEFAULT_MAX_MS = 60_000;
export const CANDIDATE_CAP = 50;
const MAX_CANDIDATE_CHARS = 600;
const MAX_NEEDLES = 16;
const MAX_MARKERS = 16;
const MAX_TEXT_NEEDLE_CHARS = 512;
const MAX_NEEDLE_BYTES = 1024;
const MAX_CHAIN = 64;
const TOKEN_PREFIX_TEXT = "rcap1.";
const TOKEN_PREFIX_LATIN1 = Buffer.from(TOKEN_PREFIX_TEXT, "latin1");
const TOKEN_PREFIX_UTF16 = Buffer.from(TOKEN_PREFIX_TEXT, "utf16le");
const NEEDLE_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const MARKER_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const BASE64URL_TEXT = /^[A-Za-z0-9_-]+$/;
const YAMA_PATH = "/proc/sys/kernel/yama/ptrace_scope";

// ---------------------------------------------------------------------------------------------------------------------------
// Specification.

export type NeedleSpec =
  | { readonly kind: "text"; readonly name: string; readonly text: string }
  | { readonly kind: "bytes"; readonly name: string; readonly base64: string };

export interface TargetSpec {
  readonly kind: "target";
  readonly pid: number;
  readonly needles: readonly NeedleSpec[];
  readonly markers: readonly string[];
  readonly keyringPath?: string;
  readonly maxBytes?: number;
  readonly maxMs?: number;
}

export interface ControlSpec {
  readonly kind: "descendant-control";
  readonly maxBytes?: number;
  readonly maxMs?: number;
}

export type ProbeSpec = TargetSpec | ControlSpec;

// A specification the parser refused. It names the member and never carries a value.
export class SpecError extends Error {
  readonly member: string;

  constructor(member: string, reason: string, options?: ErrorOptions) {
    super(`specification member ${member}: ${reason}`, options);
    this.name = "SpecError";
    this.member = member;
  }
}

function safeName(name: string): string {
  return /^[A-Za-z0-9_]{1,40}$/.test(name) ? name : "?";
}

function recordOf(value: unknown, member: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SpecError(member, "not an object");
  }
  return value as Readonly<Record<string, unknown>>;
}

// Rejects any member outside the allowed set and any required member that is absent.
function checkMembers(record: Readonly<Record<string, unknown>>, required: readonly string[], optional: readonly string[], scope: string): void {
  for (const name of Object.keys(record)) {
    if (!required.includes(name) && !optional.includes(name)) {
      throw new SpecError(scope === "" ? safeName(name) : `${scope}.${safeName(name)}`, "not allowed");
    }
  }
  for (const name of required) {
    if (!(name in record)) {
      throw new SpecError(scope === "" ? name : `${scope}.${name}`, "missing");
    }
  }
}

function integerIn(value: unknown, member: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new SpecError(member, "not an integer in range");
  }
  return value;
}

function isPrintableAscii(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) {
      return false;
    }
  }
  return true;
}

function needleOf(value: unknown, index: number): NeedleSpec {
  const member = `needles[${String(index)}]`;
  const record = recordOf(value, member);
  const kind = record["kind"];
  if (kind === "text") {
    checkMembers(record, ["kind", "name", "text"], [], member);
    const { name, text } = record;
    if (typeof name !== "string" || !NEEDLE_NAME.test(name)) {
      throw new SpecError(`${member}.name`, "not a needle name");
    }
    if (typeof text !== "string" || text.length === 0 || text.length > MAX_TEXT_NEEDLE_CHARS || !isPrintableAscii(text)) {
      throw new SpecError(`${member}.text`, "not 1 to 512 printable ASCII characters");
    }
    return { kind: "text", name, text };
  }
  if (kind === "bytes") {
    checkMembers(record, ["kind", "name", "base64"], [], member);
    const { name, base64 } = record;
    if (typeof name !== "string" || !NEEDLE_NAME.test(name)) {
      throw new SpecError(`${member}.name`, "not a needle name");
    }
    if (typeof base64 !== "string") {
      throw new SpecError(`${member}.base64`, "not a string");
    }
    const decoded = Buffer.from(base64, "base64");
    if (decoded.length === 0 || decoded.length > MAX_NEEDLE_BYTES || decoded.toString("base64") !== base64) {
      throw new SpecError(`${member}.base64`, "not canonical base64 of 1 to 1024 bytes");
    }
    return { kind: "bytes", name, base64 };
  }
  throw new SpecError(`${member}.kind`, "not text or bytes");
}

function needlesOf(value: unknown): readonly NeedleSpec[] {
  if (!Array.isArray(value) || value.length > MAX_NEEDLES) {
    throw new SpecError("needles", "not a list of at most 16");
  }
  const items: readonly unknown[] = value;
  const needles = items.map((item, index) => needleOf(item, index));
  const names = new Set<string>();
  for (const needle of needles) {
    if (names.has(needle.name)) {
      throw new SpecError("needles", "a name repeats");
    }
    names.add(needle.name);
  }
  return needles;
}

function markersOf(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_MARKERS) {
    throw new SpecError("markers", "not a list of at most 16");
  }
  const items: readonly unknown[] = value;
  const markers: string[] = [];
  for (const item of items) {
    if (typeof item !== "string" || !MARKER_NAME.test(item) || markers.includes(item)) {
      throw new SpecError("markers", "not a list of distinct variable names");
    }
    markers.push(item);
  }
  return markers;
}

function boundsOf(record: Readonly<Record<string, unknown>>): { readonly maxBytes?: number; readonly maxMs?: number } {
  return {
    ...("maxBytes" in record ? { maxBytes: integerIn(record["maxBytes"], "maxBytes", 1, 2 ** 40) } : {}),
    ...("maxMs" in record ? { maxMs: integerIn(record["maxMs"], "maxMs", 1, 3_600_000) } : {}),
  };
}

// Parses and validates the text of a specification. A bad member throws a SpecError that names the member; no value is echoed.
export function parseSpec(text: string): ProbeSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    throw new SpecError("document", "not JSON", { cause: error });
  }
  const record = recordOf(parsed, "document");
  const kind = record["kind"];
  if (kind === "descendant-control") {
    checkMembers(record, ["kind"], ["maxBytes", "maxMs"], "");
    return { kind, ...boundsOf(record) };
  }
  if (kind !== "target") {
    throw new SpecError("kind", "not target or descendant-control");
  }
  checkMembers(record, ["kind", "pid", "needles", "markers"], ["keyringPath", "maxBytes", "maxMs"], "");
  const keyringPath = record["keyringPath"];
  if ("keyringPath" in record && (typeof keyringPath !== "string" || keyringPath.length === 0 || keyringPath.length > 4096 || keyringPath.includes("\u0000"))) {
    throw new SpecError("keyringPath", "not a path");
  }
  return {
    kind,
    pid: integerIn(record["pid"], "pid", 1, 2 ** 31 - 1),
    needles: needlesOf(record["needles"]),
    markers: markersOf(record["markers"]),
    ...(typeof keyringPath === "string" ? { keyringPath } : {}),
    ...boundsOf(record),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Maps.

export interface MapRegion {
  readonly start: number;
  readonly end: number;
  readonly perms: string;
  readonly path: string;
}

const MAPS_LINE = /^([0-9a-f]+)-([0-9a-f]+) (\S{4}) \S+ \S+ \S+ *(.*)$/;

// The private writable regions (permissions exactly rw-p) of a maps file, in file order. A zero-length region, a malformed line
// and a region beyond the safe integer range are skipped.
export function parseMaps(text: string): MapRegion[] {
  const regions: MapRegion[] = [];
  for (const line of text.split("\n")) {
    const match = MAPS_LINE.exec(line);
    if (match === null) {
      continue;
    }
    const [, from, to, perms, path] = match;
    if (from === undefined || to === undefined || perms !== "rw-p" || path === undefined) {
      continue;
    }
    const start = Number.parseInt(from, 16);
    const end = Number.parseInt(to, 16);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) {
      continue;
    }
    regions.push({ start, end, perms, path });
  }
  return regions;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Token shape and claims.

export type TextEncoding = "latin1" | "utf16le";

export interface ClaimsView {
  readonly host: string | null;
  readonly kid: string | null;
  readonly sidDigest: string | null;
  readonly exp: number | null;
}

export interface TokenCandidate {
  readonly encoding: TextEncoding;
  readonly length: number;
  readonly digest: string;
  readonly claims: ClaimsView;
}

const NO_CLAIMS: ClaimsView = Object.freeze({ host: null, kid: null, sidDigest: null, exp: null });
const PAYLOAD_KEYS = ["v", "kid", "sid", "host", "caps", "iat", "exp"] as const;

export function digestOf(text: string): string {
  return createHash("sha256").update(text, "latin1").digest("hex").slice(0, 8);
}

function jsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // A payload that is not JSON has no claims: the caller records null for each.
    return undefined;
  }
}

// The public claims of a payload part (base64url JSON with the seven keys of a token payload), or null for each.
function claimsOf(payloadPart: string): ClaimsView {
  if (!BASE64URL_TEXT.test(payloadPart)) {
    return NO_CLAIMS;
  }
  const parsed = jsonOrUndefined(Buffer.from(payloadPart, "base64url").toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return NO_CLAIMS;
  }
  const record = parsed as Readonly<Record<string, unknown>>;
  if (!PAYLOAD_KEYS.every((key) => key in record)) {
    return NO_CLAIMS;
  }
  const { host, kid, sid, exp } = record;
  return {
    host: typeof host === "string" && /^[a-z0-9-]{1,32}$/.test(host) ? host : null,
    kid: typeof kid === "string" && /^[a-z0-9]{1,16}$/.test(kid) ? kid : null,
    sidDigest: typeof sid === "string" && sid.length <= 256 ? digestOf(sid) : null,
    exp: typeof exp === "number" && Number.isSafeInteger(exp) ? exp : null,
  };
}

function isTokenChar(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x2d ||
    code === 0x5f ||
    code === 0x2e
  );
}

// The shape of src/audit/redact.ts and src/capability/token.ts: exactly three non-empty dot-separated parts, the first the prefix,
// the second and third at least 8 characters.
function candidateAt(buffer: Buffer, index: number, encoding: TextEncoding): TokenCandidate | null {
  const step = encoding === "latin1" ? 1 : 2;
  let text = "";
  for (let count = 0; count < MAX_CANDIDATE_CHARS; count += 1) {
    const at = index + count * step;
    const low = buffer[at];
    if (low === undefined || (step === 2 && buffer[at + 1] !== 0) || !isTokenChar(low)) {
      break;
    }
    text += String.fromCharCode(low);
  }
  const parts = text.split(".");
  const [prefix, payload, mac] = parts;
  if (parts.length !== 3 || prefix !== "rcap1" || payload === undefined || mac === undefined || payload.length < 8 || mac.length < 8) {
    return null;
  }
  return { encoding, length: text.length, digest: digestOf(text), claims: claimsOf(payload) };
}

function allIndexes(buffer: Buffer, pattern: Buffer, limit: number): number[] {
  const found: number[] = [];
  let from = 0;
  while (from < buffer.length) {
    const index = buffer.indexOf(pattern, from);
    if (index === -1 || index >= limit) {
      break;
    }
    found.push(index);
    from = index + 1;
  }
  return found;
}

// Every token-shaped candidate whose prefix starts before limit, in Latin-1 and in UTF-16LE, at any alignment.
export function findTokenCandidates(buffer: Buffer, limit: number = buffer.length): TokenCandidate[] {
  const candidates: TokenCandidate[] = [];
  for (const index of allIndexes(buffer, TOKEN_PREFIX_LATIN1, limit)) {
    const candidate = candidateAt(buffer, index, "latin1");
    if (candidate !== null) {
      candidates.push(candidate);
    }
  }
  for (const index of allIndexes(buffer, TOKEN_PREFIX_UTF16, limit)) {
    const candidate = candidateAt(buffer, index, "utf16le");
    if (candidate !== null) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Needles and scanning.

export type HitEncoding = "latin1" | "utf16le" | "raw";
export interface HitCounts {
  latin1: number;
  utf16le: number;
  raw: number;
}

export interface CompiledNeedle {
  readonly name: string;
  readonly patterns: readonly { readonly encoding: HitEncoding; readonly bytes: Buffer }[];
}

// The byte patterns of each needle: a text needle as Latin-1 and as UTF-16LE, a bytes needle raw.
export function compileNeedles(needles: readonly NeedleSpec[]): CompiledNeedle[] {
  return needles.map((needle) =>
    needle.kind === "text"
      ? {
          name: needle.name,
          patterns: [
            { encoding: "latin1", bytes: Buffer.from(needle.text, "latin1") },
            { encoding: "utf16le", bytes: Buffer.from(needle.text, "utf16le") },
          ],
        }
      : { name: needle.name, patterns: [{ encoding: "raw", bytes: Buffer.from(needle.base64, "base64") }] },
  );
}

export interface ScanBounds {
  readonly maxBytes: number;
  readonly maxMs: number;
}

// A read at an absolute address that returns what was read or throws an error with a code. The returned buffer is consumed
// before the next read, so an implementation may reuse one buffer.
export type ReadAt = (address: number, length: number) => Buffer;

export interface ScanResult {
  readonly regionsListed: number;
  readonly regionsRead: number;
  readonly regionsFailed: Readonly<Record<string, number>>;
  readonly regionsUnread: number;
  readonly chunksFailed: number;
  readonly bytesRead: number;
  readonly truncated: boolean;
  readonly needleHits: Readonly<Record<string, HitCounts>>;
  readonly candidateCount: number;
  readonly candidates: readonly TokenCandidate[];
  readonly candidatesTruncated: boolean;
}

// The errno name of an error, or UNKNOWN. Only a short upper-case code is ever kept.
export function errnoOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && /^E[A-Z0-9]{1,15}$/.test(error.code)) {
    return error.code;
  }
  return "UNKNOWN";
}

// Reads every region in chunks of CHUNK_BYTES that advance by STRIDE_BYTES, so consecutive chunks overlap by OVERLAP_BYTES. A hit
// belongs to the chunk in which it starts inside the first STRIDE_BYTES (or anywhere in the last chunk of a region), so it is
// counted once even when it lies in an overlap. A region ends read (every chunk read), failed (some chunk threw, counted under the
// errno of the first one; the scan continued with the next chunk) or unread (a bound stopped the scan first). The bounds are
// checked before each chunk.
export function scanRegions(
  regions: readonly MapRegion[],
  read: ReadAt,
  needles: readonly CompiledNeedle[],
  bounds: ScanBounds,
  now: () => number,
): ScanResult {
  const started = now();
  const hits = new Map<string, HitCounts>(needles.map((needle) => [needle.name, { latin1: 0, utf16le: 0, raw: 0 }]));
  const failed = new Map<string, number>();
  const candidates: TokenCandidate[] = [];
  let candidateCount = 0;
  let regionsRead = 0;
  let regionsUnread = 0;
  let chunksFailed = 0;
  let bytesRead = 0;
  let stopped = false;

  for (const region of regions) {
    if (stopped) {
      regionsUnread += 1;
      continue;
    }
    const length = region.end - region.start;
    let firstError: string | null = null;
    for (let offset = 0; offset < length; offset += STRIDE_BYTES) {
      if (bytesRead >= bounds.maxBytes || now() - started >= bounds.maxMs) {
        stopped = true;
        break;
      }
      const want = Math.min(CHUNK_BYTES, length - offset);
      const last = offset + want >= length;
      let chunk: Buffer | null = null;
      try {
        chunk = read(region.start + offset, want);
      } catch (error: unknown) {
        firstError ??= errnoOf(error);
        chunksFailed += 1;
      }
      if (chunk !== null) {
        bytesRead += chunk.length;
        const limit = last ? chunk.length : STRIDE_BYTES;
        for (const needle of needles) {
          const counts = hits.get(needle.name);
          if (counts === undefined) {
            continue;
          }
          for (const pattern of needle.patterns) {
            counts[pattern.encoding] += allIndexes(chunk, pattern.bytes, limit).length;
          }
        }
        for (const candidate of findTokenCandidates(chunk, limit)) {
          candidateCount += 1;
          if (candidates.length < CANDIDATE_CAP) {
            candidates.push(candidate);
          }
        }
      }
      if (last) {
        break;
      }
    }
    if (stopped) {
      regionsUnread += 1;
    } else if (firstError !== null) {
      failed.set(firstError, (failed.get(firstError) ?? 0) + 1);
    } else {
      regionsRead += 1;
    }
  }

  return {
    regionsListed: regions.length,
    regionsRead,
    regionsFailed: Object.fromEntries(failed),
    regionsUnread,
    chunksFailed,
    bytesRead,
    truncated: stopped,
    needleHits: Object.fromEntries(hits),
    candidateCount,
    candidates,
    candidatesTruncated: candidateCount > candidates.length,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The report.

export type ReadState = "readable" | "not-asked" | `denied:${string}`;
export type OpenState = "ok" | "not-asked" | `denied:${string}`;

export interface MemReport {
  readonly open: OpenState;
  readonly maps: "read" | "not-asked" | `denied:${string}`;
  readonly regionsListed: number;
  readonly regionsRead: number;
  readonly regionsFailed: Readonly<Record<string, number>>;
  readonly regionsUnread: number;
  readonly chunksFailed: number;
  readonly bytesRead: number;
  readonly truncated: boolean;
  readonly needleHits: Readonly<Record<string, HitCounts>>;
  readonly tokenCandidateCount: number;
  readonly tokenCandidates: readonly TokenCandidate[];
  readonly candidatesTruncated: boolean;
}

export interface ProbeReport {
  readonly schema: 1;
  readonly probeUid: number;
  readonly ptraceScope: string;
  readonly targetGone: boolean;
  readonly probeChain: readonly number[];
  readonly targetChain: readonly number[];
  readonly probeIsAncestorOfTarget: boolean;
  readonly target: { readonly status: ReadState; readonly uid: number | null; readonly tracerPid: number | null };
  readonly environ: { readonly read: ReadState; readonly markers: Readonly<Record<string, boolean>>; readonly tokenShapes: number };
  readonly mem: MemReport;
  readonly keyFile: ReadState;
  // The 8-hex digest of the synthetic token of the descendant control, null for every other probe.
  readonly controlDigest: string | null;
  readonly elapsedMs: number;
}

const NOT_ASKED_MEM: MemReport = Object.freeze({
  open: "not-asked",
  maps: "not-asked",
  regionsListed: 0,
  regionsRead: 0,
  regionsFailed: Object.freeze({}),
  regionsUnread: 0,
  chunksFailed: 0,
  bytesRead: 0,
  truncated: false,
  needleHits: Object.freeze({}),
  tokenCandidateCount: 0,
  tokenCandidates: Object.freeze([]),
  candidatesTruncated: false,
});

export function isProbeReport(value: unknown): value is ProbeReport {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return record["schema"] === 1 && typeof record["mem"] === "object" && record["mem"] !== null && typeof record["environ"] === "object" && record["environ"] !== null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The probe's reads.

export interface MemHandle {
  read: ReadAt;
  close(): void;
}

// What the probe touches. The default reads the real /proc; the unit tests inject a fake.
export interface ProcIo {
  readonly pid: number;
  readonly uid: number;
  now(): number;
  readFile(path: string): Buffer;
  openMem(path: string): MemHandle;
  // Opens a file read-only and closes it again, throwing the error the open produced. It reads no byte.
  canOpen(path: string): void;
}

export function realIo(): ProcIo {
  return {
    pid: process.pid,
    uid: process.getuid?.() ?? -1,
    now: () => performance.now(),
    readFile: (path) => readFileSync(path),
    openMem: (path) => {
      const fd = openSync(path, "r");
      const scratch = Buffer.allocUnsafe(CHUNK_BYTES);
      return {
        read: (address, length) => {
          const count = readSync(fd, scratch, 0, length, address);
          return scratch.subarray(0, count);
        },
        close: () => {
          closeSync(fd);
        },
      };
    },
    canOpen: (path) => {
      closeSync(openSync(path, "r"));
    },
  };
}

function denied(error: unknown): `denied:${string}` {
  return `denied:${errnoOf(error)}`;
}

function ptraceScopeOf(io: ProcIo): string {
  try {
    const text = io.readFile(YAMA_PATH).toString("utf8").trim();
    return /^[0-9]{1,2}$/.test(text) ? text : "unexpected";
  } catch (error: unknown) {
    return `unreadable:${errnoOf(error)}`;
  }
}

// The pids from a process up to 1, following the parent field of /proc/PID/stat.
function chainOf(io: ProcIo, pid: number): number[] {
  const chain: number[] = [];
  let current = pid;
  while (chain.length < MAX_CHAIN) {
    chain.push(current);
    if (current <= 1) {
      break;
    }
    let parent: number;
    try {
      const text = io.readFile(`/proc/${String(current)}/stat`).toString("latin1");
      const rest = text.slice(text.lastIndexOf(")") + 2).split(" ");
      parent = Number(rest[1]);
    } catch {
      // The chain ends where /proc stops answering; what was read so far is the record.
      break;
    }
    if (!Number.isSafeInteger(parent) || parent < 0 || parent === current) {
      break;
    }
    current = parent;
  }
  return chain;
}

function numberAfter(status: string, field: string): number | null {
  const line = status.split("\n").find((entry) => entry.startsWith(`${field}:`));
  if (line === undefined) {
    return null;
  }
  const value = Number(line.slice(field.length + 1).trim().split(/\s+/)[0]);
  return Number.isSafeInteger(value) ? value : null;
}

function environOf(io: ProcIo, pid: number, markers: readonly string[]): ProbeReport["environ"] {
  let data: Buffer;
  try {
    data = io.readFile(`/proc/${String(pid)}/environ`);
  } catch (error: unknown) {
    return { read: denied(error), markers: {}, tokenShapes: 0 };
  }
  const names = new Set(
    data
      .toString("latin1")
      .split("\u0000")
      .map((entry) => (entry.includes("=") ? entry.slice(0, entry.indexOf("=")) : entry)),
  );
  return {
    read: "readable",
    markers: Object.fromEntries(markers.map((name) => [name, names.has(name)])),
    tokenShapes: findTokenCandidates(data).length,
  };
}

function memOf(io: ProcIo, pid: number, needles: readonly CompiledNeedle[], bounds: ScanBounds): MemReport {
  let handle: MemHandle | null = null;
  let open: OpenState;
  try {
    handle = io.openMem(`/proc/${String(pid)}/mem`);
    open = "ok";
  } catch (error: unknown) {
    open = denied(error);
  }
  let regions: MapRegion[] = [];
  let maps: MemReport["maps"];
  try {
    regions = parseMaps(io.readFile(`/proc/${String(pid)}/maps`).toString("utf8"));
    maps = "read";
  } catch (error: unknown) {
    maps = denied(error);
  }
  if (handle === null) {
    // Nothing was read: every listed region is unread, and no bound stopped the scan.
    return { ...NOT_ASKED_MEM, open, maps, regionsListed: regions.length, regionsUnread: regions.length };
  }
  try {
    const result = scanRegions(regions, handle.read, needles, bounds, () => io.now());
    return {
      open,
      maps,
      regionsListed: result.regionsListed,
      regionsRead: result.regionsRead,
      regionsFailed: result.regionsFailed,
      regionsUnread: result.regionsUnread,
      chunksFailed: result.chunksFailed,
      bytesRead: result.bytesRead,
      truncated: result.truncated,
      needleHits: result.needleHits,
      tokenCandidateCount: result.candidateCount,
      tokenCandidates: result.candidates,
      candidatesTruncated: result.candidatesTruncated,
    };
  } finally {
    handle.close();
  }
}

function keyFileOf(io: ProcIo, path: string | undefined): ReadState {
  if (path === undefined) {
    return "not-asked";
  }
  try {
    io.canOpen(path);
    return "readable";
  } catch (error: unknown) {
    return denied(error);
  }
}

// Probes one process: the Yama setting, the parent chains, the status, the environment, the whole private writable memory and
// the readability of the keyring file. Never writes to the target, never attaches, never signals. A denied read is a result
// recorded under its errno name; a pid that is not alive reports target gone and nothing else.
export function probeProcess(spec: TargetSpec, io: ProcIo = realIo()): ProbeReport {
  const started = io.now();
  const needles = compileNeedles(spec.needles);
  const bounds: ScanBounds = { maxBytes: spec.maxBytes ?? DEFAULT_MAX_BYTES, maxMs: spec.maxMs ?? DEFAULT_MAX_MS };
  const base = {
    schema: 1 as const,
    probeUid: io.uid,
    ptraceScope: ptraceScopeOf(io),
    probeChain: chainOf(io, io.pid),
    controlDigest: null,
  };

  let statusText: string | null = null;
  let statusState: ReadState;
  let gone = false;
  try {
    statusText = io.readFile(`/proc/${String(spec.pid)}/status`).toString("utf8");
    statusState = "readable";
  } catch (error: unknown) {
    const code = errnoOf(error);
    gone = code === "ENOENT" || code === "ESRCH";
    statusState = denied(error);
  }
  if (gone) {
    return {
      ...base,
      targetGone: true,
      targetChain: [],
      probeIsAncestorOfTarget: false,
      target: { status: statusState, uid: null, tracerPid: null },
      environ: { read: "not-asked", markers: {}, tokenShapes: 0 },
      mem: NOT_ASKED_MEM,
      keyFile: "not-asked",
      elapsedMs: Math.round(io.now() - started),
    };
  }
  const targetChain = chainOf(io, spec.pid);
  return {
    ...base,
    targetGone: false,
    targetChain,
    probeIsAncestorOfTarget: targetChain.slice(1).includes(io.pid),
    target: {
      status: statusState,
      uid: statusText === null ? null : numberAfter(statusText, "Uid"),
      tracerPid: statusText === null ? null : numberAfter(statusText, "TracerPid"),
    },
    environ: environOf(io, spec.pid, spec.markers),
    mem: memOf(io, spec.pid, needles, bounds),
    keyFile: keyFileOf(io, spec.keyringPath),
    elapsedMs: Math.round(io.now() - started),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The verdict rule (D-35-03, frozen before any run).

export type SubjectOutcome = "denied-at-open" | "absent-complete" | "found" | "incomplete";
export type ControlOutcome = "found" | "not-found";
export type Verdict = "settled" | "refuted" | "inconclusive";

// Did the report find the named needle, or a token candidate with the given 8-hex digest?
function foundIn(report: ProbeReport, needleNames: readonly string[], digest: string | null): boolean {
  const byNeedle = needleNames.some((name) => {
    const counts = report.mem.needleHits[name];
    return counts !== undefined && counts.latin1 + counts.utf16le + counts.raw > 0;
  });
  const byDigest = digest !== null && report.mem.tokenCandidates.some((candidate) => candidate.digest === digest);
  return byNeedle || byDigest;
}

// Arm N. found: a needle or the token's candidate was read from memory. denied-at-open: the open of the mem file was refused.
// absent-complete: the open worked, coverage is complete and nothing was found. incomplete: anything else (maps unreadable, a
// bound stopped the scan, a region unread).
export function subjectOutcomeOf(report: ProbeReport, needleNames: readonly string[], digest: string | null): SubjectOutcome {
  if (foundIn(report, needleNames, digest)) {
    return "found";
  }
  if (report.mem.open !== "ok") {
    return report.mem.open.startsWith("denied:") ? "denied-at-open" : "incomplete";
  }
  const failedRegions = Object.values(report.mem.regionsFailed).reduce((sum, count) => sum + count, 0);
  const complete =
    report.mem.maps === "read" &&
    !report.mem.truncated &&
    report.mem.regionsUnread === 0 &&
    report.mem.regionsListed > 0 &&
    report.mem.regionsListed === report.mem.regionsRead + failedRegions;
  return complete ? "absent-complete" : "incomplete";
}

// Arms D and R: the control found what it is allowed to read, or it did not.
export function controlOutcomeOf(report: ProbeReport, needleNames: readonly string[], digest: string | null): ControlOutcome {
  return foundIn(report, needleNames, digest) ? "found" : "not-found";
}

// The decision rule. refuted: N found. settled: N denied at open or complete with zero hits, and controls D and R both found.
// inconclusive: anything else (a control did not find, or coverage in N was incomplete without being a find).
export function verdictOf(subject: SubjectOutcome, descendant: ControlOutcome, root: ControlOutcome): Verdict {
  if (subject === "found") {
    return "refuted";
  }
  if ((subject === "denied-at-open" || subject === "absent-complete") && descendant === "found" && root === "found") {
    return "settled";
  }
  return "inconclusive";
}

// ---------------------------------------------------------------------------------------------------------------------------
// The detached starter.

// A short-lived node process that starts the probe entry detached (so the probe is reparented and is no descendant of the
// caller) with the specification on the probe's standard input and its standard error in a file beside the result, prints the
// probe's pid and exits.
const STARTER_PROGRAM = [
  'const { spawn } = require("node:child_process");',
  'const { openSync, closeSync } = require("node:fs");',
  "const [entry, result] = process.argv.slice(1);",
  "const chunks = [];",
  'process.stdin.on("data", (chunk) => chunks.push(chunk));',
  'process.stdin.on("end", () => {',
  '  const err = openSync(result + ".err", "w", 0o600);',
  '  const child = spawn(process.execPath, [entry, result], { detached: true, stdio: ["pipe", "ignore", err] });',
  "  closeSync(err);",
  '  process.stdout.write(String(child.pid) + "\\n");',
  "  child.unref();",
  "  child.stdin.end(Buffer.concat(chunks), () => process.exit(0));",
  "});",
].join("\n");

function stageError(stage: string, detail: string, cause?: unknown): Error {
  return new Error(`memory probe: ${stage}: ${detail}`, cause === undefined ? undefined : { cause });
}

// Starts the probe entry as a process that is no descendant of the caller, hands it the specification on standard input, and
// returns the report it wrote to resultPath. Never hangs: the starter, the result file and the probe's own bounds are waited for
// with bounds, and an error names the stage.
export async function startNonDescendantProbe(entryPath: string, spec: ProbeSpec, resultPath: string, timeoutMs?: number): Promise<ProbeReport> {
  const bound = timeoutMs ?? (spec.maxMs ?? DEFAULT_MAX_MS) + 60_000;
  const starter = spawn(process.execPath, ["--input-type=commonjs", "-e", STARTER_PROGRAM, entryPath, resultPath], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  let pidText = "";
  starter.stdout.on("data", (chunk: Buffer) => {
    pidText += chunk.toString("utf8");
  });
  const closed = once(starter, "close");
  const written = new Promise<void>((resolve, reject) => {
    starter.stdin.on("error", reject);
    starter.stdin.end(JSON.stringify(spec), () => {
      resolve();
    });
  });
  let exitCode: number | null;
  try {
    await boundedWait(written, "the specification reaching the probe starter", 15_000);
    [exitCode] = (await boundedWait(closed, "the probe starter closing", 15_000)) as [number | null];
  } catch (error: unknown) {
    throw stageError("starter", "did not exit in time", error);
  }
  const probePid = pidText.trim();
  if (exitCode !== 0) {
    throw stageError("starter", `exited with code ${String(exitCode)}`);
  }
  try {
    await pollUntil(() => existsSync(resultPath), "the probe wrote its report", { timeoutMs: bound, intervalMs: 50 });
  } catch (error: unknown) {
    let errText = "";
    try {
      errText = readFileSync(`${resultPath}.err`, "utf8").trim().slice(0, 200);
    } catch {
      // No error file: the probe never started or wrote nothing.
    }
    throw stageError("result file", `no report from probe pid ${probePid === "" ? "unknown" : probePid}${errText === "" ? "" : `; probe said: ${errText}`}`, error);
  }
  const parsed: unknown = JSON.parse(readFileSync(resultPath, "utf8"));
  if (!isProbeReport(parsed)) {
    throw stageError("result file", "not a probe report");
  }
  return parsed;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The descendant control (arm D).

// A holder that receives one synthetic token line on standard input, keeps it in a variable (a flat copy in the heap and the
// received chunk), prints ready, and exits when standard input ends. Its environment holds one marker variable.
const HOLDER_PROGRAM = [
  "let held = null;",
  'let received = "";',
  'process.stdin.setEncoding("latin1");',
  'process.stdin.on("data", (chunk) => {',
  "  received += chunk;",
  '  const end = received.indexOf("\\n");',
  "  if (end >= 0 && held === null) {",
  '    held = Buffer.from(received.slice(0, end), "latin1").toString("latin1");',
  '    process.stdout.write("ready\\n");',
  "  }",
  "});",
  'process.stdin.on("end", () => process.exit(0));',
  "",
].join("\n");

export const CONTROL_MARKER = "REALM_PROBE_CONTROL_MARKER";
export const CONTROL_NEEDLE = "synthetic";

// Arm D, run inside the probe process: mints a synthetic token with a random throwaway key, starts the holder as its own child
// (so it is the holder's ancestor, which Yama allows), runs the target probe against the holder with the synthetic token as a
// needle, kills the holder and returns the report with the digest of the synthetic token.
export async function runControlDescendant(bounds: { readonly maxBytes?: number; readonly maxMs?: number } = {}): Promise<ProbeReport> {
  const iat = Math.floor(Date.now() / 1000);
  const token = mintToken(randomBytes(32), { kid: "k1", sid: `probe-${randomBytes(6).toString("hex")}`, host: "claude", caps: TOKEN_CAPABILITIES, iat, exp: iat + 3600 });
  const holder = spawn(process.execPath, ["-e", HOLDER_PROGRAM], {
    env: { [CONTROL_MARKER]: "1" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  try {
    const ready = new Promise<void>((resolve, reject) => {
      holder.once("error", reject);
      holder.stdin.on("error", reject);
      holder.once("exit", () => {
        reject(new Error("the control holder exited before it was ready"));
      });
      holder.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString("utf8").includes("ready")) {
          resolve();
        }
      });
    });
    holder.stdin.write(`${token}\n`);
    await boundedWait(ready, "the control holder ready line", 15_000);
    const pid = holder.pid;
    if (pid === undefined) {
      throw stageError("control", "the holder has no pid");
    }
    const report = probeProcess({
      kind: "target",
      pid,
      needles: [{ kind: "text", name: CONTROL_NEEDLE, text: token }],
      markers: [CONTROL_MARKER],
      ...(bounds.maxBytes === undefined ? {} : { maxBytes: bounds.maxBytes }),
      ...(bounds.maxMs === undefined ? {} : { maxMs: bounds.maxMs }),
    });
    return { ...report, controlDigest: digestOf(token) };
  } finally {
    // The holder exits by itself when its standard input ends; the kill is the fallback and the holder is the only process killed.
    const exited: Promise<unknown> = holder.exitCode !== null || holder.signalCode !== null ? Promise.resolve() : once(holder, "exit");
    holder.stdin.end();
    try {
      await boundedWait(exited, "the control holder exiting", 3_000);
    } catch {
      // It did not leave on end of input: kill it and wait once more.
      holder.kill("SIGKILL");
      await boundedWait(once(holder, "exit"), "the control holder exiting after a kill", 10_000);
    }
  }
}
