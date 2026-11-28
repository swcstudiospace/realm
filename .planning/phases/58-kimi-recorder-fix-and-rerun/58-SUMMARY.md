---
phase: 58-kimi-recorder-fix-and-rerun
plan: "01"
requirements: [KIMV-02]
subsystem: hosts
tags: [kimi, recorder, GAP-43-03, live-rerun]
---

# Plan 58-01 summary: KIMV-02 recorder fix and rerun (GAP-43-03)

The recorder fix is hermetic and the deciding live rerun ran on 2026-11-27 on the provisioned production stack. **The recorder was the cause:** with the fixed recorder the `tools/list` response the log-after-forward recorder could lose is in the wire log, and `kimi mcp test realm` (kimi-cli 1.51.0) printed Connected + the six tools with exit 0. **GAP-43-03 closes on that evidence** (`docs/integration/host-plugin-gaps.md`), and **KIMV-02 is met on the cause**. The whole test still fails, but only at cleanup — `realm down` TOOL_TIMEOUT twice under load — a separate teardown-bound observation, not the recorder question. No `src/` change was made (this phase: no code changes beyond the test-support recorder fix described below).

## Recorder fix (hermetic, red-first)

`test/support/host-live-session.ts` (`teeSource`, generated `wire-tee.mjs`): the tee previously forwarded each direction with `pipe()` and logged in a separate `data` listener registered after the pipe. It now installs one `data` handler per direction that taps (synchronous `appendFileSync`) **before** writing the chunk onward — tap before forward in both directions, no `pipe()` forward:

```js
process.stdin.on("data", (chunk) => { tap("host-to-realm")(chunk); child.stdin.write(chunk); });
child.stdout.on("data", (chunk) => { tap("realm-to-host")(chunk); process.stdout.write(chunk); });
```

EOF, exit-code path and SIGTERM/SIGINT forwarding are unchanged; log shape is unchanged, so `wire-timeline.ts` / `wire-timeline-run.ts` are untouched. Every live harness that asserts the wire summary uses this one recorder (`writeWireRecorder`), so all of them get the fix.

Red-first row in `test/support/host-live-recorder.test.ts`: (a) ordering test over the generated `wire-tee.mjs` — asserts no `pipe()` forward and tap-before-write in both handlers, failed pre-fix and passes after; (b) SIGKILL control — a `tools/list` response with the six tool names is in the wire log when the host kills the recorder right after reading it. Local run 2026-11-21: 53 passed, 0 failed across the recorder and adjacent suites.

## Deciding rerun (2026-11-27, final)

Stack: `realmlive`, HEAD `7517be6`, image `sha256:6272a3ac…` (`check:image-digests` ok), podman 5.7.1, driver/gateway running, gateway id `openshell`; kimi-cli 1.51.0 in scratch via uv, `REALM_KIMI_BIN` pointing at it; fixed log-before-forward recorder; evidence `z58-20261127` (`58-WINDOW.md` "2026-11-27 final live run").

- Wire log (`02-all/wire.log`, repeated identically in `04-all`): `tools/list` request at **t=1586**, `realm-to-host response id=1 toolNames=[exec read write list status retry]` at **t=1587** — six tools on the wire, 1 ms after the request. The response the log-after-forward recorder could lose is IN the log.
- Host output (`command-stdout.txt`): `kimi mcp test realm` (1.51.0, 2026-11-27) prints **Connected + the six tools, exit 0**, elapsed ~9–10 s, `catalogueCodes []`.
- Whole-test verdict: the production case fails only at cleanup — `realm down: exit 1 TOOL_TIMEOUT` ("A tool call did not finish within its queue timeout") twice identically (whole test 37–42 s, under sustained host load 20–46), from the daemon-side control/queue bound, well before the harness's 120 s down bound. Teardown completes (zero containers, daemon absent after); the six-tools substance passes.

## Cause and requirement

Per D-58-3 the rerun shows the response, so the **recorder was the cause** — the client, the stack and `realm mcp` are not the failing component on this evidence. GAP-43-03 is closed in `docs/integration/host-plugin-gaps.md` on the wire log plus full output (version and date recorded); the row is never closed by inference. KIMV-02 is met on the cause.

The cleanup-down TOOL_TIMEOUT under load is a separate teardown-bound observation (cf. Phase 56 row-absent stops), recorded as such in `58-WINDOW.md` and the gap row; it is not the recorder question and does not reopen GAP-43-03.

## Provenance

Earlier state: hermetic fix 2026-11-21 (`58-EVIDENCE.md`); window attempted 2026-11-22 and blocked, stack down (`58-WINDOW.md` §3, `58-VERIFICATION.md` 2026-11-25); re-attempt 2026-11-27 (image/runtime absent); final run 2026-11-27 above, verified by `58-VERIFICATION-UPDATE-20261127.md`. Phase 59 remains excluded (gated on owner ratification of `53-DESIGN.md`, D-v9-6).
