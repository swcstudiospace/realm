# Phase 46: Live window evidence (plan 46-02) and the cause record (plan 46-03)

**Window:** 2026-11-19, the Phase 46 harness (plan 46-01) merged into main, production stack, account `realmlive`, rootless Podman 5.7.1, shared live lock, one live run. The evidence files stay outside the repository (directories 0700, files 0600). This file holds numbers, booleans and closed phrases only: no path, environment value, token or container id. Tiers: **OBSERVED** (read from the window's files), **READ** (code read in this tree), **INFERENCE** (a reading that no recorded observation shows).

## 1. Outcome by the frozen rule (D-46-02)

**OTHER-FAILURE.** The window recorded failures with no `OPENSHELL_START_FAILED` among them, and every failure is a stop whose `daemon.stopped` row has `failedTeardowns` 1 and `code` AGENTOS_STOP_FAILED. D-46-02 names exactly that case ("a stop whose `daemon.stopped` row has `failedTeardowns` above 0 or a `code`") as OTHER-FAILURE: a new named finding, never counted as a reproduction and never as a clean iteration.

| Word | Applies? | Why |
| --- | --- | --- |
| REPRODUCED | no | 0 of 51 recorded ups failed, 0 with `OPENSHELL_START_FAILED`. |
| OTHER-FAILURE | **yes** | 6 stops with `failedTeardowns` 1 and code AGENTOS_STOP_FAILED (3 in variant a, 3 in variant b). |
| NOT-REPRODUCED | no | Variants a and b ended at their failure cap (3), variant c recorded no iteration, the control did not run, and failures exist. |
| VOID | no | Failures were recorded, so the window ended in a word of its own (a host stop also occurred, see 5). |

What the outcome claims: the counts below, that the immediate stop-then-up chain produced no start failure in 51 ups, and a new finding, **F-46-1** (section 4). What it does not claim: that F-41-1 does not occur (51 ups on one host, one commit, a synthetic load, and variants c and s never completed), nor any cause for F-41-1. F-41-1 stays **carried, not reproduced, cause not established**.

## 2. Facts of the window

- OBSERVED: node v24.18.0; package version 0.7.1 of the built tree; 8 CPUs; the load variant ran 8 busy workers (one per CPU); the commit field of the window summary reads unknown (the built copy had no git metadata), so the commit is recorded by the orchestrator's merge, not by the harness.
- OBSERVED: sample intervals 50 ms (daemon pid poll), 100 ms (driver unit child processes), 250 ms (session containers), 500 ms (gateway sandbox list); both unit variables were set (driver journal and gateway journal read for every iteration).
- OBSERVED: the host was loaded by other work as well: the load average read 24.59 before the window, 10.02 after the reaper step and 9.30 at the end; per-iteration load per CPU before the stop ranged 0.2 to 5.5 (variant a median 1.62, variant b median 3.59).
- OBSERVED: residue snapshots before, after and at the end read 0 containers, 0 sandboxes, an empty pinned workspace and no daemon each time.

## 3. Per-variant table

| Variant | Iterations | Clean | Failed | Consecutive clean at end | Ended | Start failures |
| --- | --- | --- | --- | --- | --- | --- |
| a (plain stop, immediate up) | 43 | 40 | 3 | 0 | failure cap | 0 |
| b (stop under CPU load) | 8 | 5 | 3 | 0 | failure cap | 0 |
| c (stop in the middle of an up) | 0 recorded (1 iteration observed, see 5) | 0 | 0 | 0 | host stop (harness abort) | 0 |
| s (settled control) | not run (the window was halted) | none | none | none | skipped | none |

Chains: variant a ran three chains (3, then 39, then 1 iteration); variant b three chains (1, 1, 6 iterations). The consecutive clean count therefore never exceeded 39. Every failing iteration restarted its chain after the cleanup, as designed; nothing was retried or dropped.

Clean stops in variant a took 1181 to 9831 ms (median 8598 ms); in variant b 2893 to 13216 ms (median 10187 ms). The 6 failed stops took 12905, 13107, 13476, 13012, 13477 and 13916 ms. The next up after each failed stop reached active and ran one exec (6 of 6), after 15.6 to 30.5 s; no iteration had an up failure of any kind.

## 4. Finding F-46-1: AGENTOS_STOP_FAILED at about 13 s

### 4.1 The six failed stops (OBSERVED)

| Variant, chain, iteration | Stop (ms) | failedTeardowns | code | Next up | Driver journal line in the window |
| --- | --- | --- | --- | --- | --- |
| a, 1, 3 | 13476 | 1 | AGENTOS_STOP_FAILED | active, exec ok | watch poll failed, PODMAN_MACHINE_DOWN |
| a, 2, 42 | 12905 | 1 | AGENTOS_STOP_FAILED | active, exec ok | same |
| a, 3, 43 | 13107 | 1 | AGENTOS_STOP_FAILED | active, exec ok | same |
| b, 1, 1 | 13012 | 1 | AGENTOS_STOP_FAILED | active, exec ok | same |
| b, 2, 2 | 13916 | 1 | AGENTOS_STOP_FAILED | active, exec ok | same |
| b, 3, 8 | 13477 | 1 | AGENTOS_STOP_FAILED | active, exec ok | same |

The same driver journal line appears in none of the other 45 stops' windows. Each failed stop has both a `daemon.stopping` and a `daemon.stopped` row (row-absent 0 of 51). The `daemon.stopped` row and the daemon log's `daemon.failed` line carry the primary code only; no file of the window carries the cause code of the failed step.

### 4.2 Where the time went (OBSERVED, per iteration, from the timelines, the sample files and the gateway journal)

The stop rows give the whole stop. The gateway journal gives the delete that is the last stage of a session end: its `DeleteSandbox` request completes at the moment the `daemon.stopped` row is written, with a latency of 5.1 to 5.8 s in 43 of the 52 stops (the 51 counted ones and the variant c one) and 0.2 to 0.5 s in the other 9. Subtracting that latency from the stop gives the time before the delete started:

- the 45 stops that did not fail: before the delete 0.9 to 5.0 s, except two at 7.2 s and 7.8 s (b, 3, 5: stop 7407 ms; b, 3, 3: stop 12986 ms), neither of which failed;
- the 6 failed stops of variants a and b: before the delete 7.6 to 8.5 s; the failed variant c stop 16.4 s (it also waited for the create in flight).

The container sampler (the session's container state, a Podman command every 250 ms) shows the stage that holds the time. In a typical stop the container reads `stopping` from about 0.3 s and `exited` from about 2.7 to 3.7 s (median 2.75 s over 36 usable stops); in the failed stops it reads `stopping` and then `exited` only at 8.5, 9.98, 10.07, 10.2, 10.7 and 12.3 s, and the sampler's own Podman command was blocked for 5.9 to 9.8 s inside that interval (the largest gap between two samples; 1.0 to 2.3 s in typical stops). The two slow stops that did not fail read `exited` at 7.1 s (b, 3, 3; a 5.1 s sampler gap) and not at all in the sample (b, 3, 5; a 6.0 s sampler gap).

In the variant c iteration, the container read `stopping` at 8.9 s after the first up started and `exited` at 20.8 s, 11.9 s later, and that stop ended with the same code.

### 4.3 Cause (INFERENCE with named support; one link is not recorded)

The container stop is the stage that is slow, not the AgentOS stop, the sandbox delete or the controller. The stage order of one session end is read from the code (READ): `settleCreatesFor`, the AgentOS runner stop (own bound 15 s), the container step (an inspect, then `stopContainer`), the sandbox delete (own bound 15 s). The `stopContainer` request is bounded at `DEFAULT_REQUEST_TIMEOUT_MS` 5000 ms plus its 2000 ms grace, 7000 ms, and a missed bound is thrown as PODMAN_MACHINE_DOWN (`src/runtime/libpod-client.ts`, `exchange`). `containerStep` returns any failure as a failed step with that cause code, and `throwIfStopFailed` turns a failed step into AGENTOS_STOP_FAILED with `daemon.stopped` `failedTeardowns` 1 (`src/runtime/session-execution.ts`). Nothing re-reads the container after a missed bound.

The recorded numbers fit that chain and no other stage: the time before the delete in the failed stops (7.6 to 8.5 s) is the 7 s request bound plus the 0.3 to 1.0 s of the stages around it; the container reaches `exited` after that bound in all 6 failed stops of variants a and b (8.5, 9.98, 10.07, 10.2, 10.7 and 12.3 s from the signal); the driver's own Podman poll fails with PODMAN_MACHINE_DOWN inside the same window in exactly those 6 stops and in none of the others (Podman did not answer a bounded request); the sandbox delete itself finished in 5.2 to 5.5 s, far inside its 15 s bound, and the AgentOS stop has a 4 s ceiling in the runner code (2 s after SIGTERM, 2 s after SIGKILL). The two slow stops that did not fail (pre-delete 7.2 s and 7.8 s) sit at the bound, where a request that returns just inside it succeeds.

What is inferred and not recorded: that the failed step is the `stopContainer` request and that its cause code is PODMAN_MACHINE_DOWN. The window did not keep the cause code (it is not in `daemon.stopped`, and the CLI prints the primary code only).

Why Podman's stop is slow in 9 of 52 stops (the 7 failed ones and the 2 that stayed inside the bound) is **not established**: the sandbox runtime ignores SIGTERM, so the container waits its 2 s grace and is then killed; the interval after the kill is where the time goes, and Podman's state commands are blocked for it. The host was loaded by other work. The sample (one host, one window) does not separate load from a Podman teardown cost.

Classification: a bound that is too tight for an occasional slow container stop (the request bound of 7 s against observed stops of 7 to about 12 s), combined with a fail-reporting step that does not look at the container after the request misses its bound. It is not a hang (every container ended inside about 12 s; the sandbox delete then ran and succeeded; zero residue), not an ordering defect between components, and not an orphan: the end state was clean in all 6 stops and the next up was normal. The reported failure is nevertheless real as a report: `daemon.stopped` says a teardown failed, and a `realm down` that meets the same slow stop returns AGENTOS_STOP_FAILED to the user (section 5).

### 4.4 Is it F-41-1?

No. F-41-1 was an up failing with OPENSHELL_START_FAILED. In this window no up failed (0 of 51), including the 6 ups right after a failed stop, and the status notice that the Phase 41 record cited ("a previous daemon's sandbox was destroyed") was present on every one of the 51 ups, clean ones included (`recordsDeleted` 1 in the startup report after a SIGTERM stop, `containersRemoved` 0 in all 51). The notice therefore does not separate a failed run from a clean one. M2 and M4 are not shown by this window (section 6).

## 5. Variant c and the harness stop (OBSERVED)

One variant c iteration ran. The daemon's startup report was already written 1.1 s before the signal (the signal did not land in the startup window, so the OBS-C reading of E-46-09 was not exercised), the stop wrote both rows (`daemon.stopping`, then `daemon.stopped` with `failedTeardowns` 1 and code AGENTOS_STOP_FAILED after 21.5 s; the first, interrupted up exited 1 with REALM_NOT_ACTIVE), the second up reached active, and the post-iteration `realm down` returned AGENTOS_STOP_FAILED. The harness treats a failing `down` as a host stop (a chain abort), so the iteration was not counted, variant c recorded 0 iterations and the window was halted before the control. This is a harness classification defect, not a host problem: a product code from `down` is a finding and must be recorded as a failure of its own kind. The harness now classifies it so (failure kind `down-failed`, counted and kept, not an abort; corrected in the plan 46-03 change set).

OBS-C (the variant c stop with no `daemon.stopped` row) did not recur: 0 row-absent stops in 52 (51 counted, 1 observed). E-46-09 is not confirmed and not refuted.

## 6. Mechanism table (D-46-03): each candidate marked by a row of evidence

| ID | Candidate | Mark | Row of evidence |
| --- | --- | --- | --- |
| M1 | Late supervisor stop or driver delete reaches the new sandbox | NOT TESTED | No up failed, so no failure to discriminate. 0 of 51 iterations saw a previous-sandbox supervisor after the daemon's exit or after the next up started (100 ms samples, driver unit named). |
| M2 | The new daemon's startup reap and its un-awaited gateway delete | NOT TESTED | No failing up. `containersRemoved` 0 in all 51 startup reports; the notice was present on all 51 (so it separates nothing). |
| M3 | Name released early (delete exit 0 before the gateway and driver released the name) | NOT TESTED | No failing up and no create failure line in any daemon log slice. |
| M4 | The previous stop was not a full teardown and the reap destroyed what survived | NOT TESTED for F-41-1; evidence against as a general mechanism | 6 stops were reported dirty and each next up succeeded; the end state of those 6 was clean (0 containers, 0 sandboxes). |
| M5 | A start-path failure unrelated to the previous sandbox | NOT TESTED | No start failure, and the control s did not run. |

## 7. What this record does not show

- Any live result for variants c and s; any count of 50 clean iterations; the Phase 41 failure rate for the up.
- The cause code of the failed step (section 4.3).
- Why Podman's container stop takes about 7 to 12 s in 9 of 52 stops (a typical stop takes about 3 s).
- That the host load was the cause; it was not isolated.

## 8. Decision from this record (plan 46-03, OTHER-FAILURE branch)

- F-41-1: carried, not reproduced, cause not established. No behavior change is made for it.
- F-46-1: cause established to the strength stated in 4.3 (INFERENCE with named support; the cause code of the failed step was not recorded). Classification: a request bound too tight for an occasional slow Podman container stop, plus a failure report that did not re-read the container. The fix is a bounded confirmation wait after a stop or force removal request that missed its request bound (PODMAN_MACHINE_DOWN): the container state is read every 500 ms for at most 10 s, success only when the container has ended, otherwise the same failed step as before. It adds one stage (10 s) to the session-end worst case: teardown bound 60 to 70 s, `down` client bound 75 to 85 s. A red-first hermetic test (`test/runtime/container-stop-confirm.test.ts`) failed on the unchanged code in the two cases that need the confirmation. Labelled: fixed hermetically, not verified live.
- OBS-C and E-46-09 (SIGTERM during startup): not observed (the one variant c signal came after the startup report). No change is made; the owner's decision to fix it if the data confirms does not apply yet.
- What plan 46-04 must run: the harness as corrected (a post-iteration `down` failure is the failure kind `down-failed`, not an abort); variant a for at least 20 consecutive stop-then-up iterations with zero `OPENSHELL_START_FAILED`, `failedTeardowns` 0 in every row, zero residue; variants b and c at 20 each as the no-regression check, and variant s only if a failure appears; the daemon exit bound of the harness is now 100 s. A stop that fails again must be kept with the container samples and the driver journal, and the cause code of the failed step should be recorded: that needs one more capture (a log line of the failed step and its cause code), proposed for the next window if a failure recurs.

## 9. Verification window (plan 46-04): rapid stop then up, 2026-11-19, the fixed build

**Label:** rapid stop then up, verification window, 2026-11-19, about 10:32 to 11:05 UTC, production stack as the realm account (rootless Podman 5.7.1), shared live lock, residue clean before and after. Build: main with the plan 46-03 fix (the orchestrator gives the merge commit as ea04e1c; the harness summary line for the commit reads unknown because the built copy had no git metadata) and the daemon exit bound of the harness at 100 s. Evidence stays outside the repository; this section holds numbers, booleans and closed phrases only.

**Loaded host (OBSERVED).** The host was heavily loaded by other work: the load average read 12.3 before the window, 67.8 after the reaper step and 70.8 at the end, on 8 CPUs; the load per CPU read before each stop of variant a ranged 1.14 to 8.84. Node v24.18.0, package version 0.7.4, 8 CPUs, iteration target 20, failure cap 3, both unit variables set, sample intervals as in section 2.

### 9.1 Outcome by the frozen rule

**VOID.** Variant a ran to its target; variant b ended at its chain start (a host stop in the harness, see 9.3); variant c and the control s did not run (the window was halted). No failure of the kinds that give REPRODUCED or OTHER-FAILURE was recorded, and fewer than all of a, b and c completed, so D-46-02 gives VOID: the counts reached and the reason, none of the three other words. The window was also run with a target of 20 per variant, below the 50 that NOT-REPRODUCED needs, so it could not have given that word.

| Variant | Iterations | Clean | Failed | Ended |
| --- | --- | --- | --- | --- |
| a | 20 | 20 | 0 | target (20 consecutive) |
| b | 0 | 0 | 0 | host stop at the settled first up of chain 1 |
| c | not run | none | none | window halted |
| s | not run | none | none | window halted |

### 9.2 Variant a, 20 stop-then-up iterations on one sandbox name with no settle (OBSERVED)

- 20 of 20 iterations clean; 20 `daemon.stopping` rows and 20 `daemon.stopped` rows (0 rows absent), `failedTeardowns` 0 and no code in all 20; 0 ups failed (0 with `OPENSHELL_START_FAILED`); every up reached active and ran one exec; the late-supervisor counts were 0 in all 20; the status notice was present on all 20 ups (as in 4.4, it separates nothing).
- Stop times (signal to the daemon's exit): minimum 2092 ms, median 9856 ms, maximum 12176 ms; the up after each stop took 21.9 to 49.8 s (median 30.9 s), longer than in the first window (loaded host).
- Residue: 0 containers, 0 sandboxes, an empty pinned workspace and no daemon before the window, after the reaper step and at the end.

### 9.3 Variant b: a start failure at the chain start (OBSERVED), not a stop-then-up iteration

Variant b never ran an iteration. Its chain 1 starts with a settled `realm up`, and that up failed: exit 1, session state error with reason OPENSHELL_START_FAILED, at 10:53:07Z. The harness took any failure of that up as a host stop (chain abort), so the window ended VOID there.

What the files show, in time order (UTC, 2026-11-19):

- Variant a ended with its 20th up active at 10:51:36. The chain cleanup (`realm down`) then stopped the container (the sandbox phase went to Error with reason stopping at 10:52:00.9; Podman logged that SIGTERM failed to stop the container in 2 seconds and it was killed, 10:52:01.9) and the sandbox delete finished at 10:52:11.9 (5.4 s). The residue wait, the new scenario, the settle checks (no driver host supervisor, no realm sandbox at the gateway, no container for the name) and the daemon start followed. **So the failing up came about 35 s after the cleanup, on a settled stack: it is not the immediate stop-then-up shape of F-41-1, and it is not a reproduction under D-46-02** (which counts an up that fails right after a stop with no settle).
- The gateway's `CreateSandbox` for that up began at about 10:52:47.3 and returned at 10:53:04.67 after 17.4 s with gRPC status 13 (INTERNAL). All 20 creates of variant a returned ok, in 1.9 to 10.6 s.
- Inside that interval Podman did not answer a bounded request: the compute driver's Podman poll failed with PODMAN_MACHINE_DOWN at 10:53:01.8, and the gateway's store reconciliation sweep got "the podman machine is not running" at 10:53:02.2. Neither line appears in any window of variant a (driver journal poll failures 0 of 20).
- At 10:53:07.26 the gateway served a `DeleteSandbox` for the session's name that completed in 0 ms (nothing left to delete): the daemon's cleanup after the failed create. The up reported OPENSHELL_START_FAILED 0.3 s later.

### 9.4 Cause record for the b start failure (INFERENCE; the failing step is not established)

- **READ:** the driver's create runs `startContainer` and an inspect inside `startAndVerify`; any libpod failure there makes the driver discard the container and refuse with OPENSHELL_START_FAILED carrying the libpod code as its cause (`src/runtime/driver/lifecycle.ts`), which maps to gRPC INTERNAL (`src/runtime/driver/grpc-status.ts`); the OpenShell create CLI then exits non-zero and the AgentOS driver throws OPENSHELL_START_FAILED with no cause (`src/runtime/agentos-driver.ts`), which the daemon reports. Every libpod request is bounded at 5 s and a missed bound is PODMAN_MACHINE_DOWN (`src/runtime/libpod-client.ts`). The driver logs only SCHEMA_INVALID refusals, so a refusal with a libpod cause leaves no line in its journal.
- **INFERENCE (fits all the observations, not shown by them):** a libpod request of the driver's create missed its 5 s bound while Podman was stalled on the loaded host, the driver refused the create, and the up failed. This fits the INTERNAL status after 17.4 s, the PODMAN_MACHINE_DOWN lines of two components at the same moment, the silent driver journal and the 0.3 s from the failed create to the failed up.
- **Not established:** which libpod request, how long Podman stalled, and whether another step (the runtime listener wait, the host supervisor exiting before Ready) produced the same refusal. The cause code of the refusal is in no file: the daemon log, which holds the line with the exit code and stderr of the OpenShell create, was removed with the scenario by the chain cleanup before anyone read it, and the harness had captured nothing at the chain start.
- **Classification:** not a leftover of variant a's last stop (the settled stack, the 35 s gap and the 20 clean ups before it); consistent with a start-path failure under host load unrelated to a previous sandbox, i.e. the shape of candidate M5, shown possible once on a settled stack. It does not show that M5 explains F-41-1: that failure followed a stop with no settle on a different host load. M1 to M4 stay NOT TESTED.
- **Fix:** none. No bounded, testable change is clear without knowing which request failed: raising a libpod bound, retrying a create after a libpod stall, or retrying the refused up each change behavior and need that step first.

### 9.5 The four STOP-04 conditions (plan 46-04 Task 6), applied

| Condition | Variant a | Whole window |
| --- | --- | --- |
| At least 20 consecutive stop-then-up iterations on one sandbox name with no settle | MET (20) | the window is VOID |
| Zero OPENSHELL_START_FAILED | MET for the 20 ups of variant a (0); one OPENSHELL_START_FAILED occurred in the same window at the settled chain start of variant b (9.3) | not met as a window |
| `failedTeardowns` 0 in every `daemon.stopped` row, none absent | MET (20 of 20 rows, 0 absent) | b, c, s have no stops |
| Zero residue at the end and between chains | MET at the three snapshots; one chain only | variants b, c, s not run |

Per the plan, STOP-04 is met only if all four are met and the window is not VOID; the window is VOID, so **STOP-04 is recorded as not met**, with variant a's result recorded as met for its own 20 iterations. The variant c missing row (D-46-07) was not explained: variant c did not run in this window, and in the first window the one variant c stop wrote both rows (section 5), so the reading stays not established. Variants b and c were not rerun at their original counts.

### 9.6 What the 20 of 20 does and does not show about the plan 46-03 fix

- It shows 20 consecutive stop-then-up iterations on one host and one commit under a loaded host, none failing at the stop or at the up.
- **It does not show that the fix was exercised.** The fix acts only when the libpod stop request misses its 7 s bound. In this window no stop got near that: the time before the sandbox delete was at most 6.3 s (the failing stops of the first window had 7.6 to 8.5 s), the container reached exited within 5.3 s in every stop where it was sampled, and the driver's Podman poll failed in none of the 20 windows. The host was loaded, but Podman's container stop was not slow. At the first window's rate (6 failed stops of 51) the chance of 20 clean stops is about 8 percent, a weak sign and nothing more. The fix therefore stays labelled fixed hermetically, with live support that is weak and unproven; the slow stops it targets did not occur.
- It does not show the start path safe under load: the same window recorded one start failure at a settled chain start.

### 9.7 What the next window (b, c, control) must run

- The harness as now changed: a failed settled first up of a chain is a counted failure of its own kind (`chain-start-failed`, never a reproduction) that keeps the whole request log and daemon log slice of the failed up, both unit journals and the Podman events before the cleanup removes the scenario; the chain is then cleaned and a new chain starts, up to the failure cap.
- Variants b, c at 20 each and the control s with a fresh settle (the settle already runs before every chain), from a fresh built copy as the realm account under the shared lock. Run them while the host is not loaded by other work if the owner can arrange it, or record the load as in 9; a quieter host is the only way to separate a load effect from a defect.
- If a settled chain start fails again, the daemon log slice names the exit code and the stderr of the OpenShell create; read it first, then the driver and gateway journals. The proposed product capture, not made here: a driver journal line for a create refusal that carries a libpod cause (the stage and the cause code, closed phrases), so that a refusal like the one in 9.3 is not silent.
- To show the plan 46-03 fix live a window must contain a slow container stop (a stop whose time before the sandbox delete exceeds 7 s); if none occurs again the fix stays hermetic.
