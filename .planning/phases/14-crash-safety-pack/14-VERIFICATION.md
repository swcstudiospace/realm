---
phase: 14-crash-safety-pack
verified: 2026-11-08T19:24:58Z
status: gaps_found
score: 0/7 must-haves verified
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/phases/14-crash-safety-pack/14-01-PLAN.md
  - .planning/phases/14-crash-safety-pack/14-CONTEXT.md
  - .planning/phases/14-crash-safety-pack/14-SUMMARY.md
  - .planning/quick/261108-puz-reconcile-the-v3-0-planning-records-with/261108-puz-SUMMARY.md
  - src/audit/log.ts
  - src/audit/reconcile.ts
  - src/daemon/daemon.ts
  - src/daemon/main.ts
  - src/fs/atomic-write.ts
  - src/fs/temp-sweep.ts
  - src/lifecycle/controller.ts
  - src/session/reap.ts
  - src/session/store.ts
  - src/tools/dispatch.ts
  - test/audit/reconcile.test.ts
  - test/cli/cli.test.ts
  - test/daemon/daemon.test.ts
  - test/daemon/main.test.ts
  - test/fs/atomic-write-sigkill.test.ts
  - test/fs/temp-sweep.test.ts
  - test/integration/production-driver.test.ts
  - test/lifecycle/stale-container.test.ts
  - test/omp/plugin.test.ts
  - test/session/store.test.ts
  - test/support/production-live.ts
  - test/surfaces/daemon-equivalence.test.ts
covered_digest: "v4:sha256:12a6d39649335fcd4d51c94dff294677d2b44340bcc3021b5c12025aac23e102"
behavior_unverified: 5
behavior_unverified_items:
  - truth: "Four SIGKILL stages preserve original bytes and startup sweep removes only eligible orphans with audit."
    test: "Run the named SIGKILL, sweep-negative and startup-maintenance tests on the integration revision."
    expected: "Each stage preserves the original and the eligible orphan is audited and removed; negatives remain untouched."
    why_human: "Existing historical run is on an earlier revision and no current test was run in this assignment; the stage test calls the sweep directly."
  - truth: "A planted unmatched admission is reconciled exactly once across two starts."
    test: "Run the named startup reconciliation and pairing tests on the integration revision."
    expected: "First startup writes one reconciliation, second startup writes none."
    why_human: "Current test execution was prohibited; earlier reported full-suite evidence is for another tree."
  - truth: "Durable deletion, startup removal logging and all required notice surfaces work."
    test: "Run the named fsync, startup report and surface tests on the integration revision and verify the missing live removal case."
    expected: "Directory is synced; removed IDs and deletion count are logged and notices reach all required surfaces."
    why_human: "Recorded live 5b observes deletion without a startup container removal; current offline tests were not run."
  - truth: "Refusal cause codes match across in-process and daemon MCP and ACP paths."
    test: "Run the named daemon equivalence and dispatcher tests on the integration revision."
    expected: "The same refusal cause reaches all four paths."
    why_human: "Authored assertions are present but no current-revision execution was permitted."
  - truth: "Retry after the recorded container is lost reaches active with a different container."
    test: "Run the named stale-container controller test on the integration revision."
    expected: "Recovery destroys the stale reference before creating a new container and returns active."
    why_human: "The existing test uses a fake adapter and was not executed on this revision."
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: not recorded
  gaps_closed:
    - "The current live scenario 5b asserts the startup log recordsDeleted count, and its pass at a8cee97 is recorded."
  gaps_remaining:
    - "Current live proof of startup removal naming the removed container ID together with deletion count and destroyed notice remains absent."
  regressions: []
gaps:
  - truth: "The live suite scenario 5 shows the destroyed-sandbox notice and startup log line naming the removed container on the production stack."
    status: failed
    reason: "Current scenario 5 asserts re-adoption with zero removals; scenario 5b proves record deletion after SIGTERM removed the container before startup, not a startup removal and logged removed ID. The deployed driver was older than the current closure."
    artifacts:
      - path: test/integration/production-driver.test.ts
        issue: "Scenario 5 tests adoption; scenario 5b asserts containersRemoved=0 and recordsDeleted>=1, not a removed ID."
    missing:
      - "A current-production-stack scenario exercising an actually removed startup candidate, asserting its ID, counts and destroyed notice, or an explicit owner-approved change to the literal Phase 14 acceptance."
      - "Attributed live evidence against the current driver closure, in an approved serialized window."
---

# Phase 14: Crash-safety pack — re-verification

**Goal:** A daemon or process killed at any point leaves no unrecorded debris, no silent loss of a sandbox, and no audit admission without an outcome.  
**Status:** gaps_found. **Revision inspected:** `f581e5cdfd145a00a6e54dae69a892754d559826`.  
**Method:** source and recorded evidence only; no build, test, lint, formatter, probe or live operation was run. Previous report had no machine-readable frontmatter or score; its stated live-record-count gap was rechecked. No override was recorded.

## Observable truths

| # | Contract | Status | Evidence and limit |
|---|---|---|---|
| 1 | Four real SIGKILL stages and safe audited startup sweep (roadmap SC1, CRASH-01/05). | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `test/fs/atomic-write-sigkill.test.ts:20,79-110` asserts signal, original, one orphan, direct sweep and audit; `test/fs/temp-sweep.test.ts:106-180` covers age, pattern, owner and symlinks. `src/daemon/daemon.ts:1001-1005,1147-1151` connects startup sweep before serving. The stage tests call the sweep directly, not a full subsequent daemon startup for each stage. Earlier 124-test/zero-skip result was recorded for `1fa69c1`, not this revision. |
| 2 | Unmatched admission reconciled once across two starts (SC2, CRASH-02). | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `test/daemon/daemon.test.ts:624-703` plants the admission and asserts the reconciliation and second-start idempotence; `src/daemon/daemon.ts:1181-1183` invokes reconciliation. Historical full-suite result was at `1fa69c1`; current test not run. |
| 3 | Directory-synced deletion, removal IDs and counts, attach notices (SC3, CRASH-03/04). | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `test/session/store.test.ts:116-143` covers fsync and failure; `test/daemon/main.test.ts:256-288` asserts IDs and `recordsDeleted`; daemon report/notice wiring is `src/daemon/daemon.ts:1012-1014,1198-1200,1301-1308`. CLI and Omp tests exist in `test/cli/cli.test.ts` and `test/omp/plugin.test.ts`. Live 5b proves count/notice for a record without a container, not removed IDs. See blocker below. |
| 4 | Equivalent refusal cause over daemon and in-process MCP/ACP (SC4, CRASH-06). | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `test/surfaces/daemon-equivalence.test.ts:195-214` compares four paths using a scripted refusal; dispatcher propagation is separately covered in `test/tools/dispatch.test.ts`. No current execution. |
| 5 | Lost recorded container retries from error to active with new ID (SC5, CRASH-07). | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `test/lifecycle/stale-container.test.ts:65-104` asserts error, active, changed ID and destruction before create with a fake exec adapter. No current execution; live 5b is not this controller error-retry test. |
| 6 | Live scenario 5 shows destroyed notice and removed-ID startup log (context acceptance 6, D-1410). | ✗ FAILED / BLOCKER | Current scenario 5 re-adopts the same container and asserts `adopted: 1, containersRemoved: 0, recordsDeleted: 0` (`test/integration/production-driver.test.ts:557-646`), so it cannot assert the required removed ID. Scenario 5b asserts `containersRemoved: 0` and `recordsDeleted >= 1` (`:680-766`). No live startup-removal ID assertion is evidenced for the current behavior. |
| 7 | Plan acceptance gates, no skips/suppressions used to pass, catalogue and frozen contracts. | ? UNCERTAIN / WARNING | Prior report recorded gates on `1fa69c1`, including 2,426 passes and 32 unitemized skips; those results do not establish the current revision or whether any skip was used to pass. Phase 17 added the approved 31st catalogue code; no complete current frozen-contract comparison is recorded. |

**Score:** 0/7 verified; five behavior-unverified, one failed, one uncertain. This is an evidence score, not a claim that all implementations are absent. No later roadmap phase specifically substitutes for the Phase 14 live removed-ID acceptance; Phase 19 adoption is an intentional subsequent behavior change, not an automatic override.

## Live evidence and limits

The prior report documented a 2026-11-02 scenario 5 pass at `5527882`, with a staged driver, a destroyed notice and removed container ID. Its then-helper did not assert the startup log's `recordsDeleted`. That historical result does not prove current selective reaping.

The orchestrator-recorded window in `.planning/quick/261108-puz-reconcile-the-v3-0-planning-records-with/261108-puz-SUMMARY.md:12` reports scenarios 5, 5b and 6 passed at `a8cee97`. This is reported evidence, not an independently observed run here. Scenario 5 checks SIGKILL re-adoption and preservation. Scenario 5b stops the daemon with SIGTERM; shutdown removes the container, then startup reports `recordsDeleted >= 1` and a destroyed notice with **zero** containers removed (`test/integration/production-driver.test.ts:680-766`). Thus the old claim that live `recordsDeleted` is not asserted is obsolete: scenario 5b explicitly asserts it, independently of the optional count filter in `test/support/production-live.ts:295-316`. It does **not** prove the startup reap logs an actually removed container ID. The deployed driver predates the newer driver import closure; the current closure was not restarted or live-verified (`261108-puz-CONTEXT.md`, driver caveat). The 5b pass does not resolve that limitation.

## Artifacts and links

| Artifact / link | Assessment |
|---|---|
| `src/fs/atomic-write.ts` → `src/fs/temp-sweep.ts` → `src/daemon/daemon.ts` | Present and wired to startup before `serve`; the per-stage tests invoke the sweep directly. |
| `src/audit/reconcile.ts` → daemon startup | Present and invoked before the serving gate; authored two-start test exists. |
| `src/session/store.ts` → directory sync | Implementation and fsync-spy tests exist; current execution unobserved. |
| `src/session/reap.ts:95-114,148-180` → startup report → `src/daemon/main.ts:96-97` | Selective reap plans removal/deletion, proves removal, deletes records, and reports counts; main routes report to startup logging. Actual removed-ID live path remains unproven on current stack. |
| Dispatcher → daemon → MCP/ACP | Authored equivalence test covers four paths with a scripted dispatcher refusal; current execution unobserved. |
| Live 5/5b → startup log and status | Both assertions are wired, but neither covers a container removed by startup. |

Dynamic UI data-flow trace: not applicable to this infrastructure phase; notice/report propagation is traced above.

## Requirements coverage

| Requirement | Source | Disposition |
|---|---|---|
| CRASH-01, CRASH-05 | plan requirement mapping; roadmap SC1 | Implementation and tests present; current behavior unverified (truth 1). |
| CRASH-02 | plan mapping; SC2 | Implementation and tests present; current behavior unverified (truth 2). Live in-chain presence is separately scoped to Phase 17; not counted as Phase 14 proof. |
| CRASH-03 | plan mapping; SC3 | Fsync implementation and tests present; current behavior unverified (truth 3). |
| CRASH-04 | plan mapping; SC3 and context item 6 | Record deletion count has a recorded 5b pass, but startup removal ID plus notice on current stack remains open (truths 3 and 6). |
| CRASH-06 | plan mapping; SC4 | Test and wiring present; current behavior unverified (truth 4). |
| CRASH-07 | plan mapping; SC5 | Test present; current behavior unverified (truth 5). |

All seven roadmap-mapped requirements appear in the plan mapping; none is orphaned. This report does not modify requirement checkboxes.

## Checks and review

- **Behavioral checks and probes:** not run; assignment explicitly prohibits tests, builds and live operations. No current pass is inferred from source or historical summaries.
- **Historical plan gates:** prior report attributes typecheck, lint, docs, gates, scripts, build, pack and MCP passes to `1fa69c1`; full suite reported 2,426 pass, 0 fail and 32 skips, not itemized. No current gate results supplied.
- **Anti-pattern scan:** no `TBD`, `FIXME` or `XXX` found in inspected phase source paths. This limited scan is not a full security or quality audit.
- **Decision coverage:** GSD query returned skipped, “No trackable decisions in CONTEXT.md”; locked prose decisions were considered in the criteria above.
- **Test quality:** checks contain meaningful signal, state and count assertions, but scenario 5's adoption pass is not evidence for startup removal, and scenario 5b's record-only deletion does not test removal-ID logging. Current execution and full test-quality gate were not performed.
- **Advisory (new scope, unevidenced):** None.

## Required follow-through

1. Resolve the literal live-removal acceptance: exercise an ineligible startup container and demonstrate its removed ID, deletion count and destroyed notice together, against the current driver closure in an approved serialized live window; alternatively obtain an explicit owner-approved acceptance change. Do not treat scenario 5b as that proof.
2. Run the named behavior tests and required plan gates on the integrated revision under the appropriate owner-controlled verification workflow; account for skips and frozen-contract changes. The four-stage tests currently exercise the sweep directly, so establish whether the separate startup wiring test meets the literal next-start criterion or add attributed end-to-end evidence.
3. Reconcile the stale CRASH-04 wording in REQUIREMENTS.md through its owner; this assignment intentionally does not edit it. Phase 17 owns its separate in-chain live presence evidence.

_Verified by source inspection and attributed existing records; no tests or live actions performed._
