# Phase 18 (per-project sandboxes): verification

Branch: gsd/v3-phase18, final gate run 2026-11-02.
Overall: the full gate set is green on the phase head (`5ddc95e`, plus this documentation commit). Every plan 01 to 13 is committed. Plan 14 is HELD. The MULTI-05 live step has not run. The phase is not verified against the live stack. See `18-SUMMARY.md` for the plan table, deviations and HELD items.

## Gate results on the phase head

Run through the heavy-slot lock, in this order. Every gate exited 0 on the final pass. Logs are in `gate-runs/2026-11-02-phase18-final/` (outside the repository).

| # | Gate | Exit | Counts |
|---|---|---|---|
| 1 | `npm run typecheck` | 0 | none |
| 2 | `npm run lint` | 0 | 0 problems (first run exit 1, 80 errors, fixed in `5ddc95e`) |
| 3 | `npm test` | 0 | 2664 tests, 2630 pass, 0 fail, 34 skipped |
| 4 | `npm run build` | 0 | none |
| 5 | `npm run test:integration` | 0 | 204 tests, 172 pass, 0 fail, 32 skipped |
| 6 | `npm run test:scripts` | 0 | 301 tests, 301 pass, 0 fail, 0 skipped |
| 7 | `npm run check:docs` | 0 | host paths ok, agents sync ok, default mode ok |
| 8 | `npm run check:gates` | 0 | gate closure: 4 modules, no violations |
| 9 | `npm run build && npm run check:pack && npm run check:mcp` | 0 | MCP smoke: refused attach fail-closed (`PODMAN_MACHINE_DOWN`); status disconnected |

Not in the gate set and not run: `npm run test:coverage`, `npm run check:image-digests`. No live step was run: no `REALM_LIVE_*` variable was set and no omp, container or gateway workload was started.

## Per-requirement evidence

Counts are passing unit tests whose titles carry the requirement tag, from the `npm test` log of this run. A tag count is a count of passes, not proof of full coverage.

| Req | Status | Tagged passes | Evidence |
|---|---|---|---|
| MULTI-01 | Decision recorded; implementation committed; not tag-verified | 0 (no tagged title) | `docs/integration/runtime-decision.md` (D5(i)), plan 01 `4bfca1a`. Implementation in `86e5cc2`, `552434e`, `bd43453`. Covered by the green suite only. |
| MULTI-02 | Gate-verified | 14 | Plans 02 `86e5cc2`, 04 `276e64e`, 04b `ff80844`, 05 `5b90aad`, 06 `552434e` and `bd43453`, 08 `b42cb35`, 10 `e7c2cb6`. |
| MULTI-03 | Gate-verified | 32 | Plans 05, 06, 08 `b42cb35`, 09 `c42b312` (startup orphan attribution), 10, 11 `7eb19f7`. |
| MULTI-04 | Implemented; not tag-verified; live scenario HELD | 0 (no tagged title) | Plan 04 `276e64e` (driver mount from the registry). Plan 12 docs `a7f2ce2`, `b1378dd` (the `check:docs` gate passes). Plan 13 scenario `b18b20e`, default-skipped. |
| MULTI-05 | Unit level verified; live step HELD | 5 | Unit: two projects give distinct sandbox bindings, each pinned to its own workspace, state directory and channel directory; sandbox name length within the 19-character gateway limit; a name with a path separator is refused; ACP and MCP two-project writes land in their own project and audit file (plan 11 `7eb19f7`). Live: the two-project scenario in `test/integration/production-driver.test.ts` is gated by `REALM_LIVE_PRODUCTION` and was not run. |
| MULTI-06 | Gate-verified | 12 | Plan 03 `c7469dc` (aggregate ledger and derived `maxSessions`); plan 06 `552434e` (admission); plan 12 documents the bound. |

## Plan status

| Plan | Status | Commit(s) |
|---|---|---|
| 01 | committed | 4bfca1a |
| 02 | committed | 86e5cc2 |
| 03 | committed | c7469dc |
| 04 | committed | 276e64e |
| 04b | committed | ff80844 |
| 05 | committed | 5b90aad |
| 06 | committed (T1, T2) | 552434e, bd43453 |
| 07 | committed | e2baed6 |
| 08 | committed | b42cb35 |
| 09 | committed | c42b312 |
| 10 | committed | e7c2cb6 |
| 11 | committed | 7eb19f7 |
| 12 | committed | a7f2ce2, b1378dd |
| 13 | committed (default-skipped live scenario) | b18b20e |
| 14 | HELD (human checkpoint, not reached, no step run) | none |

The build failures recorded in the earlier lane run (`TS2305` for `isLiveState`, `TS2554` in `daemon.test.ts`) do not reproduce: the build and typecheck gates exit 0 on this head.

## HELD items and the owner decision each needs

1. **MULTI-05 live step (plans 13 and 14).** Decision: open the owner live window for Phase 18, batched with Phase 17 plan 05 (`.planning/STATE.md`). Run under the `realmlive` account, one live run at a time, under the shared live lock. Preconditions are in `18-14-PLAN.md`.
2. **Seven pre-record commits** (`4bfca1a` to `e2baed6`). Decision: acknowledge them before any merge toward trunk (`18-HELD-OWNER.md`, D18-1).
3. **Owner items** (`18-HELD-OWNER.md`): (a) `TOOL_TIMEOUT` reason text; (b) `startupBudgetMs` schema maximum or a client bound derived from policy.
4. **Phase 17 precondition:** the merge is the gate. Phase 17 plan 03 scenario 6 and skip-path checks have not run (`17-VERIFICATION.md`, rows T2 and T3).

## Unverified items

- MULTI-01 and MULTI-04 have no tagged test; their status rests on decision documents, commits and the green suite.
- Plans 01 to 05, 04b, 07 and 08 to 13 were not re-run one by one. The full gate set is the only evidence in this run.
- The 34 unit and 32 integration skips are live-gated; one skip reason names the `REALM_LIVE_*` prerequisites; the others were not reviewed individually.
- The MULTI-05 live two-project scenario has not run against a live stack.
- The audit line shape `{tool: session.destroy, outcome: ok}` needs owner review against the audit schema.
- The `isDownRequested` accessor in `src/daemon/daemon.ts` may conflict with the house tiny-function style note; owner review requested.
- The sub-agent write to the owner's main checkout (`docs/integration/omp.md`) was restored to HEAD; the diff is saved outside the repositories and was not re-inspected here.
