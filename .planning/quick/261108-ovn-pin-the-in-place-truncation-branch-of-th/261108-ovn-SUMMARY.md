---
phase: quick-261108-ovn
plan: 01
subsystem: daemon
tags: [obs-02, start-failure, test, mutation-check]
requires:
  - "Quick task O (commit 5c79211): daemonStartFailureSince identity and size rule"
provides:
  - "Two OBS-02 tests pinning the size rule of daemonStartFailureSince"
affects:
  - test/daemon/start-failure.test.ts
key-files:
  created: []
  modified:
    - test/daemon/start-failure.test.ts
decisions:
  - "Tests only: src/daemon/ensure.ts is unchanged; the size rule is pinned through the reader's public behaviour."
metrics:
  tasks: 3
  commits: 1
status: complete
---

# Quick task 261108-ovn: pin the in-place truncation branch of the start-failure reader (OBS-02)

## One-liner

Two `OBS-02:` tests show that a log truncated in place (same inode, shorter than the mark) is read from byte 0, and a scratch mutation check shows both fail once the `size < offset` term is removed.

## What changed

- `test/daemon/start-failure.test.ts` only:
  - Imports `statSync` from `node:fs` and the `DaemonLogMark` type from `src/daemon/ensure.js`.
  - Adds `NON_FAILURE_LINE` (a 42-byte `daemon.started` record) and the helper `truncateInPlaceAfterMark`. The helper writes seven startup records, takes `daemonLogMark`, then rewrites the same path with `writeFileSync`. That keeps the inode and produces a replacement about 118 bytes long, shorter than the 294-byte mark.
  - Test A, `OBS-02: a log truncated in place keeps its inode and is read from byte 0 when it shrank below the mark`: asserts the device and inode are unchanged (so it is not a rotation), asserts the size is below the mark, and asserts `daemonStartFailureSince(stateDir, mark.offset, identity)` returns `POLICY_DENIED`.
  - Test B, `OBS-02: the two-argument reader also reads an in-place truncated log from byte 0`: the same setup, asserting the size is below the mark and that `daemonStartFailureSince(stateDir, mark.offset)` returns `POLICY_DENIED`.
- `src/` is unchanged. Existing tests are unchanged.

## Verification

- `npm run build` through the heavy-slot lock: exit 0.
- `node --test dist/test/daemon/start-failure.test.js` on the checkout: 19 tests, 19 pass, 0 fail (17 existing plus 2 new).
- Scratch mutation check: the compiled `dist/` was copied into an OS temp directory outside the checkout, and the `start` line in that copy was changed to `const start = replaced ? 0 : offset;` (the size term removed). Running `node --test dist/test/daemon/start-failure.test.js` there gave 17 pass and 2 fail. The failing tests were both `OBS-02:` tests (`a log truncated in place keeps its inode ...` and `the two-argument reader also reads an in-place truncated log ...`). The scratch directory was then removed. `src/daemon/ensure.ts` in the checkout was not edited.
- `npm run typecheck` through the lock: exit 0.
- `npm run lint` through the lock: exit 0.
- `npm run check:gates` through the lock: exit 0 (gate closure: 4 modules, no violations; module size: 107 files checked, no violations).
- Full test suite not run (left to the orchestrator). `test/daemon/main.test.ts` is unchanged.

## Deviations from Plan

None in behaviour. The plan's note that `main.test.ts` uses offset 0 was taken as given; `main.test.ts` was not changed.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED
