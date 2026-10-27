import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { dirname, join } from "node:path";
import { status } from "@grpc/grpc-js";
import { RealmError } from "../../../src/core/errors.js";
import { ComputeDriver, type ComputeDriverConfig, type DriverSandboxMessage } from "../../../src/runtime/driver/compute-driver.js";
import { DRIVER_ADMISSION_ACKNOWLEDGEMENT } from "../../../src/runtime/driver/admission.js";
import { DriverStatusError, driverFailureOf } from "../../../src/runtime/driver/grpc-status.js";
import type { ContainerSpec } from "../../../src/runtime/libpod-client.js";
import { diskLifecycle, FakeLibpod, FakeLifecycle, FakeRuntime, driverConfig, OTHER_DIGEST_IMAGE, SANDBOX_IMAGE, validSandbox } from "./fakes.js";

function harness() {
  const libpod = new FakeLibpod();
  const lifecycle = new FakeLifecycle(libpod);
  const runtime = new FakeRuntime();
  const config = driverConfig();
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime });
  return { libpod, lifecycle, runtime, config, driver };
}

// The spec the lifecycle receives for a create of the given container name: its image, workspace, state directory and channel.
function specOf(config: ComputeDriverConfig, containerName: string): ContainerSpec {
  return {
    sandboxName: containerName,
    image: SANDBOX_IMAGE,
    workspaceDir: config.workspaceRoot,
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
    const { driver, lifecycle } = harness();
    const sandbox = change(validSandbox());
    assert.throws(() => driver.validateSandboxCreate(sandbox), expectCode("SCHEMA_INVALID"));
    await assert.rejects(driver.createSandbox(sandbox), expectCode("SCHEMA_INVALID"));
    assert.equal(lifecycle.creates.length, 0);
  });
}

void test("PRD-DRV-02: a conforming request is accepted, and only its exact spec reaches the lifecycle, then the runtime's listener is confirmed", async () => {
  const { driver, lifecycle, runtime, config } = harness();
  assert.deepEqual(driver.validateSandboxCreate(validSandbox()), {});
  const created = await driver.createSandbox(validSandbox());
  assert.equal(created.runtime_identity, "id-realm-session-1");
  assert.deepEqual(lifecycle.creates, [specOf(config, "realm-session-1")]);
  assert.deepEqual(
    runtime.confirmations.map((confirmation) => confirmation.controlSocket),
    [join(config.secretRoot, "realm-session-1", "channel", "control.sock")],
  );
  assert.equal(runtime.supervisors.length, 1);
});

void test("PRD-DRV-02: a name without the realm prefix is created as realm-<name>, and the lifecycle receives that name", async () => {
  const { driver, lifecycle, config } = harness();
  const created = await driver.createSandbox(validSandbox({ name: "agent-1" }));
  assert.equal(created.runtime_identity, "id-realm-agent-1");
  assert.deepEqual(lifecycle.creates, [specOf(config, "realm-agent-1")]);
});

void test("PRD-DRV-02: a name that already has the realm prefix is unchanged, and is not prefixed again", async () => {
  const { driver, lifecycle, config } = harness();
  await driver.createSandbox(validSandbox({ name: "realm-agent-2" }));
  assert.deepEqual(lifecycle.creates, [specOf(config, "realm-agent-2")]);
});

void test("PRD-DRV-02: a prefixed name whose control socket path exceeds 107 bytes is refused with SCHEMA_INVALID before any write or libpod call", async () => {
  const { driver, lifecycle, config, libpod } = harness();
  const name = "a".repeat(122);
  const sandbox = validSandbox({ name });
  assert.throws(() => driver.validateSandboxCreate(sandbox), expectCode("SCHEMA_INVALID"));
  await assert.rejects(driver.createSandbox(sandbox), expectCode("SCHEMA_INVALID"));
  assert.equal(lifecycle.creates.length, 0);
  assert.equal(libpod.inspectCalls, 0);
  assert.equal(lstatOrUndefined(join(config.sandboxStateRoot, `realm-${name}`)), undefined);
  assert.equal(lstatOrUndefined(join(config.secretRoot, `realm-${name}`)), undefined);
});

void test("PRD-DRV-02: the longest prefixed name whose host and container socket paths both fit 107 bytes is accepted", async () => {
  const { driver, lifecycle, config, libpod } = harness();
  // The host control socket is <secretRoot>/<prefixed name>/channel/control.sock. Each name byte adds one byte to that path, so the
  // longest name that fits is the last length whose path is still 107 bytes or less; one more byte is over the limit.
  const hostSocketBytes = (length: number): number =>
    Buffer.byteLength(join(config.secretRoot, `realm-${"a".repeat(length)}`, "channel", "control.sock"), "utf8");
  let length = 0;
  while (hostSocketBytes(length + 1) <= 107) {
    length += 1;
  }
  assert.ok(length > 0, "the secret root leaves room for a name");
  assert.equal(hostSocketBytes(length), 107, "the longest fitting name fills the 107-byte limit exactly");
  assert.ok(hostSocketBytes(length + 1) > 107, "one more byte is over the limit");
  const name = "a".repeat(length);
  const created = await driver.createSandbox(validSandbox({ name }));
  assert.equal(created.runtime_identity, `id-realm-${name}`);
  assert.equal(lifecycle.creates[0]?.sandboxName, `realm-${name}`);
  const longer = `${name}a`;
  const refused = validSandbox({ name: longer });
  assert.throws(() => driver.validateSandboxCreate(refused), expectCode("SCHEMA_INVALID"));
  await assert.rejects(driver.createSandbox(refused), expectCode("SCHEMA_INVALID"));
  assert.equal(lifecycle.creates.length, 1, "only the accepted create reached the lifecycle");
  assert.equal(libpod.inspectCalls, 0, "createSandbox makes no libpod inspect call, so the refused create made no libpod call");
  assert.equal(lstatOrUndefined(join(config.secretRoot, `realm-${longer}`)), undefined);
  assert.equal(lstatOrUndefined(join(config.sandboxStateRoot, `realm-${longer}`)), undefined);
});

void test("PRD-DRV-02: a name that fails the container-name rule after prefixing is refused with no libpod call and no directory", async () => {
  for (const name of ["agent/1", "a".repeat(123)]) {
    const { driver, lifecycle, config, libpod } = harness();
    const sandbox = validSandbox({ name });
    assert.throws(() => driver.validateSandboxCreate(sandbox), expectCode("SCHEMA_INVALID"));
    await assert.rejects(driver.createSandbox(sandbox), expectCode("SCHEMA_INVALID"));
    assert.equal(libpod.inspectCalls, 0);
    assert.equal(libpod.containers.size, 0);
    assert.equal(lifecycle.creates.length, 0);
    assert.equal(lstatOrUndefined(join(config.sandboxStateRoot, `realm-${name}`)), undefined);
    assert.deepEqual(readdirSync(config.workspaceRoot), []);
  }
});

void test("PRD-DRV-02: an empty argv is accepted, and the lifecycle receives the spec with no command forwarded", async () => {
  const { driver, lifecycle, config } = harness();
  const base = validSandbox();
  const sandbox: DriverSandboxMessage = { ...base, spec: { ...base.spec, command: [] } };
  assert.deepEqual(driver.validateSandboxCreate(sandbox), {});
  await driver.createSandbox(sandbox);
  assert.deepEqual(lifecycle.creates, [specOf(config, "realm-session-1")]);
});

void test("PRD-DRV-02: a create makes only the state directory, and the pinned root keeps its mode and is never created", async () => {
  const config = driverConfig();
  chmodSync(config.workspaceRoot, 0o755);
  const stateDir = join(config.sandboxStateRoot, "realm-session-1");
  assert.equal(existsSync(stateDir), false);
  const modesAtCreate: number[][] = [];
  const lifecycle = {
    create: (spec: ContainerSpec) => {
      modesAtCreate.push([statSync(spec.workspaceDir).mode & 0o777, statSync(spec.stateDir).mode & 0o777]);
      return Promise.resolve("id-realm-session-1");
    },
    delete: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  };
  const driver = new ComputeDriver(config, { lifecycle, libpod: new FakeLibpod(), runtime: new FakeRuntime() });
  await driver.createSandbox(validSandbox());
  assert.deepEqual(modesAtCreate, [[0o755, 0o700]]);
  assert.deepEqual(readdirSync(config.workspaceRoot), []);
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
  assert.deepEqual(readdirSync(config.workspaceRoot), []);
});

void test("PRD-DRV-02: a lifecycle refusal removes the state directory this call made, keeps the pinned root and its contents, and rethrows the original error", async () => {
  const config = driverConfig();
  const notes = join(config.workspaceRoot, "notes.txt");
  writeFileSync(notes, "user data");
  const refusal = new RealmError("SCHEMA_INVALID");
  const stateDirSeen: boolean[] = [];
  const driver = new ComputeDriver(config, {
    lifecycle: refusingLifecycle(refusal, stateDirSeen),
    libpod: new FakeLibpod(),
    runtime: new FakeRuntime(),
  });
  await assert.rejects(driver.createSandbox(validSandbox()), (error: unknown) => error === refusal);
  assert.deepEqual(stateDirSeen, [true]);
  assert.equal(lstatOrUndefined(join(config.sandboxStateRoot, "realm-session-1")), undefined);
  assert.equal(existsSync(notes), true);
});

void test("PRD-DRV-01: a create whose pinned root is replaced by a symbolic link, a file or nothing is refused before any directory is made", async () => {
  const { driver, lifecycle, config } = harness();
  const outside = join(dirname(config.workspaceRoot), "outside");
  mkdirSync(outside);
  rmdirSync(config.workspaceRoot);
  symlinkSync(outside, config.workspaceRoot);
  await assert.rejects(driver.createSandbox(validSandbox()), expectCode("SCHEMA_INVALID"));
  assert.equal(existsSync(outside), true);
  unlinkSync(config.workspaceRoot);
  writeFileSync(config.workspaceRoot, "not a directory");
  await assert.rejects(driver.createSandbox(validSandbox()), expectCode("SCHEMA_INVALID"));
  assert.equal(lstatSync(config.workspaceRoot).isFile(), true);
  unlinkSync(config.workspaceRoot);
  await assert.rejects(driver.createSandbox(validSandbox()), expectCode("SCHEMA_INVALID"));
  assert.equal(lstatOrUndefined(config.workspaceRoot), undefined, "the driver never creates the pinned root");
  assert.equal(lifecycle.creates.length, 0);
  assert.equal(lstatOrUndefined(join(config.sandboxStateRoot, "realm-session-1")), undefined);
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
    const { driver, lifecycle, libpod, config } = harness();
    const sandbox = validSandbox({
      spec: {
        ...validSandbox().spec,
        isolation_backend: { name, endpoint: "unix_socket_path", unix_socket_path: "/run/x.sock" },
      },
    });
    assert.throws(() => driver.validateSandboxCreate(sandbox), expectCode("SCHEMA_INVALID"));
    await assert.rejects(driver.createSandbox(sandbox), expectCode("SCHEMA_INVALID"));
    assert.equal(lifecycle.creates.length, 0);
    assert.equal(libpod.containers.size, 0);
    assert.equal(existsSync(join(config.sandboxStateRoot, "realm-session-1")), false);
    assert.equal(existsSync(join(config.secretRoot, "realm-session-1")), false);
    assert.deepEqual(readdirSync(config.workspaceRoot), []);
  });
}

void test("PRD-DRV-02: a create that selects the configured name over a non-unix endpoint is refused", async () => {
  const { driver, lifecycle, libpod } = harness();
  const sandbox = validSandbox({
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

void test("GetSandbox, ListSandboxes and the watch snapshot report the gateway's name, not the container name", async () => {
  const { driver } = harness();
  await driver.createSandbox(validSandbox({ name: "agent-1" }));
  const byName = await driver.getSandbox({ name: "agent-1" });
  const byId = await driver.getSandbox({ sandbox_id: "sandbox-1" });
  assert.equal(byName.sandbox.name, "agent-1");
  assert.equal(byName.sandbox.status.name, "agent-1");
  assert.equal(byId.sandbox.name, "agent-1");
  const listed = await driver.listSandboxes();
  assert.deepEqual(
    listed.sandboxes.map((sandbox) => sandbox.name),
    ["agent-1"],
  );
  assert.deepEqual([...(await driver.snapshotAll()).keys()], ["agent-1"]);
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

void test("DeleteSandbox by the gateway's name removes the container under its prefixed name", async () => {
  const { driver, lifecycle, libpod } = harness();
  await driver.createSandbox(validSandbox({ name: "agent-1" }));
  assert.deepEqual(await driver.deleteSandbox({ name: "agent-1" }), { deleted: true });
  assert.equal(libpod.containers.has("realm-agent-1"), false);
  assert.deepEqual(lifecycle.deletes, ["realm-agent-1"]);
  await assert.rejects(driver.getSandbox({ name: "agent-1" }), expectNotFound);
});

void test("DeleteSandbox by a name whose container another sandbox holds deletes nothing", async () => {
  const { driver, lifecycle, libpod } = harness();
  await driver.createSandbox(validSandbox({ name: "realm-x" }));
  assert.deepEqual(await driver.deleteSandbox({ name: "x" }), { deleted: false });
  assert.equal(libpod.containers.has("realm-x"), true);
  assert.deepEqual(lifecycle.deletes, []);
  assert.deepEqual(await driver.deleteSandbox({ sandbox_id: "sandbox-1" }), { deleted: true });
  assert.equal(libpod.containers.has("realm-x"), false);
});

void test("EnsureWorkspace checks the pinned root and creates nothing: the root keeps its mode and contents", () => {
  const { driver, config } = harness();
  chmodSync(config.workspaceRoot, 0o755);
  driver.ensureWorkspace({ workspace: "workspace-a" });
  driver.ensureWorkspace({ workspace: "another-id" });
  assert.equal(statSync(config.workspaceRoot).mode & 0o777, 0o755);
  assert.deepEqual(readdirSync(config.workspaceRoot), []);
});

void test("PRD-DRV-01: a pinned root replaced by a symbolic link is refused by EnsureWorkspace and DeleteWorkspace, and the link target is untouched", () => {
  const { driver, config } = harness();
  const outside = join(dirname(config.workspaceRoot), "outside");
  mkdirSync(outside);
  rmdirSync(config.workspaceRoot);
  symlinkSync(outside, config.workspaceRoot);
  assert.throws(() => driver.ensureWorkspace({ workspace: "workspace-a" }), expectCode("SCHEMA_INVALID"));
  assert.throws(() => driver.deleteWorkspace({ workspace: "workspace-a" }), expectCode("REALM_INVALID_TRANSITION"));
  assert.equal(existsSync(outside), true);
});

void test("DeleteWorkspace never removes the pinned root: it is refused with the transition code, empty or not, and the root stays", () => {
  const { driver, config } = harness();
  const notes = join(config.workspaceRoot, "notes.txt");
  writeFileSync(notes, "user data");
  assert.throws(() => driver.deleteWorkspace({ workspace: "workspace-a" }), expectCode("REALM_INVALID_TRANSITION"));
  assert.equal(readFileSync(notes, "utf8"), "user data");
  unlinkSync(notes);
  assert.throws(() => driver.deleteWorkspace({ workspace: "workspace-a" }), expectCode("REALM_INVALID_TRANSITION"));
  assert.equal(statSync(config.workspaceRoot).isDirectory(), true);
});

void test("PRD-DRV-01: a sandbox delete leaves the pinned root, its mode and its contents in place", async () => {
  const config = driverConfig();
  chmodSync(config.workspaceRoot, 0o755);
  const notes = join(config.workspaceRoot, "notes.txt");
  writeFileSync(notes, "user data");
  const libpod = new FakeLibpod();
  const driver = new ComputeDriver(config, {
    lifecycle: await diskLifecycle(config, libpod),
    libpod,
    runtime: new FakeRuntime(),
  });
  await driver.createSandbox(validSandbox());
  const stateDir = join(config.sandboxStateRoot, "realm-session-1");
  assert.equal(existsSync(stateDir), true);
  assert.deepEqual(await driver.deleteSandbox({ sandbox_id: "sandbox-1" }), { deleted: true });
  assert.equal(existsSync(stateDir), false, "the sandbox's own state directory is removed");
  assert.equal(readFileSync(notes, "utf8"), "user data");
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

void test("PRD-DRV-01: the sandbox workspace is the configured root for every workspace id", async () => {
  const { driver, lifecycle, config } = harness();
  await driver.createSandbox(validSandbox({ workspace: "another-id" }));
  assert.equal(lifecycle.creates[0]?.workspaceDir, config.workspaceRoot);
});

void test("PRD-DRV-01: the constructor refuses a pinned root that is relative, missing, a symbolic link, or a file", () => {
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

void test("PRD-DRV-01: the constructor refuses a state root or secret root that holds the pinned root or lies inside it", () => {
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
