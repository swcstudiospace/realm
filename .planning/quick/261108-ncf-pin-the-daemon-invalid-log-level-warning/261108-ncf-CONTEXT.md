# Quick task O2: pin the daemon's invalid log level warning (Phase 17, OBS-02, verification gap 2)

Spec: `.planning/phases/17-observability-and-tamper-evident-audit/17-VERIFICATION.md` (gap 2, about line 105) and plan 17-02 owner ruling P17-O4. Test-only task; it changes no logger contract and no production behaviour.

## Facts (re-verify the lines against the tree before editing)

- `src/daemon/main.ts` about lines 205-236: `requestLogger(writeStderr, rawLevel, logPath)` calls `parseLogLevel(rawLevel)`. For an invalid level it falls back to the parsed (effective) level and, after the logger exists, calls `logger.warn("daemon.log-level", { value: parsed.level })`. The field carries the EFFECTIVE level, not the raw text the operator supplied, so a raw secret-looking value never reaches the log.
- `test/observe/logger.test.ts` about lines 143-148 tests only `parseLogLevel`. No test exercises the daemon consumer; a repository-wide search finds no `daemon.log-level` assertion.
- `test/daemon/main.test.ts` already has a fake-start harness (see the tests around `onStartup`, the request-log file test near the end, and the entry sink test) and the plan-15-07 test that pins `doctorOptions`. Reuse the harness; do not build a second one.
- `REALM_LOG_LEVEL` is read only at the entry edge (`src/daemon/main.ts`, `deps.env["REALM_LOG_LEVEL"]`); tests pass it through the fake `deps.env`.

## Required tests (all in `test/daemon/main.test.ts`)

1. An invalid `REALM_LOG_LEVEL` (use a sentinel string such as `SENTINEL-LEVEL-VALUE`) produces exactly ONE `daemon.log-level` warning line in the request log or stderr sink the harness captures, the effective level filters as the default does (an `info` line is kept and a `debug` line is dropped, whichever the default level implies; read `parseLogLevel` to get the real default), and the sentinel text appears nowhere in the captured output.
2. A valid level (for example `debug`) and an unset level produce NO `daemon.log-level` warning.
3. If the harness cannot observe the warning without a production change, stop and report it in the SUMMARY; do not change production code to make a test pass.

## Out of scope

Everything outside `test/daemon/main.test.ts`. Do not edit `.planning/phases/` (the records task closes the verification gap text), `CHANGELOG.md`, `package-lock.json`, `.github/**` or `release/**`. Do not touch the live stack.
