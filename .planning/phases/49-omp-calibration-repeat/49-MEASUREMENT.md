# Phase 49: measurement record (OMPV-04, Step 5) — 2026-11-19

Terminal outcome, read by the code (`analyseWindow` / `analyseCalibration`
over the records and CSVs, `decideVerdict` / `decidePairs`): **FINDING**
(named cause `unattributed`); the paired effect, read by the paired rule, is
**NOT-REPRODUCED** (median boot excess −794 ms, at most 250 ms over 5 valid
pairs). 24 arm runs (12 pair attempts), 15 valid runs, 5 valid pairs.
- Every number below is copied from the evidence files or recomputed from
  them by the frozen analysis over the compiled `dist` of the commit under
  test; nothing is rounded, inferred or filled in. Evidence lives outside
  the repository in a directory named with the date (mode 0700, files
  0600), role `49-cal-20261119` under the realm account's
  `realm-evidence` directory: `calibration/` (`facts.txt`, `before.txt`,
  `after.txt`, `driver.log`, `driver.sh`, `analyse.mjs`) and per attempt
  `run-01` to `run-16` each holding `omp-responsiveness.calibration.record.json`,
  `omp-responsiveness.calibration.samples.csv`,
  `omp-responsiveness.calibration.readings.csv`,
  `omp-responsiveness.calibration.summary.txt`,
  `omp-responsiveness.calibration.frames.jsonl`,
  `omp-responsiveness.calibration.stderr.txt` and
  `omp-responsiveness.transcript.txt` plus `run.log`; and `window/`
  (`facts.txt`, `before.txt`, `after.txt`, `driver.log`, `window-driver.sh`,
  `analyse-window.mjs`) and per pair `pair-01` to `pair-12` each holding
  `before/` and `after/` (per run: `load.txt`, the paired record, the two
  samples CSVs, the two readings CSVs, `run.log`, `after.txt`). The run
  copy and the temp directory were removed at the end; the evidence
  directory stays. No host-local absolute path is written here.

## Part 0: bracket-arithmetic record (Step 2)

The plan named `attributeInterval` bracket arithmetic as the candidate
cause of the 2026-11-19 "inconsistent readings" failures (11 of 16
re-calibration attempts, 45-MEASUREMENT.md Part 1b). Executed red-first in
spirit: six hermetic cases were added to `test/support/omp-contention.test.ts`,
the owning hermetic test (`attributeInterval` lives in
`test/support/omp-contention.ts`, not in `omp-window-analysis.ts`; the plan's
file name was stale). The cases cover the three named categories — sleep
residual below −5 ms on a bracketed interval (both recorded failure shapes:
697.54 ms of thread time in a span of 633 ms; 80.04 ms in a span of 11 ms),
mixed busy/wait/sleep intervals on a slack bracket (and busy-for-the-whole-
span), and intervals whose bracket is too far on one side — plus the 5 ms
rounding rule on a short span. **None of them failed on the pre-fix tree:**
the bracket arithmetic already clamps only the ≤5 ms rounding and keeps a
larger negative residual an error (`attributeInterval`,
`SLEEP_ROUNDING_MS = 5`), so there was no arithmetic defect to fix and no
code change was made. The 102-test hermetic run (contention, window-analysis,
calibration, verdict) passes on the tree at the freeze commit (2026-11-19).
The live failures are therefore not a bracket-arithmetic bug in
`attributeInterval`; the recorded excesses (5.4 to 69.0 ms of thread time
over the stamp span) are consistent with the sampler stamping a reading
before its two blocking file reads under load (`createContentionSampler`
reads `atMs` first) or with kernel schedstat accounting skew, and today's
calibration ran with none of them (16 of 16 attempts recorded cleanly).
Pinning a cause from these records alone would be an inference and is not
made here; the phase-45 failure mode is not reproduced.

## Part 1: calibration (Step 3)

Facts (read by the realm account before the first run, `facts.txt`):
- CPUs: 8. Kernel: 6.8.0-149-generic. Node: v24.18.0. Omp: omp/19.0.0 at
  `/usr/local/bin/omp` (passed as `REALM_OMP_BIN` for every run).
- Account: uid 5002 (`realmlive`). Scope wrapper smoke is the same
  feasibility re-probe of `49-CALIBRATION.md` (P3 usable; scope leaf
  `run-r<hex>.scope`, accepted by the `run-*.scope` check).
- Descriptive only, at calibration start: one-minute load 9.84; system CPU
  pressure "some" avg10 15.08. Load and pressure are recorded, not quiet,
  and are never a validity input.
- Commit under test (checked out clean in the run copy):
  `69801646cf6fa18616351b98d0d778180580b56c`.
- SHA-256 of the built harness in the run copy:
  `dist/test/integration/omp-responsiveness.test.js`
  `567b63f5f046c560ffd41f01db74b2dd255b5abf4da361b3b973c975bec9e570`;
  `dist/test/support/omp-verdict.js`
  `e6e6b6269fa20d46398b87bf5dc90e26d7bb7c0fe995b8d8d4b58113c1d8660d`;
  `dist/test/support/omp-calibration.js`
  `82cc61cefb348543a254e39cdc5ab9415a00c3087504326b93aee29b1e876e0b`;
  `dist/test/support/omp-contention.js`
  `66247e2084cedcfd94433892e4e6024717a776014e05bf9f8629d6803660e41f`.
- Environment of every run: scrubbed (`env -i` with exactly `HOME`,
  `TMPDIR`, `PATH`, `XDG_RUNTIME_DIR` plus the session bus) plus the gate
  variables the driver sets: `REALM_LIVE_OMP=1`,
  `REALM_LIVE_OMP_RESPONSIVENESS=1`, `REALM_OMP_CALIBRATION_RUN` (the
  attempt number), `REALM_OMP_EVIDENCE_DIR` (the per-attempt directory),
  `REALM_OMP_BIN`. The command:
  `node --test --test-concurrency=1 --test-name-pattern
  "omp responsiveness calibration control"
  dist/test/integration/omp-responsiveness.test.js`, from the run copy.
- Sixteen attempts, the maximum, each followed by a settle of at least
  60 s, serialized under the shared live lock (checked free at launch:
  no other `node --test` process of the account; a second phase's window
  had just ended). The before-snapshot was taken under the same check
  (`before.txt`).

### The attempts (sixteen, all recorded; settle of at least 60 s kept)

| Attempt | Start (UTC) | End (UTC) | Exit | Validity | Counted |
| --- | --- | --- | --- | --- | --- |
| 1 | 2026-11-19T21:22:41 | 21:22:56 | 0 | valid | yes |
| 2 | 2026-11-19T21:23:56 | 21:24:09 | 0 | valid | yes |
| 3 | 2026-11-19T21:25:09 | 21:25:22 | 0 | valid | yes |
| 4 | 2026-11-19T21:26:22 | 21:26:35 | 0 | valid | yes |
| 5 | 2026-11-19T21:27:35 | 21:27:48 | 0 | valid | yes |
| 6 | 2026-11-19T21:28:48 | 21:29:02 | 0 | valid | yes |
| 7 | 2026-11-19T21:30:02 | 21:30:18 | 0 | valid | yes |
| 8 | 2026-11-19T21:31:18 | 21:31:31 | 0 | valid | yes |
| 9 | 2026-11-19T21:32:31 | 21:32:44 | 0 | valid | yes |
| 10 | 2026-11-19T21:33:44 | 21:33:57 | 0 | valid | yes |
| 11 | 2026-11-19T21:34:57 | 21:35:10 | 0 | valid | yes |
| 12 | 2026-11-19T21:36:10 | 21:36:23 | 0 | valid | yes |
| 13 | 2026-11-19T21:37:23 | 21:37:36 | 0 | valid | yes |
| 14 | 2026-11-19T21:38:36 | 21:38:49 | 0 | valid | yes |
| 15 | 2026-11-19T21:39:49 | 21:40:03 | 0 | valid | yes |
| 16 | 2026-11-19T21:41:03 | 21:41:16 | 0 | valid | yes |

Counts: 16 attempts (the maximum), 16 mechanically complete controls, 16
passing controls (5 needed), the main thread the busiest in all 16 (the
freeze precondition of D-45-08). Zero runs were refused by rule V0 and zero
runs failed the mechanics: the "inconsistent readings" failure of the 45
re-calibration did not recur.

### The sixteen controls (recomputed from the CSVs; the records match)

| Attempt | Raw max/p95 (ms) | Self-inflicted max/p95 (ms) | Stall share | Run-queue share | Main-thread share | Main busiest |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 3847 / 3360 | 18.9 / 15.7 | 0.00885 | 0.00547 | 0.688 | yes |
| 2 | 1905 / 1411 | 188.4 / 40.2 | 0.01695 | 0.00796 | 0.549 | yes |
| 3 | 2121 / 1637 | 25.7 / 11.9 | 0.00522 | 0.00263 | 0.583 | yes |
| 4 | 1933 / 1440 | 76.2 / 12.7 | 0.00268 | 0.00168 | 0.581 | yes |
| 5 | 1912 / 1415 | 104.1 / 10.4 | 0.00432 | 0.00430 | 0.584 | yes |
| 6 | 1933 / 1438 | 94.4 / 25.1 | 0.00706 | 0.00400 | 0.564 | yes |
| 7 | 4466 / 3734 | 415.0 / 241.1 | 0.04347 | 0.02783 | 0.571 | yes |
| 8 | 2189 / 1695 | 30.5 / 14.9 | 0.00858 | 0.00519 | 0.579 | yes |
| 9 | 1798 / 1303 | 87.1 / 18.8 | 0.00436 | 0.00156 | 0.577 | yes |
| 10 | 2038 / 1541 | 86.1 / 15.8 | 0.00583 | 0.00365 | 0.563 | yes |
| 11 | 1969 / 1487 | 245.5 / 49.8 | 0.03989 | 0.01943 | 0.567 | yes |
| 12 | 1928 / 1433 | 83.0 / 10.9 | 0.00654 | 0.00287 | 0.575 | yes |
| 13 | 1882 / 1390 | 20.0 / 10.0 | 0.00636 | 0.00331 | 0.570 | yes |
| 14 | 1850 / 1354 | 15.8 / 11.5 | 0.00425 | 0.00343 | 0.574 | yes |
| 15 | 1815 / 1320 | 120.6 / 72.1 | 0.01059 | 0.00595 | 0.576 | yes |
| 16 | 1952 / 1456 | 25.8 / 11.0 | 0.00324 | 0.00196 | 0.576 | yes |

(Raw columns copied from each attempt's summary; self-inflicted, shares
and main-thread share recomputed by `analyseCalibration`. Full precision in
the evidence.)

### The frozen bounds (Step 3)

Derivation `deriveBounds` over the 16 valid controls: derivable, 16 of 16
passing. Frozen in `test/support/omp-calibration.ts` (commit
`5a367037582c7a6305668d9e639ce6b112379514`) **before** any verdict run,
with `CALIBRATION_FREEZE` date `2026-11-19` and digest
`af0adf3076cc4df0613da6a448569e0e95011faec07d8a871a285266eeac247d` (the
sha256 of the canonical text of the 16 mechanically valid controls):

- `stallShareMax`: 0.008853242320819113
- `runqShareMax`: 0.00547431048269137
- `controlSelfMaxMs`: 1000
- `controlSelfP95Ms`: 500

`omp-calibration.test.ts` pins the four values, the date and the digest.
No constant changes after this point; a wrong bound would be a finding and
a replan, and the verdict window ran against exactly these numbers.

## Part 2: verdict window (Step 4)

The window ran 12 pair attempts, arm order alternating by pair (odd pair:
before arm first; even pair: after arm first), with a settle of at least
120 s between runs, serialized under the shared live lock (checked free at
launch). The run copy was rebuilt at the freeze commit
`5a367037582c7a6305668d9e639ce6b112379514` (`omp-calibration.js` digest
`124837e67c862e6c5932370b9b53add10bbd45173cf6e49f1413059efb2d7708`;
responsiveness test and verdict digests unchanged). The window never stops
for load: load and pressure at each run start are in the per-run `load.txt`.
The driver timed out at the 3600 s job bound after the last run ended
(22:44:01); the closing snapshot was taken immediately after and is
recorded as such below. One window, one decision-table outcome per rule.

### The 24 runs (all exit 0; validity by the frozen rule)

Every run recorded exit 0; 15 of 24 are valid by `runValidity` with the
frozen bounds, 9 refused by rule V3 (the cold-window scope stall share
0.00915 to 0.02476 above the frozen maximum 0.008853242320819113).
Scope-leaf refusals (V0) did not occur: every run's Omp was probed in its
`run-*.scope` scope until the serving window completed (scope names live in
the evidence records).

| Pair | runIndex (arm) | Validity | Cold stall share | Cold self-inflicted max/p95 (ms) | Cold raw max/p95 (ms) |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 (before) | V3 | 0.01222 | 95.1 / 28.2 | 96 / 29 |
| 1 | 2 (after) | V3 | 0.00915 | 28.6 / 14.9 | 32 / 15 |
| 2 | 3 (after) | V3 | 0.01659 | 163.3 / 19.7 | 209 / 20 |
| 2 | 4 (before) | valid | 0.00625 | 15.6 / 10.9 | 16 / 14 |
| 3 | 5 (before) | valid | 0.00483 | 20.8 / 8.9 | 21 / 9 |
| 3 | 6 (after) | V3 | 0.01050 | 118.9 / 10.9 | 155 / 13 |
| 4 | 7 (after) | V3 | 0.01596 | 63.2 / 27.0 | 72 / 29 |
| 4 | 8 (before) | V3 | 0.00983 | 163.6 / 13.8 | 197 / 14 |
| 5 | 9 (before) | valid | 0.00692 | 32.6 / 13.8 | 33 / 14 |
| 5 | 10 (after) | V3 | 0.01327 | 87.4 / 32.7 | 88 / 33 |
| 6 | 11 (after) | valid | 0.00720 | 96.8 / 14.9 | 100 / 15 |
| 6 | 12 (before) | valid | 0.00581 | 134.2 / 22.7 | 137 / 23 |
| 7 | 13 (before) | valid | 0.00755 | 80.5 / 9.7 | 81 / 10 |
| 7 | 14 (after) | valid | 0.00567 | 42.7 / 10.9 | 43 / 11 |
| 8 | 15 (after) | V3 | 0.01316 | 32.4 / 24.6 | 40 / 34 |
| 8 | 16 (before) | valid | 0.00483 | 46.9 / 12.7 | 47 / 13 |
| 9 | 17 (before) | V3 | 0.02476 | 724.2 / 306.1 | 783 / 318 |
| 9 | 18 (after) | valid | 0.00667 | 77.8 / 13.7 | 82 / 14 |
| 10 | 19 (after) | valid | 0.00566 | 25.2 / 10.8 | 32 / 11 |
| 10 | 20 (before) | valid | 0.00512 | 103.8 / 15.8 | 107 / 16 |
| 11 | 21 (before) | valid | 0.00730 | 127.7 / 13.8 | 134 / 14 |
| 11 | 22 (after) | valid | 0.00533 | 51.4 / 14.7 | 60 / 15 |
| 12 | 23 (after) | valid | 0.00338 | 17.8 / 11.0 | 18 / 15 |
| 12 | 24 (before) | valid | 0.00448 | 99.7 / 10.7 | 101 / 11 |

(Stall shares recomputed by `analyseWindow` with the frozen bounds; raw and
self-inflicted columns are the cold-window summaries of the records. Pair 8
before's self-inflicted values are read from the record's cold window; the
run counts as valid.)

### The decision, by the code

`analyseWindow` with the frozen bounds (`CALIBRATED_BOUNDS`) over all 24
records:

- `verdict.outcome=FINDING`. Reason, verbatim: "6 of 6 valid runs exceed
  the thresholds on the self-inflicted latency; window cause unattributed".
- `paired.outcome=NOT-REPRODUCED`. Reason, verbatim: "the median boot
  excess of the before runs is -794 ms, at most 250 ms over 5 valid pairs".
- `counts`: 24 attempts, 15 valid runs, 5 valid pairs (6, 7, 10, 11, 12).

What the FINDING's breach is. On all six valid after-arm runs (the only
runs `decideVerdict` reads), the cold-window probe counts are `sent=40,
answered=40` and the serving windows are 9749 to 9751 ms, so
`responsivenessProblems` fires exactly once on each: "the attach window
was too short to be a measurement: 97xx ms, at least 10000 ms are needed"
(runIndex 11: 9751; 14: 9750; 18: 9749; 19: 9751; 22: 9750; 23: 9750).
No other problem fires on them: their self-inflicted latencies are 17.8
to 96.8 ms (max) and 10.8 to 14.9 ms (p95), their raw latencies 18 to
100 ms and 11 to 15 ms — far below the 1000/500 ms thresholds. The named
window cause is `unattributed` because every breaching run's stall set is
empty of latency breach (the shortness branch of `causeOfRun`: only a
shortness problem can breach with an empty set, and it names no stall).
So the FINDING is short-window-driven, not latency-driven: today the
40-probe probes-never-lasted-10000 ms pattern (40 × 250 ms = 9750 ms;
baseline `MIN_WINDOW_MS` = 10000) put every valid run of the window one
tick short, and the decision table has no other slot for that state.
Recorded plainly: the measured latencies are good; the verdict word is
what the unchanged rule returns on window shortness.

What the paired second rule says. Over the 5 valid pairs, the median boot
excess of the before runs is −794 ms, under the 250 ms bound, so the
paired comparison is NOT-REPRODUCED: no before/after attach effect was
demonstrated. (Both arms were measured from the same tree; there is no
change under test between them, so an effect would have been surprising.)


## Part 3: residue, secrets, deviations

Residue, calibration: before and after agree — 2 transient scopes (the
same two pre-existing scopes) and 0 Omp processes; one-minute load 9.84
before, 4.35 after; system pressure "some" avg10 15.08 before, 5.19 after.
Residue, verdict window: per-run snapshots compared against the window
before-snapshot and matched on scopes (the same two), Omp processes (0),
and the policy.json hash (`e66c7871df0f3eaad3af...acf4`) for every run.
The closing window snapshot, taken at 22:44:58 after the driver's job
bound cut it off (the last run ended 22:44:01), matches on all fields
except one transient daemon count (0 before, 2 at close, 0 now: another
phase's daemon, started and stopped outside this window; this window's own
per-run snapshots all read 0). No Omp process remained at any end check.
The run copy (`tmp-z49`) and the temp directory were removed after the
analyses; the evidence directory stays. Nothing was removed from the
shared state: the tests' own removal scope (project dirs, scenario root,
their daemon) is recorded per-run.

Secret search: the evidence directory was searched for the capability
token shape (`rcap1`, a dot, eight base64url characters) and listed
nothing; the committed phase files were searched the same way and listed
nothing. No host-local absolute path is written in this file.

Deviations from the plan, stated:
- The bracket fix (Step 2) is reported as not needed: the six hermetic
  cases pin the frozen clamp rule and all pass pre-fix, so
  `attributeInterval` was not changed. The plan's file name for the fix
  (`omp-window-analysis.ts`) was stale; the owning test is
  `omp-contention.test.ts`.
- The verdict window ran as the realm account from a run copy of the
  frozen commit under the shared live lock (serialized, launch checks
  clear). The calibration's run copy was at commit `6980164` (pre-freeze,
  bounds null); the verdict's run copy was rebuilt at the freeze commit
  `5a36703` with the same harness code otherwise (identical test/verdict
  digests), so the frozen bounds were read by the verdict.
- The feasibility re-probe ran through `runuser` with the account's bus
  rather than a fresh ssh login (recorded in `49-CALIBRATION.md`); P6's
  probe script needed a `.cjs` rename under the account's `type:module`
  home (recorded there too).
- The calibration controls ran in one block with the 60 s settle (not
  spaced 20 minutes apart); the driver timed out at the 3600 s job bound
  during the window close and the closing snapshot was taken immediately
  after (recorded above). These affect scheduling only, not the numbers.
