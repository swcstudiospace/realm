---
phase: 38-omp-responsiveness-during-cold-attach
plan: "01"
status: complete-outcome-void
requirements: [OMPR-01, OMPR-02, OMPR-03]
completed: 2026-11-19
window: "2026-11-18 23:32 UTC to 2026-11-19 01:18 UTC, production stack, account realmlive, rootless Podman 5.7.1, shared live lock, six attempts"
---

# Plan 38-01 summary: the decision rule, the harness diagnostics, the quiet-host window and the recording

Tasks 1 and 2 (code and tests) landed in PR 189. Tasks 3 to 5 (the window) were run by a person outside this repository under the owner's authorization of 2026-11-18, and the owner chose to wait for quiet slots (HITL 2026-11-18). Task 6 (this recording) ran afterwards from the person's evidence, which is kept outside the repository.

## Outcome

**VOID.** Six attempts (the plan's maximum), one valid run; the frozen rule (38-CONTEXT D-38-02) needs three. OMPR-01 is not met. No verdict on the cold attach; plans 38-02 and 38-03 do not run. OI-11 is recorded `Carried (no quiet slot)`. The status of UI-01 is the owner's call.

## Numbers

| N | Start (UTC) | Valid | Reason when not valid |
| --- | --- | --- | --- |
| 1 | 2026-11-18 23:32 | yes | none |
| 2 | 2026-11-18 23:44 | no | host not quiet at the control and cold-attach readings (1.58 per CPU) |
| 3 | 2026-11-18 23:52 | no | baseline failed on a quiet reading (maximum 1388 ms, 95th percentile 1001 ms); host not quiet later (1.02 per CPU) |
| 4 | 2026-11-19 01:00 | no | baseline failed twice (95th percentile 512 ms and 791 ms); cold attach did not start |
| 5 | 2026-11-19 01:08 | no | baseline of the cold-attach test failed (maximum 1587 ms, 95th percentile 1312 ms); cold attach did not start |
| 6 | 2026-11-19 01:17 | no | baseline failed (95th percentile 599 ms); host not quiet at the cold-attach reading (1.15 per CPU) |

The valid run (attempt 1): 151 probes over 37500 ms, 141 answered, 10 unanswered, maximum 9906 ms, median 201 ms, 95th percentile 8213 ms, longest gap 12498 ms, `realm active` reached; control first answer 9394 ms, cold-run first answer 12498 ms, boot excess 3104 ms; serving problems (maximum 1403 ms, 95th percentile 705 ms); Omp ready 11320 ms, first realm status paint 11396 ms, last paint and `realm active` 37804 ms; case `serving-stall`. Controls that ran answered first at 9394, 15396, 10616 and 10892 ms from process start. Residue after every attempt: 0 containers, 0 sandboxes, empty workspace, no daemon. Full detail: `38-MEASUREMENT.md`.

## What changed in the recording

- `.planning/phases/38-omp-responsiveness-during-cold-attach/38-MEASUREMENT.md` (new): host facts, every attempt, the valid run, the controls, the decision and its hand cross-check (they agree), the OI-11 label.
- `docs/integration/omp.md`: a dated paragraph after the Phase 36 re-verification paragraph of the UI-01 detail, and the evidence cell of row UI-01 cites the measurement and its outcome; the status word is unchanged.
- `.planning/milestones/v5.0-phases/36-live-re-verification-of-v1-0-open-items/36-DISPOSITIONS.md`: one appended dated line under Part C (OQ-38-02); no earlier line edited.
- `38-VERIFICATION.md` (new).
- No file under `src` changed, no threshold changed, no `CHANGELOG.md`, ROADMAP, STATE or REQUIREMENTS edit.

## What follows

Plans 38-02 and 38-03 do not run (frozen rule: VOID). Not recorded: the commit under test (the evidence holds none), and the three 60-second quiet-wait readings per attempt (the waiter log holds one reading per attempt start). Observations for the owner, not verdicts: the extension-free baseline missed its 95th percentile bound in five of nine runs at 0.17 to 0.36 load per CPU, and every control answered its first probe 9394 to 15396 ms after process start.

## Checks run

`npx tsc -p tsconfig.json`; `classifyRun` and `decideWindow` applied to the recorded samples of attempt 1 from the built tree (outcome VOID, case `serving-stall`, matching the record); the checks listed in the recording report.
