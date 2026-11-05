// The state and secret directories of a sandbox, the cleanup of a failed create, and the guards on the driver's roots and
// workspace ids. The guards refuse with a catalogue code or SCHEMA_INVALID, and no raw filesystem error leaves this module.

import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { makeRealmError, RealmError, type ErrorCode } from "../../core/errors.js";
import { CONTAINER_ID_PATTERN } from "../libpod-routes.js";
import { isRealmSandboxName, REALM_SANDBOX_NAME_PREFIX } from "../openshell.js";
import { isStrictlyInside, lstatOrAbsent, realPathOrRefuse } from "./fs-guards.js";
import { refusal, type RefusalCheck, type RefusalScope } from "./refusal.js";
import { removeSandboxSecrets } from "./secret-store.js";

export const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// The container name for a gateway sandbox name: the realm prefix is added when the name lacks it. Undefined when the
// result fails the container-name rule, which also bounds the length, so the caller refuses it.
export function containerNameOf(sandboxName: string): string | undefined {
  const name = isRealmSandboxName(sandboxName) ? sandboxName : `${REALM_SANDBOX_NAME_PREFIX}${sandboxName}`;
  return CONTAINER_ID_PATTERN.test(name) ? name : undefined;
}

// A new state directory must not exist yet, and its root must. Both are checked before anything is created, so a
// refusal here leaves the disk as it was. A leftover directory is never reused.
export function assertStateDirAbsent(stateDir: string): void {
  realPathOrRefuse(dirname(stateDir));
  if (lstatOrAbsent(stateDir, "SCHEMA_INVALID") !== null) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

export function mkdirOrRefuse(dir: string): void {
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// Removes the state directory a create made. Returns CLEANUP_FAILED when the removal failed, and the directory is left in place.
export function removeStateDir(dir: string): "CLEANUP_FAILED" | undefined {
  try {
    rmSync(dir, { recursive: true, force: true });
    return undefined;
  } catch {
    return "CLEANUP_FAILED";
  }
}

// Removes the launch material and the channel a create stored. Returns CLEANUP_FAILED when the removal failed, and they are left in place.
export function removeLaunchMaterial(secretRoot: string, sandboxName: string): "CLEANUP_FAILED" | undefined {
  try {
    removeSandboxSecrets(secretRoot, sandboxName);
    return undefined;
  } catch {
    return "CLEANUP_FAILED";
  }
}

// The catalogue code a failure is recorded under. A RealmError keeps its own code. Any other failure has none, so it is
// SCHEMA_INVALID, as the sweep reports it.
export function recordedCodeOf(error: unknown): ErrorCode {
  return error instanceof RealmError ? error.code : "SCHEMA_INVALID";
}

// Writes one refusal line for a failure a create records without rethrowing it: the RPC, the check that met it, and the code.
export function recordCode(scope: RefusalScope, check: RefusalCheck, code: ErrorCode): void {
  refusal(scope, check, code);
}

// The four failures the driver writes a cause line for. A cause line is not a refusal; the refusal line of the same request names its check.
export type CauseEvent = "supervisor stop failed" | "watch poll failed" | "stale sandbox inspect failed" | "workspace verify failed";

// Writes one cause line for a failure: the event and the catalogue code, to the scope's sink. It names no RPC and no check, and carries no value.
export function recordCause(scope: RefusalScope, event: CauseEvent, code: ErrorCode): void {
  scope.log(`realm compute driver ${event}: code=${code}`);
}

// The cleanup problems a failed create reports. Each names only what is true of the removal that failed.
export const SUPERVISOR_NOT_STOPPED = "The host supervisor did not stop.";
export const CONTAINER_NOT_REMOVED = "The container was not removed.";
export const CONTAINER_UNCONFIRMED = "The container's removal could not be confirmed.";
export const FILES_LEFT_IN_PLACE = "The sandbox state directory or launch material was left in place.";

// Adds the cleanup problems to a refusal's message. Only a RealmError carries a message the driver owns. A refusal with no
// problems is left as it is.
export function addCleanupNote(error: unknown, problems: readonly string[]): void {
  if (problems.length > 0 && error instanceof RealmError) {
    error.message = `${error.message} Cleanup failed: ${problems.join(" ")}`;
  }
}

// The two roots must not hold one another, or be the same path. The workspace ceiling holds the project directories bound read-write, so no
// state or secret directory may sit under it or hold it, and a delete of a sandbox's own directories can never reach it. Both are
// compared as resolved real paths.
export function assertApart(a: string, b: string): void {
  const left = resolvedPathOf(a);
  const right = resolvedPathOf(b);
  if (left === right || isStrictlyInside(left, right) || isStrictlyInside(right, left)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// The workspace id selects no directory: the sandbox's /workspace is the directory its registry entry names. The id is still checked.
export function assertWorkspaceId(workspace: string | undefined): void {
  if (workspace === undefined || !WORKSPACE_ID_PATTERN.test(workspace)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// A workspace, the ceiling or a sandbox's own directory, must be an absolute path to a real directory that the driver's account owns.
// A missing path, a symbolic link (checked with lstat, never followed), a file, or a directory another account owns is refused. The
// driver never creates, chmods or removes it, so a refusal here changes nothing.
export function assertPinnedWorkspaceRoot(root: string): void {
  const stat = lstatOrAbsent(root, "SCHEMA_INVALID");
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
