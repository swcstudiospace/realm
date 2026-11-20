# Phase 50: Grok harness fix and production re-run - Context

**Gathered:** 2026-11-19, from `.planning/MILESTONE-CONTEXT.md` (D-v8-3), `.planning/REQUIREMENTS.md` v8.0 (HTIER-01, HTIER-04; carries GAP-48-03, GAP-40-01, GAP-48-01), `.planning/ROADMAP.md` Phase 50, `.planning/phases/48-grok-attribution-and-production-tiers/` (`48-CONTEXT.md` D-48-05/D-48-06, `48-VERIFICATION.md`), `docs/integration/host-plugin-gaps.md` rows GAP-48-03, GAP-40-01, GAP-48-01.
**Status:** Planned (one plan, nothing executed).

## Phase Boundary

Phase 48: Muse Code `proven`; Grok Build 1.0.77 rehearsal failed at install — `realm host install grok-build --dry-run` exited 1 `config-home-missing` (`POLICY_DENIED`) because the scenario creates an isolated grok-home but Realm never creates a host home (`src/host/install.ts`) and `productionOverrides` in `test/support/host-live.ts` does not create the config home (GAP-48-03, a harness defect, not a host blocker). The attribution seam exists (Outcome A: the recipe's `config.toml` entry wins whenever present); only the live demonstration and the production tier are open. This phase wires `<grok-home>/.grok` creation into `productionOverrides` as plan 48-02 owns the wiring, then reruns the live Grok attach (both-files, audit line `grok-build`) and production tier.

**Out of scope:** Prime Agent (B-48-02 stands), recipe/adapter bytes, catalogue, model-driven tool calls (GAP-31-02).

## Decisions

- **D-50-1 (owner D-v8-3):** fix GAP-48-03 in `productionOverrides`, hermetically proven, then live rerun.
- **D-50-2:** `productionOverrides("grok-build", …)` creates `<scenarioRoot>/<GROK_HOME_DIR>/.grok` (the directory Grok reads `config.toml` from) so install runs instead of refusing; no `src/host/install.ts` change unless the hermetic test shows the refusal is product-side (then it is recorded as a finding, not patched in the window).
- **D-50-3:** documentation edits (registry, matrix block, `host-plugin-gaps.md`, host pages) land after any Phase 52 gap-row edits or are rebased, so the generated matrix block does not conflict (milestone ordering note).
- **D-50-4:** a live failure or named host blocker replaces the pass honestly; tiers never relabelled.
