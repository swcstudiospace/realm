# Phase 52: Legacy kimi cause (GAP-43-03) - Context

**Gathered:** 2026-11-19, from `.planning/MILESTONE-CONTEXT.md` (D-v8-5), `.planning/REQUIREMENTS.md` v8.0 (KIMV-02; GAP-43-03), `.planning/ROADMAP.md` Phase 52, `.planning/phases/47-legacy-kimi-production-tier-and-env-forwarding/` (`47-CONTEXT.md` D-47-04/D-47-05, `47-WINDOW.md`, `47-VERIFICATION.md`), `docs/integration/host-plugin-gaps.md` GAP-43-03.
**Status:** Planned (one plan, nothing executed).

## Phase Boundary

Phase 47 reran the legacy kimi-cli 1.51.0 production tier: 3/3 valid cold runs ANSWERED with the six tool names (28804/31393/32301 ms), so the 2026-11-18 failure was NOT-REPRODUCED and the cause is NOT-ESTABLISHED. The tier still failed its own 25000 ms cold-connect bound (legacy client alone takes ~30 s on the loaded host). The narrowed candidate is [INFERENCE] only: the client sends SIGKILL to the stdio server a few ms after the `tools/list` response while the recorder logs after forwarding (folder 10 matches the 2026-11-18 shape: 18294 ms, exit 0, no response in the log). GAP-43-03 stays open, narrowed. GAP-43-01 is accepted-residual (OD-47-1; manual `kimi mcp add --env` workaround); GAP-43-02 stays accepted-residual.

**Out of scope:** GAP-43-01 reopening, recipe `env` block (client does not expand `${NAME}`/`$NAME`), model turns through the legacy CLI.

## Decisions

- **D-52-1 (owner D-v8-5):** establish or narrow the cause with a tested reason from live or hermetic evidence; the rerun decides from live evidence whether the failing component is the client, `realm mcp`, or the stack.
- **D-52-2:** scratch install of kimi-cli 1.51.0 outside the repository (as Phase 47); wire log + full `kimi mcp test realm` output kept outside the repository; version and date recorded.
- **D-52-3:** if the cause is in `realm mcp`, fix red-first (fail closed kept) and the production tier must pass; if in the client, show the tier passing in a documented variant or record the owner's retire decision (OQ-24-01); GAP-43-03 is never relabelled.
- **D-52-4:** KIMV-02 closes only on an established/narrowed cause with the bounding evidence; otherwise carried with a stated, tested reason.
