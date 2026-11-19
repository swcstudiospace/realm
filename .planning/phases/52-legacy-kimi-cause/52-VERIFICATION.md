---
phase: 52-legacy-kimi-cause
verified: 2026-11-19
verdict: passed_with_accepted_limitations
status: passed
score: "0 of 1 requirements met (KIMV-02 NOT MET; cause NOT-ESTABLISHED, narrowed: realm mcp exonerated by source, recorder instrument indicted by its own code [INFERENCE], deciding live rerun human-blocked)"
ref: "origin/main 63bbc7e (history/wire/source read 2026-11-19; no live step run)"
behavior_unverified: 1
overrides_applied: 0
---

# Phase 52 Verification: Legacy kimi cause (GAP-43-03)

Method: a read of the phase records against KIMV-02 and the success criteria of `52-CONTEXT.md` / `52-PLAN.md`, on 2026-11-19, at origin/main `63bbc7e`. No live step was run for this verification; the phase itself ran no live step either (the live rerun is BLOCKING (human): it needs the shared live lock and the `realmlive` account, which the executing agent did not hold; `kimi` is not on that host). This verification reads the history/wire/source attempt in `52-SUMMARY.md` against the plan's step 3, which permits recording NOT-ESTABLISHED with the narrowed bounds stated.

## Requirements coverage

| Req | Status | Evidence |
| --- | --- | --- |
| KIMV-02 | NOT MET, carried (NOT-ESTABLISHED, narrowed) | The 2026-11-18 failure (`kimi mcp test realm` exit 0 after 18225 ms, recorder saw `initialize`, `notifications/initialized`, `tools/list`, no tool names) and the identical Phase-47 folder-10 shape (18294 ms, exit 0, no response in the recorder log) remain unexplained as a single established cause. The narrowing (all in `52-SUMMARY.md`, evidence labels kept): (1) `realm mcp` exonerated as an error source and as an early-closing source by source (`src/cli/stdio-host.ts:298-328` answers `initialize`/`tools/list` at once before boot settles, no path answers `tools/list` with a JSON-RPC error; teardown only at stdin end / SIGTERM/SIGINT/SIGHUP / server close, and the stack was reached on 2026-11-18); (2) the wire recorder tee indicted by its own code (`test/support/host-live-session.ts:324-442`: forwards via `child.stdout.pipe(process.stdout)` while logging from a separate `child.stdout.on("data")` handler, SIGKILL neither handled nor forwarded; Phase 47 observed the client sending SIGKILL a few ms after the `tools/list` response while the recorder had no response line) — [INFERENCE] the suspected 2026-11-18 failure is most plausibly a recorder log miss of a response the client did receive. Checks: `npm run build` no errors; `wire-timeline` + `host-live-kimi-helpers` 54/54 passed. GAP-43-03 stays open, narrowed — never relabelled; no gap row was edited by this phase (explicitly out of scope). |

## Success criteria

1. Scratch reinstall + cold rerun with wire log and full output kept (plan step 2): NOT RUN — human-blocked (live lock, `realmlive` account, scratch install on the live account). Recorded as such, not claimed.
2. Cause established as client / `realm mcp` / stack with bounding evidence: narrowed, not established — two components exonerated by source, one instrument indicted by code, one client behaviour confirmed by observation.
3. Fix where the cause is in `realm mcp`, or documented variant / retire decision if in the client: no fix — the cause is not established as in `realm mcp` and nothing was changed under `src`.
4. Records agree (gap row, matrix only if tier wording changes, boot page, snippet): no agreement edit was made because the phase's narrowing is the record the next phase reads; scratch removal and stack state did not apply (no live window ran).

## What is not met, and what is only inferred

- GAP-43-03 is not closed; the recorder-miss reading is [INFERENCE] only, exactly as the Phase-47 recorder-kill-order explanation was inference before it.
- What would decide it is unchanged (plan step 2(c)): rerun with the recorder that logs *before* forwarding, keeping the wire log and the full `kimi mcp test realm` output. If that recorder shows the response the log-after-forward one misses, the cause is the instrument; otherwise it is the client's close-after-response race. The stack and `realm mcp` need no further work unless that rerun answers differently.
- Live 3-cold-runs classification, C1/C2 controls and the 25000 ms bound: not run (no live lock, no `realmlive` account, no scratch install). No credential, no model turn, no env value printed, nothing under `src` changed.

## Verdict

passed_with_accepted_limitations. KIMV-02 is not met and is carried as NOT-ESTABLISHED, narrowed: `realm mcp` exonerated by source, the recorder instrument indicted by its own code [INFERENCE], the deciding rerun human-blocked. The phase is complete with the honest NOT-ESTABLISHED outcome; GAP-43-03 stays open, narrowed.
