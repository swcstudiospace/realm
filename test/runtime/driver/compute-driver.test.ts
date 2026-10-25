import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, statSync, symlinkSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { join } from "node:path";
import { status } from "@grpc/grpc-js";
import { RealmError } from "../../../src/core/errors.js";
import { ComputeDriver, type DriverSandboxMessage } from "../../../src/runtime/driver/compute-driver.js";
import { DRIVER_ADMISSION_ACKNOWLEDGEMENT } from "../../../src/runtime/driver/admission.js";
import { DriverStatusError, driverFailureOf } from "../../../src/runtime/driver/grpc-status.js";
import type { ContainerSpec } from "../../../src/runtime/libpod-client.js";
import { FakeLibpod, FakeLifecycle, driverConfig, OTHER_DIGEST_IMAGE, SANDBOX_IMAGE, validSandbox } from "./fakes.js";

function harness() {
  const libpod = new FakeLibpod();
  const lifecycle = new FakeLifecycle(libpod);
  const config = driverConfig();
  const driver = new ComputeDriver(config, { lifecycle, libpod });
  return { libpod, lifecycle, config, driver };
}

// A lifecycle that records whether the state directory existed when it was called, then refuses with the given error.
function refusingLifecycle(error: RealmError, stateDirSeen: boolean[]) {
  return {
    create: (spec: ContainerSpec) => {
      stateDirSeen.push(existsSync(spec.stateDir));
      return Promise.reject(error);
    },
    delete: () => Promise.resolve(),
  };
}

function expectCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof RealmError && error.code === code;
}

function expectNotFound(error: unknown): boolean {
  return error instanceof DriverStatusError && error.failure.code === status.NOT_FOUND;
}

function withTemplate(sandbox: DriverSandboxMessage, changes: Record<string, unknown>): DriverSandboxMessage {
  return { ...sandbox, spec: { ...sandbox.spec, template: { ...sandbox.spec?.template, ...changes } } };
}

function withResources(sandbox: DriverSandboxMessage, resources: Record<string, string>): DriverSandboxMessage {
  return withTemplate(sandbox, {
    resources: { cpu_request: "", cpu_limit: "2", memory_request: "", memory_limit: "1Gi", ...resources },
  });
}

// Each change makes one request the realm profile must refuse. Every refusal is SCHEMA_INVALID, and the lifecycle, the
// only path to a libpod create, is never reached.
const REFUSALS: readonly [string, (sandbox: DriverSandboxMessage) => DriverSandboxMessage][] = [
  [
    "a tag-only image",
    (sandbox) => withTemplate(sandbox, { image: "registry.invalid/realm/sandbox:latest" }),
  ],
  ["another digest", (sandbox) => withTemplate(sandbox, { image: OTHER_DIGEST_IMAGE })],
  ["a CPU limit other than the profile", (sandbox) => withResources(sandbox, { cpu_limit: "4" })],
  ["a millicore request other than the profile", (sandbox) => withResources(sandbox, { cpu_request: "1500m" })],
  ["a memory limit other than the profile", (sandbox) => withResources(sandbox, { memory_limit: "2Gi" })],
  ["an unparseable memory quantity", (sandbox) => withResources(sandbox, { memory_request: "one gigabyte" })],
  [
    "a GPU request",
    (sandbox) => ({ ...sandbox, spec: { ...sandbox.spec, resource_requirements: { gpu: { count: 1 } } } }),
  ],
  [
    "a non-empty platform config",
    (sandbox) => withTemplate(sandbox, { platform_config: { fields: { hostNetwork: { boolValue: true } } } }),
  ],
  [
    "a non-empty driver config",
    (sandbox) => withTemplate(sandbox, { driver_config: { fields: { mounts: { stringValue: "/" } } } }),
  ],
  ["a user-namespace request", (sandbox) => withTemplate(sandbox, { user_namespaces: true })],
  ["an environment", (sandbox) => ({ ...sandbox, spec: { ...sandbox.spec, environment: { TOKEN: "x" } } })],
  ["an empty argv", (sandbox) => ({ ...sandbox, spec: { ...sandbox.spec, command: [] } })],
  [
    "an isolation backend selection",
    (sandbox) => ({ ...sandbox, spec: { ...sandbox.spec, isolation_backend: { name: "external" } } }),
  ],
  ["a sandbox name without the realm prefix", (sandbox) => ({ ...sandbox, name: "agent-1" })],
  ["a workspace that escapes the root", (sandbox) => ({ ...sandbox, workspace: "../elsewhere" })],
  ["no spec", (sandbox) => ({ ...sandbox, spec: null })],
];

for (const [label, change] of REFUSALS) {
  void test(`PRD-DRV-02: CreateSandbox refuses ${label} with SCHEMA_INVALID before any create`, async () => {
    const { driver, lifecycle } = harness();
    const sandbox = change(validSandbox());
    assert.throws(() => driver.validateSandboxCreate(sandbox), expectCode("SCHEMA_INVALID"));
    await assert.rejects(driver.createSandbox(sandbox), expectCode("SCHEMA_INVALID"));
    assert.equal(lifecycle.creates.length, 0);
  });
}

void test("PRD-DRV-02: a conforming request is accepted, and only its exact spec reaches the lifecycle", async () => {
  const { driver, lifecycle, config } = harness();
  assert.deepEqual(driver.validateSandboxCreate(validSandbox()), {});
  const created = await driver.createSandbox(validSandbox());
  assert.equal(created.runtime_identity, "id-realm-session-1");
  assert.deepEqual(lifecycle.creates, [
    {
      sandboxName: "realm-session-1",
      image: SANDBOX_IMAGE,
      workspaceDir: join(config.workspaceRoot, "workspace-a"),
      stateDir: join(config.sandboxStateRoot, "realm-session-1"),
    },
  ]);
});

void test("PRD-DRV-02: a create with absent directories makes the workspace and the state directory before the lifecycle runs", async () => {
  const config = driverConfig();
  const workspace = join(config.workspaceRoot, "workspace-a");
  const stateDir = join(config.sandboxStateRoot, "realm-session-1");
  assert.equal(existsSync(workspace), false);
  assert.equal(existsSync(stateDir), false);
  const modesAtCreate: number[][] = [];
  const lifecycle = {
    create: (spec: ContainerSpec) => {
      modesAtCreate.push([statSync(spec.workspaceDir).mode & 0o777, statSync(spec.stateDir).mode & 0o777]);
      return Promise.resolve("id-realm-session-1");
    },
    delete: () => Promise.resolve(),
  };
  const driver = new ComputeDriver(config, { lifecycle, libpod: new FakeLibpod() });
  await driver.createSandbox(validSandbox());
  assert.deepEqual(modesAtCreate, [[0o700, 0o700]]);
});

void test("PRD-DRV-02: a create whose state directory already exists is refused, and creates nothing", async () => {
  const { driver, lifecycle, config } = harness();
  const stateDir = join(config.sandboxStateRoot, "realm-session-1");
  mkdirSync(stateDir);
  const leftover = join(stateDir, "leftover.txt");
  writeFileSync(leftover, "from an earlier sandbox");
  await assert.rejects(driver.createSandbox(validSandbox()), expectCode("SCHEMA_INVALID"));
  assert.equal(lifecycle.creates.length, 0);
  assert.equal(existsSync(leftover), true);
  assert.equal(lstatOrUndefined(join(config.workspaceRoot, "workspace-a")), undefined);
});

void test("PRD-DRV-02: a lifecycle refusal removes the state directory this call made, keeps a pre-existing workspace, and rethrows the original error", async () => {
  const config = driverConfig();
  const workspace = join(config.workspaceRoot, "workspace-a");
  mkdirSync(workspace);
  const notes = join(workspace, "notes.txt");
  writeFileSync(notes, "user data");
  const refusal = new RealmError("SCHEMA_INVALID");
  const stateDirSeen: boolean[] = [];
  const driver = new ComputeDriver(config, {
    lifecycle: refusingLifecycle(refusal, stateDirSeen),
    libpod: new FakeLibpod(),
  });
  await assert.rejects(driver.createSandbox(validSandbox()), (error: unknown) => error === refusal);
  assert.deepEqual(stateDirSeen, [true]);
  assert.equal(lstatOrUndefined(join(config.sandboxStateRoot, "realm-session-1")), undefined);
  assert.equal(existsSync(notes), true);
});

void test("PRD-DRV-01: a create whose workspace is a symbolic link or a non-directory is refused before any directory is made", async () => {
  const { driver, lifecycle, config } = harness();
  const outside = join(config.workspaceRoot, "..", "outside");
  mkdirSync(outside);
  symlinkSync(outside, join(config.workspaceRoot, "linked"));
  const plain = join(config.workspaceRoot, "plain");
  writeFileSync(plain, "not a directory");
  await assert.rejects(driver.createSandbox(validSandbox({ workspace: "linked" })), expectCode("SCHEMA_INVALID"));
  await assert.rejects(driver.createSandbox(validSandbox({ workspace: "plain" })), expectCode("SCHEMA_INVALID"));
  assert.equal(lifecycle.creates.length, 0);
  assert.equal(lstatOrUndefined(join(config.sandboxStateRoot, "realm-session-1")), undefined);
  assert.equal(existsSync(outside), true);
  assert.equal(lstatSync(plain).isFile(), true);
});

void test("PRD-DRV-02: CPU and memory written another way for the same profile are accepted", () => {
  const { driver } = harness();
  for (const resources of [
    { cpu_limit: "2000m", memory_limit: "1024Mi" },
    { cpu_limit: "2.0", memory_limit: "1073741824" },
    { cpu_request: "", cpu_limit: "", memory_request: "", memory_limit: "" },
  ]) {
    assert.doesNotThrow(() => driver.validateSandboxCreate(withResources(validSandbox(), resources)));
  }
});

void test("PRD-GW-03: GetCapabilities returns the same pinned admission acknowledgement on every call", () => {
  const { driver, config } = harness();
  const first = driver.getCapabilities({});
  const second = driver.getCapabilities({});
  assert.equal(first["resource_admission_policy"], DRIVER_ADMISSION_ACKNOWLEDGEMENT);
  assert.equal(second["resource_admission_policy"], DRIVER_ADMISSION_ACKNOWLEDGEMENT);
  assert.equal(first["driver_name"], config.driverName);
  assert.equal(first["default_image"], SANDBOX_IMAGE);
});

void test("PRD-DRV-01: GetCapabilities advertises the contract but not the isolation backend (phase 9.5)", () => {
  const { driver } = harness();
  const extension = driver.getCapabilities({})["extension"] as { supported_capabilities: string[] };
  assert.deepEqual(extension.supported_capabilities, ["openshell.compute.contract"]);
});

void test("PRD-DRV-01: GetCapabilities refuses a gateway that requires a capability the driver lacks", () => {
  const { driver } = harness();
  assert.throws(
    () => driver.getCapabilities({ gateway: { required_capabilities: ["openshell.compute.isolation-backend"] } }),
    expectCode("SCHEMA_INVALID"),
  );
});

void test("PRD-DRV-03: StopSandbox and StartSandbox refuse with the transition code and read no state", async () => {
  const { driver, libpod } = harness();
  await driver.createSandbox(validSandbox());
  const inspectsBefore = libpod.inspectCalls;
  assert.throws(() => driver.stopSandbox(), expectCode("REALM_INVALID_TRANSITION"));
  assert.throws(() => driver.startSandbox(), expectCode("REALM_INVALID_TRANSITION"));
  assert.equal(libpod.inspectCalls, inspectsBefore);
  assert.equal(libpod.containers.get("realm-session-1")?.running, true);
  assert.equal(driverFailureOf(new RealmError("REALM_INVALID_TRANSITION")).code, status.FAILED_PRECONDITION);
});

void test("the driver reports a created sandbox as Ready only while its container runs", async () => {
  const { driver, libpod } = harness();
  await driver.createSandbox(validSandbox());
  const running = await driver.getSandbox({ sandbox_id: "sandbox-1" });
  assert.equal(running.sandbox.id, "sandbox-1");
  assert.equal(running.sandbox.status.conditions[0]?.status, "True");
  const container = libpod.containers.get("realm-session-1");
  if (container === undefined) {
    throw new Error("container missing from fake");
  }
  container.running = false;
  const stopped = await driver.getSandbox({ name: "realm-session-1" });
  const [stoppedCondition] = stopped.sandbox.status.conditions;
  assert.equal(stoppedCondition?.status, "False");
  assert.equal(stoppedCondition.reason, "exited");
});

void test("ListSandboxes lists only realm sandboxes that have both a registry entry and a labelled container", async () => {
  const { driver, libpod } = harness();
  await driver.createSandbox(validSandbox());
  libpod.add("realm-foreign", true);
  const listed = await driver.listSandboxes();
  assert.deepEqual(
    listed.sandboxes.map((sandbox) => sandbox.name),
    ["realm-session-1"],
  );
});

void test("GetSandbox of an unknown name or an unknown id is NOT_FOUND", async () => {
  const { driver } = harness();
  await assert.rejects(driver.getSandbox({ name: "realm-missing" }), expectNotFound);
  await assert.rejects(driver.getSandbox({ sandbox_id: "never-created" }), expectNotFound);
});

void test("DeleteSandbox removes the sandbox, and is idempotent for one that is already gone", async () => {
  const { driver, lifecycle, libpod } = harness();
  await driver.createSandbox(validSandbox());
  assert.deepEqual(await driver.deleteSandbox({ sandbox_id: "sandbox-1" }), { deleted: true });
  assert.equal(libpod.containers.has("realm-session-1"), false);
  assert.deepEqual(lifecycle.deletes, ["realm-session-1"]);
  assert.deepEqual(await driver.deleteSandbox({ name: "realm-session-1" }), { deleted: false });
  assert.deepEqual(await driver.deleteSandbox({ sandbox_id: "sandbox-1" }), { deleted: false });
});

void test("EnsureWorkspace creates a 0700 directory under the root, and is idempotent", () => {
  const { driver, config } = harness();
  mkdirSync(config.workspaceRoot, { recursive: true });
  driver.ensureWorkspace({ workspace: "workspace-a" });
  driver.ensureWorkspace({ workspace: "workspace-a" });
  assert.equal(statSync(join(config.workspaceRoot, "workspace-a")).mode & 0o777, 0o700);
});

void test("PRD-DRV-01: a workspace that is a symbolic link is refused and never followed", () => {
  const { driver, config } = harness();
  mkdirSync(config.workspaceRoot, { recursive: true });
  const outside = join(config.workspaceRoot, "..", "outside");
  mkdirSync(outside);
  symlinkSync(outside, join(config.workspaceRoot, "linked"));
  assert.throws(() => driver.ensureWorkspace({ workspace: "linked" }), expectCode("SCHEMA_INVALID"));
  assert.throws(() => driver.deleteWorkspace({ workspace: "linked" }), expectCode("SCHEMA_INVALID"));
  assert.equal(existsSync(outside), true);
});

void test("DeleteWorkspace refuses a workspace that still holds files, and removes it once empty", () => {
  const { driver, config } = harness();
  mkdirSync(config.workspaceRoot, { recursive: true });
  driver.ensureWorkspace({ workspace: "workspace-a" });
  const notes = join(config.workspaceRoot, "workspace-a", "notes.txt");
  writeFileSync(notes, "user data");
  assert.throws(() => driver.deleteWorkspace({ workspace: "workspace-a" }), expectCode("REALM_INVALID_TRANSITION"));
  assert.equal(existsSync(notes), true);
  unlinkSync(notes);
  driver.deleteWorkspace({ workspace: "workspace-a" });
  assert.equal(lstatOrUndefined(join(config.workspaceRoot, "workspace-a")), undefined);
  driver.deleteWorkspace({ workspace: "workspace-a" });
});

void test("a workspace id with a path separator, a dot-segment or no value is refused", () => {
  const { driver } = harness();
  for (const workspace of ["../x", "a/b", "..", ".", ""]) {
    assert.throws(() => driver.ensureWorkspace({ workspace }), expectCode("SCHEMA_INVALID"));
  }
});

function lstatOrUndefined(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

void test("PD-05: GetCapabilities advertises the configured non-empty implementation version", () => {
  const { driver, config } = harness();
  const extension = driver.getCapabilities({})["extension"];
  assert.ok(extension !== null && typeof extension === "object" && "implementation_version" in extension);
  assert.notEqual(config.implementationVersion, "");
  assert.equal(extension.implementation_version, config.implementationVersion);
});

void test("PD-05: the constructor refuses an implementation version the gateway would reject", () => {
  for (const implementationVersion of ["", "   ", "0.1.2\n", "v".repeat(129)]) {
    const libpod = new FakeLibpod();
    const lifecycle = new FakeLifecycle(libpod);
    assert.throws(
      () => new ComputeDriver(driverConfig({ implementationVersion }), { lifecycle, libpod }),
      expectCode("SCHEMA_INVALID"),
    );
  }
});
