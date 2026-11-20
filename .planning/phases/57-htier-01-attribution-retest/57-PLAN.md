# Plan 57-01: HTIER-01 attribution retest

**Phase:** 57-htier-01-attribution-retest · **Requirements:** HTIER-01 (carries GAP-40-01, GAP-48-01) · **Wave:** 1, serial (shared live lock; doc edits land before Phase 58 or are rebased). Phase 59 is explicitly excluded (gated on D-v9-6).

**Files:** `test/support/host-live.ts` (reuse; `productionOverrides` as Phase 50 left it), `test/support/host-registry.ts`, `test/integration/host-live-wave2-production.test.ts` (read-only; gated), `docs/integration/host-support-matrix.md` (generated block only), `docs/integration/host-plugin-gaps.md`, `docs/hosts/snippets/grok-build.md`, `.planning/phases/57-htier-01-attribution-retest/57-WINDOW.md`.

## Steps

1. **Confirm the Phase 50 instrument.** Read `50-WINDOW.md` and `productionOverrides` in `test/support/host-live.ts`: the `grok-build` case creates `<grok-home>/.grok`; the harness fix is in place. Add nothing unless a variant is absent.
2. **Live both-files retest (BLOCKING, human).** On the production stack, as the window account, run a live Grok Build session with the host launching `realm mcp --host grok-build`: the handshake, `tools/list` and the six tools on the wire, and the audit line attributed `grok-build` with a `realm` server present in both `config.toml` and the Claude files. Keep the wire log and the evidence outside the repository. Run the warm variant if the cold mandatory audit is the blocker (the Phase 50 cold case leaves in about 300 ms before the attach settles).
3. **Met or carried (HTIER-01).** If the live audit line appears, HTIER-01 is met on that line. If it does not, GAP-40-01 stays accepted-residual with the missing host feature named and the verified workaround documented, and GAP-48-01 stays accepted-residual unless the line proves otherwise; the outcome is recorded either way and never relabelled.
4. **Agree the records.** The registry row, support matrix, gap rows and host pages agree with the result; `test/integration/enforce-default.test.ts` still passes unedited; residue 0 before and after; stack as found.

## Checks

- Live: a Grok Build session on the production stack writes an audit line attributed `grok-build` with the full wire (handshake, `tools/list`, six tools); the warm variant result is recorded either way; version, date and host facts recorded.
- No credential, no model turn, no value printed; the operator's real config is untouched; no catalog or contract change.
- Docs: registry, matrix block, gaps page and host pages agree with the evidence; the matrix block is regenerated, not hand-edited.
