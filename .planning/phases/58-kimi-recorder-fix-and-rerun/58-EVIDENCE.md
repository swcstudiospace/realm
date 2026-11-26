# Evidence 58: KIMV-02 recorder fix (hermetic)

**Date:** 2026-11-21 (hermetic), updated 2026-11-22 (window attempted, blocked) · **Requirement:** KIMV-02 (GAP-43-03) · **Plan:** `58-PLAN.md` steps 1 and 3 · **Status:** hermetic fix landed; the deciding live rerun (58-PLAN step 3) was attempted 2026-11-22 and is BLOCKED — production stack down on this host (see §3 and 58-WINDOW.md). GAP-43-03 is not closed.

## 1. Fix description

`test/support/host-live-session.ts` (`teeSource`, the generated `wire-tee.mjs`): the tee previously forwarded each direction with `pipe()` and logged in a separate `data` listener registered after the pipe. It now installs one `data` handler per direction that logs (tap, synchronous `appendFileSync`) **before** writing the chunk onward:

```js
process.stdin.on("end", () => { child.stdin.end(); });
process.stdin.on("data", (chunk) => { tap("host-to-realm")(chunk); child.stdin.write(chunk); });
child.stdout.on("data", (chunk) => { tap("realm-to-host")(chunk); process.stdout.write(chunk); });
```

A log write error is swallowed before the forward (was: after). EOF still ends the child's stdin, as `pipe()` did; exit code and signal forwarding are unchanged. Log shape is unchanged, so `wire-timeline.ts` and `wire-timeline-run.ts` are untouched. Live harnesses that assert the wire summary use this same recorder (`writeWireRecorder`), so all of them get the fix.

## 2. Hermetic evidence (red-first)

`test/support/host-live-recorder.test.ts` (beside the recorder in `test/support/`):

- `the wire tee logs before forwarding in both directions (no pipe-forward, tap first)` — reads the **generated** `wire-tee.mjs` and asserts no `pipe()` forward in either direction and tap-before-write ordering in both handlers. **Failed pre-fix** (`the tee must not pipe-forward the target's stdout`) and **passes after the fix**.
- `a tools/list response is in the wire log when the host kills the recorder right after reading it` — runs the recorder in front of the fake MCP server, and SIGKILLs the recorder the moment the host has read the `tools/list` response (the GAP-43-03 close-after-response race). The response, with the six tool names, is in the wire log (`readWireLog`). Passes with the fix.

Local run (2026-11-21): the new file plus the existing suites that exercise the recorder — 53 passed, 0 failed (`dist/test/support/host-live-recorder.test.js`, `dist/test/integration/host-live-session-helpers.test.js`, `dist/test/support/wire-timeline.test.js`). Note: a repo-wide `tsc` currently fails on pre-existing errors in `src/doctor/checks.ts` (a peer's in-flight edit, not this phase); the test run above used the emitted `dist` output and did not touch `src/`.

## 3. Deciding live rerun — attempted 2026-11-22, BLOCKED (see 58-WINDOW.md)

58-PLAN step 3 was attempted on 2026-11-22 under the shared live lock (which was free) as the live account. The preflight found the production stack down on this host: OpenShell has no gateway configured, the realm gateway/compute-driver user units are absent and inactive, the rootless Podman image list is empty (no digest-pinned image), and no driver config, driver socket or runtime directory exists for the live account. The production tier's gate variables have no values on this host, so no cold production run was made and no wire log or `kimi mcp test realm` output exists. The recorder fix (§1), the red-first row (§2) and the kimi-cli 1.51.0 scratch install (verified 2026-11-22 outside the repository, removed after) are the window's evidence; the component stays NOT-ESTABLISHED with the narrowed bounds stated in 58-WINDOW §4. GAP-43-03 stays `narrowed` (never closed by inference) and the recorder fix is hermetic evidence only. No `src/` change: the rerun never indicted `realm mcp`, so per the plan there is none. KIMV-02 is carried, narrowed — not met.

Phase 57 (HTIER-01) live retest is likewise human-blocking (needs a Grok Build live window); recorded docs-only in `docs/integration/host-plugin-gaps.md`, no result claimed, GAP-40-01 wording intact.
