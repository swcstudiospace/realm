---
phase: 45-omp-responsiveness-valid-measurement
plan: "04"
status: complete
requirements: [OMPV-04, OMPV-05, OMPV-06]
verdict: VOID
reason: "calibration (underivable: 0 of 0 valid controls; three attempts refused V0)"
---

# Plan 45-04 summary: VOID (calibration), verdict window not run

## Verdict

**VOID (calibration).** The calibration actually ran as the realm account
under the shared live lock, with a scrubbed environment and an evidence
directory outside the repository: three scoped no-extension controls ran
(attempts 1 to 3, 2026-11-19T13:37:29 to 13:40:26 UTC, each with the 60 s
settle) and all three were refused by rule V0, "child scope could not be
verified". Zero controls were mechanically complete (target 12, at most 16
attempts), zero passed (5 needed), so `deriveBounds` is underivable and
`test/support/omp-calibration.ts` keeps `CALIBRATED_BOUNDS` and
`CALIBRATION_FREEZE` null. The freeze-before-verdict gate then forbids the
verdict window, so Tasks 5 and 6 were skipped. The paired comparison is VOID
as well (zero valid pairs; the paired rule needs five). Nothing was
relabelled: no number is cited from any earlier phase as this phase's
measurement.

## Why the calibration failed (the one real finding)

The refusal is deterministic and reproducible, and it is a harness defect,
not a host or product result. `verifyScopedChild`
(`test/support/omp-arm-run.ts`, plan 45-03) accepts only a scope leaf named
`run-p<pid>-i<id>.scope`. The transient scope this host's user manager
(systemd 255) creates for the pinned argv is named `run-<32 hex>.scope`
(observed live: `run-r8a83b262795a418cac3c9d99a9904410.scope`; the
feasibility record P3 recorded the same shape). The compiled function fed
the observed cgroup text returns the refusal. The scope itself works: the
smoke of the exact argv passed and Omp started, was probed and was closed
in every attempt. Plan 45-04 forbids editing a harness rule, so the fix is
reported, not made; any repeat of this window needs the fix first. The
supporting numbers (recomputed from the records and CSVs, which agree):
self-inflicted maximum/95th percentile 2493/2493, 4601/4601 and 2590/2590
ms over the three refused runs, with all contention shares null; residue
zero (2 scopes before and after, 0 Omp processes); secret search clean.

## Evidence and labels

Evidence directory: a fresh directory outside the repository, mode 0700,
files 0600, set as `REALM_OMP_EVIDENCE_DIR` (and
`REALM_OMP_RESPONSIVENESS_EVIDENCE_DIR` to the same per-attempt directories;
the harness reads the former), named with the date under the realm account's
`realm-evidence` directory, role `45-cal-20261119`: facts, before/after
snapshots, the driver log, and per attempt the record, samples CSV, readings
CSV, summary, frames, stderr and transcript. The run copy and the temp
directory were removed; the evidence directory stays. Labels: loaded,
scoped; `quietClaim` false; no quiet-host measurement; UI-01 status stays
the owner's call. Full record:
`.planning/phases/45-omp-responsiveness-valid-measurement/45-MEASUREMENT.md`.
| File | Change |
| --- | --- |
| `.planning/phases/45-omp-responsiveness-valid-measurement/45-MEASUREMENT.md` | New. The VOID (calibration) record: facts, per-attempt table, derivation, design finding, owner's options |
| `.planning/phases/45-omp-responsiveness-valid-measurement/45-RESOLUTION.md` | New. OMPR-01, OMPR-06 and OI-11 all carried by the VOID row of D-45-12; the owner's options; words for ROADMAP and REQUIREMENTS |
| `.planning/phases/45-omp-responsiveness-valid-measurement/45-04-SUMMARY.md` | New. This summary |
| `test/support/omp-calibration.test.ts` | One new test pinning the underivable derivation on zero valid controls (the recorded 2026-11-19 state); header comment updated |
| `docs/integration/omp.md` | One dated paragraph after the plan 45-03 paragraph, and the UI-01 evidence cell extended to cite it; the status word unchanged |
| `.planning/milestones/v5.0-phases/36-live-re-verification-of-v1-0-open-items/36-DISPOSITIONS.md` | One appended dated OI-11 line (Carried), no earlier line edited |
| (none) | No source freeze, no threshold, no harness rule, no ROADMAP/STATE/REQUIREMENTS edit |

## Checks run

- `npx tsc -p tsconfig.json` and `node --test` on
  `dist/test/support/omp-calibration.test.js`,
  `dist/test/support/omp-verdict.test.js`,
  `dist/test/support/omp-window-analysis.test.js`: pass (including the new
  underivable pin). This verifies the code rule and the pin; it is not a
  live calibration and is not counted as one.
- Before the window: the BEFORE reversal of commit 1c7fac8 applies cleanly
  (`git apply --check --reverse` on the restricted diff) in a scratch
  checkout, and the fixed constants of `omp-verdict.ts` and
  `omp-contention.ts` match `45-DESIGN.md` value by value.
- After the record: `node scripts/check/host-paths.mjs`, `npm run
  check:docs`, `npm run check:gates` (results below).
- Re-run after the summary was written: `npx tsc -p tsconfig.json` (no
  errors), `node --test dist/test/support/omp-calibration.test.js` (4 pass,
  0 fail), `npx eslint test/support/omp-calibration.test.ts` (no issues),
  `node scripts/check/host-paths.mjs` (ok), `npm run check:docs` (ok),
  `npm run check:gates` (gate closure, module size, export-usage and
  lockfile integrity: no violations).

## What stays unmet, and the owner's options

OMPR-01, OMPR-06 and OI-11 **stay carried** (D-45-12, VOID row); none closes
on VOID or on the hermetic probe alone. The owner's options (no choice made;
full text in `45-RESOLUTION.md`): (a) retire OMPR-01 and OI-11 with a
recorded reason, keeping the hermetic probe and attribution as the permanent
instruments; (b) repeat under the same frozen rule at a different time —
this now requires the harness fix for the scope name first, since the
refusal is deterministic; (c) repeat with the root-assisted isolation
(OD-45-1, approved in the frozen design); (d) ask other users to pause
heavy work. Deviations from the plan are stated in `45-MEASUREMENT.md`
(execution by the plan executor as the realm account under the lock, one
calibration block instead of three spaced blocks).

**Task 8 did not apply**: there is no FINDING (no verdict window ran, no
cause exists), so no extension fix is claimed or attempted.

## Addendum (2026-11-19): the harness fix and the re-calibration — VOID again, with new numbers

The summary above is unchanged. The harness fix that the summary said was
needed is now made, in `test/support/omp-arm-run.ts`: `verifyScopedChild`
accepts any transient-scope leaf `run-*.scope` instead of only the
pid-encoded `run-p<pid>-i<id>.scope`. The two shapes observed in the wild
(`run-p<pid>-i<id>.scope` and `run-<32hex>.scope`, seen live as
`run-r<32hex>.scope`) are both `run-*.scope`; the pid is still verified by
reading its `comm` and its cgroup, `comm == "systemd-run"` is still
refused as the wrapper, and `expectedScopeDir` still pins the exact
directory when given. Hermetic cover: both shapes accepted (including the
exact observed leaf `run-r8a83b262795a418cac3c9d99a9904410.scope`), a
generic `run-*.scope` leaf accepted, and refusals for the wrapper, a
non-`run-*.scope` leaf (`session-3.scope`, an empty `run-.scope`, a leaf
without `.scope`), the root cgroup, an unreadable `/proc` and a mismatched
`expectedScopeDir`. `npx tsc -p tsconfig.json`,
`node --test` on the five harness suites (omp-arm-run, omp-contention,
omp-calibration, omp-verdict, omp-window-analysis: 123 pass),
`npx eslint` on the two touched files, `node scripts/check/host-paths.mjs`,
`npm run check:docs` and `npm run check:gates` are green (results recorded
in the full report of this change).

The calibration was then re-run to the maximum of 16 attempts
outside the repository; full table, words and
derivations in `45-MEASUREMENT.md` Part 1b): **5 mechanically complete
controls** (attempts 3, 7, 13, 14, 16; target 12), **0 V0 refusals**
(the scope-leaf fix holds live), **11 mechanics failures** all of the one
form: the `attributeInterval` "inconsistent readings" error
(e.g. "697.54 ms of thread time in a span of 633 ms"). Of the five
counted controls, 2 met the thresholds (attempts 7 and 16), so
`deriveBounds` is still underivable ("2 of 5 calibration controls met the
thresholds, fewer than 5"); the digest is
`04e52c28f91713d18b638eedf0a01d00959e2ded9f33ed4348044fb1eff3194f`;
`mainBusiestCount` is 5 of 5 counted, which cannot satisfy the 10-of-12
identity check. No bound was frozen and the verdict window was not run.

**The verdict stays VOID (calibration), for the new counts.** OMPR-01,
OMPR-06 and OI-11 stay carried; nothing closes on VOID; the owner's
options are unchanged (full list in `45-RESOLUTION.md`). What changed is
the remaining blocker: no longer the scope name, but the "inconsistent
readings" mechanics failure in eleven of sixteen attempts, whose cause is
not established in this addendum and was not edited (plan 45-04 forbids
editing a harness rule after a number exists). Any repeat of this window
should budget for that failure mode first. Task 8 still does not apply:
there is no FINDING (no verdict window ran), so no extension fix is
claimed or attempted. Deviations of the re-run (root instead of the realm
account, one block instead of three) are stated in the addendum.
