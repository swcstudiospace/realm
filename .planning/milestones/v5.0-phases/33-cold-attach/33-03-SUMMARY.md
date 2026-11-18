---
phase: 33-cold-attach
plan: "03"
status: complete
requirements: [COLD-04, COLD-02]
merged: "PR 166 (code), PR 167 (probe fix), PR 169 (host tier criterion); recording in the PR that carries this file"
window: "2026-11-18, production stack, account realmlive, rootless Podman 5.7.1; window 3 passed 14 of 14"
---

# 33-03 summary: the cold production proof and the gap closure

## What was built (Tasks 1 and 2)

- `test/support/host-live.ts` (`runHostProduction`): the warm-up (`realm up --workspace` before the host attach), its timeout constant and its comment are removed; the claude, opencode and codex production tiers attach cold. A static test in `test/integration/host-live-helpers.test.ts` fails if `realm up`, an `up` argument or the warm-up constant returns.
- `test/support/cold-attach-probe.ts` (new): `judgeColdTimeline`, a pure judge (handshake within 10000 ms, status not active at reply time, at least one refusal in the window, every refusal an error `REALM_NOT_ACTIVE` with `retryable` true, the first success later than the last refusal, the same process throughout), and `runColdAttachProbe`, the live driver that starts `realm mcp --host claude` on a new project with no recipe and no host binary.
- `test/integration/cold-attach-live.test.ts` (new): the gated live test of the probe. `test/integration/cold-attach-probe-helpers.test.ts` (new): the judge, row by row.
- `bootPhaseCountsOf` and `downAcceptable` helpers in `test/support/host-live.ts`, with hermetic tests.

## Run history

The checkpoint tasks (3 to 5: the owner's window, the preflight, the runs) were done by people, outside this repository. The window was authorized by the owner on 2026-11-18, run as the `realmlive` account under the shared live lock, one test at a time. The evidence is kept outside the repository. The preflight counts are not recorded in this summary.

1. **Earlier cold windows, failed.** They found, in turn:
   - the probe's `list` call needed its required `depth` argument (a probe defect, fixed in PR 167);
   - the host health-check tiers had been given the wrong criterion: Task 1 required `realm status` to answer active after the host command left, and an attached boot report. A health check connects, lists the six tools and exits before the realm is ready, which is correct for a health check (it must not need a started sandbox). The child `realm mcp` is then stopped during ensure and up, and `realm status` stayed unbound or the daemon was absent. PR 169 changed the tiers to assert the host's exit 0, the connected report, the elapsed time below the 25000 ms bound, and the handshake, `tools/list` and six tool names on the wire; for the codex session drive the exit path requires the same wire and no status poll. The "same connection serves calls after ready" proof stays with the probe;
   - an interrupted run left the shared host receipt behind, which the next run's gate refuses; the cleanup is finally-based (recipe uninstall, receipt and presence removal, project directory removal) and `realm down` on an absent daemon or a session that never became active is tolerated.
2. **Window 3, `main` after PRs 166 to 169 (PR 169 merge commit `dbdbf23`), 14 of 14 passed.** Clean before and after: 0 containers, 0 sandboxes, an empty workspace.

## Results (window 3, 2026-11-18, copied from the evidence)

| Run | Result | Diagnostics |
| --- | --- | --- |
| Cold attach probe (host id claude, no recipe) | passed | spawn; handshake replies (`server/discover`, `initialize`, `tools/list`) all answered at 500 ms (bound 10000 ms); `realm status` not active at reply time; 5 calls refused `REALM_NOT_ACTIVE` with `retryable` true, the last at 6918 ms; first success at 8982 ms after 4 status polls, on the same process; `list` of the workspace root done at 8995 ms; attached boot report count 1; the child ended cleanly after stdin end; `realm down` left no container. An earlier run of the same probe measured handshake 285 ms and first success 8955 ms |
| claude 2.1.322 production tier | passed cold | `claude mcp list` returned after 2438 ms (bound 25000 ms); wire `server/discover` then `tools/list`, six tools |
| opencode 1.19.5 production tier (scratch install outside the repository) | passed cold | `opencode mcp list` returned after 2155 ms; wire `initialize`, `notifications/initialized`, `tools/list`, six tools |
| codex-cli 0.154.0 production tier | passed cold | `codex exec` host command 896 ms; same wire as opencode; no model turn, no tool call |

Before Phase 33 the first answer on a cold stack took 35 to 60 s. The hosts leave before the realm is ready; the probe, not a host, shows the transition on one connection.

## Gap dispositions

- GAP-31-04 and GAP-23-02: closed, citing the dated runs above and the repository paths.
- GAP-31-03: narrowed (the cold attach is shown; other versions, other machines and a cold image pull are not).
- GAP-22-02: narrowed (a cold attach with the image present was observed; a cold image pull was not).
- No other row changed.

## Pages and registry written from the evidence (Task 6)

`test/support/host-registry.ts` (the t3 notes of claude, opencode and codex), the generated block of `docs/integration/host-support-matrix.md`, `docs/integration/wave1-boot-matrix.md`, `docs/integration/host-plugin-gaps.md`, `docs/integration/host-plugin-contract.md` (the three rehearsal rows and the serve-early residual), `docs/integration/mcp.md` (the evidence paragraph of Q7), and the T3 rows of `docs/hosts/snippets/claude-code.md`, `codex.md` and `opencode.md`. The warm records stay as dated history; the cold record is appended with its date.

## Deviations from the plan as written

- Task 1 as written required `realm status` active and an attached boot report after the host left; that criterion was wrong for a health check and was replaced (PR 169, above). The registry notes therefore do not say that `realm status` reached active after the host left, because it did not.
- Task 7 (the final gate sweep as a non-root user, with the commands and the user name recorded) is not recorded in this summary: it was not run by the recording task. The recorded runs are the live window and the docs and registry tests named in the verification file.
- The probe uses the host id `claude`; no real host drove the window transition.
- No `covered_digest` is carried in the verification file.
