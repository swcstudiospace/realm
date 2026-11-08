---
phase: quick-261108-ncd
plan: 01
subsystem: daemon, audit
status: complete
requirements: [OBS-01, OBS-02]
commits:
  - 5c79211 fix(daemon): read the start-failure log by identity so a rotation cannot hide a failure
  - 74ce823 test(audit): pin merkleRootOfLeaves against roots computed with node:crypto
  - 6735d4b test(audit): pin the unreadable-file exit and the audit head look-back boundaries
---

# Quick task 261108-ncd: close the offline Phase 17 gaps (OBS-01, OBS-02)

## Outcome

All three plan tasks landed as three atomic commits. The start-failure reader was a real defect and is fixed. `merkleRootOfLeaves` is exported and pinned by independent roots. The unreadable-audit-file CLI case and the head look-back boundaries have deterministic tests. `src/audit/chain.ts` is unchanged, and no boundary test exposed a behaviour that differs from the plan's description.

## Task 1: rotation-aware start-failure reader (commit 5c79211)

Defect confirmed from the code before editing. The entry writer sends `daemon.log` through the rotating file sink, which renames the file to `daemon.log.1` at the size cap and opens a fresh `daemon.log`. The old reader kept only a byte offset and returned no failure whenever the file was not longer than that offset. After a rotation to a shorter replacement, every later poll returned `undefined`. A replacement longer than the offset was read from the middle, which could cut a `daemon.failed` line. Either way `realm up` waited for the timeout.

Change in `src/daemon/ensure.ts`:

- `daemonLogMark(stateDir)` takes the log's size and its identity (device and inode, as bigint) in one `stat`. It returns size 0 with no identity when the log is absent. This is one helper rather than the separate identity helper the plan described, so the offset and identity come from the same file.
- `daemonStartFailureSince(stateDir, offset, identity?)` opens the log once and `fstat`s that descriptor. It reads from byte 0 when an identity was supplied and the opened file's device or inode differs, or when the file is smaller than the offset. Otherwise it reads from the offset. The two-argument call used by `test/daemon/main.test.ts` keeps its meaning.
- `reportingStartFailure` records the mark on the first miss and keeps it. A rotation after that is caught by the identity comparison on the next read.
- Only the catalogue code leaves the reader, as before. `LOCK_CONFLICT`, uncatalogued codes and a trailing line without a newline are still ignored.
- The stale "no rotation" comments on `daemonLogPath`, `daemonStartFailureSince` and `reportingStartFailure` now describe the rotation-aware behaviour.

Tests in `test/daemon/start-failure.test.ts` (new): a failure appended to a shorter replacement; a failure near the start of a replacement longer than the old offset; the wrapper rejecting with the daemon's code after a rotation between polls; a pre-mark failure staying ignored across a rotation to a file with no failure line; a `LOCK_CONFLICT` line in a replacement not counting as a failure. The existing tests are unchanged.

Not run: a red-phase run of the new tests against the pre-change reader. Tests B and C are reasoned to fail there (the old read starts mid-line in B, and in C the replacement is shorter than the old offset).

## Task 2: export and pin `merkleRootOfLeaves` (commit 74ce823)

- `src/audit/anchor.ts`: `merkleRootOfLeaves` is exported with a doc comment covering the leaf inputs, the pairing and promotion rule, and the empty-input error. No hash, prefix or algorithm byte changed. `parentLevel` is not exported.
- `test/audit/anchor.test.ts`: direct tests for empty (`SCHEMA_INVALID`), one, two, three, four, five, six and seven leaves. Expected roots are built from the file's own `leaf`/`node` `node:crypto` helpers, not from the module. For odd counts (3, 5, 7) each test also asserts that the root differs from the duplicate-the-last-leaf construction. A test checks that `merkleRoot(lines)` equals `merkleRootOfLeaves` of the leaf hashes for three and five lines.

## Task 3: unreadable-file CLI test and head boundaries (commit 6735d4b)

- `test/cli/audit.test.ts`: a regular file at mode `0o000` passed to `realm audit verify --file` must exit 1 with the `unreadable` failure, the stderr text "audit file cannot be read", no `ok: true` file, and no file path, audit directory or state directory in stdout or stderr. The test skips with a stated reason when running as uid 0, as the ONB-02 test in `test/doctor/fix.test.ts` does. Mode is restored in a `finally` inside the test body, not in `t.after`, because `withState` removes the directory before `t.after` hooks run.
- `test/audit/chain.test.ts`: `readAuditHead` is pinned as follows.
  - A chained line exactly 64 lines from the end is the head. The chained prefix verifies to the same seq and hash.
  - A chained line 65 lines from the end gives `none`.
  - A torn final line is never the head. The verifier reports the same head with `tornTail` true.
  - A file that is only a torn fragment gives `none`.
  - A legacy-only file gives `none`. The verifier reports `ok`, with every line unprotected.
  - Tail-window edge: with the chained line starting one byte inside the window the head is found. With it starting exactly at the window boundary the result is `none`.
  - Where the verifier is applied to an altered file (the 64-line, 65-line and window cases), it reports `unchained-line` at line 3.
- No defect in `readAuditHead` surfaced. The 64-line look-back limit is the documented, accepted gap and is pinned, not fixed.

## Verification run

Heavy commands ran through `flock -w 7200 <heavy-slot lock> <command>`, the lock the orchestrator names.

| Command | Result |
|---|---|
| `npm run build && node --test dist/test/daemon/start-failure.test.js dist/test/daemon/main.test.js` | exit 0, 46 pass, 0 fail |
| `npm run build && node --test dist/test/audit/anchor.test.js` | exit 0, 42 pass, 0 fail |
| `npm run build && node --test dist/test/audit/chain.test.js dist/test/cli/audit.test.js` | exit 0, 57 pass, 0 fail, 1 skipped (mode-0 test, uid 0) |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run check:gates` | exit 0 (gate closure: no violations; module size: 107 files, no violations) |
| `npm run check:docs` | exit 0 (host paths ok, agents sync ok, default-mode ok) |

The full suite was not run here; the orchestrator runs it.

## Deviations from plan

- Task 1 uses one `daemonLogMark` helper that returns both offset and identity from a single `stat`, not a separate identity helper. The reason is that a separate stat could race a rotation between the two reads.
- The mode-0 test restores the file mode in a `finally` block inside the test, not in `t.after` (see Task 3).

## Known limits

- The unreadable-file CLI test skips as root. It was not executed as a non-root user in this run.
- The head look-back remains 64 lines and the tail window remains `2 * (AUDIT_LINE_MAX_BYTES + 1)`. Both are pinned by tests as documented limits.

## Self-Check: PASSED

- Commits 5c79211, 74ce823 and 6735d4b exist on the task branch.
- Files changed: `src/daemon/ensure.ts`, `test/daemon/start-failure.test.ts`, `src/audit/anchor.ts`, `test/audit/anchor.test.ts`, `test/cli/audit.test.ts`, `test/audit/chain.test.ts`. `src/audit/chain.ts`, `src/daemon/main.ts`, `src/observe/log-file.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `.github/**`, `release/**` and `.planning/config.json` were not modified or staged by this task.
