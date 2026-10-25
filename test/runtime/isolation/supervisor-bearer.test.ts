// Behaviour of the supervisor bearer check: a valid gateway token verifies to its sandbox identity, and each refused shape fails
// UNAUTHENTICATED (or SCHEMA_INVALID for a key that is not an Ed25519 public key or a gateway id that is not the configured form).
// No test reads the source text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { Metadata, status } from "@grpc/grpc-js";
import { RealmError } from "../../../src/core/errors.js";
import { DriverStatusError } from "../../../src/runtime/driver/grpc-status.js";
import { SupervisorBearerVerifier, bearerFromMetadata } from "../../../src/runtime/driver/isolation/bearer.js";
import {
  GATEWAY_ID,
  GENERATION_ID,
  SANDBOX_ID,
  generateGatewayKey,
  hmacTokenWithPublicKey,
  nowSeconds,
  sandboxClaims,
  sandboxHeader,
  signedToken,
  unsignedToken,
  type GatewayKey,
} from "./supervisor-token.js";

function unauthenticated(error: unknown): boolean {
  return error instanceof DriverStatusError && error.failure.code === status.UNAUTHENTICATED;
}

function schemaInvalid(error: unknown): boolean {
  return error instanceof RealmError && error.code === "SCHEMA_INVALID";
}

// One verifier per key, pinned to the realm's gateway id, so every case verifies against the gateway key the token claims to come from.
function verifierFor(key: GatewayKey): SupervisorBearerVerifier {
  return new SupervisorBearerVerifier(key.publicPem, GATEWAY_ID);
}

function metadataWith(...values: readonly string[]): Metadata {
  const metadata = new Metadata();
  for (const value of values) {
    metadata.add("authorization", value);
  }
  return metadata;
}

// Changes one signature character between two values that decode to different bytes.
function flipSignature(token: string): string {
  return token.slice(0, -2) + (token.slice(-2, -1) === "A" ? "B" : "A") + token.slice(-1);
}

void test("PRD-ISO-02: a gateway-minted sandbox token verifies to the sandbox identity it names", () => {
  const key = generateGatewayKey();
  const now = nowSeconds();
  const session = verifierFor(key).verify(signedToken(key, sandboxClaims(now)), now);
  assert.equal(session.sandboxId, SANDBOX_ID);
  assert.equal(session.runtimeGeneration, GENERATION_ID);
  assert.equal(session.authEpoch, 1);
  assert.equal(session.tokenId, "0b6a6d2e-3f7a-4c1e-9d55-2f8e1a7b9c01");
  assert.equal(session.issuedAt, now - 10);
  assert.equal(session.expiresAt, now + 600);
});

void test("PRD-ISO-02: a token with an altered payload fails the signature check", () => {
  const key = generateGatewayKey();
  const now = nowSeconds();
  const [header = "", , signature = ""] = signedToken(key, sandboxClaims(now)).split(".");
  const forgedClaims = sandboxClaims(now, { sandbox_id: "sandbox-b", sub: "spiffe://openshell/sandbox/sandbox-b" });
  const forged = Buffer.from(JSON.stringify(forgedClaims), "utf8").toString("base64url");
  assert.throws(() => verifierFor(key).verify(`${header}.${forged}.${signature}`, now), unauthenticated);
});

void test("PRD-ISO-02: a token with a flipped signature byte fails", () => {
  const key = generateGatewayKey();
  const now = nowSeconds();
  assert.throws(() => verifierFor(key).verify(flipSignature(signedToken(key, sandboxClaims(now))), now), unauthenticated);
});

void test('PRD-ISO-02: the "none" algorithm is refused, whether or not the signature segment is empty', () => {
  const key = generateGatewayKey();
  const now = nowSeconds();
  const header = sandboxHeader(key, { alg: "none" });
  const unsigned = unsignedToken(sandboxClaims(now), header);
  assert.throws(() => verifierFor(key).verify(unsigned, now), unauthenticated);
  assert.throws(() => verifierFor(key).verify(`${unsigned}x`, now), unauthenticated);
});

void test("PRD-ISO-02: an HMAC token keyed with the gateway public key is refused (algorithm confusion)", () => {
  const key = generateGatewayKey();
  const now = nowSeconds();
  assert.throws(() => verifierFor(key).verify(hmacTokenWithPublicKey(key, sandboxClaims(now)), now), unauthenticated);
});

void test("PRD-ISO-02: a token of the gateway profile, not the sandbox profile, is refused", () => {
  const key = generateGatewayKey();
  const now = nowSeconds();
  const header = sandboxHeader(key, { typ: "openshell-gateway-session+jwt" });
  assert.throws(() => verifierFor(key).verify(signedToken(key, sandboxClaims(now), header), now), unauthenticated);
});

void test("PRD-ISO-02: a token whose kid is not the gateway key identifier is refused", () => {
  const key = generateGatewayKey();
  const now = nowSeconds();
  const header = sandboxHeader(key, { kid: "0".repeat(32) });
  assert.throws(() => verifierFor(key).verify(signedToken(key, sandboxClaims(now), header), now), unauthenticated);
});

void test("PRD-ISO-02: a token signed by a different key is refused", () => {
  const trusted = generateGatewayKey();
  const other = generateGatewayKey();
  const now = nowSeconds();
  const header = sandboxHeader(other, { kid: sandboxHeader(trusted).kid });
  assert.throws(() => verifierFor(trusted).verify(signedToken(other, sandboxClaims(now), header), now), unauthenticated);
});

void test("PRD-ISO-02: an expired token is refused", () => {
  const key = generateGatewayKey();
  const now = nowSeconds();
  const claims = sandboxClaims(now, { iat: now - 3700, exp: now - 100 });
  assert.throws(() => verifierFor(key).verify(signedToken(key, claims), now), unauthenticated);
});

void test("PRD-ISO-02: a token issued in the future, beyond the 30 second leeway, is refused", () => {
  const key = generateGatewayKey();
  const now = nowSeconds();
  const claims = sandboxClaims(now, { iat: now + 60, exp: now + 600 });
  assert.throws(() => verifierFor(key).verify(signedToken(key, claims), now), unauthenticated);
});

void test("PRD-ISO-02: a token lasting longer than one hour, or without a positive expiry, is refused", () => {
  const key = generateGatewayKey();
  const now = nowSeconds();
  assert.throws(() => verifierFor(key).verify(signedToken(key, sandboxClaims(now, { exp: now + 7200 })), now), unauthenticated);
  assert.throws(() => verifierFor(key).verify(signedToken(key, sandboxClaims(now, { exp: 0 })), now), unauthenticated);
});

void test("PRD-ISO-02: a token whose audience is not the sandbox audience is refused", () => {
  const key = generateGatewayKey();
  const now = nowSeconds();
  for (const aud of ["openshell-gateway", "openshell-gateway:realm", ["openshell-sandbox"], undefined]) {
    assert.throws(() => verifierFor(key).verify(signedToken(key, sandboxClaims(now, { aud })), now), unauthenticated);
  }
});

void test("PRD-ISO-02: a token whose issuer is not exactly this gateway's issuer is refused", () => {
  const key = generateGatewayKey();
  const now = nowSeconds();
  const issuers = [
    "other:realm",
    "openshell-gateway:",
    "openshell-gateway:other",
    "openshell-gateway:REALM",
    "openshell-gateway:realm ",
    "openshell-gateway:realm/extra",
    "openshell-gateway:realm:extra",
    "openshell-gateway:realm2",
  ];
  for (const iss of issuers) {
    assert.throws(() => verifierFor(key).verify(signedToken(key, sandboxClaims(now, { iss })), now), unauthenticated, iss);
  }
});

void test("PRD-ISO-02: a bearer minted for another gateway id is refused, and verifies only for the gateway it names", () => {
  const key = generateGatewayKey();
  const now = nowSeconds();
  const otherGateway = sandboxClaims(now, { iss: "openshell-gateway:other" });
  assert.throws(() => verifierFor(key).verify(signedToken(key, otherGateway), now), unauthenticated);
  const pinnedToOther = new SupervisorBearerVerifier(key.publicPem, "other");
  assert.equal(pinnedToOther.verify(signedToken(key, otherGateway), now).sandboxId, SANDBOX_ID);
});

void test("PRD-ISO-02: a token from another issuer, or a subject that names another sandbox, is refused", () => {
  const key = generateGatewayKey();
  const now = nowSeconds();
  assert.throws(() => verifierFor(key).verify(signedToken(key, sandboxClaims(now, { iss: "other:realm" })), now), unauthenticated);
  assert.throws(() => verifierFor(key).verify(signedToken(key, sandboxClaims(now, { iss: "openshell-gateway:" })), now), unauthenticated);
  assert.throws(
    () => verifierFor(key).verify(signedToken(key, sandboxClaims(now, { sub: "spiffe://openshell/sandbox/sandbox-b" })), now),
    unauthenticated,
  );
});

void test("PRD-ISO-02: a token that carries a claim outside the gateway's set is refused", () => {
  const key = generateGatewayKey();
  const now = nowSeconds();
  assert.throws(() => verifierFor(key).verify(signedToken(key, sandboxClaims(now, { extra: "x" })), now), unauthenticated);
});

void test("PRD-ISO-02: a token without its component, sandbox identity, generation, epoch or token id is refused", () => {
  const key = generateGatewayKey();
  const now = nowSeconds();
  for (const name of ["component", "sandbox_id", "runtime_generation", "jti", "auth_epoch"]) {
    assert.throws(
      () => verifierFor(key).verify(signedToken(key, sandboxClaims(now, { [name]: undefined })), now),
      unauthenticated,
      name,
    );
  }
});

void test("PRD-ISO-02: a malformed token is refused", () => {
  const key = generateGatewayKey();
  const verifier = verifierFor(key);
  const now = nowSeconds();
  assert.throws(() => verifier.verify("not-a-token", now), unauthenticated);
  assert.throws(() => verifier.verify("a.b", now), unauthenticated);
  assert.throws(() => verifier.verify("a..c", now), unauthenticated);
  assert.throws(() => verifier.verify(`${signedToken(key, sandboxClaims(now))}=`, now), unauthenticated);
});

void test("PRD-ISO-02: the bearer is read from one Bearer authorization value with a single token", () => {
  const key = generateGatewayKey();
  const token = signedToken(key, sandboxClaims(nowSeconds()));
  assert.equal(bearerFromMetadata(metadataWith(`Bearer ${token}`)), token);
  assert.equal(bearerFromMetadata(metadataWith(`bearer   ${token}`)), token);
  assert.throws(() => bearerFromMetadata(metadataWith(`Basic ${token}`)), unauthenticated);
  assert.throws(() => bearerFromMetadata(metadataWith(token)), unauthenticated);
  assert.throws(() => bearerFromMetadata(metadataWith(`Bearer ${token} extra`)), unauthenticated);
  assert.throws(() => bearerFromMetadata(metadataWith("Bearer ")), unauthenticated);
  assert.throws(() => bearerFromMetadata(new Metadata()), unauthenticated);
});

void test("PRD-ISO-02: a duplicated authorization value is refused", () => {
  const key = generateGatewayKey();
  const token = signedToken(key, sandboxClaims(nowSeconds()));
  assert.throws(() => bearerFromMetadata(metadataWith(`Bearer ${token}`, `Bearer ${token}`)), unauthenticated);
});

void test("PRD-ISO-02: the verifier is built only from a PEM Ed25519 public key; anything else refuses with SCHEMA_INVALID", () => {
  const key = generateGatewayKey();
  assert.doesNotThrow(() => new SupervisorBearerVerifier(key.publicPem, GATEWAY_ID));
  const privatePem = key.privateKey.export({ format: "pem", type: "pkcs8" });
  assert.throws(() => new SupervisorBearerVerifier(Buffer.from(privatePem as string), GATEWAY_ID), schemaInvalid);
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rsaPem = rsa.publicKey.export({ format: "pem", type: "spki" });
  assert.throws(() => new SupervisorBearerVerifier(Buffer.from(rsaPem as string), GATEWAY_ID), schemaInvalid);
  assert.throws(() => new SupervisorBearerVerifier(new Uint8Array(), GATEWAY_ID), schemaInvalid);
  assert.throws(() => new SupervisorBearerVerifier(Buffer.from("not a key"), GATEWAY_ID), schemaInvalid);
});

void test("PRD-ISO-02: the verifier refuses a gateway id that is missing or outside the configured form, with SCHEMA_INVALID", () => {
  const key = generateGatewayKey();
  for (const gatewayId of ["", "-realm", "realm name", "realm/x", "a".repeat(65)]) {
    assert.throws(() => new SupervisorBearerVerifier(key.publicPem, gatewayId), schemaInvalid, gatewayId);
  }
});
