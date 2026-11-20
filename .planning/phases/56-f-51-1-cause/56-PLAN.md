# Plan 56-01: F-51-1 cause

**Phase:** 56-f-51-1-cause · **Requirements:** STOP-05..06 (finding F-51-1) · **Wave:** 1–2, serial (shared live lock; live windows BLOCKING). Phase 59 is explicitly excluded (gated on D-v9-6).

**Files:** `test/support/rapid-stop-up.ts`, `test/support/daemon-stop-live.ts`, `test/support/production-live.ts` (reuse; extend only if a variant or the cause-code capture is missing), `src/runtime/session-execution.ts`, `src/daemon/daemon.ts`, `src/daemon/teardown.ts`, `src/lifecycle/` (fix only if the cause is there), new/changed hermetic test beside the fix, `docs/integration/runtime-decision.md`, `.planning/phases/56-f-51-1-cause/56-EVIDENCE.md`.

## Steps

1. **Reuse the harness and close the capture gap.** Read `51-EVIDENCE.md` §4 and `test/support/rapid-stop-up.ts`; confirm variants a, b, c and the settled control are as Phase 51 left them. Extend the harness only to capture the failed step and its cause code for every dirty stop (the Phase 51 gap: `AGENTOS_STOP_FAILED` with no failed-step code), with the timeline of daemon, gateway, compute driver, supervisor and Podman kept outside the repository.
2. **Live capture window (BLOCKING, human).** On the production stack, as the window account, stop a daemon holding a sandbox and run `realm up` immediately on the same name, no settle, variant c. The outcome word is frozen before the run. Every dirty stop records its failed step and cause code; a stop with no such record is counted as not captured, never assumed.
3. **Establish or carry (STOP-05).** Record the cause in `docs/integration/runtime-decision.md`: which step fails and why, replacing the inference with the captured cause codes and the bounding evidence. If the capture cannot establish it, F-51-1 is carried with that evidence and a stated, tested reason; it is not folded into F-41-1 and no pass is claimed.
4. **Fix or bound and the clean run (STOP-06).** If the cause is established, fix red-first in the owning module with every wait bounded; fail closed and the no-orphan guarantee are kept, teardown bounds are never weakened. A live verification run does at least 20 consecutive variant-c stop-then-up iterations with `failedTeardowns` 0 in every `daemon.stopped` row and zero residue.

## Checks

- Hermetic: `npm run build` plus the owning test files; if a fix lands, the red-first test fails pre-fix and passes after.
- `npm run lint` on changed files; `daemon.stopped` contract tests unedited and passing; the error catalogue stays at 29 codes; no new dependency without the `CONTRIBUTING.md` checks.
- Live: the capture window records, for every dirty stop, the failed step and its cause code; the verification run reaches at least 20 consecutive variant-c iterations with `failedTeardowns` 0, zero residue, and the stack as found.
