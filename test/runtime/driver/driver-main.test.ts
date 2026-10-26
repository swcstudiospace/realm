import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError } from "../../../src/core/errors.js";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DRIVER_ENV,
  loadDriverProcessConfig,
  readPackageVersion,
  startDriver,
  type DriverProcessConfig,
} from "../../../src/runtime/driver/main.js";
import { GATEWAY_ID } from "../isolation/supervisor-token.js";
import { IMPLEMENTATION_VERSION, SANDBOX_IMAGE, driverConfig } from "./fakes.js";

const COMPLETE_ENV: Readonly<Record<string, string>> = {
  [DRIVER_ENV.name]: "realm",
  [DRIVER_ENV.socket]: "/run/realm/driver.sock",
  [DRIVER_ENV.image]: SANDBOX_IMAGE,
  [DRIVER_ENV.stateRoot]: "/var/lib/realm/state",
  [DRIVER_ENV.secretRoot]: "/var/lib/realm/secrets",
  [DRIVER_ENV.workspaceRoot]: "/var/lib/realm/workspaces",
  [DRIVER_ENV.isolationSocket]: "/run/realm/isolation.sock",
  [DRIVER_ENV.gatewayId]: GATEWAY_ID,
  XDG_RUNTIME_DIR: "/run/user/1001",
};

function refusedWithSchemaInvalid(): (error: unknown) => boolean {
  return (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID";
}

void test("PD-05: a complete environment yields the sockets, the libpod socket, and the driver config with its roots and gateway id", () => {
  const config = loadDriverProcessConfig(COMPLETE_ENV, IMPLEMENTATION_VERSION);
  assert.equal(config.socketPath, "/run/realm/driver.sock");
  assert.equal(config.isolationSocketPath, "/run/realm/isolation.sock");
  assert.equal(config.libpodSocketPath, "/run/user/1001/podman/podman.sock");
  assert.deepEqual(config.driver, {
    driverName: "realm",
    sandboxImage: SANDBOX_IMAGE,
    sandboxStateRoot: "/var/lib/realm/state",
    secretRoot: "/var/lib/realm/secrets",
    workspaceRoot: "/var/lib/realm/workspaces",
    implementationVersion: IMPLEMENTATION_VERSION,
    gatewayId: GATEWAY_ID,
  });
});

for (const key of Object.values(DRIVER_ENV)) {
  void test(`PD-05: a missing ${key} refuses with SCHEMA_INVALID`, () => {
    const env = { ...COMPLETE_ENV, [key]: undefined };
    assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithSchemaInvalid());
  });
}

void test("PD-05: a missing XDG_RUNTIME_DIR refuses, because the libpod socket cannot be found", () => {
  const env = { ...COMPLETE_ENV, XDG_RUNTIME_DIR: undefined };
  assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithSchemaInvalid());
});

void test("PD-05: a relative socket or root path refuses", () => {
  for (const key of [
    DRIVER_ENV.socket,
    DRIVER_ENV.stateRoot,
    DRIVER_ENV.secretRoot,
    DRIVER_ENV.workspaceRoot,
    DRIVER_ENV.isolationSocket,
  ]) {
    const env = { ...COMPLETE_ENV, [key]: "relative/path" };
    assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithSchemaInvalid());
  }
});

void test("PRD-ISO-02: a gateway id outside the configured form refuses at startup, and an empty one is missing", () => {
  for (const gatewayId of ["", " realm", "realm name", "-realm", "realm/x", "a".repeat(65)]) {
    const env = { ...COMPLETE_ENV, [DRIVER_ENV.gatewayId]: gatewayId };
    assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithSchemaInvalid());
  }
});

void test("PRD-ISO-02: a refused gateway id is not echoed in the refusal", () => {
  const env = { ...COMPLETE_ENV, [DRIVER_ENV.gatewayId]: "bad id secret-value" };
  try {
    loadDriverProcessConfig(env, IMPLEMENTATION_VERSION);
    assert.fail("expected a refusal");
  } catch (error: unknown) {
    assert.ok(error instanceof RealmError);
    assert.ok(!error.message.includes("secret-value"));
    assert.ok(!error.reason.includes("secret-value"));
  }
});

void test("PRD-DRV-02: an image that is not digest-pinned refuses at startup", () => {
  const env = { ...COMPLETE_ENV, [DRIVER_ENV.image]: "registry.invalid/realm/sandbox:latest" };
  assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithSchemaInvalid());
});

void test("PD-05: a driver name outside the short lowercase form refuses", () => {
  const env = { ...COMPLETE_ENV, [DRIVER_ENV.name]: "Realm Driver" };
  assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithSchemaInvalid());
});

void test("a refusal names no configured value", () => {
  const env = { ...COMPLETE_ENV, [DRIVER_ENV.image]: "registry.invalid/realm/secret-tag:latest" };
  try {
    loadDriverProcessConfig(env, IMPLEMENTATION_VERSION);
    assert.fail("expected a refusal");
  } catch (error: unknown) {
    assert.ok(error instanceof RealmError);
    assert.ok(!error.message.includes("secret-tag"));
    assert.ok(!error.reason.includes("secret-tag"));
  }
});

function packageJsonWith(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "realm-driver-manifest-"));
  const path = join(dir, "package.json");
  writeFileSync(path, contents);
  return path;
}

void test("PD-05: the package version is read from the manifest it is given", () => {
  assert.equal(readPackageVersion(packageJsonWith('{"name":"agent-realm","version":"9.8.7"}')), "9.8.7");
});

void test("PD-05: the entry resolves this package's own manifest four levels above the module", () => {
  const version = readPackageVersion(fileURLToPath(new URL("../../../../package.json", import.meta.url)));
  assert.match(version, /^\d+\.\d+\.\d+/);
});

void test("PD-05: a manifest without a usable version refuses with SCHEMA_INVALID", () => {
  for (const contents of ['{"name":"agent-realm"}', '{"version":""}', '{"version":"   "}', '{"version":7}', "null", "not json"]) {
    assert.throws(() => readPackageVersion(packageJsonWith(contents)), refusedWithSchemaInvalid());
  }
});

void test("PD-05: a manifest that cannot be read refuses with SCHEMA_INVALID", () => {
  assert.throws(() => readPackageVersion(join(tmpdir(), "realm-no-such-package.json")), refusedWithSchemaInvalid());
});

// A process configuration whose libpod socket does not exist. A start that reached the sweep would fail on that socket, so a
// refusal with SCHEMA_INVALID shows the gateway id was checked first, before any container was touched.
function startConfigWithGatewayId(gatewayId: string): DriverProcessConfig {
  const base = mkdtempSync(join(tmpdir(), "realm-driver-start-"));
  mkdirSync(join(base, "run"));
  return {
    socketPath: join(base, "run", "driver.sock"),
    isolationSocketPath: join(base, "run", "isolation.sock"),
    libpodSocketPath: join(base, "missing", "podman.sock"),
    driver: driverConfig({ gatewayId }),
  };
}

void test("PRD-ISO-02: startup refuses an invalid gateway id with SCHEMA_INVALID before the sweep", async () => {
  await assert.rejects(startDriver(startConfigWithGatewayId("-invalid")), refusedWithSchemaInvalid());
});
