// The host-side boot observer (Phase 23, BOOT-08). One boot event stream becomes three side effects, in this order and each
// guarded so none can throw, change what the caller does or hold it up:
//   1. a structured log line `host.boot.<phase>` through the caller's Logger (redaction is the logger's);
//   2. the presence marker (src/host/presence.ts): written on a settled attach, removed at `closed`;
//   3. the boot report to the daemon through the `host-boot` control method, never awaited by the boot path.
// The three live in one place so the Omp extension and the stdio entries (realm mcp, realm acp) cannot diverge.
//
// A boot that never reached a daemon leaves a host-side trail only (the log line, the exit code): the report needs a daemon to
// receive it. `host.log` is not used for the line because many host processes would append to one single-writer rotating sink
// (src/observe/log-file.ts); the caller hands in the Logger, over stderr.
//
// Every field of a log line, a marker and a report is a closed-vocabulary value, a catalogue code, a boot id or a bounded
// integer. No workspace path, state directory, socket path, session text or daemon reason crosses. The module reads no
// environment and imports nothing of src/omp, src/cli or src/daemon except the control request and reply types.

import { RealmError } from "../core/errors.js";
import type { ControlReply, ControlRequest } from "../daemon/channel.js";
import type { Logger } from "../observe/logger.js";
import { parseHostBootReport, type BootReportHost, type HostBootReport, type HostBootTransport } from "./boot-report.js";
import { removePresence, writePresence } from "./presence.js";
import type { HostBootEvent } from "./types.js";

// At most this many reports are in flight; one more is dropped and counted.
const MAX_IN_FLIGHT = 8;
// The bound on one report's round trip, and the tighter bound on `closed` (a session that is ending must not wait on a daemon).
const REPORT_TIMEOUT_MS = 5_000;
const CLOSED_TIMEOUT_MS = 1_000;

interface BootObserverOptions {
  readonly hostId: BootReportHost;
  readonly transport: HostBootTransport;
  // One per process start. A token-shaped id is redacted by the logger; the report carries it as given.
  readonly bootId: string;
  readonly stateDir: string;
  readonly socketPath: string;
  readonly logger: Logger;
  // Where the one presence-failure line goes. Written at most once per failed marker update.
  readonly diagnostics: { write(text: string): void };
  readonly send: (socketPath: string, request: ControlRequest, timeoutMs: number) => Promise<ControlReply>;
  readonly pid: number;
  readonly startedAt: string;
  // The session id of the workspace the last attach selected; null until one resolves. No marker is written while null.
  readonly sessionId: () => string | null;
  readonly isAlive?: (pid: number) => boolean;
}

export interface BootObserver {
  // Synchronous and total: it never throws and never waits.
  readonly observe: (event: HostBootEvent) => void;
  // Resolves when every in-flight report has settled or timeoutMs has passed, whichever is first. Never rejects.
  readonly flush: (timeoutMs: number) => Promise<void>;
  // Reports dropped because eight were already in flight.
  readonly droppedReports: () => number;
}

const LEVEL_OF: Readonly<Record<HostBootEvent["phase"], "debug" | "warn">> = Object.freeze({
  attached: "debug",
  reattached: "debug",
  closed: "debug",
  refused: "warn",
  failed: "warn",
  "link-lost": "warn",
});

export function createBootObserver(options: BootObserverOptions): BootObserver {
  const { hostId, transport, bootId, logger } = options;
  const inFlight = new Set<Promise<void>>();
  let dropped = 0;
  let nextId = 1;

  // A presence failure is one catalogue code on one diagnostics line and nothing else.
  const presenceFailure = (error: unknown): void => {
    const code = error instanceof RealmError ? error.code : "unexpected error";
    try {
      options.diagnostics.write(`realm: presence marker not updated: ${code}\n`);
    } catch {
      // A diagnostics sink that throws changes nothing.
    }
  };

  const log = (event: HostBootEvent): void => {
    try {
      logger[LEVEL_OF[event.phase]](`host.boot.${event.phase}`, {
        correlationId: bootId,
        hostId,
        transport,
        phase: event.phase,
        attempt: event.attempt,
        durationMs: event.durationMs,
        ...(event.code === undefined ? {} : { code: event.code }),
        ...(event.state === null ? {} : { state: event.state }),
      });
    } catch {
      // The logger never throws; a stand-in that does changes nothing.
    }
  };

  const debugLine = (name: string, code?: string): void => {
    try {
      logger.debug(name, { correlationId: bootId, hostId, transport, ...(code === undefined ? {} : { failure: code }) });
    } catch {
      // Best effort.
    }
  };

  const mark = (event: HostBootEvent): void => {
    if (hostId === "unlabelled") {
      return;
    }
    const sessionId = options.sessionId();
    if (sessionId === null) {
      return;
    }
    const deps = options.isAlive === undefined ? {} : { isAlive: options.isAlive };
    try {
      if (event.phase === "closed") {
        removePresence(options.stateDir, hostId, options.pid);
        return;
      }
      const attached = event.phase === "attached" || event.phase === "reattached";
      writePresence(
        options.stateDir,
        hostId,
        {
          pid: options.pid,
          startedAt: options.startedAt,
          sessionId,
          attach: attached ? "attached" : "failed",
          code: attached ? null : (event.code ?? null),
        },
        deps,
      );
    } catch (error: unknown) {
      presenceFailure(error);
    }
  };

  const report = (event: HostBootEvent): void => {
    let parsed: HostBootReport;
    try {
      parsed = parseHostBootReport({
        schemaVersion: 1,
        bootId,
        hostId,
        transport,
        phase: event.phase,
        code: event.code ?? null,
        attempt: event.attempt,
        durationMs: event.durationMs,
        state: event.state,
      });
    } catch {
      // A report that fails its own validation is a programming error: dropped, never sent.
      debugLine("host.boot.report_invalid");
      return;
    }
    if (inFlight.size >= MAX_IN_FLIGHT) {
      dropped += 1;
      debugLine("host.boot.report_dropped");
      return;
    }
    const id = nextId;
    nextId += 1;
    const request: ControlRequest = { id, method: "host-boot", params: { report: parsed } };
    const bound = event.phase === "closed" ? CLOSED_TIMEOUT_MS : REPORT_TIMEOUT_MS;
    let pending: Promise<void>;
    try {
      pending = Promise.resolve(options.send(options.socketPath, request, bound)).then(
        (reply) => {
          if (reply.error !== undefined) {
            debugLine("host.boot.report_failed", reply.error.code);
          }
        },
        (error: unknown) => {
          debugLine("host.boot.report_failed", error instanceof RealmError ? error.code : "unexpected error");
        },
      );
    } catch (error: unknown) {
      debugLine("host.boot.report_failed", error instanceof RealmError ? error.code : "unexpected error");
      return;
    }
    const tracked = pending.finally(() => {
      inFlight.delete(tracked);
    });
    inFlight.add(tracked);
  };

  return {
    observe(event) {
      log(event);
      mark(event);
      try {
        report(event);
      } catch {
        // Nothing here may change what the caller does.
      }
    },
    flush(timeoutMs) {
      if (inFlight.size === 0) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.max(0, timeoutMs));
        void Promise.allSettled([...inFlight]).then(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
    droppedReports: () => dropped,
  };
}
