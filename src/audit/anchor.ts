// Devnet anchoring of one session's audit-log root (H1). The audit log is read by the caller; this module
// hashes its lines into a Merkle root, encodes an anchor record as a Solana Memo, and publishes that memo in
// a legacy transaction signed with an Ed25519 key. Only the record (session id, line count, root, time) is
// ever published, never audit content. Node builtins only; no process.env (the CLI entry edge reads it).

import { Buffer } from "node:buffer";
import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign, timingSafeEqual } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

export class AnchorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorError";
  }
}

export const ANCHOR_RECORD_VERSION = 1;
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const MEMO_MAX_BYTES = 566;

const DEFAULT_RPC_TIMEOUT_MS = 15_000;
const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);
// PKCS#8 DER prefix of an Ed25519 private key; the 32-byte seed follows.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BIG_ZERO = BigInt(0);
const BIG_BASE = BigInt(58);
const BIG_BYTE = BigInt(256);

export interface AnchorRecord {
  readonly version: typeof ANCHOR_RECORD_VERSION;
  readonly sessionId: string;
  readonly lineCount: number;
  // 64 lowercase hex characters.
  readonly rootSha256: string;
  // ISO-8601 UTC.
  readonly createdAt: string;
}

export interface Ed25519Signer {
  readonly publicKey: Uint8Array;
  sign(message: Uint8Array): Uint8Array;
}

export interface AnchorRpc {
  call(method: string, params: readonly unknown[]): Promise<unknown>;
}

function sha256(...parts: readonly Uint8Array[]): Uint8Array {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
  }
  return hash.digest();
}

// Splits audit-log bytes on "\n", dropping one trailing empty segment. Each element is one line without its newline.
export function splitAuditLines(content: Uint8Array): Uint8Array[] {
  const lines: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === 0x0a) {
      lines.push(content.subarray(start, i));
      start = i + 1;
    }
  }
  if (start < content.length) {
    lines.push(content.subarray(start));
  }
  return lines;
}

function parentLevel(level: readonly Uint8Array[]): Uint8Array[] {
  const next: Uint8Array[] = [];
  for (let i = 0; i < level.length; i += 2) {
    const left = level[i];
    const right = level[i + 1];
    if (left === undefined) {
      break;
    }
    // An unpaired node is promoted unchanged.
    next.push(right === undefined ? left : sha256(NODE_PREFIX, left, right));
  }
  return next;
}

// Leaf = SHA-256(0x00 || line); parent = SHA-256(0x01 || left || right). Empty input is an error.
export function merkleRoot(lines: readonly Uint8Array[]): Uint8Array {
  if (lines.length === 0) {
    throw new AnchorError("cannot anchor an empty audit log");
  }
  let level: Uint8Array[] = lines.map((line) => sha256(LEAF_PREFIX, line));
  while (level.length > 1) {
    level = parentLevel(level);
  }
  const root = level[0];
  if (root === undefined) {
    throw new AnchorError("merkle root computation produced no node");
  }
  return root;
}

export function buildAnchorRecord(input: {
  readonly sessionId: string;
  readonly lines: readonly Uint8Array[];
  readonly createdAt: Date;
}): AnchorRecord {
  if (Number.isNaN(input.createdAt.getTime())) {
    throw new AnchorError("anchor time is not a valid date");
  }
  return {
    version: ANCHOR_RECORD_VERSION,
    sessionId: input.sessionId,
    lineCount: input.lines.length,
    rootSha256: Buffer.from(merkleRoot(input.lines)).toString("hex"),
    createdAt: input.createdAt.toISOString(),
  };
}

// Canonical single-line JSON with a fixed key order. Over MEMO_MAX_BYTES is an error.
export function encodeMemo(record: AnchorRecord): string {
  const memo = JSON.stringify({
    version: record.version,
    sessionId: record.sessionId,
    lineCount: record.lineCount,
    rootSha256: record.rootSha256,
    createdAt: record.createdAt,
  });
  if (Buffer.byteLength(memo, "utf8") > MEMO_MAX_BYTES) {
    throw new AnchorError(`anchor memo exceeds ${String(MEMO_MAX_BYTES)} bytes`);
  }
  return memo;
}

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) {
    zeros += 1;
  }
  let value = bytes.reduce((acc, byte) => acc * BIG_BYTE + BigInt(byte), BIG_ZERO);
  let digits = "";
  while (value > BIG_ZERO) {
    const remainder = Number(value % BIG_BASE);
    value /= BIG_BASE;
    digits = BASE58_ALPHABET.charAt(remainder) + digits;
  }
  return "1".repeat(zeros) + digits;
}

export function base58Decode(text: string): Uint8Array {
  let zeros = 0;
  while (zeros < text.length && text.charAt(zeros) === "1") {
    zeros += 1;
  }
  let value = BIG_ZERO;
  for (const char of text) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new AnchorError("base58 text contains an invalid character");
    }
    value = value * BIG_BASE + BigInt(index);
  }
  let hex = value === BIG_ZERO ? "" : value.toString(16);
  if (hex.length % 2 === 1) {
    hex = `0${hex}`;
  }
  return Buffer.concat([Buffer.alloc(zeros), Buffer.from(hex, "hex")]);
}

export function encodeCompactU16(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new AnchorError("compact-u16 value is outside 0..65535");
  }
  const out: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  out.push(rest);
  return Uint8Array.from(out);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isByte(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
}

// A path that may not exist yet: realpath when it exists, otherwise the absolute form.
function canonicalPath(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

// Loads a Solana CLI keypair file (64 integers: 32-byte seed then 32-byte public key). Refuses a file that is
// not a regular file, has any group or other permission bit, lies inside the state directory, or whose public
// half does not match the seed. Error messages never include key bytes.
export function loadAnchorKey(input: { readonly keyFile: string; readonly stateDir: string }): Ed25519Signer {
  if (!isAbsolute(input.keyFile)) {
    throw new AnchorError("anchor key file path must be absolute");
  }
  if (!existsSync(input.keyFile)) {
    throw new AnchorError("anchor key file does not exist");
  }
  const stat = lstatSync(input.keyFile);
  if (!stat.isFile()) {
    throw new AnchorError("anchor key file must be a regular file (not a link, directory or device)");
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new AnchorError("anchor key file must not be readable by group or others (use mode 0600)");
  }
  const realKey = realpathSync(input.keyFile);
  const stateRoot = canonicalPath(input.stateDir);
  const statePrefix = stateRoot.endsWith(sep) ? stateRoot : `${stateRoot}${sep}`;
  if (realKey === stateRoot || realKey.startsWith(statePrefix)) {
    throw new AnchorError("anchor key file must not be inside the state directory");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(realKey, "utf8"));
  } catch {
    throw new AnchorError("anchor key file is not a valid keypair JSON document");
  }
  if (!Array.isArray(parsed) || parsed.length !== 64 || !parsed.every(isByte)) {
    throw new AnchorError("anchor key file must hold 64 byte values (seed then public key)");
  }
  const bytes = Uint8Array.from(parsed);
  const seed = bytes.subarray(0, 32);
  const storedPublic = bytes.subarray(32);

  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  // The SPKI DER of an Ed25519 key ends with its 32-byte public key.
  const derivedPublic = Buffer.from(createPublicKey(privateKey).export({ format: "der", type: "spki" })).subarray(-32);
  if (!timingSafeEqual(derivedPublic, storedPublic)) {
    throw new AnchorError("anchor key file public half does not match its seed");
  }
  return {
    publicKey: derivedPublic,
    sign: (message) => cryptoSign(null, message, privateKey),
  };
}

// Legacy message: header [1,0,1]; keys [payer, memo program]; one instruction, program index 1, accounts [0],
// data = memo UTF-8. Wire = compact-u16(1) || 64-byte signature || message.
export function buildMemoTransaction(input: {
  readonly payer: Uint8Array;
  readonly recentBlockhash: Uint8Array;
  readonly memo: string;
  readonly signer: Ed25519Signer;
}): Uint8Array {
  if (input.payer.length !== 32) {
    throw new AnchorError("payer public key must be 32 bytes");
  }
  if (!Buffer.from(input.payer).equals(input.signer.publicKey)) {
    throw new AnchorError("payer must be the signing key's public key");
  }
  if (input.recentBlockhash.length !== 32) {
    throw new AnchorError("recent blockhash must be 32 bytes");
  }
  const memoBytes = Buffer.from(input.memo, "utf8");
  if (memoBytes.length > MEMO_MAX_BYTES) {
    throw new AnchorError(`memo exceeds ${String(MEMO_MAX_BYTES)} bytes`);
  }
  const memoProgram = base58Decode(MEMO_PROGRAM_ID);
  const message = Buffer.concat([
    Buffer.from([1, 0, 1]),
    encodeCompactU16(2),
    input.payer,
    memoProgram,
    input.recentBlockhash,
    encodeCompactU16(1),
    Buffer.from([1]),
    encodeCompactU16(1),
    Buffer.from([0]),
    encodeCompactU16(memoBytes.length),
    memoBytes,
  ]);
  const signature = input.signer.sign(message);
  if (signature.length !== 64) {
    throw new AnchorError("signer must return a 64-byte Ed25519 signature");
  }
  return Buffer.concat([encodeCompactU16(1), signature, message]);
}

// JSON-RPC 2.0 over HTTP POST. Transport failures and RPC errors become AnchorError.
export function createJsonRpc(input: {
  readonly url: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}): AnchorRpc {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  return {
    async call(method, params) {
      let response: Response;
      try {
        response = await fetchImpl(input.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new AnchorError(`RPC ${method} request failed or timed out`);
      }
      if (!response.ok) {
        throw new AnchorError(`RPC ${method} failed with HTTP ${String(response.status)}`);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new AnchorError(`RPC ${method} returned a body that is not JSON`);
      }
      if (!isRecord(body)) {
        throw new AnchorError(`RPC ${method} returned a non-object reply`);
      }
      if (body["error"] !== undefined) {
        const error = body["error"];
        const message = isRecord(error) && typeof error["message"] === "string" ? error["message"] : "unknown error";
        throw new AnchorError(`RPC ${method} error: ${message}`);
      }
      if (!("result" in body)) {
        throw new AnchorError(`RPC ${method} reply has no result`);
      }
      return body["result"];
    },
  };
}

function blockhashOf(value: unknown): string {
  if (isRecord(value) && isRecord(value["value"]) && typeof value["value"]["blockhash"] === "string") {
    return value["value"]["blockhash"];
  }
  throw new AnchorError("getLatestBlockhash reply carries no blockhash");
}

// Checks the cluster genesis hash before any send; a mismatch throws and sends nothing.
export async function publishAnchor(input: {
  readonly rpc: AnchorRpc;
  readonly signer: Ed25519Signer;
  readonly record: AnchorRecord;
  readonly expectedGenesisHash: string;
}): Promise<{ signature: string; memo: string }> {
  const genesis = await input.rpc.call("getGenesisHash", []);
  if (genesis !== input.expectedGenesisHash) {
    throw new AnchorError("refusing to publish: the endpoint's genesis hash is not the expected cluster; nothing was sent");
  }
  const latest = await input.rpc.call("getLatestBlockhash", [{ commitment: "finalized" }]);
  const memo = encodeMemo(input.record);
  const transaction = buildMemoTransaction({
    payer: input.signer.publicKey,
    recentBlockhash: base58Decode(blockhashOf(latest)),
    memo,
    signer: input.signer,
  });
  const sent = await input.rpc.call("sendTransaction", [
    Buffer.from(transaction).toString("base64"),
    { encoding: "base64", preflightCommitment: "confirmed" },
  ]);
  if (typeof sent !== "string") {
    throw new AnchorError("sendTransaction did not return a signature");
  }
  return { signature: sent, memo };
}
