# Phase 19 status: HELD-OWNER (plan 19-01 not executed)

Recorded by lane B (`gsd/v3-lane-b`), 2026-11-02. Plan `19-01-PLAN.md` was read and not executed. No Phase 19 code, test or doc change was made.

Requirements: RES-01 to RES-05 (`.planning/REQUIREMENTS.md`, lines 93 to 97).

## RES-01 (reaper decision and scratch-volume amendment)

- **Recorded:** `docs/integration/runtime-decision.md`, section "Startup reaper and scratch volume (Phase 19, RES-01)", dated 2026-10-30 in `19-CONTEXT.md`. It covers the re-adopt and remove rule, the no-orphan guarantee, the scratch volume name, mount, policy, lifetime and cleanup, and open questions OQ-P19-01 to OQ-P19-03.
- **Not settled by repo evidence:** the label set. The decision text names `io.realm.managed=true` and `io.realm.session`. `19-CONTEXT.md` records that the actual containers carry `openshell.managed` and `openshell.ai/sandbox-name`. The plan requires this alignment before code, and it belongs to the Phase 18 contract.
- **Exact decision needed (D19-1):** confirm the ownership label set that adoption and the scratch volume match. Then amend the decision text in `runtime-decision.md` in the same commit as the code.

## Why 19-01 cannot run now

1. **Phase 18 is HELD-OWNER** (`18-HELD-OWNER.md`). The plan requires the Phase 18 project-callers, the resource contract and the driver workspace mapping to be verified before runtime cutover.
2. **Callers not allocated.** The plan states that the daemon composition (`daemon/main`, compose) and the driver callsites (lifecycle, compute-driver, main, secret-store, supervisor) must be allocated to separate units by A01 before cutover. A reaper-only patch is not RES-02. No allocation exists.
3. **RES-04 spike not run.** `19-CONTEXT.md` requires a target-filesystem spike, with its output recorded, before any checkpoint code. No mechanism is selected, and reflink or atomic whole-tree restore is not presumed.
4. **Live prerequisites.** OQ-P19-01 (scratch attach through the OpenShell Podman driver), OQ-P19-02 (inspect mount shape) and OQ-P19-03 (re-adoption across a host daemon kill) are live-gated. RES-05 scenarios are in the owner's batched live window.

## Exact decisions needed

- **D19-1 (owner or contract owner):** the label set (above).
- **D19-2 (A01):** allocate the callsite units listed in `19-01-PLAN.md` for the daemon and the driver, after Phase 18 releases them.
- **D19-3 (owner):** approve the target-filesystem spike for RES-04 and name the target filesystem.
- **D19-4 (owner live window):** the RES-02, RES-03 and RES-05 live scenarios.

## What is not done

RES-01 is recorded in the decision text but its label contract is open. RES-02 to RES-05 are not implemented, verified or started.
