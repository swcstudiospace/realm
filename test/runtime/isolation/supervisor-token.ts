// Test fixtures for the supervisor bearer: a gateway-style Ed25519 key, and tokens minted with the gateway's header and claim
// shape. The negative cases build their tokens by hand, so a refusal does not depend on the verifier's own code.

import { createHmac, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { gatewayKeyId } from "../../../src/runtime/driver/isolation/bearer.js";

export const SANDBOX_TOKEN_TYPE = "openshell-sandbox-session+jwt";
export const SANDBOX_AUDIENCE = "openshell-sandbox";
export const SANDBOX_ID = "sandbox-a";
export const GENERATION_ID = "generation-1";

export interface GatewayKey {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  readonly publicPem: Uint8Array;
}

export function generateGatewayKey(): GatewayKey {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ format: "pem", type: "spki" });
  return { privateKey, publicKey, publicPem: Buffer.from(publicPem as string, "utf8") };
}

// The claims a valid supervisor bearer carries at the given time. A test overrides one claim to make one refusal.
export function sandboxClaims(nowSeconds: number, overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    iss: "openshell-gateway:gateway-1",
    sub: `spiffe://openshell/sandbox/${SANDBOX_ID}`,
    aud: SANDBOX_AUDIENCE,
    iat: nowSeconds - 10,
    exp: nowSeconds + 600,
    jti: "0b6a6d2e-3f7a-4c1e-9d55-2f8e1a7b9c01",
    sandbox_id: SANDBOX_ID,
    runtime_generation: GENERATION_ID,
    auth_epoch: 1,
    component: "openshell-supervisor",
    ...overrides,
  };
}

// The header a gateway-minted sandbox token carries under the given key.
export function sandboxHeader(key: GatewayKey, overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { alg: "EdDSA", typ: SANDBOX_TOKEN_TYPE, kid: gatewayKeyId(key.publicKey), ...overrides };
}

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

// A token signed by the key. A claim whose override is undefined is removed from the payload.
export function signedToken(
  key: GatewayKey,
  claims: Readonly<Record<string, unknown>>,
  header: Readonly<Record<string, unknown>> = sandboxHeader(key),
): string {
  const signingInput = `${encodeSegment(header)}.${encodeSegment(claims)}`;
  const signature = sign(null, Buffer.from(signingInput, "utf8"), key.privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

// A token with an empty signature segment, for the "none" algorithm case.
export function unsignedToken(claims: Readonly<Record<string, unknown>>, header: Readonly<Record<string, unknown>>): string {
  return `${encodeSegment(header)}.${encodeSegment(claims)}.`;
}

// A token whose HMAC key is the gateway's public PEM, the classic algorithm-confusion attempt.
export function hmacTokenWithPublicKey(key: GatewayKey, claims: Readonly<Record<string, unknown>>): string {
  const header = sandboxHeader(key, { alg: "HS256" });
  const signingInput = `${encodeSegment(header)}.${encodeSegment(claims)}`;
  const signature = createHmac("sha256", key.publicPem).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
