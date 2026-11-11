---
phase: 13-quality-ratchet
verified: 2026-11-08T19:25:02Z
status: gaps_found
score: 1/6 must-haves verified
behavior_unverified: 4
overrides_applied: 0
covered_files:
  - .github/dependabot.yml
  - .github/workflows/ci.yml
  - .github/workflows/mutation.yml
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/phases/13-quality-ratchet/13-01-PLAN.md
  - .planning/phases/13-quality-ratchet/13-CONTEXT.md
  - .planning/phases/13-quality-ratchet/13-RESEARCH.md
  - .planning/phases/13-quality-ratchet/13-SUMMARY.md
  - .planning/quick/261108-puz-reconcile-the-v3-0-planning-records-with/261108-puz-CONTEXT.md
  - package.json
  - scripts/check/coverage-floors.json
  - scripts/check/coverage.mjs
  - scripts/check/coverage.test.mjs
  - scripts/check/export-usage.mjs
  - scripts/check/pack-smoke.mjs
  - scripts/check/pack-smoke.test.mjs
  - scripts/mutation/run.mjs
  - scripts/mutation/run.test.mjs
  - src/audit/chain.ts
  - src/runtime/libpod-client.ts
  - test/anda/listener-diagnostic.test.ts
  - test/anda/reconnect.test.ts
  - test/core/policy.property.test.ts
  - test/daemon/daemon.test.ts
  - test/fs/canonicalize.property.test.ts
  - test/integration/omp-live-helpers.test.ts
  - test/runtime/agentos-supervisor.test.ts
  - test/runtime/driver/socket-server.test.ts
  - test/runtime/libpod-client.test.ts
  - test/support/fake-execution.ts
  - test/support/timing.ts
covered_digest: "v4:sha256:bdc51bf3cfd6a9d5019b2a74d4388e15607a7d5e96cd95738a3860d441161e8c"
gaps:
  - truth: "The Finish/repair worktree smokes its actual release tarball before remote mutation."
    status: failed
    reason: "The Finish branch builds, packs and copies its tarball without invoking pack-smoke; the smoke step is conditional on the normal release branch."
    artifacts:
      - path: .github/workflows/ci.yml
        issue: "Build milestone files at lines 384-414 does not invoke pack-smoke; the smoke at lines 456-462 is guarded by action == normal."
    missing:
      - "Run pack-smoke against the actual Finish tarball with the expected tag version before publishing, and obtain the required workflow review and evidence."
behavior_unverified_items:
  - truth: "Missing adapter files fail pack-smoke and the normal release smokes its version-synced tarball."
    test: "On the current revision, exercise the named positive and four malformed actual-tarball cases and the normal release CI path."
    expected: "Each missing file is rejected by name and the exact version-synced tarball is checked before publication."
    why_human: "Historical local results are recorded, but no current CI run is evidenced and this verification was expressly prohibited from running tests."
  - truth: "Coverage floors enforce CI regressions and dead exports are disposed of by reference analysis."
    test: "Review Node 22.x and 24.x CI coverage logs, establish 22.x floor provenance, demonstrate a below-floor CI failure, and review the current export inventory and seam dispositions."
    expected: "The gate fails below CI-derived floors and all reference-analysis findings have an appropriate disposition without changing frozen contracts."
    why_human: "Host measurements and an older inventory do not establish current CI provenance or current inventory."
  - truth: "Timing tests use the deterministic seams and the current full suite passes in a one-CPU container."
    test: "Review current-revision test evidence and the timing migration, including the TTL and lifecycle cases."
    expected: "The suite passes under the CPU quota without deleting or skipping tests to obtain green, and the clock/hold ordering is deterministic."
    why_human: "The recorded container run predates the current integration revision; its skipped tests and historical source need attribution."
  - truth: "Property tests and the non-blocking scheduled mutation workflow execute for the required targets."
    test: "Review current CI property results and a workflow_dispatch mutation artifact, including target groups, and review the workflow and required PR-body material."
    expected: "Properties pass, the recorded deliberate break is represented, mutation reaches all three groups without blocking release, and required human approvals are documented."
    why_human: "The workflow and test sources alone cannot prove a hosted execution, artifact contents, PR-body evidence, or human review."
---

# Phase 13: Quality ratchet — verification

**Goal:** Regressions in dependencies, coverage, packaging and security-relevant path and policy logic fail in CI or a scheduled run before shipping; the suite no longer fails under load.

**Verdict: gaps_found.** This is a fresh goal-backward reassessment of the earlier narrative report, not a GSD structured re-verification: the earlier report had no YAML `gaps:` section. No tests, builds, lint, probes, or live operations were run in this assessment, as assigned. Recorded historical runs below are not newly observed results. A missing Finish-path check is a blocker; missing CI provenance, PR evidence, workflow execution, and human review remain open independently. Do not mark the phase complete.

## Observable truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Audit job and three Dependabot targets are configured | VERIFIED | `.github/workflows/ci.yml:140-165` runs the exact audit and makes build depend on it; `.github/dependabot.yml` declares root Actions, root npm and site npm weekly. This verifies configuration, not an actual hosted run. |
| 2 | Four missing packaged files fail and the normal release checks the version-synced tarball | UNCERTAIN — behavior unverified | `scripts/check/pack-smoke.mjs` and its tests implement the checks; `ci.yml:428-462` wires the normal path. Earlier report records four real-tarball negative passes and a local positive, but no current CI execution. |
| 3 | Coverage gates CI below CI-derived floors and export cleanup is complete | UNCERTAIN — behavior unverified | `package.json:57`, `scripts/check/coverage.mjs:434-555`, and `ci.yml:68-74` wire the 22.x gate. Historical host floor experiment is not CI provenance; the current export inventory/disposition is not in evidence. |
| 4 | Timing fixes and one-CPU container suite pass | UNCERTAIN — behavior unverified | `test/runtime/libpod-client.test.ts:355-360` injects `ManualClock`; ACP tests use `testTimeout`; `test/runtime/agentos-supervisor.test.ts:596-625` holds deadlines. The 2026-11-08 quota run is positive historical evidence, not a run of the current integration revision or CI. |
| 5 | Properties run and scheduled non-blocking mutation covers required targets | UNCERTAIN — behavior unverified | `package.json:55,74`, property sources, `.github/workflows/mutation.yml`, and `scripts/mutation/run.mjs:156-168,178-222,571-572` provide substantive wiring. No current hosted result or mutation artifact is available. |
| 6 | Finish/repair worktree checks its actual tarball before remote mutation (D-1303) | FAILED — BLOCKER | `ci.yml:384-414` packs and copies without smoke; `ci.yml:456-462` smoke is guarded by `steps.tag_check.outputs.action == 'normal'`. The Finish branch is not covered. |

## Requirements and evidence

| ID | Assessment | Evidence and remaining action |
|---|---|---|
| QR-01 | Configuration verified; CI unverified | Node 24.x audit job is a build prerequisite. The previous report records a local audit exit 0; the actual CI job remains unobserved. |
| QR-02 | Configuration verified | Three weekly targets are present. Dependabot live behavior and owner-controlled security-update settings are not proven by this file. |
| QR-03 | BLOCKED | Normal path wired; Finish path missing as above. The previous report records four local real-tarball negative passes and a positive check, with logs outside the repo; these do not prove the current Finish or hosted path. |
| QR-04 | UNCERTAIN | On 2026-11-08, `node scripts/check/coverage.mjs --lcov coverage/lcov.info --floors <scratch>` reportedly failed with `src/fs` branches 88.89 below the raised 95 floor; committed floors passed all nine metrics on Node 24.18. Source: `.planning/quick/261108-puz-reconcile-the-v3-0-planning-records-with/261108-puz-CONTEXT.md:33`. This closes the **local** raised-floor demonstration, not the D-1304 CI floor provenance: Node 22.x gate and 24.x CI evidence remain needed. |
| QR-05 | UNCERTAIN | The same context records `npm test` in rootless Podman `--cpus=1`, image `localhost/realm-qr05-runner:0626abe261`, Node 24.22.1, lane copy e34da60: 2799 passed, 0 failed, 34 skipped, 169.7 s; host load 10.0 before and 11.9 after on eight CPUs. This is real recorded quota evidence, not merely affinity, and not CI or current-revision proof. Timing migration commits `e46b4b1`, `98a20e7`, `26e9470` are recorded in that context; current source includes deterministic seams and `holdDeadlines`. No claim that the 34 skips were newly introduced or harmless is made. |
| QR-06 | UNCERTAIN | Earlier report records `export-usage.mjs --list` with one self-only export removed in `7c044b6`, subsequent zero self-only entries and typecheck exit 0, with inventory stored outside the repository. Current inventory and intentional test-only seam dispositions are not available. Both roadmap and requirements already say reference analysis; no wording correction is needed. Frozen-catalogue invariance across the current integration tree is not established by that one-file commit. |
| QR-07 | UNCERTAIN | Properties are authored and included by the test glob. The earlier report records a local break of `isInsideRoot` with 5/11 property failures and restoration; the recovery note separately records historical break 3/11 and restored 11/11. These are distinct historical records, not a current CI result. `fast-check` justification, licence and maintenance checks must be attached to the PR body; no such body is evidenced. FS-02 remains an owner decision. |
| QR-08 | UNCERTAIN | The 2026-11-08 owner chose the D-1308 permission drop; `9e2142f` applied it. Current `.github/workflows/mutation.yml` grants only `contents: read`, schedules weekly, permits dispatch and uploads an artifact; mutation and upload steps are non-blocking. `run.mjs` selects the three target groups, but no hosted dispatch/report proves execution. The permission decision is closed; **human review of the workflow change remains open**. |

All QR-01 through QR-08 are mapped by `13-01-PLAN.md`; no phase-mapped requirement is orphaned. D6 requires the workflow/dependency PR bodies to cite owner approval; PR-body evidence and workflow human review cannot be inferred from a source comment or the permission decision.

## Artifacts, links, and data flow

- `ci.yml` → audit → build dependency is wired; `ci.yml` → 22.x `test:coverage` → lcov comparison/floor exit is wired. CI execution and provenance are not established.
- Normal version sync → pack → `pack-smoke --tarball ... --expect-version ...` is wired. Finish worktree → pack → assets has **no** corresponding smoke call, a concrete missing link.
- `npm test` → compiled `dist/test/**/*.test.js` → path and policy property tests is wired; their authored generators include traversal, symlinks, NUL, unicode and repeated separators. Historical deliberate break evidence is above; current execution is not established.
- Mutation schedule/dispatch → `scripts/mutation/run.mjs` → JSON report → artifact upload is wired in configuration. The runner enumerates filesystem sources plus policy and redact; artifact presence and successful target execution are unobserved. Rendering/data-flow UI checks are not applicable.
- Timing helper and fake-execution hold gates are substantive; source-level presence cannot alone prove all current timing invariants.

## Verification and review limitations

**Behavioral spot-checks and probes:** not run; the assignment expressly forbids tests, builds, lint, formatters and live stack operations. No phase-declared `probe-*.sh` was found in the plan or summary. Historical command results above are attributed records, not this verifier's runs.

**Anti-patterns:** targeted scan of the principal pack, coverage, export, mutation and timing sources found no `TBD`, `FIXME`, or `XXX` markers. This is not a full code-quality or security audit. No unqualified claim is made that all tests, suppressions or thresholds satisfy the plan's prohibitions across the integration history.

**Decision coverage:** the read-only GSD decision-coverage query returned `skipped: true`, `No trackable decisions in CONTEXT.md.` This heuristic does not waive D6 or D-1308 human review.

**Human/CI decision items:** obtain and inspect both CI matrix legs and the audit/release runs; establish 22.x floor provenance and a CI below-floor failure; review a current export inventory and seam dispositions; attach the three dependency checks and D6 citations to the relevant PR bodies; obtain human review of workflow changes; dispatch mutation and inspect its report; obtain current-revision timing/property evidence. Do not infer any of these from the recorded local runs. The Finish smoke is a present code gap, not merely a request for review.

**Deferred items:** None. Phase 20 covers release hardening, but the Finish smoke is explicitly required by this phase's D-1303 and acceptance plan; its absence is not silently deferred.

---
_Verified from source and recorded evidence: 2026-11-08T19:25:02Z_
