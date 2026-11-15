---
phase: 13
plan: 01
subsystem: quality-ratchet
tags: [ci, dependabot, pack-smoke, coverage, timing, export-usage, property-tests, mutation]
requires: []
provides:
  - "QR-01 to QR-08 code and CI config on origin/main a796b34, cited by file:line in the task table below"
  - "Recorded evidence: mutation run 43387372658 (success); QR-05 one-CPU rootless Podman container run (exit 0)"
affects: [.github/workflows/ci.yml, .github/dependabot.yml, .github/workflows/mutation.yml, scripts/check, test/support, package.json]
key-files:
  created: []
  modified:
    - .planning/phases/13-quality-ratchet/13-01-SUMMARY.md
decisions:
  - "Owner accepted two open owner items as known gaps on 2026-11-15 (Dependabot live setting; fast-check PR-body justifications). They are NOT VERIFIED here and do not block completion under that decision."
  - "The QR-05 container run is recorded against revision 1ddfc45; this summary does not establish that it equals origin/main a796b34."
requirements: [QR-01, QR-02, QR-03, QR-04, QR-05, QR-06, QR-07, QR-08]
metrics:
  tasks: 4
  commits: 0
  completed: 2026-11-15
status: complete-with-known-gaps
---

# Phase 13 Plan 01: quality ratchet (QR-01 to QR-08) Summary

Every plan task is present on `origin/main` (a796b34) as code or CI configuration. Two owner items are NOT VERIFIED and carried as KNOWN GAP under the owner's 2026-11-15 acceptance. The mutation run and the QR-05 container run are cited from their records below; nothing here re-runs them.

## Owner items: NOT VERIFIED, KNOWN GAP (accepted by the owner 2026-11-15)

| Item | Requirement | Status | Why it is not verifiable here |
|---|---|---|---|
| Dependabot live setting: version updates active for `github-actions` (root), `npm` (root) and `npm` (`/site`) in the GitHub Dependabot tab, and the owner's security-update setting | QR-02 | NOT VERIFIED; KNOWN GAP; accepted 2026-11-15; does not block completion under that decision | Repository settings and live Dependabot behaviour are not in the repository. The configuration file is verified (task A2 below). |
| fast-check PR-body justifications: justification, licence check and maintenance check from `CONTRIBUTING.md` for `fast-check@4.10.2` | QR-07 | NOT VERIFIED; KNOWN GAP; accepted 2026-11-15; does not block completion under that decision | Pull request bodies are not repository files. The dependency pin is verified (task C1 below). |

Other items the earlier verifier listed as human checks are not covered by the owner decision above. This summary does not claim them closed:
- D6 review of the workflow changes and D6 citations in each pull request body (`ci.yml:403-408`, `ci.yml:463-469`, `mutation.yml`, `dependabot.yml`).
- A hosted GitHub Finish or repair run that reaches `Build milestone files` (`REQUIREMENTS.md:179` records this as open).
- The `node scripts/check/export-usage.mjs --list` file paths for the two test-only entries outside the gate's count and the one self-only entry (QR-06).
- Attribution of the 40 skipped tests in the QR-05 container run (the summary file does not attribute them).

## Plan tasks: code on origin/main

Line numbers are from `origin/main` a796b34. The plan's pull-request split (PR-A, PR-B-time, PR-B-coverage, PR-B-floors, PR-B-exports, PR-C-props, PR-C-mutation) is not reproduced; this table maps each unit to its code on main.

| Unit | Requirement | Code on main | Notes |
|---|---|---|---|
| A1 | QR-03 | `scripts/check/pack-smoke.mjs:29-39` (`ADAPTER_FILES`: manifests, MCP entries, snippets and guides for claude-plugin, muse-code, hermes-agent, prime-agent); `:84-96` (`--tarball`, `--expect-version` parsing); `:124` (`missingWalkedFiles`, walks `adapters/` and `licenses/`); `:253` (walk check invoked); `:294` (`runCheck`). Tests: `scripts/check/pack-smoke.test.mjs`. | The tarball and version flags are present. No local `pack-smoke --tarball` run is recorded in this summary. |
| A2 | QR-02 | `.github/dependabot.yml:6` (`github-actions`, `/`), `:15` (`npm`, `/`), `:29` (`npm`, `/site`). Header at `:1-3` cites D6 and states that security updates are an owner setting. | Configuration only; live behaviour is the NOT VERIFIED item above. |
| A3 | QR-01, QR-03 | `.github/workflows/ci.yml:139` (`audit` job), `:160` (`npm audit --omit=dev --audit-level=high`); `:164` (`build` has `needs: [verify, site, audit]`); `:383-407` (`Build milestone files`, `runCheck(["--tarball", tarball, "--expect-version", version])` at `:407`); `:463-469` (`Smoke the release tarball`, `pack-smoke.mjs --tarball … --expect-version …` at `:469`). | Plan items `AGENTS.md`, `CONTRIBUTING.md` and the PR template were not re-read here. |
| B1 | QR-05 | `test/support/timing.ts:111` (`ManualClock`); `src/runtime/libpod-client.ts:74-75` (`now` option), `:173` (default `performance.now()`); `test/support/fake-execution.ts:114` (`holdNext`), `:127` (`settled`). | |
| B2 | QR-05 | `test/runtime/libpod-client.test.ts:356-357` injects `ManualClock` through `now`. | |
| B4, B5, B6 | QR-05 | `test/runtime/agentos-supervisor.test.ts:644` (`holdDeadlines`), used at `:652` and `:661`. The fixed `{ timeout: 10_000 }` caps under `test/acp` are absent (zero found by the earlier verifier, re-checked on that tree). | B3 (`test/lifecycle/idempotent.test.ts`) and the remaining test files were not individually re-read here. |
| B7, B8 | QR-04 | `scripts/check/coverage.mjs` (floor comparison per directory; `:544` count line; `:550` `coverage: FAILED` line); `scripts/check/coverage-floors.json` (`gateNode: 22.x`, `reportOnly: false`, `src/fs` 91/87/99, `src/core` 97/95/96, `src/tools` 96/92/99); `package.json:57` (`test:coverage`); `ci.yml:69-73` (`Coverage floors`, `npm run test:coverage`). | The below-floor red run is in the QR-04 record below. |
| B9 | QR-06 | `scripts/check/export-usage.mjs`, `scripts/check/export-usage.test.mjs`, `scripts/check/export-usage-gate.mjs`, `scripts/check/export-usage-gate.test.mjs`; `scripts/check/export-usage-allowlist.json` (164 entries with the reason field); `src/audit/chain.ts:192` (`readTailHead` is not exported). | The `--list` paths are the NOT VERIFIED item above. |
| C1 | QR-07 | `package.json:74` (`"fast-check": "4.10.2"`, exact pin); `package.json:55` (`npm test` runs `dist/test/**/*.test.js`); `test/support/property.ts:33` (`assertProperty`). | The PR-body items are the NOT VERIFIED item above. |
| C2 | QR-07 | `test/fs/canonicalize.property.test.ts` (20 `fc.property` or `assertProperty` uses across the file). | |
| C3 | QR-07 | `test/core/policy.property.test.ts:135` (round trip), `:144` (subarray and key order), `:157` (unknown top-level key). | |
| C4 | QR-08 | `.github/workflows/mutation.yml:8` (`schedule`), `:10` (`workflow_dispatch`), `:12-13` (top-level `permissions: contents: read`), `:22-23` (job `contents: read`), `:42` and `:49` (`continue-on-error: true`); runs `scripts/mutation/run.mjs` (`scripts/mutation/run.test.mjs` present). | `actions: write` is absent on main. Commit `9e2142f` is an ancestor of `origin/main`. |

Commit `75631f4` (`fix(release): smoke-check repair tarball before handoff`) is an ancestor of `origin/main`, and it is the commit that introduced the Finish smoke at `ci.yml:403-408`.

## Recorded evidence (cited as recorded; not re-run here)

- **Mutation:** run `43387372658`, conclusion success.
- **QR-05 container run:** `<home>/realm-evidence/phase13/qr05-summary.md` records a rootless Podman 5.7.1 container with `--cpus=1` (`NanoCpus=1000000000 CpuQuota=100000 CpuPeriod=100000`), image `node:24-bookworm-slim`, command `npm ci --ignore-scripts && npm run build && node --test --test-concurrency=1 --test-reporter=tap 'dist/test/**/*.test.js'`. Exit code 0. TAP: 3064 tests, 3024 pass, 0 fail, 40 skipped, 0 cancelled, 0 todo. The file records the revision as `origin/main` = `1ddfc45`, not a796b34. The combined output is at `<home>/realm-evidence/phase13/qr05-tap.txt`.
- **QR-04 below-floor run:** run `43393671617` (Node 22.x `Coverage floors` step, `coverage: FAILED (7 metric(s) below a floor …)`, exit 1), as recorded in `13-VERIFICATION.md`. The branch was closed and deleted, so the run was not re-inspected here.
- **Hosted CI on the PR 59 head:** Dependency audit, Build docs site, Verify on Node 22.x and 24.x passed, as recorded in `13-VERIFICATION.md`.

The earlier cgroup quota run (`systemd-run --scope -p CPUQuota=100%`, 3047 tests, 38 skipped) recorded in `13-VERIFICATION.md` is a different run and a different form; it is not the basis for the QR-05 entry above.

## Verification in this summary

Read-only. File reads and greps on a worktree at `origin/main` a796b34, and a read of the QR-05 summary file. No tests, builds, lint, typecheck, formatters or gates were run. No file other than this summary was changed.

## Deviations

- The earlier `13-SUMMARY.md` (2026-11-02) is stale: its statements that `mutation.yml` still grants `actions: write` and that the QR-04 floors are a host-only provenance are superseded by the tree and by the CI records above. It was not edited.
- The `REQUIREMENTS.md` status column was not edited.
