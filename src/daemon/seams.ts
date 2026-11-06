// The daemon's production seams and their helpers: the options a handle is built from, the default execution and Anda bridge,
// the libpod client and the AgentOS supervisors, the control socket file and its liveness probe, and the selection, status
// and refusal helpers of the control dispatch. startDaemon and buildDaemonHandle compose them; this module reads no process
// environment.

import { rmSync } from "node:fs";
import { AndaBridge } from "../anda/client.js";
import type { Policy, PolicyMode } from "../contract/validate.js";
import { makeRealmError, RealmError } from "../core/errors.js";
import type { BridgePort, ExecutionService } from "../core/ports.js";
import type { StateSnapshot } from "../core/state-machine.js";
import { displayStatus, type DisplayStatus } from "../core/status.js";
import { dialWithin, sleep } from "../core/timeout.js";
import type { Logger } from "../observe/logger.js";
import { AgentOsSupervisor, type AgentOsDriver } from "../runtime/agentos.js";
import { andaBridgeRequired, type RuntimeConfig } from "../runtime/config.js";
import { LibpodClient } from "../runtime/libpod-client.js";
import type { OpenShellRunner } from "../runtime/openshell.js";
import { SessionExecution, type SessionContainers, type SupervisorFor } from "../runtime/session-execution.js";
import type { EnvironmentLike } from "../session/paths.js";
import type { ControlId, ControlReply, ControlSelection } from "./channel.js";
import { codeOf } from "./sessions.js";

// Default bound for one AgentOS driver call in the production supervisor. The
// only purpose is to keep a hung driver from hanging daemon startup; the
// controller still enforces the policy startup budget around the whole path.
// The supervisor wraps every driver call in this budget, and a sandbox create takes tens of seconds. It
// must exceed the driver's create budget (AGENTOS_START_TIMEOUT_MS in main.ts, 180 s) with margin.
const AGENTOS_CALL_TIMEOUT_MS = 200_000;

export interface BuildDaemonHandleOptions {
  readonly runtimeInput: unknown;
  readonly policyPath: string;
  readonly policy?: Policy;
  readonly sessionId: string;
  // Adapter seam (P6-D12). When exec or bridge is omitted the production
  // adapter is built from the seams below; tests inject the existing fakes here.
  readonly exec?: ExecutionService;
  readonly bridge?: BridgePort;
  readonly runOpenShell?: OpenShellRunner;
  readonly clock?: () => Date;
  // Request log (OBS-02). The Anda bridge built here writes its listener diagnostics to it.
  readonly logger?: Logger;
  // Production construction seams, used only when exec is omitted.
  readonly libpod?: SessionContainers;
  readonly libpodSocketPath?: string;
  readonly agentosFor?: SupervisorFor;
  readonly agentosDriver?: AgentOsDriver;
  // Host environment filtered to OPENSHELL_ENV_NAMES for the runner (never
  // read from the process: this module reads no environment).
  readonly env?: EnvironmentLike;
  // The three roots from config.json (runtimeRootsOf). The driver reads the same file. A stale REALM_DRIVER_*_ROOT
  // variable is ignored. Without a root a session create is refused before any libpod call.
  readonly secretRoot?: string;
  readonly sandboxStateRoot?: string;
  // Host readers of the create-time conformance proof: the container's OCI config text and its /proc status. Absent, the host
  // reads are used. The startup adoption verdict takes the same readers.
  readonly readOciConfig?: (path: string) => string;
  readonly readProcStatus?: (pid: number) => string;
}

// The report of status, up and down. `notice` is present only after a startup reap that destroyed something, so a reply with
// nothing destroyed has no `notice` key.
interface StatusReport {
  readonly snapshot: StateSnapshot;
  readonly display: DisplayStatus;
  readonly mode: PolicyMode;
  readonly notice?: string;
}

// The reply of status, up and down: the report of the selected session, with the realpath of the root the selection names and
// the session id it maps to.
export interface StatusResult extends StatusReport {
  readonly boundRoot: string;
  readonly sessionId: string;
}

export function statusResult(snapshot: StateSnapshot, mode: PolicyMode, notice: string | undefined): StatusReport {
  return {
    snapshot,
    display: displayStatus(snapshot),
    mode,
    ...(notice === undefined ? {} : { notice }),
  };
}

// The selection a selected method must carry. parseControlSelection guarantees it for every such method.
export function requireSelection(selection: ControlSelection | null): ControlSelection {
  if (selection === null) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return selection;
}

// The workspace root an up names. parseControlSelection has checked its shape.
export function workspaceRootOf(params: unknown): string {
  if (
    typeof params === "object" &&
    params !== null &&
    "workspaceRoot" in params &&
    typeof params.workspaceRoot === "string"
  ) {
    return params.workspaceRoot;
  }
  throw makeRealmError("SCHEMA_INVALID");
}

// The runtime input of one session's handle: the daemon's own, with the session's pinned directory as its workspace root.
export function runtimeInputAt(runtimeInput: unknown, workspaceRoot: string): unknown {
  if (typeof runtimeInput !== "object" || runtimeInput === null || Array.isArray(runtimeInput)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return { ...runtimeInput, workspaceRoot };
}

// The refusal reply for a thrown error: its catalogue code, plus the cause code when the error has one.
export function refusalReply(id: ControlId | null, error: unknown): ControlReply {
  if (error instanceof RealmError && error.causeCode !== undefined) {
    return { id, error: { code: error.code, causeCode: error.causeCode } };
  }
  return { id, error: { code: codeOf(error) } };
}

// Removes the control socket file. A failure is returned as SCHEMA_INVALID, the refusal every other filesystem
// failure in this module uses, so it is never dropped.
export function removeSocketFile(socketPath: string): RealmError | undefined {
  try {
    rmSync(socketPath, { force: true });
    return undefined;
  } catch {
    return makeRealmError("SCHEMA_INVALID");
  }
}

// The supervisors of one driver, one per session. Each is built on the session's first use and returned for that session from
// then on, so a session's supervision state is one object, shared by the execution path and the doctor probe.
export function supervisorsOver(driver: AgentOsDriver): SupervisorFor {
  const supervisors = new Map<string, AgentOsSupervisor>();
  return (sessionId: string): AgentOsSupervisor => {
    const existing = supervisors.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const made = new AgentOsSupervisor({
      driver,
      sessionId,
      callTimeoutMs: AGENTOS_CALL_TIMEOUT_MS,
      random: Math.random,
      sleep,
      now: () => Date.now(),
    });
    supervisors.set(sessionId, made);
    return made;
  };
}

// The libpod client both entry points build: the caller's, or one over libpodSocketPath when the caller names a socket
// instead, and undefined when neither is given. startDaemon and defaultExec share it, so both reach the same socket.
export function libpodOf(options: {
  readonly libpod?: SessionContainers;
  readonly libpodSocketPath?: string;
}): SessionContainers | undefined {
  return options.libpod ?? (options.libpodSocketPath !== undefined ? new LibpodClient(options.libpodSocketPath) : undefined);
}

export function defaultExec(
  config: RuntimeConfig,
  policy: Policy,
  options: BuildDaemonHandleOptions,
  runOpenShell: OpenShellRunner,
): ExecutionService {
  const libpod = libpodOf(options);
  if (libpod === undefined) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const agentosFor =
    options.agentosFor ?? (options.agentosDriver !== undefined ? supervisorsOver(options.agentosDriver) : undefined);
  // No driver and no supervisor leaves AgentOS unbound: SessionExecution then refuses every runtime-touching
  // call with AGENTOS_NOT_CONFIGURED, so the handle still builds.
  return new SessionExecution({
    libpod,
    runner: runOpenShell,
    ...(agentosFor !== undefined ? { agentosFor } : {}),
    ...(options.secretRoot !== undefined ? { secretRoot: options.secretRoot } : {}),
    ...(options.sandboxStateRoot !== undefined ? { sandboxStateRoot: options.sandboxStateRoot } : {}),
    ...(options.readOciConfig !== undefined ? { readOciConfig: options.readOciConfig } : {}),
    ...(options.readProcStatus !== undefined ? { readProcStatus: options.readProcStatus } : {}),
    config: {
      image: config.image,
      stateDir: config.stateDir,
      ...(config.andaUrl !== undefined ? { andaUrl: config.andaUrl } : {}),
    },
    egressAllow: policy.egressAllow,
  });
}

// The Anda bridge over the configured URL, or null when no URL is configured, so the session has no
// bridge and runs no handshake (C4).
export function defaultBridge(config: RuntimeConfig, logger: Logger | undefined): BridgePort | null {
  if (!andaBridgeRequired(config)) {
    return null;
  }
  return new AndaBridge({ url: config.andaUrl, ...(logger === undefined ? {} : { logger }) });
}

// Dials a Unix socket and closes it at once, mirroring the doctor default
// (checks.ts). Rejects on refusal or a missing socket with the socket's error,
// and with PODMAN_MACHINE_DOWN when no connection completes within timeoutMs.
export async function defaultConnectSocket(socketPath: string, timeoutMs: number): Promise<void> {
  const socket = await dialWithin(socketPath, timeoutMs, "PODMAN_MACHINE_DOWN");
  socket.destroy();
}

// What a probe of the control socket path found. "alive": a live owner answered. "absent": no owner, a missing path or a
// refused dial. "unknown": the dial timed out, so a slow owner may still hold the socket.
export type SocketProbe = "alive" | "absent" | "unknown";

// Probes the control socket path. dialWithin rejects with a RealmError only on a timeout, and a socket error (a refusal or
// a missing path) is never a RealmError, so only a timeout is unknown. The dial is a parameter so a test can fail it.
export function probeSocketAlive(
  socketPath: string,
  timeoutMs: number,
  dial: typeof dialWithin = dialWithin,
): Promise<SocketProbe> {
  return dial(socketPath, timeoutMs, "DAEMON_START_TIMEOUT").then(
    (socket): SocketProbe => {
      socket.destroy();
      return "alive";
    },
    (error: unknown): SocketProbe => (error instanceof RealmError ? "unknown" : "absent"),
  );
}
