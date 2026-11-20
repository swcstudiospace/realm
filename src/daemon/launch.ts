// The daemon launch (P6-D1, D-1505, T-06-07, T-06-10): the one place the CLI and a host start the detached daemon.
// It is kept light on purpose: it imports only the core error module and the daemon's own small modules, so the Omp
// extension, which imports startDetachedDaemon from here, loads none of the CLI, doctor, MCP, ACP or runtime-driver
// graph. The lint invariant (eslint.config.js, CHILD_PROCESS_ALLOWED) names this module as the one in the CLI and
// Omp wiring that may import node:child_process and call spawn; the exec gate closure must never reach it.

import { spawn } from "node:child_process";
import { closeSync, fchmodSync, mkdirSync, openSync } from "node:fs";
import { makeRealmError } from "../core/errors.js";
import type { EnvironmentLike } from "../session/paths.js";
import { daemonLogPath } from "./ensure.js";
import { findNodeBinary } from "./node-runtime.js";
import { daemonSpawnEnv } from "./spawn-env.js";

export interface SpawnedProcess {
  unref(): void;
}

export type SpawnDaemon = (
  file: string,
  args: readonly string[],
  options: {
    readonly detached: true;
    readonly stdio: readonly ["ignore", number, number];
    readonly env: EnvironmentLike;
  },
) => SpawnedProcess;

export function defaultSpawnDaemon(
  file: string,
  args: readonly string[],
  options: Parameters<SpawnDaemon>[2],
): SpawnedProcess {
  const child = spawn(file, [...args], { detached: options.detached, stdio: [...options.stdio], env: options.env });
  child.unref();
  return child;
}

// The daemon's startup log: <stateDir>/daemon.log, append-only and owner-only. The state directory is
// made at 0700 when missing, because the log opens before the daemon creates it. The child keeps its own
// copy of the descriptor, so the parent closes its copy once the spawn returns.
function withDaemonLog(stateDir: string, launch: (log: number) => void): void {
  // Missing ancestors take the default mode; only the state directory itself is made 0700.
  const cut = stateDir.lastIndexOf("/");
  if (cut > 0) {
    mkdirSync(stateDir.slice(0, cut), { recursive: true });
  }
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const log = openSync(daemonLogPath(stateDir), "a", 0o600);
  try {
    fchmodSync(log, 0o600);
    launch(log);
  } finally {
    closeSync(log);
  }
}

// Starts the daemon entry detached with the allowlisted environment (D-1505). The CLI spawn and
// startDetachedDaemon both go through here, so a sentinel variable reaches neither child.
export function launchFilteredDaemon(
  entry: string,
  stateDir: string,
  source: EnvironmentLike,
  spawnImpl: SpawnDaemon = defaultSpawnDaemon,
  findNode: (pathValue: string | undefined) => string | null = findNodeBinary,
): void {
  // Under a Bun host process.execPath is the Omp binary, which would read the entry as a prompt and run an unsupervised
  // agent session, so it is never used there. The daemon runs on the Node found in an absolute directory of the handed-in
  // PATH; with none, the attach refuses with REALM_NOT_ACTIVE and no child exists.
  let runtime = process.execPath;
  if (Object.hasOwn(process.versions, "bun")) {
    const node = findNode(source.PATH);
    if (node === null) {
      throw makeRealmError("REALM_NOT_ACTIVE");
    }
    runtime = node;
  }
  withDaemonLog(stateDir, (log) => {
    spawnImpl(runtime, [entry], {
      detached: true,
      stdio: ["ignore", log, log],
      env: daemonSpawnEnv(source),
    });
  });
}

// The documented CLI daemon spawn (P6-D1). The Omp extension imports it from here. The child receives the allowlisted
// environment only; a stale REALM_DRIVER_*_ROOT variable is not passed.
export function startDetachedDaemon(entry: string, stateDir: string): void {
  launchFilteredDaemon(entry, stateDir, process.env);
}
