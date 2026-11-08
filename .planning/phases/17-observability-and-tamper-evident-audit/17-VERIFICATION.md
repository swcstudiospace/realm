---
phase: 17-observability-and-tamper-evident-audit
verified: 2026-11-08T19:25:11Z
status: human_needed
score: 0/4 must-haves verified
behavior_unverified: 4
overrides_applied: 0
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/phases/17-observability-and-tamper-evident-audit/17-01-PLAN.md
  - .planning/phases/17-observability-and-tamper-evident-audit/17-02-PLAN.md
  - .planning/phases/17-observability-and-tamper-evident-audit/17-03-PLAN.md
  - .planning/phases/17-observability-and-tamper-evident-audit/17-04-PLAN.md
  - .planning/phases/17-observability-and-tamper-evident-audit/17-05-PLAN.md
  - .planning/phases/17-observability-and-tamper-evident-audit/17-CONTEXT.md
  - .planning/phases/17-observability-and-tamper-evident-audit/17-SUMMARY.md
  - AGENTS.md
  - docs/integration/hardening-plan.md
  - docs/integration/omp.md
  - docs/integration/openshell.md
  - docs/integration/runtime-decision.md
  - package.json
  - src/audit/anchor.ts
  - src/audit/chain.ts
  - src/audit/log.ts
  - src/audit/reconcile.ts
  - src/cli/audit.ts
  - src/cli/main.ts
  - src/core/errors.ts
  - src/daemon/daemon.ts
  - src/daemon/main.ts
  - src/observe/log-file.ts
  - src/observe/logger.ts
  - src/observe/metrics.ts
  - src/runtime/agentos-driver.ts
  - src/runtime/agentos.ts
  - src/tools/dispatch.ts
  - test/audit/chain.test.ts
  - test/audit/log.test.ts
  - test/audit/reconcile.test.ts
  - test/daemon/daemon.test.ts
  - test/daemon/main.test.ts
  - test/integration/production-driver.test.ts
  - test/integration/production-live-helpers.test.ts
  - test/runtime/agentos-supervisor.test.ts
  - test/support/production-live.ts
covered_digest: "v4:sha256:da7228e40630fcec21779edee920acd50e81cd84334ab0e435e54bda9912e081"
behavior_unverified_items:
  - truth: "OBS-01 audit chain detects changes and recovers its head"
    test: "Run the named existing chain and reconciliation tests on the accepted tree and retain their results."
    expected: "Clean and reconciled files verify; edits, removals and reordering identify the first broken link; appends recover the head."
    why_human: "Tests were not run by this verifier; scenario 5 is an inherited report, not a receipt."
  - truth: "OBS-02 request and audit records share correlation identifiers"
    test: "Run the named existing correlation tests and inspect the retained scenario 6 result on the accepted tree."
    expected: "Each tool result joins exactly its admission and result audit lines; up and tool identifiers are recorded as specified."
    why_human: "Current-tree test results and the scenario's detailed receipt were not supplied."
  - truth: "OBS-03 counters and timings are served by the control socket without a network listener"
    test: "Run the named metrics and listener tests and inspect the scenario 6 and 10 receipts."
    expected: "The socket returns the real counters and timings and there are no TCP or UDP listeners."
    why_human: "This verifier did not run tests or inspect live process state."
  - truth: "OBS-04 distinguishes gateway or driver loss from runner failure"
    test: "Run the existing supervisor tests; authorize and perform S17-b under the shared live lock, including the four recorded observations."
    expected: "Gateway loss is not a crash loop; with the configured driver socket, driver-only loss is classified as OPENSHELL_GATEWAY_LOST and the unit is restored."
    why_human: "The driver-only stop was not approved or run; fake-driver tests do not establish live behavior."
human_verification:
  - test: "Review retained results for the existing OBS-01 through OBS-04 tests and the reported scenario 5, 6 and 10 runs."
    expected: "Evidence identifies the exact tree, environment, scenario assertion counts, results and failures, and is sufficient for the behavior claimed."
    why_human: "The supplied results are orchestrator-reported, not independently inspected receipts; this assignment prohibits tests and live operations."
  - test: "Decide whether to approve S17-b and a current-driver live window; if approved, execute plan 17-05 T2 and document observations (a) through (d)."
    expected: "Record gateway status, exec exit, realm status after 10 and 45 seconds, and status after driver restoration, with dates and unit states."
    why_human: "Stopping the driver is unapproved and the deployed driver predates the newer closure."
  - test: "Complete plan 17-05 T3 and T4 after the live evidence is available."
    expected: "Integration documents record actual scenario results and the complete S17-b result; documentation checks are reported from an authorized run."
    why_human: "T3 depends on S17-b, and this verifier may change only this report."
---

# Phase 17: Observability and tamper-evident audit — verification

**Goal:** An operator can read what happened from structured logs and counters, tell a gateway loss from a runner crash, and prove the audit log has not been edited.

**Status: human_needed.** The implementation and relevant tests are present and wired, and three live scenarios are reported as passed. They are not independently verified here. S17-b remains unapproved and incomplete, and the deployed driver was not restarted with the newer closure. Do not treat the phase as passed. This is an initial structured verification: the prior report had no YAML `gaps:` section. Its historical verdict was `human_needed` on 2026-11-02; its November 8 correction recorded rotation and additional tests, and its live-window addendum recorded the reports summarized below. Those dated observations are preserved here as historical claims, not fresh test results.

## Observable truths

| Requirement and roadmap truth | Status | Current code and test evidence |
| --- | --- | --- |
| OBS-01: chained audit records, verifier detects edit/removal/reorder, startup head recovery and reconciliation | PRESENT_BEHAVIOR_UNVERIFIED | `src/audit/log.ts:80-104,146-177` writes redacted records with recovered `seq`/`prev`; `src/audit/chain.ts:118-146,289-310` recovers tail and checks the chain; `src/audit/reconcile.ts` writes reconciliation through the audit path. `test/audit/chain.test.ts:46,61,134,174` exercises append, torn tail, tampering and CLI; reconciliation tests exist. Scenario 5 reported passing, but no independent current test result was examined. |
| OBS-02: leveled JSON and matching up/tool/audit IDs without new dependencies | PRESENT_BEHAVIOR_UNVERIFIED | `src/observe/logger.ts:110-138` formats JSON; `src/daemon/daemon.ts:411-416,635-675,679-705` generates and propagates IDs; `src/tools/dispatch.ts` writes admission/result audit records. `test/daemon/daemon.test.ts:1052,1120` asserts both correlation joins. Scenario 6 reported passing. Dependency-diff acceptance has not been independently established. |
| OBS-03: tool outcome, transition and attach metrics via existing control socket; no network listener | PRESENT_BEHAVIOR_UNVERIFIED | `src/daemon/daemon.ts:373,411-413,679-710,735-738,853` records and returns metrics and creates the control server; `src/observe/metrics.ts` contains the snapshot and fixed metrics. `test/daemon/daemon.test.ts:1731,1807` exercises socket metrics and listener inventory. Reported scenarios 6 and 10 cover a subset; no test was run here. |
| OBS-04: gateway loss yields OPENSHELL_GATEWAY_LOST rather than AGENTOS_CRASH_LOOP; catalogue coverage | PRESENT_BEHAVIOR_UNVERIFIED | `src/runtime/agentos.ts:159-185,301-325` classifies after failed health; `src/runtime/agentos-driver.ts:331-354` probes gateway and optional absolute driver socket. `test/runtime/agentos-supervisor.test.ts:425-477` covers gateway, runner and driver cases with a fake driver. Scenario 10 is reported passed; S17-b has not established real driver-only loss, and exhaustive catalogue enumeration was not independently verified. |

**Score:** 0/4 verified under the behavior-evidence gate; 4/4 present and behavior-unverified. This is not a claim that the four implementations fail. Tests listed above were read, not executed by this verifier.

## Artifact and data-flow assessment

| Artifact / link | Assessment |
| --- | --- |
| Audit writer → tail reader → chain verifier → CLI | Substantive and wired: append reads the previous physical tail, writes a hash link, and verifier checks the chain. `test/audit/chain.test.ts:134` asserts edit, deletion and reorder; the verifier reports the successor for an edited predecessor, not necessarily the edited line itself. Legacy lines are explicitly reported unprotected; a chain alone cannot prove absence of tail truncation without an independent head/anchor. |
| Daemon → logger and audit dispatcher | Substantive and wired: a minted call ID goes to both dispatcher and `tool.result`. Per owner-ratified D-1704 (`17-CONTEXT.md:23`), startup/failure entries go to `daemon.log`, while request/lifecycle records go to `requests.log`; the literal roadmap wording about daemon-log correlation must be read with that recorded amendment. Both use rotating sinks (`src/daemon/main.ts:181-215`). |
| Daemon state and tool calls → metrics → control reply | Substantive and wired, not a static response: state and call paths update in-memory metrics and the `metrics` case returns `metrics.snapshot()` (`src/daemon/daemon.ts:735-738`). Live listener behavior remains evidence-dependent. |
| Supervisor failure → gateway/driver probes → held code | Substantive and wired; the driver probe returns unknown when no absolute driver socket is configured. Real driver-only classification remains unobserved. |

## Live evidence and limits

The following are **orchestrator-reported** observations supplied with this assignment, not receipts independently inspected by this verifier. Do not infer detailed assertion counts or a current deployment from them.

| Window | Reported result | Qualification |
| --- | --- | --- |
| `9cdbe8e`, initial non-gateway production window | 31 pass / 3 test failures; OMPX-05 1/1 passed on Omp 18.18.1 | The three failures were subsequently fixed per orchestrator; the reported aggregate is not a per-scenario Phase 17 receipt. |
| `a8cee97`, second window | Scenarios 5, 5b and 6 passed | Exact assertion counts and raw receipts were not supplied. The two-project case separately failed on its first up with `OPENSHELL_START_FAILED`; the driver journal reported `ValidateSandboxCreate` / `create.workspace` `SCHEMA_INVALID`. Do not represent that failure as a Phase 17 scenario 5 or 6 failure, or as Phase 18 acceptance. |
| `e9e0c39`, separate gateway window | Scenario 10 passed 1/1 | Reported as outside the original batched approval; this report does not infer authorization or manufacture a receipt. |
| S17-b | Not run in these windows | Driver stop was not approved. The older 2026-10-30 partial observation in `docs/integration/openshell.md:583` showed `openshell status` still connected after driver stop, but did not observe exec or realm status. It cannot satisfy T2. |

The deployed driver was older throughout and was not restarted with the newer closure; its current closure is **not live-verified**. Driver restaging and the Phase 15-10 L-B unit edit were not approved. The prior report also recorded earlier inherited offline results (2,534 total, 2,501 pass, 33 skipped, and separately 2,538 total, 2,505 pass, 33 skipped in a lane); these were not rerun or tied to the current tree here.

## Outstanding acceptance and decisions

1. **S17-b:** plan 17-05 T2 requires four dated observations: gateway JSON/exit, sandbox exec/exit, realm state and reason after 10 and 45 seconds, and state after restoring the driver. The existing partial spike does not provide these. Owner approval and a serialized live window are prerequisites, not implied by the gateway run.
2. **Evidence provenance:** plan 17-05 T1 requests each scenario's status, assertion count, SHA, date and failure text. The provided inherited summary does not include all of these or a directly inspectable receipt. It reports success for 5, 6 and 10, but cannot establish complete T1 acceptance on the current code/deployed driver.
3. **Documentation closure:** plan 17-05 T3–T4 remain incomplete. `docs/integration/openshell.md:583` marks S17-b partial, `docs/integration/runtime-decision.md:349` says its live run is not recorded, and `docs/integration/omp.md:175` says a current-build gateway rerun is pending. T3 follows both T1 and T2; this assignment prohibits edits outside this report and all tests/checks.
4. **Owner rulings:** D-1701 O-e is already ratified (`17-CONTEXT.md:20`): driver-only loss is classified via the socket probe when configured. Do not describe ratification as pending. Its live proof remains pending. The previous report recorded other owner questions, including audit-head semantics, unreadable-file warning, crash stack and correlation scope; its dated addenda noted rulings for O-a through O-e and a per-session-head amendment, and code closure for O-g with confirmation of its scope requested. No new owner decisions are inferred here.

## Requirements and checks

All four OBS requirements are declared across plans 17-01 through 17-05 and mapped in `.planning/REQUIREMENTS.md:78-81,205-208`; none is orphaned. Their implementation is present but their acceptance is not yet independently evidenced in this restricted verification. No plan frontmatter `must_haves`, prohibitions, or deferred `<human-check>` blocks were found. No phase-specific explicit runnable probe script was identified in plan 17-05; live scenarios are not substituted by a probe.

**Behavioral checks:** not run — the assignment explicitly prohibits tests, builds and live operations. **Decision coverage:** not evaluated by the heuristic gate; the current decision text and relevant amendments were read directly. **Anti-pattern scan:** no `TBD`, `FIXME`, or `XXX` matches in the inspected audit, observability, daemon and supervisor source paths; this is not a whole-repository scan. **Deferred items:** none; no later roadmap phase specifically replaces S17-b or the Phase 17 evidence contract.

**Next action:** obtain the retained scenario/test evidence and owner decision on S17-b; after an authorized window, complete the four observations and the plan's documentation closure. No files other than this report were changed, and no verification commands were executed.
