import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHmac, randomBytes } from "node:crypto";
import fc from "fast-check";
import {
  KEY_BYTES,
  TOKEN_CAPABILITIES,
  TOKEN_PREFIX,
  mintToken,
  verifyToken,
  type KeyLookup,
  type MintClaims,
  type RefusalClass,
  type TokenCapability,
  type VerifyResult,
} from "../../src/capability/token.js";
import { RealmError } from "../../src/core/errors.js";
import { integrationCeiling } from "../../src/host/capabilities.js";
import { HOST_IDS, type HostId } from "../../src/host/types.js";
import { assertProperty } from "../support/property.js";

// The seeded refusal matrix (CAPT-02, D-32-13 item 1). Rows are ported from the Phase 30 prototype's E1
// (30-01-SUMMARY, scripts/spike/capability-token/run.mjs), with its host-binding rows replaced: a payload with a
// host outside HOST_IDS is bad-payload, and there is no wrong-host stage.

const NOW = 1_700_000_000;
const KEY = randomBytes(KEY_BYTES);
const LONG_KID = "a".repeat(17);
const KEYS: ReadonlyMap<string, Buffer> = new Map([
  ["k1", KEY],
  ["k9", KEY],
  [LONG_KID, KEY],
  ["K1", KEY],
]);
const lookup: KeyLookup = (kid) => KEYS.get(kid);

const BASE: MintClaims = {
  kid: "k1",
  sid: "s1",
  host: "cursor",
  caps: ["fs.list", "fs.read"],
  iat: NOW,
  exp: NOW + 3600,
};

// Test-only forger: signs any payload object as given, so a defect can carry a valid MAC where the row says so.
function sign(key: Buffer, payloadObject: unknown): string {
  const payload = Buffer.from(JSON.stringify(payloadObject), "utf8");
  const tag = createHmac("sha256", key).update("realm-capt-v1\u0000").update(payload).digest();
  return `${TOKEN_PREFIX}.${payload.toString("base64url")}.${tag.toString("base64url")}`;
}

// The payload object a good token carries, with the given members replaced (key order is kept).
function canon(over: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return { v: 1, ...BASE, ...over };
}

function parts(token: string): { payload: string; tag: string } {
  const [, payload, tag] = token.split(".");
  assert.ok(payload !== undefined && tag !== undefined);
  return { payload, tag };
}

function flipTagByte(token: string): string {
  const { payload, tag } = parts(token);
  const bytes = Buffer.from(tag, "base64url");
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  return `${TOKEN_PREFIX}.${payload}.${bytes.toString("base64url")}`;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// A different last character that decodes to the same bytes (a non-canonical form), or null when none exists.
function nonCanonicalLast(text: string): string | null {
  const bytes = Buffer.from(text, "base64url");
  const head = text.slice(0, -1);
  for (const candidate of ALPHABET) {
    const alternative = head + candidate;
    if (alternative !== text && Buffer.from(alternative, "base64url").equals(bytes)) {
      return alternative;
    }
  }
  return null;
}

interface Context {
  readonly sid?: string;
  readonly capability?: TokenCapability | null;
  readonly now?: number;
  readonly lookup?: KeyLookup;
}

function verify(text: unknown, context: Context = {}): VerifyResult {
  // null is a real value (a call that needs no capability), so only undefined takes the default.
  const capability = context.capability === undefined ? "fs.read" : context.capability;
  return verifyToken(text, context.lookup ?? lookup, context.sid ?? "s1", capability, context.now ?? NOW);
}

function refusalOf(result: VerifyResult): RefusalClass | "accepted" {
  return result.ok ? "accepted" : result.refusal;
}

const GOOD = mintToken(KEY, BASE);
const GOOD_PARTS = parts(GOOD);
const BAD_MAC = flipTagByte(GOOD);
const SWAPPED_SID = Buffer.from(Buffer.from(GOOD_PARTS.payload, "base64url").toString("utf8").replace('"s1"', '"s2"')).toString("base64url");

// A good token whose payload is not a multiple of three bytes, so its last payload character has unused bits.
function tokenWithOddPayload(): string {
  for (const sid of ["s1", "s11", "s111"]) {
    const token = mintToken(KEY, { ...BASE, sid });
    if (Buffer.from(parts(token).payload, "base64url").length % 3 !== 0) {
      return token;
    }
  }
  throw new Error("no payload length that is not a multiple of three");
}
const ODD = tokenWithOddPayload();
const ODD_PARTS = parts(ODD);
const NON_CANONICAL_PAYLOAD = nonCanonicalLast(ODD_PARTS.payload);
const NON_CANONICAL_MAC = nonCanonicalLast(GOOD_PARTS.tag);
assert.ok(NON_CANONICAL_PAYLOAD !== null && NON_CANONICAL_MAC !== null, "the matrix needs non-canonical forms");

interface Row {
  readonly name: string;
  readonly expected: RefusalClass | "accepted";
  readonly text: unknown;
  readonly context?: Context;
}

// Classes whose result carries the authentic host and kid (the MAC and the payload schema both passed).
const AUTHENTIC: ReadonlySet<RefusalClass | "accepted"> = new Set([
  "bad-version",
  "time-window",
  "wrong-session",
  "capability-not-granted",
]);

const ROWS: readonly Row[] = [
  { name: "valid token", expected: "accepted", text: GOOD },
  { name: "tampered payload byte", expected: "bad-mac", text: `${TOKEN_PREFIX}.${SWAPPED_SID}.${GOOD_PARTS.tag}` },
  { name: "tampered MAC byte", expected: "bad-mac", text: BAD_MAC },
  {
    name: "MAC truncated to 31 bytes",
    expected: "format",
    text: `${TOKEN_PREFIX}.${GOOD_PARTS.payload}.${Buffer.from(GOOD_PARTS.tag, "base64url").subarray(0, 31).toString("base64url")}`,
  },
  { name: "wrong key", expected: "bad-mac", text: mintToken(randomBytes(KEY_BYTES), BASE) },
  { name: "unknown kid", expected: "unknown-kid", text: mintToken(KEY, { ...BASE, kid: "k8" }) },
  {
    name: "revoked kid",
    expected: "unknown-kid",
    text: GOOD,
    context: { lookup: () => undefined },
  },
  { name: "version 2 signed with the right key", expected: "bad-version", text: sign(KEY, canon({ v: 2 })) },
  { name: "payload with an extra key", expected: "bad-payload", text: sign(KEY, { ...canon({}), extra: 1 }) },
  { name: "exp as a string", expected: "bad-payload", text: sign(KEY, canon({ exp: String(BASE.exp) })) },
  { name: "caps unsorted", expected: "bad-payload", text: sign(KEY, canon({ caps: ["fs.read", "fs.list"] })) },
  { name: "caps with a duplicate", expected: "bad-payload", text: sign(KEY, canon({ caps: ["fs.list", "fs.list", "fs.read"] })) },
  { name: "caps containing net.egress", expected: "bad-payload", text: sign(KEY, canon({ caps: ["fs.list", "fs.read", "net.egress"] })) },
  { name: "host outside HOST_IDS", expected: "bad-payload", text: sign(KEY, canon({ host: "notahost" })) },
  { name: "kid of 17 characters", expected: "bad-payload", text: sign(KEY, canon({ kid: LONG_KID })) },
  { name: "kid with an uppercase letter", expected: "bad-payload", text: sign(KEY, canon({ kid: "K1" })) },
  { name: "sid with a slash", expected: "bad-payload", text: sign(KEY, canon({ sid: "a/b" })), context: { sid: "a/b" } },
  { name: "exp in the past", expected: "time-window", text: sign(KEY, canon({ iat: NOW - 7200, exp: NOW - 3600 })) },
  { name: "iat 120 s in the future", expected: "time-window", text: sign(KEY, canon({ iat: NOW + 120, exp: NOW + 3720 })) },
  { name: "lifetime 86401 s", expected: "time-window", text: sign(KEY, canon({ iat: NOW, exp: NOW + 86401 })) },
  { name: "lifetime 0 s", expected: "time-window", text: sign(KEY, canon({ iat: NOW + 30, exp: NOW + 30 })) },
  { name: "presented for session s2", expected: "wrong-session", text: GOOD, context: { sid: "s2" } },
  { name: "capability outside the token set", expected: "capability-not-granted", text: GOOD, context: { capability: "fs.write" } },
  { name: "no token: undefined", expected: "format", text: undefined },
  { name: "no token: null", expected: "format", text: null },
  { name: "no token: a number", expected: "format", text: 5 },
  { name: "no token: an object", expected: "format", text: { token: GOOD } },
  { name: "not a token", expected: "format", text: "abc" },
  { name: "padded base64url MAC", expected: "format", text: `${GOOD}=` },
  { name: "payload with a non-canonical final character", expected: "format", text: `${TOKEN_PREFIX}.${NON_CANONICAL_PAYLOAD}.${ODD_PARTS.tag}` },
  { name: "MAC with a non-canonical final character", expected: "format", text: `${TOKEN_PREFIX}.${GOOD_PARTS.payload}.${NON_CANONICAL_MAC}` },
  { name: "a fourth dot part", expected: "format", text: `${GOOD}.AAAA` },
  { name: "prefix rcap2", expected: "format", text: GOOD.replace(TOKEN_PREFIX, "rcap2") },
  { name: "uppercase prefix", expected: "format", text: GOOD.replace(TOKEN_PREFIX, "RCAP1") },
  { name: "payload that is not JSON", expected: "format", text: `${TOKEN_PREFIX}.${Buffer.from("not json").toString("base64url")}.${GOOD_PARTS.tag}` },
  { name: "payload that is a JSON array", expected: "format", text: sign(KEY, ["k1"]) },
  { name: "payload whose kid is not a string", expected: "format", text: sign(KEY, canon({ kid: 1 })) },
  // Ordering rows: each token carries the intended defect and the earlier-stage defect, and the earlier stage wins.
  { name: "order: tampered MAC before wrong session", expected: "bad-mac", text: BAD_MAC, context: { sid: "s2" } },
  { name: "order: unknown kid before MAC", expected: "unknown-kid", text: flipTagByte(mintToken(KEY, { ...BASE, kid: "k8" })) },
  { name: "order: MAC before payload schema", expected: "bad-mac", text: sign(randomBytes(KEY_BYTES), { ...canon({}), extra: 1 }) },
  { name: "order: payload schema before version", expected: "bad-payload", text: sign(KEY, { ...canon({ v: 2 }), extra: 1 }) },
  { name: "order: version before time window", expected: "bad-version", text: sign(KEY, canon({ v: 2, iat: NOW - 7200, exp: NOW - 3600 })) },
  { name: "order: time window before session", expected: "time-window", text: sign(KEY, canon({ iat: NOW - 7200, exp: NOW - 3600 })), context: { sid: "s2" } },
  { name: "order: session before capability", expected: "wrong-session", text: GOOD, context: { sid: "s2", capability: "fs.write" } },
];

for (const row of ROWS) {
  void test(`matrix: ${row.name} is ${row.expected}`, () => {
    const result = verify(row.text, row.context);
    assert.equal(refusalOf(result), row.expected);
    if (result.ok) {
      assert.deepEqual(result.claims, { v: 1, ...BASE });
      return;
    }
    if (AUTHENTIC.has(row.expected)) {
      assert.deepEqual(result.principal, { host: "cursor", kid: "k1" });
    } else {
      assert.equal("principal" in result, false, "an unauthenticated claim is never carried");
    }
  });
}

void test("matrix: the valid token is accepted and every refusal class appears", () => {
  const seen = new Set<string>(ROWS.map((row) => row.expected));
  for (const name of [
    "accepted",
    "format",
    "unknown-kid",
    "bad-mac",
    "bad-payload",
    "bad-version",
    "time-window",
    "wrong-session",
    "capability-not-granted",
  ]) {
    assert.ok(seen.has(name), `no row for ${name}`);
  }
});

void test("time window edges: exp is exclusive, iat may lead by exactly 60 s, a lifetime of 1 and of 86400 pass", () => {
  assert.equal(refusalOf(verify(sign(KEY, canon({ iat: NOW - 10, exp: NOW })))), "time-window");
  assert.equal(refusalOf(verify(sign(KEY, canon({ iat: NOW - 10, exp: NOW + 1 })))), "accepted");
  assert.equal(refusalOf(verify(sign(KEY, canon({ iat: NOW + 60, exp: NOW + 61 })))), "accepted");
  assert.equal(refusalOf(verify(sign(KEY, canon({ iat: NOW + 61, exp: NOW + 62 })))), "time-window");
  assert.equal(refusalOf(verify(sign(KEY, canon({ iat: NOW, exp: NOW + 86400 })))), "accepted");
});

void test("a token needing no capability is accepted for any set, and a null capability skips the capability stage", () => {
  assert.equal(refusalOf(verify(GOOD, { capability: null })), "accepted");
});

void test("the capability catalogue is the six of the mcp-config ceiling, sorted", () => {
  assert.equal(TOKEN_CAPABILITIES.length, 6);
  assert.deepEqual(new Set<string>(TOKEN_CAPABILITIES), new Set<string>(integrationCeiling("mcp-config")));
  assert.deepEqual([...TOKEN_CAPABILITIES], [...TOKEN_CAPABILITIES].sort());
});

void test("round trip: every host and a sample of capability subsets mint and verify for their own session only", () => {
  const subsets: readonly (readonly TokenCapability[])[] = [[], ["fs.read"], [...TOKEN_CAPABILITIES].reverse()];
  for (const host of HOST_IDS) {
    for (const caps of subsets) {
      const token = mintToken(KEY, { ...BASE, host, caps });
      const sorted = [...caps].sort();
      const own = verify(token, { capability: null });
      assert.ok(own.ok);
      assert.deepEqual(own.claims.caps, sorted);
      assert.equal(own.claims.host, host);
      assert.equal(refusalOf(verify(token, { sid: "other", capability: null })), "wrong-session");
      for (const capability of TOKEN_CAPABILITIES) {
        const expected = sorted.includes(capability) ? "accepted" : "capability-not-granted";
        assert.equal(refusalOf(verify(token, { capability })), expected);
      }
    }
  }
});

void test("the empty set is accepted for a call that needs no capability and refused for any other", () => {
  const token = mintToken(KEY, { ...BASE, caps: [] });
  assert.equal(refusalOf(verify(token, { capability: null })), "accepted");
  for (const capability of TOKEN_CAPABILITIES) {
    assert.equal(refusalOf(verify(token, { capability })), "capability-not-granted");
  }
});

void test("mintToken writes the payload keys in the fixed order with v 1 and sorted caps", () => {
  const token = mintToken(KEY, { ...BASE, caps: ["fs.write", "daemon.attach", "fs.read"] });
  const text = Buffer.from(parts(token).payload, "base64url").toString("utf8");
  assert.equal(
    text,
    JSON.stringify({
      v: 1,
      kid: "k1",
      sid: "s1",
      host: "cursor",
      caps: ["daemon.attach", "fs.read", "fs.write"],
      iat: NOW,
      exp: NOW + 3600,
    }),
  );
  assert.ok(token.startsWith(`${TOKEN_PREFIX}.`));
});

void test("mintToken refuses claims the schema stage would refuse, with SCHEMA_INVALID", () => {
  const refused = (error: unknown): boolean => error instanceof RealmError && error.code === "SCHEMA_INVALID";
  assert.throws(() => mintToken(KEY.subarray(0, 31), BASE), refused);
  assert.throws(() => mintToken(Buffer.alloc(33), BASE), refused);
  assert.throws(() => mintToken(KEY, { ...BASE, host: "notahost" as HostId }), refused);
  assert.throws(() => mintToken(KEY, { ...BASE, caps: ["net.egress"] as unknown as readonly TokenCapability[] }), refused);
  assert.throws(() => mintToken(KEY, { ...BASE, caps: ["fs.read", "fs.read"] }), refused);
  assert.throws(() => mintToken(KEY, { ...BASE, kid: LONG_KID }), refused);
  assert.throws(() => mintToken(KEY, { ...BASE, kid: "" }), refused);
  assert.throws(() => mintToken(KEY, { ...BASE, sid: "a/b" }), refused);
  assert.throws(() => mintToken(KEY, { ...BASE, iat: 1.5 }), refused);
  assert.throws(() => mintToken(KEY, { ...BASE, exp: Number.MAX_SAFE_INTEGER + 2 }), refused);
});

void test("a minted token is accepted by verify for a lifetime of 1 s and of 86400 s", () => {
  assert.equal(refusalOf(verify(mintToken(KEY, { ...BASE, iat: NOW, exp: NOW + 1 }))), "accepted");
  assert.equal(refusalOf(verify(mintToken(KEY, { ...BASE, iat: NOW, exp: NOW + 86400 }))), "accepted");
});

void test("a lookup that throws, or returns a key of the wrong size, is an unknown kid", () => {
  assert.equal(
    refusalOf(
      verify(GOOD, {
        lookup: () => {
          throw new Error("boom");
        },
      }),
    ),
    "unknown-kid",
  );
  assert.equal(refusalOf(verify(GOOD, { lookup: () => KEY.subarray(0, 31) })), "unknown-kid");
});

void test("a failed verify result carries neither the key, the token text nor the payload text", () => {
  const payloadText = Buffer.from(GOOD_PARTS.payload, "base64url").toString("utf8");
  const forbidden = [
    KEY.toString("base64url"),
    KEY.toString("hex"),
    KEY.toString("base64"),
    GOOD,
    GOOD_PARTS.payload,
    GOOD_PARTS.tag,
    payloadText,
  ];
  for (const row of ROWS) {
    const result = verify(row.text, row.context);
    if (result.ok) {
      continue;
    }
    const json = JSON.stringify(result);
    for (const text of forbidden) {
      assert.equal(json.includes(text), false, `${row.name} leaks`);
    }
  }
  const contexts: readonly Context[] = [{ sid: "s2" }, { capability: "fs.write" }, { now: NOW + 7200 }];
  for (const context of contexts) {
    const json = JSON.stringify(verify(GOOD, context));
    for (const text of forbidden) {
      assert.equal(json.includes(text), false);
    }
  }
});

void test("a good result carries only the claims, never the key", () => {
  const json = JSON.stringify(verify(GOOD));
  assert.equal(json.includes(KEY.toString("base64url")), false);
  assert.equal(json.includes(KEY.toString("hex")), false);
});

void test("every single-character substitution of a valid token is refused (property)", () => {
  assertProperty(
    fc.property(fc.nat({ max: GOOD.length - 1 }), fc.nat({ max: ALPHABET.length - 1 }), (position, pick) => {
      const replacement = ALPHABET.charAt(pick);
      if (replacement === GOOD.charAt(position)) {
        return;
      }
      const mutated = GOOD.slice(0, position) + replacement + GOOD.slice(position + 1);
      assert.equal(verify(mutated).ok, false, `accepted a substitution at ${String(position)}`);
    }),
    { numRuns: 2000 },
  );
});

void test("every single-character deletion of a valid token is refused (property)", () => {
  assertProperty(
    fc.property(fc.nat({ max: GOOD.length - 1 }), (position) => {
      const mutated = GOOD.slice(0, position) + GOOD.slice(position + 1);
      assert.equal(verify(mutated).ok, false, `accepted a deletion at ${String(position)}`);
    }),
    { numRuns: 500 },
  );
});

void test("exhaustively, no substitution at any position with any base64url character is accepted", () => {
  for (let position = 0; position < GOOD.length; position += 1) {
    for (const replacement of ALPHABET) {
      if (replacement === GOOD.charAt(position)) {
        continue;
      }
      const mutated = GOOD.slice(0, position) + replacement + GOOD.slice(position + 1);
      assert.equal(verify(mutated).ok, false, `accepted a substitution at ${String(position)}`);
    }
  }
});

void test("exhaustively, no single-character deletion is accepted", () => {
  for (let position = 0; position < GOOD.length; position += 1) {
    assert.equal(verify(GOOD.slice(0, position) + GOOD.slice(position + 1)).ok, false);
  }
});
