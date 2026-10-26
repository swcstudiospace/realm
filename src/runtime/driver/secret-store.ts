// The driver's secret directories (phase 9.5, wave 1d). A sandbox's secret directory is <secretRoot>/<sandboxName>. It is
// never bound into a container and never under the state root or the workspace. It holds the gateway's launch material
// (launch.json), the active marker, and the staging copy launch.json is written under before the atomic rename.
//
// The rules: the root and the sandbox directory are owned by the realm account and carry no group or world permission bit;
// no entry is a symbolic link, and none is followed. A write creates a new sandbox directory and refuses one that exists,
// so launch material is never overwritten. Removal deletes only the named secret files, then the directory when it is empty.
// Every refusal is SCHEMA_INVALID, or CLEANUP_FAILED for a removal, and names no path or value.

import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";
import { makeRealmError, RealmError, type ErrorCode } from "../../core/errors.js";
import { CONTAINER_ID_PATTERN } from "../libpod-routes.js";
import { isRealmSandboxName } from "../openshell.js";

export const LAUNCH_FILE_NAME = "launch.json";
const LAUNCH_STAGING_NAME = "launch.json.tmp";
const ACTIVE_FILE_NAME = "active";
// The files of a sandbox's secret directory that removal deletes. The staging copy is included, so a crash mid-write
// leaves nothing behind once the sweep or a delete runs.
const SECRET_FILE_NAMES: readonly string[] = Object.freeze([LAUNCH_FILE_NAME, LAUNCH_STAGING_NAME, ACTIVE_FILE_NAME]);
const GROUP_OR_WORLD_BITS = 0o077;
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

// The sandbox's own secret directory. The name must be a realm sandbox name and one container-name-safe segment, which admits
// no separator, so the join stays under the root.
export function secretDirOf(root: string, sandboxName: string): string {
  if (!isRealmSandboxName(sandboxName) || !CONTAINER_ID_PATTERN.test(sandboxName)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return join(root, sandboxName);
}

// True when the sandbox's secret directory exists in any form. A root that cannot be read is refused.
export function secretDirExists(root: string, sandboxName: string): boolean {
  return lstatOrAbsent(secretDirOf(root, sandboxName), "SCHEMA_INVALID") !== null;
}

// Writes the launch material of a new sandbox. The root is created at 0700 when absent. The sandbox's directory must not
// exist; it is created at 0700, and launch.json is written at 0600 through a staging file and a rename. A refusal after the
// directory was created removes what this call wrote, so a failed write leaves nothing.
export function writeLaunchMaterial(root: string, sandboxName: string, body: Uint8Array): void {
  const dir = secretDirOf(root, sandboxName);
  ensurePrivateRoot(root);
  let created = false;
  try {
    mkdirSync(dir, { mode: PRIVATE_DIR_MODE });
    created = true;
    assertPrivateDir(dir);
    writeFileAtomically(dir, body);
  } catch (error: unknown) {
    if (created) {
      discardWritten(dir);
    }
    throw error instanceof RealmError ? error : makeRealmError("SCHEMA_INVALID");
  }
}

// The launch material of a sandbox, or undefined when it has none. A link, a non-regular file, a file that a group or
// world can read, or a directory the realm account does not own is refused.
export function readLaunchMaterial(root: string, sandboxName: string): Uint8Array | undefined {
  const dir = secretDirOf(root, sandboxName);
  if (lstatOrAbsent(dir, "SCHEMA_INVALID") === null) {
    return undefined;
  }
  assertPrivateDir(root);
  assertPrivateDir(dir);
  let fd: number;
  try {
    fd = openSync(join(dir, LAUNCH_FILE_NAME), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (errorCodeOf(error) === "ENOENT") {
      return undefined;
    }
    throw makeRealmError("SCHEMA_INVALID");
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || !ownedByRealm(stat) || (stat.mode & GROUP_OR_WORLD_BITS) !== 0) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return readFileSync(fd);
  } catch (error: unknown) {
    throw error instanceof RealmError ? error : makeRealmError("SCHEMA_INVALID");
  } finally {
    closeSync(fd);
  }
}

// The secret files of the sandbox's directory that exist. They are checked before anything is removed. A missing directory
// has none. A symbolic link or other non-regular entry at a secret name is refused, and is never followed or removed.
export function presentSecretFiles(dir: string): string[] {
  if (!directoryExists(dir)) {
    return [];
  }
  const present: string[] = [];
  for (const name of SECRET_FILE_NAMES) {
    const path = join(dir, name);
    const stat = lstatOrAbsent(path, "CLEANUP_FAILED");
    if (stat === null) {
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    present.push(path);
  }
  return present;
}

// Removes the given secret files. A file already gone is not an error; any other failure is refused.
export function removeSecretFiles(paths: readonly string[]): void {
  for (const path of paths) {
    try {
      unlinkSync(path);
    } catch (error: unknown) {
      if (errorCodeOf(error) !== "ENOENT") {
        throw makeRealmError("CLEANUP_FAILED");
      }
    }
  }
}

// Removes the sandbox's secret directory when it holds nothing. A missing directory is fine; a directory that still holds an
// entry is left as it is.
export function removeSecretDirIfEmpty(dir: string): void {
  if (!directoryExists(dir)) {
    return;
  }
  try {
    if (readdirSync(dir).length === 0) {
      rmdirSync(dir);
    }
  } catch {
    throw makeRealmError("CLEANUP_FAILED");
  }
}

// Removes one sandbox's secret files and its directory when it is then empty.
export function removeSandboxSecrets(root: string, sandboxName: string): void {
  const dir = secretDirOf(root, sandboxName);
  removeSecretFiles(presentSecretFiles(dir));
  removeSecretDirIfEmpty(dir);
}

// Removes the secret files of every sandbox under the root, at startup. An absent root has none. A symbolic link anywhere
// under the root is refused before anything is removed, so the sweep never follows a link.
export function removeAllSecrets(root: string): void {
  if (lstatOrAbsent(root, "SCHEMA_INVALID") === null) {
    return;
  }
  assertDirectory(root);
  const dirs: string[] = [];
  for (const name of listDirectory(root)) {
    const path = join(root, name);
    const stat = lstatOrAbsent(path, "SCHEMA_INVALID");
    if (stat === null) {
      continue;
    }
    if (stat.isSymbolicLink()) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    if (stat.isDirectory()) {
      dirs.push(path);
    }
  }
  for (const dir of dirs) {
    removeSecretFiles(presentSecretFiles(dir));
    removeSecretDirIfEmpty(dir);
  }
}

// The root is created at 0700 when absent, then must be a private directory the realm account owns.
function ensurePrivateRoot(root: string): void {
  try {
    mkdirSync(root, { mode: PRIVATE_DIR_MODE });
  } catch (error: unknown) {
    if (errorCodeOf(error) !== "EEXIST") {
      throw makeRealmError("SCHEMA_INVALID");
    }
  }
  assertPrivateDir(root);
}

// Writes the body to the staging name at 0600, flushes it, and renames it onto launch.json. The directory is flushed after.
function writeFileAtomically(dir: string, body: Uint8Array): void {
  const staging = join(dir, LAUNCH_STAGING_NAME);
  const fd = openSync(
    staging,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    PRIVATE_FILE_MODE,
  );
  try {
    fchmodSync(fd, PRIVATE_FILE_MODE);
    let written = 0;
    while (written < body.length) {
      written += writeSync(fd, body, written, body.length - written);
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(staging, join(dir, LAUNCH_FILE_NAME));
  const dirFd = openSync(dir, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
}

// Removes what a failed write of this directory left. Best effort: a failure here leaves the directory for the sweep.
function discardWritten(dir: string): void {
  for (const name of SECRET_FILE_NAMES) {
    try {
      unlinkSync(join(dir, name));
    } catch {
      // Absent, or already removed by the failure. The directory removal below reports what remains.
    }
  }
  try {
    rmdirSync(dir);
  } catch {
    // The directory still holds an entry the write did not make; it is left for the sweep.
  }
}

function assertPrivateDir(path: string): void {
  const stat = lstatOrAbsent(path, "SCHEMA_INVALID");
  if (stat === null || !stat.isDirectory() || !ownedByRealm(stat) || (stat.mode & GROUP_OR_WORLD_BITS) !== 0) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

function assertDirectory(path: string): void {
  const stat = lstatOrAbsent(path, "SCHEMA_INVALID");
  if (stat === null || !stat.isDirectory()) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

function directoryExists(dir: string): boolean {
  const stat = lstatOrAbsent(dir, "SCHEMA_INVALID");
  if (stat === null) {
    return false;
  }
  if (!stat.isDirectory()) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return true;
}

function listDirectory(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// The realm account is the process user. A stat with no uid check is never trusted, so an unknown user refuses.
function ownedByRealm(stat: Stats): boolean {
  const uid = process.getuid?.();
  return uid !== undefined && stat.uid === uid;
}

// The entry at path, or null when it is absent. Any other lstat failure is reported as the given code; the error names no path.
function lstatOrAbsent(path: string, failure: ErrorCode): Stats | null {
  try {
    return lstatSync(path);
  } catch (error: unknown) {
    if (errorCodeOf(error) === "ENOENT") {
      return null;
    }
    throw makeRealmError(failure);
  }
}

function errorCodeOf(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
