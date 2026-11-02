# Phase 13 summary: quality ratchet

Date: 2026-11-02. Lane: `gsd/v3-lane-a` (worktree `agent-realm-lanes/v3-lane-a`), based on `gsd/v3-autonomous` at `a47016f`. Source of acceptance: `13-CONTEXT.md` (D-1301 to D-1308) and `.planning/REQUIREMENTS.md` QR-01 to QR-08.

**Status: partially complete.** QR-01, QR-02, QR-03, QR-05, QR-06 and QR-07 have local evidence. QR-04 is held on a CI floor provenance step. QR-08 is HELD-OWNER (D-1308 permission choice). Items the host cannot show are listed as UNVERIFIED in `13-VERIFICATION.md`.

## What this phase changed on the lane

| Commit | Requirement | Change |
|---|---|---|
| `e8e0eeb` | QR-03 | Cherry-picked from PR #47 (`9a2a25b`): four real-tarball negatives in `scripts/check/pack-smoke.test.mjs`, one per host snippet or prime-agent guide the tarball must carry. |
| `f3e76ee` | QR-05 | `test/runtime/agentos-supervisor.test.ts`: the two OBS-04 overtake tests hold call deadlines (`holdDeadlines`). The new-start test fires the held deadline after the overtaking start with `t.mock.timers.tick(CALL_TIMEOUT_MS)`. This fixed a failure in the `test:coverage` run where the 50 ms real deadline beat the overtake under load. |
| `7c044b6` | QR-06 | `src/audit/chain.ts`: `readTailHead` loses `export`. Reference analysis found it used only in its own file (D-1306). |

Not taken on purpose: PR #47 commit `33dd980` (drops `actions: write` from `mutation.yml`). It is the QR-08 permission choice, which is an owner decision (D-1308).

Work already present on HEAD and verified here, not re-authored: the `audit` job and `release.needs` in `ci.yml`, `.github/dependabot.yml` (three targets), `pack-smoke` walk check and `--tarball`/`--expect-version`, `scripts/check/coverage.mjs` and `coverage-floors.json`, `test/support/timing.ts`, `scripts/check/export-usage.mjs`, `test/support/property.ts`, `test/fs/canonicalize.property.test.ts`, `test/core/policy.property.test.ts`, and `.github/workflows/mutation.yml`.

## Gates

Run once on the final phase 13 tree (`e8e0eeb` plus the two source commits; the tree was clean after commit) under heavy slot 1. Exit codes from the gate runner's log (kept out of the repository):

| Gate | Exit | Counts |
|---|---|---|
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm run build` | 0 | |
| `npm test` | 0 | 2537 tests, 2504 pass, 0 fail, 33 skipped |
| `npm run test:integration` | 0 | 202 tests, 171 pass, 0 fail, 31 skipped (Podman skips with stated reasons) |
| `npm run test:scripts` | 0 | 286 tests, 286 pass, 0 fail |
| `npm run check:docs` | 0 | |
| `npm run check:gates` | 0 | |
| `npm run check:pack` | 0 | positive tarball |
| `npm run check:mcp` | 0 | |
| `npm run test:coverage` | 0 | 2537 tests, 2504 pass, 0 fail; floors enforced, all ok (see QR-04) |

Before the fixes above, the first gate run had one red gate: `test:coverage` exited 1 on OBS-04 "a new start that overtakes" (the timing race fixed in `f3e76ee`). The run on the fixed tree above is green for every gate, including `test:scripts`.

CPU-limited run for QR-05, pinned with `taskset -c 0` (one CPU), start load 35.4: `npm test` exit 0, 2537 tests, 2504 pass, 0 fail, 33 skipped, 506.7 s. This is CPU affinity on the shared host, not a Podman CPU-quota container.

## Owner items (not done here)

- **QR-08 HELD-OWNER.** `mutation.yml` still grants `actions: write` (D-1308 permission choice, owner). The run artifact and a `workflow_dispatch` run are not recorded.
- **QR-04 floor provenance.** Floors in `coverage-floors.json` equal floor(measured) minus 1 on this host (Node 24.18), not on the gate leg (22.x) in CI. A CI run is needed before the floors are accepted, and a red run against a raised floor has not been shown.
- **PR #47** (`feat/v3-qr-release`, draft) is not merged or marked ready. Its QR-03 test commit is on the lane; the rest of the PR is the owner's call.
- No `ROADMAP.md` or `STATE.md` edits in this lane (see the delta in the yield).

## Omp version

`omp --version` was blocked by the shell guard (`BLOCKED needs: human-approval (mcp: nested-agent)`). The version of record is the lead's stated 18.15.0, not observed in this lane. UNVERIFIED here.
