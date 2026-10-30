// Daemon entry (RT-01, P6-D1, P6-D4). Reads the runtime config file, starts the daemon through
// startDaemon, and holds the process until a SIGTERM or SIGINT, or a control-channel down, completes
// teardown. A signal runs the control channel's own down request against the daemon socket, so both
// shutdown paths share one code path. This module parses no argv. It reads process.env once, in
// main, and never calls process.exit: the exit code is set on process.exitCode and the event loop
// drains.

import { RealmError, type ErrorCode } from "../core/errors.js";
import { loadRuntimeConfig, runtimeRootsOf } from "../runtime/config.js";
import { defaultPolicyPath, isDirectEntry, podmanSocketPath, readHostRuntime } from "../runtime/host-paths.js";
import { createOpenShellAgentOsDriver } from "../runtime/agentos-driver.js";
import { productionRunnerChild } from "../runtime/agentos-workload.js";
import type { AgentOsDriver } from "../runtime/agentos.js";
import { productionOpenShellRunner } from "../runtime/session-execution.js";
import type { EnvironmentLike } from "../session/paths.js";
import { CONTROL_TIMEOUT_MS, sendRequest, type ControlReply } from "./channel.js";
import { startDaemon, type StartDaemonOptions, type StartedDaemon, type StartupReport } from "./daemon.js";

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

// The AgentOS driver is always bound. Its sandbox image is config.image alone: the digest-pinned value the runtime
// config loader validates at load (readHostRuntime), which startDaemon receives as runtimeInput. Each session's sandbox
// is realm-<sessionId>, created from that image, and its runner runs there as the workload.
// The three roots come from that same config (runtimeRootsOf). A stale REALM_DRIVER_SECRET_ROOT,
// REALM_DRIVER_WORKSPACE_ROOT or REALM_DRIVER_STATE_ROOT is ignored.
// Start provisions the runner child and waits for its probe, so it gets the long budget; probe and delete get the short one.
const AGENTOS_START_TIMEOUT_MS = 180_000;
const AGENTOS_CALL_TIMEOUT_MS = 30_000;

function productionAgentOsDriver(env: EnvironmentLike): AgentOsDriver {
  return createOpenShellAgentOsDriver({
    runner: productionOpenShellRunner(env),
    spawnRunner: productionRunnerChild(env),
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
    const roots = runtimeRootsOf(loadRuntimeConfig(runtimeInput));
    const libpodSocketPath = podmanSocketPath(deps.env);
    const agentosDriver = productionAgentOsDriver(deps.env);
    started = await start({
      stateDir,
      runtimeInput,
      policyPath: defaultPolicyPath(stateDir),
      sessionId: SESSION_ID,
      env: deps.env,
      ...(libpodSocketPath === undefined ? {} : { libpodSocketPath }),
      agentosDriver,
      secretRoot: roots.secretRoot,
      pinnedWorkspaceRoot: roots.workspaceRoot,
      sandboxStateRoot: roots.sandboxStateRoot,
      onStartup: (report) => {
        writeStderr(startupLine(report));
      },
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

// The one startup line (CRASH-04): what the reap destroyed, what the orphan sweep removed, what the audit
// reconciliation appended, and whether the budgeted maintenance finished. The container ids are not secrets. The failure
// count is added only when it is not zero. When the budget left work unfinished, the line names the audit files (base names)
// and the sweep roots; a later start finishes them, and the user-facing notice does not change (it is about the reap only).
// When the reap itself failed, the report is partial (what it had destroyed before it stopped) and the line adds
// `reap failed: <CODE>`; the daemon then exits with that code, which is written on its own line.
// At most this many names of an unfinished list go into the line; the count is always exact. The lists can hold thousands of
// names, and one log line must stay short.
const STARTUP_LINE_MAX_NAMES = 10;

function nameList(names: readonly string[]): string {
  const shown = names.slice(0, STARTUP_LINE_MAX_NAMES).join(",");
  const more = names.length > STARTUP_LINE_MAX_NAMES ? `,+${String(names.length - STARTUP_LINE_MAX_NAMES)} more` : "";
  return `[${shown}${more}]`;
}

function startupLine(report: StartupReport): string {
  const ids = report.containerIds.length === 0 ? "" : `[${report.containerIds.join(",")}]`;
  const hasUnfinished = report.unfinishedAuditFiles.length > 0 || report.unfinishedSweepRoots.length > 0;
  const unfinished = hasUnfinished
    ? `; unfinished ${String(report.unfinishedAuditFiles.length)} audit file(s)${nameList(report.unfinishedAuditFiles)}` +
      ` and ${String(report.unfinishedSweepRoots.length)} sweep root(s)${nameList(report.unfinishedSweepRoots)}`
    : "";
  const listing = report.auditListingTruncated ? "; audit listing truncated" : "";
  const reapFailed = report.reapFailure === undefined ? "" : `; reap failed: ${report.reapFailure}`;
  const failures = report.failures > 0 ? `; ${String(report.failures)} startup failure(s)` : "";
  return (
    `realm daemon: startup removed ${String(report.containersRemoved)} container(s)${ids}` +
    ` and ${String(report.recordsDeleted)} session record(s);` +
    ` removed ${String(report.tempFilesRemoved)} orphan temp file(s);` +
    ` reconciled ${String(report.auditLinesReconciled)} audit admission(s);` +
    ` maintenanceComplete=${String(report.maintenanceComplete)}${unfinished}${listing}${reapFailed}${failures}`
  );
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
  return JSON.stringify({ level: "error", event: "daemon.failed", code });
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
