---
phase: 15
plan: 15
subsystem: onboarding-live
tags: [live-checkpoint, init, up, status, down, doctor-fix]
requires: ["15-13", "15-14"]
key-files: {created: [], modified: []}
requirements: [ONB-01, ONB-02]
metrics: {tasks: 1, commits: 0, completed: 2026-11-13}
status: transcript-returned-acceptance-not-met
---

# Phase 15 Plan 15: live checkpoint L-C (ONB-01, ONB-02) Summary

The human ran L-C on the realm account and a scratch host (transcript 15-15-LC-transcript.txt in the phase evidence directory); no repository file is written. Init, up, attempt-2 status and down passed; attempt-1 status and down were POLICY_DENIED. Policy restore hash and redaction are open.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | L-C live procedure (human checkpoint) | none | none |

## Results

- Gate, lines 1-2: `gate: passed`; owner decision paraphrased (deviation 5). L-A, L-B: 15-10-L-A.txt and 15-10-L-B-A.txt, 37 pass, 0 fail each (lines 229-230).
- Step 1, lines 4-10: state, `secrets`, `sandboxes` 700; config 1838f4c8..., policy e46ee5...; moved aside. PASS.
- Step 2, lines 12-13, attempt 1: init exit 0, `"mode":"fail-closed"`. PASS; file modes 0600 not recorded.
- Step 3, attempt 1, lines 15-22: up exit 0, active, PASS. Status exit 1 and down exit 1, both POLICY_DENIED: FAIL.
- Step 4, attempt 1, lines 24-26: originals back; hashes match step 1. PASS.
- Step 5, lines 28-47: init exit 0; state forced 755; dry run exit 0 `"dryRun":true`, state 755; real run exit 0, state 700; repeat exit 0 `"fixes":[]`; scratch deleted. PASS.
- Attempt 2, lines 48-65: init exit 0 (52-53); up exit 0 active, `"mode":"fail-closed"` (55-56); status exit 0, `"mode":"fail-closed"` (57-58); down exit 0, state `unbound` (59-60); restore (62-65). PASS.

## Verification

Read-only check; the plan's automated verify and `npm run check:docs` were not run. Gate, attempt-2 init/up/status/down, doctor and config restore PASS. Policy restore NOT MET (deviation 2); no host-local path NOT MET (deviation 4).

## Deviations from Plan

1. Attempt-1 status and down returned POLICY_DENIED (lines 17-22), recorded, not hidden. Attempt 2 (line 48: run from the pinned workspace) passed. Attempt-1 working directory not recorded.
2. Policy hash: step 1 recorded e46ee5...; attempt-2 restore shows e66c7871... (line 64), the value L-D uses as its original (15-16-L-D-evidence.txt:60). The attempt-2 step-1 hash is not recorded; the change is unexplained. Config hash unchanged. Shared fact: L-C2 config and policy were restored after L-D.
3. Step 5 real run listed two extra `create-directory` fixes (`state/run`, `state/sessions`, 700) beyond the expected set-mode (lines 37-41). Not repeated in attempt 2.
4. Redaction incomplete: 18 lines still contain host-local home paths (e.g. 12, 28, 31-45, 55-59). Re-redact before accepting as REALM_LC_TRANSCRIPT.
5. The gate line paraphrases the owner's answer; the plan requires the decision text. Not verified.
6. Not recorded: init file modes, secret and sandbox modes after restore, aside path, explicit daemon exit after down. Line 66 `containers=0 sandboxes=1` unexplained.
7. Not applicable to L-C: omp 18.20.0 (L-D), keep-state residue (L-A/L-B). P15-O4 applies to L-B; L-C made no host change beyond the step 1 and 4 moves.

## Known Stubs

None. Threat flag: unredacted host-local paths in the transcript (deviation 4).

## Next Phase Readiness

15-16 may use the init, up, status and down output after re-redaction and explanation of deviation 2.

---
*Phase: 15-zero-config-onboarding-and-fail-closed-default*
*Completed: 2026-11-13*

## Self-Check: FAILED (deviations 2 and 4)
