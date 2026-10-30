// Daemon: single-owner start, reap-before-serve, method dispatch, and graceful shutdown (P6-D1, P6-D4, P6-D12).
// buildDaemonHandle wires createRealmHandle with the production adapters (SessionExecution over the
// libpod client, AndaBridge over the configured URL, the production OpenShell runner, Date clock); tests inject
// the existing fakes at the same seam. startDaemon binds the control socket once per state directory,
// runs the startup maintenance before serving (runStartupMaintenance: the reap with the bounded sweep, the orphan
// temp-file sweep, the audit reconciliation, then the report; CRASH-01, CRASH-02, CRASH-04), dispatches the five
// CONTROL_METHODS from the 06-01 channel, and tears down on down. The wait for the controller teardown is bounded by
// TEARDOWN_TIMEOUT_MS; socket I/O keeps SOCKET_TIMEOUT_MS. With no AgentOS driver or supervisor bound,
// the handle still builds and up refuses with AGENTOS_NOT_CONFIGURED. This module parses no argv,
// spawns no daemon process, and reads no process environment: every host value arrives through its options.

import { rmSync, statSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { AndaBridge } from "../anda/client.js";
import { appendAudit } from "../audit/log.js";
import { newCorrelationId } from "../observe/ids.js";
import { nullLogger, type Logger } from "../observe/logger.js";
import { createMetrics } from "../observe/metrics.js";
import { reconcileAuditLogs } from "../audit/reconcile.js";
import type { Policy, PolicyMode } from "../contract/validate.js";
import { ERROR_CODES, makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import { loadPolicyFile } from "../core/policy.js";
import type { BridgePort, ExecutionService } from "../core/ports.js";
import type { StateSnapshot } from "../core/state-machine.js";
import { displayStatus, type DisplayStatus } from "../core/status.js";
import { withTimeout } from "../core/timeout.js";
import { defaultRunCommand, runChecks, type AgentOsReading, type CheckResult, type DoctorOptions } from "../doctor/checks.js";
import { bindRoot, isInsideRoot, type PinnedRoot } from "../fs/root.js";
import { DEFAULT_SWEEP_DEADLINE_MS, ORPHAN_TEMP_MIN_AGE_MS, sweepOrphanTempFiles } from "../fs/temp-sweep.js";
import { TEARDOWN_TIMEOUT_MS } from "../lifecycle/controller.js";
import { createRealmHandle, type RealmHandle } from "../realm/compose.js";
import { AgentOsSupervisor, type AgentOsDriver } from "../runtime/agentos.js";
import { andaBridgeRequired, loadRuntimeConfig, type RuntimeConfig } from "../runtime/config.js";
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
import { controlSocketPath, sessionsDirOf, type EnvironmentLike } from "../session/paths.js";
import { reapStartup, type ReapResult } from "../session/reap.js";
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

// How often the daemon probes an active session (RT-04, owner ruling N1). A runner that exited while the session is active is
// reported by the probe as AGENTOS_CRASH_LOOP, and the session moves to error, so the status label tells the truth without a
// doctor run. One probe runs at a time, and each is bounded by the controller's startup budget.
export const HEALTH_PROBE_INTERVAL_MS = 10_000;

// The budget of the startup temp-file sweep and audit reconciliation together, counted from the end of the reap. Both are
// optional cleanup, so a large workspace or audit history must not keep clients waiting: the work that does not fit is
// reported as unfinished and a later start finishes it. The gate opens at most this long, plus one chunk of work, after the reap.
export const STARTUP_MAINTENANCE_BUDGET_MS = 10_000;

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
  // The three roots from config.json (runtimeRootsOf). The driver reads the same file. A stale REALM_DRIVER_*_ROOT
  // variable is ignored. Without a root a session create is refused before any libpod call.
  readonly secretRoot?: string;
  readonly pinnedWorkspaceRoot?: string;
  readonly sandboxStateRoot?: string;
}

// What the startup maintenance did, handed to onStartup. The stable seam for the startup log line (Phases 17 and 19 reshape
// the reap and the logger, not this object). `failures` counts the maintenance steps that threw and the entries the sweeps
// report as failed; a failure never aborts the start.
export interface StartupReport {
  // The ids of the realm containers the reap removed, in removal order. Empty when the sweep is an injected one that names none.
  readonly containerIds: readonly string[];
  readonly containersRemoved: number;
  readonly recordsDeleted: number;
  readonly tempFilesRemoved: number;
  readonly auditLinesReconciled: number;
  // True when the temp-file sweep stopped at its wall or entry bound before it had seen every directory.
  readonly truncated: boolean;
  // The sweep roots the budget left unfinished (the root being walked when it ran out, and every root not reached), as paths.
  readonly unfinishedSweepRoots: readonly string[];
  // The audit logs the budget left unfinished, as base names without a directory. A later start finishes them.
  readonly unfinishedAuditFiles: readonly string[];
  // True when the audit directory held more logs than one start considers, or the deadline ended its listing, so logs that
  // were not considered cannot be named in `unfinishedAuditFiles`.
  readonly auditListingTruncated: boolean;
  // True when no sweep root and no audit log is unfinished. It says nothing about the notice, which is about the reap only.
  readonly maintenanceComplete: boolean;
  // Present only when the reap itself failed: the catalogue code it failed with. The report is then partial: it holds what the
  // reap had destroyed before it stopped, no sweep or reconciliation ran, and the start fails with that same error.
  readonly reapFailure?: ErrorCode;
  readonly failures: number;
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
  readonly sweep?: StartupSweep;
  // Observer for a health probe that threw. The controller has already recorded any outcome that changes the session state; this
  // receives the catalogue code of the failure, including a refusal that left the state unchanged. It must not throw.
  readonly onHealthProbeFailure?: (code: ErrorCode) => void;
  // Observer for the startup maintenance report (CRASH-04). It runs once per start, after the reap, the orphan temp-file sweep
  // and the audit reconciliation and before the daemon serves its first request. It must not throw; a throw aborts the start.
  readonly onStartup?: (report: StartupReport) => void;
  // The budget of the startup temp-file sweep and audit reconciliation together, in milliseconds counted from the end of the
  // reap. Defaults to STARTUP_MAINTENANCE_BUDGET_MS; a test passes 0 or a small value.
  readonly startupMaintenanceBudgetMs?: number;
  // Monotonic clock for that budget, in milliseconds. Defaults to performance.now(); a test injects its own.
  readonly monotonicNow?: () => number;
  readonly store?: Pick<SessionStore, "list" | "delete">;
  readonly socketDirDeps?: SocketDirDeps;
  // Bound for one socket operation and for draining in-flight requests on down.
  readonly timeoutMs?: number;
  // Test seam: receives the listening server, so a test can fail it the way the runtime would.
  readonly onServer?: (server: Server) => void;
  // Request log (OBS-02). Defaults to a logger that writes nothing. The entry passes one whose sink is the daemon log.
  readonly logger?: Logger;
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
  const config = loadRuntimeConfig(options.runtimeInput);
  // The policy is loaded once: the handle and the startup sweep roots read the same document.
  const policy = options.policy ?? loadPolicyFile(options.policyPath);
  const handle = buildDaemonHandle({
    ...options,
    policy,
    ...(libpod === undefined ? {} : { libpod }),
    ...(agentosFor === undefined ? {} : { agentosFor }),
  });
  const stateDir = config.stateDir;
  // The reap's sweep. The default one reports each removed container's id through onRemoved; an injected one reports none.
  const sweep: StartupSweep | undefined =
    options.sweep ??
    (libpod !== undefined ? (onRemoved) => removeAllRealmContainers(libpod, onRemoved) : undefined);
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
      runtimeConfig: config,
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
  // The notice every status, up and down reply carries for the daemon's lifetime once the startup reap destroyed a container or
  // a record (D-1404). It is not consumed on read: Omp attaches with up before it asks for status. Unset until the startup
  // maintenance has run, and unset when nothing was destroyed.
  let startupNotice: string | undefined;
  let upId: string | undefined;
  const logger = options.logger ?? nullLogger;
  const metrics = createMetrics({ now: () => new Date(), monotonicMs: () => performance.now() });
  const statusOf = (snapshot: StateSnapshot): StatusResult => statusResult(snapshot, handle.policyMode, startupNotice);
  const completed = new Set<Socket>();

  // The health loop (RT-04, N1). It runs while the session is in service, active or degraded: a degraded session (the Anda
  // bridge is unreachable) still serves tool calls, so a dead runner there must not keep a truthful-looking label. An event
  // that puts the session in service arms the timer unless one is already armed, so moving between active and degraded keeps
  // exactly one timer, and any event that leaves service clears it. A tick probes through the controller, which owns the
  // transition to error and ignores the result of a probe that began in an earlier life of the session. Ticks never overlap:
  // a tick that finds a probe still running does nothing. The timer is unref'd, so it never keeps the process alive.
  let healthTimer: NodeJS.Timeout | undefined;
  let healthProbing = false;
  const stopHealthLoop = (): void => {
    if (healthTimer !== undefined) {
      clearInterval(healthTimer);
      healthTimer = undefined;
    }
  };
  const healthTick = async (): Promise<void> => {
    const { state } = handle.controller.snapshot();
    if (healthProbing || downRequested || (state !== "active" && state !== "degraded")) {
      return;
    }
    healthProbing = true;
    try {
      const snapshot = await handle.controller.probe();
      if (snapshot.state === "error") {
        const code = catalogueCode(snapshot.reason);
        if (code !== undefined) {
          metrics.recordHealthProbeFailure(code);
        }
        logger.warn("health.probe_failed", {
          ...(code === undefined ? { reason: snapshot.reason } : { code }),
          ...(upId === undefined ? {} : { upId }),
        });
      }
    } catch (error: unknown) {
      const code = codeOf(error);
      metrics.recordHealthProbeFailure(code);
      logger.warn("health.probe_failed", { code, ...(upId === undefined ? {} : { upId }) });
      options.onHealthProbeFailure?.(codeOf(error));
    } finally {
      healthProbing = false;
    }
  };
  const startHealthLoop = (): void => {
    stopHealthLoop();
    healthTimer = setInterval(() => {
      void healthTick();
    }, HEALTH_PROBE_INTERVAL_MS);
    healthTimer.unref();
  };
  const unsubscribeHealth = handle.controller.events.subscribe((event) => {
    metrics.recordTransition(event.from, event.to);
    if (event.to === "active" || event.to === "degraded") {
      if (healthTimer === undefined) {
        startHealthLoop();
      }
    } else {
      stopHealthLoop();
    }
  });
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
    unsubscribeHealth();
    stopHealthLoop();
    draining = true;
    await drainOthers();
    let reply: ControlReply;
    try {
      // The teardown wait is bounded by TEARDOWN_TIMEOUT_MS. Expiry is REALM_STOPPING, the code the controller
      // reports for its own teardown bound; the catalogue has no teardown-timeout code.
      const closed = await withTimeout(handle.close(), TEARDOWN_TIMEOUT_MS, "REALM_STOPPING");
      reply = { id, result: statusOf(closed) };
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
      endSocket(socket, { id, result: statusOf(handle.controller.snapshot()) });
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
        return { id, result: statusOf(handle.controller.snapshot()) };
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
        const correlationId = newCorrelationId();
        const startedAt = performance.now();
        const finishAttach = (): number => {
          const elapsed = Math.round(performance.now() - startedAt);
          metrics.recordAttach(elapsed);
          return elapsed;
        };
        logger.info("up.begin", { correlationId, upId: correlationId });
        let probeResult: PodmanProbeResult;
        try {
          probeResult = await probe();
        } catch (error: unknown) {
          logger.info("up.end", { correlationId, upId: correlationId, durationMs: finishAttach(), code: codeOf(error) });
          return refusalReply(id, error);
        }
        if (!probeResult.ok) {
          logger.info("up.end", { correlationId, upId: correlationId, durationMs: finishAttach(), code: probeResult.code });
          return { id, error: { code: probeResult.code } };
        }
        try {
          const snapshot = await handle.controller.create(workspaceRoot);
          upId = correlationId;
          const code = snapshot.state === "error" ? catalogueCode(snapshot.reason) : undefined;
          logger.info("up.end", {
            correlationId,
            upId,
            durationMs: finishAttach(),
            state: snapshot.state,
            ...(code === undefined ? {} : { code }),
          });
          return { id, result: statusOf(snapshot) };
        } catch (error: unknown) {
          logger.info("up.end", { correlationId, upId: correlationId, durationMs: finishAttach(), code: codeOf(error) });
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
        const correlationId = newCorrelationId();
        const startedAt = performance.now();
        try {
          const outcome = await handle.dispatcher.call(tool, { correlationId });
          const elapsed = Math.round(performance.now() - startedAt);
          const toolName = outcome.tool ?? "unknown";
          if (outcome.outcome === "refused") {
            metrics.recordTool(toolName, "refused", elapsed, outcome.code);
            logger.info("tool.result", {
              correlationId,
              ...(upId === undefined ? {} : { upId }),
              tool: toolName,
              outcome: "refused",
              code: outcome.code,
              durationMs: elapsed,
            });
            return {
              id,
              error:
                outcome.causeCode === undefined
                  ? { code: outcome.code }
                  : { code: outcome.code, causeCode: outcome.causeCode },
            };
          }
          metrics.recordTool(toolName, "done", elapsed);
          logger.info("tool.result", {
            correlationId,
            ...(upId === undefined ? {} : { upId }),
            tool: toolName,
            outcome: "done",
            durationMs: elapsed,
          });
          return { id, result: outcome };
        } catch (error: unknown) {
          const elapsed = Math.round(performance.now() - startedAt);
          metrics.recordTool("unknown", "failed", elapsed, codeOf(error));
          logger.info("tool.result", {
            correlationId,
            ...(upId === undefined ? {} : { upId }),
            tool: "unknown",
            outcome: "error",
            code: codeOf(error),
            durationMs: elapsed,
          });
          return refusalReply(id, error);
        }
      }
      case "down": {
        await shutdown(id, socket);
        return null;
      }
      case "metrics": {
        metrics.setLogLinesDropped(logger.droppedLines());
        return { id, result: metrics.snapshot() };
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
    const reply = await dispatch(request.method, request.id, request.params, socket);
    metrics.recordControl(request.method, reply?.error !== undefined);
    return reply;
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
    // An error on a served socket (a client killed in the middle of its request, a reset or a broken pipe while the reply is
    // written) belongs to that one connection. The read helper removes its own error listener once the request line is read, so
    // without this one Node rethrows the error as an uncaught exception and the daemon, with its sandbox, dies because a peer
    // went away. Nobody is left to answer, so the socket is dropped, which also stops a pending reply from being written to it;
    // the work the request started continues. Failures of the listening server are handled on the server, below.
    socket.on("error", () => {
      dropSocket(socket);
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
    await runStartupMaintenance({
      store,
      sweep,
      policy,
      stateDir,
      sessionId: options.sessionId,
      now: () => Date.now(),
      monotonicNow: options.monotonicNow ?? (() => performance.now()),
      budgetMs: options.startupMaintenanceBudgetMs ?? STARTUP_MAINTENANCE_BUDGET_MS,
      onReport: (report) => {
        startupNotice = startupNoticeOf(report);
        options.onStartup?.(report);
      },
    });
  } catch (error: unknown) {
    abortStart(error);
  }
  openGate();
  return { socketPath, handle, done };
}

// The reap's sweep: removes every realm container and resolves with the count. `onRemoved` receives each removed id, so the
// report can name them; a sweep that names none (most test doubles) ignores the argument.
export type StartupSweep = (onRemoved: (id: string) => void) => Promise<number>;

interface StartupMaintenanceDeps {
  readonly store: Pick<SessionStore, "list" | "delete">;
  readonly sweep: StartupSweep;
  readonly policy: Policy;
  readonly stateDir: string;
  // The session whose audit file records the orphan removals: the daemon's own session.
  readonly sessionId: string;
  // Wall-clock milliseconds, for the age of a temp file (its mtime is a wall-clock value).
  readonly now: () => number;
  // Monotonic milliseconds (performance.now()), for the budget. The deadline is read on this clock only.
  readonly monotonicNow: () => number;
  // The budget of the temp-file sweep and the audit reconciliation together, counted from the end of the reap.
  readonly budgetMs: number;
  // Receives the report once: the full one when the maintenance ended, a partial one (with `reapFailure`) when the reap failed.
  readonly onReport: (report: StartupReport) => void;
}

// The whole startup block (D-1409), in this order: the reap, the orphan temp-file sweep, the audit reconciliation, the
// report. The reap's own failure rejects (nothing is served on a reap that did not prove zero containers). A temp-file
// sweep or reconciliation failure is counted in the report and never aborts the start: a skipped cleanup costs disk and a
// missing reconciliation line, while a daemon that will not start costs the user the sandbox.
//
// The sweep and the reconciliation are optional work, so they share ONE deadline, computed when the reap has ended:
// budgetMs after that moment. The sweep may spend at most half of what remains (and never more than its own 15 s budget),
// so a huge workspace cannot starve the reconciliation start after start; the reconciliation gets whatever is left. Work
// that the deadline cuts off is reported (unfinishedSweepRoots, unfinishedAuditFiles, maintenanceComplete) and finished by
// a later start; the gate opens when the block ends, at most the budget plus one chunk of work after the reap.
async function runStartupMaintenance(deps: StartupMaintenanceDeps): Promise<void> {
  // The reap's progress outlives its call, so a reap that fails halfway still reports what it destroyed.
  const containerIds: string[] = [];
  let sweptCount = 0;
  let recordsDeleted = 0;
  let reaped: ReapResult;
  try {
    reaped = await reapStartup({
      store: {
        list: () => deps.store.list(),
        delete: (id) => {
          deps.store.delete(id);
          recordsDeleted += 1;
        },
      },
      sweep: async () => {
        sweptCount = await deps.sweep((id) => {
          containerIds.push(id);
        });
        return sweptCount;
      },
    });
  } catch (error: unknown) {
    // The reap failed, possibly after it had removed containers or deleted records. Record what was destroyed and why it
    // stopped, hand it to the observer so the log has it, and rethrow the original error: nothing is served after it.
    deps.onReport({
      containerIds,
      containersRemoved: Math.max(sweptCount, containerIds.length),
      recordsDeleted,
      tempFilesRemoved: 0,
      auditLinesReconciled: 0,
      truncated: false,
      unfinishedSweepRoots: [],
      unfinishedAuditFiles: [],
      auditListingTruncated: false,
      maintenanceComplete: false,
      reapFailure: codeOf(error),
      failures: 1,
    });
    throw error;
  }
  const deadline = deps.monotonicNow() + deps.budgetMs;
  let failures = 0;
  let tempFilesRemoved = 0;
  let truncated = false;
  let unfinishedSweepRoots: readonly string[] = [];
  const ownerUid = process.getuid?.();
  if (ownerUid === undefined) {
    // Without a uid the owner rule cannot be applied, so nothing is removed; the report counts the gap.
    failures += 1;
  } else {
    try {
      const sweepShareMs = Math.max(0, Math.floor((deadline - deps.monotonicNow()) / 2));
      const swept = sweepOrphanTempFiles(sweepRootsOf(deps.policy.workspaceRoots, deps.stateDir), {
        now: deps.now(),
        minAgeMs: ORPHAN_TEMP_MIN_AGE_MS,
        ownerUid,
        deadlineMs: Math.min(DEFAULT_SWEEP_DEADLINE_MS, sweepShareMs),
        audit: (entry) => {
          appendAudit(deps.stateDir, {
            sessionId: deps.sessionId,
            tool: entry.tool,
            outcome: entry.outcome,
            path: entry.path,
            bytes: entry.bytes,
          });
        },
      });
      tempFilesRemoved = swept.removed.length;
      truncated = swept.truncated;
      unfinishedSweepRoots = swept.unfinishedRoots;
      failures += swept.failed;
    } catch {
      // The sweep never throws on a bad root or file; this is a failure of the sweep itself, counted in the report.
      failures += 1;
    }
  }
  let auditLinesReconciled = 0;
  let unfinishedAuditFiles: readonly string[] = [];
  let auditListingTruncated = false;
  let auditComplete: boolean;
  try {
    const reconciled = reconcileAuditLogs(deps.stateDir, { now: deps.monotonicNow, deadline });
    auditLinesReconciled = reconciled.appended;
    unfinishedAuditFiles = reconciled.unfinished;
    auditListingTruncated = reconciled.listingTruncated;
    auditComplete = reconciled.complete;
    failures += reconciled.failed;
  } catch {
    // A failure of the reconciliation itself is counted in the report; the lines it appended before it stopped are not.
    failures += 1;
    auditComplete = false;
  }
  deps.onReport({
    containerIds,
    containersRemoved: reaped.containersRemoved,
    recordsDeleted: reaped.recordsDeleted,
    tempFilesRemoved,
    auditLinesReconciled,
    truncated,
    unfinishedSweepRoots,
    unfinishedAuditFiles,
    auditListingTruncated,
    maintenanceComplete: unfinishedSweepRoots.length === 0 && auditComplete,
    failures,
  });
}

// The roots the orphan sweep walks (D-1401): the policy's workspace roots, the sessions directory, the runtime directory and
// the audit directory (where a kill during the atomic write of the reconciliation's progress record leaves a temp file).
// A root that lies inside an earlier one is dropped only when that earlier root's walk reaches it, that is when both are on
// the same device: the walk never crosses into another device, so a root on its own mount (for example /projects/ssd under
// /projects) is kept. When either device cannot be read the root is kept too, because walking a directory twice costs time
// and dropping one that is not covered costs the cleanup. A root that does not bind (for example a runtime directory that
// was never created) is passed on as it is: the sweep counts it as skipped and walks nothing. `deviceOf` is the stat seam.
export function sweepRootsOf(
  workspaceRoots: readonly string[],
  stateDir: string,
  deviceOf: (path: string) => number = (path) => statSync(path).dev,
): readonly string[] {
  const candidates = [...workspaceRoots, sessionsDirOf(stateDir), join(stateDir, "runtime"), join(stateDir, "audit")];
  const bound: PinnedRoot[] = [];
  const roots: string[] = [];
  for (const candidate of candidates) {
    let pinned: PinnedRoot;
    try {
      pinned = bindRoot(candidate);
    } catch {
      roots.push(candidate);
      continue;
    }
    if (bound.some((earlier) => isInsideRoot(earlier, pinned.realPath) && sameDevice(deviceOf, earlier.realPath, pinned.realPath))) {
      continue;
    }
    bound.push(pinned);
    roots.push(pinned.realPath);
  }
  return roots;
}

// True only when both devices are read and equal. A stat that throws means "not known to be covered", so it is false.
function sameDevice(deviceOf: (path: string) => number, covering: string, nested: string): boolean {
  try {
    return deviceOf(covering) === deviceOf(nested);
  } catch {
    // The root is kept and walked on its own, which is the conservative answer to an unreadable device.
    return false;
  }
}

// The notice text (D-1404): present only when the reap destroyed a container or a session record.
function startupNoticeOf(report: StartupReport): string | undefined {
  if (report.containersRemoved === 0 && report.recordsDeleted === 0) {
    return undefined;
  }
  return `A previous daemon's sandbox was destroyed at startup: ${String(report.containersRemoved)} container(s), ${String(report.recordsDeleted)} session record(s). Files in the workspace were kept; state outside it was lost.`;
}

// The result of status, up and down. `notice` is present only after a startup reap that destroyed something, so a reply with
// nothing destroyed has no `notice` key.
interface StatusResult {
  readonly snapshot: StateSnapshot;
  readonly display: DisplayStatus;
  readonly mode: PolicyMode;
  readonly notice?: string;
}

function statusResult(snapshot: StateSnapshot, mode: PolicyMode, notice: string | undefined): StatusResult {
  return {
    snapshot,
    display: displayStatus(snapshot),
    mode,
    ...(notice === undefined ? {} : { notice }),
  };
}

function codeOf(error: unknown): ErrorCode {
  return error instanceof RealmError ? error.code : "SCHEMA_INVALID";
}

function catalogueCode(reason: string): ErrorCode | undefined {
  for (const code of ERROR_CODES) {
    if (code === reason) {
      return code;
    }
  }
  return undefined;
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
    ...(options.sandboxStateRoot !== undefined ? { sandboxStateRoot: options.sandboxStateRoot } : {}),
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
function defaultBridge(config: RuntimeConfig): BridgePort | null {
  if (!andaBridgeRequired(config)) {
    return null;
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
