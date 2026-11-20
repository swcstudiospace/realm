# Phase 53 summary: Concurrent binding design (CBIND-01, CBIND-02)

**Date:** 2026-11-19. **Worktree:** `<worktree>`. **Type:** design only — no `src` change, no contract change, nothing executed.

## Files

| File | About |
| --- | --- |
| `.planning/phases/53-concurrent-binding-design/53-DESIGN.md` | The frozen design (§0–§6). Output of CBIND-01..02. |
| `.planning/phases/53-concurrent-binding-design/53-SUMMARY.md` | This file. |
| `53-CONTEXT.md`, `53-PLAN.md` | Pre-existing phase inputs; unchanged. |

Sources read for the design (per 53-PLAN): `src/session/paths.ts`, `src/session/workspace-registry.ts`, `src/session/checkpoint-lock.ts`, `src/session/reap.ts`, `src/lifecycle/controller.ts`, `src/daemon/sessions.ts`, `src/session/proc-identity.ts`, `src/fs/locks.ts`, `src/contract/validate.ts` (session record shape), `docs/integration/runtime-decision.md` (D-87 single-daemon precondition), `docs/integration/host-plugin-gaps.md` (no gap touches session binding; nothing in the design depends on host-plugin behaviour).

## Decisions recorded (D-53-H1…H6, in 53-DESIGN.md §5)

- **D-53-H1 — binder identity:** the binding is the tuple `(workspaceDev, workspaceIno, sessionId, bootId, binderPid, binderStartTicks)`. One live binder per workspace; aliases collapse because the session id derives from the canonical path. Rejected: workspace alone, pid alone.
- **D-53-H2 — conflict action:** bounded FIFO wait, then existing codes only — `LOCK_CONFLICT` / `TOOL_TIMEOUT` / `POLICY_DENIED`. No new catalogue code. Rejected: immediate refusal always, a new named code.
- **D-53-H3 — wait bound:** the caller's existing bound (`upLockWaitMs` / `downLockWaitMs`); no new constant.
- **D-53-H4 — nested roots:** the second bind (ancestor or descendant of a bound root) is refused `POLICY_DENIED`. Rejected: independent parent/child bindings.
- **D-53-H5 — where identity is stored:** a new `<stateDir>/bindings/<sessionId>.lock` holding the owner record (published whole by the checkpoint lock's write-sync-then-`link(2)` protocol). The workspace registry entry and the session record are **unchanged**. Rejected: new fields on either.
- **D-53-H6 — daemon restart mid-bind:** takeover only after the startup reap, under the existing single-daemon precondition (D-87, control-socket bind with `LOCK_CONFLICT`). Rejected: takeover before the reap, a daemon heartbeat.

Failure modes covered per CBIND-01: stale binder after crash (provably-gone-only takeover, cap 3, unprovable ⟹ `LOCK_CONFLICT`), alias race (same realpath ⟹ same lock), nested roots (`POLICY_DENIED` before any lock), daemon restart mid-bind (reap-first takeover under the single-daemon rule), the second binder's error (existing codes only), grant-then-swap (re-verify before create, `POLICY_DENIED`), cleanup failure (`CLEANUP_FAILED`).

## CBIND-02 surfaces and contract effects (§4)

- **Surfaces named:** `src/session/paths.ts` (two path helpers), `src/session/workspace-registry.ts` (reused as-is), a new `src/session/workspace-binding.ts` modeled on `checkpoint-lock.ts` (chosen over extending that module, so a checkpoint can never release a workspace), `src/lifecycle/controller.ts` (acquire before create/start, release on destroy/settled failure), `src/daemon/sessions.ts` (unchanged `resolveSelection`; `withSessionLock` remains the in-process layer), `src/fs/locks.ts` (**explicitly not touched** — in-memory per-process by design), `src/session/reap.ts` (D-87 precondition extended), audit/log attribution (additive optional fields only, per the `upId`/`phase` precedent), `src/session/proc-identity.ts` (reused).
- **Contract changes: none.** Session record shape unchanged; registry entry schema stays v1; error catalogue unchanged. The binding lock is a new file, not a changed contract. **Migration note:** none needed — pre-existing records, entries, and audit lines remain valid; a stale lock file is handled by the takeover rule, not migrated. **No compatibility shims** anywhere in the design (no dual-write, no fallback read).

## HITL gate status (53-PLAN step 3)

The design is frozen as written above and presented to the owner for approval. Per D-53-4, CBIND-01..02 close **only on owner approval** of `53-DESIGN.md`. Until then the phase is design-complete but not closed. Any dependent implementation phase requires its own owner decision after the freeze; nothing in this phase plans or implies implementation beyond §4.

## No-code proof

`git status --short -- src test package.json package-lock.json` in the worktree is empty (53-DESIGN.md and this summary are the only additions under `.planning/phases/53-*/`, alongside the pre-existing plan/context). No live window run and no test run — nothing was executed, per the plan.
