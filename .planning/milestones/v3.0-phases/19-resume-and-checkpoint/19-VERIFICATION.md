---
phase: 19-resume-and-checkpoint
verified: 2026-11-16
verdict: passed
status: passed
score: 5/5 roadmap criteria verified; 6/6 plan must-haves (one by owner-accepted override)
ref: gsd/phase-19-close at origin/main b23684e (PR 91 and PR 92 merged) plus two uncommitted working-tree edits (docs/integration/openshell.md, src/runtime/agentos.ts); live product code 2ff6df9
behavior_unverified: 0
overrides_applied: 2
overrides:
  - must_have: "The reaper and scratch mount decisions precede the code that depends on them in the actual integration ancestry (plan truth 1): D19-2 and D19-5 to D19-10 and the stopped-project item 7 were recorded in the same commit as, or after, the code they describe"
    reason: "D5 (0d299a0) is a strict ancestor of every dependent code commit and D19-1 has an owner ruling; the later D19 entries refine already-decided behavior and history cannot be changed"
    accepted_by: "owner"
    accepted_at: "2026-11-16"
  - must_have: "Production live scenario 12 (a scratch file survives a daemon restart) passes without failure on the integrated tree: it failed once in run 1 of the 2ff6df9 product code, cause unproven"
    reason: "Known gap accepted: 13 of 14 full-suite files and 9 of 9 isolated runs pass, the test sequencing was hardened by PR 92, and the mechanism is not proven"
    accepted_by: "owner"
    accepted_at: "2026-11-16"
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/ROADMAP.md"
  - ".planning/phases/19-resume-and-checkpoint/19-01-PLAN.md"
  - ".planning/phases/19-resume-and-checkpoint/19-01-SUMMARY.md"
  - "docs/checkpoint.md"
  - "docs/integration/omp.md"
  - "docs/integration/openshell.md"
  - "docs/integration/runtime-decision.md"
  - "docs/integration/workspace-snapshot-spike.md"
  - "src/cli/checkpoint.ts"
  - "src/daemon/daemon.ts"
  - "src/daemon/main.ts"
  - "src/daemon/sessions.ts"
  - "src/daemon/startup.ts"
  - "src/runtime/agentos.ts"
  - "src/runtime/driver/lifecycle.ts"
  - "src/runtime/driver/registry-rebuild.ts"
  - "src/runtime/hardening.ts"
  - "src/runtime/libpod-client.ts"
  - "src/runtime/session-execution.ts"
  - "src/session/checkpoint.ts"
  - "src/session/reap.ts"
  - "test/cli/checkpoint-stopped.test.ts"
  - "test/daemon/session-health-reattach.test.ts"
  - "test/integration/production-driver.test.ts"
  - "test/runtime/driver/restart-adoption.test.ts"
  - "test/runtime/driver/scratch-volume.test.ts"
  - "test/session/checkpoint.test.ts"
  - "test/session/reap.test.ts"
covered_digest: "v3:sha256:95315c4739065146b427b608c73493b83fb233acc6080815899174ebbdf17110"
---

# Phase 19: Resume and checkpoint: Verification at b23684e

**Goal:** A daemon crash or restart no longer destroys a good sandbox or its files, and an operator can keep scratch data and roll a workspace back to a snapshot.

**verdict: passed.** All five roadmap success criteria have static code evidence and non-skipped live TAP evidence on the integrated tree, and RES-01 to RES-05 are covered. Nothing is FAILED and nothing is behavior-unverified. Two owner-accepted gaps (2026-11-16) are carried as overrides: the single scenario 12 failure, whose cause is unproven, and the D19 decision-ordering deviation. Planning-record mismatches (G3 to G8) are listed as residuals and do not change the verdict, as the Phase 15 report treated its residuals.

**Method.** Worktree `<tmp>` at `origin/main` b23684e (branch `gsd/phase-19-close`; PR 92 is merged), with uncommitted edits in `docs/integration/openshell.md` and `src/runtime/agentos.ts`. Static reads and greps of source, tests and docs. Git history read with `git -C <tmp>`, including `git merge-base --is-ancestor` for every decision/code pair named below. The live TAP files were read read-only from `<home>/realm-evidence/phase14/`: `19-live-2ff6df9.txt` (run 1), `19-live-2ff6df9-r2.txt` (run 2), `19-live-live12-a.txt`, `19-live-drvrestart-10.txt`, `19-live-live12-loop-1.txt` to `-8.txt`, `19-live-full3-1.txt` to `-3.txt` and `19-live-settle-1.txt` and `-2.txt`. No evidence file was copied into the repository. No tests, build, lint, typecheck, formatter or `check:docs` were run. One read-only query was run to compute `covered_digest`: `gsd_run query verification.fingerprint <phase dir> <covered files>`, which hashes file contents and wrote nothing (`git status` was unchanged). The Phase 15 report carries no `covered_digest`, so the method comes from the GSD verifier procedure and the Phase 12 and Phase 17 reports, which carry `v3:sha256:` digests. `19-01-SUMMARY.md` is untracked at the time of writing and is part of the digest, as are the two uncommitted edits; if any covered file changes, the digest is stale. The digest was recomputed after PR 92 and the working-tree edits. Nothing was committed. Line numbers are at b23684e plus the working tree.

**Entry gates.** Plan 19-01 requires Phase 14 and Phase 18 to have passed. `14-VERIFICATION.md` (verified 2026-11-14) and `18-VERIFICATION.md` (verified 2026-11-15) both record `status: passed`. They were not re-verified here.

**Drift since the live product code.** The live product code is `2ff6df9`, an ancestor of HEAD. `git -C <tmp> diff --name-only 2ff6df9 HEAD` lists four files: `docs/integration/omp.md`, `docs/integration/openshell.md`, `scripts/check/export-usage-allowlist.json` and `test/integration/production-driver.test.ts`. The test change is PR 92 (`40a0aec`, `settleBeforeScenario`, 31 insertions and 1 deletion, test file only): each scenario waits until the driver runs no host supervisor before it starts (`production-driver.test.ts` l.213-238, l.247; `assertActive` awaits it). No file under `src` changed in a commit. The working tree changes two comments, not behavior: `src/runtime/agentos.ts` l.14-15 and `docs/integration/openshell.md` l.636. So the live results apply to the product code read here. The TAP files name the build only through their file names and `19-01-SUMMARY.md`; the compiled tree that ran is not a git checkout reachable from this report, so the build identity rests on the operator's record (residual R4).

## Goal Achievement: Roadmap Success Criteria

Criteria text: `.planning/ROADMAP.md` l.521-525. Line numbers into `test/integration/production-driver.test.ts` are at b23684e (PR 92 added 30 lines before scenario 5).

| # | Criterion | Status | Evidence at b23684e (working tree) |
| --- | --- | --- | --- |
| 1 | `runtime-decision.md` records the reaper decision and the RT-01 mount-list amendment for the scratch volume in a commit that precedes the code that needs them (RES-01) | VERIFIED (the plan's stricter reading is PASSED (override), see Decision ancestry) | Commit `0d299a0` (2026-10-30, "record per-project sessions and the reaper decision before the code (#36)") adds the section "Startup reaper and scratch volume (Phase 19, RES-01)": the reaper decision, the adopted/orphan definitions, the no-orphan guarantee, and the scratch volume's name, mount, policy, lifetime and cleanup. The section is at `docs/integration/runtime-decision.md` l.511 today. `git merge-base --is-ancestor 0d299a0 <c>` exits 0 and the hashes differ for every first dependent code commit: `e355079` (reap.ts adoption, session-execution.ts verdict), `679aad0`, `b3411bc`, `15cf3a7` (driver and daemon cutover), `d7094b6` (scratch volume in hardening.ts, libpod-client.ts, lifecycle.ts), `59f0fc7`, `466f1b4` (registry rebuild), `4ba8ab4` and `2ff6df9` (restart of an adopted sandbox). |
| 2 | A live scenario kills the daemon and restarts it; the same container id is active with `/workspace` intact and no second container (RES-02, RES-05) | VERIFIED | Live: scenario 5 is `ok` at TAP l.167 in all seven full-suite files of the 2ff6df9 product code and after PR 92 (run 1, run 2, `full3-1` to `-3`, `settle-1`, `-2`), `skipped 0` in each. Code under test: `test/integration/production-driver.test.ts` l.629-727 lists the sandbox's containers before the kill (exactly one), SIGKILLs the daemon, restarts with `realm up`, asserts the one container is the same id (l.689), exactly one sandbox (l.691), `daemon.startup` adopted 1 and names the kept container, and reads the workspace marker back from inside the sandbox (l.713). Implementation: `src/session/reap.ts` `reapStartupSelective` l.96, adoption in `judge` l.156-191; `src/runtime/session-execution.ts` `verdictOf` l.514; startup call `src/daemon/startup.ts` l.153. Hydration after the gate: `src/daemon/daemon.ts` l.317-323 (pending sessions refused with `REALM_NOT_ACTIVE`), l.896-904 and l.916-918; test `test/daemon/daemon.test.ts` l.3388. |
| 3 | A container that fails the create-time verifier, and a container with no record, are removed at startup, and both outcomes are logged (RES-02, RES-05) | VERIFIED | Live: scenario 11 is `ok` at TAP l.215 in all seven files, no skip. It lowers the pids limit of the conforming container with `podman update`, kills the daemon, restarts, asserts a new container replaced it (l.1311), `containersRemoved` 1 and `recordsDeleted` 1, and `removedCauses` names the container with cause `pids-limit` (l.1320). Scenario 5 creates a stray container carrying the sandbox label and asserts `daemon.startup` names it among the removed (l.706-708) and that no record was deleted (l.707). Code: the removal cause is the failed verdict property or `"no-record"` (`src/session/reap.ts` l.72-74, l.189; `src/daemon/startup.ts` l.101 closes the cause set; l.296-297 write `removedCauses` and `adoptedContainerIds`). A removal counts only after a listing taken after all removals no longer holds the container (`reap.ts` `removeAndProve` l.202; `REALM_STOPPING` otherwise). Offline: `test/session/reap.test.ts` l.205 (no-record cause) and l.144 (verdict failure). The driver path logs each adopted and removed container (`test/runtime/driver/restart-adoption.test.ts` l.376). The live scenarios do not assert the `no-record` cause string for the stray; the offline test does. |
| 4 | A file written to the session-owned scratch volume beyond `/workspace` survives a daemon restart and is gone after `realm down` (RES-03, RES-05) | VERIFIED on the TAP evidence, with an unresolved risk (Gaps G1) | Live, scenario 5c `ok` at TAP l.173 in all seven full-suite files, no skip: asserts the volume is `realm-scratch-<sessionId>`, mounted read-write at `/scratch` with `noexec`, `nosuid`, `nodev`, labelled, the same container after the daemon kill, the mount unchanged (l.794), the bytes unchanged (l.797), and the volume gone after `down` (l.804). Scenario 12 (the scenario the criterion text describes, l.1337-1362) is `ok` at TAP l.221 in `2ff6df9-r2`, `full3-1` to `-3` and `settle-1`, `-2`; `ok` alone in `live12-a` and in `live12-loop-1` to `-8` (9 isolated passes, each `skipped 0`); and **`not ok` in run 1** (`19-live-2ff6df9.txt` l.221): `reading the scratch marker after the restart: exit 1; stdout ""; stderr "cat: /scratch/marker.txt: No such file or directory"`. Across all 14 full-suite TAP files on disk, scenario 12 passed in 13 and failed in 1. On the unchanged 2ff6df9 product code before PR 92 it passed in 4 of 5 full runs; after PR 92 it passed in 2 of 2. The cause is unresolved (G1). Code: `src/runtime/hardening.ts` `scratchVolumeNameOf` l.171, `SCRATCH_VOLUME_REQUIRED_OPTIONS` l.166, verifier properties l.198 and l.330-341; create body `src/runtime/libpod-client.ts` l.610; driver create/delete order `src/runtime/driver/lifecycle.ts` l.316-323 (volume before container), l.392-420 (container removed, then volume, proven by a listing); adoption keeps a kept sandbox's volume and removes unreferenced ones with proof, l.263-270 and `orphanVolumesOf` l.747. |
| 5 | The snapshot and restore commands return a modified workspace to its prior content byte for byte, using the mechanism a recorded spike chose (RES-04, RES-05) | VERIFIED | Spike: `docs/integration/workspace-snapshot-spike.md` (2026-11-03): reflink refused with "Operation not supported", no filesystem snapshot layer under `/`, a scripted full copy checked byte-exact with a manifest. Selection: D19-6, `runtime-decision.md` l.537, recorded in commit `966fdf7`, a strict ancestor of the first checkpoint library commit `c9a59d5` and the first CLI commit `47470e6`. Code: `src/session/checkpoint.ts` `snapshotWorkspace` l.166, `restoreWorkspace` l.174, `copyTree` l.782, `rollback` l.456, `quiesce` l.618; CLI `src/cli/checkpoint.ts` l.57 (`realm checkpoint create\|restore --workspace <path> --id <id>`), `pinStoppedProject` l.143. Live: scenario 13 is `ok` at TAP l.227 and `checkpoint-roundtrip` at l.239 in `2ff6df9-r2`, `full3-1` to `-3` and `settle-1`, `-2` (in run 1: l.245 and l.257), no skip. The round trip asserts bytes (`production-driver.test.ts` l.1593), mode (l.1594), nested file, deleted file returned, extra file removed, and the workspace root keeps its device and inode. |

**Score:** 5/5 criteria verified on the TAP evidence. Plan truth 1 is PASSED (override, owner 2026-11-16). No behavior-unverified truth remains.

### Live evidence read

| File | Product code and test | Result | Skips |
| --- | --- | --- | --- |
| `19-live-2ff6df9.txt` (run 1) | 2ff6df9 | 40 tests, 39 pass, 1 fail; the failure is `production live 12` (TAP test 14, location `production-driver.test.js` l.1075 in the compiled file). The exit code is not in the TAP | 0 |
| `19-live-2ff6df9-r2.txt` (run 2) | 2ff6df9 | 40 pass, 0 fail | 0 |
| `19-live-full3-1.txt` to `-3.txt` | same product code (per `19-01-SUMMARY.md`) | each 40 pass, 0 fail | 0 |
| `19-live-settle-1.txt`, `-2.txt` | PR 92 test (per `19-01-SUMMARY.md`) | each 40 pass, 0 fail | 0 |
| `19-live-live12-a.txt`, `19-live-live12-loop-1.txt` to `-8.txt` | scenario 12 alone, 9 files | 9 of 9: 1 test, 1 pass | 0 |
| `19-live-drvrestart-10.txt` | `production live 19 driver-restart` alone | 1 pass (29 s) | 0 |

The full-suite TAP files show 17 top-level tests, so each executed the whole production file, scenario 10 (gateway stop) included. The count of 40 includes the subtests of scenarios 1 and 3. Whether the whole-file runs were separately authorized is not shown in the evidence. `19-01-PLAN.md` Task 3's verify pattern names `19 verifier-failure` and `19 no-record`, which are not test names in `production-driver.test.ts`; the verifier failure is scenario 11 and the no-record removal is part of scenario 5 (Gaps G8). The `19-ctr-*` and `19-gwphase-*` capture files in the same directory were not read.

Across the 14 full-suite TAP files on disk (builds `ec31518` to `2ff6df9`, then `full3` and `settle`), scenario 12 passed in 13 and failed in 1, the first run on the 2ff6df9 product code. The seven older files failed `driver-restart` instead; that is fixed on 2ff6df9 by the 19-01 commits and passed in all seven later files.

## Plan 19-01 must-have truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | The reaper and scratch mount decisions precede the code that depends on them in the integration ancestry | PASSED (override, owner 2026-11-16) | See Decision ancestry: D5 and the scratch mount list precede every dependent commit; D19-1, D19-2, D19-5, D19-7 share a commit with their code, D19-9 and D19-10 follow it. |
| 2 | A verified survivor is retained by both startup owners; rejected and unrecorded containers are removed with proven absence and logged causes | VERIFIED | Daemon owner: `src/session/reap.ts` l.96, `src/daemon/startup.ts` l.153. Driver owner: `src/runtime/driver/lifecycle.ts` `adoptSurvivors` l.239-282 (inspect and verdicts before the first removal, removals proven by a second listing, orphan volumes proven, `REALM_STOPPING` otherwise); `src/runtime/driver/main.ts` l.271-275 runs adoption then `rebuildRegistry`; `startupSweep` and `removeAllSecrets` no longer exist in `src/runtime/driver` (grep). Live scenarios 5 and 11. |
| 3 | After maintenance the daemon serves before bounded hydration; a pending session is refused rather than duplicated | VERIFIED (static and offline) | `src/daemon/daemon.ts` l.317-323, l.896-918; `test/daemon/daemon.test.ts` l.3388 (pending refused with `REALM_NOT_ACTIVE`, hydrated one answers). The live TAP files contain no assertion on a pending refusal. |
| 4 | The exact scratch volume survives a daemon crash and is removed after sandbox teardown | VERIFIED (risk G1 open) | Criterion 4. |
| 5 | A stopped project's self-pinned workspace round-trips through the full-copy checkpoint CLI byte for byte | VERIFIED | Criterion 5; `src/cli/checkpoint.ts` l.143-148 and l.190-199 (pin in memory for an unregistered project, `bindWorkspaceUnderPolicy`, ceiling check); `docs/checkpoint.md` l.80 "Stopped projects"; `test/cli/checkpoint-stopped.test.ts` (19 tests); live `checkpoint-roundtrip` `ok` at TAP l.239 in the six later full-suite files and l.257 in run 1. |
| 6 | Each required real-stack scenario passes without a skip on the integrated tree; Phase 18 is passed first | VERIFIED on the latest files | Scenarios 5, 5c, 11, 12, 13, `19 driver-restart` and `19 checkpoint-roundtrip` are `ok` with `skipped 0` in the six full-suite files after run 1 (run 2, `full3-1` to `-3`, `settle-1`, `-2`). Run 1 failed scenario 12 and is recorded, not discarded. Phase 18 passed per its own report. The driver-restart scenario needs `REALM_LIVE_DRIVER_UNIT`; it ran (no skip) in every file. |

## Requirements Coverage: RES-01 to RES-05

| Requirement | Status | Evidence |
| --- | --- | --- |
| RES-01 | VERIFIED (D19 ordering: PASSED (override, owner 2026-11-16)) | The decision and the RT-01 mount-list amendment for the scratch volume are recorded in `0d299a0`, a strict ancestor of all dependent code (Decision ancestry). The requirement says "recorded before the code that needs them"; the later D19 refinements are amendments, not the original record. |
| RES-02 | VERIFIED | Static: `src/session/reap.ts` l.96-191, `src/runtime/session-execution.ts` `verdictOf` l.514 and shared `conformanceFailures` l.562 (the create path's `verifyOrRemove` l.448 uses the same checks), `src/runtime/driver/lifecycle.ts` l.239-282, `src/daemon/startup.ts` l.101 and l.296-297. Both outcomes are logged: `daemon.startup` fields `adoptedContainerIds`, `removedCauses`; driver lines per the round 13 ruling in the Phase 19 section of `runtime-decision.md` (`restart-adoption.test.ts` l.376). Live: scenarios 5 and 11 `ok` in every full-suite file. |
| RES-03 | VERIFIED, risk G1 open | Everything in criterion 4. Implementation, offline tests (`test/runtime/driver/scratch-volume.test.ts`, 11 tests), live scenario 5c `ok` in 7 of 7 full-suite files, and scenario 12 `ok` in 13 of 14 full-suite files and 9 of 9 isolated runs; the one failure is unexplained. |
| RES-04 | VERIFIED | Criterion 5. Residual R5: the spike's recorded host filesystem is ext4 on its own host; the live TAP files do not name the filesystem of the live workspace, so "chosen after a spike" on the target filesystem is shown by the recorded spike, and the live round trip passing is the only evidence for the live host. |
| RES-05 | VERIFIED, risk G1 open | Every named scenario is `ok`, no skip, in each of the six full-suite files after run 1: daemon kill with same container id (5), failed verifier removed (11), scratch survives (5c, 12) and is gone after `down` (5c, 12), snapshot then restore (13, `checkpoint-roundtrip`). Run 1 failed scenario 12 on the first build of the 2ff6df9 product code. The prior (superseded) scenario 5 observation recorded in `19-HELD-OWNER.md` is not used. |

## Amendment of the RT-04 / N1 no-automatic-restart rule

The rule as it stood: "one failed probe is terminal and there is no automatic restart; recovery is `realm down` then `realm up`, or the retry command" (`.planning/milestones/v2.0-REQUIREMENTS.md` l.107; code comment `src/runtime/agentos.ts` l.14).

The amendment is implemented and documented consistently in the places that carry the behavior, and left stale in four places that restate the old rule.

| Check | Result | Evidence |
| --- | --- | --- |
| The code implements a bounded re-attach, and only in the daemon health loop | CONFIRMED | `src/daemon/sessions.ts` `SessionReattachPolicy` l.233-240, `#tick` l.311-326, `#reattach` l.334-355: after `controller.probe()` moves the session to `error`, up to `attempts` restarts, each after `delayMs * attempt`, stopping at the first attempt that leaves `error`, when the daemon is stopping, or when another call moved the session on. The supervisor's own policy is unchanged (`src/runtime/agentos.ts` l.14-20 still holds the supervisor on a failed probe). |
| It is bounded and enabled in production only | CONFIRMED | `src/daemon/main.ts` l.55-57 (`HEALTH_REATTACH = { attempts: 3, delayMs: 10_000 }`, passed at l.107); `src/daemon/daemon.ts` l.126-129 and l.343-349 (`reattach` is `undefined` unless `healthReattach` is set); `sessions.ts` l.229 "Absent, a probe failure is terminal until an explicit retry". Offline: `test/daemon/session-health-reattach.test.ts` l.128, l.136, l.145 (success on the first working attempt, bounded attempts with growing waits, terminal without a policy). |
| It never creates or replaces a container | CONFIRMED by the comment and wiring (restart goes through the hydration path, `daemon.ts` l.896-904); the live driver-restart scenario asserts the same container list before and after (`production-driver.test.ts` l.1531) | `omp.md` l.138 states the same. |
| `docs/integration/omp.md` states the amended rule | CONFIRMED | l.138: "the supervisor itself never restarts and there is no hysteresis. The daemon's health loop then runs a bounded re-attach (plan 19-01, owner decision 2026-11-16): up to three attempts, waiting 10, 20 and 30 s ... the `error` state, the reason and the `realm disconnected` label are visible until an attempt succeeds, at least 10 s; once the attempts are spent the session stays in `error` until `realm up` or the `realm-retry` tool." `docs/integration/openshell.md` l.153 carries the driver-restart side. |
| Live evidence of the re-attach | CONFIRMED | The daemon's `requests.log`, read read-only from the daemon state directory, holds `health.reattach` with `attempt` 1 and `state` `active` for session `pda297968e47c` at `2026-11-16T12:57:38.400Z` (log l.9176), `13:10:12.329Z` (l.9474) and `13:36:30.307Z` (l.10030). Each is preceded by `lifecycle.transition` `error` to `connecting` to `active` (checked for the first), and their times fall in the `full3-1`, `full3-2` and `settle-1` live runs (TAP files written 12:58, 13:10 and 13:37). The log has 25 `health.reattach` lines in all; no `health.reattach_failed` line follows 11:30 that day (earlier lines, at 11:23 with code `SCHEMA_INVALID` and others, predate the 2ff6df9 product code and are not relied on). The log is host-local and not copied into the repository. |
| Visible-error window | PASSES, narrowly | Scenario 8 (runner kill, `AGENTOS_CRASH_LOOP`, then `down` and `up`) is `ok` at TAP l.191 in every full-suite file. It passes only because the poll catches `error` inside the 10 s before the first attempt (`19-01-SUMMARY.md` "NOT VERIFIED"). The owner accepted the re-attach on 2026-11-16 on the offline tests, the driver-restart scenario and these log lines. |
| Stale restatements of the old rule | PARTLY CORRECTED | Corrected in the working tree, not committed: `docs/integration/openshell.md` l.636 ("the daemon had no automatic restart when it was recorded (since 2026-11-16 the daemon's health loop runs a bounded re-attach; `docs/integration/omp.md`)") and `src/runtime/agentos.ts` l.14-15 ("this supervisor never restarts the runner ... Since 2026-11-16 the daemon's health loop, not this class, runs a bounded re-attach after a failed probe: SessionHealth"). Still stale: the archived `.planning/milestones/v2.0-REQUIREMENTS.md` l.107 (historical text of RT-04) and `.planning/ROADMAP.md` l.334, which records only the 2026-10-28 amendment. `src/daemon/sessions.ts` l.4-5 and l.20-21 cite N1 without the amendment, which is accurate for the first stage. |

## Decision ancestry (plan Task 1)

Each pair was tested with `git -C <tmp> merge-base --is-ancestor DECISION CODE` and a hash comparison.

| Decision | Text first appears in | First dependent code in the named files or feature | Relation |
| --- | --- | --- | --- |
| D5 reaper decision and scratch mount list (RES-01) | `0d299a0` 2026-10-30 | `e355079`, `679aad0`, `b3411bc`, `15cf3a7`, `d7094b6`, `59f0fc7`, `466f1b4`, `4ba8ab4`, `2ff6df9` | strict ancestor of all nine |
| D19-1 sandbox ownership labels (supersedes the `io.realm` adoption label clause) | `e355079` 2026-11-03 | `e355079` (the adoption verdict that checks the OpenShell labels) | **same commit**, not a strict ancestor |
| D19-2 scratch mount options `noexec`, `nosuid`, `nodev` | `59f0fc7` 2026-11-03 | `d7094b6` (scratch volume created), `59f0fc7` (options pinned) | after `d7094b6`, same commit as the pinning code |
| D19-5 startup cutover and registry rebuild | `466f1b4` 2026-11-03 | `15cf3a7` (driver cutover), `466f1b4` (rebuild) | after `15cf3a7`; same commit as `466f1b4` |
| D19-6 snapshot mechanism (full copy) | `966fdf7` 2026-11-03 | `c9a59d5` (checkpoint library), `47470e6` (CLI) | strict ancestor |
| D19-7 hydration pin and bounded hydration | `a8fa08d` 2026-11-03 | `a8fa08d` (`src/daemon/daemon.ts`, `src/lifecycle/controller.ts`) | same commit |
| D19-8 runner identity | `f2f64f5` 2026-11-03 | process-identity code `6b929f5` | strict ancestor of `6b929f5`; the runner-guard code itself was not traced |
| D19-9 checkpoint library decisions | `092c255` 2026-11-03 | `c9a59d5`, `47470e6` | **not** an ancestor of either |
| D19-10 workspace pin for stopped projects | `eb26673` 2026-11-04 | `47470e6` | **not** an ancestor |
| Stopped-project pin in memory (owner, 2026-11-08), item 7 | `455671a` (2026-11-08), reapplied in `21a3b17` (2026-11-15) | the same two commits (`src/cli/checkpoint.ts`) | same commit |

D5, the decision the requirement and criterion 1 name, precedes all dependent code. The D19 entries are refinements recorded in the same commit as, or after, the code they describe; they were not "before the code". On 2026-11-16 the owner accepted this ordering deviation (override 1 in the front matter), so it does not count against RES-01. The only recorded owner ruling on any D19 entry's ordering is D19-1 (`runtime-decision.md` l.519, 2026-11-06), which states that the phase 19 code was already on the branch and that the adoption clause was aligned to the OpenShell labels in the same change; it does not itself ratify D19-2, D19-5 to D19-10; the 2026-11-16 acceptance does. Timestamps and merge dates were not used as evidence.

## Required Artifacts

| Artifact | Status | Details |
| --- | --- | --- |
| `docs/integration/runtime-decision.md` | VERIFIED | Section at l.511 holds D5 and D19-1 to D19-10 (D19-1 l.517, D19-2 l.531, D19-5 l.533, D19-6 l.537, D19-7 l.539, D19-8 l.583, D19-9 l.585, stopped-project item 7 l.593, D19-10 l.603). |
| `docs/integration/workspace-snapshot-spike.md` | VERIFIED | Experiments 1 to 6, "Selected mechanism" l.131, "Quiescence rule" l.139, "Restore method" l.150, "Limits" l.164. |
| `src/session/reap.ts`, `src/runtime/session-execution.ts`, `src/runtime/hardening.ts`, `src/runtime/driver/lifecycle.ts`, `src/runtime/driver/registry-rebuild.ts` | VERIFIED | Substantive and wired: `reapStartupSelective` is called from `src/daemon/startup.ts` l.153; `adoptSurvivors` and `rebuildRegistry` are called from `src/runtime/driver/main.ts` l.271-275; `restartAdopted` is called from `registry-rebuild.ts` l.103. |
| `src/session/checkpoint.ts`, `src/cli/checkpoint.ts`, `docs/checkpoint.md` | VERIFIED | CLI registered in `src/cli/main.ts` l.51 and dispatched l.711. |
| `test/integration/production-driver.test.ts` | VERIFIED | Scenarios 5, 5c, 11, 12, 13, `19 driver-restart`, `19 checkpoint-roundtrip` present, all gated by `gate` (default `npm test` skips them); `settleBeforeScenario` (PR 92) l.213. |

## Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| `src/session/reap.ts` | `src/runtime/session-execution.ts` | `verdict` seam built by `adoptionVerdictOver` (`src/daemon/startup.ts` l.520-559) calling `verdictOf` | WIRED |
| `src/runtime/driver/lifecycle.ts` | `src/runtime/driver/registry-rebuild.ts` | `main.ts` l.271-275 passes `adoption.adopted` to `rebuildRegistry`; `registry-rebuild.ts` l.103 calls `lifecycle.restartAdopted` | WIRED |
| `src/cli/checkpoint.ts` | `src/session/checkpoint.ts` | `pinStoppedProject` l.143, `snapshotWorkspace` / `restoreWorkspace` at l.302 | WIRED |
| `src/daemon/main.ts` | `src/daemon/sessions.ts` | `HEALTH_REATTACH` l.57 and l.107, to `daemon.ts` l.343-349, to `SessionHealth` options | WIRED |

## Data-Flow Trace (Level 4)

| Value | Source | Real data | Status |
| --- | --- | --- | --- |
| `daemon.startup.removedCauses`, `adoptedContainerIds` | `reaped.removed`, `reaped.adopted` from the libpod listing and inspect (`src/daemon/startup.ts` l.296-297) | yes; the live scenarios read them back from `daemon.log` | FLOWING |
| Scratch mount shape the verifier reads | libpod inspect `Mounts` (`hardening.ts` l.330-341) | yes; scenario 5c compares the live inspect before and after the kill | FLOWING |
| Checkpoint manifest | tree walk of the pinned workspace (`checkpoint.ts` `copyTree` l.782) | yes; round trip compares bytes and modes | FLOWING |

## Anti-Patterns Found

Not scanned. No grep for debt markers, stubs or empty implementations was run over the covered files; only targeted reads were done. The stale-comment items under the RT-04 section are the only inconsistencies noted.

## Gaps and unresolved risks

**G1 (unresolved risk, owner-accepted known gap 2026-11-16): scenario 12 failure.** Run 1 of the 2ff6df9 product code failed `production live 12` with the marker absent after the daemon restart (`19-live-2ff6df9.txt` l.221-235). The cause was never established. What the evidence supports:

- Counts: 13 of 14 full-suite files and 9 of 9 isolated runs pass. On the unchanged product code before PR 92 the full-suite rate was 4 of 5; after the test-only PR 92 it is 2 of 2. Two passes cannot separate a fix from luck at a 1-in-5 earlier rate (the chance of two passes with no fix is about 0.64).
- Mechanism: `19-01-SUMMARY.md` states that the failing run's daemon log shows the reaper removed the survivor with cause `running` (the container was not running when the new daemon started), after a scenario that reused the same sandbox name, and that the driver journal shows the previous sandbox's host supervisor exiting seconds after that scenario's residue check. I did not read that log or journal; neither is among the evidence files read. The cause `running` is a verdict property in the code (`src/runtime/session-execution.ts` `verdictOf`), which by D5 is correct for a stopped container. Which actor stopped the container is not shown. The driver's exit handler is guarded by supervisor identity (`src/runtime/driver/compute-driver.ts` l.741-743, `this.supervisors.get(containerName) !== supervisor`), which is consistent with the summary's claim but does not prove a late teardown cannot reach a newer container of the same name.
- Hardening: PR 92 changes only `test/integration/production-driver.test.ts`. It makes the next scenario wait for the previous scenario's host supervisors. It removes a hypothesized test-ordering cause; it is not evidence that the product is free of one.
- Test gap that remains: scenario 12 asserts no container id and captures no `daemon.log`, so a repeat would again not say whether the container was adopted or replaced. Scenario 5c asserts the same container and passed in every full-suite file, including run 1.

This does not make a criterion PARTIAL, because the TAP files show scenario 12 `ok` with no skip on the integrated tree, and, if the summary's cause `running` is right, the loss followed from the designed rule that a non-running container is not adopted, not from an adopted container losing its volume. That reading is [INFERENCE] until the log is read. On 2026-11-16 the owner accepted it as a known gap (override 2 in the front matter); it remains an unresolved risk, not a resolved one.

**G2 (resolved): health re-attach success path.** Three live `health.reattach` lines with `state` `active` are read in the daemon `requests.log` (RT-04 section). The owner accepted the re-attach on 2026-11-16. The one remaining caveat: scenario 8 still depends on the 10 s window before the first attempt.

**G3 (record mismatch): `.planning/REQUIREMENTS.md` RES-01 to RES-05 checkboxes (l.94-98) are unchecked and the traceability rows (l.215-219) describe a pre-live state.** RES-01 says "actual labels/order alignment before code" (D19-1 settled it); RES-02 says "live acceptance open" and cites `src/daemon/daemon.ts:988-991,1079-1082,1193-1200`, but `daemon.ts` has 945 lines, so those ranges do not exist (the code is at l.317-323, l.896-918); it also cites `lifecycle.ts:217-264` where `adoptSurvivors` is now l.239-282; RES-03 says "live attachment and inspect OQ-P19-01/02 open" although scenario 5c asserts the attachment, mount shape and options live; RES-04 cites `runtime-decision.md:467` and `:523` where D19-6 is l.537 and the stopped-project decision is l.593; RES-05 says same-container survival "remains live acceptance OQ-P19-03", which scenario 5 now shows `ok` twice.

**G4 (record mismatch): `.planning/ROADMAP.md`.** l.193 and l.530 leave Phase 19 and `19-01-PLAN.md` unchecked (correct until this verdict is accepted). l.529 says "decision ancestry and current live acceptance remain open"; l.586 says "Recovery plan independently checked; upstream prerequisites and live acceptance open". Phase 14 and Phase 18 have passed and live acceptance ran on 2ff6df9. ROADMAP success criterion 4 (l.524) says scratch survival is a live scenario, which now has the unresolved failure above.

**G5 (record mismatch): `.planning/phases/19-resume-and-checkpoint/19-HELD-OWNER.md`** still cites `runtime-decision.md:459`, `:467`, `:515`, `:523`; the lines are now l.517, l.537, l.585 and l.593. Its header "HELD-OWNER (plan 19-01 not executed)" is superseded by `19-01-SUMMARY.md`.

**G6 (record mismatch, partly resolved): the old RT-04 / N1 text** (see the RT-04 section). `docs/integration/openshell.md` l.636 and `src/runtime/agentos.ts` l.14-15 are corrected in the working tree and not committed. Remaining: `.planning/milestones/v2.0-REQUIREMENTS.md` l.107 (archived) and `.planning/ROADMAP.md` l.334.

**G7 (record mismatch): command naming.** RES-04 and criterion 5 say "snapshot and restore commands"; the shipped surface is `realm checkpoint create|restore` (`src/cli/checkpoint.ts` l.57). The behavior matches, the names differ.

**G8 (plan mismatch): `19-01-PLAN.md` Task 3's verify pattern** names tests `19 verifier-failure` and `19 no-record` that do not exist. The scenarios are 11 and 5, and the evidence runs executed the whole file rather than the plan's filtered command.

**G9 (decision ancestry, owner-accepted 2026-11-16): D19-1, D19-2, D19-5, D19-7 recorded with their code, D19-9 and D19-10 after it** (Decision ancestry table; override 1).

## Residuals (not verdict-blocking)

The two owner-accepted gaps are G1 (scenario 12) and G9 (D19 ordering), both dated 2026-11-16.

- **R1.** No TAP file records the process exit code; `19-01-SUMMARY.md` reports exit 0 for run 2 only.
- **R2.** Scenario 5 asserts that the stray is removed and named in `daemon.startup`, not its cause string; the `no-record` cause is proven offline (`test/session/reap.test.ts` l.205, `test/daemon/daemon.test.ts` l.3197).
- **R3.** `restartAdopted` has no unit test by name; it is exercised through `startDriver` in `test/runtime/driver/restart-adoption.test.ts` l.355 and by the live driver-restart scenario. A driver restart restarts the container, so processes inside it end (`lifecycle.ts` l.440-446); the workspace and scratch volume persist.
- **R4.** Build identity of every live run rests on file names and the operator's record (`19-01-SUMMARY.md`); the compiled tree is outside the repository. The `full3` and `settle` files carry no commit name; `19-01-SUMMARY.md` says "same product code" and "PR 92".
- **R5.** Spike host filesystem versus live host filesystem (RES-04), see Requirements Coverage.
- **R6.** Hosts other than the realm CLI (Omp harness) were not exercised by these scenarios (`19-01-SUMMARY.md`).
- **R8.** Planning records G3 to G8 (REQUIREMENTS.md, ROADMAP.md, `19-HELD-OWNER.md`, the plan's verify pattern, the archived RT-04 text, command naming) still carry pre-live wording, and the two comment edits in `docs/integration/openshell.md` and `src/runtime/agentos.ts` are uncommitted. They are bookkeeping for the phase close, outside this report's single-file scope, and do not change what the code and TAP files show.
- **R7.** Gates not run: no test, lint, typecheck, build, formatter or `check:docs` was run. Test references above were read, not executed.

## Owner-accepted gaps

No human verification item remains open. The owner ruled on 2026-11-16 (all three accepted):

1. **Scenario 12 failure** (G1): accepted as a known gap, cause unproven, test hardened by PR 92. Override 2.
2. **D19-2 and D19-5 to D19-10 ordering** (G9): the same-commit-as-code ordering deviation accepted. Override 1.
3. **Health re-attach**: accepted on the offline tests (`test/daemon/session-health-reattach.test.ts`), the passing driver-restart scenario and the three live `health.reattach` log lines verified above. Moved out of behavior-unverified.

## Gaps Summary

No success criterion is FAILED and no truth is behavior-unverified. The code for RES-01 to RES-05 is present, wired and carries flowing data, and every named live scenario is `ok` with no skip in the six latest full-suite files and in 9 of 9 isolated scenario 12 runs. Two gaps are owner-accepted (G1, G9). The planning records and two uncommitted comment edits (G3 to G8, R8) remain as non-blocking residuals.

## Verdict

verdict: passed

All five criteria are VERIFIED at b23684e plus the working tree. Plan truth 1 and the scenario 12 failure are carried as owner-accepted overrides dated 2026-11-16. The RT-04 / N1 amendment by the bounded health re-attach is implemented (`src/daemon/sessions.ts` l.233-355), documented (`docs/integration/omp.md` l.138) and shown in the live daemon log. The verdict rests on the Phase 14 and Phase 18 reports (`status: passed`), which were not re-verified here, and on the unresolved-but-accepted risk G1.

---

_Verified: 2026-11-16_
_Verifier: Claude (gsd-verifier)_
