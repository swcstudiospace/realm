// Daemon: single-owner start, reap-before-serve, selected method dispatch, and graceful shutdown (P6-D1, P6-D4, P6-D12).
// buildDaemonHandle wires createRealmHandle with the production adapters (SessionExecution over the
// libpod client, AndaBridge over the configured URL, the production OpenShell runner, Date clock); tests inject
// the existing fakes at the same seam. startDaemon binds the control socket once per state directory,
// runs the startup maintenance before serving (runStartupMaintenance: the reap with the bounded sweep, the orphan
// temp-file sweep, the audit reconciliation, then the report; CRASH-01, CRASH-02, CRASH-04), and dispatches the six
// CONTROL_METHODS from the channel. Each admitted project (MULTI-02) has its own handle, held in a SessionEntry keyed by
// session id (sessions.ts); every selected request acts on the entry its selection names and on no other. A session's
// teardown bounds its wait by TEARDOWN_TIMEOUT_MS; socket I/O keeps SOCKET_TIMEOUT_MS. With no AgentOS driver or supervisor
// bound, a handle still builds and up refuses with AGENTOS_NOT_CONFIGURED. This module parses no argv,
// spawns no daemon process, and reads no process environment: every host value arrives through its options.

import { rmSync, statSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { isAbsolute, join, relative, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { AndaBridge } from "../anda/client.js";
import { appendAudit } from "../audit/log.js";
import { newCorrelationId } from "../observe/ids.js";
import { nullLogger, type Logger } from "../observe/logger.js";
import { createMetrics } from "../observe/metrics.js";
import { reconcileAuditLogs } from "../audit/reconcile.js";
import type { Policy, PolicyMode } from "../contract/validate.js";
import { makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import { loadPolicyFile } from "../core/policy.js";
import type { BridgePort, ExecutionService } from "../core/ports.js";
import type { StateSnapshot } from "../core/state-machine.js";
import { displayStatus, type DisplayStatus } from "../core/status.js";
import { withTimeout } from "../core/timeout.js";
import { defaultRunCommand, runChecks, type AgentOsReading, type CheckResult, type DoctorOptions } from "../doctor/checks.js";
import { bindRoot, isInsideRoot, type PinnedRoot } from "../fs/root.js";
import { DEFAULT_SWEEP_DEADLINE_MS, ORPHAN_TEMP_MIN_AGE_MS, sweepOrphanTempFiles } from "../fs/temp-sweep.js";
import { isLiveState, TEARDOWN_TIMEOUT_MS } from "../lifecycle/controller.js";
import { createRealmHandle, type RealmHandle } from "../realm/compose.js";
import { AgentOsSupervisor, type AgentOsDriver } from "../runtime/agentos.js";
import { andaBridgeRequired, loadRuntimeConfig, type RuntimeConfig } from "../runtime/config.js";
import { MAX_CONCURRENT_SESSIONS } from "../runtime/hardening.js";
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
import { controlSocketPath, sessionIdOfWorkspace, sessionsDirOf, type EnvironmentLike } from "../session/paths.js";
import { reapStartup, type ReapResult } from "../session/reap.js";
import { SessionStore } from "../session/store.js";
import {
  listWorkspaceEntryIds,
  readWorkspaceEntry,
  removeWorkspaceEntry,
  writeWorkspaceEntry,
} from "../session/workspace-registry.js";
import { AdmissionLedger } from "./admission.js";
import {
  chmodSocket,
  CONTROL_TIMEOUT_MS,
  decodeRequest,
  encodeReply,
  ensureSocketDir,
  isControlMethod,
  oversizedLineReply,
  parseControlSelection,
  readControlLine,
  replyForMalformedLine,
  SOCKET_TIMEOUT_MS,
  unknownMethodReply,
  type ControlId,
  type ControlMethod,
  type ControlReply,
  type ControlRequest,
  type ControlSelection,
  type SocketDirDeps,
} from "./channel.js";
import {
  catalogueCode,
  codeOf,
  DAEMON_REPLY_ALLOWANCE_MS,
  downLockWaitMs,
  isSessionLockHeld,
  reserveAdmission,
  resolveSelection,
  settleFailedCreate,
  SessionHealth,
  SessionRegistry,
  unboundSnapshot,
  upLockWaitMs,
  withSessionLock,
  type ResolvedSelection,
  type SessionEntry,
} from "./sessions.js";

// Default bound for one AgentOS driver call in the production supervisor. The
// only purpose is to keep a hung driver from hanging daemon startup; the
// controller still enforces the policy startup budget around the whole path.
// The supervisor wraps every driver call in this budget, and a sandbox create takes tens of seconds. It
// must exceed the driver's create budget (AGENTOS_START_TIMEOUT_MS in main.ts, 180 s) with margin.
const AGENTOS_CALL_TIMEOUT_MS = 200_000;

// The budget of the startup temp-file sweep and audit reconciliation together, counted from the end of the reap. Both are
// optional cleanup, so a large workspace or audit history must not keep clients waiting: the work that does not fit is
// reported as unfinished and a later start finishes it. The gate opens at most this long, plus one chunk of work, after the reap.
const STARTUP_MAINTENANCE_BUDGET_MS = 10_000;

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
  // Orphan temp files removed from no recorded workspace. They are counted here and written to no audit file (C9).
  readonly unattributedTempFiles: number;
  // Records the startup could not read. Their workspace is unknown, so they own no orphan (C9).
  readonly unattributedRecords: number;
  // Registry entries of earlier generations that the startup removed.
  readonly registryEntriesRemoved: number;
  readonly failures: number;
}

export interface StartDaemonOptions extends Omit<BuildDaemonHandleOptions, "sessionId"> {
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
  readonly store?: Pick<SessionStore, "list" | "load" | "delete">;
  readonly socketDirDeps?: SocketDirDeps;
  // Bound for one socket operation and for draining in-flight requests on down.
  readonly timeoutMs?: number;
  // Test seam: receives the listening server, so a test can fail it the way the runtime would.
  readonly onServer?: (server: Server) => void;
  // Request log (OBS-02). Defaults to a logger that writes nothing. The entry passes one whose sink is the daemon log.
  readonly logger?: Logger;
  // The most sessions the daemon admits at once (C7). Defaults to MAX_CONCURRENT_SESSIONS.
  readonly maxSessions?: number;
  // Builds the handle of one admitted session. Defaults to buildDaemonHandle; a test wraps it to patch a controller before up.
  readonly buildHandle?: (options: BuildDaemonHandleOptions) => RealmHandle;
  // Called with a session id after its container is created, and after its record and registry entry are removed on its
  // destroy. The daemon reads no audit file; the caller does.
  readonly onAuditHead?: (sessionId: string) => void;
  // The client bound of each method that waits on a lock, in milliseconds. Defaults to CONTROL_TIMEOUT_MS.
  readonly clientBoundMs?: Partial<Record<"up" | "down", number>>;
  // The slack kept on a client bound for the reply. Defaults to DAEMON_REPLY_ALLOWANCE_MS.
  readonly replyAllowanceMs?: number;
}

export interface StartedDaemon {
  readonly socketPath: string;
  // Resolves when the daemon has stopped: every session is stopped, the server is released and the socket is removed.
  // Rejects with the stop reason when the listening server failed. The entrypoint exits the process then; this
  // module never exits.
  readonly done: Promise<void>;
  // Stops every admitted session in process and ends the daemon. It sends no control message and writes no reply. Rejects
  // with the teardown's code when a session did not stop; the daemon has stopped either way.
  stop(): Promise<void>;
  // The entry of an admitted session, or undefined. It is the only way to reach a session's handle.
  session(sessionId: string): SessionEntry | undefined;
  committedCount(): number;
  isCommitted(sessionId: string): boolean;
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
  const bridge = options.bridge ?? defaultBridge(config, options.logger);
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
// stopped (P6-D1, P6-D4). A rival owner bound to the same socket refuses with
// LOCK_CONFLICT; a failed sweep rejects before any record is touched and before
// anything is served.
export async function startDaemon(options: StartDaemonOptions): Promise<StartedDaemon> {
  const timeoutMs = options.timeoutMs ?? SOCKET_TIMEOUT_MS;
  const libpod =
    options.libpod ??
    (options.libpodSocketPath !== undefined ? new LibpodClient(options.libpodSocketPath) : undefined);
  // One supervisor per session: the caller's, or one built over the driver. A session's handle and the doctor probe share
  // its supervisor, so each session's supervision state is one object.
  const agentosFor =
    options.agentosFor ?? (options.agentosDriver !== undefined ? supervisorsOver(options.agentosDriver) : undefined);
  const config = loadRuntimeConfig(options.runtimeInput);
  // The policy is loaded once: every session's handle and the startup sweep roots read the same document.
  const policy = options.policy ?? loadPolicyFile(options.policyPath);
  // The ceiling every admitted workspace must lie inside (MULTI-02): the configured workspace root, bound once.
  const ceiling = bindRoot(config.workspaceRoot);
  const clock = options.clock ?? (() => new Date());
  const stateDir = config.stateDir;
  // The reap's sweep. The default one reports each removed container's id through onRemoved; an injected one reports none.
  const sweep: StartupSweep | undefined =
    options.sweep ??
    (libpod !== undefined ? (onRemoved) => removeAllRealmContainers(libpod, onRemoved) : undefined);
  if (sweep === undefined) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const store = options.store ?? new SessionStore(stateDir);
  const probeTimeoutMs = options.probeTimeoutMs ?? SOCKET_TIMEOUT_MS;
  const probe =
    options.probe ??
    (() =>
      probePodman({
        runCommand: options.runCommand ?? defaultRunCommand,
        connectSocket: options.connectSocket ?? defaultConnectSocket,
        env: options.env ?? {},
        timeoutMs: probeTimeoutMs,
      }));
  // The client bound and the reply slack set the lock waits and the post-grant budgets of the locked methods.
  const clientBoundMs = (method: "up" | "down"): number => options.clientBoundMs?.[method] ?? CONTROL_TIMEOUT_MS[method];
  const replyAllowanceMs = options.replyAllowanceMs ?? DAEMON_REPLY_ALLOWANCE_MS;
  const upWaitMs = upLockWaitMs(clientBoundMs("up"), probeTimeoutMs, replyAllowanceMs);
  const downWaitMs = downLockWaitMs(clientBoundMs("down"), replyAllowanceMs);
  // The one admission ledger of the daemon: the count of admitted sessions is the daemon's, never the driver's (C7).
  const ledger = new AdmissionLedger({
    maxSessions: options.maxSessions ?? MAX_CONCURRENT_SESSIONS,
    recordedIds: () => store.list(),
  });
  const registry = new SessionRegistry();
  // The correlation id of the up that last admitted each session. The audit lines of its tool calls name it.
  const upIds = new Map<string, string>();
  const buildHandle = options.buildHandle ?? buildDaemonHandle;
  // The options every session's handle is built from. The runtime input and the session id are per session.
  const handleBase = {
    ...options,
    policy,
    ...(libpod === undefined ? {} : { libpod }),
    ...(agentosFor === undefined ? {} : { agentosFor }),
  };
  // The doctor report. With a session selected, its AgentOS reading is that session's supervisor; with none, unbound (C4).
  const runDoctor = (sessionId: string | null): Promise<readonly CheckResult[]> =>
    (options.runChecks ?? runChecks)({
      stateDir,
      policyPath: options.policyPath,
      agentos: async (): Promise<AgentOsReading> =>
        sessionId === null || agentosFor === undefined
          ? { bound: false }
          : { bound: true, alive: await agentosFor(sessionId).check() },
      env: options.env ?? {},
      ...options.doctorOptions,
      runtimeConfig: config,
    });

  // Lifecycle and control lines go through the caller's logger: requests.log in production (D-1704).
  const logger = options.logger ?? nullLogger;
  logger.info("daemon.starting");
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
  // Set once a stop has begun: by a down that leaves no live session, by a signal, or by a failed server. Admission refuses
  // from then on, and the health loops probe nothing.
  let downRequested = false;
  // The flag changes across awaits, which control-flow narrowing does not track.
  const isDownRequested = (): boolean => downRequested;
  // Set by a down that leaves no live session. The stop runs after that down's reply is written (serveOne).
  let stopAfterReply = false;
  // The notice every status, up and down reply carries for the daemon's lifetime once the startup reap destroyed a container or
  // a record (D-1404). It is not consumed on read: Omp attaches with up before it asks for status. Unset until the startup
  // maintenance has run, and unset when nothing was destroyed.
  let startupNotice: string | undefined;
  const metrics = createMetrics({ now: () => new Date(), monotonicMs: () => performance.now() });
  const completed = new Set<Socket>();

  // The reply of status, up and down for a selection: the snapshot, the bound root and the session id the selection names.
  const selectedResult = (snapshot: StateSnapshot, pinned: PinnedRoot, sessionId: string): StatusResult => ({
    ...statusResult(snapshot, policy.mode, startupNotice),
    boundRoot: pinned.realPath,
    sessionId,
  });
  const resolveTarget = (selection: ControlSelection): ResolvedSelection =>
    resolveSelection({ selection, policy, ceiling, registry });

  // Builds the entry of a new session: its handle, its workspace entry and its health loop. The handle is built for the pinned
  // directory and nothing is created yet, so a failure here leaves no container.
  const newEntry = (sessionId: string, pinned: PinnedRoot): SessionEntry => {
    const handle = buildHandle({
      ...handleBase,
      sessionId,
      runtimeInput: runtimeInputAt(options.runtimeInput, pinned.realPath),
    });
    writeWorkspaceEntry(stateDir, pinned, sessionId);
    const health = new SessionHealth({
      sessionId,
      handle,
      metrics,
      logger,
      isStopping: () => downRequested,
      onProbeFailure: options.onHealthProbeFailure,
    });
    return { sessionId, pinned, handle, health };
  };

  const finishUp = (correlationId: string, startedAt: number, state: string | undefined, code: ErrorCode | undefined): void => {
    const durationMs = Math.round(performance.now() - startedAt);
    metrics.recordAttach(durationMs);
    logger.info("up.end", {
      correlationId,
      upId: correlationId,
      durationMs,
      ...(state === undefined ? {} : { state }),
      ...(code === undefined ? {} : { code }),
    });
  };

  // The admission of one up, run under the lock of its session id. Its steps are numbered as the plan states them: the
  // stop check (1), the selection (2), the collision check (3), the post-grant check of a waiter, the reservation (4), the probe
  // (5), the stop check after the probe (5a), and the create on the entry (6). A refusal before (4) takes no slot.
  const admitUp = async (
    realPath: string,
    sessionId: string,
    correlationId: string,
    waiter: boolean,
    dispatchedAt: number,
  ): Promise<StatusResult> => {
    if (downRequested) {
      throw makeRealmError("REALM_STOPPING");
    }
    const resolved = resolveTarget({ workspaceRoot: realPath, sessionId });
    const { pinned, entry } = resolved;
    if (entry === null) {
      const recorded = store.load(sessionId);
      const registered = readWorkspaceEntry(stateDir, sessionId);
      if (
        (recorded !== null && recorded.workspaceRoot !== pinned.realPath) ||
        (registered !== null && registered.workspaceRoot !== pinned.realPath)
      ) {
        throw makeRealmError("SANDBOX_NAME_IN_USE");
      }
    }
    // A waiter that finds its budget spent by the wait is refused before any reservation. A live session is not refused here:
    // it is admitted through the path below, where its id is already committed and create returns its snapshot.
    if (waiter) {
      const live = entry !== null && isLiveState(entry.handle.controller.snapshot().state);
      const remaining = clientBoundMs("up") - (performance.now() - dispatchedAt) - replyAllowanceMs;
      if (!live && remaining < 2 * probeTimeoutMs + policy.startupBudgetMs) {
        throw makeRealmError("STARTUP_BUDGET_EXCEEDED");
      }
    }
    const fresh = reserveAdmission(ledger, sessionId);
    // A reservation this request created is released when no container can exist for the id.
    const releaseFresh = (): void => {
      if (fresh) {
        ledger.release(sessionId);
      }
    };
    try {
      const probeResult = await probe();
      if (!probeResult.ok) {
        throw makeRealmError(probeResult.code);
      }
    } catch (error: unknown) {
      releaseFresh();
      throw error;
    }
    if (isDownRequested()) {
      releaseFresh();
      throw makeRealmError("REALM_STOPPING");
    }
    let current = entry;
    if (current === null) {
      try {
        current = newEntry(sessionId, pinned);
      } catch (error: unknown) {
        releaseFresh();
        throw error;
      }
      registry.set(sessionId, current);
    }
    const wasLive = isLiveState(current.handle.controller.snapshot().state);
    let snapshot: StateSnapshot;
    try {
      snapshot = await current.handle.controller.create(pinned.realPath);
    } catch (error: unknown) {
      settleFailedCreate(ledger, registry, stateDir, sessionId, current.handle, fresh);
      throw error;
    }
    // An error snapshot other than a teardown's keeps its slot as the create settles it (the enterError rule of the controller).
    if (snapshot.state === "error" && snapshot.reason !== "REALM_STOPPING") {
      settleFailedCreate(ledger, registry, stateDir, sessionId, current.handle, fresh);
    }
    upIds.set(sessionId, correlationId);
    if (!wasLive && snapshot.state !== "error") {
      options.onAuditHead?.(sessionId);
    }
    return selectedResult(snapshot, pinned, sessionId);
  };

  // The release of a session, run under the lock of its id. A down of an id with no entry replies the unbound snapshot and
  // destroys nothing. A down of an entry destroys its container, then removes its record, registry entry and admission slot. A
  // failed destroy keeps all three and holds the slot as unproven. After a successful destroy, or for a down that names no live
  // session, the daemon stops once its reply is written when no session is live and no admission is in flight.
  const releaseSession = async (selection: ControlSelection, waiter: boolean, dispatchedAt: number): Promise<StatusResult> => {
    const resolved = resolveTarget(selection);
    const { entry, pinned, sessionId } = resolved;
    if (entry !== null) {
      if (waiter) {
        const remaining = clientBoundMs("down") - (performance.now() - dispatchedAt) - replyAllowanceMs;
        if (remaining < TEARDOWN_TIMEOUT_MS + replyAllowanceMs) {
          throw makeRealmError("TOOL_TIMEOUT");
        }
      }
      try {
        await entry.handle.controller.destroy();
      } catch (error: unknown) {
        ledger.markUnproven(sessionId);
        throw error;
      }
      removeWorkspaceEntry(stateDir, sessionId);
      ledger.release(sessionId);
      registry.delete(sessionId);
      entry.health.dispose();
      upIds.delete(sessionId);
      // The destroy of the session is one line in its own audit file, written before the head of that file is read.
      appendAudit(stateDir, { sessionId, tool: "session.destroy", outcome: "ok" });
      options.onAuditHead?.(sessionId);
    }
    if (!downRequested && registry.size === 0 && ledger.reservedCount() === 0) {
      // Set under the lock, so an up queued behind this down is refused with REALM_STOPPING when it is granted.
      downRequested = true;
      stopAfterReply = true;
    }
    return selectedResult(unboundSnapshot(clock), pinned, sessionId);
  };

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
    // A down keeps its own in-flight count until its request is answered, so the drain
    // waits only for the other requests (inFlight above one).
    const deadline = Date.now() + timeoutMs;
    while (inFlight > 1 && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
      });
    }
  };

  // The one stop path: a signal, a failed listening server, or the stop a down arms once no session remains. Every admitted
  // session is stopped (controller.stop keeps its record, so the next start's reap clears it), its health loop is disposed,
  // the server closes and the socket file is removed. Nothing is written to a socket. Resolves with the teardown's failure
  // code when a session did not stop, and never rejects. A failed server passes its code as the reason, so done rejects with
  // that code instead of resolving.
  const closeEverything = async (reason: ErrorCode | undefined): Promise<ErrorCode | undefined> => {
    logger.info("daemon.stopping");
    downRequested = true;
    draining = true;
    await drainOthers();
    let failure: ErrorCode | undefined;
    for (const entry of registry.values()) {
      entry.health.dispose();
      try {
        // The teardown wait is bounded by TEARDOWN_TIMEOUT_MS. Expiry is REALM_STOPPING, the code the controller
        // reports for its own teardown bound; the catalogue has no teardown-timeout code.
        await withTimeout(entry.handle.controller.stop(), TEARDOWN_TIMEOUT_MS, "REALM_STOPPING");
      } catch (error: unknown) {
        failure ??= codeOf(error);
      }
    }
    // Written after the teardown attempt, whether it finished or was refused, and before the socket is removed.
    logger.info("daemon.stopped");
    server.close();
    // A socket file that cannot be removed is the stop's refusal, never a silent loss. The daemon stops either way.
    const removal = removeSocketFile(socketPath);
    if (reason !== undefined) {
      rejectDone(makeRealmError(reason, removal?.code));
    } else if (removal !== undefined) {
      // The socket file that cannot be removed is the daemon's failure: done rejects with its code.
      rejectDone(removal);
    } else {
      resolveDone();
    }
    return failure;
  };

  let stopping: Promise<ErrorCode | undefined> | undefined;
  const stopDaemon = (reason?: ErrorCode): Promise<ErrorCode | undefined> => {
    if (stopping === undefined) {
      stopping = closeEverything(reason);
    }
    return stopping;
  };

  const dispatch = async (
    method: ControlMethod,
    id: ControlId,
    selection: ControlSelection | null,
    params: unknown,
  ): Promise<ControlReply> => {
    switch (method) {
      case "status": {
        const resolved = resolveTarget(requireSelection(selection));
        const snapshot = resolved.entry === null ? unboundSnapshot(clock) : resolved.entry.handle.controller.snapshot();
        return { id, result: selectedResult(snapshot, resolved.pinned, resolved.sessionId) };
      }
      case "up": {
        const realPath = bindRoot(workspaceRootOf(params)).realPath;
        const sessionId = sessionIdOfWorkspace(realPath);
        const correlationId = newCorrelationId();
        const startedAt = performance.now();
        // A request that finds the lock held is a waiter: only a waiter applies the post-grant checks.
        const waiter = isSessionLockHeld(sessionId);
        logger.info("up.begin", { correlationId, upId: correlationId, sessionId });
        let result: StatusResult;
        try {
          result = await withSessionLock(
            sessionId,
            () => admitUp(realPath, sessionId, correlationId, waiter, startedAt),
            upWaitMs,
          );
        } catch (error: unknown) {
          finishUp(correlationId, startedAt, undefined, codeOf(error));
          throw error;
        }
        const code = result.snapshot.state === "error" ? catalogueCode(result.snapshot.reason) : undefined;
        finishUp(correlationId, startedAt, result.snapshot.state, code);
        return { id, result };
      }
      case "tool": {
        const tool: unknown =
          typeof params === "object" && params !== null && !Array.isArray(params) && "tool" in params
            ? params.tool
            : undefined;
        if (typeof tool !== "object" || tool === null || Array.isArray(tool)) {
          return { id, error: { code: "SCHEMA_INVALID" } };
        }
        const resolved = resolveTarget(requireSelection(selection));
        if (resolved.entry === null) {
          throw makeRealmError("REALM_NOT_ACTIVE");
        }
        const { sessionId } = resolved;
        const correlationId = newCorrelationId();
        const upId = upIds.get(sessionId);
        const startedAt = performance.now();
        try {
          const outcome = await resolved.entry.handle.dispatcher.call(tool, {
            correlationId,
            ...(upId === undefined ? {} : { upId }),
          });
          const elapsed = Math.round(performance.now() - startedAt);
          const toolName = outcome.tool ?? "unknown";
          if (outcome.outcome === "refused") {
            metrics.recordTool(toolName, "refused", elapsed, outcome.code);
            logger.info("tool.result", {
              correlationId,
              sessionId,
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
            sessionId,
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
            sessionId,
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
        const target = requireSelection(selection);
        // A request that finds the lock held is a waiter: only a waiter applies the post-grant checks.
        const waiter = isSessionLockHeld(target.sessionId);
        const dispatchedAt = performance.now();
        const result = await withSessionLock(
          target.sessionId,
          () => releaseSession(target, waiter, dispatchedAt),
          downWaitMs,
        );
        return { id, result };
      }
      case "metrics": {
        resolveTarget(requireSelection(selection));
        metrics.setLogLinesDropped(logger.droppedLines());
        return { id, result: metrics.snapshot() };
      }
      case "doctor": {
        try {
          const sessionId = selection === null ? null : (resolveTarget(selection).entry?.sessionId ?? null);
          const results = await runDoctor(sessionId);
          return { id, result: results };
        } catch (error: unknown) {
          return refusalReply(id, error);
        }
      }
    }
  };

  // A line that names no known method is refused without its text: the method is client text, so the log says "unrecognized".
  const refuseUnrecognized = (reply: ControlReply | null): ControlReply | null => {
    const refused = reply?.error;
    if (refused !== undefined) {
      logger.warn("control.refused", { method: "unrecognized", code: refused.code });
    }
    return reply;
  };

  // Runs one decoded request. The selection is validated first (parseControlSelection), and any refusal, from the validator or
  // from the dispatch, becomes the reply under the request's id.
  const dispatchRequest = async (method: ControlMethod, id: ControlId, params: unknown): Promise<ControlReply> => {
    try {
      const { selection } = parseControlSelection(method, params);
      return await dispatch(method, id, selection, params);
    } catch (error: unknown) {
      return refusalReply(id, error);
    }
  };

  const dispatchLine = async (line: string): Promise<ControlReply | null> => {
    let request: ControlRequest;
    try {
      request = decodeRequest(line);
    } catch {
      return refuseUnrecognized(replyForMalformedLine(line));
    }
    if (!isControlMethod(request.method)) {
      return refuseUnrecognized(unknownMethodReply(request.id));
    }
    // A control line names only the method. Params, ids and payloads are never logged (requests.log, D-1704).
    logger.debug("control.request", { method: request.method });
    const reply = await dispatchRequest(request.method, request.id, request.params);
    const refused = reply.error;
    metrics.recordControl(request.method, refused !== undefined);
    if (refused !== undefined) {
      logger.warn("control.refused", { method: request.method, code: refused.code });
    }
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
      const reply = await dispatchLine(read.line);
      if (reply === null) {
        dropSocket(socket);
      } else {
        endSocket(socket, reply);
      }
      if (stopAfterReply) {
        stopAfterReply = false;
        void stopDaemon();
      }
    } catch (error: unknown) {
      endSocket(socket, refusalReply(null, error));
    } finally {
      inFlight -= 1;
    }
  };

  let resolveDone!: () => void;
  let rejectDone!: (cause: unknown) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // A stop that rejects here is reported to whoever awaits done. A stop that nobody awaits yet is not an unhandled rejection.
  done.catch(() => undefined);
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
    // without this one Node rethrows the error as an uncaught exception and the daemon, with its sandboxes, dies because a peer
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
        logger.info("daemon.listening");
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
    void stopDaemon(codeOf(error));
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
  return {
    socketPath,
    done,
    stop: async (): Promise<void> => {
      const failure = await stopDaemon();
      if (failure !== undefined) {
        throw makeRealmError(failure);
      }
    },
    session: (sessionId: string): SessionEntry | undefined => registry.get(sessionId),
    committedCount: (): number => ledger.committedCount(),
    isCommitted: (sessionId: string): boolean => ledger.isCommitted(sessionId),
  };
}

// The reap's sweep: removes every realm container and resolves with the count. `onRemoved` receives each removed id, so the
// report can name them; a sweep that names none (most test doubles) ignores the argument.
export type StartupSweep = (onRemoved: (id: string) => void) => Promise<number>;

interface StartupMaintenanceDeps {
  readonly store: Pick<SessionStore, "list" | "load" | "delete">;
  readonly sweep: StartupSweep;
  readonly policy: Policy;
  readonly stateDir: string;
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
  let registryEntriesRemoved = 0;
  let unreadableRecords = 0;
  let unattributedTempFiles = 0;
  let owners: readonly RecordOwner[] = [];
  let reaped: ReapResult;
  try {
    // The owners are read before the reap deletes the records, so each orphan's removal can be attributed (C9).
    const captured = captureOwners(deps.store);
    owners = captured.owners;
    unreadableRecords = captured.unreadable;
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
    // The reap deleted every record, so no registry entry is live: each entry left by an earlier generation is removed.
    for (const id of listWorkspaceEntryIds(deps.stateDir)) {
      removeWorkspaceEntry(deps.stateDir, id);
      registryEntriesRemoved += 1;
    }
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
      unattributedTempFiles,
      unattributedRecords: unreadableRecords,
      registryEntriesRemoved,
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
          const sessionId = ownerOfPath(owners, entry.path);
          if (sessionId === undefined) {
            unattributedTempFiles += 1;
            return;
          }
          appendAudit(deps.stateDir, {
            sessionId,
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
    unattributedTempFiles,
    unattributedRecords: unreadableRecords,
    registryEntriesRemoved,
    failures,
  });
}

// A record as it stood before the reap: the session it names and the workspace it was recorded for.
interface RecordOwner {
  readonly sessionId: string;
  readonly workspaceRoot: string;
}

// The records the reap is about to delete. A record that cannot be read has no known workspace, so it owns no orphan, and it
// is counted.
function captureOwners(store: Pick<SessionStore, "list" | "load">): { readonly owners: RecordOwner[]; readonly unreadable: number } {
  const owners: RecordOwner[] = [];
  let unreadable = 0;
  for (const sessionId of store.list()) {
    let record: ReturnType<SessionStore["load"]>;
    try {
      record = store.load(sessionId);
    } catch {
      unreadable += 1;
      continue;
    }
    if (record === null) {
      unreadable += 1;
    } else {
      owners.push({ sessionId, workspaceRoot: record.workspaceRoot });
    }
  }
  return { owners, unreadable };
}

// The session whose recorded workspace contains the path: an owner whose root is the path or one of its ancestors, the longest
// root winning. The comparison is by path segment, so /ws-other is not inside /ws. Undefined when no owner contains it.
function ownerOfPath(owners: readonly RecordOwner[], path: string): string | undefined {
  let best: RecordOwner | undefined;
  for (const owner of owners) {
    const rel = relative(owner.workspaceRoot, path);
    const contains = rel === "" || (!isAbsolute(rel) && rel.split(sep)[0] !== "..");
    if (contains && (best === undefined || owner.workspaceRoot.length > best.workspaceRoot.length)) {
      best = owner;
    }
  }
  return best?.sessionId;
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
interface StatusResult extends StatusReport {
  readonly boundRoot: string;
  readonly sessionId: string;
}

function statusResult(snapshot: StateSnapshot, mode: PolicyMode, notice: string | undefined): StatusReport {
  return {
    snapshot,
    display: displayStatus(snapshot),
    mode,
    ...(notice === undefined ? {} : { notice }),
  };
}

// The selection a selected method must carry. parseControlSelection guarantees it for every such method.
function requireSelection(selection: ControlSelection | null): ControlSelection {
  if (selection === null) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return selection;
}

// The workspace root an up names. parseControlSelection has checked its shape.
function workspaceRootOf(params: unknown): string {
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
function runtimeInputAt(runtimeInput: unknown, workspaceRoot: string): unknown {
  if (typeof runtimeInput !== "object" || runtimeInput === null || Array.isArray(runtimeInput)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return { ...runtimeInput, workspaceRoot };
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
function defaultBridge(config: RuntimeConfig, logger: Logger | undefined): BridgePort | null {
  if (!andaBridgeRequired(config)) {
    return null;
  }
  return new AndaBridge({ url: config.andaUrl, ...(logger === undefined ? {} : { logger }) });
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
