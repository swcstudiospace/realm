// The realm's implementation of the OpenShell ComputeDriver gRPC service (phase 9.4, PRD-DRV-01..03).
//
// Create is the only path to a container. Before it reaches the lifecycle, the request is checked against the realm
// profile: the digest-pinned image, the portable CPU and memory limits, no GPU, no platform or driver config, no
// environment, no user-namespace request, an isolation backend selection only when it names the configured backend over a
// unix socket (see isolationSelectionOf), and a sandbox name that passes the container-name rule
// once the realm prefix is added. The gateway's launch material is required and must decode for this driver's gateway
// (launch.ts). Any mismatch is refused with SCHEMA_INVALID, logged with the RPC and the check that refused (refusal.ts), and no
// libpod call is made. An empty argv is accepted and creates
// an idle sandbox; the command is not forwarded before phase 9.5. A create that passes prepares the directories the lifecycle
// requires: the workspace, by the same rule EnsureWorkspace uses, and a new state directory. It then stores the launch material
// in a new secret directory (secret-store.ts), outside the state root and the workspace. If the lifecycle then refuses, the state
// directory and the launch material this call made are removed. The lifecycle (DriverLifecycle, phase 9.3) then builds, starts
// and verifies the container.
//
// The gateway names a sandbox without the realm prefix, and the container runs under that name with the prefix added.
// A name that already has the prefix is unchanged. The driver keeps a registry keyed by the gateway's name, holding the
// gateway's sandbox id, its workspace, the container name and the isolation backend the create selected, if any. CreateSandbox
// fills it and DeleteSandbox clears it. The startup sweep removes every realm container before the driver accepts
// requests, so no sandbox survives a restart without a registry entry. Observed state comes from the labelled
// containers, and every snapshot carries the gateway's name. StopSandbox and StartSandbox refuse with the
// transition code, which maps to FAILED_PRECONDITION (PD-08).
// AuthenticateSandbox is not implemented: the driver does not advertise sandbox authentication. Attach verifies a bearer
// with the verification keys of the sandbox's own launch material (launchVerifierOf).

import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmdirSync, rmSync, type Stats } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ServerUnaryCall,
  type ServerWritableStream,
  type sendUnaryData,
  type ServiceDefinition,
  type UntypedServiceImplementation,
} from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { makeRealmError, RealmError } from "../../core/errors.js";
import { HARDENING_PROFILE } from "../hardening.js";
import type { ContainerSpec, LibpodClient, LibpodInspect } from "../libpod-client.js";
import { CONTAINER_ID_PATTERN } from "../libpod-routes.js";
import {
  isRealmSandboxName,
  OPENSHELL_ISOLATION_ROLE_LABEL_KEY,
  OPENSHELL_SANDBOX_NAME_LABEL_KEY,
  OPENSHELL_SANDBOX_ROLE_VALUE,
  REALM_SANDBOX_NAME_PREFIX,
} from "../openshell.js";
import { DRIVER_ADMISSION_ACKNOWLEDGEMENT } from "./admission.js";
import { driverFailureOf, DriverStatusError, driverNotFound, driverUnimplemented, toServerError } from "./grpc-status.js";
import type { DriverLifecycle } from "./lifecycle.js";
import { SupervisorBearerVerifier } from "./isolation/bearer.js";
import type { BoundaryRegistry, ProvisionedResource } from "./isolation/boundary.js";
import { decodeLaunchAuthentication } from "./isolation/launch.js";
import { refusal, refusalScope, type RefusalLog, type RefusalScope } from "./refusal.js";
import { GATEWAY_ID_PATTERN } from "../gateway-config.js";
import { readLaunchMaterial, removeSandboxSecrets, secretDirExists, writeLaunchMaterial } from "./secret-store.js";

export const COMPUTE_DRIVER_SERVICE_NAME = "openshell.compute.v1.ComputeDriver";
const PROTO_FILE = "compute_driver.proto";
const PROTO_DIRECTORY = join("src", "runtime", "driver", "proto");
// The extension capabilities this driver declares. The isolation backend capability is advertised because this driver serves the
// one backend its configuration names.
const SUPPORTED_CAPABILITIES: readonly string[] = Object.freeze([
  "openshell.compute.contract",
  "openshell.compute.launch-authentication",
  "openshell.compute.isolation-backend",
]);
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
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
const DEFAULT_WATCH_INTERVAL_MS = 1000;

// The gateway accepts an implementation version of 1 to 128 bytes that is not blank and holds no control characters
// (openshell-core extension_protocol validate_text). The driver applies the same rule, so an invalid value fails here.
const MAX_IMPLEMENTATION_VERSION_BYTES = 128;
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;

export function isImplementationVersion(value: string): boolean {
  return (
    value.trim() !== "" &&
    Buffer.byteLength(value, "utf8") <= MAX_IMPLEMENTATION_VERSION_BYTES &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

export interface ComputeDriverConfig {
  // The driver's name as the gateway's [openshell.drivers.<name>] table names it.
  readonly driverName: string;
  // The one digest-pinned sandbox image this driver creates.
  readonly sandboxImage: string;
  // Absolute root under which each sandbox's state directory sits, at <root>/<containerName>.
  readonly sandboxStateRoot: string;
  // Absolute root under which each sandbox's secret directory sits, at <root>/<containerName>. It holds the launch material.
  readonly secretRoot: string;
  // Absolute root under which each workspace directory sits, at <root>/<workspace>.
  readonly workspaceRoot: string;
  // The build version advertised as the extension implementation version. The gateway refuses an empty or invalid value.
  readonly implementationVersion: string;
  // The gateway this driver serves. Launch material issued for another gateway is refused, and bearers are checked against it.
  readonly gatewayId: string;
  // The one isolation backend this driver serves, by the name the gateway selects it with. A create that selects any other name
  // is refused.
  readonly isolationBackendName: string;
  // Receives each refusal line (refusal.ts). Stderr when absent.
  readonly refusalLog?: RefusalLog;
}

export interface ComputeDriverDeps {
  readonly lifecycle: Pick<DriverLifecycle, "create" | "delete">;
  readonly libpod: Pick<LibpodClient, "inspectContainer" | "listContainersByLabel">;
  // Boundary handles of a deleted sandbox are invalidated here (PRD-ISO-06).
  readonly boundaries: Pick<BoundaryRegistry, "invalidateAll">;
}

// The message shapes the driver reads and writes. proto-loader delivers keepCase field names. It runs with defaults, so an
// unset message field is null and an unset string is "".
interface PeerMetadataMessage {
  readonly required_capabilities?: readonly string[];
}
export interface GetCapabilitiesRequest {
  readonly gateway?: PeerMetadataMessage | null;
}
interface ResourceQuantityMessage {
  readonly cpu_request?: string;
  readonly cpu_limit?: string;
  readonly memory_request?: string;
  readonly memory_limit?: string;
}
interface SandboxTemplateMessage {
  readonly image?: string;
  readonly environment?: Readonly<Record<string, string>> | null;
  readonly resources?: ResourceQuantityMessage | null;
  readonly platform_config?: unknown;
  readonly driver_config?: unknown;
  readonly user_namespaces?: boolean | null;
}
interface SandboxSpecMessage {
  readonly environment?: Readonly<Record<string, string>> | null;
  readonly template?: SandboxTemplateMessage | null;
  readonly resource_requirements?: { readonly gpu?: unknown } | null;
  readonly command?: readonly string[];
  readonly isolation_backend?: unknown;
  // The gateway-created launch credentials, as the bytes of the gateway's JSON encoding. Required for every create.
  readonly launch_authentication?: Uint8Array | null;
}
export interface DriverSandboxMessage {
  readonly id?: string;
  readonly name?: string;
  readonly workspace?: string;
  readonly spec?: SandboxSpecMessage | null;
}
interface SandboxIdentityRequest {
  readonly sandbox_id?: string;
  readonly name?: string;
}
interface WorkspaceRequest {
  readonly workspace?: string;
}

// The sandbox snapshot the driver returns. The gateway derives the public phase from its conditions.
export interface DriverSandboxOut {
  readonly id: string;
  readonly name: string;
  readonly namespace: string;
  readonly workspace: string;
  readonly status: {
    readonly name: string;
    readonly instance_id: string;
    readonly agent_fd: string;
    readonly sandbox_fd: string;
    readonly conditions: readonly {
      readonly type: string;
      readonly status: string;
      readonly reason: string;
      readonly message: string;
    }[];
    readonly deleting: boolean;
  };
}

interface SandboxRecord {
  readonly id: string;
  readonly workspace: string;
  // The container name the sandbox runs under: the gateway's name with the realm prefix added when it lacks it.
  readonly containerName: string;
  // The identity the runtime reported when the container was created. It is the resource a boundary binds to.
  readonly runtimeIdentity: string;
  // The isolation backend the create selected, or undefined when it selected none.
  readonly isolationBackend: string | undefined;
}

// A validated create: the gateway's sandbox name and id, its workspace, the spec the lifecycle takes, and the launch material
// the driver stores for the sandbox, and the isolation backend the create selected.
interface CreatePlan {
  readonly sandboxName: string;
  readonly sandboxId: string;
  readonly workspace: string;
  readonly spec: ContainerSpec;
  readonly launch: Uint8Array;
  readonly isolationBackend: string | undefined;
}

// The service's method map, loaded from the vendored protos with the pinned loader. The protos are read from disk at
// startup. A missing or unreadable proto is a broken install, so it throws a plain error rather than a catalogue code.
export function loadComputeDriverService(): ServiceDefinition {
  const packageDefinition = protoLoader.loadSync(PROTO_FILE, {
    includeDirs: [protoIncludeDirectory()],
    keepCase: true,
    defaults: true,
    oneofs: true,
    longs: String,
    enums: String,
  });
  const service = packageDefinition[COMPUTE_DRIVER_SERVICE_NAME];
  if (service === undefined || !("GetCapabilities" in service)) {
    throw new Error("compute driver service is missing from the vendored protos");
  }
  return service;
}

// The directory that holds the vendored protos. The source tree and the built tree both sit under the package root, so
// the lookup walks up from this module until it finds the proto file. This keeps the path correct in dist/ and src/.
export function protoIncludeDirectory(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, PROTO_DIRECTORY);
    if (existsSync(join(candidate, PROTO_FILE))) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("compute driver protos are missing from the installed package");
    }
    dir = parent;
  }
}

// The realm's driver. Each method is one RPC. A method refuses by throwing a RealmError, or a DriverStatusError for a
// status with no catalogue code. The binding maps either one to a gRPC status.
export class ComputeDriver {
  private readonly config: ComputeDriverConfig;
  private readonly deps: ComputeDriverDeps;
  private readonly registry = new Map<string, SandboxRecord>();

  constructor(config: ComputeDriverConfig, deps: ComputeDriverDeps) {
    if (
      !isAbsolute(config.sandboxStateRoot) ||
      !isAbsolute(config.secretRoot) ||
      !isAbsolute(config.workspaceRoot) ||
      !isImplementationVersion(config.implementationVersion) ||
      !GATEWAY_ID_PATTERN.test(config.gatewayId)
    ) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    assertSecretRootApart(config.secretRoot, config.workspaceRoot);
    this.config = config;
    this.deps = deps;
  }

  getCapabilities(request: GetCapabilitiesRequest): Record<string, unknown> {
    const required = request.gateway?.required_capabilities ?? [];
    if (required.some((capability) => !SUPPORTED_CAPABILITIES.includes(capability))) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return {
      driver_name: this.config.driverName,
      default_image: this.config.sandboxImage,
      gateway_manages_lifecycle: false,
      supports_sandbox_authentication: false,
      driver_reports_runtime_readiness: false,
      resource_capabilities: {
        cpu: { limit_supported: true },
        memory: { limit_supported: true },
        gpu: { default_selection_supported: false, count_selection_supported: false },
      },
      rootfs_tar_max_bytes: 0,
      extension: {
        protocol_version: { major: 1, minor: 0 },
        implementation_name: "realm/podman",
        implementation_version: this.config.implementationVersion,
        supported_capabilities: [...SUPPORTED_CAPABILITIES],
        required_capabilities: [],
      },
      resource_admission_policy: DRIVER_ADMISSION_ACKNOWLEDGEMENT,
    };
  }

  // Runs every create check, the launch material included. Makes no libpod call and writes nothing.
  validateSandboxCreate(sandbox: DriverSandboxMessage | null | undefined): Record<string, never> {
    planCreate(sandbox, this.config, this.scopeOf("ValidateSandboxCreate"));
    return {};
  }

  // An existing state or secret directory is refused before anything is prepared, so that refusal creates nothing. Then the
  // workspace and the new state directory are prepared, and the launch material is stored. Only then does the lifecycle run.
  // If the store or the lifecycle refuses, the state directory and the launch material this call made are removed and the
  // original error is rethrown. The workspace is left in place.
  async createSandbox(sandbox: DriverSandboxMessage | null | undefined): Promise<{ runtime_identity: string }> {
    const plan = planCreate(sandbox, this.config, this.scopeOf("CreateSandbox"));
    assertStateDirAbsent(plan.spec.stateDir);
    if (secretDirExists(this.config.secretRoot, plan.spec.sandboxName)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    this.prepareWorkspace(plan.workspace);
    mkdirOrRefuse(plan.spec.stateDir);
    try {
      writeLaunchMaterial(this.config.secretRoot, plan.spec.sandboxName, plan.launch);
    } catch (error: unknown) {
      const stateRemoved = removeStateDir(plan.spec.stateDir);
      if (!stateRemoved && error instanceof RealmError) {
        error.message = `${error.message} Cleanup failed: the sandbox state directory was left in place.`;
      }
      throw error;
    }
    let containerId: string;
    try {
      containerId = await this.deps.lifecycle.create(plan.spec);
    } catch (error: unknown) {
      const stateRemoved = removeStateDir(plan.spec.stateDir);
      const materialRemoved = removeLaunchMaterial(this.config.secretRoot, plan.spec.sandboxName);
      if (!(stateRemoved && materialRemoved) && error instanceof RealmError) {
        error.message = `${error.message} Cleanup failed: the sandbox state directory or launch material was left in place.`;
      }
      throw error;
    }
    this.registry.set(plan.sandboxName, {
      id: plan.sandboxId,
      workspace: plan.workspace,
      containerName: plan.spec.sandboxName,
      runtimeIdentity: containerId,
      isolationBackend: plan.isolationBackend,
    });
    return { runtime_identity: containerId };
  }

  async getSandbox(request: SandboxIdentityRequest): Promise<{ sandbox: DriverSandboxOut }> {
    const name = this.nameOf(request);
    const sandbox = name === undefined ? undefined : await this.snapshotOf(name);
    if (sandbox === undefined) {
      throw new DriverStatusError(driverNotFound("sandbox not found"));
    }
    return { sandbox };
  }

  // The resource the driver holds for a gateway sandbox id: the driver's name for the sandbox and its runtime identity. It is
  // synchronous, so the isolation backend binds or checks a boundary handle with no await in between. An unknown id is undefined.
  provisionedResource(sandboxId: string): ProvisionedResource | undefined {
    const name = this.nameOf({ sandbox_id: sandboxId });
    const record = name === undefined ? undefined : this.registry.get(name);
    if (name === undefined || record === undefined) {
      return undefined;
    }
    return { sandboxName: name, resourceId: record.runtimeIdentity };
  }

  // The isolation backend a sandbox's create selected, by the gateway's sandbox id. Undefined when the create selected none or the
  // driver holds no such sandbox. The isolation backend reports the binding through this.
  isolationBackendOf(sandboxId: string): string | undefined {
    const name = this.nameOf({ sandbox_id: sandboxId });
    const record = name === undefined ? undefined : this.registry.get(name);
    return record?.isolationBackend;
  }

  // The verifier of one sandbox's supervisor bearers, built from the launch material the driver stored at create. Undefined when
  // the driver holds no such sandbox or the sandbox holds no launch material. A stored body that no longer validates throws.
  launchVerifierOf(sandboxId: string): SupervisorBearerVerifier | undefined {
    const name = this.nameOf({ sandbox_id: sandboxId });
    const record = name === undefined ? undefined : this.registry.get(name);
    if (record === undefined) {
      return undefined;
    }
    const body = readLaunchMaterial(this.config.secretRoot, record.containerName);
    if (body === undefined) {
      return undefined;
    }
    const launch = decodeLaunchAuthentication(body, this.config.gatewayId, this.scopeOf("BearerVerification"));
    return new SupervisorBearerVerifier(launch.verificationKeys, launch.gatewayId);
  }

  async listSandboxes(): Promise<{ sandboxes: DriverSandboxOut[] }> {
    const snapshots = await this.snapshotAll();
    return { sandboxes: [...snapshots.values()] };
  }

  // Idempotent: a sandbox that is already gone deletes nothing and succeeds. A name whose container a different
  // registered sandbox holds deletes nothing, so a request never removes a sandbox it does not name. The lifecycle removes
  // the sandbox's state directory and its launch material.
  async deleteSandbox(request: SandboxIdentityRequest): Promise<{ deleted: boolean }> {
    const name = this.nameOf(request);
    if (name === undefined) {
      return { deleted: false };
    }
    // Every handle of the sandbox is invalid after delete, even when no container is removed.
    this.deps.boundaries.invalidateAll(name);
    const containerName = containerNameOf(name);
    if (containerName === undefined || this.heldByAnotherSandbox(name, containerName)) {
      return { deleted: false };
    }
    const existed = (await this.deps.libpod.inspectContainer(containerName)) !== null;
    await this.deps.lifecycle.delete(containerName);
    this.registry.delete(name);
    // A handle bound while the container was being removed is invalid once the record is gone.
    this.deps.boundaries.invalidateAll(name);
    return { deleted: existed };
  }

  // PD-08: stop and start are refused with the transition code (FAILED_PRECONDITION). Nothing is read or changed.
  stopSandbox(): never {
    throw makeRealmError("REALM_INVALID_TRANSITION");
  }

  startSandbox(): never {
    throw makeRealmError("REALM_INVALID_TRANSITION");
  }

  ensureWorkspace(request: WorkspaceRequest): Record<string, never> {
    this.prepareWorkspace(request.workspace);
    return {};
  }

  // Removes only an empty workspace directory. A workspace that still holds files may be the user's own data, so it is
  // left alone and the refusal uses the transition code (FAILED_PRECONDITION).
  deleteWorkspace(request: WorkspaceRequest): Record<string, never> {
    const dir = this.workspaceDir(request.workspace);
    const stat = statOrNull(dir);
    if (stat === null) {
      return {};
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    this.assertInsideRoot(dir);
    if (readdirSync(dir).length > 0) {
      throw makeRealmError("REALM_INVALID_TRANSITION");
    }
    rmdirOrRefuse(dir);
    return {};
  }

  // Every sandbox that has both a registry entry and a labelled container, keyed by the gateway's name.
  async snapshotAll(): Promise<Map<string, DriverSandboxOut>> {
    const listed = await this.deps.libpod.listContainersByLabel(
      OPENSHELL_ISOLATION_ROLE_LABEL_KEY,
      OPENSHELL_SANDBOX_ROLE_VALUE,
    );
    const labelled = new Set<string>();
    for (const container of listed) {
      const name = container.labels?.[OPENSHELL_SANDBOX_NAME_LABEL_KEY];
      if (name !== undefined) {
        labelled.add(name);
      }
    }
    const snapshots = new Map<string, DriverSandboxOut>();
    for (const [name, record] of [...this.registry]) {
      if (!labelled.has(record.containerName)) {
        continue;
      }
      const sandbox = await this.snapshotOf(name);
      if (sandbox !== undefined) {
        snapshots.set(name, sandbox);
      }
    }
    return snapshots;
  }

  // The snapshot of one sandbox, named by the gateway. The container is inspected under its own name.
  private async snapshotOf(name: string): Promise<DriverSandboxOut | undefined> {
    const record = this.registry.get(name);
    if (record === undefined) {
      return undefined;
    }
    const inspect = await this.deps.libpod.inspectContainer(record.containerName);
    if (inspect === null) {
      return undefined;
    }
    return sandboxOut(name, record, inspect);
  }

  // The gateway's sandbox name for a request. A name the request gives is used as is. Otherwise the id is looked up in
  // the registry. A request with neither is malformed.
  private nameOf(request: SandboxIdentityRequest): string | undefined {
    if (request.name !== undefined && request.name !== "") {
      return request.name;
    }
    if (request.sandbox_id === undefined || request.sandbox_id === "") {
      throw makeRealmError("SCHEMA_INVALID");
    }
    for (const [name, record] of this.registry) {
      if (record.id === request.sandbox_id) {
        return name;
      }
    }
    return undefined;
  }

  // True when a registered sandbox other than `name` runs under `containerName`. Such a container is that sandbox's.
  private heldByAnotherSandbox(name: string, containerName: string): boolean {
    for (const [registered, record] of this.registry) {
      if (registered !== name && record.containerName === containerName) {
        return true;
      }
    }
    return false;
  }

  private workspaceDir(workspace: string | undefined): string {
    if (workspace === undefined || !WORKSPACE_ID_PATTERN.test(workspace)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return join(this.config.workspaceRoot, workspace);
  }

  // The one workspace rule, shared by EnsureWorkspace and CreateSandbox: the directory is created at 0700 when absent,
  // a symbolic link or non-directory is refused, and the result must resolve inside the root.
  private prepareWorkspace(workspace: string | undefined): void {
    const dir = this.workspaceDir(workspace);
    const stat = statOrNull(dir);
    if (stat === null) {
      mkdirOrRefuse(dir);
    } else if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    this.assertInsideRoot(dir);
  }

  // A workspace directory must resolve, through any symbolic link, to a path strictly inside the configured root.
  private assertInsideRoot(dir: string): void {
    const root = realpathOrRefuse(this.config.workspaceRoot);
    const real = realpathOrRefuse(dir);
    if (!isStrictlyInside(root, real)) {
      throw makeRealmError("PATH_ESCAPE");
    }
  }

  // The refusal scope of one RPC: its name, and the sink this driver was configured with.
  private scopeOf(rpc: "ValidateSandboxCreate" | "CreateSandbox" | "BearerVerification"): RefusalScope {
    return refusalScope(rpc, this.config.refusalLog);
  }
}

// The container name for a gateway sandbox name: the realm prefix is added when the name lacks it. Undefined when the
// result fails the container-name rule, which also bounds the length, so the caller refuses it.
function containerNameOf(sandboxName: string): string | undefined {
  const name = isRealmSandboxName(sandboxName) ? sandboxName : `${REALM_SANDBOX_NAME_PREFIX}${sandboxName}`;
  return CONTAINER_ID_PATTERN.test(name) ? name : undefined;
}

// The endpoint field proto-loader sets for an isolation backend registration (oneofs: true delivers the set field's name).
interface IsolationBackendSelectionMessage {
  readonly name?: string;
  readonly endpoint?: string;
}

// The isolation backend a create selects. An unset selection selects none. A selection is accepted only when its name is the
// configured backend and its endpoint is a unix socket, the one transport the driver's isolation socket serves. Any other selection
// is refused with SCHEMA_INVALID before any write or libpod call. The selected name is returned.
function isolationSelectionOf(selection: unknown, configuredName: string, scope: RefusalScope): string | undefined {
  if (selection === undefined || selection === null) {
    return undefined;
  }
  const { name, endpoint } = selection as IsolationBackendSelectionMessage;
  if (name !== configuredName || endpoint !== "unix_socket_path") {
    throw refusal(scope, "create.isolation_backend");
  }
  return name;
}

// Checks a create request against the realm profile and returns the lifecycle spec and the launch material. Every refusal is
// SCHEMA_INVALID, logged with its RPC and check, and no libpod call is made. The launch material is required: the driver advertises
// openshell.compute.launch-authentication, so every launch carries the gateway's bundle, and Attach can verify a bearer only
// with keys from that bundle. A bundle that does not decode for this driver's gateway is refused here, before any write.
function planCreate(
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
  // network, mounts or capabilities, so it is refused. So are environment and a user-namespace request. An isolation backend
  // selection is accepted only when it names the configured backend (isolationSelectionOf).
  if (!structIsEmpty(template.platform_config) || !structIsEmpty(template.driver_config)) {
    throw refusal(scope, "create.runtime_config");
  }
  if (template.user_namespaces === true) {
    throw refusal(scope, "create.user_namespaces");
  }
  const isolationBackend = isolationSelectionOf(spec.isolation_backend, config.isolationBackendName, scope);
  if (hasEntries(spec.environment) || hasEntries(template.environment)) {
    throw refusal(scope, "create.environment");
  }
  // An empty argv is accepted and creates an idle sandbox. An argument that is an empty string is still refused.
  if ((spec.command ?? []).some((argument) => argument === "")) {
    throw refusal(scope, "create.command");
  }
  const launch = spec.launch_authentication;
  if (launch === undefined || launch === null || launch.length === 0) {
    throw refusal(scope, "create.launch_authentication");
  }
  decodeLaunchAuthentication(launch, config.gatewayId, scope);
  return {
    sandboxName,
    sandboxId,
    workspace,
    launch,
    isolationBackend,
    spec: {
      sandboxName: containerName,
      image: template.image,
      workspaceDir: join(config.workspaceRoot, workspace),
      stateDir: join(config.sandboxStateRoot, containerName),
    },
  };
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

// The observed state of one sandbox, named by the gateway. Ready is True only while the container is running.
function sandboxOut(name: string, record: SandboxRecord, inspect: LibpodInspect): DriverSandboxOut {
  const state = runStateOf(inspect);
  const instance: unknown = inspect["Id"];
  return {
    id: record.id,
    name,
    namespace: "",
    workspace: record.workspace,
    status: {
      name,
      instance_id: typeof instance === "string" ? instance : "",
      agent_fd: "",
      sandbox_fd: "",
      conditions: [
        {
          type: "Ready",
          status: state === "running" ? "True" : "False",
          reason: state,
          message: "",
        },
      ],
      deleting: false,
    },
  };
}

function runStateOf(inspect: LibpodInspect): string {
  const state: unknown = inspect["State"];
  if (typeof state === "object" && state !== null && "Status" in state && typeof state.Status === "string") {
    return state.Status;
  }
  return "unknown";
}

// True when the child is a strict descendant of the parent directory. Both paths are already resolved.
function isStrictlyInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

// The filesystem helpers. A failure is a catalogue code or SCHEMA_INVALID. The raw error is never copied.
function statOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// A new state directory must not exist yet, and its root must. Both are checked before anything is created, so a
// refusal here leaves the disk as it was. A leftover directory is never reused.
function assertStateDirAbsent(stateDir: string): void {
  realpathOrRefuse(dirname(stateDir));
  if (statOrNull(stateDir) !== null) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

function mkdirOrRefuse(dir: string): void {
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// Removes the state directory a create made. Returns false when the removal failed, and the directory is left in place.
function removeStateDir(dir: string): boolean {
  try {
    rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// Removes the launch material a create stored. Returns false when the removal failed, and the material is left in place.
function removeLaunchMaterial(secretRoot: string, sandboxName: string): boolean {
  try {
    removeSandboxSecrets(secretRoot, sandboxName);
    return true;
  } catch {
    return false;
  }
}

function rmdirOrRefuse(dir: string): void {
  try {
    rmdirSync(dir);
  } catch {
    throw makeRealmError("CLEANUP_FAILED");
  }
}

// The secret root and the workspace root must not hold one another. The workspace is bound into the sandbox read-write, so launch
// material under it would reach the workload. Both are compared as resolved real paths.
function assertSecretRootApart(secretRoot: string, workspaceRoot: string): void {
  const secret = resolvedPathOf(secretRoot);
  const workspace = resolvedPathOf(workspaceRoot);
  if (secret === workspace || isStrictlyInside(secret, workspace) || isStrictlyInside(workspace, secret)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// The real location of a path that may not exist yet: the nearest existing ancestor, resolved through any symbolic link, with the
// rest of the path appended. A path that cannot be resolved is refused.
function resolvedPathOf(path: string): string {
  const missing: string[] = [];
  let current = path;
  for (;;) {
    try {
      return join(realpathSync(current), ...missing);
    } catch (error: unknown) {
      const parent = dirname(current);
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT") || parent === current) {
        throw makeRealmError("SCHEMA_INVALID");
      }
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

function realpathOrRefuse(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

function hasEntries(map: Readonly<Record<string, string>> | null | undefined): boolean {
  return map !== null && map !== undefined && Object.keys(map).length > 0;
}

// Wraps a promise-returning RPC as a unary handler. A thrown value becomes its gRPC status and nothing else.
function unary<Req, Res>(
  handle: (request: Req) => Promise<Res>,
): (call: ServerUnaryCall<Req, Res>, callback: sendUnaryData<Res>) => void {
  return (call, callback) => {
    handle(call.request).then(
      (response) => {
        callback(null, response);
      },
      (error: unknown) => {
        callback(toServerError(driverFailureOf(error)));
      },
    );
  };
}

// Wraps a synchronous RPC the same way.
function sync<Req, Res>(
  handle: (request: Req) => Res,
): (call: ServerUnaryCall<Req, Res>, callback: sendUnaryData<Res>) => void {
  return (call, callback) => {
    try {
      callback(null, handle(call.request));
    } catch (error: unknown) {
      callback(toServerError(driverFailureOf(error)));
    }
  };
}

interface WatchedSandbox {
  readonly json: string;
  readonly id: string;
}

// The stream of observations. It sends every sandbox on connect, then polls the labelled containers and sends each
// change. A sandbox that disappears is sent as deleted. Cancellation, from the client or from the stream ending, aborts
// the signal, which stops the timer and makes any poll still in flight send nothing more.
function watchSandboxes(
  driver: ComputeDriver,
  intervalMs: number,
): (call: ServerWritableStream<unknown, unknown>) => void {
  return (call) => {
    const cancelled = new AbortController();
    let previous = new Map<string, WatchedSandbox>();
    let polling = false;
    const timer = setInterval(() => {
      void poll();
    }, intervalMs);
    const stop = (): void => {
      cancelled.abort();
      clearInterval(timer);
    };
    const poll = async (): Promise<void> => {
      if (polling) {
        return;
      }
      polling = true;
      try {
        const next = await driver.snapshotAll();
        if (cancelled.signal.aborted) {
          return;
        }
        const current = new Map<string, WatchedSandbox>();
        for (const [name, sandbox] of next) {
          const json = JSON.stringify(sandbox);
          current.set(name, { json, id: sandbox.id });
          if (previous.get(name)?.json !== json) {
            call.write({ sandbox: { sandbox } });
          }
        }
        for (const [name, before] of previous) {
          if (!current.has(name)) {
            call.write({ deleted: { sandbox_id: before.id } });
          }
        }
        previous = current;
      } catch (error: unknown) {
        stop();
        call.emit("error", toServerError(driverFailureOf(error)));
      } finally {
        polling = false;
      }
    };
    call.on("cancelled", stop);
    void poll();
  };
}

// Binds every RPC of the service to the driver. The keys are the RPC names from compute_driver.proto.
export function computeDriverImplementation(
  driver: ComputeDriver,
  watchIntervalMs: number = DEFAULT_WATCH_INTERVAL_MS,
): UntypedServiceImplementation {
  return {
    GetCapabilities: sync((request: GetCapabilitiesRequest) => driver.getCapabilities(request)),
    AuthenticateSandbox: unary(() =>
      Promise.reject(new DriverStatusError(driverUnimplemented("sandbox authentication is not offered"))),
    ),
    ValidateSandboxCreate: sync((request: { sandbox?: DriverSandboxMessage | null }) =>
      driver.validateSandboxCreate(request.sandbox),
    ),
    GetSandbox: unary((request: SandboxIdentityRequest) => driver.getSandbox(request)),
    ListSandboxes: unary(() => driver.listSandboxes()),
    CreateSandbox: unary((request: { sandbox?: DriverSandboxMessage | null }) => driver.createSandbox(request.sandbox)),
    StopSandbox: sync(() => driver.stopSandbox()),
    StartSandbox: sync(() => driver.startSandbox()),
    DeleteSandbox: unary((request: SandboxIdentityRequest) => driver.deleteSandbox(request)),
    WatchSandboxes: watchSandboxes(driver, watchIntervalMs),
    EnsureWorkspace: sync((request: WorkspaceRequest) => driver.ensureWorkspace(request)),
    DeleteWorkspace: sync((request: WorkspaceRequest) => driver.deleteWorkspace(request)),
  };
}
