# Phase 19 — Resume and checkpoint: CONTEXT (consolidation)

Canonical detail reused: `19-CONTEXT.md`, `19-01-PLAN.md`,
`19-HELD-OWNER.md` (2026-11-08 reconciliation supersedes earlier statements),
`docs/integration/runtime-decision.md`, `docs/integration/workspace-snapshot-spike.md`.

## Goal
Re-adopt verified recorded survivors before serving and prove all others
gone; preserve session-owned persistent scratch across restart and remove
it on down; snapshot/restore a project byte-for-byte via a spike-chosen
mechanism.

## Owner decisions D1–D6 relevance
- D5(ii/iii): reaper re-adopts what passes the create-time hardening
  verifier, removes what cannot be proven good (no-orphan in precise
  form); RT-01 mount list gains `realm-scratch-<sessionId>` rw `/scratch`.
  D1: proposal 5.
- D2/D3/D4/D6: no direct requirement here. Depends on Phase 18 identity
  and Phase 14 maintenance/reconciliation; owner chose checkpoint
  workspace self-pinning for stopped projects (2026-11-08).

## Honest status
RES-01 DR (decision recorded; D19-1 label contract decided at
`runtime-decision.md:459`). RES-02/03/04 implemented offline with authored
tests; RES-05 live acceptance open (OQ-P19-03 same-container survival
across daemon kill unproven; prior observation does not close it).
Deployed driver not restarted with the newer closure — live observations
do not validate it. Historical replacement+scratch-loss is the opposite
of target, not proof.

## Grey areas / decisions
- Actual containers carry `openshell.managed`/`openshell.ai/sandbox-name`
  labels, not `io.realm.*` — alignment recorded, discovery must be complete.
- RES-04 mechanism: spike recorded, D19-6 selects full copy
  (`runtime-decision.md:467`); reflink/atomic whole-tree NOT presumed.
- Callsite allocation (daemon composition + driver callsites) is A01's
  pre-cutover step (D19-2); a reaper-only patch is not RES-02.
- Live scenarios all sit in the owner's batched live window (D19-4).

## Success criteria (verbatim, REQUIREMENTS RES-01..05)
- RES-01: The reaper decision (re-adopt what passes the hardening verifier, remove what cannot be proven good, keep the no-orphan guarantee in a precise form) and the amendment of the RT-01 mount list for the scratch volume are recorded in `docs/integration/runtime-decision.md` before the code that needs them
- RES-02: At startup a session record whose container is still running and passes the create-time hardening verifier is adopted, and a container that fails the verifier or has no record is removed; both outcomes are logged
- RES-03: A persistent scratch volume is mounted beyond `/workspace`, owned by the session, survives a daemon restart, and is removed by `realm down`
- RES-04: Workspace snapshot and restore commands exist, with the mechanism (copy, reflink or filesystem snapshot) chosen after a spike; restore returns a modified workspace to its prior content byte for byte
- RES-05: Live scenarios show: the daemon is killed and restarted and the same container id is active with `/workspace` intact and no second container; a container that fails the verifier is removed; a scratch-volume file survives a daemon restart and is gone after `realm down`; a snapshot then restore round-trips
