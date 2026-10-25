// Hardened container lifecycle of the driver (phase 9.3, PRD-CTR-01..03). create builds the container from a
// typed spec, starts it, and proves it conforms before it is returned. delete removes a sandbox's own containers and
// its own state directory. startupSweep removes every realm-labelled container before any request is accepted.
//
// Everything here goes through the closed libpod client (PD-11). The verifier is the same one session-execution
// uses (PD-13): verifyInspect over HARDENING_PROFILE, with the kernel capability sets attached from the host's
// /proc. The checks the verifier does not make are added here, after it. The state root is a constructor argument;
// this module reads no host environment.

import { lstatSync, readdirSync, realpathSync, rmSync, type Dirent, type Stats } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { makeRealmError, RealmError, type ErrorCode } from "../../core/errors.js";
import { attachKernelCaps, readHostProcStatus } from "../kernel-caps.js";
import { HARDENING_PROFILE, verifyInspect, type HardeningBinding, type HardeningProperty } from "../hardening.js";
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
} from "../openshell.js";
import { removeAllRealmContainers } from "../sweep.js";

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

export interface DriverLifecycleOptions {
  readonly libpod: LifecycleLibpod;
  // Absolute root of the per-sandbox state directories. A sandbox's state directory is exactly <root>/<sandboxName>.
  readonly sandboxStateRoot: string;
  // Reads the text of a host process's status file. The create-time check reads the init process through it (D-51).
  readonly readProcStatus?: ((pid: number) => string) | undefined;
  // Removes a sandbox's state directory tree. The default removes it without following a symlink inside the tree.
  readonly removeDirectory?: ((dir: string) => void) | undefined;
}

// A property a container is refused for: the verifier's fourteen (D-51), then the two checks made after it.
// "mounts-options" is the workspace mount's options (C1). "tty" is a container that has a terminal (C6).
export type LifecycleProperty = HardeningProperty | "mounts-options" | "tty";

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

export class DriverLifecycle {
  private readonly libpod: LifecycleLibpod;
  private readonly sandboxStateRoot: string;
  private readonly readProcStatus: (pid: number) => string;
  private readonly removeDirectory: (dir: string) => void;
  private swept = false;

  constructor(options: DriverLifecycleOptions) {
    if (!isAbsolute(options.sandboxStateRoot)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    this.libpod = options.libpod;
    this.sandboxStateRoot = options.sandboxStateRoot;
    this.readProcStatus = options.readProcStatus ?? readHostProcStatus;
    this.removeDirectory = options.removeDirectory ?? removeTree;
  }

  // Removes every realm-owned container and resolves with how many it removed. create and delete refuse with
  // REALM_NOT_ACTIVE until this has resolved, so no request is accepted ahead of the sweep (PRD-CTR-03).
  async startupSweep(): Promise<number> {
    this.swept = false;
    const removed = await removeAllRealmContainers(this.libpod);
    this.swept = true;
    return removed;
  }

  // Creates, starts, and verifies one sandbox container, and returns its id. A conforming container is kept. Any
  // other outcome removes it before the error is thrown. Every refusal that the spec and the host can decide comes
  // before the first libpod request: the spec, the state directory, the workspace, and the name being free.
  async create(spec: ContainerSpec): Promise<string> {
    this.requireSwept();
    validateContainerSpec(spec);
    // The sweep removes only realm-prefixed names, so a container with any other name would escape it.
    if (!isRealmSandboxName(spec.sandboxName)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    assertSandboxStateDir(this.sandboxStateRoot, spec);
    assertNoOverlap(spec.workspaceDir, this.sandboxStateRoot, spec.stateDir);
    assertStateDirClear(spec.stateDir);
    assertWorkspaceHasNoSocket(spec.workspaceDir);
    const info = await this.libpod.info();
    // A container of this name is a live sandbox this create did not make, so it is refused and never removed. The
    // check is by name, so a container without the sandbox label is refused too.
    const existing = await this.libpod.inspectContainer(spec.sandboxName);
    if (existing !== null) {
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
    const binding: HardeningBinding = {
      image: spec.image,
      rootless: info.rootless,
      workspaceRoot: spec.workspaceDir,
      stateDir: spec.stateDir,
    };
    await this.startAndVerify(id, binding);
    return id;
  }

  // Stops and force-removes the containers that are this sandbox's own, then removes the sandbox's state directory.
  // A container is this sandbox's own only when it carries the managed and sandbox-name labels, and its name is the
  // sandbox name. Every role of the sandbox counts, the supervisor included. The name must be a realm sandbox name and
  // one container-name-safe segment. The directory
  // is checked before any container is touched, and a symlink or other non-directory is refused, never followed.
  async delete(sandboxName: string): Promise<void> {
    this.requireSwept();
    const dir = sandboxDirOf(this.sandboxStateRoot, sandboxName);
    const dirExists = sandboxDirExists(dir);
    const listed = await this.libpod.listContainersByLabel(OPENSHELL_SANDBOX_NAME_LABEL_KEY, sandboxName);
    for (const container of listed) {
      if (await isSandboxOwned(this.libpod, container, sandboxName)) {
        await this.libpod.stopContainer(container.id, STOP_GRACE_MS);
        await this.libpod.removeContainer(container.id, { force: true });
      }
    }
    if (dirExists) {
      try {
        this.removeDirectory(dir);
      } catch {
        // The removal's own error can carry the path, so it is not passed on. Only the catalogue code is reported.
        throw makeRealmError("CLEANUP_FAILED");
      }
    }
  }

  // Starts the created container and proves it conforms. The verifier runs first, then the two checks it does not
  // make. Any failure removes the container by id before the error is thrown. A State.Pid of 0, or one the host
  // cannot read, leaves the kernel capability sets unattached, so cap-drop fails. The refusal keeps the original
  // hardening or start cause. A failed removal is named in its message, with the survivor's id and the cleanup code,
  // and does not replace that cause.
  private async startAndVerify(id: string, binding: HardeningBinding): Promise<void> {
    let failed: readonly LifecycleProperty[] | null = null;
    let causeCode: ErrorCode | undefined;
    try {
      await this.libpod.startContainer(id);
      const inspect = await this.libpod.inspectContainer(id);
      if (inspect !== null) {
        failed = [
          ...verifyInspect(binding, attachKernelCaps(inspect, this.readProcStatus)),
          ...postCreateFailures(inspect),
        ];
      }
    } catch (error) {
      causeCode = codeOf(error);
    }
    if (failed?.length === 0) {
      return;
    }
    const removeCause = await this.discard(id);
    const [first, ...rest] = failed ?? [];
    const refusal =
      first !== undefined
        ? new HardeningRefusal([first, ...rest], causeCode)
        : makeRealmError("OPENSHELL_START_FAILED", causeCode);
    if (removeCause !== undefined) {
      reportSurvivor(refusal, id, removeCause);
    }
    throw refusal;
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

  private requireSwept(): void {
    if (!this.swept) {
      throw makeRealmError("REALM_NOT_ACTIVE");
    }
  }
}

// The catalogue code of a RealmError, or undefined for any other error.
function codeOf(error: unknown): ErrorCode | undefined {
  return error instanceof RealmError ? error.code : undefined;
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

// True when child is parent or lies inside it.
function within(child: string, parent: string): boolean {
  const prefix = parent.endsWith(sep) ? parent : parent + sep;
  return child === parent || child.startsWith(prefix);
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

// Refuses a state directory that a sandbox must not bind (C5): one holding any socket, or a secret-named entry
// that group or world can access. The error names no path.
function assertStateDirClear(stateDir: string): void {
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

// Refuses a workspace that holds any socket, since the workspace is bound into the container read-write.
function assertWorkspaceHasNoSocket(workspaceDir: string): void {
  visitTree(workspaceDir, (_path, entry) => {
    if (entry.isSocket()) {
      throw makeRealmError("SCHEMA_INVALID");
    }
  });
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

// The sandbox's own directory: the state root joined with the sandbox name. The name must be a realm sandbox name
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
  let stat: Stats;
  try {
    stat = lstatSync(dir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw makeRealmError("SCHEMA_INVALID");
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
