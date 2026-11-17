// The environment the host layer may know about, built from a value the caller hands in. Nothing here reads
// the process environment: the CLI entry edge passes it down as a parameter (src/cli/main.ts).

import { isAbsolute } from "node:path";
import { SchemaInvalidError } from "../contract/validate.js";
import type { EnvironmentLike } from "../session/paths.js";
import type { HostEnv } from "./types.js";

// HOME must be absolute. PATH is split on ":" and keeps only absolute, non-empty entries, so a relative
// entry never makes detection look at the working directory. The whole environment is passed through for
// the table's override names (envOverride), which resolveHomes validates itself.
export function hostEnvFrom(env: EnvironmentLike): HostEnv {
  const home = env["HOME"];
  if (home === undefined || !isAbsolute(home)) {
    throw new SchemaInvalidError("HOME must be an absolute path");
  }
  const pathDirs = (env["PATH"] ?? "").split(":").filter((dir) => dir !== "" && isAbsolute(dir));
  return { home, env, pathDirs };
}

// The host operations log, beside daemon.log and requests.log (src/daemon/ensure.ts).
export function hostLogPath(stateDir: string): string {
  return `${stateDir}/host.log`;
}
