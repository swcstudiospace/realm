# Plan 41-01 Summary: the hermetic half of the daemon teardown flake

**Executed:** 2026-11-18, on `origin/main` at `e64f39c` (v0.6.0), branch `gsd/phase-41-exec1`. Nothing was committed by the executor.
**Requirements:** TEAR-01 and TEAR-02, hermetic half. The live half is Plan 41-02.

## Cause (TEAR-01)

The stages of one session end run in turn, each under its own bound, and their bounds summed to more than the 30 s teardown bound. A stop that spends its stages near their bounds was cut off by two timers that expire together (the daemon's `withTimeout` in `stopSessions` and the controller's `teardownCall`), and both report `REALM_STOPPING`, naming no stage.

| Stage | Bound before | Bound after |
| --- | --- | --- |
| wait for a create in flight (only while one is in flight) | 15 s | 15 s |
| AgentOS stop | 15 s | 15 s |
| container step: inspect 5 s, then stop 5 s plus the grace | 5 + 5 + 10 = 20 s | 5 + 5 + 2 = 12 s |
| sandbox delete | 15 s | 15 s |
| **sum** | 50 s (65 s with a create) | 42 s (57 s with a create) |
| teardown bound | 30 s | 60 s (57 s plus a 3 s margin, derived) |

[INFERENCE] The live report (`daemon.stopped code=REALM_STOPPING failedTeardowns=1` after about 30 s) is explained by this arithmetic: the sandbox delete step (2026-10-26) was never added to the 30 s of the 2026-10-21 derivation, and the container stop spends its whole 10 s grace because the sandbox runtime ignores SIGTERM. The hermetic reproduction shows the bound is too small for stages that are each inside their own bound; which stage was slow on the live host is Plan 41-02's evidence.

## Red run (the TEAR-01 reproduction)

Run on the tree of Tasks 1 and 2 (the refactor with no value changed, plus the new tests), before any value changed: `node --test dist/test/runtime/teardown-stages.test.js dist/test/daemon/stop-bounds.test.js dist/test/daemon/channel.test.js` gave 45 tests, 40 pass, 5 fail. The daemon cases D1 to D4, M1, M2 and the channel formula pass; the five failures are exactly the cases expected red:

```
✖ R0: the teardown bound is not below the worst case of the stages that run in turn
  AssertionError: TEARDOWN_TIMEOUT_MS is 30000 ms against a stage worst case of 65000 ms
✖ R1: every stage just inside its own bound still ends the session, with no REALM_STOPPING
  AssertionError: the end settled at 30000 ms of virtual time with code REALM_STOPPING, every stage inside its own bound
✖ R2: a slow but ordinary host (the container ignores SIGTERM and spends its whole grace) still ends the session
  AssertionError: the end settled at 30000 ms of virtual time with code REALM_STOPPING
✖ R3: a stage that runs out of its own bound reports its own code before the teardown bound expires
  AssertionError: the end settled at 30000 ms of virtual time with code REALM_STOPPING
  actual 'REALM_STOPPING', expected 'AGENTOS_STOP_FAILED'
✖ R4: stop mode asks libpod for the grace the constant names, and that grace is the force-removal grace or less
  AssertionError: the stop grace is 10000 ms and the runtime ignores SIGTERM, so more than 2000 ms is dead time
```

R1 to R3 run the real `LifecycleController` over the real `SessionExecution` with the mock clock on `setTimeout` only; the stages are held calls released after the scripted cost.

## Changes (Tasks 1 to 3)

- New `src/runtime/teardown-stages.ts`: `AGENTOS_STOP_DEADLINE_MS` 15 000, `CONTAINER_STOP_GRACE_MS` (10 000 then 2 000), `SANDBOX_DELETE_DEADLINE_MS` 15 000, the stage bounds and `SESSION_END_WORST_CASE_MS`.
- New `src/daemon/teardown.ts`: `stopSessions`, the sequential bounded stop loop moved verbatim out of `closeEverything` (`src/daemon/daemon.ts` now 974 lines, down from 986; `src/lifecycle/controller.ts` untouched).
- `teardownTimeoutMs` seam on `BuildDaemonHandleOptions` (inherited by `StartDaemonOptions`), `CreateRealmHandleOptions` and the test rig; never read from the environment.
- Values changed: `TEARDOWN_TIMEOUT_MS` 30 000 to 60 000 (derived: `SESSION_END_WORST_CASE_MS` plus a private 3 000 margin), `CONTAINER_STOP_GRACE_MS` 10 000 to 2 000, `CONTROL_TIMEOUT_MS.down` 45 000 to 75 000 (pinned to `TEARDOWN_TIMEOUT_MS + 2 * DAEMON_REPLY_ALLOWANCE_MS + 5_000` in `test/daemon/channel.test.ts`).
- The startup reap's gateway delete deadline now uses `SANDBOX_DELETE_DEADLINE_MS` (same 15 s).
- Docs: `docs/policy-reference.md` (values, new `SANDBOX_DELETE_DEADLINE_MS` row), `docs/integration/runtime-decision.md` (`daemon.stopped` bullets, 75 s, C11 rewritten from the code, new "Teardown budget (Phase 41, 2026-11-18)" paragraph).

## Pre-fix commit

Not available: the executor was told not to commit, so Tasks 1 and 2 are uncommitted in the worktree. The pre-fix state is `e64f39c` plus the refactor and tests of Tasks 1 and 2; whoever commits should commit Tasks 1 and 2 before Task 3's three value edits if Plan 41-02's optional baseline needs a hash.

## Not done as written

- `SESSION_END_STAGE_BOUNDS_MS` is not exported: the export-usage gate fails a self-only export, and no other module reads it. `SESSION_END_WORST_CASE_MS` is exported (read by `src/lifecycle/bounds.ts` and `test/runtime/teardown-stages.test.ts`). During Task 1 alone the gate listed `SESSION_END_WORST_CASE_MS` as test-only (its importer arrives in Task 3); after Task 3 the gate passes.
- `scripts/check/export-usage-allowlist.json`: removed the two entries `src/runtime/libpod-client.ts#DEFAULT_REQUEST_TIMEOUT_MS` and `#FORCE_REMOVE_STOP_GRACE_SECONDS`, which became stale when `teardown-stages.ts` (a src module) started importing them.
- Tests ran as root, not as a regular user (the worktree is under the root home); the new tests create only temporary directories and use no permission behaviour.

## Gate results

Run on the final tree: `npm test` (tsc build plus all suites) 5239 tests, 5161 pass, 0 fail, 78 skipped; `npm run test:scripts` exit 0; `npm run lint` exit 0; `npm run check:docs` exit 0; `npm run check:gates` exit 0 (gate closure, module size, export usage with 0 failing and 0 stale, lockfile). The Task 3 targeted suites (the two new files plus channel, main, daemon, controller, create-interrupt, teardown-failures and session-execution) passed 326 of 326.

## Open items

- OQ-41-02, the mid-up bound: a stop in the middle of an up can outlast the bound and is reported as `REALM_STOPPING` (M2 pins it; the late container is destroyed once its create returns).
- The two teardown calls of `down` still run in turn, each under the bound.
- Sessions of one daemon still stop sequentially.
- The live proof is Plan 41-02.
