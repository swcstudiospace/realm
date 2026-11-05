// The startup rebuild of the driver's registry (CS-3 and CS-6). DriverLifecycle.adoptSurvivors keeps each container that still conforms,
// but a restarted driver holds none of the state createSandbox keeps in memory for it: the registry entry that names the sandbox's id,
// workspace and container, and the host supervisor, which exited with the previous driver. This module rebuilds both for each adopted
// sandbox before the driver returns from startup. A survivor whose supervisor cannot be respawned is destroyed, so no sandbox is left
// half-registered, and the failure is reported as a RealmError with its catalogue code.
//
// The sandbox id is read from the runtime descriptor that createSandbox wrote in the sandbox's secret directory. The launch material is
// decoded with the gateway's rules, and the supervisor is started through launchSandboxSupervisor, the spawn createSandbox uses.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeRealmError, RealmError } from "../../core/errors.js";
import { sessionOfRealmSandbox } from "../openshell.js";
import { channelPathsOf } from "./channel.js";
import type { ComputeDriver, ComputeDriverConfig, RuntimeHost, SandboxRecord } from "./compute-driver.js";
import { addCleanupNote, SUPERVISOR_NOT_STOPPED } from "./compute-driver-state.js";
import { decodeLaunchAuthentication } from "./isolation/launch.js";
import type { DriverLifecycle } from "./lifecycle.js";
import { refusalScope } from "./refusal.js";
import { LAUNCH_FILE_NAME, secretDirOf } from "./secret-store.js";
import { launchSandboxSupervisor, type SupervisorHandle } from "./supervisor.js";

// One sandbox the adoption kept: its gateway name and its container id.
export interface AdoptedSurvivor {
  readonly sandboxName: string;
  readonly containerId: string;
}

// A sandbox whose supervisor is respawned: the registry record the rebuild gives it, and the supervisor it runs under.
interface RespawnedSandbox {
  readonly record: SandboxRecord;
  readonly supervisor: SupervisorHandle;
}

// What the rebuild writes to and reads from: the driver whose registry it fills, the lifecycle that destroys a survivor it cannot
// rebuild, the driver configuration the supervisor is started from, and the runtime host that spawns it.
export interface RegistryRebuildDeps {
  readonly driver: Pick<ComputeDriver, "adoptSandbox">;
  readonly lifecycle: Pick<DriverLifecycle, "delete">;
  readonly config: ComputeDriverConfig;
  readonly runtime: Pick<RuntimeHost, "spawnSupervisor">;
}

// Rebuilds the registry entry and the supervisor of each adopted sandbox, in the order the adoption listed them. Every survivor is respawned
// before any is registered. A survivor that cannot be respawned is destroyed, the supervisors already started are stopped without being
// registered, and the rebuild rejects with the error. The driver is discarded on a rejected start, and a supervisor left running would keep
// the process alive. Those containers stay, so the next start adopts them again.
export async function rebuildRegistry(deps: RegistryRebuildDeps, adopted: readonly AdoptedSurvivor[]): Promise<void> {
  const respawned: { sandboxName: string; started: RespawnedSandbox }[] = [];
  for (const { sandboxName, containerId } of adopted) {
    try {
      respawned.push({ sandboxName, started: await respawnSupervisor(deps, sandboxName, containerId) });
    } catch (error: unknown) {
      const stops = await Promise.allSettled(respawned.map(({ started }) => started.supervisor.stop()));
      const refusal = await destroySurvivor(deps.lifecycle, sandboxName, error);
      // A supervisor that did not stop is named beside the failure, which it does not replace.
      if (stops.some((stop) => stop.status === "rejected")) {
        addCleanupNote(refusal, [SUPERVISOR_NOT_STOPPED]);
      }
      throw refusal;
    }
  }
  for (const { sandboxName, started } of respawned) {
    deps.driver.adoptSandbox(sandboxName, started.record, started.supervisor);
  }
}

// Starts the host supervisor of one adopted sandbox and returns its registry record. The checks are the ones createSandbox runs before it
// starts a supervisor: the descriptor names the sandbox, the launch material decodes for this gateway, and it carries the SSH host key the
// supervisor binds with. The refusals are logged under CreateSandbox, the RPC whose checks they are, and name no value.
async function respawnSupervisor(
  deps: RegistryRebuildDeps,
  sandboxName: string,
  containerId: string,
): Promise<RespawnedSandbox> {
  const { config } = deps;
  const sessionId = sessionOfRealmSandbox(sandboxName);
  if (sessionId === undefined) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const secretDir = secretDirOf(config.secretRoot, sandboxName);
  const channel = channelPathsOf(secretDir);
  const sandboxId = sandboxIdOf(channel.descriptor);
  const authentication = decodeLaunchAuthentication(
    readSecretFile(join(secretDir, LAUNCH_FILE_NAME)),
    config.gatewayId,
    refusalScope("CreateSandbox", config.refusalLog),
  );
  if (!authentication.supervisor.hasSshHostPrivateKey) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const supervisor = await launchSandboxSupervisor(deps.runtime, {
    binary: config.supervisor.binary,
    gatewayEndpoint: config.supervisor.gatewayEndpoint,
    gatewayCaPath: config.supervisor.gatewayCaPath,
    image: config.sandboxImage,
    sandboxId,
    sandboxName,
    secretDir,
    sshSocketPath: channel.sshSocket,
  });
  // A supervisor that exited before the rebuild registers it is a failed start, as it is for a create.
  if (supervisor.hasExited()) {
    throw makeRealmError("OPENSHELL_START_FAILED");
  }
  // createSandbox keeps the gateway's workspace identifier in memory only, and no artifact retains it. The adopted record therefore carries
  // the session the sandbox name names, which is the key the realm binds the sandbox's workspace by.
  return {
    record: {
      id: sandboxId,
      workspace: sessionId,
      containerName: sandboxName,
      runtimeIdentity: containerId,
      supervisorExited: false,
    },
    supervisor,
  };
}

// Destroys a survivor whose registry entry could not be rebuilt. Resolves with the error the start reports: the cause that refused the
// survivor, or the cleanup's own failure when the destruction did not finish, since a container left standing is the graver fault.
async function destroySurvivor(lifecycle: Pick<DriverLifecycle, "delete">, sandboxName: string, cause: unknown): Promise<RealmError> {
  try {
    await lifecycle.delete(sandboxName);
  } catch (error: unknown) {
    return error instanceof RealmError ? error : makeRealmError("CLEANUP_FAILED");
  }
  return cause instanceof RealmError ? cause : makeRealmError("OPENSHELL_START_FAILED");
}

// The gateway's sandbox id, as the runtime descriptor names it (boundary_id). A file that is missing, is not JSON, or lacks the id refuses
// with SCHEMA_INVALID, and the refusal names no value.
function sandboxIdOf(descriptorPath: string): string {
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(descriptorPath, "utf8"));
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const id = typeof document === "object" && document !== null && "boundary_id" in document ? document.boundary_id : undefined;
  if (typeof id !== "string" || id === "") {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return id;
}

// The bytes of a file in a sandbox's secret directory. A file that cannot be read refuses with SCHEMA_INVALID and names no path.
function readSecretFile(path: string): Buffer {
  try {
    return readFileSync(path);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
}
