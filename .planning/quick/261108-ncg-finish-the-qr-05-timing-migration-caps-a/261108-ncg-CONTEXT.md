# Quick task T: finish the QR-05 timing migration (Phase 13)

Specs: `.planning/phases/13-quality-ratchet/13-RESEARCH.md` around line 200 and `13-CONTEXT.md` decision D-1305. Read `test/support/timing.ts` and `test/support/timing.test.ts` first (TIMEOUT_SCALE, scaledMs, testTimeout, boundedWait, pollUntil, ManualClock).

## Locked decisions

1. Replace the literal outer node:test caps (`{ timeout: N }`) with `testTimeout(...)`: `test/anda/reconnect.test.ts` (six, around lines 336, 474, 540, 588, 620, 650), `test/runtime/driver/socket-server.test.ts` (four, around 163, 174, 186, 197), `test/anda/listener-diagnostic.test.ts` (one, around 64). Keep the behavioural timer values and the elapsed-time assertions: these tests exercise real timers on purpose (see the file header comments); only the outer CAP scales.
2. `test/daemon/daemon.test.ts` has two unconditional 12 s sleeps: the probe-log assertion (around lines 1194-1215) and the probe-counter assertion (around 1816-1835). Replace each blind sleep with an OBSERVED condition bounded through pollUntil or boundedWait (poll the log lines or the counter until the expected probe happened), or with deterministic control of the probe interval if the fixture allows it. Preserve the asserted error codes and counter values. Never just shorten or lengthen the sleep.

## Files in scope

`test/anda/reconnect.test.ts`, `test/runtime/driver/socket-server.test.ts`, `test/anda/listener-diagnostic.test.ts`, `test/daemon/daemon.test.ts`. Nothing else.

## Acceptance

No literal timeout cap remains in the four files unless a comment states why. Every test asserts exactly what it asserted before. `daemon.test.ts` loses about 24 s of wall time.

## Execution notes

- Every heavy command through `flock -w 7200 <heavy-slot lock> <command>`. Run the four test files, typecheck and lint; the orchestrator runs the full suite.
- Do not touch the live stack. Do not edit CHANGELOG.md (the release job owns it), package.json, package-lock.json, `.github/**` or `release/**`. `.planning/config.json` has an uncommitted orchestrator change: never stage it.
