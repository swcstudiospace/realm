---
phase: 18-per-project-sandboxes
plan: 06
subsystem: daemon
tags: [daemon, sessions, selection, admission, down, signal-shutdown, multi-project]
requires: ["18-03", "18-04", "18-04b", "18-05"]
provides:
  - "src/daemon/sessions.ts: SessionRegistry, resolveSelection, per-id FIFO withSessionLock, reserveAdmission, settleFailedCreate, SessionHealth"
  - "One daemon holds one handle per admitted project, keyed by session id; up, status, tool, down, metrics and doctor act on the handle the selection names"
  - "Admission (reserve) before the probe's first await; outside-root and collision refusals before any reservation or write"
  - "StartedDaemon exposes session(id), committedCount(), isCommitted(id) and stop(); it has no handle property"
  - "A signal stops every handle in process (stopAll); no control message is sent"
affects: [src/daemon/daemon.ts, src/daemon/main.ts, src/daemon/admission.ts, src/lifecycle/controller.ts, src/realm/compose.ts, test/daemon/daemon.test.ts, test/daemon/main.test.ts, test/daemon/admission.test.ts]
key-files:
  created:
    - src/daemon/sessions.ts
  modified:
    - src/daemon/daemon.ts
    - src/daemon/main.ts
    - src/daemon/admission.ts
    - src/lifecycle/controller.ts
    - src/realm/compose.ts
    - test/daemon/daemon.test.ts
    - test/daemon/main.test.ts
    - test/daemon/admission.test.ts
decisions:
  - "The daemon derives the session id from the canonical path (sessionIdOfWorkspace); the wire carries no sessionId for up"
  - "startDaemon builds no handle eagerly (owner answer 4, 2026-11-02): a handle-build refusal, such as no libpod configured, surfaces at up, not at start"
  - "Session down uses controller.destroy() and removes the record; daemon shutdown uses controller.stop() and keeps the record (contract C5)"
  - "A down that leaves no live session (registry empty, no reservation) arms the stop after its reply; a down while another session is live does not"
  - "A failed create whose handle has a session record, or whose controller is not unbound, keeps its registry entry and holds its slot as unproven until a down removes the session; a failed create with no container releases its slot and registry entry"
  - "Audit head is emitted per session through onAuditHead at create and at destroy, not to audit/daemon.jsonl (amends Phase 17 ruling O-d per C6, owner choice 2026-11-02)"
requirements: [MULTI-02, MULTI-03, MULTI-06]
metrics:
  tasks: 2
  commits: 3
  completed: 2026-11-15
commits:
  - "552434e feat(phase-18): per-project sessions, selection resolution and admission (plan 06 T1)"
  - "bd43453 feat(phase-18): selected dispatch, session down and signal shutdown (plan 06 T2)"
  - "99edfda test(daemon): close phase 18 plan 18-06 gaps for T1 (g) and OBS-02 (PR 88)"
status: complete; tests not run in this audit
---

# Phase 18 plan 06 (unit H1): the daemon's per-project handles and selected dispatch

The daemon now admits each project under its own session id, holds one handle per admitted project, and routes every control request through `resolveSelection`. Code for T1 and T2 is on the branch in commits 552434e and bd43453; the gap commit 99edfda adds the T1 (g) swap test and the per-session OBS-02 assertions.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| T1 | sessions, selection resolution and admission in one place | 552434e | src/daemon/sessions.ts (new), src/daemon/daemon.ts, src/daemon/admission.ts, src/lifecycle/controller.ts, test/daemon/admission.test.ts, test/daemon/daemon.test.ts |
| T2 | selected dispatch, session down, daemon stop and signal shutdown | bd43453 | src/daemon/daemon.ts, src/daemon/main.ts, src/realm/compose.ts, test/daemon/daemon.test.ts, test/daemon/main.test.ts, test/daemon/client.test.ts, test/daemon/daemon-health.test.ts, test/daemon/e2e.test.ts, test/daemon/realm-daemon-fixture.test.ts, test/integration/omp-guard.test.ts, test/support/realm-daemon-fixture.ts, test/surfaces/daemon-equivalence.test.ts |
| gap | T1 (g) swap case; OBS-02 per-session audit.head | 99edfda | test/daemon/daemon.test.ts, test/daemon/main.test.ts |

## What was added

- `src/daemon/sessions.ts` (new): `SessionEntry`, `SessionRegistry` over a `Map` keyed by session id; `resolveSelection`, which for a registered id verifies the pinned directory at its path and the id it derives (rename or swap gives `POLICY_DENIED`), and otherwise binds under the policy roots and the configured `workspaceRoot` ceiling (equality accepted) and requires the derived id to equal the selection's; `withSessionLock`, an in-process FIFO lock per session id with per-waiter timers (`TOOL_TIMEOUT` on expiry, `fn` never runs); `reserveAdmission` (the only path to `AdmissionLedger.reserve`); `settleFailedCreate`; `SessionHealth`, the per-session health loop disposed on session down.
- `src/daemon/daemon.ts`: the single-handle construction and the `boundRoot` binding are removed; one `AdmissionLedger` is built with `maxSessions` (default `MAX_CONCURRENT_SESSIONS`); `up` runs resolve, collision check, `reserveAdmission`, probe, then `controller.create` on the resolved entry or on a handle built through `buildHandle`; `onAuditHead(id)` is called after create and after destroy; `down` destroys only its session and arms the stop when no session and no reservation remain; `StartedDaemon` exposes `session(id)`, `committedCount()`, `isCommitted(id)` and `stop()` (`stopAll`), and no `handle`.
- `src/daemon/main.ts`: the `sendDown` path and the constant session id are removed from the entrypoint; a signal calls `started.stop()`; `emitAuditHead(stateDir, sessionId, write)` reads `audit/<sessionId>.jsonl` through `onAuditHead`.
- `src/daemon/admission.ts`: `reservedCount()`, used by the stop arming in `down`.
- `src/lifecycle/controller.ts`: `isLiveState` is exported and used by `create`, so the daemon and the controller share one predicate.
- `src/realm/compose.ts`: a read-only `locks` accessor on `RealmHandle` (3 lines, see Deviations).
- Tests: `test/daemon/daemon.test.ts` gains the T1 cases (titles for T1 (a) to (t) are present) and the T2 migrations; `test/daemon/main.test.ts` drops the `sendDown` fakes, asserts that a signal calls `stop()` and writes no socket line, and asserts the per-session OBS-02 `audit.head` and `audit.unreadable` lines; `test/daemon/admission.test.ts` gains the reservation cases; the remaining daemon and surface fixtures move from literal session ids to `sessionIdOfWorkspace(realpathSync(workspace))`.

## Requirement evidence

| Requirement | Evidence in this unit | Status |
| --- | --- | --- |
| MULTI-02 | T1 (a), (b), (c) titles present in `test/daemon/daemon.test.ts`; T1 (d) and (g) cases present (the (g) swap is added by 99edfda); `resolveSelection` in `src/daemon/sessions.ts` implements the containment and verify steps | Code and titles observed; test bodies not run here |
| MULTI-03 | `session(id)` and per-entry handles in `src/daemon/daemon.ts`; down removes only its session's record, registry entry and slot (commit bd43453); per-session `audit.head` in `test/daemon/main.test.ts` | Code observed; two-session socket test (T2 (a) to (b)) not checked at test level |
| MULTI-06 | `reserveAdmission` is synchronous before the probe's first await (`src/daemon/sessions.ts`); T1 (e), (i), (l) titles present; `reservedCount` in `src/daemon/admission.ts` | Code and titles observed; tests not run here |

## Verification

No test, build, lint or format command was run for this summary (contract). Evidence used: the two task commits (`git show --stat` on 552434e and bd43453), the gap commit 99edfda, read-only grep of the cited source files for the exported names and wiring (`resolveSelection`, `withSessionLock`, `reserveAdmission`, `settleFailedCreate`, `SessionHealth`, `session(sessionId)`, `committedCount`, `isCommitted`, `onAuditHead`, `downRequested` arming), and read-only grep of the test titles. No `sendDown` or `pinnedWorkspaceRoot` match was seen in `src/daemon/main.ts`.

## Deviations from Plan

**1. [Plan text vs commit] `src/realm/compose.ts` changed**
- The plan's reconciliation says `compose.ts` is unchanged, while the T2 Files list includes it. Commit bd43453 adds a three-line read-only `locks` accessor on `RealmHandle`, as its message states.

**2. [Plan text] The plan file was edited in the task commit**
- bd43453 changes 5 lines of `18-06-PLAN.md`, recording that `startDaemon` builds no handle eagerly.

**3. [Gap] Two done-when items were not covered and were added by 99edfda**
- T1 (g) swap: a new directory at the pinned path makes `status`, `tool` and `down` refuse with `POLICY_DENIED`.
- OBS-02: `audit.head` derives the session id with `sessionIdOfWorkspace(realpathSync(workspace))` and asserts that `audit/daemon.jsonl` is absent.

**4. [Behaviour change, owner answer 4] Handle build moves to `up`**
- `startDaemon` builds no handle at start, so a handle-build refusal (for example, no libpod configured) surfaces at the first `up`.

**Total deviations:** 4 (one plan-text vs code gap, one plan edit in a task commit, one gap closed on PR 88, one owner-approved behaviour change).

## Issues Encountered

None recorded in the task commits or the gap commit.

## Known Stubs

None observed in the cited files.

## Threat Flags

None. The daemon reads no process environment; the entrypoint passes host values in.

## NOT VERIFIED

- The Phase 17 plan 02 external gate (the rebase onto Phase 17 logging in `daemon.ts` and `main.ts`): not checked in this audit.
- Pass/fail of every verify command in the plan (`npm run build && node --test dist/test/daemon/...`): not run.
- T2 done-when cases (a) to (k) in `test/daemon/daemon.test.ts`: no T2-labelled test titles were found, and test bodies were not read; only the code paths were observed.
- `stopAll()` as a named function in `src/daemon/daemon.ts`: its behaviour was not read; `StartedDaemon.stop` wiring was observed only through the interface.
- The five real-socket client cases reinstated from plan 05 (T2 (g)): not checked.

## Next Phase Readiness

Plan 08 (CLI behaviour) and plan 09 (maintenance attribution, which edits `daemon.ts` and `main.ts` again) build on the selected dispatch recorded here. The `StartupMaintenanceDeps` change (`attributeOrphan` in place of `sessionId`) is planned in this plan's text but was not verified in `src/daemon/startup.ts`. The C5 reading of `down` and the C6 `audit.head` placement are documented by plan 12.

---
*Phase: 18-per-project-sandboxes*
*Completed: 2026-11-15*
