# Milestone v9.0 context: Doctor health and concurrent binding

The v8.0 context is archived at `.planning/milestones/v8.0-MILESTONE-CONTEXT.md`; the v7.0 context at `.planning/milestones/v7.0-MILESTONE-CONTEXT.md`; the v6.0 context at `.planning/milestones/v6.0-MILESTONE-CONTEXT.md`; the v5.0 context at `.planning/milestones/v5.0-MILESTONE-CONTEXT.md`; the v3.0 context (owner decisions D1 to D6 of 2026-10-29) at `.planning/milestones/v3.0-MILESTONE-CONTEXT.md`. This file holds v9.0 only.

Scope source: the owner's decisions of 2026-11-20 (below); the v8.0 audit (`.planning/v8.0-MILESTONE-AUDIT.md`: the carried items — STOP-01 to STOP-04 with F-41-1 and new F-51-1; KIMV-02 with GAP-43-03 narrowed; HTIER-01 with GAP-40-01 and GAP-48-01; CBIND-01..02 design-frozen pending HITL ratification — and the "v9.0 candidates" list); the phase records of Phases 49 to 54 under `.planning/phases/` (notably `51-VERIFICATION.md`, `52-VERIFICATION.md`, `53-DESIGN.md`, `50-VERIFICATION.md`); the gap rows in `docs/integration/host-plugin-gaps.md`; `docs/integration/omp.md`; `docs/integration/omp-lifecycle-runbook.md`; `docs/integration/runtime-decision.md` (the F-41-1 INFERENCE paragraph). Planners and executors read those files; they do not work from memory.

## Goal

Operators can see Omp plugin health from `realm doctor` with a runbook for the failing cases (HEALTH). The F-51-1 dirty-stop cause is established from a captured failed-step code and fixed or bounded (STOP-05, STOP-06). The two host-evidence items v8.0 carried get a final retest with corrected instruments: the Grok Build both-files audit line (HTIER-01) and the legacy kimi deciding rerun after the wire recorder is fixed to log before forwarding (KIMV-02). Concurrent binding is implemented on the frozen Phase 53 design (CBIND-03), gated on the owner ratifying `53-DESIGN.md` (CBIND-01..02).

## Release line

The release line is 0.9.x. `release/milestone.json` is `{"milestone":"v9.0","minor":9}`; the start of the milestone carries the owner's approval of that exact one-line change (HITL 2026-11-20), as PR 216 did for v7.0. A phase that changes a documented contract incompatibly uses `!` in its commit subjects so the release notes list it (Phase 55, adding a doctor check, and Phase 59, adding the binding lock, are additive; the doctor check list is an enumerating surface whose tests update in the same pull request).

## Owner decisions (2026-11-20, HITL)

- **D-v9-1, start milestone v9.0** "Doctor health and concurrent binding", five items, all ticked by the owner: phases 55 to 59, numbering continues from Phase 54, release line 0.9.x.
- **D-v9-2, Omp plugin health check (Phase 55):** add a `realm doctor` check that reports the Omp plugin install and health state with its fix text, and document the failing cases and their remedy in the Omp lifecycle runbook (HEALTH-01, HEALTH-02).
- **D-v9-3, F-51-1 cause (Phase 56):** capture the failed-step cause code, establish the dirty variant-c stop cause in `runtime-decision.md`, and fix or bound it with a 20-iteration clean run (STOP-05, STOP-06).
- **D-v9-4, HTIER-01 attribution retest (Phase 57):** retest the Grok Build both-files audit line live, or keep GAP-40-01 accepted-residual with the missing host feature named (HTIER-01).
- **D-v9-5, KIMV-02 recorder fix and rerun (Phase 58):** fix the wire recorder to log before forwarding, then run the deciding live rerun; GAP-43-03 is established or stays narrowed on the new evidence (KIMV-02).
- **D-v9-6, concurrent binding implementation (Phase 59; gated):** implement the binding lock from the frozen `53-DESIGN.md` §4 surfaces only after the owner ratifies the design; CBIND-01..02 close on ratification, CBIND-03 on the implementation (CBIND-01..03).
- **D-v9-7, supported versions:** the latest release line is supported: currently 0.8.x, and 0.9.x from its first release, 0.9.0. `SECURITY.md`, the Safety bullet of `AGENTS.md` and the README status bullet say so.

## Scope: five phases (numbering continues at 55)

| Phase | Name | Requirements | Carries | Notes |
|-------|------|--------------|---------|-------|
| 55 | Omp plugin health check | HEALTH-01..02 | — | doctor check plus runbook section |
| 56 | F-51-1 cause | STOP-05..06 | F-51-1 (Phase 51) | capture cause code, then fix or bound |
| 57 | HTIER-01 attribution retest | HTIER-01 | GAP-40-01, GAP-48-01 | live both-files audit line |
| 58 | KIMV-02 recorder fix and rerun | KIMV-02 | GAP-43-03 | log-before-forward, then deciding rerun |
| 59 | Concurrent binding implementation (gated on Phase 53 ratification) | CBIND-01..03 | — | frozen surfaces only, no new codes |

## Ordering and dependencies

- The five phases are independent in code except Phase 59, which depends on the owner ratification of `53-DESIGN.md` before any code (D-v9-6). Each depends on Phase 54 only as the last phase of v8.0. Phases 56, 57 and 58 each need a live window on the production stack; the shared live lock serialises them, and the startup reap is account-wide, so only one live run is active at a time. Phase 55 needs no live window for its hermetic core (doctor checks run on injected fakes) and may run its live proof inside a Phase 56 to 58 window or its own.
- Phases 57 and 58 both edit the host registry rows, the support matrix and `docs/integration/host-plugin-gaps.md`; their documentation edits land in order 57 then 58 (or are rebased), so the generated matrix block does not conflict.
- Phase 55 touches `src/doctor/` (the check list is an enumerating surface: `checks.ts`, its enumerating tests and the doctor docs update together) and `docs/integration/omp-lifecycle-runbook.md`; Phase 56 touches the daemon stop and start path (`src/runtime/session-execution.ts`, `src/daemon/`, `src/lifecycle/`); Phase 59 touches the `53-DESIGN.md` §4 surfaces (`src/session/workspace-binding.ts` new, `src/session/paths.ts`, `src/lifecycle/controller.ts`, `src/daemon/sessions.ts`); Phase 58 touches the wire recorder (`test/support/host-live*.ts`) and no `src` file unless the rerun indicts `realm mcp`. No two live phases touch the same `src` file.
- Each phase ships through the ship flow (pull request, Greptile 5 of 5, squash merge, release on the `0.9.x` line). A phase may ship as several pull requests.

## Constraints for every phase

- The rules of `AGENTS.md` apply: strict TypeScript, `RealmError` with catalogue codes, a timeout on every async boundary, no silent catch, no suppression comments, `process.env` read only at the three entry edges, no new dependency without the justification, licence check and maintenance check that `CONTRIBUTING.md` requires, no host-local absolute paths in committed files.
- Tests assert observable behaviour. No source-text tests. A change to a frozen contract updates its enumerating tests in the same pull request. The error catalogue stays at 29 codes unless a phase records a reason and the owner approves an addition by name (Phase 59 adds none, per `53-DESIGN.md` §3).
- `LICENSE`, `NOTICE` and `docs/specs/realm-spec.xml` are not modified. Version fields and `CHANGELOG.md` belong to the release job. Files under `.github/workflows/**`, `release/**` and `scripts/release/**` change only with human review (the `release/milestone.json` bump itself is this start pull request).
- Clean cutover: migrate every caller and remove the obsolete code in the same pull request. No compatibility shims (Phase 59: the binding lock is new code alongside no replacement; the in-process `LockTable` is untouched).
- Fail closed is kept: no change makes a mutation run before the session is ready, and a stop or start fix never weakens teardown bounds or the no-orphan guarantee. The Phase 55 doctor check is read-only: it reports health, it does not install, remove or repair the plugin except through the existing `doctor --fix` rules.
- Every claim in a document carries an evidence label and is checked against the code or a run. Live evidence is kept outside the repository and cited by date. A failed live step is recorded as failed, never relabelled as a pass, and GAP-43-03, GAP-40-01 and F-51-1 are never closed by inference alone.

## Limits

- Live phases depend on this host: rootless Podman 5.7.1, the OpenShell gateway, and the installed host CLIs (Muse Code, Prime Agent, Grok Build and Omp were on the PATH of the planning account on 2026-11-19; the legacy kimi-cli 1.51.0 and Kimi Code need a scratch install outside the repository, as in Phase 43, and the Phase 58 rerun needs the `realmlive` account and the shared live lock). An item that cannot run is carried with a named reason, not claimed.
- The Phase 55 doctor check reads the Omp plugin state through the same seams the existing doctor checks use (injected probes, no process environment); what Omp exposes about its own install is the planner's to record (HEALTH-01), and the check reports `warn` or `fail` with its fix rather than guessing.
- Capability tokens still give no defence against a same-uid reader (Phases 30, 32 and 35 records); the Grok re-run does not change that, and the host label stays a self-declared attribution, not an identity.

## Open owner questions

One blocking gate: the HITL ratification of `53-DESIGN.md` (D-53-H1…H6), which gates Phase 59 (D-v9-6) and closes CBIND-01..02. Defaults taken: if the Phase 57 retest still cannot produce the live audit line, GAP-40-01 stays accepted-residual with the missing host feature named; if the Phase 58 rerun shows the response the log-after-forward recorder missed, the recorder is the cause and GAP-43-03 closes on that evidence, otherwise the client's close-after-response race is recorded as the narrowed cause.

## Out of scope

The ship-flow `--enforce` confirmation of DEBT-03 (owner-side configuration; carried), FS-02 closure (accepted limitation), UI-01 status (the owner's call; Phase 55 supplies evidence only), TD-06, the TD-10 repository settings, a model-driven tool call through a host (GAP-31-02, unless a scripted provider seam makes it a by-product of a production tier), SNAP implementation (design only in v8.0, Phase 54), F-41-1 and STOP-01 to STOP-04 (never reproduced; only F-51-1 is taken into v9.0), and any change to the product spec.
