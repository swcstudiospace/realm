// Behaviour of the launch-material decoder against the gateway's own encoding. The gateway's sample is accepted. The inputs where the
// decoder once differed from the gateway's serde types are decided as the gateway decides them, and each refusal logs one line with
// its RPC and check and no value. The inputs are made by editing the sample's text, so each one differs from the sample by one edit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError } from "../../../src/core/errors.js";
import { decodeLaunchAuthentication } from "../../../src/runtime/driver/isolation/launch.js";
import type { RefusalScope } from "../../../src/runtime/driver/refusal.js";
import { GATEWAY_LAUNCH_SAMPLE, GATEWAY_PUBLIC_KEY_PEM } from "./gateway-launch-sample.js";

const GATEWAY_ID = "realm";

// A scope that keeps each refusal line, for assertions.
function capturing(): { scope: RefusalScope; lines: string[] } {
  const lines: string[] = [];
  return { scope: { rpc: "CreateSandbox", log: (line) => lines.push(line) }, lines };
}

// The sample with one exact substring replaced. The substring must occur, so a test never passes against an unchanged body.
function sampleWith(find: string, replacement: string): Buffer {
  assert.ok(GATEWAY_LAUNCH_SAMPLE.includes(find), `the sample has no ${find}`);
  return Buffer.from(GATEWAY_LAUNCH_SAMPLE.replace(find, replacement), "utf8");
}

// Asserts the body is refused as SCHEMA_INVALID, with exactly one refusal line naming the check.
function assertRefused(body: Buffer, check: string): void {
  const { scope, lines } = capturing();
  assert.throws(
    () => decodeLaunchAuthentication(body, GATEWAY_ID, scope),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  assert.deepEqual(lines, [`realm compute driver refused: rpc=CreateSandbox check=${check} code=SCHEMA_INVALID`]);
}

// Asserts the body is accepted with the given key id, and logs nothing.
function assertAccepted(body: Buffer, keyId: string): void {
  const { scope, lines } = capturing();
  const launch = decodeLaunchAuthentication(body, GATEWAY_ID, scope);
  assert.equal(launch.gatewayId, GATEWAY_ID);
  assert.deepEqual(
    launch.verificationKeys.map((key) => key.keyId),
    [keyId],
  );
  assert.deepEqual(lines, []);
}

void test("PRD-ISO-02: the gateway's own launch body is accepted, with its gateway id and its public key", () => {
  const { scope, lines } = capturing();
  const launch = decodeLaunchAuthentication(Buffer.from(GATEWAY_LAUNCH_SAMPLE, "utf8"), GATEWAY_ID, scope);
  assert.equal(launch.gatewayId, GATEWAY_ID);
  assert.equal(launch.verificationKeys.length, 1);
  assert.equal(Buffer.from(launch.verificationKeys[0]?.publicKeyPem ?? []).toString("utf8"), GATEWAY_PUBLIC_KEY_PEM);
  assert.deepEqual(lines, []);
});

void test("PRD-ISO-02: a body that is not one JSON document is refused, as a body error", () => {
  assertRefused(Buffer.from(`${GATEWAY_LAUNCH_SAMPLE} trailing`, "utf8"), "launch.json");
  assertRefused(Buffer.from(GATEWAY_LAUNCH_SAMPLE.slice(0, -1), "utf8"), "launch.json");
});

void test("PRD-ISO-02: a body with a leading UTF-8 byte order mark is refused, as the gateway's parser refuses it", () => {
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  assertRefused(Buffer.concat([bom, Buffer.from(GATEWAY_LAUNCH_SAMPLE, "utf8")]), "launch.json");
});

void test("PRD-ISO-02: a body with a duplicate object key is refused, as serde refuses a duplicate field", () => {
  assertRefused(sampleWith('"gateway_id":"realm",', '"gateway_id":"realm","gateway_id":"realm",'), "launch.json");
});

void test("PRD-ISO-02: a raw control character in a string is refused, as serde refuses it", () => {
  assertRefused(sampleWith('"key_id":"key-1"', '"key_id":"key\u00011"'), "launch.json");
});

void test("PRD-ISO-02: a session_rotation written as a fraction is refused, as serde refuses a float for a u64", () => {
  assertRefused(sampleWith('"session_rotation":1,', '"session_rotation":1.0,'), "launch.session_rotation");
});

void test("PRD-ISO-02: a session_rotation written with an exponent is refused, as serde refuses it for a u64", () => {
  assertRefused(sampleWith('"session_rotation":1,', '"session_rotation":1e0,'), "launch.session_rotation");
});

void test("PRD-ISO-02: an auth_epoch above the JavaScript safe integer range is accepted, as serde accepts it for a u64", () => {
  assertAccepted(sampleWith('"auth_epoch":1,', '"auth_epoch":9007199254740993,'), "key-1");
});

void test("PRD-ISO-02: an auth_epoch above the u64 range is refused", () => {
  assertRefused(sampleWith('"auth_epoch":1,', '"auth_epoch":18446744073709551616,'), "launch.auth_epoch");
});

void test("PRD-ISO-02: a negative auth_epoch is refused, as serde refuses a negative value for a u64", () => {
  assertRefused(sampleWith('"auth_epoch":1,', '"auth_epoch":-1,'), "launch.auth_epoch");
});

void test("PRD-ISO-02: a negative zero auth_epoch is refused, as serde reads -0 as a float for a u64", () => {
  assertRefused(sampleWith('"auth_epoch":1,', '"auth_epoch":-0,'), "launch.auth_epoch");
});

void test("PRD-ISO-02: a negative zero token lifetime is refused, as serde reads -0 as a float for an i64", () => {
  assertRefused(sampleWith('"gateway_expires_at":1793004954,', '"gateway_expires_at":-0,'), "launch.expires_at");
});

void test("PRD-ISO-02: a key id with U+0085 is refused, as the gateway refuses a whitespace character in an identifier", () => {
  assertRefused(sampleWith('"key_id":"key-1"', '"key_id":"key\u00851"'), "launch.key_id");
});

void test("PRD-ISO-02: a key id with U+FEFF is accepted, as the gateway accepts it (U+FEFF is not White_Space)", () => {
  assertAccepted(sampleWith('"key_id":"key-1"', '"key_id":"key\uFEFF1"'), "key\uFEFF1");
});

void test("PRD-ISO-02: a token with U+0085 is refused, as the gateway refuses a whitespace character in a token", () => {
  assertRefused(sampleWith('"gateway_token":"fixture-gateway-token"', '"gateway_token":"fixture\u0085token"'), "launch.token");
});

void test("PRD-ISO-02: a token with U+FEFF is accepted, as the gateway accepts it", () => {
  const body = sampleWith('"sandbox_token":"fixture-sandbox-token"', '"sandbox_token":"fixture\uFEFFtoken"');
  assertAccepted(body, "key-1");
});

void test("PRD-ISO-02: a lone surrogate escape in a string is refused, as serde refuses it", () => {
  assertRefused(sampleWith('"key_id":"key-1"', '"key_id":"key\\ud800"'), "launch.json");
});

void test("PRD-ISO-02: a valid surrogate pair escape in a string is accepted", () => {
  assertAccepted(sampleWith('"key_id":"key-1"', '"key_id":"key\\ud83d\\ude00"'), "key\u{1F600}");
});

void test("PRD-ISO-02: a refusal line names the RPC and the check, and carries no token, key or gateway value", () => {
  const { scope, lines } = capturing();
  assert.throws(() => decodeLaunchAuthentication(Buffer.from(GATEWAY_LAUNCH_SAMPLE, "utf8"), "other-gateway", scope));
  // Exactly one line, with the expected text: no value can hide in a second line.
  assert.deepEqual(lines, ["realm compute driver refused: rpc=CreateSandbox check=launch.gateway_id code=SCHEMA_INVALID"]);
  const logged = lines.join("\n");
  for (const secret of ["fixture-gateway-token", "fixture-sandbox-token", "fixture-ssh-host-key", "MCowBQYDK2", "key-1"]) {
    assert.equal(logged.includes(secret), false, `the refusal line carries ${secret}`);
  }
});
