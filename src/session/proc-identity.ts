// Process identity read from /proc. The session lock and the runner record both need the same facts: the boot id of this
// kernel boot, and for a pid its state, process group and start time in clock ticks. One parser reads /proc/<pid>/stat,
// so the two modules cannot disagree about when a pid started.

import { readFileSync } from "node:fs";

const BOOT_ID_FILE = "/proc/sys/kernel/random/boot_id";
// The fields after the command name, counted from field 3 (state) as index 0. Field 5 (pgrp) is index 2 and field 22
// (starttime) is index 19.
const STATE_INDEX = 0;
const PGRP_INDEX = 2;
const START_TICKS_INDEX = 19;

export interface ProcStat {
  readonly state: string;
  readonly pgid: number;
  readonly startTicks: number;
}

// Parses the text of /proc/<pid>/stat. The command name sits in parentheses and may hold spaces or parentheses, so the
// fields are read after the LAST ")". Malformed text is null.
export function parseProcStat(text: string): ProcStat | null {
  const close = text.lastIndexOf(")");
  if (close < 0) {
    return null;
  }
  const fields = text.slice(close + 2).split(" ");
  const state = fields[STATE_INDEX];
  const pgrp = fields[PGRP_INDEX];
  const start = fields[START_TICKS_INDEX];
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

// The parsed stat of a pid, or null when the process has no stat file or the file is malformed.
export function readProcStat(pid: number): ProcStat | null {
  let text: string;
  try {
    text = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
  } catch {
    return null;
  }
  return parseProcStat(text);
}

// The start time of a pid in clock ticks, or undefined when it cannot be read.
export function startTicksOf(pid: number): number | undefined {
  return readProcStat(pid)?.startTicks;
}

// The boot id of this kernel boot, or null when it cannot be read. A record from another boot names pids of a dead boot.
export function currentBootId(): string | null {
  try {
    const id = readFileSync(BOOT_ID_FILE, "utf8").trim();
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}
