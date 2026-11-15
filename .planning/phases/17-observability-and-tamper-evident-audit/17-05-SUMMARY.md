---
phase: 17
plan: 05
subsystem: docs
tags: [live-evidence, operator-checkpoint, openshell, gateway-lost, obs-01, obs-02, obs-03, obs-04]
requires: ["17-03", "17-04"]
provides:
  - "Operator live report (T1): production live scenarios 5, 6 and 10 on main a796b34, 37 of 37 assertions pass, 2026-11-15"
  - "Operator live report (T2): spike S17-b driver-only loss observations (a) to (d), 2026-11-15"
  - "docs/integration/openshell.md, runtime-decision.md and omp.md record the observed results (T3, commit 891c7ad, PR 85)"
affects: [docs/integration/openshell.md, docs/integration/runtime-decision.md, docs/integration/omp.md]
key-files:
  created: []
  modified:
    - docs/integration/openshell.md
    - docs/integration/runtime-decision.md
    - docs/integration/omp.md
key-decisions:
  - "T1 and T2 are operator checkpoints: no agent ran a live step; the results are the operator's reports"
  - "The S17-b result is recorded as observed, not as the plan's expected outcome"
requirements: [OBS-01, OBS-02, OBS-03, OBS-04]
metrics:
  tasks: 4
  commits: 1
  completed: 2026-11-15
status: complete
---

# Phase 17 Plan 05: live evidence for scenarios 5, 6, 10 and spike S17-b (OBS-01 to OBS-04) Summary

The operator ran the live checkpoints (T1 and T2) and reported the results. The agent recorded those results in the docs (T3) and ran the docs check (T4). No product code, test, or `.planning/` file changed in this plan.

## Operator checkpoints

Both checkpoints are human-action steps. No agent command ran them. The results below are the operator's reports as passed to the executor.

### T1. Production live scenarios 5, 6 and 10 (operator checkpoint)

- Run: production live suite, scenarios 5, 6 and 10, on main `a796b34`, 2026-11-15.
- Result: 37 of 37 assertions pass. Scenarios 5, 6 and 10 report ok.
- Per-scenario assertion counts were not reported; only the 37 of 37 total is recorded.

### T2. Spike S17-b, driver-only loss (operator checkpoint)

The operator stopped only the compute-driver user unit with the gateway and realm daemon running. The evidence file is `<home>/realm-evidence/phase17/17-S17b-20261115-002232.txt`.

| Observation | Result (2026-11-15) |
| ---- | ---- |
| (a) `openshell status` exit code and `--output json` after the driver stop | Still reports connected with the driver stopped |
| (b) realm exec probe (`openshell sandbox exec`) | Inconclusive; exit code not recorded in the report |
| (c) `realm status` after one health interval (10 s) and after 45 s | `OPENSHELL_GATEWAY_LOST` at both 10 s and 45 s |
| (d) recovery after the unit is restarted | No recovery within about 40 s. A follow-up retry check (`17-OBS04-retry-20261115-005732.txt`) showed that down then up returns to active |

The operator restarted the unit before reporting, as T2 requires.

## Tasks

| Task | Name | Commit | Status |
| ---- | ---- | ------ | ------ |
| T1 | production live scenarios 5, 6 and 10 (operator checkpoint) | none (live run, no commit) | reported by operator |
| T2 | spike S17-b driver-only loss (operator checkpoint) | none (live run, no commit) | reported by operator |
| T3 | record the results in openshell.md, runtime-decision.md and omp.md | 891c7ad (PR 85) | done |
| T4 | `npm run check:docs` | none (check only) | passes |

## What the docs now record

- `docs/integration/openshell.md`: the S17-b result with its observations and date, and the re-run of scenarios 5, 6 and 10 (commit `a796b34`, 2026-11-15, 37 of 37).
- `docs/integration/runtime-decision.md`: the partial S17-b paragraph under "Catalogue extension (Phase 17)" is replaced by the observed result.
- `docs/integration/omp.md`: the Gateway-lost row no longer says the re-run is pending.

## Acceptance to evidence

| Acceptance | Live evidence reported |
| ---- | ---- |
| 1. `seq`/`prev`, verify names the broken line (OBS-01) | scenario 5 ok (T1) |
| 2. JSON daemon log, correlation id matches audit lines (OBS-02) | scenario 6 ok (T1) |
| 3. `realm metrics` over the control socket, no network listener (OBS-03) | scenarios 6 and 10 ok (T1) |
| 4. Gateway loss shows `OPENSHELL_GATEWAY_LOST` (OBS-04) | scenario 10 ok (T1); S17-b (c) shows `OPENSHELL_GATEWAY_LOST` at 10 s and 45 s on a driver-only stop (T2) |

## Deviations

- The T1 report does not give per-scenario assertion counts, which T1 asks for. The total of 37 of 37 is the only count recorded.
- The T1 report does not list the individual evidence lines that T1 names (for example the `correlationId` line count in scenario 6). Only the scenario ok status is recorded.
- The T2 exec probe (b) has no recorded exit code, so its result is recorded as inconclusive.
- T3 says the coverage limit (a) stays only where `realm status` does not show `OPENSHELL_GATEWAY_LOST` for a driver-only stop. The report shows it does show that state at 10 s and 45 s. Whether the coverage-limit wording was changed in 891c7ad is not recorded in the facts supplied for this summary.

## NOT VERIFIED

- Per-scenario assertion counts for scenarios 5, 6 and 10 (T1 requires them).
- Per-scenario evidence lines named in T1 (`realm audit verify --file` exit code, `daemon.log` JSON check, `correlationId` line count, `realm metrics` counts, listener check, gateway-unit restore). Only the ok status is reported.
- T2 (b) exec probe exit code.
- The file list of commit 891c7ad (the three docs files are the T3 scope; the commit's diff was not inspected here).
- T4 `npm run check:docs` result: reported as passing by the orchestrator; not re-run in this summary.
- T3 grep check (`! grep -rn "S17-b (2026-10-30, partial)\|re-run on the current build is pending" docs/integration`): not re-run here.

## Issues Encountered

None in the executor's work. The live steps ran only under the operator.

## Self-Check

Based on the orchestrator facts only. Commit `891c7ad` and the T4 check were not re-read or re-run in this summary; see NOT VERIFIED.

---
*Phase: 17-observability-and-tamper-evident-audit*
*Completed: 2026-11-15*
