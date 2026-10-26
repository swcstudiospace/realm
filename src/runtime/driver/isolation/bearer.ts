// The supervisor bearer check for the isolation backend (phase 9.5, PRD-ISO-02, PRD-ISO-03).
//
// The supervisor presents a gateway-minted sandbox session token as `authorization: Bearer <token>` on a Sandbox Protocol
// stream. The keys that verify it are the verification keys of that sandbox's launch material (launch.ts), stored at create.
// The token's header kid selects one of them by key id, as the gateway's SessionJwtVerifier does (crates/openshell-core/src/jwt.rs,
// SessionJwtVerifier::verify). The driver's gateway id is the issuer pin: the token's issuer must be exactly
// `openshell-gateway:<gateway id>`. The claim rules mirror the gateway's sandbox profile: the same header type, audience, subject,
// claim set and lifetime bounds.
//
// The algorithm is pinned to EdDSA by an exact match on the header, so "none", HMAC, and any other algorithm fail before a
// signature is read. Every key is an Ed25519 public key; node:crypto verifies with the key the kid selects and never with a key
// the token names. Every refusal is an UNAUTHENTICATED status with a fixed reason. No reason carries a token, a claim value or a
// key.

import { createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";
import { status, type Metadata } from "@grpc/grpc-js";
import { makeRealmError } from "../../../core/errors.js";
import { DriverStatusError } from "../grpc-status.js";
import { GATEWAY_ID_PATTERN } from "../../gateway-config.js";

export const SANDBOX_SESSION_JWT_TYPE = "openshell-sandbox-session+jwt";
export const SANDBOX_SESSION_AUDIENCE = "openshell-sandbox";
const GATEWAY_ISSUER_PREFIX = "openshell-gateway:";
const SANDBOX_SUBJECT_PREFIX = "spiffe://openshell/sandbox/";
const SUPERVISOR_COMPONENT = "openshell-supervisor";
const ALGORITHM = "EdDSA";
const PEM_PUBLIC_KEY_HEADER = "-----BEGIN PUBLIC KEY-----";
// The gateway's bounds: a token issued up to 30 seconds ahead of this clock is accepted, and its lifetime is at most one hour.
const CLOCK_LEEWAY_SECONDS = 30;
const MAX_LIFETIME_SECONDS = 3600;
// The gateway's runtime generation is at most 64 lowercase letters, digits or hyphens.
const GENERATION_PATTERN = /^[a-z0-9-]{1,64}$/;
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

// One verification key of a sandbox's launch material: the key id the gateway assigned and the PEM public key it names.
export interface VerificationKey {
  readonly keyId: string;
  readonly publicKeyPem: Uint8Array;
}

// The verifier of one sandbox's bearers, or undefined when the sandbox holds no launch material.
export type VerifierLookup = (sandboxId: string) => SupervisorBearerVerifier | undefined;

type Json = Readonly<Record<string, unknown>>;

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

// Verifies a bearer with the launch keys of the sandbox it names. The name is read from the unverified payload only to choose
// the keys; the verified claims must then name the same sandbox, and the signature must check under a key the header's kid
// selects. A sandbox with no usable launch material is refused, and nothing else is read.
export function verifyBearer(lookup: VerifierLookup, token: string, nowSeconds?: number): SupervisorSession {
  const sandboxId = claimedSandboxId(token);
  let verifier: SupervisorBearerVerifier | undefined;
  try {
    verifier = lookup(sandboxId);
  } catch {
    throw unauthenticated("the sandbox has no usable launch material");
  }
  if (verifier === undefined) {
    throw unauthenticated("the sandbox has no launch material");
  }
  return verifier.verify(token, nowSeconds);
}

// Verifies tokens with one sandbox's launch keys, pinned to the gateway the driver serves.
export class SupervisorBearerVerifier {
  private readonly keys: ReadonlyMap<string, KeyObject>;
  private readonly issuer: string;

  // Accepts the verification keys of one sandbox's launch material and the gateway id the driver is pinned to. A key that is
  // not a PEM Ed25519 public key, a duplicate key id, no keys, or a gateway id outside the configured form fails with
  // SCHEMA_INVALID and names none of the input.
  constructor(keys: readonly VerificationKey[], gatewayId: string) {
    if (!GATEWAY_ID_PATTERN.test(gatewayId)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    this.keys = parseVerificationKeys(keys);
    this.issuer = `${GATEWAY_ISSUER_PREFIX}${gatewayId}`;
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
    const key = typeof header.kid === "string" ? this.keys.get(header.kid) : undefined;
    if (key === undefined) {
      throw unauthenticated("the supervisor bearer is not signed by a launch key of this sandbox");
    }
    const signed = Buffer.from(`${headerSegment}.${payloadSegment}`, "utf8");
    const signature = Buffer.from(signatureSegment, "base64url");
    if (!verifySignature(null, signed, key, signature)) {
      throw unauthenticated("the supervisor bearer is not signed by a launch key of this sandbox");
    }
    return checkClaims(parseObject(payloadSegment), this.issuer, nowSeconds);
  }
}

// Parses each key's PEM as an Ed25519 public key. The key ids must be distinct, and there must be at least one key.
export function parseVerificationKeys(keys: readonly VerificationKey[]): ReadonlyMap<string, KeyObject> {
  if (keys.length === 0) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const parsed = new Map<string, KeyObject>();
  for (const key of keys) {
    const text = Buffer.from(key.publicKeyPem).toString("utf8");
    if (!text.includes(PEM_PUBLIC_KEY_HEADER)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    let object: KeyObject;
    try {
      object = createPublicKey({ key: text, format: "pem", type: "spki" });
    } catch {
      throw makeRealmError("SCHEMA_INVALID");
    }
    if (object.type !== "public" || object.asymmetricKeyType !== "ed25519" || parsed.has(key.keyId)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    parsed.set(key.keyId, object);
  }
  return parsed;
}

// The sandbox id the payload names, read before the signature is checked. It is used only to choose the launch keys.
function claimedSandboxId(token: string): string {
  const payload = token.split(".")[1];
  if (payload === undefined || !BASE64URL_PATTERN.test(payload)) {
    throw unauthenticated("the supervisor bearer is malformed");
  }
  const sandboxId = parseObject(payload).sandbox_id;
  if (typeof sandboxId !== "string" || sandboxId === "" || WHITESPACE_PATTERN.test(sandboxId)) {
    throw unauthenticated("the supervisor bearer has an invalid sandbox identity");
  }
  return sandboxId;
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
// token id, and the issued-at and expiry bounds. The issuer must equal the configured gateway's issuer exactly.
function checkClaims(claims: Json, issuer: string, nowSeconds: number): SupervisorSession {
  for (const name of Object.keys(claims)) {
    if (!Object.hasOwn(CLAIM_NAMES, name)) {
      throw unauthenticated("the supervisor bearer carries a claim that is not accepted");
    }
  }
  if (claims.iss !== issuer) {
    throw unauthenticated("the supervisor bearer was not issued by this gateway");
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
