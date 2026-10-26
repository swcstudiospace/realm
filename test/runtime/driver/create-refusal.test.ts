// The create path against the gateway's launch body: a sample from the gateway's own type is accepted and stored, and a refused
// create logs one line with its RPC and its check, writes nothing, and reaches no libpod call. No test reads source text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RealmError } from "../../../src/core/errors.js";
import { ComputeDriver, type ComputeDriverConfig, type DriverSandboxMessage } from "../../../src/runtime/driver/compute-driver.js";
import { BoundaryRegistry } from "../../../src/runtime/driver/isolation/boundary.js";
import { FakeLibpod, FakeLifecycle, driverConfig, validSandbox } from "./fakes.js";
import { GATEWAY_LAUNCH_SAMPLE } from "./gateway-launch-sample.js";

const CONTAINER_NAME = "realm-session-1";

function schemaInvalid(error: unknown): boolean {
  return error instanceof RealmError && error.code === "SCHEMA_INVALID";
}

// A driver whose refusal lines go to the returned array, with its fakes.
function harness(overrides: Partial<ComputeDriverConfig> = {}) {
  const lines: string[] = [];
  const config = driverConfig({ refusalLog: (line) => lines.push(line), ...overrides });
  const libpod = new FakeLibpod();
  const lifecycle = new FakeLifecycle(libpod);
  const driver = new ComputeDriver(config, { lifecycle, libpod, boundaries: new BoundaryRegistry() });
  return { config, libpod, lifecycle, driver, lines };
}

function entriesOf(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir) : [];
}

function sandboxWith(body: Uint8Array): DriverSandboxMessage {
  return validSandbox({ spec: { ...validSandbox().spec, launch_authentication: body } });
}

void test("PRD-ISO-02: a create with the gateway's own launch body is accepted, and its material is stored at 0600", async () => {
  const { config, lifecycle, driver, lines } = harness();
  const body = Buffer.from(GATEWAY_LAUNCH_SAMPLE, "utf8");
  await driver.createSandbox(sandboxWith(body));
  assert.equal(lifecycle.creates.length, 1);
  const path = join(config.secretRoot, CONTAINER_NAME, "launch.json");
  assert.deepEqual(readFileSync(path), body);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(lines, []);
});

void test("PRD-ISO-02: a create refused for its launch body logs one line with the RPC and the check, and writes nothing", async () => {
  const { config, libpod, lifecycle, driver, lines } = harness();
  const wrongGateway = Buffer.from(GATEWAY_LAUNCH_SAMPLE.replace('"gateway_id":"realm"', '"gateway_id":"other"'), "utf8");
  await assert.rejects(driver.createSandbox(sandboxWith(wrongGateway)), schemaInvalid);
  assert.deepEqual(lines, ["realm compute driver refused: rpc=CreateSandbox check=launch.gateway_id code=SCHEMA_INVALID"]);
  assert.deepEqual(lifecycle.creates, []);
  assert.equal(libpod.inspectCalls, 0);
  assert.deepEqual(entriesOf(config.secretRoot), []);
  assert.deepEqual(entriesOf(config.sandboxStateRoot), []);
});

void test("PRD-DRV-02: a create refused by the realm profile logs its RPC and check, for both the validate and the create RPC", async () => {
  const { driver, lines } = harness();
  const wrongImage = validSandbox({
    spec: { ...validSandbox().spec, template: { ...validSandbox().spec?.template, image: "registry.invalid/realm/sandbox:latest" } },
  });
  assert.throws(() => driver.validateSandboxCreate(wrongImage), schemaInvalid);
  await assert.rejects(driver.createSandbox(wrongImage), schemaInvalid);
  assert.deepEqual(lines, [
    "realm compute driver refused: rpc=ValidateSandboxCreate check=create.image code=SCHEMA_INVALID",
    "realm compute driver refused: rpc=CreateSandbox check=create.image code=SCHEMA_INVALID",
  ]);
});

void test("PRD-ISO-02: a bearer check that reads launch material which no longer decodes logs its check", async () => {
  const { config, driver, lines } = harness();
  await driver.createSandbox(validSandbox());
  writeFileSync(join(config.secretRoot, CONTAINER_NAME, "launch.json"), "not json", { mode: 0o600 });
  assert.throws(() => driver.launchVerifierOf("sandbox-1"), schemaInvalid);
  assert.deepEqual(lines, ["realm compute driver refused: rpc=BearerVerification check=launch.json code=SCHEMA_INVALID"]);
});
