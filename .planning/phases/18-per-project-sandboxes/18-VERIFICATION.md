# Phase 18 (per-project sandboxes): verification

Lane: gsd/v3-phase18, run 2026-11-02. Overall status: NOT VERIFIED. Plan 18-06 is BLOCKED at T1 (red build), so plans 18-08 to 18-13 were not run, and the gate set has not run on a complete phase. See 18-SUMMARY.md for the stop point.

## Per-requirement evidence

| Req | Status | Evidence in this run |
|---|---|---|
| MULTI-01 | Decision recorded; runtime not implemented | `docs/integration/runtime-decision.md` holds the per-project session decision (D5(i), accepted 2026-10-30) and the C1 to C7 rulings that plan 01 recorded (commit 4bfca1a). The runtime itself is not implemented. Not re-verified in this run. |
| MULTI-02 | Partly implemented; daemon wiring not verified | Plans 02 (86e5cc2), 04 (276e64e), 04b (ff80844), 05 (5b90aad) and 07 (e2baed6) are committed, per the earlier lane records. Plan 06, which hosts the per-project handles and the selected dispatch, is BLOCKED (T1 build, TS2305 and TS2554). The end-to-end per-project `up` refusal and per-session pin are therefore not verified on this head. |
| MULTI-03 | Not verified | Requires 18-06 (per-session handles), 18-08 (CLI selection), 18-09 (maintenance attribution), 18-10 (Omp attach) and 18-11 (two-project surface tests). None of these ran. |
| MULTI-04 | Partly implemented; docs and scenario not done | Plan 04 (276e64e) resolves the driver's sandbox mount from the workspace registry. Plan 12 (docs) and plan 13 (scenario authoring) are not started. |
| MULTI-05 | HELD for the owner's live window; not authored | Plan 13 (two-project scenario, default-skipped) is not started. Plan 14 (live checkpoint) is HELD, and no live step was run. The owner's live window is not open for Phase 18 (`.planning/STATE.md`, 2026-11-02). |
| MULTI-06 | Ledger committed; daemon wiring not verified; docs not done | Plan 03 (c7469dc) adds the aggregate admission ledger and derived `maxSessions`. The daemon wiring of `reservedCount()` and the admission path sits in plan 06, which is BLOCKED. Plan 12 (documentation of the bound) is not started. The owner's C7 setting is 4 GiB aggregate memory, 4e9 aggregate nanoCpus and 2 concurrent sessions (D18-2). |

## Plan status

| Plan | Status |
|---|---|
| 18-01 | Committed earlier (4bfca1a); not re-run |
| 18-02 | Committed earlier (86e5cc2); not re-run |
| 18-03 | Committed earlier (c7469dc); not re-run |
| 18-04 | Committed earlier (276e64e); not re-run |
| 18-04b | Committed earlier (ff80844); not re-run |
| 18-05 | Committed earlier (5b90aad); not re-run |
| 18-06 | BLOCKED at T1 (verify exit 2; `isLiveState` not exported from `src/lifecycle/controller.ts`; `test/daemon/daemon.test.ts(2449)` calls `client.up` with an argument it does not take). Uncommitted WIP saved at `gate-runs/2026-11-02-phase18/18-06-wip.patch`. |
| 18-07 | Committed earlier (e2baed6); not re-run |
| 18-08 | NOT STARTED (depends on 18-06) |
| 18-09 | NOT STARTED (depends on 18-06) |
| 18-10 | NOT STARTED (depends on 18-05, 18-06) |
| 18-11 | NOT STARTED (depends on 18-06, 18-08, 18-09, 18-10) |
| 18-12 | NOT STARTED (depends on 18-07, 18-10, 18-11) |
| 18-13 | NOT STARTED (depends on 18-07, 18-11) |
| 18-14 | HELD (human checkpoint; not reached; no step run) |

## Verify output recorded

Plan 18-06, T1 verify (`npm run build && node --test dist/test/daemon/daemon.test.js`), run once in the heavy slot under `flock -w 7200 .../heavy-slot-1.lock`, wall 302.9 s:

```
> agent-realm@0.3.26 build
> tsc -p tsconfig.json

src/daemon/daemon.ts(33,10): error TS2305: Module '"../lifecycle/controller.js"' has no exported member 'isLiveState'.
test/daemon/daemon.test.ts(2449,33): error TS2554: Expected 0 arguments, but got 1.
EXIT=2
```

Log: `gate-runs/2026-11-02-phase18/18-06-T1.log`. Because the build failed, `node --test` did not run, and no test count exists for this step.

## Gate results

Not run. The full gate set (typecheck, lint, test, build, test:integration, test:scripts, check:docs, check:gates, then build, check:pack, check:mcp) is scheduled after the last plan. The lane stopped at the red build of 18-06, so the set has not run on a complete phase. The red build above is the only gate evidence.

## HELD items and the owner decision each needs

1. **MULTI-05 and the two-project live scenario (plan 13 and plan 14).** Decision needed: open the owner live window for Phase 18, batched with Phase 17 plan 05 (`.planning/STATE.md`), under the `realmlive` account, one live run at a time, with the shared live lock. Until then no live step runs and MULTI-05 stays HELD.
2. **Plan 06 (BLOCKED).** Decision needed: authorise a bounded fix to the two compile errors (export `isLiveState` from `src/lifecycle/controller.ts`; correct the `client.up` call at `test/daemon/daemon.test.ts` line 2449) and the T2 gaps in 18-SUMMARY.md, then the lane re-runs the 18-06 verify. The plan's stop rule forbids this without that approval.
3. **T2 (d) read-only accessor in `src/realm/compose.ts`.** Decision needed: confirm that the read-only `locks` accessor on `RealmHandle` is acceptable, since compose.ts is outside plan 06's files list.
4. **Owner items from `18-HELD-OWNER.md`, unchanged by this run:**
   - (a) keep or change the `TOOL_TIMEOUT` reason text, which now also answers lock-wait expiry for `up` and `down`;
   - (b) choose a schema maximum for `startupBudgetMs`, or a client bound derived from the policy, since a policy budget above the client's `up` bound (about 230 s) lets the create outlive the client's bound (`src/daemon/channel.ts` lines 26 to 29);
   - (c) acknowledge the seven commits made before the plan-check verdict was recorded (4bfca1a to e2baed6), before any merge toward trunk.
5. **Plan 14 checkpoint.** Preconditions the owner confirms before any live run are in `18-14-PLAN.md`: Phase 17 plan 05's preconditions met or a Phase 18-only decision; the commit under test recorded; the `realmlive` stack up; the shared live lock taken.

## Commits in this run

- `fe0c231` docs(phase-18): add waitMs to the withSessionLock signature in plan 06 (plan-text fix, committed alone).
- This report commit (18-SUMMARY.md and 18-VERIFICATION.md) only. No code commit was made for plan 18-06, because its T1 verify is red.
