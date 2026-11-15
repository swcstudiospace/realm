---
phase: 17
plan: 04
subsystem: docs
tags: [docs, observability, audit, audit-head, metrics, daemon-log, owner-rulings]
requires: ["17-01", "17-02"]
provides:
  - "docs/integration/hardening-plan.md H2 names the audit.head pin: --head, and the per-session audit.head record"
  - "docs/integration/runtime-decision.md names emitStartup, emitAuditHead and emitFailure, and records audit.head and audit.unreadable per session"
  - "docs/integration/omp.md shows the daemon.failed JSON event and the gateway-lost observation"
  - "AGENTS.md states that metrics are read only over the control socket, and that the daemon uses the logger, file sink and metrics registry"
affects: [docs/integration/omp.md, docs/integration/runtime-decision.md, docs/integration/hardening-plan.md, AGENTS.md, .planning/phases/17-observability-and-tamper-evident-audit/17-CONTEXT.md]
key-files:
  created: []
  modified:
    - docs/integration/hardening-plan.md
    - docs/integration/runtime-decision.md
    - docs/integration/omp.md
    - AGENTS.md
    - .planning/phases/17-observability-and-tamper-evident-audit/17-CONTEXT.md
decisions:
  - "audit.head is recorded per session, for that session's own file audit/<sessionId>.jsonl, at go-live (after realm up) and at destroy (realm down). The earlier text (audit/daemon.jsonl at startup and shutdown) is corrected in the docs. Code call sites: src/daemon/daemon.ts:435 (go-live) and :468 (destroy), through onAuditHead, wired at src/daemon/main.ts:109-111."
  - "The owner rulings O-b (audit.unreadable per session) and O-d (audit.head scope per session) were recorded as the owner's choice on 2026-11-15 in runtime-decision.md and in the D-1704 amendment in 17-CONTEXT.md. This matches the code, and it supersedes the 2026-11-02 wording."
  - "The 17-CONTEXT.md edit (commit 3cf9d64) was not in this plan's files_modified. It changes the recorded scope of O-b and O-d from the daemon's own file to each session's file, as the owner chose on 2026-11-15. The plan's rule against changing locked decisions was not applied to this edit; the owner should confirm it is in scope."
  - "The gateway-lost row in omp.md records the 2026-10-30 observation on the pre-2026-11-01 build, and the 2026-11-15 re-run on a796b34 (plan 17-05 T1), instead of 'designed, not yet observed live'."
requirements: [OBS-01, OBS-02, OBS-03, OBS-04]
metrics:
  tasks: 5
  commits: 3
  completed: 2026-11-15
status: complete
---

# Phase 17 Plan 04: docs that match the code (OBS-01 to OBS-04) Summary

The H2 audit-head text, the daemon-log record names, the omp failure line and gateway-lost row, and the AGENTS.md safety and layout lines now match the shipped code. Three commits in this plan (2afd9b5, a5ae315, 3cf9d64) corrected the audit.head timing, file and owner-ruling text. The other text the plan named was already on main before those commits (see the Tasks table).

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| T1 | omp.md: daemon.failed JSON event, gateway-lost row | 9e6ed08 (text); 891c7ad (row 183 re-run, plan 17-05 T3) | docs/integration/omp.md |
| T2 | runtime-decision.md: record names and event list | 09ec888 (base text); a5ae315 (audit.head timing and file) | docs/integration/runtime-decision.md |
| T3 | hardening-plan.md: H2 audit.head pin | 2afd9b5 (per-session wording); 9e6ed08 (first bullet) | docs/integration/hardening-plan.md |
| T4 | AGENTS.md: metrics safety line | 9e6ed08 | AGENTS.md |
| T5 | AGENTS.md: observe/ layout line | 09ec888 | AGENTS.md |

Owner-ruling wording: 3cf9d64 (O-b and O-d) edited runtime-decision.md and 17-CONTEXT.md.

Commits tagged `17-04` on main: 2afd9b5, a5ae315, 3cf9d64. Merged via PR 83 (merge a796b34). The commits 9e6ed08 and 09ec888 are on main but not tagged `17-04`; they are attributed here from `git log -S`.

## What changed

- `docs/integration/hardening-plan.md` H2: a "Head pin and start/stop record" bullet. `realm audit verify --head <seq>:<sha256>` checks a pinned head. The daemon writes `audit.head` per session at go-live and at destroy. The record is not a defence on its own. Commit 2afd9b5 changed one line (1 insertion, 1 deletion). The Non-goals bullet is still present.
- `docs/integration/runtime-decision.md`: "The daemon log records" names `emitStartup`, `emitAuditHead` and `emitFailure` (`src/daemon/main.ts`). `startupLine` no longer appears. `audit.head` and `audit.unreadable` are per session, at go-live and destroy.
- `docs/integration/omp.md`: the failure line is `{"ts":...,"level":"error","event":"daemon.failed","code":"<CODE>"}`, read by `src/daemon/ensure.ts`. The table rows that quoted `realm daemon: <CODE>` now show the JSON event, with a note on the rows that predate the cutover. The gateway-lost row records the 2026-10-30 observation and the 2026-11-15 re-run on a796b34.
- `AGENTS.md`: line 173 (safety section) says metrics are read only over the control socket (`realm metrics`), with no metrics listener. Line 74 (`observe/` layout) says the daemon uses the logger, the file sink and the metrics registry. The false clause "the daemon does not call them yet" is gone.
- `.planning/.../17-CONTEXT.md` (outside `files_modified`): the D-1704 amendment and the O-b and O-d rulings now say the behaviour is per session, as the owner chose on 2026-11-15.

## Verification

Read-only greps and file reads in the worktree. No tests, lint, typecheck or `npm run check:docs` were run in this summary.

- T1 Done-when: `grep "realm daemon: <CODE>\|not yet observed live" docs/integration/omp.md` prints nothing. Verified.
- T2 Done-when: `grep startupLine docs/integration/runtime-decision.md` returns 0 matches; `emitStartup` is present. Verified.
- T2 event list: the events I checked (`audit.head`, `audit.unreadable`, `daemon.stopped`, `daemon.log-close`, `startup.adoption_refused`, `daemon.failed`, `daemon.startup`, `lifecycle.transition`, `daemon.starting`, `daemon.listening`, `daemon.stopping`, `up.begin`, `up.end`, `tool.result`, `health.probe_failed`, `control.request`, `control.refused`) each appear in `src/daemon` or `src/observe`. `requests.log-close` and the full list were NOT VERIFIED.
- T3: `grep audit.head docs/integration/hardening-plan.md` matches; the Non-goals "Encryption of audit content" line is present. Verified. The Acceptance bullets were not diffed on main; commit 2afd9b5 touched one line only.
- T4: the metrics line is at AGENTS.md:173. Verified by grep. `npm run check:docs` NOT VERIFIED (not run).
- T5: `grep "does not call them yet" AGENTS.md` prints nothing; `logger.ts` is named at AGENTS.md:74. Verified.
- Code: `onAuditHead` is called at `src/daemon/daemon.ts:435` (go-live) and `:468` (destroy, after `appendAudit` of `session.destroy`). Verified by read.
- Owner rulings: 3cf9d64 diff of `runtime-decision.md` and `17-CONTEXT.md` is as described. Verified by `git show`.

NOT VERIFIED:
- `npm run check:docs` and the other docs checks after these edits.
- Whether the plan executor (not the orchestrator) authored 9e6ed08 and 09ec888. Attribution is from `git log -S`.
- The `requests.log-close` event and the full event list in runtime-decision.md.
- Live behaviour of `audit.head` per session. The 2026-11-15 live suite (plan 17-05) is recorded in its own summary, not here.
