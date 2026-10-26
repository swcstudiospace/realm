// A CreateSandbox request as the gateway encodes it on the wire, decoded by the driver's pinned proto loader. The isolation backend
// registration (name and unix socket endpoint) and the launch body are the gateway's; planCreate reads them as the proto delivers them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ComputeDriver, loadComputeDriverService } from "../../../src/runtime/driver/compute-driver.js";
import { BoundaryRegistry } from "../../../src/runtime/driver/isolation/boundary.js";
import { FakeLibpod, FakeLifecycle, driverConfig, ISOLATION_BACKEND_NAME, validSandbox } from "./fakes.js";
import { GATEWAY_LAUNCH_SAMPLE } from "./gateway-launch-sample.js";

void test("PRD-DRV-02: a create the gateway encodes on the wire is accepted, and its isolation selection and launch material are stored", async () => {
  const create = loadComputeDriverService()["CreateSandbox"];
  assert.ok(create !== undefined);
  const base = validSandbox();
  const request = {
    sandbox: {
      ...base,
      spec: {
        ...base.spec,
        isolation_backend: {
          name: ISOLATION_BACKEND_NAME,
          unix_socket_path: "/run/realm/isolation.sock",
        },
        launch_authentication: Buffer.from(GATEWAY_LAUNCH_SAMPLE, "utf8"),
      },
    },
  };
  const decoded = create.requestDeserialize(create.requestSerialize(request)) as typeof request;

  const libpod = new FakeLibpod();
  const lifecycle = new FakeLifecycle(libpod);
  const config = driverConfig();
  const driver = new ComputeDriver(config, { lifecycle, libpod, boundaries: new BoundaryRegistry() });
  await driver.createSandbox(decoded.sandbox);

  assert.equal(driver.isolationBackendOf("sandbox-1"), ISOLATION_BACKEND_NAME);
  assert.deepEqual(readFileSync(join(config.secretRoot, "realm-session-1", "launch.json")), Buffer.from(GATEWAY_LAUNCH_SAMPLE, "utf8"));
});
