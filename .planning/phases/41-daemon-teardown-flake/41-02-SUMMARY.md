# Plan 41-02 Summary: the live half of the daemon teardown flake

**Executed:** 2026-11-18, the live window run by a person as the `realmlive` account on the production stack (rootless Podman 5.7.1) under the shared live lock, on main at `24e7722` (contains the Plan 41-01 fix and the live test of this plan). Evidence is kept outside the repository (`EVIDENCE_DIR`, a placeholder here; TAP output, `iterations.jsonl` and `summary.txt`); this file carries names, counts and durations only. The owner's authorization of 2026-11-18 (live windows when a phase needs them) was cited, not asked again.
**Requirements:** TEAR-01 and TEAR-02, live half.

## What was built (Task 1, merged before the window)

`test/support/daemon-stop-live.ts`, `test/integration/daemon-stop-live-helpers.test.ts` (34 hermetic cases) and the gated `test/integration/daemon-stop-live.test.ts`. No file under `src` changed in this plan. The stop under test is a SIGTERM to the one daemon pid; the daemon's stop rows are read from the request log (the plan said `daemon.log`; in production the lifecycle lines go through the request logger).

## Window (Tasks 2 to 4)

- Host before and after: 0 containers, 0 sandboxes, an empty pinned workspace, no daemon.
- Cold daemon in every iteration. The pre-fix baseline (optional Step B) was **not run live**.
- Run 1 skipped: `REALM_LIVE_STOP_VARIANTS` was not a comma list, and the test skipped naming the variable (a window fix, not a product result).
- Run 2: variants a, b, c with `REALM_LIVE_STOP_REPEATS` 5, 3 and 3.

| Variant | Iterations | Passed | stopMs (signal to daemon exit) | `failedTeardowns` | `code` | Near 30 s |
| --- | --- | --- | --- | --- | --- | --- |
| a, stop after a scratch session (one exec) | 5 | 4 (iteration 5 failed at `realm up`, see F-41-1) | min 9106, median 9689, max 12873 (4 stops) | 0 in 4 | none | 0 |
| b, the same under CPU load (one busy worker per CPU) | 3 | 3 | 4414, 8202, 11006 | 0 in 3 | none | 0 |
| c, stop in the middle of an up (observation) | 3 | 3 | 197, 4699, 7688 | 0 in 2, no row found in 1 | none in the 2 rows | 0 |

Ten stops in all. None came near 30 s. Every stop that logged a `daemon.stopped` row reported `failedTeardowns` 0 and no `code`. The follow-up up reached active in all three variant c iterations. The per-iteration stage timeline (when the container stopped and when it was gone) is in the evidence; it was not copied into the repository, so the doc record does not restate it.

## Findings

- **F-41-1 (observed, cause not established, not a teardown-bound defect).** Variant a iteration 5: `realm up` exited 1 with `OPENSHELL_START_FAILED` ("OpenShell failed to start inside the session container"), with a status notice that a previous daemon's sandbox was destroyed, right after iteration 4's stop with the same sandbox name. [INFERENCE] A late supervisor or driver teardown of the previous iteration may have reached the new sandbox; the live test has no settle between iterations (the older production live suite waits for the driver's host supervisors to go before reusing a name). Recorded as failed, not retried; carried for a later plan. It is a note here and in `docs/integration/runtime-decision.md` and in 41-VERIFICATION.md; `docs/integration/host-plugin-gaps.md` tracks host plugin work only, so no row was added there.
- Variant c iteration with no `daemon.stopped` row: why is not established; the variant's verdict does not judge the row.

## Outcome per requirement

- **TEAR-01 met, without a live reproduction.** The cause (stage bounds in turn summing to 50 s, 65 s with a create, against a 30 s bound; the sandbox delete step never added to it; the SIGTERM-ignored 10 s grace) is established by reading the code and reproduced hermetically by the red-first cases of Plan 41-01 (R0 to R4 fail on the unchanged code at 30 s of virtual time with `REALM_STOPPING`). The live baseline was not run, and the original live flake did not recur; its slow stage was never recovered.
- **TEAR-02 met for the stop bounds, with F-41-1 named.** On the fixed build 10 live stops (after a scratch session, under load, mid-up) reported no failed teardown and left no residue. The rapid stop-start start failure of F-41-1 is a separate, unexplained observation.

## Gate results

The code part of this plan (Task 1) passed build, lint, `npm run check:gates` and `node scripts/check/host-paths.mjs` before its merge. The recording change was checked with the build, the docs tests, `npm run check:docs` and `node scripts/check/host-paths.mjs` (results in the task report).

## Not done as written

- The baseline (Step B) was not run live.
- The node version of the window was not recorded.
- The stage timeline of the median iteration is not in the repository (evidence only).
- Plan wording said `daemon.log`; the test reads the request log.
