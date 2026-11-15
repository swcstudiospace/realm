---
phase: 18-per-project-sandboxes
plan: 12
subsystem: docs
tags: [docs, openshell, omp, runtime-decision, multi-project, resource-bound]
requires: ["18-07", "18-10", "18-11", "phase-17-plan-04 (commit 9e6ed08)"]
provides:
  - "docs/integration/openshell.md states the driver ceiling, the registry-resolved project directory, the per-session sandbox name and the MULTI-06 resource bound"
  - "docs/integration/omp.md states the working-directory selection, the session switch rule, the refused-up rule and the four-method POLICY_DENIED consequence"
  - "docs/integration/runtime-decision.md marks the Phase 18 contract implemented-unverified and records the C2, C5 and O-d amendment readings"
affects: [docs/integration/openshell.md, docs/integration/omp.md, docs/integration/runtime-decision.md]
key-files:
  created: []
  modified:
    - docs/integration/openshell.md
    - docs/integration/omp.md
    - docs/integration/runtime-decision.md
decisions:
  - "The runtime-decision status line reads 'implemented, unverified; the live two-project checkpoint is pending (plan 14). Not live-verified.' No document claims a live result."
  - "The C2 equality reading is recorded as the explicit interpretation of MULTI-02; the owner-facing wording of MULTI-02 is unchanged."
  - "The C5 rule (a down that leaves no live session stops the daemon; a down while another session is live never stops it) and the O-d amendment by C6 are recorded as owner-approved on 2026-11-02."
  - "The dated 2026-10-28 and 2026-10-30 live results and the podman event example are kept as recorded and labelled historical."
requirements: [MULTI-01, MULTI-02, MULTI-04, MULTI-06]
metrics:
  tasks: 2
  commits: 1
  completed: 2026-11-03
commits: [a7f2ce2]
status: complete_offline
---

# Phase 18 Plan 12: documentation that matches the code (MULTI-01, MULTI-02, MULTI-04, MULTI-06) Summary

The three integration documents now describe the per-project code of plans 02 to 11 and the status of the contract. They claim no live result. The change is one commit, a7f2ce2 (2026-11-03), on `gsd/phase-18-complete`, which is an ancestor of HEAD. The diff touches only the three documents: 52 insertions and 25 deletions in total, and the contract section of `runtime-decision.md` gained 6 lines and lost none.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| T1 | openshell.md: the driver, the mount, the bound and the live suite | a7f2ce2 | docs/integration/openshell.md |
| T2 | omp.md and runtime-decision.md: selection, switch rule, status | a7f2ce2 | docs/integration/omp.md, docs/integration/runtime-decision.md |

## What was added

- `docs/integration/openshell.md`
  - The `EnsureWorkspace` row names the ceiling (the configured `workspaceRoot`) and says it creates nothing (evidence: src/runtime/driver/compute-driver.ts).
  - The "Directories" paragraph says the workspace is the project directory that `<stateDir>/workspaces/<sessionId>.json` names, lists the driver's four checks (recomputed id, ceiling, device-and-inode pin, one live container per directory), and says nothing is created under it (evidence: src/runtime/driver/compute-driver.ts; src/session/workspace-registry.ts).
  - `create.workspace` is described as "the registry-resolved workspace must be a real directory the driver owns"; the check name is unchanged.
  - The "Workspace root must equal the approved workspace" paragraph is replaced by a session bind paragraph: the session binds its own pinned project directory, the equality refusal is removed, and the verifier compares the inspected mounts with the request binding (evidence: src/runtime/session-execution.ts; src/lifecycle/controller.ts; src/runtime/hardening.ts).
  - A session's sandbox is `realm-<sessionIdOfWorkspace(project)>`; the `realm-daemon` example and the live-suite names (scenario 5, "What the suite touches", "Cleanup") now use the derived name (evidence: src/session/paths.ts).
  - New section `## Resource bound (Phase 18, MULTI-06)`: the per-container caps (1 GiB, 2e9 nanoCPUs), the aggregate constants (4 GiB, 4e9 nanoCPUs), `maxConcurrentSessions` taking the smaller term so the bound is 2, the `AdmissionLedger` committed set, and `POLICY_DENIED` as the refusal (evidence: src/runtime/hardening.ts; src/daemon/admission.ts; test/daemon/admission.test.ts).
- `docs/integration/omp.md`
  - The attach names its project by the session working directory. The session id is derived from the canonical path (C1), and the daemon admits a directory inside or equal to a policy root and the configured workspace root (C2) (evidence: src/omp/extension.ts, `attachDaemon`; src/daemon/sessions.ts, `resolveSelection`; src/fs/root.ts, `bindWorkspaceUnderPolicy`).
  - A refused `up` keeps the client only when the status names the same session id and bound root; otherwise the client closes and the refusal is rethrown (evidence: src/omp/extension.ts; test/omp/extension.test.ts).
  - Session switch: `session_switch` re-attaches when the payload's working directory differs from the attached one and keeps the attachment otherwise, with the S2b evidence (row `S2b`; evidence: src/omp/plugin.ts, `session_switch` handler; test/omp/plugin.test.ts; test/integration/omp-spike.test.ts).
  - Outside every policy root: `status`, `metrics`, `down` and the `tool` call of `realm mcp` and `realm acp` report `POLICY_DENIED`, before any runtime I/O and before the no-live-session answer (C4; evidence: src/daemon/daemon.ts, the four cases each calling `resolveTarget`; src/cli/main.ts, `runMcp` and `runAcp`; test/cli/cli.test.ts).
- `docs/integration/runtime-decision.md`, contract section only (the 2026-10-30 section and the Phase 19 sections are unchanged)
  - Status line: "Status: implemented, unverified; the live two-project checkpoint is pending (plan 14). Not live-verified."
  - Bullets: the C2 equality reading as the explicit interpretation of MULTI-02; the C5 down rule (a `down` leaving no live session stops the daemon, as HEAD did; a `down` while another session is live never stops it); the O-d amendment by C6 (`audit.head` per session, owner choice 2026-11-02).

## Verification

Checked by reading the commit diff (`git show a7f2ce2`), by grep of the three documents, and by existence checks of every cited source and test file. Nothing was built, linted or tested here, and no git command beyond read-only inspection was run.

- VERIFIED: the commit exists, is an ancestor of HEAD, and changes exactly the three files named in the plan's `files_modified`.
- VERIFIED: `grep -c "Resource bound (Phase 18, MULTI-06)" docs/integration/openshell.md` returns 1.
- VERIFIED: `grep` finds the status line `Status: implemented, unverified; ...` once, at runtime-decision.md line 477, inside the contract section; the C2, C5 and O-d bullets follow it (lines 479 to 481).
- VERIFIED: the phrases "pinned workspace root" and "equal the approved" no longer appear in openshell.md; the sandbox is named `realm-<sessionIdOfWorkspace(project)>` in the live-suite text.
- VERIFIED: the `realm-daemon` name remains only in the 2026-10-28 dated evidence (lines 374 and 561 to 566), which is labelled historical.
- VERIFIED: the contract section diff is +6 −0; no other line of `runtime-decision.md` changed.
- VERIFIED: the external gate, commit 9e6ed08, is an ancestor of HEAD.
- VERIFIED: every module and test named in the new evidence references exists at the path given (src/runtime/driver/compute-driver.ts, src/runtime/hardening.ts, src/daemon/admission.ts, src/session/workspace-registry.ts, src/omp/extension.ts, src/daemon/sessions.ts, src/daemon/daemon.ts, src/fs/root.ts, src/session/paths.ts, test/omp/plugin.test.ts, test/omp/extension.test.ts, test/daemon/admission.test.ts, test/integration/omp-spike.test.ts, test/cli/cli.test.ts).
- NOT VERIFIED: `node scripts/check/host-paths.mjs` and `npm run check:docs`. The plan assigns the docs checker to the parent's gate, and this run did not execute it.
- NOT VERIFIED: that every statement in the three documents is accurate against the running code. The evidence cited was checked for existence and for the symbols named, not re-derived by execution.

## Deviations from Plan

**1. [Audit fact, not found in plan] "One leftover note" in 18-12-PLAN.md**
- The audit reported "one leftover noted below" without detail. The plan file contains no note below its last task, and the search for "leftover" and "note" in 18-12-PLAN.md found none. The leftover is therefore unidentified and this summary records no resolution for it.

**2. [Evidence wording] Two call sites are cited as definitions**
- openshell.md attributes `verifyPinnedAt` to `src/lifecycle/controller.ts` and `bindRoot` to `src/runtime/session-execution.ts`. Both files call those functions; the definitions are in `src/fs/root.ts`. The sentences are correct about behaviour. The wording was not changed here, since this summary writes only its own file.

**3. [Judgment] "One live sandbox per pinned root." kept**
- openshell.md still lists this line in the "Decisions recorded with this evidence" block of the 2026-10-28 live section. It sits under dated historical evidence and does not describe a current driver mount, so it was left as recorded. The plan's done-when test would flag it on a naive grep.

**4. [Not checked] Phase 17 plan 05**
- 17-05 is HELD-OWNER. This review did not check whether it has landed. If it lands, the plan's rebase instruction still applies.

**Total deviations:** 4, two of them evidence-wording notes and one an unidentified leftover.

## Issues Encountered

None in the edits. The leftover note from the audit could not be located (deviation 1).

## Known Stubs

None.

## Threat Flags

None. The documents describe existing controls and name no secret, path or live result.

## Next Phase Readiness

The documents describe the code after plans 02 to 11. The status line in `runtime-decision.md` must be changed once the live two-project checkpoint (plan 14) passes, and the "implemented, unverified" wording must not be dropped before then. The parent should run `npm run check:docs` on the joined edits, as the plan requires.

---
*Phase: 18-per-project-sandboxes*
*Completed: 2026-11-03*
