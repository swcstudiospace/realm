# Phase 13 verification: quality ratchet

Date: 2026-11-02. Tree: `gsd/v3-lane-a` at `7c044b6` (commits `e8e0eeb`, `f3e76ee`, `7c044b6` on top of `a47016f`). Host: 8 CPUs, load 12 to 40 during runs; Node v24.18.0; Podman 5.7.1; omp not probed (see the omp note below). Source of acceptance: `13-CONTEXT.md` acceptance items 1 to 5 and `.planning/REQUIREMENTS.md` QR-01 to QR-08.

**Status: gaps_found.** Local evidence closes the code-side of QR-01, QR-02, QR-03, QR-05, QR-06 and QR-07. QR-04 needs a CI floor run. QR-08 is HELD-OWNER. Nothing here is CI evidence; CI has not run on this lane.

## Gate runs

- Final gate run: `/tmp/lane-a-p13-final.log` (outside the repo), heavy slot 1, after all three commits. Exit codes: typecheck 0, lint 0, build 0, test 0, test:integration 0, test:scripts 0, check:docs 0, check:gates 0, check:pack 0, check:mcp 0, test:coverage 0. Counts are in `13-SUMMARY.md`.
- Earlier run on `e8e0eeb` (before the fixes): same set, `test:coverage` exit 1 on OBS-04 "a new start that overtakes" (timing race). Fixed in `f3e76ee`. This is the only red gate observed.
- CPU-limited: `taskset -c 0 npm test` exit 0 (2537 tests, 2504 pass, 0 fail, 33 skipped, 506.7 s). Affinity to one CPU, not a Podman CPU-quota container.

## Requirements

### QR-01: `ci.yml` runs `npm audit --omit=dev --audit-level=high`: local evidence, CI UNVERIFIED
- `.github/workflows/ci.yml` lines 140 to 162: job `audit` runs `npm audit --omit=dev --audit-level=high` on Node 24.x; `release.needs` includes `audit` (line 165).
- Local run on this lane, 2026-11-02: `npm audit --omit=dev --audit-level=high` exit 0, `found 0 vulnerabilities`.
- UNVERIFIED: an actual CI run of the job. D-1301 blocking-on-release is configuration only here.

### QR-02: `.github/dependabot.yml` covers the three targets: DONE (configuration)
- File content: `github-actions` at `/`; `npm` at `/`; `npm` at `/site`; weekly; `ci` and `build` prefixes; grouped updates; `@types/node` semver-major ignored.
- UNVERIFIED: Dependabot's live behaviour and the owner's security-update setting (TD-10, owner's).

### QR-03: `pack-smoke` includes the four adapter files and the release reruns `check:pack`: DONE locally
- `scripts/check/pack-smoke.mjs` lists the four files (lines 35 to 39) and walks `adapters/` and `licenses/`; `--tarball` and `--expect-version` parse (lines 84 to 96).
- Real-tarball negatives, by name, run in this lane (`node --test --test-name-pattern="real tarball that omits" scripts/check/pack-smoke.test.mjs`): `omits adapters/hermes-agent/mcp.snippet.yaml`, `omits adapters/muse-code/mcp-settings.snippet.json`, `omits adapters/prime-agent/MCP.md`, `omits adapters/prime-agent/skills/realm/SKILL.md`. All four pass (4 pass, 0 fail, 41.0 s). Each packs a fixture missing one file and expects exit 1 naming it. Commit `e8e0eeb` (cherry-pick of PR #47 `9a2a25b`).
- Positive: `npm run check:pack` exit 0.
- Release job: `ci.yml` line 391 runs `pack-smoke.mjs --tarball ... --expect-version ...` after the version sync.
- UNVERIFIED: the Finish/repair path in CI. PR #40 (`ci/release-build-publish-split`) carries the release smoke in its build job; see phase 20.

### QR-04: coverage output and a per-directory floor ratchet: PARTIAL, HELD on CI provenance
- `npm run test:coverage` exit 0. Re-evaluating the saved lcov (`node scripts/check/coverage.mjs --lcov coverage/lcov.info`, exit 0): every metric at or above its floor, every source loaded. Per directory, actual vs floor: `src/fs` lines 92.54/91, branches 88.82/87, functions 100/99; `src/core` lines 98.82/97, branches 96.06/95, functions 97.37/96; `src/tools` lines 97.36/96, branches 93.33/92, functions 100/99.
- Provenance gap: each floor equals floor(measured) minus tolerance 1 on this host (Node 24.18), not on the gate leg (22.x) in CI. D-1304 requires the floors to come from a CI run. `reportOnly` is `false` in `scripts/check/coverage-floors.json`.
- Not shown: a CI run of both legs, and a gate run red against a raised floor. Both are required before the floor claim is closed.
- Owner/CI action: one CI run on 22.x and one on 24.x, then set floors and show a red run against a raised floor.

### QR-05: fixed-timeout tests use injected clocks, hold gates or the scaled helper; suite passes CPU-limited: DONE locally, container quota UNVERIFIED
- Helper and seams on HEAD: `test/support/timing.ts` (`TIMEOUT_SCALE`, `scaledMs`, `testTimeout`, `boundedWait`, `pollUntil`, `ManualClock`), `test/support/timing.test.ts`, the `now` option in `src/runtime/libpod-client.ts`, the hold gate in `test/support/fake-execution.ts`.
- Fix in this lane, `f3e76ee`: `test/runtime/agentos-supervisor.test.ts` OBS-04 overtake tests hold call deadlines and the new-start test fires the held deadline after the overtaking start. Before the fix, the test failed under the coverage run's load: the pending check rejected with a RealmError ("the OpenShell gateway, or the compute driver behind it, did not answer") where the test expects `false`. After the fix the two overtake tests pass (2 of 2) and the full gate set is green.
- CPU-limited: `taskset -c 0 npm test` exit 0 (2537 tests, 2504 pass, 0 fail, 33 skipped), start load 35.4. This is one-CPU affinity on a shared host.
- UNVERIFIED: the requirement's "CPU-limited container" wording. No Podman container with a CPU quota was run.

### QR-06: dead exports removed by reference analysis; frozen catalogue unchanged: DONE locally
- `node scripts/check/export-usage.mjs --list` before the change reported one `self-only` export, `readTailHead` (`src/audit/chain.ts:185`). It loses `export` in `7c044b6`. After the change the listing reports zero `self-only` in every directory (`/tmp/lane-a-exports-after.txt`).
- `test-only` seams are kept per D-1306 (the listing's `test-only` column; the counts are in the listing, not re-counted here).
- `npm run typecheck` (noUnusedLocals in tsconfig) exit 0 after the change.
- Frozen catalogue, `ports` types, schema validator types: not edited (`git show --stat 7c044b6`: one file, `src/audit/chain.ts`).
- Requirement wording: QR-06 says "found with the coverage output" in the requirement text. D-1306 amends it to "found by reference analysis". The wording change belongs in REQUIREMENTS.md and ROADMAP.md, which are integrated by the main agent (see the delta in the yield).

### QR-07: `fast-check` dev dependency; properties in `npm test`; a broken canonicalizer fails one: DONE locally, CONTRIBUTING items UNVERIFIED
- `package.json` devDependency `fast-check` 4.10.2 (exact). Properties in `test/fs/canonicalize.property.test.ts` and `test/core/policy.property.test.ts`, run by `npm test` (`dist/test/**/*.test.js`).
- Deliberate breakage, run in this lane and reverted: `src/fs/root.ts` `isInsideRoot` line 92 changed from `return rel.split(sep)[0] !== "..";` to `return true;`. `npx tsc` then `node --test dist/test/fs/canonicalize.property.test.js`: 5 of 11 fail, 6 pass, exit 1 (`/tmp/lane-a-break2.txt`). Failing: no accepted path escapes the root; canonicalize agrees with realpath; absent result names a real directory; a final-segment link refused in write mode; isInsideRoot true inside and false outside. The tsc output also shows `TS6133 'sep' is declared but its value is never read`, expected from the breakage. Restored byte-for-byte: `git status` shows no change to `src/fs/root.ts`.
- A first breakage attempt, `isAbsolute(rel)` returning `true`, did not fail any property (11 of 11 pass, `/tmp/lane-a-break.txt`). On POSIX `relative()` never returns an absolute path, so that branch is unreachable there. It is recorded here so the reader knows which breakage counts.
- UNVERIFIED: the three `CONTRIBUTING.md` items (justification, licence check, maintenance check) for `fast-check` must appear in the PR body. No PR body exists in this lane.
- Finding (not a defect here): the NUL-after-missing-segment question from D-1307 was not decided in this lane; decide in the PR body.

### QR-08: scheduled, non-blocking mutation run covering `src/fs`, `src/core/policy.ts`, `src/audit/redact.ts`: HELD-OWNER
- `.github/workflows/mutation.yml` exists: weekly schedule plus `workflow_dispatch`, `permissions: contents: read` at top level, job `actions: write` (line 25 region). The steps use `continue-on-error: true` and upload the report as an artifact. `scripts/mutation/run.mjs` and `run.test.mjs` exist.
- HELD-OWNER: the D-1308 permission choice. `actions: write` is still granted. PR #47 commit `33dd980` drops it; it is not taken here because the choice belongs to the owner.
- UNVERIFIED: a `workflow_dispatch` run and the artifact. Coverage of the three named paths by `run.mjs` was not checked in this lane.
- `actionlint` on `mutation.yml` with a temporary config declaring the `omega-ci` label: clean.

## Lint of workflows

`actionlint` (1.7.7) on `ci.yml`, `mutation.yml`, `pages.yml`, with `/tmp/lane-a-actionlint.yaml` declaring the self-hosted label `omega-ci`: one finding, `ci.yml:274` SC2016 (info). It is a false positive: the single-quoted block is a `node -e` script with JS template literals on purpose. The bare run without the config reports the unknown-label error only.

## omp version

`omp --version` was blocked by the shell guard (`BLOCKED needs: human-approval (mcp: nested-agent)`), so no omp version was observed in this lane. The lead's stated version is 18.15.0. UNVERIFIED here.

## UNVERIFIED items

- CI runs of the audit job, the coverage report, and the release `check:pack` step on GitHub.
- CI floor provenance for QR-04 and the red-against-raised-floor demonstration.
- A CPU-quota container run for QR-05 (one-CPU affinity was run instead).
- CONTRIBUTING.md items for `fast-check` in the PR body (QR-07).
- The mutation workflow's `workflow_dispatch` run and artifact (QR-08).
- omp version (see above).
