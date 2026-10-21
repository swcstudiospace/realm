# Plan 03-01 Summary: Backoff schedule and BridgePort contract

Status: done (unit-verified). No live I/O; nothing in this plan is live-gated.

## Files

- `src/core/backoff.ts` (new): `computeBackoffDelayMs(attempt, baseMs, capMs, random)`. Full jitter: `random() * min(cap, base * 2^attempt)`. Imports nothing. The random source and any sleep are injected.
- `src/core/ports.ts` (extended): added `BridgePort`, `BridgeEvent`, and `BridgeKind` beside `ExecutionService`. The import of `ErrorCode` is type-only. `ExecutionService` lines are unchanged.
- `test/core/backoff.test.ts` (new): 11 tests, each title citing ANDA-03 and/or RT-04.

## Verification

- `npx tsc -p tsconfig.json`: no errors.
- `node --test dist/test/core/backoff.test.js`: 11 pass, 0 fail, 0 skipped.
- `npx eslint` on the three owned files: no issues.

## Requirement evidence

- ANDA-03: the bounded, jittered schedule is unit-tested for the Anda parameters (base 500, cap 30000). The reconnect loop itself is not in this plan; it belongs to the Anda client (plan 03-06).
- RT-04: the same schedule is unit-tested for the AgentOS parameters (base 500, cap 8000). The restart supervisor is not in this plan; it belongs to plan 03-07.

## Design choices (not fixed by the plan)

- `BridgePort.snapshot()` returns the most recent `BridgeEvent`, or `null` before the first event. This keeps the port to one event type and matches the "current snapshot" wording without adding a second status type.
- The random source contract is `[0, 1]` inclusive, because the plan's test uses 1 as the upper jitter bound. The result is always at most the cap. A draw outside `[0, 1]` or not a number throws `RangeError`, so it fails closed.
- Invalid attempt, base, or cap values throw `RangeError` instead of returning a delay. A zero base returns 0, not NaN. A large attempt clamps at the cap.
- `BridgePort.connect` and `close` return `Promise<void>`, and `subscribe` returns an unsubscribe function. This matches D-64 and D-65.

## Deviations and open items

- None against the plan's acceptance criteria.
- No dependency was added. No `src/core` module outside this plan was edited.
