# Plan 39-03 Summary: the live window and the record

Date: 2026-11-18. Run by a person on the production stack (rootless Podman 5.7.1, account `realmlive`, shared live lock, one test at a time). Evidence is kept outside the repository. Each step started and ended with 0 containers, 0 sandboxes, an empty workspace and no daemon; the host load during the steps ranged from 5 to 46.

## The window, in order

| Step | Tree | Result |
| --- | --- | --- |
| A. Baseline | main with Plan 39-01, no watchdog | Closeout C FAILED at the death assertion as predicted: tree in flight at 821 ms, `TOOL_TIMEOUT` after 28204 ms, 3 members (the shell, `sleep 301`, `sleep 300`) running on every poll up to 15297 ms after the reply. C2 FAILED the same way. D passed. F-3 confirmed. |
| B. First fix | coreutils `timeout` watchdog (`6e2b1d2`) | Closeout C FAILED: `timeout` and the shell died, the two sleeps survived. Lab finding: inside the sandbox kill(2) with a pid at or below zero returns EPERM for every caller, so `timeout` reaches only its direct child. Group kill is unusable. |
| C. Final fix | the bash `/proc`-sweep watchdog (`275b486`; the window tree was built before the merge commit `ed8b814`, with the same wrapper) | Closeout C PASSED: nonexistent command answers exit 127 (`realm-exec-wd: line 59: ... command not found`); tree in flight at 996 ms; `TOOL_TIMEOUT` after 28103 ms; 5 running at +1378 ms; 0 running at +2988 ms (dead 2988 ms after the reply); 269 s of the sleeper's life left; settle listing after 3000 ms: 0 running; a following `echo ok` exit 0; `realm status` active. Closeout C2 PASSED: reply after 28717 ms; group dead 1380 ms after it; the `setsid` escapee gone too (escapee absent). Closeout D PASSED: 1.1.1.1 on 443 ok, 8.8.8.8 on 443 EACCES through the dispatcher. `production live 7` PASSED. |

Baseline nonexistent command: exit 127 with `/bin/bash: line 1: realm-no-such-command: command not found`; with the wrapper only the prefix changes.

## What was recorded

- `docs/integration/openshell.md`: the dated Phase 39 paragraph (baseline, first fix and lab cause, final fix, the numbers above, what is and is not shown), one sentence in the Phase 36 paragraph that F-3 is closed by it, a sentence in the scenario 7 description, and the image requirement bullet (bash 5.0 or newer, `sleep`, `cat`).
- `docs/integration/runtime-decision.md`: the decision record and the live result (the section revising D-91 and D-93).
- `docs/policy-reference.md`: the `WATCHDOG_MARGIN_MS` row and the `TOOL_CALL_TIMEOUT_MS` row note. `AGENTS.md`: the exec verb sentence names the wrapper prefix. `docs/integration/omp.md`: the Omp-side note.
- The archived ledger (`36-DISPOSITIONS.md`, `36-VERIFICATION.md`, the v5.0 audit) is history and was not edited; those records already said the Phase 36 pass could not tell a kill from the sleeper ending by itself, and F-3 is closed by the record above.

## Deviations from the plan as written

- Plan 39-03 expected one fixed run; there were three, because the first fix failed live. The plan text of 39-02 and 39-03 carries a revision note (39-CONTEXT D-39-13).
- The coreutils `timeout` binary is not required by the final fix; the live step that prints its version is stale (see `39-VERIFICATION.md`, R2).
- The `/usr/bin/timeout` image requirement, the kill grace rows of the policy reference and the `timeout`-based wording of the plans were replaced by the bash wrapper's own requirements.
