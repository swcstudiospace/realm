// A CreateSandbox request as the gateway encodes it on the wire, decoded by the driver's pinned proto loader. The launch body is
// the gateway's; planCreate reads it as the proto delivers it. A selection of an isolation backend is refused, because the built-in
// path carries none.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RealmError } from "../../../src/core/errors.js";
import { ComputeDriver, loadComputeDriverService, type DriverSandboxMessage } from "../../../src/runtime/driver/compute-driver.js";
import { FakeLibpod, FakeLifecycle, FakeRuntime, driverConfig, validSandbox } from "./fakes.js";
import { GATEWAY_LAUNCH_SAMPLE } from "./gateway-launch-sample.js";

// The request as the driver receives it after the gateway's bytes pass through the pinned CreateSandbox request codec.
function onTheWire(sandbox: DriverSandboxMessage): DriverSandboxMessage {
  const create = loadComputeDriverService()["CreateSandbox"];
  assert.ok(create !== undefined);
  const request = { sandbox };
  return (create.requestDeserialize(create.requestSerialize(request)) as typeof request).sandbox;
}

void test("PRD-DRV-02: a create the gateway encodes on the wire is accepted, and its launch material is stored", async () => {
  const base = validSandbox();
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const driver = new ComputeDriver(config, { lifecycle: new FakeLifecycle(libpod), libpod, runtime: new FakeRuntime() });
  const sandbox = onTheWire({
    ...base,
    spec: { ...base.spec, launch_authentication: Buffer.from(GATEWAY_LAUNCH_SAMPLE, "utf8") },
  });
  await driver.createSandbox(sandbox);
  assert.deepEqual(readFileSync(join(config.secretRoot, "realm-session-1", "launch.json")), Buffer.from(GATEWAY_LAUNCH_SAMPLE, "utf8"));
});

void test("PRD-DRV-02: a create the gateway encodes with an isolation backend selection is refused on the wire, before any write", async () => {
  const base = validSandbox();
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const lifecycle = new FakeLifecycle(libpod);
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime: new FakeRuntime() });
  const sandbox = onTheWire({
    ...base,
    spec: {
      ...base.spec,
      isolation_backend: { name: "realm", unix_socket_path: "/run/realm/isolation.sock" },
      launch_authentication: Buffer.from(GATEWAY_LAUNCH_SAMPLE, "utf8"),
    },
  });
  await assert.rejects(
    driver.createSandbox(sandbox),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  assert.deepEqual(lifecycle.creates, []);
  assert.equal(libpod.inspectCalls, 0);
});
