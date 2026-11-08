# QUICK-O3: pin the in-place truncation branch of the start-failure reader (Phase 17, OBS-02)

## Why

Quick task O (commit 5c79211) changed `daemonStartFailureSince` in `src/daemon/ensure.ts` so that the reader starts from byte 0 when either (a) the log's device or inode differs from the identity recorded with the mark, or (b) the file is shorter than the recorded offset. The expression is `const start = replaced || size < offset ? 0 : offset;`.

An independent mutation check on the scratch export of 5c79211 showed:

- Removing the identity check (`replaced` forced to false) fails 3 of the new tests. The identity mechanism is pinned.
- Removing the size rule (`size < offset` term dropped) leaves all 17 tests in `test/daemon/start-failure.test.ts` green. Every new rotation test replaces the file with a NEW inode, so `replaced` decides first and the size rule is never the deciding term. Nothing pins the size rule.

Production rotation (`src/observe/log-file.ts`) renames the file, so the inode changes and the identity rule covers it. The size rule still guards a file truncated in place (same inode, shorter), and the two-argument call used by `test/daemon/main.test.ts` (no identity) depends on it entirely. It needs a test.

## Required change (test only)

File in scope: `test/daemon/start-failure.test.ts`. Nothing else. No change to `src/`.

Add tests named with the prefix `OBS-02:` (follow the file's existing names and helpers: `scratchStateDir`, `failed()`, the `RealmError` assertion shape):

1. In-place truncation with identity: write a `daemon.log` with about 300 bytes of non-failure JSON lines. Take the mark with the file's existing mark helper (`daemonLogMark`). Rewrite the SAME path in place so the inode is kept: `writeFileSync` on the existing path (opens with truncation, same inode). Write a new, shorter content of about 120 bytes that ends with one complete `daemon.failed` line carrying a catalogue code the file already uses (for example `OPENSHELL_START_FAILED` or whichever the existing tests use). Call `daemonStartFailureSince(stateDir, mark.offset, mark.identity)` and assert it returns that code. Before the call, assert that the inode and device did not change (`statSync(path, { bigint: true })`), so the test proves the in-place path and not a rotation. Assert the new size is below the mark's offset, so the size rule is the deciding term.
2. The same truncation through the two-argument call (no identity), since `test/daemon/main.test.ts` uses that form: the same file contents, the call `daemonStartFailureSince(stateDir, mark.offset)` returns the code.

Both tests must fail if the `size < offset` term is removed from `start`. Verify that yourself: in a SCRATCH copy outside the repository (for example a directory under the OS temp dir, with `node_modules` linked from the lane), apply the removal to the compiled or copied `ensure` source, run `node --test` on `test/daemon/start-failure.test.ts`, and report the failing test names. Do not edit the lane's `src/daemon/ensure.ts` for this check. Never write a host-local path into a committed file.

## Verification

- `flock -w 7200 <heavy-slot lock> npm run build` then `node --test dist/test/daemon/start-failure.test.js` with the same lock: all tests pass, including the two new ones.
- The scratch mutation check above fails both new tests.
- `npm run typecheck`, `npm run lint`, `npm run check:gates`, each through the lock.
- The orchestrator runs the full suite after this task. Do not run it yourself.

## Out of scope

`src/**`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `.github/**`, `release/**`, `docs/specs/realm-spec.xml`, `.planning/phases/**`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/config.json` (never stage it), and the live stack.
