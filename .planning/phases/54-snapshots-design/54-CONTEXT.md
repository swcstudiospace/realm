# Phase 54: Snapshots design (HITL, owner-approved scope) - Context

**Gathered:** 2026-11-19, from `.planning/MILESTONE-CONTEXT.md` (D-v8-7), `.planning/REQUIREMENTS.md` v8.0 (SNAP-01..02), `.planning/ROADMAP.md` Phase 54, `src/session/checkpoint.ts` (RES-04: full tree copy + `manifest.json` content identity, per-session lock, crash-marker recovery), `src/cli/checkpoint.ts`, `src/session/checkpoint-lock.ts`, `src/session/paths.ts`.
**Status:** Planned (one plan, design only, nothing executed).

## Phase Boundary

RES-04 already ships workspace checkpoint create/restore (`realm checkpoint create|restore --workspace <path> --id <id>`): a full copy with a manifest recording relative path, type, mode, size, link target and sha256; restore returns a modified workspace to prior content byte for byte; cross-process per-session lock with takeover only when the owner is provably gone; crash recovery via backed-up/committed markers. This phase designs *durable snapshots* on that mechanism: what a snapshot contains, what survives a daemon restart and a crash, what restore means, how it composes with RES-04 create/restore, the scratch volume and the no-orphan guarantee — each settled by an explicit HITL owner decision. **Design only: no code, no `src` change.** The frozen design (`54-DESIGN.md`) is the output; implementation is planned only after owner approval.

**Out of scope:** any implementation, any behaviour change, catalogue changes.

## Decisions

- **D-54-1 (owner D-v8-7, HITL):** owner-approved scope; HITL owner decisions settled before any code (SNAP-01..02).
- **D-54-2:** candidate semantics to decide (not pre-decided): snapshot = named, retained checkpoint (id, manifest digest, retention) vs a new content-addressed store; durability = survives daemon restart and crash (fsync of file + directory, manifest last) vs best-effort; restore = byte-for-byte return (RES-04 semantics) vs merge; composition = snapshots reuse `snapshotWorkspace`/`restoreWorkspace` under the session lock vs a new path.
- **D-54-3:** the design states code surfaces (`src/session/checkpoint.ts`, `src/cli/checkpoint.ts`, `src/session/paths.ts`) and contract changes with a migration note; no compatibility shims.
- **D-54-4:** open questions for the owner are listed in `54-DESIGN.md` with options and a recommendation; SNAP-01..02 do not close until the owner picks.
