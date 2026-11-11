---
phase: quick-261108-ncf
plan: 01
subsystem: daemon
status: complete
tags: [observability, logging, tests]
requires: []
provides:
  - "daemon consumer tests for the invalid REALM_LOG_LEVEL warning (Phase 17 verification gap 2, P17-O4)"
affects: [test/daemon/main.test.ts]
key-files:
  created: []
  modified:
    - test/daemon/main.test.ts
decisions:
  - "Test-only change: src/daemon/main.ts is unchanged. The warning is observable through the existing request log harness, so no production change was needed."
metrics:
  tasks: 2
  commits: 1
  plan_head_before: 097256f
  commits_measured: 1
---

# Quick Task 261108-ncf: Pin the daemon invalid log level warning

Three behaviour tests in `test/daemon/main.test.ts` run the real `runDaemon` and pin the `daemon.log-level` warning for an invalid, a valid and an unset `REALM_LOG_LEVEL`.

## Verified order

`requestLogger` (src/daemon/main.ts) calls `parseLogLevel` and writes the `daemon.log-level` warning before `start()` is called. The warning therefore lands in `requests.log` ahead of any start-time line, and the tests read it from there.

## Tests added

- **Invalid level:** exactly one `daemon.log-level` line, parsed to `{ level: "warn", event: "daemon.log-level", value: "info" }`. The info probe line is kept, the debug probe line is dropped, and the raw sentinel value appears neither in the request log nor in the stderr sink.
- **Valid level (`debug`):** no `daemon.log-level` line in the request log or stderr, and the debug probe line is kept.
- **Unset level:** no `daemon.log-level` line, and the default filter drops debug while keeping info.

A shared `runWithLogLevel` helper reuses the existing `tempDir`, `validConfig`, `writeConfig` and `harness` helpers. No second harness, no new imports, no source-text assertions.

## Commits

- `94590fd` test(daemon): pin the invalid REALM_LOG_LEVEL warning on the request log

The SUMMARY and planning docs are not committed here; the orchestrator commits them.

## Verification (exit codes)

- `npm run build && node --test dist/test/daemon/main.test.js`: exit 0, 29 pass, 0 fail.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npm run check:gates`: exit 0 (gate closure: no violations; module size: no violations).

All four were run through `heavy-slot-1.lock`. `npm run check:docs` is not run here because this SUMMARY is the only docs artifact written.

## Deviations

- The session's default shell directory was the owner's main checkout, not the pinned root. The first pin-guard run therefore failed with root-mismatch. Re-running the guard and all later commands with the working directory set to the pinned root fixed it. No files were written from the wrong checkout.
- `.planning/config.json` carries the orchestrator's uncommitted change. It was neither staged nor reverted.

## Self-Check: PASSED
