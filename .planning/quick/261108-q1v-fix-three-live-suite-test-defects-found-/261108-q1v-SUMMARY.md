---
task: 261108-q1v
type: quick
status: complete
files_modified:
  - test/integration/production-driver.test.ts
commits:
  - "test(live): fix three production-suite defects found by the first non-gateway window"
---

# Quick task 261108-q1v: fix three live-suite test defects

## Outcome

Three test-code defects in `test/integration/production-driver.test.ts` are fixed. Each failed at the last assertion of a scenario whose earlier assertions had passed. No file under `src/` or `test/support/` changed. The live suite was not run; its gate stays closed.

## Changes

1. **Scenario 5 (re-adoption).** Removes its host copy of `WORKSPACE_ADOPT_NAME` after the catch block and before `assertDownAndClean`, so the residue check after `realm down` sees an empty pinned workspace. Every existing assertion, the `finally` block and the catch block are unchanged.
2. **Scenario 5b (SIGTERM destroy path).**
   - New constant `WORKSPACE_DESTROY_NAME` (`realm-live-destroy-marker`), added to `WORKSPACE_FILES` so cleanup removes it on failure.
   - The scenario now receives `WORKSPACE_FILES`.
   - Before the SIGTERM it opens one MCP session, calls `initializeMcp`, `status` and `write`, asserts the write's `bytes` and `sha256`, and closes the session in a `finally`. The write creates the session's audit file, so the `realm audit verify` after the restart reads a real file.
   - Removes its host copy of the written file before `assertDownAndClean`.
   - The destroyed-record checks, the `daemon.startup` checks and the `realm audit verify` assertions are unchanged.
3. **Scenario 6 (MCP).** The `realm metrics` call in `runMcpSession` now passes `--workspace <pinned root>`, as `statusCli` does through `realmCliWithWorkspace`. `realm metrics` accepts `--workspace` (`src/cli/main.ts`). Every metrics assertion is unchanged.

## Verification (exit codes, run under the heavy-slot lock)

- `npm run typecheck`: exit 0
- `npm run lint`: exit 0
- `npm run check:gates`: exit 0 (gate closure: 4 modules, no violations; module size: 107 files, no violations)
- `npm run build && node --test dist/test/integration/production-live-helpers.test.js`: exit 0 (96 of 96 pass, 0 skipped)
- `npm run check:docs`: exit 0 (host paths ok, agents sync ok, default mode: no advisory-default claim)

The live suite was not run.

## Notes

- The repository's `.planning/config.json` carries an uncommitted orchestrator change. It was not staged or reverted. The code commit contains only the test file.
- Scenario 10 (`production live 10`) calls `realm metrics` without `--workspace` at the same defect site. It is out of this task's scope and was left unchanged. It will need the same fix if its metrics call fails on a live run.
- The first shell in this session started in the owner's main checkout, so the root-pin guard failed there. Re-running the guard with the working directory set to the pinned root passed. All file edits and commits were made from the pinned root.
