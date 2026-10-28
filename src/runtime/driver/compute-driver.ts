// The realm's implementation of the OpenShell ComputeDriver gRPC service (phase 9.4, PRD-DRV-01..03; phase 9.5 starts the
// in-container runtime on the built-in path).
//
// Create is the only path to a container. Before it reaches the lifecycle, the request is checked against the realm
// profile: the digest-pinned image, the portable CPU and memory limits, no GPU, no platform or driver config, no
// environment, no user-namespace request, no isolation backend selection (the built-in path carries none), and a sandbox name
// that passes the container-name rule once the realm prefix is added. A create carries the gateway's launch material.
// CreateSandbox requires it. ValidateSandboxCreate accepts a create without it, because the gateway validates a create before
// it mints the material. Launch material that is present must decode for this driver's gateway on both RPCs (launch.ts). Any
// mismatch is refused with SCHEMA_INVALID, logged with the RPC and the check that refused (refusal.ts), and no libpod call is made.
// The sandbox runtime is PID 1 whatever the argv. spec.command is checked for empty arguments and is otherwise not forwarded, as at HEAD.
//
// A create is refused while a container this driver created is live on the pinned root, or while another create holds the root.
// Live means any readable state other than configured, created, exited or stopped, so running, paused, stopping and removing all hold.
// The containers are read from the runtime as well as from memory, so a restarted driver refuses too. A container that is gone,
// exited, created or stopped holds nothing, so a failed sandbox releases the root once its container has stopped.
// A create that passes checks the pinned workspace root, which the driver never creates, chmods or removes, and prepares a new state
// directory. It stores the launch material in a new secret directory outside the state root and the workspace, and it
// makes the channel: a TLS identity for the runtime, and the runtime's bootstrap, descriptor and auth bundle, built and checked
// for agreement before any libpod call. The lifecycle (DriverLifecycle) then creates the container, and the bootstrap and the
// rest are written before it starts. The sandbox runtime is the container's main process, so once the container is verified the
// driver waits for the runtime's listener, removes the runtime's server key, and starts the host supervisor. Any failure removes
// what this call made, and rethrows the original error.
//
// The gateway names a sandbox without the realm prefix, and the container runs under that name with the prefix added.
// A name that already has the prefix is unchanged. The driver keeps a registry keyed by the gateway's name, holding the
// gateway's sandbox id, its workspace, and the container name. CreateSandbox fills it and DeleteSandbox clears it.
// The startup sweep removes every realm container before the driver accepts requests, so no sandbox survives a restart
// without a registry entry. Observed state comes from the labelled containers, and every snapshot carries the gateway's name.
// StopSandbox and StartSandbox refuse with the transition code, which maps to FAILED_PRECONDITION (PD-08).
// AuthenticateSandbox is not implemented: the driver does not advertise sandbox authentication.

import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, type Stats } from "node:fs";
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
import { HARDENING_PROFILE, hardeningEvidenceDigest } from "../hardening.js";
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
import { assertSocketPathsFit, channelPathsOf, generateRuntimeTls, makeChannelDirectory, removeKeyFile, writeRuntimeFiles, type ListenerTrust } from "./channel.js";
import { driverFailureOf, DriverStatusError, driverNotFound, driverUnimplemented, toServerError } from "./grpc-status.js";
import { assertStateDirClear, type DriverLifecycle } from "./lifecycle.js";
import { decodeLaunchAuthentication, type LaunchAuthentication } from "./isolation/launch.js";
import { logStageRefusal, refusal, refusalScope, type RefusalCheck, type RefusalLog, type RefusalScope } from "./refusal.js";
import {
  assertRuntimeFilesAgree,
  CONTAINER_CONTROL_SOCKET,
  buildRuntimeChannel,
  runtimeServerName,
  supervisorArguments,
  supervisorEnvironment,
  type RuntimeChannel,
  type RuntimeVerificationKey,
} from "./runtime-channel.js";
import { GATEWAY_ID_PATTERN } from "../gateway-config.js";
import { removeSandboxSecrets, secretDirExists, secretDirOf, writeLaunchMaterial } from "./secret-store.js";
import { sandboxBindingOf } from "./sandbox-binding.js";
import type { SupervisorHandle, SupervisorSpawn } from "./supervisor.js";

export const COMPUTE_DRIVER_SERVICE_NAME = "openshell.compute.v1.ComputeDriver";
const PROTO_FILE = "compute_driver.proto";
const PROTO_DIRECTORY = join("src", "runtime", "driver", "proto");
// The extension capabilities this driver declares. The isolation backend capability is not advertised: the gateway requires it
// only for a registered external backend, and the built-in path has none.
const SUPPORTED_CAPABILITIES: readonly string[] = Object.freeze([
  "openshell.compute.contract",
  "openshell.compute.launch-authentication",
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

// The configuration of the compute driver, as the entry point reads it.
export interface ComputeDriverConfig {
  // The driver's name as the gateway's [openshell.drivers.<name>] table names it.
  readonly driverName: string;
  // The one digest-pinned sandbox image this driver creates.
  readonly sandboxImage: string;
  // Absolute root under which each sandbox's state directory sits, at <root>/<containerName>.
  readonly sandboxStateRoot: string;
  // Absolute root under which each sandbox's secret directory sits, at <root>/<containerName>. It holds the launch material,
  // the runtime's channel, and the supervisor's files.
  readonly secretRoot: string;
  // Absolute path of the pinned workspace root, the sandbox's /workspace, bound read-write. It is the root itself, and the
  // workspace id selects no directory under it. The driver never creates, chmods or removes it.
  readonly workspaceRoot: string;
  // The build version advertised as the extension implementation version. The gateway refuses an empty or invalid value.
  readonly implementationVersion: string;
  // The gateway this driver serves. Launch material issued for another gateway is refused.
  readonly gatewayId: string;
  // The host supervisor the driver starts for each sandbox: its binary, the gateway endpoint it dials, and the CA it trusts.
  readonly supervisor: {
    readonly binary: string;
    readonly gatewayEndpoint: string;
    readonly gatewayCaPath: string;
  };
  // Receives each refusal line (refusal.ts). Stderr when absent.
  readonly refusalLog?: RefusalLog;
}

// The process-level effects the driver needs and the tests replace: confirming the sandbox runtime's listener, and starting a host
// supervisor. The entry point wires the real ones.
export interface RuntimeHost {
  // Resolves once a TLS handshake with the runtime's listener completes on its control socket, trusting the given CA and server name
  // (channel.ts awaitRuntimeListener).
  awaitListener(controlSocket: string, trust: ListenerTrust): Promise<void>;
  // Starts a host supervisor process.
  spawnSupervisor(options: SupervisorSpawn): Promise<SupervisorHandle>;
}

export interface ComputeDriverDeps {
  readonly lifecycle: Pick<DriverLifecycle, "create" | "delete" | "stop">;
  // The check a create runs before it touches the disk. The driver process passes the lifecycle's requireSwept, so a create that
  // arrives while the startup sweep runs is refused before it writes a state directory or launch material the sweep would then
  // race. Omitted by a caller whose lifecycle needs no sweep.
  readonly requireSwept?: () => void;
  readonly libpod: Pick<LibpodClient, "inspectContainer" | "listContainersByLabel">;
  readonly runtime: RuntimeHost;
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
  // The gateway-created launch credentials, as the bytes of the gateway's JSON encoding. CreateSandbox requires them;
  // ValidateSandboxCreate accepts their absence.
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
  // The identity the runtime reported when the container was created: the container id.
  readonly runtimeIdentity: string;
  // Set when the sandbox's host supervisor exits. The sandbox then reports failed, whether or not its container stop worked.
  supervisorExited: boolean;
}

// A validated create: the gateway's sandbox name and id, its workspace, the spec the lifecycle takes, and the launch material
// the driver stores for the sandbox, with its decoded authentication.
interface CreatePlan {
  readonly sandboxName: string;
  readonly sandboxId: string;
  readonly workspace: string;
  readonly spec: ContainerSpec;
  // The launch material, or undefined when the request carries none. CreateSandbox refuses a plan without it.
  readonly launch: Uint8Array | undefined;
  readonly authentication: LaunchAuthentication | undefined;
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
  // The host supervisor of each sandbox, keyed by the container name. It is stopped on delete and on a failed create.
  private readonly supervisors = new Map<string, SupervisorHandle>();
  // True while a create holds the pinned root, from its check until it returns or fails. It is set before the first await, so a
  // create that starts meanwhile is refused.
  private rootReserved = false;
  // Containers this driver created and could not confirm removed. Each keeps holding the pinned root while it is live.
  private readonly unremovedContainers = new Set<string>();

  constructor(config: ComputeDriverConfig, deps: ComputeDriverDeps) {
    if (
      !isAbsolute(config.sandboxStateRoot) ||
      !isAbsolute(config.secretRoot) ||
      !isAbsolute(config.workspaceRoot) ||
      !isAbsolute(config.supervisor.binary) ||
      !isAbsolute(config.supervisor.gatewayCaPath) ||
      !isImplementationVersion(config.implementationVersion) ||
      !GATEWAY_ID_PATTERN.test(config.gatewayId)
    ) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    assertPinnedWorkspaceRoot(config.workspaceRoot);
    assertApart(config.secretRoot, config.workspaceRoot);
    assertApart(config.sandboxStateRoot, config.workspaceRoot);
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
        gpu: { default_supported: false },
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

  // Runs every create check. Launch material is validated when present and may be absent. Makes no libpod call and writes nothing.
  validateSandboxCreate(sandbox: DriverSandboxMessage | null | undefined): Record<string, never> {
    planCreate(sandbox, this.config, this.scopeOf("ValidateSandboxCreate"));
    return {};
  }

  // A create without launch material is refused before anything is written, because CreateSandbox requires it.
  // A state or secret directory that exists is reclaimed when its container is gone and the driver tracks none
  // (reclaimStaleSandbox), and is refused before anything is prepared otherwise, so that refusal creates nothing. Then the pinned
  // workspace root is checked, which never creates it, and the state directory, the launch material and the channel are prepared.
  // The channel's bootstrap and descriptor must agree before the lifecycle runs. The lifecycle creates the container and writes the
  // runtime's files before it starts it. Then the runtime starts in the container and the host supervisor starts beside it. Any
  // failure removes what this call made: the container, the state directory, the secret entries, and the supervisor, and the
  // original error is rethrown.
  async createSandbox(sandbox: DriverSandboxMessage | null | undefined): Promise<{ runtime_identity: string }> {
    this.deps.requireSwept?.();
    const scope = this.scopeOf("CreateSandbox");
    const plan = planCreate(sandbox, this.config, scope);
    const { launch, authentication } = plan;
    if (launch === undefined || authentication === undefined) {
      throw refusal(scope, "create.launch_authentication");
    }
    // Every sandbox of this driver is bound to the one pinned root. The root is reserved before the first await, so a create that
    // starts while another is still checking or building is refused too. The reservation ends when its create returns or fails:
    // after that a running container holds the root.
    if (this.rootReserved) {
      throw refusal(scope, "create.pinned_root_held", "REALM_INVALID_TRANSITION");
    }
    this.rootReserved = true;
    try {
      if (await this.pinnedRootHeld(scope)) {
        throw refusal(scope, "create.pinned_root_held", "REALM_INVALID_TRANSITION");
      }
      return await this.buildSandbox(plan, scope, launch, authentication);
    } finally {
      this.rootReserved = false;
    }
  }

  // The create once the pinned root is reserved and free: the state directory, the launch material and the channel are prepared,
  // and the container, the runtime and the supervisor are started, as described above.
  private async buildSandbox(
    plan: CreatePlan,
    scope: RefusalScope,
    launch: Uint8Array,
    authentication: LaunchAuthentication,
  ): Promise<{ runtime_identity: string }> {
    const sandboxName = plan.spec.sandboxName;
    const staleCheck = this.staleDirectoryCheck(plan);
    if (staleCheck !== undefined) {
      await this.reclaimStaleSandbox(plan, scope, staleCheck);
    }
    atStage(scope, "create.state_dir", () => {
      assertStateDirAbsent(plan.spec.stateDir);
    });
    if (atStage(scope, "create.secret_dir", () => secretDirExists(this.config.secretRoot, sandboxName))) {
      throw refusal(scope, "create.secret_dir");
    }
    atStage(scope, "create.workspace", () => {
      assertPinnedWorkspaceRoot(this.config.workspaceRoot);
    });
    atStage(scope, "create.state_dir", () => {
      mkdirOrRefuse(plan.spec.stateDir);
    });
    const channel = atStage(scope, "create.channel", () => channelPathsOf(secretDirOf(this.config.secretRoot, sandboxName)));
    const serverName = runtimeServerName(authentication.supervisor.sessionId);
    let trustAnchorPem: string;
    let files: RuntimeChannel;
    let stage: RefusalCheck = "create.launch_material";
    try {
      writeLaunchMaterial(this.config.secretRoot, sandboxName, launch);
      stage = "create.channel";
      makeChannelDirectory(channel);
      trustAnchorPem = await generateRuntimeTls(channel, serverName);
      files = buildRuntimeChannel({
        sandboxId: plan.sandboxId,
        containerName: sandboxName,
        image: plan.spec.image,
        gatewayId: authentication.gatewayId,
        supervisor: authentication.supervisor,
        verificationKeys: runtimeKeysOf(authentication),
        serverName,
        trustAnchorPem,
        controlSocketHostPath: channel.controlSocket,
        evidenceDigest: hardeningEvidenceDigest(plan.spec.image),
      });
      stage = "create.runtime_files";
      assertRuntimeFilesAgree(files.bootstrap, files.descriptor);
    } catch (error: unknown) {
      logStageRefusal(scope, stage, error);
      addCleanupNote(error, this.discardPrepared(plan));
      throw error;
    }
    let containerId: string;
    try {
      containerId = await this.deps.lifecycle.create(plan.spec, () => {
        writeRuntimeFiles(channel, files);
        return Promise.resolve();
      });
    } catch (error: unknown) {
      logStageRefusal(scope, "create.container", error);
      const problems = this.discardPrepared(plan);
      // A container this create made may still run and hold the pinned root. A name already in use belongs to another container, which this create did not make.
      if (!(error instanceof RealmError && error.code === "SANDBOX_NAME_IN_USE")) {
        const containerProblem = await this.containerProblem(sandboxName);
        if (containerProblem !== undefined) {
          this.unremovedContainers.add(sandboxName);
          problems.push(containerProblem);
        }
      }
      addCleanupNote(error, problems);
      throw error;
    }
    try {
      await this.deps.runtime.awaitListener(channel.controlSocket, { caPem: trustAnchorPem, serverName });
      // The TLS handshake completed, so the runtime has loaded its key, and nothing after this reads server.key from the channel.
      // The driver removes the key now; a key that cannot be removed refuses the create.
      removeKeyFile(channel.privateKey);
      // The supervisor binds its SSH socket only with the SSH host key. Without it the supervisor fails at startup, so the spawn is
      // refused here, before any supervisor starts. The refusal names no key material.
      if (!authentication.supervisor.hasSshHostPrivateKey) {
        throw makeRealmError("SCHEMA_INVALID");
      }
      const supervisor = await this.deps.runtime.spawnSupervisor({
        binary: this.config.supervisor.binary,
        args: supervisorArguments({
          sandboxId: plan.sandboxId,
          sandboxName: plan.sandboxName,
          gatewayEndpoint: this.config.supervisor.gatewayEndpoint,
          secretDir: channel.secretDir,
          sshSocketPath: channel.sshSocket,
        }),
        env: supervisorEnvironment({
          sandboxId: plan.sandboxId,
          sandboxName: plan.sandboxName,
          gatewayEndpoint: this.config.supervisor.gatewayEndpoint,
          gatewayCaPath: this.config.supervisor.gatewayCaPath,
          image: plan.spec.image,
        }),
      });
      this.supervisors.set(sandboxName, supervisor);
      void supervisor.exited.then(() => this.onSupervisorExit(sandboxName, supervisor));
      // A supervisor that exited before Ready refuses the create. Nothing between this check and the registry entry yields, so no
      // exit can land between them.
      if (supervisor.hasExited()) {
        throw makeRealmError("OPENSHELL_START_FAILED");
      }
    } catch (error: unknown) {
      logStageRefusal(scope, "create.start", error);
      addCleanupNote(error, await this.discardCreated(plan));
      throw error;
    }
    this.registry.set(plan.sandboxName, {
      id: plan.sandboxId,
      workspace: plan.workspace,
      containerName: sandboxName,
      runtimeIdentity: containerId,
      supervisorExited: false,
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

  // Idempotent: a sandbox that is already gone deletes nothing and succeeds. A name whose container a different
  // registered sandbox holds deletes nothing, so a request never removes a sandbox it does not name. The host supervisor
  // is stopped first, then the lifecycle removes the container, the state directory and the secret entries.
  async deleteSandbox(request: SandboxIdentityRequest): Promise<{ deleted: boolean }> {
    const name = this.nameOf(request);
    if (name === undefined) {
      return { deleted: false };
    }
    const containerName = containerNameOf(name);
    if (containerName === undefined || this.heldByAnotherSandbox(name, containerName)) {
      return { deleted: false };
    }
    const existed = await this.removeSandbox(name, containerName);
    return { deleted: existed };
  }

  // The delete path for one sandbox: stops the host supervisor the driver holds for the container, reads whether the container
  // exists, has the lifecycle remove the container, the state directory and the secret entries, and drops the registry entry.
  // Returns whether the container existed. DeleteSandbox and the create-time reclaim both run it.
  private async removeSandbox(name: string, containerName: string): Promise<boolean> {
    await this.stopSupervisor(containerName);
    const existed = (await this.deps.libpod.inspectContainer(containerName)) !== null;
    await this.deps.lifecycle.delete(containerName);
    this.registry.delete(name);
    return existed;
  }

  // The check a create reports for a stale entry, when the sandbox's state directory or secret directory exists and every entry
  // that exists is a real directory. Undefined means there is nothing to reclaim, or an entry is a symbolic link, a wrong kind, or
  // cannot be read; the absence checks then refuse it as they always did. Reads the filesystem only, makes no libpod call, and
  // logs nothing.
  private staleDirectoryCheck(plan: CreatePlan): RefusalCheck | undefined {
    try {
      realpathOrRefuse(dirname(plan.spec.stateDir));
      const state = statOrNull(plan.spec.stateDir);
      const secret = statOrNull(secretDirOf(this.config.secretRoot, plan.spec.sandboxName));
      if ((state !== null && !state.isDirectory()) || (secret !== null && !secret.isDirectory())) {
        return undefined;
      }
      return state !== null ? "create.state_dir" : secret !== null ? "create.secret_dir" : undefined;
    } catch {
      return undefined;
    }
  }

  // Reclaims the state directory and the secret directory of a sandbox whose container is gone: a crashed driver never ran the
  // delete path, so they are still on disk when the gateway creates the same sandbox again. The gateway creates only a name it
  // holds no live sandbox for, and the pinned root admits one live sandbox, so a directory with no container behind it is an
  // orphan. The reclaim runs only when all of these hold; otherwise it removes nothing and returns, and the absence checks refuse
  // the create as they always did:
  //   (a) libpod has no container of this sandbox's container name (inspect returns null; an inspect that throws proves nothing);
  //   (b) the driver tracks no live container for the name: it is not in unremovedContainers (that set is pruned of gone
  //       containers by pinnedRootHeld, so a name left in it was found), and no registry record under another gateway name holds
  //       the container name (DeleteSandbox deletes nothing for such a name either);
  //   (c) the driver holds no running supervisor for the name, except a stale handle: with the container proven gone by (a), a
  //       supervisor handle for the name and a registry record under this gateway name belong to the dead sandbox, so they are
  //       stopped and dropped by the delete path below. A create already in flight is excluded by rootReserved.
  // The cleanup is the delete path (removeSandbox), after the state directory passes the same check a create applies to one
  // (assertStateDirClear). Any failure refuses the create, is logged with the stage's check and no path, and leaves what the
  // failing step left in place.
  private async reclaimStaleSandbox(plan: CreatePlan, scope: RefusalScope, check: RefusalCheck): Promise<void> {
    const containerName = plan.spec.sandboxName;
    if (this.unremovedContainers.has(containerName) || this.heldByAnotherSandbox(plan.sandboxName, containerName)) {
      return;
    }
    try {
      if ((await this.deps.libpod.inspectContainer(containerName)) !== null) {
        return;
      }
    } catch {
      return;
    }
    try {
      if (statOrNull(plan.spec.stateDir) !== null) {
        assertStateDirClear(plan.spec.stateDir);
      }
      await this.removeSandbox(plan.sandboxName, containerName);
    } catch (error: unknown) {
      logStageRefusal(scope, check, error);
      throw error instanceof RealmError ? error : makeRealmError("CLEANUP_FAILED");
    }
  }

  // PD-08: stop and start are refused with the transition code (FAILED_PRECONDITION). Nothing is read or changed.
  stopSandbox(): never {
    throw makeRealmError("REALM_INVALID_TRANSITION");
  }

  startSandbox(): never {
    throw makeRealmError("REALM_INVALID_TRANSITION");
  }

  // Checks the id and the pinned root. Nothing is created, so the root keeps its mode and contents.
  ensureWorkspace(request: WorkspaceRequest): Record<string, never> {
    assertWorkspaceId(request.workspace);
    assertPinnedWorkspaceRoot(this.config.workspaceRoot);
    return {};
  }

  // The pinned workspace root is never removed, empty or not. The request is refused with the transition code
  // (FAILED_PRECONDITION). Only the id is checked first; nothing is read or changed.
  deleteWorkspace(request: WorkspaceRequest): Record<string, never> {
    assertWorkspaceId(request.workspace);
    throw makeRealmError("REALM_INVALID_TRANSITION");
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

  async listSandboxes(): Promise<{ sandboxes: DriverSandboxOut[] }> {
    const snapshots = await this.snapshotAll();
    return { sandboxes: [...snapshots.values()] };
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

  // Ends the host supervisor of a container, if the driver started one. A supervisor already gone is not an error. The supervisor
  // leaves the table before it is stopped, and the sandbox is marked failed first: a delete that fails after this cannot report the
  // sandbox Ready with no supervisor behind it.
  private async stopSupervisor(containerName: string): Promise<void> {
    const supervisor = this.supervisors.get(containerName);
    this.supervisors.delete(containerName);
    if (supervisor !== undefined) {
      this.markSupervisorExited(containerName);
    }
    await supervisor?.stop();
  }

  // Marks every registered sandbox that runs under this container as failed, so its snapshot reports Ready False.
  private markSupervisorExited(containerName: string): void {
    for (const record of this.registry.values()) {
      if (record.containerName === containerName) {
        record.supervisorExited = true;
      }
    }
  }

  // The host supervisor of a sandbox exited. An exit the driver caused is not a failure: the driver has already taken the supervisor
  // out of the table. Any other exit marks the sandbox failed, which the snapshot reports from now on, and stops its container. The
  // mark stands even when the stop fails; the container is removed by the sandbox's delete.
  private async onSupervisorExit(containerName: string, supervisor: SupervisorHandle): Promise<void> {
    if (this.supervisors.get(containerName) !== supervisor) {
      return;
    }
    this.supervisors.delete(containerName);
    this.markSupervisorExited(containerName);
    try {
      await this.deps.lifecycle.stop(containerName);
    } catch {
      // The mark above already reports the sandbox as failed, and no caller can receive this error.
    }
  }

  // True when a container this driver created holds the pinned root. The candidates are the containers in memory (the registry's and
  // the unconfirmed-removal set) and every container the runtime lists under the driver's own label, so a driver with no memory still
  // sees a live sandbox. A candidate holds the root when it is live and binds the pinned root. A state or mount list that cannot be
  // read is not known to be free, so the create is refused, as is a lookup that fails for any other reason.
  private async pinnedRootHeld(scope: RefusalScope): Promise<boolean> {
    try {
      // One entry per container, keyed by its sandbox name, so a container both in memory and listed is inspected once. A listed container
      // is inspected by the id the runtime reports; a container known only from memory is inspected by its name.
      const references = new Map<string, string>();
      for (const name of this.unremovedContainers) {
        references.set(name, name);
      }
      for (const record of this.registry.values()) {
        references.set(record.containerName, record.containerName);
      }
      const listed = await this.deps.libpod.listContainersByLabel(OPENSHELL_ISOLATION_ROLE_LABEL_KEY, OPENSHELL_SANDBOX_ROLE_VALUE);
      for (const container of listed) {
        references.set(container.labels?.[OPENSHELL_SANDBOX_NAME_LABEL_KEY] ?? container.id, container.id);
      }
      for (const [name, reference] of references) {
        const inspect = await this.deps.libpod.inspectContainer(reference);
        if (inspect === null) {
          this.unremovedContainers.delete(name);
        } else if (holdsPinnedRoot(inspect, this.config.workspaceRoot)) {
          return true;
        }
      }
      return false;
    } catch (error: unknown) {
      // A RealmError keeps its own code. Any other failure refuses the create under this check, with SCHEMA_INVALID.
      if (error instanceof RealmError) {
        throw error;
      }
      throw refusal(scope, "create.pinned_root_held");
    }
  }

  // Removes what a create made before its container existed: the state directory and the secret entries. Returns what was left
  // in place, as cleanup problems. An empty list means every removal succeeded.
  private discardPrepared(plan: CreatePlan): string[] {
    const stateRemoved = removeStateDir(plan.spec.stateDir);
    const materialRemoved = removeLaunchMaterial(this.config.secretRoot, plan.spec.sandboxName);
    return stateRemoved && materialRemoved ? [] : [FILES_LEFT_IN_PLACE];
  }

  // Removes what a create made after its container existed: the host supervisor, the container, and the files. Every removal is
  // attempted, so one failure does not skip the rest. Returns what was left in place, each named as it is.
  private async discardCreated(plan: CreatePlan): Promise<string[]> {
    const problems: string[] = [];
    try {
      await this.stopSupervisor(plan.spec.sandboxName);
    } catch {
      problems.push(SUPERVISOR_NOT_STOPPED);
    }
    let deleted = true;
    try {
      await this.deps.lifecycle.delete(plan.spec.sandboxName);
    } catch {
      deleted = false;
    }
    if (!deleted) {
      const containerProblem = await this.containerProblem(plan.spec.sandboxName);
      if (containerProblem !== undefined) {
        problems.push(containerProblem);
        this.unremovedContainers.add(plan.spec.sandboxName);
      }
    }
    problems.push(...this.discardPrepared(plan));
    return problems;
  }

  // The problem with a container that the lifecycle failed to remove. A lookup that still finds it names it as present; a lookup
  // that fails names the removal as unconfirmed. Undefined means the container is gone.
  private async containerProblem(containerName: string): Promise<string | undefined> {
    try {
      const inspect = await this.deps.libpod.inspectContainer(containerName);
      return inspect === null ? undefined : CONTAINER_NOT_REMOVED;
    } catch {
      return CONTAINER_UNCONFIRMED;
    }
  }

  // The refusal scope of one RPC: its name, and the sink this driver was configured with.
  private scopeOf(rpc: "ValidateSandboxCreate" | "CreateSandbox"): RefusalScope {
    return refusalScope(rpc, this.config.refusalLog);
  }
}

// The container name for a gateway sandbox name: the realm prefix is added when the name lacks it. Undefined when the
// result fails the container-name rule, which also bounds the length, so the caller refuses it.
function containerNameOf(sandboxName: string): string | undefined {
  const name = isRealmSandboxName(sandboxName) ? sandboxName : `${REALM_SANDBOX_NAME_PREFIX}${sandboxName}`;
  return CONTAINER_ID_PATTERN.test(name) ? name : undefined;
}

// The built-in path carries no isolation backend selection: the gateway selects the built-in backend by name, and the
// driver is not told of it. A selection that arrives anyway is refused before any write or libpod call.
function refuseIsolationSelection(selection: unknown, scope: RefusalScope): void {
  if (selection !== undefined && selection !== null) {
    throw refusal(scope, "create.isolation_backend");
  }
}

// Runs one stage of the create path. A SCHEMA_INVALID the stage raises is logged with the stage's check, and the error is rethrown unchanged.
function atStage<T>(scope: RefusalScope, check: RefusalCheck, work: () => T): T {
  try {
    return work();
  } catch (error: unknown) {
    logStageRefusal(scope, check, error);
    throw error;
  }
}

// Checks a create request against the realm profile and returns the lifecycle spec and the launch material when it carries any.
// Every refusal is SCHEMA_INVALID, logged with its RPC and check, and no libpod call is made. Launch material that is present must
// decode for this driver's gateway, on both RPCs, before any write. An absent bundle is not refused here: CreateSandbox refuses it
// (createSandbox), so ValidateSandboxCreate can run before the gateway mints the bundle.
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
  // The container's mounts are the sandbox binding, which the lifecycle verifies the container against.
  const binding = atStage(scope, "create.identity", () =>
    sandboxBindingOf(
      { workspaceRoot: config.workspaceRoot, stateRoot: config.sandboxStateRoot, secretRoot: config.secretRoot },
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
function runtimeKeysOf(authentication: LaunchAuthentication): RuntimeVerificationKey[] {
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

// The observed state of one sandbox, named by the gateway. Ready is True only while the container is running and its host
// supervisor has not exited.
function sandboxOut(name: string, record: SandboxRecord, inspect: LibpodInspect): DriverSandboxOut {
  const state = runStateOf(inspect);
  const ready = state === "running" && !record.supervisorExited;
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
          status: ready ? "True" : "False",
          reason: record.supervisorExited ? "supervisor-exited" : state,
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

// States in which a container holds no pinned root: it has not started, or it has stopped. Every other readable state is live,
// which includes running and paused.
const NON_HOLDING_STATES: Record<string, true> = { configured: true, created: true, exited: true, stopped: true };

// True when a container holds the pinned root: it is live, and one of its mounts has the pinned root as its source. Throws when the
// state or the mounts cannot be read, so the caller refuses the create.
function holdsPinnedRoot(inspect: LibpodInspect, root: string): boolean {
  const state = runStateOf(inspect);
  if (state === "unknown") {
    throw new Error("container state unreadable");
  }
  if (NON_HOLDING_STATES[state] === true) {
    return false;
  }
  const mounts: unknown = inspect["Mounts"];
  if (!Array.isArray(mounts)) {
    throw new Error("container mounts unreadable");
  }
  const entries: readonly unknown[] = mounts;
  return entries.some((mount) => typeof mount === "object" && mount !== null && "Source" in mount && mount.Source === root);
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

// Removes the launch material and the channel a create stored. Returns false when the removal failed, and they are left in place.
function removeLaunchMaterial(secretRoot: string, sandboxName: string): boolean {
  try {
    removeSandboxSecrets(secretRoot, sandboxName);
    return true;
  } catch {
    return false;
  }
}

// The cleanup problems a failed create reports. Each names only what is true of the removal that failed.
const SUPERVISOR_NOT_STOPPED = "The host supervisor did not stop.";
const CONTAINER_NOT_REMOVED = "The container was not removed.";
const CONTAINER_UNCONFIRMED = "The container's removal could not be confirmed.";
const FILES_LEFT_IN_PLACE = "The sandbox state directory or launch material was left in place.";

// Adds the cleanup problems to a refusal's message. Only a RealmError carries a message the driver owns. A refusal with no
// problems is left as it is.
function addCleanupNote(error: unknown, problems: readonly string[]): void {
  if (problems.length > 0 && error instanceof RealmError) {
    error.message = `${error.message} Cleanup failed: ${problems.join(" ")}`;
  }
}

// The two roots must not hold one another, or be the same path. The pinned workspace root is bound into the sandbox read-write, so no
// state or secret directory may sit under it or hold it, and a delete of a sandbox's own directories can never reach it. Both are
// compared as resolved real paths.
function assertApart(a: string, b: string): void {
  const left = resolvedPathOf(a);
  const right = resolvedPathOf(b);
  if (left === right || isStrictlyInside(left, right) || isStrictlyInside(right, left)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// The workspace id selects no directory: the sandbox's /workspace is the pinned root. The id is still checked.
function assertWorkspaceId(workspace: string | undefined): void {
  if (workspace === undefined || !WORKSPACE_ID_PATTERN.test(workspace)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// The pinned workspace root must be an absolute path to a real directory that the driver's account owns. A missing path, a symbolic
// link (checked with lstat, never followed), a file, or a directory another account owns is refused. The driver never creates,
// chmods or removes it, so a refusal here changes nothing.
function assertPinnedWorkspaceRoot(root: string): void {
  const stat = statOrNull(root);
  const uid = process.getuid?.();
  if (!isAbsolute(root) || stat === null || !stat.isDirectory() || uid === undefined || stat.uid !== uid) {
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
