// Daemon: single-owner start, reap-before-serve, method dispatch, and graceful shutdown (P6-D1, P6-D4, P6-D12).
// buildDaemonHandle wires createRealmHandle with the production adapters (SessionExecution over the
// libpod client, AndaBridge over the configured URL, the production OpenShell runner, Date clock); tests inject
// the existing fakes at the same seam. startDaemon binds the control socket once per state directory,
// runs reapStartup with the bounded sweep before serving, dispatches the five CONTROL_METHODS from
// the 06-01 channel, and tears down on down. The wait for the controller teardown is bounded by
// TEARDOWN_TIMEOUT_MS; socket I/O keeps SOCKET_TIMEOUT_MS. With no AgentOS driver or supervisor bound,
// the handle still builds and up refuses with AGENTOS_NOT_CONFIGURED. This module parses no argv,
// spawns no daemon process, and reads no process environment: every host value arrives through its options.

import { rmSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { AndaBridge } from "../anda/client.js";
import type { Policy, PolicyMode } from "../contract/validate.js";
import { makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import { loadPolicyFile } from "../core/policy.js";
import type { BridgePort, ExecutionService } from "../core/ports.js";
import type { StateSnapshot } from "../core/state-machine.js";
import { displayStatus, type DisplayStatus } from "../core/status.js";
import { withTimeout } from "../core/timeout.js";
import { defaultRunCommand, runChecks, type AgentOsReading, type CheckResult, type DoctorOptions } from "../doctor/checks.js";
import { TEARDOWN_TIMEOUT_MS } from "../lifecycle/controller.js";
import { createRealmHandle, type RealmHandle } from "../realm/compose.js";
import { AgentOsSupervisor, type AgentOsDriver } from "../runtime/agentos.js";
import { loadRuntimeConfig, type RuntimeConfig } from "../runtime/config.js";
import { LibpodClient } from "../runtime/libpod-client.js";
import {
  productionOpenShellRunner,
  SessionExecution,
  type SessionContainers,
  type SupervisorFor,
} from "../runtime/session-execution.js";
import type { OpenShellRunner } from "../runtime/openshell.js";
import {
  probePodman,
  type ConnectSocket,
  type PodmanProbeResult,
  type RunCommand,
} from "../runtime/podman-probe.js";
import { removeAllRealmContainers } from "../runtime/sweep.js";
import { controlSocketPath, type EnvironmentLike } from "../session/paths.js";
import { reapStartup } from "../session/reap.js";
import { SessionStore } from "../session/store.js";
import {
  chmodSocket,
  decodeRequest,
  encodeReply,
  ensureSocketDir,
  isControlMethod,
  oversizedLineReply,
  readControlLine,
  replyForMalformedLine,
  SOCKET_TIMEOUT_MS,
  unknownMethodReply,
  type ControlId,
  type ControlMethod,
  type ControlReply,
  type ControlRequest,
  type SocketDirDeps,
} from "./channel.js";

// Default bound for one AgentOS driver call in the production supervisor. The
// only purpose is to keep a hung driver from hanging daemon startup; the
// controller still enforces the policy startup budget around the whole path.
// The supervisor wraps every driver call in this budget, and a sandbox create takes tens of seconds. It
// must exceed the driver's create budget (AGENTOS_START_TIMEOUT_MS in main.ts, 180 s) with margin.
const AGENTOS_CALL_TIMEOUT_MS = 200_000;

// How the start gate settles: open for serving, or failed with the start error.
type GateOutcome = { readonly ok: true } | { readonly ok: false; readonly error: unknown };

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
  // Production construction seams, used only when exec is omitted.
  readonly libpod?: SessionContainers;
  readonly libpodSocketPath?: string;
  readonly agentosFor?: SupervisorFor;
  readonly agentosDriver?: AgentOsDriver;
  // Host environment filtered to OPENSHELL_ENV_NAMES for the runner (never
  // read from the process: this module reads no environment).
  readonly env?: EnvironmentLike;
  // The realm secret root the sandbox binding derives from: the root the driver is given as REALM_DRIVER_SECRET_ROOT. Without it a
  // session create is refused before any libpod call.
  readonly secretRoot?: string;
  // The pinned workspace root the sandbox binding mounts at /workspace: the root the driver is given as REALM_DRIVER_WORKSPACE_ROOT.
  // Without it a session create is refused before any libpod call.
  readonly pinnedWorkspaceRoot?: string;
}

export interface StartDaemonOptions extends BuildDaemonHandleOptions {
  // Probe seam for up (P6-D5). Defaults to the real probePodman over the
  // injected command/socket seams; tests inject a scripted result.
  readonly probe?: () => Promise<PodmanProbeResult>;
  readonly runCommand?: RunCommand;
  readonly connectSocket?: ConnectSocket;
  readonly probeTimeoutMs?: number;
  // Doctor seam. Defaults to runChecks over the daemon state directory; tests
  // inject a scripted report.
  readonly runChecks?: (options: DoctorOptions) => Promise<readonly CheckResult[]>;
  readonly doctorOptions?: Omit<DoctorOptions, "stateDir" | "env">;
  // Reap seam (P6-D4). Defaults to removeAllRealmContainers over the resolved
  // libpod client; tests inject a recording fake. Omitting both sweep and any
  // libpod seam refuses with SCHEMA_INVALID rather than silently skipping the reap.
  readonly sweep?: () => Promise<number>;
  readonly store?: Pick<SessionStore, "list" | "delete">;
  readonly socketDirDeps?: SocketDirDeps;
  // Bound for one socket operation and for draining in-flight requests on down.
  readonly timeoutMs?: number;
  // Test seam: receives the listening server, so a test can fail it the way the runtime would.
  readonly onServer?: (server: Server) => void;
}

export interface StartedDaemon {
  readonly socketPath: string;
  readonly handle: RealmHandle;
  // Resolves when the daemon has stopped: down completes teardown, removes the socket, and releases the server.
  // Rejects with the stop reason when the listening server failed. The entrypoint exits the process then; this
  // module never exits.
  readonly done: Promise<void>;
}

// Builds the shared composition root wiring (P6-D12): the exact
// createRealmHandle path the realm mcp surface uses, so no second tool path can
// bypass the dispatcher. Production adapters are built only for the seams the
// caller leaves open; every supplied fake flows through untouched.
export function buildDaemonHandle(options: BuildDaemonHandleOptions): RealmHandle {
  const config = loadRuntimeConfig(options.runtimeInput);
  const policy = options.policy ?? loadPolicyFile(options.policyPath);
  const clock = options.clock ?? (() => new Date());
  const runOpenShell =
    options.runOpenShell ?? productionOpenShellRunner(options.env ?? {});
  const exec = options.exec ?? defaultExec(config, policy, options, runOpenShell);
  const bridge = options.bridge ?? defaultBridge(config);
  return createRealmHandle({
    runtimeInput: options.runtimeInput,
    policyPath: options.policyPath,
    policy,
    sessionId: options.sessionId,
    exec,
    bridge,
    clock,
    runOpenShell,
  });
}

// Starts the daemon: single-owner bind, reap-before-serve, then dispatch until
// down (P6-D1, P6-D4). A rival owner bound to the same socket refuses with
// LOCK_CONFLICT; a failed sweep rejects before any record is touched and before
// anything is served.
export async function startDaemon(options: StartDaemonOptions): Promise<StartedDaemon> {
  const timeoutMs = options.timeoutMs ?? SOCKET_TIMEOUT_MS;
  const libpod =
    options.libpod ??
    (options.libpodSocketPath !== undefined ? new LibpodClient(options.libpodSocketPath) : undefined);
  // One supervisor per session: the caller's, or one built over the driver. The handle and the doctor probe share them, so
  // each session's supervision state is one object.
  const agentosFor =
    options.agentosFor ?? (options.agentosDriver !== undefined ? supervisorsOver(options.agentosDriver) : undefined);
  const handle = buildDaemonHandle({
    ...options,
    ...(libpod === undefined ? {} : { libpod }),
    ...(agentosFor === undefined ? {} : { agentosFor }),
  });
  const config = loadRuntimeConfig(options.runtimeInput);
  const stateDir = config.stateDir;
  const sweep =
    options.sweep ?? (libpod !== undefined ? () => removeAllRealmContainers(libpod) : undefined);
  if (sweep === undefined) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const store = options.store ?? new SessionStore(stateDir);
  const probe =
    options.probe ??
    (() =>
      probePodman({
        runCommand: options.runCommand ?? defaultRunCommand,
        connectSocket: options.connectSocket ?? defaultConnectSocket,
        env: options.env ?? {},
        timeoutMs: options.probeTimeoutMs ?? SOCKET_TIMEOUT_MS,
      }));
  // The AgentOS reading the doctor reports (CLI-03; P6-D14): unbound when no driver is given, otherwise
  // whether the driver's live session answers.
  const agentosReading = async (): Promise<AgentOsReading> =>
    agentosFor === undefined ? { bound: false } : { bound: true, alive: await agentosFor(options.sessionId).check() };
  const runDoctor = (): Promise<readonly CheckResult[]> =>
    (options.runChecks ?? runChecks)({
      stateDir,
      policyPath: options.policyPath,
      agentos: agentosReading,
      env: options.env ?? {},
      ...options.doctorOptions,
    });

  ensureSocketDir(stateDir, options.socketDirDeps);
  const socketPath = controlSocketPath(stateDir);
  // OQ-P6-03: a refused dial means a live owner answers; any other outcome
  // means the path is stale or absent, so it is removed and this start proceeds.
  if (await probeSocketAlive(socketPath, timeoutMs)) {
    throw makeRealmError("LOCK_CONFLICT");
  }
  const stale = removeSocketFile(socketPath);
  if (stale !== undefined) {
    throw stale;
  }

  let inFlight = 0;
  let draining = false;
  let downRequested = false;
  const completed = new Set<Socket>();
  let resolveDone!: () => void;
  let rejectDone!: (cause: unknown) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // The gate settles with a result and never rejects: a failed start reaches each connection waiting on it
  // as a typed refusal, so no connection needs a rejection handler.
  let openGate!: () => void;
  let failGate!: (cause: unknown) => void;
  const gate = new Promise<GateOutcome>((resolve) => {
    openGate = () => {
      resolve({ ok: true });
    };
    failGate = (error: unknown) => {
      resolve({ ok: false, error });
    };
  });

  const endSocket = (socket: Socket, reply: ControlReply): void => {
    if (completed.has(socket)) {
      return;
    }
    completed.add(socket);
    // A reply that cannot be encoded is replaced by its refusal under the same id, so the peer always gets a
    // catalogue answer it can match to its request.
    let line: string;
    try {
      line = encodeReply(reply);
    } catch (error: unknown) {
      line = encodeReply(refusalReply(reply.id, error));
    }
    socket.end(line);
  };

  const dropSocket = (socket: Socket): void => {
    if (completed.has(socket)) {
      return;
    }
    completed.add(socket);
    socket.destroy();
  };

  const drainOthers = async (): Promise<void> => {
    // down keeps its own in-flight count until its finally block, so the drain
    // waits only for the other requests (inFlight above one).
    const deadline = Date.now() + timeoutMs;
    while (inFlight > 1 && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
      });
    }
  };

  // The one stop path, for a down request and for a failed listening server. It closes the server, tears the
  // handle down, and removes the socket file. A down passes its socket and is answered on it. A failed server
  // passes its code as the reason, so done rejects with that code instead of resolving.
  const stop = async (id: ControlId | null, socket: Socket | undefined, reason?: ErrorCode): Promise<void> => {
    downRequested = true;
    draining = true;
    await drainOthers();
    let reply: ControlReply;
    try {
      // The teardown wait is bounded by TEARDOWN_TIMEOUT_MS. Expiry is REALM_STOPPING, the code the controller
      // reports for its own teardown bound; the catalogue has no teardown-timeout code.
      const closed = await withTimeout(handle.close(), TEARDOWN_TIMEOUT_MS, "REALM_STOPPING");
      reply = { id, result: statusResult(closed, handle.policyMode) };
    } catch (error: unknown) {
      reply = refusalReply(id, error);
    }
    server.close();
    // A socket file that cannot be removed is the reply's refusal, never a silent loss. The daemon stops either way.
    const removal = removeSocketFile(socketPath);
    if (socket !== undefined) {
      endSocket(socket, removal === undefined ? reply : refusalReply(id, removal));
    }
    if (reason === undefined) {
      resolveDone();
    } else {
      rejectDone(makeRealmError(reason, removal?.code));
    }
  };

  const shutdown = async (id: ControlId, socket: Socket): Promise<void> => {
    if (downRequested) {
      // A second down is a no-op: it answers the current snapshot without
      // running teardown again (close delegates to controller stop, which is
      // safe to call twice).
      endSocket(socket, { id, result: statusResult(handle.controller.snapshot(), handle.policyMode) });
      return;
    }
    await stop(id, socket);
  };

  const dispatch = async (
    method: ControlMethod,
    id: ControlId,
    params: unknown,
    socket: Socket,
  ): Promise<ControlReply | null> => {
    switch (method) {
      case "status": {
        return { id, result: statusResult(handle.controller.snapshot(), handle.policyMode) };
      }
      case "up": {
        const workspaceRoot: unknown =
          typeof params === "object" &&
          params !== null &&
          !Array.isArray(params) &&
          "workspaceRoot" in params
            ? params.workspaceRoot
            : undefined;
        if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
          return { id, error: { code: "SCHEMA_INVALID" } };
        }
        let probeResult: PodmanProbeResult;
        try {
          probeResult = await probe();
        } catch (error: unknown) {
          return refusalReply(id, error);
        }
        if (!probeResult.ok) {
          return { id, error: { code: probeResult.code } };
        }
        try {
          const snapshot = await handle.controller.create(workspaceRoot);
          return { id, result: statusResult(snapshot, handle.policyMode) };
        } catch (error: unknown) {
          return refusalReply(id, error);
        }
      }
      case "tool": {
        const tool: unknown =
          typeof params === "object" && params !== null && !Array.isArray(params) && "tool" in params
            ? params.tool
            : undefined;
        if (typeof tool !== "object" || tool === null || Array.isArray(tool)) {
          return { id, error: { code: "SCHEMA_INVALID" } };
        }
        try {
          const outcome = await handle.dispatcher.call(tool);
          if (outcome.outcome === "refused") {
            return { id, error: { code: outcome.code } };
          }
          return { id, result: outcome };
        } catch (error: unknown) {
          return refusalReply(id, error);
        }
      }
      case "down": {
        await shutdown(id, socket);
        return null;
      }
      case "doctor": {
        try {
          const results = await runDoctor();
          return { id, result: results };
        } catch (error: unknown) {
          return refusalReply(id, error);
        }
      }
    }
  };

  const dispatchLine = async (line: string, socket: Socket): Promise<ControlReply | null> => {
    let request: ControlRequest;
    try {
      request = decodeRequest(line);
    } catch {
      return replyForMalformedLine(line);
    }
    if (!isControlMethod(request.method)) {
      return unknownMethodReply(request.id);
    }
    return dispatch(request.method, request.id, request.params, socket);
  };

  const serveOne = async (socket: Socket): Promise<void> => {
    if (draining) {
      dropSocket(socket);
      return;
    }
    inFlight += 1;
    try {
      const read = await readControlLine(socket, timeoutMs);
      if (!read.ok) {
        // An oversized line is never dispatched: refuse it with a null-id reply, then close.
        endSocket(socket, oversizedLineReply());
        return;
      }
      const reply = await dispatchLine(read.line, socket);
      if (reply === null) {
        dropSocket(socket);
      } else {
        endSocket(socket, reply);
      }
    } catch (error: unknown) {
      endSocket(socket, refusalReply(null, error));
    } finally {
      inFlight -= 1;
    }
  };

  const track = async (socket: Socket): Promise<void> => {
    const outcome = await gate;
    if (!outcome.ok) {
      endSocket(socket, refusalReply(null, outcome.error));
      return;
    }
    await serveOne(socket);
  };

  const server: Server = createServer((socket: Socket) => {
    socket.once("close", () => {
      completed.delete(socket);
    });
    // track answers every path itself; this catch only turns an unexpected rejection into a refusal.
    void track(socket).catch((error: unknown) => {
      endSocket(socket, refusalReply(null, error));
    });
  });

  const abortStart = (cause: unknown): never => {
    failGate(cause);
    server.close();
    const removal = removeSocketFile(socketPath);
    if (removal === undefined) {
      throw cause;
    }
    // The start failure stays the reason; the removal failure is kept as its cause code.
    throw makeRealmError(codeOf(cause), removal.code);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (cause: unknown) {
    // A rival won the bind race between the stale probe and this listen; any
    // other listen failure is a bare refusal with no secret attached.
    failGate(cause);
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EADDRINUSE") {
      throw makeRealmError("LOCK_CONFLICT");
    }
    throw makeRealmError("SCHEMA_INVALID");
  }
  // A failure of the listening server stops the daemon: it must not keep serving on a dead socket. Its code is
  // the stop reason. A failure during a stop belongs to that stop. Per-connection failures never reach here.
  server.on("error", (error: unknown) => {
    if (downRequested) {
      return;
    }
    void stop(null, undefined, codeOf(error));
  });
  options.onServer?.(server);

  try {
    chmodSocket(socketPath);
  } catch (error: unknown) {
    abortStart(error);
  }
  try {
    await reapStartup({ store, sweep });
  } catch (error: unknown) {
    abortStart(error);
  }
  openGate();
  return { socketPath, handle, done };
}

function statusResult(
  snapshot: StateSnapshot,
  mode: PolicyMode,
): {
  readonly snapshot: StateSnapshot;
  readonly display: DisplayStatus;
  readonly mode: PolicyMode;
} {
  return { snapshot, display: displayStatus(snapshot), mode };
}

function codeOf(error: unknown): ErrorCode {
  return error instanceof RealmError ? error.code : "SCHEMA_INVALID";
}

// The refusal reply for a thrown error: its catalogue code, plus the cause code when the error has one.
function refusalReply(id: ControlId | null, error: unknown): ControlReply {
  if (error instanceof RealmError && error.causeCode !== undefined) {
    return { id, error: { code: error.code, causeCode: error.causeCode } };
  }
  return { id, error: { code: codeOf(error) } };
}

// Removes the control socket file. A failure is returned as SCHEMA_INVALID, the refusal every other filesystem
// failure in this module uses, so it is never dropped.
function removeSocketFile(socketPath: string): RealmError | undefined {
  try {
    rmSync(socketPath, { force: true });
    return undefined;
  } catch {
    return makeRealmError("SCHEMA_INVALID");
  }
}

// A bridge that immediately reports the engine unreachable. Used only when the
// runtime input configures no Anda URL and the caller injects no bridge, so
// status and doctor keep working while up reports ANDA_UNREACHABLE through the
// controller instead of refusing to construct the handle.
class UnreachableBridge implements BridgePort {
  connect(): Promise<void> {
    return Promise.reject(makeRealmError("ANDA_UNREACHABLE"));
  }

  snapshot(): null {
    return null;
  }

  subscribe(): () => void {
    return () => undefined;
  }

  async close(): Promise<void> {}
}

// The supervisors of one driver, one per session. Each is built on the session's first use and returned for that session from
// then on, so a session's supervision state is one object, shared by the execution path and the doctor probe.
function supervisorsOver(driver: AgentOsDriver): SupervisorFor {
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
      sleep: (ms: number) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, ms);
        }),
      now: () => Date.now(),
    });
    supervisors.set(sessionId, made);
    return made;
  };
}

function defaultExec(
  config: RuntimeConfig,
  policy: Policy,
  options: BuildDaemonHandleOptions,
  runOpenShell: OpenShellRunner,
): ExecutionService {
  const libpod =
    options.libpod ??
    (options.libpodSocketPath !== undefined ? new LibpodClient(options.libpodSocketPath) : undefined);
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
    ...(options.pinnedWorkspaceRoot !== undefined ? { pinnedWorkspaceRoot: options.pinnedWorkspaceRoot } : {}),
    config: {
      image: config.image,
      stateDir: config.stateDir,
      ...(config.andaUrl !== undefined ? { andaUrl: config.andaUrl } : {}),
    },
    egressAllow: policy.egressAllow,
  });
}

function defaultBridge(config: RuntimeConfig): BridgePort {
  if (config.andaUrl === undefined) {
    return new UnreachableBridge();
  }
  return new AndaBridge({ url: config.andaUrl });
}

// Dials a Unix socket and closes it at once, mirroring the doctor default
// (checks.ts). Rejects on refusal, a missing socket, or no connection within
// timeoutMs.
function defaultConnectSocket(socketPath: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const socket = createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`daemon: connect to ${socketPath} timed out`));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
    socket.once("error", (cause: unknown) => {
      clearTimeout(timer);
      socket.destroy();
      reject(cause instanceof Error ? cause : new Error("daemon: socket dial failed"));
    });
  });
}

// True when a live owner answers at the socket path. Any other outcome (absent
// path, refusal, timeout) means no live owner.
function probeSocketAlive(socketPath: string, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}
