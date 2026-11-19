# Phase 38 Measurement: Omp cold attach on a quiet host

**Window:** 2026-11-18 23:32 UTC to 2026-11-19 01:18 UTC (six attempts, the plan's maximum), run by a person as the `realmlive` account on the production stack (rootless Podman 5.7.1) under the shared live lock, with the owner's authorization of 2026-11-18 and the owner's choice to wait for quiet slots (HITL 2026-11-18). The waiter log records `done attempts=6 elapsed=7967s`.
**Outcome:** `VOID`. One valid run in six attempts; the frozen rule needs three. OMPR-01 is **not met**. OI-11 stays Carried.
**Rule:** 38-CONTEXT D-38-02, applied unchanged (constants and tables are in `test/support/responsiveness-decision.ts`, pinned by its hermetic test; nothing is restated here so nothing can drift).
**Evidence:** kept outside the repository, cited by directory name and file name only. Every number below is copied from those files.

## Host facts

| Fact | Value | Source |
| --- | --- | --- |
| CPUs | 8 | every load record (`cpus`) |
| Kernel | 6.8.0-149-generic | read on the host after the window, not in the evidence files |
| Omp | 18.22.2 | `omp --version` as `realmlive`, read after the window, not in the evidence files |
| Podman | rootless 5.7.1, account `realmlive` | owner authorization and window setup (not re-read here) |
| Commit under test | not recorded | the run copy was built from a tree that contains the control test and the per-run record (the TAP shows the control test and the record files); the evidence holds no commit hash |
| Residue | after every attempt and at the end: containers 0, sandboxes 0, workspace entries 0, daemons 0 | `snapshots.txt` of each attempt directory (the snapshot has those four counts and the load; it has no hosts-entries count and no policy hash) |

The load readings are those the waiter log and the tests recorded. The waiter log has one reading per attempt start (the one-minute, five-minute and fifteen-minute averages); it does not hold the three 60-second quiet-wait readings of the plan's Task 5 step 1.

## Every attempt

An attempt is one run of the three tests of `test/integration/omp-responsiveness.test.ts` (baseline, control, cold attach) in one evidence directory. It is valid only if the cold attach wrote a record that says `valid: true` and the control of the same attempt wrote a first answer (plan 38-01 Task 5 step 6). An invalid attempt counts for nothing: it is not a pass and not a fail.

| N | Start (UTC) | Evidence directory | Load at start (1, 5, 15 min) | Result per test | Valid | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 2026-11-18 23:32:20 | p38-20261118-233220 | 1.57, 10.46, 13.77 | baseline pass; control pass; cold attach fail (thresholds) | yes | none; both quiet readings, baseline passed, no daemon at start, `realm active` reached, control answered |
| 2 | 2026-11-18 23:44:00 | p38-20261118-234400 | 2.31, 10.07, 14.21 | baseline pass; control fail (host not quiet); cold attach fail (host not quiet) | no | host not quiet at the control and cold-attach readings (12.64 on 8 CPUs, 1.58 per CPU); no attach record, no control record |
| 3 | 2026-11-18 23:52:50 | p38-20261118-235250 | 2.01, 9.68, 13.94 | baseline fail (thresholds); control fail (host not quiet); cold attach fail (host not quiet) | no | baseline failed on a quiet reading; host not quiet at the control and cold-attach readings (8.20 on 8 CPUs, 1.02 per CPU); no attach record, no control record |
| 4 | 2026-11-19 01:00:00 | p38-20261119-010000 | 1.37, 10.43, 14.72 | baseline fail (thresholds); control pass; cold attach fail (its own baseline) | no | baseline failed (the test's own and the cold test's); the cold attach did not start; no attach record |
| 5 | 2026-11-19 01:08:13 | p38-20261119-010813 | 1.38, 9.69, 13.69 | baseline pass; control pass; cold attach fail (its own baseline) | no | baseline of the cold-attach test failed; the cold attach did not start; no attach record |
| 6 | 2026-11-19 01:17:03 | p38-20261119-011703 | 1.36, 7.37, 11.72 | baseline fail (thresholds); control pass; cold attach fail (host not quiet) | no | baseline failed; host not quiet at the cold-attach reading (9.16 on 8 CPUs, 1.15 per CPU); no attach record |

Details of each test, copied from the TAP and diagnostics of each `E.txt`:

| N | Baseline (test 1) | Control (test 2) | Cold attach (test 3) |
| --- | --- | --- | --- |
| 1 | load 2.04 on 8 CPUs (0.26 per CPU), quiet; 41 probes, 0 unanswered, maximum 578 ms, median 9 ms, 95th percentile 300 ms, longest gap 787 ms | load 1.91 (0.24 per CPU), quiet; 48 probes, 0 unanswered, first answer 9394 ms from process start | load 1.99 (0.25 per CPU) before its baseline, quiet; baseline 41 probes, 0 unanswered, maximum 491 ms, median 12 ms, 95th percentile 319 ms, longest gap 510 ms; load 1.31 before the extension session; the numbers of the run are below |
| 2 | load 3.82 (0.48 per CPU), quiet; 41 probes, 0 unanswered, maximum 694 ms, median 12 ms, 95th percentile 416 ms, longest gap 700 ms | refused: load 12.64 (1.58 per CPU), loaded | refused: load 12.64 (1.58 per CPU), loaded |
| 3 | load 2.65 (0.33 per CPU), quiet; maximum 1388 ms, 95th percentile 1001 ms (above the bounds); 41 probes, 0 unanswered, median 97 ms, longest gap 1589 ms | refused: load 8.20 (1.02 per CPU), loaded | refused: load 8.20 (1.02 per CPU), loaded |
| 4 | load 2.87 (0.36 per CPU), quiet; maximum 695 ms, 95th percentile 512 ms (above the bound); 41 probes, 0 unanswered, median 82 ms, longest gap 880 ms | load 2.27 (0.28 per CPU), quiet; 55 probes, 22 unanswered, first answer 15396 ms from process start | load 1.85 (0.23 per CPU), quiet; its baseline: maximum 827 ms, 95th percentile 791 ms (above the bound), 41 probes, 0 unanswered, median 85 ms, longest gap 1022 ms |
| 5 | load 1.41 (0.18 per CPU), quiet; 41 probes, 0 unanswered, maximum 489 ms, median 15 ms, 95th percentile 392 ms, longest gap 616 ms | load 1.43 (0.18 per CPU), quiet; 49 probes, 3 unanswered, first answer 10616 ms from process start | load 1.38 (0.17 per CPU), quiet; its baseline: maximum 1587 ms, 95th percentile 1312 ms (above the bounds), 41 probes, 0 unanswered, median 91 ms, longest gap 1503 ms |
| 6 | load 1.55 (0.19 per CPU), quiet; maximum 804 ms, 95th percentile 599 ms (above the bound); 41 probes, 0 unanswered, median 190 ms, longest gap 799 ms | load 2.23 (0.28 per CPU), quiet; 49 probes, 4 unanswered, first answer 10892 ms from process start | refused: load 9.16 (1.15 per CPU), loaded |

Controls, summarised (Omp with no extension, probed from process start; the record files of attempts 1, 4, 5 and 6): the first answer came at 9394, 15396, 10616 and 10892 ms from process start, and the `ready` frame at 8999, 13011, 10121 and 10076 ms (frame times are taken from the session's construction, a few milliseconds after the probe loop's origin). The control asserts only that at least one probe was answered; it passed in all four attempts that reached it.

Residue: for each of the six attempts, `snapshots.txt` shows containers 0, sandboxes 0, workspace entries 0 and daemons 0 before the test run, after it and at the end. The load after the test run was 33.29, 15.63, 10.43, 12.95, 6.75 and 9.63 (attempts 1 to 6).

## The one valid run (attempt 1)

Labelled: measured on 2026-11-18 on a host that read quiet at both readings (0.25 and 0.16 load per CPU), baseline passed, no realm daemon at the start, `realm active` reached. It is **one** valid run; the rule needs three before any case decides an outcome.

| Item | Value (from `omp-responsiveness.attach.record.json`, `summary.txt`, `timeline.txt` of attempt 1) |
| --- | --- |
| Probes sent, answered, unanswered | 151, 141, 10 |
| Window | 37500 ms |
| Maximum, median, 95th percentile | 9906 ms, 201 ms, 8213 ms |
| Longest gap between answers | 12498 ms |
| `realm active` reached | yes |
| Verdict problems | 10 of 151 probes were never answered; the maximum latency was 9906 ms, above 1000 ms; the 95th percentile latency was 8213 ms, above 500 ms |
| Control first answer (same attempt) | 9394 ms |
| Cold-run first answer | 12498 ms |
| Boot excess (cold first answer minus control first answer) | 3104 ms |
| Serving verdict (probes sent at or after the first answer) | the maximum latency was 1403 ms, above 1000 ms; the 95th percentile latency was 705 ms, above 500 ms |
| Omp ready | 11320 ms from process start |
| First realm status paint | 11396 ms |
| Last realm status paint, and `realm active` | 37804 ms |
| Ready before the first realm status paint | yes |
| Loads (1 minute) before the baseline, after the baseline, before the extension session, after the session | 1.99, 1.43, 1.31, 26.35 on 8 CPUs |
| Case | `serving-stall` |

Where the numbers sit, read from `omp-responsiveness.attach.samples.csv` (the CSV is kept outside the repository): the ten unanswered probes were sent at 0 to 2292 ms; the probe sent at 2592 ms was answered after 9906 ms, which is the first answer at 12498 ms; the probes after it were answered with falling latency (1403 ms at the probe sent at 12499 ms, 1110, 890, 614, 416, then 14 ms at 13903 ms). Later probes above 500 ms were sent at 17807, 18512, 19092, 19792, 25797, 26000, 26503 and 30022 ms (685, 791, 506, 705, 901, 699, 505 and 597 ms). The control with no extension also answered nothing for 9394 ms.

## The decision

Computed by `classifyRun` and `decideWindow` of `test/support/responsiveness-decision.ts` (built from the tree that carries this file) on the recorded samples of attempt 1 and the control first-answer time 9394 ms:

- `classifyRun` returned case `serving-stall`, verdict as above, first answer 12498 ms, boot excess 3104 ms and the serving problems as above. The summary recomputed from the samples file equals the summary in the record, and the case and boot excess equal those the harness wrote into the record.
- `decideWindow(["serving-stall"])` returned outcome `VOID`, reason "1 valid runs (serving-stall): fewer than 3 valid runs, so no verdict".

Hand cross-check against the two tables of D-38-02:

1. Case of attempt 1. The verdict is not empty. It has latency problems, so it is not `short-window`. The serving verdict (the latency conditions over the probes sent at or after 12498 ms) is not empty (maximum 1403 ms, above 1000 ms), so the row is `serving-stall`, whatever the boot excess (3104 ms) is. Agrees with the function.
2. Outcome. The window has 1 valid run in 6 attempts, which is fewer than 3 valid runs, so the row is `VOID`. Attempts 2 to 6 are invalid by the reasons in the table and are not cases. Agrees with the function.

No disagreement.

## Outcome and what it means

**VOID.** One valid run in six attempts. The window ended at the attempt maximum; no valid run was discarded or repeated, and the rule was not changed. OMPR-01 (three valid quiet-host runs, each pass or finding) is **not met**: one valid run was recorded, and it read `serving-stall`; one run does not decide `CODE`, `HARNESS` or `PASS`. OMPR-02 (the trigger): no code change or harness change is triggered by the rule, because the rule produced no verdict; plans 38-02 and 38-03 do not run. OMPR-03: the numbers and host facts are recorded here and in `docs/integration/omp.md`; OI-11 carries the label below.

Observations from the data, stated as observations and not as causes or verdicts:

- Five of the nine baseline runs (the baseline test and the baseline inside the cold-attach test, over the attempts that reached them) failed their own bounds on a quiet reading: the baseline test in attempts 3, 4 and 6, and the baseline inside the cold-attach test in attempts 4 and 5. Each missed the 500 ms 95th percentile bound (1001, 512, 599, 791 and 1312 ms) at 0.17 to 0.36 load per CPU, with no extension. Three attempts (2, 3 and 6) also had a test refused because the load was no longer quiet at a later reading (1.58, 1.02 and 1.15 per CPU).
- The Omp with no extension answered no probe for 9394 to 15396 ms from process start in every control that ran (four of four), so a window that starts at process start contains Omp's own boot of that size on this host. The cold attach of attempt 1 answered first at 12498 ms, 3104 ms after the control of the same attempt.
- In attempt 1 the load after the extension session was 26.35 (the attach itself loads the host), which is expected and is not a validity condition.

## OI-11 label

`Carried (no quiet slot)` (the label of D-38-08 for outcome VOID). Reason, precisely: fewer than three valid runs in six attempts, one valid run, no verdict. The ledger line is appended under Part C of `36-DISPOSITIONS.md`; no earlier line is edited (OQ-38-02). The status of UI-01 is not changed; it is the owner's call.

| Row | Label | Date | Commit | Evidence |
| --- | --- | --- | --- | --- |
| OI-11 | Carried (no quiet slot) | 2026-11-19 | not recorded | this file |

## Labels of the numbers

Every number above is a measured value on the date and host stated, copied from the evidence files of the six attempt directories (the TAP and diagnostics `E.txt`, `snapshots.txt`, and in `omp/` the record, summary, timeline and samples files). Kernel and Omp version were read on the host after the window. Nothing is rounded, inferred or taken from the plan.
