// Behaviour of the launch material the driver keeps for each sandbox: a create stores it under the secret root, a refused create
// writes nothing and reaches no libpod call, delete and the startup sweep remove it, and the secret and workspace roots must not
// hold one another. No test reads source text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { RealmError } from "../../../src/core/errors.js";
import { ComputeDriver, type ComputeDriverConfig, type DriverSandboxMessage } from "../../../src/runtime/driver/compute-driver.js";
import { DriverLifecycle, type LifecycleLibpod } from "../../../src/runtime/driver/lifecycle.js";
import { writeLaunchMaterial } from "../../../src/runtime/driver/secret-store.js";
import { diskLifecycle, FakeLibpod, FakeLifecycle, FakeRuntime, LAUNCH_KEY, driverConfig, validSandbox } from "./fakes.js";
import { launchBody, launchSupervisor } from "../isolation/supervisor-token.js";

// The container name a valid create runs under (validSandbox().name, with the realm prefix).
const CONTAINER_NAME = "realm-session-1";

function schemaInvalid(error: unknown): boolean {
  return error instanceof RealmError && error.code === "SCHEMA_INVALID";
}

interface Harness {
  readonly config: ComputeDriverConfig;
  readonly libpod: FakeLibpod;
  readonly lifecycle: FakeLifecycle;
  readonly driver: ComputeDriver;
}

function harness(): Harness {
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const lifecycle = new FakeLifecycle(libpod);
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime: new FakeRuntime() });
  return { config, libpod, lifecycle, driver };
}

// A create request whose launch authentication is the given bytes.
function sandboxWith(body: Uint8Array): DriverSandboxMessage {
  return validSandbox({ spec: { ...validSandbox().spec, launch_authentication: body } });
}

// A create request with the launch authentication field absent from its spec.
function sandboxWithoutLaunch(): DriverSandboxMessage {
  const spec = { ...validSandbox().spec };
  Reflect.deleteProperty(spec, "launch_authentication");
  return validSandbox({ spec });
}

// The entries of a directory, or none when the directory does not exist.
function entriesOf(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir) : [];
}

// Every file of the given name under a directory, at any depth.
function filesNamed(root: string, name: string): string[] {
  const found: string[] = [];
  for (const entry of entriesOf(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      found.push(...filesNamed(path, name));
    } else if (entry === name) {
      found.push(path);
    }
  }
  return found;
}

// A refused create touched nothing: no lifecycle create, no libpod call, and no file under any root.
function assertNothingWritten(h: Harness): void {
  assert.deepEqual(h.lifecycle.creates, []);
  assert.equal(h.libpod.inspectCalls, 0);
  assert.equal(h.libpod.containers.size, 0);
  assert.deepEqual(entriesOf(h.config.secretRoot), []);
  assert.deepEqual(entriesOf(h.config.sandboxStateRoot), []);
  assert.deepEqual(entriesOf(h.config.workspaceRoot), []);
}

// A libpod stub for a lifecycle that never reaches a container: nothing is listed or found, and every removal succeeds.
function emptyLibpod(): LifecycleLibpod {
  const stub = {
    listContainersByLabel: () => Promise.resolve([]),
    inspectContainer: () => Promise.resolve(null),
    stopContainer: () => Promise.resolve(),
    removeContainer: () => Promise.resolve(),
  };
  return stub as unknown as LifecycleLibpod;
}

void test("PRD-ISO-02: a create stores its launch material under the secret root at 0600, and nowhere under the state or workspace root", async () => {
  const { config, lifecycle, driver } = harness();
  await driver.createSandbox(validSandbox());
  const containerName = lifecycle.creates[0]?.sandboxName;
  assert.ok(containerName !== undefined);
  const path = join(config.secretRoot, containerName, "launch.json");
  assert.deepEqual(readFileSync(path), launchBody(LAUNCH_KEY));
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(filesNamed(config.sandboxStateRoot, "launch.json"), []);
  assert.deepEqual(filesNamed(config.workspaceRoot, "launch.json"), []);
});

const rsaPem = Buffer.from(
  String(generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "pem", type: "spki" })),
);
const wireKey = { key_id: LAUNCH_KEY.keyId, public_key_pem: Array.from(LAUNCH_KEY.publicPem) };

const MALFORMED: readonly [string, Uint8Array][] = [
  ["non-JSON bytes", Buffer.from("not json")],
  ["an empty body", Buffer.alloc(0)],
  ["a JSON array", Buffer.from("[]")],
  ["an unknown top-level field", launchBody(LAUNCH_KEY, { extra: "x" })],
  ["a missing supervisor", launchBody(LAUNCH_KEY, { supervisor: undefined })],
  ["a gateway_id different from the driver's", launchBody(LAUNCH_KEY, { gateway_id: "other-gateway" })],
  ["an empty verification_keys array", launchBody(LAUNCH_KEY, { verification_keys: [] })],
  ["a duplicate key_id", launchBody(LAUNCH_KEY, { verification_keys: [wireKey, wireKey] })],
  [
    "a key that is an RSA public key",
    launchBody(LAUNCH_KEY, { verification_keys: [{ key_id: LAUNCH_KEY.keyId, public_key_pem: Array.from(rsaPem) }] }),
  ],
  ["a session_rotation of 0", launchBody(LAUNCH_KEY, { supervisor: launchSupervisor({ session_rotation: 0 }) })],
  [
    "a runtime_generation with an uppercase letter",
    launchBody(LAUNCH_KEY, { supervisor: launchSupervisor({ runtime_generation: "Generation-1" }) }),
  ],
];

for (const [label, body] of MALFORMED) {
  void test(`PRD-ISO-02: a create whose launch material is ${label} refuses with SCHEMA_INVALID, and writes nothing`, async () => {
    const h = harness();
    await assert.rejects(h.driver.createSandbox(sandboxWith(body)), schemaInvalid);
    assertNothingWritten(h);
  });
}

void test("PRD-ISO-02: a create with no launch_authentication field refuses with SCHEMA_INVALID, and writes nothing", async () => {
  const h = harness();
  await assert.rejects(h.driver.createSandbox(sandboxWithoutLaunch()), schemaInvalid);
  assertNothingWritten(h);
});

void test("PRD-ISO-02: a create with an empty launch_authentication buffer refuses with SCHEMA_INVALID, and writes nothing", async () => {
  const h = harness();
  await assert.rejects(h.driver.createSandbox(sandboxWith(Buffer.alloc(0))), schemaInvalid);
  assertNothingWritten(h);
});

void test("PRD-ISO-02: a validate with no launch_authentication field passes, and writes nothing and makes no libpod call", () => {
  const h = harness();
  assert.deepEqual(h.driver.validateSandboxCreate(sandboxWithoutLaunch()), {});
  assertNothingWritten(h);
});

void test("PRD-ISO-02: a validate with an empty launch_authentication buffer passes, and writes nothing and makes no libpod call", () => {
  const h = harness();
  assert.deepEqual(h.driver.validateSandboxCreate(sandboxWith(Buffer.alloc(0))), {});
  assertNothingWritten(h);
});

for (const [label, body] of MALFORMED.filter(([, body]) => body.length > 0)) {
  void test(`PRD-ISO-02: a validate whose launch material is ${label} refuses with SCHEMA_INVALID, and writes nothing`, () => {
    const h = harness();
    assert.throws(() => h.driver.validateSandboxCreate(sandboxWith(body)), schemaInvalid);
    assertNothingWritten(h);
  });
}

void test("PRD-ISO-02: delete removes the sandbox's launch material and its secret directory", async () => {
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const driver = new ComputeDriver(config, {
    lifecycle: await diskLifecycle(config, libpod),
    libpod,
    runtime: new FakeRuntime(),
  });
  await driver.createSandbox(validSandbox());
  const secretDir = join(config.secretRoot, CONTAINER_NAME);
  assert.equal(existsSync(join(secretDir, "launch.json")), true);
  assert.deepEqual(await driver.deleteSandbox({ name: CONTAINER_NAME }), { deleted: true });
  assert.equal(existsSync(secretDir), false);
});

void test("PRD-ISO-02: the startup sweep removes leftover launch material and its directory", async () => {
  const config = driverConfig();
  writeLaunchMaterial(config.secretRoot, "realm-leftover-1", launchBody(LAUNCH_KEY));
  assert.equal(existsSync(join(config.secretRoot, "realm-leftover-1", "launch.json")), true);
  const lifecycle = new DriverLifecycle({
    libpod: emptyLibpod(),
    sandboxStateRoot: config.sandboxStateRoot,
    secretRoot: config.secretRoot,
  });
  await lifecycle.startupSweep();
  assert.equal(existsSync(join(config.secretRoot, "realm-leftover-1")), false);
  assert.deepEqual(entriesOf(config.secretRoot), []);
});

void test("PRD-ISO-02: a secret root inside the workspace root, or a workspace root inside the secret root, refuses construction; sibling roots construct", () => {
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const deps = { lifecycle: new FakeLifecycle(libpod), libpod, runtime: new FakeRuntime() };
  assert.doesNotThrow(() => new ComputeDriver(config, deps));
  const secretInWorkspace = { ...config, secretRoot: join(config.workspaceRoot, "secrets") };
  assert.throws(() => new ComputeDriver(secretInWorkspace, deps), schemaInvalid);
  const workspaceInSecret = { ...config, workspaceRoot: join(config.secretRoot, "workspaces") };
  assert.throws(() => new ComputeDriver(workspaceInSecret, deps), schemaInvalid);
});
