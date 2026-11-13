---
phase: 13-quality-ratchet
verified: 2026-11-13T08:44:55Z
status: human_needed
score: 5/6 must-haves verified
behavior_unverified: 1
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
  - package-lock.json
  - package.json
  - scripts/check/coverage-floors.json
  - scripts/check/coverage.mjs
  - scripts/check/coverage.test.mjs
  - scripts/check/export-usage-allowlist.json
  - scripts/check/export-usage-gate.mjs
  - scripts/check/export-usage-gate.test.mjs
  - scripts/check/export-usage.mjs
  - scripts/check/export-usage.test.mjs
  - scripts/check/pack-smoke.mjs
  - scripts/check/pack-smoke.test.mjs
  - scripts/mutation/run.mjs
  - scripts/mutation/run.test.mjs
  - src/audit/chain.ts
  - src/runtime/libpod-client.ts
  - test/acp/agent.test.ts
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
  - test/support/property.ts
  - test/support/timing.test.ts
  - test/support/timing.ts
covered_digest: "v4:sha256:165ac85dfb2540db62c917b7076427ad9a7ff969ee16d46f68b25da07d0896c1"
re_verification:
  previous_status: human_needed
  previous_score: 4/6
  gaps_closed:
    - "Truth 3 / QR-04: below-floor CI failure observed on the Node 22.x Coverage floors step (orchestrator-supplied; run 43393671617)"
  gaps_remaining: []
  regressions: []
behavior_unverified_items:
  - truth: "The suite passes under a CPU quota on the current revision without deleting or skipping tests (QR-05)"
    test: "Run npm test under a one-CPU quota, in a container if QR-05 is read literally, record the log digest and host load, and attribute every skipped test."
    expected: "Exit 0; each skip is attributed to an existing skip reason; no test removed or skipped to obtain green."
    why_human: "The recorded quota run is a cgroup run (systemd-run --scope -p CPUQuota=100%), not a container. It exited 0 with 0 failures and 38 skips, but its log sits outside the repository with no digest recorded, and the 38 skips are not attributed."
human_verification:
  - test: "Review the phase 13 workflow changes against owner decision D6 and AGENTS.md: the Finish smoke (ci.yml:403-408, commit 75631f4), the release smoke (ci.yml:463-469), the mutation permission drop (mutation.yml, commit 9e2142f), and .github/dependabot.yml. Confirm each pull request body cites D6."
    expected: "The owner signs off each workflow change, and each pull request body carries its D6 citation."
    why_human: "Workflow review and pull request bodies are not repository files, and AGENTS.md requires human review before any workflow change merges."
  - test: "Inspect a GitHub Finish or repair run that reaches the Build milestone files step."
    expected: "The step log shows pack-smoke run with --expect-version for the tag, and it passes before any publish step runs."
    why_human: "No hosted Finish or repair run is evidenced; REQUIREMENTS.md:179 records that GitHub repair-run evidence is open."
  - test: "In GitHub settings and the Dependabot tab, confirm version updates are active for github-actions (root), npm (root) and npm (site), and record the owner's choice for Dependabot security updates. OPEN: the owner will close this item; it stays open in this file."
    expected: "Each of the three targets shows a configured schedule, and the security-update setting is recorded by the owner."
    why_human: "A configuration file cannot show live Dependabot behaviour or repository settings (QR-02; the owner keeps those settings)."
  - test: "Run npm test at the current revision under a one-CPU quota, in a container if QR-05 is read literally. Attribute the skipped tests, and record the log digest and host load."
    expected: "Exit 0, with the skip count stated and attributed to existing skip reasons."
    why_human: "The recorded quota run is a cgroup, not a container. Its log is outside the repository and its skips are unattributed."
  - test: "Run node scripts/check/export-usage.mjs --list on the current tree and record the file path of the self-only entry and of the two test-only entries outside the gate's count. Confirm each sits outside src/, that nothing in src/core/errors.ts, src/contract/ or src/core/ports* changed, and that no src export is used only inside its own file."
    expected: "Each entry's file path is shown in the --list output; no src/ export is used only inside its own file; nothing in src/core/errors.ts, src/contract/ or src/core/ports* changed."
    why_human: "The --list output is not in the repository. The gate covers src/ only, and the inventory counts (165 test-only plus 1 self-only) exceed the gate's 164 src/ candidates by two (QR-06)."
  - test: "Check the QR-07 pull request body for the three CONTRIBUTING.md items for fast-check 4.10.2: justification, licence check and maintenance check. OPEN: the owner will close this item; it stays open in this file."
    expected: "All three appear in the pull request body."
    why_human: "Pull request bodies are not repository files."
---

# Phase 13: Quality ratchet — verification (re-verification)

**Phase Goal:** Regressions in dependencies, coverage, packaging and the security-relevant path and policy logic fail in CI or in a scheduled run before they ship, and the test suite no longer fails under load.
**Verified:** 2026-11-13T08:44:55Z
**Status:** human_needed
**Re-verification:** Yes — re-verification after the 2026-11-13 08:14:48Z report (`human_needed`, 4/6). Evidence changed for QR-04: the below-floor CI failure is now observed (truth 3 moves from UNCERTAIN to VERIFIED). QR-05 and QR-06 evidence is unchanged. Truths 1, 2, 4, 5 and 6 keep their previous labels.

## Method and scope

- Read-only, as assigned. This verifier ran no tests, builds, lint, typecheck, formatters, gates or `check:docs`. The checks performed were file reads, read-only greps of the cited line numbers and of the test files, a read of the allowlist JSON, a read-only debt-marker scan (Step 7) over the covered implementation files, and `gsd-tools query verification.fingerprint` for the digest.
- Tree: this report is written on `gsd/phase-13-reverify`, branched from `origin/main` at `43486bb`. That tree contains `4386b9b`, the closeout revision the previous report verified. The only covered files that differ between `4386b9b` and `origin/main` are `package.json` and `package-lock.json`, where the release bump changes `version` from `0.3.27` to `0.3.28`. The covered digest therefore differs from the previous `v4` digest; the difference comes from that version field alone. Every line citation below was re-checked by grep on this tree.
- The digest was computed by `gsd-tools` 1.20.1 (`v4`). The `gsd-tools` 1.18.0 installed on this host emits `v3` for the same file set, so the `v4` value is not reproducible with that older build.
- Debt-marker scan (Step 7): no `TBD`, `FIXME` or `XXX` marker in any covered implementation or test file. No `.skip`, `skip:` or `{ skip` marker in `test/runtime/agentos-supervisor.test.ts`, `test/runtime/libpod-client.test.ts`, `test/acp/agent.test.ts`, `test/support/timing.ts` or `test/support/fake-execution.ts`. Zero `timeout: 10_000` literals remain under `test/acp`.
- Orchestrator-supplied evidence, cited and not re-observed here:
  - Hosted CI on PR 59 head: Dependency audit, Build docs site, Verify on Node 22.x and 24.x, all passed, including `npm run test:coverage`, the property tests and the full suite (3041 tests, 0 failures).
  - QR-04 red run: hosted Verify, Node 22.x leg, run `43393671617` on branch `ci/red-floor-demo`. The Coverage floors step logged `coverage: FAILED (7 metric(s) below a floor, 0 unloaded file(s), 0 not built file(s))`, followed by `##[error]Process completed with exit code 1`. The red came from a raised scratch floor set in the committed file on that branch only. Committed floors on main pass. The branch is closed, unmerged and deleted, so the run cannot be re-inspected from this repository.
  - QR-04 local corroboration: `node scripts/check/coverage.mjs --lcov coverage/lcov.info` with a scratch floors file at 99 (not committed) exits non-zero with "7 metric(s) below a floor".
  - Mutation run `43387372658`: success; killed 7, survived 5, timedOut 0, untested 0; `src/fs` 9, `src/core` 2, `src/audit` 1 mutants.
  - QR-05 quota run: `systemd-run --scope -p CPUQuota=100% -- npm test` at the repository root exited 0 with 3047 tests, 3009 pass, 0 fail and 38 skipped (log: a host evidence log outside the repository, not committed; digest not recorded).
  - QR-06 inventory from `node scripts/check/export-usage.mjs --list`: used-in-src 541, test-only 165, self-only 1, forwarded 2, unclassified 1, excluded 63, public-signature 138. `node scripts/check/export-usage-gate.mjs` exits 0: "0 failing export(s), 164 allowlisted seam(s), 0 stale allowlist entries".
- Covered set: 40 repository-relative files, listed in the frontmatter.
- `gsd-tools phase complete 13` was not run, because it writes ROADMAP and STATE, which are out of scope.

## Goal Achievement

### Observable Truths

| #   | Truth   | Status     | Evidence       |
| --- | ------- | ---------- | -------------- |
| 1   | Audit job and three Dependabot targets are configured (QR-01, QR-02) | ✓ VERIFIED | `ci.yml:140-160`: the audit job runs `npm audit --omit=dev --audit-level=high` on `ubuntu-24.04` (re-read: `:160`). `ci.yml:164`: `build` has `needs: [verify, site, audit]` (re-read). `.github/dependabot.yml` declares `github-actions` at `/`, `npm` at `/`, and `npm` at `/site`, all weekly, with `ci`/`build` prefixes, a `dev-tooling` group, and an ignore for `@types/node` semver-major. Live Dependabot behaviour and the owner's security-update setting are human items. |
| 2   | Four packaged adapter files are checked, and the normal release smokes the version-synced tarball (QR-03) | ✓ VERIFIED | `scripts/check/pack-smoke.mjs:29-39` lists the four files in `ADAPTER_FILES`. `:124` `missingWalkedFiles` walks `adapters/` and `licenses/`. `:249-255` checks adapter, walked, declared and legal files and fails by name. `ci.yml:469` runs `node scripts/check/pack-smoke.mjs --tarball "agent-realm-${VERSION}.tgz" --expect-version "${VERSION}"` in the release path, inside the `:463-469` range. |
| 3   | Coverage floors gate CI, and dead exports are removed by reference analysis (QR-04, QR-06) | ✓ VERIFIED | QR-04: `ci.yml:69-73` runs `npm run test:coverage` on the 22.x leg only (`ci.yml:73` re-read). `scripts/check/coverage-floors.json` sets `reportOnly: false`, `gateNode: 22.x`, `src/fs` 91/87/99, `src/core` 97/95/96, `src/tools` 96/92/99; the file is unchanged since the previous report. The hosted Verify run passed with these floors on main. The below-floor branch is now observed on the Node 22.x leg: run `43393671617` logged `coverage: FAILED (7 metric(s) below a floor, …)` and exited 1 (orchestrator-supplied; the branch is deleted, so the run is not re-inspectable here). QR-06: the export gate passes with 0 failing src exports, 164 documented test-only seams, and 0 stale entries (gate exit 0, orchestrator-supplied). `readTailHead` (`src/audit/chain.ts:192`) is no longer exported (`function readTailHead`, re-checked on this tree). |
| 4   | Timing tests use deterministic seams, and the suite passes CPU-limited (QR-05) | ⚠️ UNCERTAIN | Seams are present. `test/support/timing.ts:111` exports `ManualClock`. The libpod TTL test injects it through `now` (`test/runtime/libpod-client.test.ts:356-357`). `test/runtime/agentos-supervisor.test.ts:644-678` holds call deadlines in `holdDeadlines`. `test/support/fake-execution.ts:114` provides `holdNext`. The fixed `{ timeout: 10_000 }` caps under `test/acp` are gone (0 remain, re-checked on this tree). The CPU-quota evidence is a cgroup run at this revision with exit 0, 0 failures and 38 skips. That run is not a container, its log is outside the repository without a digest, and its 38 skips are not attributed. The skip attribution and container form remain open. |
| 5   | Property tests run in `npm test` and a broken canonicalizer fails one; the mutation run is scheduled and non-blocking (QR-07, QR-08) | ✓ VERIFIED | QR-07: `package.json:74` pins `"fast-check": "4.10.2"` exactly, and `package-lock.json:1159-1160` matches. `test/fs/canonicalize.property.test.ts` has `fc.property` blocks at `:143-292` covering traversal, symlink, NUL, doubled-separator and unicode inputs. `test/core/policy.property.test.ts:135-136` covers the round trip, `:157-160` covers unknown top-level keys, and `:170` covers unknown `egressAllow` keys. `npm test` (`ci.yml:65`) runs `dist/test/**`, which includes these files, and hosted Verify passed. The deliberate-break record is historical: `.planning/phases/RECOVERY-2026-10-31.md` records a break with its outcome. QR-08: `.github/workflows/mutation.yml:8` (schedule) and `:10` (`workflow_dispatch`) are present, `:13` sets `contents: read`, and `:45` runs `scripts/mutation/run.mjs`. Run `43387372658` succeeded (orchestrator-supplied). |
| 6   | The Finish/repair worktree smokes its actual release tarball before any remote mutation (QR-03) | ✓ VERIFIED | `ci.yml:383-414` ("Build milestone files", guard `steps.milestone.outputs.tag != ''` at `:384`) builds the tag in a worktree and packs the tarball. `ci.yml:407` runs `runCheck(["--tarball", tarball, "--expect-version", version], { root: dir })`, which sits inside the `:403-408` range, so the checker is the triggering checkout's and the tree walked is the tagged one. The step sits in the build job (`ci.yml:166`-onward). That job contains no `gh release` or `git push` command, and `ci.yml:425-429` uploads the milestone files afterwards. The publish job (`ci.yml:500`) performs the first remote writes (`gh release upload` at `:821`, tag push at `:877-878`, both on the normal path). |

Score: 5/6 truths VERIFIED (1, 2, 3, 5, 6). Truth 4 is UNCERTAIN and is the only item in `behavior_unverified_items`.

### Corrections to the orchestrator's evidence

- The fork guards at `ci.yml:25`, `:112` and `:141` apply to the GitHub-hosted jobs `verify`, `site` and `audit` (`runs-on: ubuntu-24.04`). They do not guard the self-hosted jobs. The self-hosted `build` (`ci.yml:166`) and `publish` (`ci.yml:500`) jobs are guarded by `github.event_name == 'push' && github.ref == 'refs/heads/main'` (`:165`, `:499`), and that condition already excludes pull requests from forks.
- The 2026-11-08 finding that `Build milestone files` does not invoke `pack-smoke` is superseded by the tree at HEAD.
- `13-SUMMARY.md` and the `REQUIREMENTS.md` status column (`P13A`–`P13C`, "Implemented-unverified") predate this report and are stale. The QR-08 "HELD-OWNER" status there is superseded by `9e2142f`. Neither file was edited here.
- QR-05 is not closed. The quota run is a cgroup (`systemd-run --scope -p CPUQuota=100%`), not a container, and its 38 skips are unattributed. The repository holds no record of those skips, and the 33-skip figure from the e8e0eeb tree is not the same tree. The requirement's acceptance text ("no test deleted or skipped to get green") therefore cannot be checked from the repository. Truth 4 stays UNCERTAIN and is listed as the behavior item. The orchestrator should decide whether that residual blocks the phase.
- QR-06 inventory: the `--list` counts (test-only 165, self-only 1) sum to 166. The gate's src/ candidates (self-only plus test-only) total 164, the number of allowlisted seams. The two extra entries are most likely in `test/`, which the analyzer covers but the gate ignores (`export-usage-gate.mjs:31` filters to `src/`). This is an inference, not an observation: the `--list` output paths are not in the repository. Human item 5 asks for the paths.
- `ci.yml` line numbers: the Finish `runCheck` call is at `:407` within the cited `:403-408` range, and the release smoke is at `:469` within `:463-469`. The cited ranges still hold on this tree.

### Deferred Items

None. The Finish smoke was explicitly in this phase's acceptance (D-1303) and is wired at HEAD.

### Advisory (New Scope, Unevidenced)

None. No new-scope finding was raised in this re-verification.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `.github/workflows/ci.yml` | audit job, coverage gate, release and Finish smoke | VERIFIED | `:140-160`, `:69-73`, `:403-408` (runCheck at `:407`), `:463-469` (smoke at `:469`), `:164` |
| `.github/dependabot.yml` | three update targets | VERIFIED | Whole file; unchanged between `4386b9b` and `origin/main` |
| `.github/workflows/mutation.yml` | scheduled, dispatchable, non-blocking, `contents: read` | VERIFIED | `:8`, `:10`, `:13`, `:22-23`, `:45`, `:52-53` |
| `scripts/check/pack-smoke.mjs` | four files, walk check, `--tarball`, `--expect-version` | VERIFIED | `:29-39`, `:83-99`, `:124`, `:249-255` |
| `scripts/check/coverage.mjs` and `coverage-floors.json` | per-directory floor comparison, enforced | VERIFIED | `:205-218`, `:435`; floors file as cited; CI-leg below-floor red run `43393671617` (orchestrator-supplied) |
| `scripts/check/export-usage.mjs` | informational reference analysis | VERIFIED (present); inventory supplied by orchestrator | Header states the analyzer never fails; `--list` counts as cited |
| `scripts/check/export-usage-gate.mjs` and `export-usage-allowlist.json` | fails on src self-only or test-only exports not documented as seams | VERIFIED (logic and allowlist); gate result orchestrator-supplied | `export-usage-gate.mjs:20`, `:31`, `:33`; allowlist holds 164 entries, all with reason "D-1306 test-only seam" |
| `test/support/timing.ts` and `timing.test.ts` | deterministic helpers and `ManualClock` | VERIFIED | `timing.ts:111` |
| `test/support/property.ts`, `test/fs/canonicalize.property.test.ts`, `test/core/policy.property.test.ts` | fast-check properties | VERIFIED | `:135-170` in the policy file; `:143-292` in the canonicalizer file |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `ci.yml` audit job | `build` job | `needs: [verify, site, audit]` | WIRED | `ci.yml:164` |
| `ci.yml` Coverage floors step | `scripts/check/coverage.mjs` | `npm run test:coverage` → `node scripts/check/coverage.mjs` | WIRED | `package.json:57`, `ci.yml:69-73` |
| `ci.yml` Build milestone files | `pack-smoke.mjs` | `runCheck` with `--tarball` and `--expect-version` over the tag worktree | WIRED | `ci.yml:403-408`; `pack-smoke.mjs:294` |
| `ci.yml` Smoke the release tarball | `pack-smoke.mjs` | `--tarball … --expect-version …` after build and pack | WIRED | `ci.yml:469` |
| `test/fs/canonicalize.property.test.ts` | `npm test` | compiled `dist/test/**` glob | WIRED | `package.json:55`, `ci.yml:65` |
| `mutation.yml` | `scripts/mutation/run.mjs` | `node scripts/mutation/run.mjs --report mutation-report.json` | WIRED | `mutation.yml:45` |

### Data-Flow Trace (Level 4)

Not applicable. No artifact in this phase renders dynamic data.

### Behavioral Spot-Checks

Not run by this verifier. The assignment forbids running tests, builds and lint. Results cited above are orchestrator-supplied and are attributed to their records. No phase-declared `probe-*.sh` exists in the plan or summary.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| QR-01 | 13-01-PLAN.md | `ci.yml` runs `npm audit --omit=dev --audit-level=high` | SATISFIED | `ci.yml:140-164`; hosted audit job passed |
| QR-02 | 13-01-PLAN.md | Dependabot covers `github-actions` and `npm` at root and `site/` | SATISFIED (configuration); OPEN for live behaviour and the security-update setting (owner will close) | `.github/dependabot.yml`; human item 3 |
| QR-03 | 13-01-PLAN.md | `pack-smoke` covers the four files, and the release and Finish paths smoke the tarball after the version sync | SATISFIED | Truths 2 and 6 |
| QR-04 | 13-01-PLAN.md | Per-directory floor ratchet fails CI below floor | SATISFIED | Truth 3. Below-floor failure observed on the Node 22.x Coverage floors step (run `43393671617`, orchestrator-supplied; branch deleted). Committed floors on main pass |
| QR-05 | 13-01-PLAN.md | Fixed timeouts replaced by seams and the shared helper; suite passes CPU-limited | UNCERTAIN | Truth 4. Quota run at this revision exited 0 (cgroup, not container; 38 unattributed skips); behavior item |
| QR-06 | 13-01-PLAN.md | Dead exports removed by reference analysis; frozen catalogue unchanged | SATISFIED (gate evidence); inventory paths for the two extra test-only entries and the self-only entry are a human item | Truth 3. Gate: 0 failing src exports, 164 documented seams, 0 stale. `readTailHead` no longer exported (`src/audit/chain.ts:192`) |
| QR-07 | 13-01-PLAN.md | fast-check dev dependency, properties in `npm test`, a broken canonicalizer fails | SATISFIED (code and CI); PR-body items OPEN (owner will close) | Truth 5; human item 6 |
| QR-08 | 13-01-PLAN.md | Scheduled non-blocking mutation run over `src/fs`, `src/core/policy.ts`, `src/audit/redact.ts` | SATISFIED (run evidenced by orchestrator); workflow review is a human item | Truth 5; run `43387372658` |

### Anti-Patterns Found

None. The debt-marker scan found no `TBD`, `FIXME` or `XXX` in covered files. No skip marker was found in the five test and helper files listed under Method.

### Human Verification Required

1. **Workflow review and D6 citations.** Review `ci.yml:403-408` (commit `75631f4`), `ci.yml:463-469`, `mutation.yml` (commit `9e2142f`) and `dependabot.yml` against D6 and AGENTS.md. Confirm each pull request body cites D6.
2. **Finish-path execution.** Inspect a GitHub Finish or repair run. The `Build milestone files` step should log `pack-smoke` with `--expect-version` for the tag, and it should pass before any publish step runs (`REQUIREMENTS.md:179`).
3. **Dependabot live behaviour (QR-02, OPEN).** Confirm in GitHub that version updates are active for the three targets, and record the owner's security-update setting. The owner will close this item; it stays open in this file.
4. **CPU-quota run (QR-05).** Run `npm test` at the current revision under a one-CPU quota, in a container if QR-05 is read literally. Attribute the 38 skipped tests to existing skip reasons, and record the log digest and host load.
5. **Export inventory paths (QR-06).** Run `node scripts/check/export-usage.mjs --list` on the current tree and record the file path of the self-only entry and of the two test-only entries outside the gate's count. Confirm each sits outside `src/`, that nothing in `src/core/errors.ts`, `src/contract/` or `src/core/ports*` changed, and that no src export is used only inside its own file.
6. **PR-body items (QR-07, OPEN).** Confirm the fast-check pull request body carries the justification, licence check and maintenance check from `CONTRIBUTING.md`. The owner will close this item; it stays open in this file.

### Gaps Summary

No blocker remains, and no truth is FAILED. QR-04 is now closed on the observed red run: the Node 22.x Coverage floors step failed below a raised floor, and committed floors on main pass. Status is `human_needed` because these items stay open and need evidence that only a human or a hosted run can supply:

- the container form and skip attribution for the quota run (QR-05, truth 4);
- the `--list` paths behind the export inventory (QR-06);
- the live Dependabot behaviour and security-update setting (QR-02, owner will close);
- the D6 workflow review and a hosted Finish or repair run (REQUIREMENTS.md:179);
- the QR-07 pull request body items (owner will close).

---

_Verified: 2026-11-13T08:44:55Z_
_Verifier: Claude (gsd-verifier)_
