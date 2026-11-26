# SANDBOX n6 — Refined Scope After Clarification (SPE-38109..38115)

Date: 2026-11-25. Branch: `swarm/Tb559r-fe`. Graph: `ut-4b4c9b9f07-77d10d12`.
Inputs: STATE/ROADMAP on disk; n1b trio (`.planning/SANDBOX-n1b-MANIFEST.md`,
`-ISOLATION.md`, `-LIFECYCLE.md`); n2 `.planning/SANDBOX-n2-UNITS.md`; n3
`.planning/SANDBOX-n3-OPTIONS.md`; n4 `.planning/SANDBOX-n4-SCOPE.md`; n5
`.planning/SANDBOX-n5-DESIGN.md`. Owner decisions A1 (repo-keyed APPROVED),
A3 (keep hosted APPROVED) recorded in `UNITY-n4-AMBIGUITIES.md` §8.

## 1. Scope freeze (n6.1)

Only phases listed in `.planning/ROADMAP.md`, executed in roadmap order.
No invented phases/milestones. This run: phases 56 (gaps_found, carried),
57/58 (passed-with-gaps, carried) are the remaining v9 close-out scope;
55/59 are verified-complete. STATE.md was stale at run start and has been
synced to this truth (2/5 complete, current 56).

## 2. Locked grey-area decisions (n6.2)

No allowlist widening. Fail closed on isolation error, no unsandboxed
fallback. Sync unavailable ⇒ sync-pending, never reported synced.
GSD Skills unavailable ⇒ direct execution, substitution recorded.
These are the defaults from n4; they are not re-decided here.

## 3. Sandboxing scope (n6.3)

Hardening only (n3 Option A). Preserve the existing Podman/OpenShell/AgentOS
boundary, lifecycle, limits, cleanup, logging from the n1b traces.
U1-U5 units per n2; file overlaps resolved by single-owner assignment.

## 4. Blocked vs awaiting-user-decision (n6.4/6.5)

| Condition | State recorded |
|---|---|
| No sandbox mechanism / corrupt planning / unrunnable verification | blocked |
| Allowlist widening beyond the plan, definition-of-done conflict, external reconciliation dispute | awaiting-user-decision |
| Live-window gate (realmlive stack down) | blocked (reproducible probe recorded in 56/57/58 VERIFICATIONs) |

Both leave STATE/ROADMAP/SUMMARY in a resumable pending state.

## 5. Per-phase state rules (n6.6)

One phase at a time: update STATE.md + ROADMAP.md only after that phase is
verified, blocked, or paused — never batched across phases. Record every
state transition.

## 6. Closeout gate (n6.7)

Milestone audit → complete → cleanup, only after every phase verified.
Audit findings recorded; residual blockers listed, never narrated away.
