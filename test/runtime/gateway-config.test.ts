import { test } from "node:test";
import assert from "node:assert/strict";
import {
  realmGatewayPkiPaths,
  type RealmGatewayInput,
  renderRealmGatewayConfig,
} from "../../src/runtime/gateway-config.js";
import { RealmError } from "../../src/core/errors.js";

const VALID: RealmGatewayInput = {
  bindAddress: "127.0.0.1:17671",
  gatewayId: "realm",
  computeDriver: "realm",
  driverSocketPath: "/realm-state/gateway/driver.sock",
  pkiDir: "/realm-state/gateway/pki",
};

// A copy of VALID with one field replaced by a value that may violate the contract.
function withField(field: keyof RealmGatewayInput, value: unknown): RealmGatewayInput {
  return { ...VALID, [field]: value };
}

// Asserts that the call throws a RealmError with the given catalogue code. The message is not asserted.
function assertRefused(fn: () => unknown, code = "SCHEMA_INVALID"): void {
  assert.throws(fn, (error: unknown) => error instanceof RealmError && error.code === code);
}

const EXPECTED_VALID_CONFIG = [
  "[openshell]",
  "version = 2",
  "",
  "[openshell.gateway]",
  'compute_driver = "realm"',
  'bind_address = "127.0.0.1:17671"',
  'guest_tls_ca = "/realm-state/gateway/pki/ca.crt"',
  "",
  "[openshell.gateway.tls]",
  'cert_path = "/realm-state/gateway/pki/server/tls.crt"',
  'key_path = "/realm-state/gateway/pki/server/tls.key"',
  'client_ca_path = "/realm-state/gateway/pki/ca.crt"',
  "",
  "[openshell.gateway.gateway_jwt]",
  'signing_key_path = "/realm-state/gateway/pki/jwt/signing.pem"',
  'public_key_path = "/realm-state/gateway/pki/jwt/public.pem"',
  'kid_path = "/realm-state/gateway/pki/jwt/kid"',
  'gateway_id = "realm"',
  "",
  "[openshell.drivers.realm]",
  'socket_path = "/realm-state/gateway/driver.sock"',
  'isolation_backend = "openshell-sandbox"',
  "",
].join("\n");

void test("the rendered gateway config equals the exact expected TOML for a fixed valid input (phase 9.1 T7)", () => {
  assert.equal(renderRealmGatewayConfig(VALID), EXPECTED_VALID_CONFIG);
});

void test("valid inputs render the tls and gateway_jwt tables and never disable_tls (phase 9.1 T7)", () => {
  const inputs: RealmGatewayInput[] = [
    VALID,
    { ...VALID, bindAddress: "[::1]:17671" },
    { ...VALID, bindAddress: "10.0.0.5:1", gatewayId: "gw.01_a-b", computeDriver: "realm-2" },
    { ...VALID, pkiDir: "/realm-state/gateway/pki/", driverSocketPath: "/run/realm/driver.sock" },
  ];
  for (const input of inputs) {
    const config = renderRealmGatewayConfig(input);
    assert.ok(config.includes("[openshell.gateway.tls]"));
    assert.ok(config.includes("[openshell.gateway.gateway_jwt]"));
    assert.ok(config.includes(`[openshell.drivers.${input.computeDriver}]`));
    assert.ok(!config.includes("disable_tls"));
  }
});

void test("a relative pkiDir or a relative driverSocketPath is refused with SCHEMA_INVALID (phase 9.1 T7)", () => {
  assertRefused(() => renderRealmGatewayConfig(withField("pkiDir", "realm-state/gateway/pki")));
  assertRefused(() => renderRealmGatewayConfig(withField("driverSocketPath", "driver.sock")));
  assertRefused(() => realmGatewayPkiPaths("gateway/pki"));
});

void test("a path with a '..' segment is refused (phase 9.1 T7)", () => {
  assertRefused(() => renderRealmGatewayConfig(withField("pkiDir", "/realm-state/../etc/pki")));
  assertRefused(() => renderRealmGatewayConfig(withField("driverSocketPath", "/realm-state/gateway/..")));
  assertRefused(() => realmGatewayPkiPaths("/realm-state/gateway/../pki"));
});

void test("a path with a double quote, a backslash, a newline, or another control character is refused (phase 9.1 T7)", () => {
  const badPaths = [
    '/realm-state/gateway/"pki"',
    "/realm-state/gateway\\pki",
    "/realm-state/gateway/pki\n",
    "/realm-state/gateway/\tpki",
    "/realm-state/gateway/\u0007pki",
    "/realm-state/gateway/pki\u007f",
  ];
  for (const path of badPaths) {
    assertRefused(() => renderRealmGatewayConfig(withField("pkiDir", path)));
    assertRefused(() => renderRealmGatewayConfig(withField("driverSocketPath", path)));
    assertRefused(() => realmGatewayPkiPaths(path));
  }
});

void test("bindAddress accepts an IPv4 or bracketed IPv6 literal with a port and refuses every other form (phase 9.1 T7)", () => {
  for (const bindAddress of ["127.0.0.1:17671", "[::1]:17671"]) {
    assert.ok(renderRealmGatewayConfig(withField("bindAddress", bindAddress)).includes(`bind_address = "${bindAddress}"`));
  }
  const badAddresses = [
    "127.0.0.1",
    "127.0.0.1:0",
    "127.0.0.1:65536",
    "localhost:17671",
    "256.0.0.1:17671",
    "",
    "::1:17671",
    "[127.0.0.1]:17671",
  ];
  for (const bindAddress of badAddresses) {
    assertRefused(() => renderRealmGatewayConfig(withField("bindAddress", bindAddress)));
  }
});

void test("gatewayId and computeDriver refuse the empty string, a space, and an over-length value, and computeDriver refuses uppercase (phase 9.1 T7)", () => {
  const badGatewayIds = ["", "bad id", "a".repeat(65)];
  for (const gatewayId of badGatewayIds) {
    assertRefused(() => renderRealmGatewayConfig(withField("gatewayId", gatewayId)));
  }
  const badDrivers = ["", "bad driver", "a".repeat(64), "Realm"];
  for (const computeDriver of badDrivers) {
    assertRefused(() => renderRealmGatewayConfig(withField("computeDriver", computeDriver)));
  }
});

void test("an empty bindAddress is refused with SCHEMA_INVALID (phase 9.1 T7)", () => {
  assertRefused(() => renderRealmGatewayConfig(withField("bindAddress", "")));
});

void test("a missing or non-string field, and a non-object input, are refused with SCHEMA_INVALID (phase 9.1 T7)", () => {
  assertRefused(() => renderRealmGatewayConfig(withField("gatewayId", 7)));
  assertRefused(() => renderRealmGatewayConfig(withField("pkiDir", undefined)));
  assertRefused(() => renderRealmGatewayConfig(null as unknown as RealmGatewayInput));
  assertRefused(() => renderRealmGatewayConfig("realm" as unknown as RealmGatewayInput));
});

void test("realmGatewayPkiPaths derives the generate-certs layout and omits ca.key (phase 9.1 T7)", () => {
  assert.deepEqual(realmGatewayPkiPaths("/realm-state/gateway/pki"), {
    serverCert: "/realm-state/gateway/pki/server/tls.crt",
    serverKey: "/realm-state/gateway/pki/server/tls.key",
    clientCert: "/realm-state/gateway/pki/client/tls.crt",
    clientKey: "/realm-state/gateway/pki/client/tls.key",
    caCert: "/realm-state/gateway/pki/ca.crt",
    jwtSigningKey: "/realm-state/gateway/pki/jwt/signing.pem",
    jwtPublicKey: "/realm-state/gateway/pki/jwt/public.pem",
    jwtKid: "/realm-state/gateway/pki/jwt/kid",
  });
  assert.equal("caKey" in realmGatewayPkiPaths("/realm-state/gateway/pki"), false);
  assert.equal(
    realmGatewayPkiPaths("/realm-state/gateway/pki/").caCert,
    "/realm-state/gateway/pki/ca.crt",
  );
});

void test("rendering the same input twice yields the same string (phase 9.1 T7)", () => {
  assert.equal(renderRealmGatewayConfig(VALID), renderRealmGatewayConfig(VALID));
});
