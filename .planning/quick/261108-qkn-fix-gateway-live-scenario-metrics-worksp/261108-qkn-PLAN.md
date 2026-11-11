---
task: 261108-qkn
type: quick
wave: 1
depends_on: []
files_modified:
  - test/integration/production-driver.test.ts
autonomous: true
must_haves:
  truths:
    - Scenario 10 requests metrics for its selected workspace and retains its gateway-loss assertions.
    - Scenario 5b describes the rotating daemon log accurately without changing its log assertion.
  artifacts:
    - test/integration/production-driver.test.ts
  key_links:
    - Scenario 10 passes scenario.inputs.workspaceRoot to realm metrics, matching scenario 6.
---

<objective>
Fix the workspace selection in the gateway-stopping live scenario and correct the stale log-rotation comment. Follow the locked decisions in `.planning/quick/261108-qkn-fix-gateway-live-scenario-metrics-worksp/261108-qkn-CONTEXT.md`. This is a test-only change; no live stack operations are authorized during implementation.
</objective>

<tasks>

<task type="tracer">
  <name>Fix scenario 10 metrics selection and scenario 5b comment</name>
  <files>test/integration/production-driver.test.ts</files>
  <action>In the test titled `production live 10: a stopped gateway`, locate the `realmCli` metrics call and change only its argument array to `["metrics", "--workspace", scenario.inputs.workspaceRoot]`, matching scenario 6. Keep the timeout, all metrics and gateway assertions, and gateway restoration unchanged. In scenario 5b, replace the comment above `daemonLog` and `logOffset` with an accurate description: daemon entry records use a rotating file sink, and this test reads from the saved offset in the current log; the offset approach assumes no rotation during that interval. Do not alter the log read or its assertions. Do not change any other file or behavior.</action>
  <verify>
    <automated>npm run build && node --test dist/test/integration/production-live-helpers.test.js</automated>
  </verify>
  <done>Scenario 10 explicitly selects the pinned workspace for metrics, and its existing assertions and cleanup are intact. Scenario 5b no longer claims the log never rotates, and its offset read and log assertion remain unchanged. The hermetic helper suite passes; this does not establish a live scenario pass.</done>
</task>

</tasks>

<threat_model>
The changed test invokes an existing local control-socket command for the explicitly selected workspace; no access policy or production interface changes. Scenario 10 stops a gateway, so it must not run during implementation.
</threat_model>

<verification>
From the checkout root, run the hermetic helper command in the task, then run the following final gates as plain commands:

1. `npm run typecheck`
2. `npm run lint`
3. `npm run check:gates`

The executor applies the orchestrator-provided host lock externally. Do not run scenario 10 or perform live stack operations during implementation. Scenario 10 may run separately only after the gates and with explicit owner approval. Report only the checks actually exercised; a hermetic pass is not live evidence.
</verification>
