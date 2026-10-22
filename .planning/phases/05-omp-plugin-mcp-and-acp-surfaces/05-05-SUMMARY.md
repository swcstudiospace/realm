# Phase 05 Plan 05-05: Omp Extension Surface Summary

**Phase:** 05-omp-plugin-mcp-and-acp-surfaces
**Plan:** 05-05
**Status:** complete
**Requirements:** OMP-01, OMP-02, OMP-03, OMP-04, OMP-05
**Depends on:** 05-01 (createRealmHandle), 05-02 (verified Omp API names)
**Files:** src/omp/plugin.ts (new), test/omp/plugin.test.ts (new), package.json (omp field)

## One-liner

Omp extension with detached autostart under the startup budget, single-label status with reason plus time, dispatcher-owned retry command, and a proven tool_call write/edit guard, using only the 05-02-verified host API names.

## What was built

- `src/omp/plugin.ts` exports `registerRealmPlugin(pi, options)` plus the
  `OmpExtensionApi` / `OmpSessionContext` / `OmpStatusUi` host interfaces,
  `renderRealmStatus`, `guardHostToolCall`, the `realm` / `realm.detail`
  status keys, the `realm-retry` command name, and `GUARDED_HOST_TOOLS`.
  - Autostart: `session_start` handler builds the handle through
    `createRealmHandle`, renders launch status, subscribes to controller
    events, kicks `create` without awaiting, arms `ctx.setTimeout` for
    `policy.startupBudgetMs`, renders disconnected with
    `STARTUP_BUDGET_EXCEEDED` on expiry while the session continues, and
    clears the timer plus re-renders on settle.
  - Status: every render goes through `displayStatus(snapshot).label` on one
    key with a text marker (`●` active family, `○` disconnected family,
    ` [degraded]` flag); reason and ISO instant ride the second key.
  - Retry: `realm-retry` calls `ToolDispatcher.call({ retry: {} })` and
    nothing else, then re-renders.
  - Guard: `write` / `edit` read the controller mutation gate (mirrors
    `decideMutation`, redefines nothing); refused denies with the gate code,
    proceed-with-warning notifies and lets through, everything else passes.
- `test/omp/plugin.test.ts`: 11 tests citing OMP-01 to OMP-05 against a fake
  host (captured handlers, timers, commands) plus the fake execution service
  and bridge, a fixed clock, and real controller plus dispatcher.
- `package.json`: `"omp": { "extensions": ["./dist/src/omp/plugin.js"] }`
  per the Q1 array-of-entries shape.

## Decisions

- Required mode is the fail-closed policy mode; advisory is the default
  (matches 05-01: advisory uses the absent-policy defaults, required writes
  `{"mode": "fail-closed"}`).
- P5-D5 tooltip deviation: reason plus time go in the second `setStatus`
  item, since no tooltip surface was verified; recorded in the module doc
  comment.
- OQ-P5-02 residual risk is a doc comment on the guard: the block holds
  inside the extension pipeline (proven by the block-verdict tests); any host
  path that bypasses the extension pipeline is named as not covered.
- Real wall-clock delays in the budget tests (60 ms budget vs 500 ms exec
  delay; 300 ms detached-launch delay) are deliberate: the plan mandates the
  overrun drive via delayed fake execution service, and managed host timers
  cannot be driven by deterministic timer mocks. Polling is bounded
  (500 x 10 ms) and every started test awaits settle before teardown.

## Deviations from Plan

1. **Compiled entry path.** The plan names `dist/omp/plugin.js`, but the repo
   `rootDir` is `.`, so `tsc` emits `dist/src/omp/plugin.js` (confirmed:
   `dist/` holds `src/` and `test/`). The `omp` field and the manifest test
   use `./dist/src/omp/plugin.js`. Ground truth: `tsconfig.json` (`rootDir`,
   `outDir`) plus the existing `dist/` layout.
2. **omp.md not edited.** The plan asks for the OQ-P5-02 statement in both
   the module doc comment and `docs/integration/omp.md`, but the shared
   file scope for this plan covers only `src/omp/plugin.ts`,
   `test/omp/plugin.test.ts`, and `package.json`. The statement lives in the
   guard doc comment; the exact text for Main to append to `omp.md` is:
   "Residual risk (OQ-P5-02): the tool_call block holds inside the extension
   pipeline (proven by the block-verdict tests); any host path that bypasses
   the extension pipeline is not covered."
3. **No new error code, policy key, or dependency** added, per the plan
   prohibition: the overrun reason reuses catalogue `STARTUP_BUDGET_EXCEEDED`
   and the timer reads the unchanged `startupBudgetMs` (OQ-P5-04).

## Threat mitigations

- T-05-09 (DoS): detached launch plus budget timer; proven by the detached
  and overrun tests.
- T-05-10 (Tampering): fail-closed guard via the mutation gate with the
  residual risk named; proven by the refusal, warning, and pass-through
  tests.
- T-05-11 (Spoofing): single shared label with a text cue; pinned by the
  allowlist assertion over every launch and transition render.

## Known stubs

None. No placeholders, no unwired renders, no skipped verifications in the
new code.

## Verification (not run — orchestrator gates own this)

Per the shared constraints no typecheck, test, lint, or build was run here.
Expected green:

```bash
npx tsc -p tsconfig.json && node --test dist/test/omp/plugin.test.js
```

plus OMP-01 through OMP-05 present in the test titles.

## Commits

Per the shared constraints no commits were made; Main commits.
