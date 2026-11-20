---
phase: 47-legacy-kimi-production-tier-and-env-forwarding
verified: 2026-11-19
verdict: passed_with_accepted_limitations
status: passed
score: "3 of 4 requirements met (KIMV-01, KIMV-03 as accepted-residual, KIMV-04); KIMV-02 NOT MET: the legacy failure was not reproduced and the cause is NOT-ESTABLISHED"
ref: "origin/main 3160320 (window 2026-11-19, commit 3c675c3, kimi-cli 1.51.0)"
behavior_unverified: 2
overrides_applied: 0
---

# Phase 47 Verification: Legacy kimi production tier and environment forwarding

Method: a read of the phase records against KIMV-01 to KIMV-04 and the success criteria of `47-CONTEXT.md`, on 2026-11-19, at origin/main `3160320`. No live step was run for this verification. The window is copied from `47-WINDOW.md` (computed by the frozen rules of plan 47-01; evidence outside the repository). Plan 47-03 had no summary: it took Branch D and E-B only (no change the production tier exercises), so its live re-run was skipped by its own rule — that is an execution by rule, not a missing plan.

## Requirements coverage

| Req | Status | Evidence |
| --- | --- | --- |
| KIMV-01 | MET | Scratch install of kimi-cli 1.51.0 (Python 3.12 venv, wheel SHA-256 `ffb9d0d4…` equal to the registry value, 127 frozen deps, fastmcp 3.2.4 / mcp 1.30.0), production tier rerun cold with the wire log and full `kimi mcp test realm` output kept outside the repository; every run classified by the frozen rules. Controls: C1 (client vs fake stack) ANSWERED with six tools; C2 (realm alone) handshake 1720 ms. Reproduction (default drive, all three names restored): 3/3 valid cold runs ANSWERED with the six names, durations 28804/31393/32301 ms — outcome NOT-REPRODUCED. The three tests failed their own 25000 ms cold-connect bound (legacy client alone takes ~30 s on the loaded host); that assertion is outside the frozen classification and no record calls any run a pass of the tier. Scratch removed; stack left as found (equal before/after snapshots). |
| KIMV-02 | NOT MET (carried) | Cause by D-47-05: NOT-ESTABLISHED (reproduction did not reproduce). GAP-43-03 stays open, narrowed, never closed on this evidence. The I-tier candidate (legacy client sends SIGKILL to the stdio server a few ms after the `tools/list` response while the recorder logs after forwarding; folder 10 shows the same shape as the 2026-11-18 failure: 18294 ms, exit 0, no response in the log) is stated as an inference only, in the gap row, window paragraph and snippet. No change in `realm mcp`; no documented variant passed. OD-47-3 default applies (KIMV-02 carried when not reproduced). |
| KIMV-03 | MET as accepted-residual (not closed) | Ablation (diagnostic variants, never the tier): `XDG_CONFIG_HOME` NEEDED, `XDG_RUNTIME_DIR` NEEDED, `REALM_DRIVER_SOCKET` NOT-NEEDED for this non-default stack; S0 (nothing restored) not reached (`realm mcp` exits at start with `SCHEMA_INVALID`). Expansion probe: the client does not expand `${NAME}`/`$NAME` (both spellings arrive as reference text; literal unchanged) — so no recipe `env` block is possible. OD-47-1 (option a, owner 2026-11-19): GAP-43-01 is accepted-residual with the manual workaround `kimi mcp add --env NAME=VALUE …` (or hand-editing the `env` object) carrying the exact names; an install-time capture capability is noted for its own later phase, not implemented. The gap row is `accepted`, not `closed`. The XDG_CONFIG_HOME verdict is stated as not shown for a default config location. |
| KIMV-04 | MET | `GAP-24-02`, `GAP-24-03`, `GAP-43-01`, `GAP-43-03`, the registry kimi note, the regenerated support-matrix block (only the kimi row differs), the wave 1 page, the contract page, the hosts page and the kimi snippet agree at one dated result; the tier is recorded as `rehearsal failed` (did NOT pass its bound), reproduction NOT-REPRODUCED, cause NOT-ESTABLISHED. Scratch directory removed (absence confirmed); stack comparison equal before/after (0 containers/sandboxes, no daemon, real Kimi config absent); `package.json`/lockfile unchanged; no `src` change. Host's own `kimi mcp add` writer returned exit 0 in the window (the 2026-11-17 hang was not seen again, stays unexplained). |

## Success criteria

1. Scratch reinstall, cold rerun, wire log + full output kept, runs classified (never-written / after-close / error): met — all three runs ANSWERED; the window classifies by those five classes.
2. Cause recorded as client / `realm mcp` / stack with fix or documented variant: NOT MET (cause NOT-ESTABLISHED; KIMV-02 carried).
3. Needed names shown live; recipe `env` block only if needed; GAP-43-01 closed or retired: MET AS RECORDING — two names needed, no expansion, so the owner-accepted residual with the manual workaround; no recipe env block and no migration note (recipe unchanged, none needed).
4. Registry/matrix/docs/gaps agree; scratch removed; stack as found: met.

## What is not met, and what is only inferred

- GAP-43-03 is not closed; the recorder-kill-order explanation is [INFERENCE] only.
- Whether the 2026-11-18 failure was a recorder log miss is not shown; C3 (warm control) was not run; C2's folder is a hand-written record, not a recorder log.
- One version (1.51.0), one machine, loaded host; dependencies not hash-pinned (accepted residual). No model turn or tool call through the legacy CLI.

## Verdict

passed_with_accepted_limitations. Three of four requirements met (KIMV-03 as accepted-residual, gap `accepted` not `closed`); KIMV-02 not met and carried. The phase is complete; the tier did NOT pass its bound and no record says it passed.
