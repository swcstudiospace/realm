# 04-06 Summary: dispatcher unit surface (TOOL-03, TOOL-04)

## Outcome

All four tasks are complete. No source file was changed: `src/core/events.ts`
already returns an unsubscribe function with tests, and `src/tools/dispatch.ts`
already implements the specified pipeline, so this plan contributed the three
test files plus the routing-test fix and extension. No gate (tsc, tests, lint)
was run by this agent, per the run rules; the orchestrator runs all gates.

## Files changed

- `test/core/events.test.ts` — unchanged (Task 1 verified complete, see below).
- `src/core/events.ts` — unchanged.
- `src/tools/dispatch.ts` — unchanged (tests only; no plan violation found).
- `test/tools/dispatch.test.ts` — new. Twelve TOOL-03 tests over the real
  `ToolDispatcher` with the `makeHarness` fake (real workspace, locks, audit
  log; only the OpenShell runner is fake): exec/write/read/list/status/retry
  stage order, schema-failure zero side effects, SHELL_NOT_ALLOWED before the
  state check, malformed argv refused before admission, admission failure runs
  no execution, exec-active-only in both modes, advisory write warning,
  required-mode refusal with no audit line, retry by state, and shared-lock-table
  LOCK_CONFLICT with post-release success.
- `test/tools/queue-timeout.test.ts` — new. Four TOOL-04 tests: timed-out runner
  yields TOOL_TIMEOUT with `timeoutMs === TOOL_CALL_TIMEOUT_MS` and
  `captureOutput: true` passed to the runner; connecting with the default policy
  returns REALM_NOT_ACTIVE after the 2000ms `toolQueueMs` bound; a queued call
  proceeds at once when active is reached during the wait; timer/listener cleanup
  on settle and no wait in degraded.
- `test/runtime/openshell-routing.test.ts` — fixed the `SessionExecution`
  construction (added `egressAllow: []`, matching every other Phase 4 fixture)
  and added three TOOL-03 dispatcher routing tests: exec reaches the runner with
  the pinned `buildExecArgv` argv plus timeout/capture options, a write lands on
  disk with exactly admission+result audit lines carrying sha256 and no content,
  and `SessionExecution.prototype` exposes no call/tool/dispatch/exec surface.

## Task 1 confirmation (C-2)

`src/core/events.ts` `subscribe` already returns `() => void` with
registration-scoped removal, and `test/core/events.test.ts` already contains
the two C-2 unsubscribe cases (removal skips later publication; double
unsubscribe is safe with a twice-subscribed listener). No edit was needed.

## Deviations from the plan

1. **Queue-timeout kill test (Task 3).** The plan asks for "a runner that never
   settles yields TOOL_TIMEOUT within the bound". `TOOL_CALL_TIMEOUT_MS` is
   30000, so a real hang cannot be awaited in a unit test. The test instead
   rejects with `OpenShellRunnerError("timed-out")` — the exact signal the
   killing runner produces — and asserts the TOOL_TIMEOUT refusal, the
   admission+result audit pair with the TOOL_TIMEOUT result outcome, and that
   the runner received the kill deadline (`timeoutMs === TOOL_CALL_TIMEOUT_MS`,
   `captureOutput: true`). The 30s bound itself is covered by assertion, not by
   waiting.
2. **No `dispatch.ts` change (Tasks 2–3).** The plan anticipated implementing
   the dispatcher, but the wave 1–3 source already implements the specified
   stages. The tests were written against the as-built behavior; every asserted
   behavior matched, so no source change and no finding against dispatch.ts.

## Findings (existing source, not changed)

- None blocking. `dispatch.ts` stage order, refusal codes, queue wait, and audit
  phases all match D-89/D-91/D-95 as the plan specifies. `waitLeavingConnecting`
  clears its timer and unsubscribes on both outcomes (C-2/D-105), which the
  `listeners() === 0` assertions pin.
- `readFileCapped` and `listDir` import no lock machinery, confirming the
  read/list "no lock probe" assertion is structural, not incidental.

## Not done / left for the orchestrator

- All gates (`tsc`, `node --test` on the four files, requirement-ID grep) were
  explicitly not run per the run rules. The most timing-sensitive new test is
  the default-2000ms connecting expiry (~2s) and the degraded fast-return bound
  (<1000ms); both use loose bounds to avoid flakes.
