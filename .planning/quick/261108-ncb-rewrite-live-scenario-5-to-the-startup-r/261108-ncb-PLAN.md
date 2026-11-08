---
phase: quick-261108-ncb
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - test/support/production-live.ts
  - test/integration/production-live-helpers.test.ts
  - test/integration/production-driver.test.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "Live scenario 5 asserts the startup re-adoption behaviour (D5), not the superseded destroyed-at-startup behaviour."
    - "startupLineWith and adoptedCountOfNotice are pure helpers with hermetic fixed-input tests; startupReapLineFor and reapCountsOfNotice are gone."
    - "The gated live scenarios stay skipped; only the hermetic helper tests run."
  artifacts:
    - path: test/support/production-live.ts
      provides: "startupLineWith, adoptedCountOfNotice"
    - path: test/integration/production-live-helpers.test.ts
      provides: "hermetic tests for both helpers"
    - path: test/integration/production-driver.test.ts
      provides: "scenario 5 rewritten to adopt after crash"
  key_links:
    - from: test/integration/production-driver.test.ts
      to: test/support/production-live.ts
      via: "imports startupLineWith, adoptedCountOfNotice; drops startupReapLineFor, reapCountsOfNotice"
---

<objective>
Rewrite production live scenario 5 from "reap after crash" to "adopt after crash", per owner decision D5
(`docs/integration/runtime-decision.md`, "Startup reaper and scratch volume"): the startup reaper re-adopts a running realm
container that passes the hardening verifier. A live run on 2026-11-08 showed the notice "1 session(s) from the previous daemon
were adopted and kept." (`startupNoticeOf`, `src/daemon/daemon.ts`) and a `daemon.startup` line from `emitStartup`
(`src/daemon/main.ts`) with `adopted`, `containersRemoved`, `recordsDeleted`, `containerIds`.

Purpose: scenario 5 currently fails at its "destroyed at startup" assertion. Closes the Phase 14 CRASH-04 helper gap (the helper
now compares `recordsDeleted`) and the Phase 17 live re-run helper need.
Output: two new pure helpers with hermetic tests, and a rewritten scenario 5. Files in scope: the three listed in the
frontmatter. Nothing else.

Do NOT run the gated live scenarios (`REALM_LIVE_PRODUCTION=1`), and do not touch the live stack (no podman, openshell or
systemctl, nothing under the live account's home). Do not edit CHANGELOG.md, package.json, package-lock.json, `.github/**`,
`release/**`, `.planning/phases/`, REQUIREMENTS.md or ROADMAP.md. `.planning/config.json` has an uncommitted orchestrator change:
never stage it.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@AGENTS.md
@.planning/quick/261108-ncb-rewrite-live-scenario-5-to-the-startup-r/261108-ncb-CONTEXT.md
@test/support/production-live.ts
@test/integration/production-live-helpers.test.ts
@test/integration/production-driver.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Replace the reap helpers with startupLineWith and adoptedCountOfNotice, with hermetic tests</name>
  <files>test/support/production-live.ts, test/integration/production-live-helpers.test.ts</files>
  <behavior>
    - startupLineWith(log, expected) returns the first line of `log` (split on `\r?\n`) that parses as JSON (`parseJsonLine`), has `event === "daemon.startup"`, and whose `adopted`, `containersRemoved` and `recordsDeleted` each strictly equal the number given in `expected`; a field absent from `expected` is not compared. When `expected.containerId` is given and non-empty, the line's `containerIds` must be an array holding a string id that is non-empty and equals it, starts with it, or that it starts with (both prefix directions). An empty `containerId` returns undefined. No match returns undefined.
    - adoptedCountOfNotice(notice) returns the number n parsed from "<n> session(s) from the previous daemon were adopted and kept" and undefined when the sentence is absent.
    - Tests (fixed inputs, no host): positive match returning the exact line; wrong `adopted`, `containersRemoved` and `recordsDeleted` counts each rejected; a field not named in `expected` is not compared; non-JSON lines and a torn line skipped before a later matching line; a JSON line without the `daemon.startup` event (other event, same numbers) rejected; containerId prefix match short-in-expected and short-in-log; containerId mismatch and empty containerId rejected; `containerIds` missing or non-array rejected. adoptedCountOfNotice: adopted-only notice gives 1; notice without the adopted sentence (destroyed sentence only) gives undefined; notice with both sentences (destroyed then adopted, joined by a space, as `startupNoticeOf` produces) gives the adopted count, not the destroyed count; multi-digit count.
  </behavior>
  <action>
In `test/support/production-live.ts`, at the place of `startupReapLineFor` (after `noticeOfStatus`), remove both `reapCountsOfNotice` and `startupReapLineFor` with their comments (clean cutover, no alias). Add, with comments in the file's style:
- exported interface `StartupLineExpectation` with optional readonly numeric `adopted`, `containersRemoved`, `recordsDeleted` and optional readonly string `containerId` (mind `exactOptionalPropertyTypes`: declare as `readonly adopted?: number` and compare only when `!== undefined`).
- exported `startupLineWith(log: string, expected: StartupLineExpectation): string | undefined`, reusing the existing `parseJsonLine` and `field` helpers in this file (read the record through `field`, not a cast, where practical). Document that the container id is matched by prefix in both directions because the list taken before a kill prints Podman's short id while the daemon logs the full one, and that the log may hold lines from several daemon starts, so the caller states the counts it expects.
- exported `adoptedCountOfNotice(notice: string): number | undefined` using the regex `(\d+) session\(s\) from the previous daemon were adopted and kept` (the exact wording of `startupNoticeOf` in `src/daemon/daemon.ts`).

In `test/integration/production-live-helpers.test.ts`, add `startupLineWith` and `adoptedCountOfNotice` to the import list from `../support/production-live.js` (keep alphabetical-ish position next to the neighbours) and add a section "---- startupLineWith ----" and "---- adoptedCountOfNotice ----" in the file's existing `void test("...", () => {...})` style implementing the behaviours above. Build fixture lines with `JSON.stringify`. Update the header comment of the file to name the startup-line and notice readers if it lists helper areas. The tests must assert observable behaviour only (no source-text assertions).
  </action>
  <verify>
    <automated>npm run typecheck && npm run build && node --test dist/test/integration/production-live-helpers.test.js</automated>
  </verify>
  <done>Both helpers are exported and covered by the hermetic tests listed above; `startupReapLineFor` and `reapCountsOfNotice` no longer exist in `test/support/production-live.ts` (the driver test still imports them until Task 2, so typecheck of the whole project is only expected to pass after Task 2; run Task 1 and Task 2 edits before the first verify if typecheck fails on the stale import).</done>
</task>

<task type="auto">
  <name>Task 2: Rewrite live scenario 5 to "adopt after crash"</name>
  <files>test/integration/production-driver.test.ts</files>
  <action>
In `test/integration/production-driver.test.ts`, scenario "production live 5" (locate by that test title; it follows `jsonLinesSinceStartup` and `itemsOf` in the section "Scenario 5: crash recovery"). Locked decisions: keep every step up to the SIGKILL and the daemon-gone poll, and the container-left-behind poll, unchanged.

1. Imports: remove `reapCountsOfNotice` and `startupReapLineFor` from the `../support/production-live.js` import list; add `adoptedCountOfNotice` and `startupLineWith`. Keep `noticeOfStatus`, `callTool`, `initializeMcp`, `startMcpSession`, `decodeReadContent`, `field` (all already imported).

2. Marker file: add a constant `WORKSPACE_ADOPT_NAME = "realm-live-adopt-marker"` next to `WORKSPACE_MCP_NAME` and append it to `WORKSPACE_FILES` (so `cleanupScenario` removes it). Change the scenario's `startScenario(t, { image: inputs().image })` call to pass `WORKSPACE_FILES` as the third argument, as scenarios 1 and 6 do.

3. Before the kill: the scenario already opens a `primed` MCP session (`startMcpSession`, `initializeMcp`, `callTool(primed, "status", {})`). In that same session, after the status call and before it is closed, write the marker through the MCP `write` tool: content `` `realm-live-adopt-${randomUUID()}` `` kept in a local const, `callTool(primed, "write", { path: WORKSPACE_ADOPT_NAME, content })`; assert `field(written, "bytes") === Buffer.byteLength(content)` and `field(written, "sha256") === sha256Hex(Buffer.from(content))` as scenario 6 does. Keep the `finally` that closes input, waits for exit and kills.

4. Update the comment and the title: title becomes `production live 5: after the daemon is killed, the next realm up adopts the sandbox it left and reaches active with exactly one`. Rewrite the comments that say the restarted daemon "reaps", "destroys" or "reports destroying" the container to say it re-adopts it (D5, `docs/integration/runtime-decision.md`, "Startup reaper and scratch volume"). Fix the section comment at the head of the crash scenario if it says reap.

5. After `realm up` restarts the daemon and `waitForActive` passes, keep the existing assertions (one new daemon pid via `daemonPids`, `notEqual` to the old pid, the `replacementReady` poll for exactly one sandbox and one container) and add, in place of the old destroyed-notice block:
   - container identity: list the sandbox's containers (`itemsOf(listSandboxContainers(...))`) and assert the single container id and `crashedContainerId` match by prefix in either direction (`a.startsWith(b) || b.startsWith(a)`), with a failure message naming both ids. This proves re-adoption rather than recreation. Compute it after `replacementReady`.
   - status notice: `statusCli(scenario)`, `assertExit(status, 0, ...)`, `const notice = noticeOfStatus(status.stdout)`; assert `notice !== undefined`, `notice.includes("adopted and kept")`, `adoptedCountOfNotice(notice) === 1`, and `!notice.includes("destroyed at startup")`, each with `describeResult(status)` or the notice in the message.
   - daemon log: read `daemon.log` as today and assert `startupLineWith(daemonLog, { adopted: 1, containersRemoved: 0, recordsDeleted: 0, containerId: crashedContainerId }) !== undefined` with a message naming the container id. Keep the existing JSON-lines check, updated per step 6.
   - marker survived: open a second MCP session (`startMcpSession`, `await initializeMcp`), `callTool(session, "read", { path: WORKSPACE_ADOPT_NAME, maxBytes: MCP_READ_MAX_BYTES })`, assert `field(readBack, "status") === "found"`, `decodeReadContent(field(readBack, "content")) === content` and `field(readBack, "truncated") === false`; close it in a `finally` with `closeInput()`, `await waitForExit(MCP_EXIT_TIMEOUT_MS)`, `kill()` exactly as the primed session does. The host file at `join(scenario.inputs.workspaceRoot, WORKSPACE_ADOPT_NAME)` is left for cleanup (named in `WORKSPACE_FILES`).
   - keep the `realm audit verify` block and its assertions exactly as they are.

6. `jsonLinesSinceStartup`: it anchors on the last `daemon.startup` line with `containersRemoved === 1`, which no longer exists after a re-adoption. Change that anchor condition to `value.adopted === 1` (update the type annotation of the parsed value accordingly) so it checks that every `daemon.log` line from the adopting start onward is JSON.

7. Keep the `catch` block that runs one extra `up` and rethrows (its comment may say "adopt" or "start" instead of "reap": a daemon started by that `up` re-adopts or reaps what the crash left so the cleanup's `down` can remove it). Keep `await assertDownAndClean(scenario)` at the end.

Do not modify any other scenario. Do not run the live suite; it stays skipped without `REALM_LIVE_PRODUCTION=1`.
  </action>
  <verify>
    <automated>npm run typecheck && npm run build && node --test dist/test/integration/production-driver.test.js dist/test/integration/production-live-helpers.test.js</automated>
  </verify>
  <done>Scenario 5 asserts: status active, one new daemon process, one sandbox and one container whose id matches the pre-kill id, a status notice with "adopted and kept" and count 1 and no "destroyed at startup", a `daemon.startup` line with adopted 1, containersRemoved 0, recordsDeleted 0 naming the container, the MCP-written marker read back byte-identical, and `realm audit verify` ok. It compiles; the production-driver file loads and its live scenarios report skipped (gate closed); no references to `startupReapLineFor` or `reapCountsOfNotice` remain anywhere under `test/`.</done>
</task>

<task type="auto">
  <name>Task 3: Final gates</name>
  <files>test/integration/production-driver.test.ts, test/support/production-live.ts, test/integration/production-live-helpers.test.ts</files>
  <action>
Run the gates over the finished change; fix any finding in the three in-scope files only (an unused import, a lint rule, a `noUnusedLocals` hit on a helper that became unused such as a leftover constant). Confirm by grep that `startupReapLineFor` and `reapCountsOfNotice` appear nowhere under `test/`. Do not touch `.planning/config.json`, and stage only the three in-scope files plus this plan's own `.planning/quick/261108-ncb-*` artifacts when committing (Conventional Commit subject, type `test`, for example `test(live): rewrite scenario 5 to startup re-adoption`).
  </action>
  <verify>
    <automated>npm run typecheck && npm run lint && npm run check:gates</automated>
  </verify>
  <done>`npm run typecheck`, `npm run lint` and `npm run check:gates` all exit 0, and the hermetic helper tests from Task 1 still pass.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| test code to live stack | Gated scenarios only run with `REALM_LIVE_PRODUCTION=1`; this change runs none of them |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-ncb-01 | Tampering | marker file left in the pinned workspace | low | mitigate | `WORKSPACE_ADOPT_NAME` is named in `WORKSPACE_FILES`, so `cleanupScenario` removes it and the residue check stays empty |
| T-ncb-02 | Denial of service | stranded sandbox after a failed scenario | low | mitigate | existing catch block runs one extra `up` before rethrow, kept unchanged |
| T-ncb-03 | Information disclosure | secrets in failure messages | low | accept | messages carry ids, counts and notice text only, as before |
</threat_model>

<verification>
- `npm run typecheck`, `npm run lint`, `npm run check:gates` exit 0.
- `npm run build && node --test dist/test/integration/production-live-helpers.test.js` passes with the new helper tests.
- The live scenarios stay skipped; nothing touched the live stack.
</verification>

<success_criteria>
Scenario 5 matches the locked decisions in 261108-ncb-CONTEXT.md; helpers are pure with explicit parameters and hermetic tests; removed helpers leave no references; all three gates pass.
</success_criteria>

<output>
Create `.planning/quick/261108-ncb-rewrite-live-scenario-5-to-the-startup-r/261108-ncb-SUMMARY.md` when done
</output>
