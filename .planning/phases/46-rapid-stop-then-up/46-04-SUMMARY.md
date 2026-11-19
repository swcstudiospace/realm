---
phase: 46-rapid-stop-then-up
plan: "04"
status: executed
requirements: [STOP-04]
---

# Plan 46-04 summary (the verification window and its recording)

The window ran on 2026-11-19, about 10:32 to 11:05 UTC (owner and orchestrator; production stack as the realm account, rootless Podman 5.7.1, shared live lock, residue 0 before, after and at the end), on main with the plan 46-03 fix (the orchestrator gives ea04e1c; the harness summary line for the commit reads unknown). **The host was heavily loaded by other work** (load average 12.3 before, 67.8 and 70.8 after, on 8 CPUs). Evidence stays outside the repository; this file holds numbers and closed phrases only. The record is `46-EVIDENCE.md` section 9.

## Verdict

**Window VOID by the frozen rule (D-46-02). STOP-04 recorded as not met.** The plan meets STOP-04 only if all four conditions are met and the window is not VOID.

| Condition | Result |
| --- | --- |
| At least 20 consecutive stop-then-up iterations on one sandbox name with no settle | MET by variant a (20 of 20) |
| Zero OPENSHELL_START_FAILED | MET for the 20 ups of variant a; one OPENSHELL_START_FAILED occurred in the window at the settled first up of variant b |
| `failedTeardowns` 0 in every `daemon.stopped` row, none absent | MET for variant a (20 of 20 rows) |
| Zero residue at the end and between chains | MET at the three snapshots (one chain run) |
| The variant c missing row explained or recorded | not done: variant c did not run |

| Variant | Iterations | Clean | Failed | Ended |
| --- | --- | --- | --- | --- |
| a | 20 | 20 | 0 | target |
| b | 0 | 0 | 0 | host stop at the settled first up of chain 1 (OPENSHELL_START_FAILED) |
| c | not run | none | none | window halted |
| s | not run | none | none | window halted |

## What the results show and do not show

- Variant a: stops of 2.1 to 12.2 s (median 9.9 s), ups of 21.9 to 49.8 s (median 30.9 s), 20 rows of each kind, none failed, the late-supervisor counts 0.
- It does not show that the plan 46-03 fix was exercised: no stop got near the 7 s libpod request bound (at most 6.3 s before the sandbox delete, against 7.6 to 8.5 s in the failing stops of the first window; the container ended within 5.3 s where sampled; no Podman poll failure in the driver journal in any of the 20 windows). At the first window's rate the chance of 20 clean stops is about 8 percent, a weak sign. The fix stays fixed hermetically, with weak live support.
- The b start failure is an observation, not a reproduction of F-41-1: a settled up about 35 s after a `realm down`, not an up right after a stop. The gateway's create returned status 13 after 17.4 s while the driver's Podman poll and the gateway's reconciliation sweep both reported PODMAN_MACHINE_DOWN, and the driver's cleanup found nothing to delete. [INFERENCE] a libpod request of the driver's create missed its 5 s bound during a Podman stall on the loaded host; the failing step, the stall length and the cause code are not established (the daemon log was removed with the scenario before it was read). It is the shape of candidate M5 shown possible once on a settled stack under load; it does not explain F-41-1, which stays carried with its cause not established.
- No product change was made: no bounded, testable fix is clear without the failing step.

## Changes made in this plan (harness and docs only)

- `test/support/rapid-stop-up.ts`: failure kind `chain-start-failed`, `recordChainStartFailure` (kept and counted, resets the consecutive count, not an iteration, never `start-failed`, so never REPRODUCED) and `chainStartEvidenceLine`; hermetic cases in `test/integration/rapid-stop-up-helpers.test.ts`.
- `test/integration/rapid-stop-up-live.test.ts`: a failed settled first up (non-zero exit, not active, or a failed exec) is no longer a host stop: the request log slice, the daemon log slice, both unit journals, the Podman events, the gateway status and the load are written before the chain cleanup, the failure is counted, and a new chain starts up to the failure cap.
- `docs/integration/runtime-decision.md` (a dated paragraph, loaded host stated), `docs/integration/openshell.md` (one sentence on the new failure kind and the windows run so far), `46-EVIDENCE.md` section 9.

## What the next window must run (b, c, control at 20 each, fresh settle)

Variants b and c at 20 each and the control s, from a fresh built copy with the changed harness, as the realm account under the shared lock, both unit variables set; on a quieter host if possible, or with the load recorded; a window that contains a slow container stop (time before the sandbox delete above 7 s) is the only one that can show the F-46-1 fix live. If a settled chain start fails again, read the kept daemon log slice first (it names the exit code and stderr of the OpenShell create), then the driver and gateway journals. Proposed and not made: a driver journal line for a create refusal that carries a libpod cause, so such a refusal is not silent.

## Checks run

See the executor report: compile, hermetic tests, lint, docs and gate checks. No live step ran.
