---
phase: quick-261108-ncg
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - test/anda/reconnect.test.ts
  - test/runtime/driver/socket-server.test.ts
  - test/anda/listener-diagnostic.test.ts
  - test/daemon/daemon.test.ts
autonomous: true
requirements: [QR-05]

estimate:
  tokens: 60000
  raw_tokens: 30000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "No literal node:test timeout cap remains in reconnect.test.ts, socket-server.test.ts or listener-diagnostic.test.ts; every outer cap is testTimeout(N) with the same N, so REALM_TEST_TIMEOUT_SCALE stretches it."
    - "The behavioural timer values and the elapsed-time assertions in those three files are unchanged."
    - "daemon.test.ts has no unconditional 12 s sleep: the probe-log test and the probe-counter test fire the session health interval by hand and wait, bounded by pollUntil, for the observed log row or metrics count."
    - "The asserted values are unchanged: log code OPENSHELL_GATEWAY_LOST for health.probe_failed, and a healthProbeFailures row with code 'probe failed' and count exactly 1."
    - "daemon.test.ts loses about 24 s of wall time."
  artifacts:
    - path: "test/daemon/daemon.test.ts"
      provides: "Two tests that observe the health probe through a hand-fired interval and pollUntil"
  key_links:
    - from: "test/daemon/daemon.test.ts"
      to: "src/daemon/sessions.ts SessionHealth (setInterval at HEALTH_PROBE_INTERVAL_MS)"
      via: "a recording fake of globalThis.setInterval installed before startDaemon, the same technique as fakeIntervals in test/daemon/daemon-health.test.ts"
---

<objective>
Finish the QR-05 timing migration (Phase 13, D-1305) in the four named test files: scale the outer node:test caps through testTimeout, and replace the two blind 12 s sleeps in daemon.test.ts with observed conditions.

Purpose: a loaded runner can stretch every bound at once with REALM_TEST_TIMEOUT_SCALE, and the daemon suite stops idling for 24 s.
Output: edits to test/anda/reconnect.test.ts, test/runtime/driver/socket-server.test.ts, test/anda/listener-diagnostic.test.ts and test/daemon/daemon.test.ts. Nothing else.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@AGENTS.md
@.planning/quick/261108-ncg-finish-the-qr-05-timing-migration-caps-a/261108-ncg-CONTEXT.md
@test/support/timing.ts
@test/daemon/daemon-health.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Scale the outer caps with testTimeout in three files</name>
  <files>test/anda/reconnect.test.ts, test/runtime/driver/socket-server.test.ts, test/anda/listener-diagnostic.test.ts</files>
  <action>
Per locked decision 1. Re-verify the line numbers with a grep for the literal option object before editing, because they drifted.

Add `import { testTimeout } from "../support/timing.js";` to test/anda/reconnect.test.ts and test/anda/listener-diagnostic.test.ts, next to their existing `../support/fake-anda.js` import. Add `import { testTimeout } from "../../support/timing.js";` to test/runtime/driver/socket-server.test.ts, next to its existing relative imports.

Replace each literal outer cap object with testTimeout of the same number, keeping the number's existing form:
- reconnect.test.ts: six tests (the ANDA-03 hung-engine connect at about line 336 with 20000; the listener-throws-on-up, async-listener-rejects, superseded-monitor, monitor-fails-on-its-own and throwing-clock tests at about lines 474, 540, 588, 620 and 650 with 5000 each).
- socket-server.test.ts: four PRD-DRV-01 tests at about lines 163, 174, 186 and 197, each 20_000.
- listener-diagnostic.test.ts: one test at about line 64, 5000.

Change only the option argument. Do not touch behavioural timer values (probe intervals, budgets, grace values, Date.now elapsed-time assertions) or any assertion: these tests exercise real timers on purpose. Afterwards grep the three files for any remaining literal `timeout:` option on a test call; none may remain.
  </action>
  <verify>
    <automated>npm run build && node --test dist/test/anda/reconnect.test.js dist/test/runtime/driver/socket-server.test.js dist/test/anda/listener-diagnostic.test.js</automated>
  </verify>
  <done>All eleven outer caps are testTimeout(N) with the original N; the three compiled test files pass with the same test count as before; no literal cap remains in them.</done>
</task>

<task type="auto">
  <name>Task 2: Replace the two blind 12 s sleeps in daemon.test.ts with observed probes</name>
  <files>test/daemon/daemon.test.ts</files>
  <action>
Per locked decision 2. The two sleeps are `await new Promise(... setTimeout(resolve, 12_000))` in "OBS-02: a probe that resolves in error is logged" (about line 1211) and "OBS-03: a probe that returns probe failed is counted" (about line 1830). They wait for the first tick of SessionHealth (src/daemon/sessions.ts), whose setInterval period is HEALTH_PROBE_INTERVAL_MS (10 s, a module constant with no injection seam; src is out of scope). The deterministic control is therefore the one test/daemon/daemon-health.test.ts already uses: record the interval instead of letting it arm.

1. Add a small local helper in daemon.test.ts, near the existing `pause` helper or the other test helpers, modelled on fakeIntervals in test/daemon/daemon-health.test.ts. It takes the TestContext and uses t.mock.method on globalThis setInterval and clearInterval. For a setInterval call whose delay equals HEALTH_PROBE_INTERVAL_MS, it records the callback and returns a real never-firing placeholder timer (setTimeout of 2 ** 31 - 1) so the code under test can unref it; clearInterval of a recorded placeholder marks it cleared. Every other setInterval or clearInterval call passes through to the original functions, captured before mocking, so no other daemon timer is affected. t.after clears the placeholders. The helper returns a `fire()` that calls each live recorded callback once, as one health period elapsing. Import HEALTH_PROBE_INTERVAL_MS from the daemon sessions module (`../../src/daemon/sessions.js`) and the TestContext type from node:test, adding to existing import lines where they exist.
2. In the OBS-02 probe-log test: install the helper before startDaemon, so the interval armed by `up` is captured. After the existing override of the session's controller.probe (the resolved-in-error snapshot with reason OPENSHELL_GATEWAY_LOST), call fire(), then replace the sleep with pollUntil over the collected log lines: the predicate parses the lines and is true once a row with event health.probe_failed exists; give it a description naming that row and a timeout of a few seconds (scaled by pollUntil). Keep the existing find and `assert.equal(logged?.code, "OPENSHELL_GATEWAY_LOST")` unchanged.
3. In the OBS-03 probe-counter test: install the helper before startDaemon. After the controller.probe override (reason "probe failed"), call fire() exactly once, then replace the sleep with pollUntil whose async predicate sends the existing `metrics` control request and is true once healthProbeFailures has a row with code "probe failed". Keep the final assertion exactly: a row with code "probe failed" and count === 1. Because the interval is fired by hand exactly once, the count stays 1 and the assertion remains meaningful.
4. The remaining down request and awaitDone cleanup in both tests stay as they are. Do not change the `pause` helper or any other test. Do not shorten or lengthen any sleep: the sleeps are removed, not tuned.

Follow AGENTS.md conventions: no suppression comments, no silent catch, no source-text assertions. Add a one-line comment on the helper saying why the interval is fired by hand (the period is a fixed 10 s constant).
  </action>
  <verify>
    <automated>npm run build && node --test --test-name-pattern="OBS-02: a probe that resolves in error is logged|OBS-03: a probe that returns probe failed is counted" dist/test/daemon/daemon.test.js && node --test dist/test/daemon/daemon.test.js</automated>
  </verify>
  <done>Neither test sleeps; each fires the health interval by hand and waits under pollUntil for the observed log row or metrics row; the asserted code OPENSHELL_GATEWAY_LOST and the count of exactly 1 are unchanged; the daemon.test.ts file passes and runs about 24 s faster; grep finds no `12_000` sleep left in the file.</done>
</task>

<task type="auto">
  <name>Task 3: Run the gates</name>
  <files>test/daemon/daemon.test.ts</files>
  <action>
Run typecheck, lint and the gate check over the finished edits and fix any finding in the four in-scope files only. Do not edit CHANGELOG.md, package.json, package-lock.json, .github/**, release/**, or .planning/config.json (it carries an uncommitted orchestrator change: never stage it). Stage only the four test files.
  </action>
  <verify>
    <automated>npm run typecheck && npm run lint && npm run check:gates</automated>
  </verify>
  <done>typecheck, lint and check:gates exit 0.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| test code to process globals | Test-only edits to timing options and a scoped mock of setInterval; no production code, no network, no secrets. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quick-01 | Tampering | globalThis.setInterval mock in daemon.test.ts | low | mitigate | Mock is installed through t.mock.method, restored at test end, and passes every non-health interval through to the original. |
| T-quick-02 | Denial of service | pollUntil bounds | low | accept | Each wait is bounded and scaled; a missed probe fails the test instead of hanging. |
</threat_model>

<verification>
- Grep the three cap files for a literal `timeout:` test option: none.
- Grep daemon.test.ts for `12_000`: none.
- The four compiled test files pass; typecheck, lint and check:gates pass.
</verification>

<success_criteria>
Every outer cap scales through testTimeout, both blind sleeps are replaced by observed, bounded conditions with identical assertions, and the gates pass.
</success_criteria>

<output>
Create `.planning/quick/261108-ncg-finish-the-qr-05-timing-migration-caps-a/261108-ncg-SUMMARY.md` when done
</output>
