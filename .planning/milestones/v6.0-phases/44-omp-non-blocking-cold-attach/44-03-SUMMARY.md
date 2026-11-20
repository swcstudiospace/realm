---
phase: 44-omp-non-blocking-cold-attach
plan: "03"
status: executed (outcome VOID)
requirements: [OMPR-06]
---

# Plan 44-03 summary: the paired loaded window of 2026-11-19

Owner override of the VOID outcome (D-44-01); the evidence is one valid run and loaded-host runs; no quiet-host verdict was reached. Every number below is labelled `loaded, paired`. None is a quiet-host measurement.

## Outcome and what it claims

The frozen paired rule (`44-CONTEXT.md` D-44-07, as code in `test/support/paired-ab.ts`) gave **VOID**: three valid pairs (3, 7 and 8) of the five it needs, after all ten pair attempts. VOID makes no effect claim, for or against the change. OMPR-06 is unmet: the condition that kept the pairs below five was the start-load ceiling (pairs 1, 2, 5, 6, 9 and 10) and the load gap (pair 4) on a loaded host. The change of plan 44-02 stays by the owner's decision; that it was not re-proved is the record; nothing was reverted. OMPR-01 is not met and OI-11 is not closed (it reads `Carried (no quiet slot; owner override D-44-01; paired loaded A/B: VOID)`). The status of UI-01 is the owner's call and was not changed.

## The numbers

| Pair | Order run | Start load per CPU (BEFORE, AFTER) | Valid | First failed condition |
| --- | --- | --- | --- | --- |
| 1 | before-first | 2.5275, 2.90625 | no | the before run started above the ceiling |
| 2 | after-first | 0.97625, 2.35 | no | the after run started above the ceiling |
| 3 | before-first | 0.4625, 0.2925 | yes | - |
| 4 | after-first | 1.17625, 0.19125 | no | the start loads differ by 0.98 load per CPU |
| 5 | before-first | 2.795, 2.62 | no | the before run started above the ceiling |
| 6 | after-first | 1.37875, 2.49625 | no | the after run started above the ceiling |
| 7 | before-first | 0.78, 0.3375 | yes | - |
| 8 | after-first | 0.2225, 0.285 | yes | - |
| 9 | before-first | 2.855, 3.24 | no | the before run started above the ceiling |
| 10 | after-first | 2.045, 2.705 | no | the before run started above the ceiling |

| Valid pair | X before | X after | Gain | S before | S after |
| --- | --- | --- | --- | --- | --- |
| 3 | -2831 | -3916 | 1085 | 0 | 0 |
| 7 | -3104 | -1223 | -1881 | 0 | 30 |
| 8 | -2201 | -2501 | 300 | 161 | 0 |

Medians over the three valid pairs (descriptive): X -2831 (before) and -2501 (after); X1 -2649 and -2700; X2 -182 and 180; S 0 and 0. The full per-run tables are in `44-MEASUREMENT.md`.

Descriptive, over all 10 attempts and counted for nothing: X is negative in all 20 runs (-881 to -38296 ms), so this window did not reproduce the Phase 38 excess of +3104 ms; the control always runs first in the test, and the window cannot separate that position from the load (an inference, not a finding).

## Facts

Commits: BEFORE 1e7ca3e (main after PR 210), AFTER 1ffeb80 (head of PR 211). The four harness files have equal hashes in both trees; the extension differs; the launch module exists only in AFTER. Omp 18.22.2, Node v24.18.0, 8 CPUs, kernel 6.8.0-149-generic, the production stack as the live account under the shared lock, scrubbed environment. CPU pressure readable and high throughout (the some line avg10 48 to 67 at the start of each run). 20 arm runs, each one test and one pass with the arm line `valid`; 42 residue snapshots, every one 0 containers, 0 sandboxes, 0 workspace entries and 0 daemons. The evidence files are kept outside the repository and are cited by name in `44-MEASUREMENT.md`, not by path.

## How the outcome was computed

For every run, `runMetrics` over the parsed samples CSVs and the recorded ready times equals the record's metrics (no difference). `pairValid` and `decidePairs` were run from the built `paired-ab.js` over the ten pair attempts. The hand reading (start loads from the records divided by 8, then the first row of the D-44-07 table) was done with `jq` arithmetic after the function had been run, so it is an independent check and not a prediction; the two agree. The decision is pinned as a case of `test/support/paired-ab.test.ts` titled with the window date; no constant and no row of the rule and none of the existing cases were edited.

## Files changed

`44-MEASUREMENT.md`, `44-03-SUMMARY.md` and `44-VERIFICATION.md` (new); `test/support/paired-ab.test.ts` (one case appended); `docs/integration/omp.md` (one dated paragraph after the 44-01 and 44-02 paragraphs, and the evidence cell of the UI-01 row extended, status word unchanged); `36-DISPOSITIONS.md` (one line appended under Part C). No file under `src` changed.

## What is unmet

OMPR-01 (a quiet-host measurement of the cold attach), the closure of OI-11, and OMPR-06 (at least five valid pairs). The rule reads the start load at the first reading inside the test, and in seven of the ten pair attempts that reading broke the ceiling or the gap on this loaded host; a future window would need the first in-test reading to meet the ceiling, and a control and cold order that does not always put the control first, to be informative.
