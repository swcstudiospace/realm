// State directory layout (D-37). The environment is passed in, so nothing here reads
// process.env and tests stay hermetic.

import { createHash } from "node:crypto";
import { join, posix } from "node:path";
import { makeRealmError } from "../core/errors.js";

export type EnvironmentLike = Readonly<Record<string, string | undefined>>;

// Session ids become file names, so they are limited to a safe character set.
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function sessionsDirOf(stateDir: string): string {
  return join(stateDir, "sessions");
}

// The control socket path is recorded in the session record and never created here
// (S-04, RT-06 is Phase 6).
export function controlSocketPath(stateDir: string): string {
  return join(stateDir, "run", "control.sock");
}

// True when a session id is in the safe set. The id names a file, so only these characters may appear.
export function isSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value);
}

// The record file name for a session id. An id outside the safe set is SCHEMA_INVALID.
export function recordFileName(sessionId: string): string {
  if (!isSessionId(sessionId)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return `${sessionId}.json`;
}

// Checkpoints (RES-04) live under the state directory, outside every workspace root. Each session has one
// directory, and each checkpoint has one directory inside it. Both names come from the safe session id set.
export function checkpointsDirOf(stateDir: string): string {
  return join(stateDir, "checkpoints");
}

export function checkpointSessionDirOf(stateDir: string, sessionId: string): string {
  if (!isSessionId(sessionId)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return join(checkpointsDirOf(stateDir), sessionId);
}

// The directory of one checkpoint. The checkpoint id is a directory name too, so it must be in the safe set.
export function checkpointDirOf(stateDir: string, sessionId: string, checkpointId: string): string {
  if (!isSessionId(checkpointId)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return join(checkpointSessionDirOf(stateDir, sessionId), checkpointId);
}

// Workspace identity (C1, MULTI-02). A project's session id is a function of its canonical path, so every
// alias of one directory names the same session and sandbox. sessionIdOfWorkspace is the one derivation.
export const WORKSPACE_SESSION_PREFIX = "p";
export const WORKSPACE_ID_HEX_LENGTH = 12;

// The sandbox name is "realm-" plus the session id. SANDBOX_NAME_MAX_LENGTH restates
// GATEWAY_SANDBOX_NAME_MAX_LENGTH (src/runtime/openshell.ts) without importing it, so this module does not
// depend on the runtime. The test asserts that both values agree.
const SANDBOX_NAME_PREFIX = "realm-";
const SANDBOX_NAME_MAX_LENGTH = 19;

// The id of a project directory. The path must be absolute and already normalized, with no trailing separator
// unless it is "/". A path that still needs canonicalizing is SCHEMA_INVALID, so callers pass the realpath.
export function sessionIdOfWorkspace(canonicalPath: string): string {
  if (!isCanonicalAbsolutePath(canonicalPath)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const digest = createHash("sha256").update(canonicalPath, "utf8").digest("hex");
  return `${WORKSPACE_SESSION_PREFIX}${digest.slice(0, WORKSPACE_ID_HEX_LENGTH)}`;
}

// The OpenShell sandbox name of a session. Refused unless the id is in the safe set and the name fits the
// gateway limit.
export function sandboxNameOfSession(sessionId: string): string {
  const name = `${SANDBOX_NAME_PREFIX}${sessionId}`;
  if (!isSessionId(sessionId) || name.length > SANDBOX_NAME_MAX_LENGTH) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return name;
}

function isCanonicalAbsolutePath(path: string): boolean {
  if (!posix.isAbsolute(path) || posix.normalize(path) !== path) {
    return false;
  }
  return path === "/" || !path.endsWith("/");
}
