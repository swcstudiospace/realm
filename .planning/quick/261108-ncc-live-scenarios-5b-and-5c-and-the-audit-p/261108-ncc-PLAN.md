---
quick_id: 261108-ncc
slug: live-scenarios-5b-and-5c-and-the-audit-pair-validator
date: 2026-11-08
type: quick
wave: 1
depends_on: []
autonomous: true
requirements: []
files_modified:
  - test/support/production-live.ts
  - test/integration/production-live-helpers.test.ts
  - test/integration/omp-ompx05.test.ts
  - test/integration/production-driver.test.ts
must_haves:
  truths:
    - "auditPairProblems(records, expected) returns [] for exactly one admission line followed by exactly one result line with one shared string correlationId, the expected tool and session id, and the expected result outcome, and a non-empty problem list for each of the eight failure shapes in the context"
    - "production live 5b exists: SIGTERM of the scenario's one daemon, then realm up, reports a destroyed-at-startup notice with 0 containers and at least 1 session record, a new container id, and a daemon.startup line of the restart with recordsDeleted >= 1, containersRemoved 0, adopted 0"
    - "production live 5c exists: a marker written under /scratch survives SIGKILL of the daemon plus realm up, reads back with identical bytes, and no volume named for the session remains after realm down"
    - "omp-ompx05 and production live 6 judge the admission/result pair through auditPairProblems and keep every assertion they hold today (bytes, sha256, outcome, string correlationId, audit verify)"
    - "the volume-list parser and every new validator case are covered by hermetic tests; the live scenarios stay gated and are never run"
  artifacts:
    - path: "test/support/production-live.ts"
      provides: "auditPairProblems, parseSessionVolumeNames, listSessionVolumes"
    - path: "test/integration/production-live-helpers.test.ts"
      provides: "hermetic tests for the three new helpers"
    - path: "test/integration/production-driver.test.ts"
      provides: "scenarios 5b and 5c, scenario 6 audit join through auditPairProblems"
    - path: "test/integration/omp-ompx05.test.ts"
      provides: "audit pair check through auditPairProblems"
  key_links:
    - from: "test/integration/production-driver.test.ts"
      to: "startupLineWith, adoptedCountOfNotice (quick task L1, 261108-ncb)"
      via: "import from test/support/production-live.ts"
---

<objective>
Add the two live scenarios that surround scenario 5 (the SIGTERM destroy path, 5b, and the per-session scratch volume lifecycle, 5c) and close the open item of plan 16-03 T1/T2: a pure audit-pair validator that the live scenarios use.

Purpose: the destroyed-record path and `recordsDeleted` (CRASH-04) and the scratch volume (RES-03) have no live proof, and the admission/result audit pair is judged by hand-rolled count checks in two places.
Output: three helpers in `test/support/production-live.ts`, their hermetic tests, the validator wired into two existing live tests, and scenarios 5b and 5c in `test/integration/production-driver.test.ts`.

Hard limits (from the context file, locked): edit only the four files in `files_modified`. Never run the gated live scenarios (`REALM_LIVE_PRODUCTION`, `REALM_LIVE_OMP`) and never touch the live stack (no podman, openshell or systemctl invocation, nothing under the live account's home directory). Do not edit CHANGELOG.md, package.json, package-lock.json, `.github/**`, `release/**`, or anything under `.planning/phases/`. `.planning/config.json` has an uncommitted orchestrator change: never stage it. Commit only the four files.

Prerequisite: quick task L1 (261108-ncb) has landed. It adds `startupLineWith(log, expected)` and `adoptedCountOfNotice(notice)` to `test/support/production-live.ts` and rewrites scenario 5. At planning time neither helper existed in the tree. Before Task 3, confirm `startupLineWith` is exported from `test/support/production-live.ts`; if it is not, STOP and report that L1 has not landed (do not write your own copy). Re-read its real signature and use that, not the one assumed here.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@AGENTS.md
@.planning/STATE.md
@.planning/quick/261108-ncc-live-scenarios-5b-and-5c-and-the-audit-p/261108-ncc-CONTEXT.md
@.planning/quick/261108-ncb-rewrite-live-scenario-5-to-the-startup-r/261108-ncb-CONTEXT.md
@test/support/production-live.ts
@test/integration/production-driver.test.ts
@test/integration/omp-ompx05.test.ts
@test/integration/production-live-helpers.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add auditPairProblems and the session-volume helpers, with hermetic tests</name>
  <files>test/support/production-live.ts, test/integration/production-live-helpers.test.ts</files>
  <behavior>
    Fixed-input cases for auditPairProblems, with records built as plain objects carrying correlationId, phase, tool, sessionId, outcome:
    - ok pair (admission outcome "ok", result outcome "ok") returns [].
    - ok pair whose expected outcome is an error code and whose result line carries that code returns [] (the admission line carries "ok" always, so only the result line is compared with expected.outcome).
    - missing result: one problem naming the result count.
    - missing admission: one problem naming the admission count.
    - duplicate admission: a problem that says exactly one admission is required.
    - duplicate result: a problem that says exactly one result is required.
    - reversed order (result line before admission line, one of each): a problem naming the order.
    - wrong correlation id: admission and result carry different ids, a problem naming the mismatch; and, separately, both carry the same id but expected.correlationId is another id, a problem naming it.
    - wrong session id: a problem naming the session id, reported for the line that carries it.
    - a wrong tool and a wrong result outcome are each reported.
    - a missing, empty or non-string correlationId is reported.
    - a record whose phase is neither admission nor result (for example reconciliation) is reported as an unexpected phase.
    - an empty record list returns the missing-admission and missing-result problems, never [].
    Cases for parseSessionVolumeNames(output, sessionId): returns [] for empty output; keeps the line equal to the session's scratch volume name; ignores other sessions' volume names, a name that only starts with the session's volume name, and blank lines; accepts CRLF and surrounding spaces; returns both entries when the same name is listed twice (a duplicate is evidence, not hidden).
  </behavior>
  <action>
In `test/support/production-live.ts`, in the Log files section next to `auditLinesWithCorrelation`, add exported `auditPairProblems(records: readonly LogRecord[], expected)`. The `expected` parameter is an exported interface `AuditPairExpectation` with required readonly `tool: string`, `sessionId: string`, `outcome: string` and optional `correlationId?: string` (the optional field is a plain optional property, compatible with `exactOptionalPropertyTypes` when callers omit it; never pass `undefined` explicitly). Return type `readonly string[]`; empty means ok. Use the same wire fields `auditLinesWithCorrelation` and `src/audit/log.ts` use (`phase`, `correlationId`, `tool`, `sessionId`, `outcome`); do not invent a field. Use the existing `field` helper for reads.

Logic, in this order: split the records by `phase`; any phase other than "admission" or "result" is a problem that names the phase and its position. Require exactly one admission and exactly one result, one problem each when the count is wrong, saying the count found. Only when there is exactly one of each, require the admission index to be lower than the result index, else one problem naming the order. For every admission and result line, require `tool === expected.tool` and `sessionId === expected.sessionId` and a non-empty string `correlationId`, each failure naming the phase and the value found (use `describeValue` for values so long text is clipped). Require the result line's `outcome === expected.outcome` (the admission line is not compared: `src/tools/dispatch.ts` and `src/tools/workspace.ts` always write "ok" on admission). When both lines carry string correlation ids, require them equal, and when `expected.correlationId` is given require every line to carry it. Never throw and never assert inside the validator: it is pure and returns strings only.

Also in `production-live.ts`, in the Residue section next to `listSandboxContainers`, add exported `parseSessionVolumeNames(output: string, sessionId: string): readonly string[]`: split with the existing `lines` helper, and keep the entries equal to `scratchVolumeNameOf(sessionId)` imported from `src/runtime/hardening.ts` (the single owner of the name, `SCRATCH_VOLUME_PREFIX` plus the session id; import it, do not rebuild the string). Then add exported async `listSessionVolumes(inputs: LiveInputs, sessionId: string): Promise<Listing>` that runs `podman volume ls --format {{.Name}}` through `runCommand` with `inputs.hostEnvironment`, a 30 s timeout and a temp-dir cwd exactly as `listSandboxContainers` does, returns `{ ok: false, detail: "podman volume ls failed (...)" }` with `describeResult` on a non-zero exit, and otherwise `{ ok: true, items: parseSessionVolumeNames(result.stdout, sessionId) }`. Account-wide listing plus exact-name filtering is deliberate: podman's `--filter name=` is a substring match and would also return another session's volume.

In `test/integration/production-live-helpers.test.ts`, add the three import names to the existing import list and add one `void test(...)` per behavior group above, in the existing style (a "---- auditPairProblems ----" section header, plain object records via a small local builder, `assert.deepEqual(..., [])` for ok cases and `assert.match` or a problem-count check for failures). Each failure test must assert the specific problem text, not just a non-empty list, so a validator that reports the wrong problem fails. Tests call no podman and read no host state.
  </action>
  <verify>
    <automated>npm run build && node --test dist/test/integration/production-live-helpers.test.js</automated>
  </verify>
  <done>The helpers test file passes with the new cases; the ok pair gives [] and each of the eight failure shapes gives a specific problem; `parseSessionVolumeNames` filters exactly; nothing live ran.</done>
</task>

<task type="auto">
  <name>Task 2: Use auditPairProblems in the Omp write test and production live 6</name>
  <files>test/integration/omp-ompx05.test.ts, test/integration/production-driver.test.ts</files>
  <action>
In `test/integration/omp-ompx05.test.ts`, import `auditPairProblems` from `../support/production-live.js` (sorted into the existing import list). In the "(c)" audit section after `const writes = auditEntries(auditFile).filter(... tool "write" and path name)`, replace the two count assertions (`admissions.length` is 1, `results.length` is 1), the result-line `correlationId` string assertion and the admission-to-result correlation equality assertion, and the result `outcome === "ok"` assertion with one assertion: `assert.deepEqual(auditPairProblems(writes, { tool: "write", sessionId, outcome: "ok" }), [], ...)` whose message includes `describeValue(writes)`. `sessionId` is the variable the test already uses to build `auditFile`; confirm it is in scope at that point and use it. Keep the `admissions`/`results` split only as far as the remaining assertions need it: keep, unchanged, the result line `bytes === expected.byteLength`, the result line `sha256`, and the admission line `sha256` assertions (they check payload facts the validator does not own). Do not weaken: the validator is strictly stronger than the removed assertions (it also checks order, tool and session id).

In `test/integration/production-driver.test.ts`, add `auditPairProblems` to the import list from `../support/production-live.js`. In `runMcpSession` (scenario 6), step 6 audit join: keep `const joined = auditLinesWithCorrelation(auditFile, correlationId)` and replace the `joined.length === 2` assertion and the phases-include assertion (and the now unused `phases` constant) with `assert.deepEqual(auditPairProblems(joined, { tool: "write", sessionId: sessionIdFor(scenario.inputs.workspaceRoot), outcome: "ok", correlationId }), [], ...)` whose message names the audit file and correlation id and includes `describeValue(joined)`. Leave the `unparsedLinesOf` and `realm audit verify` assertions exactly as they are. Match on current text, not the line numbers in the context file (scenario 5 is rewritten by quick task L1, so line numbers moved).
  </action>
  <verify>
    <automated>npm run typecheck && npm run lint</automated>
  </verify>
  <done>Both live tests judge the audit pair through `auditPairProblems`; every assertion that existed before either remains or is subsumed by a stricter one; no unused variable or import is left (`noUnusedLocals` and eslint pass); both files still compile and the gated tests still skip.</done>
</task>

<task type="auto">
  <name>Task 3: Add live scenarios 5b (SIGTERM destroy path) and 5c (scratch volume lifecycle)</name>
  <files>test/integration/production-driver.test.ts</files>
  <action>
Precondition: quick task L1 has landed. Confirm `startupLineWith` and `adoptedCountOfNotice` are exported from `test/support/production-live.ts` and read their signatures; STOP and report if they are absent. Add scenarios 5b and 5c immediately before the "Scenario 6: MCP exec" section header, after the L1-rewritten scenario 5, reusing the helpers already in the file (`startScenario`, `assertActive`, `up`, `down`, `statusCli`, `daemonPids`, `itemsOf`, `sandboxOf`, `assertExit`, `assertDownAndClean`, `waitForActive`, `pollUntil`, `startMcpSession`, `initializeMcp`, `callTool`, `noticeOfStatus`, `reapCountsOfNotice`) and the existing constants (`CRASH_OBSERVE_INTERVAL_MS`, `ACTIVE_TIMEOUT_MS`, `STATUS_TIMEOUT_MS`, `MCP_EXIT_TIMEOUT_MS`, `RESIDUE_TIMEOUT_MS`). Add the new names to the import list (`listSessionVolumes`, `startupLineWith` and `adoptedCountOfNotice` only if used). Each scenario uses `{ skip: gate, timeout: SCENARIO_TIMEOUT_MS }` like its neighbours and names no host path.

Scenario 5b, title exactly "production live 5b: after the daemon is stopped with SIGTERM, the next realm up reports the destroyed record and reaches active with a new container": startScenario with `{ image: inputs().image }`; `assertActive`; list the sandbox containers through `itemsOf(listSandboxContainers(...))` and require exactly one, keeping its id as `firstContainerId`; read `daemonPids` and require exactly one (the suite may only signal the one daemon its own `realm up` started; never signal any other pid), then `process.kill(pid, "SIGTERM")`. Poll with `pollUntil` and `CRASH_OBSERVE_INTERVAL_MS` until the daemon is gone AND `listSandboxContainers` returns no container for the sandbox, in one check that reports both in its detail. Use `RESIDUE_TIMEOUT_MS` (90 s, an existing constant) as the bound, not the 10 s `CRASH_OBSERVE_TIMEOUT_MS`, because `docs/integration/omp-lifecycle-runbook.md` section C says the SIGTERM removal takes about 30 s. Record the byte size of `daemon.log` in the scenario state directory (`statSync`, `join(scenario.environment.stateDir, "daemon.log")`) before the restart; `daemon.log` is the detached daemon's inherited stderr and is never rotated (`src/daemon/ensure.ts`, `daemonLogPath`), so the restart's lines are the bytes after that offset. Then `up`, `assertExit(..., 0, ...)`, `waitForActive` with `ACTIVE_TIMEOUT_MS`, and assert: a new daemon pid list of length 1; exactly one sandbox container whose id does not equal and does not prefix-match `firstContainerId` in either direction (the earlier list prints Podman's short id); the status notice from `noticeOfStatus(status.stdout)` includes "destroyed at startup" and `reapCountsOfNotice(notice)` gives `containers === 0` and `sessionRecords >= 1` (message includes the notice); from `daemon.log` bytes after the saved offset, `startupLineWith(restartLog, { adopted: 0, containersRemoved: 0 })` returns a line, which is parsed with `parseJsonLine` and must carry a numeric `recordsDeleted >= 1` (this line is the only live proof of the logged `recordsDeleted`, CRASH-04; `startupLineWith` compares equality only, so the lower bound is asserted on the parsed line). Run `realm audit verify --file <audit file>` the way scenario 5 does (audit file `join(stateDir, "audit", sessionIdFor(workspaceRoot) + ".jsonl")`, `assertExit(..., 0, ...)`, parsed `ok === true`). Wrap the body after the SIGTERM in try/catch whose catch runs one extra `up(scenario)` (result not judged) and rethrows, as scenario 5 does, so a failure cannot strand a sandbox; finish with `assertDownAndClean`.

Scenario 5c, title exactly "production live 5c: the scratch volume survives a daemon crash and is gone after realm down": startScenario; open an MCP session (`startMcpSession`, `initializeMcp`), `callTool(session, "exec", { argv: ["sh", "-c", WRITE_SCRIPT, "sh", marker, "/scratch/<fixed file name>"] })` with `WRITE_SCRIPT` (the existing 'printf %s "$1" > "$2"' constant; positional arguments, nothing interpolated), `marker` a fresh `realm-scratch-` plus `randomBytes(6).toString("hex")` value, and require `exitCode === 0`; close the session in a finally (`closeInput`, `waitForExit(MCP_EXIT_TIMEOUT_MS)`, `kill`) as scenario 5 does for its primed session. Before the kill, `listSessionVolumes(inputs, sessionIdFor(workspaceRoot))` through `itemsOf` must return exactly one name (this proves the helper is not vacuous). SIGKILL the one daemon pid and poll until it is gone with the scenario 5 constants (`CRASH_OBSERVE_TIMEOUT_MS`, `CRASH_OBSERVE_INTERVAL_MS`), `up`, `waitForActive`; the volume listing must still return exactly one name. Open a second MCP session, `callTool(session, "exec", { argv: ["cat", "/scratch/<fixed file name>"] })`, require `exitCode === 0`, `truncated` not true and `stdout === marker` (same bytes), and close it. Then `down(scenario)` with `assertExit(..., 0, ...)`, `waitForNoResidue` as `assertDownAndClean` does, and poll `listSessionVolumes` (bound `RESIDUE_TIMEOUT_MS`, interval 2 s) until it returns no name; a failed listing is a failed scenario, never "clean". Use the same try/catch with one extra `up` on failure as scenario 5. Add the fixed scratch file name as a constant next to the other scenario constants; it lives in the container volume, not the pinned workspace, so `WORKSPACE_FILES` is unchanged.

Do not modify scenario 5, any other scenario, or the shared helpers other than the import list. Do not run either scenario.
  </action>
  <verify>
    <automated>npm run typecheck && npm run lint</automated>
  </verify>
  <done>Scenarios 5b and 5c exist with the locked titles and assertions, compile, lint clean, and skip without `REALM_LIVE_PRODUCTION=1`; neither was run.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| test process to host processes | scenario 5b sends SIGTERM and 5c SIGKILL to a daemon pid |
| test process to podman | 5c lists the account's volumes |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-ncc-01 | Denial of service | signalling a daemon | high | mitigate | signal only the single pid `daemonPids` returns after asserting exactly one process runs from the compiled daemon entry, started by this scenario's own `realm up`; scenarios stay gated and are never run during this task |
| T-ncc-02 | Tampering | volume listing | low | mitigate | `listSessionVolumes` only lists (`podman volume ls`), filters by exact name, and removes nothing |
| T-ncc-03 | Information disclosure | assertion messages | low | accept | messages carry clipped `describeValue` output of audit lines and notices, which hold no secrets (audit lines are redacted at write) |
</threat_model>

<verification>
Final verify step (run after Task 3, fix anything reported in the four files, then commit): `npm run typecheck`, `npm run lint`, `npm run check:gates`, then `npm run build && node --test dist/test/integration/production-live-helpers.test.js`. The gated live scenarios are not run.

Commit exactly the four files in `files_modified` by explicit path with a Conventional Commit subject such as `test(live): add scenarios 5b and 5c and the audit-pair validator`; never stage `.planning/config.json`.

Follow-up for the orchestrator, not an edit in this task: AGENTS.md (Commands) describes the production live suite as "ten scenarios"; 5b and 5c make it twelve, and README.md and `docs/integration/openshell.md` cite dated evidence of ten scenarios. Those files are outside the four in scope, so record the mismatch in the summary and leave them untouched.
</verification>

<success_criteria>
- auditPairProblems exists, is pure, and its nine-plus hermetic cases pass.
- Scenarios 5b and 5c exist with the locked titles and compile; the live suite stays skipped here.
- omp-ompx05 and scenario 6 judge the audit pair through the validator with no assertion weakened.
- Only the four listed files changed, committed without `.planning/config.json`.
</success_criteria>

<output>
Create `.planning/quick/261108-ncc-SUMMARY.md` when done.
</output>
