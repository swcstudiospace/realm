# Phase 49: feasibility restatement (OMPV-04, Step 1) — 2026-11-19

Commit under restatement: 9d2a085 (worktree z49, branch gsd/exec-49).
Account: the realm live account (uid 5002), via `runuser` with the account's
own runtime directory and session bus (the account's user manager reports
`running`). Deviation from Phase 45, stated: Phase 45 used a fresh ssh login
session for the probes; this restatement used `runuser` with the account's
bus variables, which reaches the same user manager and the same scopes. The
one visible effect is that `cat /proc/self/cgroup` in the unscoped shell
(P6 "outside" leg, P1) shows the root session scope instead of the account's
login scope; the scoped legs (all the design touches) are unaffected.
Evidence: one file per probe (p1.txt to p12.txt) plus inner scripts, in a new
directory outside the repository (mode 0700), role `feas49-20261119` under the
realm account's `realm-evidence` directory. No host-local absolute path is
written here.

Host in numbers at probe time (descriptive only, never a validity input):
one-minute load 7.37 to 8.65 on 8 CPUs; system CPU pressure "some" avg10
5.92 to 9.66 (Phase 45 read 45.18 to 58.68: the host is differently shaped
today — runnable load remains, stall share is much lower); account slice
pressure "some" avg10 0.00 to 0.03; guest steal ticks advancing
(105417599 to 105424142 across the window: the guest is on a shared host).
Nothing in the restatement started Omp, a daemon, a container or the
production stack; the only load added was the phase-45 burner/sleeper pair
(15 s each, P5). Residue is recorded in 49-MEASUREMENT.md.

## Per-primitive re-probe (Step 1)

One row per primitive. "Literal result" is copied from the probe file;
verdicts reuse 45-FEASIBILITY.md Part B vocabulary (usable, usable with
limits, not usable, not tried). "vs 45" names any change.

| Probe | Primitive | Literal result (probe file) | Verdict | vs 45 |
| --- | --- | --- | --- | --- |
| P1 | cgroup v2 | `cgroup2fs`; controllers `cpuset cpu io memory hugetlb pids rdma misc` (p1.txt) | usable | unchanged |
| P2 | delegated subtree | `Delegate=yes`, `DelegateControllers=cpu memory pids`; subtree owned by the realm account; type `domain`; `cgroup.procs` writable; `systemctl --user is-system-running` (p2.txt) | usable with limits (cpuset still not delegated) | unchanged |
| P3 | transient scope from scrubbed environment | scope path `app.slice/run-r6d684ee71c2a4fbca324b6105be53318.scope`; scope controllers `cpu memory pids`; scope `cpu.pressure` readable (`some ... total=145`); detached child cgroup identical; no leftover scope (p3.txt) | usable | LEAF SHAPE changed: `run-r<32hex>.scope` (45 saw `run-<32hex>.scope`). Both are accepted by the `run-*.scope` check (`omp-arm-run.ts` `isRunScopeLeaf`). |
| P4 | cpuset / AllowedCPUs on the scope | affinity `ff` (unchanged); no cpuset files in the scope (p4.txt) | not usable (silently ignored) | unchanged |
| P5 | per-cgroup pressure moves | scope A burner: scope total delta 137161 µs, system delta 1499529 µs; scope B sleeper: delta 489 µs, system delta 1313288 µs (p5.txt) | usable | unchanged (magnitudes differ, mechanism same) |
| P6 | per-thread run-queue delay | in scope: before `41066021 2769896 32`, after `1450949706 33085175 449` (both fields moved); outside: before `31428309 404751 8`, after `1370905716 24652329 335`; PID 1 schedstat readable (p6.txt) | usable | probe script staleness only (see note); primitive unchanged |
| P7 | taskset | shell affinity `ff`; pinned child `1` (p7.txt) | usable | unchanged |
| P8 | the two descriptions of load | `nproc` 8; load per CPU 0.92 to 1.08; system stall share 5.92 to 9.66; slice 0.00 to 0.03 (p8.txt) | usable (descriptive only) | numbers differ (host shape); method unchanged |
| P9 | kernel and tool facts | kernel `6.8.0-149-generic`; boot config `CONFIG_PSI=y`, `CONFIG_SCHED_INFO=y`, `CONFIG_SCHEDSTATS=y`; `kernel.sched_schedstats` 0; systemd 255; node `v24.18.0`; scrubbed-env `omp --version` prints `omp/19.0.0`, `omp` resolves under `/usr/local/bin` (p9.txt) | usable | unchanged |
| P10 | CPU weight on a scope | `100` then `1000` read back (p10.txt) | usable but not used | unchanged |
| P11 | root-assisted options (read only) | mount-root subtree control `cpuset cpu io memory hugetlb pids rdma misc`; all `AllowedCPUs` empty; nothing changed (p11.txt) | usable (read only) | unchanged |

Note on P6: the phase-45 probe script's `inner-sched.js` uses `require()`
while the account's home `package.json` now declares `"type": "module"`, so
the script as archived fails at import. The re-run used the identical script
as a `.cjs` file (recorded in the probe file). This is probe-script
staleness, not a host primitive regression.

## Branch selection

The frozen design is Branch S. Every condition that selected S in
45-FEASIBILITY.md Part D still holds: P3 usable (scope from a scrubbed
environment, detached child inside it, pressure file readable), P5 showing
the scope total readable and moving under a burner and near zero for a
sleeper, P6 readable with both fields moving. No primitive regressed, so no
fallback is needed and the design does not fall back to anything: the
isolation envelope stays the phase-45 per-run scope, `loaded, scoped`.

## What this restatement does not show

That a verdict-length window fits on this host today. P12 lists the realm
account's processes during the probes: beside the production stack (podman
system service, gateway, runtime driver) a second phase's live test was
running (role `z50-20261119`, still in its control leg when P12 was taken).
Live windows of this phase are serialized behind it under the shared live
lock; the calibration and any verdict window start only when no other window
is active (checked at run time, recorded in 49-MEASUREMENT.md).
