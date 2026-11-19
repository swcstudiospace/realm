# Milestone v7.0 context: Carried findings closure

The v6.0 context is archived at `.planning/milestones/v6.0-MILESTONE-CONTEXT.md`; the v5.0 context at `.planning/milestones/v5.0-MILESTONE-CONTEXT.md`; the v3.0 context (owner decisions D1 to D6 of 2026-10-29) at `.planning/milestones/v3.0-MILESTONE-CONTEXT.md`. This file holds v7.0 only.

Scope source: the owner's decision of 2026-11-19 (below); the v6.0 audit (`.planning/milestones/v6.0-MILESTONE-AUDIT.md`: OMPR-01 and OMPR-06 carried, findings F-41-1 and F-44-01, GAP-40-01 and GAP-43-01 to GAP-43-03, the "v7.0 candidates" list); the phase records of Phases 38, 40, 41, 43 and 44 under `.planning/milestones/v6.0-phases/` (notably `38-MEASUREMENT.md`, `44-MEASUREMENT.md`, `41-VERIFICATION.md`, `43-VERIFICATION.md`, `40-VERIFICATION.md`); the gap rows in `docs/integration/host-plugin-gaps.md`; `docs/integration/omp.md`; `docs/integration/runtime-decision.md` (the F-41-1 paragraph); and the Linear tickets SPE-34730 to SPE-34733. Planners and executors read those files; they do not work from memory.

## Goal

Every finding v6.0 carried is closed with evidence or stays carried with a stated, tested reason. The Omp cold-attach responsiveness gets a measurement that can yield a valid verdict on a shared host, so OMPR-01, OMPR-06 and OI-11 are resolved honestly. A `realm up` right after a rapid stop no longer fails once with `OPENSHELL_START_FAILED`. The legacy kimi-cli production-tier failure and its environment forwarding (GAP-43-01) are root-caused. Grok Build is attributed to itself, and Muse Code, Prime Agent and Grok Build each reach a production tier or have a named blocker.

## Release line

The release line is 0.7.x. `release/milestone.json` is `{"milestone":"v7.0","minor":7}`; the start of the milestone carries the owner's approval of that exact one-line change (HITL 2026-11-19), as PR 186 did for v6.0. A phase that changes a documented contract incompatibly uses `!` in its commit subjects so the release notes list it (Phase 47 is the likely case if the `kimi` recipe starts to write an `env` block that an existing install must refresh).

## Owner decisions (2026-11-19, HITL)

- **D-v7-1, start milestone v7.0** "Carried findings closure", four items, all ticked by the owner: phases 45 to 48, numbering continues from Phase 44, release line 0.7.x.
- **D-v7-2, Omp responsiveness (Phase 45; Linear SPE-34730):** fix the harness so a window can yield a valid outcome on this shared host (the paired and quiet-slot windows of v6.0 were void because of load gating and a baseline bound too tight for a shared host), and resolve OMPR-01, OMPR-06 and OI-11 honestly. The measurement design is the planner's to freeze (see "Measurement design" below).
- **D-v7-3, F-41-1 (Phase 46; Linear SPE-34731):** root-cause and fix `realm up` failing once with `OPENSHELL_START_FAILED` right after a rapid stop, with a live reproduction.
- **D-v7-4, legacy kimi (Phase 47; Linear SPE-34732):** root-cause the legacy kimi-cli 1.51.0 production-tier failure (GAP-43-03) and the environment forwarding of GAP-43-01.
- **D-v7-5, Grok attribution and production tiers (Phase 48; Linear SPE-34733):** close GAP-40-01 (a Grok Build session is attributed `grok-build`) and add production tiers for Muse Code, Prime Agent and Grok Build.
- **D-v7-6, supported versions:** the latest release line is supported: currently 0.6.x, and 0.7.x from its first release, 0.7.0. `SECURITY.md`, the Safety bullet of `AGENTS.md` and the README status bullet say so.
- **D-v7-7, Notion skipped:** the Notion tracker sync is skipped for this milestone start because the Notion workspace is payment-locked. Linear (SPE-34730 to SPE-34733) and the planning files are the record.

## Scope: four phases (numbering continues at 45)

| Phase | Name | Requirements | Carries | Linear |
|-------|------|--------------|---------|--------|
| 45 | Omp responsiveness: a measurement that can yield a valid verdict | OMPV-01..06 | OMPR-01, OMPR-06, OI-11, F-44-01 | SPE-34730 |
| 46 | Rapid stop then up: F-41-1 | STOP-01..04 | F-41-1 (Phase 41) | SPE-34731 |
| 47 | Legacy kimi production tier and environment forwarding | KIMV-01..04 | GAP-43-03, GAP-43-01, GAP-24-02 (legacy half), OQ-24-01, OQ-43-03 | SPE-34732 |
| 48 | Grok Build attribution and production tiers for Muse Code, Prime Agent and Grok Build | HTIER-01..05 | GAP-40-01, D-40-06 (no production tier), HOSTID-02 partial | SPE-34733 |

## Ordering and dependencies

- The four phases are independent in code. Each depends on Phase 44 only as the last phase of v6.0. Phases 45, 46, 47 and 48 each need a live window on the production stack; the shared live lock serialises them, and the startup reap is account-wide, so only one live run is active at a time.
- Phases 47 and 48 both edit the host registry rows, the support matrix, `docs/integration/host-plugin-gaps.md` and `docs/integration/wave1-boot-matrix.md`; their documentation edits land in order 47 then 48 (or are rebased), so the generated matrix block does not conflict.
- Phase 45 touches `src/omp/` (the plugin module is at the 1000-line ceiling: any growth goes to a new module) and `test/support/`; Phase 46 touches the daemon stop and start path (`src/lifecycle/controller.ts`, `src/runtime/`, `src/daemon/`); neither touches the other's files.
- Each phase ships through the ship flow (pull request, Greptile 5 of 5, squash merge, release on the `0.7.x` line). A phase may ship as several pull requests.

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
- Isolation primitives (a delegated cgroup, `cpuset`, per-cgroup `cpu.pressure`) are available to the realm account only if the host grants them; Phase 45 records which are, and designs for what it finds.
- Capability tokens still give no defence against a same-uid reader (Phases 30, 32 and 35 records); the new attribution of Grok Build does not change that, and the host label stays a self-declared attribution, not an identity.

## Open owner questions

None blocking. Defaults taken: the measurement design above is a proposal and Phase 45 freezes it after the feasibility record; if the legacy kimi failure is not in `realm mcp`, the owner chooses between a documented limit and dropping the archived row (OQ-24-01) at the Phase 47 discussion; whether the `kimi` recipe writes an `env` block (OQ-43-03) is decided from the Phase 47 live evidence, and the default is to write it only for the names the evidence shows are needed and are not secrets.

## Out of scope

The ship-flow `--enforce` confirmation of DEBT-03 (owner-side configuration; carried), FS-02 closure (accepted limitation), UI-01 status (the owner's call; Phase 45 supplies evidence only), TD-06, the TD-10 repository settings, a model-driven tool call through a host (GAP-31-02, unless a scripted provider seam makes it a by-product of a production tier), and any change to the product spec.
