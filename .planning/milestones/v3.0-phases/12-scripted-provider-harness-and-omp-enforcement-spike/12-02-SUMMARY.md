# Phase 12 Plan 02: Unreadable advisory status refuses guarded calls (CR-01) Summary

**Closes the code side of verification gap 1 (CR-01): under advisory, a host `edit` and a Realm `write` are refused when the realm status cannot be read. HARN-02 and OMP-05 are NOT closed by this plan; the live half stays with plan 12-03.**

## Frontmatter

```yaml
phase: 12-scripted-provider-harness-and-omp-enforcement-spike
plan: 02
status: complete
requirements: [HARN-02, OMP-05]   # code side only; not closed here
commits: 3                         # MEASURED: git rev-list --count 9181e80..HEAD
plan_head_before: 9181e808f7f4a70ad783d79adb942eb0e5023516
plan_head_after: 82d86545af8000cf841f0b1fa13470fda6ab48f1
actuals:
  tasks: 3
  commits: 3
files_modified:
  - src/omp/plugin.ts
  - test/omp/plugin.test.ts
  - docs/integration/omp.md
  - docs/integration/omp-lifecycle-runbook.md
  - docs/policy-reference.md
```

## Commits

| Task | Type | Commit | Subject |
|------|------|--------|---------|
| 1 (RED) | test | 19c86b1 | test(omp): pin the owner ruling on an unreadable advisory status |
| 2 (GREEN) | fix | 38d5778 | fix(omp): refuse guarded calls when the daemon status cannot be read (CR-01) |
| 3 (docs) | docs | 82d8654 | docs(omp): describe the refusal on an unreadable advisory status |

## What changed

- **Guard (`src/omp/plugin.ts`).** `unreadableVerdict` now takes only the error and returns `{ block: true, reason: <read code> }` in every mode. The "realm status unavailable ... the write proceeds" notice is gone. In the status-failure branch of `guardHostToolCall`, the Realm write is handed to the daemon only when the last published mode is not advisory (fail-closed, or no mode yet). Under advisory it is refused before any daemon call, as is a guarded `edit`. Other host tools keep `POLICY_DENIED`. The reachable-daemon allowance (readable status, advisory, host edit with its warning) is unchanged. `reassertLastMode`, `readStatus`, `setHostMode`, `stateVerdict` and the WR-03 catch blocks are untouched. File length is 876 lines.
- **Tests (`test/omp/plugin.test.ts`).** Six pinned expectations now assert the refusal and no notification: OMP-05 (d) advisory, B9 / T6, P16 (b), P16 (lifecycle c), "failed poll mode changes retain...", and "failed guarded mode changes never paint...". The `publishedModeOf` probe now reads the published mode through the Realm write verdict (`undefined` means fail-closed, a refusal means advisory). Its callers are unchanged.
- **Docs.** `docs/integration/omp.md`: the guarded-call paragraph, manual advisory step 2, and the 2026-10-29/30 observation marked as superseded for its daemon-down assertion. `docs/integration/omp-lifecycle-runbook.md`: manual check row 6. `docs/policy-reference.md`: the advisory paragraph. The guard-suite section and runbook case table were not touched.

## Test results (real output)

- Baseline at HEAD 9181e80 (after `npm ci` and `npm run build`): `dist/test/omp/plugin.test.js` 97 pass, 0 fail.
- RED (tests rewritten, source unchanged): 91 pass, **6 fail**. The six failing tests are exactly the six named in the plan. Each fails on `actual undefined` where the TOOL_TIMEOUT refusal was expected, which is the advisory allowance the ruling removes.
- GREEN (after the guard change): 97 pass, **0 fail**.
- Full `npm test`: exit 0. `tests 3018, pass 2980, fail 0, skipped 38, cancelled 0`. The skips are the live Omp suites, which name `REALM_LIVE_OMP=1 is not set` as their reason.

## Gates (real output)

| Gate | Result |
|------|--------|
| `npm run typecheck` | exit 0 (`tsc -p tsconfig.json --noEmit`, no output) |
| `npm run lint` | exit 0 (`eslint .`, no output) |
| `npm run build` | exit 0 |
| `node --test dist/test/omp/plugin.test.js` | 97 pass, 0 fail |
| `npm run check:docs` | exit 0: `host paths: ok`, `agents sync: ok`, `check:default-mode: 28 files scanned, no advisory-default claim` |
| `npm run check:gates` | exit 0: `gate closure: 4 modules, no violations`, `module size: 120 files checked, no violations`, `export-usage gate: 0 failing export(s), 160 allowlisted seam(s), 0 stale allowlist entries` |
| `! grep -q "status unavailable" src/omp/plugin.ts` | exit 0 (the notice text is gone) |

`check:docs` passed in this worktree without editing `12-VERIFICATION.md`. The host-path line it held was already redacted at HEAD (`571d474`).

## Deviations from Plan

**1. [Precondition] Dependencies installed before Task 1.** `node_modules` was absent and `fast-check` was missing, so the build could not start. Ran `npm ci` from `package-lock.json`. No tracked file changed.

**2. [Docs wording, runbook row 6] Adapted the expected result.** The plan says to keep the "file exists" wording and to describe "the existing file keeping its previous bytes". Row 6 is a new-file write (`guard-advisory.txt`), so "the file exists" and "existing file" cannot both hold after a refusal. I wrote the row with two cases. If the status cannot be read, the write is refused with the read's code, no notice appears, and the file does not exist. If a daemon answers in a non-active state, the reachable-daemon allowance applies and the file exists. The row number is kept.

**3. [Docs wording, omp.md] Historical marker date.** The plan prefixes the paragraph with "2026-10-30". The section heading says 2026-10-29. I used the plan's text verbatim, so the dates disagree. Left as written for the owner to decide.

**4. [Not run] State and roadmap updates.** The executor's state-update step (`state advance-plan`, `roadmap update-plan-progress`, `requirements mark-complete`) was not run. The plan says not to edit `REQUIREMENTS.md`, `ROADMAP.md` or `STATE.md`, and the orchestrator asked for no `.planning` commits beyond this SUMMARY. Plan progress for phase 12 needs an orchestrator-level update.

**5. [Out of scope, flagged] Pre-existing inconsistency in `docs/integration/omp.md`, manual advisory step 2, first half.** Step 2 says the Realm write with the daemon reachable and the realm inactive is refused with `REALM_NOT_ACTIVE`. `docs/integration/omp.md` (the Advisory mode paragraph) and `docs/policy-reference.md` say advisory forwards that write with a warning when the daemon is reachable. I did not change it, because it is not part of the CR-01 change.

## Residual risk (from the plan's threat register, T-12-04)

An unreadable status includes a read that times out at the 5 s guard budget. Under advisory, a slow but live daemon is therefore over-refused. This follows the owner's ruling literally. The owner should confirm this reading, as the plan requires.

## Not closed by this plan

HARN-02 and OMP-05 remain open. The live guard suite (`test/integration/omp-guard.test.ts`, C1 to C4 and HARN-03) has not been run, and plan 12-03 owns it.

## Self-Check

- Created file exists: `.planning/phases/12-scripted-provider-harness-and-omp-enforcement-spike/12-02-SUMMARY.md` (this file).
- Commits 19c86b1, 38d5778 and 82d8654 are ancestors of HEAD (checked with `git merge-base --is-ancestor` before this file was committed).
- Source assertion: `grep -c "status unavailable" src/omp/plugin.ts` returns no matches.

## Self-Check: PASSED
