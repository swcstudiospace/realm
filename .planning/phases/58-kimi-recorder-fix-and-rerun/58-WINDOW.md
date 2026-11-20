# Phase 58 window record (plan 58-01)

Observed in this window on 2026-11-20; I is an inference and is never stated as a result. No live command was run in this
window: plan step 3 is BLOCKING (human) — it needs the shared live lock and the live account, which the executing agent does
not hold (`kimi` is not on this host; there is no kimi binary in the live account's home either). Step 2 (the scratch install
of kimi-cli 1.51.0) exists only to serve step 3, so it was not made. This record states what was done instead and what the
fix does and does not prove.

## 1. Header (O)

| Item | Value |
| --- | --- |
| Date | 2026-11-20 |
| Commit under test | c679e31 (HEAD of the worktree; `Merge pull request #245 from swcstudiospace/gsd/v9plan`) |
| Node | v24.18.0 |
| Deps | `npm ci --ignore-scripts --no-audit --no-fund`: 145 packages (the worktree had no `node_modules`) |
| Live | not run (see §3) |

## 2. The recorder fix (O)

`test/support/host-live-session.ts`, `teeSource` (the one and only wire-recorder implementation in the repo; a grep over
`test/support` finds no second tee): the log tap was registered after the forwarding `pipe` in both directions. The fix
registers the tap first in both directions —

```
process.stdin.on("data", tap("host-to-realm"));
process.stdin.pipe(child.stdin);
child.stdout.on("data", tap("realm-to-host"));
child.stdout.pipe(process.stdout);
```

— so each line is appended to the log synchronously (`appendFileSync` inside `record`) before the forward write of that
chunk. A host that SIGKILLs the tee the moment a response arrives cannot take that response's line with it. The comment
block above `teeSource` states this. The log shape is unchanged: `test/support/wire-timeline.ts` and
`test/support/wire-timeline-run.ts` were not touched and their tests pass.

Every live harness that asserts the wire summary imports this one recorder: `test/support/host-live.ts` (the production
harness, `runHostProduction`), `test/integration/host-live-kimi.test.ts`, `host-live-kimi-code.test.ts`,
`host-live-codex.test.ts`, `host-live-muse.test.ts`, `host-live-opencode.test.ts` and
`capability-live-enforce.test.ts`. The fix therefore reaches every one of them; none kept a private copy.

### Red-first hermetic proof (O)

Two new rows in `test/integration/host-live-session-helpers.test.ts` (the always-running hermetic suite of the recorder;
the plan's kimi test files are gated and were left read-only):

1. **Ordering pin (fails pre-fix).** It reads the generated `wire-tee.mjs` and asserts the tap is registered before the
   pipe in both directions. Run against the unfixed source it failed with `the host-to-realm line is logged before it is
   forwarded`, pass 1 of 2, fail 1 of 2.
2. **Kill-after-receive retention.** The host sends `initialize` + `tools/list` through the recorder to the fake MCP
   server and SIGKILLs the shim in the same data callback that receives the two response lines (SIGKILL cannot be caught,
   blocked or forwarded). After the kill, the wire log still holds the `tools/list` response with the six tool names and
   `wireSummary(...).answered` is true.

Honest marking of row 2: it also passed pre-fix, because Node dispatches the `data` listeners of one chunk in the same
tick, so the old code usually still logged the line. Row 2 is therefore the retention guarantee, not the red proof; row 1
is the red proof. After the fix, row 2's guarantee is structural: the log append precedes the forward write in the same
dispatch, so no kill timing can drop a forwarded line.

### Checks (O)

- Pre-fix, the two new rows: pass 1, fail 1 (the ordering pin).
- Post-fix, `node --test dist/test/integration/host-live-session-helpers.test.js
  dist/test/integration/host-live-timeline-helpers.test.js dist/test/integration/host-live-kimi-helpers.test.js
  dist/test/support/wire-timeline.test.js`: 83 of 83 passed, 0 failed.
- Gated `dist/test/integration/host-live-kimi.test.js` and `host-live-kimi-code.test.js`: 8 skipped, 0 failed (no `kimi`
  on this host, so the gates skip).
- `npm run build`: no errors. `npx eslint` on the two changed source/test files: no issues.
- No credential, no model turn, no env value printed, nothing under `src` changed, no new dependency.

## 3. Deciding live rerun (NOT RUN)

Plan steps 2–3 were not run. `which kimi` on this host: command not found. The live account's home holds no kimi binary
(only docs, tests and the evidence directories of Phases 43 and 47). The shared live lock and the live account are held by
the owner/orchestrator, not by this agent, so the cold production tier with the fixed recorder could not be run, and the
scratch install outside the repository was not made. No wire log and no `kimi mcp test realm` output were kept, because no
run happened. Nothing about the 25000 ms cold-connect bound is claimed either way.

## 4. Cause (O / I)

**NOT-ESTABLISHED, narrowed — unchanged from Phase 52, with one difference: the recorder side is now fixed, not only
indicted by its code.** KIMV-02 is carried. GAP-43-03 stays open, never relabelled.

- O (carried from 52, unchanged): `realm mcp` exonerated as an error source and as an early-closing source by source
  (`src/cli/stdio-host.ts` answers `initialize`/`tools/list` at once before boot settles; teardown only at stdin end /
  SIGTERM/SIGINT/SIGHUP / server close, and the stack was reached on 2026-11-18).
- O (new): the log-before-forward fix is in and hermetically proven as above; every live harness uses this one recorder.
- I (unchanged): whether the run of 2026-11-18 was a recorder miss of a response the client did receive is still inference.
  The fix removes the mechanism the inference points at; it does not retroactively establish the cause.

## 5. What would decide it (unchanged)

Plan step 3, when a human holds the live lock and the live account: the cold production tier (kimi-cli 1.51.0, scratch
install outside the repository, Phase 47 classification rules and C1/C2 controls) with this recorder, keeping the wire log
and the full `kimi mcp test realm` output. If the response appears, the recorder was the cause and GAP-43-03 closes on that
evidence; otherwise the client's close-after-response race is the narrowed cause and GAP-43-03 is not relabelled. If the
rerun indicts `realm mcp`, fix red-first and the tier must pass.

## 6. Records agreed

- GAP-43-03 row (`docs/integration/host-plugin-gaps.md`): one factual sentence added — Phase 58 fixed the recorder
  hermetically on 2026-11-20; the deciding live rerun has not been run; the cause stays NOT ESTABLISHED, narrowed; the gap
  stays open. No other wording changed. If Phase 57's wave also touches this table, this edit is the one to rebase.
- Support matrix (`docs/integration/host-support-matrix.md`): untouched — the tier wording did not change.
- No scratch install was made, so no scratch was removed; the stack is as found (nothing was started).
