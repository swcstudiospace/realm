# Phase 17 — Observability and tamper-evident audit: CONTEXT (consolidation)

Canonical detail reused: `17-CONTEXT.md` (D-1701..D-1706 + amendments),
`17-RESEARCH.md`, `17-01..17-05-PLAN.md`, `17-SUMMARY.md`, `17-VERIFICATION.md`.

## Goal
Hash-chained audit with `realm audit verify`, leveled JSON logging with
correlation ids, control-socket-only metrics, and a distinct gateway/driver
-loss code.

## Owner decisions D1–D6 relevance
- D5: exactly one catalogue addition here (`OPENSHELL_GATEWAY_LOST`,
  30→31, TD-05); amendment O-e ratified: driver-only loss also classifies
  as gateway-lost when the driver's socket probe fails. D1: proposal 7.
- D2/D3/D4/D6: no direct requirement here. Phase 14 must precede: the
  chain must cover reconciliation lines (D-1702).

## Honest status (REQUIREMENTS traceability, newer than RECOVERY)
OBS-01 automated pass (chain, verify file/session/head/anchor, oversize
fail-closed); live audit-verify scenarios human-needed. OBS-02 automated
partial (sinks, correlation, rotation, unreadable-refusal); live scenario
human-needed; open owner decisions on audit.head cost, unreadable audit
file, crash stack, audit.head coverage. OBS-03 automated pass incl.
`/proc` listener test; live counts human-needed. OBS-04 automated pass for
gateway path; driver-only classification awaits owner ratification of
D-1701 (O-e); live scenario 10 human-needed. Do not claim live proof.

## Grey areas / decisions
- Pre-chain files: first chained line commits to last legacy line;
  legacy lines reported unprotected (D-1702) — no marker-line invention.
- `daemon.log` = startup/failure sink; request/lifecycle → `requests.log`
  (2026-11-02 amendment). QUAL-01 exception (i) covers logger sink path.
- `audit.head` record: tail-only read, `sessionId/seq/lineSha256`, covers
  only `audit/daemon.jsonl` — see amendment O-a/O-b.

## Success criteria (verbatim, from 17-CONTEXT.md §Acceptance)
1. Each audit line carries `seq` and `prev`; `realm audit verify` passes an untouched file and names the first broken line after an edit, a removal and a reorder, and the Phase 14 reconciliation lines are inside the chain (OBS-01).
2. The daemon log is one JSON object per line with a correlation id per `up` and per tool call that also appears in the admission and result audit lines (OBS-02).
3. `realm metrics` shows counters and timings over the control socket and no network listener exists (OBS-03).
4. A stopped gateway shows `OPENSHELL_GATEWAY_LOST`, not `AGENTOS_CRASH_LOOP`, in `realm status` and in a probe test (OBS-04); the live scenario 10 shows it on the real stack.
