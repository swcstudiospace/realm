# Phase 59: Concurrent binding implementation - Context

**Gathered:** 2026-11-20, from `.planning/phases/53-concurrent-binding-design/53-DESIGN.md` (frozen design, §3 failure modes, §4 code surfaces, §5 decision record D-53-H1..H6), `.planning/MILESTONE-CONTEXT.md` (D-v9-6, Ordering and dependencies), `.planning/REQUIREMENTS.md` v9.0 (CBIND-01..03, CBIND-03 row), and `.planning/phases/55-omp-plugin-health-check/55-PLAN.md` (format model).
**Status:** Planned (planning artifacts only; no code executed, no gate run).

## Phase Boundary

**Goal.** Implement the cross-process workspace binding lock from the frozen Phase 53 design so that at most one live binder holds a workspace at a time, across processes. This closes CBIND-03. Nothing today stops two processes from binding the same workspace concurrently: the in-process `LockTable` dies with its process and `withSessionLock` is per-process (53-DESIGN §0).

**Gate status: RATIFIED 2026-11-22.** Owner ratified D-53-H1..H6 (D-v9-6) on 2026-11-22; waves 1-3 are unblocked. CBIND-01..02 are closed by this ratification record; CBIND-03 closes on the implementation (59-01.3 step 4).

**Out of scope:** any surface outside the frozen inventory below; any design re-decision (re-picking a D-53-Hn row is a design change, not an implementation change); live proof beyond what the hermetic and enumerating tests cover.

## Frozen surface inventory (53-DESIGN §4)

Each surface below appears exactly once in this inventory. The implementation touches only these surfaces; §4.2 contract effects are unchanged (session record unchanged, registry entry unchanged at v1, no new catalogue code, no migration, no compatibility shims).

| # | Surface | Frozen change |
|---|---------|---------------|
| S1 | `src/session/paths.ts` | Add `bindingsDirOf(stateDir)` and `bindingLockPathOf(stateDir, sessionId)` (the `isSessionId` gate applied, as `checkpointSessionDirOf` does). Nothing else. |
| S2 | New `src/session/workspace-binding.ts` | Carries acquire / release / takeover for the binding lock, modeled on `checkpoint-lock.ts` (same write-sync-then-`link(2)` publish protocol, same provably-gone rule, same cap of 3 takeover attempts), *not* by extending that module. Lock record: `schema`, `pid`, `startTicks`, `bootId`, plus `sessionId`, `dev`, `ino`, at `<stateDir>/bindings/<sessionId>.lock`. |
| S3 | `src/lifecycle/controller.ts` | Acquire the binding before create / start; release on destroy and on the settled-failed-create path. The existing boot-id check stays; the binding makes it reachable. |
| S4 | `src/daemon/sessions.ts` | `resolveSelection` unchanged (it derives identity; the binding lock is beneath it). `withSessionLock` stays the in-process serializer; the binding lock is the cross-process layer beneath it. `reserveAdmission` / `settleFailedCreate` ordering preserved so a settled failure releases the binding before the entry is removed. |
| S5 | `src/session/reap.ts` | Precondition only: the D-87 rule extends to "no binder exists before the reap". The reap deletes no binding lock file of an adopted session; takeover handles the rest. |
| S6 | Audit / log attribution | Additive and optional only, following the `upId` / `phase` precedent: the binding's identity (session id, binder pid / boot) is recorded on `up.begin` / `up.end` and as an optional audit field. A line written before this change still parses; an unbound call carries no field. |
| S7 | `src/session/workspace-registry.ts` | Reused as-is: pinning, entry read, `verifyWorkspaceEntry`. No field added, no schema change. |
| S8 | `src/session/proc-identity.ts` | Reused as-is (`currentBootId`, `startTicksOf`). |
| S9 | `src/fs/locks.ts` (`LockTable`) | **Not touched.** In-memory and per-process by design (D-33); the binding lock does the cross-process work. Extending it would be a second convention for one problem. |

**No new catalogue code.** Reused only: `LOCK_CONFLICT` (live holder refuses outright), `TOOL_TIMEOUT` (bounded wait expires on the `up` path), `POLICY_DENIED` (nested roots, or pin mismatch / grant-then-swap), `CLEANUP_FAILED` (a temporary owner file that cannot be removed refuses the acquisition). A non-regular or empty lock file, or a malformed record, is refused `LOCK_CONFLICT`, never followed. No shims: no dual-write, no fallback read path, no deprecated alias — the binding lock is the one place the claim lives.

## Binding semantics carried forward (53-DESIGN §1, §3)

- A binding is the tuple `(workspaceDev, workspaceIno, sessionId, bootId, binderPid, binderStartTicks)`; at most one live binder holds a workspace (D-53-H1).
- Conflict: same workspace under any alias canonicalizes to the same `(dev, ino)`, the same session id and the same lock path — serialized, no alias bookkeeping. Nested roots: the second bind is refused `POLICY_DENIED` before any lock is taken (D-53-H4).
- Wait: bounded FIFO per binding key, reusing the caller's existing bound via `upLockWaitMs` / `downLockWaitMs`; no new wait constant, no unbounded wait (D-53-H2, D-53-H3). On grant the binder re-verifies the registry pin and its own `(dev, ino)` before creating anything.
- Stale takeover: provably gone only (boot differs, pid dead with `ESRCH`, `EPERM` counts as alive, or start ticks differ), capped at 3 attempts; a live or unprovable owner is `LOCK_CONFLICT`. Cleanup failure refuses with `CLEANUP_FAILED` and releases any lock already published, so a refused acquisition holds no lock.

## Hermetic test inventory

Tests assert observable behaviour; no source-text tests. The following hermetic tests are required; each is red-first in `59-PLAN.md`.

1. **Alias contention** — two binders opening two alias paths to one directory contend on the same lock path; the loser waits bounded or is refused `LOCK_CONFLICT`; no container is created outside a binding.
2. **Stale takeover, cap 3** — a lock file naming a provably-gone binder is taken over on the same rules as `takeOverProvablyGone`; a live or unprovable owner (unreadable `/proc` stat, non-regular or empty lock file, malformed record) is never taken over (`LOCK_CONFLICT`).
3. **Nested-root refusal** — a candidate root that is an ancestor or descendant of a currently bound root is refused `POLICY_DENIED` before any lock is taken, including across devices and nesting created after the first bind.
4. **Expired wait, `TOOL_TIMEOUT`** — a waiter whose `upLockWaitMs` / `downLockWaitMs` bound fires before the grant leaves the queue and is refused `TOOL_TIMEOUT` for an `up` whose lock wait expired.
5. **Grant-then-swap refused** — a waiter granted the lock whose directory was moved or replaced while it waited is refused `POLICY_DENIED` on the pre-create re-verification; the granted lock is released and the next waiter is granted.

## Success criteria for CBIND-03

- Every frozen surface S1–S9 is implemented exactly as inventoried above, with `LockTable` untouched and no new catalogue code; the error catalogue stays at 29 codes.
- Ratification of D-53-H1..H6 is recorded with a date before any code lands; CBIND-01..02 close on that ratification, CBIND-03 on the implementation.
- A second binder for a held workspace never creates a sandbox; alias, stale-takeover, nested-root, expired-wait and grant-then-swap behaviour is pinned by the hermetic tests above.
- No contract change: session records and registry entries from before this phase remain valid; a workspace with no binding lock file binds fresh; enumerating tests and docs update in the same pull request as any enumerating surface.

## Decisions

- **D-59-1 (owner D-v9-6):** implement only the frozen §4 surfaces, only after ratification is recorded with a date; no wave starts before that record exists.
- **D-59-2:** waves are disjoint by file (see `59-PLAN.md`); a later wave does not edit an earlier wave's files, so each wave can be reviewed and shipped independently.
- **D-59-3:** the binding lock is modeled on `checkpoint-lock.ts` without extending it; conflating checkpoint and workspace claims would let a checkpoint release a workspace (53-DESIGN §4.1).

## Risks and limits

- If ratification rejects a D-53-Hn pick, the affected row is re-picked and `53-DESIGN.md` is re-frozen; this plan is then revised to the re-frozen §4 before any code. The rejected pick is recorded as superseded, never deleted.
- Live proof of two processes binding one workspace concurrently is not in this phase's required tests; the hermetic suite pins the observable refusal codes, and any live run follows the no-live-run rule of the planning step that produced these artifacts.
