---
phase: 41-daemon-teardown-flake
verified: 2026-11-22
verdict: passed
status: passed
score: "2/2 requirements covered (TEAR-01, TEAR-02): TEAR-01 met (the cause is established by code reading and reproduced hermetically red-first; the live reproduction was not obtained), TEAR-02 met for the stop bounds (10 live stops on the production stack reported no failed teardown and left no residue); one live iteration failed for a reason that is not the teardown bound (F-41-1, carried); 5 items listed as behavior_unverified"
ref: "origin/main 24e7722 (PR 197, after the Plan 41-01 merge, PR 193), plus the recording change that carries this file"
behavior_unverified: 5
overrides_applied: 0
covered_files:
  - ".planning/phases/41-daemon-teardown-flake/41-CONTEXT.md"
  - ".planning/phases/41-daemon-teardown-flake/41-01-PLAN.md"
  - ".planning/phases/41-daemon-teardown-flake/41-01-SUMMARY.md"
  - ".planning/phases/41-daemon-teardown-flake/41-02-PLAN.md"
  - ".planning/phases/41-daemon-teardown-flake/41-02-SUMMARY.md"
  - "src/runtime/teardown-stages.ts"
  - "src/daemon/teardown.ts"
  - "src/lifecycle/bounds.ts"
  - "src/daemon/daemon.ts"
  - "src/daemon/channel.ts"
  - "test/runtime/teardown-stages.test.ts"
  - "test/daemon/stop-bounds.test.ts"
  - "test/daemon/channel.test.ts"
  - "test/support/daemon-stop-live.ts"
  - "test/integration/daemon-stop-live-helpers.test.ts"
  - "test/integration/daemon-stop-live.test.ts"
  - "docs/integration/runtime-decision.md"
  - "docs/integration/openshell.md"
  - "docs/policy-reference.md"
covered_digest: "v3:sha256:458e526f60441b90d9b38fe0e937a38952258bf1696e63d76e89400690d3a59d"
---

# Phase 41 Verification: daemon teardown flake

Method: a read of the files above on `origin/main` after PR 197 (`24e7722`), against TEAR-01 and TEAR-02 in `.planning/REQUIREMENTS.md` and the plans' truths, on 2026-11-18. The live results are copied from the owner-authorized window's evidence (production stack, rootless Podman 5.7.1, account `realmlive`, shared live lock), kept outside the repository and reported to the recording task. The verifier ran no live step.

What this phase is: Plan 41-01 reproduced the report `daemon.stopped code=REALM_STOPPING failedTeardowns=1` after about 30 s hermetically and fixed the bound (the stage bounds in one leaf module, `TEARDOWN_TIMEOUT_MS` derived from them as 60 s, a 2 s container stop grace, `CONTROL_TIMEOUT_MS.down` 75 s by a pinned formula); Plan 41-02 added the gated live test and ran it once. No error code, event or field was added.

## Requirements coverage

| Req | Statement | Status | Evidence |
| --- | --- | --- | --- |
| TEAR-01 | The cause of `daemon.stopped code=REALM_STOPPING failedTeardowns=1` after about 30 s is found and reproduced | MET hermetically; not reproduced live | The stage bounds of one session end (15 + 15 + 20 + 15 = 65 s with a create, 50 s without) exceeded the 30 s bound. The red-first cases R0 to R4 of `test/runtime/teardown-stages.test.ts` failed on the unchanged code at 30 s of virtual time with `REALM_STOPPING` while every stage was inside its own bound (see `41-01-SUMMARY.md`). The live baseline was not run and the original flake did not recur, so its slow stage was never recovered. |
| TEAR-02 | The stop is fixed or bounded, proved by a hermetic test and a live run | MET for the stop bounds, with F-41-1 named | Hermetic: the same cases pass after the fix, and `daemon.stopped` is pinned unchanged (`test/daemon/stop-bounds.test.ts`). Live: variant a 4 stops (9106, median 9689, 12873 ms), variant b 3 (4414, 8202, 11006 ms), variant c 3 (197, 4699, 7688 ms); `failedTeardowns` 0 in every stop that logged a row, no `code`, none near 30 s, host clean before and after. |

"Met" does not mean every live iteration passed: variant a iteration 5 failed at `realm up` (F-41-1 below). It is not a teardown-bound result, and it is recorded as failed, not retried.

## Findings

- **F-41-1.** Variant a iteration 5: `realm up` exited 1 with `OPENSHELL_START_FAILED` right after iteration 4's stop with the same sandbox name; the status notice said a previous daemon's sandbox was destroyed. Cause not established. [INFERENCE] A late supervisor or driver teardown of the previous iteration (the live test has no settle between iterations). Carried for a later plan; recorded in `docs/integration/runtime-decision.md`. `docs/integration/host-plugin-gaps.md` is for host plugin work, so it has no row.
- One variant c stop wrote no `daemon.stopped` row that the test found; why is not established. The variant's verdict does not judge the row.
- The first run of the window skipped (the variant list was not a comma list); a window fix, not a product result.

## behavior_unverified

1. **The live reproduction.** The pre-fix baseline was not run live and the original flake did not recur, so the slow stage of the original report is unknown.
2. **F-41-1.** Whether a rapid stop-start cycle on one sandbox name can fail at start on the fixed build, and why.
3. **A stop in the middle of an up can outlast the teardown bound** and is reported as `REALM_STOPPING` by design (pinned hermetically by M2, observed live only as three passing stops).
4. **Small sample on one machine.** Ten stops, one host, one commit; the load variant is synthetic and is not the load of the original report; the node version of the window was not recorded and the median-iteration stage timeline was left in the evidence.
5. **A `down` runs two teardown calls in turn, and the sessions of one daemon stop in sequence.** Neither was exercised live.

## Residuals (not verdict-blocking)

- **R1: planning bookkeeping.** This file does not edit `ROADMAP.md`, `STATE.md` or `REQUIREMENTS.md`.
- **R2: `daemon.log` or request log.** The plan named `daemon.log` for the stop rows; the daemon writes them to the request log, and the live test reads that.

## Verdict

passed, with TEAR-01 and TEAR-02 met as stated: the cause is established and reproduced hermetically, the fix is proved hermetically and on ten live stops that reported no failed teardown, and the one failed live iteration is a named finding (F-41-1) that is not a teardown-bound result. The claim is limited to what the evidence shows.


## Re-verification at main 7ae9afc (2026-11-22, autonomous)

Full local suite executed on main 7ae9afc: 5945 tests, 5849 pass, 0 fail, 96 skipped (Podman-gated). Prior verdict (passed) stands; covered files changed only by later merged phases.

_Re-verifier: Omp (main session)_
