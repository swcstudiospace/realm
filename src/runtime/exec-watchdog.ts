// The in-sandbox end of a timed-out exec (Phase 39, D-39-02, revised after the live proof). When the dispatcher's runner deadline
// expires, the runner kills the local `openshell sandbox exec` client and its process group, and nothing else: the OpenShell
// gateway and supervisor of the pinned revision do not signal the workload when a client goes away or an execution timeout expires
// (NVIDIA/OpenShell issues 5042 and 3159; 39-CONTEXT E-39-04 and E-39-05). So every dispatcher exec runs under a small bash wrapper
// inside the sandbox, which does not depend on the gateway, the supervisor or the client being alive.
//
// Why not coreutils `timeout` or a group kill. Inside the sandbox kill(2) with a pid at or below zero (a process group, or every
// process) returns EPERM for every caller (seccomp, NoNewPrivs, no capabilities); only signals to one named process work. `timeout`
// reaches only its direct child, so a shell's children survive it, reparented to pid 1 (live lab, 2026-11-18). The wrapper therefore
// never signals a group. At the deadline it finds the exec's processes by reading /proc and signals each one by pid.
//
// What the wrapper does. It runs the workload in the background with a random token in its environment and stdin passed through,
// and polls every 20 ms until the workload has ended or the deadline has passed on the sandbox clock. The poll is a `read -t` on a
// bash coprocess pipe that never delivers data, so there is no timer process to leave behind or to hold the exec's pipes; the
// coprocess is started only when the workload is still running after its first check, and it exits when the wrapper does. (A
// first version waited for the workload and a `sleep` with `wait -n -p`; under load a workload that ended before the wait began was
// missed and the call ran to the deadline. A second version polled with `kill -0` and found bash had not reaped the exited workload,
// which stays a zombie that `kill -0` still accepts. The poll therefore reads the workload's state from /proc, treats Z and X as ended,
// and takes the exit code with `wait`, which reaps it.)
// If the workload ends first, the wrapper exits with the workload's own exit code. If the deadline passes first, the wrapper sweeps
// up to twelve rounds: each round lists the exec's processes, never the wrapper's ancestors or pid 1, stops them (SIGSTOP, so a
// forking process cannot outrun the sweep), kills them (SIGKILL), waits 50 ms, and lists again to catch children forked in
// between. It then exits 124, the exit code of `timeout`.
//
// A process belongs to the exec when any rule holds: it is in the wrapper's own process group (every dispatcher exec is its own
// group leader, so the group is the exec's); it holds the wrapper's stdout or stderr pipe open (an orphan that still holds the
// exec's output pipe would keep the client waiting); it carries the token in its environment (a process that left the group with
// setsid keeps it unless it clears the environment); or its parent is a member (repeated until nothing changes, so descendants are
// found). Not covered: a process that is orphaned, clears its environment and closes both pipes (an `env -i`, `setsid` double fork
// with stdio sent to /dev/null) is indistinguishable from an unrelated process and survives. That limit is documented and measured,
// not fixed; a cgroup per exec would need OpenShell (D-39-05).
//
// The wrapper's arguments are fixed text plus the deadline in seconds and the caller's argv, which follows verbatim and is never
// reparsed. The argv is: /usr/bin/bash -c SCRIPT realm-exec-wd SECONDS WORKLOAD. The deadline is the runner deadline plus a margin,
// measured on the sandbox clock, so the wrapper cannot end a call before the client's own bound would (D-39-03).
//
// Requirements on the sandbox image: /usr/bin/bash 5.0 or newer (EPOCHREALTIME), and `sleep` and `cat`. The script checks the bash
// version itself and exits 127 with a message on stderr when bash is older; when /usr/bin/bash is absent the exec fails at its
// start, as any missing program does. Neither case runs the workload unsupervised. The wrapper reads only /proc and sends signals
// to single processes; it uses bash builtins plus `sleep` and `cat`, because the image has no pkill, pgrep or ps.
//
// This module is pure; it spawns nothing and imports only the error factory, so it stays outside the exec gate closure (E-39-14).

import { makeRealmError } from "../core/errors.js";

const WATCHDOG_BINARY = "/usr/bin/bash";
// The wrapper's own name in the process table and its error messages (argument zero of the script).
const WATCHDOG_NAME = "realm-exec-wd";
// The deadline of the wrapper is the runner deadline plus this margin.
const WATCHDOG_MARGIN_MS = 500;

const WATCHDOG_SCRIPT =
  [
    '# realm exec watchdog. $0 = realm-exec-wd, $1 = the deadline in seconds (28.5), the rest = the workload argv.',
    'D=$1; shift',
    '(( BASH_VERSINFO[0] >= 5 )) || { echo "realm-exec-wd: bash 5.0 or newer is required (EPOCHREALTIME)" >&2; exit 127; }',
    'TOK="$$.$EPOCHREALTIME"',
    'IFS=. read -r DS DF <<<"$D"; DF=${DF}000000',
    'END=$(( ${EPOCHREALTIME//[.,]/} + 10#$DS * 1000000 + 10#${DF:0:6} ))',
    'OWNPG=; { read -r st < /proc/$$/stat; } 2>/dev/null; st=${st##*) }; read -r _ _ OWNPG _ <<<"$st"',
    'declare -A PP MEM',
    'collect() {',
    '  local d p st state ppid pgid kv hit changed f',
    '  PP=(); MEM=()',
    '  for d in /proc/[0-9]*; do',
    '    p=${d#/proc/}',
    '    [[ $p == $$ ]] && continue',
    '    { read -r st < "$d/stat"; } 2>/dev/null || continue',
    '    st=${st##*) }',
    '    read -r state ppid pgid _ <<<"$st"',
    '    [[ $state == Z || $state == X ]] && continue',
    '    PP[$p]=$ppid',
    '    hit=',
    '    [[ $OWNPG == $$ && $pgid == $OWNPG ]] && hit=1',
    '    if [[ -z $hit ]]; then',
    '      for f in "$d"/fd/*; do',
    '        [[ $f -ef /proc/$$/fd/1 || $f -ef /proc/$$/fd/2 ]] && { hit=1; break; }',
    '      done',
    '    fi',
    '    if [[ -z $hit ]]; then',
    "      { while IFS= read -r -d '' kv; do [[ $kv == \"REALM_EXEC_TOKEN=$TOK\" ]] && { hit=1; break; }; done < \"$d/environ\"; } 2>/dev/null",
    '    fi',
    '    [[ -n $hit ]] && MEM[$p]=1',
    '  done',
    '  changed=1',
    '  while [[ -n $changed ]]; do',
    '    changed=',
    '    for p in "${!PP[@]}"; do',
    '      [[ -z ${MEM[$p]} && ( ${PP[$p]} == $$ || -n ${MEM[${PP[$p]}]} ) ]] && { MEM[$p]=1; changed=1; }',
    '    done',
    '  done',
    '}',
    'sweep() {',
    '  local round p st f',
    '  for round in 1 2 3 4 5 6 7 8 9 10 11 12; do',
    '    collect',
    '    p=$PPID',
    '    while [[ -n $p && $p -gt 0 ]]; do unset "MEM[$p]"; read -r st < /proc/$p/stat 2>/dev/null || break; st=${st##*) }; read -r _ p _ <<<"$st"; done',
    '    unset "MEM[1]"',
    '    (( ${#MEM[@]} )) || return 0',
    '    kill -STOP "${!MEM[@]}" 2>/dev/null',
    '    kill -KILL "${!MEM[@]}" 2>/dev/null',
    '    sleep 0.05',
    '  done',
    '}',
    'alive() {',
    '  local st',
    '  { read -r st < /proc/$W/stat; } 2>/dev/null || return 1',
    '  st=${st##*) }',
    '  [[ ${st%% *} != [ZX] ]]',
    '}',
    'REALM_EXEC_TOKEN=$TOK "$@" <&0 &',
    'W=$!',
    'if alive; then',
    '  coproc TICK { exec cat 2>/dev/null; }',
    '  while alive; do',
    '    (( ${EPOCHREALTIME//[.,]/} < END )) || { disown -a; sweep; exit 124; }',
    '    read -t 0.02 -u "${TICK[0]}" _',
    '  done',
    '  kill "$TICK_PID" 2>/dev/null',
    '  wait "$TICK_PID" 2>/dev/null',
    'fi',
    'wait "$W"',
    'exit $?',
  ].join("\n") + "\n";

// The workload to hand to buildExecArgv: the wrapper in front of the caller's workload, which follows unchanged. Throws the
// SCHEMA_INVALID realm error for a deadline that is not a positive integer number of milliseconds and for an empty workload.
export function watchdogWorkload(workload: readonly string[], runnerDeadlineMs: number): readonly string[] {
  if (!Number.isInteger(runnerDeadlineMs) || runnerDeadlineMs <= 0 || workload.length === 0) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  // Seconds as a plain number, no exponent and no trailing zeros (28500 ms is 28.5).
  const seconds = String((runnerDeadlineMs + WATCHDOG_MARGIN_MS) / 1000);
  return Object.freeze([WATCHDOG_BINARY, "-c", WATCHDOG_SCRIPT, WATCHDOG_NAME, seconds, ...workload]);
}
