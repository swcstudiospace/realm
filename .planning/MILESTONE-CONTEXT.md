# Milestone v8.0 context: Shared sandboxes and durable recovery

The v7.0 context is archived at `.planning/milestones/v7.0-MILESTONE-CONTEXT.md`; the v6.0 context at `.planning/milestones/v6.0-MILESTONE-CONTEXT.md`; the v5.0 context at `.planning/milestones/v5.0-MILESTONE-CONTEXT.md`; the v3.0 context (owner decisions D1 to D6 of 2026-10-29) at `.planning/milestones/v3.0-MILESTONE-CONTEXT.md`. This file holds v8.0 only.

Scope source: the owner's decisions of 2026-11-19 (below); the v7.0 audit (`.planning/v7.0-MILESTONE-AUDIT.md`: the eight carried requirements — OMPV-04; STOP-01 to STOP-04; KIMV-02; HTIER-01 and HTIER-04 — with finding F-41-1, GAP-43-03, GAP-48-01/03 and GAP-40-01, and the "v8.0 candidates" list); the phase records of Phases 45 to 48 under `.planning/phases/` (notably `45-VERIFICATION.md`, `46-VERIFICATION.md`, `47-VERIFICATION.md`, `48-VERIFICATION.md`); the gap rows in `docs/integration/host-plugin-gaps.md`; `docs/integration/omp.md`; `docs/integration/runtime-decision.md` (the F-41-1 paragraph). Planners and executors read those files; they do not work from memory.

## Goal

The eight requirements v7.0 carried are retested with corrected instruments and close only on a valid verdict, live evidence or a frozen design. The Omp calibration gets a defensible bound (OMPV-04, with OMPR-01, OMPR-06 and OI-11). The Grok harness reaches the host (GAP-48-03) and the live Grok attach and production tier rerun (HTIER-01, HTIER-04). `realm up` after a rapid stop is retested to the iteration bar (F-41-1, STOP-01 to STOP-04) and the legacy kimi cause is established or narrowed (KIMV-02, GAP-43-03). Two owner-approved (HITL) design phases sketch the shared-sandbox steps: concurrent binding (CBIND) and durable snapshots (SNAP).

## Release line

The release line is 0.8.x. `release/milestone.json` is `{"milestone":"v8.0","minor":8}`; the start of the milestone carries the owner's approval of that exact one-line change (HITL 2026-11-19), as PR 216 did for v7.0. A phase that changes a documented contract incompatibly uses `!` in its commit subjects so the release notes list it.

## Owner decisions (2026-11-19, HITL)

- **D-v8-1, start milestone v8.0** "Shared sandboxes and durable recovery", six items, all ticked by the owner: phases 49 to 54, numbering continues from Phase 48, release line 0.8.x.
- **D-v8-2, Omp calibration repeat (Phase 49):** fix the bracket arithmetic red-first, recalibrate on this host and freeze `CALIBRATED_BOUNDS`, then rerun a live window; resolve OMPV-04 with OMPR-01, OMPR-06 and OI-11 honestly.
- **D-v8-3, Grok harness fix and production re-run (Phase 50):** wire `<grok-home>/.grok` creation into `productionOverrides` as plan 48-02 owns the wiring, then rerun the live Grok attach and production tier (HTIER-01, HTIER-04; GAP-48-03).
- **D-v8-4, stop windows repeat (Phase 51):** rerun F-41-1 to the 50-per-variant bar, or pin the suspected mechanism hermetically and carry F-41-1 with that evidence (STOP-01 to STOP-04).
- **D-v8-5, kimi cause (Phase 52):** establish or narrow the GAP-43-03 cause with a tested reason (KIMV-02).
- **D-v8-6, concurrent binding design (Phase 53; HITL, owner-approved scope):** a frozen design for concurrent sandbox binding; the HITL owner decisions are settled before any code (CBIND-01 to CBIND-02).
- **D-v8-7, snapshots design (Phase 54; HITL, owner-approved scope):** a frozen design for durable workspace snapshots built on the RES-04 checkpoint mechanism; the HITL owner decisions are settled before any code (SNAP-01 to SNAP-02).
- **D-v8-8, supported versions:** the latest release line is supported: currently 0.7.x, and 0.8.x from its first release, 0.8.0. `SECURITY.md`, the Safety bullet of `AGENTS.md` and the README status bullet say so.

## Scope: six phases (numbering continues at 49)

| Phase | Name | Requirements | Carries | Notes |
|-------|------|--------------|---------|-------|
| 49 | Omp calibration repeat | OMPV-04 | OMPR-01, OMPR-06, OI-11 | bracket-arithmetic fix, then recalibration |
| 50 | Grok harness fix and production re-run | HTIER-01, HTIER-04 | GAP-48-03, GAP-40-01, GAP-48-01 | `<grok-home>/.grok` in `productionOverrides` |
| 51 | Rapid stop then up repeat (F-41-1) | STOP-01..04 | F-41-1 (Phase 41) | 50-per-variant bar, else hermetic pin |
| 52 | Legacy kimi cause (GAP-43-03) | KIMV-02 | GAP-43-03 | establish or narrow with a tested reason |
| 53 | Concurrent binding design (HITL, owner-approved scope) | CBIND-01..02 | — | frozen design only, no code |
| 54 | Snapshots design (HITL, owner-approved scope) | SNAP-01..02 | RES-04 mechanism | frozen design only, no code |

## Ordering and dependencies

- The six phases are independent in code. Each depends on Phase 48 only as the last phase of v7.0. Phases 49, 50, 51 and 52 each need a live window on the production stack; the shared live lock serialises them, and the startup reap is account-wide, so only one live run is active at a time. Phases 53 and 54 are design-only (frozen designs, no live window, no code) and their HITL owner decisions are settled before any dependent implementation phase is planned.
- Phase 50 edits the host registry rows, the support matrix and `docs/integration/host-plugin-gaps.md` for the Grok re-run; its documentation edits land after any Phase 52 gap-row edits (or are rebased), so the generated matrix block does not conflict.
- Phase 49 touches the calibration harness (`test/support/omp-*`, `test/integration/omp-responsiveness*`); Phase 51 touches the daemon stop and start path (`src/lifecycle/controller.ts`, `src/runtime/`, `src/daemon/`); neither touches the other's files. Phases 53 and 54 touch no code and no source files; their designs live under `.planning/phases/53-*/` and `.planning/phases/54-*/`.
- Each phase ships through the ship flow (pull request, Greptile 5 of 5, squash merge, release on the `0.8.x` line). A phase may ship as several pull requests.

## Measurement design (Phase 45; a proposal the planner freezes after the feasibility record of OMPV-01)

Why v6.0 produced no valid verdict (from `38-MEASUREMENT.md` and `44-MEASUREMENT.md`): the host is shared (8 CPUs; the one-minute load per CPU at the start of the Phase 44 runs ranged from 0.19 to 3.24); the verdict was gated on the one-minute load average per CPU, which describes the whole host and not the contention the Omp process saw (F-44-01); the extension-free baseline missed a 500 ms 95th-percentile bound in five of nine runs at 0.17 to 0.36 load per CPU, so the baseline bound was too tight for a shared host; the control always ran first and the cold attach second, so position and load variation were confounded (the cold attach answered before its own control in all 20 loaded runs); and Omp's own boot (9.4 to 15.4 s with no extension) sits inside a window that starts at process start.

Proposal, in four parts, each testable:

1. **Scoped contention gate in place of the host load average.** Run the live window in a host-isolated envelope where the platform allows it: a transient systemd scope or a delegated cgroup v2 subtree with `cpuset` (pinned CPUs) and `cpu.pressure`, or at least `taskset` pinning. Validity is decided by what the Omp process tree itself experienced: the cgroup's own CPU pressure (`some` avg10) and the run-queue delay of the Omp process (`/proc/PID/schedstat`, second field) over the window, not by `loadavg`. The feasibility of each isolation primitive for the realm account is itself recorded first (OMPV-01); if none is available, the design falls back to part 2 plus the run-queue-delay attribution of part 3 and says so.
2. **A deterministic in-process stall probe.** A hermetic test runs the extension's attach path (the real plugin and launch modules, a scripted control socket with scripted `up` latencies, no Omp, no Podman) and measures event-loop blocking in CPU time per synchronous slice (`process.cpuUsage` deltas and `perf_hooks` event-loop delay), which does not move with host load to first order. It fails red-first on a seeded blocking attach and is stable on a loaded host. It answers "does the extension itself block the loop"; it does not answer "does a real Omp answer `get_state` within the thresholds on a cold attach", so it cannot alone close OMPR-01 or OI-11.
3. **Attribution of every stall in the live window.** Each unanswered probe interval is split into the Omp main thread's on-CPU time, its run-queue delay and its sleeping time, so a stall that is contention (run-queue delay) is separated from one the process caused (on-CPU time) or waited for (sleep). The verdict reads the self-inflicted part with the existing thresholds (maximum 1000 ms, 95th percentile 500 ms) unchanged; the raw answered-probe numbers stay recorded as a labelled secondary measure.
4. **Order and baseline.** The control and the cold attach alternate order inside the pair (the Phase 44 recommendation), the baseline bound becomes a validity condition recalibrated from a recorded calibration of the no-extension control on this host and frozen in code before the verdict runs (never relaxed after seeing a verdict), and the decision rule (PASS, FINDING with a named cause, NOT-REPRODUCED, VOID) is code with a hermetic test before the first live run, as `test/support/paired-ab.ts` was.

## Constraints for every phase

- The rules of `AGENTS.md` apply: strict TypeScript, `RealmError` with catalogue codes, a timeout on every async boundary, no silent catch, no suppression comments, `process.env` read only at the three entry edges, no new dependency without the justification, licence check and maintenance check that `CONTRIBUTING.md` requires, no host-local absolute paths in committed files.
- Tests assert observable behaviour. No source-text tests. A change to a frozen contract updates its enumerating tests in the same pull request. The error catalogue stays at 29 codes unless a phase records a reason and the owner approves an addition by name.
- `LICENSE`, `NOTICE` and `docs/specs/realm-spec.xml` are not modified. Version fields and `CHANGELOG.md` belong to the release job. Files under `.github/workflows/**`, `release/**` and `scripts/release/**` change only with human review.
- Clean cutover: migrate every caller and remove the obsolete code in the same pull request. No compatibility shims.
- Fail closed is kept: no change makes a mutation run before the session is ready, and a stop or start fix never weakens teardown bounds or the no-orphan guarantee.
- Every claim in a document carries an evidence label and is checked against the code or a run. Live evidence is kept outside the repository and cited by date. A measurement that fails its thresholds or ends VOID is recorded as such, never relabelled as a pass, and OMPR-01, OMPR-06 and OI-11 never close on a VOID outcome.

## Limits

- Live phases depend on this host: rootless Podman 5.7.1, the OpenShell gateway, and the installed host CLIs (Muse Code, Prime Agent, Grok Build and Omp were on the PATH of the planning account on 2026-11-19; the legacy kimi-cli 1.51.0 and Kimi Code need a scratch install outside the repository, as in Phase 43). An item that cannot run is carried with a named reason, not claimed.
- Isolation primitives (a delegated cgroup, `cpuset`, per-cgroup `cpu.pressure`) are available to the realm account only if the host grants them; Phase 49 reuses the Phase 45 feasibility record and states what it finds again before the verdict window.
- Capability tokens still give no defence against a same-uid reader (Phases 30, 32 and 35 records); the Grok re-run does not change that, and the host label stays a self-declared attribution, not an identity.

## Open owner questions

None blocking. Defaults taken: the Phase 49 calibration rerun reuses the frozen Phase 45 design and states its feasibility again before the verdict window; the Phase 52 kimi cause rerun decides from live evidence whether the failing component is the client, `realm mcp` or the stack, and the HITL decisions of Phases 53 and 54 are taken at their phase discussions and recorded here.

## Out of scope

The ship-flow `--enforce` confirmation of DEBT-03 (owner-side configuration; carried), FS-02 closure (accepted limitation), UI-01 status (the owner's call; Phase 49 supplies evidence only), TD-06, the TD-10 repository settings, a model-driven tool call through a host (GAP-31-02, unless a scripted provider seam makes it a by-product of a production tier), any implementation of CBIND or SNAP (Phases 53 and 54 are design only), and any change to the product spec.
