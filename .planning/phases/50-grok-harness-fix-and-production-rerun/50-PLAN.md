# Plan 50-01: Grok harness fix and production re-run

**Phase:** 50-grok-harness-fix-and-production-rerun · **Requirements:** HTIER-01, HTIER-04 (carries GAP-48-03, GAP-40-01, GAP-48-01) · **Wave:** 1–2, serial (shared live lock; doc edits after Phase 52 gap-row edits or rebased).

**Files:** `test/support/host-live.ts`, `test/integration/host-live-helpers.test.ts` (hermetic rows), `test/integration/host-live-wave2-production.test.ts` (read-only; gated), `test/support/host-registry.ts`, `docs/integration/host-support-matrix.md` (generated block only), `docs/integration/host-plugin-gaps.md`, `docs/hosts/snippets/grok-build.md`, `.planning/phases/50-grok-harness-fix-and-production-rerun/50-WINDOW.md` (after the run).

## Steps

1. **Hermetic fix (red first).** In `productionOverrides` (`test/support/host-live.ts`): for `grok-build`, after creating the isolated HOME, also `mkdirSync(join(home, ".grok"), { recursive: true })` so `realm host install grok-build` runs instead of refusing `config-home-missing`. Add hermetic rows in `host-live-helpers.test.ts`: the override creates `<grok-home>/.grok`; no other host's overrides change; nothing points at the operator's real home. Show the new row failing before the fix (recorded).
2. **Confirm product-side refusal absent.** Run the hermetic `host-live` helper suite and the install tests (`test/host/*.test.ts` as applicable): if `src/host/install.ts` still refuses once `.grok` exists, record it as a finding with the owning plan — do not patch in the window.
3. **Live re-run (BLOCKING, human).** As the window account under the shared live lock: the Grok Build production tier and the both-files attribution attach (`test/integration/host-live-wave2-production.test.ts`, gate `REALM_LIVE_PRODUCTION` + Grok opt-in). Cold, new project directory, no warm-up. Pass = host launches `realm mcp --host grok-build`, handshake, `tools/list`, six tools on the wire, audit line attributed `grok-build` with `realm` in both `config.toml` and the Claude files; Claude-file-alone control stays attributed `claude` (GAP-40-01 residual unchanged). Record version, date, wire summary in `50-WINDOW.md`; evidence outside the repository.
4. **Agree the records.** Update `test/support/host-registry.ts` T3 (dated result or named blocker), regenerate the `host-support-matrix.md` block, update GAP-48-03 (closed on a pass, or the new finding), GAP-40-01/GAP-48-01 wording, and the `grok-build.md` host page. Only rows the evidence supports change.

## Checks

- `npm run build && node --test dist/test/integration/host-live-helpers.test.js dist/test/docs/host-support-matrix.test.js dist/test/host/runtimes.test.js` and `node scripts/check/host-paths.mjs`.
- `test/integration/enforce-default.test.ts` still attaches and completes a call for every host id under the default (unedited).
- Live: one of passed / failed (named finding) / named blocker — never relabelled; operator's real Grok config byte-equal; stack as found.
