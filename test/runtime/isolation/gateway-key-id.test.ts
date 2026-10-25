// The key identifier the bearer check expects, pinned to a value the gateway itself wrote. The public key and its kid come from
// `openshell-gateway generate-certs --output-dir`, so this test does not compare the verifier with a copy of its own rule.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { gatewayKeyId } from "../../../src/runtime/driver/isolation/bearer.js";

// jwt/public.pem and jwt/kid from one gateway-generated PKI. The kid is the hex of the first 16 bytes of SHA-256 over the
// SubjectPublicKeyInfo DER of the key.
const GATEWAY_PUBLIC_PEM = [
  "-----BEGIN PUBLIC KEY-----",
  "MCowBQYDK2VwAyEAckUpfL+yfZnuBtogz8jhcmFgtCkbDu2VfsPBU3S5C6w=",
  "-----END PUBLIC KEY-----",
  "",
].join("\n");
const GATEWAY_KID = "4c843348e0667a1dc0642beff403ae53";

void test("PRD-ISO-02: the key identifier of the gateway's own public key is the kid the gateway wrote for it", () => {
  assert.equal(gatewayKeyId(createPublicKey(GATEWAY_PUBLIC_PEM)), GATEWAY_KID);
});
