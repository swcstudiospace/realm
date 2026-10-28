// Anchor module tests (H1). Expected values are pinned constants from the design or independent
// node:crypto computations; no test reaches the network. Keys are generated into os.tmpdir()
// directories that are removed when the file's tests finish.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ANCHOR_RECORD_VERSION,
  AnchorError,
  DEVNET_GENESIS_HASH,
  MEMO_MAX_BYTES,
  MEMO_PROGRAM_ID,
  base58Decode,
  base58Encode,
  buildAnchorRecord,
  buildMemoTransaction,
  createJsonRpc,
  encodeCompactU16,
  encodeMemo,
  loadAnchorKey,
  merkleRoot,
  publishAnchor,
  type AnchorRecord,
  type AnchorRpc,
  type Ed25519Signer,
} from "../../src/audit/anchor.js";
import { ERROR_CODES, type ErrorCode } from "../../src/core/errors.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SESSION = "11111111-2222-4333-8444-555555555555";
const SIGNATURE = "signature-returned-by-fake-rpc";
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const BLOCKHASH_BYTES = new Uint8Array(32).fill(7);
const BLOCKHASH = base58Encode(BLOCKHASH_BYTES);

const tempDirs: string[] = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "realm-anchor-"));
  tempDirs.push(dir);
  return dir;
}

// Independent SHA-256 helpers. The leaf and node prefixes are the H1 domain separators (0x00, 0x01).
function sha256(...parts: Uint8Array[]): Uint8Array {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}

function leaf(line: Uint8Array): Uint8Array {
  return sha256(Uint8Array.of(0x00), line);
}

function node(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(Uint8Array.of(0x01), left, right);
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function byteAt(bytes: Uint8Array, index: number): number {
  const value = bytes[index];
  assert.ok(value !== undefined, `byte ${String(index)} exists`);
  return value;
}

const A = encoder.encode("alpha");
const B = encoder.encode("bravo");
const C = encoder.encode("charlie");
const D = encoder.encode("delta");

const SAMPLE_ROOT = hex(node(node(leaf(A), leaf(B)), leaf(C)));
const SAMPLE_RECORD: AnchorRecord = {
  version: 1,
  sessionId: SESSION,
  lineCount: 3,
  rootSha256: SAMPLE_ROOT,
  createdAt: "2026-10-23T12:00:00.000Z",
};
const SAMPLE_MEMO = `{"version":1,"sessionId":"${SESSION}","lineCount":3,"rootSha256":"${SAMPLE_ROOT}","createdAt":"2026-10-23T12:00:00.000Z"}`;

interface TestKey {
  readonly seed: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly privateKey: KeyObject;
  readonly publicKeyObject: KeyObject;
}

// Generates an Ed25519 key pair. The seed is the last 32 bytes of the PKCS#8 DER, and the raw public
// key is the last 32 bytes of the SPKI DER.
function newTestKey(): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
  const spki = publicKey.export({ format: "der", type: "spki" });
  return {
    seed: new Uint8Array(pkcs8.subarray(pkcs8.length - 32)),
    publicKey: new Uint8Array(spki.subarray(spki.length - 32)),
    privateKey,
    publicKeyObject: publicKey,
  };
}

function testSigner(key: TestKey): Ed25519Signer {
  return {
    publicKey: key.publicKey,
    sign: (message) => new Uint8Array(cryptoSign(null, message, key.privateKey)),
  };
}

// Writes a Solana-CLI-style keypair file (64 integers) and sets its mode exactly.
function writeKeyFile(dir: string, key: TestKey, mode: number, publicHalf: Uint8Array = key.publicKey): string {
  const path = join(dir, "anchor-key.json");
  writeFileSync(path, JSON.stringify([...key.seed, ...publicHalf]));
  chmodSync(path, mode);
  return path;
}

interface KeyDirs {
  readonly stateDir: string;
  readonly keyDir: string;
}

function keyDirs(): KeyDirs {
  const root = makeTempDir();
  const stateDir = join(root, "state");
  const keyDir = join(root, "keys");
  mkdirSync(stateDir);
  mkdirSync(keyDir);
  return { stateDir, keyDir };
}

// Independent wire parser for the single-signer legacy transaction H1 builds. Compact-u16 lengths are
// decoded here, not with the module's encoder, so the layout is checked from the bytes.
interface ParsedTransaction {
  readonly signature: Uint8Array;
  readonly message: Uint8Array;
  readonly header: readonly number[];
  readonly accountKeys: readonly Uint8Array[];
  readonly blockhash: Uint8Array;
  readonly instructionCount: number;
  readonly programIdIndex: number;
  readonly instructionAccounts: readonly number[];
  readonly data: Uint8Array;
  readonly trailingBytes: number;
}

function readCompactU16(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let at = offset;
  for (;;) {
    const byte = byteAt(bytes, at);
    at += 1;
    value |= (byte & 0x7f) << shift;
    shift += 7;
    if ((byte & 0x80) === 0) return { value, next: at };
  }
}

function parseWire(wire: Uint8Array): ParsedTransaction {
  assert.equal(byteAt(wire, 0), 1, "exactly one signature");
  const signature = wire.subarray(1, 65);
  const message = wire.subarray(65);
  const header = [byteAt(message, 0), byteAt(message, 1), byteAt(message, 2)];
  let offset = 3;
  const keyCount = readCompactU16(message, offset);
  offset = keyCount.next;
  const accountKeys: Uint8Array[] = [];
  for (let i = 0; i < keyCount.value; i += 1) {
    accountKeys.push(message.subarray(offset, offset + 32));
    offset += 32;
  }
  const blockhash = message.subarray(offset, offset + 32);
  offset += 32;
  const instructionCount = readCompactU16(message, offset);
  offset = instructionCount.next;
  const programIdIndex = byteAt(message, offset);
  offset += 1;
  const accounts = readCompactU16(message, offset);
  offset = accounts.next;
  const instructionAccounts: number[] = [];
  for (let i = 0; i < accounts.value; i += 1) {
    instructionAccounts.push(byteAt(message, offset));
    offset += 1;
  }
  const dataLength = readCompactU16(message, offset);
  offset = dataLength.next;
  const data = message.subarray(offset, offset + dataLength.value);
  return {
    signature,
    message,
    header,
    accountKeys,
    blockhash,
    instructionCount: instructionCount.value,
    programIdIndex,
    instructionAccounts,
    data,
    trailingBytes: message.length - (offset + dataLength.value),
  };
}

// base58 ---------------------------------------------------------------------------------------

void test("base58 matches the reference vectors, keeps leading zero bytes as '1', and round-trips (H1 memo transport)", () => {
  assert.equal(base58Encode(encoder.encode("Hello World!")), "2NEpo7TZRRrLZSi2U");
  assert.equal(decoder.decode(base58Decode("2NEpo7TZRRrLZSi2U")), "Hello World!");
  assert.equal(base58Encode(Uint8Array.of(0, 0, 1)), "112");
  assert.deepEqual(Array.from(base58Decode("112")), [0, 0, 1]);
  assert.equal(base58Encode(Uint8Array.of(0xff)), "5Q");
  for (const sample of [Uint8Array.of(0, 0, 0, 255, 1), new Uint8Array(32).fill(7), Uint8Array.of(0)]) {
    assert.deepEqual(Array.from(base58Decode(base58Encode(sample))), Array.from(sample));
  }
});

void test("base58Decode refuses every character outside the base58 alphabet (H1 memo transport)", () => {
  for (const ch of ["0", "O", "I", "l", "+", "/", " "]) {
    assert.throws(() => base58Decode(`2${ch}2`));
  }
});

// compact-u16 ----------------------------------------------------------------------------------

void test("encodeCompactU16 produces the Solana short-vec bytes for the boundary values (H1 transaction)", () => {
  const vectors: [number, number[]][] = [
    [0, [0]],
    [127, [127]],
    [128, [0x80, 0x01]],
    [16383, [0xff, 0x7f]],
    [16384, [0x80, 0x80, 0x01]],
    [65535, [0xff, 0xff, 0x03]],
  ];
  for (const [value, bytes] of vectors) {
    assert.deepEqual(Array.from(encodeCompactU16(value)), bytes);
  }
});

void test("encodeCompactU16 refuses values outside 0..65535 (H1 transaction)", () => {
  assert.throws(() => encodeCompactU16(-1));
  assert.throws(() => encodeCompactU16(65536));
});

// merkleRoot -----------------------------------------------------------------------------------

void test("merkleRoot of one line is the leaf hash H(0x00 || line) (H1 Merkle)", () => {
  assert.equal(hex(merkleRoot([A])), hex(sha256(Uint8Array.of(0x00), A)));
  assert.equal(merkleRoot([A]).length, 32);
});

void test("merkleRoot of two lines is H(0x01 || H(0x00||a) || H(0x00||b)) (H1 Merkle)", () => {
  assert.equal(hex(merkleRoot([A, B])), hex(node(leaf(A), leaf(B))));
});

void test("merkleRoot of three lines promotes the unpaired third leaf unchanged (H1 Merkle)", () => {
  assert.equal(hex(merkleRoot([A, B, C])), hex(node(node(leaf(A), leaf(B)), leaf(C))));
});

void test("merkleRoot of four lines pairs each level from the left (H1 Merkle)", () => {
  assert.equal(hex(merkleRoot([A, B, C, D])), hex(node(node(leaf(A), leaf(B)), node(leaf(C), leaf(D)))));
});

void test("merkleRoot refuses an empty line list (H1 Merkle)", () => {
  assert.throws(() => merkleRoot([]));
});

void test("merkleRoot changes when one line changes, and is stable for the same input (H1 Merkle)", () => {
  const original = hex(merkleRoot([A, B, C]));
  assert.equal(hex(merkleRoot([A, B, C])), original);
  assert.notEqual(hex(merkleRoot([A, encoder.encode("bravO"), C])), original);
});

void test("buildAnchorRecord fills version, session, line count, root and an ISO-8601 UTC time (H1 record)", () => {
  const record = buildAnchorRecord({
    sessionId: SESSION,
    lines: [A, B, C],
    createdAt: new Date("2026-10-23T12:00:00.000Z"),
  });
  assert.deepEqual(record, SAMPLE_RECORD);
  assert.equal(record.version, ANCHOR_RECORD_VERSION);
});

// encodeMemo -----------------------------------------------------------------------------------

void test("encodeMemo writes the record as single-line JSON in the fixed key order (H1 record)", () => {
  assert.equal(encodeMemo(SAMPLE_RECORD), SAMPLE_MEMO);
  assert.equal(encodeMemo(SAMPLE_RECORD).includes("\n"), false);
});

void test("encodeMemo accepts a memo of exactly 566 bytes and refuses one more byte (H1 memo)", () => {
  const probe = encodeMemo({ ...SAMPLE_RECORD, sessionId: "x" });
  const extra = MEMO_MAX_BYTES - Buffer.byteLength(probe, "utf8");
  const exact = encodeMemo({ ...SAMPLE_RECORD, sessionId: "x".repeat(1 + extra) });
  assert.equal(Buffer.byteLength(exact, "utf8"), MEMO_MAX_BYTES);
  assert.throws(() => encodeMemo({ ...SAMPLE_RECORD, sessionId: "x".repeat(2 + extra) }));
});

void test("encodeMemo refuses a record whose memo is longer than 566 bytes (H1 memo)", () => {
  assert.throws(() => encodeMemo({ ...SAMPLE_RECORD, sessionId: "a".repeat(600) }));
});

// buildMemoTransaction -------------------------------------------------------------------------

void test("buildMemoTransaction lays out one signed legacy message with the memo as instruction data (H1 transaction)", () => {
  const key = newTestKey();
  const wire = buildMemoTransaction({
    payer: key.publicKey,
    recentBlockhash: BLOCKHASH_BYTES,
    memo: SAMPLE_MEMO,
    signer: testSigner(key),
  });
  const tx = parseWire(wire);
  assert.equal(wire.length, 1 + 64 + tx.message.length);
  assert.equal(tx.signature.length, 64);
  assert.deepEqual(tx.header, [1, 0, 1]);
  assert.deepEqual(
    tx.accountKeys.map((keyBytes) => hex(keyBytes)),
    [hex(key.publicKey), hex(base58Decode(MEMO_PROGRAM_ID))],
  );
  assert.equal(hex(tx.blockhash), hex(BLOCKHASH_BYTES));
  assert.equal(tx.instructionCount, 1);
  assert.equal(tx.programIdIndex, 1);
  assert.deepEqual(tx.instructionAccounts, [0]);
  assert.equal(decoder.decode(tx.data), SAMPLE_MEMO);
  assert.equal(tx.trailingBytes, 0);
});

void test("buildMemoTransaction signature verifies over the message with the payer key, and fails once the message changes (H1 transaction)", () => {
  const key = newTestKey();
  const wire = buildMemoTransaction({
    payer: key.publicKey,
    recentBlockhash: BLOCKHASH_BYTES,
    memo: SAMPLE_MEMO,
    signer: testSigner(key),
  });
  const tx = parseWire(wire);
  assert.equal(cryptoVerify(null, tx.message, key.publicKeyObject, tx.signature), true);
  const lastIndex = tx.message.length - 1;
  const tampered = Uint8Array.from(tx.message, (byte, index) => (index === lastIndex ? byte ^ 0x01 : byte));
  assert.equal(cryptoVerify(null, tampered, key.publicKeyObject, tx.signature), false);
});

// loadAnchorKey --------------------------------------------------------------------------------

void test("loadAnchorKey accepts a 0600 keypair file outside stateDir and signs with it (H1 key)", () => {
  const { stateDir, keyDir } = keyDirs();
  const key = newTestKey();
  const keyFile = writeKeyFile(keyDir, key, 0o600);
  const signer = loadAnchorKey({ keyFile, stateDir });
  assert.equal(hex(signer.publicKey), hex(key.publicKey));
  const message = encoder.encode("anchor-check");
  const signature = signer.sign(message);
  assert.equal(signature.length, 64);
  assert.equal(cryptoVerify(null, message, key.publicKeyObject, signature), true);
});

void test("loadAnchorKey refuses any key file with a group or other permission bit set (H1 key)", () => {
  for (const mode of [0o644, 0o640, 0o604]) {
    const { stateDir, keyDir } = keyDirs();
    const keyFile = writeKeyFile(keyDir, newTestKey(), mode);
    assert.throws(() => loadAnchorKey({ keyFile, stateDir }));
  }
});

void test("loadAnchorKey refuses a key file inside stateDir even at 0600 (H1 key)", () => {
  const { stateDir } = keyDirs();
  const keyFile = writeKeyFile(stateDir, newTestKey(), 0o600);
  assert.throws(() => loadAnchorKey({ keyFile, stateDir }));
});

void test("loadAnchorKey refuses a stored public half that does not match the seed (H1 key)", () => {
  const { stateDir, keyDir } = keyDirs();
  const key = newTestKey();
  const other = newTestKey();
  const keyFile = writeKeyFile(keyDir, key, 0o600, other.publicKey);
  assert.throws(() => loadAnchorKey({ keyFile, stateDir }));
});

void test("loadAnchorKey refuses a path that is not a regular file (H1 key)", () => {
  const { stateDir, keyDir } = keyDirs();
  const directory = join(keyDir, "not-a-file");
  mkdirSync(directory);
  assert.throws(() => loadAnchorKey({ keyFile: directory, stateDir }));
});

void test("loadAnchorKey refuses a missing key file (H1 key)", () => {
  const { stateDir, keyDir } = keyDirs();
  assert.throws(() => loadAnchorKey({ keyFile: join(keyDir, "absent.json"), stateDir }));
});

// publishAnchor --------------------------------------------------------------------------------

interface RpcCall {
  readonly method: string;
  readonly params: readonly unknown[];
}

interface ScriptedRpc {
  readonly rpc: AnchorRpc;
  readonly calls: RpcCall[];
}

// A fake JSON-RPC node. Each method answers with the shape the live node uses: getLatestBlockhash
// wraps its blockhash in value, and sendTransaction returns the signature string.
function scriptedRpc(genesis: unknown, signature: unknown): ScriptedRpc {
  const calls: RpcCall[] = [];
  const rpc: AnchorRpc = {
    call(method, params) {
      calls.push({ method, params });
      if (method === "getGenesisHash") return Promise.resolve(genesis);
      if (method === "getLatestBlockhash") {
        return Promise.resolve({ context: { slot: 1 }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 100 } });
      }
      if (method === "sendTransaction") return Promise.resolve(signature);
      return Promise.reject(new Error(`unexpected RPC method: ${method}`));
    },
  };
  return { rpc, calls };
}

void test("publishAnchor with a wrong genesis hash refuses and sends nothing (H1 devnet guard)", async () => {
  const key = newTestKey();
  const { rpc, calls } = scriptedRpc(MAINNET_GENESIS, SIGNATURE);
  await assert.rejects(
    publishAnchor({ rpc, signer: testSigner(key), record: SAMPLE_RECORD, expectedGenesisHash: DEVNET_GENESIS_HASH }),
  );
  assert.deepEqual(
    calls.map((call) => call.method),
    ["getGenesisHash"],
  );
});

void test("publishAnchor on devnet sends a base64 transaction that decodes, carries the memo and verifies (H1 publish)", async () => {
  const key = newTestKey();
  const { rpc, calls } = scriptedRpc(DEVNET_GENESIS_HASH, SIGNATURE);
  const result = await publishAnchor({
    rpc,
    signer: testSigner(key),
    record: SAMPLE_RECORD,
    expectedGenesisHash: DEVNET_GENESIS_HASH,
  });
  assert.equal(result.signature, SIGNATURE);
  assert.equal(result.memo, SAMPLE_MEMO);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["getGenesisHash", "getLatestBlockhash", "sendTransaction"],
  );
  assert.deepEqual(calls.at(1)?.params, [{ commitment: "finalized" }]);
  assert.deepEqual(calls.at(2)?.params[1], { encoding: "base64", preflightCommitment: "confirmed" });
  const sent = calls.at(2)?.params[0];
  assert.ok(typeof sent === "string", "the transaction is sent as a string");
  const wire = new Uint8Array(Buffer.from(sent, "base64"));
  const tx = parseWire(wire);
  assert.equal(hex(tx.blockhash), hex(BLOCKHASH_BYTES));
  assert.equal(decoder.decode(tx.data), SAMPLE_MEMO);
  assert.equal(cryptoVerify(null, tx.message, key.publicKeyObject, tx.signature), true);
});

void test("publishAnchor throws when the node returns a signature that is not a string (H1 publish)", async () => {
  const key = newTestKey();
  const { rpc } = scriptedRpc(DEVNET_GENESIS_HASH, 42);
  await assert.rejects(
    publishAnchor({ rpc, signer: testSigner(key), record: SAMPLE_RECORD, expectedGenesisHash: DEVNET_GENESIS_HASH }),
  );
});

// createJsonRpc is the only network surface. Every refusal below must reach the caller as an AnchorError.
function jsonReply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fetchReplying(reply: () => Response): typeof fetch {
  return () => Promise.resolve(reply());
}

void test("createJsonRpc returns the result of a successful JSON-RPC reply (H1 RPC)", async () => {
  const rpc = createJsonRpc({
    url: "https://rpc.invalid",
    fetchImpl: fetchReplying(() => jsonReply({ jsonrpc: "2.0", id: 1, result: DEVNET_GENESIS_HASH })),
  });
  assert.equal(await rpc.call("getGenesisHash", []), DEVNET_GENESIS_HASH);
});

void test("createJsonRpc refuses a non-2xx reply and names the HTTP status (H1 RPC)", async () => {
  const rpc = createJsonRpc({
    url: "https://rpc.invalid",
    fetchImpl: fetchReplying(() => new Response("busy", { status: 503 })),
  });
  await assert.rejects(
    rpc.call("getLatestBlockhash", []),
    (error) => error instanceof AnchorError && error.message.includes("503"),
  );
});

void test("createJsonRpc surfaces a JSON-RPC error object as AnchorError with the node's message (H1 RPC)", async () => {
  const rpc = createJsonRpc({
    url: "https://rpc.invalid",
    fetchImpl: fetchReplying(() => jsonReply({ jsonrpc: "2.0", id: 1, error: { code: -32603, message: "Internal error" } })),
  });
  await assert.rejects(
    rpc.call("requestAirdrop", []),
    (error) => error instanceof AnchorError && error.message.includes("Internal error"),
  );
});

void test("createJsonRpc refuses a body that is not JSON as AnchorError (H1 RPC)", async () => {
  const rpc = createJsonRpc({
    url: "https://rpc.invalid",
    fetchImpl: fetchReplying(() => new Response("<html>gateway</html>", { status: 200 })),
  });
  await assert.rejects(rpc.call("getGenesisHash", []), (error) => error instanceof AnchorError);
});

void test("createJsonRpc refuses a reply that carries neither result nor error (H1 RPC)", async () => {
  const rpc = createJsonRpc({
    url: "https://rpc.invalid",
    fetchImpl: fetchReplying(() => jsonReply({ jsonrpc: "2.0", id: 1 })),
  });
  await assert.rejects(rpc.call("getGenesisHash", []), (error) => error instanceof AnchorError);
});

void test("createJsonRpc turns a transport failure into AnchorError (H1 RPC)", async () => {
  const rpc = createJsonRpc({
    url: "https://rpc.invalid",
    fetchImpl: () => Promise.reject(new TypeError("fetch failed")),
  });
  await assert.rejects(rpc.call("getGenesisHash", []), (error) => error instanceof AnchorError);
});

// Pinned values from the H1 design. A change to any of these changes the wire format or the devnet guard.
void test("the module pins the H1 constants: record version, memo limit, memo program and devnet genesis (H1 constants)", () => {
  assert.equal(ANCHOR_RECORD_VERSION, 1);
  assert.equal(MEMO_MAX_BYTES, 566);
  assert.equal(MEMO_PROGRAM_ID, "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
  assert.equal(DEVNET_GENESIS_HASH, "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
});

// AnchorError carries a code from the frozen catalogue --------------------------------------------

function thrownAnchorError(run: () => unknown): AnchorError {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof AnchorError, "expected an AnchorError");
    return error;
  }
  return assert.fail("expected the call to throw");
}

async function rejectedAnchorError(run: () => Promise<unknown>): Promise<AnchorError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof AnchorError, "expected an AnchorError");
    return error;
  }
  return assert.fail("expected the call to reject");
}

void test("AnchorError carries the catalogue code of each failure class and every code is in ERROR_CODES (H1 errors)", async () => {
  const observed = new Map<string, ErrorCode>();
  const expectCode = (label: string, error: AnchorError, code: ErrorCode): void => {
    assert.equal(error.name, "AnchorError", label);
    assert.equal(error.code, code, label);
    observed.set(label, error.code);
  };
  const key = newTestKey();
  const signer = testSigner(key);

  // Malformed input, record, memo, key or reply: SCHEMA_INVALID.
  expectCode("base58 character", thrownAnchorError(() => base58Decode("2O2")), "SCHEMA_INVALID");
  expectCode("compact-u16 range", thrownAnchorError(() => encodeCompactU16(65536)), "SCHEMA_INVALID");
  expectCode("empty merkle input", thrownAnchorError(() => merkleRoot([])), "SCHEMA_INVALID");
  expectCode(
    "invalid anchor time",
    thrownAnchorError(() => buildAnchorRecord({ sessionId: SESSION, lines: [A], createdAt: new Date(Number.NaN) })),
    "SCHEMA_INVALID",
  );
  expectCode(
    "memo too long",
    thrownAnchorError(() => encodeMemo({ ...SAMPLE_RECORD, sessionId: "a".repeat(600) })),
    "SCHEMA_INVALID",
  );
  expectCode(
    "payer length",
    thrownAnchorError(() =>
      buildMemoTransaction({ payer: new Uint8Array(31), recentBlockhash: BLOCKHASH_BYTES, memo: SAMPLE_MEMO, signer }),
    ),
    "SCHEMA_INVALID",
  );
  expectCode(
    "payer is not the signer",
    thrownAnchorError(() =>
      buildMemoTransaction({ payer: newTestKey().publicKey, recentBlockhash: BLOCKHASH_BYTES, memo: SAMPLE_MEMO, signer }),
    ),
    "SCHEMA_INVALID",
  );
  expectCode(
    "blockhash length",
    thrownAnchorError(() =>
      buildMemoTransaction({ payer: key.publicKey, recentBlockhash: new Uint8Array(31), memo: SAMPLE_MEMO, signer }),
    ),
    "SCHEMA_INVALID",
  );
  const dirs = keyDirs();
  expectCode(
    "relative key path",
    thrownAnchorError(() => loadAnchorKey({ keyFile: "relative.json", stateDir: dirs.stateDir })),
    "SCHEMA_INVALID",
  );
  expectCode(
    "missing key file",
    thrownAnchorError(() => loadAnchorKey({ keyFile: join(dirs.keyDir, "absent.json"), stateDir: dirs.stateDir })),
    "SCHEMA_INVALID",
  );
  const mismatched = writeKeyFile(dirs.keyDir, key, 0o600, newTestKey().publicKey);
  expectCode(
    "key public half mismatch",
    thrownAnchorError(() => loadAnchorKey({ keyFile: mismatched, stateDir: dirs.stateDir })),
    "SCHEMA_INVALID",
  );
  const notJson = join(dirs.keyDir, "not-json.json");
  writeFileSync(notJson, "not json", { mode: 0o600 });
  expectCode(
    "key file is not JSON",
    thrownAnchorError(() => loadAnchorKey({ keyFile: notJson, stateDir: dirs.stateDir })),
    "SCHEMA_INVALID",
  );
  const shortKey = join(dirs.keyDir, "short.json");
  writeFileSync(shortKey, JSON.stringify([1, 2, 3]), { mode: 0o600 });
  expectCode(
    "key file wrong length",
    thrownAnchorError(() => loadAnchorKey({ keyFile: shortKey, stateDir: dirs.stateDir })),
    "SCHEMA_INVALID",
  );
  expectCode(
    "signature is not a string",
    await rejectedAnchorError(() =>
      publishAnchor({
        rpc: scriptedRpc(DEVNET_GENESIS_HASH, 42).rpc,
        signer,
        record: SAMPLE_RECORD,
        expectedGenesisHash: DEVNET_GENESIS_HASH,
      }),
    ),
    "SCHEMA_INVALID",
  );

  // RPC transport, HTTP and reply failures: SCHEMA_INVALID.
  const rpcWith = (fetchImpl: typeof fetch): AnchorRpc => createJsonRpc({ url: "https://rpc.invalid", fetchImpl });
  expectCode(
    "rpc transport failure",
    await rejectedAnchorError(() => rpcWith(() => Promise.reject(new TypeError("fetch failed"))).call("getGenesisHash", [])),
    "SCHEMA_INVALID",
  );
  expectCode(
    "rpc http failure",
    await rejectedAnchorError(() => rpcWith(fetchReplying(() => new Response("busy", { status: 503 }))).call("getGenesisHash", [])),
    "SCHEMA_INVALID",
  );
  expectCode(
    "rpc body not json",
    await rejectedAnchorError(() => rpcWith(fetchReplying(() => new Response("<html>", { status: 200 }))).call("getGenesisHash", [])),
    "SCHEMA_INVALID",
  );
  expectCode(
    "rpc non-object reply",
    await rejectedAnchorError(() => rpcWith(fetchReplying(() => jsonReply([1]))).call("getGenesisHash", [])),
    "SCHEMA_INVALID",
  );
  expectCode(
    "rpc error object",
    await rejectedAnchorError(() =>
      rpcWith(fetchReplying(() => jsonReply({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "boom" } }))).call("getGenesisHash", []),
    ),
    "SCHEMA_INVALID",
  );
  expectCode(
    "rpc reply without result",
    await rejectedAnchorError(() => rpcWith(fetchReplying(() => jsonReply({ jsonrpc: "2.0", id: 1 }))).call("getGenesisHash", [])),
    "SCHEMA_INVALID",
  );

  // Key file mode, key inside the state directory, genesis mismatch: POLICY_DENIED.
  const openKey = writeKeyFile(dirs.keyDir, key, 0o644);
  expectCode(
    "key file mode",
    thrownAnchorError(() => loadAnchorKey({ keyFile: openKey, stateDir: dirs.stateDir })),
    "POLICY_DENIED",
  );
  const insideState = writeKeyFile(dirs.stateDir, key, 0o600);
  expectCode(
    "key inside state dir",
    thrownAnchorError(() => loadAnchorKey({ keyFile: insideState, stateDir: dirs.stateDir })),
    "POLICY_DENIED",
  );
  expectCode(
    "genesis mismatch",
    await rejectedAnchorError(() =>
      publishAnchor({
        rpc: scriptedRpc(MAINNET_GENESIS, SIGNATURE).rpc,
        signer,
        record: SAMPLE_RECORD,
        expectedGenesisHash: DEVNET_GENESIS_HASH,
      }),
    ),
    "POLICY_DENIED",
  );

  // A key file that is not a regular file: PATH_ESCAPE.
  const directory = join(dirs.keyDir, "a-directory");
  mkdirSync(directory);
  expectCode(
    "key path is a directory",
    thrownAnchorError(() => loadAnchorKey({ keyFile: directory, stateDir: dirs.stateDir })),
    "PATH_ESCAPE",
  );

  for (const [label, code] of observed) {
    assert.ok(ERROR_CODES.includes(code), `${label}: ${code} is not in ERROR_CODES`);
  }
});
