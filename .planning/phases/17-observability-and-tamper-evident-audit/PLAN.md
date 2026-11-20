# Phase 17 — PLAN (consolidation)

Reused detail: `17-01..17-05-PLAN.md` (PRs A/B/C0/C1/C2/D per D-1706).
Each OBS ID appears in exactly one plan below; waves are file-disjoint.

## Wave 1 — Gateway code + observe libraries (parallel, disjoint)
- P17-01 [OBS-04] files: `src/runtime/agentos.ts`,
  `src/runtime/agentos-driver.ts`, `test/runtime/agentos.test.ts`.
  Observable: stopped gateway → `OPENSHELL_GATEWAY_LOST` in status+probe
  (not `AGENTOS_CRASH_LOOP`); driver-only loss per O-e amendment.
  Automated pass; live scenario 10 human-needed.
- P17-02 [OBS-02] files: `src/observe/logger.ts`, `src/observe/log-file.ts`,
  `src/observe/ids.ts`, `test/observe/logger.test.ts`. (Libraries only,
  no consumers — C0.) Observable: one JSON object/line, ts/level/event/code,
  redacted, never throws, 4 MiB rotation. Automated partial.

## Wave 2 — Chain + daemon integration (after Phase 14 part 2)
- P17-03 [OBS-01] files: `src/audit/chain.ts`, `src/cli/audit.ts`,
  `src/cli/main.ts`, `test/audit/chain.test.ts`. Observable: untouched
  passes; edit/delete/reorder/prefix-loss/tail-loss each fail naming the
  first broken line; head/anchor selectors work. Automated pass.
- P17-04 [OBS-03] files: `src/observe/metrics.ts`, `src/daemon/channel.ts`,
  `src/daemon/client.ts`, `src/cli/metrics.ts`, `test/daemon/metrics.test.ts`.
  Observable: `realm metrics` over control socket only; `/proc` test shows
  no new listener. Automated pass; live counts human-needed.

Wave 2 P17-03/P17-04 depend on P17-02 libraries + Phase 14 merged.
Live evidence (scenarios 5/6/10) is a parent-run human-needed checkpoint,
not claimed here.
