# Plan 39-02 Summary: the kill path fix (EXEC-02) and the unchanged contract (EXEC-03, code side)

Date: 2026-11-18. Commits: `6e2b1d2` (first attempt, coreutils `timeout`), `275b486` (final fix, bash watchdog), `ed8b814` (merge with Phase 41).

## History, stated honestly

1. The plan's fix was `/usr/bin/timeout --kill-after=1.5 -- 28.5 WORKLOAD` in front of every dispatcher exec, with hermetic tests that ran the real `timeout` on the host. They passed, and the live proof failed: `timeout` and the shell died but the grandchildren survived. The hermetic tests could not show this because on the host `timeout` can signal its process group, and inside the sandbox it cannot.
2. A live lab found the cause: inside the sandbox kill(2) with a pid at or below zero returns EPERM for every caller (seccomp, NoNewPrivs, no capabilities). Only a signal to one named process works. `timeout` therefore reaches only its direct child.
3. The final fix is an in-sandbox bash wrapper that finds the exec's processes in `/proc` and signals each by pid. The lab's candidate script had a race: `wait -n -p` missed a workload that had already ended, and about 2 in 1900 quick runs under load ran to the deadline (a 28 s call for a quick command). A second version that polled with `kill -0` hung because bash had not reaped the exited workload. The shipped script polls the workload's state in `/proc` (Z or X counts as ended), takes the exit code with `wait`, and ticks on a bash coprocess pipe; about 3600 mixed quick runs under 12-way load and about 9600 hang-hunt runs gave no hang.

## What was built

- `src/runtime/exec-watchdog.ts`: one export, `watchdogWorkload(workload, runnerDeadlineMs)`, returning `/usr/bin/bash -c SCRIPT realm-exec-wd SECONDS WORKLOAD...` (SECONDS is the runner deadline plus 500 ms, 28.5). It validates the deadline and the workload (`SCHEMA_INVALID`) and imports only the error factory. The script is a constant in the module, documented there.
- `src/runtime/session-execution.ts`: `runSandboxExec` builds the argv from the wrapped workload, takes an optional monotonic clock, and a run that resolves at or after the runner deadline is `TOOL_TIMEOUT` whatever its exit code (a stalled client timer); an earlier resolve keeps its exit code, 124 included. The comment says what a timeout does. `src/tools/dispatch.ts`: comments only.
- `test/runtime/exec-watchdog.test.ts`: the argv pins (the script by SHA-256 and key tokens), `bash -n`, and real-process tests of the wrapper on this host's bash with a `BASH_ENV` file that makes the builtin `kill` refuse a group target as the sandbox does: a tree of background sleeps, a nested subshell, a `trap '' TERM` child and a repeated forker all dead after the deadline with exit 124; an unrelated sibling survives; exit codes 0, 3, 127 and 143 pass through; stdout, stderr and stdin pass through; options are not reparsed; a winning workload leaves nothing of the wrapper behind; 60 quick runs never wait for the deadline; a `setsid` child that keeps the environment is reached and one that clears it and detaches its stdio survives (recorded in the test as the limit). The test runs as a regular user (as root it drops to uid 65534).
- The argv pins in `test/runtime/session-execution.test.ts`, `test/runtime/openshell-routing.test.ts` and `test/tools/dispatch.test.ts` follow the new argv; new dispatcher tests show the audit lines carry the caller's argv (or the shell script's size and hash) and no wrapper text, and that a timed-out runner still gives the retryable `TOOL_TIMEOUT` refusal with no cause code. The pinned exec form (the verb and four flags), the AgentOS runner child and its probe are unchanged.

## Task 3 (the `!` marker, OQ-39-03)

No answer was given; the default applies: no `!` marker. The image requirement (bash 5.0 or newer, `sleep`, `cat`) is documented in `docs/integration/openshell.md`; a custom image without them fails every dispatcher exec loudly (exit 127 from the version check, or a start failure) and never runs the workload unsupervised.

## Checks run by the worker

`tsc` clean; `eslint` clean; `check:gates`, `host-paths`, `check:docs` pass; suites tools, runtime, daemon, mcp, acp, surfaces, quality and docs passed (after the merge, runtime, tools and daemon 1118 of 1118). The new test file passes 18 of 18 as root and with the timeout scale at 3.
