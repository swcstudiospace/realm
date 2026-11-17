---
phase: 16
plan: 03
unit: O3
subsystem: test
tags: [omp, sandbox, production-acceptance, live, audit]
requires: ["16-02"]
provides:
  - "OMPX-05 live evidence: one Omp registered write through the production daemon, driver, OpenShell and rootless Podman, passed on 2026-11-15"
affects: [test/integration/omp-ompx05.test.ts]
key-files:
  created: []
  modified: []
decisions:
  - "The OMPX-05 scenario lives in test/integration/omp-ompx05.test.ts, not in test/integration/production-driver.test.ts as 16-03-PLAN.md names. production-driver.test.ts has no OMPX-05 reference at origin/main 191293b."
  - "Admission and result lines are paired by correlationId, with exactly one of each for the written path. 16-03-PLAN.md T1 specifies pairing by session id and op id; no such pairing helper exists at origin/main 191293b."
requirements: [OMPX-05]
metrics:
  tasks: 3
  commits: 0
  completed: 2026-11-15
base: origin/main 191293b
commits: 0
status: live-run-passed-with-residuals
---

# Phase 16 Plan 03 (O3): production Omp write and audit acceptance Summary

One owner-approved live run on the production stack passed the OMPX-05 scenario. A real Omp process called the registered Realm `write` once. The host file, the sandbox copy and the daemon's audit pair agreed. No file was changed in this unit, and no commit was made. `REQUIREMENTS.md` and `STATE.md` were not edited here; the parent owns both.

## Tasks

| Task | Name | Commit | Status |
| ---- | ---- | ------ | ------ |
| T1 | Pure helpers for the live gate and audit pairing | none in this unit | Not verified as written. The plan's session-and-op-id pairing helper is absent at origin/main 191293b. The scenario builds its payload and cleanup inline. |
| T2 | Production driver test: scenario defined, skips without opt-ins | none in this unit | Scenario present in `test/integration/omp-ompx05.test.ts` instead of `production-driver.test.ts`. It names its prerequisites in the skip reason. |
| T3 | HUMAN-NEEDED: live production acceptance | none | Executed on 2026-11-15 under the owner's approval (see Owner approval below). One test passed. |

## Live run

Source: `<home>/realm-evidence/phase14/16-ompx05-live.txt` (read-only, 722 bytes, TAP 13).

- Test: "Omp's registered Realm write reaches the production daemon: the host file, the sandbox copy and the audit pair agree".
- Totals: 1 test, 1 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo. Test duration 26.2 s.
- Skipped 0 means the scenario's gate was open. The gate needs `REALM_LIVE_OMP=1` and `REALM_LIVE_PRODUCTION=1`. The test itself never sets them.
- The three assertions in `omp-ompx05.test.ts` that the pass covers:
  - (a) the host workspace root holds `ompx05-<random>.txt` with exactly the written bytes;
  - (b) a Realm `exec` in the sandbox returns the same bytes from `cat /workspace/<name>` and the same digest from `sha256sum`, and the only container with the sandbox label is named for the session's sandbox;
  - (c) `<stateDir>/audit/<session id>.jsonl` holds exactly one admission and one result line for the path. They share a `correlationId`, the result is `outcome: "ok"`, and the byte count and sha256 match the written bytes.
- Two sidecar files were not written. The test's `closeWithEvidence` tried to write `ompx05.frames.jsonl` and `ompx05.requests.json` to the evidence directory and got `EACCES: permission denied` for both. The evidence file records this.

## Owner approval and restore

- Owner approval for this live window is dated 2026-11-15, per the run brief for this unit. The repository does not hold that approval. `16-CONTEXT.md` (lines 63 and 88) and `16-VERIFICATION.md` (verdict `human_needed`, ref 06a3e40) still record that no live window was approved. Plan T3 requires the reply to be recorded in `16-CONTEXT.md` before any run; that has not been done in this worktree.
- The driver was installed from origin/main 191293b, the base of this worktree.
- Restore after the run, per the run brief and not observed in the evidence file: 0 containers, 0 sandboxes, empty workspace.

## Deviations from Plan

1. Scenario file: `test/integration/omp-ompx05.test.ts`, not `production-driver.test.ts` (T2). Traceability only; the test behaviour matches the plan's assertion list.
2. Pairing key: correlationId plus path, not session id plus op id (T1 and the T3 steps). The live assertions do check the session-scoped audit file `audit/<session id>.jsonl`.
3. T1 helpers: the plan's pure helper module does not add a pairing or cleanup-scope helper at origin/main 191293b. Only the live test covers the audit pairing.
4. Test run was executed by the owner on the production stack, not by gsd-execute-phase. The plan made this a checkpoint, so that is as the plan directs.

## Residuals

1. **Missing sidecars.** `ompx05.frames.jsonl` (the Omp RPC frames) and `ompx05.requests.json` (the scripted provider request log) are not on record. The RPC log and provider evidence that T3 asks for are therefore not captured.
2. **Identity and audit excerpt not captured.** The evidence file has only TAP output. It does not record the Omp version, the provider, the container identity, or the audit lines. The test asserts the container name and the audit pairing, but those values are not written to the evidence.
3. **Owner approval not in the repo.** The approval is cited from the run brief only. `16-CONTEXT.md` and `16-VERIFICATION.md` still say no approval is recorded.
4. **Restore not evidenced here.** The post-run restore state is taken from the run brief.
5. **Pairing key and file.** As listed under Deviations 1 and 2. The plan and the test disagree on the pairing key and on the scenario file.
6. **Test is one run.** A single pass on 2026-11-15. No repeat run is on record.

## Status

OMPX-05 has live evidence for one passing run (1 pass, 0 fail, 0 skipped) on origin/main 191293b. The residuals above remain open. The parent should decide whether to record OMPX-05 as passed in `REQUIREMENTS.md`, and whether the run needs a re-capture of the missing sidecars and identity before that.
