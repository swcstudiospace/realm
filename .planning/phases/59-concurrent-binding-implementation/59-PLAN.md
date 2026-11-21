# Plan 59-01: Concurrent binding implementation

**Phase:** 59-concurrent-binding-implementation · **Requirements:** CBIND-01..03 (CBIND-01..02 close on ratification; CBIND-03 closes on this implementation) · **Waves:** 3, disjoint by file (≤5 files each). **Gate: no wave starts until owner ratification of `53-DESIGN.md` (D-53-H1..H6, D-v9-6) is recorded with a date.** `53-DESIGN.md` is frozen but **not ratified** as recorded in `59-CONTEXT.md`; every plan below is blocked on that record.

Optional next actions (not required for any plan below):
- **Record ratification:** write the ratification date and the approved D-53-H1..H6 row set into `59-CONTEXT.md` and the phase record, then unblock wave 1. (Blocked on the owner's ratification decision itself.)

## Plans

### Plan 59-01.1 (wave 1): binding paths and binding-lock core, hermetic

**Files (3):** `src/session/paths.ts`, `src/session/workspace-binding.ts` (new), `test/session/workspace-binding.test.ts` (new). **Requirements:** CBIND-03.

**Steps**
1. **Paths (red first).** Add `bindingsDirOf(stateDir)` and `bindingLockPathOf(stateDir, sessionId)` to `src/session/paths.ts`, with the `isSessionId` gate applied as `checkpointSessionDirOf` does. Nothing else in this file.
2. **Binding lock (red first).** Create `src/session/workspace-binding.ts`, modeled on `checkpoint-lock.ts` and not by extending it: publish the owner record (`schema`, `pid`, `startTicks`, `bootId`, plus `sessionId`, `dev`, `ino`) whole by write-sync-then-`link(2)` at `<stateDir>/bindings/<sessionId>.lock`; provably-gone takeover only (boot differs, pid dead with `ESRCH`, `EPERM` counts as alive, or start ticks differ), capped at 3 attempts; bounded FIFO wait per binding key reusing the caller's `upLockWaitMs` / `downLockWaitMs`; liveness re-derived from `/proc` via `proc-identity.ts` on each check, never trusted from the file alone. Refusals use only `LOCK_CONFLICT`, `TOOL_TIMEOUT`, `CLEANUP_FAILED`; a non-regular or empty lock file and a malformed record are refused `LOCK_CONFLICT`, never followed; a cleanup failure refuses with `CLEANUP_FAILED` and releases any lock already published.
3. **Hermetic tests (red first, observable behaviour only).** Pin: alias contention (two alias paths to one directory, one lock path, loser waits or is refused `LOCK_CONFLICT`); stale takeover with the cap of 3, including the live / unprovable owner cases.

**Checks**
- `npm run build` and `npm run lint` on the changed files.
- Error catalogue unchanged (29 codes); no new dependency; strict TypeScript, `RealmError` with catalogue codes, no silent catch, no suppression comments.
- Observable acceptance: two concurrent acquisitions of one workspace yield exactly one holder; a provably-gone holder's lock is taken over; a live or unprovable holder's lock is never taken over.

### Plan 59-01.2 (wave 2): controller, sessions ordering and reap precondition

**Files (3):** `src/lifecycle/controller.ts`, `src/daemon/sessions.ts`, `src/session/reap.ts`. **Requirements:** CBIND-03.

**Steps**
1. **Acquire before create, release on destroy (red first).** In `src/lifecycle/controller.ts`, acquire the binding before create / start and release it on destroy and on the settled-failed-create path. The existing boot-id check stays. No sandbox exists outside a binding.
2. **Sessions ordering (red first).** In `src/daemon/sessions.ts`, keep `resolveSelection` unchanged and `withSessionLock` as the in-process serializer with the binding lock as the cross-process layer beneath it; preserve `reserveAdmission` / `settleFailedCreate` ordering so a settled failure releases the binding before the entry is removed.
3. **Reap precondition.** In `src/session/reap.ts`, extend the D-87 precondition to "no binder exists before the reap" (precondition only): the reap deletes no binding lock file of an adopted session; takeover handles the rest.
4. **Remaining hermetic tests (red first).** Pin: nested-root refusal (`POLICY_DENIED` before any lock is taken, including across devices and nesting created after the first bind); expired wait (`TOOL_TIMEOUT` when the `up` lock wait expires); grant-then-swap refused (`POLICY_DENIED` on the pre-create re-verification, the granted lock released, the next waiter granted).

**Checks**
- `src/fs/locks.ts` (`LockTable`) untouched — proven by diff, not by test.
- On grant, the binder re-verifies the registry pin and its own `(dev, ino)` before creating anything; `src/session/workspace-registry.ts` and `src/session/proc-identity.ts` reused as-is.
- Observable acceptance: nested-root, expired-wait and grant-then-swap refusals carry exactly `POLICY_DENIED` / `TOOL_TIMEOUT` as specified; a settled failed create releases the binding before its entry is removed.

### Plan 59-01.3 (wave 3): docs and enumerating tests

**Files (≤5):** `docs/integration/runtime-decision.md` (binding-lock section), the enumerating test file(s) beside the changed surfaces, the audit / log attribution site for `up.begin` / `up.end`, `59-CONTEXT.md` (ratification record, once recorded), `.planning/REQUIREMENTS.md` (CBIND-03 row). **Requirements:** CBIND-01..03.

**Steps**
1. **Attribution (red first).** Add optional `upId` / `phase`-precedent attribution of the binding identity (session id, binder pid / boot) on `up.begin` / `up.end` and as an optional audit field: a line written before this change still parses; an unbound call carries no field.
2. **Docs.** Record the binding lock in `docs/integration/runtime-decision.md` beside the D-87 / OQ-P4-06 single-daemon precondition it extends; no host-local absolute path appears in committed files.
3. **Enumerating tests.** Update every enumerating test over the changed surfaces in the same pull request, so the surface, its enumerating tests and the docs land together.
4. **Closure.** With ratification recorded (date) and the implementation merged, CBIND-01..02 are closed by the ratification record and CBIND-03 by this plan; update the `REQUIREMENTS.md` CBIND-03 row status in this pull request, not in `STATE.md` or `ROADMAP.md`.

**Checks**
- No new catalogue code (29 codes); no contract change: session records and registry entries from before this phase remain valid, and a workspace with no binding lock file binds fresh.
- No compatibility shims: no dual-write, no fallback read path, no deprecated alias.
- Observable acceptance: the docs state the single-daemon precondition the takeover rule depends on; every enumerating surface, its tests and its docs are consistent in one pull request.
