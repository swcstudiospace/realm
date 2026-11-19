# Phase 45: Omp responsiveness, a measurement that can yield a valid verdict - Context

**Gathered:** 2026-11-19, from the owner decision of 2026-11-19 (D-v7-2, HITL), `.planning/MILESTONE-CONTEXT.md` (the "Measurement design" proposal), the v6.0 audit (`.planning/milestones/v6.0-MILESTONE-AUDIT.md`: OMPR-01 carried, OMPR-06 partial, finding F-44-01), the Phase 38 and Phase 44 records under `.planning/milestones/v6.0-phases/` (`38-MEASUREMENT.md`, `44-CONTEXT.md`, `44-MEASUREMENT.md`, `44-03-PLAN.md`), `.planning/REQUIREMENTS.md` (OMPV-01 to OMPV-06), `docs/integration/omp.md`, and a fresh read of the tree at `fae4c27` (v0.6.8 plus the v7.0 start): `src/omp/extension.ts` (166 lines), `src/omp/plugin.ts` (1000 lines, at the module-size ceiling), `src/daemon/launch.ts`, `test/omp/extension.test.ts` (the scripted control socket rig), `test/omp/attach-window.test.ts`, `test/integration/omp-responsiveness.test.ts` (779 lines, four tests), `test/support/responsiveness.ts`, `test/support/responsiveness-decision.ts`, `test/support/paired-ab.ts`, `test/support/omp-rpc.ts`.
**Status:** Planned (four plans, nothing executed). The requirement ids OMPV-01 to OMPV-06 are already in `.planning/REQUIREMENTS.md` and the phase block is in `.planning/ROADMAP.md`; this phase does not edit ROADMAP, STATE or REQUIREMENTS (the orchestrator registers the four plan lines; see "Text for the orchestrator").
**Format and depth:** the v6.0 phases (CONTEXT with evidence tiers and decisions, plans with frontmatter, a threat model per plan, blocking human live windows under the owner's live-window authorization of 2026-11-18).
**Linear:** SPE-34730.

<domain>
## Phase Boundary

Two things went wrong in v6.0 and one thing stayed unproven. The Omp cold-attach responsiveness (OI-11, OMPR-01) never produced a valid verdict, because the harness decided validity from the host one-minute load average (which does not describe what the Omp process saw: finding F-44-01), because the no-extension baseline bound was too tight for a shared host (five of nine baselines missed 500 ms at 0.17 to 0.36 load per CPU), because the control always ran before the cold attach (position and load drift were confounded: the cold attach answered before its own control in all 20 loaded runs of Phase 44), and because the validity of a run was a property of the whole host and not of the measured process tree. The change of Phase 44 (K1 and K2) was therefore never re-proved (OMPR-06: three valid pairs of five, outcome VOID).

This phase builds a measurement that can yield a valid verdict on this host and runs it once:

1. A dated **feasibility record** of the isolation and contention primitives the realm account can actually use (OMPV-01), and a design frozen from it before any verdict run.
2. A **hermetic in-process stall probe** that answers only "does the extension's own attach block the event loop, in CPU time" (OMPV-02). It is red first on a seeded blocking attach and does not move with host load.
3. A **live harness** that scopes every run to its own transient cgroup, decides validity from the contention that scope and the Omp main thread experienced, attributes each unanswered-probe interval to on-CPU time, run-queue delay or sleep, alternates the order of control and cold attach, recalibrates the baseline validity bound from a recorded calibration, and holds the decision rule as code with a hermetic test (OMPV-03, OMPV-04).
4. **One live window** under the frozen design that ends in exactly one of PASS, FINDING, NOT-REPRODUCED or VOID, and the resolution of OMPR-01, OMPR-06 and OI-11 from that outcome (OMPV-05, OMPV-06).

### Out of scope, stated so no task drifts into it

- Editing a verdict threshold (1000 ms maximum, 500 ms 95th percentile, 40 probes, 10 s window, 250 ms probe interval, 10 s answer timeout) or any constant or table of the Phase 38 rule (`test/support/responsiveness-decision.ts`: `MIN_VALID_RUNS`, `MAX_ATTEMPTS`, `BOOT_EXCESS_MAX_MS`, `CONTROL_MIN_WINDOW_MS`, `CONTROL_MAX_WINDOW_MS`, the case table, the window table) or `QUIET_LOAD_PER_CPU`. They stay pinned by their existing tests and stay valid for a future quiet-host window.
- Changing `responsivenessProblems` or its output strings.
- Lowering or raising the process priority or the CPU weight of the daemon or of Omp, a worker thread or second process for the attach, a dynamic `import()` of the CLI at spawn time (all rejected in Phase 38 D-38-05; unchanged), and any attempt to make the measured system faster by tuning the scope (the scope is a measurement boundary, never a performance lever).
- Anything that runs before a session is ready: fail closed is kept (no mutation or tool call reaches the daemon before a client is adopted).
- A model-driven tool call, FS-02, TD-06, TD-10, the product spec, `CHANGELOG.md`, version fields, `release/milestone.json`, Phases 46 to 48.
- The status of UI-01: it stays the owner's call (Phase 27 D-27-08); this phase supplies evidence only.
- Host changes that need root and affect other users of the shared host (a CPU reservation, cpuset delegation): not done here; only listed as an owner decision (OD-45-1).
</domain>

<decisions>
## Implementation Decisions

### Evidence (each fact: source, read date, tier)

Tiers: **Observed** = read in this worktree or on this host on 2026-11-19; **Measured** = recorded by an earlier live window and cited from its record; **Derived** = arithmetic on Measured numbers; **[INFERENCE]** = reasoning from those, to be proven or refuted by a named task. The host reads marked "planning account" were taken by the planner as the root account switching to the realm account with `runuser`, outside a login session of that account, read-only; they are leads, not the OMPV-01 record, which plan 45-01 produces as the realm account in its own session.

| ID | Fact | Source | Tier |
| --- | --- | --- | --- |
| E-45-01 | The host has 8 CPUs, kernel 6.8.0-149-generic, systemd 255, Node v24.18.0. At planning time the one-minute load was 29.07 then 31.00 on 8 CPUs, and the system CPU pressure "some" line read avg10 68.29, avg60 63.96, avg300 50.77 (a second read: avg10 68.94, avg60 64.93, avg300 51.69). | `/proc/loadavg`, `/proc/pressure/cpu`, planning account | Observed |
| E-45-02 | cgroup v2 is the unified hierarchy (`cgroup2fs`); the root controllers are cpuset, cpu, io, memory, hugetlb, pids, rdma, misc. The kernel has `CONFIG_PSI=y` (PSI enabled by default), `CONFIG_SCHED_INFO=y` and `CONFIG_SCHEDSTATS=y`; `kernel.sched_schedstats` reads 0, and `/proc/self/schedstat` of a fresh shell still shows non-zero on-CPU and run-queue fields (75058095, 5481493, 5), so the run-delay field is readable with the sysctl off. | `/sys/fs/cgroup`, `/boot/config-*`, `/proc/sys/kernel/sched_schedstats`, `/proc/self/schedstat`, planning account | Observed |
| E-45-03 | The realm account's user manager unit has `Delegate=yes` with `DelegateControllers=cpu memory pids`: the controller set `cpuset` is NOT delegated, so a transient unit of that account cannot set `AllowedCPUs` and cannot own a cpuset partition. The subtree directory is owned by the realm account and its `cgroup.procs` is writable by it; its `cgroup.controllers` and `cgroup.subtree_control` both read `cpu memory pids`; the subtree holds `app.slice`, `session.slice`, `init.scope`. | `systemctl show user@UID.service`, `/sys/fs/cgroup/user.slice/user-UID.slice/user@UID.service`, planning account | Observed |
| E-45-04 | The realm account's user bus socket exists in its runtime directory; with `XDG_RUNTIME_DIR` set to that directory, `systemctl --user is-system-running` read `running`; without it the call failed with "Failed to connect to bus: Permission denied". `systemd-run`, `taskset`, `chrt` and `perf` are installed; the account's CPU affinity is 0-7. | planning account | Observed |
| E-45-05 | At that moment the realm account's own slice read CPU pressure "some" avg10 0.58 (it was idle), while the shared `user.slice` read avg10 66.49. A per-cgroup pressure file therefore reports the stall of the tasks of that cgroup only: it says nothing while the account is idle and everything about the measured tree while a run is in progress. [INFERENCE] A transient scope per run makes the file describe exactly the Omp tree. | `cpu.pressure` of the two slices, planning account | Observed |
| E-45-06 | The Phase 44 window (2026-11-19): ten pair attempts, three valid (pairs 3, 7, 8), seven invalid (six on the start-load ceiling of 2.0 per CPU, one on the 0.5 gap); the CPU pressure "some" avg10 at run starts read 48.08 to 66.58; X was negative in all 20 runs (the cold run answered 881 to 38 296 ms before its own control); the control ran first in every run; the control ready time spread from 9103 to 44 407 ms; outcome VOID. | `44-MEASUREMENT.md` | Measured (loaded, paired) |
| E-45-07 | Phase 44 [INFERENCE] recorded that the one-minute load per CPU at the settle step differed from the one at the first reading inside the test (for example 20.22 on 8 CPUs against a settle at or below 2.0 per CPU): a load gate on the host average is read minutes before the window it gates and describes the whole host. | `44-MEASUREMENT.md` | Measured |
| E-45-08 | The Phase 38 window (2026-11-18/19): six attempts, one valid; the in-test no-extension baseline missed its bounds in five of nine runs at 0.17 to 0.36 load per CPU (95th percentile 1001, 512, 599, 791, 1312 ms); controls with no extension answered nothing for 9.4 to 15.4 s from process start. | `38-MEASUREMENT.md`, `44-CONTEXT.md` E-44-08, E-44-09 | Measured |
| E-45-09 | The extension starts its attach one event-loop turn after `session_start` through `deferStart` (`setImmediate`), launches the daemon through `src/daemon/launch.ts`, and attaches through `createDaemonAttach` with `connectDaemon`. `createRealmPlugin` takes `attachDaemon` and `deferStart` as options. The module `src/omp/plugin.ts` is exactly 1000 lines; the ceiling allowlist (`scripts/check/module-size-allowlist.json`) lists only `src/lifecycle/controller.ts`, so a file over 1000 lines fails the gate. | `src/omp/extension.ts`, `src/omp/plugin.ts`, `scripts/check/module-size-allowlist.json` | Observed |
| E-45-10 | `test/omp/extension.test.ts` already drives the real `realmExtension` entry against a stand-in daemon: a `net` server on a control socket path inside a temporary state directory, answering NDJSON `status`, `up` and `host-boot` requests (the rig is local to that file: `startStub`, `answeredFor`, `createHost`, `startOmpSession`, `setProcessEnv`). `test/omp/attach-window.test.ts` drives the plugin with a manual deferral. | those two files | Observed |
| E-45-11 | `startOmp` (`test/support/omp-rpc.ts`) accepts an optional `wrap` argv prefix (the network trace uses it) and leads its own process group; `OmpSession` exposes `frameArrivalsMs`, `ready`, `status`, `close` and no process id. The live responsiveness test has four tests (baseline, control, cold attach, paired arm), a probe loop that sends `get_state` every 250 ms with a 10 s answer timeout, a pressure reader for `/proc/pressure/cpu`, and a recorder. | `test/support/omp-rpc.ts`, `test/integration/omp-responsiveness.test.ts` | Observed |
| E-45-12 | The only product commit between the Phase 44 BEFORE and AFTER trees is `1c7fac8` (PR 211, K1 and K2); no `src` file changed after it (`git log 1ffeb80..HEAD -- src` lists only it). A read-only `git merge-tree` of a revert of `1c7fac8` on the current head conflicts only in a planning summary rename and in `docs/integration/omp.md`, never in a `src`, `scripts` or `test` file. [INFERENCE] The BEFORE tree of OMPR-06 can be built in a scratch checkout as the current head with the product and test paths of `1c7fac8` reversed, and the harness files stay byte-equal between the two trees. | `git log`, `git merge-tree`, 2026-11-19 | Observed |
| E-45-13 | A cgroup v2 `cpu.pressure` file has `some` and `full` lines, each with avg10, avg60, avg300 and a cumulative `total` in microseconds; `total` is monotonic, so a stall share over a window is the difference of two readings over the elapsed time. `/proc/PID/task/TID/schedstat` carries three fields for one thread: nanoseconds on CPU, nanoseconds waiting on a run queue, and the number of time slices. [INFERENCE] The thread that serves `get_state` in Omp is the main thread (thread id equal to the process id); this is verified by the calibration records (D-45-08), not assumed. | kernel documentation of the two files, cited in the plan 45-01 record | Derived from documentation, to be shown live |

### D-45-01. Terms and labels (all documents use these words)

- **Run**: one arm run of the window: a no-extension control run and a cold-attach run of one build, both inside one test invocation.
- **Arm**: BEFORE (the current head with the product code of PR 211 reversed) or AFTER (the current head). The AFTER arm carries the verdict; both arms carry the OMPR-06 comparison.
- **Pair**: one BEFORE run and one AFTER run, back to back; the order of the two arms alternates by pair number (odd pairs BEFORE first), as in Phase 44.
- **Scope**: the transient systemd user scope (its own cgroup) in which Omp and everything Omp starts run, one per Omp process.
- **Tier labels.** Every number carries one measurement tier and one isolation tier. Measurement tier: `measured` (read from a live run) or `derived` (arithmetic on measured numbers). Isolation tier: `loaded, scoped` (a per-run scope, no CPU reservation: the default result of this design), `loaded, unscoped` (the fallback when no scope could be made: scoped pressure absent, run-queue share only) or `isolated` (exclusive CPUs; only possible with the root-assisted step of OD-45-1, which is not taken by default). The fixed label of the Phase 44 rule `loaded, paired` is kept in the paired outcome object and `quietClaim` stays false. No number is ever called a quiet-host measurement.

### D-45-02. The feasibility record comes first and the design is frozen from it (OMPV-01; plan 45-01)

The record is `45-FEASIBILITY.md`, dated, written from commands the realm account ran in its own session (not from planning leads). Primitives, each with the command or read that showed it and its result (usable, usable with limits, not usable, with the exact error text for a refusal): P1 cgroup v2 and the controller list; P2 the delegated subtree of the user manager (the `Delegate` and `DelegateControllers` properties, ownership, writability); P3 a transient scope from a scrubbed environment (`systemd-run --user --scope`), the cgroup path of a process in it, that a detached child started inside it stays in it; P4 `AllowedCPUs` and `cpuset` on that scope (expected: not delegated; record what happens); P5 per-cgroup `cpu.pressure` of the scope, including that its `total` moves when a CPU burner in the scope competes on this loaded host, and stays near zero for a sleeping process; P6 `/proc/PID/task/TID/schedstat` readable for a same-uid process, with the run-queue field moving under a burner; P7 `taskset` (own affinity, pinning a child); P8 the system CPU pressure file and the load average, sampled together, to show how far apart the two descriptions are; P9 kernel facts (`CONFIG_PSI`, `CONFIG_SCHEDSTATS`, `kernel.sched_schedstats`); P10 `CPUWeight` on a scope (recorded as available or not, never used by the design); P11 the root-assisted options (cpuset delegation, `AllowedCPUs` on other slices), recorded as listed and not run.

The design is frozen in `45-DESIGN.md` by plan 45-01 Task 4: it copies D-45-03 to D-45-10 below, states for each primitive whether the record supports the decision, and records an amendment (with the reason, from a record line) wherever the record contradicts a decision here. Plan 45-03 Task 1 refuses to start unless `45-DESIGN.md` says `Status: frozen` with a date. The branch table of the design: **Branch S** (a scope is obtainable and its pressure file is readable and moves: the default, expected from E-45-03 and E-45-04); **Branch N** (no scope: runs are labelled `loaded, unscoped`, validity uses the run-queue share of the main thread only, the scoped-pressure condition V3a is dropped and the record says so); **Branch X** (the owner took the root-assisted step: runs are labelled `isolated`; the design adds the cpuset facts; not taken by default). Which branch applies is read from the record, never chosen after a verdict.

### D-45-03. The isolation envelope (OMPV-01, OMPV-03)

Every Omp process of the window (the control, the cold attach and the calibration controls) is started through the `wrap` option of `startOmp` with `systemd-run --user --scope --quiet --collect` and the double dash, so Omp, the daemon the extension starts detached, and anything either starts run in one fresh cgroup with the default CPU weight. The scope is identical for the control and the cold attach and for both arms. Nothing in the scope is tuned (no weight, no quota, no pinning by default); `taskset` pinning is not used unless the record shows it lowers variance and the owner approves (not by default). The environment is the scrubbed environment of Phase 44 with `XDG_RUNTIME_DIR` (already passed) and nothing else new. If `systemd-run` fails, the run is a refusal (D-45-06 rule V0), recorded with the command's error text and counted as nothing; it never falls back silently to an unscoped run inside a Branch S window.

### D-45-04. The hermetic in-process stall probe (OMPV-02; plan 45-02)

What it answers: does the extension's own synchronous work in the attach path block the event loop, measured in CPU time per synchronous slice. What it cannot answer: whether a real Omp answers `get_state` within the thresholds during a cold attach (so it cannot close OMPR-01 or OI-11 alone).

Design. `test/omp/attach-stall.test.ts` loads the real extension entry `realmExtension` against a scripted control socket (a new support module, `test/support/scripted-control-socket.ts`, with per-method scripted reply latencies; no Omp, no Podman, no real daemon: the socket exists from the start so the extension never spawns one). A slice recorder (`test/support/stall-probe.ts`) runs a `setImmediate` loop in the same process; a **slice** is the span between two consecutive turns of that loop, and its CPU is the difference of `process.cpuUsage()` (user plus system) over that span (the recorder's own cost is a few microseconds and is not subtracted). The measurement window opens just before the `session_start` handler is called and closes when the realm status paint reads active and a settle turn has passed. Recorded and asserted: the largest slice CPU in the window (`STALL_SLICE_CPU_MAX_MS`) and the CPU of the handler's own synchronous run. Recorded, labelled secondary, load-sensitive and not asserted: the wall time of every slice and the `perf_hooks` `monitorEventLoopDelay` histogram.

Scripted `up` latencies: a series (zero, 100 ms, 600 ms, 2000 ms and one catalogue refusal) so the attach exercises the poll, the status check and the `up` call under several waits; the waits are asynchronous (timers in the socket stand-in), so they add wall time and no CPU.

Red first. The seeded blocking attach is a one-shot synchronous burn (a fixed CPU burn of 400 ms) injected into the real attach path through the first synchronous call the attach makes at its start (`Date.now`, which `attachDaemon` of the extension calls before it begins to connect), by a test-local patch armed for exactly one call and restored in `t.after`. The probe must report it as blocking (a slice of at least 90 percent of the seeded burn inside the window); on the current extension it must report no slice above `STALL_SLICE_CPU_MAX_MS`. The task writes the seeded case first against a recorder that cannot yet see slices (the case fails: red), then the recorder (green), and records the red output in the summary. The bound `STALL_SLICE_CPU_MAX_MS` is set from the observed maximum slice of the current extension over 20 runs (recorded in the summary) with a stated margin and is at most 100 ms; if the observed maximum of the current extension is above 50 ms the executor stops and reports a finding (the extension blocks), it does not raise the bound.

Load invariance. A second pass runs the same two cases while CPU burners run beside the test (worker threads, one per available CPU, bounded duration, terminated in `t.after`); the verdicts must equal the quiet pass (current extension: not blocking; seeded: blocking). Equal verdicts, not equal numbers: CPU time moves a little with cache and SMT contention, the margin between the seeded 400 ms and the bound absorbs it, and the test asserts the verdicts and the ordering (the seeded slice exceeds the bound by at least a factor of 2.5).

Names avoid the substrings `mcp` and `acp` (the taxonomy test). The probe stays a unit-tier test in `test/omp/` (it runs in `npm test`, it needs no gate variable).

### D-45-05. Contention reading and the attribution of every stall (OMPV-03; plan 45-03)

Readings, taken by the harness in its own process at every probe send and at every answer arrival: the cumulative `total` of the scope's `cpu.pressure` "some" line (microseconds) and the three fields of `/proc/PID/task/PID/schedstat` for the Omp main thread (thread id equal to the pid; a verification of that identity is part of the calibration, D-45-08), plus the sum of the run-queue field over all threads of the process at the window ends. Each reading carries the harness monotonic time.

For a window probe with raw latency L (an unanswered probe counts as the answer timeout of 10 000 ms) over the interval from its send to its answer (or timeout), the harness computes from the readings nearest inside the interval: on-CPU ms, run-queue ms, and sleep ms equal to the interval minus the first two (never below zero; a residual of at most 5 ms is rounding). The **self-inflicted latency** of the probe is L minus its run-queue ms, never below zero. When no two readings bracket the interval the probe is **unattributed** (its self-inflicted latency is its raw latency: the conservative reading) and lowers the coverage figure.

The verdict reads the **self-inflicted summary**: `summariseLatencies` over the window probes with each latency replaced by its self-inflicted latency, with the thresholds of `responsivenessProblems` unchanged (maximum 1000 ms, 95th percentile 500 ms, unanswered counted by the existing function over the raw samples). The raw summary (the current number) is recorded beside it as a labelled secondary measure. The window is the Phase 44 window: probes sent at or after the ready frame; boot probes are kept and summarized apart.

Stall causes of a run, used by the verdict table: the **stall set** is the window probes whose self-inflicted latency exceeds 500 ms; the cause of a stall set is on-CPU when the on-CPU share of the set's summed intervals is at least `CAUSE_SHARE_MIN` (0.5), sleep when the sleep share is, and mixed otherwise.

### D-45-06. Run validity (OMPV-03, OMPV-04; plan 45-03)

A run is valid, and counts, only when every rule holds; the first failed rule is the recorded reason, and an invalid run is recorded and counted as nothing (never reported as a result):

- **V0, refusal:** the scope was obtained (Branch S) or the run is declared unscoped by the frozen branch (Branch N); `systemd-run` failure, an unreadable pressure file under Branch S, or an unreadable schedstat file is a refusal with its reason.
- **V1, mechanics:** the mechanics of the Phase 44 arm test held (no daemon at the start, the control answered, `realm active` reached, the session answered a command, the record complete).
- **V2, probe driver health:** no gap between consecutive probe sends in the window exceeds `PROBE_DRIVER_GAP_MAX_MS` (750 ms, three probe intervals): the harness itself was not starved.
- **V3, scoped contention, for the cold window and for the control serving window:** (a) the scope's "some" stall share over the window (the difference of the `total` readings over the elapsed microseconds) is at most `STALL_SHARE_MAX`; (b) the main thread's run-queue share over the window is at most `RUNQ_SHARE_MAX`. Under Branch N only (b) applies.
- **V4, baseline validity:** the control's self-inflicted serving summary (the 10 s after its ready frame) has a maximum at most `CONTROL_SELF_MAX_BOUND_MS` and a 95th percentile at most `CONTROL_SELF_P95_BOUND_MS`.
- **V5, attribution coverage:** at least `ATTRIBUTION_COVERAGE_MIN` (0.9) of the window probes are attributed.

`STALL_SHARE_MAX`, `RUNQ_SHARE_MAX`, `CONTROL_SELF_MAX_BOUND_MS` and `CONTROL_SELF_P95_BOUND_MS` are the four **calibrated constants** (D-45-08). Until they are frozen they are unset in code, and the decision functions refuse a verdict while any is unset (outcome VOID, reason `uncalibrated`): the freeze is a code state, not a promise.

### D-45-07. Order inside the pair (OMPV-04; plan 45-03)

The run index of an arm run is `2 * (pair - 1) + (first arm of the pair ? 1 : 2)`, where the first arm of pair N is BEFORE when N is odd and AFTER when N is even. The control runs first inside a run when its run index is odd, the cold attach first when it is even. Over four consecutive runs each arm sees control-first and cold-first once. `runIndexOf(pair, arm)` and `controlFirst(runIndex)` are pure and pinned by a hermetic test. The no-daemon check, the residue rule and the cleanup are the same for both orders; a cold-first run leaves its daemon stopped (`realm down`) before the control starts.

### D-45-08. Calibration of the baseline validity bound and of the contention bounds (OMPV-04; plan 45-04)

Procedure. After plan 45-03 is merged, a person runs the **calibration**: up to `CALIBRATION_MAX_ATTEMPTS` (16) controls (Omp with no extension, scoped, scrubbed environment, the same probe loop and window as the live control, recorded by the new calibration test, which needs no production stack) until `CALIBRATION_TARGET_RUNS` (12) controls are mechanically complete, spread over the same kind of hour the verdict window will use. Each record carries the self-inflicted serving summary (maximum and 95th percentile over the 10 s after ready), the scope stall share, the main-thread run-queue share, the per-thread on-CPU split (to verify that the thread whose id equals the pid carries the largest on-CPU share), the pressure and load readings, and the fixed labels.

Derivation, as pure code (`deriveBounds`, tested hermetically before any calibration run exists):

1. A calibration control **meets the thresholds** when its self-inflicted serving summary passes `responsivenessProblems` unchanged.
2. If fewer than `CALIBRATION_MIN_PASSING` (5) controls meet the thresholds, the bounds are **underivable**: the host cannot show a no-extension Omp meeting the thresholds under the scope, the verdict window is not run, and the phase outcome is VOID (calibration) with the owner's options of D-45-12.
3. `CONTROL_SELF_MAX_BOUND_MS` is the larger of 1000 and the nearest-rank 90th percentile of the self-inflicted serving maxima of all mechanically complete calibration controls, rounded up to a multiple of `BOUND_ROUND_MS` (50); `CONTROL_SELF_P95_BOUND_MS` likewise with 500 and the 95th percentiles. Each is capped at `CONTROL_BOUND_CAP_FACTOR` (3) times its threshold; a bound that would exceed the cap makes the bounds underivable (as in 2).
4. `STALL_SHARE_MAX` and `RUNQ_SHARE_MAX` are the nearest-rank 75th percentile of the stall share and of the run-queue share among the controls that met the thresholds: a window is valid when its contention is no higher than that under which a no-extension Omp has been shown to meet the thresholds on this host.
5. Freeze: the four values, the calibration summary digest and the date are written into a code module (`test/support/omp-calibration.ts`) with a hermetic test that pins them and the derivation of them from the recorded calibration records; the change is committed and merged before the first verdict run; no later edit is allowed, a wrong bound is a finding and a replan.

The identity of the main thread is a freeze precondition: if the thread whose id equals the pid does not carry the largest on-CPU share in at least 10 of 12 calibration controls, the freeze task stops and the design is amended (attribution thread) by a recorded decision before any bound is frozen.

### D-45-09. The verdict table of the live window (OMPV-05; plan 45-03 as code, plan 45-04 applies it)

Verdict runs are the **valid AFTER-arm runs** (the current build). With N the number of them and the self-inflicted summary of each run's cold window checked by `responsivenessProblems` with the thresholds unchanged, the first row that holds decides:

| Outcome | Condition | Consequence |
| --- | --- | --- |
| `VOID` | the bounds are unset or underivable (D-45-08), or N is below `MIN_VERDICT_RUNS` (5) | no verdict; OMPR-01, OMPR-06 and OI-11 stay carried; the owner's options are written (D-45-12) |
| `FINDING` | at least one valid run has a non-empty self-inflicted verdict | the thresholds are exceeded on a valid run; the finding names a cause by the cause table below; the runs and their stall sets are listed |
| `NOT-REPRODUCED` | no valid run breaches on its self-inflicted summary and at least one valid run breaches on its raw summary | the original symptom (raw thresholds exceeded) appeared, and on every valid run the excess was run-queue delay, not the process's own on-CPU or sleep time |
| `PASS` | no valid run breaches on the self-inflicted summary or the raw summary | the thresholds held in N valid runs under the recorded scope |

**Cause table of a FINDING** (per breaching run, then the window): `omp-own` when the same run's control self-inflicted serving summary also fails the thresholds under the same bounds (Omp without the extension stalls the same way); otherwise `extension-on-cpu` when the run's stall set is on-CPU, `extension-wait` when it is sleep, `unattributed` when it is mixed or the stall set is unattributed. The window cause is the cause shared by more than half of the breaching runs, else `mixed`, with every run's cause listed. `extension-on-cpu` and `extension-wait` read: the cold run with the extension breached while the no-extension control of the same run did not; the table names where the time went and does not name a code line.

What each outcome can claim: PASS says the thresholds held in the valid runs of this window on this host under the recorded scope and tier; it does not say they hold on a quiet host or in general. FINDING says they were exceeded with the stated cause. NOT-REPRODUCED says the raw exceedance was contention. VOID says nothing about the product.

### D-45-10. The OMPR-06 comparison keeps its metrics and its table and changes its validity predicate (OMPV-06; plan 45-03)

`test/support/paired-ab.ts` keeps the metrics X, X1, X2 and S and the outcome table of Phase 44 D-44-07 (`VOID`, `NOT-REPRODUCED`, `REGRESSION`, `EFFECT`, `NO-EFFECT`), `PAIRED_LABEL` and `quietClaim`; its pair validity predicate stops reading the one-minute load average (the finding F-44-01 is exactly that) and reads the run validity of D-45-06 for both arms of the pair. Clean cutover: `PAIR_LOAD_CEILING_PER_CPU`, `PAIR_LOAD_GAP_PER_CPU` and the load fields of `ArmRun` are removed and the tests that pinned them are migrated in the same change, with the reason recorded; `MAX_PAIR_ATTEMPTS` becomes 12 (the predicate changed, the window may need more attempts), `MIN_VALID_PAIRS` stays 5. The window outcome vocabulary for OMPR-06 is the Phase 44 one and is reported next to, not instead of, the PASS, FINDING, NOT-REPRODUCED or VOID of D-45-09.

### D-45-11. The window procedure (OMPV-05; plan 45-04)

- **Trees.** AFTER is the head of the branch that ships plan 45-03 and the freeze; BEFORE is a scratch checkout of the same commit with the product and test paths of `1c7fac8` reversed (E-45-12); the harness files are byte-equal between the two trees (the same hash check as plan 44-03: the four harness hashes equal, the extension hash different, `src/daemon/launch.js` present in AFTER only).
- **Account and stack.** The realm account, its rootless Podman 5.7.1 production stack, the shared live lock held for the whole window, a scrubbed environment (`env -i` with exactly the named variables), evidence outside the repository (directory mode 0700, files 0600), residue snapshots before, after every run and at the end, the secret search before anything is cited, the Phase 18 stop rule. The calibration part needs no production stack and no lock but runs as the realm account in the same way.
- **Stop rule.** The window stops at the fifth valid pair or the twelfth pair attempt, whichever comes first. No valid pair or run is discarded or repeated to change the outcome. The person may end the wait at any step; the window then ends with the pairs so far (outcome VOID if N is below 5).
- **Cost.** A run is about five minutes with its settle, so a pair is about ten and twelve attempts about two hours; the calibration is about one hour. The window is serialized with the live windows of Phases 46 to 48 by the shared lock and by the order the owner sets.
- **Settle.** The settle step no longer gates on the host load average. It only waits for the previous run's `realm down`, a clean snapshot and 120 s; validity is decided inside the run by D-45-06.

### D-45-12. Resolution of OMPR-01, OMPR-06 and OI-11 (OMPV-06; plan 45-04)

| Outcome | OMPR-01 and OI-11 | OMPR-06 | UI-01 |
| --- | --- | --- | --- |
| PASS | close with the window as evidence, labelled as D-45-09 says | closes with its own outcome word (EFFECT, NO-EFFECT or REGRESSION) when N valid pairs reached 5; stays carried on VOID or NOT-REPRODUCED of the pair rule, with that reason | evidence cell extended; status stays the owner's call |
| FINDING | close with the finding and its cause (a finding is an answer); the extension-named causes open the fix task | as above | as above |
| NOT-REPRODUCED | close with the window as evidence and the sentence that the raw exceedance was contention | as above | as above |
| VOID | stay carried; the phase writes the owner's options: (a) retire OMPR-01 and OI-11 with a recorded reason (the host cannot yield a valid measurement; the hermetic probe and the attribution remain as the permanent instruments), (b) repeat under the same frozen rule at a different time, (c) repeat after the owner approves the root-assisted isolation of OD-45-1, (d) ask other users to pause heavy work for the window | stays carried | as above |

No row closes on VOID or on the hermetic probe alone. If the finding names the extension (`extension-on-cpu` or `extension-wait`), plan 45-04 Task 8 runs: the fix keeps fail closed (no mutation before the session is ready, the existing attach-window and Omp suites unedited and passing), is shown red first by an OMPV-02 probe case that reproduces the named slice hermetically (if no hermetic case can reproduce the stall, the task records that and claims no fix), and any growth beyond the `src/omp/plugin.ts` ceiling goes to a new module.

### D-45-13. Hygiene constraints for every plan

- Gates: `npm run check:gates` (the exec gate closure, the module-size ratchet, the export-usage gate: a test-only export of a new `src` module needs an allowlist entry; this phase adds no `src` export unless Task 8 of plan 45-04 runs), `src/omp/plugin.ts` stays at or under 1000 lines.
- Lint: no unnecessary conditions after assert narrowing, `restrict-template-expressions` (numbers through `String(...)`), `no-base-to-string`, `prefer-const`, `void test(...)` for tests, no suppression comments, no silent catch.
- New tests use a temporary directory and in-process stand-ins only, no gate variable except the live tests, no file basename containing `mcp` or `acp`; a test that needs a clock uses an injected one; every async wait has a timeout.
- Tests pass as a regular non-root user. The CPU burner of plan 45-02 stops in `t.after` and is bounded.
- The error catalogue stays at 29 codes; this phase adds none.
- Markdown: no host-local absolute path (`node scripts/check/host-paths.mjs`), raw angle tokens outside code fences escaped, plan task blocks hold no angle brackets, frontmatter list entries that contain a colon and a space are quoted; `npm run check:docs` passes. `AGENTS.md` and its layout lines are updated in the same pull request as a new support module (the CLAUDE.md sync check applies).
- Docs are updated in the same pull request as the code. No `CHANGELOG.md`, no version field.
- Every number written into the repository is copied from the person's evidence files with the tier label; nothing is inferred, rounded or filled in.
- Commit conventions: the harness and probe are `test` commits; a product fix (Task 8) is `fix(omp)`; none is breaking.

### D-45-14. Threat model (summary; each plan carries its STRIDE rows)

| ID | Category | Threat | Mitigation |
| --- | --- | --- | --- |
| T-45-01 | Repudiation | A VOID or an invalid window is relabelled, or a loaded or scoped number is cited as a quiet-host measurement, or a row is closed on VOID or on the hermetic probe alone | D-45-09 and D-45-12; fixed labels in records and docs; `quietClaim` pinned false; the resolution file states the closure only from the table |
| T-45-02 | Tampering | A calibrated constant, a threshold, a validity rule or a row is bent after a verdict is seen | the decision functions refuse a verdict while a calibrated constant is unset; the freeze module and its hermetic test merge before the first verdict run; the person reads the rule to the owner; a mismatch stops the task |
| T-45-03 | Tampering | The scope or a harness change makes the arms differ in more than the change | identical scope for both arms and both parts; the four harness hashes equal and the extension hash different; two separate copies; alternating order |
| T-45-04 | Tampering | The probe or the harness hides a real stall (a stall classed as contention) | thresholds untouched; the raw summary is still written and still decides NOT-REPRODUCED versus PASS; the contention bounds are validity conditions calibrated from controls that met the thresholds; unattributed probes count at their raw latency |
| T-45-05 | Denial of service | A calibration or a window leaves a daemon, container, scope, socket or workspace entry on the shared host, or runs while another live run holds the stack | the shared lock; before, per-run and final snapshots including transient scopes of the account; any count change stops the window; the harness cleanup; scopes are created with collect so they vanish when empty |
| T-45-06 | Information disclosure | Records or docs hold a token, a host path, an environment value or a secret | records hold numbers, booleans and closed phrases; the secret search; the host-paths check |
| T-45-07 | Elevation of privilege | A root step or a wider environment than needed | the realm account for everything but copies; no root-assisted isolation unless the owner decides OD-45-1; scope properties limited to the defaults |
| T-45-08 | Tampering | The fix of Task 8 weakens fail closed | attach-window and Omp suites unedited and passing; no mutation before the session is ready; the red-first probe case |

## Owner decisions needed (none blocks planning or plan 45-01; defaults are taken)

- **OD-45-1, root-assisted isolation.** The realm account cannot reserve CPUs: `cpuset` is not delegated to its user manager (E-45-03) and other accounts keep the shared host at a load of about 30 on 8 CPUs (E-45-01). An `isolated` tier would need a root step (delegate `cpuset` to the account, and exclude a few CPUs from the other slices with runtime `AllowedCPUs`, reverted after the window), which affects every other user of the host. Default: not taken; the design runs as `loaded, scoped` and VOID is a legal outcome. Needed only if the owner prefers the isolated attempt (it adds Branch X and a root-run preparation task, to be planned then).
- **OD-45-2, the constants this plan freezes.** `MIN_VERDICT_RUNS` 5, `MIN_VALID_PAIRS` 5, `MAX_PAIR_ATTEMPTS` 12, `CALIBRATION_TARGET_RUNS` 12, `CALIBRATION_MAX_ATTEMPTS` 16, `CALIBRATION_MIN_PASSING` 5, the bound quantiles (0.9 and 0.75), `BOUND_ROUND_MS` 50, `CONTROL_BOUND_CAP_FACTOR` 3, `ATTRIBUTION_COVERAGE_MIN` 0.9, `PROBE_DRIVER_GAP_MAX_MS` 750, `CAUSE_SHARE_MIN` 0.5, `STALL_SLICE_CPU_MAX_MS` at most 100. They are the planner's choices (the owner asked that the design be the planner's to freeze); the owner may amend any of them before plan 45-01 Task 4 freezes the design; after that they change only by a recorded decision and never after a verdict. Default: accept.
- **OD-45-3, a quieter window.** A quieter host is the cheapest isolation. The owner may ask other users and agents of the host to pause heavy work during the window. Default: no request; validity is scoped contention only.
- **OD-45-4, the BEFORE tree.** OMPR-06 needs a BEFORE build; the planner builds it by reversing the product paths of PR 211 in a scratch checkout of the shipped head (E-45-12). Default: build it. The alternative is to drop OMPR-06 from this window and leave it carried.
- **OD-45-5 (after the window, only on VOID).** Which of the options of D-45-12 the owner takes. The phase writes the options and does not choose.

## Canonical References

- `.planning/MILESTONE-CONTEXT.md` (D-v7-2, "Measurement design", constraints, limits); `.planning/REQUIREMENTS.md` (OMPV-01 to OMPV-06); `.planning/ROADMAP.md` (the Phase 45 block); `.planning/PROJECT.md`
- `.planning/milestones/v6.0-MILESTONE-AUDIT.md` (OMPR-01 carried, OMPR-06 partial, F-44-01, the v7.0 candidates)
- `.planning/milestones/v6.0-phases/38-omp-responsiveness-during-cold-attach/` (`38-CONTEXT.md`, `38-MEASUREMENT.md`, `38-VERIFICATION.md`)
- `.planning/milestones/v6.0-phases/44-omp-non-blocking-cold-attach/` (`44-CONTEXT.md` D-44-01 to D-44-11, `44-MEASUREMENT.md`, `44-03-PLAN.md` for the live window shape, `44-01-PLAN.md` for the plan format)
- `.planning/milestones/v5.0-phases/36-live-re-verification-of-v1-0-open-items/36-DISPOSITIONS.md` (OI-11, Part C), `.planning/milestones/v5.0-phases/35-capability-token-evidence/35-01-PLAN.md` (the copy, the scrubbed environment)
- `docs/integration/omp.md` (UI-01 row and detail), `docs/integration/runtime-decision.md`
- `src/omp/extension.ts`, `src/omp/plugin.ts`, `src/daemon/launch.ts`, `src/host/attach.ts`
- `test/omp/extension.test.ts`, `test/omp/attach-window.test.ts`, `test/omp/extension-load.test.ts`, `test/integration/omp-responsiveness.test.ts`, `test/support/responsiveness.ts`, `test/support/responsiveness-decision.ts`, `test/support/paired-ab.ts`, `test/support/omp-rpc.ts`, `test/support/omp-live.ts`, `test/support/timing.ts`
- `eslint.config.js`, `scripts/check/gate-closure.mjs`, `scripts/check/module-size.mjs`, `scripts/check/export-usage-gate.mjs`, `scripts/check/host-paths.mjs`
- Kernel documentation of PSI (`Documentation/accounting/psi.rst`), cgroup v2 (`Documentation/admin-guide/cgroup-v2.rst`) and per-task scheduler statistics (`Documentation/scheduler/sched-stats.rst`); `systemd.resource-control(5)` and `systemd-run(1)`. Plan 45-01 records the read date and the exact statements used.

## Existing Code Insights

- The probe loop, the ready-window split, the control-relative secondary measure, the pressure parser and the paired rule exist (Phase 44). Phase 45 adds the contention and attribution layer beside them and replaces one predicate; it does not rebuild them.
- `startOmp` already takes `wrap`; the scope is one argv prefix. `killGroup` signals the process group; `systemd-run --scope` runs the command in the scope in place, so the group and the pid stay the child's own.
- The daemon the extension starts is detached, but a cgroup is inherited across `setsid` and `detached`, so it stays in the scope; the gateway, the compute driver and the sandbox container are other units and other cgroups and are not in the scope (they are the production stack, not the measured tree).
- The extension test rig already shows how to drive `realmExtension` against a stand-in on a control socket; the stall probe needs a variant with scripted latencies and no host-boot recorder.
- `src/omp/plugin.ts` is at its ceiling: any fix grows a new module.

## Wave Structure

| Wave | Plan | What | Depends on |
| --- | --- | --- | --- |
| 1 | 45-01 | The feasibility record as the realm account (human), the record, the frozen design. | none |
| 1 | 45-02 | The hermetic in-process stall probe (autonomous; independent of the record). | none |
| 2 | 45-03 | The harness code: contention reading, attribution, validity, order, calibration derivation, verdict table, paired-validity cutover, the scoped arm and calibration tests. Autonomous. | 45-01 (frozen design), 45-02 not required |
| 3 | 45-04 | Pre-window checks, owner acceptance, calibration (human), freeze, preflight (human), the verdict window (human), the record and the resolution, and the conditional fix. | 45-01, 45-02, 45-03 |

## Requirement coverage

| Requirement | Plan | Where |
| --- | --- | --- |
| OMPV-01 | 45-01 | Tasks 1 to 4: the primitives matrix as the realm account, the record, the frozen design |
| OMPV-02 | 45-02 | Tasks 1 to 4: the slice recorder, the scripted socket, the red-first and load-invariance cases |
| OMPV-03 | 45-03 | Tasks 2, 3, 5: contention, attribution, validity, the scoped run and the pinned decision table |
| OMPV-04 | 45-03 (alternation, derivation as code), 45-04 (the calibration and the freeze) | Tasks 3 and 5 of 45-03; Tasks 3 and 4 of 45-04 |
| OMPV-05 | 45-03 (the table as code), 45-04 (the window, the record, the docs) | Tasks 3 and 4 of 45-03; Tasks 5 to 7 of 45-04 |
| OMPV-06 | 45-03 (the validity cutover), 45-04 (the resolution, the conditional fix) | Task 4 of 45-03; Tasks 7 and 8 of 45-04 |

## Open Questions (none blocks plan 45-01)

- **OQ-45-01 (the thread that serves get_state).** Omp is a Bun program with several threads. The design attributes the main thread (thread id equal to the pid). The calibration verifies it (D-45-08); if it fails the design is amended before freezing.
- **OQ-45-02 (a scope changes the scheduling share).** A leaf scope competes with its siblings by CPU weight, where an unscoped process shares its login scope. Both arms and both parts run in the same shape, so comparisons are fair; absolute numbers are labelled `loaded, scoped`. If the record shows a transient scope cannot be made, Branch N applies.
- **OQ-45-03 (the host may stay too loaded).** With a system pressure "some" avg10 of 48 to 69 for hours, the calibration may find fewer than five controls that meet the thresholds, and the phase would end VOID before the verdict window. That is a legal outcome (D-45-08 rule 2) and the owner's options are written; no step bends a bound to avoid it.
- **OQ-45-04 (Linear).** SPE-34730 is the Phase 45 ticket; no issue is created or changed by this phase.

## Success Criteria (from the roadmap text, made observable)

1. `45-FEASIBILITY.md` states, with the command or read for each, which of the primitives P1 to P11 the realm account can use, dated, and `45-DESIGN.md` is frozen from it before any verdict run.
2. `test/omp/attach-stall.test.ts` fails on the seeded blocking attach (red output kept in the summary), passes on the current extension, and returns the same verdicts with CPU burners running.
3. The harness decides validity from scoped contention and run-queue delay, attributes each stall interval, alternates the order, keeps every threshold and Phase 38 constant, and its constants and tables are pinned by hermetic tests that exist before the first live run; the calibrated constants are frozen from a recorded calibration before the first verdict run.
4. The window ends in exactly one of PASS, FINDING, NOT-REPRODUCED, VOID by the code rule; the numbers carry their tier labels; host facts, commit, Omp version and isolation are in `45-MEASUREMENT.md` and `docs/integration/omp.md`; the stack ends with zero containers, sandboxes, workspace entries, daemons and transient scopes.
5. OMPR-01, OMPR-06 and OI-11 read the outcome by the table of D-45-12; none closes on VOID or on the probe alone; a fix, if the finding names the extension, is red first, fail closed, and in a new module if it grows past the ceiling; UI-01 stays the owner's call.

## Deferred Ideas

- The root-assisted isolated tier (OD-45-1) with `cpuset` partitions.
- A keystroke-echo probe beside `get_state`; a K1-only arm (OQ-44-01); lowering the daemon priority during a cold attach (all deferred in Phases 38 and 44).
- A quiet-host window under the Phase 38 rule, if the host is ever quiet.
</decisions>

## Text for the orchestrator

The orchestrator applies the following; this phase edits none of these files.

### ROADMAP.md (Phase 45 block)

Replace `**Plans:** 0 plans` and the TBD line with:

```
**Plans:** 4 plans

Plans:
- [ ] 45-01-PLAN.md: the dated feasibility record of the isolation and contention primitives as the realm account (human), and the design frozen from it (wave 1)
- [ ] 45-02-PLAN.md: the hermetic in-process stall probe, red first on a seeded blocking attach and load invariant (wave 1)
- [ ] 45-03-PLAN.md: the harness: scoped runs, contention validity, stall attribution, alternating order, calibration derivation, the verdict table and the paired validity cutover, as code with hermetic tests (wave 2)
- [ ] 45-04-PLAN.md: the calibration and its freeze, the live verdict window (blocking human), the record, the resolution of OMPR-01, OMPR-06 and OI-11, and the conditional fix (wave 3)
```

### REQUIREMENTS.md

Statuses follow the outcome only after plan 45-04 Task 7 and its `45-RESOLUTION.md`: OMPV-01 and OMPV-02 may be ticked when plans 45-01 and 45-02 land (they are artifacts, not live results); OMPV-03 and OMPV-04 when plan 45-03 lands and the freeze of plan 45-04 Task 4 is merged; OMPV-05 and OMPV-06 only when the window outcome and the resolution are recorded. OMPR-01 and OMPR-06 keep their v6.0 rows until `45-RESOLUTION.md` states the closure or the carry; the resolution file holds the exact words per outcome.
