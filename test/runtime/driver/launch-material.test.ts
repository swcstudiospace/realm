// Behaviour of the launch material the driver keeps for each sandbox: a create stores it under the secret root, a refused create
// writes nothing and reaches no libpod call, delete and the startup sweep remove it, and the bearer check verifies a token with
// the keys the material holds. No test reads source text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { status } from "@grpc/grpc-js";
import { RealmError } from "../../../src/core/errors.js";
import { ComputeDriver, type ComputeDriverConfig, type DriverSandboxMessage } from "../../../src/runtime/driver/compute-driver.js";
import { DriverStatusError } from "../../../src/runtime/driver/grpc-status.js";
import { DriverLifecycle, type LifecycleLibpod } from "../../../src/runtime/driver/lifecycle.js";
import { verifyBearer } from "../../../src/runtime/driver/isolation/bearer.js";
import { BoundaryRegistry } from "../../../src/runtime/driver/isolation/boundary.js";
import { writeLaunchMaterial } from "../../../src/runtime/driver/secret-store.js";
import { FakeLibpod, FakeLifecycle, LAUNCH_KEY, driverConfig, validSandbox } from "./fakes.js";
import {
  generateGatewayKey,
  launchBody,
  launchSupervisor,
  nowSeconds,
  sandboxClaims,
  signedToken,
} from "../isolation/supervisor-token.js";

// The sandbox id a valid create registers (validSandbox().id), and the container name it runs under (validSandbox().name).
const CREATED_SANDBOX_ID = "sandbox-1";
const CONTAINER_NAME = "realm-session-1";

function schemaInvalid(error: unknown): boolean {
  return error instanceof RealmError && error.code === "SCHEMA_INVALID";
}

function unauthenticated(error: unknown): boolean {
  return error instanceof DriverStatusError && error.failure.code === status.UNAUTHENTICATED;
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
  const driver = new ComputeDriver(config, { lifecycle, libpod, boundaries: new BoundaryRegistry() });
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

// A bearer the created sandbox's launch key signs. An override changes one claim to make one refusal.
function bearerFor(now: number, overrides: Readonly<Record<string, unknown>> = {}): string {
  const claims = sandboxClaims(now, {
    sandbox_id: CREATED_SANDBOX_ID,
    sub: `spiffe://openshell/sandbox/${CREATED_SANDBOX_ID}`,
    ...overrides,
  });
  return signedToken(LAUNCH_KEY, claims);
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

void test("PRD-ISO-02: delete removes the sandbox's launch material, and a bearer for it is then UNAUTHENTICATED", async () => {
  const config = driverConfig();
  const real = new DriverLifecycle({
    libpod: emptyLibpod(),
    sandboxStateRoot: config.sandboxStateRoot,
    secretRoot: config.secretRoot,
  });
  await real.startupSweep();
  const driver = new ComputeDriver(config, {
    lifecycle: {
      create: (spec) => Promise.resolve(`id-${spec.sandboxName}`),
      delete: (name) => real.delete(name),
    },
    libpod: new FakeLibpod(),
    boundaries: new BoundaryRegistry(),
  });
  await driver.createSandbox(validSandbox());
  const secretDir = join(config.secretRoot, CONTAINER_NAME);
  assert.equal(existsSync(join(secretDir, "launch.json")), true);
  await driver.deleteSandbox({ name: CONTAINER_NAME });
  assert.equal(existsSync(secretDir), false);
  assert.equal(driver.launchVerifierOf(CREATED_SANDBOX_ID), undefined);
  const now = nowSeconds();
  assert.throws(() => verifyBearer((id) => driver.launchVerifierOf(id), bearerFor(now), now), unauthenticated);
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

void test("PRD-ISO-02: a bearer signed by the sandbox's launch key verifies, through the driver's lookup, to the sandbox it names", async () => {
  const { driver } = harness();
  await driver.createSandbox(validSandbox());
  const now = nowSeconds();
  const session = verifyBearer((id) => driver.launchVerifierOf(id), bearerFor(now), now);
  assert.equal(session.sandboxId, CREATED_SANDBOX_ID);
});

void test("PRD-ISO-02: a bearer for a sandbox whose launch material was removed, or that the lookup does not hold, is UNAUTHENTICATED", async () => {
  const { config, driver } = harness();
  await driver.createSandbox(validSandbox());
  const now = nowSeconds();
  unlinkSync(join(config.secretRoot, CONTAINER_NAME, "launch.json"));
  assert.throws(() => verifyBearer((id) => driver.launchVerifierOf(id), bearerFor(now), now), unauthenticated);
  assert.throws(() => verifyBearer(() => undefined, bearerFor(now), now), unauthenticated);
});

void test("PRD-ISO-02: a bearer whose issuer names another gateway is refused by the material's verifier", async () => {
  const { driver } = harness();
  await driver.createSandbox(validSandbox());
  const now = nowSeconds();
  const otherGateway = bearerFor(now, { iss: "openshell-gateway:other" });
  assert.throws(() => verifyBearer((id) => driver.launchVerifierOf(id), otherGateway, now), unauthenticated);
});

void test("PRD-ISO-02: a bearer signed by a key the sandbox's launch material does not hold is refused", async () => {
  const { driver } = harness();
  await driver.createSandbox(validSandbox());
  const now = nowSeconds();
  const stranger = generateGatewayKey();
  const token = signedToken(stranger, sandboxClaims(now, { sandbox_id: CREATED_SANDBOX_ID }));
  assert.throws(() => verifyBearer((id) => driver.launchVerifierOf(id), token, now), unauthenticated);
});

void test("PRD-ISO-02: a secret root inside the workspace root, or a workspace root inside the secret root, refuses construction; sibling roots construct", () => {
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const deps = { lifecycle: new FakeLifecycle(libpod), libpod, boundaries: new BoundaryRegistry() };
  assert.doesNotThrow(() => new ComputeDriver(config, deps));
  const secretInWorkspace = { ...config, secretRoot: join(config.workspaceRoot, "secrets") };
  assert.throws(() => new ComputeDriver(secretInWorkspace, deps), schemaInvalid);
  const workspaceInSecret = { ...config, workspaceRoot: join(config.secretRoot, "workspaces") };
  assert.throws(() => new ComputeDriver(workspaceInSecret, deps), schemaInvalid);
});
