# Phase 46: second verification window (variants b, c, s at 20, 2026-11-19)

**Window:** 2026-11-19, about 12:51:47 to 13:37:28 UTC (45.7 minutes), production stack as the
realm account (rootless Podman 5.7.1), shared live lock (`realm-evidence/live.lock`, flock),
one live run. Build: worktree head `fda151f`, fresh build (`rm -rf dist`, `npm ci`,
`npm run build`, exit 0), copied to a fresh directory under the realm home and run from
there; the harness summary line for the commit reads unknown (the copy had no git metadata).
Variants b, c, s, iteration target 20, failure cap 3, both unit variables set. Evidence
stays outside the repository (evidence directory under the realm home, 0700, files 0600);
this file holds numbers, booleans and closed phrases only. Tiers: **OBSERVED** (read from
the window's files), **READ** (code read in this tree), **INFERENCE** (a reading that no
recorded observation shows).

## Summary (the second window)

- **Outcome by the frozen rule (D-46-02): VOID.** No `OPENSHELL_START_FAILED` was recorded
  (so not REPRODUCED), no failure of any kind was recorded (so not OTHER-FAILURE), and
  variant a did not run and the target was 20, below the 50 consecutive clean iterations
  that NOT-REPRODUCED needs. The window counts are below.
- **STOP-04 is recorded as not met** (the plan's rule met STOP-04 only if all four
  conditions are met and the window is not VOID). Per variant, all four conditions are
  met by b (20 of 20, one chain) and by c (20 of 20, one chain); s is the settled control
  and does not count for the no-settle condition.
- **The host was loaded by other work** (before snapshot: load1 25.76, falling; CPU
  pressure `some` avg10 about 67 percent; per-iteration load per CPU before each stop
  ranged 0.28 to 5.76 across the 60 iterations; at the end load1 5.23). A Phase 45
  calibration queued on the shared live lock from 13:22 and acquired it at 13:37:28, the
  moment this window released it: the runs were serialized, with no overlap.
- F-46-1 fix: **not exercised in b** (no stop got near the 7 s libpod request bound;
  the time before the sandbox delete reached at most 5.8 s, and the driver's Podman poll
  failed in none of the 60 windows). One s stop had a pre-delete time of 7.6 s and
  completed clean; whether the fix's confirmation wait ran there is not established.
- Variant c missing row (D-46-07): **0 row-absent in 20 c stops** (20 stopping rows and
  20 stopped rows); the reading stays not established.

| Variant | Iterations | Clean | Failed | Consecutive clean at end | Ended | Start failures |
| --- | --- | --- | --- | --- | --- | --- |
| b (stop under CPU load) | 20 | 20 | 0 | 20 | target | 0 |
| c (stop in the middle of an up) | 20 | 20 | 0 | 20 | target | 0 |
| s (settled control) | 20 | 20 | 0 | 20 | target | 0 |
| a | not run | none | none | none | not in list | none |

Chains: one chain per variant (chain 1). Every iteration reached active and ran one exec;
the late-supervisor counts were 0 in all 60; the status notice was present on all 60 ups
(as in the first window's 4.4, it separates nothing).

## 1. Facts of the window (OBSERVED)

- Node v24.18.0; package version 0.7.7 of the built tree; 8 CPUs; the load variant ran
  8 busy workers (one per CPU); the commit field of the window summary reads unknown
  (the built copy had no git metadata), so the commit is recorded by the orchestrator's
  build, not by the harness.
- Sample intervals 50 ms (daemon pid poll), 100 ms (driver unit child processes),
  250 ms (session containers), 500 ms (gateway sandbox list); both unit variables were
  set (driver journal and gateway journal read for every iteration).
- The two settled chain starts that run (b and s; c starts each iteration from a settled
  state with no daemon) both exited 0 and reached active (kept in `chain-start-up.txt`).
- Residue snapshots before and after the window read 0 containers, 0 sandboxes, an empty
  pinned workspace and no daemon each time; the harness wrote `final=yes`, and the
  account's Podman held 0 containers after the run.

## 2. Numbers per variant (OBSERVED)

Stop times (signal to the daemon's exit):

| Variant | Min (ms) | Median (ms) | Max (ms) | Load per CPU before stop, min-max |
| --- | --- | --- | --- | --- |
| b | 1809 | 8795 | 11202 | 2.0-5.76 |
| c | 9811 | 13185 | 20504 | 0.28-4.18 |
| s | 1766 | 8791 | 12875 | 0.45-3.6 |

Rows: 60 `daemon.stopping` rows and 60 `daemon.stopped` rows against 60 stops (0 rows
absent); `failedTeardowns` 0 and no code in all 60. `OPENSHELL_START_FAILED` count 0 in
the whole evidence directory. The c iterations' interrupted first ups all classified
`other-failure` (expected: the first up is interrupted by design), and every second up
reached active and ran one exec.

## 3. The four STOP-04 conditions, applied

| Condition | b | c | s | Whole window |
| --- | --- | --- | --- | --- |
| At least 20 consecutive stop-then-up iterations on one sandbox name with no settle | MET (20, one chain) | MET (20, one chain) | control: settle before each up, not counted | the window is VOID |
| Zero OPENSHELL_START_FAILED | MET (0) | MET (0) | MET (0) | MET as a count (0 in all 60 ups and both chain starts) |
| `failedTeardowns` 0 in every `daemon.stopped` row, none absent | MET (20 of 20) | MET (20 of 20) | MET (20 of 20) | MET (60 of 60) |
| Zero residue at the end and between chains | MET at both snapshots; one chain | MET; one chain | MET; one chain | MET at the two snapshots |

Per the plan, STOP-04 is met only if all four are met and the window is not VOID; the
window is VOID, so **STOP-04 is recorded as not met**, with b and c each meeting all four
conditions at 20 iterations. The 20-clean target was below the 50 that the frozen rule
needs for NOT-REPRODUCED, so this window could not have given that word either way.

## 4. What the 40 of 40 (b and c) does and does not show

- It shows 20 consecutive stop-then-up iterations under CPU load (b, one sandbox name,
  one chain) and 20 stop-in-the-middle-of-an-up iterations (c, one chain), none failing
  at the stop or at the up, on a loaded host.
- **It does not show that the plan 46-03 fix was exercised in b.** The fix acts only when
  the libpod stop request misses its 7 s bound. In b the time before the sandbox delete
  (stop time minus the delete latency from the gateway journal) was at most 5.8 s
  (median 3.5 s), and the driver's Podman poll failed in none of the 20 windows.
  One s stop had a pre-delete time of 7.6 s and completed clean; no file shows whether
  the container stop missed its bound and the confirmation wait ran, so that too is
  not established. At the first window's rate (6 failed stops of 51) the chance of 20
  clean stops is about 8 percent: with the fix unexercised, 40 of 40 across b and c is a
  weak sign and nothing more. The fix stays labelled fixed hermetically, with live
  support that is weak and unproven.
- c stop times (median about 12.5 s before the delete) include the wait for the
  interrupted create to settle, so they are not a measure of a slow container stop.
- It does not show the start path safe under load: this window recorded no start failure
  at all, but the first window recorded one at a settled chain start (see 46-EVIDENCE.md
  section 9.3), and the load here (fell to about 0.3 to 5.8 per CPU while running) was
  lower than the first window's peak.

## 5. Variant c missing row (D-46-07)

Every c stop in this window wrote both rows (20 of 20): the row-absent stop of Phase 41
did not recur. The closed-list reading stays **not established** (no row-absent stop was
observed to explain). The c stops here never landed in the daemon's startup window in a
way that produced a missing row: `startupSeen` read yes in the c iterations and the rows
are present, so the startup-window hypothesis was not exercised either.

## 6. What this record does not show

- Any result for variant a in this window; any count of 50 clean iterations; the Phase 41
  failure rate for the up; NOT-REPRODUCED.
- That the plan 46-03 fix was exercised (section 4).
- Why the host was loaded, or that the load was the cause of anything; the load was
  recorded, not isolated.

## 7. Checks run

- Fresh build: `rm -rf dist`, `npm ci`, `npm run build` in the worktree (exit 0); the
  built tree copied to a fresh directory under the realm home and the window run from
  there, as the realm account, with the scrubbed environment (HOME, TMPDIR, PATH with the
  Podman 5 directory first, XDG_RUNTIME_DIR) and the gate variables set for the command.
- With the gate closed, the live test skipped (1 skipped, 0 failed) before the window;
  with the gate open it passed (4 passed, 0 failed) and wrote `summary.txt` with
  `outcome=VOID`, `final=yes`.
- Secret search over the evidence directory (token and key patterns, the word lists of
  the plan): no match. No path, environment value, token or container id enters this
  file; the evidence stays outside the repository.
- The repository is clean of window artifacts: `git status` in the worktree showed no
  window file (dist and node_modules are ignored); the only repository change of this
  task is this file.
