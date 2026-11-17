// Presence markers (Phase 22, D-22-05). A host plugin that has loaded and settled an attach writes one small file,
// <stateDir>/hosts/<hostId>-active/<pid>.json, and removes it when its session ends. Doctor and `realm host status` count the
// markers whose process is still alive. A marker means "a process of this host loaded the plugin and its last attach ended this
// way"; it is not proof the sandbox is healthy (that is `realm status`) and it is not containment. It never causes any action.
//
// The directory is host-side only (the sandbox does not mount the state directory). Reading is strict and bounded: at most
// 64 file names are examined, a file over 4096 bytes, a symlink, a directory, a wrong key set, a wrong type, an unknown code or
// a pid that differs from the file name is counted unreadable and never trusted. Nothing here follows a symlink. The module is
// host-neutral and reads no environment, so a later in-process host can reuse it.

import { constants, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { ERROR_CODES, makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import { withTimeout } from "../core/timeout.js";
import { atomicWriteFile, observeSha256, type StageHook } from "../fs/atomic-write.js";
import { errnoOf, lstatIfPresent } from "../fs/canonicalize.js";
import { isSessionId } from "../session/paths.js";
import { DEFAULT_READ_TIMEOUT_MS } from "./receipt.js";
import { HOST_IDS, type HostId } from "./types.js";

const MAX_ENTRIES = 64;
const MAX_RECORD_BYTES = 4096;
const MAX_PID = 4_194_304;
const FILE_NAME_PATTERN = /^[1-9][0-9]{0,6}\.json$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const RECORD_KEYS = Object.freeze(["attach", "code", "pid", "schemaVersion", "sessionId", "startedAt"]);

// What a settled attach reports. Every field is bounded, so a serialised record cannot approach MAX_RECORD_BYTES.
interface PresenceInput {
  readonly pid: number;
  readonly startedAt: string;
  readonly sessionId: string;
  readonly attach: "attached" | "failed";
  readonly code: string | null;
}

export interface PresenceCounts {
  readonly live: number;
  readonly stale: number;
  readonly unreadable: number;
}

interface PresenceWriteDeps {
  readonly isAlive?: (pid: number) => boolean;
  readonly stageHook?: StageHook;
}

interface PresenceReadOptions {
  readonly isAlive?: (pid: number) => boolean;
  readonly readTimeoutMs?: number;
}

// True while the process exists. EPERM means it exists but belongs to another user; ESRCH and anything else mean it is gone.
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return errnoOf(error) === "EPERM";
  }
}

function isPid(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_PID;
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && ISO_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function isCode(value: unknown): boolean {
  return value === null || (typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value));
}

function isAttach(value: unknown): boolean {
  return value === "attached" || value === "failed";
}

// Whether a parsed value is exactly one presence record, with its pid equal to the one in its file name.
function isRecordFor(parsed: unknown, pid: number): boolean {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return false;
  }
  const keys = Object.keys(parsed).sort();
  if (keys.length !== RECORD_KEYS.length || keys.some((key, index) => key !== RECORD_KEYS[index])) {
    return false;
  }
  const record = parsed as Readonly<Record<string, unknown>>;
  return (
    record.schemaVersion === 1 &&
    record.pid === pid &&
    isIso(record.startedAt) &&
    typeof record.sessionId === "string" &&
    isSessionId(record.sessionId) &&
    isAttach(record.attach) &&
    isCode(record.code)
  );
}

function presenceDirOf(stateDir: string, hostId: HostId): string {
  return join(stateDir, "hosts", `${hostId}-active`);
}

// Creates the directory when absent (mode 0700); a symlink or non-directory at the path is PATH_ESCAPE.
function ensureRealDirectory(path: string): void {
  if (lstatIfPresent(path) === null) {
    try {
      mkdirSync(path, { mode: 0o700 });
    } catch (error: unknown) {
      if (errnoOf(error) !== "EEXIST") {
        throw makeRealmError("PATH_ESCAPE");
      }
    }
  }
  const stats = lstatIfPresent(path);
  if (stats === null || stats.isSymbolicLink() || !stats.isDirectory()) {
    throw makeRealmError("PATH_ESCAPE");
  }
}

// Removes the markers of processes that are gone, examining at most MAX_ENTRIES names. Best effort: a failure to prune never
// fails the write that called it. A symlink is unlinked (never followed); a directory is left alone.
function pruneDead(dir: string, ownPid: number, isAlive: (pid: number) => boolean): void {
  let names: readonly string[];
  try {
    names = readdirSync(dir).filter((name) => FILE_NAME_PATTERN.test(name)).sort().slice(0, MAX_ENTRIES);
  } catch {
    return;
  }
  for (const name of names) {
    const pid = Number.parseInt(name, 10);
    if (pid === ownPid || isAlive(pid)) {
      continue;
    }
    try {
      const stats = lstatSync(join(dir, name));
      if (stats.isFile() || stats.isSymbolicLink()) {
        rmSync(join(dir, name), { force: true });
      }
    } catch {
      // Best effort: the next write tries again.
    }
  }
}

// Writes <pid>.json for this process (mode 0600, atomic) and prunes the markers of dead processes. A record whose fields are
// out of range is SCHEMA_INVALID; a symlink or non-directory on the path is PATH_ESCAPE.
export function writePresence(stateDir: string, hostId: HostId, record: PresenceInput, deps: PresenceWriteDeps = {}): void {
  const full = { schemaVersion: 1, ...record };
  if (!isRecordFor(full, record.pid) || !isPid(record.pid)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const text = `${JSON.stringify(full)}\n`;
  if (Buffer.byteLength(text, "utf8") > MAX_RECORD_BYTES) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  let realState: string;
  try {
    realState = realpathSync(stateDir);
  } catch {
    throw makeRealmError("PATH_ESCAPE");
  }
  ensureRealDirectory(join(realState, "hosts"));
  const dir = presenceDirOf(realState, hostId);
  ensureRealDirectory(dir);
  const file = join(dir, `${String(record.pid)}.json`);
  atomicWriteFile(file, text, {
    expectedPriorSha256: observeSha256(file),
    ...(deps.stageHook === undefined ? {} : { stageHook: deps.stageHook }),
  });
  pruneDead(dir, record.pid, deps.isAlive ?? processAlive);
}

// Removes this pid's marker only. An absent marker is fine; the path is never followed through a symlinked directory.
export function removePresence(stateDir: string, hostId: HostId, pid: number): void {
  if (!isPid(pid)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const hosts = lstatIfPresent(join(stateDir, "hosts"));
  if (hosts === null) {
    return;
  }
  if (hosts.isSymbolicLink() || !hosts.isDirectory()) {
    throw makeRealmError("PATH_ESCAPE");
  }
  const dir = presenceDirOf(stateDir, hostId);
  const dirStats = lstatIfPresent(dir);
  if (dirStats === null) {
    return;
  }
  if (dirStats.isSymbolicLink() || !dirStats.isDirectory()) {
    throw makeRealmError("PATH_ESCAPE");
  }
  const file = join(dir, `${String(pid)}.json`);
  const stats = lstatIfPresent(file);
  if (stats !== null && (stats.isFile() || stats.isSymbolicLink())) {
    rmSync(file, { force: true });
  }
}

// One marker: "live" or "stale" for a valid record, "unreadable" for anything else. Never throws for content.
async function classify(path: string, pid: number, isAlive: (pid: number) => boolean): Promise<keyof PresenceCounts> {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size > MAX_RECORD_BYTES) {
        return "unreadable";
      }
      const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, MAX_RECORD_BYTES + 1, 0);
      if (bytesRead > MAX_RECORD_BYTES) {
        return "unreadable";
      }
      const parsed: unknown = JSON.parse(buffer.toString("utf8", 0, bytesRead));
      if (!isRecordFor(parsed, pid)) {
        return "unreadable";
      }
      return isAlive(pid) ? "live" : "stale";
    } finally {
      await handle.close();
    }
  } catch {
    return "unreadable";
  }
}

async function scan(dir: string, isAlive: (pid: number) => boolean): Promise<PresenceCounts> {
  const names = (await readdir(dir)).filter((name) => FILE_NAME_PATTERN.test(name)).sort().slice(0, MAX_ENTRIES);
  const counts = { live: 0, stale: 0, unreadable: 0 };
  for (const name of names) {
    counts[await classify(join(dir, name), Number.parseInt(name, 10), isAlive)] += 1;
  }
  return counts;
}

// The live, stale and unreadable marker counts for a host. An absent directory is all zeros; a symlinked or non-directory
// path is PATH_ESCAPE; a scan that does not finish within readTimeoutMs is TOOL_TIMEOUT.
export async function readPresence(stateDir: string, hostId: HostId, options: PresenceReadOptions = {}): Promise<PresenceCounts> {
  const hosts = lstatIfPresent(join(stateDir, "hosts"));
  if (hosts === null) {
    return { live: 0, stale: 0, unreadable: 0 };
  }
  if (hosts.isSymbolicLink() || !hosts.isDirectory()) {
    throw makeRealmError("PATH_ESCAPE");
  }
  const dir = presenceDirOf(stateDir, hostId);
  const stats = lstatIfPresent(dir);
  if (stats === null) {
    return { live: 0, stale: 0, unreadable: 0 };
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw makeRealmError("PATH_ESCAPE");
  }
  try {
    return await withTimeout(
      scan(dir, options.isAlive ?? processAlive),
      options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS,
      "TOOL_TIMEOUT",
    );
  } catch (error: unknown) {
    if (errnoOf(error) === "ENOENT") {
      return { live: 0, stale: 0, unreadable: 0 };
    }
    throw error;
  }
}

// One host's reading: its counts, or the catalogue code of the failure that kept it from being read.
export type HostPresenceReport =
  | { readonly id: HostId; readonly counts: PresenceCounts }
  | { readonly id: HostId; readonly error: ErrorCode };

// The hosts that have live or unreadable markers, in HOST_IDS order. A host with none is left out, and so is every host when
// the hosts directory is absent. Every bound of readPresence applies per host. A host whose directory cannot be read is
// reported by code and the others are still read; the function never throws for content.
export async function readAllPresence(stateDir: string, options: PresenceReadOptions = {}): Promise<readonly HostPresenceReport[]> {
  const readings = await Promise.all(
    HOST_IDS.map(async (id): Promise<HostPresenceReport> => {
      try {
        return { id, counts: await readPresence(stateDir, id, options) };
      } catch (error: unknown) {
        return { id, error: error instanceof RealmError ? error.code : "SCHEMA_INVALID" };
      }
    }),
  );
  return readings.filter((reading) => "error" in reading || reading.counts.live + reading.counts.unreadable > 0);
}
