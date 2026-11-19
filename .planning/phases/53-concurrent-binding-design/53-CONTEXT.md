# Phase 53: Concurrent binding design (HITL, owner-approved scope) - Context

**Gathered:** 2026-11-19, from `.planning/MILESTONE-CONTEXT.md` (D-v8-6), `.planning/REQUIREMENTS.md` v8.0 (CBIND-01..02), `.planning/ROADMAP.md` Phase 53, current binding code (`src/session/paths.ts`, `src/session/workspace-registry.ts`, `src/lifecycle/controller.ts`, `src/daemon/sessions.ts`, `src/session/checkpoint-lock.ts`, `src/session/reap.ts`).
**Status:** Planned (one plan, design only, nothing executed).

## Phase Boundary

Today one session binds one project workspace under a configured root: `sessionIdOfWorkspace` derives the session id from the workspace path, the workspace registry pins `{dev, ino}`, the controller binds the workspace to the session record (S-02/F5), and the checkpoint/start locks serialise per session. Two agents binding the same workspace (or a workspace and its alias) is unhandled: the design must state what binds, what conflicts, what waits, the identity of a binding, and the failure modes — each settled by an explicit HITL owner decision. **Design only: no code, no `src` change, no contract change in this phase.** The frozen design (`53-DESIGN.md`) is the output; any dependent implementation phase is planned only after the owner approves it.

**Out of scope:** any implementation of concurrent binding, any behaviour change, catalogue changes.

## Decisions

- **D-53-1 (owner D-v8-6, HITL):** owner-approved scope; the HITL owner decisions are settled before any code (CBIND-01..02).
- **D-53-2:** the design names the code surfaces it would touch (`src/session/paths.ts`, `workspace-registry.ts`, `src/lifecycle/controller.ts`, `src/daemon/sessions.ts`, lock table, audit attribution) and the contract changes it would need, with a migration note where an existing contract changes; no compatibility shims.
- **D-53-3:** candidate semantics to decide (not pre-decided): binding identity = (workspace dev/ino, session id, host boot id) vs workspace alone; conflict = second binder waits / is refused `LOCK_CONFLICT` / is refused with a new named code; waits bounded; failure modes = stale binder after crash, alias paths, nested roots.
- **D-53-4:** open questions for the owner are listed in `53-DESIGN.md` with options and a recommendation; the phase does not close CBIND-01..02 until the owner picks.
