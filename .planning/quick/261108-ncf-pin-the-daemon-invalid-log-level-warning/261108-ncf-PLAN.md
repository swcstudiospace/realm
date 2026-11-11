---
phase: quick-261108-ncf
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - test/daemon/main.test.ts
autonomous: true
requirements: [OBS-02]
estimate:
  tokens: 30000
  raw_tokens: 30000
  tasks: 2
  confidence: low
must_haves:
  truths:
    - "An invalid REALM_LOG_LEVEL makes runDaemon write exactly one daemon.log-level warning to the request log, and nothing to the stderr sink."
    - "The warning's value field is the effective level (info), and the raw operator text never appears in the request log or the stderr sink."
    - "With an invalid level the logger filters as the default does: an info line is kept and a debug line is dropped."
    - "A valid level (debug) and an unset level produce no daemon.log-level warning."
  artifacts:
    - path: test/daemon/main.test.ts
      provides: "daemon consumer tests for the invalid log level warning (Phase 17 verification gap 2, P17-O4)"
  key_links:
    - from: test/daemon/main.test.ts
      to: "src/daemon/main.ts requestLogger (parseLogLevel then logger.warn daemon.log-level)"
      via: "runDaemon with deps.env REALM_LOG_LEVEL and a fake start that logs through options.logger"
---

<objective>
Pin the daemon's invalid log level warning with tests that run the real consumer, `runDaemon` in `src/daemon/main.ts`. Test-only: no production change, no logger contract change. The existing `parseLogLevel` unit test in `test/observe/logger.test.ts` is left as it is.

Purpose: Phase 17 verification gap 2 and plan 17-02 ruling P17-O4. Nothing asserts that the daemon warns once with the effective level, or that a raw secret-looking value never reaches the log.
Output: new tests in `test/daemon/main.test.ts` only.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@AGENTS.md
@.planning/quick/261108-ncf-pin-the-daemon-invalid-log-level-warning/261108-ncf-CONTEXT.md
@src/daemon/main.ts
@src/observe/logger.ts
@test/daemon/main.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add the daemon log level warning tests to test/daemon/main.test.ts</name>
  <files>test/daemon/main.test.ts</files>
  <behavior>
    - Test 1 (invalid level): env carries REALM_LOG_LEVEL set to the sentinel string SENTINEL-LEVEL-VALUE. runDaemon returns 0. The request log (requests.log under the config stateDir) holds exactly one daemon.log-level line; it parses, through the existing entryOf helper, to level warn, event daemon.log-level, value info. The start fake logs one debug line and one info line through options.logger: the info line is in requests.log and the debug line is not, because parseLogLevel's default for an invalid value is info. The sentinel text appears in neither the request log text nor any h.lines entry. h.lines holds no daemon.log-level line, because the file sink took the line.
    - Test 2 (valid level): REALM_LOG_LEVEL=debug gives zero daemon.log-level lines in requests.log and in h.lines. The start fake's debug line IS present, which shows the valid level took effect.
    - Test 3 (unset level): no REALM_LOG_LEVEL key gives zero daemon.log-level lines in requests.log and in h.lines.
  </behavior>
  <action>
    Edit only test/daemon/main.test.ts. Reuse the existing harness: tempDir, validConfig, writeConfig, harness, startedWith, entryOf, and the mkdirSync/readFileSync/join imports already at the top of the file. Do not add a second harness and do not add imports unless a needed one is genuinely absent.

    Place the new tests directly after the two "OBS-02: a request line ..." tests (the stderr fallback test ends before the first CRASH-04 test), in the same style (`void test("OBS-02: ...", async (t) => {...})`).

    Add one small local helper above the new tests, for example `logLevelRun(t, level: string | undefined)`. It builds the temp dir and validConfig, creates stateDir with mkdirSync so the file sink takes the lines, and sets env to `{ ...writeConfig(dir, raw), REALM_LOG_LEVEL: level }` when level is defined, or plain `writeConfig(dir, raw)` when it is undefined (the key must be absent, not undefined-valued; exactOptionalPropertyTypes is on and EnvironmentLike allows `string | undefined`, but absence is the real unset case). The start fake calls `options.logger?.debug("probe.debug", {})` and `options.logger?.info("probe.info", {})`, then resolves `startedWith(Promise.resolve())` as the neighbouring tests do. After `assert.equal(await runDaemon(h.deps), 0)`, the helper returns the request log text split into non-empty lines, plus h.lines.

    Assert on parsed lines, not on raw substrings, except for the sentinel check, which is a negative `includes` on the whole request log text and on every h.lines entry. Count daemon.log-level lines by parsing each line with JSON.parse and comparing its event field, not by text match. Use entryOf (it strips and validates ts) for the one expected warning line, and compare with assert.deepEqual against `{ level: "warn", event: "daemon.log-level", value: "info" }`.

    Do not change src/ or any other file. Per the context file: if the harness cannot observe the warning without a production change, stop and report that in the SUMMARY instead of editing src/. Do not touch .planning/phases/, CHANGELOG.md, package-lock.json, .github/** or release/**. Do not write host-local absolute paths anywhere; the tests use tempDir. No suppression comments, no silent catch blocks, no source-text assertions on modules.
  </action>
  <verify>
    <automated>npm run build && node --test dist/test/daemon/main.test.js</automated>
  </verify>
  <done>The three new tests pass alongside the existing ones in dist/test/daemon/main.test.js. They pin: exactly one daemon.log-level warning with the effective value for an invalid level, filtering at info, the sentinel absent from all captured output, and no warning for a valid or unset level. `git diff --name-only` lists only test/daemon/main.test.ts.</done>
</task>

<task type="auto">
  <name>Task 2: Run the gates</name>
  <files>test/daemon/main.test.ts</files>
  <action>
    Run the three gates against the finished test file. Fix any typecheck or lint finding in test/daemon/main.test.ts itself (no suppression comments, and no change outside that file). If a gate fails for a reason outside this file, record it in the SUMMARY and do not edit around it.
  </action>
  <verify>
    <automated>npm run typecheck && npm run lint && npm run check:gates</automated>
  </verify>
  <done>npm run typecheck, npm run lint and npm run check:gates all exit 0.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| operator environment to daemon log | REALM_LOG_LEVEL is operator-supplied text that must never be echoed into the request log |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-ncf-01 | Information Disclosure | requestLogger daemon.log-level warning | medium | mitigate | Test 1 asserts the sentinel raw value appears in neither requests.log nor the stderr sink, and that the warning carries only the effective level |
| T-ncf-02 | Tampering | production code | low | accept | Test-only change; Task 1 forbids edits outside test/daemon/main.test.ts |
</threat_model>

<verification>
- `npm run build && node --test dist/test/daemon/main.test.js` passes.
- `npm run typecheck`, `npm run lint` and `npm run check:gates` pass.
- Only test/daemon/main.test.ts changed.
</verification>

<success_criteria>
Invalid, valid and unset REALM_LOG_LEVEL are each pinned through runDaemon, so a regression in the single-warning, effective-level or no-raw-value behaviour fails a test. No production code changed.
</success_criteria>

<output>
Create `.planning/quick/261108-ncf-SUMMARY.md` when done
</output>
