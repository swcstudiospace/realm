// State directory layout (D-37). The environment is passed in, so nothing here reads
// process.env and tests stay hermetic.

import { join } from "node:path";
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
