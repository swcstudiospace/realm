// The selective startup adoption (DriverLifecycle.adoptSurvivors). A realm container that still conforms to the binding rebuilt from its
// retained artifacts is kept; every other realm container is removed with its cause, and a removal counts only when a listing taken after
// all of them no longer holds it. A sandbox's secret entries are removed only when it keeps no container.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { makeRealmError, RealmError } from "../../../src/core/errors.js";
import type { ComputeDriverConfig } from "../../../src/runtime/driver/compute-driver.js";
import { DriverLifecycle, type AdoptionRoots, type LifecycleLibpod } from "../../../src/runtime/driver/lifecycle.js";
import { sandboxBindingOf, type SandboxBinding } from "../../../src/runtime/driver/sandbox-binding.js";
import { presentSecretEntries, secretDirOf, writeLaunchMaterial } from "../../../src/runtime/driver/secret-store.js";
import { HARDENING_PROFILE, RUNTIME_ARGV, RUNTIME_BINARY, tmpfsOptionsOf } from "../../../src/runtime/hardening.js";
import type {
  LibpodContainerSummary,
  LibpodInfo,
  LibpodInspect,
} from "../../../src/runtime/libpod-client.js";
import { sandboxNameOfSession, sessionIdOfWorkspace } from "../../../src/session/paths.js";
import { CONFORMING_PROC_STATUS, RUNTIME_OCI_CONFIG_TEXT } from "../hardening-fixtures.js";
import { OCI_CONFIG_PATH, ociReaderOf, STATIC_DIR } from "../seccomp-fixtures.js";
import { driverConfig, realmLabels, writeSandboxWorkspaceEntry } from "./fakes.js";

// The digest the driver's sandbox image pins. A conforming container reports it as its image digest.
const IMAGE_DIGEST = `sha256:${"a".repeat(64)}`;
const PID = 4242;
const ENGINE_VERSION = "5.7.1";

// A container the fake engine holds: its id, its labels, and its raw inspect, which carries its name and labels as the engine reports them.
interface Survivor {
  readonly id: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly inspect: Record<string, unknown>;
}

// A libpod stand-in for an adoption. It lists, inspects and removes containers from memory. An adoption never creates, starts or stops a
// container, so those calls reject.
class SurvivorLibpod implements LifecycleLibpod {
  readonly containers = new Map<string, Survivor>();
  readonly removals: string[] = [];
  // Ids whose inspect fails with the engine's timeout code.
  readonly inspectFails = new Set<string>();
  // Ids whose removal fails and leaves the container in place.
  readonly removalRefused = new Set<string>();

  info(): Promise<LibpodInfo> {
    return Promise.resolve({ rootless: true, version: ENGINE_VERSION });
  }

  listContainersByLabel(key: string, value: string): Promise<LibpodContainerSummary[]> {
    const listed = [...this.containers.values()]
      .filter((survivor) => survivor.labels[key] === value)
      .map((survivor) => ({ id: survivor.id, labels: survivor.labels }));
    return Promise.resolve(listed);
  }

  inspectContainer(id: string): Promise<LibpodInspect | null> {
    if (this.inspectFails.has(id)) {
      return Promise.reject(makeRealmError("PODMAN_MACHINE_DOWN"));
    }
    const survivor = this.containers.get(id);
    return Promise.resolve(survivor === undefined ? null : structuredClone(survivor.inspect));
  }

  removeContainer(id: string): Promise<void> {
    this.removals.push(id);
    if (this.removalRefused.has(id)) {
      return Promise.reject(makeRealmError("CLEANUP_FAILED"));
    }
    this.containers.delete(id);
    return Promise.resolve();
  }

  createContainer(): Promise<string> {
    return Promise.reject(makeRealmError("SCHEMA_INVALID"));
  }

  startContainer(): Promise<void> {
    return Promise.reject(makeRealmError("SCHEMA_INVALID"));
  }

  stopContainer(): Promise<void> {
    return Promise.reject(makeRealmError("SCHEMA_INVALID"));
  }
}

interface Harness {
  readonly config: ComputeDriverConfig;
  readonly libpod: SurvivorLibpod;
  readonly lifecycle: DriverLifecycle;
  readonly roots: AdoptionRoots;
}

function harnessOf(): Harness {
  const config = driverConfig();
  const libpod = new SurvivorLibpod();
  const lifecycle = new DriverLifecycle({
    libpod,
    sandboxStateRoot: config.sandboxStateRoot,
    secretRoot: config.secretRoot,
    readOciConfig: ociReaderOf(RUNTIME_OCI_CONFIG_TEXT),
    readProcStatus: () => CONFORMING_PROC_STATUS,
  });
  const roots: AdoptionRoots = {
    workspaceStateDir: config.stateDir,
    workspaceCeiling: config.workspaceRoot,
    image: config.sandboxImage,
  };
  return { config, libpod, lifecycle, roots };
}

// A sandbox the driver made earlier: its workspace is pinned in the registry, and its launch material is written unless the test drops it.
// workspaceRoot is the real path the container binds at /workspace.
interface Made {
  readonly sandboxName: string;
  readonly workspaceRoot: string;
}

function madeSandbox(h: Harness, project: string, launch = true): Made {
  const dir = join(h.config.workspaceRoot, project);
  const sandboxName = writeSandboxWorkspaceEntry(h.config, dir);
  if (launch) {
    writeLaunchMaterial(h.config.secretRoot, sandboxName, new TextEncoder().encode("{}"));
  }
  return { sandboxName, workspaceRoot: realpathSync(dir) };
}

// A container whose sandbox retains nothing: no workspace entry and no secret directory.
function strayOf(h: Harness, project: string): Made {
  const dir = join(h.config.workspaceRoot, project);
  mkdirSync(dir, { recursive: true });
  const workspaceRoot = realpathSync(dir);
  return { sandboxName: sandboxNameOfSession(sessionIdOfWorkspace(workspaceRoot)), workspaceRoot };
}

// The raw inspect of a conforming sandbox container, bound the way create binds it. The lifecycle attaches the host evidence to it, as it
// does for a container create starts.
function conformingInspect(id: string, name: string, binding: SandboxBinding): Record<string, unknown> {
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
    ],
  };
}

// Adds the sandbox's container to the engine, bound the way create binds it. The mutate hook changes the inspect to break one property.
function addContainer(h: Harness, made: Made, mutate?: (inspect: Record<string, unknown>) => void): string {
  const id = `c-${made.sandboxName}`;
  const binding = sandboxBindingOf(
    { workspaceRoot: made.workspaceRoot, stateRoot: h.config.sandboxStateRoot, secretRoot: h.config.secretRoot },
    made.sandboxName,
  );
  const inspect = conformingInspect(id, made.sandboxName, binding);
  mutate?.(inspect);
  h.libpod.containers.set(id, { id, labels: realmLabels(made.sandboxName), inspect });
  return id;
}

function secretDirOfSandbox(h: Harness, sandboxName: string): string {
  return secretDirOf(h.config.secretRoot, sandboxName);
}

function isRealmError(code: string): (error: unknown) => boolean {
  return (error: unknown): boolean => error instanceof RealmError && error.code === code;
}

await test("a verified survivor is adopted: it is kept, its secret entries stay, and the result lists it", async () => {
  const h = harnessOf();
  const made = madeSandbox(h, "project-a");
  const containerId = addContainer(h, made);

  const adoption = await h.lifecycle.adoptSurvivors(h.roots);

  assert.deepEqual(adoption, {
    adopted: [{ sandboxName: made.sandboxName, containerId }],
    removed: [],
    secretsRemoved: [],
  });
  assert.deepEqual(h.libpod.removals, []);
  assert.ok(h.libpod.containers.has(containerId));
  assert.notEqual(presentSecretEntries(secretDirOfSandbox(h, made.sandboxName)).length, 0);
  assert.doesNotThrow(() => {
    h.lifecycle.requireSwept();
  });
});

await test("a survivor whose binding cannot be rebuilt is removed with cause no-artifacts, and its removal is proven", async () => {
  const h = harnessOf();
  const made = madeSandbox(h, "project-b", false);
  const containerId = addContainer(h, made);

  const adoption = await h.lifecycle.adoptSurvivors(h.roots);

  assert.deepEqual(adoption, {
    adopted: [],
    removed: [{ containerId, cause: "no-artifacts" }],
    secretsRemoved: [],
  });
  assert.deepEqual(h.libpod.removals, [containerId]);
  assert.equal(h.libpod.containers.has(containerId), false);
});

await test("a container whose sandbox retains nothing is removed with cause no-record", async () => {
  const h = harnessOf();
  const stray = strayOf(h, "project-c");
  const containerId = addContainer(h, stray);

  const adoption = await h.lifecycle.adoptSurvivors(h.roots);

  assert.deepEqual(adoption, {
    adopted: [],
    removed: [{ containerId, cause: "no-record" }],
    secretsRemoved: [],
  });
  assert.equal(h.libpod.containers.has(containerId), false);
});

await test("a survivor that fails one hardening check is removed with that check's cause, and no other container is touched", async () => {
  const h = harnessOf();
  const bad = madeSandbox(h, "project-d");
  const good = madeSandbox(h, "project-e");
  const badId = addContainer(h, bad, (inspect) => {
    (inspect.HostConfig as Record<string, unknown>).Privileged = true;
  });
  const goodId = addContainer(h, good);

  const adoption = await h.lifecycle.adoptSurvivors(h.roots);

  assert.deepEqual(adoption, {
    adopted: [{ sandboxName: good.sandboxName, containerId: goodId }],
    removed: [{ containerId: badId, cause: "privileged" }],
    secretsRemoved: [bad.sandboxName],
  });
  assert.deepEqual(h.libpod.removals, [badId]);
  assert.ok(h.libpod.containers.has(goodId));
  assert.notEqual(presentSecretEntries(secretDirOfSandbox(h, good.sandboxName)).length, 0);
  assert.equal(presentSecretEntries(secretDirOfSandbox(h, bad.sandboxName)).length, 0);
});

await test("an inspect that throws rejects the adoption before any removal, and swept stays false", async () => {
  const h = harnessOf();
  const doomed = madeSandbox(h, "project-f", false);
  const doomedId = addContainer(h, doomed);
  const failing = madeSandbox(h, "project-g");
  const failingId = addContainer(h, failing);
  h.libpod.inspectFails.add(failingId);

  await assert.rejects(h.lifecycle.adoptSurvivors(h.roots), isRealmError("PODMAN_MACHINE_DOWN"));

  assert.deepEqual(h.libpod.removals, []);
  assert.ok(h.libpod.containers.has(doomedId));
  assert.throws(() => {
    h.lifecycle.requireSwept();
  }, isRealmError("REALM_NOT_ACTIVE"));
});

await test("a removal that the proving listing still shows rejects the adoption, and that sandbox's secret entries are kept", async () => {
  const h = harnessOf();
  const stuck = madeSandbox(h, "project-h");
  const stuckId = addContainer(h, stuck, (inspect) => {
    (inspect.HostConfig as Record<string, unknown>).Privileged = true;
  });
  h.libpod.removalRefused.add(stuckId);

  await assert.rejects(h.lifecycle.adoptSurvivors(h.roots), (error: unknown) => {
    return isRealmError("REALM_STOPPING")(error) && error instanceof RealmError && error.causeCode === "CLEANUP_FAILED";
  });

  assert.ok(h.libpod.containers.has(stuckId));
  assert.notEqual(presentSecretEntries(secretDirOfSandbox(h, stuck.sandboxName)).length, 0);
  assert.throws(() => {
    h.lifecycle.requireSwept();
  }, isRealmError("REALM_NOT_ACTIVE"));
});

await test("a sandbox with no adopted container has its secret entries removed only after the presence check", async () => {
  const h = harnessOf();
  const orphan = madeSandbox(h, "project-i");
  const orphanDir = secretDirOfSandbox(h, orphan.sandboxName);
  assert.notEqual(presentSecretEntries(orphanDir).length, 0);

  const adoption = await h.lifecycle.adoptSurvivors(h.roots);

  assert.deepEqual(adoption, { adopted: [], removed: [], secretsRemoved: [orphan.sandboxName] });
  assert.deepEqual(presentSecretEntries(orphanDir), []);
  assert.equal(existsSync(orphanDir), false);
});
