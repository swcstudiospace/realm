// Runner identity record (per session). The AgentOS runner child leads its own process group and can outlive the daemon
// that spawned it. Right after its spawn, the driver writes <stateDir>/<sessionId>.runner.json naming the leader's pid,
// its process group id, its start time in clock ticks (field 22 of /proc/<pid>/stat) and the boot id. Before a restart
// hydrates an adopted session, the controller reads that record and stops the recorded group, so a new runner never shares
// a sandbox with an old one. Every check reads /proc. Nothing is signalled unless the recorded leader is still the same
// process, and a pid whose start ticks differ is a different process that is never signalled.

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { makeRealmError } from "../core/errors.js";
import { atomicWriteFile, observeSha256 } from "../fs/atomic-write.js";
import { bindRoot } from "../fs/root.js";
import { isSessionId } from "./paths.js";

const RECORD_SCHEMA = 1;
const RECORD_SUFFIX = ".runner.json";
const DIRECTORY_MODE = 0o700;
// How long the recorded group gets to exit after SIGTERM before it is killed. The runner is `openshell sandbox exec`, which
// must end its in-sandbox workload and close its gateway stream after SIGTERM; 5 s gives that time on a loaded host.
export const RUNNER_STOP_GRACE_MS = 5000;
// How long the group gets to empty after SIGKILL. SIGKILL cannot be caught, so this only covers kernel delivery and reaping.
const KILL_SETTLE_MS = 1000;
const POLL_MS = 50;

export interface RunnerRecord {
  readonly schema: typeof RECORD_SCHEMA;
  readonly pid: number;
  readonly pgid: number;
  readonly startTicks: number;
  readonly bootId: string;
}

// The leader's state: "same" when a live process holds the pid and the recorded start ticks, "absent" when no live process
// holds the pid (none, or a zombie), and "other" when a live process holds the pid with other start ticks, a reused pid.
export type LeaderState = "same" | "absent" | "other";

interface ProcStat {
  readonly state: string;
  readonly pgid: number;
  readonly startTicks: number;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

// A zombie or dead process holds no resources and sends no further signals, so it is not live.
function isLive(state: string): boolean {
  return state !== "Z" && state !== "X";
}

// Reads /proc/<pid>/stat. The comm field sits in parentheses and may hold spaces or parentheses, so the fields are read
// after the last ")". After it, the first field is state (field 3), pgrp is field 5 (index 2) and starttime is field 22
// (index 19). A missing or malformed file is null.
function readProcStat(pid: number): ProcStat | null {
  let text: string;
  try {
    text = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
  } catch {
    return null;
  }
  const close = text.lastIndexOf(")");
  const fields = close < 0 ? [] : text.slice(close + 2).split(" ");
  const state = fields[0];
  const pgrp = fields[2];
  const start = fields[19];
  if (state === undefined || pgrp === undefined || start === undefined) {
    return null;
  }
  const pgid = Number(pgrp);
  const startTicks = Number(start);
  if (!Number.isSafeInteger(pgid) || !Number.isSafeInteger(startTicks) || startTicks < 0) {
    return null;
  }
  return { state, pgid, startTicks };
}

// The boot id of this kernel boot, or null when it cannot be read. A record from another boot names pids of a dead boot.
export function currentBootId(): string | null {
  try {
    const id = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

// The record of a runner just spawned. The runner must lead its own group, pgid equal to pid: a group signal aimed at any other
// group could reach processes this realm did not start. A runner that is not live, or not a leader, gives no record.
export function runnerRecordOf(pid: number, bootId: string): RunnerRecord | null {
  const stat = readProcStat(pid);
  if (stat === null || !isLive(stat.state) || stat.pgid !== pid) {
    return null;
  }
  return { schema: RECORD_SCHEMA, pid, pgid: stat.pgid, startTicks: stat.startTicks, bootId };
}

function recordFileName(sessionId: string): string {
  if (!isSessionId(sessionId)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return `${sessionId}${RECORD_SUFFIX}`;
}

// Writes the record atomically (temp file, then rename). A failed write throws, and the caller refuses the spawn.
export function writeRunnerRecord(stateDir: string, sessionId: string, record: RunnerRecord): void {
  const name = recordFileName(sessionId);
  mkdirSync(stateDir, { recursive: true, mode: DIRECTORY_MODE });
  const target = join(bindRoot(stateDir).realPath, name);
  atomicWriteFile(target, `${JSON.stringify(record)}\n`, { expectedPriorSha256: observeSha256(target) });
}

function parseRunnerRecord(text: string): RunnerRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObjectRecord(value)) {
    return null;
  }
  const { schema, pid, pgid, startTicks, bootId } = value;
  // The group must be the leader's own (pgid equal to pid): a record that names another group is refused.
  if (
    schema !== RECORD_SCHEMA ||
    !isPositiveInteger(pid) ||
    pgid !== pid ||
    !isNonNegativeInteger(startTicks) ||
    typeof bootId !== "string" ||
    bootId.length === 0
  ) {
    return null;
  }
  return { schema: RECORD_SCHEMA, pid, pgid, startTicks, bootId };
}

// The record of one session, or null when it is absent, unreadable, malformed or not a session id. Null is the refusal
// the controller acts on: a session with no record is never adopted.
export function readRunnerRecord(stateDir: string, sessionId: string): RunnerRecord | null {
  if (!isSessionId(sessionId)) {
    return null;
  }
  let text: string;
  try {
    text = readFileSync(join(stateDir, recordFileName(sessionId)), "utf8");
  } catch {
    return null;
  }
  return parseRunnerRecord(text);
}

// The state of the recorded leader now (see LeaderState).
export function leaderStateOf(record: RunnerRecord): LeaderState {
  const stat = readProcStat(record.pid);
  if (stat === null || !isLive(stat.state)) {
    return "absent";
  }
  return stat.startTicks === record.startTicks ? "same" : "other";
}

// True when a process of the group exists, a zombie included. The probe is kill(-pgid, 0): one system call, with no scan of
// /proc, so its cost does not grow with the number of processes on the host, which matters inside the startup budget. A zombie
// keeps its group until its parent reaps it, so it counts as a member: a wait for the group ends once the parent has reaped
// it, and the parent's exit event has then fired, so the exit signal is observable. EPERM means a process exists that this
// process may not signal, so it counts as present, and the caller fails closed.
export function groupHasMembers(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error: unknown) {
    const code: unknown = error instanceof Error ? Reflect.get(error, "code") : undefined;
    return code !== "ESRCH";
  }
}

// Sends one signal to the recorded group, and only while the recorded leader is still the same process. A leader that is
// absent or reused is never signalled. Linux gives Node no pidfd here, so a race remains between the check and the kill:
// the leader can exit, and its pid be reused, in the gap. The gap is one system call wide and cannot be closed without a
// pidfd. Returns true when the signal was sent.
export function signalRecordedGroup(record: RunnerRecord, signal: NodeJS.Signals): boolean {
  if (leaderStateOf(record) !== "same") {
    return false;
  }
  try {
    process.kill(-record.pgid, signal);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Waits until the group has no live members, for at most ms. True when it is empty.
async function waitGone(pgid: number, ms: number, groupLive: (pgid: number) => boolean): Promise<boolean> {
  const deadline = performance.now() + ms;
  for (;;) {
    if (!groupLive(pgid)) {
      return true;
    }
    if (performance.now() >= deadline) {
      return false;
    }
    await delay(POLL_MS);
  }
}

// Stops the runner of a recorded session. True only when the session may be adopted: the recorded group has no live member
// left. A leader that is other, a reused pid, is refused and never signalled. A leader that is absent is never signalled: its
// group is only awaited, for at most graceMs, so an unreaped zombie leader has time to be reaped, and a member still alive
// then refuses the session. A live leader gets SIGTERM, then SIGKILL when the group still has members after graceMs, and the
// group must be empty once the kill settles. Every wait is bounded, and a wait that expires returns false.
export async function stopRecordedRunner(
  record: RunnerRecord,
  graceMs: number,
  groupLive: (pgid: number) => boolean,
): Promise<boolean> {
  const leader = leaderStateOf(record);
  if (leader === "other") {
    return false;
  }
  if (leader === "absent") {
    return waitGone(record.pgid, graceMs, groupLive);
  }
  signalRecordedGroup(record, "SIGTERM");
  if (await waitGone(record.pgid, graceMs, groupLive)) {
    return true;
  }
  signalRecordedGroup(record, "SIGKILL");
  return waitGone(record.pgid, KILL_SETTLE_MS, groupLive);
}
