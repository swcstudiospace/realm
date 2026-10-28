// Delivery of the sandbox seccomp profile (phase 9.6). Podman reads the profile from a file the create request names, so the driver
// writes the embedded profile to disk before it binds its socket and before it accepts any request.
//
// The file lives in a `seccomp` directory next to the driver socket, that is, inside the socket's parent directory. That parent is
// already held to mode 0700, owned by the realm account, and it is never a container mount source: a sandbox mounts only its
// workspace, its own state directory and its own channel directory, and the lifecycle refuses a workspace or state directory that
// holds any socket, which the driver's socket in the same parent would be. The sandbox workload shares the realm account's kernel uid
// under keep-id, so file permissions alone would not stop it; keeping the directory out of every mount is what does.
//
// The file name carries the first 16 hex digits of the profile's SHA-256, so a file of that name with other content is not an older
// version of the profile: it is a tampered or damaged file. The driver then refuses to start and leaves the file as it found it. A
// refusal throws a catalogue error and names no path.

import { lstatSync, mkdirSync, chmodSync, realpathSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { makeRealmError } from "../../core/errors.js";
import { atomicWriteFile, observeSha256 } from "../../fs/atomic-write.js";
import { SECCOMP_PROFILE_FILE_NAME, SECCOMP_PROFILE_SHA256, SECCOMP_PROFILE_TEXT } from "./seccomp-profile.js";
import { accountUid, prepareParent } from "./server.js";

// The directory name under the socket's parent.
export const SECCOMP_DIRECTORY_NAME = "seccomp";

const DIRECTORY_MODE = 0o700;
const PERMISSION_BITS = 0o777;
// Any write bit for the group or for others.
const GROUP_OR_WORLD_WRITE_BITS = 0o022;

// Writes the profile next to the driver socket and returns the absolute path of the file, on the real path of its directory. It
// creates the socket's parent and the `seccomp` directory at mode 0700 when they are missing. It refuses, with SCHEMA_INVALID, when
// the socket path is not absolute; when the directory is a symbolic link, is not a directory, belongs to another account, or is
// writable by the group or others; when the file is not a regular file owned by this account that others cannot write; and when a
// file of the profile's name holds other content. An existing file with the profile's content is left as it is.
export function installSeccompProfile(socketPath: string): string {
  if (!isAbsolute(socketPath)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const uid = accountUid();
  const parent = dirname(socketPath);
  prepareParent(parent, uid);
  const directory = join(parent, SECCOMP_DIRECTORY_NAME);
  ensureOwnDirectory(directory, uid);
  const path = join(realPathOf(directory), SECCOMP_PROFILE_FILE_NAME);
  const observed = observeProfile(path, uid);
  if (observed === null) {
    atomicWriteFile(path, SECCOMP_PROFILE_TEXT, { expectedPriorSha256: null });
  } else if (observed !== SECCOMP_PROFILE_SHA256) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return path;
}

// Creates the directory at 0700 when it is absent, then holds it to the rules. A symbolic link is refused, never followed.
function ensureOwnDirectory(directory: string, uid: number): void {
  let stat = lstatOrNull(directory);
  if (stat === null) {
    try {
      mkdirSync(directory, { mode: DIRECTORY_MODE });
    } catch {
      throw makeRealmError("SCHEMA_INVALID");
    }
    stat = lstatOrNull(directory);
  }
  if (
    stat === null ||
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    stat.uid !== uid ||
    (stat.mode & GROUP_OR_WORLD_WRITE_BITS) !== 0
  ) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if ((stat.mode & PERMISSION_BITS) !== DIRECTORY_MODE) {
    chmodSync(directory, DIRECTORY_MODE);
  }
}

// The SHA-256 of the file when it exists and may be trusted as a file the driver wrote, or null when it is absent.
function observeProfile(path: string, uid: number): string | null {
  const stat = lstatOrNull(path);
  if (stat === null) {
    return null;
  }
  if (!stat.isFile() || stat.uid !== uid || (stat.mode & GROUP_OR_WORLD_WRITE_BITS) !== 0) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return observeSha256(path);
}

function realPathOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// The entry at path, or null when it is absent. Any other lstat failure is a refusal.
function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw makeRealmError("SCHEMA_INVALID");
  }
}
