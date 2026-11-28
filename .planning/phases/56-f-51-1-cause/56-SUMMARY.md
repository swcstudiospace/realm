---
phase: 56-f-51-1-cause
plan: "01"
requirements: [STOP-05, STOP-06]
subsystem: daemon
tags: [F-51-1, cause, live-window, STOP-05, STOP-06]
---

# Plan 56-01 summary: F-51-1 cause (STOP-05..06)

## Goal

Phase 51 found F-51-1: a dirty stop (`failedTeardowns` 1, `AGENTOS_STOP_FAILED`) in every
variant-c stop of its window (3 of 3), with no F-46-1 slow-stop signature and successful sandbox
deletes — but the failed-step cause code was not captured, so the cause was not established.
This phase's goal (D-56-1, owner D-v9-3) was to capture the failed step and its cause code for
every dirty stop in a live window, establish the cause in `docs/integration/runtime-decision.md`,
and fix or bound it with a 20-iteration clean run (STOP-05, STOP-06). A capture that cannot
establish the cause carries F-51-1 with that evidence instead of claiming it (D-56-3); a fix
never weakens teardown bounds or the no-orphan guarantee (D-56-4).

## Verdict: F-51-1 NOT established; STOP-05 and STOP-06 carried

The final live window ran — but F-51-1's dirty-stop shape did not recur, so there was no failed
step or cause code to capture, and no fix was made. The `docs/integration/runtime-decision.md`
inference from Phase 51 stands unreplaced; F-51-1 remains distinct from F-41-1 (not folded in).
Nothing is relabelled as a pass.

## Hermetic emission (the capture gap, closed in code)

- `src/daemon/teardown.ts` — `StopSessionsResult.causeCode` carries the first failed session's
  own cause code (`RealmError.causeCode` of the first failure; `undefined` otherwise, the
  Phase 51 shape). Additive only: the same `boundMs` path, `withTimeout` unchanged.
- `src/daemon/daemon.ts` — the `daemon.stopped` row logs `causeCode` when present, alongside
  `code`/`failedTeardowns` (commit `b37b94c`).
- `test/support/rapid-stop-up.ts` — `stopCauseOf` reads `causeCode`/`failedStep`/`captured`;
  a row without either counts as **not captured**, never assumed. No failed-step *name* is
  emitted by the product (recorded limitation; `causeCode` alone counts as captured).

Before this phase the row carried only `code` + `failedTeardowns`, so the three dirty stops of
`51-EVIDENCE.md` §4 yielded `AGENTOS_STOP_FAILED` with no cause code. The emission exists in
the tree but, per the final window below, was never exercised on a dirty stop.

## Final live window (2026-11-27, realmlive, HEAD 7517be6)

Stack fully provisioned: podman 5.7.1 (user-unit override), gateway id `openshell`, sandbox
image `localhost/realm-agentos@sha256:6272a3ac...` (rebuilt 2026-11-27, `check:image-digests`
ok). Variant-c window under the shared live lock (`TMPDIR=/dev/shm`, evidence `z56-20261127`,
timelines kept outside the repository):

- `outcome=OTHER-FAILURE (failure-cap)`, **36 iterations, 33 clean, 3 failed, 0 startFailed**.
- **Peak 26 consecutive clean iterations** — the ≥20-consecutive-clean *shape* was shown — but
  the window as a whole failed at failure-cap 3, so the criterion's window form is not met.
- All 33 clean iterations: up ok, active yes, execOk yes, down ok, stop clean.

### The 3 identical row-absent failures

All 3 failures are `kind=row-absent`: the signaled daemon exits in **77–209 ms** (stopMs < 210)
writing **no `daemon.stopping`/`daemon.stopped` row** (stoppingSeen/startupSeen/notice all
none), then the next up's gap is **~226 s** (~226000 ms: the 200 s daemon-start wait) before up
succeeds (upMs 27–32 s). The pattern is new and distinct from F-51-1 (daemon killed before its
logger writes the stopping row); its own cause is not established here.

### Dirty teardowns: zero recorded

No stop in the window ever recorded `failedTeardowns > 0` — clean iterations show
`failedTeardowns=none`. Precisely: zero *recorded* dirty teardowns; the 3 row-absent stops
also show `failedTeardowns=none` but, being row-absent, their teardown state is **unknown,
not zero**. No `causeCode` exists to capture: `AGENTOS_STOP_FAILED` with `failedTeardowns` 1
did not occur once in 36 iterations (0/36).

## What happened across the phase (chronology)

1. **2026-11-22** — window blocked at the production gate (podman.socket dead,
   openshell-gateway dead, no compute-driver unit for `realmlive`; root's stack unreachable).
   `56-WINDOW.md` records WINDOW NOT RUN; F-51-1 carried, STOP-05/STOP-06 carried.
2. **2026-11-25** — `56-VERIFICATION.md` (`gaps_found`): emission verified read-only in tree,
   live gate reproduced closed; criteria 1 and 3 carried (gate-blocked), criterion 2
   carried-with-reason.
3. **2026-11-27 re-attempt** — provisioning fixed (podman override, gateway id alignment
   proven past `launch.gateway_id` SCHEMA_INVALID) but the window was VOID at 0 iterations:
   pinned sandbox image absent in the account store (chain-abort).
4. **2026-11-27 final run** — supersedes the gate-blocked reading for the live criteria
   (`56-VERIFICATION-UPDATE-20261127.md`): criterion 1 VERIFIED (window ran; no dirty stop
   occurred), criterion 2 CARRIED WITH REASON, criterion 3 NOT MET as a window (shape shown
   once: peak 26). The hermetic emission reading from 2026-11-25 stands.

## Requirements

- **STOP-05** (cause recorded, or carried with stated tested reason): **carried** — the cause
  is not established; F-51-1 is carried with the evidence above (emission in place, 0/36 dirty
  stops, new row-absent pattern), distinct from F-41-1 / GAP-43-03 / GAP-40-01.
- **STOP-06** (cause fixed or bounded + ≥20 consecutive variant-c iterations with
  `failedTeardowns` 0): **carried** — no fix commit exists; 26 consecutive clean iterations
  were shown once inside a window that ended OTHER-FAILURE at failure-cap 3.

## Checks

Per the assignment, verification was skipped (no builds, lint, tests or gates run by this
task; the orchestrator verifies). Prior read-only verification stands as recorded in
`56-VERIFICATION.md` (2026-11-25) and `56-VERIFICATION-UPDATE-20261127.md` (2026-11-27).
No code changes were made by this summary task.

## Files changed

- `.planning/phases/56-f-51-1-cause/56-SUMMARY.md` (this file) only. The phase's other
  records (`56-EVIDENCE.md`, `56-WINDOW.md`, `56-VERIFICATION.md`,
  `56-VERIFICATION-UPDATE-20261127.md`) and the additive emission in `src/daemon/teardown.ts`
  + `src/daemon/daemon.ts` predate this summary.
