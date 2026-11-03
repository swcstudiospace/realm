# Phase 18 (per-project sandboxes): run summary

Branch: gsd/v3-phase18, lane worktree, run 2026-11-02 (final gate run).
Status: all plans 01 to 13 are committed. Plan 14 is HELD for the owner. The full gate set is green on the phase head. The two-project live scenario (MULTI-05 live step) has not run. The phase is not verified against the live stack.

Gate evidence is in `gate-runs/2026-11-02-phase18-final/` (outside the repository, one wrapper, one log and one exit-code file per gate).

## Plan status

| Plan | Status | Commit(s) | Notes |
|---|---|---|---|
| 01 | committed | 4bfca1a | Per-project session contract (`docs/integration/runtime-decision.md`). |
| 02 | committed | 86e5cc2 | Session identity, workspace registry, runtime stateDir. |
| 03 | committed | c7469dc | Aggregate admission ledger and derived `maxSessions` (MULTI-06). |
| 04 | committed | 276e64e | Driver sandbox mount resolved from the workspace registry. |
| 04b | committed | ff80844 | Per-request workspace binding. |
| 05 | committed | 5b90aad | Selection-tagged control requests and per-client detach. |
| 06 | committed | 552434e (T1), bd43453 (T2) | Per-project sessions, selection resolution, admission, selected dispatch, session down, signal shutdown. Plan-text fix `fe0c231` (`withSessionLock` takes `waitMs`). T1 case (m) wording correction `84b6ed5`. |
| 07 | committed | e2baed6 | Pin proofs for symlink, nested, sibling, rename-aside and relative roots. |
| 08 | committed | b42cb35 | CLI addresses each project by its selection (MULTI-02, MULTI-03). |
| 09 | committed | c42b312 | Startup orphan removals attributed to their session; registry entries reaped (MULTI-03). |
| 10 | committed | e7c2cb6 | Omp attach checks the session of a refused `up` and follows a session switch. |
| 11 | committed | 7eb19f7 | Two projects on one daemon across the CLI, MCP, ACP and Omp paths (MULTI-03, MULTI-05). |
| 12 | committed | a7f2ce2, b1378dd | Documentation of per-project sandboxes, selection, switch rule and status; cleanup residue check names the scenario's own sandboxes. |
| 13 | committed | b18b20e | Two-project live scenario with derived sandbox names. Default-skipped (`REALM_LIVE_PRODUCTION` unset). |
| 14 | HELD | none | Human checkpoint for the live run. Not reached. See the HELD section below. |

Lint fix commit on the phase head, outside any plan: `5ddc95e` (see "Lint red on the first run").

## Gate results

Run in the heavy slot (`flock -w 7200 heavy-slot-1.lock`), one job at a time, in this order. The final pass ran from typecheck to pack/MCP after the last edit. Every gate exited 0.

| # | Gate | Exit | Counts |
|---|---|---|---|
| 1 | `npm run typecheck` | 0 | none |
| 2 | `npm run lint` | 0 | 0 problems (first run: exit 1, 80 errors; see below) |
| 3 | `npm test` | 0 | 2664 tests, 2630 pass, 0 fail, 34 skipped |
| 4 | `npm run build` | 0 | none |
| 5 | `npm run test:integration` | 0 | 204 tests, 172 pass, 0 fail, 32 skipped |
| 6 | `npm run test:scripts` | 0 | 301 tests, 301 pass, 0 fail, 0 skipped |
| 7 | `npm run check:docs` | 0 | host paths ok, agents sync ok, default mode ok |
| 8 | `npm run check:gates` | 0 | gate closure: 4 modules, no violations |
| 9 | `npm run build && npm run check:pack && npm run check:mcp` | 0 | MCP smoke: refused attach fail-closed (`PODMAN_MACHINE_DOWN`), status disconnected |

The skipped cases are live-gated. The skip reason shown for one case names the `REALM_LIVE_*` prerequisites. The rest of the skipped cases were not reviewed one by one.

Not in the gate set and not run: `npm run test:coverage`, `npm run check:image-digests`.

## Lint red on the first run

The first gate run stopped at lint (exit 1): 80 errors in nine files, all on lines that plans 06 to 11 added or changed. Blame attributes them to `552434e`, `b42cb35`, `c42b312`, `e7c2cb6`, `b18b20e` and `c7469dc`. Rule counts: `no-non-null-assertion` 58, `no-confusing-void-expression` 9, `no-unnecessary-condition` 7, `require-await` 3, `unified-signatures` 2, `no-unsafe-member-access` 1.

Fixed in `5ddc95e`. No lint suppression and no change to the lint config.

- `src/cli/main.ts`: removed the `takesWorkspace` guard. Its last operand was always true at that point, because every command that reaches it takes a workspace. Behavior is unchanged.
- `src/daemon/daemon.ts`: the `downRequested` guard after `await probe()` stays. The flag can change across the await, and control-flow narrowing does not track that, so the flag is now read through `isDownRequested()`.
- `src/omp/plugin.ts`: merged the `session_start` and `session_switch` overloads into one union signature. The handler type is unchanged.
- Tests (`test/daemon/daemon.test.ts`, `admission.test.ts`, `hardening.test.ts`, `workspace-registry.test.ts`, `plugin.test.ts`, `production-driver.test.ts`): non-null assertions replaced by narrowing or tuple annotations, void calls made into statements, `attach` keeps its Promise contract, and the admission test keeps its `undefined` return check. No expectation was removed.

The lane's style notes record a house rule against tiny functions (`ts-no-tiny-functions`). It is not a lint rule. The one-line `isDownRequested` accessor touches it. Owner review is requested.

## Deviations

Plan 06, recorded in the lane's reports and carried forward unchanged. This run did not re-audit them.

1. T2 (d) needed a read-only `readonly locks: LockTable` on `RealmHandle` in `src/realm/compose.ts`, which is outside plan 06's file list.
2. T2 (g): five real-socket cases were reinstated from `5b90aad^` and adapted. The client-side case "an up whose reply names another session is refused by the client" was not written.
3. T2 (f): the no-control-request part is not asserted.
4. T2 (i): the destroy line in `audit/<idA>.jsonl` is not asserted. The daemon writes no per-session destroy line; the `onAuditHead` callback fires instead.
5. Behavior change: `startDaemon` no longer builds a handle eagerly. A handle-build refusal (for example, no libpod configured) now surfaces at `up`, not at start.
6. `stopDaemon(reason?)` replaces the plan's `stop(id, socket, reason)` helper. A down that arms the stop replies through dispatch and writes nothing to a socket.
7. A socket-removal failure in `done` now rejects with `SCHEMA_INVALID`, not a refused down reply.
8. The T1 (p) lock-wait cap is 1.94 s (`clientBoundMs.up` 2000, `probeTimeoutMs` 20, `replyAllowanceMs` 20) against a 100 ms hold. The plan's wording on this conflicts with itself, so the cap is set longer than the hold.

Also:
- The audit line for session destroy has the shape `{tool: session.destroy, outcome: ok}`. It needs owner review against the audit schema.
- The lint fix above changed product source in three files.

## HELD items and the owner decision each needs

1. **MULTI-05 live step (plans 13 and 14).** Decision: open the owner live window for Phase 18, batched with Phase 17 plan 05 (`.planning/STATE.md`). Run under the `realmlive` account, one live run at a time, under the shared live lock. The preconditions are in `18-14-PLAN.md`. Not run in this lane.
2. **Seven commits made before the plan-check verdict was recorded** (`4bfca1a` to `e2baed6`, see `18-HELD-OWNER.md`, D18-1). Decision: acknowledge them before any merge toward trunk. None is merged into trunk.
3. **Owner items from `18-HELD-OWNER.md`:** (a) keep or change the `TOOL_TIMEOUT` reason text, which now also answers lock-wait expiry for `up` and `down`; (b) choose a schema maximum for `startupBudgetMs`, or a client bound derived from the policy, since a policy budget above the client's `up` bound (about 230 s) lets the create outlive the client's bound.
4. **Phase 17 precondition:** the gate requires the merge only. The Phase 17 plan 03 scenario 6 and its skip-path checks have not run (`17-VERIFICATION.md`, rows T2 and T3).

## Incident

During the run, a sub-agent wrote one line into the owner's main checkout, `docs/integration/omp.md`, which is not the lane worktree. The file was restored to HEAD. The exact diff is saved outside the repositories. This lane did not touch the main checkout; the diff was not re-inspected here.

## Disk and load

Free space on the root filesystem was read before each heavy job. It ranged from about 21.4 GB to 21.9 GB, above the 8 GiB floor. No load incident was recorded. The gate chain ran once through the heavy-slot lock, one job at a time.

## Unverified items

- Plans 01 to 05, 04b, 07 and 08 to 13: their focused suites were not re-run one by one in this run. Their coverage is through the full gate set only.
- MULTI-01 and MULTI-04: no test title carries the requirement tag. Their evidence is the decision document and the plan commits.
- The 34 unit and 32 integration skips were not reviewed individually beyond the one skip reason noted above.
- The live two-project scenario and the MULTI-05 live step have not run.
- The lint-fix test rewrites were checked by the gates (typecheck, lint and tests pass), not reviewed line by line.
- The `isDownRequested` accessor and the house tiny-function note (above).
- The audit line shape `{tool: session.destroy, outcome: ok}` against the audit schema.
- The incident diff outside the repositories.
