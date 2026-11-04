// The create checks of compute-driver.ts: the request against the realm profile, the sandbox's workspace, and its launch
// material. The checks read only. They make no libpod call and write nothing.

import { makeRealmError } from "../../core/errors.js";
import { bindRoot, isInsideRoot } from "../../fs/root.js";
import { isSessionId } from "../../session/paths.js";
import { readWorkspaceEntry, verifyWorkspaceEntry } from "../../session/workspace-registry.js";
import { HARDENING_PROFILE } from "../hardening.js";
import type { ContainerSpec } from "../libpod-client.js";
import { REALM_SANDBOX_NAME_PREFIX } from "../openshell.js";
import { assertSocketPathsFit, channelPathsOf } from "./channel.js";
import { decodeLaunchAuthentication, type LaunchAuthentication } from "./isolation/launch.js";
import { logStageRefusal, refusal, type RefusalCheck, type RefusalScope } from "./refusal.js";
import { CONTAINER_CONTROL_SOCKET, type RuntimeVerificationKey } from "./runtime-channel.js";
import { sandboxBindingOf } from "./sandbox-binding.js";
import { secretDirOf } from "./secret-store.js";
import type { ComputeDriverConfig, DriverSandboxMessage, ResourceQuantityMessage } from "./compute-driver.js";
import { containerNameOf, WORKSPACE_ID_PATTERN } from "./compute-driver-state.js";

const CPU_QUANTITY_PATTERN = /^([0-9]+(?:\.[0-9]+)?)(m)?$/;
const MEMORY_QUANTITY_PATTERN = /^([0-9]+)(Ki|Mi|Gi|Ti)?$/;
const MEMORY_UNIT_BYTES: Readonly<Record<string, number>> = Object.freeze({
  "": 1,
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
});
const NANOCPUS_PER_CORE = 1_000_000_000;

// A validated create: the gateway's sandbox name and id, its workspace, the spec the lifecycle takes, and the launch material
// the driver stores for the sandbox, with its decoded authentication.
export interface CreatePlan {
  readonly sandboxName: string;
  readonly sandboxId: string;
  readonly workspace: string;
  readonly spec: ContainerSpec;
  // The launch material, or undefined when the request carries none. CreateSandbox refuses a plan without it.
  readonly launch: Uint8Array | undefined;
  readonly authentication: LaunchAuthentication | undefined;
}

// The built-in path carries no isolation backend selection: the gateway selects the built-in backend by name, and the
// driver is not told of it. A selection that arrives anyway is refused before any write or libpod call.
function refuseIsolationSelection(selection: unknown, scope: RefusalScope): void {
  if (selection !== undefined && selection !== null) {
    throw refusal(scope, "create.isolation_backend");
  }
}

// Runs one stage of the create path. A SCHEMA_INVALID the stage raises is logged with the stage's check, and the error is rethrown unchanged.
export function atStage<T>(scope: RefusalScope, check: RefusalCheck, work: () => T): T {
  try {
    return work();
  } catch (error: unknown) {
    logStageRefusal(scope, check, error);
    throw error;
  }
}

// The host directory a sandbox mounts at /workspace: the directory its workspace registry entry names, verified now. The sandbox name
// is "realm-" plus the session id. A name without the prefix, or an id outside the safe set, is refused, and so is a name with no
// usable entry. Reads only.
function resolveSandboxWorkspace(config: ComputeDriverConfig, sandboxName: string, scope: RefusalScope): string {
  const sessionId = sandboxName.startsWith(REALM_SANDBOX_NAME_PREFIX) ? sandboxName.slice(REALM_SANDBOX_NAME_PREFIX.length) : "";
  if (!isSessionId(sessionId)) {
    throw refusal(scope, "create.workspace");
  }
  const workspace = registeredWorkspaceOf(config, sessionId);
  if (workspace === undefined) {
    throw refusal(scope, "create.workspace");
  }
  return workspace;
}

// The verified real path of the directory the registry entry for a session id names. Undefined when there is no entry, the entry
// lies outside the ceiling, or the registry read or the verify throws. Reads only.
function registeredWorkspaceOf(config: ComputeDriverConfig, sessionId: string): string | undefined {
  try {
    const entry = readWorkspaceEntry(config.stateDir, sessionId);
    if (entry === null || !isInsideRoot(bindRoot(config.workspaceRoot), entry.workspaceRoot)) {
      return undefined;
    }
    return verifyWorkspaceEntry(entry).realPath;
  } catch {
    return undefined;
  }
}

// Checks a create request against the realm profile and returns the lifecycle spec and the launch material when it carries any.
// Every refusal is SCHEMA_INVALID, logged with its RPC and check, and no libpod call is made. Launch material that is present must
// decode for this driver's gateway, on both RPCs, before any write. An absent bundle is not refused here: CreateSandbox refuses it
// (createSandbox), so ValidateSandboxCreate can run before the gateway mints the bundle.
export function planCreate(
  sandbox: DriverSandboxMessage | null | undefined,
  config: ComputeDriverConfig,
  scope: RefusalScope,
): CreatePlan {
  if (sandbox === null || sandbox === undefined) {
    throw refusal(scope, "create.sandbox");
  }
  const sandboxId = sandbox.id ?? "";
  const sandboxName = sandbox.name ?? "";
  const workspace = sandbox.workspace ?? "";
  const containerName = sandboxName === "" ? undefined : containerNameOf(sandboxName);
  if (sandboxId === "" || containerName === undefined) {
    throw refusal(scope, "create.identity");
  }
  if (!WORKSPACE_ID_PATTERN.test(workspace)) {
    throw refusal(scope, "create.workspace");
  }
  const spec = sandbox.spec;
  const template = spec?.template;
  if (spec === null || spec === undefined || template === null || template === undefined) {
    throw refusal(scope, "create.spec");
  }
  // The image must be the configured digest exactly. A tag, or any other digest, is refused.
  if (template.image !== config.sandboxImage) {
    throw refusal(scope, "create.image");
  }
  const gpu = spec.resource_requirements?.gpu;
  if (gpu !== undefined && gpu !== null) {
    throw refusal(scope, "create.gpu");
  }
  checkResources(template.resources, scope);
  // The container is built from the realm profile alone. Caller-supplied platform or driver config could reach the
  // network, mounts or capabilities, so it is refused. So are environment and a user-namespace request.
  if (!structIsEmpty(template.platform_config) || !structIsEmpty(template.driver_config)) {
    throw refusal(scope, "create.runtime_config");
  }
  if (template.user_namespaces === true) {
    throw refusal(scope, "create.user_namespaces");
  }
  refuseIsolationSelection(spec.isolation_backend, scope);
  if (hasEntries(spec.environment) || hasEntries(template.environment)) {
    throw refusal(scope, "create.environment");
  }
  // The runtime is PID 1 whatever the argv, so an empty argv is not refused. An empty argument is still refused, as at HEAD.
  if ((spec.command ?? []).some((argument) => argument === "")) {
    throw refusal(scope, "create.command");
  }
  const launch = launchMaterialOf(spec.launch_authentication);
  const authentication = launch === undefined ? undefined : decodeLaunchAuthentication(launch, config.gatewayId, scope);
  // The control socket and the SSH socket must fit a unix socket address on the host, and the control socket in the container.
  // Checked before any write or libpod call.
  const channel = atStage(scope, "create.identity", () => channelPathsOf(secretDirOf(config.secretRoot, containerName)));
  atStage(scope, "create.socket_path", () => {
    assertSocketPathsFit([channel.controlSocket, channel.sshSocket, CONTAINER_CONTROL_SOCKET]);
  });
  // The container's mounts are the sandbox binding, which the lifecycle verifies the container against. Its workspace is the directory
  // the registry entry for this sandbox names, verified now.
  const workspaceDir = resolveSandboxWorkspace(config, sandboxName, scope);
  const binding = atStage(scope, "create.identity", () =>
    sandboxBindingOf(
      { workspaceRoot: workspaceDir, stateRoot: config.sandboxStateRoot, secretRoot: config.secretRoot },
      containerName,
    ),
  );
  return {
    sandboxName,
    sandboxId,
    workspace,
    launch,
    authentication,
    spec: {
      sandboxName: containerName,
      image: template.image,
      workspaceDir: binding.workspaceRoot,
      stateDir: binding.stateDir,
      channelDir: binding.channelDir,
    },
  };
}

// The launch material a request carries, or undefined when it carries none. proto3 bytes arrive empty when unset, so an empty
// buffer is no material.
function launchMaterialOf(value: Uint8Array | null | undefined): Uint8Array | undefined {
  return value === undefined || value === null || value.length === 0 ? undefined : value;
}

// The gateway's verification keys as the runtime's bootstrap names them: each PEM as text. A key that is not UTF-8 is refused.
export function runtimeKeysOf(authentication: LaunchAuthentication): RuntimeVerificationKey[] {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return authentication.verificationKeys.map((key) => {
    try {
      return { keyId: key.keyId, publicKeyPem: decoder.decode(key.publicKeyPem) };
    } catch {
      throw makeRealmError("SCHEMA_INVALID");
    }
  });
}

// Each non-empty CPU and memory value must equal the realm profile. An empty value means the request did not set it.
function checkResources(resources: ResourceQuantityMessage | null | undefined, scope: RefusalScope): void {
  for (const cpu of [resources?.cpu_request, resources?.cpu_limit]) {
    if (cpu !== undefined && cpu !== "" && cpuNanos(cpu) !== HARDENING_PROFILE.nanoCpus) {
      throw refusal(scope, "create.resources");
    }
  }
  for (const memory of [resources?.memory_request, resources?.memory_limit]) {
    if (memory !== undefined && memory !== "" && memoryBytes(memory) !== HARDENING_PROFILE.memoryBytes) {
      throw refusal(scope, "create.resources");
    }
  }
}

// A Kubernetes-style CPU quantity ("2", "0.5", "2000m") as nanocpus. An unparseable value gives undefined, which never
// matches the profile.
function cpuNanos(quantity: string): number | undefined {
  const match = CPU_QUANTITY_PATTERN.exec(quantity);
  if (match === null) {
    return undefined;
  }
  const cores = Number(match[1]) * (match[2] === "m" ? 0.001 : 1);
  return cores * NANOCPUS_PER_CORE;
}

// A memory quantity ("1Gi", "1024Mi", "1073741824") as bytes. An unparseable value gives undefined.
function memoryBytes(quantity: string): number | undefined {
  const match = MEMORY_QUANTITY_PATTERN.exec(quantity);
  if (match === null) {
    return undefined;
  }
  const unit = MEMORY_UNIT_BYTES[match[2] ?? ""];
  return unit === undefined ? undefined : Number(match[1]) * unit;
}

// google.protobuf.Struct as the loader delivers it: {fields: {...}}. An unset Struct is null.
function structIsEmpty(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value !== "object") {
    return false;
  }
  const fields: unknown = "fields" in value ? value.fields : value;
  return fields === null || fields === undefined || (typeof fields === "object" && Object.keys(fields).length === 0);
}

function hasEntries(map: Readonly<Record<string, string>> | null | undefined): boolean {
  return map !== null && map !== undefined && Object.keys(map).length > 0;
}
