---
phase: 15
plan: 12
subsystem: doctor
tags: [doctor, fix, onboarding, descriptor-pinning, ONB-02]
requires: ["15-10"]
provides:
  - "realm doctor --fix safe subset: state dir, run, sessions; descriptor-only mode changes; refusals before first write"
affects: [src/doctor/fix.ts, test/doctor/fix.test.ts]
key-files:
  modified:
    - src/doctor/fix.ts
    - test/doctor/fix.test.ts
commits: [0f141fe]
requirements: [ONB-02]
status: "code and tests present at HEAD; unit-test pass NOT VERIFIED; live repair behaviour observed in 15-15 L-C"
---

# Phase 15 Plan 12: realm doctor --fix safe subset (ONB-02) Summary

The shipped `doctor --fix` scope matches the plan: state directory, `run`, `sessions`, descriptor-pinned mode changes. The plan's tests and static guard are in the tree. No test run is on record, so pass/fail of the unit tests is not verified here.

## Tasks

| Task | Name | Commit | Result |
| ---- | ---- | ------ | ------ |
| 1 | refusal and scope tests in test/doctor/fix.test.ts | 0f141fe (single phase commit, also carries ONB-01) | tests present; `node --test` run NOT VERIFIED |
| 2 | static guard: mode changes only through pinned descriptors | none (no edit; checked by grep) | PASS by grep, see below |

## Evidence per truth (15-12-PLAN.md must_haves)

- Repair scope, 0700, create missing: fix.ts targets state dir, `run`, `sessions` (plan cites fix.ts:65-84). Live: `15-15-LC-transcript.txt` lines 30-42 show the scratch state dir going 755 to 700, `run` and `sessions` created at 0700, `fix exit=0`. Scratch host only.
- Second run and dry run: transcript line 35-36 dry run exit 0, same three actions as the real run (line 41), state still 755 afterwards. Line 43-44: second run `"fixes":[]`, exit 0.
- Refusals decided before any write: tests at `test/doctor/fix.test.ts:520` (empty HOME), `:534` (run symlink to workspace), `:548` (regular file at run). No live refusal evidence exists. Pass NOT VERIFIED.
- Descriptor-only changes: `grep -En "(^|[^f])chmodSync\(" src/doctor/fix.ts` finds no match; `O_NOFOLLOW` at fix.ts:174; `fchmodSync(pin.fd` at fix.ts:230. Observed on HEAD.
- Build identity: fix.ts and fix.test.ts at HEAD are identical to 1ddfc45, the build the host kept, so the live transcript exercised this code.

## Verification

- Not run (contract forbids tests). No file under `/home/realmlive/realm-evidence/phase15/` is named 15-12.
- NOT VERIFIED: `npm run build && node --test dist/test/doctor/fix.test.js` exit 0; the four new tests passing; any live refusal case; the plan's "no existing fix test changed its assertions" (the 0f141fe test diff removes only the import line).

## Deviations from Plan

1. Titles differ from the plan's suggested titles. Committed: "a run symlink that resolves to the workspace ..." and "a file inside the state directory keeps its mode and bytes after a repair". Same behaviour asserted.
2. Five tests were added, not four. Extra: "a missing state directory in an unwritable parent is refused alike by dry run and repair" (end of file, `LOCKED_SKIP`).
3. fix.ts changed, which the plan did not list (plan allowed a change only for a defect). 0f141fe adds `canCreateEntry` (access(2) through the pinned fd) and refusal detail `unwritable-parent`, +17/-3. No reason is recorded beyond the commit message.
4. The 15-15 transcript is the L-C run. Its steps 1-4 (init, up, status, down) include the attempt-1 POLICY_DENIED lines (transcript :17-22) and the config/policy restore. The doctor steps (:28-45) make no omp call, so omp 18.20.0 (plan expected 18.12.6) and the P15-O4 driver change do not affect them.

**Total deviations:** 5; items 2 and 3 change scope beyond the plan.

## Issues Encountered

None recorded for this plan.

## Known Stubs

None.

## Next Phase Readiness

- Before this plan can close: run `npm run build && node --test dist/test/doctor/fix.test.js`, save the output under the evidence directory, and record exit 0.
- Plan 15-13 owns the exit-1 assertion for refusals.

---
*Phase: 15-zero-config-onboarding-and-fail-closed-default*

## Self-Check: NOT VERIFIED (unit tests not run; live repair evidence only)
