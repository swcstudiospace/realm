# Phase 18 — Per-project sandboxes: CONTEXT (consolidation)

Canonical detail reused: `18-CONTEXT.md`, `18-01..18-14-PLAN.md` (+18-04b),
`18-PLAN-CHECK.md`, `18-SUMMARY.md`, `18-VERIFICATION.md`, `18-HELD-OWNER.md`
(2026-11-08 reconciliation supersedes its earlier lane statements).

## Goal
One daemon, one pinned session/sandbox/audit/lock/status per canonical
policy-contained project; transport resolves selection to the actual
driver mount; local down leaves others active; aggregate CPU/memory bounded.

## Owner decisions D1–D6 relevance
- D5(i): one session per project workspace (2026-10-30, PR36) supersedes
  one-session-per-daemon; no new catalogue code. D1: proposal 3.
- D2/D3/D4/D6: no direct requirement here. D18-2 owner-set aggregate bound:
  4 GiB memory, 4e9 nanoCpus, 2 concurrent sessions (drafted 8e9/4 superseded).
- Wider PRD-DRV-01 amendment stays owner-open; handled only as this phase needs.

## Honest status
MULTI-01 DR (decision recorded, not runtime). MULTI-02/03/06 + offline
MULTI-04/05 implemented with authored tests; live acceptance open.
MULTI-05 two-project scenario authored, live-gated (second window failed
at first `up` with `OPENSHELL_START_FAILED`). MULTI-04 deployed-driver
closure not restarted (`261108-puz-CONTEXT.md` driver caveat). Lane gate
set at `c39abe6` is not live acceptance. Never claim live mount proof
from a daemon map or offline tests.

## Grey areas / decisions
- Exact dev/ino/realpath pin on every selected-project use; root equality
  kept (contract owner states it, never silently weakened).
- Gateway sandbox max 19 chars → 13-char session id; collision refusal
  against persisted canonical workspace, never truncated-id reuse.
- Maintenance audit attribution with per-session selection (no fabricated
  global daemon session); `startupBudgetMs` schema max 200000 (owner 2026-11-08).
- Seven pre-record commits `4bfca1a..e2baed6` stand (owner), none merged
  to trunk; human review required before merge.

## Success criteria (verbatim, REQUIREMENTS MULTI-01..06)
- MULTI-01: The new runtime decision (one session per project workspace, superseding one session per daemon) is recorded in `docs/integration/runtime-decision.md` before the code that needs it
- MULTI-02: `up` carries a workspace root that is a descendant of a configured root; the session id derives from the workspace; each session has its own record, its sandbox `realm-<sessionId>`, its pinned subdirectory and its bind mount; a directory outside every configured root is refused with `POLICY_DENIED`
- MULTI-03: The audit file, the lock table and the status snapshot are per session; `realm down` for one session leaves the others active
- MULTI-04: The compute driver and the gateway contract handle a workspace per sandbox, with PRD-DRV-01 handled only as far as this phase needs
- MULTI-05: A live scenario brings up two projects under the configured roots with distinct `/workspace` contents, shows that a write in one is not visible in the other, and shows that `down` of one leaves the other active; unit tests cover the per-session pin
- MULTI-06: The aggregate memory and CPU commitment of concurrent sessions is bounded and documented, using existing configuration and no new catalogue code
