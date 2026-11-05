// Daemon entry (RT-01, P6-D1, P6-D4). Reads the runtime config file, starts the daemon through
// startDaemon, and holds the process until a SIGTERM or SIGINT, or a control-channel down, completes
// teardown. A signal stops the daemon in process and sends no control message, so a signal and a control-channel down both
// reach the daemon's one stop path. This module parses no argv. It reads process.env once, in
// main. Only the uncaught-failure handler calls process.exit, after logging `daemon.failed`. Otherwise the exit code is set
// on process.exitCode and the event loop drains.

import { join } from "node:path";
import { readAuditHead } from "../audit/chain.js";
import { RealmError, type ErrorCode } from "../core/errors.js";
import { loadRuntimeConfig, runtimeRootsOf } from "../runtime/config.js";
import { defaultPolicyPath, isDirectEntry, podmanSocketPath, readHostRuntime } from "../runtime/host-paths.js";
import { createOpenShellAgentOsDriver } from "../runtime/agentos-driver.js";
import { productionRunnerChild } from "../runtime/agentos-workload.js";
import type { AgentOsDriver } from "../runtime/agentos.js";
import { productionOpenShellRunner } from "../runtime/session-execution.js";
import type { EnvironmentLike } from "../session/paths.js";
import { createLogger, parseLogLevel, type LogFailureCategory, type Logger } from "../observe/logger.js";
import { createFileSink } from "../observe/log-file.js";
import { FAILURE_EVENT, daemonLogPath, requestLogPath } from "./ensure.js";
import { startDaemon, type StartDaemonOptions, type StartedDaemon } from "./daemon.js";
import type { StartupReport } from "./startup.js";

export type DaemonSignal = "SIGTERM" | "SIGINT";

const SIGNALS: readonly DaemonSignal[] = ["SIGTERM", "SIGINT"];

// startDaemon derives the state directory from runtimeInput; stateDir is carried alongside so the
// entry derives the policy path from the same value.
export type DaemonStartOptions = StartDaemonOptions & { readonly stateDir: string };

export interface DaemonDeps {
  readonly env: EnvironmentLike;
  readonly readConfig?: (path: string) => unknown;
  readonly start?: (options: DaemonStartOptions) => Promise<StartedDaemon>;
  readonly writeStderr?: (line: string) => void;
  readonly onSignal?: (signal: DaemonSignal, handler: () => void) => () => void;
}

interface StopWiring {
  readonly onSignal: (signal: DaemonSignal, handler: () => void) => () => void;
  readonly writeStderr: (line: string) => void;
}

// The AgentOS driver is always bound. Its sandbox image is config.image alone: the digest-pinned value the runtime
// config loader validates at load (readHostRuntime), which startDaemon receives as runtimeInput. Each session's sandbox
// is realm-<sessionId>, created from that image, and its runner runs there as the workload.
// The three roots come from that same config (runtimeRootsOf). A stale REALM_DRIVER_SECRET_ROOT,
// REALM_DRIVER_WORKSPACE_ROOT or REALM_DRIVER_STATE_ROOT is ignored.
// Start provisions the runner child and waits for its probe, so it gets the long budget; probe and delete get the short one.
const AGENTOS_START_TIMEOUT_MS = 180_000;
const AGENTOS_CALL_TIMEOUT_MS = 30_000;

function productionAgentOsDriver(env: EnvironmentLike, stateDir: string): AgentOsDriver {
  const driverSocket = env["REALM_DRIVER_SOCKET"];
  return createOpenShellAgentOsDriver({
    runner: productionOpenShellRunner(env),
    spawnRunner: productionRunnerChild(env),
    stateDir,
    startTimeoutMs: AGENTOS_START_TIMEOUT_MS,
    callTimeoutMs: AGENTOS_CALL_TIMEOUT_MS,
    // The compute driver's socket, as the daemon's environment names it. Unset, no socket is configured: driverAnswers is not
    // probed and the supervisor does not claim the driver is down. realm doctor reports the unset variable.
    ...(driverSocket === undefined ? {} : { driverSocketPath: driverSocket }),
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
    const roots = runtimeRootsOf(loadRuntimeConfig(runtimeInput));
    const libpodSocketPath = podmanSocketPath(deps.env);
    const agentosDriver = productionAgentOsDriver(deps.env, stateDir);
    const requests = requestLogger(writeStderr, deps.env["REALM_LOG_LEVEL"], requestLogPath(stateDir));
    const entry = entryWriter(deps.writeStderr, stateDir, writeStderr);
    try {
      started = await start({
        stateDir,
        runtimeInput,
        policyPath: defaultPolicyPath(stateDir),
        env: deps.env,
        ...(libpodSocketPath === undefined ? {} : { libpodSocketPath }),
        agentosDriver,
        secretRoot: roots.secretRoot,
        sandboxStateRoot: roots.sandboxStateRoot,
        onStartup: (report) => {
          emitStartup(entry.write, report);
        },
        onAuditHead: (sessionId) => {
          emitAuditHead(stateDir, sessionId, entry.write);
        },
        logger: requests.logger,
      });
    } catch (error: unknown) {
      requests.close();
      emitFailure(entry.write, codeOf(error));
      closeEntry(entry, writeStderr);
      return 1;
    }
    try {
      const code = await awaitStop(started, {
        onSignal: deps.onSignal ?? registerSignal,
        writeStderr: entry.write,
      });
      return code;
    } finally {
      requests.close();
      closeEntry(entry, writeStderr);
    }
  } catch (error: unknown) {
    emitFailure(writeStderr, codeOf(error));
    return 1;
  }
}

// The one startup record (CRASH-04): what the reap destroyed and adopted, what the orphan sweep removed, what the audit
// reconciliation appended, and whether the budgeted maintenance finished. The container ids are not secrets.
// When the reap itself failed, reapFailure names the code; the daemon then exits with that code on its own
// daemon.failed line.
const STARTUP_NAME_CAP = 10;

// The entry's own startup and failure lines go through the logger, so each is one JSON object with the same ts, level,
// event and code prefix and redaction as the request lines. Its sink is the caller's stderr write.
function entryLogger(writeStderr: (line: string) => void): Logger {
  return createLogger({
    sink: {
      write: (line) => {
        writeStderr(line);
        return true;
      },
    },
    level: "debug",
    now: () => new Date(),
  });
}

function emitStartup(writeStderr: (line: string) => void, report: StartupReport): void {
  entryLogger(writeStderr).info("daemon.startup", {
    containersRemoved: report.containersRemoved,
    containerIds: report.containerIds,
    recordsDeleted: report.recordsDeleted,
    adopted: report.adopted,
    tempFilesRemoved: report.tempFilesRemoved,
    unattributedTempFiles: report.unattributedTempFiles,
    unattributedRecords: report.unattributedRecords,
    registryEntriesRemoved: report.registryEntriesRemoved,
    auditLinesReconciled: report.auditLinesReconciled,
    maintenanceComplete: report.maintenanceComplete,
    unfinishedAuditFiles: report.unfinishedAuditFiles.slice(0, STARTUP_NAME_CAP),
    unfinishedAuditFileCount: report.unfinishedAuditFiles.length,
    unfinishedSweepRoots: report.unfinishedSweepRoots.slice(0, STARTUP_NAME_CAP),
    unfinishedSweepRootCount: report.unfinishedSweepRoots.length,
    auditListingTruncated: report.auditListingTruncated,
    ...(report.reapFailure === undefined ? {} : { code: report.reapFailure, reapFailure: report.reapFailure }),
    failures: report.failures,
  });
}

// The chain head of one session's audit file (OBS-02), logged when the session is created and when it is destroyed. It is read
// from the file tail only. A missing file, or one with no chained line, logs nothing. A file that exists but cannot be read logs
// audit.unreadable (warn). This is an entry record, so it goes to the entry logger (daemon.log in production).
function emitAuditHead(stateDir: string, sessionId: string, writeStderr: (line: string) => void): void {
  const outcome = readAuditHead(join(stateDir, "audit", `${sessionId}.jsonl`));
  if (outcome.state === "head") {
    entryLogger(writeStderr).info("audit.head", { sessionId, seq: outcome.head.seq, lineSha256: outcome.head.hash });
  } else if (outcome.state === "unreadable") {
    entryLogger(writeStderr).warn("audit.unreadable", { sessionId, reason: "unreadable" });
  }
}

// The entry records (D-1704) go to <stateDir>/daemon.log through the rotating file sink. A line the sink refuses goes to the
// stderr writer, so no line is dropped. An injected writer (tests) receives every line itself, and no file is opened.
function entryWriter(
  injected: ((line: string) => void) | undefined,
  stateDir: string,
  stderr: (line: string) => void,
): { readonly write: (line: string) => void; readonly close: () => LogFailureCategory | undefined } {
  if (injected !== undefined) {
    return { write: injected, close: () => undefined };
  }
  const file = createFileSink({ path: daemonLogPath(stateDir) });
  return {
    write: (line) => {
      try {
        if (file.write(line)) {
          return;
        }
      } catch {
        // The file sink refused the path. The stderr writer below still receives the line.
      }
      stderr(line);
    },
    // undefined when the file closed; otherwise the category the file sink named for the failed close.
    close: () => (file.close() ? undefined : (file.lastFailure() ?? "close")),
  };
}

// The entry file closes last. A close failure goes to stderr as daemon.log-close, because the file can no longer take the line.
function closeEntry(entry: { readonly close: () => LogFailureCategory | undefined }, writeStderr: (line: string) => void): void {
  const failure = entry.close();
  if (failure !== undefined) {
    entryLogger(writeStderr).warn("daemon.log-close", { category: failure });
  }
}

function requestLogger(
  writeStderr: (line: string) => void,
  rawLevel: string | undefined,
  logPath: string,
): { readonly logger: Logger; readonly close: () => void } {
  const parsed = parseLogLevel(rawLevel);
  const file = createFileSink({ path: logPath });
  // The category of the file's most recent failed write. The logger names a dropped line under it through lastFailure.
  let fileFailure: LogFailureCategory | undefined;
  const logger = createLogger({
    sink: {
      write: (line) => {
        fileFailure = undefined;
        try {
          if (file.write(line)) {
            return true;
          }
          fileFailure = file.lastFailure();
        } catch {
          // The file sink refused the path. stderr still receives the line.
        }
        writeStderr(line);
        // The line reached stderr. The logger counts the drop under the category the file sink named.
        return false;
      },
      lastFailure: () => fileFailure,
    },
    level: parsed.level,
    now: () => new Date(),
  });
  if (parsed.invalid) {
    logger.warn("daemon.log-level", { value: parsed.level });
  }
  // A close failure is recorded as a warn line on stderr, the same way closeEntry records one for daemon.log.
  const close = (): void => {
    if (!file.close()) {
      entryLogger(writeStderr).warn("requests.log-close", { category: "close" });
    }
  };
  return { logger, close };
}

// Resolves once the daemon has stopped. A signal stops the daemon in process and settles with the outcome of that stop. A stop
// that arrives over the control channel completes done, and the process drains.
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
      await started.stop();
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
            emitFailure(wiring.writeStderr, codeOf(error));
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
          emitFailure(wiring.writeStderr, codeOf(error));
          settle(1);
        }
      },
    );
  });
}

export async function main(): Promise<void> {
  installFailureHandlers(writeLine, exitProcess);
  const env: EnvironmentLike = { ...process.env };
  process.exitCode = await runDaemon({ env });
}

type FailureEvent = "uncaughtException" | "unhandledRejection";
const FAILURE_EVENTS: readonly FailureEvent[] = ["uncaughtException", "unhandledRejection"];

// The uncaught-failure handlers (research 3.2). Each writes one daemon.failed line through the entry logger, sets the exit
// code and exits 1. register defaults to process.on, so a test passes a fake and installs no real process handler.
export function installFailureHandlers(
  writeStderr: (line: string) => void,
  exit: (code: number) => void,
  register: (event: FailureEvent, listener: (error: unknown) => void) => void = registerProcessFailure,
): void {
  for (const event of FAILURE_EVENTS) {
    register(event, (error: unknown) => {
      emitFailure(writeStderr, codeOf(error));
      process.exitCode = 1;
      exit(1);
    });
  }
}

function registerProcessFailure(event: FailureEvent, listener: (error: unknown) => void): void {
  process.on(event, listener);
}

function exitProcess(code: number): void {
  process.exit(code);
}

// A non-RealmError maps to SCHEMA_INVALID. For a crash that is the fallback: the catalogue has no generic crash code.
function codeOf(error: unknown): ErrorCode {
  return error instanceof RealmError ? error.code : "SCHEMA_INVALID";
}

// The entry's failure line goes through the logger: one JSON object with ts, level, event and code, redacted like the
// request lines. The ensure parser reads it back by event and code (ensure.ts).
function emitFailure(writeStderr: (line: string) => void, code: ErrorCode): void {
  entryLogger(writeStderr).error(FAILURE_EVENT, { code });
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

if (isDirectEntry(import.meta.url, process.argv[1])) {
  void main();
}
