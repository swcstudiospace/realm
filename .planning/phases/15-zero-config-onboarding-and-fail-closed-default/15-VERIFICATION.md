---
phase: 15-zero-config-onboarding-and-fail-closed-default
verified: 2026-11-13T19:30:00Z
status: human_needed
score: 5/5 roadmap success criteria verified on evidence; 4 human items open
behavior_unverified: 0
overrides_applied: 0
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-01-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-01-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-02-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-02-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-03-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-03-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-04-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-04-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-05-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-05-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-06-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-06-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-07-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-07-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-08-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-08-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-09-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-09-SUMMARY.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-10-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-11-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-12-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-13-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-14-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-15-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-16-PLAN.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-CONTEXT.md
  - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-SUMMARY.md
  - AGENTS.md
  - README.md
  - docs/hosts/snippets/omp.md
  - docs/integration/host-binaries.md
  - docs/integration/hosts.md
  - docs/integration/omp.md
  - docs/integration/openshell.md
  - docs/policy-reference.md
  - package.json
  - scripts/check/default-mode.mjs
  - scripts/check/default-mode.test.mjs
  - src/cli/init.ts
  - src/cli/main.ts
  - src/contract/validate.ts
  - src/core/policy.schema.json
  - src/core/policy.ts
  - src/daemon/main.ts
  - src/daemon/spawn-env.ts
  - src/doctor/checks.ts
  - src/doctor/fix.ts
  - src/doctor/runtime-checks.ts
  - src/omp/extension.ts
  - src/runtime/config.ts
  - src/runtime/driver/main.ts
  - src/runtime/openshell.ts
  - test/cli/cli.test.ts
  - test/cli/init.test.ts
  - test/core/policy.schema.test.ts
  - test/core/policy.test.ts
  - test/daemon/main.test.ts
  - test/daemon/spawn-env.test.ts
  - test/doctor/checks.test.ts
  - test/doctor/dial-defaults.test.ts
  - test/doctor/fix.test.ts
  - test/doctor/runtime-root-checks.test.ts
  - test/integration/production-driver.test.ts
  - test/integration/production-live-helpers.test.ts
  - test/runtime/config.test.ts
  - test/runtime/driver/driver-main.test.ts
  - test/support/production-live.ts
covered_digest: "v3:sha256:a54c03e356b53331cd5c11949e857f4d0f4db0aee41fdc355029101cbf88051a"
re_verification:
  previous_status: gaps_found
  previous_score: "0/5 roadmap criteria verified"
  gaps_closed:
    - "Current-build L-D evidence (omp plugin install, list, rpc-ui, realm-retry) now recorded (15-16-L-D-evidence)"
    - "Current-build L-C2 quickstart on Podman 5.7.1 (init, up, status, down) now recorded (15-16-transcript-evidence)"
    - "L-C attempt 1 failure (status and down denied from outside the pinned workspace) closed by attempt 2 in the same transcript (15-15-LC-transcript)"
    - "Full live suite L-A: clean runs at 37/37 on the combined build (15-10 evidence)"
    - "L-B checkpoint: owner decision to keep the new build and edited unit recorded (15-15-LC-transcript)"
  gaps_remaining:
    - "docs/specs/realm-spec.xml still lists the advisory-versus-fail-closed default as an open question (see human item 1)"
  regressions: []
human_verification:
  - test: "Decide whether docs/specs/realm-spec.xml is within DEF-02's document search. Its open question (around line 200) still asks whether the default is fail-closed or advisory, and its note (around line 256) describes advisory as the default contradiction."
    expected: "Either the spec is updated to record fail-closed as the decided default, or it is recorded as a historical spec outside DEF-02 scope."
    why_human: "This is a scope judgment on a planning-era document; the verifier does not edit docs."
  - test: "Decide whether an rpc-ui capture with the daemon active is required for ONB-06. The recorded L-D frames show 'realm disconnected · REALM_NOT_ACTIVE' because the daemon was down; the extension registered and realm-retry was listed, with no extension_error."
    expected: "Either accept the disconnected capture as sufficient for the install record, or capture one active-state setStatus frame with the daemon up."
    why_human: "The success criterion is the recorded install result; whether the active state must also be shown is an owner decision."
  - test: "Confirm that status and down run from outside the pinned workspace are POLICY_DENIED while a daemon is running. Attempt 1 of L-C recorded this; attempt 2 ran them from the workspace and passed."
    expected: "Accept it as intended behavior and confirm the README and runbook say to run status and down from the bound workspace."
    why_human: "Whether this is intended product behavior is a product decision; the verifier only checked the observed result."
  - test: "Re-run the hermetic test suite on the merged main tree. This pass skipped tests, as the assignment required."
    expected: "The suite is green on main (the orchestrator reported 3025 pass, 0 fail, 39 skipped at PR 66 head)."
    why_human: "Test execution was out of scope for this verification and is the main agent's gate."
---

# Phase 15: Zero-config onboarding and fail-closed default — Verification Report

**Phase Goal:** A new user on a Podman 5.x host reaches an active sandbox with `realm init` and `realm up` and no manual edit, and a policy that says nothing about its mode contains the agent.
**Verified:** 2026-11-13T19:30:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (previous report: gaps_found, 0/5)

Scope of this pass: goal-backward verification of the five roadmap success criteria against the merged code (PR 66 code at 0f141fe / 1ddfc45 on main; PR 67 docs at b09ac75), the orchestrator-observed test and live results, and the live transcripts. No tests, lint, typecheck, build, formatters or check:docs were run here. No live operation was run here; live results are cited from the transcripts and not re-executed. No source, test, docs, workflow, REQUIREMENTS, ROADMAP or STATE file was edited.

## Goal Achievement

### Observable Truths

| #   | Truth (roadmap success criterion) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Clean host: `realm init` then `realm up` reaches active with no manual edit; init writes templates, state dir 0700, refuses overwrite, digest by argument or from release/ and never invented (ONB-01) | ✓ VERIFIED | `src/cli/init.ts`: 0700 enforcement and refusal of a mode-wrong directory (≈l.208), refusal of an existing file (≈l.327, ≈l.415 EEXIST via linkSync), `--image` must be digest-pinned (≈l.246–253), file header states it never invents a digest. Live L-C2 (15-16-transcript-evidence, Podman 5.7.1): init exit 0 with mode fail-closed, up active, status active, down unbound, containers 0 before and after. L-C attempt 2 (15-15-LC-transcript): init 0, up 0 active. |
| 2 | Doctor fails with a named check and fix for unset/relative/mode-wrong driver roots and unreachable socket or gateway; `doctor --fix` 0755→0700, second run no change, dry-run no change, symlinked dir refused (ONB-02, ONB-04) | ✓ VERIFIED (presence + live evidence) | `src/doctor/fix.ts`: `PRIVATE_DIR_MODE = 0o700`, `FixRefusal(path, "symlink")` on symbolic links, descriptor-based ancestor checks. Live L-C scratch run (15-15-LC-transcript): state 755 forced; dry-run lists set-mode and two create-directory fixes, exit 0, mode still 755; real run sets 700; repeat returns `fixes: []`. Unit tests exist in test/doctor/fix.test.ts and runtime-root-checks.test.ts; test execution not re-run here (see human item 4). |
| 3 | Secret, workspace and state roots read from `config.json` with a default under stateDir; `REALM_DRIVER_SECRET_ROOT`/`_WORKSPACE_ROOT`/`_STATE_ROOT` gone; driver and daemon read the same source; sentinel env does not reach the daemon (ONB-03, ONB-07) | ✓ VERIFIED (presence; sentinel test exists, not re-run) | `src/runtime/config.ts` `runtimeRootsOf` derives `<stateDir>/secrets` and `<stateDir>/sandboxes` when omitted. `src/daemon/main.ts` (l.50–51) and `src/runtime/driver/main.ts` (l.66) both read the same config and ignore the three stale variables. `docs/policy-reference.md` l.318 and `docs/integration/openshell.md` l.214 state the same. Sentinel test: `test/daemon/spawn-env.test.ts` exists (`src/daemon/spawn-env.ts`). `REALM_DRIVER_SOCKET` and other `REALM_DRIVER_*` variables are unchanged per docs. |
| 4 | Policy with no `mode` loads as fail-closed; schema default and loader agree; advisory needs explicit value; policy reference, README, Omp notes, doctor output and init templates state fail-closed; no document calls advisory the default; tests asserting old default updated (DEF-01, DEF-02) | ✓ VERIFIED (with human item 1) | `src/core/policy.schema.json` `"mode"` default `"fail-closed"`; `src/core/policy.ts` validated defaults fail-closed (l.34), advisory warning only under explicit advisory (l.151–160). README.md states the default and an upgrade note for policies without `mode`; `docs/integration/omp.md` and `docs/integration/openshell.md` consistent. `scripts/check/default-mode.mjs` exists as a guard. Residual: `docs/specs/realm-spec.xml` (≈l.200, ≈l.256) still frames the default as an open fail-closed-or-advisory question. |
| 5 | `omp plugin install` run live under isolated profile and recorded in `docs/hosts/snippets/omp.md`; README carries install steps and a quickstart transcript of init, up, status, down on a real Podman 5.x host (ONB-05, ONB-06) | ✓ VERIFIED (with deviation and human items 2–3) | `docs/hosts/snippets/omp.md` records the dated 2026-11-13 install: `omp/18.20.0` (the plan expected 18.12.6; the record states the actual value), dry-run, install (linked agent-realm 0.3.29), list (enabled), doctor (0 errors). Live L-D (15-16-L-D-evidence): rpc-ui shows two realm setStatus frames, realm-retry listed, no extension_error; originals restored with matching hashes. README transcript (quickstart) captured on Podman 5.7.1 with `<digest>` substituted, covering init, up, status and down only, as the criterion specifies. |

**Score:** 5/5 roadmap criteria verified on evidence (criteria 3 and 4 rely partly on test presence; see human items 1 and 4).

### Live checkpoints

| Checkpoint | Result | Verdict on this pass |
| --- | --- | --- |
| L-A (plan 15-10): full live suite, two clean runs | 37 of 37 each on the combined build, no keep flags (orchestrator-observed; clean-run transcript shows 37 pass, 0 fail, 0 skipped) | Closes the previous "L-A not green" gap |
| L-B (plan 15-10): edited unit and new build | 37 of 37; runtime-roots, driver-socket, gateway doctor checks pass; host restored | Closes the previous "L-B unapproved" gap; owner decision recorded |
| Kept install (main 1ddfc45) | 37 of 37 rerun; doctor runtime items pass | Accepted |
| L-C (plan 15-15), attempt 1 | init 0 fail-closed; up 0 active; status and down POLICY_DENIED (exit 1) because they ran outside the pinned workspace while the daemon was up | Recorded failure; not a pass for status and down in attempt 1 |
| L-C (plan 15-15), attempt 2 | init 0; up 0 active; status 0 showing mode fail-closed; down 0 unbound; originals restored with matching hashes | Closes the attempt-1 failure for those steps |
| L-C2 (plan 15-16 Task 1) | init 0 fail-closed, up active, status active, down unbound, containers 0 before and after on Podman 5.7.1 | Pass |
| L-D (plan 15-16 Task 2) | omp 18.20.0; install dry-run, install, list, doctor exit 0; two realm setStatus frames ("realm disconnected · connecting", then "realm disconnected · REALM_NOT_ACTIVE"); realm-retry listed; no extension_error; daemon not running at capture; originals restored with matching hashes | Pass for install and registration; active-state frame not captured (human item 2) |

### Residuals stated honestly

- **Omp version:** the live install ran on omp 18.20.0. The plan expected 18.12.6. The install record uses the actual value.
- **L-D rpc-ui state:** the captured frames are disconnected, with REALM_NOT_ACTIVE, because the daemon was down. No active-state frame is recorded.
- **Status and down from outside the workspace:** while a daemon is running, these are POLICY_DENIED. The passing run executed them from the bound workspace. Whether this is intended behavior is for a human (item 3).
- **L-C2 config restore:** the config and policy were moved aside for L-C2 and restored after L-D. The restore hashes match (config 1838f4c8…, policy e66c7871…). The L-C2 transcript notes the restore.
- **Spec document:** `docs/specs/realm-spec.xml` is not updated (human item 1).

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/cli/init.ts` | Template write, 0700, refuse overwrite, digest validation | ✓ VERIFIED | Refusal paths and digest check present in code; exercised live (L-C2, L-C attempt 2) |
| `src/doctor/fix.ts` | Descriptor-based fixes, 0700, symlink refusal, dry-run | ✓ VERIFIED | Exercised in the L-C scratch run (dry-run, fix, repeat) |
| `src/runtime/config.ts` | `runtimeRootsOf` with stateDir defaults | ✓ VERIFIED | Derives secrets and sandboxes roots when omitted |
| `src/daemon/main.ts`, `src/runtime/driver/main.ts` | Read the same config; ignore stale root variables | ✓ VERIFIED | Lines cited above |
| `src/core/policy.schema.json`, `src/core/policy.ts` | `mode` default fail-closed, loader agrees | ✓ VERIFIED | Schema default and loader fallback both fail-closed |
| `docs/hosts/snippets/omp.md` | Dated install record | ✓ VERIFIED | Records omp 18.20.0, install, list and doctor |
| `README.md` | Install steps and init/up/status/down transcript | ✓ VERIFIED | Transcript on Podman 5.7.1 with `<digest>` substituted |
| `docs/specs/realm-spec.xml` | Default-mode consistent with decision | ⚠️ NOT UPDATED | Open question still present (human item 1). Not in the covered_files list |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `realm init` | `config.json` and `policy.json` | writes templates with 0700 directory | ✓ WIRED | Live L-C2 and L-C attempt 2 |
| `config.json` | daemon and driver roots | `runtimeRootsOf` read by both processes | ✓ WIRED | Code and docs consistent; live up active in L-C2 |
| `doctor --fix` | state directory | descriptor-based set-mode and create-directory | ✓ WIRED | Live scratch run (dry-run, fix, repeat) |
| Omp extension | daemon status | setStatus frames, realm-retry | ✓ WIRED (disconnected state observed) | L-D frames; active state not captured |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| Quickstart status | `mode`, `boundRoot`, `sessionId` | daemon snapshot | Yes (live) | ✓ FLOWING |
| Doctor fixes | `fixes` list | filesystem state | Yes (live scratch run) | ✓ FLOWING |

### Behavioral Spot-Checks

Not run in this pass. The assignment prohibited tests, builds and live operations. Behavioral evidence is cited from the orchestrator-observed hermetic run (3025 pass, 0 fail, 39 skipped at PR 66 head; typecheck, lint, build and check:docs green) and the live transcripts above. No new probe or spot-check outcome is claimed.

### Probe Execution

Not run (no probe scripts were executed in this pass). No `MISSING_PROBE` items were identified for this phase.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| ONB-01 | 15-01 to 15-16 | realm init writes templates, state 0700, refuses overwrite, digest pinned | ✓ SATISFIED | Criterion 1 |
| ONB-02 | 15-01 to 15-16 | doctor named checks and fixes | ✓ SATISFIED | Criterion 2 |
| ONB-03 | 15-01 to 15-16 | roots read from config.json | ✓ SATISFIED | Criterion 3 |
| ONB-04 | 15-01 to 15-16 | doctor --fix on mode 0755 and symlink refusal | ✓ SATISFIED | Criterion 2 |
| ONB-05 | 15-16 | omp plugin install recorded | ✓ SATISFIED | Criterion 5 (version deviation noted) |
| ONB-06 | 15-16 | README install and quickstart | ✓ SATISFIED | Criterion 5 |
| ONB-07 | 15-01 to 15-16 | sentinel env does not reach daemon | ✓ SATISFIED (test presence) | Criterion 3; test not re-run |
| DEF-01 | 15-01 to 15-16 | policy without mode is fail-closed | ✓ SATISFIED | Criterion 4 |
| DEF-02 | 15-01 to 15-16 | docs state fail-closed default | ⚠️ SATISFIED WITH RESIDUAL | Criterion 4; spec doc open question (human item 1) |

### Anti-Patterns Found

No new source edits were made in this pass, so no new anti-pattern scan was run on changed code. The only documentation residual is `docs/specs/realm-spec.xml` (see Requirements Coverage and human item 1).

### Human Verification Required

1. **Spec document scope (DEF-02).** `docs/specs/realm-spec.xml` still asks whether the default is fail-closed or advisory (≈l.200) and describes advisory as the default contradiction (≈l.256). Decide whether this file is within DEF-02's document search. If it is, it needs updating in a separate change.
2. **Active-state rpc-ui capture (ONB-06).** The recorded frames show REALM_NOT_ACTIVE because the daemon was down. Decide whether an active-state frame with the daemon up is required, or whether the disconnected capture is enough for the install record.
3. **Status and down outside the workspace.** While a daemon runs, these are POLICY_DENIED from outside the pinned workspace. Confirm this is intended and that README and the runbook say to run them from the bound workspace.
4. **Test gate on merged main.** Re-run the hermetic suite on the merged main tree. Test execution was excluded from this pass.

### Gaps Summary

No blocker gaps. All five roadmap success criteria have evidence. The prior gaps (missing L-D and L-C2 current-build evidence, L-A not green, L-B unapproved, and the L-C attempt-1 failure) are closed or recorded as above. The phase is not marked `passed` because four human items remain open, including one document residual.

---

_Verified: 2026-11-13T19:30:00Z_
_Verifier: Claude (gsd-verifier)_
