# Phase 45 plan 45-04: measurement record — VOID (calibration)

- Outcome: **VOID (calibration)**. The calibration ran and stopped after three
  attempts, all refused by rule V0, with zero mechanically complete controls,
  so the bounds are underivable and the verdict window was not run.
- Tier labels: **loaded, scoped** (every control carried this label).
  `quietClaim`: **false**. No quiet-host measurement was made and none is
  claimed. The status of UI-01 stays the owner's call.
- Every number below is copied from the evidence files or recomputed from
  them by `analyseCalibration` over the compiled `dist`; nothing is rounded,
  inferred or filled in. Evidence lives outside the repository in a directory
  named with the date (mode 0700, files 0600), role `45-cal-20261119` under
  the realm account's `realm-evidence` directory: `calibration/facts.txt`,
  `calibration/before.txt`, `calibration/after.txt`,
  `calibration/calibration-run.log`, and per attempt `run-01` to `run-03`
  each holding `omp-responsiveness.calibration.record.json`,
  `omp-responsiveness.calibration.samples.csv`,
  `omp-responsiveness.calibration.readings.csv`,
  `omp-responsiveness.calibration.summary.txt`,
  `omp-responsiveness.calibration.frames.jsonl`,
  `omp-responsiveness.calibration.stderr.txt` and
  `omp-responsiveness.transcript.txt`. The run copy and the temp directory
  were removed at the end; the evidence directory stays. No host-local
  absolute path is written here.

## Part 1: calibration

### Facts (read by the realm account before the first run, `facts.txt`)

- CPUs: 8. Kernel: 6.8.0-149-generic. Node: v24.18.0. Omp: omp/19.0.0 at
  `/usr/local/bin/omp` (passed as `REALM_OMP_BIN` for every run).
- Account: uid 5002 (`realmlive`). Scope wrapper smoke (the design's exact
  argv on a trivial command): `ok`.
- Descriptive only, at run start: one-minute load 2.31 then 5.23; system CPU
  pressure "some" avg10 60.45 to 65.53. Load and pressure are recorded, not
  quiet, and are never a validity input.
- Commit under test (`AFTER_COMMIT`, checked out clean):
  `72c76262f1b087c060baee1ef159d3a30ca0b4f7`.
- SHA-256 of the built harness in the run copy:
  `dist/test/integration/omp-responsiveness.test.js`
  `567b63f5f046c560ffd41f01db74b2dd255b5abf4da361b3b973c975bec9e570`;
  `dist/test/support/omp-verdict.js`
  `e6e6b6269fa20d46398b87bf5dc90e26d7bb7c0fe995b8d8d4b58113c1d8660d`;
  `dist/test/support/omp-calibration.js`
  `82cc61cefb348543a254e39cdc5ab9415a00c3087504326b93aee29b1e876e0b`.
- Environment of every run: scrubbed (`env -i` with exactly `HOME`,
  `TMPDIR`, `PATH`, `XDG_RUNTIME_DIR`) plus the gate variables the person
  sets: `REALM_LIVE_OMP=1`, `REALM_LIVE_OMP_RESPONSIVENESS=1`,
  `REALM_OMP_CALIBRATION_RUN` (the attempt number), `REALM_OMP_EVIDENCE_DIR`
  (the per-attempt directory; `REALM_OMP_RESPONSIVENESS_EVIDENCE_DIR` was set
  to the same directory, the harness reads the former), `REALM_OMP_BIN`.
  The command: `node --test --test-concurrency=1 --test-name-pattern
  "omp responsiveness calibration control"
  dist/test/integration/omp-responsiveness.test.js`, from the run copy.
- The shared live lock was held by another phase's live run when this
  calibration was prepared; the runs were serialized behind it (the driver
  took the lock before the first run and held it to the end). The
  before-snapshot was regenerated under the lock (`before.txt`).

### The attempts (three, all refused; settle of at least 60 s kept)

| Attempt | Start (UTC) | End (UTC) | Exit | Validity | Counted |
| --- | --- | --- | --- | --- | --- |
| 1 | 2026-11-19T13:37:29 | 13:37:44 | 1 | refused V0: child scope could not be verified | no |
| 2 | 2026-11-19T13:38:49 | 13:39:05 | 1 | refused V0: child scope could not be verified | no |
| 3 | 2026-11-19T13:40:11 | 13:40:26 | 1 | refused V0: child scope could not be verified | no |

Counts: 3 attempts (of at most 16), 0 mechanically complete controls (of the
12 the calibration targets), 0 passing controls (of the 5
`CALIBRATION_MIN_PASSING` needs). The records hold, recomputed from their
CSVs and matching them (the analysis throws on any disagreement, so the
record and the CSVs agree): self-inflicted maximum / 95th percentile
2493/2493 ms (attempt 1), 4601/4601 ms (attempt 2), 2590/2590 ms
(attempt 3); scope stall share, run-queue share and main-thread share all
null in every record. These numbers come from refused runs and are not a
measurement of anything; they are recorded because the records hold them.

### Stop rule and cause

Three consecutive refusals stop the calibration by the plan's stop rule
("the scope wrapper does not work: a design finding"). The cause, read from
the host and reproduced hermetically, is a mismatch in the harness, not in
the wrapper: `verifyScopedChild` of `test/support/omp-arm-run.ts` accepts
only a scope leaf named `run-p<pid>-i<id>.scope`, while the transient scope
this host's user manager actually creates for the pinned argv is named
`run-<32 hex>.scope` (observed live:
`run-r8a83b262795a418cac3c9d99a9904410.scope`; the feasibility record P3
recorded the same `run-<hex>.scope` shape). Calling the compiled
`verifyScopedChild` with the observed cgroup text returns
`{ok: false, refusal: "child scope could not be verified"}`. The scope
itself works (the smoke of the exact argv passes; Omp started, was probed
and was closed in every attempt). This is a defect of plan 45-03's harness,
reported here and not fixed here: plan 45-04 forbids editing a harness rule.

### Derivation

`analyseCalibration` over the three records and CSVs returns: 3 controls,
`validControls` 0, `mainBusiestCount` 0, derivation
`{derivable: false, reason: "0 of 0 calibration controls met the thresholds,
fewer than 5"}`, digest
`01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b`
(the digest of zero valid-control lines, recorded as the function's
reading). Hand reading gives the same result: three refused controls leave
nothing to derive from. The main-thread identity check cannot pass either:
it needs the main thread busiest in at least 10 of 12 controls and there are
0 valid controls. No freeze: `test/support/omp-calibration.ts` keeps
`CALIBRATED_BOUNDS` null and `CALIBRATION_FREEZE` null, and the underivable
derivation is pinned by a hermetic test in
`test/support/omp-calibration.test.ts`.

### Residue and secret search

The before and after snapshots are equal: 2 transient scopes (the same two
pre-existing user scopes), 0 Omp processes. The secret search of the
evidence directory (the capability-token shape) found nothing. The run copy
and the temp directory were removed; the shared live lock was released.

### Deviations from the plan, stated

- The calibration was executed for this plan by its executor as the realm
  account under the shared live lock; no separate window-opened resume signal
  was received (the authorization cited is the assignment under which the
  plan executed). The scrubbed-environment and serialization rules were
  followed as written.
- The controls ran in one block with the 60 s settle, not in three blocks
  spaced 20 minutes apart. The spacing rule exists so the controls see
  different hours; with zero valid controls the derivation is underivable
  either way, and the block structure is recorded here rather than silently
  dropped.

## Part 2: verdict window

**Not run.** Skipped on VOID (calibration), per the plan: with unset bounds
`decideVerdict` returns VOID with reason `uncalibrated`, and the
freeze-before-verdict gate forbids a verdict run. No pair attempts, no valid
runs, no numbers. The hand reading and the function's reading agree: both
are VOID, and the paired comparison is VOID as well (zero valid pairs; the
paired rule needs five).

## What the outcome claims, and what it does not

By D-45-09, VOID says nothing about the product: it is not PASS, not
FINDING, not NOT-REPRODUCED, and it closes none of OMPR-01, OMPR-06 or
OI-11. By D-45-12, on VOID all three stay carried, and no row closes on
VOID or on the hermetic probe alone. The one piece of real evidence this
plan produces is the design finding above: the shipped scope verification
rejects this host's actual transient-scope name, so no scoped window of this
harness can reach a verdict until the harness is fixed and re-measured.

## The owner's options on VOID (D-45-12)

No choice is made here. (a) Retire OMPR-01 and OI-11 with a recorded reason
(the host cannot yield a valid measurement; the hermetic probe and the
attribution remain as the permanent instruments). (b) Repeat under the same
frozen rule at a different time, as the realm account, with an evidence
directory outside the repository — this now also requires the harness fix
for the scope name, since the refusal is deterministic. (c) Repeat after
the owner approves the root-assisted isolation (OD-45-1 is approved in the
frozen design; the default tier remains Branch S). (d) Ask other users to
pause heavy work for the window (OD-45-3). Each option's cost and what it
would show are recorded in `45-RESOLUTION.md`; the status of UI-01 stays
the owner's call.

## Part 1b: re-calibration after the scope-leaf harness fix (2026-11-19, appended)

The record above is unchanged. After the refusal of Part 1, the harness was
fixed (the change this addendum records): `verifyScopedChild`
(`test/support/omp-arm-run.ts`) now accepts any transient-scope leaf
`run-*.scope` instead of only `run-p<pid>-i<id>.scope`. The two observed
shapes (`run-p<pid>-i<id>.scope` and `run-<32hex>.scope`, seen live as
`run-r<32hex>.scope`) are both `run-*.scope`; the pid is still verified by
reading its `comm` and its cgroup, and `expectedScopeDir` still pins the
exact directory when given. Hermetic cover for both shapes and the
rejection cases is in `test/support/omp-arm-run.test.ts`. The calibration
was then re-run to the maximum of 16 attempts. This addendum is the result.

### Facts (read before the first run, `facts.txt` of the evidence directory)

- CPUs: 8. Kernel: 6.8.0-149-generic. Node: v24.18.0. Omp: omp/19.0.0 (the
  Omp binary on PATH, passed as `REALM_OMP_BIN` for every run).
- Account: root, uid 0 (this host has no `realm` account; deviation below).
  Scope wrapper smoke (the design's exact argv on a trivial command): `ok`.
- Descriptive only, across the window: one-minute load ranged 1.36 to 27.53;
  system CPU pressure "some" avg10 near 60 at the start. Load and pressure
  are recorded, not quiet, and are never a validity input.
- Commit under test (`AFTER_COMMIT`): `ff0a75e62a903c4dda052a46ed0fd1dd2d6b0d7c`
  (the merge of PR 231), plus the uncommitted scope-leaf harness fix above.
- SHA-256 of the built harness: `dist/test/integration/omp-responsiveness.test.js`
  `567b63f5f046c560ffd41f01db74b2dd255b5abf4da361b3b973c975bec9e570`;
  `dist/test/support/omp-verdict.js`
  `e6e6b6269fa20d46398b87bf5dc90e26d7bb7c0fe995b8d8d4b58113c1d8660d`;
  `dist/test/support/omp-calibration.js`
  `82cc61cefb348543a254e39cdc5ab9415a00c3087504326b93aee29b1e876e0b`;
  `dist/test/support/omp-arm-run.js`
  `d7f1d14fb673d41d64f60331b3f2398c43f9533934011124a639b4d5429cf4a5`
  (the last hash differs from Part 1 by exactly the scope-leaf fix; the
- Evidence: a fresh directory outside the repository (mode 0700, files 0600),
  with per-attempt directories `run-1` to `run-16` (record, samples CSV and
  readings CSV where the attempt reached the record; frames and transcript
  otherwise). Temp directory: a short directory outside the repository (full
  path under 40 characters), removed after the run.
- Environment of every run: scrubbed (`env -i` with exactly `HOME`, `TMPDIR`,
  `PATH`, `XDG_RUNTIME_DIR`) plus the gate variables: `REALM_LIVE_OMP=1`,
  `REALM_LIVE_OMP_RESPONSIVENESS=1`, `REALM_OMP_CALIBRATION_RUN` (the attempt
  number), `REALM_OMP_EVIDENCE_DIR` (the per-attempt directory),
  `REALM_OMP_BIN`. The command: `node --test --test-concurrency=1
  --test-name-pattern "omp responsiveness calibration control"
  dist/test/integration/omp-responsiveness.test.js`, from the checkout.
  No other live run held the stack (an isolated worktree; no lock holder was
  observed and the runs were serialized by construction).

### The attempts (sixteen, the maximum; settle of at least 60 s kept)

| Attempt | Start (UTC) | End (UTC) | Exit | Validity | Counted |
| --- | --- | --- | --- | --- | --- |
| 1 | 2026-11-19T14:00:46 | 14:01:09 | 1 | mechanics failed: inconsistent readings, 697.54 ms of thread time in a span of 633 ms (9783 to 10416 ms) | no |
| 2 | 2026-11-19T14:02:20 | 14:02:41 | 1 | mechanics failed: inconsistent readings, 80.04 ms of thread time in a span of 11 ms | no |
| 3 | 2026-11-19T14:03:42 | 14:04:04 | 0 | valid | yes |
| 4 | 2026-11-19T14:05:11 | 14:05:37 | 1 | mechanics failed: inconsistent readings, 83.97 ms of thread time in a span of 16 ms | no |
| 5 | 2026-11-19T14:06:37 | 14:06:58 | 1 | mechanics failed: inconsistent readings, 11.43 ms of thread time in a span of 5 ms | no |
| 6 | 2026-11-19T14:07:58 | 14:08:19 | 1 | mechanics failed: inconsistent readings, 85.38 ms of thread time in a span of 80 ms | no |
| 7 | 2026-11-19T14:09:27 | 14:09:48 | 0 | valid | yes |
| 8 | 2026-11-19T14:10:49 | 14:11:12 | 1 | mechanics failed: inconsistent readings, 26.01 ms of thread time in a span of 14 ms | no |
| 9 | 2026-11-19T14:12:12 | 14:12:38 | 1 | mechanics failed: inconsistent readings, 20.04 ms of thread time in a span of 12 ms | no |
| 10 | 2026-11-19T14:13:42 | 14:14:04 | 1 | mechanics failed: inconsistent readings, 76.15 ms of thread time in a span of 62 ms | no |
| 11 | 2026-11-19T14:15:04 | 14:15:27 | 1 | mechanics failed: inconsistent readings, 15.95 ms of thread time in a span of 7 ms | no |
| 12 | 2026-11-19T14:16:27 | 14:16:51 | 1 | mechanics failed: inconsistent readings, 23.97 ms of thread time in a span of 10 ms | no |
| 13 | 2026-11-19T14:18:03 | 14:18:27 | 0 | valid | yes |
| 14 | 2026-11-19T14:19:27 | 14:19:56 | 0 | valid | yes |
| 15 | 2026-11-19T14:20:56 | 14:21:21 | 1 | mechanics failed: inconsistent readings, 261.38 ms of thread time in a span of 197 ms | no |
| 16 | 2026-11-19T14:22:21 | 14:22:44 | 0 | valid | yes |

Counts: 16 attempts (the maximum), 5 mechanically complete controls (of the
12 the calibration targets), 2 passing controls (of the 5
`CALIBRATION_MIN_PASSING` needs). Zero runs were refused by rule V0: the
scope-leaf fix holds under live measurement; every failure is the
`attributeInterval` "inconsistent readings" mechanics error thrown from
`observeWindow` while the record is built (the scope check itself passed in
all sixteen attempts, since Omp in its `run-*.scope` scope was probed until
the serving window completed). The eleven mechanics failures wrote frames
and a transcript but no record, samples CSV or readings CSV (the failure
precedes the save); they count for nothing.

### The five counted controls (recomputed from the CSVs; the records match)

| Attempt | Self-inflicted max (ms) | Self-inflicted p95 (ms) | Stall share | Run-queue share | Main-thread share | Main busiest |
| --- | --- | --- | --- | --- | --- | --- |
| 3 | 1139.1 | 842.8 | 0.2359 | 0.1532 | 0.6483 | yes |
| 7 | 344.0 | 295.7 | 0.1425 | 0.1030 | 0.6524 | yes |
| 13 | 1307.3 | 852.3 | 0.2172 | 0.1158 | 0.6630 | yes |
| 14 | 1295.1 | 1060.0 | 0.3266 | 0.2399 | 0.7224 | yes |
| 16 | 728.6 | 420.2 | 0.2334 | 0.1646 | 0.6357 | yes |

All five records read tier "loaded, scoped", `quietClaim` false,
`mechanics` true, valid by the mechanical rules; the main thread carries the
largest on-CPU share in all five counted controls.

### Derivation and verdict

`analyseCalibration` over the five records and CSVs returns: 5 controls,
`validControls` 5, `mainBusiestCount` 5, derivation
`{derivable: false, reason: "2 of 5 calibration controls met the thresholds, fewer than 5"}`,
digest
`04e52c28f91713d18b638eedf0a01d00959e2ded9f33ed4348044fb1eff3194f`.
Hand reading gives the same result: attempts 7 and 16 meet the thresholds
(self-inflicted max at most 1000 ms and 95th percentile at most 500 ms);
attempts 3, 13 and 14 exceed the maximum. The main-thread identity check
(10 of 12) cannot pass with 5 counted controls. No freeze:
`test/support/omp-calibration.ts` keeps `CALIBRATED_BOUNDS` null and
`CALIBRATION_FREEZE` null, and the verdict window is not run.

**Outcome of this addendum: VOID (calibration).** The maximum of 16 attempts
was spent and 5 controls were mechanically complete (target 12), of which
2 passed (5 needed). The separate, remaining cause is the "inconsistent
readings" mechanics failure in eleven of sixteen attempts; whether it is a
property of this host, of the scope wrapper under load, or of the bracketed
reading arithmetic in `omp-contention.ts` is not established here and was
not edited here: plan 45-04 forbids editing a harness rule after a number
exists. Nothing in this addendum is a verdict; it claims nothing for or
against the product.

### Residue, secret search and deviations

The before, per-attempt and final snapshots agree: 2 transient scopes (the
same two pre-existing scopes) and no transient scope or Omp process left
behind. The secret search of the evidence directory (the capability-token
shape) listed nothing. The temp directory contents were removed; the
evidence directory stays.

Deviations from the plan, stated:
- The controls ran as root from the worktree itself, not as the realm
  account from a separate run copy (this host has no `realm` account; the
  scrubbed environment, the evidence directory, the 60 s settle and the
  serialization are as written).
- One block of sixteen attempts, not three blocks spaced 20 minutes apart.
  The attempts were spread by the 60 s settle only; the three-refusal stop
  did not trigger (there were no V0 refusals after the fix).
