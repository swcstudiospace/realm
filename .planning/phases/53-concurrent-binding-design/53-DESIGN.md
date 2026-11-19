# Design 53: Concurrent binding of sandboxes to workspaces (CBIND-01, CBIND-02)

**Date:** 2026-11-19. **Phase:** 53-concurrent-binding-design. **Scope:** design only; no code, no contract change in this phase.
**Status:** frozen design, pending HITL owner ratification. Per 53-PLAN step 3 and D-53-4, CBIND-01..02 close only when the owner approves this design. Each item below carries the decision that settled it, recorded as `D-53-H1`…`D-53-H6` (table in §4). No item is left open in this design; the D-53-3 candidate questions are answered in §4 with the pick and the rejected alternatives.

## 0. Current state (what exists today)

- **One session binds one project workspace.** `sessionIdOfWorkspace(canonicalPath)` (`src/session/paths.ts`) derives the session id as `p` + the first 12 hex chars of the SHA-256 of the canonical path, so every alias of one directory names the same session. The workspace registry entry `<stateDir>/workspaces/<sessionId>.json` pins `{schema, sessionId, workspaceRoot, dev, ino}` (`src/session/workspace-registry.ts`), and `verifyWorkspaceEntry` re-checks the pin at bind time (a moved or replaced directory is `POLICY_DENIED`).
- **The daemon binds in process.** `resolveSelection` (`src/daemon/sessions.ts`) is the one place that binds, verifies and derives a project's identity; `withSessionLock` serializes admission/teardown of one id in process, FIFO, with a bounded wait (`upLockWaitMs`/`downLockWaitMs`) and `TOOL_TIMEOUT` on expiry. `reserveAdmission`/`settleFailedCreate` keep the admission ledger in step with the registry.
- **The checkpoint/start lock is the cross-process precedent.** `src/session/checkpoint-lock.ts` publishes an owner record (`pid`, start ticks, boot id) at `<stateDir>/checkpoints/<sessionId>/.lock` via write-sync-then-`link(2)`, so the lock path either does not exist or holds the full record. Takeover only when the owner is provably gone (pid dead, start ticks differ, boot differs), capped at 3 attempts; a live or unprovable owner is `LOCK_CONFLICT`. `src/session/proc-identity.ts` supplies `currentBootId()` and `startTicksOf()`. The controller already checks `record.bootId !== currentBootId()` (`src/lifecycle/controller.ts`).
- **Single-daemon precondition.** The startup reap (`src/session/reap.ts`) must run before any `LifecycleController`/`ToolDispatcher` exists, and only one host daemon may own the state directory (D-87, OQ-P4-06 in `docs/integration/runtime-decision.md`); a second daemon fails binding the control socket with `LOCK_CONFLICT` before its maintenance runs.
- **The gap.** Nothing today stops two *processes* (two agents, or an agent and a stale daemon) from binding the same workspace concurrently: the in-process `LockTable` (`src/fs/locks.ts`) dies with its process, and `withSessionLock` is per-process. This design closes that gap.

## 1. Binding semantics (CBIND-01a) — D-53-H1, D-53-H2, D-53-H3, D-53-H4

### 1.1 What binds

A binding joins four things into one exclusive claim:

1. **Workspace identity** — the `(dev, ino)` pair of the canonical realpath's directory, as pinned in the registry entry. The path string is never the identity; the inode pair is.
2. **Session id** — derived by `sessionIdOfWorkspace` from the canonical path, never chosen, never stored as authority. Equal `(dev, ino)` under any alias path yields the same session id, so aliases cannot fork a binding.
3. **Binder identity** — the binding process: `(pid, startTicks, bootId)` from `proc-identity.ts`. Boot id distinguishes a pid reused after reboot from a live process; start ticks distinguish a pid reused within one boot.
4. **The sandbox** — `realm-<sessionId>`, created only while the binding is held. The controller acquires the binding before any port create and releases it on destroy, so no container exists outside a binding.

**Rule (D-53-H1): a binding is the tuple `(workspaceDev, workspaceIno, sessionId, bootId, binderPid, binderStartTicks)`. At most one live binder holds a workspace at a time.**

### 1.2 What conflicts

- **Same workspace, any alias.** Two binders canonicalizing different alias paths to the same `(dev, ino)` request the same session id and the same binding lock: direct conflict, serialized by §1.3. No action is taken on the alias string — there is no alias list and no special case.
- **Same session id, different `(dev, ino)`.** A directory replaced at the same path after pinning: the registry pin check fails and the bind is refused `POLICY_DENIED` (existing behaviour in `verifyWorkspaceEntry`). The binder never writes a registry entry whose `(dev, ino)` differs from the directory it opened.
- **Nested roots (D-53-H4).** If a candidate workspace root is an ancestor or descendant of a currently bound root, the second bind is refused `POLICY_DENIED`, naming neither — the refusal is shape, not contention. Accepted alternative considered: independent bindings for parent and child. Rejected: the workspace mount and the one-session-per-project rule make parent/child sandboxes overlap the same files, and the design must stay boring. Refusing the second bind keeps the invariant "one bound root per directory tree" without new machinery.

### 1.3 What waits

- **Bounded, FIFO, per binding key** (D-53-H2, D-53-H3). A second binder for a held workspace queues behind the holder in arrival order — the same discipline as `withSessionLock` — but the wait is bounded by the caller's own existing bound, reused exactly: `upLockWaitMs` for `up`, `downLockWaitMs` for `down` (client bound less probe budgets and reply allowance). **No new wait constant, no unbounded wait.**
- **Expiry.** A waiter whose timer fires before the grant leaves the queue and is refused with the existing code for the call: `TOOL_TIMEOUT` for an `up` whose lock wait expired (matching `withSessionLock`), `LOCK_CONFLICT` for a binder that finds a live holder and has no wait budget. No new error code.
- **Grant and release.** The holder releases the binding on destroy or on settled failed create (`settleFailedCreate` path); the next waiter is granted FIFO. A waiter granted the lock re-verifies the registry pin and its own `(dev, ino)` before creating anything, so a grant after a directory swap is refused `POLICY_DENIED`, not bound to the wrong directory.

## 2. Identity of a binding: stored vs derived (CBIND-01b) — D-53-H1, D-53-H5

| Part | Derived or stored | How |
| --- | --- | --- |
| session id | derived | `sessionIdOfWorkspace(canonicalPath)`; the registry read refuses any entry whose id does not derive from the presented id |
| workspace `(dev, ino)` | stored, re-verified | registry entry `{schema, sessionId, workspaceRoot, dev, ino}`; re-checked by `verifyWorkspaceEntry` at every bind |
| binder `(pid, startTicks, bootId)` | stored in the binding lock file | owner record published whole by the same write-sync-then-`link(2)` protocol as the checkpoint lock; liveness re-derived from `/proc` on each check, never trusted from the file alone |
| sandbox name | derived | `realm-<sessionId>` |

**Storage (D-53-H5).** The binder identity lives in a new per-session binding lock file, `<stateDir>/bindings/<sessionId>.lock`, published with the checkpoint lock's protocol and holding the same owner-record shape (`schema`, `pid`, `startTicks`, `bootId`, plus `sessionId`, `dev`, `ino` so a lock file cannot be renamed onto another session and still validate). **The registry entry is unchanged** — no new field, no schema bump — and the **session record is unchanged** (see §3). A binding with no lock file simply does not exist yet; nothing is migrated.

## 3. Failure modes (CBIND-01c)

Each mode states the rule the future implementation follows, the code the loser sees, and the decision that settled it.

1. **Stale binder after crash (D-53-H2).** The lock file names a binder; the binder died without releasing. The next binder checks liveness exactly as `takeOverProvablyGone` does: boot differs, pid dead (`ESRCH`, `EPERM` counts as alive), or start ticks differ ⟹ provably gone ⟹ takeover, capped at 3 attempts (`LOCK_TAKEOVER_ATTEMPTS`). A live or *unprovable* owner — unreadable `/proc` stat, non-regular or empty lock file, malformed record — is never taken over: the binder is refused `LOCK_CONFLICT`. A lock file that is not a regular file is refused, never followed.
2. **Alias race (D-53-H1).** Two binders open two alias paths to one directory concurrently. Both canonicalize to the same realpath, derive the same session id, and contend on the same lock path; the loser waits bounded (§1.3) or is refused `LOCK_CONFLICT`. No alias bookkeeping exists to race.
3. **Nested roots (D-53-H4).** Second binder refused `POLICY_DENIED` before any lock is taken, so nesting can never produce two live sandboxes over overlapping trees even when the two roots are on different devices or the nesting is created after the first bind.
4. **Daemon restart mid-bind (D-53-H2).** The daemon holds bindings only through the lock files; a restart leaves lock files naming a dead pid/boot. The restarted daemon's startup reap runs first (D-87 precondition), adopts or removes sandboxes by its existing verdict, and only then may a binder take over a provably-gone lock. The single-daemon rule is load-bearing here: a second daemon cannot bind the control socket (`LOCK_CONFLICT`), so it can never reap or take over under a live daemon. Binder takeover after a restart is therefore safe *because* the precondition holds, not because the lock is smarter.
5. **The second binder's error (D-53-H2).** Loser sees only existing codes: `LOCK_CONFLICT` when a live holder refuses it outright, `TOOL_TIMEOUT` when its bounded wait expires on the `up` path, `POLICY_DENIED` for nesting or a pin mismatch. **No new catalogue code.** A distinct second-binder code was considered and rejected: `LOCK_CONFLICT` already names exactly this situation, and a new code would be catalogue churn with no new caller behaviour.
6. **Grant-then-swap.** A waiter is granted the lock, but the directory was moved or replaced while it waited. The pre-create re-verification (§1.3) refuses `POLICY_DENIED`; the granted lock is released, and the next waiter is granted. The grant confers no right to skip verification.
7. **Cleanup failure.** Mirror the checkpoint lock: a temporary owner file that cannot be removed refuses the acquisition with `CLEANUP_FAILED` and releases any lock the call already published, so a refused acquisition holds no lock.

## 4. Code surfaces and contract changes (CBIND-02) — D-53-H5, D-53-H6

### 4.1 Surfaces a future implementation would touch

| Surface | Change |
| --- | --- |
| `src/session/paths.ts` | Add `bindingsDirOf(stateDir)` and `bindingLockPathOf(stateDir, sessionId)` (the `isSessionId` gate applied, as `checkpointSessionDirOf` does). Nothing else. |
| `src/session/workspace-registry.ts` | Reuse as-is: pinning, entry read, `verifyWorkspaceEntry`. No field added, no schema change. |
| New `src/session/workspace-binding.ts` | Carries acquire/release/takeover for the binding lock, modeled on `checkpoint-lock.ts` (same publish protocol, same provably-gone rule, same attempt cap), *not* by extending that module — the checkpoint lock guards checkpoints, the binding lock guards the workspace claim, and conflating them would let a checkpoint release a workspace. |
| `src/lifecycle/controller.ts` | Acquire the binding before create/start; release on destroy and on the settled-failed-create path. The existing boot-id check stays; the binding makes it reachable. |
| `src/daemon/sessions.ts` | `resolveSelection` unchanged (it derives identity; the binding lock is beneath it). `withSessionLock` stays the in-process serializer; the binding lock is the cross-process layer beneath it. `reserveAdmission`/`settleFailedCreate` ordering preserved so a settled failure releases the binding before the entry is removed. |
| `src/fs/locks.ts` (`LockTable`) | **Not touched.** It is in-memory and per-process by design (D-33); the binding lock does the cross-process work. Extending it would be a second convention for one problem. |
| `src/session/reap.ts` | Precondition only: the D-87 rule extends to "no binder exists before the reap". The reap deletes no binding lock file of an adopted session; takeover handles the rest. |
| Audit / log attribution | Additive and optional only, following the `upId`/`phase` precedent: the binding's identity (session id, binder pid/boot) is recorded on `up.begin`/`up.end` and as an optional audit field. A line written before this change still parses; an unbound call carries no field. |
| `src/session/proc-identity.ts` | Reused as-is (`currentBootId`, `startTicksOf`). |

### 4.2 Contract changes

- **Session record shape: unchanged.** `SessionRecord` in `src/contract/validate.ts` keeps `{realmId, sessionId, workspaceRoot, state, controlSocketPath, containerId?}`. The binding is a lock, not a record field.
- **Registry entry schema: unchanged** (v1, exact field set). The binding lock file is a new file with its own record shape in §2 — new surface, not a changed contract.
- **Lock semantics: one new lock** (the binding lock) with the same semantics as the existing session lock: whole-published, provably-gone-only takeover, `LOCK_CONFLICT` otherwise.
- **Error codes: none added, none renamed.** Reused: `LOCK_CONFLICT`, `POLICY_DENIED`, `TOOL_TIMEOUT`, `CLEANUP_FAILED`, `SCHEMA_INVALID`. A new code would be named here first and needs owner approval **by name** before any implementation phase (per 53-PLAN step 2) — this design proposes none.
- **Migration note.** None required where contracts change, because no existing contract changes: registry entries, session records, and audit lines from before this design are all still valid, and a workspace with no binding lock file binds fresh. **No compatibility shims**: there is no dual-write, no fallback read path, no deprecated alias — the binding lock is simply the one place the claim lives, and a stale file is handled by the takeover rule, not migrated.

## 5. Decision record (HITL) — D-53-H1…H6

The D-53-3 candidate questions, with the pick this design freezes and the alternatives rejected:

| ID | Question | Pick (frozen in this design) | Rejected alternatives |
| --- | --- | --- | --- |
| D-53-H1 | Binder identity: full tuple or workspace alone | `(workspaceDev, workspaceIno, sessionId, bootId, binderPid, binderStartTicks)` — workspace alone cannot tell a live binder from a stale one or a pid reused after reboot | workspace alone (no liveness evidence; a crash would block the workspace forever); pid alone (pid reuse within a boot) |
| D-53-H2 | Conflict action: wait, refuse `LOCK_CONFLICT`, or a new named code | Bounded FIFO wait, then existing codes only (`LOCK_CONFLICT` / `TOOL_TIMEOUT` / `POLICY_DENIED`) | immediate refusal always (breaks the `withSessionLock` wait discipline callers already rely on); new code (catalogue churn, no new caller behaviour) |
| D-53-H3 | Wait bound | The caller's existing bound via `upLockWaitMs`/`downLockWaitMs`; no new constant | a new fixed timeout (a second convention for the same wait) |
| D-53-H4 | Nested roots | Second bind refused `POLICY_DENIED` | independent parent/child bindings (overlapping mounts under one-session-per-project) |
| D-53-H5 | Where the identity is stored | New `<stateDir>/bindings/<sessionId>.lock`; registry entry and session record unchanged | extra fields on the registry entry (schema bump + migration for no gain); fields on the session record (binds identity into a record the reap reads before binders exist) |
| D-53-H6 | Daemon restart mid-bind | Takeover after the startup reap, under the existing single-daemon precondition (D-87); no new mechanism | takeover before the reap (a live sandbox could be adopted *and* re-bound); a daemon heartbeat (new machinery to solve what the control-socket bind already guarantees) |

**HITL gate (53-PLAN step 3).** This design is presented to the owner for approval. On approval, CBIND-01..02 are closed by this file, and any dependent implementation phase is planned under its own owner decision after this freeze — no implementation is planned or implied beyond the scope in §4. On rejection, the affected `D-53-Hn` rows are re-picked and this file is re-frozen; the rejected pick is recorded as superseded, never deleted.

## 6. No-code statement

This file is the only output of the design step. No `src`, `test`, or contract file is changed by Phase 53; §4 names surfaces and contract effects for a *future* implementation and changes nothing now.
