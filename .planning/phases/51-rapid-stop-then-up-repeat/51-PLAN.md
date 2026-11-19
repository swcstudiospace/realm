# Plan 51-01: Rapid stop then up repeat (F-41-1)

**Phase:** 51-rapid-stop-then-up-repeat · **Requirements:** STOP-01..04 (finding F-41-1) · **Wave:** 1–3, serial (shared live lock; live windows BLOCKING).

**Files:** `test/support/rapid-stop-up.ts` (reuse; extend only if a variant is missing), `test/support/daemon-stop-live.ts`, `test/support/production-live.ts`, `src/lifecycle/controller.ts` + `src/runtime/` + `src/daemon/` (fix only if reproduced), new/changed hermetic test beside the fix, `docs/integration/runtime-decision.md`, `.planning/phases/51-rapid-stop-then-up-repeat/51-EVIDENCE.md`.

## Steps

1. **Reuse the harness.** Read `46-EVIDENCE.md`/`46-SECOND-WINDOW.md` and `test/support/rapid-stop-up.ts`: confirm variants a (clean), b (dirty), c (signal variant), s (settled control) and the no-settle loop are as Phase 46 left them. Add nothing unless a variant is absent.
2. **Live reproduction window (BLOCKING, human).** On the production stack, as the window account: stop a daemon holding a sandbox, `realm up` immediately on the same name, no settle, also under CPU load. Target: 50 consecutive iterations per variant. Keep the timeline of daemon request log, gateway, compute driver, supervisor and Podman outside the repository, cited in `51-EVIDENCE.md`. Outcome word frozen before the run (REPRODUCED / NOT-REPRODUCED / OTHER-FAILURE), as Phase 46.
3. **Branch on the outcome.**
   - *Reproduced:* record the cause in `docs/integration/runtime-decision.md` in place of the INFERENCE paragraph (component, timestamps, refusal cause code). Fix red-first in the owning module with every wait bounded; fail closed and no-orphan kept; contract and 29-code catalogue unchanged.
   - *Not reproduced (50 per variant clean):* pin the suspected mechanism hermetically (a test that fails when the wait is removed, e.g. stop-returns-before-teardown-completes); carry F-41-1 with that evidence and a stated reason. No fix claimed.
   - *Other failure:* record it as a new finding with the evidence; do not fold it into F-41-1.
4. **Verification window (only if a fix landed).** ≥20 consecutive stop-then-up iterations on one name: zero `OPENSHELL_START_FAILED`, `failedTeardowns` 0 in every `daemon.stopped` row, zero residue. Explain the Phase 41 variant-c row-absent stop or record it as a finding.

## Checks

- Hermetic: `npm run build && node --test dist/test/support/rapid-stop-up*.test.js` (or the owning test names) plus, if fixed, the red-first test failing pre-fix.
- `npm run lint` on changed files; `daemon.stopped` contract tests unedited and passing; catalogue check unchanged at 29 codes.
- Live: iteration counts per variant, zero-residue snapshot, stack as found.
