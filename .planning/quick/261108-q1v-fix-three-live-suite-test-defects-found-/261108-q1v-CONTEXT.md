# QUICK-W: fix three live-suite test defects found by the first non-gateway window (2026-11-08)

## Evidence (first window, production suite, 31 of 34 pass; OMPX-05 passes)

The window ran scenarios 1 to 9, 5b and 5c with the test name pattern. The results below are from the evidence TAP file. Each failure is at the LAST assertion of a scenario whose earlier assertions passed. Nothing in the product was shown wrong by these failures.

1. Scenario 5 (re-adoption, `production-driver.test.ts`, the test titled "production live 5: ..."): failed in the final `assertDownAndClean` with `residue after realm down: the pinned workspace holds 1 entry`. The entry is the marker file `WORKSPACE_ADOPT_NAME` that the scenario writes through MCP. The body never removes it, so the residue check sees it. Scenarios 1 and 6 remove their own host file in the body before the residue check (`rmSync(hostPath)` in those scenarios). Its adoption assertions had already passed: the sandbox identity, the status notice with count 1, the `daemon.startup` line with adopted 1, and the marker read-back.

2. Scenario 5b (SIGTERM destroy path, "production live 5b: ..."): failed at `realm audit verify after the SIGTERM restart` with `exit 1 ... audit file is missing`. The scenario makes no audited tool call before the SIGTERM, so the session never gets an audit file (the audit file is created on the first audited admission). The earlier destroyed-record assertions had passed: the container removed by the stop, the new container after the restart, the notice with 0 containers and at least one session record, and the restart's `daemon.startup` counts. Fix the scenario so it makes one audited write before the stop, then verify the chain after the restart, and remove the host file it wrote before the residue check.

3. Scenario 6 (MCP, "production live 6: ..."): failed at `realm metrics after the write` with `exit 1; stdout POLICY_DENIED`. The scenario calls `realmCli(scenario.inputs, scenario.environment, ["metrics"], ...)` with NO workspace argument. The CLI's `metrics` falls back to the working directory of the test runner, which is not an admitted project, so the daemon refuses it. The status helper in the same file passes the scenario's workspace (`statusCli` uses `realmCliWithWorkspace(..., scenario.inputs.workspaceRoot, ...)`). Phase 18 (commit b42cb35) made the CLI address each project by its selection, so this call has been stale since then. The earlier MCP steps (exec echo, exit code 3, write, the host file, read-back) had passed.

## Required change (test code only)

File in scope: `test/integration/production-driver.test.ts`. No change to `src/`, `test/support/` or any other file, unless a helper it needs does not exist: then stop and report instead.

1. Scenario 5: after the final read of the marker (the second MCP session's read-back) and before `await assertDownAndClean(scenario)`, remove the host file the scenario wrote, `rmSync(join(scenario.inputs.workspaceRoot, WORKSPACE_ADOPT_NAME), { force: true })`, following the way scenarios 1 and 6 remove theirs. Keep every existing assertion. Keep the `finally` blocks.
2. Scenario 5b: before the SIGTERM (after the first `assertActive` and the container and daemon checks, before `process.kill(daemonPid, "SIGTERM")`), open one MCP session the same way scenario 5 opens its primed session (`startMcpSession`, `initializeMcp`), make one `write` of a unique file name to the workspace (a new constant, for example `WORKSPACE_DESTROY_NAME`, added to `WORKSPACE_FILES`), assert the write's `bytes` and `sha256` as scenario 6 does, and close the session in a `finally` the way scenario 5 does (`closeInput`, `waitForExit(MCP_EXIT_TIMEOUT_MS)`, `kill`). The write creates the session's audit file. After the restart keep the destroyed-record checks as they are, and keep `realm audit verify` exactly as written: it now verifies a real file. Remove the host file the write created, before the final `assertDownAndClean`. Do not weaken any assertion.
3. Scenario 6: change the `realmCli(...["metrics"]...)` call to pass the scenario's workspace, the way `statusCli` does, by using `realmCliWithWorkspace(scenario.inputs, scenario.environment, ["metrics"], scenario.inputs.workspaceRoot, STATUS_TIMEOUT_MS)`. Keep every assertion on the metrics snapshot.
4. The name pattern bug is NOT in this file: it was the orchestrator's command line. Nothing to change for it here.

## Verification (offline only; do not run the live suite)

- `npm run typecheck`, `npm run lint`, `npm run check:gates`, each through the heavy-slot lock (the lock prefix is in the orchestrator notes, not in any file you commit).
- `npm run build` then `node --test` on `dist/test/integration/production-live-helpers.test.js` (hermetic; the live scenarios stay skipped because the gate is closed).
- Grep the file for the three changed spots and read them. The orchestrator reviews the diff and reruns the gates.

## Out of scope

Everything else: scenarios 10, S17-b and 15-10 L-B; the live run itself (a second window needs the owner's approval, asked separately); `CHANGELOG.md`; `package.json`; `package-lock.json`; `.github/**`; `release/**`; `docs/specs/realm-spec.xml`; `.planning/phases/**`; `.planning/REQUIREMENTS.md`; `.planning/ROADMAP.md`; `.planning/config.json` (never stage it). Commit only the test file; write the SUMMARY into the task directory.
