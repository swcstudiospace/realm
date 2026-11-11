---
phase: 16-omp-runs-in-the-sandbox
verified: 2026-11-08T19:25:32Z
status: gaps_found
score: 0/4 must-haves verified
behavior_unverified: 2
overrides_applied: 0
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/phases/16-omp-runs-in-the-sandbox/16-01-PLAN.md
  - .planning/phases/16-omp-runs-in-the-sandbox/16-02-PLAN.md
  - .planning/phases/16-omp-runs-in-the-sandbox/16-03-PLAN.md
  - .planning/phases/16-omp-runs-in-the-sandbox/16-04-PLAN.md
  - .planning/phases/16-omp-runs-in-the-sandbox/16-SUMMARY.md
  - .planning/quick/261108-puz-reconcile-the-v3-0-planning-records-with/261108-puz-SUMMARY.md
  - docs/integration/omp.md
  - src/omp/extension.ts
  - src/omp/plugin.ts
  - src/omp/tools.ts
  - test/integration/omp-guard.test.ts
  - test/integration/omp-live-helpers.test.ts
  - test/integration/omp-ompx05.test.ts
  - test/integration/production-live-helpers.test.ts
  - test/omp/extension.test.ts
  - test/omp/plugin.test.ts
  - test/omp/tools.test.ts
  - test/support/omp-profile.ts
  - test/support/omp-rpc.ts
  - test/support/production-live.ts
  - test/support/scripted-provider.ts
covered_digest: "v4:sha256:892c8a04c005e4a10875c719263beb5ed5ad36110c1b28724378bfbb4485d203"
gaps:
  - truth: "Fail-closed status text and docs say the mechanism is a guard, not containment when removal cannot be enforced."
    status: failed
    reason: "The status renderer emits only label, degradation, reason and transition time; it does not identify the fail-closed guard or its containment limits."
    artifacts:
      - path: src/omp/plugin.ts
        issue: "renderRealmStatus at lines 187-197 has no policy-mode or guard/containment disclosure."
    missing:
      - "Display the required guard-not-containment qualification in fail-closed status, or obtain a documented owner-approved override."
behavior_unverified_items:
  - truth: "The five tools use frozen ToolCall shapes and schema tests pass unchanged."
    test: "Run the relevant named tool and frozen schema tests, and observe registered read/write through Omp."
    expected: "All five calls reach the daemon with the frozen shape and successful read content and metadata reach the model."
    why_human: "Source wiring and unexecuted tests cannot establish passing runtime behavior in this restricted verification."
  - truth: "Advisory keeps eligible native tools and restores the active set safely across mode changes, with the native-path notice."
    test: "Run the named active-set transition tests and the actual Omp advisory-to-fail-closed consumer control."
    expected: "Only still-registered extension-removed tools are restored, manually disabled tools stay disabled, the mode is published after readback, and the native advisory notice appears."
    why_human: "The current verification cannot execute tests or live Omp, and transition correctness cannot be established by presence alone."
---

# Phase 16: Omp runs in the sandbox — Verification Report

**Goal:** A model working through Omp does its file mutations and commands through Realm's tools in the sandbox, and in fail-closed mode its built-in host `write`, `edit` and `bash` are gone or refused.

**Status:** gaps_found. **Score:** 0/4 roadmap truths verified; two present but behavior-unverified, one failed, one uncertain. Prior report dated 2026-11-02 had `human_needed` and no structured `gaps:` frontmatter; this is a fresh goal-backward verification, not a gap-closure re-verification. No tests, builds, probes, services, or live operations were run under the assignment's restrictions.

## Observable truths

| # | Roadmap acceptance | Status | Evidence |
|---|---|---|---|
| 1 | Five registered Realm tools use the frozen ToolCall; retry remains a command, no Realm glob, and frozen schemas pass unchanged. | WARNING — PRESENT_BEHAVIOR_UNVERIFIED | `src/omp/tools.ts:15-16,210-237` defines the five names and maps inputs to calls; `src/omp/plugin.ts:730-746` calls the daemon and registers definitions; `:747-750` registers retry. `test/omp/tools.test.ts:61-105` exercises the shape using a stub, not an actual daemon. Test and frozen-schema pass status was not independently checked. |
| 2 | Fail-closed removes or blocks native tools, guard refuses model bash with a catalogue code, and status and docs disclose guard-not-containment. | **BLOCKER — FAILED** | `src/omp/tools.ts:28-40` keeps bash and filters others; `src/omp/plugin.ts:783-855,920-945` guards and reads back host tool changes, with `POLICY_DENIED`. However `renderRealmStatus` at `:187-197` only prints label, degraded flag, reason and time: it does not state guard-not-containment. Docs discuss limitations (`docs/integration/omp.md:293-303`), but do not repair the missing status disclosure. Actual model-issued bash denial remains unverified here. |
| 3 | Advisory registers Realm tools, preserves other eligible native tools and emits the native advisory notice. | WARNING — PRESENT_BEHAVIOR_UNVERIFIED | `src/omp/tools.ts:62-105` plans restoration; plugin serializes changes and reads back the set (`plugin.ts:900-945`), and notifies advisory host calls (`:979-997`). Shadowing is assumed by the host API and documented in `tools.ts:6-9`; actual mode-transition and Omp notice tests were not executed. |
| 4 | Phase 12 harness live registered write matches host and `/workspace` bytes and paired real audit entries. | WARNING — UNCERTAIN | `test/integration/omp-ompx05.test.ts:121-299` exercises a scripted provider, real Omp and production setup, checks host bytes, `/workspace` text and SHA-256, container identity, and paired audit entries. Orchestrator reports 1/1 passed on Omp 18.18.1 at snapshot `9cdbe8e`; `.planning/quick/261108-puz-reconcile-the-v3-0-planning-records-with/261108-puz-SUMMARY.md:12` records the same as orchestrator-reported. No independent TAP/RPC/audit receipt was supplied or inspected here, and the deployed driver predates newer driver changes. This is meaningful reported evidence, not a verifier-observed pass for the current tree. Scripted-provider evidence is not LLM-driven. |

## Artifacts, key links and data flow

| Artifact / link | Assessment |
|---|---|
| `src/omp/extension.ts:33-80` → plugin | Substantive and wired: extension parses the reattach setting and registers the plugin. |
| `src/omp/plugin.ts:730-746` → `src/omp/tools.ts:210-237` → daemon client | Substantive and wired: five definitions call `client.call` with single-key ToolCalls; no static output substitutes for the daemon. |
| `src/omp/tools.ts:250-290` → model-visible read | Successful daemon bytes are decoded, with digest/truncation metadata; actual current-host result unverified. |
| `src/omp/plugin.ts:783-855,900-945` → Omp active set and guard | Substantive and wired; runtime ordering and catalogue response still require execution. |
| `test/integration/omp-ompx05.test.ts:121-299` → Omp / real daemon / sandbox / audit | Substantive, doubly gated integration scenario; reported prior execution is not an independently inspected receipt. No fallback to a fake daemon is shown in that scenario. |

## Requirements coverage

| Requirement | Plan | Disposition |
|---|---|---|
| OMPX-02 | 16-01, 16-02, 16-04 | WARNING: implementation and tests present; current passing frozen-schema and actual consumer read evidence not independently established. |
| OMPX-03 | 16-01, 16-02 | **BLOCKED:** required fail-closed status disclosure is absent; live model bash refusal also needs evidence. |
| OMPX-04 | 16-01, 16-02, 16-04 | WARNING: host transition and advisory path exist; runtime results need verification. |
| OMPX-05 | 16-03 | WARNING: reported 1/1 historical live result at `9cdbe8e`; independently inspect its receipt and determine applicability to the current integrated stack. |

All four phase-mapped IDs appear in plan frontmatter; no orphaned phase requirement identified.

## Remaining conditions and evidence boundary

1. Correct the observable fail-closed status wording, or have the owner explicitly accept an override; documentation alone is not the status criterion.
2. Independently inspect the OMPX-05 run's TAP, Omp/provider capture, exact snapshot and audit-pair evidence; confirm whether the owner accepts that run for this integrated tree. The prior production window used an older, unrestarted deployed driver and cannot validate newer driver closure.
3. Exercise the named Omp consumer control for model-visible successful read metadata, mode changes, native advisory notice and model-issued bash `POLICY_DENIED`, plus the frozen schemas and relevant active-set tests. No claims of passing these checks are made here.
4. O4 re-attach remains default-off (`src/omp/extension.ts:19-33`); owner live stop/re-attach validation and default decision remain outstanding. The existing control protocol lacks handshake/version/credential negotiation; the previous verification records an accepted 2026-11-02 deviation, not implementation of those features. In-flight requests lack abort support. These limitations are not evidence of failure of the four roadmap criteria.
5. Separate orchestrator-reported windows: `9cdbe8e` production suite 31 pass/3 failures subsequently fixed; `a8cee97` scenarios 5, 5b, 6 passed and two-project first up failed `OPENSHELL_START_FAILED` with driver `create.workspace` `SCHEMA_INVALID`; separate gateway scenario 10 at `e9e0c39` passed 1/1. These do not establish OMPX-05 on the later tree. S17-b and driver restage/unit edit were not approved and were not run by this verifier.

## Anti-patterns and checks

A targeted scan of `src/omp`, `test/omp`, and the Omp guard/live acceptance tests found no `TBD`, `FIXME`, `XXX`, `TODO`, `HACK` or `PLACEHOLDER` markers. No test quality verdict is inferred from names alone: the frozen-call test explicitly uses a daemon stub, and is not a production-path proof. Behavioral spot-checks and live probes were not run: this assignment forbids tests, builds and live operations. No named shell probe was declared by the phase plans.

### Decision Coverage

GSD decision-coverage query returned `skipped: true`, reason `no trackable decisions` (0/0); this is not a substantive decision audit.

_Verified by source inspection and qualified inherited evidence; no commits made._
