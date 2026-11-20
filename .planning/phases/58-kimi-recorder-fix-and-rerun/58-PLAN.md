# Plan 58-01: KIMV-02 recorder fix and rerun

**Phase:** 58-kimi-recorder-fix-and-rerun · **Requirements:** KIMV-02 (gap GAP-43-03) · **Wave:** 1–2, serial (shared live lock; scratch install outside the repository; doc edits land after Phase 57 or are rebased). Phase 59 is explicitly excluded (gated on D-v9-6).

**Files:** `test/support/host-live-session.ts` (wire recorder: log before forwarding), `test/support/wire-timeline.ts` and `test/support/wire-timeline-run.ts` (reader, unchanged unless the log shape changes), `test/support/host-live-kimi.ts` (reuse), `test/integration/host-live-kimi.test.ts` and `test/integration/host-live-kimi-helpers.test.ts` (read-only; gated, plus the red-first hermetic row), `src/cli/stdio-host.ts` (fix only if the rerun indicts `realm mcp`), `docs/integration/host-plugin-gaps.md` (GAP-43-03 row), `docs/integration/host-support-matrix.md` (generated block only if the tier wording changes), `.planning/phases/58-kimi-recorder-fix-and-rerun/58-WINDOW.md`.

## Steps

1. **Fix the recorder (red first).** Change the wire recorder in `test/support/host-live-session.ts` to log before forwarding, so a response that the client SIGKILLs right after is visible in the log. Add a hermetic row showing a response visible after the fix that the old code dropped; the new row fails pre-fix. Confirm every live harness that asserts the wire summary uses the fixed recorder.
2. **Scratch reinstall.** Install kimi-cli 1.51.0 in a scratch location outside the repository (record version, install source, date; remove after). Reuse the Phase 47 classification rules (never-written / after-close / error) and the C1/C2 controls.
3. **Deciding live rerun (BLOCKING, human).** Cold production tier with the fixed recorder, keeping the wire log and the full `kimi mcp test realm` output outside the repository. If the response appears, the recorder was the cause; otherwise the client's close-after-response race is recorded as the narrowed cause. If the rerun indicts `realm mcp`, fix red-first (fail closed kept) and the tier must pass. Version and date recorded.
4. **Establish or carry (KIMV-02).** Record the failing component as client / recorder / `realm mcp` / stack in `58-WINDOW.md` and the GAP-43-03 row, with the bounding evidence. If nothing reproduces, record NOT-ESTABLISHED with the narrowed bounds stated — never relabel GAP-43-03, and the recorder inference is no longer inference once the rerun runs.
5. **Agree the records.** Gap row, support matrix block (only if the tier wording changes), wave 1 boot page, kimi snippet — only what the evidence supports. Scratch removed; stack as found.

## Checks

- Hermetic: the red-first recorder row fails pre-fix and passes after; `npm run build` plus the owning test files; `npm run lint` on changed files.
- Live: the rerun keeps the wire log and the full `kimi mcp test realm` output; the outcome (recorder cause / client race / `realm mcp` fix) names the component with bounding evidence; durations recorded against the 25000 ms cold-connect bound (a bound miss is a tier failure, not a cause).
- No credential, no model turn, no value printed; the operator's real Kimi config is byte-equal; no new dependency, catalogue or contract change.
