---
phase: 18-per-project-sandboxes
plan: 11
requirements: [MULTI-03, MULTI-05]
status: complete_offline
---

# Phase 18 plan 11: selected-surface offline evidence

The user approved a narrow T2 reconciliation: compare `status` and `up` across the CLI request, MCP client and Omp client paths; issue project-local `down` through the CLI/selected control channel and observe both clients and the peer afterward. The parent reports an independent plan-check PASS before execution resumed. This does not revise the Phase 18 roadmap or live acceptance. MCP and Omp do not issue `down` in this test; `DaemonClient.close()` is only client detachment.

The two-project test in `test/surfaces/daemon-equivalence.test.ts` exercises both project selections, checks status/up reply equivalence, drives selected down through `sendRequest`, observes status through both clients and checks that the other project stays active, then re-establishes the selected session through each up path. Omp's attach closure is not called directly; its selection and client calls are reproduced. `test/mcp/server.test.ts` and `test/acp/agent.test.ts` contain per-project write and audit tests. The fixture starts a real in-process daemon but uses fake execution, bridge, libpod, probe and OpenShell implementations; this is offline evidence, not live sandbox evidence. The current edits to the surface and ACP tests remain uncommitted.

The first reported attempt stopped at `test/surfaces/daemon-equivalence.test.ts:316` with TypeScript TS7022; no tests ran. After the approved reconciliation and independent plan check, the parent corrected the type error and reports this complete command exited 0:

```text
npm run build && node --test dist/test/daemon/realm-daemon-fixture.test.js && node --test dist/test/surfaces/daemon-equivalence.test.js dist/test/mcp/server.test.js dist/test/acp/agent.test.js && npx eslint test/surfaces/daemon-equivalence.test.ts test/acp/agent.test.ts
```

Reported results: fixture tests 4/4; surface/MCP/ACP tests 47/47; lint clean. The verifier did not rerun these commands. This result replaces neither the historical full-gate record nor the still-open live, human and Phase 18 acceptance gates. In particular, MULTI-05 requires the owner-authorized live two-project scenario; the later recorded attempt failed at first `up` with `OPENSHELL_START_FAILED`.
