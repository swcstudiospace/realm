// Daemon entry (RT-01, P6-D1, P6-D4). Reads the runtime config file, starts the daemon through
// startDaemon, and holds the process until a SIGTERM or SIGINT, or a control-channel down, completes
// teardown. A signal runs the control channel's own down request against the daemon socket, so both
// shutdown paths share one code path. This module parses no argv. It reads process.env once, in
// main, and never calls process.exit: the exit code is set on process.exitCode and the event loop
// drains.

import { RealmError, type ErrorCode } from "../core/errors.js";
import { defaultPolicyPath, isDirectEntry, podmanSocketPath, readHostRuntime } from "../runtime/host-paths.js";
import { createOpenShellAgentOsDriver } from "../runtime/agentos-driver.js";
import { productionRunnerChild } from "../runtime/agentos-workload.js";
import type { AgentOsDriver } from "../runtime/agentos.js";
import { writePolicyDocument } from "../runtime/openshell.js";
import { productionOpenShellRunner, SANDBOX_CPUS, SANDBOX_MEMORY } from "../runtime/session-execution.js";
import type { EnvironmentLike } from "../session/paths.js";
import { CONTROL_TIMEOUT_MS, sendRequest, type ControlReply } from "./channel.js";
import { startDaemon, type StartDaemonOptions, type StartedDaemon } from "./daemon.js";

export type DaemonSignal = "SIGTERM" | "SIGINT";

const SIGNALS: readonly DaemonSignal[] = ["SIGTERM", "SIGINT"];
const SESSION_ID = "daemon";
const DOWN_REQUEST_ID = "shutdown";

// startDaemon derives the state directory from runtimeInput; stateDir is carried alongside so the
// entry derives the policy path from the same value.
export type DaemonStartOptions = StartDaemonOptions & { readonly stateDir: string };

export interface DaemonDeps {
  readonly env: EnvironmentLike;
  readonly readConfig?: (path: string) => unknown;
  readonly start?: (options: DaemonStartOptions) => Promise<StartedDaemon>;
  // Sends the control channel's down to the daemon socket. Defaults to sendRequest bounded by
  // CONTROL_TIMEOUT_MS.down, so the signal path runs the same teardown a CLI down runs.
  readonly sendDown?: (socketPath: string) => Promise<ControlReply>;
  readonly writeStderr?: (line: string) => void;
  readonly onSignal?: (signal: DaemonSignal, handler: () => void) => () => void;
}

interface StopWiring {
  readonly sendDown: (socketPath: string) => Promise<ControlReply>;
  readonly onSignal: (signal: DaemonSignal, handler: () => void) => () => void;
  readonly writeStderr: (line: string) => void;
}

// The AgentOS driver is bound only when REALM_AGENTOS_IMAGE names a digest-pinned sandbox image. Without it
// the daemon stays unbound and refuses AgentOS work with AGENTOS_NOT_CONFIGURED (fail closed). The sandbox
// takes the session's cpu and memory limits and its own policy document, written beside the state
// directory. The policy names the node binary in the image as its workload binary.
const AGENTOS_IMAGE_ENV = "REALM_AGENTOS_IMAGE";
const AGENTOS_SESSION_ID = "agentos";
const AGENTOS_WORKLOAD_BINARY = "/usr/local/bin/node";
// Create provisions the container and waits for it to start, so it gets the long budget; probe and delete
// get the short one.
const AGENTOS_START_TIMEOUT_MS = 180_000;
const AGENTOS_CALL_TIMEOUT_MS = 30_000;

function agentosDriverFromEnv(env: EnvironmentLike, stateDir: string): AgentOsDriver | undefined {
  const imageRef = env[AGENTOS_IMAGE_ENV];
  if (imageRef === undefined || imageRef.length === 0) {
    return undefined;
  }
  return createOpenShellAgentOsDriver({
    runner: productionOpenShellRunner(env),
    spawnRunner: productionRunnerChild(env),
    imageRef,
    policyPath: writePolicyDocument(stateDir, AGENTOS_SESSION_ID, [], AGENTOS_WORKLOAD_BINARY),
    cpus: SANDBOX_CPUS,
    memory: SANDBOX_MEMORY,
    startTimeoutMs: AGENTOS_START_TIMEOUT_MS,
    callTimeoutMs: AGENTOS_CALL_TIMEOUT_MS,
  });
}

// Starts the daemon and resolves with its exit code once it has stopped: 0 after a clean teardown,
// 1 when start, the shutdown, or the listening server fails. Each failure writes one line carrying only a catalogue code.
export async function runDaemon(deps: DaemonDeps): Promise<number> {
  const start = deps.start ?? startDaemon;
  const writeStderr = deps.writeStderr ?? writeLine;
  let started: StartedDaemon;
  try {
    const { runtimeInput, stateDir } = readHostRuntime(deps.env, deps.readConfig);
    const libpodSocketPath = podmanSocketPath(deps.env);
    const agentosDriver = agentosDriverFromEnv(deps.env, stateDir);
    started = await start({
      stateDir,
      runtimeInput,
      policyPath: defaultPolicyPath(stateDir),
      sessionId: SESSION_ID,
      env: deps.env,
      ...(libpodSocketPath === undefined ? {} : { libpodSocketPath }),
      ...(agentosDriver === undefined ? {} : { agentosDriver }),
    });
  } catch (error: unknown) {
    writeStderr(failureLine(codeOf(error)));
    return 1;
  }
  return awaitStop(started, {
    sendDown: deps.sendDown ?? requestDown,
    onSignal: deps.onSignal ?? registerSignal,
    writeStderr,
  });
}

// Resolves once the daemon has stopped. A signal runs the down request and settles with its
// outcome. A down that arrives over the control channel completes done, and the process drains.
function awaitStop(started: StartedDaemon, wiring: StopWiring): Promise<number> {
  return new Promise<number>((resolve) => {
    const unregister: (() => void)[] = [];
    let shutdownRequested = false;
    let settled = false;
    const settle = (code: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      for (const off of unregister) {
        off();
      }
      resolve(code);
    };
    const shutdown = async (): Promise<number> => {
      const reply = await wiring.sendDown(started.socketPath);
      if (reply.error !== undefined) {
        wiring.writeStderr(failureLine(reply.error.code));
        return 1;
      }
      await started.done;
      return 0;
    };
    for (const signal of SIGNALS) {
      unregister.push(
        wiring.onSignal(signal, () => {
          if (shutdownRequested) {
            return;
          }
          shutdownRequested = true;
          void shutdown().then(settle, (error: unknown) => {
            wiring.writeStderr(failureLine(codeOf(error)));
            settle(1);
          });
        }),
      );
    }
    void started.done.then(
      () => {
        // A signal-initiated shutdown reports its own outcome, so done alone never settles it.
        if (!shutdownRequested) {
          settle(0);
        }
      },
      (error: unknown) => {
        // The listening server failed: its code is the stop reason, and the daemon exits nonzero.
        if (!shutdownRequested) {
          wiring.writeStderr(failureLine(codeOf(error)));
          settle(1);
        }
      },
    );
  });
}

export async function main(): Promise<void> {
  const env: EnvironmentLike = { ...process.env };
  process.exitCode = await runDaemon({ env });
}

function codeOf(error: unknown): ErrorCode {
  return error instanceof RealmError ? error.code : "SCHEMA_INVALID";
}

function failureLine(code: ErrorCode): string {
  return `realm daemon: ${code}`;
}

function writeLine(line: string): void {
  process.stderr.write(`${line}\n`);
}

function registerSignal(signal: DaemonSignal, handler: () => void): () => void {
  process.on(signal, handler);
  return () => {
    process.off(signal, handler);
  };
}

function requestDown(socketPath: string): Promise<ControlReply> {
  return sendRequest(
    socketPath,
    { id: DOWN_REQUEST_ID, method: "down" },
    { timeoutMs: CONTROL_TIMEOUT_MS.down },
  );
}

if (isDirectEntry(import.meta.url, process.argv[1])) {
  void main();
}
