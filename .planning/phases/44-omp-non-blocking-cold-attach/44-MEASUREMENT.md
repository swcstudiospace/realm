# Phase 44: the paired loaded window of 2026-11-19 (measurement record)

Owner override of the VOID outcome (D-44-01); the evidence is one valid run and loaded-host runs; no quiet-host verdict was reached. Every number below is labelled `loaded, paired`: it was measured on a loaded host (the CPU pressure stayed high throughout), in interleaved before and after runs, each against its own no-extension control. It is not a quiet-host measurement. OMPR-01 is not met, OI-11 stays Carried, and the status of UI-01 is the owner's call.

The outcome of the window under the frozen rule is **VOID**: three valid pairs, fewer than the five the rule needs. No effect claim is made, for or against the change.

## Facts

| Fact | Value | Tier |
| --- | --- | --- |
| Date of the window | 2026-11-19 (first run started about 03:23 UTC) | Measured |
| BEFORE commit | 1e7ca3e (main after PR 210: plan 44-01 merged, no `src/daemon/launch.ts`) | Measured |
| AFTER commit | 1ffeb80 (head of PR 211, plan 44-02: the launch split and the injected deferral) | Measured |
| Hash facts (first 16 hex digits of a digest, from the copies' build output) | `test/integration/omp-responsiveness.test.js` dcef937ca43b982f, `test/support/paired-ab.js` 986c21a9382231ad, `test/support/responsiveness.js` 5a0eba84506c5276 and `test/support/responsiveness-decision.js` c9c94135c75477de are equal in both trees; `src/omp/extension.js` differs (BEFORE a6c7e82d6b0557a2, AFTER 84d35f2a4dd9cdb5); `src/daemon/launch.js` exists only in AFTER | Measured |
| Omp | 18.22.2 as `omp --version` reports it on this host (the binary the account ran was not re-queried) | Observed |
| Node | v24.18.0 (as `node --version` reports it on this host) | Observed |
| Host | 8 CPUs, kernel 6.8.0-149-generic, rootless Podman stack, the production stack | Measured |
| Account and lock | the live account `realmlive`, the shared live lock held, runs serial, scrubbed environment, no loaded-host escape variable set (the test does not read it) | Reported by the person |
| CPU pressure file | readable; the "some" line at the first reading of each run read avg10 48.08 to 66.58 and avg60 53.79 to 64.56 | Measured |
| One-minute load per CPU at the first reading of each run | 0.191 to 3.240 (see the pair table) | Measured |
| Residue | 42 snapshots (before, a pre and a post snapshot for each of the 20 runs, and a final one): every one reads 0 containers, 0 sandboxes, 0 workspace entries and 0 daemons; the final snapshot equals the first | Measured |
| Runs | 20 arm runs (10 pairs, the order alternating: odd pairs before-first, even pairs after-first); every run reported one test, one pass, zero failures, and its arm line `valid` | Measured |

The rule is the frozen rule of `44-CONTEXT.md` D-44-07, as code in `test/support/paired-ab.ts` (pinned by `test/support/paired-ab.test.ts`); no constant is restated here. The start load of a run is the first load reading of its record (label: before the control) divided by its CPU count.

## The pair attempts

| Pair | Order run | Start load per CPU, BEFORE | Start load per CPU, AFTER | Valid | First failed condition |
| --- | --- | --- | --- | --- | --- |

| 1 | before-first | 2.527 | 2.906 | no | the before run started at 2.5275 load per cpu, above 2 |
| 2 | after-first | 0.976 | 2.350 | no | the after run started at 2.35 load per cpu, above 2 |
| 3 | before-first | 0.463 | 0.292 | yes | - |
| 4 | after-first | 1.176 | 0.191 | no | the start loads differ by 0.98 load per cpu, more than 0.5 |
| 5 | before-first | 2.795 | 2.620 | no | the before run started at 2.795 load per cpu, above 2 |
| 6 | after-first | 1.379 | 2.496 | no | the after run started at 2.49625 load per cpu, above 2 |
| 7 | before-first | 0.780 | 0.338 | yes | - |
| 8 | after-first | 0.223 | 0.285 | yes | - |
| 9 | before-first | 2.855 | 3.240 | no | the before run started at 2.855 load per cpu, above 2 |
| 10 | after-first | 2.045 | 2.705 | no | the before run started at 2.045 load per cpu, above 2 |

Three pairs are valid (3, 7 and 8). Seven are invalid, six on the load ceiling and one on the load gap. Pair 10's BEFORE start load is 2.045, 0.045 above the ceiling. No valid pair was discarded or repeated, and no extra pair was run to replace one. The window used all ten pair attempts, the maximum.

[INFERENCE] The settle step before each run waited for a one-minute load per CPU at or below the ceiling, but the load at the first reading inside the test was often higher (for example 20.22 on 8 CPUs before the control of pair 1, 2.53 per CPU): the test's own start-up work and the host's other load raised the one-minute average in between. This is why most pairs failed validity.

## Every run (the runs of invalid pairs are shown and counted for nothing)

Times are in milliseconds from process start of that run, shown to the nearest millisecond (the records keep the unrounded values). The window summary is over the probes sent at or after Omp ready; the uncorrected summary is over every probe from process start. The relative columns are the secondary reading, control-relative, not a verdict: the window's maximum and 95th percentile minus the paired control's.

| Pair | Arm | Counted | Start load per CPU | Pressure avg10, avg60 | Control ready | Control first answer | Cold ready | Cold first answer | First realm paint | Last realm paint and realm active |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

| 1 | before | no | 2.527 | 64.11, 64.56 | 44407 | 51195 | 10817 | 12899 | 10820 | 40527 |
| 1 | after | no | 2.906 | 59.8, 61.66 | 11893 | 12587 | 10801 | 11706 | 10801 | 29912 |
| 2 | before | no | 0.976 | 66.58, 63.84 | 10792 | 11284 | 7602 | 8305 | 7605 | 21692 |
| 2 | after | no | 2.350 | 59.08, 62.48 | 11605 | 13685 | 8188 | 8902 | 8191 | 27198 |
| 3 | before | yes | 0.463 | 58.3, 62.36 | 9727 | 10817 | 7078 | 7986 | 7083 | 24392 |
| 3 | after | yes | 0.292 | 60.2, 59.89 | 10818 | 11420 | 6722 | 7504 | 6724 | 18907 |
| 4 | before | no | 1.176 | 59.09, 59.01 | 9913 | 10701 | 7878 | 8285 | 7881 | 23183 |
| 4 | after | no | 0.191 | 57.15, 58.39 | 11310 | 12320 | 8988 | 9380 | 8996 | 28494 |
| 5 | before | no | 2.795 | 55.2, 58.08 | 11203 | 12196 | 7801 | 8386 | 7803 | 27000 |
| 5 | after | no | 2.620 | 58.66, 59.9 | 9493 | 9910 | 7998 | 8782 | 8000 | 22285 |
| 6 | before | no | 1.379 | 57.51, 57.96 | 9787 | 10187 | 6391 | 7204 | 6391 | 20911 |
| 6 | after | no | 2.496 | 53.77, 58.81 | 9792 | 10192 | 7277 | 7887 | 7280 | 26803 |
| 7 | before | yes | 0.780 | 55.28, 57.05 | 10397 | 10896 | 7184 | 7792 | 7195 | 27491 |
| 7 | after | yes | 0.338 | 52.94, 56.64 | 9103 | 9606 | 7790 | 8383 | 7794 | 21199 |
| 8 | before | yes | 0.223 | 60.26, 58.01 | 10917 | 12188 | 9201 | 9987 | 9210 | 25886 |
| 8 | after | yes | 0.285 | 56.68, 57.19 | 9806 | 10119 | 7106 | 7618 | 7109 | 28082 |
| 9 | before | no | 2.855 | 57.6, 59.42 | 11588 | 12385 | 8487 | 8786 | 8490 | 26702 |
| 9 | after | no | 3.240 | 55.39, 59.84 | 9404 | 9690 | 6409 | 7092 | 6413 | 21594 |
| 10 | before | no | 2.045 | 48.08, 53.79 | 9797 | 10283 | 7489 | 7797 | 7492 | 20991 |
| 10 | after | no | 2.705 | 48.69, 55.3 | 9492 | 9999 | 6820 | 7415 | 6824 | 26420 |

| Pair | Arm | X | X1 | X2 | S | Window probes | Window unanswered | Window max | Window p95 | Uncorrected probes | Uncorrected unanswered | Uncorrected max | Uncorrected p95 | Relative max | Relative p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | before | -38296 | -33590 | -4706 | 1317 | 119 | 0 | 2917 | 1812 | 163 | 12 | 9899 | 8423 | -6978 | -7610 |
| 1 | after | -881 | -1092 | 211 | 0 | 76 | 0 | 2184 | 1409 | 120 | 7 | 9817 | 8794 | -7825 | -7918 |
| 2 | before | -2979 | -3190 | 211 | 0 | 56 | 0 | 1092 | 701 | 87 | 0 | 8305 | 7404 | -8692 | -8886 |
| 2 | after | -4783 | -3417 | -1366 | 0 | 76 | 0 | 1205 | 512 | 109 | 0 | 8902 | 7696 | -8703 | -8910 |
| 3 | before | -2831 | -2649 | -182 | 0 | 69 | 0 | 1393 | 714 | 98 | 0 | 7986 | 7011 | -8624 | -8604 |
| 3 | after | -3916 | -4096 | 180 | 0 | 49 | 0 | 1003 | 516 | 76 | 0 | 7504 | 6723 | -8917 | -8784 |
| 4 | before | -2416 | -2035 | -381 | 0 | 61 | 0 | 1187 | 499 | 93 | 0 | 8285 | 7299 | -8721 | -8714 |
| 4 | after | -2940 | -2322 | -618 | 0 | 78 | 0 | 1190 | 579 | 114 | 0 | 9380 | 8228 | -8842 | -8742 |
| 5 | before | -3810 | -3402 | -408 | 92 | 76 | 0 | 1188 | 610 | 108 | 0 | 8386 | 7304 | -8623 | -8599 |
| 5 | after | -1128 | -1495 | 367 | 0 | 58 | 0 | 1305 | 898 | 90 | 0 | 8782 | 7805 | -8605 | -8196 |
| 6 | before | -2983 | -3397 | 414 | 0 | 58 | 0 | 1692 | 1206 | 84 | 0 | 7204 | 6293 | -8227 | -8077 |
| 6 | after | -2305 | -2515 | 210 | 0 | 78 | 0 | 1193 | 420 | 108 | 0 | 7887 | 6630 | -8720 | -8778 |
| 7 | before | -3104 | -3213 | 109 | 0 | 81 | 0 | 1223 | 432 | 110 | 0 | 7792 | 6526 | -8673 | -8689 |
| 7 | after | -1223 | -1313 | 90 | 30 | 53 | 0 | 881 | 431 | 85 | 0 | 8383 | 7400 | -8725 | -8690 |
| 8 | before | -2201 | -1716 | -485 | 161 | 67 | 0 | 1433 | 790 | 104 | 0 | 9987 | 8723 | -8454 | -8404 |
| 8 | after | -2501 | -2700 | 199 | 0 | 84 | 0 | 721 | 215 | 113 | 0 | 7618 | 6430 | -9104 | -8907 |
| 9 | before | -3599 | -3101 | -498 | 315 | 73 | 0 | 906 | 414 | 107 | 0 | 8786 | 7525 | -8979 | -8698 |
| 9 | after | -2598 | -2995 | 397 | 0 | 61 | 0 | 897 | 383 | 87 | 0 | 7091 | 6097 | -8791 | -8813 |
| 10 | before | -2486 | -2308 | -178 | 0 | 54 | 0 | 976 | 481 | 84 | 0 | 7796 | 6801 | -9036 | -9021 |
| 10 | after | -2584 | -2671 | 87 | 0 | 78 | 0 | 706 | 206 | 106 | 0 | 7415 | 6222 | -9293 | -9107 |

Every record read `valid` true: the mechanics held in every run (no daemon at the start, the control answered, realm active reached, the session answered `get_available_commands`). The record's metrics for all 20 runs equal what `runMetrics` computes from the parsed samples CSVs and the recorded ready times (checked for every run; no difference).

## The valid pairs and the medians (the only numbers the outcome uses)

| Pair | X before | X after | Gain (X before minus X after) | S before | S after | S change (after minus before) |
| --- | --- | --- | --- | --- | --- | --- |
| 3 | -2831 | -3916 | 1085 | 0 | 0 | 0 |
| 7 | -3104 | -1223 | -1881 | 0 | 30 | 30 |
| 8 | -2201 | -2501 | 300 | 161 | 0 | -161 |

Medians over the three valid pairs (descriptive; the outcome reads only the rule's own medians below):

| Arm | Median X | Median X1 | Median X2 | Median S |
| --- | --- | --- | --- | --- |
| BEFORE | -2831 | -2649 | -182 | 0 |
| AFTER | -2501 | -2700 | 180 | 0 |

Median gain: 300 (the gains are 1085, -1881 and 300). X1 and X2 are shown to the nearest millisecond; X and S are exact.

## The hand reading of the outcome

Read against the table of D-44-07 from the records' numbers with `jq` arithmetic (independent of `paired-ab.ts`), then compared with the function's answer. [Note: the function had already been run when this reading was written, so it was an independent check and not a prediction made before the run.]

1. Pair validity, per pair, from the first load reading of each record divided by 8: pair 1 BEFORE 20.22/8 = 2.5275 (above 2.0, invalid); pair 2 AFTER 18.8/8 = 2.35 (above 2.0, invalid); pair 3 0.4625 and 0.2925, gap 0.17 (valid); pair 4 1.17625 and 0.19125, gap 0.985 (above 0.5, invalid); pair 5 BEFORE 22.36/8 = 2.795 (invalid); pair 6 AFTER 19.97/8 = 2.49625 (invalid); pair 7 0.78 and 0.3375, gap 0.4425 (valid); pair 8 0.2225 and 0.285, gap 0.0625 (valid); pair 9 BEFORE 22.84/8 = 2.855 (invalid); pair 10 BEFORE 16.36/8 = 2.045 (invalid). Valid: 3, 7 and 8. N is 3. The mechanics of every run held.
2. First row of the table, VOID: N is below 5 (3 is below 5). The row holds, so the later rows are not read. The outcome is VOID.
3. For completeness only (not the outcome, and not an application of a later row): the median X of the BEFORE runs over the three valid pairs is -2831, which is at most 250, so the second row (NOT-REPRODUCED) is the row that would have held next had N been 5 or more. The first row comes first and holds.

`decidePairs` over the same ten pair attempts (the records, the parsed samples CSVs, the recorded ready times and start loads) returned outcome VOID, reason "3 valid pairs, fewer than 5: no effect claim", the seven invalid pairs with the reasons of the pair table, the three rows and the medians above. The hand reading and the function agree. The decision is pinned as a case of `test/support/paired-ab.test.ts` titled with the window date.

## What the outcome claims, and nothing more

VOID: the window recorded three valid pairs of the five the frozen rule needs, so there is no effect claim, for or against the change. OMPR-06 is reported unmet, and the condition that kept the pairs below five is the start-load ceiling (six pairs) and the load gap (one pair) on a loaded host, with all ten pair attempts used. The change of plan 44-02 stays by the owner's decision (D-44-01); that it was not re-proved is the record. Nothing was reverted. This is a `loaded, paired` record. It is not a quiet-host measurement, it does not close OI-11 (which stays `Carried`), it does not meet OMPR-01, and it says nothing about whether the thresholds hold or whether `get_state` is answered within 1000 ms during a cold attach.

## Descriptive observations (not the outcome; not gating)

Over all ten pair attempts, valid or not, counted for nothing (every statement here is Measured and `loaded, paired`):

- X is negative in all 20 runs: the cold run's first answer came before the control's first answer by 881 to 38 296 ms. The Phase 38 attempt 1 excess was +3104 ms. Median X over all ten BEFORE runs -2981, over all ten AFTER runs -2542.5. X1 is negative in all 20 runs as well (the cold run was ready earlier than its control).
- The medians of X2 over all ten runs are -281.5 (BEFORE) and 189.4 (AFTER); the medians of X1 are -3145.4 (BEFORE) and -2593.2 (AFTER). Neither is a claim about the change.
- S is 0 in the median for both arms over all ten runs (largest S 1317 for a BEFORE run in pair 1 and 30 for an AFTER run).
- [INFERENCE] In this arm the control always runs first and the cold attach second in the same test, on a host whose load changes between them, and the control's own ready time varied from 9103 to 44 407 ms. The cold run being faster to ready than its control in every run is consistent with a position effect or load variation between the two parts rather than with anything about the extension; this window cannot separate them, and the design cannot show the Phase 38 excess on a loaded host. A future window would need a control-then-cold order that alternates inside the pair or a quiet host.
- The realm active paint came 18 907 to 40 527 ms after process start in the cold runs; the window summaries over probes sent at or after ready read a maximum of 706 to 2917 ms and a 95th percentile of 206 to 1812 ms (the thresholds are 1000 and 500 ms). These are loaded-host numbers and are not a verdict.

