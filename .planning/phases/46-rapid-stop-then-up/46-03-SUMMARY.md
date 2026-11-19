---
phase: 46-rapid-stop-then-up
plan: "03"
status: executed
requirements: [STOP-02, STOP-03]
---

# Plan 46-03 summary (OTHER-FAILURE branch: F-46-1)

Executed under the OTHER-FAILURE branch of the window outcome: the work is on the new finding F-46-1 (AGENTOS_STOP_FAILED at about 13 s), not on F-41-1, which was not reproduced and stays carried. Not committed. No live step ran.

## Cause (from the evidence only; see `46-EVIDENCE.md` section 4)

The stage that holds the time in the 6 failed stops is the libpod container stop. A typical stop leaves the container `stopping` for about 3 s; in 9 of 52 stops it took about 7 to 12 s, with Podman's own state commands blocked for the same interval (and the compute driver's Podman poll failing with PODMAN_MACHINE_DOWN in all 6 failed stops and in none of the others). The stop request is bounded at 7 s (5 s plus the 2 s grace) and a missed bound is thrown as PODMAN_MACHINE_DOWN; `containerStep` reported any request failure as a failed step without re-reading the container. Classification: a request bound too tight for an occasional slow container stop, plus a failure report that did not re-read the container. Not a hang (the container ended in at most about 12 s, the sandbox delete ran and succeeded, zero residue), not an ordering defect, not an orphan. [INFERENCE] The failed step is that request and its cause code is PODMAN_MACHINE_DOWN: no file of the window recorded the cause code. Why Podman is slow in those stops is not established.

## Fix

- `src/runtime/teardown-stages.ts`: `CONTAINER_END_CONFIRM_MS` (10 s, derived from the longest observed stop of 11.9 s against the 7 s request bound: 5 s past it, doubled), `CONTAINER_CONFIRM_POLL_MS` (500 ms), and a new stage `containerConfirm` in the session-end worst case: `SESSION_END_WORST_CASE_MS` 57 000 to 67 000 ms, so `TEARDOWN_TIMEOUT_MS` is 70 000 ms.
- `src/runtime/session-execution.ts`: `containerStep` splits the inspect from the stop or removal request. When the request fails with PODMAN_MACHINE_DOWN, `containerEnded` reads the container state every 500 ms for at most `CONTAINER_END_CONFIRM_MS` and the step succeeds only when the container has ended (a stop: state exited, stopped, created or configured, or gone; a removal: gone). A container still live at the bound, a state that cannot be read, and any failure other than a missed bound keep the failed step with the same code and cause as before. The wait is spent only after a miss. Every wait has an explicit bound and fails closed; the sandbox delete still runs after the container step; no orphan is possible that the next start's reap could not clear.
- `src/daemon/channel.ts`: `CONTROL_TIMEOUT_MS.down` 75 000 to 85 000 ms (the pinned formula is the teardown bound plus twice the reply allowance plus 5 s); the daemon's lock wait for a down is derived and becomes 80 000 ms.
- `test/integration/rapid-stop-up-live.test.ts` and `test/support/rapid-stop-up.ts`: the harness daemon exit bound is 100 s (5 s drain, 70 s teardown, 25 s margin); a failing `realm down` after a variant c iteration is the failure kind `down-failed` (kept, counted, its output written) instead of a chain abort, with hermetic cases in `test/integration/rapid-stop-up-helpers.test.ts`.
- Unchanged: the `daemon.stopped` row, the 29-code error catalogue, the compute driver contract, the sandbox delete order.
- Docs: `docs/policy-reference.md` (teardown bound 70 000 ms and its derivation), `docs/integration/runtime-decision.md` (the Phase 46 live result, F-46-1 with cause, fix and limits, the `down` bound), `46-EVIDENCE.md`.

## Red first

`test/runtime/container-stop-confirm.test.ts` was written and run against the unchanged source: 5 pass, 2 fail (exit non-zero). The first failing assertion: "the container ended, so the stop reports no failure" (the stop threw AGENTOS_STOP_FAILED although the container ended after the request missed its bound); the second failing case is the same for a destroy. Command: node --test on the compiled test file. With the fix all cases pass.

## What this does not show

That the fix removes the failure live; that 10 s covers every slow stop (9 slow stops, one host, one window); why Podman's stop is slow; any F-41-1 cause. A stop slower than 17 s (7 s plus 10 s) still fails closed and says so. The SIGTERM-during-startup candidate (E-46-09) was not observed and is not changed.

## What plan 46-04 must run

The Phase 46 harness (a failing post-iteration `realm down` in variant c is now a counted failure kind, not an abort): variant a at least 20 consecutive stop-then-up iterations with zero OPENSHELL_START_FAILED, `failedTeardowns` 0 in every `daemon.stopped` row and zero residue; variants b and c at 20 each as the no-regression check; the control s only if a failure appears. Keep the driver journal and the container samples of any stop that fails. If a stop fails again, record the cause code of the failed step: one more capture is proposed for that case (a log line of the failed step and its cause code), not added now.
