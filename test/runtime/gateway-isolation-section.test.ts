// The supervisor isolation backend section of the rendered gateway configuration (phase 9.5, PRD-GW-04, T9). The section has a
// unique name and an absolute unix socket path, and each invalid input throws SCHEMA_INVALID.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type RealmGatewayInput,
  type RealmIsolationBackend,
  renderRealmGatewayConfig,
} from "../../src/runtime/gateway-config.js";
import { RealmError } from "../../src/core/errors.js";

const BASE: RealmGatewayInput = {
  bindAddress: "127.0.0.1:17671",
  gatewayId: "realm",
  computeDriver: "realm",
  driverSocketPath: "/realm-state/gateway/driver.sock",
  pkiDir: "/realm-state/gateway/pki",
};

const BACKEND: RealmIsolationBackend = { name: "realm-isolation", socketPath: "/run/realm/isolation.sock" };

function withBackends(backends: readonly RealmIsolationBackend[], isolationBackend?: string): RealmGatewayInput {
  return isolationBackend === undefined
    ? { ...BASE, isolationBackends: backends }
    : { ...BASE, isolationBackends: backends, isolationBackend };
}

function assertRefused(fn: () => unknown): void {
  assert.throws(fn, (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID");
}

void test("PRD-GW-04: the rendered config selects the backend and carries an absolute unix section entry", () => {
  const rendered = renderRealmGatewayConfig(withBackends([BACKEND], BACKEND.name));
  assert.equal(
    rendered,
    [
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
      'isolation_backend = "realm-isolation"',
      "",
      "[[openshell.supervisor.isolation_backends]]",
      'name = "realm-isolation"',
      'endpoint = { kind = "unix", socket_path = "/run/realm/isolation.sock" }',
      "",
    ].join("\n"),
  );
});

void test("PRD-GW-04: each listed backend renders its own entry, and an unselected list leaves the driver table unchanged", () => {
  const rendered = renderRealmGatewayConfig(
    withBackends([BACKEND, { name: "second.backend_1", socketPath: "/run/realm/second.sock" }]),
  );
  assert.equal(rendered.split("[[openshell.supervisor.isolation_backends]]").length - 1, 2);
  assert.ok(rendered.includes('name = "second.backend_1"'));
  assert.ok(rendered.includes('endpoint = { kind = "unix", socket_path = "/run/realm/second.sock" }'));
  assert.ok(!rendered.includes("isolation_backend ="));
  assert.ok(rendered.endsWith("\n"));
});

void test("PRD-GW-04: a configuration without isolation backends renders no supervisor section", () => {
  assert.ok(!renderRealmGatewayConfig(BASE).includes("supervisor"));
  assert.ok(!renderRealmGatewayConfig({ ...BASE, isolationBackends: [] }).includes("supervisor"));
});

void test("PRD-GW-04: a duplicate backend name is refused", () => {
  assertRefused(() => renderRealmGatewayConfig(withBackends([BACKEND, { ...BACKEND, socketPath: "/run/other.sock" }])));
});

void test("PRD-GW-04: a relative socket path, a hostname endpoint, and a path with a parent segment are refused", () => {
  for (const socketPath of ["isolation.sock", "backend.example:443", "/run/../etc/isolation.sock", ""]) {
    assertRefused(() => renderRealmGatewayConfig(withBackends([{ name: "realm-isolation", socketPath }])));
  }
});

void test("PRD-GW-04: a socket path with a quote, a backslash, or a control character is refused", () => {
  for (const socketPath of ['/run/"quoted".sock', "/run/back\\slash.sock", "/run/line\nbreak.sock", "/run/nul\u0000.sock", "/run/del\u007f.sock"]) {
    assertRefused(() => renderRealmGatewayConfig(withBackends([{ name: "realm-isolation", socketPath }])));
  }
});

void test("PRD-GW-04: a backend name outside the gateway's rule, the reserved name, or an empty name is refused", () => {
  for (const name of ["", "bad name", "quote\"name", "slash/name", "openshell-sandbox", "a".repeat(129)]) {
    assertRefused(() => renderRealmGatewayConfig(withBackends([{ name, socketPath: "/run/realm/isolation.sock" }])));
  }
});

void test("PRD-GW-04: a selected backend that is not listed, or a selection with no listed backend, is refused", () => {
  assertRefused(() => renderRealmGatewayConfig(withBackends([BACKEND], "other-backend")));
  assertRefused(() => renderRealmGatewayConfig({ ...BASE, isolationBackend: BACKEND.name }));
  assertRefused(() => renderRealmGatewayConfig({ ...BASE, isolationBackends: "realm-isolation" as unknown as readonly RealmIsolationBackend[] }));
  assertRefused(() => renderRealmGatewayConfig({ ...BASE, isolationBackends: [null as unknown as RealmIsolationBackend] }));
});
