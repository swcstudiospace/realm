// Capability token (CAPT-02, D-32-03): rcap1.PAYLOAD.MAC, minted and verified with Node built-ins only.
//
// Wire form: the prefix rcap1, a dot, base64url of the payload bytes, a dot, base64url of the MAC. The payload
// is a JSON object with exactly the keys v, kid, sid, host, caps, iat, exp in that order. The MAC is
// HMAC-SHA256 over the domain separator, a zero byte and the payload bytes, keyed by the key named by kid.
//
// verifyToken runs a fixed order (format, kid known, MAC, payload schema, version, time window, session,
// capability), so a refusal is deterministic. The refusal classes are internal names. A later layer maps every
// one of them to POLICY_DENIED and puts no class on the wire.
//
// Privacy rule: nothing here logs, and no result, error or refusal carries the key, the token text or the payload
// text. This module imports no audit code (the audit module imports core only).

import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
import { makeRealmError } from "../core/errors.js";
import { integrationCeiling } from "../host/capabilities.js";
import { HOST_IDS, type HostCapability, type HostId } from "../host/types.js";

export const TOKEN_PREFIX = "rcap1";

// The six capabilities of the mcp-config ceiling. The runtime list is read from the host layer, so the token, the
// policy schema and the host layer cannot drift; the type excludes the three capabilities outside that ceiling.
export type TokenCapability = Exclude<HostCapability, "net.egress" | "credential.read" | "host.tools.restrict">;

const CEILING: ReadonlySet<HostCapability> = new Set(integrationCeiling("mcp-config"));

function isTokenCapability(value: HostCapability): value is TokenCapability {
  return CEILING.has(value);
}

// UTF-16 code unit order, the order the payload schema demands of caps.
function byCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export const TOKEN_CAPABILITIES: readonly TokenCapability[] = Object.freeze(
  integrationCeiling("mcp-config")
    .filter(isTokenCapability)
    .sort(byCodeUnit),
);

export interface TokenClaims {
  readonly v: 1;
  readonly kid: string;
  readonly sid: string;
  readonly host: HostId;
  readonly caps: readonly TokenCapability[];
  readonly iat: number;
  readonly exp: number;
}

// What a caller gives mintToken: v is always 1 and caps are sorted by the minter.
export type MintClaims = Omit<TokenClaims, "v">;

// Internal names, never on the wire.
export type RefusalClass =
  | "format"
  | "unknown-kid"
  | "bad-mac"
  | "bad-payload"
  | "bad-version"
  | "time-window"
  | "wrong-session"
  | "capability-not-granted";

// The host and key id of a token whose MAC and payload schema both passed, so both are authentic.
export interface TokenPrincipal {
  readonly host: HostId;
  readonly kid: string;
}

export type VerifyResult =
  | { readonly ok: true; readonly claims: TokenClaims }
  | { readonly ok: false; readonly refusal: RefusalClass; readonly principal?: TokenPrincipal };

// A key lookup from kid. undefined stands for an unknown kid and for a revoked one.
export type KeyLookup = (kid: string) => Uint8Array | undefined;

export const KEY_BYTES = 32;

// A frozen string, as a Buffer cannot be frozen. The text is the bytes realm-capt-v1 and a zero byte.
const MAC_DOMAIN = "realm-capt-v1\u0000";
const FIELD_ORDER = Object.freeze(["v", "kid", "sid", "host", "caps", "iat", "exp"]);
const KID_PATTERN = /^[a-z0-9]{1,16}$/;
// The audit module's safe session id pattern (SAFE_SESSION_ID in src/audit/log.ts), duplicated here on purpose.
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const BASE64URL_ALPHABET = /^[A-Za-z0-9_-]+$/;
const CLOCK_SKEW_SECONDS = 60;
const MAX_LIFETIME_SECONDS = 86400;

interface Fields {
  readonly v: number;
  readonly kid: string;
  readonly sid: string;
  readonly host: HostId;
  readonly caps: readonly TokenCapability[];
  readonly iat: number;
  readonly exp: number;
}

function macOf(key: Uint8Array, payload: Uint8Array): Buffer {
  return createHmac("sha256", key).update(MAC_DOMAIN).update(payload).digest();
}

// Strict base64url: the alphabet only, and the decoded bytes must re-encode to the same text.
function decodeStrict(text: string): Buffer | null {
  if (!BASE64URL_ALPHABET.test(text)) {
    return null;
  }
  const bytes = Buffer.from(text, "base64url");
  return bytes.toString("base64url") === text ? bytes : null;
}

// Sorted and unique, every member inside the six.
function capsOf(value: unknown): readonly TokenCapability[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items: readonly unknown[] = value;
  const caps: TokenCapability[] = [];
  for (const item of items) {
    const capability = TOKEN_CAPABILITIES.find((known) => known === item);
    const previous = caps.at(-1);
    if (capability === undefined || (previous !== undefined && previous >= capability)) {
      return null;
    }
    caps.push(capability);
  }
  return caps;
}

// The payload schema stage: exactly the seven keys in order, and a valid value for each. The version is checked
// for its type only; a version other than 1 is its own stage.
function fieldsOf(record: Readonly<Record<string, unknown>>): Fields | null {
  const keys = Object.keys(record);
  if (keys.length !== FIELD_ORDER.length || !FIELD_ORDER.every((name, index) => keys[index] === name)) {
    return null;
  }
  const { v, kid, sid, host: hostValue, caps: capsValue, iat, exp } = record;
  const host = HOST_IDS.find((id) => id === hostValue);
  const caps = capsOf(capsValue);
  if (
    typeof v !== "number" ||
    !Number.isSafeInteger(v) ||
    typeof kid !== "string" ||
    !KID_PATTERN.test(kid) ||
    typeof sid !== "string" ||
    !SESSION_ID_PATTERN.test(sid) ||
    host === undefined ||
    caps === null ||
    typeof iat !== "number" ||
    !Number.isSafeInteger(iat) ||
    typeof exp !== "number" ||
    !Number.isSafeInteger(exp)
  ) {
    return null;
  }
  return { v, kid, sid, host, caps, iat, exp };
}

function plainObject(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Readonly<Record<string, unknown>>;
}

// Signs the claims. caps are sorted here; a claim set the schema stage would refuse (an unknown host or
// capability, a duplicate, a bad kid or session id, a non-integer time, a key that is not 32 bytes) is
// SCHEMA_INVALID, so a minted token is always schema-valid. Lifetime is the caller's business: the time window is
// a verify-time stage.
export function mintToken(key: Uint8Array, claims: MintClaims): string {
  if (key.length !== KEY_BYTES) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const sorted = [...claims.caps].sort(byCodeUnit);
  const record = { v: 1, kid: claims.kid, sid: claims.sid, host: claims.host, caps: sorted, iat: claims.iat, exp: claims.exp };
  if (fieldsOf(record) === null) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const payload = Buffer.from(JSON.stringify(record), "utf8");
  return `${TOKEN_PREFIX}.${payload.toString("base64url")}.${macOf(key, payload).toString("base64url")}`;
}

function refuse(refusal: RefusalClass, principal?: TokenPrincipal): VerifyResult {
  return principal === undefined ? { ok: false, refusal } : { ok: false, refusal, principal };
}

// Verifies text for the expected session and the capability the call needs (null when it needs none), at
// nowSeconds. Never throws, never returns the key. A refusal after the MAC and schema stages carries the
// authentic host and kid; an earlier one carries none.
export function verifyToken(
  text: unknown,
  lookup: KeyLookup,
  sessionId: string,
  needed: TokenCapability | null,
  nowSeconds: number,
): VerifyResult {
  // Stage 1: format.
  const parts = typeof text === "string" ? text.split(".") : [];
  const [prefix, payloadText, tagText] = parts;
  if (parts.length !== 3 || prefix !== TOKEN_PREFIX || payloadText === undefined || tagText === undefined) {
    return refuse("format");
  }
  const payload = decodeStrict(payloadText);
  const tag = decodeStrict(tagText);
  if (payload === null || tag === null || tag.length !== KEY_BYTES) {
    return refuse("format");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString("utf8"));
  } catch {
    return refuse("format");
  }
  const record = plainObject(parsed);
  const kid = record?.["kid"];
  if (record === null || typeof kid !== "string") {
    return refuse("format");
  }
  // Stage 2: kid known and not revoked. A lookup that throws or returns a key of the wrong size is an unknown kid.
  let key: Uint8Array | undefined;
  try {
    key = lookup(kid);
  } catch {
    return refuse("unknown-kid");
  }
  if (key?.length !== KEY_BYTES) {
    return refuse("unknown-kid");
  }
  // Stage 3: MAC, computed once, compared in constant time.
  if (!timingSafeEqual(macOf(key, payload), tag)) {
    return refuse("bad-mac");
  }
  // Stage 4: payload schema.
  const fields = fieldsOf(record);
  if (fields === null) {
    return refuse("bad-payload");
  }
  // From here on the MAC and the schema passed, so the host and kid are authentic.
  const principal: TokenPrincipal = { host: fields.host, kid: fields.kid };
  // Stage 5: version.
  if (fields.v !== 1) {
    return refuse("bad-version", principal);
  }
  // Stage 6: time window. iat may lead the clock by the skew; exp allows none and is exclusive.
  const lifetime = fields.exp - fields.iat;
  if (
    fields.iat > nowSeconds + CLOCK_SKEW_SECONDS ||
    fields.exp <= nowSeconds ||
    lifetime < 1 ||
    lifetime > MAX_LIFETIME_SECONDS
  ) {
    return refuse("time-window", principal);
  }
  // Stage 7: session binding.
  if (fields.sid !== sessionId) {
    return refuse("wrong-session", principal);
  }
  // Stage 8: capability.
  if (needed !== null && !fields.caps.includes(needed)) {
    return refuse("capability-not-granted", principal);
  }
  return {
    ok: true,
    claims: {
      v: 1,
      kid: fields.kid,
      sid: fields.sid,
      host: fields.host,
      caps: fields.caps,
      iat: fields.iat,
      exp: fields.exp,
    },
  };
}
