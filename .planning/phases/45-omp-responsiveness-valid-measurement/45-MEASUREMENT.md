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
