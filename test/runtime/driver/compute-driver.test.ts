import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { status } from "@grpc/grpc-js";
import { makeRealmError, RealmError } from "../../../src/core/errors.js";
import { bindRoot } from "../../../src/fs/root.js";
import { ComputeDriver, computeDriverImplementation, type ComputeDriverConfig, type DriverSandboxMessage } from "../../../src/runtime/driver/compute-driver.js";
import { DRIVER_ADMISSION_ACKNOWLEDGEMENT } from "../../../src/runtime/driver/admission.js";
import { DriverStatusError, driverFailureOf } from "../../../src/runtime/driver/grpc-status.js";
import { DriverLifecycle, type AdoptionRoots, type LifecycleLibpod } from "../../../src/runtime/driver/lifecycle.js";
import type { ContainerSpec, LibpodContainerSummary, LibpodInspect } from "../../../src/runtime/libpod-client.js";
import { recordFileName, sandboxNameOfSession, sessionIdOfWorkspace } from "../../../src/session/paths.js";
import { workspaceRegistryDirOf, writeWorkspaceEntry } from "../../../src/session/workspace-registry.js";
import {
  diskLifecycle,
  FakeLibpod,
  FakeLifecycle,
  FakeRuntime,
  driverConfig,
  OTHER_DIGEST_IMAGE,
  SANDBOX_IMAGE,
  validSandbox,
  writeSandboxWorkspaceEntry,
} from "./fakes.js";

// Binds a project directory under the ceiling: creates it, writes its registry entry, and returns the sandbox name the entry gives
// and the directory's real path. Every create in these tests names a sandbox bound this way.
function bindProject(config: ComputeDriverConfig, dirName: string): { name: string; project: string } {
  const dir = join(config.workspaceRoot, dirName);
  const name = writeSandboxWorkspaceEntry(config, dir);
  return { name, project: realpathSync(dir) };
}

// A driver over one ceiling, with the project directory project-a bound under the name its registry entry gives.
function harness() {
  const libpod = new FakeLibpod();
  const lifecycle = new FakeLifecycle(libpod);
  const runtime = new FakeRuntime();
  const config = driverConfig();
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime });
  const { name, project } = bindProject(config, "project-a");
  return { libpod, lifecycle, runtime, config, driver, name, project };
}

// The spec the lifecycle receives for a create of the given container name and workspace: its image, workspace, state directory and channel.
function specOf(config: ComputeDriverConfig, containerName: string, workspaceDir: string): ContainerSpec {
  return {
    sandboxName: containerName,
    image: SANDBOX_IMAGE,
    workspaceDir,
    stateDir: join(config.sandboxStateRoot, containerName),
    channelDir: join(config.secretRoot, containerName, "channel"),
  };
}

// A lifecycle that records whether the state directory existed when it was called, then refuses with the given error.
function refusingLifecycle(error: RealmError, stateDirSeen: boolean[]) {
  return {
    create: (spec: ContainerSpec) => {
      stateDirSeen.push(existsSync(spec.stateDir));
      return Promise.reject(error);
    },
    delete: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  };
}

function expectCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof RealmError && error.code === code;
}

function expectNotFound(error: unknown): boolean {
  return error instanceof DriverStatusError && error.failure.code === status.NOT_FOUND;
}

// Lets every microtask an exit queued run before the test looks at the result: a macrotask turn runs after them all.
function settle(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
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
  [
    "an argument that is an empty string",
    (sandbox) => ({ ...sandbox, spec: { ...sandbox.spec, command: ["/usr/bin/true", ""] } }),
  ],
  [
    "an isolation backend selection",
    (sandbox) => ({ ...sandbox, spec: { ...sandbox.spec, isolation_backend: { name: "external" } } }),
  ],
  ["a workspace that escapes the root", (sandbox) => ({ ...sandbox, workspace: "../elsewhere" })],
  ["no spec", (sandbox) => ({ ...sandbox, spec: null })],
];

for (const [label, change] of REFUSALS) {
  void test(`PRD-DRV-02: CreateSandbox refuses ${label} with SCHEMA_INVALID before any create`, async () => {
    const { driver, lifecycle, name } = harness();
    const sandbox = change(validSandbox({ name }));
    assert.throws(() => driver.validateSandboxCreate(sandbox), expectCode("SCHEMA_INVALID"));
    await assert.rejects(driver.createSandbox(sandbox), expectCode("SCHEMA_INVALID"));
    assert.equal(lifecycle.creates.length, 0);
  });
}

void test("PRD-DRV-02: a conforming request is accepted, and only its exact spec reaches the lifecycle, then the runtime's listener is confirmed", async () => {
  const { driver, lifecycle, runtime, config, name, project } = harness();
  assert.deepEqual(driver.validateSandboxCreate(validSandbox({ name })), {});
  const created = await driver.createSandbox(validSandbox({ name }));
  assert.equal(created.runtime_identity, `id-${name}`);
  assert.deepEqual(lifecycle.creates, [specOf(config, name, project)]);
  assert.deepEqual(
    runtime.confirmations.map((confirmation) => confirmation.controlSocket),
    [join(config.secretRoot, name, "channel", "control.sock")],
  );
  assert.equal(runtime.supervisors.length, 1);
});

void test("PRD-DRV-02: a create mounts only the directory its registry entry names, and the container's mount list names that directory", async () => {
  const { driver, lifecycle, libpod, config, name, project } = harness();
  await driver.createSandbox(validSandbox({ name }));
  assert.equal(lifecycle.creates[0]?.workspaceDir, project);
  assert.notEqual(project, config.workspaceRoot);
  assert.equal(libpod.containers.get(name)?.workspace, project);
});

void test("PRD-DRV-02: a prefixed name whose control socket path exceeds 107 bytes is refused with SCHEMA_INVALID before any write or libpod call", async () => {
  const { driver, lifecycle, config, libpod } = harness();
  const name = "a".repeat(122);
  const sandbox = validSandbox({ name: `realm-${name}` });
  assert.throws(() => driver.validateSandboxCreate(sandbox), expectCode("SCHEMA_INVALID"));
  await assert.rejects(driver.createSandbox(sandbox), expectCode("SCHEMA_INVALID"));
  assert.equal(lifecycle.creates.length, 0);
  assert.equal(libpod.inspectCalls, 0);
  assert.equal(lstatOrUndefined(join(config.sandboxStateRoot, `realm-${name}`)), undefined);
  assert.equal(lstatOrUndefined(join(config.secretRoot, `realm-${name}`)), undefined);
});

void test("PRD-DRV-02: the derived sandbox name is accepted when both socket paths fit 107 bytes, and a secret root that pushes the host socket past 107 bytes is refused before any write or libpod call", async () => {
  const { driver, lifecycle, config, name } = harness();
  const created = await driver.createSandbox(validSandbox({ name }));
  assert.equal(created.runtime_identity, `id-${name}`);
  assert.equal(lifecycle.creates[0]?.sandboxName, name);
  // The refusing driver has its own state root, so the state directory the accepted create made is not in its way.
  const refusedBase = dirname(config.workspaceRoot);
  const longSecrets = { ...config, secretRoot: join(refusedBase, "s".repeat(80)), sandboxStateRoot: join(refusedBase, "refused-state") };
  mkdirSync(longSecrets.sandboxStateRoot);
  const libpod = new FakeLibpod();
  const refusedLifecycle = new FakeLifecycle(libpod);
  const refusing = new ComputeDriver(longSecrets, { lifecycle: refusedLifecycle, libpod, runtime: new FakeRuntime() });
  assert.throws(() => refusing.validateSandboxCreate(validSandbox({ name })), expectCode("SCHEMA_INVALID"));
  await assert.rejects(refusing.createSandbox(validSandbox({ name })), expectCode("SCHEMA_INVALID"));
  assert.equal(refusedLifecycle.creates.length, 0);
  assert.equal(libpod.inspectCalls, 0);
  assert.equal(lstatOrUndefined(join(longSecrets.secretRoot, name)), undefined);
  assert.equal(lstatOrUndefined(join(longSecrets.sandboxStateRoot, name)), undefined);
});

void test("PRD-DRV-02: a name that fails the container-name rule after prefixing is refused with no libpod call and no directory", async () => {
  for (const name of ["agent/1", "a".repeat(123)]) {
    const { driver, lifecycle, config, libpod, project } = harness();
    const sandbox = validSandbox({ name });
    assert.throws(() => driver.validateSandboxCreate(sandbox), expectCode("SCHEMA_INVALID"));
    await assert.rejects(driver.createSandbox(sandbox), expectCode("SCHEMA_INVALID"));
    assert.equal(libpod.inspectCalls, 0);
    assert.equal(libpod.containers.size, 0);
    assert.equal(lifecycle.creates.length, 0);
    assert.equal(lstatOrUndefined(join(config.sandboxStateRoot, `realm-${name}`)), undefined);
    assert.deepEqual(readdirSync(project), []);
  }
});

void test("PRD-DRV-02: an empty argv is accepted, and the lifecycle receives the spec with no command forwarded", async () => {
  const { driver, lifecycle, config, name, project } = harness();
  const base = validSandbox({ name });
  const sandbox: DriverSandboxMessage = { ...base, spec: { ...base.spec, command: [] } };
  assert.deepEqual(driver.validateSandboxCreate(sandbox), {});
  await driver.createSandbox(sandbox);
  assert.deepEqual(lifecycle.creates, [specOf(config, name, project)]);
});

void test("PRD-DRV-02: a create makes only the state directory, and the project keeps its mode and is never created", async () => {
  const config = driverConfig();
  const { name, project } = bindProject(config, "project-a");
  chmodSync(project, 0o755);
  const stateDir = join(config.sandboxStateRoot, name);
  assert.equal(existsSync(stateDir), false);
  const modesAtCreate: number[][] = [];
  const lifecycle = {
    create: (spec: ContainerSpec) => {
      modesAtCreate.push([statSync(spec.workspaceDir).mode & 0o777, statSync(spec.stateDir).mode & 0o777]);
      return Promise.resolve(`id-${name}`);
    },
    delete: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  };
  const driver = new ComputeDriver(config, { lifecycle, libpod: new FakeLibpod(), runtime: new FakeRuntime() });
  await driver.createSandbox(validSandbox({ name }));
  assert.deepEqual(modesAtCreate, [[0o755, 0o700]]);
  assert.deepEqual(readdirSync(project), []);
});

// A libpod whose inspect of a name answers as usual until the given call, and finds no container from then on.
class VanishingLibpod extends FakeLibpod {
  vanishAt = Number.POSITIVE_INFINITY;

  override inspectContainer(reference: string): Promise<LibpodInspect | null> {
    if (this.inspectCalls + 1 >= this.vanishAt) {
      this.inspectCalls += 1;
      return Promise.resolve(null);
    }
    return super.inspectContainer(reference);
  }
}

// A libpod whose inspect of a container cannot be read.
class UnreadableLibpod extends FakeLibpod {
  override inspectContainer(): Promise<LibpodInspect | null> {
    this.inspectCalls += 1;
    return Promise.reject(new Error("inspect refused"));
  }
}

const STATE_DIR_REFUSAL_CHECK = "check=create.state_dir code=SCHEMA_INVALID";
const SECRET_DIR_REFUSAL_CHECK = "check=create.secret_dir code=SCHEMA_INVALID";
const STATE_DIR_REFUSAL = `realm compute driver refused: rpc=CreateSandbox ${STATE_DIR_REFUSAL_CHECK}`;
const SECRET_DIR_REFUSAL = `realm compute driver refused: rpc=CreateSandbox ${SECRET_DIR_REFUSAL_CHECK}`;

// A driver over the real state and secret directories: the lifecycle's delete removes them from disk. Refusal lines are collected.
async function diskHarness(libpod: FakeLibpod = new FakeLibpod()) {
  const lines: string[] = [];
  const config = driverConfig({ refusalLog: (line) => lines.push(line) });
  const { name, project } = bindProject(config, "project-a");
  const lifecycle = await diskLifecycle(config, libpod);
  const runtime = new FakeRuntime();
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime });
  return {
    libpod,
    lifecycle,
    runtime,
    config,
    driver,
    lines,
    name,
    project,
    stateDir: join(config.sandboxStateRoot, name),
    secretDir: join(config.secretRoot, name),
  };
}

// Reproduces what a crashed driver leaves behind after a create: both directories on disk with the given files in them.
function leaveStaleDirectories(stateDir: string, secretDir: string): { stateSentinel: string; secretSentinel: string } {
  mkdirSync(stateDir);
  mkdirSync(secretDir, { recursive: true, mode: 0o700 });
  const stateSentinel = join(stateDir, "sentinel.txt");
  const secretSentinel = join(secretDir, "main-exit");
  writeFileSync(stateSentinel, "from a crashed sandbox");
  writeFileSync(secretSentinel, "from a crashed sandbox", { mode: 0o600 });
  return { stateSentinel, secretSentinel };
}

void test("PRD-DRV-02: a create whose state or secret directory exists while a container of that name exists is refused with the same check, and nothing is deleted", async () => {
  for (const which of ["state", "secret"] as const) {
    const lines: string[] = [];
    const config = driverConfig({ refusalLog: (line) => lines.push(line) });
    const { name, project } = bindProject(config, "project-a");
    const libpod = new FakeLibpod();
    const lifecycle = new FakeLifecycle(libpod);
    const driver = new ComputeDriver(config, { lifecycle, libpod, runtime: new FakeRuntime() });
    libpod.add(name, false);
    const dir = which === "state" ? join(config.sandboxStateRoot, name) : join(config.secretRoot, name);
    mkdirSync(dir, { recursive: true });
    const leftover = join(dir, "leftover.txt");
    writeFileSync(leftover, "from an earlier sandbox");
    await assert.rejects(driver.createSandbox(validSandbox({ name })), expectCode("SCHEMA_INVALID"));
    assert.deepEqual(lines, [which === "state" ? STATE_DIR_REFUSAL : SECRET_DIR_REFUSAL]);
    assert.equal(lifecycle.creates.length, 0);
    assert.deepEqual(lifecycle.deletes, []);
    assert.equal(existsSync(leftover), true);
    assert.equal(libpod.containers.has(name), true);
    assert.deepEqual(readdirSync(project), []);
  }
});

void test("PRD-DRV-02: a create whose state directory exists while a running container of that name binds its workspace is refused with the transition code, and nothing is deleted", async () => {
  const { driver, lifecycle, libpod, config, name, project } = harness();
  libpod.add(name, true, project);
  const stateDir = join(config.sandboxStateRoot, name);
  mkdirSync(stateDir);
  const leftover = join(stateDir, "leftover.txt");
  writeFileSync(leftover, "live sandbox state");
  await assert.rejects(driver.createSandbox(validSandbox({ name })), expectCode("REALM_INVALID_TRANSITION"));
  assert.deepEqual(lifecycle.deletes, []);
  assert.equal(lifecycle.creates.length, 0);
  assert.equal(existsSync(leftover), true);
  assert.equal(libpod.containers.get(name)?.running, true);
});

void test("PRD-DRV-02: a create whose state and secret directories remain from a sandbox whose container is gone reclaims them, stops the stale supervisor, and succeeds", async () => {
  const { driver, lifecycle, libpod, runtime, name, stateDir, secretDir, lines } = await diskHarness();
  await driver.createSandbox(validSandbox({ name }));
  const [stale] = runtime.supervisors;
  assert.ok(stale !== undefined);
  // The crash: a restart removed the container; the directories and the driver's handle for it remain.
  libpod.containers.delete(name);
  const stateSentinel = join(stateDir, "sentinel.txt");
  const secretSentinel = join(secretDir, "main-exit");
  writeFileSync(stateSentinel, "from a crashed sandbox");
  writeFileSync(secretSentinel, "from a crashed sandbox", { mode: 0o600 });
  lifecycle.deletes.length = 0;
  const created = await driver.createSandbox(validSandbox({ name }));
  assert.equal(created.runtime_identity, `id-${name}`);
  assert.equal(stale.stops, 1, "the stale supervisor handle was stopped");
  assert.deepEqual(lifecycle.deletes, [name]);
  assert.equal(existsSync(stateSentinel), false, "the stale state directory's file is gone");
  assert.equal(existsSync(secretSentinel), false, "the stale secret directory's file is gone");
  assert.equal(runtime.supervisors.length, 2, "the new sandbox has its own supervisor");
  assert.equal(runtime.supervisors[1]?.stops, 0);
  assert.equal(existsSync(join(secretDir, "launch.json")), true, "the new launch material is written");
  assert.deepEqual(lines, []);
});

void test("PRD-DRV-02: a create whose stale state directory holds a socket is refused as the create-time check does, and nothing is removed", async () => {
  const { driver, lifecycle, libpod, runtime, name, stateDir, secretDir, lines } = await diskHarness();
  await driver.createSandbox(validSandbox({ name }));
  const [stale] = runtime.supervisors;
  libpod.containers.delete(name);
  writeFileSync(join(stateDir, "sentinel.txt"), "from a crashed sandbox");
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(join(stateDir, "s.sock"), resolve);
  });
  try {
    lifecycle.deletes.length = 0;
    await assert.rejects(driver.createSandbox(validSandbox({ name })), expectCode("SCHEMA_INVALID"));
    assert.deepEqual(lines, [STATE_DIR_REFUSAL]);
    assert.deepEqual(lifecycle.deletes, []);
    assert.equal(existsSync(join(stateDir, "sentinel.txt")), true);
    assert.equal(existsSync(join(secretDir, "launch.json")), true);
    assert.equal(stale?.stops, 0, "the supervisor handle is kept when nothing is reclaimed");
  } finally {
    server.close();
  }
});

void test("PRD-DRV-02: a create whose container lookup cannot be read is refused with the same check, and nothing is removed", async () => {
  const { driver, lifecycle, name, stateDir, secretDir, lines } = await diskHarness(new UnreadableLibpod());
  const { stateSentinel, secretSentinel } = leaveStaleDirectories(stateDir, secretDir);
  await assert.rejects(driver.createSandbox(validSandbox({ name })), expectCode("SCHEMA_INVALID"));
  assert.deepEqual(lines, [STATE_DIR_REFUSAL]);
  assert.deepEqual(lifecycle.deletes, []);
  assert.equal(lifecycle.creates.length, 0);
  assert.equal(existsSync(stateSentinel), true);
  assert.equal(existsSync(secretSentinel), true);
});

void test("PRD-DRV-02: a name the driver tracks as an unremoved container is refused with the same check, whatever a later lookup finds, and nothing is removed", async () => {
  const libpod = new VanishingLibpod();
  const { lifecycle, runtime, name, stateDir, secretDir, lines, config } = await diskHarness(libpod);
  // A failed create whose container cannot be removed leaves the container in the driver's unremoved set.
  const undeletable = {
    create: lifecycle.create.bind(lifecycle),
    stop: lifecycle.stop.bind(lifecycle),
    delete: (): Promise<void> => Promise.reject(new Error("delete refused")),
  };
  const tracking = new ComputeDriver(config, { lifecycle: undeletable, libpod, runtime });
  runtime.exitOnSpawn = true;
  await assert.rejects(tracking.createSandbox(validSandbox({ name })), expectCode("OPENSHELL_START_FAILED"));
  runtime.exitOnSpawn = false;
  const container = libpod.containers.get(name);
  assert.ok(container !== undefined);
  container.running = false;
  const { stateSentinel, secretSentinel } = leaveStaleDirectories(stateDir, secretDir);
  // The workspace check finds the stopped container, which stays tracked; the next lookup would find nothing.
  libpod.vanishAt = libpod.inspectCalls + 2;
  lifecycle.deletes.length = 0;
  await assert.rejects(tracking.createSandbox(validSandbox({ name })), expectCode("SCHEMA_INVALID"));
  assert.deepEqual(lifecycle.deletes, []);
  assert.equal(existsSync(stateSentinel), true);
  assert.equal(existsSync(secretSentinel), true);
  assert.equal(lines.at(-1), STATE_DIR_REFUSAL);
});

void test("PRD-DRV-02: a create with no state or secret directory makes the same libpod calls as before: one list, no inspect, no delete", async () => {
  const { driver, lifecycle, libpod, name } = harness();
  await driver.createSandbox(validSandbox({ name }));
  assert.equal(libpod.listCalls, 1, "only the workspace check lists containers");
  assert.equal(libpod.inspectCalls, 0);
  assert.deepEqual(lifecycle.deletes, []);
  assert.equal(lifecycle.creates.length, 1);
});

void test("PRD-DRV-02: a lifecycle refusal removes the state directory this call made, keeps the project and its contents, and rethrows the original error", async () => {
  const config = driverConfig();
  const { name, project } = bindProject(config, "project-a");
  const notes = join(project, "notes.txt");
  writeFileSync(notes, "user data");
  const refusal = new RealmError("SCHEMA_INVALID");
  const stateDirSeen: boolean[] = [];
  const driver = new ComputeDriver(config, {
    lifecycle: refusingLifecycle(refusal, stateDirSeen),
    libpod: new FakeLibpod(),
    runtime: new FakeRuntime(),
  });
  await assert.rejects(driver.createSandbox(validSandbox({ name })), (error: unknown) => error === refusal);
  assert.deepEqual(stateDirSeen, [true]);
  assert.equal(lstatOrUndefined(join(config.sandboxStateRoot, name)), undefined);
  assert.equal(existsSync(notes), true);
});

void test("PRD-DRV-01: a create whose ceiling is replaced by a symbolic link, a file or nothing is refused before any directory is made", async () => {
  const { driver, lifecycle, config, name } = harness();
  const outside = join(dirname(config.workspaceRoot), "outside");
  mkdirSync(outside);
  rmSync(config.workspaceRoot, { recursive: true, force: true });
  symlinkSync(outside, config.workspaceRoot);
  await assert.rejects(driver.createSandbox(validSandbox({ name })), expectCode("SCHEMA_INVALID"));
  assert.equal(existsSync(outside), true);
  unlinkSync(config.workspaceRoot);
  writeFileSync(config.workspaceRoot, "not a directory");
  await assert.rejects(driver.createSandbox(validSandbox({ name })), expectCode("SCHEMA_INVALID"));
  assert.equal(lstatSync(config.workspaceRoot).isFile(), true);
  unlinkSync(config.workspaceRoot);
  await assert.rejects(driver.createSandbox(validSandbox({ name })), expectCode("SCHEMA_INVALID"));
  assert.equal(lstatOrUndefined(config.workspaceRoot), undefined, "the driver never creates the ceiling");
  assert.equal(lifecycle.creates.length, 0);
  assert.equal(lstatOrUndefined(join(config.sandboxStateRoot, name)), undefined);
});

void test("PRD-DRV-02: CPU and memory written another way for the same profile are accepted", () => {
  const { driver, name } = harness();
  for (const resources of [
    { cpu_limit: "2000m", memory_limit: "1024Mi" },
    { cpu_limit: "2.0", memory_limit: "1073741824" },
    { cpu_request: "", cpu_limit: "", memory_request: "", memory_limit: "" },
  ]) {
    assert.doesNotThrow(() => driver.validateSandboxCreate(withResources(validSandbox({ name }), resources)));
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

void test("PRD-DRV-01: GetCapabilities advertises the contract and launch authentication, and no other capability", () => {
  const { driver } = harness();
  const extension = driver.getCapabilities({})["extension"] as { supported_capabilities: string[] };
  assert.deepEqual(extension.supported_capabilities, [
    "openshell.compute.contract",
    "openshell.compute.launch-authentication",
  ]);
});

void test("PRD-DRV-01: GetCapabilities refuses a gateway that requires a capability the driver lacks, including the isolation backend", () => {
  const { driver } = harness();
  for (const capability of ["openshell.compute.sandbox-authentication", "openshell.compute.isolation-backend"]) {
    assert.throws(
      () => driver.getCapabilities({ gateway: { required_capabilities: [capability] } }),
      expectCode("SCHEMA_INVALID"),
    );
  }
});

void test("PRD-DRV-01: GetCapabilities accepts a gateway that requires only the capabilities the driver advertises", () => {
  const { driver } = harness();
  assert.doesNotThrow(() =>
    driver.getCapabilities({ gateway: { required_capabilities: ["openshell.compute.launch-authentication"] } }),
  );
});

for (const name of ["realm", "external", "openshell-sandbox", "realm-other", "Realm", ""]) {
  void test(`PRD-DRV-02: a create that selects an isolation backend (name ${JSON.stringify(name)}) is refused before any write or libpod call`, async () => {
    const { driver, lifecycle, libpod, config, name: sandboxName, project } = harness();
    const sandbox = validSandbox({
      name: sandboxName,
      spec: {
        ...validSandbox().spec,
        isolation_backend: { name, endpoint: "unix_socket_path", unix_socket_path: "/run/x.sock" },
      },
    });
    assert.throws(() => driver.validateSandboxCreate(sandbox), expectCode("SCHEMA_INVALID"));
    await assert.rejects(driver.createSandbox(sandbox), expectCode("SCHEMA_INVALID"));
    assert.equal(lifecycle.creates.length, 0);
    assert.equal(libpod.containers.size, 0);
    assert.equal(existsSync(join(config.sandboxStateRoot, sandboxName)), false);
    assert.equal(existsSync(join(config.secretRoot, sandboxName)), false);
    assert.deepEqual(readdirSync(project), []);
  });
}

void test("PRD-DRV-02: a create that selects the configured name over a non-unix endpoint is refused", async () => {
  const { driver, lifecycle, libpod, name } = harness();
  const sandbox = validSandbox({
    name,
    spec: {
      ...validSandbox().spec,
      isolation_backend: { name: "realm", endpoint: "tcp", tcp: { authority: "realm.invalid", addresses: ["10.0.0.1:443"] } },
    },
  });
  assert.throws(() => driver.validateSandboxCreate(sandbox), expectCode("SCHEMA_INVALID"));
  await assert.rejects(driver.createSandbox(sandbox), expectCode("SCHEMA_INVALID"));
  assert.equal(lifecycle.creates.length, 0);
  assert.equal(libpod.containers.size, 0);
});

void test("PRD-DRV-03: StopSandbox and StartSandbox refuse with the transition code and read no state", async () => {
  const { driver, libpod, name } = harness();
  await driver.createSandbox(validSandbox({ name }));
  const inspectsBefore = libpod.inspectCalls;
  assert.throws(() => driver.stopSandbox(), expectCode("REALM_INVALID_TRANSITION"));
  assert.throws(() => driver.startSandbox(), expectCode("REALM_INVALID_TRANSITION"));
  assert.equal(libpod.inspectCalls, inspectsBefore);
  assert.equal(libpod.containers.get(name)?.running, true);
  assert.equal(driverFailureOf(new RealmError("REALM_INVALID_TRANSITION")).code, status.FAILED_PRECONDITION);
});

void test("the driver reports a created sandbox as Ready only while its container runs", async () => {
  const { driver, libpod, name } = harness();
  await driver.createSandbox(validSandbox({ name }));
  const running = await driver.getSandbox({ sandbox_id: "sandbox-1" });
  assert.equal(running.sandbox.id, "sandbox-1");
  assert.equal(running.sandbox.status.conditions[0]?.status, "True");
  const container = libpod.containers.get(name);
  if (container === undefined) {
    throw new Error("container missing from fake");
  }
  container.running = false;
  const stopped = await driver.getSandbox({ name });
  const [stoppedCondition] = stopped.sandbox.status.conditions;
  assert.equal(stoppedCondition?.status, "False");
  assert.equal(stoppedCondition.reason, "exited");
});

void test("ListSandboxes lists only realm sandboxes that have both a registry entry and a labelled container", async () => {
  const { driver, libpod, name } = harness();
  await driver.createSandbox(validSandbox({ name }));
  libpod.add("realm-foreign", true);
  const listed = await driver.listSandboxes();
  assert.deepEqual(
    listed.sandboxes.map((sandbox) => sandbox.name),
    [name],
  );
});

void test("GetSandbox, ListSandboxes and the watch snapshot report the gateway's name, not the container name", async () => {
  const { driver, name } = harness();
  await driver.createSandbox(validSandbox({ name }));
  const byName = await driver.getSandbox({ name });
  const byId = await driver.getSandbox({ sandbox_id: "sandbox-1" });
  assert.equal(byName.sandbox.name, name);
  assert.equal(byName.sandbox.status.name, name);
  assert.equal(byId.sandbox.name, name);
  const listed = await driver.listSandboxes();
  assert.deepEqual(
    listed.sandboxes.map((sandbox) => sandbox.name),
    [name],
  );
  assert.deepEqual([...(await driver.snapshotAll()).keys()], [name]);
});

void test("GetSandbox of an unknown name or an unknown id is NOT_FOUND", async () => {
  const { driver, config } = harness();
  await assert.rejects(driver.getSandbox({ name: sandboxNameOfSession(sessionIdOfWorkspace(join(config.workspaceRoot, "missing"))) }), expectNotFound);
  await assert.rejects(driver.getSandbox({ sandbox_id: "never-created" }), expectNotFound);
});

void test("DeleteSandbox removes the sandbox, and is idempotent for one that is already gone", async () => {
  const { driver, lifecycle, libpod, name } = harness();
  await driver.createSandbox(validSandbox({ name }));
  assert.deepEqual(await driver.deleteSandbox({ sandbox_id: "sandbox-1" }), { deleted: true });
  assert.equal(libpod.containers.has(name), false);
  assert.deepEqual(lifecycle.deletes, [name]);
  assert.deepEqual(await driver.deleteSandbox({ name }), { deleted: false });
  assert.deepEqual(await driver.deleteSandbox({ sandbox_id: "sandbox-1" }), { deleted: false });
});

void test("DeleteSandbox by the gateway's name removes the container under that name", async () => {
  const { driver, lifecycle, libpod, name } = harness();
  await driver.createSandbox(validSandbox({ name }));
  assert.deepEqual(await driver.deleteSandbox({ name }), { deleted: true });
  assert.equal(libpod.containers.has(name), false);
  assert.deepEqual(lifecycle.deletes, [name]);
  await assert.rejects(driver.getSandbox({ name }), expectNotFound);
});

void test("DeleteSandbox by a name whose container another sandbox holds deletes nothing", async () => {
  const { driver, lifecycle, libpod, name } = harness();
  await driver.createSandbox(validSandbox({ name }));
  // The gateway's name without its realm prefix names the same container, which the registered sandbox holds.
  assert.deepEqual(await driver.deleteSandbox({ name: name.slice("realm-".length) }), { deleted: false });
  assert.equal(libpod.containers.has(name), true);
  assert.deepEqual(lifecycle.deletes, []);
  assert.deepEqual(await driver.deleteSandbox({ sandbox_id: "sandbox-1" }), { deleted: true });
  assert.equal(libpod.containers.has(name), false);
});

void test("PRD-DRV-02: a second create for a project whose sandbox is live is refused with REALM_INVALID_TRANSITION, and creates nothing", async () => {
  const { driver, lifecycle, libpod, config, name } = harness();
  await driver.createSandbox(validSandbox({ name }));
  const stateBefore = readdirSync(config.sandboxStateRoot);
  const secretBefore = readdirSync(config.secretRoot);
  const second = validSandbox({ id: "sandbox-2", name });
  await assert.rejects(driver.createSandbox(second), expectCode("REALM_INVALID_TRANSITION"));
  assert.equal(lifecycle.creates.length, 1);
  assert.equal(libpod.containers.get(name)?.running, true);
  assert.deepEqual(readdirSync(config.sandboxStateRoot), stateBefore, "the refused create wrote no state directory");
  assert.deepEqual(readdirSync(config.secretRoot), secretBefore, "the refused create wrote no launch material");
});

void test("PRD-DRV-02: a refused second create logs the held-workspace check and its code, and the line names no path", async () => {
  const lines: string[] = [];
  const config = driverConfig({
    refusalLog: (line) => {
      lines.push(line);
    },
  });
  const libpod = new FakeLibpod();
  const lifecycle = new FakeLifecycle(libpod);
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime: new FakeRuntime() });
  const { name } = bindProject(config, "project-a");
  await driver.createSandbox(validSandbox({ name }));
  await assert.rejects(driver.createSandbox(validSandbox({ id: "sandbox-2", name })), expectCode("REALM_INVALID_TRANSITION"));
  assert.deepEqual(lines, ["realm compute driver refused: rpc=CreateSandbox check=create.pinned_root_held code=REALM_INVALID_TRANSITION"]);
});

void test("PRD-DRV-02: two concurrent creates under one sandbox name: the second is refused while the first is in flight with REALM_INVALID_TRANSITION, and one lifecycle create runs", async () => {
  const { driver, lifecycle, name } = harness();
  const results = await Promise.allSettled([
    driver.createSandbox(validSandbox({ name })),
    driver.createSandbox(validSandbox({ id: "sandbox-2", name })),
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(expectCode("REALM_INVALID_TRANSITION")(rejected[0]?.reason));
  assert.equal(lifecycle.creates.length, 1);
});

void test("PRD-DRV-02: two directories under one ceiling create on one driver; a third create for the first directory is refused while its container is live", async () => {
  const { driver, lifecycle, config, name } = harness();
  await driver.createSandbox(validSandbox({ name }));
  const second = bindProject(config, "project-b");
  await driver.createSandbox(validSandbox({ id: "sandbox-2", name: second.name }));
  assert.equal(lifecycle.creates.length, 2);
  assert.notEqual(second.name, name);
  await assert.rejects(driver.createSandbox(validSandbox({ id: "sandbox-4", name })), expectCode("REALM_INVALID_TRANSITION"));
  assert.equal(lifecycle.creates.length, 2);
});

void test("PRD-DRV-02: a failed create whose container removal fails keeps its workspace held, so a second create for it is refused", async () => {
  const { libpod, lifecycle, runtime, config, name } = harness();
  const undeletable = {
    create: lifecycle.create.bind(lifecycle),
    stop: lifecycle.stop.bind(lifecycle),
    delete: (): Promise<void> => Promise.reject(new Error("delete refused")),
  };
  const driver = new ComputeDriver(config, { lifecycle: undeletable, libpod, runtime });
  runtime.exitOnSpawn = true;
  await assert.rejects(driver.createSandbox(validSandbox({ name })), expectCode("OPENSHELL_START_FAILED"));
  assert.equal(libpod.containers.get(name)?.running, true);
  runtime.exitOnSpawn = false;
  await assert.rejects(driver.createSandbox(validSandbox({ id: "sandbox-2", name })), expectCode("REALM_INVALID_TRANSITION"));
  assert.equal(lifecycle.creates.length, 1);
});

void test("PRD-DRV-02: a failed create whose container still runs holds its workspace, so a second create for it is refused", async () => {
  const { libpod, lifecycle, runtime, config, name } = harness();
  const startFailing = {
    create: (spec: ContainerSpec): Promise<string> => {
      lifecycle.creates.push(spec);
      libpod.add(spec.sandboxName, true, spec.workspaceDir);
      return Promise.reject(makeRealmError("OPENSHELL_START_FAILED"));
    },
    delete: lifecycle.delete.bind(lifecycle),
    stop: lifecycle.stop.bind(lifecycle),
  };
  const driver = new ComputeDriver(config, { lifecycle: startFailing, libpod, runtime });
  await assert.rejects(driver.createSandbox(validSandbox({ name })), expectCode("OPENSHELL_START_FAILED"));
  assert.equal(libpod.containers.get(name)?.running, true);
  await assert.rejects(driver.createSandbox(validSandbox({ id: "sandbox-2", name })), expectCode("REALM_INVALID_TRANSITION"));
  assert.equal(lifecycle.creates.length, 1);
  assert.equal(libpod.containers.get(name)?.running, true);
});

void test("PRD-DRV-02: a create whose workspace container lookup fails is refused with SCHEMA_INVALID under create.pinned_root_held, and creates nothing", async () => {
  const lines: string[] = [];
  const config = driverConfig({
    refusalLog: (line) => {
      lines.push(line);
    },
  });
  const libpod = new FakeLibpod();
  const lifecycle = new FakeLifecycle(libpod);
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime: new FakeRuntime() });
  const { name } = bindProject(config, "project-a");
  await driver.createSandbox(validSandbox({ name }));
  libpod.inspectContainer = () => Promise.reject(new Error("socket reset"));
  await assert.rejects(driver.createSandbox(validSandbox({ id: "sandbox-2", name })), expectCode("SCHEMA_INVALID"));
  assert.equal(lifecycle.creates.length, 1);
  assert.deepEqual(lines, ["realm compute driver refused: rpc=CreateSandbox check=create.pinned_root_held code=SCHEMA_INVALID"]);
});

void test("PRD-DRV-02: a container no longer found is dropped from the tracked set, so a later create checks no name for it", async () => {
  const { libpod, lifecycle, runtime, config, name } = await diskHarness();
  let deleteRefusals = 1;
  const deleteOnce = {
    create: lifecycle.create.bind(lifecycle),
    stop: lifecycle.stop.bind(lifecycle),
    delete: (sandboxName: string): Promise<void> => {
      if (deleteRefusals > 0) {
        deleteRefusals -= 1;
        return Promise.reject(new Error("delete refused"));
      }
      return lifecycle.delete(sandboxName);
    },
  };
  const driver = new ComputeDriver(config, { lifecycle: deleteOnce, libpod, runtime });
  runtime.exitOnSpawn = true;
  await assert.rejects(driver.createSandbox(validSandbox({ name })), expectCode("OPENSHELL_START_FAILED"));
  runtime.exitOnSpawn = false;
  libpod.containers.delete(name);
  await driver.createSandbox(validSandbox({ id: "sandbox-2", name }));
  await driver.deleteSandbox({ sandbox_id: "sandbox-2" });
  const before = libpod.inspectCalls;
  await driver.createSandbox(validSandbox({ id: "sandbox-3", name }));
  assert.equal(libpod.inspectCalls - before, 0);
  assert.equal(lifecycle.creates.length, 3);
});

void test("PRD-DRV-02: a supervisor exit whose container stop succeeds releases the workspace; a create for it then reaches the state-directory check (create.state_dir)", async () => {
  const lines: string[] = [];
  const config = driverConfig({ refusalLog: (line) => lines.push(line) });
  const libpod = new FakeLibpod();
  const lifecycle = new FakeLifecycle(libpod);
  const runtime = new FakeRuntime();
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime });
  const { name } = bindProject(config, "project-a");
  await driver.createSandbox(validSandbox({ name }));
  const [supervisor] = runtime.supervisors;
  assert.ok(supervisor !== undefined);
  supervisor.exit();
  await settle();
  assert.deepEqual(lifecycle.stops, [name]);
  // The stopped container holds no workspace, so the create passes the workspace check. Its state directory is still on disk, which
  // the state directory check refuses, as it does for any sandbox that has not been deleted.
  await assert.rejects(driver.createSandbox(validSandbox({ id: "sandbox-2", name })), expectCode("SCHEMA_INVALID"));
  assert.deepEqual(lines, ["realm compute driver refused: rpc=CreateSandbox check=create.state_dir code=SCHEMA_INVALID"]);
  assert.equal(lifecycle.creates.length, 1);
});

void test("PRD-DRV-02: a supervisor exit whose container stop fails keeps the workspace held while the container runs, so a create for it is refused", async () => {
  const { libpod, lifecycle, runtime, config, name } = harness();
  const unstoppable = {
    create: lifecycle.create.bind(lifecycle),
    delete: lifecycle.delete.bind(lifecycle),
    stop: (): Promise<void> => Promise.reject(new Error("stop refused")),
  };
  const driver = new ComputeDriver(config, { lifecycle: unstoppable, libpod, runtime });
  await driver.createSandbox(validSandbox({ name }));
  const [supervisor] = runtime.supervisors;
  assert.ok(supervisor !== undefined);
  supervisor.exit();
  await settle();
  assert.equal(libpod.containers.get(name)?.running, true);
  await assert.rejects(driver.createSandbox(validSandbox({ id: "sandbox-2", name })), expectCode("REALM_INVALID_TRANSITION"));
  assert.equal(lifecycle.creates.length, 1);
});

void test("PRD-DRV-02: a create after the first sandbox for its project is deleted succeeds", async () => {
  const { driver, lifecycle, name } = await diskHarness();
  await driver.createSandbox(validSandbox({ name }));
  await driver.deleteSandbox({ sandbox_id: "sandbox-1" });
  await driver.createSandbox(validSandbox({ id: "sandbox-2", name }));
  assert.equal(lifecycle.creates.length, 2);
});

void test("PRD-DRV-02: a live sandbox for one project does not block a create for another project under the same ceiling", async () => {
  const { driver, lifecycle, config, name } = harness();
  await driver.createSandbox(validSandbox({ name }));
  const other = bindProject(config, "project-b");
  await driver.createSandbox(validSandbox({ id: "sandbox-2", name: other.name }));
  assert.equal(lifecycle.creates.length, 2);
});

void test("PRD-DRV-02: a stale record whose container is gone does not block a create for its project", async () => {
  const { driver, lifecycle, libpod, name } = await diskHarness();
  await driver.createSandbox(validSandbox({ name }));
  libpod.containers.delete(name);
  await driver.createSandbox(validSandbox({ id: "sandbox-2", name }));
  assert.equal(lifecycle.creates.length, 2);
});

void test("PRD-DRV-02: after a driver restart with no in-memory state, a create for a project held by a running container is refused, and creates nothing", async () => {
  const { driver, lifecycle, libpod, runtime, config, name } = harness();
  await driver.createSandbox(validSandbox({ name }));
  const restarted = new ComputeDriver(config, { lifecycle, libpod, runtime });
  await assert.rejects(restarted.createSandbox(validSandbox({ id: "sandbox-2", name })), expectCode("REALM_INVALID_TRANSITION"));
  assert.equal(lifecycle.creates.length, 1);
  assert.equal(libpod.containers.get(name)?.running, true);
});

void test("PRD-DRV-02: a paused container holds its workspace, so a create for it is refused", async () => {
  const { driver, lifecycle, libpod, name } = harness();
  await driver.createSandbox(validSandbox({ name }));
  const container = libpod.containers.get(name);
  assert.ok(container !== undefined);
  container.paused = true;
  await assert.rejects(driver.createSandbox(validSandbox({ id: "sandbox-2", name })), expectCode("REALM_INVALID_TRANSITION"));
  assert.equal(lifecycle.creates.length, 1);
});

void test("PRD-DRV-02: an exited container holds no workspace; a create for it then reaches the state-directory check (create.state_dir)", async () => {
  const lines: string[] = [];
  const config = driverConfig({ refusalLog: (line) => lines.push(line) });
  const libpod = new FakeLibpod();
  const lifecycle = new FakeLifecycle(libpod);
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime: new FakeRuntime() });
  const { name } = bindProject(config, "project-a");
  await driver.createSandbox(validSandbox({ name }));
  const container = libpod.containers.get(name);
  assert.ok(container !== undefined);
  container.running = false;
  // Refused at the state directory, not at the workspace check: an exited container holds no workspace, but its state directory stays
  // on disk until the sandbox is deleted.
  await assert.rejects(driver.createSandbox(validSandbox({ id: "sandbox-2", name })), expectCode("SCHEMA_INVALID"));
  assert.deepEqual(lines, ["realm compute driver refused: rpc=CreateSandbox check=create.state_dir code=SCHEMA_INVALID"]);
  assert.equal(lifecycle.creates.length, 1);
});

void test("PRD-DRV-02: a create whose workspace container state cannot be read is refused with SCHEMA_INVALID under create.pinned_root_held, and creates nothing", async () => {
  const lines: string[] = [];
  const config = driverConfig({
    refusalLog: (line) => {
      lines.push(line);
    },
  });
  const libpod = new FakeLibpod();
  const lifecycle = new FakeLifecycle(libpod);
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime: new FakeRuntime() });
  const { name } = bindProject(config, "project-a");
  await driver.createSandbox(validSandbox({ name }));
  libpod.inspectContainer = () => Promise.resolve({ Id: `id-${name}`, Mounts: [] });
  await assert.rejects(driver.createSandbox(validSandbox({ id: "sandbox-2", name })), expectCode("SCHEMA_INVALID"));
  assert.equal(lifecycle.creates.length, 1);
  assert.deepEqual(lines, ["realm compute driver refused: rpc=CreateSandbox check=create.pinned_root_held code=SCHEMA_INVALID"]);
});

void test("PRD-DRV-02: a running container bound to another directory does not block a create for this project", async () => {
  const { driver, lifecycle, libpod, config, name } = harness();
  libpod.add("realm-other", true, join(dirname(config.workspaceRoot), "other-workspace"));
  await driver.createSandbox(validSandbox({ name }));
  assert.equal(lifecycle.creates.length, 1);
  assert.equal(libpod.containers.has(name), true);
});

void test("PRD-DRV-02: a create whose running workspace container has unreadable mounts is refused with SCHEMA_INVALID under create.pinned_root_held, and creates nothing", async () => {
  const lines: string[] = [];
  const config = driverConfig({
    refusalLog: (line) => {
      lines.push(line);
    },
  });
  const libpod = new FakeLibpod();
  const lifecycle = new FakeLifecycle(libpod);
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime: new FakeRuntime() });
  const { name } = bindProject(config, "project-a");
  await driver.createSandbox(validSandbox({ name }));
  libpod.inspectContainer = () => Promise.resolve({ Id: `id-${name}`, State: { Status: "running" }, Mounts: "unreadable" });
  await assert.rejects(driver.createSandbox(validSandbox({ id: "sandbox-2", name })), expectCode("SCHEMA_INVALID"));
  assert.equal(lifecycle.creates.length, 1);
  assert.deepEqual(lines, ["realm compute driver refused: rpc=CreateSandbox check=create.pinned_root_held code=SCHEMA_INVALID"]);
});

void test("PRD-DRV-02: a create whose registry entry is missing, outside the ceiling, or no longer names its directory is refused before any libpod call", async () => {
  // No entry: the name a project would bind under, with nothing written for it.
  {
    const h = refusedHarness();
    await assertWorkspaceRefused(h, sandboxNameOfSession(sessionIdOfWorkspace(join(h.config.workspaceRoot, "project-b"))));
  }
  // An entry for a directory outside the ceiling.
  {
    const h = refusedHarness();
    const outside = join(dirname(h.config.workspaceRoot), "outside");
    mkdirSync(outside);
    const pinned = bindRoot(outside);
    const id = sessionIdOfWorkspace(pinned.realPath);
    writeWorkspaceEntry(h.config.stateDir, pinned, id);
    await assertWorkspaceRefused(h, sandboxNameOfSession(id));
  }
  // An entry whose directory was replaced at the same path: the entry's device and inode no longer match.
  {
    const h = refusedHarness();
    const { name, project } = bindProject(h.config, "project-a");
    renameSync(project, join(h.config.workspaceRoot, "project-a-moved"));
    mkdirSync(project);
    await assertWorkspaceRefused(h, name);
  }
});

void test("PRD-DRV-02: a second name whose entry file is a copy of another directory's entry is refused by the recomputed-id check, and two names cannot resolve to one directory", async () => {
  const h = refusedHarness();
  const first = bindProject(h.config, "project-a");
  const secondDir = join(h.config.workspaceRoot, "project-b");
  mkdirSync(secondDir);
  const secondId = sessionIdOfWorkspace(realpathSync(secondDir));
  const registry = workspaceRegistryDirOf(h.config.stateDir);
  copyFileSync(join(registry, recordFileName(sessionIdOfWorkspace(first.project))), join(registry, recordFileName(secondId)));
  await assertWorkspaceRefused(h, sandboxNameOfSession(secondId));
});

void test("PRD-DRV-02: ValidateSandboxCreate refuses a name with no entry, accepts a name with a valid entry, and writes nothing in either case", async () => {
  const h = refusedHarness();
  const { name } = bindProject(h.config, "project-a");
  assert.deepEqual(h.driver.validateSandboxCreate(validSandbox({ name })), {});
  assert.equal(h.libpod.listCalls, 0);
  assert.equal(h.lifecycle.creates.length, 0);
  assert.equal(lstatOrUndefined(join(h.config.sandboxStateRoot, name)), undefined);
  assert.equal(lstatOrUndefined(join(h.config.secretRoot, name)), undefined);
  await assertWorkspaceRefused(h, sandboxNameOfSession(sessionIdOfWorkspace(join(h.config.workspaceRoot, "project-b"))));
});

void test("PRD-DRV-02: a sandbox name without the realm prefix, or whose remainder fails isSessionId, is refused with create.workspace before any libpod call", async () => {
  // "agent-1" has no prefix. "realm-session.1" carries the prefix, and its remainder fails the session id rule, though it passes the container-name rule.
  for (const name of ["agent-1", "realm-session.1"]) {
    await assertWorkspaceRefused(refusedHarness(), name);
  }
});

interface RefusedHarness {
  readonly driver: ComputeDriver;
  readonly lifecycle: FakeLifecycle;
  readonly libpod: FakeLibpod;
  readonly config: ComputeDriverConfig;
  readonly lines: string[];
}

// A driver whose refusals are collected, over a ceiling with no project yet, for the cases the registry refuses.
function refusedHarness(): RefusedHarness {
  const lines: string[] = [];
  const libpod = new FakeLibpod();
  const lifecycle = new FakeLifecycle(libpod);
  const config = driverConfig({ refusalLog: (line) => lines.push(line) });
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime: new FakeRuntime() });
  return { driver, lifecycle, libpod, config, lines };
}

// A create the registry refuses with create.workspace: validation and create both refuse, and nothing reaches libpod, the lifecycle,
// the state directory or the secret directory.
async function assertWorkspaceRefused(h: RefusedHarness, name: string): Promise<void> {
  assert.throws(() => h.driver.validateSandboxCreate(validSandbox({ name })), expectCode("SCHEMA_INVALID"));
  await assert.rejects(h.driver.createSandbox(validSandbox({ name })), expectCode("SCHEMA_INVALID"));
  assert.equal(h.lifecycle.creates.length, 0);
  assert.equal(h.libpod.listCalls, 0);
  assert.equal(h.libpod.inspectCalls, 0);
  assert.equal(lstatOrUndefined(join(h.config.sandboxStateRoot, name)), undefined);
  assert.equal(lstatOrUndefined(join(h.config.secretRoot, name)), undefined);
  assert.ok(h.lines.length > 0 && h.lines.every((line) => line.endsWith("check=create.workspace code=SCHEMA_INVALID")), h.lines.join("\n"));
  h.lines.length = 0;
}

void test("PRD-DRV-02: the constructor refuses a relative state directory", () => {
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const deps = { lifecycle: new FakeLifecycle(libpod), libpod, runtime: new FakeRuntime() };
  assert.throws(() => new ComputeDriver({ ...config, stateDir: "realm-state" }, deps), expectCode("SCHEMA_INVALID"));
});

function lstatOrUndefined(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

void test("PRD-DRV-01: a workspace replaced by a symbolic link is refused by EnsureWorkspace and DeleteWorkspace, and the link target is untouched", () => {
  const { driver, config } = harness();
  const outside = join(dirname(config.workspaceRoot), "outside");
  mkdirSync(outside);
  rmSync(config.workspaceRoot, { recursive: true, force: true });
  symlinkSync(outside, config.workspaceRoot);
  assert.throws(() => driver.ensureWorkspace({ workspace: "workspace-a" }), expectCode("SCHEMA_INVALID"));
  assert.throws(() => driver.deleteWorkspace({ workspace: "workspace-a" }), expectCode("REALM_INVALID_TRANSITION"));
  assert.equal(existsSync(outside), true);
});

void test("EnsureWorkspace checks the ceiling and creates nothing: the ceiling keeps its mode and contents", () => {
  const { driver, config } = harness();
  chmodSync(config.workspaceRoot, 0o755);
  const before = readdirSync(config.workspaceRoot);
  driver.ensureWorkspace({ workspace: "workspace-a" });
  driver.ensureWorkspace({ workspace: "another-id" });
  assert.equal(statSync(config.workspaceRoot).mode & 0o777, 0o755);
  assert.deepEqual(readdirSync(config.workspaceRoot), before);
});

void test("DeleteWorkspace never removes the ceiling: it is refused with the transition code, empty or not, and the ceiling stays", () => {
  const { driver, config } = harness();
  const notes = join(config.workspaceRoot, "notes.txt");
  writeFileSync(notes, "user data");
  assert.throws(() => driver.deleteWorkspace({ workspace: "workspace-a" }), expectCode("REALM_INVALID_TRANSITION"));
  assert.equal(readFileSync(notes, "utf8"), "user data");
  unlinkSync(notes);
  assert.throws(() => driver.deleteWorkspace({ workspace: "workspace-a" }), expectCode("REALM_INVALID_TRANSITION"));
  assert.equal(statSync(config.workspaceRoot).isDirectory(), true);
});

void test("PRD-DRV-01: a sandbox delete leaves its project, the project's mode, its contents and the ceiling in place", async () => {
  const config = driverConfig();
  const { name, project } = bindProject(config, "project-a");
  chmodSync(config.workspaceRoot, 0o755);
  const notes = join(project, "notes.txt");
  writeFileSync(notes, "user data");
  const libpod = new FakeLibpod();
  const driver = new ComputeDriver(config, {
    lifecycle: await diskLifecycle(config, libpod),
    libpod,
    runtime: new FakeRuntime(),
  });
  await driver.createSandbox(validSandbox({ name }));
  const stateDir = join(config.sandboxStateRoot, name);
  assert.equal(existsSync(stateDir), true);
  assert.deepEqual(await driver.deleteSandbox({ sandbox_id: "sandbox-1" }), { deleted: true });
  assert.equal(existsSync(stateDir), false, "the sandbox's own state directory is removed");
  assert.equal(readFileSync(notes, "utf8"), "user data");
  assert.equal(statSync(project).isDirectory(), true);
  assert.equal(statSync(config.workspaceRoot).isDirectory(), true);
  assert.equal(statSync(config.workspaceRoot).mode & 0o777, 0o755);
});

void test("a workspace id with a path separator, a dot-segment or no value is refused", () => {
  const { driver } = harness();
  for (const workspace of ["../x", "a/b", "..", ".", ""]) {
    assert.throws(() => driver.ensureWorkspace({ workspace }), expectCode("SCHEMA_INVALID"));
    assert.throws(() => driver.deleteWorkspace({ workspace }), expectCode("SCHEMA_INVALID"));
  }
});

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
      () =>
        new ComputeDriver(driverConfig({ implementationVersion }), {
          lifecycle,
          libpod,
          runtime: new FakeRuntime(),
        }),
      expectCode("SCHEMA_INVALID"),
    );
  }
});

void test("PRD-DRV-01: the sandbox workspace is the project's entry directory for every workspace id", async () => {
  const { driver, lifecycle, name, project } = harness();
  await driver.createSandbox(validSandbox({ name, workspace: "another-id" }));
  assert.equal(lifecycle.creates[0]?.workspaceDir, project);
});

void test("PRD-DRV-01: the constructor refuses a ceiling that is relative, missing, a symbolic link, or a file", () => {
  const config = driverConfig();
  const base = dirname(config.workspaceRoot);
  const link = join(base, "root-link");
  symlinkSync(config.workspaceRoot, link);
  const file = join(base, "root-file");
  writeFileSync(file, "not a directory");
  const libpod = new FakeLibpod();
  const deps = { lifecycle: new FakeLifecycle(libpod), libpod, runtime: new FakeRuntime() };
  for (const workspaceRoot of ["workspaces", join(base, "missing"), link, file]) {
    assert.throws(() => new ComputeDriver({ ...config, workspaceRoot }, deps), expectCode("SCHEMA_INVALID"));
  }
  assert.doesNotThrow(() => new ComputeDriver(config, deps));
});

void test("PRD-DRV-01: the constructor refuses a state root or secret root that holds the ceiling or lies inside it", () => {
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const deps = { lifecycle: new FakeLifecycle(libpod), libpod, runtime: new FakeRuntime() };
  for (const change of [
    { sandboxStateRoot: join(config.workspaceRoot, "state") },
    { secretRoot: join(config.workspaceRoot, "secrets") },
    { sandboxStateRoot: dirname(config.workspaceRoot) },
  ]) {
    assert.throws(() => new ComputeDriver({ ...config, ...change }, deps), expectCode("SCHEMA_INVALID"));
  }
});

// The readiness bounds the readiness tests give the driver. The driver's own timer ends each wait at its bound, so these tests exercise
// real timer behavior on purpose. The bound is short to keep each test brief, and each test waits on a promise the driver settles.
const SHORT_READY_WAIT_MS = 30;
const LONG_READY_WAIT_MS = 2_000;
const WATCH_TICK_MS = 5;

// A libpod whose next container listing waits for a gate. The startup rebuild lists the realm's containers first, so holding that
// listing holds the rebuild in progress: DriverLifecycle.adoptSurvivors keeps its swept flag down until the listing is released.
// It holds no containers of its own, so the rebuild adopts nothing and only reaches its readiness.
class RebuildingLibpod extends FakeLibpod {
  private gate: Promise<void> | undefined;

  // Holds the next container listing until the returned function is called. The executor form is used because tsconfig's ES2023
  // lib has no Promise.withResolvers.
  holdNextListing(): () => void {
    let release: () => void = () => undefined;
    this.gate = new Promise<void>((resolve) => {
      release = () => {
        resolve();
      };
    });
    return release;
  }

  override listContainersByLabel(key: string, value: string): Promise<LibpodContainerSummary[]> {
    const gate = this.gate;
    this.gate = undefined;
    return (gate ?? Promise.resolve()).then(() => super.listContainersByLabel(key, value));
  }

  info(): Promise<{ rootless: boolean }> {
    return Promise.resolve({ rootless: true });
  }
}

// A driver whose readiness is the real startup rebuild: DriverLifecycle's adoption over a RebuildingLibpod the test can hold. The
// sandbox is created after the first rebuild has finished, so the driver's registry holds it. startRebuild begins a second rebuild,
// whose listing waits until the test releases it; the readiness check refuses until that rebuild resolves.
async function rebuildHarness(readyWaitMs: number) {
  const libpod = new FakeLibpod();
  const config = driverConfig();
  const { name } = bindProject(config, "project-a");
  const rebuildLibpod = new RebuildingLibpod();
  const rebuild = new DriverLifecycle({
    libpod: rebuildLibpod as unknown as LifecycleLibpod,
    sandboxStateRoot: config.sandboxStateRoot,
    secretRoot: mkdtempSync(join(tmpdir(), "realm-rebuild-secrets-")),
  });
  const roots: AdoptionRoots = { workspaceStateDir: config.stateDir, workspaceCeiling: config.workspaceRoot, image: config.sandboxImage };
  await rebuild.adoptSurvivors(roots);
  const driver = new ComputeDriver(config, {
    lifecycle: new FakeLifecycle(libpod),
    libpod,
    runtime: new FakeRuntime(),
    requireSwept: () => {
      rebuild.requireSwept();
    },
    readyWaitMs,
  });
  await driver.createSandbox(validSandbox({ name }));
  const startRebuild = (): { rebuilding: Promise<unknown>; release: () => void } => {
    const release = rebuildLibpod.holdNextListing();
    return { rebuilding: rebuild.adoptSurvivors(roots), release };
  };
  return { driver, name, startRebuild };
}

// The messages the Watch stream writes: a sandbox as it stands, or the id of one that is gone.
type WatchMessage =
  | { readonly sandbox: { readonly sandbox: { readonly name: string } } }
  | { readonly deleted: { readonly sandbox_id: string } };

// A Watch call the test reads and ends, as the server stream is read.
class FakeWatchCall extends EventEmitter {
  readonly written: WatchMessage[] = [];
  private readonly waiters: ((message: WatchMessage) => void)[] = [];

  write(message: WatchMessage): boolean {
    this.written.push(message);
    for (const waiter of this.waiters.splice(0)) {
      waiter(message);
    }
    return true;
  }

  // Resolves with the next message the stream writes. It is taken before the write it awaits, so no write is missed. The executor form
  // is used because tsconfig's ES2023 lib has no Promise.withResolvers.
  nextWrite(): Promise<WatchMessage> {
    return new Promise<WatchMessage>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

type WatchHandler = (call: FakeWatchCall) => void;
// The unary form the bound GetSandbox handler takes, as the test calls it.
type UnaryHandler = (
  call: { request: unknown },
  callback: (error: { code: number } | null, response?: { readonly sandbox: { readonly name: string } }) => void,
) => void;

// The WatchSandboxes handler the service binds over the driver, at the given poll interval. The loader types bound handlers untyped,
// so the cast names the one call shape the test uses.
function watchOf(driver: ComputeDriver, intervalMs: number): WatchHandler {
  const handler = computeDriverImplementation(driver, intervalMs).WatchSandboxes;
  assert.ok(handler !== undefined);
  return handler as unknown as WatchHandler;
}

// Calls GetSandbox over the bound service the way gRPC does. Resolves with the wire code of its error, or with the name it answers.
function invokeGet(driver: ComputeDriver, request: unknown): Promise<{ code?: number | undefined; name?: string | undefined }> {
  const handler = computeDriverImplementation(driver).GetSandbox;
  assert.ok(handler !== undefined);
  const get = handler as unknown as UnaryHandler;
  return new Promise((resolve) => {
    get({ request }, (error, response) => {
      resolve(error === null ? { name: response?.sandbox.name } : { code: error.code });
    });
  });
}

// The sandbox a Watch message reports.
function sandboxNameOf(message: WatchMessage): string | undefined {
  return "sandbox" in message ? message.sandbox.sandbox.name : undefined;
}

void test("PRD-DRV-01: a List during a rebuild waits for readiness, then returns the sandboxes", { timeout: 10_000 }, async () => {
  const { driver, name, startRebuild } = await rebuildHarness(LONG_READY_WAIT_MS);
  const { rebuilding, release } = startRebuild();
  let answered = false;
  const listing = driver.listSandboxes().then((listed) => {
    answered = true;
    return listed;
  });
  // The rebuild holds readiness, so the listing cannot answer, however many turns of the event loop pass.
  await settle();
  assert.equal(answered, false, "List does not answer while the rebuild holds readiness");
  release();
  await rebuilding;
  const listed = await listing;
  assert.deepEqual(
    listed.sandboxes.map((sandbox) => sandbox.name),
    [name],
  );
});

void test("PRD-DRV-01: a Get during a held rebuild fails UNAVAILABLE once the readiness bound passes, and answers after the rebuild", { timeout: 10_000 }, async () => {
  const { driver, name, startRebuild } = await rebuildHarness(SHORT_READY_WAIT_MS);
  const { rebuilding, release } = startRebuild();
  const refused = await invokeGet(driver, { name });
  assert.equal(refused.code, status.UNAVAILABLE);
  release();
  await rebuilding;
  const answered = await invokeGet(driver, { name });
  assert.equal(answered.code, undefined);
  assert.equal(answered.name, name);
});

void test("PRD-DRV-01: a Watch poll the driver rejects during a rebuild is retried on its next tick, and the stream stays open", { timeout: 10_000 }, async () => {
  const { driver, name, startRebuild } = await rebuildHarness(SHORT_READY_WAIT_MS);
  const { rebuilding, release } = startRebuild();
  // Counts the polls the driver rejects, so the test waits for two rejected ticks rather than for a guessed time.
  const snapshotAll = driver.snapshotAll.bind(driver);
  let rejections = 0;
  let twoRejected: () => void = () => undefined;
  const rejectedTwice = new Promise<void>((resolve) => {
    twoRejected = () => {
      resolve();
    };
  });
  driver.snapshotAll = async () => {
    try {
      return await snapshotAll();
    } catch (error: unknown) {
      rejections += 1;
      if (rejections === 2) {
        twoRejected();
      }
      throw error;
    }
  };
  const call = new FakeWatchCall();
  const errors: unknown[] = [];
  call.on("error", (error: unknown) => {
    errors.push(error);
  });
  watchOf(driver, WATCH_TICK_MS)(call);
  await rejectedTwice;
  assert.deepEqual(errors, []);
  assert.deepEqual(call.written, []);
  const written = call.nextWrite();
  release();
  await rebuilding;
  assert.equal(sandboxNameOf(await written), name);
  assert.deepEqual(errors, []);
  call.emit("cancelled");
});

void test("PRD-DRV-01: a Watch poll whose listing fails is retried on its next tick, and the stream reports no error", { timeout: 10_000 }, async () => {
  const { driver, libpod, name } = harness();
  await driver.createSandbox(validSandbox({ name }));
  const listContainers = libpod.listContainersByLabel.bind(libpod);
  let failures = 1;
  libpod.listContainersByLabel = (key: string, value: string) => {
    if (failures > 0) {
      failures -= 1;
      return Promise.reject(new Error("socket reset"));
    }
    return listContainers(key, value);
  };
  const call = new FakeWatchCall();
  const errors: unknown[] = [];
  call.on("error", (error: unknown) => {
    errors.push(error);
  });
  const first = call.nextWrite();
  watchOf(driver, WATCH_TICK_MS)(call);
  assert.equal(sandboxNameOf(await first), name);
  assert.deepEqual(errors, []);
  assert.equal(failures, 0);
  call.emit("cancelled");
});
