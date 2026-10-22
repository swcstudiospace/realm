// Daemon: single-owner start, reap-before-serve, method dispatch, and graceful shutdown (P6-D1, P6-D4, P6-D12).
// buildDaemonHandle wires createRealmHandle with the production adapters (SessionExecution over the
// libpod client, AndaBridge over the configured URL, the production OpenShell runner, Date clock); tests inject
// the existing fakes at the same seam. startDaemon binds the control socket once per state directory,
// runs reapStartup with the bounded sweep before serving, dispatches the four CONTROL_METHODS from
// the 06-01 channel, and tears down on down. This module parses no argv, spawns no daemon process,
// and reads no process environment: every host value arrives through its options.

import { rmSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { AndaBridge } from "../anda/client.js";
import type { Policy } from "../contract/validate.js";
import { makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import { loadPolicyFile } from "../core/policy.js";
import type { BridgePort, ExecutionService } from "../core/ports.js";
import type { StateSnapshot } from "../core/state-machine.js";
import { displayStatus, type DisplayStatus } from "../core/status.js";
import { withTimeout } from "../core/timeout.js";
import { defaultRunCommand, runChecks, type CheckResult, type DoctorOptions } from "../doctor/checks.js";
import { createRealmHandle, type RealmHandle } from "../realm/compose.js";
import { AgentOsSupervisor, type AgentOsDriver } from "../runtime/agentos.js";
import { loadRuntimeConfig, type RuntimeConfig } from "../runtime/config.js";
import { LibpodClient } from "../runtime/libpod-client.js";
import {
  productionOpenShellRunner,
  SessionExecution,
  type SessionContainers,
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
const AGENTOS_CALL_TIMEOUT_MS = 5000;

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
  readonly agentos?: AgentOsSupervisor;
  readonly agentosDriver?: AgentOsDriver;
  // Host environment filtered to OPENSHELL_ENV_NAMES for the runner (never
  // read from the process: this module reads no environment).
  readonly env?: EnvironmentLike;
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
  readonly doctorOptions?: Omit<DoctorOptions, "stateDir">;
  // Reap seam (P6-D4). Defaults to removeAllRealmContainers over the resolved
  // libpod client; tests inject a recording fake. Omitting both sweep and any
  // libpod seam refuses with SCHEMA_INVALID rather than silently skipping the reap.
  readonly sweep?: () => Promise<number>;
  readonly store?: Pick<SessionStore, "list" | "delete">;
  readonly socketDirDeps?: SocketDirDeps;
  // Bound for one socket operation and for draining in-flight requests on down.
  readonly timeoutMs?: number;
}

export interface StartedDaemon {
  readonly socketPath: string;
  readonly handle: RealmHandle;
  // Resolves when down completes teardown, removes the socket, and releases
  // the server. The entrypoint exits the process then; this module never exits.
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
    ...(options.policy !== undefined ? { policy: options.policy } : {}),
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
  const handle = buildDaemonHandle(libpod === undefined ? options : { ...options, libpod });
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
  const runDoctor = (): Promise<readonly CheckResult[]> =>
    (options.runChecks ?? runChecks)({
      stateDir,
      policyPath: options.policyPath,
      ...options.doctorOptions,
    });

  ensureSocketDir(stateDir, options.socketDirDeps);
  const socketPath = controlSocketPath(stateDir);
  // OQ-P6-03: a refused dial means a live owner answers; any other outcome
  // means the path is stale or absent, so it is removed and this start proceeds.
  if (await probeSocketAlive(socketPath, timeoutMs)) {
    throw makeRealmError("LOCK_CONFLICT");
  }
  try {
    rmSync(socketPath, { force: true });
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }

  let inFlight = 0;
  let draining = false;
  let downRequested = false;
  let finished = false;
  const completed = new Set<Socket>();
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  let openGate!: () => void;
  let failGate!: (cause: unknown) => void;
  const gate = new Promise<void>((resolve, reject) => {
    openGate = resolve;
    failGate = reject;
  });
  // A failed start rejects the gate before any connection awaits it; mark it handled so
  // only the connections that await it see the rejection.
  void gate.catch(() => undefined);

  const endSocket = (socket: Socket, reply: ControlReply): void => {
    if (completed.has(socket)) {
      return;
    }
    completed.add(socket);
    try {
      socket.end(encodeReply(reply));
    } catch {
      try {
        socket.destroy();
      } catch {
        // Best effort on the way out; the peer already went away.
      }
    }
  };

  const dropSocket = (socket: Socket): void => {
    if (completed.has(socket)) {
      return;
    }
    completed.add(socket);
    try {
      socket.destroy();
    } catch {
      // Best effort on the way out; the peer already went away.
    }
  };

  const finalize = (): void => {
    if (finished) {
      return;
    }
    finished = true;
    try {
      server.close();
    } catch {
      // The server is already closed; removal and resolution still run.
    }
    try {
      rmSync(socketPath, { force: true });
    } catch {
      // Best effort on the way out; the run directory guards still hold.
    }
    resolveDone();
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

  const shutdown = async (id: ControlId, socket: Socket): Promise<void> => {
    if (downRequested) {
      // A second down is a no-op: it answers the current snapshot without
      // running teardown again (close delegates to controller stop, which is
      // safe to call twice).
      endSocket(socket, { id, result: statusResult(handle.controller.snapshot()) });
      return;
    }
    downRequested = true;
    draining = true;
    await drainOthers();
    let reply: ControlReply;
    try {
      reply = { id, result: statusResult(await handle.close()) };
    } catch (error: unknown) {
      reply = { id, error: { code: codeOf(error) } };
    }
    endSocket(socket, reply);
    finalize();
  };

  const dispatch = async (
    method: ControlMethod,
    id: ControlId,
    params: unknown,
    socket: Socket,
  ): Promise<ControlReply | null> => {
    switch (method) {
      case "status": {
        return { id, result: statusResult(handle.controller.snapshot()) };
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
          return { id, error: { code: codeOf(error) } };
        }
        if (!probeResult.ok) {
          return { id, error: { code: probeResult.code } };
        }
        try {
          const snapshot = await handle.controller.create(workspaceRoot);
          return { id, result: statusResult(snapshot) };
        } catch (error: unknown) {
          return { id, error: { code: codeOf(error) } };
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
          return { id, error: { code: codeOf(error) } };
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
      const line = await readLine(socket, timeoutMs);
      const reply = await dispatchLine(line, socket);
      if (reply === null) {
        dropSocket(socket);
      } else {
        endSocket(socket, reply);
      }
    } catch {
      dropSocket(socket);
    } finally {
      inFlight -= 1;
    }
  };

  const track = async (socket: Socket): Promise<void> => {
    try {
      await gate;
    } catch {
      dropSocket(socket);
      return;
    }
    await serveOne(socket);
  };

  const server: Server = createServer((socket: Socket) => {
    socket.once("close", () => {
      completed.delete(socket);
    });
    // track never rejects: gate failures drop the socket and serveOne answers
    // or drops every path. The catch is belt-and-braces so a future edit can
    // never surface an unhandled rejection here.
    void track(socket).catch(() => undefined);
  });

  const abortStart = (cause: unknown): never => {
    failGate(cause);
    try {
      server.close();
    } catch {
      // The server never listened; removal still runs.
    }
    try {
      rmSync(socketPath, { force: true });
    } catch {
      // Best effort on a failed start.
    }
    throw cause;
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
  // Post-listen server errors (a stray connection failure) never throw out of
  // the daemon; per-connection failures are answered or dropped in serveOne.
  server.on("error", () => undefined);

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

function statusResult(snapshot: StateSnapshot): {
  readonly snapshot: StateSnapshot;
  readonly display: DisplayStatus;
} {
  return { snapshot, display: displayStatus(snapshot) };
}

function codeOf(error: unknown): ErrorCode {
  return error instanceof RealmError ? error.code : "SCHEMA_INVALID";
}

// A bridge that immediately reports the engine unreachable. Used only when the
// runtime input configures no Anda URL and the caller injects no bridge, so
// status and doctor keep working while up reports ANDA_UNREACHABLE through the
// controller instead of refusing to construct the handle.
class UnreachableBridge implements BridgePort {
  async connect(): Promise<void> {
    throw makeRealmError("ANDA_UNREACHABLE");
  }

  snapshot(): null {
    return null;
  }

  subscribe(): () => void {
    return () => undefined;
  }

  async close(): Promise<void> {}
}

function defaultSupervisor(driver: AgentOsDriver): AgentOsSupervisor {
  return new AgentOsSupervisor({
    driver,
    callTimeoutMs: AGENTOS_CALL_TIMEOUT_MS,
    random: Math.random,
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
    now: () => Date.now(),
  });
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
  const agentos =
    options.agentos ??
    (options.agentosDriver !== undefined ? defaultSupervisor(options.agentosDriver) : undefined);
  if (agentos === undefined) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return new SessionExecution({
    libpod,
    runner: runOpenShell,
    agentos,
    config: {
      image: config.image,
      workloadArgv: config.workloadArgv,
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

// One newline-terminated line bounded by the socket timeout, mirroring the
// 06-01 channel read. A peer that never answers rejects with TOOL_TIMEOUT; a
// peer that went away rejects with REALM_NOT_ACTIVE.
function readLine(socket: Socket, timeoutMs: number): Promise<string> {
  const pending = new Promise<string>((resolve, reject) => {
    let text = "";
    const cleanup = (): void => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const onData = (chunk: unknown): void => {
      text += String(chunk);
      const end = text.indexOf("\n");
      if (end !== -1) {
        cleanup();
        resolve(text.slice(0, end));
      }
    };
    const onError = (cause: unknown): void => {
      cleanup();
      reject(cause);
    };
    const onClose = (): void => {
      cleanup();
      reject(makeRealmError("REALM_NOT_ACTIVE"));
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
  return withTimeout(pending, timeoutMs, "TOOL_TIMEOUT").catch((error: unknown) => {
    socket.destroy();
    throw error instanceof RealmError ? error : makeRealmError("REALM_NOT_ACTIVE");
  });
}
