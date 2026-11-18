---
phase: 33-cold-attach
plan: "02"
status: complete
requirements: [COLD-01, COLD-02, COLD-03]
---

# 33-02 summary: serve-early contract in the docs, two gap rows narrowed

## Edited pages

- `docs/integration/mcp.md` Q7: rewritten to the serve-early contract (server created after step 1, steps 2 to 5 behind it; the handshake, server/discover and tools/list answered at once; the not-active window and its refusal; what ends the window; the scripted-client note; a host that leaves in the window; the failure table of five rows; teardown with the marker and reports only after adoption; the evidence paragraph, with no live claim). Q1 to Q6 and Q8 to Q10 are unchanged.
- `docs/integration/host-plugin-contract.md`: sequence rows 5 and 6, the stdin sentence, the readiness contract, one sentence in the driver paragraph, and the residual about serve-after-boot (now says MCP is addressed in code, ACP unchanged, no live cold run). Rehearsal rows untouched.
- `docs/integration/acp.md` Q6: states that ACP still answers only after the boot settles and still exits 1 on a failed boot; no longer says it runs the same boot order as `realm mcp`.
- `docs/integration/host-plugin-gaps.md`: GAP-23-02 and GAP-31-04 are narrowed (not closed), cite existing repository paths, say no live cold run has been made, and name plan 33-03 as the closer. No other row changed.

## Statements corrected to the code

- The old Q7 said that when `up` was refused and the readback confirms this root, "every call is refused". The built code adopts the client in that case, so calls are forwarded and the daemon answers each with its refusal (D-33-05 row 2, `src/host/boot-driver.ts`). The new text follows the code.
- The residual in the contract page ("Serve-after-boot can exceed ... serve-early is the follow-up") was not in the plan's task list but became false for MCP; it was rewritten (the sweep rule).

## Sweep hits and dispositions

- Fixed in place: Q7 of mcp.md; the readiness contract, sequence table, stdin sentence and residual in the contract page; Q6 of acp.md.
- Kept (ACP): `docs/integration/host-plugin-contract.md` lines about ACP reading stdin after step 5 and ACP's first reply being the readiness signal.
- Kept as dated 2026-11-18 records for plan 33-03: `docs/integration/wave1-boot-matrix.md` (rows 13 to 15, line 23, line 26, line 33), `docs/integration/host-support-matrix.md` (rows 47, 48, 50), `docs/hosts/snippets/claude-code.md`, `codex.md`, `opencode.md` (warm session), contract rehearsal rows (341 to 343), the GAP-31-04 observation text and `host-plugin-gaps.md` row 47 (GAP-24-03, a warm run record).
- Not related: `docs/integration/omp.md` and `omp-lifecycle-runbook.md` (Omp warm-up of another subject).
- Reported, not edited (outside the four files): `.planning/REQUIREMENTS.md` line 134 (BOOT-03, a completed v3 requirement: "serves nothing before settle; a terminal failure exits 1 ... nothing on stdout") and the same text in archived milestone files under `.planning/milestones/`; these are historical records, so left unchanged. README.md has no hit.

## Checks run

- `npm run check:docs` (host-paths, agents-sync, default-mode): ok.
- `npx tsc -p tsconfig.json`: clean.
- `node --test dist/test/docs/*.test.js dist/test/host/*docs*`: 53 pass, 0 fail (includes host-gaps, wave1-boot-matrix, host-docs).
- Not run: lint, the full suite, any live run.
