// Host path rules shared by the CLI and the runtime. Every function takes its environment
// or inputs as parameters; this module reads no host environment of its own.

import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRealmError } from "../core/errors.js";
import type { EnvironmentLike } from "../session/paths.js";
import { loadRuntimeConfig } from "./config.js";
import { readRuntimeConfigFile } from "./config-file.js";

// $XDG_CONFIG_HOME/realm/config.json when XDG_CONFIG_HOME is an absolute path, otherwise
// $HOME/.config/realm/config.json. A relative XDG value is ignored, as the XDG spec requires.
// When neither base is absolute there is no location to read, so the call is SCHEMA_INVALID.
export function resolveConfigPath(env: EnvironmentLike): string {
  const xdg = env["XDG_CONFIG_HOME"];
  if (xdg !== undefined && isAbsolute(xdg)) {
    return join(xdg, "realm", "config.json");
  }
  const home = env["HOME"];
  if (home === undefined || !isAbsolute(home)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return join(home, ".config", "realm", "config.json");
}

// The host runtime as the daemon reads it: the config file at resolveConfigPath(env), validated by
// loadRuntimeConfig. The state directory is that config's stateDir, so the CLI, the daemon, and the Omp
// extension derive every state path from one value. readConfig defaults to the file reader; a missing,
// unreadable, or invalid config is SCHEMA_INVALID.
export interface HostRuntime {
  readonly runtimeInput: unknown;
  readonly stateDir: string;
}

export function readHostRuntime(
  env: EnvironmentLike,
  readConfig: (path: string) => unknown = readRuntimeConfigFile,
): HostRuntime {
  const runtimeInput = readConfig(resolveConfigPath(env));
  const { stateDir } = loadRuntimeConfig(runtimeInput);
  return { runtimeInput, stateDir };
}

// The rootless API socket lives under an absolute XDG_RUNTIME_DIR; otherwise there is no
// socket path to report. This mirrors the probe's apiSocketPath rule (podman-probe.ts,
// OQ-P3-13). String operations keep the result exactly that rule.
export function podmanSocketPath(env: EnvironmentLike): string | undefined {
  const runtimeDir = env["XDG_RUNTIME_DIR"];
  if (runtimeDir === undefined || !runtimeDir.startsWith("/")) {
    return undefined;
  }
  return `${runtimeDir}/podman/podman.sock`;
}

// Conventional policy location beside the state directory. String concatenation keeps the
// result identical to the CLI's existing derivation.
export function defaultPolicyPath(stateDir: string): string {
  return `${stateDir}/policy.json`;
}

// True when argv1 and the module file named by moduleUrl are the same file once symbolic
// links are resolved. An undefined argv1, or one that does not exist, is never the entry.
// A compiled Omp binary reports its virtual /$bunfs entry as existing, yet realpath fails on
// it with ENOENT. That path is not a file on disk, so it is not the entry either. Any other
// realpath error propagates.
export function isDirectEntry(moduleUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined || !existsSync(argv1)) {
    return false;
  }
  let resolved: string;
  try {
    resolved = realpathSync(argv1);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
  return resolved === realpathSync(fileURLToPath(moduleUrl));
}
