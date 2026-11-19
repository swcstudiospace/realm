---
phase: 44-omp-non-blocking-cold-attach
plan: "01"
status: executed
requirements: [OMPR-04, OMPR-06]
---

# Plan 44-01 summary

Executed on branch gsd/phase-44-exec1 (from the main branch). Nothing live ran: no Omp, daemon, container or production stack was started, and no file under src changed. The Phase 44 plans were copied from the planning branch so they ship with the change.

## What changed, per file

- `.planning/phases/38-omp-responsiveness-during-cold-attach/38-02-PLAN.md` and `38-03-PLAN.md`: one status paragraph each, directly after the frontmatter (superseded by Phase 44, not executed). The diff is two added lines per file (the paragraph and a blank line).
- `.planning/phases/44-omp-non-blocking-cold-attach/44-ATTRIBUTION.md`: the override sentence, the one valid run with tiers, the two components of the boot excess (2321 ms before ready, 783 ms after, 3104 ms), the sample shape, the corrected-window arithmetic (the verdict from ready still holds a latency over 1000 ms for this run), what the evidence does not show, finding F-44-01, and what the paired window can and cannot separate. Written from the recorded numbers only.
- `test/support/responsiveness.ts`: `checkedReadyAtMs`, `samplesCsvWithPhase` (header sentAtMs,latencyMs,phase), `relativeSummary` and `SECONDARY_HEADING` (no verdict member), `parsePressure`, `summaryTextWithSecondary` (corrected window, uncorrected numbers, boot samples, a section headed "secondary, control-relative, not a verdict"). `summaryText` output is byte for byte the same (its lines moved into two private helpers).
- `test/support/responsiveness-decision.ts`: `splitAtReady`, `windowStopReached`, and the optional third argument `readyAtMs` of `classifyRun`. Absent, the code path is the Phase 38 one. Present: pass, serving-stall, boot-delay and short-window as D-44-03 says; own-boot cannot be returned. Header comment cites D-44-03 and says the constants and tables are unchanged.
- `test/support/paired-ab.ts` (new): the constants of D-44-07, `PAIRED_LABEL`, `parseSamplesCsv`, `runMetrics`, `pairValid`, `decidePairs`. Pure; no process, clock, environment or file.
- `test/support/paired-ab.test.ts` (new): every constant by value, one test per row of the outcome table in table order, precedence cases, odd and even N, the boundaries (2.0 and 2.01, 0.5 and 0.51; 250 and 251), floor of one fifth at N of 5, the attempt-1 shape giving X 3104, X1 2321, X2 783, the label and `quietClaim` false.
- `test/support/responsiveness.test.ts` and `responsiveness-decision.test.ts`: new Phase 44 cases appended; the only edit to existing lines is the import lists. No existing case or assertion was changed.
- `test/integration/omp-responsiveness.test.ts`: the cold attach still probes from process start and stops when realm active is shown and `MIN_WINDOW_MS` have passed since the ready frame (or 360 s). The verdict, the probe minimum and the window minimum are read over the window samples; a missing ready frame fails the test with its own message after the record is written. The record gains `readyAtMs`, `windowSummary`, `allSamplesSummary`, `bootSummary`, `relative`, `pressure`; the samples CSV carries the phase column. CPU pressure is read at every load reading (all tests, through `takeReading`) and noted in the transcript. The control run and the cold-attach setup are extracted into helpers shared with the new fourth test. The baseline assertion, the no-daemon check, the `reachedActive` check and the `get_available_commands` check are unchanged. New test: `V1LIVE-01 omp responsiveness paired arm (loaded, paired A/B of Phase 44)`.
- `docs/integration/omp.md`: one dated paragraph (2026-11-19, Phase 44, method) after the Phase 38 paragraphs of the UI-01 detail; no numbers; the UI-01 status cell is untouched.

## Pinned constants and tables

The Phase 38 constants (1000 ms, 500 ms, 40 probes, 10 s, 0.5 per CPU, 250 ms interval, `MIN_VALID_RUNS` 3, `MAX_ATTEMPTS` 6, `BOOT_EXCESS_MAX_MS` 250, control windows 12 000 and 60 000 ms) and both Phase 38 tables stay pinned by their existing, unedited tests. Pinned new: `MIN_VALID_PAIRS` 5, `MAX_PAIR_ATTEMPTS` 10, `PAIR_LOAD_CEILING_PER_CPU` 2.0, `PAIR_LOAD_GAP_PER_CPU` 0.5, `SERVING_CONTROL_WINDOW_MS` 5000, `REPRODUCTION_MIN_MS` 250, `GAIN_MIN_MS` 250, `GAIN_PAIR_FRACTION` 0.8, `GAIN_MEDIAN_SHARE` 0.5, `STALL_TOLERANCE_MS` 250, `REGRESS_PAIR_FRACTION` 0.2, the answer timeout 10 000 ms, the label `loaded, paired`; and the five rows of the outcome table (VOID, NOT-REPRODUCED, REGRESSION by three conditions, EFFECT, NO-EFFECT) in that order.

## Interpretation choices where the plan was silent

- In `S`, an unanswered control probe in the serving window is skipped (the plan says "largest control latency"); an unanswered cold probe counts as 10 000 ms, as written.
- `pairValid` reasons are checked in this order: the BEFORE run, the AFTER run, the load ceiling (BEFORE, then AFTER), then the load gap. A run is valid when the arm's mechanics held and `runMetrics` has metrics.
- Fraction thresholds use a 1e-9 tolerance before floor and ceiling so 0.8 times N cannot land a hair off an integer.
- The paired record also carries `relative` (window minus the paired control), because D-44-03 asks for it in the paired arm.
- The paired arm skip order is: the opt-in, the arm variable, the pair variable, then the Omp and production prerequisites. A run with the opt-in set but no arm variable therefore names `REALM_OMP_PAIRED_ARM`, as the plan's done criterion requires, even on a host without the other prerequisites.

## Checks run

- `npx tsc -p tsconfig.json`: clean.
- `npx eslint` on the seven touched ts files: clean (after fixing two findings in the new test).
- `node --test` on responsiveness, responsiveness-decision, paired-ab, omp-responsiveness (integration) and omp-live-helpers: 150 tests, 146 pass, 4 skipped (the four gated tests, each with a reason naming a missing prerequisite), 0 fail. The same run as a regular non-root account (omprunner) under `env -i`: the same numbers.
- `node --test dist/test/support/*.test.js`: 143 pass as root and 143 pass as the regular user under `env -i`.
- With `REALM_LIVE_OMP_RESPONSIVENESS=1` and no arm variable the paired arm skips naming `REALM_OMP_PAIRED_ARM`; with an arm and pair 11 it skips naming `REALM_OMP_PAIRED_PAIR`.
- `node scripts/check/host-paths.mjs`, `npm run check:docs`, `scripts/check/module-size.mjs`, `scripts/check/export-usage-gate.mjs`, `scripts/check/gate-closure.mjs`: pass.

## What plans 44-02 and 44-03 can rely on

- The BEFORE commit is the merge commit of this plan.
- The paired arm test: `V1LIVE-01 omp responsiveness paired arm (loaded, paired A/B of Phase 44)` in `test/integration/omp-responsiveness.test.ts`, gated by `REALM_LIVE_OMP_RESPONSIVENESS=1`, `REALM_LIVE_OMP=1`, the production prerequisites, `REALM_OMP_PAIRED_ARM` (before or after) and `REALM_OMP_PAIRED_PAIR` (1 to 10), with `REALM_OMP_EVIDENCE_DIR` for the evidence. It writes `omp-responsiveness.paired.record.json`, `omp-responsiveness.paired.control.samples.csv` and `omp-responsiveness.paired.cold.samples.csv` (with the phase column), plus the frames and stderr per part.
- The rule: `test/support/paired-ab.ts` (`runMetrics`, `pairValid`, `decidePairs`, `parseSamplesCsv`); the per-arm input for `decidePairs` is the control and cold samples with their ready times (the record's `control.readyMs` and `cold.readyMs`), the start load per CPU (the record's first load reading, labelled before the control, divided by its cpus) and whether the mechanics held (the record's `controlAnswered`, `reachedActive` and `commandsAnswered` all true).

## Not done as written

Nothing is omitted. Not committed, by instruction.
