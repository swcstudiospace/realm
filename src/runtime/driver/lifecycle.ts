// Hardened container lifecycle of the driver (phase 9.3, PRD-CTR-01..03). create builds the container from a
// typed spec, runs the caller's before-start step, starts it, and proves it conforms before it is returned. delete removes a
// sandbox's own containers, its own state directory, and its secret entries. adoptSurvivors runs at every driver start, before the
// driver serves a request that acts on a container or a secret. It keeps each realm container that still conforms to its retained
// binding, removes the rest, and removes the secret entries of each sandbox it keeps no container for.
//
// Everything here goes through the closed libpod client (PD-11). The verifier is the same one session-execution
// uses (PD-13): verifyInspect over HARDENING_PROFILE, with the host evidence (the OCI config's fields and the init process's
// /proc status) attached first by attachRuntimeEvidence. The checks the verifier does not make are added here, after it. The
// state root is a constructor argument; this module reads no host environment. The secret directories are handled by secret-store.ts.

import { lstatSync, readdirSync, realpathSync, rmSync, type Dirent, type Stats } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { makeRealmError, RealmError, type ErrorCode } from "../../core/errors.js";
import { withTimeout } from "../../core/timeout.js";
import { bindRoot, isInsideRoot } from "../../fs/root.js";
import { readWorkspaceEntry, verifyWorkspaceEntry } from "../../session/workspace-registry.js";
import { attachRuntimeEvidence } from "../create-evidence.js";
import { liveCapabilityFailures, readHostProcStatus, type LiveProperty } from "../kernel-caps.js";
import { readHostOciConfig } from "../seccomp-evidence.js";
import { channelOptionFailures, HARDENING_PROFILE, verifyInspect, type ChannelProperty, type HardeningBinding, type HardeningProperty } from "../hardening.js";
import {
  validateContainerSpec,
  type ContainerSpec,
  type LibpodClient,
  type LibpodContainerSummary,
  type LibpodInspect,
} from "../libpod-client.js";
import { CONTAINER_ID_PATTERN } from "../libpod-routes.js";
import {
  isRealmSandboxName,
  OPENSHELL_MANAGED_LABEL_KEY,
  OPENSHELL_MANAGED_LABEL_VALUE,
  OPENSHELL_SANDBOX_NAME_LABEL_KEY,
  sessionOfRealmSandbox,
} from "../openshell.js";
import { listRealmContainers, SWEEP_CALL_TIMEOUT_MS } from "../sweep.js";
import { presentSecretEntries, removeSecretDirIfEmpty, removeSecretEntries, secretDirExists, secretDirOf, secretDirsUnder } from "./secret-store.js";
import { sandboxBindingOf, type SandboxBinding } from "./sandbox-binding.js";

// Grace period a sandbox container gets to stop before it is killed. Matches the session composition's grace.
const STOP_GRACE_MS = 10_000;

// C5. An entry whose path under the state directory matches this names a secret. Such an entry (file or directory)
// must carry no group or world permission bit. The pattern is deliberately broad: a false match only refuses a
// create, which fails closed. It matches case-insensitively.
const SECRET_NAME_PATTERN =
  /secret|token|credential|passw|private|apikey|id_rsa|id_ed25519|kubeconfig|\.npmrc|\.netrc|\.pgpass|\.htpasswd|\.key$|\.pem$|\.env$|\.p12$|\.pfx$|\.jks$/i;
const GROUP_OR_WORLD_BITS = 0o077;

// C1. The options every workspace mount must carry, so the workspace is not executable, suid or device-bearing.
const WORKSPACE_REQUIRED_OPTIONS: readonly string[] = Object.freeze(["noexec", "nosuid", "nodev"]);

// The launch material's file in a sandbox's secret directory. secret-store writes it and does not export its name.
const LAUNCH_FILE_NAME = "launch.json";

// The libpod calls the lifecycle needs. The closed client satisfies it.
export type LifecycleLibpod = Pick<
  LibpodClient,
  | "info"
  | "createContainer"
  | "startContainer"
  | "inspectContainer"
  | "stopContainer"
  | "removeContainer"
  | "listContainersByLabel"
>;

// A step run after the container exists and before it starts. The driver writes the runtime's files here, so they are in place
// when the runtime starts and are removed by the driver when the create refuses.
export type BeforeStart = (containerId: string) => Promise<void>;

export interface DriverLifecycleOptions {
  readonly libpod: LifecycleLibpod;
  // Absolute root of the per-sandbox state directories. A sandbox's state directory is exactly <root>/<sandboxName>.
  readonly sandboxStateRoot: string;
  // Absolute root of the per-sandbox secret directories, <root>/<sandboxName>. It is never bound into a container and
  // must lie outside the state root. delete and adoptSurvivors remove the sandbox's secret entries from it.
  readonly secretRoot: string;
  // Reads the text of a host process's status file. The create-time check reads the init process through it (D-51).
  readonly readProcStatus?: ((pid: number) => string) | undefined;
  // Reads the text of a container's OCI config file. The create-time check reads its seccomp section through it. Bounded to 1 MiB by default.
  readonly readOciConfig?: ((path: string) => string) | undefined;
  // Reads the device of a path without following a symlink. The workspace scan compares the device of every directory under the
  // workspace with the device of the workspace's real path, so a mount of another filesystem nested in the workspace is refused.
  // A same-filesystem bind mount shares its parent's device and is not detected. lstatSync by default.
  readonly lstat?: ((path: string) => Pick<Stats, "dev">) | undefined;
  // Removes a sandbox's state directory tree. The default removes it without following a symlink inside the tree.
  readonly removeDirectory?: ((dir: string) => void) | undefined;
}

// The driver configuration an adoption rebuilds a survivor's binding from. The lifecycle holds none of these values: the state
// directory that holds the workspace registry, the pinned workspace ceiling and the sandbox image are the driver's configuration.
export interface AdoptionRoots {
  // The driver's state directory. The workspace registry, which names each sandbox's workspace, lives under it.
  readonly workspaceStateDir: string;
  // The pinned workspace ceiling. A survivor's workspace must lie inside it.
  readonly workspaceCeiling: string;
  // The one digest-pinned sandbox image the driver creates.
  readonly image: string;
}

// The outcome of an adoption. adopted lists the containers kept, each with its sandbox name. removed lists every other realm
// container, with the cause it was removed for, once a listing proved it gone. secretsRemoved names the sandboxes whose secret
// entries were removed.
export interface DriverAdoption {
  readonly adopted: { sandboxName: string; containerId: string }[];
  readonly removed: { containerId: string; cause: string }[];
  readonly secretsRemoved: string[];
}

// A property a container is refused for: the verifier's properties (D-51), the workspace mount's options and the terminal check
// made after start (C1, C6), and the channel options checked before start (phase 9.5, F).
// "mounts-options" is the workspace mount's options (C1). "tty" is a container that has a terminal (C6).
export type LifecycleProperty = HardeningProperty | LiveProperty | "mounts-options" | "tty" | ChannelProperty;

// The refusal of a container that fails a create check. Its property is the first failed property, and its message
// lists every failed property in report order, with that first name first. The refusal is a RealmError with the
// OPENSHELL_START_FAILED code, and causeCode is the libpod code the refusal rests on, when there is one.
export class HardeningRefusal extends RealmError {
  readonly property: LifecycleProperty;
  readonly failed: readonly [LifecycleProperty, ...LifecycleProperty[]];

  constructor(failed: readonly [LifecycleProperty, ...LifecycleProperty[]], causeCode?: ErrorCode) {
    super("OPENSHELL_START_FAILED", causeCode);
    this.property = failed[0];
    this.failed = failed;
    this.message = `${this.reason} Failed hardening properties, in report order: ${failed.join(", ")}.`;
  }
}

// Why a survivor is removed without a failed property. no-record: nothing is retained for its sandbox, or the container is not
// named as its sandbox. no-artifacts: something is retained, but the binding cannot be rebuilt from it.
type RemovalCause = "no-record" | "no-artifacts";

interface Adoption {
  readonly kind: "adopt";
  readonly sandboxName: string;
  readonly containerId: string;
}

interface Removal {
  readonly kind: "remove";
  readonly containerId: string;
  readonly cause: string;
}

type Verdict = Adoption | Removal;

// A sandbox directory under the secret root. Its entries are read before any container is removed.
interface SecretDir {
  readonly name: string;
  readonly path: string;
}

interface SecretPlan extends SecretDir {
  readonly entries: readonly string[];
}

export class DriverLifecycle {
  private readonly libpod: LifecycleLibpod;
  private readonly sandboxStateRoot: string;
  private readonly secretRoot: string;
  private readonly readProcStatus: (pid: number) => string;
  private readonly readOciConfig: (path: string) => string;
  private readonly lstat: (path: string) => Pick<Stats, "dev">;
  private readonly removeDirectory: (dir: string) => void;
  private swept = false;
  // The sandbox names this start adopted. A create of such a name is refused until delete removes the sandbox.
  private readonly adopted = new Set<string>();

  constructor(options: DriverLifecycleOptions) {
    if (!isAbsolute(options.sandboxStateRoot)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    assertSecretRoot(options.secretRoot, options.sandboxStateRoot);
    this.libpod = options.libpod;
    this.sandboxStateRoot = options.sandboxStateRoot;
    this.secretRoot = options.secretRoot;
    this.readProcStatus = options.readProcStatus ?? readHostProcStatus;
    this.readOciConfig = options.readOciConfig ?? readHostOciConfig;
    this.lstat = options.lstat ?? lstatSync;
    this.removeDirectory = options.removeDirectory ?? removeTree;
  }

  // Adopts the realm containers that still conform and removes every other one. It replaces the destroy-all sweep of earlier drivers at a start that
  // keeps live sandboxes. Every listing, inspect and retained artifact is read before the first removal, so a failure there rejects the
  // adoption with nothing removed, and the next start retries. A container is adopted only when its binding rebuilds from its retained
  // artifacts and it passes the checks create runs after start. A removal counts only when a listing taken after all of them no longer
  // holds the container; an unproven removal rejects the adoption with REALM_STOPPING, as the sweep does. The secret entries of a sandbox
  // with no adopted container are removed after the removals are proven, and each removal is confirmed by a presence check. The method
  // sets swept only when it resolves, so create, delete and stop refuse with REALM_NOT_ACTIVE until then.
  async adoptSurvivors(roots: AdoptionRoots): Promise<DriverAdoption> {
    this.swept = false;
    this.adopted.clear();
    const listed = await bounded(listRealmContainers(this.libpod));
    const secretDirs = secretDirsUnder(this.secretRoot);
    const info = await bounded(this.libpod.info());
    const inspected = await this.inspectAll(listed);
    const verdicts = inspected.map(({ container, inspect }) => this.verdictOf(container, inspect, roots, info.rootless));
    const adoptions = verdicts.filter((verdict): verdict is Adoption => verdict.kind === "adopt");
    const removals = verdicts.filter((verdict): verdict is Removal => verdict.kind === "remove");
    const keptSandboxes = new Set(adoptions.map((adoption) => adoption.sandboxName));
    const secretPlan: SecretPlan[] = secretDirs
      .filter((dir) => !keptSandboxes.has(dir.name))
      .map((dir) => ({ ...dir, entries: presentSecretEntries(dir.path) }));
    const removalFailure = await this.removeContainers(removals);
    const survivors = new Set((await bounded(listRealmContainers(this.libpod))).map((container) => container.id));
    if (removals.some((removal) => survivors.has(removal.containerId))) {
      throw makeRealmError("REALM_STOPPING", removalFailure);
    }
    const secretsRemoved = removeSecretPlan(secretPlan);
    for (const adoption of adoptions) {
      this.adopted.add(adoption.sandboxName);
    }
    this.swept = true;
    return {
      adopted: adoptions.map(({ sandboxName, containerId }) => ({ sandboxName, containerId })),
      removed: removals.map(({ containerId, cause }) => ({ containerId, cause })),
      secretsRemoved,
    };
  }

  // Creates, starts, and verifies one sandbox container, and returns its id. A conforming container is kept. Any
  // other outcome removes it before the error is thrown. Every refusal that the spec and the host can decide comes
  // before the first libpod request: the spec, the state directory, the workspace, the channel, and the name being free.
  // beforeStart runs once the container exists and before it starts; if it fails, the container is removed.
  async create(spec: ContainerSpec, beforeStart?: BeforeStart): Promise<string> {
    this.requireSwept();
    validateContainerSpec(spec);
    // The sweep removes only realm-prefixed names, so a container with any other name would escape it.
    if (!isRealmSandboxName(spec.sandboxName)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    const sandboxBinding = sandboxBindingOf(
      { workspaceRoot: spec.workspaceDir, stateRoot: this.sandboxStateRoot, secretRoot: this.secretRoot },
      spec.sandboxName,
    );
    assertSpecBinding(spec, sandboxBinding);
    assertSandboxStateDir(this.sandboxStateRoot, spec);
    assertNoOverlap(spec.workspaceDir, this.sandboxStateRoot, spec.stateDir);
    assertNoOverlapPair(spec.workspaceDir, spec.channelDir);
    assertStateDirClear(spec.stateDir);
    assertWorkspaceHasNoSocket(spec.workspaceDir, this.lstat);
    const info = await this.libpod.info();
    // A container of this name is a live sandbox this create did not make, so it is refused and never removed. The
    // check is by name, so a container without the sandbox label is refused too. A sandbox this start adopted is refused
    // by name as well, even when its container is gone, until delete removes it.
    const existing = await this.libpod.inspectContainer(spec.sandboxName);
    if (existing !== null || this.adopted.has(spec.sandboxName)) {
      throw makeRealmError("SANDBOX_NAME_IN_USE");
    }
    let id: string;
    try {
      id = await this.libpod.createContainer(spec);
    } catch (error) {
      // A 409 means another container already owns the name. This create did not make it, so the error is rethrown
      // and nothing is removed.
      if (codeOf(error) === "SANDBOX_NAME_IN_USE") {
        throw error;
      }
      // Any other failure may have left this create's own container. It is removed by name only when its labels show
      // it is this spec's sandbox, so a foreign container of the name is left alone.
      const removeCause = await this.discardOwnedByName(spec);
      if (error instanceof RealmError && removeCause !== undefined) {
        reportSurvivor(error, spec.sandboxName, removeCause);
      }
      throw error;
    }
    const binding: HardeningBinding = { image: spec.image, rootless: info.rootless, ...sandboxBinding };
    await this.checkBeforeStart(id);
    if (beforeStart !== undefined) {
      try {
        await beforeStart(id);
      } catch (error) {
        const removeCause = await this.discard(id);
        if (error instanceof RealmError && removeCause !== undefined) {
          reportSurvivor(error, id, removeCause);
        }
        throw error;
      }
    }
    await this.startAndVerify(id, binding);
    return id;
  }

  // Stops and force-removes the containers that are this sandbox's own, then removes the sandbox's state directory.
  // A container is this sandbox's own only when it carries the managed and sandbox-name labels, and its name is the
  // sandbox name. Every role of the sandbox counts. The name must be a realm sandbox name and one container-name-safe
  // segment. The directory is checked before any container is touched, and a symlink or other non-directory is refused,
  // never followed. Then the sandbox's secret entries (launch material, descriptor, auth bundle, channel) are removed from
  // its secret directory, and that directory when empty.
  async delete(sandboxName: string): Promise<void> {
    this.requireSwept();
    const dir = sandboxDirOf(this.sandboxStateRoot, sandboxName);
    const dirExists = sandboxDirExists(dir);
    // The secret directory follows the same name rule. Its entries are checked here, before any container is touched, so a
    // symbolic link or other wrong-kind entry there refuses the delete with nothing removed.
    const secretDir = secretDirOf(this.secretRoot, sandboxName);
    // Data-loss guard: a delete removes only this sandbox's state directory and its secret entries, and each must lie strictly inside
    // its root. The pinned workspace root lies outside both roots (the driver checks this at construction), so it is never removed.
    assertStrictlyInside(dir, this.sandboxStateRoot);
    assertStrictlyInside(secretDir, this.secretRoot);
    const secretEntries = presentSecretEntries(secretDir);
    const listed = await this.libpod.listContainersByLabel(OPENSHELL_SANDBOX_NAME_LABEL_KEY, sandboxName);
    for (const container of listed) {
      if (await isSandboxOwned(this.libpod, container, sandboxName)) {
        await this.libpod.stopContainer(container.id, STOP_GRACE_MS);
        await this.libpod.removeContainer(container.id, { force: true });
      }
    }
    // The sandbox's containers are gone, so an adopted record of the name no longer refuses a create of it.
    this.adopted.delete(sandboxName);
    if (dirExists) {
      try {
        this.removeDirectory(dir);
      } catch {
        // The removal's own error can carry the path, so it is not passed on. Only the catalogue code is reported.
        throw makeRealmError("CLEANUP_FAILED");
      }
    }
    removeSecretEntries(secretEntries);
    removeSecretDirIfEmpty(secretDir);
  }

  // Stops a sandbox's container by its name, for a sandbox whose host supervisor exited. The container is kept, so a later
  // delete removes it. A stop that fails is thrown to the caller.
  async stop(sandboxName: string): Promise<void> {
    this.requireSwept();
    await this.libpod.stopContainer(sandboxName, STOP_GRACE_MS);
  }

  // Starts the created container and proves it conforms. The verifier runs first, then the live capability proof and the two
  // checks it does not make. Any failure removes the container by id before the error is thrown. A State.Pid of 0, or one the
  // host cannot read, leaves the kernel capability sets unattached, so the live proof fails. The refusal keeps the original
  // hardening or start cause. A failed removal is named in its message, with the survivor's id and the cleanup code, and does
  // not replace that cause.
  private async startAndVerify(id: string, binding: HardeningBinding): Promise<void> {
    let failed: readonly LifecycleProperty[] | null = null;
    let causeCode: ErrorCode | undefined;
    try {
      await this.libpod.startContainer(id);
      const inspect = await this.libpod.inspectContainer(id);
      if (inspect !== null) {
        const attached = attachRuntimeEvidence(inspect, this.readOciConfig, this.readProcStatus);
        failed = [
          ...verifyInspect(binding, attached),
          ...liveCapabilityFailures(attached),
          ...postCreateFailures(inspect),
        ];
      }
    } catch (error) {
      causeCode = codeOf(error);
    }
    if (failed?.length === 0) {
      return;
    }
    await this.refuse(id, failed ?? [], causeCode);
  }

  // Removes the container by id, then throws the refusal for the failed properties. A failed removal is named in the refusal's
  // message, with the survivor's id and the cleanup code, and does not replace the refusal.
  private async refuse(id: string, failed: readonly LifecycleProperty[], causeCode: ErrorCode | undefined): Promise<never> {
    const removeCause = await this.discard(id);
    const [first, ...rest] = failed;
    const refusal =
      first !== undefined
        ? new HardeningRefusal([first, ...rest], causeCode)
        : makeRealmError("OPENSHELL_START_FAILED", causeCode);
    if (removeCause !== undefined) {
      reportSurvivor(refusal, id, removeCause);
    }
    throw refusal;
  }

  // The channel options of a container as created, checked before the runtime's files are written and before it starts (phase
  // 9.5, F). A container that cannot be inspected, or whose options do not match, is removed and refused, so it never runs.
  private async checkBeforeStart(id: string): Promise<void> {
    let failed: readonly LifecycleProperty[] | null = null;
    let causeCode: ErrorCode | undefined;
    try {
      const inspect = await this.libpod.inspectContainer(id);
      if (inspect !== null) {
        failed = channelOptionFailures(inspect);
      }
    } catch (error) {
      causeCode = codeOf(error);
    }
    if (failed?.length === 0) {
      return;
    }
    await this.refuse(id, failed ?? [], causeCode);
  }

  // Removes the container of the spec's name when it carries this spec's managed label and sandbox-name label. A
  // container that cannot be inspected, or that carries other labels, is not proven to be this create's, so it stays.
  private async discardOwnedByName(spec: ContainerSpec): Promise<ErrorCode | undefined> {
    let inspect: LibpodInspect | null;
    try {
      inspect = await this.libpod.inspectContainer(spec.sandboxName);
    } catch {
      return undefined;
    }
    if (inspect === null || !carriesSandboxLabels(inspect, spec.sandboxName)) {
      return undefined;
    }
    return this.discard(spec.sandboxName);
  }

  // Force-removes a container by id or name. A container already gone counts as removed. Returns the code of a
  // failed removal, so a survivor can be reported beside the original failure.
  private async discard(target: string): Promise<ErrorCode | undefined> {
    try {
      await this.libpod.removeContainer(target, { force: true });
      return undefined;
    } catch (error) {
      return codeOf(error);
    }
  }

  // Inspects every listed container. A container the engine reports absent is not a survivor. A failed inspect rejects the adoption,
  // with the code it carries, before any removal.
  private async inspectAll(
    listed: readonly LibpodContainerSummary[],
  ): Promise<{ container: LibpodContainerSummary; inspect: LibpodInspect }[]> {
    const inspected: { container: LibpodContainerSummary; inspect: LibpodInspect }[] = [];
    for (const container of listed) {
      let inspect: LibpodInspect | null;
      try {
        inspect = await bounded(this.libpod.inspectContainer(container.id));
      } catch (error: unknown) {
        throw asRealmError(error);
      }
      if (inspect !== null) {
        inspected.push({ container, inspect });
      }
    }
    return inspected;
  }

  // The verdict on one survivor. It is adopted when its name matches its sandbox, its binding rebuilds from its retained artifacts, and it
  // passes the checks create runs after start. Otherwise it is removed, with the cause.
  private verdictOf(container: LibpodContainerSummary, inspect: LibpodInspect, roots: AdoptionRoots, rootless: boolean): Verdict {
    const sandboxName = container.labels?.[OPENSHELL_SANDBOX_NAME_LABEL_KEY] ?? "";
    if (!namedAs(inspect, sandboxName)) {
      return { kind: "remove", containerId: container.id, cause: "no-record" };
    }
    const binding = this.rebuildBinding(sandboxName, roots, rootless);
    if (typeof binding === "string") {
      return { kind: "remove", containerId: container.id, cause: binding };
    }
    const failure = this.verificationFailure(inspect, binding);
    if (failure !== undefined) {
      return { kind: "remove", containerId: container.id, cause: failure };
    }
    return { kind: "adopt", sandboxName, containerId: container.id };
  }

  // The binding a sandbox's container must carry, rebuilt from the artifacts the driver retains for the sandbox: its workspace registry
  // entry, which names the workspace root, and its launch material. The state and channel directories are derived from the name, as create
  // derives them. The image comes from the driver's configuration and rootless from the engine. Returns the cause when the binding cannot be
  // rebuilt: no-record when nothing is retained for the sandbox, otherwise no-artifacts.
  private rebuildBinding(sandboxName: string, roots: AdoptionRoots, rootless: boolean): HardeningBinding | RemovalCause {
    try {
      const sessionId = sessionOfRealmSandbox(sandboxName);
      const entry = sessionId === undefined ? null : readWorkspaceEntry(roots.workspaceStateDir, sessionId);
      if (entry === null && !secretDirExists(this.secretRoot, sandboxName)) {
        return "no-record";
      }
      if (entry === null || !isInsideRoot(bindRoot(roots.workspaceCeiling), entry.workspaceRoot)) {
        return "no-artifacts";
      }
      const workspaceRoot = verifyWorkspaceEntry(entry).realPath;
      const secretDir = secretDirOf(this.secretRoot, sandboxName);
      if (!presentSecretEntries(secretDir).includes(join(secretDir, LAUNCH_FILE_NAME))) {
        return "no-artifacts";
      }
      const binding = sandboxBindingOf({ workspaceRoot, stateRoot: this.sandboxStateRoot, secretRoot: this.secretRoot }, sandboxName);
      return {
        image: roots.image,
        rootless,
        workspaceRoot: binding.workspaceRoot,
        stateDir: binding.stateDir,
        channelDir: binding.channelDir,
      };
    } catch {
      // An artifact that cannot be read or verified leaves the binding unbuilt, so the container is not verified.
      return "no-artifacts";
    }
  }

  // The first failed property of a survivor against its rebuilt binding, with the checks create runs after start: the verifier, the live
  // capability proof, and the workspace and terminal checks. Undefined when it conforms. A check that throws fails the survivor with the
  // code its error carries.
  private verificationFailure(inspect: LibpodInspect, binding: HardeningBinding): string | undefined {
    try {
      const attached = attachRuntimeEvidence(inspect, this.readOciConfig, this.readProcStatus);
      const failed: readonly LifecycleProperty[] = [
        ...verifyInspect(binding, attached),
        ...liveCapabilityFailures(attached),
        ...postCreateFailures(inspect),
      ];
      return failed[0];
    } catch (error: unknown) {
      return asRealmError(error).code;
    }
  }

  // Force-removes each container. A failed removal is not reported here: the listing that follows decides whether it is gone. Returns
  // the code of the first failed removal, which a rejection keeps.
  private async removeContainers(removals: readonly Removal[]): Promise<ErrorCode | undefined> {
    let failure: ErrorCode | undefined;
    for (const removal of removals) {
      try {
        await bounded(this.libpod.removeContainer(removal.containerId, { force: true }));
      } catch (error: unknown) {
        if (failure === undefined) {
          failure = asRealmError(error).code;
        }
      }
    }
    return failure;
  }

  // Refuses with REALM_NOT_ACTIVE until adoptSurvivors has resolved. create, delete and stop call it first; the compute driver calls it
  // before a create writes anything to disk, so no request touches the state or secret roots ahead of the sweep.
  requireSwept(): void {
    if (!this.swept) {
      throw makeRealmError("REALM_NOT_ACTIVE");
    }
  }
}

// The catalogue code of a RealmError, or undefined for any other error.
function codeOf(error: unknown): ErrorCode | undefined {
  return error instanceof RealmError ? error.code : undefined;
}

// The RealmError a failure reports. A failure that is not a RealmError has no catalogue code of its own, so it is SCHEMA_INVALID, as the
// sweep reports it.
function asRealmError(error: unknown): RealmError {
  return error instanceof RealmError ? error : makeRealmError("SCHEMA_INVALID");
}

// Bounds one libpod call by the sweep's per-call bound, so a hung engine cannot block the adoption. A call that does not answer in time
// gives PODMAN_MACHINE_DOWN, as the sweep's does.
function bounded<T>(call: Promise<T>): Promise<T> {
  return withTimeout(call, SWEEP_CALL_TIMEOUT_MS, "PODMAN_MACHINE_DOWN");
}

// Removes the planned secret entries of each sandbox directory, confirms by a presence check that none is left, then removes the directory
// when it is empty. Returns the sandboxes whose entries were removed.
function removeSecretPlan(plan: readonly SecretPlan[]): string[] {
  const removed: string[] = [];
  for (const { name, path, entries } of plan) {
    removeSecretEntries(entries);
    if (presentSecretEntries(path).length > 0) {
      throw makeRealmError("CLEANUP_FAILED");
    }
    removeSecretDirIfEmpty(path);
    if (entries.length > 0) {
      removed.push(name);
    }
  }
  return removed;
}

// Adds the survivor's id and the cleanup code to a refusal's message. The refusal keeps its code, its property, and
// its original cause; only the message gains the note.
function reportSurvivor(refusal: RealmError, survivorId: string, cleanupCode: ErrorCode): void {
  refusal.message = `${refusal.message} Cleanup failed: container ${survivorId} survived (cleanup code ${cleanupCode}).`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The real location of a path. A path that does not resolve is refused, and the error names no path.
function realPathOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// The state directory must be exactly <root>/<sandboxName>, with no symlink in any ancestor and none at the end.
// The given root and the given state directory must each already be their own real path. A symlink anywhere on the
// way makes the given path differ from its real path, so it is refused. The final component is also lstat-ed.
function assertSandboxStateDir(root: string, spec: ContainerSpec): void {
  const givenRoot = resolve(root);
  const givenDir = resolve(spec.stateDir);
  if (
    givenDir !== join(givenRoot, spec.sandboxName) ||
    realPathOf(givenRoot) !== givenRoot ||
    realPathOf(givenDir) !== givenDir
  ) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  let isDirectory: boolean;
  try {
    isDirectory = lstatSync(givenDir).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// The container's state and channel directories must be the sandbox binding's, so the mounts it is created with are the paths the
// verifier checks. A spec that names other paths is refused before any libpod call.
function assertSpecBinding(spec: ContainerSpec, binding: SandboxBinding): void {
  if (spec.stateDir !== binding.stateDir || spec.channelDir !== binding.channelDir) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// True when child is parent or lies inside it.
function within(child: string, parent: string): boolean {
  const prefix = parent.endsWith(sep) ? parent : parent + sep;
  return child === parent || child.startsWith(prefix);
}

// Refuses a removal target that does not lie strictly inside its root, on resolved paths. Every delete target is derived from a
// validated sandbox name, so this holds for every delete; the check keeps the removal structurally unable to reach the root itself.
function assertStrictlyInside(target: string, root: string): void {
  const rel = relative(resolve(root), resolve(target));
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// The workspace, the state root and the state directory must not overlap in either direction, on real paths. The
// workspace is bound read-write, so it must not contain the state directory or the state root, and must not sit inside
// either of them.
function assertNoOverlap(workspaceDir: string, stateRoot: string, stateDir: string): void {
  const workspace = realPathOf(workspaceDir);
  const root = realPathOf(stateRoot);
  const dir = realPathOf(stateDir);
  const overlaps = (a: string, b: string): boolean => within(a, b) || within(b, a);
  if (overlaps(workspace, dir) || overlaps(workspace, root)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// The workspace and the channel must not overlap in either direction, on real paths. Both are bound read-write.
function assertNoOverlapPair(workspaceDir: string, channelDir: string): void {
  const workspace = realPathOf(workspaceDir);
  const channel = realPathOf(channelDir);
  if (within(workspace, channel) || within(channel, workspace)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// Refuses a state directory that a sandbox must not bind (C5): one holding any socket, or a secret-named entry
// that group or world can access. The error names no path. The driver also runs it on a stale directory before reclaiming it.
export function assertStateDirClear(stateDir: string): void {
  visitTree(stateDir, (path, entry) => {
    if (entry.isSocket()) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    const secretAndOpen =
      SECRET_NAME_PATTERN.test(relative(stateDir, path)) && (lstatSync(path).mode & GROUP_OR_WORLD_BITS) !== 0;
    if (secretAndOpen) {
      throw makeRealmError("SCHEMA_INVALID");
    }
  });
}

// Refuses a workspace that holds any socket, or a directory on another device than the workspace's, since the workspace is bound
// into the container read-write. A directory whose device differs from the workspace root's is a mount of another filesystem
// nested in the workspace, which the container would reach through the workspace mount, so it is refused. A bind mount of a
// directory on the same filesystem shares its parent's device, and a file bind mount is not a directory, so neither is detected
// by this scan. The root's device is read from its real path, so a symlinked workspace root compares its target's device and not
// the link's. The scan runs at create only. A socket or a mount made in the workspace after the container starts is not
// detected: the owner accepted that as a residual risk, and a re-scan at ListSandboxes would walk the whole tree synchronously on
// the event loop.
function assertWorkspaceHasNoSocket(workspaceDir: string, lstat: (path: string) => Pick<Stats, "dev">): void {
  const rootDevice = deviceOf(realPathOf(workspaceDir), lstat);
  visitTree(workspaceDir, (path, entry) => {
    if (entry.isSocket()) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    if (entry.isDirectory() && lstat(path).dev !== rootDevice) {
      throw makeRealmError("SCHEMA_INVALID");
    }
  });
}

// The device of a path, or SCHEMA_INVALID when it cannot be read. The error names no path.
function deviceOf(path: string, lstat: (path: string) => Pick<Stats, "dev">): number {
  try {
    return lstat(path).dev;
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// Visits every entry under dir, depth first, without following a symlink: a symlink is an entry and is never
// entered. Any read failure, or any refusal the visitor throws, becomes SCHEMA_INVALID. The error names no path.
// A tree that cannot be read cannot be proven clear, so it is refused as well.
function visitTree(dir: string, visit: (path: string, entry: Dirent) => void): void {
  try {
    walkTree(dir, visit);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

function walkTree(dir: string, visit: (path: string, entry: Dirent) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    visit(path, entry);
    if (entry.isDirectory()) {
      walkTree(path, visit);
    }
  }
}

// The checks the verifier does not make. C1: every workspace mount carries noexec, nosuid and nodev. C6: the
// container has no terminal. A missing field fails closed.
function postCreateFailures(inspect: LibpodInspect): LifecycleProperty[] {
  const failures: LifecycleProperty[] = [];
  if (!workspaceOptionsSafe(inspect)) {
    failures.push("mounts-options");
  }
  if (!ttyOff(inspect)) {
    failures.push("tty");
  }
  return failures;
}

function workspaceOptionsSafe(inspect: LibpodInspect): boolean {
  const mounts: unknown = inspect["Mounts"];
  if (!Array.isArray(mounts)) {
    return false;
  }
  const entries: readonly unknown[] = mounts;
  const workspace = entries.filter(
    (mount) => isRecord(mount) && mount["Destination"] === HARDENING_PROFILE.workspaceDestination,
  );
  return (
    workspace.length > 0 &&
    workspace.every((mount) => isRecord(mount) && hasWorkspaceOptions(mount["Options"]))
  );
}

function hasWorkspaceOptions(options: unknown): boolean {
  if (!Array.isArray(options)) {
    return false;
  }
  const entries: readonly unknown[] = options;
  return WORKSPACE_REQUIRED_OPTIONS.every((option) => entries.includes(option));
}

function ttyOff(inspect: LibpodInspect): boolean {
  const config: unknown = inspect["Config"];
  return isRecord(config) && config["Tty"] === false;
}

// True when the inspect carries this spec's managed label and sandbox-name label.
function carriesSandboxLabels(inspect: LibpodInspect, sandboxName: string): boolean {
  const config: unknown = inspect["Config"];
  const labels: unknown = isRecord(config) ? config["Labels"] : undefined;
  return (
    isRecord(labels) &&
    labels[OPENSHELL_MANAGED_LABEL_KEY] === OPENSHELL_MANAGED_LABEL_VALUE &&
    labels[OPENSHELL_SANDBOX_NAME_LABEL_KEY] === sandboxName
  );
}

// A listed container is the sandbox's own only when it carries the managed and sandbox-name labels, and its name is
// the sandbox name. Any other container that carries the sandbox-name label is left alone.
async function isSandboxOwned(
  libpod: LifecycleLibpod,
  container: LibpodContainerSummary,
  sandboxName: string,
): Promise<boolean> {
  const labels: Readonly<Record<string, string>> = container.labels ?? {};
  if (
    labels[OPENSHELL_MANAGED_LABEL_KEY] !== OPENSHELL_MANAGED_LABEL_VALUE ||
    labels[OPENSHELL_SANDBOX_NAME_LABEL_KEY] !== sandboxName
  ) {
    return false;
  }
  const inspect = await libpod.inspectContainer(container.id);
  return inspect !== null && namedAs(inspect, sandboxName);
}

// True when the inspect's name is the sandbox name. Podman reports the bare name; a leading slash, if present, is
// removed once so both forms match.
function namedAs(inspect: LibpodInspect, sandboxName: string): boolean {
  const name: unknown = inspect["Name"];
  if (typeof name !== "string") {
    return false;
  }
  return (name.startsWith("/") ? name.slice(1) : name) === sandboxName;
}

// The sandbox's own state directory: the state root joined with the sandbox name. The name must be a realm sandbox name
// and one container-name-safe segment, which admits no separator, so the join stays under the root.
function sandboxDirOf(root: string, sandboxName: string): string {
  if (!isRealmSandboxName(sandboxName) || !CONTAINER_ID_PATTERN.test(sandboxName)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return join(root, sandboxName);
}

// True when the sandbox directory exists and is a real directory. Absent is false. A symlink or any other entry
// is refused, so it is never removed or followed.
function sandboxDirExists(dir: string): boolean {
  const stat = lstatOrAbsent(dir, "SCHEMA_INVALID");
  if (stat === null) {
    return false;
  }
  if (!stat.isDirectory()) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return true;
}

// Removes a sandbox directory and its contents. rm does not follow a symlink inside the tree.
function removeTree(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// The entry at path, or null when it is absent. Any other lstat failure is reported as the given code; the error
// names no path.
function lstatOrAbsent(path: string, failure: ErrorCode): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw makeRealmError(failure);
  }
}

// The secret root must be absolute, must be neither the bound state directory nor inside it, and must not be a
// symbolic link. A missing secret root is allowed; the store creates it at the first write, and the sweep and delete
// then have nothing to remove there.
function assertSecretRoot(secretRoot: string, stateRoot: string): void {
  if (!isAbsolute(secretRoot) || within(resolve(secretRoot), resolve(stateRoot))) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const stat = lstatOrAbsent(resolve(secretRoot), "SCHEMA_INVALID");
  if (stat !== null && stat.isSymbolicLink()) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}
