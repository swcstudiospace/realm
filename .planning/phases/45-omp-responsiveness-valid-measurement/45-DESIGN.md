# Phase 45: frozen measurement design (OMPV-01)

Status: frozen 2026-11-19
Commit: 999cb2f28bd6812139825dedd89b04f512ef8f45
Owner answers (Task 4): OD-45-1 approved (root-assisted isolation allowed
for windows; Branch X in scope, default stays Branch S); OD-45-2 constants
accepted as listed in 45-CONTEXT; OD-45-3 no (no request to other users to
pause heavy work); OD-45-4 yes (build the BEFORE tree by reversing the
product paths of the PR 211 commit in a scratch checkout).

Branch: S (selected). Deciding record lines (45-FEASIBILITY.md, Part B):
P3 usable (scope from a scrubbed environment, detached child inside the
scope, P3 literal result); P5 showing the scope total readable and moving
under the burner and staying near zero for a sleeper (P5 literal result);
P6 readable (P6 literal result). Branch N is not selected (P3 is usable).
Branch X is in scope by OD-45-1 (approved) and is taken only when a
root-run preparation task has run for the window; the default tier for a
window remains Branch S.

## D-45-03 isolation envelope — as in 45-CONTEXT

Every Omp process of a window runs through the `wrap` option of `startOmp`
with exactly this argv (the P3 command that worked, options and order,
double dash included; pinned by value in `test/support/omp-arm-run.ts` as
`SCOPE_RUNNER_ARGV`):

`systemd-run --user --scope --quiet --collect --`

The scope is identical for the control and the cold attach and for both
arms. Nothing in it is tuned (P10 records that a weight is accepted, and
the design does not use one; no quota, no pinning by default). The
environment is the scrubbed one (the runtime directory and the system
PATH, nothing else). If the scope command fails the run is a refusal
(rule V0), never a silent unscoped run. The scope's cgroup path is
derived from `/proc/PID/cgroup` of the child (P3 literal result shows the
shape under the user-manager service `app.slice`).

One amendment is recorded against the context's repository facts: the
context (E-45-11) states that `OmpSession` has no process id; at this
commit it does (`get pid()`, 45-FEASIBILITY.md Part A.3), and the design
reads the child pid through that accessor for the contention sampler
(amendment forced by that record line; no other seam changes).

Branch X (OD-45-1, approved; root-assisted, prepared by a separate root
run, never by a plan executor). The harness seam is the `isolation` argv
prefix of `scopedWrap` (put before the scope command; empty by default,
pinned by the hermetic tests). With cpuset delegated, the prefix carries
the reservation to the Omp process; the root step itself is:

Preparation (root, runtime only, recorded in the window evidence):
`systemctl set-property --runtime user@UID.service DelegateControllers="cpu memory pids cpuset"`
then, for every other per-user slice present (listed at prep time),
`systemctl set-property --runtime user-<uid>.slice AllowedCPUs="0-3"`,
and `systemctl set-property --runtime user-5002.slice AllowedCPUs="4-7"`.
Effect on other users: during the window the other slices of the shared
host lose CPUs 4-7 and keep only 0-3, so other users' work slows; the
account's own scope sees an isolated tier. Revert (root, after the
window): clear each runtime property back to empty
(`systemctl set-property --runtime <unit> AllowedCPUs=""` and
`DelegateControllers` restored to `cpu memory pids`), then verify with
`systemctl show` on the same units and record the readings; the cgroup
subtree-control hashes are recorded before and after. This plan changed
nothing in the host policy; the P11 read shows the pre-step state (mount
root subtree control includes cpuset; all three `AllowedCPUs` empty).

## D-45-05 readings — as in 45-CONTEXT, fields confirmed by P5 and P6

- The scope's cumulative `total` of the `cpu.pressure` "some" line
  (microseconds), from the scope's cgroup directory (P5 confirms the file
  exists in the scope and the field moves).
- The three fields of `/proc/PID/task/PID/schedstat` (nanoseconds on CPU,
  nanoseconds on a run queue, time slices) for the Omp main thread, plus
  the run-queue sum over all threads at the window ends (P6 confirms the
  file and that both fields move).
- Each reading carries the harness monotonic time. Attribution, the
  self-inflicted latency and the stall set follow 45-CONTEXT D-45-05
  unchanged: on-CPU ms, run-queue ms, sleep ms (interval minus the first
  two, never below zero); self-inflicted latency is the raw latency minus
  run-queue ms, never below zero; an unbracketed probe is unattributed
  and counts at its raw latency. The verdict reads `summariseLatencies`
  over the self-inflicted latencies; the raw summary is recorded beside
  it. Thresholds unchanged (see the unchanged list below).

## D-45-06 run validity — as in 45-CONTEXT

V0 refusal, V1 mechanics, V2 probe-driver health (gap at most
`PROBE_DRIVER_GAP_MAX_MS`), V3 scoped contention (V3a scope stall share at
most `STALL_SHARE_MAX`, V3b main-thread run-queue share at most
`RUNQ_SHARE_MAX`; under Branch N only V3b), V4 control self-inflicted
serving summary bounds, V5 attribution coverage at least
`ATTRIBUTION_COVERAGE_MIN`. Constants, in two groups:

Fixed now (OD-45-2, accepted): `MIN_VERDICT_RUNS` 5, `MIN_VALID_PAIRS` 5,
`MAX_PAIR_ATTEMPTS` 12, `CALIBRATION_TARGET_RUNS` 12,
`CALIBRATION_MAX_ATTEMPTS` 16, `CALIBRATION_MIN_PASSING` 5, bound
quantiles 0.9 and 0.75, `BOUND_ROUND_MS` 50, `CONTROL_BOUND_CAP_FACTOR` 3,
`ATTRIBUTION_COVERAGE_MIN` 0.9, `PROBE_DRIVER_GAP_MAX_MS` 750,
`CAUSE_SHARE_MIN` 0.5, `STALL_SLICE_CPU_MAX_MS` at most 100.

Calibration-pending (each marked unset until plan 45-04 freezes it):
`STALL_SHARE_MAX`, `RUNQ_SHARE_MAX`, `CONTROL_SELF_MAX_BOUND_MS`,
`CONTROL_SELF_P95_BOUND_MS`. The decision functions refuse a verdict
while any is unset (outcome VOID, reason `uncalibrated`).

## D-45-07 order — as in 45-CONTEXT

Run index and control-first rule unchanged; `runIndexOf` and
`controlFirst` pure and pinned by hermetic tests.

## D-45-08 calibration — as in 45-CONTEXT

The procedure, the `deriveBounds` derivation (including: fewer than
`CALIBRATION_MIN_PASSING` passing controls makes the bounds underivable
and the phase ends VOID before the verdict window) and the freeze into a
code module are as in 45-CONTEXT. The main-thread identity check is a
freeze precondition (at least 10 of 12 calibration controls), as in
45-CONTEXT.

## D-45-09 verdict table, cause table and claims — as in 45-CONTEXT

VOID, FINDING, NOT-REPRODUCED, PASS in that order; the cause table
(`omp-own`, `extension-on-cpu`, `extension-wait`, `unattributed`,
`mixed`) and the claims each outcome can make are as in 45-CONTEXT.

## D-45-10 paired cutover — as in 45-CONTEXT

Metrics, outcome table and labels kept; the pair validity predicate reads
the run validity of D-45-06 instead of the one-minute load average;
`PAIR_LOAD_CEILING_PER_CPU`, `PAIR_LOAD_GAP_PER_CPU` and the load fields
of `ArmRun` are removed in the same change with the reason recorded;
`MAX_PAIR_ATTEMPTS` 12, `MIN_VALID_PAIRS` 5.

## D-45-11 window procedure — as in 45-CONTEXT

Trees (AFTER the shipping head; BEFORE the scratch checkout with the PR
211 product paths reversed; the reversal conflicts only in planning and
docs, 45-FEASIBILITY.md Part A.4), account and stack, stop rule (fifth
valid pair or twelfth attempt), cost, settle under the shared lock, and
evidence outside the repository are as in 45-CONTEXT.

## D-45-12 resolution — as in 45-CONTEXT

The outcome-to-issue table is as in 45-CONTEXT; no row closes on VOID or
on the hermetic probe alone; the conditional fix keeps fail closed.

## Unchanged thresholds and Phase 38 constants

`PROBE_INTERVAL_MS` 250, `MAX_LATENCY_MS` 1000, `P95_LATENCY_MS` 500,
`MIN_PROBES` 40, `MIN_WINDOW_MS` 10000, `BASELINE_WINDOW_MS` 10000,
`BASELINE_MIN_PROBES` 30, `QUIET_LOAD_PER_CPU` 0.5; `MIN_VALID_RUNS` 3,
`MAX_ATTEMPTS` 6, `BOOT_EXCESS_MAX_MS` 250, `CONTROL_MIN_WINDOW_MS`
12000, `CONTROL_MAX_WINDOW_MS` 60000 and the case and window tables;
`MIN_VALID_PAIRS` 5, `MAX_PAIR_ATTEMPTS` 12, `SERVING_CONTROL_WINDOW_MS`
5000 and the remaining paired constants (45-FEASIBILITY.md Part A.5).
`responsivenessProblems` and its output strings are untouched.

## What is not frozen, and why

The four calibrated constants (`STALL_SHARE_MAX`, `RUNQ_SHARE_MAX`,
`CONTROL_SELF_MAX_BOUND_MS`, `CONTROL_SELF_P95_BOUND_MS`) are not frozen
by this design: they are fixed only by the calibration of plan 45-04,
which measures what a no-extension Omp actually does on this host under
the scope, and they are frozen in code by that plan's freeze task before
the first verdict run. Everything else above is frozen now, and the
harness plan refuses to start on an unfrozen design. No quiet-host
measurement is claimed by this design; no verdict exists yet.
