# Phase 14 — Crash-safety pack: CONTEXT (consolidation)

Canonical detail reused: `14-CONTEXT.md` (D-1401..D-1410), `14-RESEARCH.md`,
`14-01-PLAN.md`, `14-SUMMARY.md`, `14-VERIFICATION.md`.

## Goal
Crash safety: startup temp sweep, audit reconciliation, durable session
delete, loud startup-reap notice, real-SIGKILL proof, daemon cause-code
equivalence, stale-container retry.

## Owner decisions D1–D6 relevance
- D5: exactly one catalogue addition here (`AUDIT_OUTCOME_UNKNOWN`,
  29→30); Phase 17 adds the second (TD-05). Count assertions must be
  one-line-evolvable. D1: proposal 4 in scope.
- D2/D3/D4/D6: no direct requirement here. No policy-schema, session-record
  or tool-schema change; anything needing one stops and is reported.

## Honest status
All seven: implemented-unverified (RECOVERY). CRASH-04 is the genuine gap:
live 5b asserts `recordsDeleted` after SIGTERM removed the container — it
does not prove startup removal with its ID, count and notice
(`14-VERIFICATION.md`; REQUIREMENTS CRASH-04 note 2026-11-08). Keep
unchecked until logged record-deletion count is asserted against a real
startup-removal run. CRASH-02's live in-chain presence is gated on Phase 17.

## Grey areas / decisions
- Stable seams for later phases: `runStartupMaintenance`,
  `sweepOrphanTempFiles(roots)`, report object, `pairingKey`.
- Sweep is exact-name/owner/age/no-symlink only (D-1401) — a user file
  literally matching the orphan pattern older than 60 s is removed by design.
- Daemon/result shapes are NOT unified (D-1406 candidate owner decision);
  only cause propagation is in scope.

## Success criteria (verbatim, from 14-CONTEXT.md)
1. For each of the four stages a real-SIGKILL test leaves the original bytes intact and one orphan temp file, and the sweep removes it with an audit line; the age bound, owner, pattern and no-symlink rules each have a negative test.
2. A planted admission with no result gets exactly one reconciliation line at the next start and none at the second.
3. `SessionStore.delete` syncs the directory (observed through an fsync spy); the startup reap is logged with the container ids and counts; the notice reaches `realm status`, the Omp status flow and the MCP and ACP attach diagnostics.
4. A daemon-path test shows the same refusal cause code over MCP and ACP as in process.
5. A controller test with the recorded container removed reaches `active` on retry with a new container id.
6. The live suite scenario 5 shows the notice and the log line on the production stack.
