// The built-in sandbox runtime in the rendered gateway configuration (phase 9.5, PRD-GW-04). The driver's table names the built-in
// backend by its reserved name, no supervisor section is rendered, and each invalid input throws SCHEMA_INVALID.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_ISOLATION_BACKEND, type RealmGatewayInput, renderRealmGatewayConfig } from "../../src/runtime/gateway-config.js";
import { RealmError } from "../../src/core/errors.js";

const BASE: RealmGatewayInput = {
  bindAddress: "127.0.0.1:17671",
  gatewayId: "realm",
  computeDriver: "realm",
  driverSocketPath: "/realm-state/gateway/driver.sock",
  pkiDir: "/realm-state/gateway/pki",
};

function assertRefused(fn: () => unknown): void {
  assert.throws(fn, (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID");
}

void test("PRD-GW-04: the driver table selects the built-in sandbox runtime, and no supervisor section is rendered", () => {
  const rendered = renderRealmGatewayConfig(BASE);
  const driverTable = rendered.slice(rendered.indexOf("[openshell.drivers.realm]"));
  assert.ok(driverTable.split("\n").includes('isolation_backend = "openshell-sandbox"'));
  assert.equal(rendered.includes("[[openshell.supervisor.isolation_backends]]"), false);
  assert.equal(rendered.includes("supervisor"), false);
});

void test("PRD-GW-04: the built-in selection is the reserved name, and it ends every valid rendering whatever the driver's name", () => {
  assert.equal(BUILTIN_ISOLATION_BACKEND, "openshell-sandbox");
  const other = renderRealmGatewayConfig({ ...BASE, computeDriver: "realm-two" });
  assert.ok(other.endsWith('[openshell.drivers.realm-two]\nsocket_path = "/realm-state/gateway/driver.sock"\nisolation_backend = "openshell-sandbox"\n'));
});

void test("PRD-GW-04: an invalid bind address, driver name or driver socket path is refused", () => {
  assertRefused(() => renderRealmGatewayConfig({ ...BASE, bindAddress: "localhost:17671" }));
  assertRefused(() => renderRealmGatewayConfig({ ...BASE, computeDriver: "Realm" }));
  assertRefused(() => renderRealmGatewayConfig({ ...BASE, driverSocketPath: "realm-state/driver.sock" }));
});

void test("PRD-GW-04: a driver socket path with a quote, a backslash, or a control character is refused", () => {
  for (const driverSocketPath of ['/realm-state/"driver".sock', "/realm-state\\driver.sock", "/realm-state/driver\n.sock"]) {
    assertRefused(() => renderRealmGatewayConfig({ ...BASE, driverSocketPath }));
  }
});
