// The in-sandbox end of a timed-out exec (Phase 39, D-39-02). When the dispatcher's runner deadline expires, the runner kills the
// local `openshell sandbox exec` client and its process group, and nothing else: the OpenShell gateway and supervisor of the pinned
// revision do not signal the workload when a client goes away or an execution timeout expires (NVIDIA/OpenShell issues 5042 and
// 3159; 39-CONTEXT E-39-04 and E-39-05). So every dispatcher exec runs under GNU coreutils `timeout` inside the sandbox, which does not
// depend on the gateway, the supervisor or the client being alive.
//
// What it covers: `timeout` runs its command in a new process group and signals that group, so the command, a shell and its
// background jobs and helpers end together, with a SIGKILL after a grace for a command that ignores SIGTERM. What it does not cover: a
// process that leaves the group on its own (setsid, a daemonizing double fork) is not signalled (D-39-05; live scenario C2 measures it).
//
// The watchdog fires the runner deadline plus a small margin after the command starts, measured on the sandbox clock, so it cannot end
// a call before the client's own bound would (D-39-03). The caller's argv follows the duration verbatim and is never reparsed as
// options: the `--` separator precedes the duration. This module is pure; it spawns nothing and imports only the error factory, so it
// stays outside the exec gate closure (E-39-14).

import { makeRealmError } from "../core/errors.js";

const WATCHDOG_BINARY = "/usr/bin/timeout";
// The watchdog's SIGTERM comes this long after the runner deadline, and its SIGKILL this long after the SIGTERM.
const WATCHDOG_MARGIN_MS = 500;
const WATCHDOG_KILL_GRACE_MS = 1500;

// The `timeout` argument for a millisecond count: seconds as a plain number, no exponent and no trailing zeros (28500 is 28.5).
function secondsOf(ms: number): string {
  return String(ms / 1000);
}

// The workload to hand to buildExecArgv: the watchdog in front of the caller's workload, which follows unchanged. Throws the
// SCHEMA_INVALID realm error for a deadline that is not a positive integer number of milliseconds and for an empty workload.
export function watchdogWorkload(workload: readonly string[], runnerDeadlineMs: number): readonly string[] {
  if (!Number.isInteger(runnerDeadlineMs) || runnerDeadlineMs <= 0 || workload.length === 0) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return Object.freeze([
    WATCHDOG_BINARY,
    `--kill-after=${secondsOf(WATCHDOG_KILL_GRACE_MS)}`,
    "--",
    secondsOf(runnerDeadlineMs + WATCHDOG_MARGIN_MS),
    ...workload,
  ]);
}
