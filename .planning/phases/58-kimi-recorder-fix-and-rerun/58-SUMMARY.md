---
phase: 58-kimi-recorder-fix-and-rerun
plan: "01"
requirements: [KIMV-02]
subsystem: hosts
tags: [kimi, recorder, GAP-43-03, hermetic]
---

# Plan 58-01 summary: KIMV-02 recorder fix and rerun

The log-before-forward recorder fix is landed and hermetically proven, red-first. The deciding live rerun (plan steps 2–3)
is **BLOCKING (human)**: no `kimi` on this host, no kimi binary in the live account's home, and the shared live lock and
live account are not held by this agent. Like Phase 52, no live command was run; the cause stays **NOT-ESTABLISHED,
narrowed, and GAP-43-03 stays open — never relabelled**. The full record is `58-WINDOW.md` in this directory.

## What changed

- `test/support/host-live-session.ts` — in `teeSource` (the single wire-recorder implementation every live harness uses)
  the log tap is now registered **before** the forwarding `pipe` in both directions, so each line is appended to the log
  synchronously before the forward write of that chunk; a host that SIGKILLs the tee the moment a response arrives cannot
  take the response line with it. The comment above `teeSource` says so. Log shape unchanged (the wire-timeline readers
  are untouched, their tests pass).
- `test/integration/host-live-session-helpers.test.ts` — two new hermetic rows: (1) an ordering pin on the generated
  `wire-tee.mjs` (tap before pipe, both directions) — **failed pre-fix** (`the host-to-realm line is logged before it is
  forwarded`), pass 1/fail 1 of the pair; (2) a kill-after-receive retention row — the host SIGKILLs the shim in the data
  callback that receives the `tools/list` response, and the log still holds the response with the six tool names and
  `answered` true. Row 2 also passed pre-fix (same-tick `data` dispatch), so row 1 is the red proof and row 2 the
  structural retention guarantee; that nuance is recorded in `58-WINDOW.md`, not hidden.
- `docs/integration/host-plugin-gaps.md` — GAP-43-03 row: one factual 2026-11-20 sentence (fix landed hermetically,
  deciding live rerun not run, cause stays NOT ESTABLISHED narrowed, gap stays open). Nothing else in the row changed.

Harness confirmation (D-58-2): every live harness that asserts the wire summary imports `writeWireRecorder` from
`test/support/host-live-session.js` — `test/support/host-live.ts` (`runHostProduction`) plus the kimi, kimi-code, codex,
muse, opencode and capability live tests. No second recorder exists in `test/support`, so the fix reaches all of them.

## Live outcome (honest)

NOT RUN. Reasons, all observed: `which kimi` — command not found; `/home/realmlive` has no kimi binary (docs, tests and
the Phase 43/47 evidence directories only); the shared live lock and the `realmlive` account belong to the
owner/orchestrator. The scratch install (step 2) was not made because it serves only the live rerun (step 3). No wire log
and no full `kimi mcp test realm` output exist to keep; nothing is claimed about the 25000 ms cold-connect bound. What
would decide it remains plan step 3 under a human-held lock: if the fixed recorder shows the response the old one missed,
the recorder was the cause and GAP-43-03 closes on that evidence; otherwise the client's close-after-response race is the
narrowed cause and the gap is not relabelled. Whether 2026-11-18 was a recorder miss is still [INFERENCE] — the fix
removes the mechanism, it does not retroactively establish the cause.

## Checks

- `npm ci --ignore-scripts --no-audit --no-fund`: 145 packages (worktree had no `node_modules`).
- Red-first: the two new rows against the unfixed source — pass 1, fail 1 (ordering pin failed as required).
- `npm run build` (`tsc -p tsconfig.json`): no errors, before and after the fix.
- Post-fix: `node --test dist/test/integration/host-live-session-helpers.test.js
  dist/test/integration/host-live-timeline-helpers.test.js dist/test/integration/host-live-kimi-helpers.test.js
  dist/test/support/wire-timeline.test.js`: **83 of 83 passed, 0 failed**.
- Gated `dist/test/integration/host-live-kimi.test.js` and `host-live-kimi-code.test.js`: 8 skipped, 0 failed.
- `npx eslint test/support/host-live-session.ts test/integration/host-live-session-helpers.test.ts`: no issues.
- Live 3-cold-runs classification, C1/C2 controls, 25000 ms bound, scratch install: **not run** (human-blocked above).
- No credential, no model turn, no env value printed; nothing under `src` changed; no new dependency, catalogue or
  contract change. Scratch: none made, none to remove; stack as found.

## Files changed

- `test/support/host-live-session.ts` (recorder fix + comment)
- `test/integration/host-live-session-helpers.test.ts` (two hermetic rows)
- `docs/integration/host-plugin-gaps.md` (GAP-43-03 Phase 58 note only)
- `.planning/phases/58-kimi-recorder-fix-and-rerun/58-WINDOW.md` (new)
- `.planning/phases/58-kimi-recorder-fix-and-rerun/58-SUMMARY.md` (this file)

## Requirements

KIMV-02: closes only on an established cause with bounding evidence. This attempt lands the recorder side of it
hermetically and honestly marks the live half as human-blocked: the cause is narrowed further (instrument fixed, mechanism
removed) but NOT ESTABLISHED, GAP-43-03 remains open, and the deciding rerun stays owed under plan step 3.
