# Phase 51: Live window evidence (the repeat run, 2026-11-19)

**Window:** 2026-11-19, about 22:59:52 to 23:29:19 UTC (about 29.5 minutes), the Phase 46 harness on the current main as merged, production stack, account `realmlive`, rootless Podman 5.7.1, shared live lock (`realm-evidence/live.lock`, flock), one live run. Build: worktree head `2879c35`, fresh build (`npm ci`, `npm run build`, exit 0); the built tree copied to a fresh directory under the realm home and run from there; the harness summary line for the commit reads unknown (the copy had no git metadata). The F-46-1 fix is in this build (the 10 s container confirmation wait and the 70 s teardown bound). Variants a, b, c, s; iteration target 50 (control 20); failure cap 3; both unit variables set. Evidence stays outside the repository (evidence directory under the realm home, 0700, files 0600); this file holds numbers, booleans and closed phrases only. Tiers: **OBSERVED** (read from the window's files), **READ** (code read in this tree), **INFERENCE** (a reading that no recorded observation shows).

## 1. Outcome by the frozen rule (D-46-02)

**OTHER-FAILURE.** No `OPENSHELL_START_FAILED` was recorded (0 of 123 ups, so not REPRODUCED); failures of another kind were recorded (3 dirty stops in variant c, so not NOT-REPRODUCED); the window did not end in a host stop before the failures appeared (so not VOID). The one failing kind is a stop whose `daemon.stopped` row has `failedTeardowns` 1 and code AGENTOS_STOP_FAILED, three times, all in variant c. D-46-02 names exactly that case as OTHER-FAILURE: a new named finding (section 4), never counted as a reproduction and never as a clean iteration.

| Word | Applies? | Why |
| --- | --- | --- |
| REPRODUCED | no | 0 of 123 recorded ups failed, 0 with `OPENSHELL_START_FAILED`. |
| OTHER-FAILURE | **yes** | 3 stops with `failedTeardowns` 1 and code AGENTOS_STOP_FAILED (all variant c). |
| NOT-REPRODUCED | no | Variant c ended at its failure cap; it did not reach 50 consecutive clean iterations. |
| VOID | no | Failures were recorded, so the window ended in a word of its own. |

What the outcome claims: the counts below, that the immediate stop-then-up chain produced no start failure in 123 ups (100 of them in variants a and b, each reaching the 50-consecutive bar in one chain), and a new finding, **F-51-1** (section 4). What it does not claim: that F-41-1 does not occur (123 ups on one host, one commit, a quiet host, variant c did not reach its bar), nor any cause for F-41-1. F-41-1 stays **carried, not reproduced, cause not established**.

## 2. Facts of the window (OBSERVED)

- Node v24.18.0; package version 0.8.0 of the built tree; 8 CPUs; the load variant ran 8 busy workers (one per CPU); the commit field of the window summary reads unknown (the built copy had no git metadata), so the commit is recorded by the orchestrator's merge, not by the harness.
- Sample intervals 50 ms (daemon pid poll), 100 ms (driver unit child processes), 250 ms (session containers), 500 ms (gateway sandbox list); both unit variables were set (driver journal and gateway journal read for every iteration).
- The host was quiet: the load average read 0.53 per CPU at the window start and 2.31 per CPU at the end; per-iteration load per CPU before each stop ranged 0.44 to 1.93 (variant a 0.44 to 0.94, variant b 0.47 to 1.93, variant c 0.84 to 1.41, variant s 0.45 to 0.71). This window therefore does not share the heavy other-work load of the Phase 46 windows.
- The two settled chain starts that run (a and b; c starts each iteration from a settled state with no daemon, and s settles before its chain) exited 0 and reached active.
- Residue snapshots before and after the window read 0 containers, 0 sandboxes, an empty pinned workspace and no daemon each time; the harness wrote `final=yes`, and the account's Podman held 0 containers after the run. The stack was found as it was left: gateway and compute driver still running, lock free.

## 3. Per-variant table

| Variant | Iterations | Clean | Failed | Consecutive clean at end | Ended | Start failures |
| --- | --- | --- | --- | --- | --- | --- |
| a (plain stop, immediate up) | 50 | 50 | 0 | 50 | target | 0 |
| b (stop under CPU load) | 50 | 50 | 0 | 50 | target | 0 |
| c (stop in the middle of an up) | 3 | 0 | 3 (dirty stop) | 0 | failure cap | 0 |
| s (settled control) | 20 | 20 | 0 | 20 | target | 0 |

Chains: one chain per variant (chain 1). 123 iterations recorded in total; every recorded iteration's up reached active and ran one exec (including the 3 failed c iterations, whose next up was normal).

Stop times (signal to the daemon's exit):

| Variant | Min (ms) | Median (ms) | Max (ms) |
| --- | --- | --- | --- |
| a | 351 | 7474 | 9904 |
| b | 524 | 7598 | 8065 |
| c | 403 | 7401 | 7415 |
| s | 5382 | 7418 | 7529 |

The status notice was present on all 123 ups (as in the Phase 46 records, it separates nothing); `containersRemoved` 0 in all 123 startup reports; `lateAfterExit` 0 and `lateAfterNextUp` 0 in all 123 iterations; 123 `daemon.stopping` rows and 123 `daemon.stopped` rows against 123 stops (0 rows absent).

## 4. Finding F-51-1: a dirty stop in every variant-c stop of this window

### 4.1 The three failed stops (OBSERVED)

| Variant, chain, iteration | Stop (ms) | failedTeardowns | code | stopping row | stopped row | Next up | startup seen |
| --- | --- | --- | --- | --- | --- | --- | --- |
| c, 1, 1 | 403 | 1 | AGENTOS_STOP_FAILED | yes | yes | active, exec ok | yes |
| c, 2, 2 | 7401 | 1 | AGENTOS_STOP_FAILED | yes | yes | active, exec ok | yes |
| c, 3, 3 | 7415 | 1 | AGENTOS_STOP_FAILED | yes | yes | active, exec ok | yes |

Each failed stop has both a `daemon.stopping` and a `daemon.stopped` row (row-absent 0 of 123 in the whole window). The `daemon.stopped` row and the daemon log's `daemon.failed` line carry the primary code only; no file of the window carries the cause code of the failed step.

### 4.2 Where the time went (OBSERVED, from the timelines and the gateway journal)

In the first c iteration the container was seen 66 ms after the signal and gone 402 ms after it; `daemon.stopped` was written 362 ms after `daemon.stopping`. Both gateway sandbox deletes in that window completed successfully (status 200, 80 ms). In later c iterations the supervisor that the driver unit saw was still seen thousands of milliseconds after the signal, and the `daemon.stopped` row followed about 7.4 s after `daemon.stopping`.

### 4.3 Cause (not established; what is excluded and what remains possible)

**Not established.** The failed-step cause code was not captured (the known capture gap of 46-EVIDENCE section 9; the proposed product capture, a driver journal line for a refused step carrying the stage and cause code, was not made), so the failing step cannot be named from this window.

Excluded by the recorded numbers:

- **Not the sandbox delete.** Both deletes in the first c window completed successfully (status 200, 80 ms).
- **Not a bound expiry, and not the F-46-1 shape.** The three stops took 0.4 to 7.4 s, far inside every stage bound; and there is no slow-container-stop signature (no Podman poll failure line in the driver journal, one of which accompanied every F-46-1 failed stop of Phase 46). The failing step failed fast, or waited a bounded few seconds only in the second and third c stops.
- **No holder of the sandbox was left behind.** The next up after each dirty stop reached active and ran one exec (3 of 3), and the end state was clean.

What remains possible (READ, from the code): a stop whose create is in flight runs, in turn, `settleCreatesFor` (a wait for the in-flight create, 15 s stage bound), the AgentOS stop, the container inspect-then-stop step and the sandbox delete; any one step failing makes `throwIfStopFailed` report AGENTOS_STOP_FAILED with `failedTeardowns` 1. This window does not distinguish them. In all three c iterations the signal came after the daemon's startup report (`startupSeen` yes in 3 of 3), so OBS-C's startup window was not exercised again either.

### 4.4 Is it F-41-1?

No. F-41-1 was an up failing with OPENSHELL_START_FAILED. In this window no up failed (0 of 123), including the 3 ups right after the dirty stops. It is F-46-1's report shape (`failedTeardowns` 1, AGENTOS_STOP_FAILED) in a stop-mid-create, with fast stops and no F-46-1's slow-stop signature; whether it shares F-46-1's mechanism is not established and is not claimed. It is not folded into F-41-1, and it does not make F-41-1 less carried. The F-46-1 fix was present in this build and unexercised (every stop completed well inside the request bound, so the confirmation wait had nothing to confirm).

### 4.5 Variant-c row absent (D-46-07)

0 row-absent stops in 123. The reading stays **not established** (no row-absent stop was observed to explain, and the signal never landed in the daemon's startup window: `startupSeen` yes in all 3 c iterations).

## 5. Mechanism table (D-46-03): each candidate marked by a row of evidence

| ID | Candidate | Mark | Row of evidence |
| --- | --- | --- | --- |
| M1 | Late supervisor stop or driver delete reaches the new sandbox | NOT TESTED | No up failed, so no failure to discriminate. `lateAfterExit` 0 and `lateAfterNextUp` 0 in all 123 iterations. |
| M2 | The new daemon's startup reap and its un-awaited gateway delete | NOT TESTED | No failing up. `containersRemoved` 0 in all 123 startup reports; the notice was present on all 123 (so it separates nothing). |
| M3 | Name released early (delete exit 0 before the gateway and driver released the name) | NOT TESTED | No failing up, and no create failure line in any daemon log slice. |
| M4 | The previous stop was not a full teardown and the reap destroyed what survived | NOT TESTED for F-41-1; evidence against as a general mechanism | 3 stops were reported dirty and each next up succeeded; the end state of those 3 was clean (0 containers, 0 sandboxes). |
| M5 | A start-path failure unrelated to the previous sandbox | NOT TESTED | No start failure; the control s ran 20 of 20 clean. |

## 6. The first launch of this window (recorded, not counted)

A first launch of this window was made with the image reference read from the operator's config file instead of the image the running driver was given. Every `realm up` of that launch failed at the settled chain start with OPENSHELL_START_FAILED (the compute driver refused the image with SCHEMA_INVALID; the named image is absent from the account's image store), including one variant-c immediate up, and the harness read that as REPRODUCED. That reading was spurious: a stack that cannot do any up cannot reproduce a stop-then-up interaction. The launch was stopped after 3 chain starts per variant of a and b and one c iteration, its evidence kept under a separate directory outside the repository, residue 0/0/0/0, and the window rerun with the image the running driver was given, verified against the image in the account's store and the prior windows' facts. This section is the whole record of it; none of its numbers are counted in sections 1 to 5.

## 7. What this record does not show

- Any live result for variant c beyond 3 dirty stops; any count of 50 clean iterations in variant c; NOT-REPRODUCED.
- The cause code of the failed step in the 3 dirty c stops (section 4.3).
- Why variant c stops failed in this window while the 20 of 20 c stops of the Phase 46 second window were clean. Both windows are single-host; the load differs (this window was quiet). Not established.
- The Phase 41 failure rate for the up, or any cause for F-41-1.

## 8. Checks run

- Fresh build: `npm ci`, `npm run build` in the worktree (exit 0); the built tree copied to a fresh directory under the realm home and the window run from there, as the realm account, with the scrubbed environment (HOME, TMPDIR, PATH with the Podman 5 directory first, XDG_RUNTIME_DIR) and the gate variables set for the command.
- Hermetic: `npm run build && node --test dist/test/integration/rapid-stop-up-helpers.test.js` — 70 passed, 0 failed. No source, test or contract file was changed by this phase, so the `daemon.stopped` contract tests and the 29-code catalogue stand as they were.
- With the gate closed, the live test skipped (1 skipped, 0 failed) before the window; with the gate open it failed with the OTHER-FAILURE assertion and wrote `summary.txt` with `outcome=OTHER-FAILURE`, `final=yes`.
- Secret search over the evidence directory (token and key patterns, the word lists of the plan): no match. No path, environment value, token or container id enters this file; the evidence stays outside the repository.
- The repository is clean of window artifacts: `git status` in the worktree showed no window file (dist and node_modules are ignored); the only repository changes of this task are this file and `51-SUMMARY.md`.
