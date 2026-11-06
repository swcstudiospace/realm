// The restart path, end to end. A driver's exit leaves its sandbox's container, scratch volume, launch material and runtime descriptor
// on the engine and on disk. A fresh driver started through startDriver adopts them before the start returns: it keeps the container,
// rebuilds the registry entry, and respawns the host supervisor. The sandbox is then served over the driver's socket to List, Get and
// Delete, and a survivor whose supervisor cannot be respawned is destroyed, with the start failing on its catalogue code.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { credentials, makeClientConstructor, type ServiceDefinition, type ServiceError } from "@grpc/grpc-js";
import { makeRealmError, RealmError } from "../../../src/core/errors.js";
import { COMPUTE_DRIVER_SERVICE_NAME, loadComputeDriverService, type ComputeDriverConfig } from "../../../src/runtime/driver/compute-driver.js";
import { startDriver, type DriverProcessConfig, type DriverStartSeams } from "../../../src/runtime/driver/main.js";
import type { LifecycleLibpod } from "../../../src/runtime/driver/lifecycle.js";
import { sandboxBindingOf, type SandboxBinding } from "../../../src/runtime/driver/sandbox-binding.js";
import { DESCRIPTOR_FILE_NAME, secretDirOf, writeLaunchMaterial } from "../../../src/runtime/driver/secret-store.js";
import {
  HARDENING_PROFILE,
  RUNTIME_ARGV,
  RUNTIME_BINARY,
  scratchVolumeLabelsOf,
  scratchVolumeNameOf,
  tmpfsOptionsOf,
} from "../../../src/runtime/hardening.js";
import type { LibpodContainerSummary, LibpodInfo, LibpodInspect } from "../../../src/runtime/libpod-client.js";
import { sessionOfRealmSandbox } from "../../../src/runtime/openshell.js";
import { CONFORMING_PROC_STATUS, RUNTIME_OCI_CONFIG_TEXT } from "../hardening-fixtures.js";
import { launchBody } from "../isolation/supervisor-token.js";
import { OCI_CONFIG_PATH, ociReaderOf, STATIC_DIR } from "../seccomp-fixtures.js";
import { driverConfig, FakeRuntime, LAUNCH_KEY, realmLabels, socketDirectory, writeSandboxWorkspaceEntry } from "./fakes.js";

// The sandbox id the survivor's runtime descriptor names. The gateway assigns it, and the rebuilt registry entry must carry it.
const SANDBOX_ID = "sandbox-1";
const PROJECT = "project-a";
const IMAGE_DIGEST = `sha256:${"a".repeat(64)}`;
const PID = 4242;
const ENGINE_VERSION = "5.7.1";

interface Survivor {
  readonly id: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly inspect: Record<string, unknown>;
}

// The engine a fresh driver starts against. It holds the containers and the scratch volumes the previous generation left, and it records
// every container removal, so a test can show what the start and each RPC removed. Nothing is created or started here: a restart creates
// no container.
class RestartEngine implements LifecycleLibpod {
  readonly containers = new Map<string, Survivor>();
  readonly volumes = new Map<string, Readonly<Record<string, string>>>();
  readonly removals: string[] = [];

  info(): Promise<LibpodInfo> {
    return Promise.resolve({ rootless: true, version: ENGINE_VERSION });
  }

  listContainersByLabel(key: string, value: string): Promise<LibpodContainerSummary[]> {
    const listed = [...this.containers.values()]
      .filter((survivor) => survivor.labels[key] === value)
      .map((survivor) => ({ id: survivor.id, labels: survivor.labels }));
    return Promise.resolve(listed);
  }

  // Resolves a reference the way libpod does: by container id, or by the container's name.
  inspectContainer(reference: string): Promise<LibpodInspect | null> {
    const survivor =
      this.containers.get(reference) ?? [...this.containers.values()].find((candidate) => candidate.inspect["Name"] === reference);
    return Promise.resolve(survivor === undefined ? null : structuredClone(survivor.inspect));
  }

  stopContainer(): Promise<void> {
    return Promise.resolve();
  }

  removeContainer(id: string): Promise<void> {
    this.removals.push(id);
    this.containers.delete(id);
    return Promise.resolve();
  }

  createContainer(): Promise<string> {
    return Promise.reject(makeRealmError("SCHEMA_INVALID"));
  }

  startContainer(): Promise<void> {
    return Promise.reject(makeRealmError("SCHEMA_INVALID"));
  }

  createVolume(name: string, labels: Readonly<Record<string, string>>): Promise<void> {
    this.volumes.set(name, { ...labels });
    return Promise.resolve();
  }

  inspectVolume(name: string): Promise<{ readonly name: string } | null> {
    return Promise.resolve(this.volumes.has(name) ? { name } : null);
  }

  listVolumesByLabel(key: string, value: string): Promise<string[]> {
    const listed = [...this.volumes].filter(([, labels]) => labels[key] === value).map(([name]) => name);
    return Promise.resolve(listed);
  }

  removeVolume(name: string): Promise<void> {
    this.volumes.delete(name);
    return Promise.resolve();
  }
}

// The raw inspect of a conforming sandbox container, bound the way create binds it: its workspace, its state directory and its channel
// directory, its scratch volume, and the hardening profile's properties. The verifier checks it against the binding the registry entry
// rebuilds.
function conformingInspect(id: string, name: string, binding: SandboxBinding): Record<string, unknown> {
  const session = sessionOfRealmSandbox(name);
  if (session === undefined) {
    throw new Error(`the sandbox name ${name} carries no session`);
  }
  const scratch = scratchVolumeNameOf(session);
  return {
    Id: id,
    Name: name,
    ImageDigest: IMAGE_DIGEST,
    Path: RUNTIME_BINARY,
    Args: RUNTIME_ARGV.slice(1),
    StaticDir: STATIC_DIR,
    OCIConfigPath: OCI_CONFIG_PATH,
    State: { Status: "running", Running: true, Pid: PID },
    Config: { User: HARDENING_PROFILE.workloadUser, Tty: false, Labels: realmLabels(name) },
    HostConfig: {
      Privileged: HARDENING_PROFILE.privileged,
      CapAdd: [...HARDENING_PROFILE.capAdd],
      SecurityOpt: [...HARDENING_PROFILE.securityOpt],
      ReadonlyRootfs: HARDENING_PROFILE.readonlyRootfs,
      Tmpfs: Object.fromEntries(
        [...HARDENING_PROFILE.tmpfs, HARDENING_PROFILE.supervisorCaDestination].map((destination): [string, string] => [
          destination,
          tmpfsOptionsOf(destination).join(","),
        ]),
      ),
      PidsLimit: 512,
      Memory: 1024 * 1024 * 1024,
      MemorySwap: 1024 * 1024 * 1024,
      NanoCpus: 2_000_000_000,
      NetworkMode: HARDENING_PROFILE.networkMode,
      Devices: [],
      PidMode: "private",
      IpcMode: "shareable",
      UTSMode: "private",
      CgroupMode: "private",
      UsernsMode: "keep-id:uid=1001,gid=1001",
    },
    Mounts: [
      {
        Type: "bind",
        Source: binding.workspaceRoot,
        Destination: HARDENING_PROFILE.workspaceDestination,
        RW: true,
        Options: ["rbind", "noexec", "nosuid", "nodev"],
      },
      {
        Type: "bind",
        Source: binding.stateDir,
        Destination: HARDENING_PROFILE.stateDestination,
        RW: false,
        Options: ["rbind", "ro", "noexec", "nosuid", "nodev"],
      },
      {
        Type: "bind",
        Source: binding.channelDir,
        Destination: HARDENING_PROFILE.channelDestination,
        RW: true,
        Options: ["rbind", "rw", "noexec", "nosuid", "nodev"],
      },
      {
        Type: "volume",
        Name: scratch,
        Source: `/var/lib/containers/storage/volumes/${scratch}/_data`,
        Destination: HARDENING_PROFILE.scratchDestination,
        RW: true,
        Options: ["rw", "noexec", "nosuid", "nodev"],
      },
    ],
  };
}

// Leaves one sandbox behind as a previous generation's driver would: its registry entry, its launch material and runtime descriptor in the
// secret directory, its conforming container, and its scratch volume. Returns the sandbox's gateway name.
function leaveSurvivor(engine: RestartEngine, config: ComputeDriverConfig): string {
  const dir = join(config.workspaceRoot, PROJECT);
  const name = writeSandboxWorkspaceEntry(config, dir);
  const workspaceRoot = realpathSync(dir);
  writeLaunchMaterial(config.secretRoot, name, launchBody(LAUNCH_KEY));
  writeFileSync(join(secretDirOf(config.secretRoot, name), DESCRIPTOR_FILE_NAME), JSON.stringify({ boundary_id: SANDBOX_ID }), {
    mode: 0o600,
  });
  const id = `c-${name}`;
  const binding = sandboxBindingOf({ workspaceRoot, stateRoot: config.sandboxStateRoot, secretRoot: config.secretRoot }, name);
  engine.containers.set(id, { id, labels: realmLabels(name), inspect: conformingInspect(id, name, binding) });
  const session = sessionOfRealmSandbox(name);
  if (session === undefined) {
    throw new Error(`the sandbox name ${name} carries no session`);
  }
  engine.volumes.set(scratchVolumeNameOf(session), scratchVolumeLabelsOf(session));
  return name;
}

// The seams of a start over the engine: the libpod calls, the spawn, and the two host readers the verifier reads the init process and the
// OCI config through, which a test cannot provide from the host.
function seamsOver(engine: RestartEngine, runtime: FakeRuntime): DriverStartSeams {
  return {
    libpod: engine,
    runtime,
    readProcStatus: () => CONFORMING_PROC_STATUS,
    readOciConfig: ociReaderOf(RUNTIME_OCI_CONFIG_TEXT),
  };
}

function processConfigOf(driver: ComputeDriverConfig): DriverProcessConfig {
  return {
    socketPath: join(socketDirectory(), "driver.sock"),
    libpodSocketPath: "/not-used-by-the-seams/podman.sock",
    driver,
  };
}

// A unary call on the driver's socket, as the gateway makes it. A failed call rejects with the wire error.
function rpcOver(t: TestContext, socketPath: string): (method: string, request: object) => Promise<unknown> {
  const service = loadComputeDriverService();
  const Constructor = makeClientConstructor(service, COMPUTE_DRIVER_SERVICE_NAME);
  const client = new Constructor(`unix:${socketPath}`, credentials.createInsecure());
  t.after(() => {
    client.close();
  });
  return (method: string, request: object): Promise<unknown> => {
    const definition: ServiceDefinition[string] | undefined = service[method];
    if (definition === undefined) {
      throw new Error(`the service has no ${method} method`);
    }
    let resolve: (value: unknown) => void = () => undefined;
    let reject: (reason: unknown) => void = () => undefined;
    const promise = new Promise<unknown>((resolveWith, rejectWith) => {
      resolve = resolveWith;
      reject = rejectWith;
    });
    client.makeUnaryRequest(
      definition.path,
      definition.requestSerialize,
      definition.responseDeserialize,
      request,
      (error: ServiceError | null, response: unknown) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(response);
      },
    );
    return promise;
  };
}

// A value that is an object, typed as a record so that a field can be read by its name.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// One field of a response. A value that is not an object, or lacks the field, reads as undefined, so the assertion that uses it fails.
function fieldOf(response: unknown, field: string): unknown {
  return isRecord(response) && field in response ? response[field] : undefined;
}

void test("restart: the start adopts a conforming survivor and rebuilds its registry, and List, Get and Delete serve it", async (t) => {
  const config = driverConfig();
  t.after(() => {
    rmSync(dirname(config.sandboxStateRoot), { recursive: true, force: true });
  });
  const engine = new RestartEngine();
  const name = leaveSurvivor(engine, config);
  const id = `c-${name}`;
  const session = sessionOfRealmSandbox(name) ?? "";
  const runtime = new FakeRuntime();
  const processConfig = processConfigOf(config);
  const server = await startDriver(processConfig, seamsOver(engine, runtime));
  t.after(async () => {
    await server.close();
  });

  // The start returned, so the adoption and the rebuild have resolved. Nothing was removed, and the supervisor was respawned for the
  // survivor with the sandbox's id and name.
  assert.deepEqual(engine.removals, [], "the start removed no container");
  assert.equal(engine.containers.has(id), true, "the survivor's container is kept");
  assert.equal(engine.volumes.has(scratchVolumeNameOf(session)), true, "the survivor's scratch volume is kept");
  assert.equal(existsSync(join(secretDirOf(config.secretRoot, name), "launch.json")), true, "the survivor's launch material is kept");
  assert.equal(runtime.spawns.length, 1, "the supervisor was respawned once");
  const args = runtime.spawns[0]?.args ?? [];
  assert.equal(args[args.indexOf("--sandbox-id") + 1], SANDBOX_ID);
  assert.equal(args[args.indexOf("--sandbox") + 1], name);

  // The registry the start rebuilt is the one the RPCs read.
  const rpc = rpcOver(t, processConfig.socketPath);
  const listed = await rpc("ListSandboxes", {});
  const sandboxes = fieldOf(listed, "sandboxes");
  assert.ok(Array.isArray(sandboxes), "List answers with a sandbox list");
  assert.deepEqual(
    sandboxes.map((sandbox: unknown) => [fieldOf(sandbox, "id"), fieldOf(sandbox, "name")]),
    [[SANDBOX_ID, name]],
    "List returns the adopted sandbox",
  );
  const got = await rpc("GetSandbox", { name });
  assert.equal(fieldOf(fieldOf(got, "sandbox"), "name"), name, "Get returns the adopted sandbox");

  // Delete removes the container, the scratch volume and the secret directory, and stops the respawned supervisor.
  const deleted = await rpc("DeleteSandbox", { name });
  assert.equal(fieldOf(deleted, "deleted"), true, "Delete reports the sandbox deleted");
  assert.deepEqual(engine.removals, [id], "Delete removed the sandbox's container, once");
  assert.equal(engine.volumes.has(scratchVolumeNameOf(session)), false, "Delete removed the scratch volume");
  assert.equal(existsSync(secretDirOf(config.secretRoot, name)), false, "Delete removed the secret directory");
  assert.equal(runtime.supervisors[0]?.stops, 1, "Delete stopped the respawned supervisor");
});

void test("restart: a survivor whose supervisor cannot be respawned is destroyed, and the start fails with its catalogue code", async (t) => {
  const config = driverConfig();
  t.after(() => {
    rmSync(dirname(config.sandboxStateRoot), { recursive: true, force: true });
  });
  const engine = new RestartEngine();
  const name = leaveSurvivor(engine, config);
  const runtime = new FakeRuntime();
  runtime.spawnError = makeRealmError("OPENSHELL_START_FAILED");
  const processConfig = processConfigOf(config);

  await assert.rejects(
    startDriver(processConfig, seamsOver(engine, runtime)),
    (error: unknown) => error instanceof RealmError && error.code === "OPENSHELL_START_FAILED",
  );

  assert.deepEqual(engine.removals, [`c-${name}`], "the survivor's container was removed");
  assert.equal(engine.containers.size, 0, "no container is left standing");
  assert.equal(existsSync(secretDirOf(config.secretRoot, name)), false, "the survivor's secret directory was removed");
  assert.equal(existsSync(processConfig.socketPath), false, "the failed start left no socket");
});

void test("restart: the start logs an adopted line for the kept container, and a removed line with its cause for one with no record", async (t) => {
  const config = driverConfig();
  t.after(() => {
    rmSync(dirname(config.sandboxStateRoot), { recursive: true, force: true });
  });
  const engine = new RestartEngine();
  const kept = leaveSurvivor(engine, config);
  // A realm container whose sandbox has no registry entry and no secret directory: nothing is retained for it, so the start removes it.
  const orphan = "realm-0123abcd-0000-4000-8000-000000000001";
  const orphanId = `c-${orphan}`;
  engine.containers.set(orphanId, { id: orphanId, labels: realmLabels(orphan), inspect: { Id: orphanId, Name: orphan } });
  const lines: string[] = [];
  const logged: ComputeDriverConfig = {
    ...config,
    refusalLog: (line: string): void => {
      lines.push(line);
    },
  };
  const server = await startDriver(processConfigOf(logged), seamsOver(engine, new FakeRuntime()));
  t.after(async () => {
    await server.close();
  });

  assert.deepEqual(engine.removals, [orphanId], "the start removed the container with no record, and no other");
  assert.deepEqual(lines, [
    `realm compute driver adoption removed: container=${orphanId} cause=no-record`,
    `realm compute driver adoption adopted: container=c-${kept}`,
  ]);
});
