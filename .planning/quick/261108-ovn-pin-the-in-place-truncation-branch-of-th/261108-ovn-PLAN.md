---
phase: quick-261108-ovn
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - test/daemon/start-failure.test.ts
autonomous: true
requirements:
  - OBS-02
must_haves:
  truths:
    - "A log truncated in place (same inode, shorter than the mark) is read from byte 0, so a failure line in the replacement is reported through the identity-aware reader and through the two-argument reader."
    - "Each new test first proves the inode and device did not change, so the in-place path is exercised and not a rotation."
    - "Removing the size term from the reader's start expression in a scratch copy makes both new OBS-02 tests fail."
    - "No file under src/ changes, and the only committed file is test/daemon/start-failure.test.ts."
  artifacts:
    - path: test/daemon/start-failure.test.ts
      provides: "Two OBS-02 tests pinning the size rule of daemonStartFailureSince"
      contains: "OBS-02:"
  key_links:
    - from: test/daemon/start-failure.test.ts
      to: src/daemon/ensure.ts
      via: "daemonLogMark identity passed to daemonStartFailureSince; the start expression `replaced || size < offset ? 0 : offset` (src/daemon/ensure.ts, daemonStartFailureSince)"
threat_model:
  trust_boundaries:
    - boundary: "test scratch copy to checkout"
      description: "The mutation check edits a copy of compiled output, never the checkout's src/."
  threats:
    - id: T-ovn-01
      category: Tampering
      component: "src/daemon/ensure.ts"
      severity: low
      disposition: mitigate
      mitigation_plan: "Task 2 edits only a scratch copy outside the checkout and leaves src/daemon/ensure.ts untouched."
---

<objective>
Pin the in-place truncation branch of the daemon start-failure reader (Phase 17, OBS-02) with tests only.

Quick task O (commit 5c79211) made `daemonStartFailureSince` in `src/daemon/ensure.ts` start from byte 0 when the log's device or inode differs from the recorded identity, or when the file is shorter than the recorded offset: `const start = replaced || size < offset ? 0 : offset;`. The identity rule is pinned by the existing rotation tests, which replace the file with a new inode. Nothing pins the size rule: with `replaced` decided first, removing `size < offset` leaves all 17 tests in `test/daemon/start-failure.test.ts` green. The size rule guards a file truncated in place (same inode, shorter), which the production rotation (`src/observe/log-file.ts`, rename) never produces.

Purpose: make the size rule's deciding case observable, so a regression that drops it fails a test.
Output: two new `OBS-02:` tests in `test/daemon/start-failure.test.ts`, and a recorded scratch mutation check showing both fail without the size term.
</objective>

<context>
@.planning/quick/261108-ovn-pin-the-in-place-truncation-branch-of-th/261108-ovn-CONTEXT.md
@AGENTS.md
@test/daemon/start-failure.test.ts
@src/daemon/ensure.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add two OBS-02 in-place truncation tests to start-failure.test.ts</name>
  <files>test/daemon/start-failure.test.ts</files>
  <action>
Edit only `test/daemon/start-failure.test.ts`. Do not touch `src/`.

Imports: add `statSync` to the existing `node:fs` import list. Add `type DaemonLogMark` to the existing `../../src/daemon/ensure.js` import block (the type is exported there, at `src/daemon/ensure.ts`, next to `daemonLogMark`).

Module-level constant: `NON_FAILURE_LINE`, one startup record written as JSON with `level` "info" and `event` "daemon.started", followed by a newline. It is 42 bytes, so seven copies are about 300 bytes. Build it with JSON.stringify, the same style as the `failed` helper.

Helper `truncateInPlaceAfterMark(stateDir: string): DaemonLogMark`, placed after the existing `rotate` helper. It writes `NON_FAILURE_LINE` repeated seven times to `daemonLogPath(stateDir)` with writeFileSync, takes `daemonLogMark(stateDir)`, then writeFileSync to the SAME path with the text "startup output after truncation, before the failure\n" followed by `failed("POLICY_DENIED")`. That replacement is about 116 bytes, shorter than the mark's offset. writeFileSync opens the existing path with truncation, so the inode is kept. Add a comment saying so, because that is the point of the test. Return the mark.

Test A, named "OBS-02: a log truncated in place keeps its inode and is read from byte 0 when it shrank below the mark":
- `stateDir = scratchStateDir(t)`; `mark = truncateInPlaceAfterMark(stateDir)`.
- `identity = mark.identity`; `assert.ok(identity !== undefined, "the mark records the startup log's identity")`. Use `assert.ok` so the type narrows; do not use a non-null assertion.
- `after = statSync(daemonLogPath(stateDir), { bigint: true })`; assert `after.dev` equals `identity.dev` and `after.ino` equals `identity.ino`, with a message saying the rewrite was in place and not a rotation.
- Assert `daemonLogSize(stateDir) < mark.offset`, with a message saying the size rule is the deciding term.
- Assert `daemonStartFailureSince(stateDir, mark.offset, identity)` equals "POLICY_DENIED".

Test B, named "OBS-02: the two-argument reader also reads an in-place truncated log from byte 0":
- Same setup via `truncateInPlaceAfterMark`.
- Assert `daemonLogSize(stateDir) < mark.offset`.
- Assert `daemonStartFailureSince(stateDir, mark.offset)` equals "POLICY_DENIED". This is the no-identity form, so the size rule is the only rule that can decide it.

Use `void test(...)` and the file's existing style: `scratchStateDir(t)` for the directory, and `assert.equal` on the returned code. Do not add new error-shape assertions. Do not modify any existing test. No suppression comments, no source-text assertions (AGENTS.md).
  </action>
  <verify>
    <automated>npm run build && node --test dist/test/daemon/start-failure.test.js</automated>
  </verify>
  <done>Both OBS-02 tests exist in test/daemon/start-failure.test.ts, the whole file passes on the compiled tree (the 17 existing tests plus the 2 new ones), and no file under src/ changed.</done>
</task>

<task type="auto">
  <name>Task 2: Scratch mutation check that the size term is pinned (no checkout edits)</name>
  <files>test/daemon/start-failure.test.ts</files>
  <action>
This task runs after Task 1's build. It edits no file in the checkout. It is the check the context requires: the new tests must fail when the size term is removed.

1. Create a scratch directory with `mktemp -d` (an OS temp directory, outside the repository). Do not write its path into any file in the repository or in this plan.
2. Copy the checkout's compiled `dist/` and `package.json` into the scratch directory. Link `node_modules` from the checkout root into the scratch directory so module resolution works.
3. In the scratch copy only, grep for `const start = replaced` in `dist/src/daemon/ensure.js` and confirm the line is `const start = replaced || size < offset ? 0 : offset;`. If the compiled text differs, stop and report the actual line rather than guessing.
4. With the edit tool, edit that line in the scratch copy's `dist/src/daemon/ensure.js` to `const start = replaced ? 0 : offset;`. This removes the size term and leaves the identity rule unchanged. Do not use sed, perl or python.
5. From inside the scratch directory, run `node --test dist/test/daemon/start-failure.test.js`. Record the names of the failing tests.
6. Expected result: both "OBS-02:" tests fail. Report every other failing test name too, because the claim is about the two new tests. If the two OBS-02 tests pass under the mutation, the tests do not pin the size rule: report that as a blocker and do not weaken the tests.
7. Delete the scratch directory with `rm -rf` on the directory it created.

Never edit `src/daemon/ensure.ts` in the checkout for this check. Never run the mutation in the checkout's `dist/`.
  </action>
  <verify>
    <automated>Scratch copy of dist with the size term removed: node --test dist/test/daemon/start-failure.test.js exits non-zero and reports both "OBS-02:" tests as failing.</automated>
  </verify>
  <done>The scratch run's failing test names, including both OBS-02 tests, are reported; the scratch directory is removed; src/daemon/ensure.ts in the checkout is unchanged.</done>
</task>

<task type="auto">
  <name>Task 3: Final gates and commit</name>
  <files>test/daemon/start-failure.test.ts</files>
  <action>
Run the gates from the checkout root, each wrapped in the heavy-slot host lock according to your notes: `npm run typecheck`, `npm run lint`, `npm run check:gates`. Do not run the full test suite; the orchestrator runs it after this task.

If all three exit 0, commit with the subject `test(daemon): pin the in-place truncation branch of the start-failure reader (OBS-02)`. Stage only `test/daemon/start-failure.test.ts`. Never stage `.planning/config.json`, and do not stage anything under `src/`, `.planning/phases/`, `.planning/REQUIREMENTS.md` or `.planning/ROADMAP.md`.

If a gate fails because of the new tests, fix the test (for example an unused import or a lint rule) without suppression comments and without weakening the assertions, then rerun the gates and the start-failure file.
  </action>
  <verify>
    <automated>npm run typecheck && npm run lint && npm run check:gates</automated>
  </verify>
  <done>typecheck, lint and check:gates each exit 0; the commit, if made, touches only test/daemon/start-failure.test.ts.</done>
</task>

</tasks>

<verification>
- `npm run build && node --test dist/test/daemon/start-failure.test.js` passes, including both new OBS-02 tests.
- The scratch mutation check (Task 2) fails both new tests when the `size < offset` term is removed.
- `npm run typecheck`, `npm run lint` and `npm run check:gates` exit 0.
- Only `test/daemon/start-failure.test.ts` changes in the repository.
</verification>

<success_criteria>
- Two `OBS-02:` tests exist in `test/daemon/start-failure.test.ts`: the identity-aware in-place truncation test, which first proves the inode is unchanged and that the replacement is shorter than the mark; and the two-argument in-place truncation test.
- Both pass on the compiled tree.
- Both fail when the size term is removed in a scratch copy, and the failing names are reported.
- No change under `src/`, `CHANGELOG.md`, `package*.json`, `.github/`, `release/`, `docs/specs/`, `.planning/phases/`, `.planning/REQUIREMENTS.md` or `.planning/ROADMAP.md`.
</success_criteria>

<notes>
- Context correction: `test/daemon/main.test.ts` line 682 calls `daemonStartFailureSince(stateDir, 0)`, with offset 0. With offset 0 the size term never decides, so that call does not depend on the size rule as the context states. The new two-argument test in this plan (nonzero mark offset) is what pins the size rule for the two-argument form. `main.test.ts` is out of scope and stays unchanged.
- Verified in the tree before planning: `daemonLogMark` at `src/daemon/ensure.ts:102`; the start expression at `src/daemon/ensure.ts:153`; test helpers `scratchStateDir`, `failed` and `rotate` at `test/daemon/start-failure.test.ts:18-33`; the existing failure tests at lines 35-41.
- Lock wrapping of heavy commands (build, typecheck, lint, check:gates, the test file) is the executor's responsibility per its own notes; the verify commands above carry no lock prefix.
</notes>
