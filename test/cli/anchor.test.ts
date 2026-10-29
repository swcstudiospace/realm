// `realm anchor` tests (H1), against src/cli/anchor.ts. parseAnchorArgs turns the words after `anchor`
// into AnchorArgs, or undefined for anything it refuses. runAnchor reports expected failures as exitCode 1
// with a stderr line and never throws for them. A fixed `now` makes createdAt deterministic, and the RPC
// factory is a fake, so no test reaches the network. Audit files and keys live under os.tmpdir()
// directories that are removed when the file's tests finish.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEVNET_GENESIS_HASH, type AnchorRpc } from "../../src/audit/anchor.js";
import {
  parseAnchorArgs,
  runAnchor,
  type AnchorArgs,
  type AnchorRunDeps,
} from "../../src/cli/anchor.js";

const encoder = new TextEncoder();
const SESSION = "11111111-2222-4333-8444-555555555555";
const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const CUSTOM_RPC_URL = "https://rpc.example.invalid/devnet";
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const SIGNATURE = "signature-returned-by-fake-rpc";
const BLOCKHASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const FIXED_ISO = "2026-10-23T12:00:00.000Z";
const FIXED_NOW = new Date(FIXED_ISO);

// Three audit lines, written with a trailing newline as appendAudit does.
const LINE_ONE = '{"n":1}';
const LINE_TWO = '{"n":2}';
const LINE_THREE = '{"n":3}';
const AUDIT_TEXT = `${LINE_ONE}\n${LINE_TWO}\n${LINE_THREE}\n`;

const tempDirs: string[] = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "realm-anchor-cli-"));
  tempDirs.push(dir);
  return dir;
}

// Independent SHA-256 helpers with the H1 leaf (0x00) and node (0x01) domain separators.
function sha256(...parts: Uint8Array[]): Uint8Array {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}

function leafHash(line: string): Uint8Array {
  return sha256(Uint8Array.of(0x00), encoder.encode(line));
}

function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(Uint8Array.of(0x01), left, right);
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

// Three lines: the first two pair, the third is promoted unchanged to the top level.
const EXPECTED_ROOT = hex(nodeHash(nodeHash(leafHash(LINE_ONE), leafHash(LINE_TWO)), leafHash(LINE_THREE)));
const EXPECTED_RECORD = {
  version: 1,
  sessionId: SESSION,
  lineCount: 3,
  rootSha256: EXPECTED_ROOT,
  createdAt: FIXED_ISO,
};
const EXPECTED_MEMO = `{"version":1,"sessionId":"${SESSION}","lineCount":3,"rootSha256":"${EXPECTED_ROOT}","createdAt":"${FIXED_ISO}"}`;

// Writes <stateDir>/audit/<SESSION>.jsonl with the given content and returns stateDir.
function stateWithAudit(content: string): string {
  const stateDir = join(makeTempDir(), "state");
  mkdirSync(join(stateDir, "audit"), { recursive: true });
  writeFileSync(join(stateDir, "audit", `${SESSION}.jsonl`), content);
  return stateDir;
}

// Parses the words after `anchor` and fails the test if the parser refuses them.
function parsed(words: readonly string[]): AnchorArgs {
  const args = parseAnchorArgs(words);
  assert.ok(args !== undefined, `parseAnchorArgs accepts ${words.join(" ")}`);
  return args;
}

// A fresh signing key whose seed and public half are written to a 0600 keypair file outside any state
// directory. The public key object verifies the transaction that the publish path sends.
interface SigningKey {
  readonly keyFile: string;
  readonly publicKeyObject: KeyObject;
}

function signingKeyFile(): SigningKey {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
  const spki = publicKey.export({ format: "der", type: "spki" });
  const seed = new Uint8Array(pkcs8.subarray(pkcs8.length - 32));
  const pub = new Uint8Array(spki.subarray(spki.length - 32));
  const dir = join(makeTempDir(), "keys");
  mkdirSync(dir);
  const keyFile = join(dir, "anchor-key.json");
  writeFileSync(keyFile, JSON.stringify([...seed, ...pub]));
  chmodSync(keyFile, 0o600);
  return { keyFile, publicKeyObject: publicKey };
}

// A fake node that records the RPC URL each factory call received, every method name, and every
// base64 transaction sent. With no options every call rejects, which proves a run made no RPC call.
interface NodeOptions {
  readonly genesis?: string;
  readonly signature?: string;
}

interface FakeNode {
  readonly createRpc: (url: string) => AnchorRpc;
  readonly urls: string[];
  readonly methods: string[];
  readonly sent: string[];
}

function fakeNode(options?: NodeOptions): FakeNode {
  const urls: string[] = [];
  const methods: string[] = [];
  const sent: string[] = [];
  const createRpc = (url: string): AnchorRpc => {
    urls.push(url);
    return {
      call(method, params) {
        methods.push(method);
        if (options === undefined) return Promise.reject(new Error(`no RPC allowed in this test: ${method}`));
        if (method === "getGenesisHash") return Promise.resolve(options.genesis ?? DEVNET_GENESIS_HASH);
        if (method === "getLatestBlockhash") return Promise.resolve({ value: { blockhash: BLOCKHASH } });
        if (method === "sendTransaction") {
          const b64 = params[0];
          if (typeof b64 === "string") sent.push(b64);
          return Promise.resolve(options.signature ?? SIGNATURE);
        }
        return Promise.reject(new Error(`unexpected RPC method: ${method}`));
      },
    };
  };
  return { createRpc, urls, methods, sent };
}

function depsFor(stateDir: string, node: FakeNode, keyFile: string | undefined): AnchorRunDeps {
  return { stateDir, keyFile, createRpc: node.createRpc, now: () => FIXED_NOW };
}

void test("parseAnchorArgs reads --session, --publish and --rpc in any order, and refuses anything else (H1 CLI args)", () => {
  assert.deepEqual(parseAnchorArgs(["--session", SESSION]), { sessionId: SESSION, publish: false, rpcUrl: undefined });
  assert.deepEqual(parseAnchorArgs(["--publish", "--rpc", CUSTOM_RPC_URL, "--session", SESSION]), {
    sessionId: SESSION,
    publish: true,
    rpcUrl: CUSTOM_RPC_URL,
  });
  assert.equal(parseAnchorArgs([]), undefined, "no session");
  assert.equal(parseAnchorArgs(["--session"]), undefined, "session without a value");
  assert.equal(parseAnchorArgs(["--session", SESSION, "--session", SESSION]), undefined, "session given twice");
  assert.equal(parseAnchorArgs(["--session", SESSION, "--unknown"]), undefined, "unknown flag");
  assert.equal(parseAnchorArgs(["--session", "../escape"]), undefined, "session id that could leave the audit directory");
});

void test("realm anchor without --publish prints the record and memo with createdAt from deps.now, and makes zero RPC calls (H1 CLI dry run)", async () => {
  const stateDir = stateWithAudit(AUDIT_TEXT);
  const node = fakeNode();
  const result = await runAnchor(parsed(["--session", SESSION]), depsFor(stateDir, node, undefined));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(node.methods, []);
  assert.deepEqual(node.urls, []);

  assert.equal(result.stdout.endsWith("\n"), true);
  assert.equal(result.stdout.slice(0, -1).includes("\n"), false, "stdout is one JSON line");
  const out: unknown = JSON.parse(result.stdout);
  assert.deepEqual(out, {
    mode: "dry-run",
    record: EXPECTED_RECORD,
    memo: EXPECTED_MEMO,
    memoBytes: Buffer.byteLength(EXPECTED_MEMO, "utf8"),
  });
});

void test("realm anchor fails with exitCode 1 and a stderr line when the session's audit file is missing, with zero RPC calls (H1 CLI)", async () => {
  const stateDir = join(makeTempDir(), "state");
  mkdirSync(stateDir);
  const node = fakeNode();
  const result = await runAnchor(parsed(["--session", SESSION]), depsFor(stateDir, node, undefined));
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `realm anchor: no audit log exists for session ${SESSION}\n`);
  assert.deepEqual(node.methods, []);
});

void test("realm anchor fails with exitCode 1 and a stderr line when the audit file has zero lines, with zero RPC calls (H1 CLI)", async () => {
  const stateDir = stateWithAudit("");
  const node = fakeNode();
  const result = await runAnchor(parsed(["--session", SESSION]), depsFor(stateDir, node, undefined));
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `realm anchor: audit log for session ${SESSION} has no lines\n`);
  assert.deepEqual(node.methods, []);
});

void test("realm anchor turns a failing audit read into exitCode 1 with a fixed stderr line that names no host path, and makes zero RPC calls (H1 CLI)", async () => {
  const stateDir = stateWithAudit(AUDIT_TEXT);
  const node = fakeNode();
  let attemptedPath: string | undefined;
  const result = await runAnchor(parsed(["--session", SESSION]), {
    ...depsFor(stateDir, node, undefined),
    readAuditFile: (path) => {
      attemptedPath = path;
      throw Object.assign(new Error(`EACCES: permission denied, open '${path}'`), { code: "EACCES" });
    },
  });
  assert.ok(attemptedPath !== undefined, "the injected reader was used");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `realm anchor: audit log for session ${SESSION} could not be read\n`);
  assert.equal(result.stderr.includes(stateDir), false, "no host path in the output");
  assert.deepEqual(node.methods, []);
});

void test("realm anchor reports a directory where the audit file is expected as exitCode 1 without a host path (H1 CLI)", async () => {
  const stateDir = join(makeTempDir(), "state");
  mkdirSync(join(stateDir, "audit", `${SESSION}.jsonl`), { recursive: true });
  const node = fakeNode();
  const result = await runAnchor(parsed(["--session", SESSION]), depsFor(stateDir, node, undefined));
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `realm anchor: audit log for session ${SESSION} is not a regular file\n`);
  assert.equal(result.stderr.includes(stateDir), false, "no host path in the output");
  assert.deepEqual(node.methods, []);
});

void test("realm anchor --publish without a key file fails before any RPC call, with exitCode 1 and a stderr line (H1 CLI)", async () => {
  const stateDir = stateWithAudit(AUDIT_TEXT);
  const node = fakeNode({});
  const result = await runAnchor(parsed(["--session", SESSION, "--publish"]), depsFor(stateDir, node, undefined));
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "realm anchor: REALM_ANCHOR_KEY_FILE is not set; --publish needs the anchor key file\n",
  );
  assert.deepEqual(node.urls, []);
  assert.deepEqual(node.methods, []);
});

void test("realm anchor --publish sends a signed memo to the default devnet RPC and prints the signature and explorer link (H1 CLI publish)", async () => {
  const stateDir = stateWithAudit(AUDIT_TEXT);
  const signing = signingKeyFile();
  const node = fakeNode({});
  const result = await runAnchor(parsed(["--session", SESSION, "--publish"]), depsFor(stateDir, node, signing.keyFile));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(node.urls, [DEFAULT_RPC_URL]);
  assert.deepEqual(node.methods, ["getGenesisHash", "getLatestBlockhash", "sendTransaction"]);

  const out: unknown = JSON.parse(result.stdout);
  assert.deepEqual(out, {
    mode: "published",
    cluster: "devnet",
    signature: SIGNATURE,
    explorer: `https://explorer.solana.com/tx/${SIGNATURE}?cluster=devnet`,
    record: EXPECTED_RECORD,
  });

  const sent = node.sent[0];
  assert.ok(sent !== undefined, "one transaction was sent");
  const wire = new Uint8Array(Buffer.from(sent, "base64"));
  assert.equal(wire[0], 1, "one signature");
  const signature = wire.subarray(1, 65);
  const message = wire.subarray(65);
  assert.equal(cryptoVerify(null, message, signing.publicKeyObject, signature), true);
  // The memo is the last field of the message, so it ends the message bytes.
  assert.equal(
    new TextDecoder().decode(message.subarray(message.length - Buffer.byteLength(EXPECTED_MEMO, "utf8"))),
    EXPECTED_MEMO,
  );
});

void test("realm anchor --publish --rpc sends to the URL it was given (H1 CLI publish)", async () => {
  const stateDir = stateWithAudit(AUDIT_TEXT);
  const signing = signingKeyFile();
  const node = fakeNode({});
  const result = await runAnchor(
    parsed(["--session", SESSION, "--publish", "--rpc", CUSTOM_RPC_URL]),
    depsFor(stateDir, node, signing.keyFile),
  );
  assert.equal(result.exitCode, 0);
  assert.deepEqual(node.urls, [CUSTOM_RPC_URL]);
});

void test("realm anchor --publish refuses a non-devnet endpoint with exitCode 1, and sends no transaction (H1 CLI devnet guard)", async () => {
  const stateDir = stateWithAudit(AUDIT_TEXT);
  const signing = signingKeyFile();
  const node = fakeNode({ genesis: MAINNET_GENESIS });
  const result = await runAnchor(parsed(["--session", SESSION, "--publish"]), depsFor(stateDir, node, signing.keyFile));
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "realm anchor: refusing to publish: the endpoint's genesis hash is not the expected cluster; nothing was sent\n",
  );
  assert.deepEqual(node.methods, ["getGenesisHash"]);
  assert.deepEqual(node.sent, []);
});
