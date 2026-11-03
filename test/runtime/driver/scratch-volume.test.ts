import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRealmError, RealmError, type ErrorCode } from "../../../src/core/errors.js";
import { bindRoot } from "../../../src/fs/root.js";
import { DriverLifecycle, HardeningRefusal, type AdoptionRoots, type LifecycleLibpod } from "../../../src/runtime/driver/lifecycle.js";
import { sandboxBindingOf } from "../../../src/runtime/driver/sandbox-binding.js";
import { secretDirOf } from "../../../src/runtime/driver/secret-store.js";
import {
  HARDENING_PROFILE,
  RUNTIME_ARGV,
  RUNTIME_BINARY,
  scratchVolumeLabelsOf,
  scratchVolumeNameOf,
  tmpfsOptionsOf,
} from "../../../src/runtime/hardening.js";
import type { ContainerSpec, LibpodContainerSummary, LibpodInfo, LibpodInspect } from "../../../src/runtime/libpod-client.js";
import {
  OPENSHELL_ISOLATION_ROLE_LABEL_KEY,
  OPENSHELL_MANAGED_LABEL_KEY,
  OPENSHELL_MANAGED_LABEL_VALUE,
  OPENSHELL_SANDBOX_NAME_LABEL_KEY,
  OPENSHELL_SANDBOX_ROLE_VALUE,
} from "../../../src/runtime/openshell.js";
import { sandboxNameOfSession, sessionIdOfWorkspace } from "../../../src/session/paths.js";
import { writeWorkspaceEntry } from "../../../src/session/workspace-registry.js";
import { CONFORMING_PROC_STATUS, RUNTIME_OCI_CONFIG_TEXT } from "../hardening-fixtures.js";
import { OCI_CONFIG_PATH, ociReaderOf, STATIC_DIR } from "../seccomp-fixtures.js";

// The engine answers in memory. Every sandbox here is realm-sess-1, whose session is sess-1, so its scratch volume is
// realm-scratch-sess-1. Digests and paths come from the hardening profile and the fixtures the create body is verified against.
const IMAGE_DIGEST = `sha256:${"a".repeat(64)}`;
const IMAGE = `localhost/realm-agentos@${IMAGE_DIGEST}`;
const PID = 4242;
const SESSION = "sess-1";
const SANDBOX = "realm-sess-1";
const VOLUME = scratchVolumeNameOf(SESSION);

interface Container {
  readonly id: string;
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly inspect: Record<string, unknown>;
  // The scratch volume the container mounts, or undefined when it mounts none.
  readonly volume: string | undefined;
}

// The libpod calls the lifecycle makes, answered in memory. Each call is recorded in order, so a test can show which removal came
// first. The options model the engine's refusals: a create it refuses, a volume removal it refuses, and a volume that stays listed
// after its removal returns.
class FakeEngine implements LifecycleLibpod {
  readonly containers = new Map<string, Container>();
  readonly volumes = new Map<string, Readonly<Record<string, string>>>();
  readonly calls: string[] = [];
  // The code a container create is refused with, as an engine that cannot attach the volume refuses it.
  createError: ErrorCode | undefined;
  // A container is created without the scratch volume mount.
  omitScratch = false;
  // A volume removal is refused with this code.
  removeVolumeError: ErrorCode | undefined;
  // A volume removal returns, and the volume stays listed.
  volumeStays = false;
  private sequence = 0;

  info(): Promise<LibpodInfo> {
    return Promise.resolve({ rootless: true, version: "5.7.1" });
  }

  createContainer(spec: ContainerSpec): Promise<string> {
    this.calls.push(`createContainer:${spec.sandboxName}`);
    if (this.createError !== undefined) {
      return Promise.reject(makeRealmError(this.createError));
    }
    if (this.findContainer(spec.sandboxName) !== undefined) {
      return Promise.reject(makeRealmError("SANDBOX_NAME_IN_USE"));
    }
    this.sequence += 1;
    const id = `ctr-${String(this.sequence)}`;
    const volume = this.omitScratch ? undefined : VOLUME;
    this.seed(id, spec.sandboxName, inspectOf(spec, id, volume), volume);
    return Promise.resolve(id);
  }

  startContainer(id: string): Promise<void> {
    this.calls.push(`startContainer:${id}`);
    return Promise.resolve();
  }

  inspectContainer(reference: string): Promise<LibpodInspect | null> {
    return Promise.resolve(this.findContainer(reference)?.inspect ?? null);
  }

  stopContainer(reference: string): Promise<void> {
    this.calls.push(`stopContainer:${reference}`);
    return Promise.resolve();
  }

  removeContainer(reference: string): Promise<void> {
    this.calls.push(`removeContainer:${reference}`);
    const container = this.findContainer(reference);
    if (container !== undefined) {
      this.containers.delete(container.id);
    }
    return Promise.resolve();
  }

  listContainersByLabel(key: string, value: string): Promise<LibpodContainerSummary[]> {
    const listed = [...this.containers.values()]
      .filter((container) => container.labels[key] === value)
      .map((container) => ({ id: container.id, labels: container.labels }));
    return Promise.resolve(listed);
  }

  createVolume(name: string, labels: Readonly<Record<string, string>>): Promise<void> {
    this.calls.push(`createVolume:${name}`);
    if (this.volumes.has(name)) {
      return Promise.reject(makeRealmError("SANDBOX_NAME_IN_USE"));
    }
    this.volumes.set(name, labels);
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
    this.calls.push(`removeVolume:${name}`);
    if (this.removeVolumeError !== undefined) {
      return Promise.reject(makeRealmError(this.removeVolumeError));
    }
    // The engine declines to remove a volume a container still uses, which the client reports as an unexpected status.
    if ([...this.containers.values()].some((container) => container.volume === name)) {
      return Promise.reject(makeRealmError("SCHEMA_INVALID"));
    }
    if (!this.volumeStays) {
      this.volumes.delete(name);
    }
    return Promise.resolve();
  }

  // Adds a container the engine already holds, as a container from an earlier start would be.
  seed(id: string, name: string, inspect: Record<string, unknown>, volume: string | undefined): void {
    this.containers.set(id, { id, name, labels: realmLabels(name), inspect, volume });
  }

  private findContainer(reference: string): Container | undefined {
    return [...this.containers.values()].find((container) => container.id === reference || container.name === reference);
  }
}

function realmLabels(name: string): Record<string, string> {
  return {
    [OPENSHELL_MANAGED_LABEL_KEY]: OPENSHELL_MANAGED_LABEL_VALUE,
    [OPENSHELL_SANDBOX_NAME_LABEL_KEY]: name,
    [OPENSHELL_ISOLATION_ROLE_LABEL_KEY]: OPENSHELL_SANDBOX_ROLE_VALUE,
  };
}

// The scratch volume's mount entry, as Podman's inspect reports a named volume.
function scratchMount(volume: string): Record<string, unknown> {
  return {
    Type: "volume",
    Name: volume,
    Source: `/var/lib/containers/storage/volumes/${volume}/_data`,
    Destination: HARDENING_PROFILE.scratchDestination,
    RW: true,
  };
}

// The inspect of a container the create body built, conforming to every property the verifier and the checks after start make. The
// scratch mount is the given one, or none. Each value is the profile's, as the create body carries it.
function inspectOf(spec: ContainerSpec, id: string, volume: string | undefined): Record<string, unknown> {
  const scratch = volume === undefined ? [] : [scratchMount(volume)];
  return {
    Id: id,
    Name: spec.sandboxName,
    ImageDigest: IMAGE_DIGEST,
    Path: RUNTIME_BINARY,
    Args: RUNTIME_ARGV.slice(1),
    StaticDir: STATIC_DIR,
    OCIConfigPath: OCI_CONFIG_PATH,
    State: { Pid: PID, Status: "running" },
    Config: { User: HARDENING_PROFILE.workloadUser, Tty: false, Labels: realmLabels(spec.sandboxName) },
    HostConfig: {
      Privileged: HARDENING_PROFILE.privileged,
      CapAdd: [...HARDENING_PROFILE.capAdd],
      SecurityOpt: [...HARDENING_PROFILE.securityOpt],
      ReadonlyRootfs: HARDENING_PROFILE.readonlyRootfs,
      Tmpfs: Object.fromEntries(
        [...HARDENING_PROFILE.tmpfs, HARDENING_PROFILE.supervisorCaDestination].map((path): [string, string] => [
          path,
          tmpfsOptionsOf(path).join(","),
        ]),
      ),
      PidsLimit: HARDENING_PROFILE.pidsLimit,
      Memory: HARDENING_PROFILE.memoryBytes,
      MemorySwap: HARDENING_PROFILE.memoryBytes,
      NanoCpus: HARDENING_PROFILE.nanoCpus,
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
        Source: spec.workspaceDir,
        Destination: HARDENING_PROFILE.workspaceDestination,
        RW: true,
        Options: ["rbind", "noexec", "nosuid", "nodev"],
      },
      {
        Type: "bind",
        Source: spec.stateDir,
        Destination: HARDENING_PROFILE.stateDestination,
        RW: false,
        Options: ["rbind", "ro", "noexec", "nosuid", "nodev"],
      },
      {
        Type: "bind",
        Source: spec.channelDir,
        Destination: HARDENING_PROFILE.channelDestination,
        RW: true,
        Options: ["rbind", "rw", "noexec", "nosuid", "nodev"],
      },
      ...scratch,
    ],
  };
}

function tempDir(t: TestContext, prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function hasCode(code: ErrorCode): (error: unknown) => boolean {
  return (error) => error instanceof RealmError && error.code === code;
}

// The create spec the driver derives for a sandbox: its state and channel directories are the binding's, created on disk.
function specFor(roots: { readonly stateRoot: string; readonly secretRoot: string }, name: string, workspaceDir: string): ContainerSpec {
  const binding = sandboxBindingOf({ workspaceRoot: workspaceDir, stateRoot: roots.stateRoot, secretRoot: roots.secretRoot }, name);
  mkdirSync(binding.stateDir, { recursive: true });
  mkdirSync(binding.channelDir, { recursive: true });
  return {
    sandboxName: name,
    image: IMAGE,
    workspaceDir: binding.workspaceRoot,
    stateDir: binding.stateDir,
    channelDir: binding.channelDir,
  };
}

interface Harness {
  readonly engine: FakeEngine;
  readonly lifecycle: DriverLifecycle;
  readonly root: string;
  readonly stateRoot: string;
  readonly secretRoot: string;
  readonly roots: AdoptionRoots;
  readonly spec: ContainerSpec;
}

// A lifecycle over a fresh engine, with real directories for the state, the secrets, the workspace and the registry. The startup
// adoption runs first unless adopt is false, since create and delete refuse until it has run.
async function harness(t: TestContext, adopt = true): Promise<Harness> {
  const root = tempDir(t, "realm-scratch-");
  const stateRoot = join(root, "state");
  const secretRoot = join(root, "secrets");
  const workspaceDir = join(root, "workspace");
  const registry = join(root, "registry");
  for (const dir of [stateRoot, secretRoot, workspaceDir, registry]) {
    mkdirSync(dir);
  }
  const engine = new FakeEngine();
  const lifecycle = new DriverLifecycle({
    libpod: engine,
    sandboxStateRoot: stateRoot,
    secretRoot,
    readProcStatus: () => CONFORMING_PROC_STATUS,
    readOciConfig: ociReaderOf(RUNTIME_OCI_CONFIG_TEXT),
  });
  const roots: AdoptionRoots = { workspaceStateDir: registry, workspaceCeiling: root, image: IMAGE };
  if (adopt) {
    await lifecycle.adoptSurvivors(roots);
  }
  return { engine, lifecycle, root, stateRoot, secretRoot, roots, spec: specFor({ stateRoot, secretRoot }, SANDBOX, workspaceDir) };
}

// Seeds a survivor that conforms: a workspace registered under the session its path names, the launch material the binding is
// rebuilt from, and a container of that name with the scratch volume of its session. Returns the sandbox name, the container id and the
// volume's name.
function seedSurvivor(
  h: Harness,
  workspace: string,
): { readonly sandboxName: string; readonly containerId: string; readonly volume: string } {
  mkdirSync(workspace);
  const pinned = bindRoot(workspace);
  const sessionId = sessionIdOfWorkspace(pinned.realPath);
  const sandboxName = sandboxNameOfSession(sessionId);
  writeWorkspaceEntry(h.roots.workspaceStateDir, pinned, sessionId);
  const spec = specFor({ stateRoot: h.stateRoot, secretRoot: h.secretRoot }, sandboxName, pinned.realPath);
  const secretDir = secretDirOf(h.secretRoot, sandboxName);
  mkdirSync(secretDir, { recursive: true });
  writeFileSync(join(secretDir, "launch.json"), "{}");
  const volume = scratchVolumeNameOf(sessionId);
  const containerId = `ctr-${sandboxName}`;
  h.engine.seed(containerId, sandboxName, inspectOf(spec, containerId, volume), volume);
  h.engine.volumes.set(volume, scratchVolumeLabelsOf(sessionId));
  return { sandboxName, containerId, volume };
}

void test("R2: create makes the session's scratch volume before the container, labelled as the realm's, and the container mounts it", async (t) => {
  const h = await harness(t);
  const id = await h.lifecycle.create(h.spec);
  assert.equal(id, "ctr-1");
  assert.deepEqual(h.engine.calls.slice(0, 2), [`createVolume:${VOLUME}`, `createContainer:${SANDBOX}`]);
  assert.deepEqual(h.engine.volumes.get(VOLUME), scratchVolumeLabelsOf(SESSION));
  assert.equal(h.engine.containers.get(id)?.volume, VOLUME);
});

void test("R2: a create whose verification fails removes the container, then the volume, each with proof", async (t) => {
  const h = await harness(t);
  h.engine.omitScratch = true;
  await assert.rejects(
    h.lifecycle.create(h.spec),
    (error: unknown) =>
      error instanceof HardeningRefusal && error.property === "mounts" && error.code === "OPENSHELL_START_FAILED",
  );
  assert.equal(h.engine.containers.size, 0, "the container is gone");
  assert.equal(h.engine.volumes.size, 0, "the volume is gone, proven by the listing");
  const removedContainer = h.engine.calls.findIndex((call) => call.startsWith("removeContainer:"));
  const removedVolume = h.engine.calls.findIndex((call) => call.startsWith("removeVolume:"));
  assert.ok(removedContainer >= 0 && removedContainer < removedVolume, "the container is removed before the volume");
});

void test("R2: a volume the engine keeps after its removal is reported with its cleanup code, and the refusal keeps its own code", async (t) => {
  const h = await harness(t);
  h.engine.omitScratch = true;
  h.engine.volumeStays = true;
  await assert.rejects(h.lifecycle.create(h.spec), (error: unknown) => {
    return (
      error instanceof RealmError &&
      error.code === "OPENSHELL_START_FAILED" &&
      error.message.includes(`volume ${VOLUME} survived (cleanup code CLEANUP_FAILED)`)
    );
  });
  assert.equal(h.engine.volumes.has(VOLUME), true, "the volume is kept, so the commitment is kept");
});

void test("R2: the fail-closed attach case refuses with OPENSHELL_START_FAILED, makes no second attempt and no fallback, and removes its volume", async (t) => {
  const h = await harness(t);
  h.engine.createError = "SCHEMA_INVALID";
  await assert.rejects(
    h.lifecycle.create(h.spec),
    (error: unknown) =>
      error instanceof RealmError && error.code === "OPENSHELL_START_FAILED" && error.causeCode === "SCHEMA_INVALID",
  );
  assert.deepEqual(
    h.engine.calls.filter((call) => call.startsWith("createContainer:")),
    [`createContainer:${SANDBOX}`],
    "one container create, and no fallback container",
  );
  assert.deepEqual(
    h.engine.calls.filter((call) => call.startsWith("createVolume:")),
    [`createVolume:${VOLUME}`],
    "one volume create, and no fallback volume",
  );
  assert.equal(h.engine.containers.size, 0);
  assert.equal(h.engine.volumes.size, 0);
});

void test("R2: a volume of the name already present refuses the create with SANDBOX_NAME_IN_USE, and the volume is left alone", async (t) => {
  const h = await harness(t);
  h.engine.volumes.set(VOLUME, {});
  await assert.rejects(h.lifecycle.create(h.spec), hasCode("SANDBOX_NAME_IN_USE"));
  assert.equal(h.engine.volumes.has(VOLUME), true);
  assert.equal(
    h.engine.calls.some((call) => call.startsWith("createVolume:") || call.startsWith("removeVolume:")),
    false,
    "neither a create nor a removal of the volume is attempted",
  );
});

void test("R2: delete removes the sandbox, then its volume, and proves the volume is gone with a listing", async (t) => {
  const h = await harness(t);
  await h.lifecycle.create(h.spec);
  await h.lifecycle.delete(SANDBOX);
  assert.deepEqual(
    h.engine.calls.filter((call) => call.startsWith("removeContainer:") || call.startsWith("removeVolume:")),
    ["removeContainer:ctr-1", `removeVolume:${VOLUME}`],
  );
  assert.equal(h.engine.containers.size, 0);
  assert.equal(h.engine.volumes.size, 0);
  assert.equal(existsSync(h.spec.stateDir), false, "the state directory is removed after the volume");
});

void test("R2: delete keeps the sandbox's state when the volume's removal is not proven, so a retry can finish", async (t) => {
  const h = await harness(t);
  await h.lifecycle.create(h.spec);
  h.engine.volumeStays = true;
  await assert.rejects(h.lifecycle.delete(SANDBOX), hasCode("CLEANUP_FAILED"));
  assert.equal(h.engine.volumes.has(VOLUME), true);
  assert.equal(existsSync(h.spec.stateDir), true);
});

void test("R2: startup removes an unreferenced realm volume with the cause no-container, and leaves a volume that is not the realm's", async (t) => {
  const h = await harness(t, false);
  h.engine.volumes.set(scratchVolumeNameOf("sess-9"), scratchVolumeLabelsOf("sess-9"));
  h.engine.volumes.set("foreign", {});
  const adoption = await h.lifecycle.adoptSurvivors(h.roots);
  assert.deepEqual(adoption.volumesRemoved, [{ name: scratchVolumeNameOf("sess-9"), cause: "no-container" }]);
  assert.deepEqual([...h.engine.volumes.keys()], ["foreign"]);
});

void test("R2: startup removes the volume of a container it removes, with that container's cause", async (t) => {
  const h = await harness(t, false);
  const spec = specFor({ stateRoot: h.stateRoot, secretRoot: h.secretRoot }, "realm-sess-7", join(h.root, "workspace"));
  const volume = scratchVolumeNameOf("sess-7");
  const inspect = { ...inspectOf(spec, "ctr-seed", volume), Name: "realm-other" };
  h.engine.seed("ctr-seed", "realm-sess-7", inspect, volume);
  h.engine.volumes.set(volume, scratchVolumeLabelsOf("sess-7"));
  const adoption = await h.lifecycle.adoptSurvivors(h.roots);
  assert.deepEqual(adoption.removed, [{ containerId: "ctr-seed", cause: "no-record" }]);
  assert.deepEqual(adoption.volumesRemoved, [{ name: volume, cause: "no-record" }]);
  assert.equal(h.engine.volumes.has(volume), false);
});

void test("R2: startup keeps the volume a surviving sandbox uses, and removes none of it", async (t) => {
  const h = await harness(t, false);
  const survivor = seedSurvivor(h, join(h.root, "project-a"));
  const adoption = await h.lifecycle.adoptSurvivors(h.roots);
  assert.deepEqual(adoption.adopted, [{ sandboxName: survivor.sandboxName, containerId: survivor.containerId }]);
  assert.deepEqual(adoption.removed, []);
  assert.deepEqual(adoption.volumesRemoved, []);
  assert.equal(h.engine.volumes.has(survivor.volume), true, "the surviving sandbox's volume is kept");
  assert.deepEqual(
    h.engine.calls.filter((call) => call.startsWith("removeVolume:")),
    [],
    "no volume removal is attempted",
  );
});

void test("R2: startup with an unproven volume removal rejects the adoption with REALM_STOPPING and the removal's cause, and sweeps nothing else", async (t) => {
  const h = await harness(t, false);
  h.engine.volumes.set(scratchVolumeNameOf("sess-9"), scratchVolumeLabelsOf("sess-9"));
  h.engine.removeVolumeError = "PODMAN_MACHINE_DOWN";
  await assert.rejects(
    h.lifecycle.adoptSurvivors(h.roots),
    (error: unknown) => error instanceof RealmError && error.code === "REALM_STOPPING" && error.causeCode === "PODMAN_MACHINE_DOWN",
  );
  assert.equal(h.engine.volumes.has(scratchVolumeNameOf("sess-9")), true);
  await assert.rejects(h.lifecycle.create(h.spec), hasCode("REALM_NOT_ACTIVE"));
});
