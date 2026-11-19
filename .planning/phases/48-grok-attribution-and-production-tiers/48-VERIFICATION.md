---
phase: 48-grok-attribution-and-production-tiers
verified: 2026-11-19
verdict: passed_with_accepted_limitations
status: passed
score: "3 of 5 requirements met (HTIER-02, HTIER-03, HTIER-05); HTIER-01 NOT MET live (validator matrix passed, live both-files attach never reached the host); HTIER-04 NOT MET (Grok failed honestly at install on a harness defect)"
ref: "origin/main 3160320 (window 2026-11-19T12:18:38Z, commit 999cb2f, Grok Build 1.0.77, Muse Code 1.4.24, Prime Agent 0.10.2)"
behavior_unverified: 2
overrides_applied: 0
---

# Phase 48 Verification: Grok Build attribution and production tiers

Method: a read of the phase records against HTIER-01 to HTIER-05 and the success criteria of `48-CONTEXT.md`, on 2026-11-19, at origin/main `3160320`. No live step was run for this verification. The window is copied from `48-WINDOW.md` (evidence outside the repository). Owner decision OD-48-1 (answered yes) promotes a passing production tier to `proven` — only Muse Code passed.

## Requirements coverage

| Req | Status | Evidence |
| --- | --- | --- |
| HTIER-01 | NOT MET live (validator proven, live audit open) | 48-01 source matrix on Grok Build 1.0.77 (cells a–i, each run twice, plus extras): the recipe's `config.toml` entry wins in every combination that holds it (cell c: Claude file `server_count` 0, shadowed), Outcome A; the gated validator step passed in the window (Step A). Residual: the Claude-file-alone cell (b, and h0) is attributed `claude` — GAP-40-01 stays accepted-residual with the missing Grok feature named (a per-vendor MCP switch that works, or a host name in a shared file; the `[compat.claude] mcps = false` switch exists but does not stop the Claude file loading, F-2, not shipped per OD-48-4, must not be documented as a workaround). The live both-files attach never reached the host (Step B failed at `realm host install grok-build --dry-run`: `config-home-missing`, `POLICY_DENIED` — harness defect, owning plan 48-02 `productionOverrides` not creating `<grok-home>/.grok`); no audit line was written. The Claude-alone control (Step C) showed the right attribution by presence (`claude-active`) but wrote no attach line and held 0 attached boot reports (cold doctor left before the attach settled — the case 48-02 deviation 2 predicted). GAP-48-03 carries the harness fix; GAP-48-01 carries the claude-only cell and the no-model-turn limits. `adapters/claude-plugin` stays labelled `claude`. |
| HTIER-02 | MET | Muse Code 1.4.24 (recorded 1.4.23) passed its production tier cold on 2026-11-19 (Step D): `muse exec --provider echo --trust-workspace` from a new project directory, `--host muse-code`, full wire (initialize, notifications/initialized, tools/list, six tools), 5891 ms, zero live sessions, real settings byte-equal. Registry T3 `rehearsed`; runtime tier `config-only` → `proven` (OD-48-1 yes). The host left before the realm was ready (judged from the wire, as for codex) — recorded, not a failure. |
| HTIER-03 | MET by named blocker | Prime Agent 0.10.2: no credential-free command starts the registered server (B-48-02, a host property: MCP is initialized on first use through the model's REPL; `mcp list`/`status`/`doctor`/RPC/ACP/refusing-provider probes all failed to start it). Step E skipped with the fixed sentence; registry T3 `gap` (`B-48-02:`); GAP-48-04 accepted-residual. The daemon residue found in acp mode (socket dir under the system tmp, F-7) was removed by hand and the window snapshots it. |
| HTIER-04 | NOT MET, honestly failed | Grok Build 1.0.77 production tier (Step F) failed at install with the same `config-home-missing` first assertion; no host command ran, no wire. Not a pass and not a named host blocker — a harness defect carried as GAP-48-03 (unverified-behavior, open; fix carries the owning plan 48-02). Tier stays `config-only`; T3 `gap` with a note starting `rehearsal failed`. No live re-run was made in plan 48-04. |
| HTIER-05 | MET | Registry, generated matrix block, wave 1 page (8 cells per host, version/date/GAP ids), contract page (wave 2 statement corrected: "no wave 2 host other than Muse Code, Prime Agent and Grok Build has a production tier"), gaps page (GAP-40-01, GAP-48-01/02/03/04, GAP-25-07 narrowed, GAP-34-01 evidence lists), host pages and snippets, and pinning tests agree. `test/integration/enforce-default.test.ts` passes unedited; no launcher added, so the labelled-launcher guard needed no entry. No blocked/failed/not-reproduced result is written as a pass (re-read claim-by-claim in 48-04-SUMMARY). |

## Success criteria

1. Live both-files audit line `grok-build`, or accepted-residual with the missing feature named: NOT MET live — the residual is named and documented, but the seam exists and the live demonstration is open (GAP-48-03), so this is carried, not closed by the alternative clause alone.
2. Each of Muse/Prime/Grok: production tier or named blocker, version/date recorded, registry tier updated: MET for Muse (passed) and Prime (blocker B-48-02); NOT MET for Grok (failed, no re-run).
3. Registry/matrix/contract/gaps/host pages/pinning tests agree: met.
4. `enforce-default` still attaches every host id; launcher coverage: met.

## What is not met, and what is only inferred

- The live `grok-build` audit line for the both-files attach is not demonstrated; the attribution rests on the validator matrix (validator tier, no Podman) and its gated step, not on a production attach.
- First-source-wins is an observation of 1.0.77 and its documented source order (config, Claude, Cursor, `.mcp.json`), not a guarantee for later versions; the gated step fails on a version that changes it.
- Prime Agent downloads a Python runtime into HOME on first use (host network use, not contained: GAP-48-02, accepted-residual); the three CLIs' network use is not contained or measured.
- Muse `exec`/`status`/`doctor` never started the stub in the probes (Prime) — the live window is the production result, not the probe.

## Verdict

passed_with_accepted_limitations. Three of five requirements met; HTIER-01 (live half) and HTIER-04 not met and carried as GAP-48-03. Muse Code is `proven`; Grok Build and Prime Agent stay `config-only`. The phase is complete; no failed result is written as a pass.
