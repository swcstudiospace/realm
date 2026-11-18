// Omp extension entry (edge). The only module in the Omp wiring that reads process.env: it resolves
// the state directory and the control socket once, builds the attach path and the boot observer, and hands them to the
// plugin. The plugin itself stays free of environment and runtime reads.
//
// The bounds come from the omp manifest through resolveBoot (src/host/boot.ts); the one switch this edge reads is REALM_OMP_REATTACH.
// The attach is the shared one (createDaemonAttach, src/host/attach.ts) with refusal retention "verified". The presence marker, the
// boot log line and the host-boot report go through the shared observer (createBootObserver, src/host/boot-observer.ts), driven by
// the plugin's onAttach and onSessionEnd callbacks; none of the three ever changes an attach outcome.
//
// Attach means: ensure a daemon answers on the control socket (spawn it detached when absent), connect,
// and run the idempotent up for the workspace. The daemon owns the sandbox; this host only attaches.
//
// The log level is REALM_LOG_LEVEL when that variable is set and error when it is not, so a default session writes nothing new
// to stderr (Omp paints its own status item); REALM_LOG_LEVEL=debug shows the host.boot lines.

import { startDetachedDaemon } from "../cli/main.js";
import { fileURLToPath } from "node:url";
import { connectDaemon } from "../daemon/client.js";
import { CONTROL_TIMEOUT_MS, sendRequest } from "../daemon/channel.js";
import { readHostRuntime } from "../runtime/host-paths.js";
import { controlSocketPath } from "../session/paths.js";
import { ERROR_CODES, makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import { packageVersion } from "../core/package-version.js";
import { createDaemonAttach } from "../host/attach.js";
import { resolveBoot } from "../host/boot.js";
import { createBootObserver } from "../host/boot-observer.js";
import { defaultManifestFor, parseHostPluginManifest } from "../host/manifest.js";
import { newCorrelationId } from "../observe/ids.js";
import { createLogger, parseLogLevel, type LogLevel } from "../observe/logger.js";
import { createStderrSink } from "../observe/log-file.js";
import {
  createRealmPlugin,
  type DaemonAttach,
  type OmpExtensionApi,
  type PluginAttachOutcome,
  type RealmPluginHandle,
  type RealmPluginView,
} from "./plugin.js";

// The re-attach switch (O4). Unset and 0 leave re-attach off, 1 turns it on. Any other value is a bad setting and fails the load.
export function reattachEnabledOf(value: string | undefined): boolean {
  if (value === undefined || value === "0") {
    return false;
  }
  if (value === "1") {
    return true;
  }
  throw makeRealmError("SCHEMA_INVALID");
}

// Event fields are bounded the way a boot report's are (src/host/boot-report.ts): attempts 1 to 9, durations up to 600 000 ms.
const MAX_ATTEMPT = 9;
const MAX_DURATION_MS = 600_000;

const isErrorCode = (value: string): value is ErrorCode => ERROR_CODES.some((code) => code === value);

export default function realmExtension(pi: OmpExtensionApi): void {
  // Read once, at the edge: the config's stateDir, the value the CLI and the daemon use. An invalid config throws here.
  const stateDir = readHostRuntime(process.env).stateDir;
  // The re-attach switch is read once, here: a value that is neither unset, 0 nor 1 fails the load before anything registers.
  const reattachEnabled = reattachEnabledOf(process.env.REALM_OMP_REATTACH);
  const bounds = resolveBoot(
    parseHostPluginManifest({ ...defaultManifestFor("omp", packageVersion()), boot: { reattach: { enabled: reattachEnabled } } }),
  );
  const socketPath = controlSocketPath(stateDir);
  const daemonEntry = fileURLToPath(new URL("../daemon/main.js", import.meta.url));
  const rawLevel = process.env.REALM_LOG_LEVEL;
  const level: LogLevel = rawLevel === undefined || rawLevel.trim() === "" ? "error" : parseLogLevel(rawLevel).level;

  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  // The session id of the workspace the last attach selected; null until one resolves.
  let attachedSessionId: string | null = null;
  // When the current attach began, and how many attaches have settled.
  let attachBeganAt = Date.now();
  let settled = 0;

  const attach = createDaemonAttach({
    socketPath,
    stateDir,
    connect: connectDaemon,
    // Omp is the host id omp: its client attaches with it when the daemon enforces capability tokens (CAPT-06).
    host: "omp",
    spawnDaemon: () => {
      // startDetachedDaemon allowlists the child environment (spawn-env.ts). A sentinel does not cross.
      startDetachedDaemon(daemonEntry, stateDir);
    },
    diagnostics: process.stderr,
    upBoundMs: CONTROL_TIMEOUT_MS.up,
    pollMs: 100,
    // A refused up keeps the client only when its status answers and names this root and session (src/host/attach.ts).
    refusalRetention: "verified",
    onSelection: (sessionId) => {
      attachedSessionId = sessionId;
    },
  });
  const attachDaemon = (workspaceRoot: string): Promise<DaemonAttach> => {
    attachBeganAt = Date.now();
    return attach(workspaceRoot);
  };

  const observer = createBootObserver({
    hostId: "omp",
    transport: "extension",
    bootId: newCorrelationId(),
    stateDir,
    socketPath,
    logger: createLogger({ sink: createStderrSink(process.stderr), level, now: () => new Date() }),
    diagnostics: process.stderr,
    send: (path, request, timeoutMs) => sendRequest(path, request, { timeoutMs }),
    pid: process.pid,
    startedAt,
    sessionId: () => attachedSessionId,
  });

  // A presence failure is reported as its catalogue code on one stderr line and nothing else; it never reaches the plugin.
  const presenceFailure = (error: unknown): void => {
    const code = error instanceof RealmError ? error.code : "unexpected error";
    process.stderr.write(`realm: presence marker not updated: ${code}\n`);
  };

  const plugin: RealmPluginHandle = createRealmPlugin(pi, {
    attachDaemon,
    bounds,
    reattach: { enabled: bounds.reattach.enabled, random: Math.random },
    onAttach: (outcome: PluginAttachOutcome): void => {
      if (attachedSessionId === null) {
        return;
      }
      settled = Math.min(MAX_ATTEMPT, settled + 1);
      // The plugin's own view of what it last painted: the state the daemon reported, read after the paint.
      const view: RealmPluginView = plugin.view();
      const common = {
        attempt: settled,
        durationMs: Math.min(MAX_DURATION_MS, Math.max(0, Math.trunc(Date.now() - attachBeganAt))),
        state: view.state,
      };
      if (outcome.outcome === "attached") {
        observer.observe({ phase: "attached", ...common });
      } else if (isErrorCode(outcome.code)) {
        observer.observe({ phase: "failed", code: outcome.code, ...common });
      } else {
        // A code outside the catalogue cannot be recorded: the event is dropped with the one line a presence failure writes.
        presenceFailure(makeRealmError("SCHEMA_INVALID"));
      }
    },
    onSessionEnd: (): void => {
      if (attachedSessionId === null) {
        return;
      }
      observer.observe({
        phase: "closed",
        attempt: Math.max(1, settled),
        durationMs: Math.min(MAX_DURATION_MS, Math.max(0, Math.trunc(Date.now() - startedMs))),
        state: plugin.view().state,
      });
    },
  });
}
