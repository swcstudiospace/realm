# Phase 18 (per-project sandboxes): lane run summary

Lane: gsd/v3-phase18, worktree /root/src/repos/agent-realm-lanes/v3-phase18, run 2026-11-02.
Status: BLOCKED at plan 18-06, task T1. Plans 18-08 to 18-13 were not started; plan 18-14 is HELD. The full gate set was not run, because the stop rule forbids advancing past a red verify.

## Plan status

| Plan | Status | Commit | Notes |
|---|---|---|---|
| 18-01 | committed earlier | 4bfca1a | Session contract docs. Not re-run in this lane. |
| 18-02 | committed earlier | 86e5cc2 | Session identity, workspace registry. Not re-run in this lane. |
| 18-03 | committed earlier | c7469dc | Aggregate admission ledger (MULTI-06). Not re-run in this lane. |
| 18-04 | committed earlier | 276e64e | Driver mount from the workspace registry. Not re-run in this lane. |
| 18-04b | committed earlier | ff80844 | Per-request workspace binding. Not re-run in this lane. |
| 18-05 | committed earlier | 5b90aad | Selection-tagged control requests. Not re-run in this lane. |
| 18-06 | BLOCKED (T1 verify red) | none | Source and tests written, uncommitted. See below. |
| 18-07 | committed earlier | e2baed6 | Pin proofs for symlink, nested, sibling and relative roots. Not re-run in this lane. |
| 18-08 | NOT STARTED | none | Depends on 18-06. |
| 18-09 | NOT STARTED | none | Depends on 18-06. |
| 18-10 | NOT STARTED | none | Depends on 18-05 and 18-06. |
| 18-11 | NOT STARTED | none | Depends on 18-06, 18-08, 18-09, 18-10. |
| 18-12 | NOT STARTED | none | Depends on 18-07, 18-10, 18-11. |
| 18-13 | NOT STARTED | none | Depends on 18-07, 18-11. Authoring of the gated two-project scenario has not begun. |
| 18-14 | HELD | none | Human checkpoint. Not reached. See 18-VERIFICATION.md. |

The plan-text fix in 18-06 (the `withSessionLock` signature now takes `waitMs`) is committed on its own as `fe0c231` (`docs(phase-18)`).

## Plan 18-06: where it stopped

The implementation pass produced the source for T1 and T2, with the test cases the plan names, but the lane owner ran the first T1 verify command (`npm run build && node --test dist/test/daemon/daemon.test.js`) in the heavy slot. It exited 2 at the build step:

```
src/daemon/daemon.ts(33,10): error TS2305: Module '"../lifecycle/controller.js"' has no exported member 'isLiveState'.
test/daemon/daemon.test.ts(2449,33): error TS2554: Expected 0 arguments, but got 1.
```

Under the plan's stop rule, plan 18-06 stops at T1. No further edits were made to it and no dependent plan was started. The uncommitted work (12 modified files and one new file, `src/daemon/sessions.ts`) is kept as a patch at `/root/src/repos/agent-realm-lanes/gate-runs/2026-11-02-phase18/18-06-wip.patch`, outside the repository. Nothing from 18-06 is committed.

Known gaps in the 18-06 test set, separate from the compile errors:
- T2 (d) needed one read-only accessor, `readonly locks: LockTable` on `RealmHandle` in `src/realm/compose.ts`. That file is outside the plan's files list. It is recorded here as a deviation.
- T2 (g): five real-socket cases were reinstated from 5b90aad^ and adapted. The client-side case "an up whose reply names another session is refused by the client" is not written.
- T2 (f): the no-control-request part is not asserted.
- T2 (i): the destroy line in `audit/<idA>.jsonl` is not asserted; the daemon writes no per-session destroy line, and the `onAuditHead` callback fires instead.
- Behaviour change: `startDaemon` no longer builds a handle eagerly, so a handle-build refusal (for example, no libpod configured) surfaces at `up`, not at start.
- `stopDaemon(reason?)` replaces the plan's `stop(id, socket, reason)` helper; a down that arms the stop replies through dispatch and writes nothing to a socket.
- A socket-removal failure in `done` now rejects with `SCHEMA_INVALID`, not a refused down reply.
- The T1 (p) lock-wait cap is 1.94 s (`clientBoundMs.up` 2000, `probeTimeoutMs` 20, `replyAllowanceMs` 20) against a 100 ms hold. The plan's wording conflicts with itself here ("held longer than a short lock-wait cap" versus "both attach"), so the cap is set longer than the hold.

To unblock, the owner would need to authorise a fix to the two compile errors and the T2 gaps above, then the lane re-runs the 18-06 verify commands. Until then, plan 18-06 is BLOCKED.

## Gate results

| Gate | Where | Exit | Evidence |
|---|---|---|---|
| `npm run build` (inside the 18-06 T1 verify) | lane worktree, uncommitted 18-06 WIP on fe0c231 | 2 | Log: `gate-runs/2026-11-02-phase18/18-06-T1.log`; two TS errors above |
| `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:integration`, `npm run test:scripts`, `npm run check:docs`, `npm run check:gates`, `npm run check:pack`, `npm run check:mcp` | lane head | not run | Not run. The stop rule holds the lane at the red build, and the set runs once after the last plan. |

The build result is for the working tree with the 18-06 WIP, not the committed head. The committed head was not separately gated in this run.

## Operational notes
- Disk floor: 13.5 GB free at the start of the heavy job, above the 8 GiB floor.
- Heavy slot: `flock -w 7200 /root/src/repos/agent-realm-lanes/heavy-slot-1.lock`, one job at a time, used once.
- No push, fetch, GitHub write, merge, rebase, reset, `npm ci` or lockfile change. Nothing was committed except the plan-text fix and the two reports.
