# Phase 58: KIMV-02 recorder fix and rerun - Context

**Gathered:** 2026-11-20, from `.planning/MILESTONE-CONTEXT.md` (D-v9-5, Ordering and dependencies), `.planning/REQUIREMENTS.md` v9.0 (KIMV-02; carries GAP-43-03), `.planning/ROADMAP.md` Phase 58, `.planning/phases/52-legacy-kimi-cause/` (`52-VERIFICATION.md`, `52-SUMMARY.md`), `.planning/phases/47-legacy-kimi-production-tier-and-env-forwarding/` (`47-CONTEXT.md` D-47-04/D-47-05), `test/support/host-live-session.ts` (wire recorder), `test/support/wire-timeline.ts`, `test/support/host-live-kimi.ts`, `docs/integration/host-plugin-gaps.md` GAP-43-03.
**Status:** Planned (one plan, nothing executed).

## Phase Boundary

Phase 52 narrowed GAP-43-03: `realm mcp` exonerated by source, the recorder instrument indicted by its own code ([INFERENCE] only): the recorder logs after forwarding, so a client that SIGKILLs the server a few ms after the `tools/list` response can leave the response unseen. The deciding rerun — a recorder that logs *before* forwarding — was human-blocked. This phase fixes the wire recorder to log before forwarding, then runs that deciding live rerun. Live window on the production stack; the shared live lock serialises it against Phases 56 and 57. Phase 59 is explicitly excluded: it is gated on the owner ratification of `53-DESIGN.md` (D-v9-6) and this phase writes no binding code.

**Out of scope:** reopening GAP-43-01 (accepted-residual, OD-47-1; manual `kimi mcp add --env` workaround); GAP-43-02; recipe `env` block (the client does not expand `${NAME}`/`$NAME`); model turns through the legacy CLI; any `src` change unless the rerun indicts `realm mcp`.

## Decisions

- **D-58-1 (owner D-v9-5):** fix the wire recorder to log before forwarding, then run the deciding live rerun (KIMV-02).
- **D-58-2:** the fix is hermetic red-first (a response visible after the fix that the old code dropped) and the fixed recorder is in use by every live harness that asserts the wire summary.
- **D-58-3:** if the rerun shows the response the log-after-forward recorder missed, the recorder was the cause and GAP-43-03 closes on that evidence; otherwise the client's close-after-response race is recorded as the narrowed cause and GAP-43-03 is not relabelled.
- **D-58-4:** the rerun keeps the wire log and the full `kimi mcp test realm` output, with version and date recorded; GAP-43-03 is never closed by inference alone.
