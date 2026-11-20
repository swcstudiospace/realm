# Plan 49-01: Omp calibration repeat — Summary

**Verdict:** FINDING (named cause `unattributed`); paired effect NOT-REPRODUCED. Tier
`loaded, scoped`, `quietClaim` false. This is the code's decision table read over the
records, unchanged — not a hand reading.

## What was done
1. **Feasibility restated (Step 1).** The per-primitive probes were re-run as the
   realm live account. No primitive regressed; Branch S stands. Recorded in
   `49-CALIBRATION.md`.
2. **Bracket arithmetic (Step 2).** Six hermetic cases were added to the owning
   test (`omp-contention.test.ts`), including both recorded 45 failure shapes.
   **None failed pre-fix**: `attributeInterval` already clamps only the 5 ms
   rounding and errors beyond it, so it was not changed. The phase-45 failures are
   not a bracket-arithmetic defect (they did not recur either).
3. **Recalibration and freeze (Step 3).** 16 records controls ran as the realm
   account from a clean copy under the shared live lock: **16/16 mechanically valid
   and passing, main thread busiest in all 16** — no mechanics failure occurred.
   The bounds froze before the verdict run:
   - `stallShareMax`: 0.008853242320819113
   - `runqShareMax`: 0.00547431048269137
   - `controlSelfMaxMs`: 1000
   - `controlSelfP95Ms`: 500
   - `CALIBRATION_FREEZE`: date `2026-11-19`, digest
     `af0adf3076cc4df0613da6a448569e0e95011faec07d8a871a285266eeac247d`
   The hermetic test pins all four values, the date and the digest.
4. **Verdict window (Step 4).** 12 pair attempts (arm order alternating, settle
   ≥120 s), 24 arm runs, 15 valid, 5 valid pairs; 9 runs refused V3 (cold stall
   share above the frozen maximum). `decideVerdict` = FINDING ("6 of 6 valid runs
   exceed the thresholds on the self-inflicted latency; window cause unattributed");
   `decidePairs` = NOT-REPRODUCED (median boot excess −794 ms against 250 ms).
5. **Record and resolve (Step 5).** `49-MEASUREMENT.md` (calibration with per-attempt
   numbers, window with per-run numbers, residue/secrets/deviations) and
   `49-RESOLUTION.md` are written; `docs/integration/omp.md` matches.

## What the verdict means here
Every one of the 6 valid after-arm runs breaches on the attach-window shortness
problem (40 probes x 250 ms = 9749-9751 ms against the 10000 ms minimum); no other
problem fires on them. Their latencies are low and responsive: self-inflicted
17.8-96.8 ms maximum, 10.8-14.9 ms p95 (raw 18-100 / 11-15 ms). The FINDING is
shortness-driven, not latency-driven. OMPV-04 is MET on the frozen bound; per
D-49-1, OMPR-01, OMPR-06 and OI-11 closed on the FINDING with the 5 valid pairs the
rule needs. nothing is labelled met on VOID, a probe, or inference. Residue zero
at every snapshot; secret search clean; evidence outside the repository.

## Files (this phase, committed)
- `test/support/omp-contention.test.ts` — six bracket cases (Step 2; no source
  change).
- `test/support/omp-calibration.ts`, `test/support/omp-calibration.test.ts` — the
  freeze (Step 3).
- `.planning/phases/49-omp-calibration-repeat/49-CALIBRATION.md` — feasibility
  restatement (Step 1).
- `.planning/phases/49-omp-calibration-repeat/49-MEASUREMENT.md` — measurement
  record (Step 5).
- `.planning/phases/49-omp-calibration-repeat/49-RESOLUTION.md` — resolution
  (Step 5).
- `docs/integration/omp.md` — the Phase-49 outcome paragraph.
- This summary (`49-SUMMARY.md`).

Reference rather than owned: `test/integration/omp-responsiveness.test.ts`,
`test/support/omp-window-analysis(.test).ts`, `test/support/omp-verdict(.test).ts`
read as the ruling code.
Live-window commands and gate variables for the window as run are the gate list
(`REALM_LIVE_OMP=1`, `REALM_LIVE_OMP_RESPONSIVENESS=1`, `REALM_LIVE_PRODUCTION=1`,
`REALM_LIVE_IMAGE`, `REALM_LIVE_DRIVER_CONFIG`, `REALM_DRIVER_SOCKET`,
`REALM_OMP_BIN`, `REALM_OMP_PAIRED_ARM`, `REALM_OMP_PAIRED_PAIR`,
`REALM_OMP_EVIDENCE_DIR`) plus the scrubbed environment (HOME, TMPDIR, PATH =
podman-5 directory first, XDG_RUNTIME_DIR and the session bus) as recorded in
`49-MEASUREMENT.md`.

## Deviations from the plan, stated
- Step 2's fix is "not needed": the hermetic cases pass on the pre-fix tree, so
  `attributeInterval` was untouched. Nothing was fabricated: the summary records
  the absence of red-first failures as the finding it is.
- The window driver's job bound cut the closing snapshot; it was taken immediately
  after and recorded as such. The run copy is the frozen commit for the verdict
  window (same harness code as the calibration copy, digests identical except
  `omp-calibration.js`).
- Arm runs executed from a single tree (both arms measured from the frozen commit;
  no before-code tree exists in this phase; the paired value read is recorded as
  boot excess, not as a product-change effect).

## Verification (the checks of the assignment, as run)
- `npm run build` (emits under the container's missing `@types/node`; the same
  emission the live runs used) and the hermetic suite
  `node --test` over the contention, window-analysis, calibration and verdict
  tests at the frozen tree: **102 tests, 102 pass, 0 fail**.
- Red-first proof: not applicable as an all-pass (recorded above; the cases pin the
  recorded failure shapes and they pass pre-fix, so there was nothing to fix
  red-first against).
- Live window: exactly one decision-table outcome by `decideVerdict` (FINDING) with
  the second rule NOT-REPRODUCED; residue zero (scopes 2→2, Omp processes 0,
  policy hash unchanged; one transient daemon blip from another phase at the
  closing snapshot, recorded); no host-local path in committed files (asserted in
  the docs); secret search clean (evidence and committed files).

## Voice of the window
[INFERENCE] nothing about the product is claimed by the word FINDING alone; what the
records contain is that the boundary the rule drew was crossed on window
shortness while latency stayed low. The paired rule shows no before/after effect
ever existed to reproduce between these two runs of the same tree.
