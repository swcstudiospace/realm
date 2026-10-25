// The supervisor bearer check for the isolation backend (phase 9.5, PRD-ISO-02, PRD-ISO-03).
//
// The supervisor presents a gateway-minted sandbox session token as `authorization: Bearer <token>` on a Sandbox Protocol
// stream. This module verifies it against the one gateway public key the driver was started with. It mirrors the gateway's
// sandbox-profile verifier (crates/openshell-core/src/jwt.rs, SessionJwtVerifier::verify and validate_claims) at the
// pinned source revision: the same header type, audience, subject, claim set and lifetime rules.
//
// The algorithm is pinned to EdDSA by an exact match on the header, so "none", HMAC, and any other algorithm fail before
// a signature is read. The key is an Ed25519 public key only; node:crypto verifies with that key's own algorithm and
// never with a key the token names. The key identifier is the gateway's: the first 16 bytes of SHA-256 over the public
// key's SubjectPublicKeyInfo DER, hex-encoded (crates/openshell-bootstrap/src/jwt.rs, kid_from_public_key_der). A token
// whose kid is not that identifier fails.
//
// Every refusal is an UNAUTHENTICATED status with a fixed reason. No reason carries a token, a claim value or a key.

import { createHash, createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";
import { status, type Metadata } from "@grpc/grpc-js";
import { makeRealmError } from "../../../core/errors.js";
import { DriverStatusError } from "../grpc-status.js";

export const SANDBOX_SESSION_JWT_TYPE = "openshell-sandbox-session+jwt";
export const SANDBOX_SESSION_AUDIENCE = "openshell-sandbox";
const GATEWAY_ISSUER_PREFIX = "openshell-gateway:";
const SANDBOX_SUBJECT_PREFIX = "spiffe://openshell/sandbox/";
const SUPERVISOR_COMPONENT = "openshell-supervisor";
const ALGORITHM = "EdDSA";
// The gateway's bounds: a token issued up to 30 seconds ahead of this clock is accepted, and its lifetime is at most one hour.
const CLOCK_LEEWAY_SECONDS = 30;
const MAX_LIFETIME_SECONDS = 3600;
// The gateway's runtime generation is at most 64 lowercase letters, digits or hyphens.
const GENERATION_PATTERN = /^[a-z0-9-]{1,64}$/;
const GATEWAY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const WHITESPACE_PATTERN = /\s/;
// The only claim names a token may carry. Any other name is refused, as the gateway's deny_unknown_fields does.
const CLAIM_NAMES: Readonly<Record<string, true>> = {
  iss: true,
  sub: true,
  aud: true,
  iat: true,
  exp: true,
  jti: true,
  sandbox_id: true,
  runtime_generation: true,
  auth_epoch: true,
  component: true,
};

// The identity a verified bearer proves. The caller compares it with the sandbox the boundary handle belongs to.
export interface SupervisorSession {
  readonly sandboxId: string;
  readonly runtimeGeneration: string;
  readonly authEpoch: number;
  readonly tokenId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

type Json = Readonly<Record<string, unknown>>;

// The gateway's key identifier for a public key: hex of the first 16 bytes of SHA-256 over its SPKI DER.
export function gatewayKeyId(publicKey: KeyObject): string {
  const der = publicKey.export({ format: "der", type: "spki" });
  return createHash("sha256").update(der).digest("hex").slice(0, 32);
}

// Reads the bearer from the call metadata. Exactly one authorization value is accepted, with the Bearer scheme, and its
// credential is one token with no whitespace, as the gateway's sandbox protocol reads it.
export function bearerFromMetadata(metadata: Metadata): string {
  const values = metadata.get("authorization");
  if (values.length === 0) {
    throw unauthenticated("the supervisor bearer is missing");
  }
  if (values.length > 1) {
    throw unauthenticated("the supervisor bearer is duplicated");
  }
  const value = String(values[0]);
  const space = value.indexOf(" ");
  if (space < 0 || value.slice(0, space).toLowerCase() !== "bearer") {
    throw unauthenticated("the supervisor bearer is malformed");
  }
  const token = value.slice(space + 1).replace(/^ +/, "");
  if (token === "" || WHITESPACE_PATTERN.test(token)) {
    throw unauthenticated("the supervisor bearer is malformed");
  }
  return token;
}

export class SupervisorBearerVerifier {
  private readonly publicKey: KeyObject;
  private readonly keyId: string;

  // Accepts only a PEM public key on an Ed25519 key. A private key, another algorithm, or unreadable content fails
  // startup with SCHEMA_INVALID and names none of the input.
  constructor(publicKeyPem: Uint8Array) {
    const text = Buffer.from(publicKeyPem).toString("utf8");
    if (!text.includes("-----BEGIN PUBLIC KEY-----")) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    let key: KeyObject;
    try {
      key = createPublicKey({ key: text, format: "pem", type: "spki" });
    } catch {
      throw makeRealmError("SCHEMA_INVALID");
    }
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
      throw makeRealmError("SCHEMA_INVALID");
    }
    this.publicKey = key;
    this.keyId = gatewayKeyId(key);
  }

  // Verifies one token at the given time (Unix seconds). Every failed check throws UNAUTHENTICATED and reads nothing else.
  verify(token: string, nowSeconds: number = Math.floor(Date.now() / 1000)): SupervisorSession {
    const segments = token.split(".");
    if (segments.length !== 3 || segments.some((segment) => segment === "" || !BASE64URL_PATTERN.test(segment))) {
      throw unauthenticated("the supervisor bearer is malformed");
    }
    const [headerSegment, payloadSegment, signatureSegment] = segments as [string, string, string];
    const header = parseObject(headerSegment);
    // The algorithm is pinned by exact match. "none" and any HMAC or RSA name fail here, before a signature is read.
    if (header.alg !== ALGORITHM) {
      throw unauthenticated("the supervisor bearer uses an algorithm that is not accepted");
    }
    if (header.typ !== SANDBOX_SESSION_JWT_TYPE) {
      throw unauthenticated("the supervisor bearer has the wrong token type");
    }
    if (header.kid !== this.keyId) {
      throw unauthenticated("the supervisor bearer is not signed by the gateway key");
    }
    const signed = Buffer.from(`${headerSegment}.${payloadSegment}`, "utf8");
    const signature = Buffer.from(signatureSegment, "base64url");
    if (!verifySignature(null, signed, this.publicKey, signature)) {
      throw unauthenticated("the supervisor bearer is not signed by the gateway key");
    }
    return checkClaims(parseObject(payloadSegment), nowSeconds);
  }
}

// Decodes one base64url JSON object. A segment that is not a JSON object is malformed.
function parseObject(segment: string): Json {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw unauthenticated("the supervisor bearer is malformed");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw unauthenticated("the supervisor bearer is malformed");
  }
  return value as Json;
}

// The claim rules of the gateway's sandbox profile: issuer, audience, subject, identity, generation, epoch, component,
// token id, and the issued-at and expiry bounds.
function checkClaims(claims: Json, nowSeconds: number): SupervisorSession {
  for (const name of Object.keys(claims)) {
    if (!Object.hasOwn(CLAIM_NAMES, name)) {
      throw unauthenticated("the supervisor bearer carries a claim that is not accepted");
    }
  }
  const issuer = claims.iss;
  if (typeof issuer !== "string" || !issuer.startsWith(GATEWAY_ISSUER_PREFIX)) {
    throw unauthenticated("the supervisor bearer was not issued by a gateway");
  }
  if (!GATEWAY_ID_PATTERN.test(issuer.slice(GATEWAY_ISSUER_PREFIX.length))) {
    throw unauthenticated("the supervisor bearer was not issued by a gateway");
  }
  if (claims.aud !== SANDBOX_SESSION_AUDIENCE) {
    throw unauthenticated("the supervisor bearer has the wrong audience");
  }
  const sandboxId = claims.sandbox_id;
  if (typeof sandboxId !== "string" || sandboxId === "" || WHITESPACE_PATTERN.test(sandboxId)) {
    throw unauthenticated("the supervisor bearer has an invalid sandbox identity");
  }
  if (claims.sub !== `${SANDBOX_SUBJECT_PREFIX}${sandboxId}`) {
    throw unauthenticated("the supervisor bearer subject does not match its sandbox");
  }
  const generation = claims.runtime_generation;
  if (typeof generation !== "string" || !GENERATION_PATTERN.test(generation)) {
    throw unauthenticated("the supervisor bearer has an invalid runtime generation");
  }
  const epoch = claims.auth_epoch;
  if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 1) {
    throw unauthenticated("the supervisor bearer has an invalid credential epoch");
  }
  if (claims.component !== SUPERVISOR_COMPONENT) {
    throw unauthenticated("the supervisor bearer is not issued to the supervisor");
  }
  const tokenId = claims.jti;
  if (typeof tokenId !== "string" || !UUID_PATTERN.test(tokenId)) {
    throw unauthenticated("the supervisor bearer has an invalid token id");
  }
  const issuedAt = claims.iat;
  const expiresAt = claims.exp;
  if (typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt)) {
    throw unauthenticated("the supervisor bearer has invalid timestamps");
  }
  if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt)) {
    throw unauthenticated("the supervisor bearer has invalid timestamps");
  }
  if (issuedAt > nowSeconds + CLOCK_LEEWAY_SECONDS) {
    throw unauthenticated("the supervisor bearer was issued in the future");
  }
  // An expiry of zero is refused here, although the gateway reads it as no expiry: this backend trusts only bearers that expire.
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_LIFETIME_SECONDS) {
    throw unauthenticated("the supervisor bearer has an invalid lifetime");
  }
  if (expiresAt < nowSeconds - CLOCK_LEEWAY_SECONDS) {
    throw unauthenticated("the supervisor bearer has expired");
  }
  return {
    sandboxId,
    runtimeGeneration: generation,
    authEpoch: epoch,
    tokenId,
    issuedAt,
    expiresAt,
  };
}

function unauthenticated(details: string): DriverStatusError {
  return new DriverStatusError({ code: status.UNAUTHENTICATED, details });
}
