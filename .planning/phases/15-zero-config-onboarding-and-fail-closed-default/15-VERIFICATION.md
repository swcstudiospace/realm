---
phase: 15-zero-config-onboarding-and-fail-closed-default
verified: 2026-11-08T19:25:21Z
status: gaps_found
score: 0/5 roadmap criteria verified
behavior_unverified: 5
overrides_applied: 0
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-01-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-01-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-02-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-02-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-03-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-03-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-04-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-04-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-05-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-05-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-06-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-06-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-07-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-07-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-08-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-08-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-09-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-09-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-10-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-11-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-12-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-13-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-14-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-15-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-16-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-CONTEXT.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-SUMMARY.md
  - AGENTS.md
  - README.md
  - docs/hosts/snippets/omp.md
  - docs/integration/host-binaries.md
  - docs/integration/hosts.md
  - docs/integration/omp.md
  - docs/integration/openshell.md
  - docs/policy-reference.md
  - package.json
  - scripts/check/default-mode.mjs
  - scripts/check/default-mode.test.mjs
  - src/cli/init.ts
  - src/cli/main.ts
  - src/contract/validate.ts
  - src/core/policy.schema.json
  - src/core/policy.ts
  - src/daemon/main.ts
  - src/daemon/spawn-env.ts
  - src/doctor/checks.ts
  - src/doctor/fix.ts
  - src/doctor/runtime-checks.ts
  - src/omp/extension.ts
  - src/runtime/config.ts
  - src/runtime/driver/main.ts
  - src/runtime/openshell.ts
  - test/cli/cli.test.ts
  - test/cli/init.test.ts
  - test/core/policy.schema.test.ts
  - test/core/policy.test.ts
  - test/daemon/main.test.ts
  - test/daemon/spawn-env.test.ts
  - test/doctor/checks.test.ts
  - test/doctor/dial-defaults.test.ts
  - test/doctor/fix.test.ts
  - test/doctor/runtime-root-checks.test.ts
  - test/integration/production-driver.test.ts
  - test/integration/production-live-helpers.test.ts
  - test/runtime/config.test.ts
  - test/runtime/driver/driver-main.test.ts
  - test/support/production-live.ts
covered_digest: "v4:sha256:48e41c2fd4bf700d49fad27bc884f375055dd8eec4ce3bd36d336a5a2b06da46"
gaps:
  - truth: "L-A records the complete production live suite passing with config-selected roots and scenario 1's no-mode policy reporting fail-closed."
    status: failed
    reason: "The orchestrator-reported first window had 31 passing and three failing production tests, subsequently fixed; the selective second window is not a complete passing L-A rerun. No required L-A receipt or scenario 1 mode line was supplied to this verifier."
    artifacts:
      - path: .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-10-PLAN.md
        issue: "The required all-green redacted L-A suite receipt and scenario 1 mode line remain unestablished."
    missing:
      - "Owner-approved, serialized full current-build L-A run with the required config, per-scenario outcomes, counts, and fail-closed mode evidence."
  - truth: "The current-build isolated Omp install record includes install, list, and an rpc-ui session loading the installed extension without -e."
    status: failed
    reason: "The snippet explicitly identifies its 0.3.24 install/list receipt as historical and says the current package has no new successful install/load capture."
    artifacts:
      - path: docs/hosts/snippets/omp.md
        issue: "No current-build install/list/rpc-ui record with status and realm-retry as required by plan 15-16."
    missing:
      - "Approved L-D receipt for current build, and documentation linked to the matching install and session evidence."
  - truth: "README's current-build quickstart transcript is captured from init, up, status and down."
    status: failed
    reason: "README identifies its actual transcript as the 2026-10-31 Realm 0.3.26 run with a temporary rebuilt driver, not a current-build capture as plan 15-16 requires."
    artifacts:
      - path: README.md
        issue: "Current-build L-C2 transcript and its corresponding evidence link are absent; historical transcript is retained."
    missing:
      - "Approved L-C2 current-build capture, normalized and recorded per plan 15-16, retaining historical evidence separately."
behavior_unverified_items:
  - truth: "Roadmap 1: clean-host init and up reach active without manual edits."
    test: "Run the approved current-build L-C/L-C2 sequence on the specified pre-provisioned Podman 5.x host."
    expected: "Init creates private templates and roots without clobbering, then up and status report active and down succeeds without manual JSON edits."
    why_human: "Historical parent-reported capture is not a current-build acceptance run; no live operations were authorized for this verifier."
  - truth: "Roadmap 2: named doctor checks and safe fix transitions work."
    test: "Run the named unit tests and approved local fix scenario, including dry run, repeat and symlink refusal."
    expected: "Checks identify failures and fixes; 0755 becomes 0700 once, dry run writes nothing and symlinks are refused."
    why_human: "Tests exist but were not run here; filesystem safety and state transitions cannot be proved by presence."
  - truth: "Roadmap 3: driver and daemon share roots and both child launch paths filter the environment."
    test: "Run the named real-child sentinel test and complete L-B under the approved live lock."
    expected: "Sentinel and legacy root variables are absent; updated driver and daemon use the same config, all three live doctor checks pass, and the unit and app are restored."
    why_human: "The deployed older driver was not restaged or restarted and unit changes are not approved."
  - truth: "Roadmap 4: default mode and documentation cutover behave correctly."
    test: "Run the current named policy/default-mode tests and docs checks, and inspect scenario 1's no-mode status in L-A."
    expected: "Missing mode loads fail-closed, explicit advisory remains opt-in, and the docs guard passes."
    why_human: "This verifier did not run tests or docs checks; prior results belong to other snapshots."
  - truth: "Roadmap 5: isolated Omp install and real Podman quickstart transcript meet current-build acceptance."
    test: "Perform approved L-D and L-C2 and examine the recorded current-build evidence."
    expected: "Install/list succeed, rpc-ui loads the installed extension without -e, and normalized init/up/status/down output matches the README."
    why_human: "The current-build receipts are absent; historical install and lifecycle records cannot establish the current version."
---

# Phase 15: Zero-config onboarding and fail-closed default — Verification

**Phase goal:** A new user on a Podman 5.x host reaches an active sandbox with `realm init` and `realm up` and no manual edit, and a policy that says nothing about its mode contains the agent.

**Status:** gaps_found. **Snapshot:** `f581e5cdfd145a00a6e54dae69a892754d559826`. **Mode:** initial assessment; the previous report had no YAML `gaps:` section. No override was recorded. This assessment is read-only except for this report; it ran no tests, builds, probes or live operations. All inherited test and live results below are **orchestrator-reported**, not independently re-observed or receipts invented by this verifier.

The goal's broader Omp builtin containment language is specifically assigned to Phase 16 by D3 (`15-CONTEXT.md`); fail-closed policy loading alone is not proof that Omp's built-in host tools are contained. This explicit later-phase boundary does not waive any Phase 15 acceptance below.

## Goal achievement: roadmap criteria

| # | Roadmap success criterion | Verdict | Evidence and limit |
|---|---|---|---|
| 1 | Clean Podman 5.x host: init then up is active; templates, permissions, no overwrite, digest | UNCERTAIN — WARNING | `src/cli/init.ts:241-242,364-395,460-481` validates, publishes without clobber and writes explicit fail-closed policy; `test/cli/init.test.ts` exists. README:118-146 contains a parent-reported 0.3.26/Podman 5.7.1 lifecycle with a temporary matching rebuilt driver. This is historical, not current-build L-C2 proof. |
| 2 | Doctor diagnoses roots/socket/gateway; safe, idempotent, dry-run and symlink-refusing fixes | UNCERTAIN — WARNING | `src/doctor/runtime-checks.ts:56-67,332-366,411-420` implements named checks and recovery prose; `src/doctor/fix.ts:53-106,194-223` preflights and uses pinned `fchmod`; associated tests exist. Prior 31-pass nonroot doctor evidence is parent-reported for the historical snapshot, not rerun here. Doctor intentionally exits 0 for diagnostic failures (P15-O3), not a failing process exit. |
| 3 | Config-selected roots and filtered environment on both launch paths | UNCERTAIN — WARNING | `src/runtime/config.ts:142-145`, `src/runtime/driver/main.ts:107-110`, and `src/daemon/main.ts:74-75` derive roots from config; `src/daemon/spawn-env.ts` selects allowed names; `test/daemon/spawn-env.test.ts:89-142` asserts real-child sentinel filtering. L-B is not approved or performed for the current deployed service; no test was run here. |
| 4 | Fail-closed default, explicit advisory, aligned docs and guard | UNCERTAIN — WARNING | `src/core/policy.schema.json:10-11` and `src/core/policy.ts:38-55` wire schema defaults and mode provenance; `src/cli/init.ts:478-481` writes explicit fail-closed; `package.json:60` runs the guard. The named policy tests and docs guard were not exercised at this snapshot; L-A scenario 1 remains unproven. |
| 5 | Isolated install evidence and real Podman transcript | FAILED — BLOCKER | Historical Omp 18.12.6 / package 0.3.24 install/list and historical 0.3.26 lifecycle are recorded, but current-build L-D installed-load and L-C2 capture required by `15-16-PLAN.md` are absent. The README and snippet explicitly qualify their records as historical. |

**Score:** 0/5 fully verified; all five have behavior evidence requiring current verification, and criterion 5 also has an observable missing current-build artifact. The score is not a statement that none of the code exists.

## Phase-specific checkpoint matrix

| Checkpoint | Contract | Evidence and remaining work |
|---|---|---|
| L-A, plan 15-10 | Full production live suite with `REALM_LIVE_DRIVER_CONFIG`; zero failures; scenario 1 status shows fail-closed for a policy without `mode`; redacted per-scenario/count evidence | **Incomplete.** Orchestrator reports initial `9cdbe8e` production run 31 pass / 3 test failures, with fixes subsequently applied. Selective `a8cee97` scenarios 5, 5b, 6 passed; separate two-project failed first up with `OPENSHELL_START_FAILED` and driver journal `create.workspace` / `SCHEMA_INVALID`. Separate scenario 10 at `e9e0c39` passed 1/1. None is an all-green full L-A rerun or the required mode receipt. `test/integration/production-driver.test.ts:278-281` contains the assertion, not proof it passed. |
| L-B, plan 15-10 | New driver build installed, unit stripped of three legacy root variables and given config home; restart; L-A rerun; three doctor items pass; restore app/unit/config and report listening | **Not approved, not run.** The deployed older driver was used through the cited windows; no restart, restage or unit edit was approved. Its startup sweep is account-wide. Require explicit owner approval, lock, backups and the plan's restore; do not treat the historical temporary driver as this prescribed checkpoint. |
| L-C, plan 15-15 | Fresh-config lifecycle and safe-fix run, under lock and the owner's written L-B host-state decision | **Current checkpoint incomplete.** The historical 2026-10-31 parent-reported fresh-config lifecycle and nonroot fix observations are useful bounded evidence, but no current L-C transcript or required L-B host-state decision was supplied. |
| L-C2, plan 15-16 | Current-build `init/up/status/down` evidence with normalized output for README | **Incomplete.** README currently labels its actual transcript Realm 0.3.26, Podman 5.7.1, 2026-10-31. Do not relabel it as current. |
| L-D, plan 15-16 | Isolated current-build install dry-run/install/list plus rpc-ui without `-e`, status frame and `realm-retry`, no extension error | **Incomplete.** `docs/hosts/snippets/omp.md:71-82` documents only historical local-link install/list; no matching current-build installed-load session is documented. The separately reported OMPX-05 1/1 at `9cdbe8e`, Omp 18.18.1, is not an L-D install/list receipt. |
| PR D | Update README and integration documentation using the L-C2 and L-D receipts; run docs checks | **Incomplete.** Current install record and transcript links cannot be fulfilled without those receipts. Docs checks were not run here. |

Inherited scenario outcomes are reproduced from `.planning/quick/261108-puz-reconcile-the-v3-0-planning-records-with/261108-puz-SUMMARY.md:12` and the orchestrator, not direct test output. No result asserts the newer driver closure was live-verified. The prior report's blanket statement that all live steps were never run is superseded only to the extent of these qualified historical observations, not by a phase pass.

## Requirement coverage and wiring

| Requirement | Plans | Status | Evidence / outstanding obligation |
|---|---|---|---|
| ONB-01 | 11, 13, 15 | UNCERTAIN | `init.ts` has digest/config validation and no-clobber publication; historical generated-config active lifecycle is parent-reported; current L-C/L-C2 pending. |
| ONB-02 | 12, 13, 15 | UNCERTAIN | `fix.ts` preflights and uses descriptor mode changes; parent-reported historical nonroot tests and real fix sequence; current tests and checkpoint not run. Later filesystem failures can leave reported partial actions (`fix.ts:53-54,99-106`); preflight is not transactional rollback. |
| ONB-03 | 04, 07, 08, 10 | UNCERTAIN | Driver and daemon both call `runtimeRootsOf`; full L-A and edited-unit L-B not established. Workspace root is explicitly required; only secret and sandbox-state roots default under stateDir (`config.ts:142-145`), so do not claim all three are defaulted. |
| ONB-04 | 06, 07, 10 | UNCERTAIN | Three substantive checks and named tests exist, including repair prose for missing configured roots (`runtime-checks.ts:59-67`); L-B doctor pass and current test results absent. This source evidence improves on the stale requirements trace note claiming repair prose unresolved, without declaring the requirement complete. |
| ONB-05 | 16 | FAILED | Historical isolated install/list exists; current-build install/list/rpc-ui evidence and current record are absent. |
| ONB-06 | 16 | FAILED | Historical real Podman 5.7.1 transcript exists; plan requires a current-build transcript, not yet recorded. |
| ONB-07 | 05, 07, 10 | UNCERTAIN | Allowlist is wired and a real-child sentinel test is authored; no present-run test or completed live L-A/L-B. |
| DEF-01 | 01, 03 | UNCERTAIN | Schema, loader and provenance exist; current test and scenario 1 pass not observed. |
| DEF-02 | 01–03 | UNCERTAIN | Docs/default guard and package wiring exist; no current docs gate was run. |

All nine roadmap requirement IDs occur in the plan requirement fields; no orphaned Phase 15 requirement identified. Plans 15-10 and 15-15/16 explicitly require live external evidence; plans 15-11–14 specify safety, CLI and documentation contracts. Source presence and authored tests do not prove every plan-specific runtime invariant; execute the named checks when authorized.

**Key links:** schema → validator → detailed policy loader (`policy.ts:44-55`); CLI init → `loadRuntimeConfig`/`runtimeRootsOf` → published templates (`init.ts:241-242,478-480`); driver and daemon → config roots (`driver/main.ts:107-110`, `daemon/main.ts:74-75`); doctor → roots, driver socket and gateway (`runtime-checks.ts:411-420`); package → docs guard (`package.json:60`). These links are present in source. The README-to-current-L-C2 and README/snippet-to-current-L-D evidence links are **not wired**, because the required current receipts are missing. No rendered dynamic data surface is in this phase; runtime data sources are traced above.

## Anti-pattern and verification limits

A targeted scan for unreferenced `TBD`, `FIXME`, `XXX` in the examined phase-owned implementation files returned no matches. This is not a full-repository or full test-quality audit. No source-level stub was established in the examined paths. The phase-specific anti-pattern finding is the observable absence of the current install and transcript evidence, not the existence of the intentionally historical records.

**Behavioral spot-checks and probes:** Not run: the assignment expressly prohibited tests, builds and live operations. No new test or probe outcome is claimed. Prior verification's older aggregate pass cannot certify this later snapshot, and selective live windows cannot be inflated into an all-green production suite. Review named tests and run the appropriate gates at the orchestration level after authorization.

**Decision coverage:** Not evaluated with the GSD decision gate; no gate execution was authorized. D3, D4, P15-O2, P15-O3 and P15-O4 were checked manually against context and relevant source/docs; this is not a complete decision-coverage count. No `human-check`, `prohibitions`, or `verification: backstop` blocks were found in the phase plans.

## Human decision and verification required

1. Approve and schedule L-A under the live lock, with complete scenario/count and no-mode fail-closed evidence; investigate any remaining failures rather than inferring a pass from the fixes.
2. Decide whether the high-impact L-B restage/unit edit/restart is authorized and what state is left after restoration. If approved, follow the plan's backups, all-green rerun, three doctor checks and explicit restore. A driver restart removes account-wide realm containers.
3. Decide the L-B host-state prerequisite, then authorize L-C/L-C2 and L-D. Capture the current-build lifecycle and isolated installed-plugin session and update PR D from actual normalized evidence. Do not substitute the historical receipts.
4. Run the relevant named tests and docs checks on the final integrated tree; a human or main agent must assess the unexercised state-transition and filtering assertions.

**Conclusion:** Phase 15 is not complete and must not be advanced as passed. The current-build L-D and L-C2 deliverables are missing, and the required full L-A evidence is not green; L-B remains an unapproved high-impact checkpoint. Phase 16's explicitly scheduled Omp containment work is separate and does not resolve these Phase 15 gaps.
