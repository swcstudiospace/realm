// Test fixtures for the supervisor bearer: a gateway-style Ed25519 key, the verification keys and launch material built from it,
// and tokens minted with the gateway's header and claim shape. The negative cases build their tokens by hand, so a refusal does
// not depend on the verifier's own code.

import { createHmac, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import type { BackendProvisioning } from "../../../src/runtime/driver/isolation/backend.js";
import { SupervisorBearerVerifier, type VerificationKey } from "../../../src/runtime/driver/isolation/bearer.js";

export const SANDBOX_TOKEN_TYPE = "openshell-sandbox-session+jwt";
export const SANDBOX_AUDIENCE = "openshell-sandbox";
export const SANDBOX_ID = "sandbox-a";
export const GENERATION_ID = "generation-1";
// The gateway id the realm's gateway configuration renders, and the one every verifier in these tests is pinned to.
export const GATEWAY_ID = "realm";
// The session the launch material names: a canonical lowercase non-nil UUID, as the gateway writes it.
export const LAUNCH_SESSION_ID = "5a3c1f7e-9b2d-4e8a-8c61-3d7f0e2b4a19";
// An expiry far beyond any test run, so the launch material never lapses during a test.
const FAR_FUTURE_SECONDS = 4102444800;

export interface GatewayKey {
  readonly keyId: string;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  readonly publicPem: Uint8Array;
}

// A fresh Ed25519 key. The key id defaults to one fixed value, so two keys made with the default share an id on purpose.
export function generateGatewayKey(keyId: string = "gateway-key-1"): GatewayKey {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ format: "pem", type: "spki" });
  return { keyId, privateKey, publicKey, publicPem: Buffer.from(publicPem as string, "utf8") };
}

// The verification key a launch body carries for the gateway key.
export function verificationKeyOf(key: GatewayKey): VerificationKey {
  return { keyId: key.keyId, publicKeyPem: key.publicPem };
}

// A verifier that holds the one key and is pinned to the gateway id.
export function verifierOf(key: GatewayKey, gatewayId: string = GATEWAY_ID): SupervisorBearerVerifier {
  return new SupervisorBearerVerifier([verificationKeyOf(key)], gatewayId);
}

// The provisioning a backend is started with: the key's verifier for one sandbox, and no verifier for any other.
export function provisioningFor(key: GatewayKey, sandboxId: string = SANDBOX_ID): BackendProvisioning {
  const verifier = verifierOf(key);
  return { verifierFor: (id: string) => (id === sandboxId ? verifier : undefined) };
}

// The claims a valid supervisor bearer carries at the given time. A test overrides one claim to make one refusal.
export function sandboxClaims(nowSeconds: number, overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    iss: `openshell-gateway:${GATEWAY_ID}`,
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

// The header a gateway-minted sandbox token carries under the given key: its kid names the key.
export function sandboxHeader(key: GatewayKey, overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { alg: "EdDSA", typ: SANDBOX_TOKEN_TYPE, kid: key.keyId, ...overrides };
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

// The supervisor half of a valid launch body: a session, its generation and rotation, the epoch, and two tokens that expire far
// in the future. An override replaces one field; an override of undefined removes it.
export function launchSupervisor(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    session_id: LAUNCH_SESSION_ID,
    runtime_generation: GENERATION_ID,
    session_rotation: 1,
    auth_epoch: 1,
    gateway_token: "gateway-token-1",
    gateway_expires_at: FAR_FUTURE_SECONDS,
    sandbox_token: "sandbox-token-1",
    sandbox_expires_at: FAR_FUTURE_SECONDS,
    ...overrides,
  };
}

// The gateway's JSON encoding of SandboxLaunchAuthentication for the key: the supervisor, the pinned gateway id, and the key as
// its PEM bytes. An override replaces a top-level field; an override of undefined removes it.
export function launchBody(key: GatewayKey, overrides: Readonly<Record<string, unknown>> = {}): Buffer {
  const body = {
    supervisor: launchSupervisor(),
    gateway_id: GATEWAY_ID,
    verification_keys: [{ key_id: key.keyId, public_key_pem: Array.from(key.publicPem) }],
    ...overrides,
  };
  return Buffer.from(JSON.stringify(body), "utf8");
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
