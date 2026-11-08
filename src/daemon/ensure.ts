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

import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { ERROR_CODES, makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import { sleep } from "../core/timeout.js";
import type { DaemonClient } from "./client.js";
import type { ControlSelection } from "./channel.js";

// What one probe of the control socket found.
export type DaemonPresence = "answering" | "starting" | "absent";

export interface EnsureDaemonOptions {
  // Control socket the probe checks; passed to probe so the caller owns no hidden path.
  readonly socketPath: string;
  // Reports what socketPath holds.
  readonly probe: (socketPath: string) => Promise<DaemonPresence>;
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
  if (first === "answering") {
    return;
  }
  spawnWhenAbsent(first);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const presence = await probe(socketPath);
    if (presence === "answering") {
      return;
    }
    spawnWhenAbsent(presence);
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw makeRealmError("DAEMON_START_TIMEOUT");
    }
    await sleep(Math.min(pollMs, remaining));
  }
}

// The daemon's startup log: <stateDir>/daemon.log. The entry records are written here through the rotating file sink
// (log-file.ts): at the size cap the sink renames the file to daemon.log.1 and opens a fresh daemon.log. The reader
// tolerates that rotation by the file's identity (device and inode) and size; see daemonStartFailureSince. Request lines
// do not go here.
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

// Identity of one file: its device and inode. A replacement (rename, then a new file at the same path) has a new inode.
export interface DaemonLogIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
}

// Where the reader starts: the startup log's size and identity, taken in one stat. Size 0 with no identity when the log
// does not exist yet.
export interface DaemonLogMark {
  readonly offset: number;
  readonly identity: DaemonLogIdentity | undefined;
}

export function daemonLogMark(stateDir: string): DaemonLogMark {
  const stats = statSync(daemonLogPath(stateDir), { bigint: true, throwIfNoEntry: false });
  if (stats === undefined) {
    return { offset: 0, identity: undefined };
  }
  return { offset: Number(stats.size), identity: { dev: stats.dev, ino: stats.ino } };
}

// Shared with the entry (main.ts), which writes the line this module reads back.
export const FAILURE_EVENT = "daemon.failed";

function isErrorCode(value: string): value is ErrorCode {
  return ERROR_CODES.some((code) => code === value);
}

// The startup log opened read-only, or undefined when it does not exist. One descriptor serves both the fstat and the read,
// so the size and the bytes come from the same file even if its path is renamed in between.
function openLogForRead(stateDir: string): number | undefined {
  try {
    return openSync(daemonLogPath(stateDir), "r");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

// The bytes of an open log from start to start + length, decoded as UTF-8. The caller guarantees they exist.
function readFrom(fd: number, start: number, length: number): string {
  const bytes = Buffer.alloc(length);
  const read = readSync(fd, bytes, 0, length, start);
  return bytes.subarray(0, read).toString("utf8");
}

// The catalogue code of the last complete daemon.failed line written at or after the start, or undefined. The start is
// offset, unless the log was replaced or shrank since the mark: then it is 0, so a replacement is read from its first
// line. A replacement is seen when identity is supplied and the open file's device or inode differs from it, or when the
// file is smaller than offset. A trailing line without a newline is not yet complete and is ignored. A missing log, or one
// with nothing after the start, yields undefined. A LOCK_CONFLICT line is not a start failure: it is what a rival daemon
// writes when it finds the socket owned, so a daemon is alive and the hosts waiting for it must keep waiting.
// A line that is not that JSON event is ignored, so a startup record cannot be mistaken for a failure.
export function daemonStartFailureSince(stateDir: string, offset: number, identity?: DaemonLogIdentity): ErrorCode | undefined {
  const fd = openLogForRead(stateDir);
  if (fd === undefined) {
    return undefined;
  }
  try {
    const stats = fstatSync(fd, { bigint: true });
    const size = Number(stats.size);
    const replaced = identity !== undefined && (stats.dev !== identity.dev || stats.ino !== identity.ino);
    const start = replaced || size < offset ? 0 : offset;
    if (size <= start) {
      return undefined;
    }
    return lastFailureCode(readFrom(fd, start, size - start));
  } finally {
    closeSync(fd);
  }
}

// The catalogue code of the last complete daemon.failed line in text, or undefined. Only the code leaves this module:
// the text is never returned or thrown.
function lastFailureCode(text: string): ErrorCode | undefined {
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline < 0) {
    return undefined;
  }
  let found: ErrorCode | undefined;
  for (const line of text.slice(0, lastNewline).split("\n")) {
    const code = failedCode(line);
    if (code !== undefined) {
      found = code;
    }
  }
  return found;
}

function failedCode(line: string): ErrorCode | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
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

// Failures that mean no daemon has answered yet. REALM_NOT_ACTIVE: nothing holds the socket (absent, or a refused dial).
// TOOL_TIMEOUT and SCHEMA_INVALID: something accepted the connection but gave no complete reply in time (a daemon busy
// with its startup reap holds requests, and one still binding its socket cuts a reply short), so a daemon is there.
const SOCKET_ABSENT: readonly ErrorCode[] = ["REALM_NOT_ACTIVE"];
const SOCKET_HELD_NOT_ANSWERING: readonly ErrorCode[] = ["TOOL_TIMEOUT", "SCHEMA_INVALID"];

// The probe ensureDaemon polls, shared by every host that attaches (the CLI and the Omp extension): one status request on a
// fresh client. Any other failure propagates unchanged. Telling "held but not answering" from "absent" is what keeps a host
// from spawning a second daemon over one that is alive but busy, which would only refuse with LOCK_CONFLICT. The Omp
// extension spawns the daemon itself, so it meets the same reaping and bind races the CLI does.
export function daemonAnswers(
  connect: (socketPath: string, selection: ControlSelection) => Pick<DaemonClient, "status" | "close">,
  selection: ControlSelection,
): (socketPath: string) => Promise<DaemonPresence> {
  return async (socketPath) => {
    const client = connect(socketPath, selection);
    try {
      await client.status();
      return "answering";
    } catch (error: unknown) {
      if (error instanceof RealmError) {
        if (SOCKET_ABSENT.includes(error.code)) {
          return "absent";
        }
        if (SOCKET_HELD_NOT_ANSWERING.includes(error.code)) {
          return "starting";
        }
      }
      throw error;
    } finally {
      client.close();
    }
  };
}

// Wraps a status probe for ensureDaemon. An answer passes through. On the first miss the log's mark (its size and
// identity, taken in one stat) is recorded; ensureDaemon spawns the daemon after that miss when the socket is absent, so
// the mark precedes the new daemon's output. Every miss then looks for a failure line after the mark and rejects with its
// code; otherwise the miss resolves with what the probe found. The mark is kept, not refreshed: a rotation after the first
// miss is handled by daemonStartFailureSince, which reads the replacement from its start.
export function reportingStartFailure(
  probe: (socketPath: string) => Promise<DaemonPresence>,
  stateDir: string,
): (socketPath: string) => Promise<DaemonPresence> {
  let mark: DaemonLogMark | undefined;
  return async (socketPath) => {
    const presence = await probe(socketPath);
    if (presence === "answering") {
      return presence;
    }
    const recorded = mark ?? daemonLogMark(stateDir);
    mark = recorded;
    const code = daemonStartFailureSince(stateDir, recorded.offset, recorded.identity);
    if (code !== undefined) {
      throw makeRealmError(code);
    }
    return presence;
  };
}
