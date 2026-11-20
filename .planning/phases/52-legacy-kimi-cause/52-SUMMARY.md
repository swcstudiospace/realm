---
phase: 52-legacy-kimi-cause
plan: "01"
requirements: [KIMV-02]
subsystem: hosts
tags: [kimi, root-cause, GAP-43-03]
---

# Plan 52-01 summary: legacy kimi cause (GAP-43-03)

The live rerun of plan step 2 is **BLOCKING (human)** — it needs the shared live lock and the
`realmlive` account, which this agent does not hold (`kimi` is not on this host; the plan's scratch
install was to be made on the live account). No live command was run. What follows is the root-cause
attempt by history, wire and source, which the plan's own step 3 permits: record NOT-ESTABLISHED
with the narrowed bounds stated.

## Verdict: NOT-ESTABLISHED (cause), narrowed as below

The failure of 2026-11-18 (`kimi mcp test realm` exit 0 after 18225 ms, recorder saw
`initialize`, `notifications/initialized`, `tools/list`, and no tool names) and the identical shape
of Phase-47 folder 10 (18294 ms, exit 0, no response in the recorder log) remain unexplained as a
single established cause. The bounds below are the narrowing: two candidate components are
exonerated by source, one instrument is indicted by its own code, and one client behaviour is
confirmed by observation. **GAP-43-03 stays open, narrowed — never relabelled.**

## What is exonerated (O, source)

- **`realm mcp` as an error source.** `src/cli/stdio-host.ts:298-328`: on the MCP transport the
  boot driver starts behind the server and `createMcpServer` is created in the same synchronous
  turn; the server answers `initialize` and `tools/list` at once, before boot settles, and
  declines tool calls only as `REALM_NOT_ACTIVE` retries. No code path answers `tools/list` with a
  JSON-RPC error; every reached run across the Phase 43 and Phase 47 windows (fake server, minimal
  restore, full restore) was answered with the six names. An error response on 2026-11-18 would
  have been written to the recorder log with the `error` flag (the tee records `error`/`errorCode`
  on responses; the frozen classifier keeps ERROR a separate class from NEVER-WRITTEN —
  `test/support/wire-timeline.ts`), and the Phase 43 record reports a plain absence of tool names,
  nothing flagged as an error.
- **`realm mcp` early close.** Teardown runs only at stdin end, on SIGTERM/SIGINT/SIGHUP, or after
  the server closes (`src/cli/stdio-host.ts:18-20, 251-276`). The server does not close itself while
  the client holds stdin open; the stack was reached on 2026-11-18 (container, sandbox and daemon
  existed after the run).

## What is indicted (O, code) — the recorder instrument

The wire recorder tee (`test/support/host-live-session.ts:324-442`) forwards the child's stdout
with `child.stdout.pipe(process.stdout)` and logs from a **separate** `child.stdout.on("data")`
handler (`tap`); the log line is appended (`appendFileSync`, `record`) only when that handler runs.
SIGKILL is neither handled nor forwarded (only SIGTERM/SIGINT, line 435) and cannot be handled.
Phase 47 observed the legacy client sending **SIGKILL to the stdio server a few milliseconds after
the `tools/list` response** (47-WINDOW §6, process trace), and in folder 10 the client printed the
connected line and all six tools **while the recorder log had no response line**
(47-WINDOW §4). So the instrument can lose its last line when the client kills the shim first;
both 2026-11-18 and folder 10 match that shape. The suspected failure of 2026-11-18 is therefore
most plausibly a **recorder log miss of a response the client did receive** — [INFERENCE]: the
window kept only the summary line, and the same loss in folder 10 is reported by the runner as
NEVER-WRITTEN, which is exactly how a lost line classifies.

## What would decide it (unchanged from the plan)

Plan step 2(c): rerun with the recorder that logs **before** forwarding, and keep the wire log and
the full `kimi mcp test realm` output. That is the human-blocked live step. If the log-before-
forward recorder shows the response the log-after-forward one misses, the cause is the instrument;
otherwise it is the client's close-after-response race. The stack and `realm mcp` need no further
work unless that rerun answers differently.

## Checks

- `npm ci --ignore-scripts --no-audit --no-fund` (the worktree had no `node_modules`; 145 packages).
- `npm run build` (`tsc -p tsconfig.json`): no errors.
- `node --test dist/test/support/wire-timeline.test.js dist/test/integration/host-live-kimi-helpers.test.js`:
  54 of 54 passed, 0 failed.
- `which kimi` on this host: command not found — consistent with the live step being human-blocked.
- Live 3-cold-runs classification, C1/C2 controls, and the 25000 ms bound: **not run** (no live lock,
  no `realmlive` account, no scratch install).
- No credential, no model turn, no env value printed; nothing under `src` changed.

## Files changed

- `.planning/phases/52-legacy-kimi-cause/52-SUMMARY.md` (this file) only. `dist/` and
  `node_modules/` are build output and ignored; no gap row was edited (the narrowing above is the
  record the next phase reads; relabelling GAP-43-03 was explicitly out of scope).

## Requirements

KIMV-02: closes only on an established or narrowed cause with bounding evidence. This attempt
narrows the cause to the recorder instrument [INFERENCE] with two source-exonerated components;
GAP-43-03 remains open, narrowed, and the deciding rerun stays human-blocked under plan step 2.
