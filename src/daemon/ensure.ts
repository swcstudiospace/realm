// Ensures a daemon answers on its control socket (Phase 6 wave 3). When the probe already reports
// a live daemon, it returns at once. Otherwise it calls spawnDaemon exactly once, then polls the
// probe every pollMs until it reports true or timeoutMs has elapsed. The poll mirrors runUp in
// src/cli/main.ts: one spawn after an absent daemon, then bounded retries, and DAEMON_START_TIMEOUT when the
// daemon never comes up. The module spawns no process itself and reads no environment; the caller
// supplies the probe and the spawn. A rejected probe or spawn propagates unchanged.
//
// reportingStartFailure wraps the probe so that a daemon which refuses to start is reported by the code
// it wrote itself: `realm daemon: <CODE>` in <stateDir>/daemon.log, before it exits. The caller passes
// the state directory, so the module still reads no environment.

import { closeSync, openSync, readSync, statSync } from "node:fs";
import { ERROR_CODES, makeRealmError, type ErrorCode } from "../core/errors.js";

export interface EnsureDaemonOptions {
  // Control socket the probe checks; passed to probe so the caller owns no hidden path.
  readonly socketPath: string;
  // Resolves true when a daemon answers on socketPath.
  readonly probe: (socketPath: string) => Promise<boolean>;
  // Starts the daemon. Called at most once per ensureDaemon call.
  readonly spawnDaemon: () => void;
  // Bound, in milliseconds, on the wait after the spawn. Finite and non-negative.
  readonly timeoutMs: number;
  // Interval, in milliseconds, between probes after the spawn. Finite and positive.
  readonly pollMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function ensureDaemon(options: EnsureDaemonOptions): Promise<void> {
  const { socketPath, probe, spawnDaemon, timeoutMs, pollMs } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(pollMs) || pollMs <= 0) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (await probe(socketPath)) {
    return;
  }
  spawnDaemon();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe(socketPath)) {
      return;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw makeRealmError("DAEMON_START_TIMEOUT");
    }
    await sleep(Math.min(pollMs, remaining));
  }
}

// The daemon's startup log: <stateDir>/daemon.log.
export function daemonLogPath(stateDir: string): string {
  return `${stateDir}/daemon.log`;
}

// Byte size of the startup log, or 0 when it does not exist.
export function daemonLogSize(stateDir: string): number {
  return statSync(daemonLogPath(stateDir), { throwIfNoEntry: false })?.size ?? 0;
}

const FAILURE_LINE = /^realm daemon: ([A-Z_]+)$/;

function isErrorCode(value: string): value is ErrorCode {
  return ERROR_CODES.some((code) => code === value);
}

// The bytes of the log from offset to its end, decoded as UTF-8. The caller guarantees offset < size.
function readLogFrom(stateDir: string, offset: number, length: number): string {
  const fd = openSync(daemonLogPath(stateDir), "r");
  try {
    const bytes = Buffer.alloc(length);
    const read = readSync(fd, bytes, 0, length, offset);
    return bytes.subarray(0, read).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

// The catalogue code of the last complete `realm daemon: <CODE>` line written at or after offset, or
// undefined. A trailing line without a newline is not yet complete and is ignored. A log shorter than
// offset, or a missing log, yields undefined.
export function daemonStartFailureSince(stateDir: string, offset: number): ErrorCode | undefined {
  const size = daemonLogSize(stateDir);
  if (size <= offset) {
    return undefined;
  }
  const text = readLogFrom(stateDir, offset, size - offset);
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline < 0) {
    return undefined;
  }
  let found: ErrorCode | undefined;
  for (const line of text.slice(0, lastNewline).split("\n")) {
    const token = FAILURE_LINE.exec(line)?.[1];
    if (token !== undefined && isErrorCode(token)) {
      found = token;
    }
  }
  return found;
}

// Wraps a status probe for ensureDaemon. A true answer passes through. On the first miss the log's
// current size is recorded; ensureDaemon spawns the daemon after that miss, so the recorded offset
// precedes the new daemon's output. Every miss then looks for a failure line after the offset and
// rejects with its code; otherwise the miss resolves false.
export function reportingStartFailure(
  probe: (socketPath: string) => Promise<boolean>,
  stateDir: string,
): (socketPath: string) => Promise<boolean> {
  let offset: number | undefined;
  return async (socketPath) => {
    if (await probe(socketPath)) {
      return true;
    }
    const start = offset ?? daemonLogSize(stateDir);
    offset = start;
    const code = daemonStartFailureSince(stateDir, start);
    if (code !== undefined) {
      throw makeRealmError(code);
    }
    return false;
  };
}
