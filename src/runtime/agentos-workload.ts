// The AgentOS runner child (D-14, RT-04). OpenShell 0.1.5 does not run a create command, so the realm starts the
// AgentOS runner in the sandbox itself: a long-lived `openshell sandbox exec` child, started after create. This is
// the only module that spawns that child. The child gets the environment names every OpenShell call gets, and its
// stdio is ignored, so no byte it writes is captured, logged or copied into an error.

import { spawn, type SpawnOptions } from "node:child_process";
import { makeRealmError } from "../core/errors.js";
import type { EnvironmentLike } from "../session/paths.js";
import { selectOpenShellEnvironment } from "./session-execution.js";

// POSIX children lead their own process group, so a signal reaches helpers the exec forks. Windows has no such
// group here, and the child alone is signalled there.
const OWN_PROCESS_GROUP = process.platform !== "win32";

// The part of a spawned process the runner child uses. A ChildProcess satisfies it; a test supplies a fake.
export interface RunnerProcess {
  readonly pid?: number | undefined;
  kill(signal: NodeJS.Signals): boolean;
  on(event: "exit" | "error", listener: () => void): unknown;
}

export type SpawnProcess = (file: string, args: readonly string[], options: SpawnOptions) => RunnerProcess;

// One runner child of one sandbox.
export interface RunnerChild {
  // True once the process has exited, or once its spawn failed.
  hasExited(): boolean;
  // Stops the process: SIGTERM, then SIGKILL when it has not exited within graceMs. Each wait is bounded by graceMs,
  // so the call always settles. It never rejects and never reports the child's output.
  terminate(graceMs: number): Promise<void>;
}

// Starts the runner child for one argv (argv[0] is the binary, with no shell). Throws when it cannot be started.
export type RunnerChildSpawner = (argv: readonly string[]) => RunnerChild;

function defaultSpawn(file: string, args: readonly string[], options: SpawnOptions): RunnerProcess {
  return spawn(file, args, options);
}

// The runner child spawner for the environment the caller passes. Only the names OpenShell calls receive reach the child.
export function spawnRunnerChild(
  environment: Readonly<Record<string, string>>,
  spawnProcess: SpawnProcess = defaultSpawn,
): RunnerChildSpawner {
  const childEnvironment: Readonly<Record<string, string>> = Object.freeze({ ...environment });
  return (argv) => {
    const [file, ...args] = argv;
    if (file === undefined) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    const proc = spawnProcess(file, args, {
      shell: false,
      env: { ...childEnvironment },
      stdio: "ignore",
      detached: OWN_PROCESS_GROUP,
    });
    return track(proc);
  };
}

// The production runner child spawner for the environment the composition root passes (RT-03, D-46).
export function productionRunnerChild(source: EnvironmentLike): RunnerChildSpawner {
  return spawnRunnerChild(selectOpenShellEnvironment(source));
}

// Follows one spawned process: its exit, and the signals that stop it.
function track(proc: RunnerProcess): RunnerChild {
  let exited = false;
  const gone = new Promise<void>((resolve) => {
    const finish = (): void => {
      exited = true;
      resolve();
    };
    proc.on("exit", finish);
    // An error with no pid means the process never started. An error on a started process, such as a failed
    // signal, leaves the process running, so it is not an exit.
    proc.on("error", () => {
      if (proc.pid === undefined) {
        finish();
      }
    });
  });
  return {
    hasExited: () => exited,
    terminate: async (graceMs) => {
      if (!exited) {
        signalRunner(proc, "SIGTERM");
      }
      await settleWithin(gone, graceMs);
      if (!exited) {
        signalRunner(proc, "SIGKILL");
      }
      await settleWithin(gone, graceMs);
    },
  };
}

// Sends one signal to the runner child and, on POSIX, to the process group it leads. When the group cannot be
// signalled, the child alone gets the signal.
function signalRunner(proc: RunnerProcess, name: NodeJS.Signals): void {
  if (OWN_PROCESS_GROUP && proc.pid !== undefined) {
    try {
      process.kill(-proc.pid, name);
      return;
    } catch {
      // The group is already gone or cannot be signalled. The direct signal below still reaches the child.
    }
  }
  proc.kill(name);
}

// Resolves once promise settles or after ms, whichever comes first. The timer is cleared on either path.
function settleWithin(promise: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([promise, expiry]).finally(() => {
    clearTimeout(timer);
  });
}
