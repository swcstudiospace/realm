---
phase: 18-per-project-sandboxes
plan: 01
subsystem: docs
tags: [docs, contract, multi-project, sessions, runtime-decision]
requires: []
provides:
  - "docs/integration/runtime-decision.md has one section, `## Per-project session contract (Phase 18, MULTI-01 to MULTI-06, 2026-11-02)`, with items C1 to C12 and a rejected-alternatives paragraph"
  - "C1 to C12 are the reference that plans 18-02 to 18-13 cite for identity, containment, registry, selection, lifecycle, per-session state, aggregate bound, legacy id, attribution and driver reservations"
affects: [docs/integration/runtime-decision.md]
key-files:
  created: []
  modified:
    - docs/integration/runtime-decision.md
decisions:
  - "C1 and C2 are engineering rulings ratified by the owner on 2026-11-02; C7 is a setting by the owner on 2026-11-02; C6 is an owner ruling on 2026-11-02 (amends Phase 17 ruling O-d); C3 to C5, C8 to C12 are engineering decisions"
  - "C2 reads MULTI-02 as inside or equal to a configured root; the owner-facing wording of MULTI-02 is unchanged"
  - "C5 changes HEAD's reading of `down`: a down with no live session stops the daemon; a down while another session is live does not"
  - "C7 bound: 4 GiB, 4e9 nanoCpus, 2 sessions, derived from the existing per-container caps in HARDENING_PROFILE"
requirements: [MULTI-01, MULTI-02, MULTI-03, MULTI-04, MULTI-06]
metrics:
  tasks: 1
  commits: 1
  dated: 2026-11-02
commits: 1
status: complete
---

# Phase 18 Plan 01 (unit R0): per-project session contract record Summary

The per-project session contract is recorded in `docs/integration/runtime-decision.md` as one new section, inserted after the accepted 2026-10-30 section and before the Phase 19 startup-reaper section. It writes no code and changes no existing text.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| T1 | Record the per-project session contract (C1 to C10 in the plan; C11 and C12 added in the committed section) | 4bfca1a | docs/integration/runtime-decision.md |

## What was added

- A level-two section `## Per-project session contract (Phase 18, MULTI-01 to MULTI-06, 2026-11-02)`, which appears exactly once in the file (`grep -c` returns 1).
- Items C1 to C12, each a bold-labelled paragraph with its label, decision, reason and evidence line:
  - C1 identity: session id `p` plus the first 12 lowercase hex characters of SHA-256 of the canonical path; sandbox name `realm-p<12 hex>` (19 characters, equal to `GATEWAY_SANDBOX_NAME_MAX_LENGTH`); collision refused with `SANDBOX_NAME_IN_USE`.
  - C2 containment: equality counts as inside a configured root; the path must pass `bindWorkspaceUnderPolicy` and lie at or below the `config.json` `workspaceRoot`; refusal is `POLICY_DENIED`.
  - C3 mount authority: per-project registry entry `<stateDir>/workspaces/<sessionId>.json`; the driver checks it before the create and refuses with check name `create.workspace`.
  - C4 selection: every project-addressed control request carries `selection`; malformed or self-inconsistent is `SCHEMA_INVALID`; outside the roots is `POLICY_DENIED`.
  - C5 lifecycle: per-session `down`, with ordered steps and no daemon stop while another session is live.
  - C6 per-session state (owner ruling): per-session record, pinned directory, sandbox, mount, audit file, lock table, controller, dispatcher and snapshot; metrics stay daemon-wide; `audit.head` is per session at create and destroy.
  - C7 aggregate bound (set by owner): `aggregateMemoryBytes = 4 GiB`, `aggregateNanoCpus = 4e9`, which gives `maxSessions = 2`; a refusal is `POLICY_DENIED`.
  - C8 legacy: the fixed id `daemon` is retired with no alias; `audit/daemon.jsonl` is kept as history.
  - C9 startup attribution: orphan temp-file sweep lines go to the audit file of the session whose captured workspace contains the removed path; unattributed removals are counted and logged, with no session audit written.
  - C10 driver reservations: a per-sandbox-name in-flight reservation (`create.pinned_root_held`) and a per-workspace live-container check replace the process-global `rootReserved` rule.
  - C11 down lock-wait budget: `DOWN_LOCK_WAIT_MS = 10_000`, shorter than the client's `CONTROL_TIMEOUT_MS.down = 45_000`.
  - C12 cancelable session lock waiter: FIFO lock keyed by session id, with the `down` waiter abandoned after C11's deadline (`TOOL_TIMEOUT`).
- A "Rejected alternatives" paragraph naming the options considered and not taken.
- The section's status line and its three opening bullets (C2 equality, C5 down rule, O-d amendment) are in the committed text (see Deviations).

## Verification

- `git show --stat 4bfca1a` shows one changed file, `docs/integration/runtime-decision.md`, with 30 insertions and 0 deletions. Existing lines are unchanged, which covers the plan's byte-identity requirement for the surrounding text.
- `grep -c '^## Per-project session contract' docs/integration/runtime-decision.md` returns 1.
- A grep of the new section for `<root>/`, `/tmp/`, `/home/` and `/Users/` finds no host-local path. This is a read-only check, not the repository checker.
- Labels: C1, C2 and C7 read as owner-ratified or owner-set on 2026-11-02; C6 reads as an owner ruling; the others read as engineering decisions. Read from the committed text.
- NOT VERIFIED: `node scripts/check/host-paths.mjs` (the plan's done-when command). Not run, per the contract for this assignment.
- NOT VERIFIED: that the committed text matches the plan's C1 to C10 wording item by item. Only C1 to C10 labels and key facts were compared, and the differences listed below were observed in the read.

## Deviations and open items

1. **C5 wording (open owner decision).** The plan says a `down` with "no live or admitting session" arms the daemon stop. The committed text says "no live session" only. The word "admitting" does not appear in the file (`grep -c admitting` returns 0). The plan's "no registry entry and no admission reservation" parenthetical is also absent. The audit recorded this as an open owner decision. It is not resolved here.
2. **Opening structure.** The plan asks the section to begin with one paragraph. The committed section begins with a status line and three bullets (C2 equality, C5 down rule, O-d amendment), then the paragraph.
3. **Status line is stale.** The committed status reads "implemented, unverified; the live two-project checkpoint is pending (plan 14)". The 18-14 live checkpoint is recorded as run on 2026-11-15 (37 tests, 37 pass). This record was not edited, per the one-file scope.
4. **Text added in the committed section, not in the plan's wording:** C3 says the registry entry is removed on release (C5) or at startup (C9); C5 has a sentence on the session-lock wait tied to C11; C10 maps `create.pinned_root_held` to `REALM_INVALID_TRANSITION` as the driver already does. These are consistent with C11, C12 and the driver code cited by later plans, but they were not in the plan draft.
5. **C11 and C12 are in the committed section but not among C1 to C10 of the plan.** The plan's own text lists C1 to C10. The later plans (18-04, 18-06) cite C11 and C12.

## Known Stubs

None. This plan writes no code.

## Threat Flags

None.

## Next Phase Readiness

Plans 18-02 to 18-13 cite this section. Before the owner rules on the C5 "admitting" wording, plan 12's down-rule text and the code in plan 06 should be checked against the committed C5 wording. The status line should be updated when plan 14's checkpoint is recorded in the document.

---
*Phase: 18-per-project-sandboxes*
*Dated: 2026-11-02 (contract record date)*
