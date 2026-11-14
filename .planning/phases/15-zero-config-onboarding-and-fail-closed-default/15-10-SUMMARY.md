---
phase: 15
plan: 10
subsystem: live-verification
tags: [live, checkpoint, driver-roots, doctor]
requires: ["15-07", "15-08", "15-09"]
provides:
  - "L-A: live suite 37/37, roots from REALM_LIVE_DRIVER_CONFIG (15-10-L-A.txt)"
  - "L-B: live suite 37/37 on candidate driver; doctor runtime items pass (15-10-L-B-A.txt, 15-10-L-B-doctor.json)"
affects: [docs/integration/openshell.md]
key-files:
  created: []
  modified: []
decisions:
  - "D4: scenario 1 (no mode key) asserts fail-closed; subtest passes (15-10-L-A.txt:3-4)"
requirements: [ONB-03, ONB-04, ONB-07]
metrics:
  tasks: 0
  commits: 0
status: evidence-recorded-with-gaps
---

# Phase 15 Plan 10: live checkpoints L-A and L-B (ONB-03, ONB-04, ONB-07) Summary

L-A and L-B have TAP evidence with `# fail 0`; the doctor JSON shows the three runtime items passing. Two gaps: no mode JSON line in L-A, and no driver-start or restore record in any 15-10 file.

| Checkpoint | File | Evidence (from file) | Verdict |
| ---- | ---- | ---- | ---- |
| L-A | 15-10-L-A.txt | tests 37, pass 37, fail 0, skipped 0 | PASS (`# fail 0`; exit code not in file) |
| L-B rerun | 15-10-L-B-A.txt | tests 37, pass 37, fail 0, skipped 0 | PASS (`# fail 0`; exit code not in file) |
| L-B doctor | 15-10-L-B-doctor.json | 14 items; runtime-roots, driver-socket, gateway `pass` | PASS |

Doctor ran with no daemon ("ran 14 local checks", 15-10-L-B-doctor.err); non-pass items are `warn` only. Host-path grep is clean on all three files; no environment, unit or key value found.

## Gaps

1. `"mode":"fail-closed"` is NOT in 15-10-L-A.txt; only the subtest name (lines 3-4). The literal verify check fails.
2. No 15-10 file holds the driver `listening on` line (L-B step 6), the unit `ExecStart`, or the restore record (step 9).

## Earlier attempts (history, none accepted)

- attempt1, attempt2, attempt3-main: 14 tests, 2 pass, 12 fail; OPENSHELL_START_FAILED.
- prev, run-flaky11: 36/37 (scenario 11 fails): AGENTOS_STOP_FAILED; AGENTOS_CRASH_LOOP.
- capture-1: 36/37 (scenario 13 fails): SCHEMA_INVALID.
- L-A-keep: 37/37 with 13 unredacted `/tmp/rlv-*` paths (keep-state run).
- L-A-after-keep-residue: interrupted, no TAP summary. L-B-A-broken-attempt: 14 skipped; REALM_DRIVER_SOCKET not absolute.
- 37/37, not designated: L-A-clean-run1, L-A-11-rerun, L-A-tmp, L-B-A-prev.

## Deviations

1. Mode line: literal check fails; needs a live re-capture, not done here.
2. Driver and restore: per orchestrator facts, the candidate driver was installed then restored; the host kept main build `1ddfc45` with the edited unit (roots removed, XDG_CONFIG_HOME set). Plan step 9 says restore the saved unit and previous `app`. Owner decision pending.
3. Baseline: plan cites ten scenarios and 33/33 assertions (2026-10-30); files show 14 top-level tests and 37 TAP results. Not comparable; reported, not accepted silently.
4. L-A "two clean runs": four files show 37/37; designated file is L-A.txt.
5. Keep-state residue cleaned before accepted runs. omp 18.20.0 vs 18.12.6: no omp step in these files.

## Not verified

Process exit codes; live driver binary identity and unit contents after restore. Known stubs: none. Threat flags: none.
