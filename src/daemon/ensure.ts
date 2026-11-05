// Ensures a daemon answers on its control socket (Phase 6 wave 3). The probe reports what the socket holds: a daemon that
// answers, a daemon that holds the socket but has not answered yet (still binding it, or busy with its startup reap), or
// nothing. When a daemon answers, ensureDaemon returns at once. A daemon is spawned only when the socket is absent, and at
// most once: a second daemon spawned over one that holds the socket would only refuse with LOCK_CONFLICT. It then polls the
// probe every pollMs until a daemon answers or timeoutMs has elapsed, so a daemon that is busy gets the whole bound to
// answer, and DAEMON_START_TIMEOUT reports that none did. The poll mirrors runUp in src/cli/main.ts. The module spawns no
// process itself and reads no environment; the caller supplies the probe and the spawn. A rejected probe or spawn
// propagates unchanged.
//
// reportingStartFailure wraps the probe so that a daemon which refuses to start is reported by the code
// it wrote itself: a daemon.failed JSON line in <stateDir>/daemon.log, before it exits. The caller passes
// the state directory, so the module still reads no environment.

import { closeSync, openSync, readSync, statSync } from "node:fs";
import { ERROR_CODES, makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import { sleep } from "../core/timeout.js";
import type { DaemonClient } from "./client.js";
import type { ControlSelection } from "./channel.js";

// What one probe of the control socket found.
export type DaemonPresence = "answering" | "starting" | "absent";

// What one probe found. A miss carries the catalogue code of the reply that made it a miss: REALM_NOT_ACTIVE when
// nothing holds the socket, TOOL_TIMEOUT or SCHEMA_INVALID when something holds it and gave no reply. ensureDaemon
// reports the code of the last probe as the cause of DAEMON_START_TIMEOUT.
type ProbeResult =
  | { readonly presence: "answering" }
  | { readonly presence: "absent"; readonly code: "REALM_NOT_ACTIVE" }
  | { readonly presence: "starting"; readonly code: "TOOL_TIMEOUT" | "SCHEMA_INVALID" };

export interface EnsureDaemonOptions {
  // Control socket the probe checks; passed to probe so the caller owns no hidden path.
  readonly socketPath: string;
  // Reports what socketPath holds.
  readonly probe: (socketPath: string) => Promise<ProbeResult>;
  // Starts the daemon. Called at most once per ensureDaemon call, and only when the probe found the socket absent.
  readonly spawnDaemon: () => void;
  // Bound, in milliseconds, on the wait for an answer after the first probe that found none. Finite and non-negative.
  readonly timeoutMs: number;
  // Interval, in milliseconds, between probes while waiting. Finite and positive.
  readonly pollMs: number;
}

export async function ensureDaemon(options: EnsureDaemonOptions): Promise<void> {
  const { socketPath, probe, spawnDaemon, timeoutMs, pollMs } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(pollMs) || pollMs <= 0) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  let spawned = false;
  // Nothing holds the socket, so a daemon is started, once. If a daemon that held the socket vanishes while this waits, the
  // next probe finds the socket absent and starts the one daemon this call may start.
  const spawnWhenAbsent = (presence: DaemonPresence): void => {
    if (presence === "absent" && !spawned) {
      spawned = true;
      spawnDaemon();
    }
  };
  const first = await probe(socketPath);
  if (first.presence === "answering") {
    return;
  }
  spawnWhenAbsent(first.presence);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const finding = await probe(socketPath);
    if (finding.presence === "answering") {
      return;
    }
    spawnWhenAbsent(finding.presence);
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      // The last probe's code is the cause: REALM_NOT_ACTIVE when nothing held the socket, otherwise the reply's code.
      throw makeRealmError("DAEMON_START_TIMEOUT", finding.code);
    }
    await sleep(Math.min(pollMs, remaining));
  }
}

// The daemon's startup log: <stateDir>/daemon.log. Request lines do not go here: a detached daemon
// inherits this file as stderr, and rotating it would leave later failure lines on an unlinked inode.
export function daemonLogPath(stateDir: string): string {
  return `${stateDir}/daemon.log`;
}

// Request lines (up, tool, health): <stateDir>/requests.log. The file sink rotates this file. stderr
// stays the fallback when the path cannot be opened.
export function requestLogPath(stateDir: string): string {
  return `${stateDir}/requests.log`;
}

// Byte size of the startup log, or 0 when it does not exist.
export function daemonLogSize(stateDir: string): number {
  return statSync(daemonLogPath(stateDir), { throwIfNoEntry: false })?.size ?? 0;
}

// Shared with the entry (main.ts), which writes the line this module reads back.
export const FAILURE_EVENT = "daemon.failed";

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

// The result of scanning the startup log from an offset: the catalogue code of the last complete daemon.failed line, or
// undefined. A line that is not JSON is skipped and never read as a failure.
export interface StartFailureScan {
  readonly code: ErrorCode | undefined;
}

// The scan of the last complete daemon.failed line written at or after offset. A trailing line without a newline is not yet
// complete and is ignored. A log shorter than offset, or a missing log, yields no code. A LOCK_CONFLICT line is not a start
// failure: it is what a rival daemon writes when it finds the socket owned, so a daemon is alive and the hosts waiting for it
// must keep waiting. A line that is not that JSON event is ignored, so a startup record cannot be mistaken for a failure.
export function daemonStartFailureSince(stateDir: string, offset: number): StartFailureScan {
  const size = daemonLogSize(stateDir);
  if (size <= offset) {
    return { code: undefined };
  }
  const text = readLogFrom(stateDir, offset, size - offset);
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline < 0) {
    return { code: undefined };
  }
  let code: ErrorCode | undefined;
  for (const line of text.slice(0, lastNewline).split("\n")) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      // Not JSON, so it cannot be a daemon.failed event: the line is skipped.
      continue;
    }
    const found = failedCode(value);
    if (found !== undefined) {
      code = found;
    }
  }
  return { code };
}

function failedCode(value: unknown): ErrorCode | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record["event"] !== FAILURE_EVENT || typeof record["code"] !== "string") {
    return undefined;
  }
  if (record["code"] === "LOCK_CONFLICT" || !isErrorCode(record["code"])) {
    return undefined;
  }
  return record["code"];
}

// Failures that mean no daemon has answered yet, each mapped to the probe result it makes. REALM_NOT_ACTIVE: nothing
// holds the socket (absent, or a refused dial). TOOL_TIMEOUT and SCHEMA_INVALID: something accepted the connection but
// gave no complete reply in time (a daemon busy with its startup reap holds requests, and one still binding its socket
// cuts a reply short), so a daemon is there.

// The probe ensureDaemon polls, shared by every host that attaches (the CLI and the Omp extension): one status request on a
// fresh client. Any other failure propagates unchanged. Telling "held but not answering" from "absent" is what keeps a host
// from spawning a second daemon over one that is alive but busy, which would only refuse with LOCK_CONFLICT. The Omp
// extension spawns the daemon itself, so it meets the same reaping and bind races the CLI does.
export function daemonAnswers(
  connect: (socketPath: string, selection: ControlSelection) => Pick<DaemonClient, "status" | "close">,
  selection: ControlSelection,
): (socketPath: string) => Promise<ProbeResult> {
  return async (socketPath) => {
    const client = connect(socketPath, selection);
    try {
      await client.status();
      return { presence: "answering" };
    } catch (error: unknown) {
      if (error instanceof RealmError) {
        switch (error.code) {
          case "REALM_NOT_ACTIVE":
            return { presence: "absent", code: error.code };
          case "TOOL_TIMEOUT":
          case "SCHEMA_INVALID":
            return { presence: "starting", code: error.code };
        }
      }
      throw error;
    } finally {
      client.close();
    }
  };
}

// Wraps a status probe for ensureDaemon. An answer passes through. On the first miss the log's
// current size is recorded; ensureDaemon spawns the daemon after that miss when the socket is absent, so the recorded
// offset precedes the new daemon's output. Every miss then looks for a failure line after the offset and
// rejects with its code; otherwise the miss resolves with what the probe found.
export function reportingStartFailure(
  probe: (socketPath: string) => Promise<ProbeResult>,
  stateDir: string,
): (socketPath: string) => Promise<ProbeResult> {
  let offset: number | undefined;
  return async (socketPath) => {
    const finding = await probe(socketPath);
    if (finding.presence === "answering") {
      return finding;
    }
    const start = offset ?? daemonLogSize(stateDir);
    offset = start;
    const { code } = daemonStartFailureSince(stateDir, start);
    if (code !== undefined) {
      throw makeRealmError(code);
    }
    return finding;
  };
}
