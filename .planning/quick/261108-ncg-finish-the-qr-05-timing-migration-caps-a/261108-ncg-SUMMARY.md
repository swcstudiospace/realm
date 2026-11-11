---
phase: quick-261108-ncg
plan: 01
subsystem: test-timing
tags: [QR-05, timing, tests]
requires: [test/support/timing.ts]
provides: [scaled outer caps, observed health-probe tests]
key-files:
  modified:
    - test/anda/reconnect.test.ts
    - test/runtime/driver/socket-server.test.ts
    - test/anda/listener-diagnostic.test.ts
    - test/daemon/daemon.test.ts
    - test/integration/omp-live-helpers.test.ts
decisions:
  - Health interval is fired by hand through a recording fake of setInterval (period is the fixed HEALTH_PROBE_INTERVAL_MS, no injection seam), then observed with pollUntil.
status: complete
commits: 3
plan_head_before: see git log (three commits e46b4b1, 98a20e7, 26e9470)
actuals:
  tasks: 3
  commits: 3
---

# Phase quick-261108-ncg Plan 01: Finish the QR-05 timing migration Summary

All eleven literal outer caps are now `testTimeout(N)` with the original N, and the two blind 12 s sleeps in daemon.test.ts are replaced by a hand-fired health interval plus bounded `pollUntil` observation.

## Changes

- Task 1 (e46b4b1): reconnect.test.ts (6 caps: 20000 and 5x 5000), socket-server.test.ts (4 caps, 20_000), listener-diagnostic.test.ts (1 cap, 5000) now use `testTimeout`. Behavioural timers and elapsed-time assertions untouched. No literal `timeout:` option remains in the three files.
- Task 2 (98a20e7): new local helper `healthIntervals(t)` in daemon.test.ts records only `setInterval` calls whose period is `HEALTH_PROBE_INTERVAL_MS` (placeholder never-firing timer returned; `clearInterval` of a placeholder marks it cleared; everything else passes through to the real functions; placeholders cleared in `t.after`). "OBS-02: a probe that resolves in error is logged" fires once and polls for the `health.probe_failed` log row, then asserts code `OPENSHELL_GATEWAY_LOST` unchanged. "OBS-03: a probe that returns probe failed is counted" fires once and polls the `metrics` request for a `probe failed` row, then asserts the row with count exactly 1 unchanged. No `12_000` remains in the file.
- Task 3: typecheck, lint and check:gates run clean.

## Deviations from Plan

**1. [Orchestrator scope addition - latent race] omp-live-helpers safety-net kill (26e9470)**
- Issue: in test/integration/omp-live-helpers.test.ts the `t.after` safety net did `if (isAlive(pid)) process.kill(pid, "SIGKILL")`; the process can exit between the check and the signal, throwing `kill ESRCH` under load.
- Fix: small helper `killIfPresent(pid, signal)` swallows only `ESRCH` and rethrows everything else; used at the hook. That was the only signalling site after an `isAlive` check in the file (the other `process.kill` call is the signal-0 probe inside `isAlive`, which already handles ESRCH).
- Files: test/integration/omp-live-helpers.test.ts.

## Verification (run through the heavy-slot lock)

- `npm run typecheck` exit 0; `npm run lint` exit 0; `npm run check:gates` exit 0 (gate closure and module size clean).
- `npm run build` exit 0.
- Compiled reconnect, socket-server and listener-diagnostic suites: 36 tests, 36 pass (socket-server file shown at tail; combined run exit 0).
- The two daemon tests alone: 2 pass. Whole daemon.test.js: 101 tests, 101 pass, 15.9 s.
- omp-live-helpers.test.js run 6 times: exit 0 each time.

## Known Stubs

None.

## Self-Check: PASSED
