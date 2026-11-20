# Phase 45: feasibility record (OMPV-01) — 2026-11-19

Commit: 999cb2f28bd6812139825dedd89b04f512ef8f45. Date: 2026-11-19.
Account: the realm live account (uid 5002), in its own ssh login session
(logind session scope under the account's user slice; the account's user
manager reported `running`). The host reads of 45-CONTEXT E-45-01 to E-45-05
were taken by the planner as the root account switching to the realm account
without a login session; they are leads, and are repeated or superseded
below by the account's own session reads. Evidence: one file per probe
(p1.txt to p12.txt) plus a baseline file, in a new directory outside the
repository (mode 0700, files 0600), named with the date (2026-11-19); the
probe script is kept beside them. Evidence locations are described by role
only; no host-local absolute path is written here.

How the session was obtained: a fresh ssh login as the realm account, using
a temporary key installed for this window (a key file under the account's
ssh directory, mode 0700/0600) and removed after the probes; no login
session of the account remains after the window (the root account's own
sessions only). Nothing in this plan started Omp, a daemon, a container, a
gateway or the production stack; no shared live lock was taken (the lock
file was unheld at the time); the only load added was one bounded CPU
burner of 15 seconds per scope probe. Host load and PSI were recorded, not
quiet: at probe time the one-minute load was 2.20 then 4.77 to 16.15 on
8 CPUs across the window and the system CPU pressure "some" average over
10 s was 58.68 down to 45.18, so no number below is a quiet-host
measurement.

Residue, before and after: 0 containers, 0 workspace entries, the same two
user scopes (`init.scope`, a podman pause scope) and no probe scope, the
account's pre-existing processes unchanged, the cgroup subtree-control
hashes byte-identical before and after (recorded as root), and the secret
search at the end (the capability token shape and the account's environment
values) found none.

## Part A: repository facts

Read at the commit above on 2026-11-19 (tier: Observed, this worktree).

1. `wc -l src/omp/plugin.ts` reads 1000. `scripts/check/module-size-allowlist.json`
   lists only one entry: `src/lifecycle/controller.ts` (1069). (E-45-09 holds.)
2. `src/omp/extension.ts` line 19: `import { startDetachedDaemon } from "../daemon/launch.js";`
   and lines 130-131:
   `deferStart: (start: () => void): void => {` / `setImmediate(start);`
   (E-45-09 holds.)
3. `startOmp` in `test/support/omp-rpc.ts` still takes an optional `wrap`
   argv prefix (line 196: `readonly wrap?: readonly string[];`; line 205
   builds the wrapper command), and `test/omp/extension.test.ts` still
   holds the stand-in daemon rig (`startStub`, line 78). DRIFT (E-45-11):
   the context says `OmpSession` exposes no process id; at this commit it
   does expose one, `get pid(): number | undefined` at line 413 (added by
   plan 45-03 for the contention sampler). The drift is recorded with the
   new reading; it does not stop the plan, because the sampler needs the
   pid and the design reads it through this accessor.
4. E-45-12, re-read: `git log --oneline --all -- src/daemon/launch.ts`
   lists `1c7fac8` (and its squash pair `ce04f64`). DRIFT (minor):
   `git log --oneline 1ffeb80..HEAD -- src` lists two commits, not one:
   `1c7fac8` and `ea04e1c` (a later runtime container-stop change touching
   `src/runtime/` and `src/daemon/channel.ts`, none of the product paths
   of `1c7fac8`). The read-only reversal check was run as
   `git merge-tree --write-tree --merge-base=1c7fac8 HEAD 1c7fac8^`
   (exit 1, no working-tree file written): the only conflicts are the
   planning summary rename (`44-02-SUMMARY.md`) and `docs/integration/omp.md`;
   no `src`, `scripts` or `test` file conflicts. The BEFORE tree can still
   be built in a scratch checkout; the harness files are unchanged by the
   reversal except for the same paths `1c7fac8` touched.
5. Thresholds and constants the phase must not change, by name and value at
   this commit:
   - `test/support/responsiveness.ts`: `PROBE_INTERVAL_MS` 250,
     `MAX_LATENCY_MS` 1000, `P95_LATENCY_MS` 500, `MIN_PROBES` 40,
     `MIN_WINDOW_MS` 10000, `BASELINE_WINDOW_MS` 10000,
     `BASELINE_MIN_PROBES` 30, `QUIET_LOAD_PER_CPU` 0.5.
   - `test/support/responsiveness-decision.ts`: `MIN_VALID_RUNS` 3,
     `MAX_ATTEMPTS` 6, `BOOT_EXCESS_MAX_MS` 250,
     `CONTROL_MIN_WINDOW_MS` 12000, `CONTROL_MAX_WINDOW_MS` 60000, plus
     the case and window tables (unchanged).
   - `test/support/paired-ab.ts`: `MIN_VALID_PAIRS` 5,
     `MAX_PAIR_ATTEMPTS` 12, `SERVING_CONTROL_WINDOW_MS` 5000,
     `REPRODUCTION_MIN_MS` 250, `GAIN_MIN_MS` 250,
     `GAIN_PAIR_FRACTION` 0.8, `GAIN_MEDIAN_SHARE` 0.5,
     `STALL_TOLERANCE_MS` 250, `REGRESS_PAIR_FRACTION` 0.2,
     `PAIR_ANSWER_TIMEOUT_MS` 10000, `PAIRED_LABEL` "loaded, paired".
   The later plans pin that these are unchanged.

## Part B: the matrix

One row per primitive P1 to P11. "Literal result" is copied from the probe
file; nothing is rounded, inferred or filled in. Verdicts: usable, usable
with limits, not usable, not tried. "Design use" cites 45-DESIGN.md.

| Probe | Primitive | Command or read (probe file) | Literal result | Verdict | Design use |
| --- | --- | --- | --- | --- | --- |
| P1 | cgroup v2 | `stat -fc %T` on the cgroup mount; `cat cgroup.controllers` of the mount root; `cat /proc/self/cgroup` (p1.txt) | `cgroup2fs`; controllers `cpuset cpu io memory hugetlb pids rdma misc`; login shell `0::/user.slice/user-5002.slice/session-602.scope` | usable | used (D-45-03 scope path derivation) |
| P2 | delegated subtree | `systemctl show user@UID.service -p Delegate -p DelegateControllers`; `ls -ld`, `cat cgroup.controllers`, `cgroup.subtree_control`, `cgroup.type` of the subtree; writability of `cgroup.procs`; `systemctl --user is-system-running` (p2.txt) | `Delegate=yes`, `DelegateControllers=cpu memory pids`; subtree owned by the realm account; controllers and subtree control both `cpu memory pids`; type `domain`; `cgroup.procs` writable: yes; `running` | usable with limits (controller set is cpu/memory/pids; cpuset not delegated) | used (D-45-03; limits feed Branch X) |
| P3 | transient scope from scrubbed environment | `env -i` with exactly the runtime directory and the system PATH, then `systemd-run --user --scope --quiet --collect --` running a shell that prints its cgroup, the scope's controllers and first two pressure lines, and the cgroup of a detached child (p3.txt) | scope path under the user-manager service `app.slice/run-<hex>.scope`; scope controllers `cpu memory pids`; scope `cpu.pressure` readable (`some ... total=62697`); detached child cgroup identical to the scope's; exit 0; no leftover scope afterwards | usable | used (D-45-03 wrapper argv, pinned by value) |
| P4 | cpuset / AllowedCPUs on the scope | same wrapper with `-p AllowedCPUs=0-1`, printing affinity and the scope's cpuset files (p4.txt) | affinity printed `0-7` (unchanged); no cpuset file exists in the scope directory; the two cpuset reads fail with "No such file or directory". No refusal was printed by the runner | not usable (property silently ignored: cpuset is not delegated, P2) | not used by default; Branch X records the root step that would change this |
| P5 | per-cgroup pressure moves | two scopes in sequence, each reading the scope's `cpu.pressure` "some" total and the system file's "some" total at start and after 15 s; scope A one CPU burner, scope B sleep 15 (p5.txt) | scope A: scope total 350 to 393904 (delta 393554 µs); system total delta 9223733 µs; one-minute load 1.28 to 3.55. Scope B: scope total 328 to 3501 (delta 3173 µs); system total delta 8405937 µs; load 3.55 to 7.50 | usable | used (D-45-05 reading; D-45-06 rule V3a) |
| P6 | per-thread run-queue delay | node program reading `schedstat` of its own process before and after a busy loop, in a scope and outside; plus the read of PID 1's file (p6.txt) | in scope: before `176911990 9246060 41`, after `5336687317 153246378 547`. Outside: before `95189586 1277521 14`, after `5489664784 303172635 1265`. The on-CPU field and the run-queue field both moved; PID 1's schedstat was readable (exit 0). The per-permission listing sample did not run (its target shell had exited) and is recorded as not tried; readability itself is shown by the three successful reads | usable | used (D-45-05 readings; D-45-06 rule V3b) |
| P7 | taskset | `taskset -pc` on the login shell; `taskset -c 0` on a child printing its affinity (p7.txt) | shell affinity `0-7`; pinned child affinity `0` | usable | recorded only (isolation seam for Branch X; not used by default) |
| P8 | the two descriptions of load | six samples 10 s apart: first line of the load average, the system pressure file, the account slice pressure file; `nproc` (p8.txt) | `nproc` 8; see Part E table | usable (descriptive only, never a validity input) | recorded only |
| P9 | kernel and tool facts | `uname -r`; boot config search for the PSI and scheduler options; `sched_schedstats`; `systemd-run --version`; `node --version`; paths and versions of omp and node (p9.txt) | kernel `6.8.0-149-generic`; `/proc/config.gz` absent, boot config present with `CONFIG_PSI=y`, `# CONFIG_PSI_DEFAULT_DISABLED is not set`, `CONFIG_SCHED_INFO=y`, `CONFIG_SCHEDSTATS=y`; `kernel.sched_schedstats` 0; systemd 255; node `v24.18.0`; omp at the system path, `omp/19.0.0`; node at `/usr/bin/node` | usable | used (D-45-05 fields exist; later windows use these binaries) |
| P10 | CPU weight on a scope | same wrapper with `CPUWeight=100` and again `1000`, printing the scope's weight file (p10.txt) | both accepted and read back: `100`, then `1000` | usable but not used | recorded only (D-45-03 tunes nothing) |
| P11 | root-assisted options (read only) | `cat cgroup.subtree_control` of the mount root; `systemctl show -p AllowedCPUs` for the system slice, the user slice and the account's user manager (p11.txt) | mount-root subtree control `cpuset cpu io memory hugetlb pids rdma misc`; all three `AllowedCPUs` empty. Nothing was changed | usable (read only) | used (D-45-03 Branch X: what the root step would change, and the revert) |

## Part C: what the record shows and does not show

Shows:
- A transient scope can be made from a scrubbed environment and the
  detached child stays in it (P3); its pressure file is readable and its
  "some" total moves under a burner (delta 393554 µs over 15 s) and stays
  near zero for a sleeper (delta 3173 µs) while the system total moves by
  millions of microseconds in both windows (P5).
- Per-thread run-queue delay is readable by the account in and out of a
  scope, and both fields move (P6); taskset works (P7); the kernel has PSI
  enabled by default and scheduler stats on (P9).
- The two descriptions of load are far apart on this host: the host load
  per CPU 1.34 to 2.12 and system stall share 45 to 58 while the account's
  own slice reads 0.50 to 1.99 (P8, Part E).

Does not show:
- That the Omp main thread is the JavaScript thread (thread id equal to
  the pid); only the calibration of plan 45-04 shows that (D-45-08).
- That a scope does not change the scheduling share compared with an
  unscoped process; stated as a limit and handled by identical scopes for
  both arms and parts (OQ-45-02).
- That the host will be quiet enough for a verdict; the record shows the
  host was not quiet during the probes, and validity is decided inside a
  run by scoped contention (D-45-06), not by this record.

## Part D: Branch selection

Branch condition check against the record lines:
- Branch S requires P3 usable (a scope from a scrubbed environment with
  the detached child inside it): P3 literal result above. P5 showing the
  scope total readable and moving under the burner: P5 literal result
  above. P6 readable: P6 literal result above. All three hold, so Branch S
  is selected. P4 being not usable does not change the branch: cpuset was
  never in the S envelope.
- Branch N would apply only if P3 were not usable; it is usable, so N is
  not selected.
- Branch X: the owner has approved OD-45-1 (2026-11-19, recorded in
  45-CONTEXT), so the design includes the root-assisted isolated tier as
  an approved option with its preparation and revert commands (45-DESIGN.md);
  the default for a window remains Branch S (`loaded, scoped`), and X is
  taken only when a root-run preparation task has run for that window.

## Part E: the host in numbers

P8 samples, 10 s apart, 8 CPUs. Load per CPU is the one-minute load
divided by 8.

| Sample | Load avg (1 min) | Load per CPU | System "some" avg10 | Slice "some" avg10 |
| --- | --- | --- | --- | --- |
| 1 | 10.70 | 1.34 | 57.66 | 1.99 |
| 2 | 12.50 | 1.56 | 54.32 | 1.60 |
| 3 | 13.72 | 1.72 | 52.16 | 1.03 |
| 4 | 15.40 | 1.93 | 51.33 | 0.50 |
| 5 | 17.15 | 2.14 | 50.08 | 1.11 |
| 6 | 16.98 | 2.12 | 45.18 | 0.77 |

The host description (load per CPU above 1.3, system stall share 45 to 58)
and the account description (slice stall share 0.50 to 1.99 while idle)
differ by an order of magnitude; a validity gate on the host average
describes the whole host, not the measured tree (finding F-44-01).
