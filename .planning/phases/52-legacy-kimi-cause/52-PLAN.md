# Plan 52-01: Legacy kimi cause (GAP-43-03)

**Phase:** 52-legacy-kimi-cause · **Requirements:** KIMV-02 (gap GAP-43-03) · **Wave:** 1–2, serial (shared live lock; scratch install outside the repository).

**Files:** `test/support/host-live-kimi.ts` (reuse; recorder variants only), `test/integration/host-live-kimi.test.ts` (read-only; gated), `src/cli/stdio-host.ts` / `realm mcp` path (fix only if the cause is there), `docs/integration/host-plugin-gaps.md` (GAP-43-03 row), `docs/integration/host-support-matrix.md` (generated block only if the tier wording changes), `.planning/phases/52-legacy-kimi-cause/52-WINDOW.md`.

## Steps

1. **Scratch reinstall.** Install kimi-cli 1.51.0 in a scratch location outside the repository (record version, install source, date; remove after). Reuse the Phase 47 classification rules (never-written / after-close / error) and the C1/C2 controls.
2. **Live rerun with ablation (BLOCKING, human).** Cold production tier with the wire log and full `kimi mcp test realm` output kept outside the repository. Ablation steps, each bounded: (a) default drive, 3 cold runs; (b) warm control (session up first); (c) recorder that logs *before* forwarding (tests the SIGKILL-after-response inference); (d) `realm mcp` alone timing (C2 repeat). Each step names the component it exonerates or implicates.
3. **Establish or narrow.** Record the failing component as client / `realm mcp` / stack in `52-WINDOW.md` and the GAP-43-03 row, with the bounding evidence (which ablation step changed the outcome). If the cause is in `realm mcp`, fix red-first (fail closed kept) and the tier must pass. If in the client, show the tier passing in a documented variant or record the owner's retire decision (OQ-24-01). If nothing reproduces, record NOT-ESTABLISHED with the narrowed bounds stated — never relabel GAP-43-03.
4. **Agree the records.** Gap row, support matrix block (only if the tier wording changes), wave 1 boot page, kimi snippet — only what the evidence supports. Scratch removed; stack as found.

## Checks

- Hermetic (if a fix lands): red-first test failing pre-fix; `npm run build` + owning test file.
- Live: 3 cold runs classified (never-written / after-close / error), controls C1/C2 answered, durations recorded against the 25000 ms bound (a bound miss is a tier failure, not a cause).
- No credential, no model turn, no value printed; operator's real Kimi config byte-equal.
