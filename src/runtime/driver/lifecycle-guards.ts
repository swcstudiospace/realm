// Tree guards of the driver's sandbox lifecycle. create runs them on a spec and its host paths before the first libpod call: the
// state directory, the binding the spec must carry, the overlaps between workspace, state and channel, the state directory's
// secret-named entries and sockets, and the sockets and foreign-device directories of the workspace. Each refusal is a catalogue
// code, and no path text leaves this module. The path helpers shared with the other driver modules are in fs-guards.ts.

import { lstatSync, readdirSync, type Dirent, type Stats } from "node:fs";
import { join, relative, resolve } from "node:path";
import { makeRealmError } from "../../core/errors.js";
import type { ContainerSpec } from "../libpod-client.js";
import { isInsideInclusive, realPathOrRefuse } from "./fs-guards.js";
import type { SandboxBinding } from "./sandbox-binding.js";

// C5. An entry whose path under the state directory matches this names a secret. Such an entry (file or directory)
// must carry no group or world permission bit. The pattern is deliberately broad: a false match only refuses a
// create, which fails closed. It matches case-insensitively.
const SECRET_NAME_PATTERN =
  /secret|token|credential|passw|private|apikey|id_rsa|id_ed25519|kubeconfig|\.npmrc|\.netrc|\.pgpass|\.htpasswd|\.key$|\.pem$|\.env$|\.p12$|\.pfx$|\.jks$/i;
const GROUP_OR_WORLD_BITS = 0o077;

// The state directory must be exactly <root>/<sandboxName>, with no symlink in any ancestor and none at the end.
// The given root and the given state directory must each already be their own real path. A symlink anywhere on the
// way makes the given path differ from its real path, so it is refused. The final component is also lstat-ed.
export function assertSandboxStateDir(root: string, spec: ContainerSpec): void {
  const givenRoot = resolve(root);
  const givenDir = resolve(spec.stateDir);
  if (
    givenDir !== join(givenRoot, spec.sandboxName) ||
    realPathOrRefuse(givenRoot) !== givenRoot ||
    realPathOrRefuse(givenDir) !== givenDir
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
export function assertSpecBinding(spec: ContainerSpec, binding: SandboxBinding): void {
  if (spec.stateDir !== binding.stateDir || spec.channelDir !== binding.channelDir) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// The workspace, the state root and the state directory must not overlap in either direction, on real paths. The
// workspace is bound read-write, so it must not contain the state directory or the state root, and must not sit inside
// either of them.
export function assertNoOverlap(workspaceDir: string, stateRoot: string, stateDir: string): void {
  const workspace = realPathOrRefuse(workspaceDir);
  const root = realPathOrRefuse(stateRoot);
  const dir = realPathOrRefuse(stateDir);
  const overlaps = (a: string, b: string): boolean => isInsideInclusive(b, a) || isInsideInclusive(a, b);
  if (overlaps(workspace, dir) || overlaps(workspace, root)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// The workspace and the channel must not overlap in either direction, on real paths. Both are bound read-write.
export function assertNoOverlapPair(workspaceDir: string, channelDir: string): void {
  const workspace = realPathOrRefuse(workspaceDir);
  const channel = realPathOrRefuse(channelDir);
  if (isInsideInclusive(channel, workspace) || isInsideInclusive(workspace, channel)) {
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
export function assertWorkspaceHasNoSocket(workspaceDir: string, lstat: (path: string) => Pick<Stats, "dev">): void {
  const rootDevice = deviceOf(realPathOrRefuse(workspaceDir), lstat);
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
