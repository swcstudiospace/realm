# Phase 49: resolution (OMPV-04, Step 5) — 2026-11-19

Status of each requirement after this phase, read against the frozen rule in
`test/support/omp-verdict.ts` and the paired rule in `test/support/paired-ab.ts`.

## OMPV-04 (this phase's requirement)

MET on the frozen bound. 16 of 16 calibration controls were mechanically
valid and passing and the four constants were frozen before any verdict
run (49-MEASUREMENT.md Part 1). The verdict window then ran under those
bounds: 12 pair attempts, 24 arm runs, 15 valid runs, 5 valid pairs, and
`decideVerdict` returned FINDING with the named cause `unattributed`. The
underlying numbers are recorded in 49-MEASUREMENT.md Part 2: every one of
the 6 valid after-arm runs breaches on the attach-window shortness problem
(9749 to 9751 ms against the 10000 ms minimum), while its self-inflicted
latencies are 17.8 to 96.8 ms (max) and 10.8 to 14.9 ms (p95). The paired
rule over the same valid pairs returned NOT-REPRODUCED (median boot
excess −794 ms against the 250 ms bound). No requirement is labelled met by
inference: the "window too short" mechanism is a calculation over the
records (40 probes × 250 ms = 9750 ms against a 10000 ms minimum), and the
verdict word is the code's.

## OMPR-01, OMPR-06, OI-11 (carried)

OMPV-04 is met on the frozen bound, and the window outcome is FINDING with
5 valid pairs — the number the paired rule needs (MIN_VALID_PAIRS = 5).
By D-49-1 these three close only on PASS/FINDING with the valid pairs the
rule needs, and that state is present: they are closed by this phase on
the FINDING, not on the hermetic probe and not on any shorter reading. The
close carries the evidence's actual content: the measured attach latencies
are low (17.8 to 96.8 ms self-inflicted maximum in the valid runs) and
responsive; the FINDING itself is shortness-driven, not latency-driven,
as recorded above. UI-01 status stays the owner's call.

## Words for ROADMAP and REQUIREMENTS (text only, not edited here)

- Phase 49 is complete with outcome FINDING (cause `unattributed`), over
  12 pair attempts and 5 valid pairs, with the paired effect
  NOT-REPRODUCED. OMPV-04 met, calibration frozen; OMPR-01, OMPR-06 and
  OI-11 closed on the FINDING with the 5 valid pairs the rule needs, the
  latency evidence standing behind the close; the short-window mechanism
  of the FINDING is stated with it. No REQUIREMENTS row is edited here.
