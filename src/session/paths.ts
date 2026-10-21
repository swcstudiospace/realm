// State directory layout (D-37). The environment is passed in, so nothing here reads
// process.env and tests stay hermetic.

import { isAbsolute, join } from "node:path";
import { makeRealmError } from "../core/errors.js";

export type EnvironmentLike = Readonly<Record<string, string | undefined>>;

// Session ids become file names, so they are limited to a safe character set.
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

// $XDG_STATE_HOME/realm when XDG_STATE_HOME is an absolute path, otherwise
// $HOME/.local/state/realm. A relative XDG value is ignored, as the XDG spec requires.
export function resolveStateDir(env: EnvironmentLike): string {
  const xdg = env["XDG_STATE_HOME"];
  if (xdg !== undefined && isAbsolute(xdg)) {
    return join(xdg, "realm");
  }
  const home = env["HOME"];
  if (home === undefined || !isAbsolute(home)) {
    throw new Error("resolveStateDir: neither XDG_STATE_HOME nor an absolute HOME is set");
  }
  return join(home, ".local", "state", "realm");
}

export function sessionsDirOf(stateDir: string): string {
  return join(stateDir, "sessions");
}

// The control socket path is recorded in the session record and never created here
// (S-04, RT-06 is Phase 6).
export function controlSocketPath(stateDir: string): string {
  return join(stateDir, "run", "control.sock");
}

// The record file name for a session id. An id outside the safe set is SCHEMA_INVALID.
export function recordFileName(sessionId: string): string {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return `${sessionId}.json`;
}
