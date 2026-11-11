---
phase: 18-per-project-sandboxes
verified: 2026-11-10T19:17:35Z
status: gaps_found
score: "1/6 current acceptance truths verified"
behavior_unverified: 0
overrides_applied: 0
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/phases/18-per-project-sandboxes/18-01-PLAN.md
  - .planning/phases/18-per-project-sandboxes/18-02-PLAN.md
  - .planning/phases/18-per-project-sandboxes/18-03-PLAN.md
  - .planning/phases/18-per-project-sandboxes/18-04-PLAN.md
  - .planning/phases/18-per-project-sandboxes/18-04b-PLAN.md
  - .planning/phases/18-per-project-sandboxes/18-05-PLAN.md
  - .planning/phases/18-per-project-sandboxes/18-06-PLAN.md
  - .planning/phases/18-per-project-sandboxes/18-07-PLAN.md
  - .planning/phases/18-per-project-sandboxes/18-08-PLAN.md
  - .planning/phases/18-per-project-sandboxes/18-09-PLAN.md
  - .planning/phases/18-per-project-sandboxes/18-10-PLAN.md
  - .planning/phases/18-per-project-sandboxes/18-11-PLAN.md
  - .planning/phases/18-per-project-sandboxes/18-11-SUMMARY.md
  - .planning/phases/18-per-project-sandboxes/18-12-PLAN.md
  - .planning/phases/18-per-project-sandboxes/18-13-PLAN.md
  - .planning/phases/18-per-project-sandboxes/18-14-PLAN.md
  - .planning/phases/18-per-project-sandboxes/18-SUMMARY.md
  - docs/integration/omp.md
  - docs/integration/openshell.md
  - docs/integration/runtime-decision.md
  - src/cli/main.ts
  - src/daemon/admission.ts
  - src/daemon/channel.ts
  - src/daemon/client.ts
  - src/daemon/daemon.ts
  - src/daemon/ensure.ts
  - src/daemon/main.ts
  - src/daemon/sessions.ts
  - src/omp/extension.ts
  - src/omp/plugin.ts
  - src/realm/compose.ts
  - src/runtime/config.ts
  - src/runtime/driver/compute-driver.ts
  - src/runtime/driver/main.ts
  - src/runtime/hardening.ts
  - src/runtime/session-execution.ts
  - src/session/paths.ts
  - src/session/workspace-registry.ts
  - test/acp/agent.test.ts
  - test/cli/cli.test.ts
  - test/cli/mcp-attach.test.ts
  - test/daemon/admission.test.ts
  - test/daemon/channel.test.ts
  - test/daemon/client.test.ts
  - test/daemon/daemon-health.test.ts
  - test/daemon/daemon.test.ts
  - test/daemon/e2e.test.ts
  - test/daemon/ensure.test.ts
  - test/daemon/main.test.ts
  - test/daemon/realm-daemon-fixture.test.ts
  - test/fs/root.test.ts
  - test/integration/omp-guard.test.ts
  - test/integration/omp-ompx05.test.ts
  - test/integration/production-driver.test.ts
  - test/integration/production-live-helpers.test.ts
  - test/mcp/server.test.ts
  - test/omp/extension.test.ts
  - test/omp/plugin.test.ts
  - test/runtime/config.test.ts
  - test/runtime/driver/channel-artifacts.test.ts
  - test/runtime/driver/compute-driver.test.ts
  - test/runtime/driver/create-refusal.test.ts
  - test/runtime/driver/driver-main.test.ts
  - test/runtime/driver/driver-service.test.ts
  - test/runtime/driver/fakes.ts
  - test/runtime/driver/gateway-wire.test.ts
  - test/runtime/driver/launch-material.test.ts
  - test/runtime/driver/runtime-channel.test.ts
  - test/runtime/driver/runtime-listener.test.ts
  - test/runtime/driver/supervisor-exit.test.ts
  - test/runtime/hardening.test.ts
  - test/runtime/openshell-routing.test.ts
  - test/runtime/sandbox-binding.test.ts
  - test/runtime/session-execution.test.ts
  - test/session/paths.test.ts
  - test/session/workspace-registry.test.ts
  - test/support/production-live.ts
  - test/support/realm-daemon-fixture.ts
  - test/surfaces/daemon-equivalence.test.ts
covered_digest: "v3:sha256:161d94078221b0c67f02f68c73ef4c9ba3ecf808f0b9825617cbe8cdbc932d99"
re_verification:
  previous_status: gaps_found
  previous_score: "0/6"
  gaps_closed:
    - "Reconciled plan 18-11 offline surface proof and successful current build and focused tests"
  gaps_remaining:
    - "MULTI-05 live two-project isolation and local down"
  regressions: []
gaps:
  - truth: "MULTI-05 live two-project isolation and project-local down are proven on the live stack."
    status: failed
    reason: "The recorded second live window failed at the first up with OPENSHELL_START_FAILED; the complete required live scenario has not succeeded."
    artifacts:
      - path: test/integration/production-driver.test.ts
        issue: "Live-gated scenario lacks successful live acceptance evidence."
    missing:
      - "Resolve the first-up failure and complete the owner-authorized serialized live scenario, proving both workspace mounts, write isolation, and local down leaving the peer active."
---

# Phase 18: Per-project sandboxes — verification refresh

**Goal:** Two projects under the configured roots each get their own active sandbox, workspace, audit file and lock table, and taking one down leaves the other running.

**Status: gaps_found.** This is a targeted refresh, not a full phase re-verification. The parent supplied the test results below; this verifier did not rerun them. The actual fixture is a real in-process daemon using fake execution, bridge, libpod, probe and OpenShell components. It cannot establish live sandbox isolation. The five roadmap success criteria and all MULTI requirements retain their existing live and human gates.

## Plan 18-11 decision and focused gate

The user explicitly approved revising T2: compare status and up across CLI, MCP client and Omp client paths; send project-local down through the CLI/selected control channel, then observe status through the clients and check the other project remains active. The parent reports independent plan review PASS before execution resumed. This supersedes the former three-direct-down-replies criterion, **not** the roadmap or live acceptance. `DaemonClient` has no down; `close()` only detaches. The test does not prove that MCP or Omp can issue down. Omp's attach closure is not invoked directly; its selection and client calls are reproduced.

The first reported verification stopped at `test/surfaces/daemon-equivalence.test.ts:316` with TypeScript TS7022, before any tests executed. Following the approved plan revision and review, the parent corrected the error and reports the following command exited 0:

```text
npm run build && node --test dist/test/daemon/realm-daemon-fixture.test.js && node --test dist/test/surfaces/daemon-equivalence.test.js dist/test/mcp/server.test.js dist/test/acp/agent.test.js && npx eslint test/surfaces/daemon-equivalence.test.ts test/acp/agent.test.ts
```

Reported fixture result: **4/4**; surface/MCP/ACP: **47/47**; lint clean. The two edited test files remain uncommitted. `18-11-SUMMARY.md` records the scope and evidence. The prior build failure and stop are historical, not a current failure; the focused pass is not a live or full-phase pass.

## Goal and requirement coverage

| Truth / requirement | Disposition | Evidence / limitation |
|---|---|---|
| Decision recorded before dependent code (MULTI-01) | UNCERTAIN / WARNING | Historical record cites `docs/integration/runtime-decision.md`, D5(i), and commit `4bfca1a`; chronology not independently reverified in this refresh. |
| Two isolated live sandboxes, distinct workspaces and per-sandbox transport (MULTI-02, MULTI-04, MULTI-05) | FAILED / BLOCKER | `.planning/REQUIREMENTS.md` records live acceptance open and the second live window failing at first up with `OPENSHELL_START_FAILED`; deployed driver closure was not restarted. |
| Project-local down and independent session resources (MULTI-03, MULTI-05) | UNCERTAIN / WARNING | Parent-reported fake-backed tests cover selected control-channel down and peer status; live acceptance remains open. |
| Outside-root selection refused with `POLICY_DENIED` (MULTI-02) | UNCERTAIN / WARNING | Prior offline coverage recorded; not independently re-exercised here. |
| Aggregate CPU and memory commitment bounded and documented (MULTI-06) | UNCERTAIN / WARNING | Prior offline tests and docs recorded; no current independent full verification, live acceptance open. |
| Reconciled plan 18-11 selected-surface offline behavior | VERIFIED (parent-reported test evidence) | Parent reports current build, 4/4 fixture tests, 47/47 surface/MCP/ACP tests and clean targeted lint. No direct MCP/Omp down claim. |

All MULTI-01 through MULTI-06 remain unchecked in `.planning/REQUIREMENTS.md`; this targeted refresh does not independently close them. No override was applied.

## Historical gate record — 2026-11-02 only

The prior report recorded green gates on `gsd/v3-phase18` at `5ddc95e`, logs outside the repository at `gate-runs/2026-11-02-phase18-final/`. They were not revalidated here and do not verify current uncommitted edits.

| Gate | Previously recorded result |
|---|---|
| Typecheck, lint, build | Exit 0; lint initially reported 80 errors, fixed in `5ddc95e`. |
| `npm test` | Exit 0; 2664 total, 2630 pass, 34 skipped. |
| `npm run test:integration` | Exit 0; 204 total, 172 pass, 32 skipped. |
| `npm run test:scripts` | Exit 0; 301 pass. |
| `npm run check:docs`; `npm run check:gates` | Exit 0; 4 modules, no gate violations. |
| Build, pack and MCP checks | Exit 0; MCP smoke refused attach fail-closed (`PODMAN_MACHINE_DOWN`), status disconnected. |

Coverage and image-digest checks were not in that set. That lane ran no live step. The later second live window failed at first up; older summary statements describing no live step apply only to that earlier lane. Historical tagged passing titles: MULTI-01 0, MULTI-02 14, MULTI-03 32, MULTI-04 0, MULTI-05 5, MULTI-06 12. Counts do not prove complete coverage. Plans 01–13 were historically recorded committed and plan 14 held; this is not live acceptance.

## Preserved live and human blockers

1. **MULTI-05 live acceptance:** owner-authorized, serialized live window remains required, including inspection of both workspace mount sources, isolation of writes, project-local down leaving the peer and socket active, and cleanup. Resolve the reported first-up failure. Plan 14's historical checkpoint was held; the scenario has not successfully completed.
2. **MULTI-01–06:** preserve unchecked requirement status and live acceptance limitations. The deployed driver closure was not restarted; no live result follows from fake-backed tests.
3. **Phase 17 prerequisite:** the earlier record notes the merge is the gate and phase 17 plan 03 scenario 6 and skip-path checks were not run; consult current phase 17 verification before treating these as closed.
4. **Owner decisions and review:** `18-HELD-OWNER.md` records the 2026-11-08 decisions to keep `TOOL_TIMEOUT` text, cap `startupBudgetMs` at 200000, and allow the seven pre-record commits to stand. Human review remains required before merge.
5. **Additional unverified review:** audit line `{tool: session.destroy, outcome: ok}` against the audit schema; `isDownRequested` against the tiny-function style note; the restored main-checkout `docs/integration/omp.md` diff saved outside the repositories; individual review of historical skipped tests.

## Verification limitations

No tests, build, probes or live execution were run by this verifier. This targeted report does not replace a complete goal-backward phase verification or owner acceptance. Advisory findings from the prior refresh: none.
