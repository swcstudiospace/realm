---
phase: 50-grok-harness-fix-and-production-rerun
verified: 2026-11-19
verdict: passed_with_accepted_limitations
status: passed
score: "1 of 2 requirements met (HTIER-04: Grok Build production tier passed cold after the GAP-48-03 harness fix); HTIER-01 NOT MET live (both-files audit line not reproduced, cold mandatory audit); GAP-48-03 closed"
ref: "origin/main 63bbc7e (window 2026-11-19T21:18Z to 21:22Z, Grok Build 1.0.77, node v24.18.0, Podman 5.7.1)"
behavior_unverified: 1
overrides_applied: 0
---

# Phase 50 Verification: Grok harness fix and production re-run

Method: a read of the phase records against HTIER-01 and HTIER-04 (carrying GAP-48-03, GAP-40-01, GAP-48-01) and the success criteria of `50-CONTEXT.md` / `50-PLAN.md`, on 2026-11-19, at origin/main `63bbc7e`. The hermetic claims are read from the plan summaries and the files they name; no live step was run for this verification. The window is copied from `50-WINDOW.md` (evidence outside the repository, serial, cold, shared live lock, account `realmlive`).

## Requirements coverage

| Req | Status | Evidence |
| --- | --- | --- |
| HTIER-04 | MET | The GAP-48-03 harness fix (one line in `productionOverrides`, `test/support/host-live.ts`: the `grok-build` case creates `<grok-home>/.grok`) is pinned by a hermetic row that failed pre-fix with `ENOENT` and passes after. Step A of the window passed (1 passed, 0 failed): Grok Build 1.0.77 `grok mcp doctor` exit 0 after 525 ms, checks [command found, server started, handshake OK, N tools discovered], wire [initialize, notifications/initialized, tools/list] with the six Realm tools, one start `mcp --host grok-build`. Registry T3 `rehearsed` with the dated note; the generated matrix block carries the rehearsed Grok cell; residue 0 before and after (0 containers, 0 sandboxes, policy SHA-256 unchanged, operator's real config `absent` before and after). GAP-48-03 is `closed` in `docs/integration/host-plugin-gaps.md`. No `src` change. |
| HTIER-01 | NOT MET live (carried) | Step B (both-files attribution) failed on the mandatory audit: install succeeded and the wire was complete (303 ms) but no attach line, no presence, 0 attached boot reports. Step C (Claude-alone control) failed the same way (402 ms, presence `claude-active`, no audit line). The cause recorded in `50-WINDOW.md` is the cold case the harness predicts: the cold doctor leaves in about 300 ms before the attach settles, so there is no audit line to read. The production wire does carry `grok-build` with `realm` in `config.toml` (validator Outcome A stands), but the live both-files audit line was not reproduced. GAP-40-01 and GAP-48-01 stay `accepted` as before (Phase 50 control wording). The warm diagnostic variant was not run (it is not the production tier). No model turn, no credential at any step. |

## Success criteria

1. Hermetic fix, red first, no other host changed, nothing pointing at the operator's real home: met (new row + `host-live-helpers`, 98 passed, `enforce-default` 11 passed unedited).
2. Product-side refusal absent, or recorded as a finding: met — absent; no finding, no patch in the window.
3. Live re-run reaches the host and passes the production tier, or records a named blocker honestly: met for the tier (Step A passed); the attribution steps failed on the mandatory audit under D-50-4, never relabelled.
4. Registry, matrix, gaps page, host pages and pinning tests agree and support only what the evidence shows: met (registry T3 `rehearsed`, matrix regenerated 8/8, gaps/matrix/host-docs/registry 40/40; snippet tier stays `config-only`, no promotion decision).

## What is not met, and what is only inferred

- The live `grok-build` audit line for the both-files attach remains undemonstrated; attribution rests on the validator matrix plus the Step A wire, not on a production audit line.
- GAP-40-01 (Claude-file-alone attributed `claude`) and GAP-48-01 stay accepted-residual and unchanged in kind; the Phase 50 control again named presence `claude-active` with no audit line.
- First-source-wins remains a 1.0.77 observation, not a later-version guarantee; no model-driven tool call was made (GAP-31-02).

## Verdict

passed_with_accepted_limitations. One of two requirements met: HTIER-04 is met and GAP-48-03 is closed; HTIER-01 is not met live and stays carried (accepted-residual GAP-40-01 / GAP-48-01). The phase is complete; no failed result is written as a pass.
