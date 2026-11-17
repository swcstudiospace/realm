---
phase: 13-quality-ratchet
verified: 2026-11-15
verdict: passed
status: passed
ref: origin/main a796b34 (branch gsd/phase-13-verify)
supersedes: 13-VERIFICATION.md dated 2026-11-13 (status human_needed)
---

# Phase 13: Quality ratchet: Verification at a796b34

**Goal:** Regressions in dependencies, coverage, packaging and the security-relevant path and policy logic fail in CI or in a scheduled run before they ship, and the test suite no longer fails under load.

**verdict: passed.** Every roadmap success criterion (ROADMAP.md:388-392) has evidence on `origin/main` a796b34, except the two items the owner accepted as known gaps on 2026-11-15: the Dependabot live setting and the fast-check PR-body justifications. Both are recorded under Residuals as accepted gaps, not failures.

**Method.** Worktree `<tmp>` created from `origin/main` a796b34. Static reads, greps and line references on that tree. Read-only GitHub CLI queries (`gh run view`) for CI and mutation runs. Read-only reads of the QR-05 container evidence under `<home>/realm-evidence/phase13/`. No tests, lint, typecheck, build, formatters or gates were run. Nothing was committed. Only this file was written.

**Commit placement.** Several Phase 13 commits cited below are on `origin/main`. Two are not and are cited only as the source of CI evidence: `b96beb8` (floors raised to 99 on branch `ci/red-floor-demo`) and `9a2a25b` (the lane cherry-pick; its test commit is `e8e0eeb` on main).

## Goal Achievement: Roadmap Success Criteria

Criteria text: `.planning/ROADMAP.md` l.388-392. Requirement IDs: `.planning/REQUIREMENTS.md` l.28-35.

| # | Criterion | Status | Evidence on main (a796b34) |
| --- | --- | --- | --- |
| 1 | `ci.yml` runs `npm audit --omit=dev --audit-level=high`; `.github/dependabot.yml` covers `github-actions` and `npm` for root and `site/` (QR-01, QR-02) | VERIFIED for the audit job and the config. Dependabot live setting: ACCEPTED GAP (Residual 1) | Audit job `.github/workflows/ci.yml:139-160`, command at l.160. `build` depends on it at l.164 (`needs: [verify, site, audit]`). Observed: job "Dependency audit" succeeded in CI run 43393671617 (`gh run view`, job 131779361123). `.github/dependabot.yml`: `github-actions` at `/` (l.6-7), `npm` at `/` (l.15-16), `npm` at `/site` (l.29-30). `site/package.json` exists. |
| 2 | `pack-smoke` fails when a host snippet, or prime-agent `MCP.md` or `SKILL.md`, is missing from the tarball; the release job reruns `check:pack` on the release tarball after the version sync (QR-03) | VERIFIED | `scripts/check/pack-smoke.mjs` `ADAPTER_FILES` l.29-40 lists the four host snippets (l.33, l.36 and the Hermes/Muse entries), `adapters/prime-agent/MCP.md` (l.38) and `SKILL.md` (l.39). Check throws on a missing file at l.250-251; walk check at l.253. Real-tarball negatives: `scripts/check/pack-smoke.test.mjs:409` (Hermes `mcp.snippet.yaml`), `:415` (Muse snippet), `:421` (`MCP.md`), `:427` (`SKILL.md`), each packs a fixture with `npm pack` and expects status 1. Release job (`build`, `ci.yml:164-166`): `Sync package version` (l.432-438), `Build and pack tarball` (l.454-457), `Smoke the release tarball` (l.463-469) runs `pack-smoke.mjs --tarball … --expect-version`. Finish path: `ci.yml:403-408` runs the same check on the tagged tree before publish. Workflow change commit `75631f4` is on main. |
| 3 | `npm run test:coverage` prints the Node coverage output; CI fails below the recorded floor for `src/fs`, `src/core`, `src/tools`, shown by a run against a lowered coverage; dead exports removed; frozen error catalogue unchanged (QR-04, QR-06) | VERIFIED. Wording note: the red run raised the floors above measured coverage, which is the same comparison (Residual 6) | `package.json:57` `test:coverage` = `tsc && node scripts/check/coverage.mjs`. Table printed on CI: "Coverage floors" step, run 43393671617 job 131779361447. Floor comparison `scripts/check/coverage.mjs:203-223` (status `below`), failure counts at l.542-544. Committed floors `scripts/check/coverage-floors.json`: `gateNode` 22.x, `reportOnly` false, `src/fs` 91/87/99, `src/core` 97/95/96, `src/tools` 96/92/99 (lines/branches/functions). Gate leg only: `ci.yml:67-73` (`if: matrix.node-version == '22.x'`). Red demonstration: CI #63, run 43393671617 on `ci/red-floor-demo` (floors raised to 99, commit `b96beb8`): step "Coverage floors" exit 1, "coverage: FAILED (7 metric(s) below a floor …)". Measured values on that run (Node 22.23.4) clear every committed floor: fs 92.16/88.36/100, core 98.92/96.40/97.92, tools 96.81/92.79/100. Dead exports: reference-analysis tool `scripts/check/export-usage.mjs`, gate `scripts/check/export-usage-gate.mjs` wired in `check:gates` (`package.json:65`) and run in CI `ci.yml:93`. Self-only `export` keywords dropped on main in `9376984` (#35) and `edb8555` (#16). `readTailHead` is unexported at `src/audit/chain.ts:192` (`7c044b6`). Error catalogue: `git diff a47016f origin/main -- src/core/errors.ts src/contract/validate.ts` (a47016f = Phase 13 base) adds only comment lines (from `7314650`, docs), so `ERROR_CODES` is unchanged by this phase. |
| 4 | Libpod TTL test and idempotent lifecycle test use an injected fake clock; the 21 `{ timeout: 10_000 }` caps under `test/acp` and other fixed waits use the shared scaled-timeout helper in `test/support`; the full suite passes in a CPU-limited container (QR-05) | VERIFIED. Skip attribution: 38 of 40 skips named; 1 skip without reason text (Residual 4) | Injected clock: `src/runtime/libpod-client.ts:75` (`readonly now?`), wired at l.173; `test/runtime/libpod-client.test.ts:355-366` ("info cache: after the TTL …") uses `ManualClock` with `now: clock.now`. Idempotent lifecycle: `test/lifecycle/idempotent.test.ts:51` injects `clock: () => new Date(CLOCK_TIME)`; `performance.now` is fixed at l.96 and l.177. Caps: zero raw `timeout:` literals in `test/acp`; 22 `testTimeout(` uses (`test/acp/agent.test.ts:123`, `:148`, `:176`, …; `test/acp/stdio.test.ts:53`). Helper: `test/support/timing.ts` `scaledMs` l.30, `testTimeout` l.35, `ManualClock` l.111, scale clamped to 1-10 via `REALM_TEST_TIMEOUT_SCALE`. Other fixed waits: one raw `setTimeout` of 100 ms or more outside `test/support` (`test/runtime/session-execution.test.ts:979`), and it is a child-process script body, not a wait. CPU-limited container: `<home>/realm-evidence/phase13/qr05-summary.md` and `qr05-tap.txt`: container exit 0, `NanoCpus=1000000000 CpuQuota=100000 CpuPeriod=100000` (one CPU, rootless Podman 5.7.1, cgroups v2). TAP footer: `# tests 3064`, `# pass 3024`, `# fail 0`, `# skipped 40`, `# cancelled 0`, `# todo 0`. The run was at `1ddfc45`, which includes the timing migration `6784dbb` (Residual 3). |
| 5 | `fast-check` properties for the path canonicalizer and the policy parser run in `npm test`; a deliberately broken canonicalizer fails at least one; a scheduled non-blocking workflow runs mutation testing over `src/fs`, `src/core/policy.ts`, `src/audit/redact.ts` (QR-07, QR-08) | VERIFIED for the properties, the mutation schedule and scope, and the mutation run. PR-body justifications: ACCEPTED GAP (Residual 2) | `fast-check` dev dependency exact-pinned at `package.json:74` (`4.10.2`). `npm test` (`package.json:55`) compiles and runs `dist/test/**/*.test.js`, which includes both property files. Canonicalizer properties `test/fs/canonicalize.property.test.ts`: generators for `..`, `.`, empty, NUL, long, binary segments and `//`, `///` separators (l.80-96); escape check l.141; absolute-path rejection l.152; kernel `realpath` agreement l.158; NUL segment l.183; final-segment link l.251; unicode bytewise l.267. Policy properties `test/core/policy.property.test.ts`: round trip l.133; unknown top-level key rejected, value not echoed l.151; unknown `egressAllow` key l.166. Broken-canonicalizer negative: historical break3/11/restored11/11, accepted in the phase record (`.planning/ROADMAP.md:396`, `.planning/REQUIREMENTS.md:183`); not re-run here. Mutation workflow `.github/workflows/mutation.yml`: `schedule` cron `0 6 * * 1` (l.9) and `workflow_dispatch` (l.10); the run step and the upload step are `continue-on-error: true` (l.42, l.49); permissions `contents: read` only. Target list `scripts/mutation/run.mjs:563-572` (`src/core/policy.ts`, `src/audit/redact.ts`, `src/fs/**`). Run evidence: `gh run view 43387372658` (Mutation #59, `workflow_dispatch`, job "Mutation" success, artifact `mutation-report`, branch `gsd/phase-13-quality-ratchet`). |

**Score:** 5/5 success criteria have evidence. Two accepted known gaps sit inside criteria 1 and 5 (Residuals 1 and 2).

## Artifacts

| Artifact | Criteria | Status |
| --- | --- | --- |
| `.github/workflows/ci.yml` | 1, 2, 3 | VERIFIED (audit l.139-160; floors l.67-73; check:gates l.93; release smoke l.403-408, l.463-469) |
| `.github/dependabot.yml` | 1 | VERIFIED (config). Live setting: accepted gap |
| `.github/workflows/mutation.yml` | 5 | VERIFIED (schedule, non-blocking, read-only permissions) |
| `scripts/check/pack-smoke.mjs`, `pack-smoke.test.mjs` | 2 | VERIFIED |
| `scripts/check/coverage.mjs`, `coverage-floors.json` | 3 | VERIFIED |
| `scripts/check/export-usage.mjs`, `export-usage-gate.mjs`, `export-usage-allowlist.json` | 3 | VERIFIED (wiring and removal commits; current-tree run not repeated, Residual 5) |
| `src/audit/chain.ts` | 3 | VERIFIED (`readTailHead` unexported) |
| `src/core/errors.ts`, `src/contract/validate.ts` | 3 | VERIFIED (comment-only changes since the Phase 13 base) |
| `test/support/timing.ts`, `test/acp/*.test.ts` | 4 | VERIFIED |
| `src/runtime/libpod-client.ts`, `test/runtime/libpod-client.test.ts` | 4 | VERIFIED |
| `test/lifecycle/idempotent.test.ts` | 4 | VERIFIED |
| `test/fs/canonicalize.property.test.ts`, `test/core/policy.property.test.ts` | 5 | VERIFIED (properties present; broken-canonicalizer result historical) |
| `scripts/mutation/run.mjs` | 5 | VERIFIED |
| `package.json` | 1, 3, 5 | VERIFIED (`test:coverage` l.57, `check:gates` l.65, `fast-check` l.74) |

## Residuals (not verdict-blocking)

1. **Accepted known gap: Dependabot live setting (SC1, QR-02).** Dependabot security updates and the live version-update state are repository settings the owner controls. The configuration file is verified above. Accepted by the owner on 2026-11-15 as a known gap; not a failure.
2. **Accepted known gap: fast-check PR-body justifications (SC5, QR-07).** `CONTRIBUTING.md` requires the justification, licence check and maintenance check in the pull request body. They are not repository files and were not inspected. The dependency itself is present and exact-pinned (`package.json:74`). Accepted by the owner on 2026-11-15 as a known gap; not a failure.
3. **Drift since the QR-05 evidence revision.** The container run was at `1ddfc45`. Since then `origin/main` changed 7 files in `src/` and `test/` (`src/daemon/daemon.ts`, `src/daemon/sessions.ts`, `src/session/checkpoint.ts`, `test/daemon/daemon.test.ts`, `test/integration/production-driver.test.ts`, `test/session/checkpoint-symlink.test.ts`, `package.json`). None is in the QR-05 timing or helper paths. The container run was not repeated at a796b34.
4. **One skip without a stated reason.** The 40 skips in `qr05-tap.txt`: 21 `REALM_LIVE_OMP=1`, 14 `REALM_LIVE_PRODUCTION=1`, 3 root-permission skips, 1 Podman-not-found skip, and 1 skip with no reason text (TAP test "an unwritable directory returns false, and writing recovers once it is writable"). No test was removed or skipped to obtain green. The skip reason for the one blank case is not recorded.
5. **Export gate not re-run on the current tree.** The removal and wiring are verified from commits and the gate's CI step (`ci.yml:93`). This verification ran no gate.
6. **Criterion 3 wording.** The roadmap says "a run against a lowered coverage". The red demonstration raised the floors above measured coverage (`b96beb8`, branch `ci/red-floor-demo`). The comparison is the same (measured below floor fails the job).
7. **Hosted runs on this head.** No completed green `verify` run on the `main` head was observed: recent `main` CI runs (43657096128, 43656471257, 43655248193) show `cancelled`, and 43657108017 was pending when checked. The Node 22 floor step was observed failing only on `ci/red-floor-demo`. The Finish or repair run on a real tag and the D6 pull-request citations are human workflow-review items (REQUIREMENTS.md QR-03 and Phase 13 Notes); neither is a roadmap success criterion.

## Verdict

verdict: passed

All five success criteria have evidence on `origin/main` a796b34. The Dependabot live setting and the fast-check PR-body justifications are accepted known gaps (Residuals 1 and 2). Residuals 3 to 7 are recorded for the record and do not change the verdict.
