# SANDBOX n7 — Waves Execution Plan (SPE-38277..38283)

Date: 2026-11-25. Branch: `swarm/Tb559r-fe`. Graph: `ut-4b4c9b9f07-77d10d12`.
Inputs: n1b trio; n2 `.planning/SANDBOX-n2-UNITS.md`; n3
`.planning/SANDBOX-n3-OPTIONS.md` (Option A); n4
`.planning/SANDBOX-n4-SCOPE.md`; n5 `.planning/SANDBOX-n5-DESIGN.md`; n6
`.planning/SANDBOX-n6-SCOPE.md`; owner decisions A1/A3 (2026-11-23).

## Waves

- **Wave 1 — Discovery.** File: `.planning/SANDBOX-n1b-*.md` (written 2026-11-25; updated STATE/ROADMAP staleness first). Done: evidenced outstanding list (56 carried gaps_found; 57/58 passed-with-gaps), sandbox mechanism + boundaries recorded, verification commands extracted. **Complete.**
- **Wave 2 (parallel) — Units + options.** U1-U5 decomposition (`SANDBOX-n2-UNITS.md`) and Option A selection (`SANDBOX-n3-OPTIONS.md`). Parallel safe: both READ-ONLY, no shared output file. **Complete.**
- **Wave 3 (parallel) — Scope + design.** n4 ledger (`SANDBOX-n4-SCOPE.md`, owner decisions applied) and n5 design (`SANDBOX-n5-DESIGN.md`, per-U verification gates + guardrails). Both READ-ONLY + own output. **Complete.**
- **Wave 4 — Scope refinement.** n6 (`SANDBOX-n6-SCOPE.md`): one-phase state rules, blocked-vs-awaiting states, closeout gate. **Complete.**
- **Wave 5 — This plan (n7).** A1/A3 gates closed by owner decisions; remaining work is audit + complete + cleanup, all host-gated by review-infra (PR #257 blocked: Claude billing).
- **Wave 6 — Milestone closeout (pending infra).** Audit, complete, cleanup in that order; then ultrathink-ship PR #257 review→5/5→merge.

## Verify line

At closeout: run SANDBOX-n5-DESIGN.md §2 gate commands; grep logs for
`rcap1` shape (must be empty); grep source/planning for unsandboxed
fallback (must be empty); confirm `.planning/STATE.md` and
`.planning/ROADMAP.md` agree with `SANDBOX-n1b-MANIFEST.md` after the
STATE sync of 2026-11-25.

## Idempotency / owner

Every wave output above is an idempotent read artifact (re-run changes
nothing; file ownership: this file only). One wave runs after its
dependency: W2 reads W1; W3 reads W1-W2; W4 reads W1-W3; W5 reads
W1-W4; W6 blocked on billing + realmlive stack. Any future wave head
change requires updating `.planning/STATE.md` per n6 §5.
