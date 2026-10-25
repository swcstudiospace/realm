import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError } from "../../../src/core/errors.js";
import { DRIVER_ENV, loadDriverProcessConfig } from "../../../src/runtime/driver/main.js";
import { SANDBOX_IMAGE } from "./fakes.js";

const COMPLETE_ENV: Readonly<Record<string, string>> = {
  [DRIVER_ENV.name]: "realm",
  [DRIVER_ENV.socket]: "/run/realm/driver.sock",
  [DRIVER_ENV.image]: SANDBOX_IMAGE,
  [DRIVER_ENV.stateRoot]: "/var/lib/realm/state",
  [DRIVER_ENV.secretRoot]: "/var/lib/realm/secrets",
  [DRIVER_ENV.workspaceRoot]: "/var/lib/realm/workspaces",
  XDG_RUNTIME_DIR: "/run/user/1001",
};

function refusedWithSchemaInvalid(): (error: unknown) => boolean {
  return (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID";
}

void test("PD-05: a complete environment yields the socket, the libpod socket, and the driver config", () => {
  const config = loadDriverProcessConfig(COMPLETE_ENV);
  assert.equal(config.socketPath, "/run/realm/driver.sock");
  assert.equal(config.libpodSocketPath, "/run/user/1001/podman/podman.sock");
  assert.equal(config.secretRoot, "/var/lib/realm/secrets");
  assert.deepEqual(config.driver, {
    driverName: "realm",
    sandboxImage: SANDBOX_IMAGE,
    sandboxStateRoot: "/var/lib/realm/state",
    workspaceRoot: "/var/lib/realm/workspaces",
  });
});

for (const key of Object.values(DRIVER_ENV)) {
  void test(`PD-05: a missing ${key} refuses with SCHEMA_INVALID`, () => {
    const env = { ...COMPLETE_ENV, [key]: undefined };
    assert.throws(() => loadDriverProcessConfig(env), refusedWithSchemaInvalid());
  });
}

void test("PD-05: a missing XDG_RUNTIME_DIR refuses, because the libpod socket cannot be found", () => {
  const env = { ...COMPLETE_ENV, XDG_RUNTIME_DIR: undefined };
  assert.throws(() => loadDriverProcessConfig(env), refusedWithSchemaInvalid());
});

void test("PD-05: a relative socket or root path refuses", () => {
  for (const key of [DRIVER_ENV.socket, DRIVER_ENV.stateRoot, DRIVER_ENV.secretRoot, DRIVER_ENV.workspaceRoot]) {
    const env = { ...COMPLETE_ENV, [key]: "relative/path" };
    assert.throws(() => loadDriverProcessConfig(env), refusedWithSchemaInvalid());
  }
});

void test("PRD-DRV-02: an image that is not digest-pinned refuses at startup", () => {
  const env = { ...COMPLETE_ENV, [DRIVER_ENV.image]: "registry.invalid/realm/sandbox:latest" };
  assert.throws(() => loadDriverProcessConfig(env), refusedWithSchemaInvalid());
});

void test("PD-05: a driver name outside the short lowercase form refuses", () => {
  const env = { ...COMPLETE_ENV, [DRIVER_ENV.name]: "Realm Driver" };
  assert.throws(() => loadDriverProcessConfig(env), refusedWithSchemaInvalid());
});

void test("a refusal names no configured value", () => {
  const env = { ...COMPLETE_ENV, [DRIVER_ENV.image]: "registry.invalid/realm/secret-tag:latest" };
  try {
    loadDriverProcessConfig(env);
    assert.fail("expected a refusal");
  } catch (error: unknown) {
    assert.ok(error instanceof RealmError);
    assert.ok(!error.message.includes("secret-tag"));
    assert.ok(!error.reason.includes("secret-tag"));
  }
});
