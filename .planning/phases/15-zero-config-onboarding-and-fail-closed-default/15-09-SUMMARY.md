---
phase: 15
plan: 09
subsystem: docs
tags: [docs, doctor, config, onboarding, driver-roots]
requires: ["15-06", "15-07", "15-08"]
provides:
  - "docs/policy-reference.md names secretRoot and sandboxStateRoot, the overlap rule, and that the CLI, daemon and driver read one file"
  - "docs/integration/openshell.md describes runtime-roots, driver-socket and gateway as the code checks them, and gives the driver-roots cutover"
  - "AGENTS.md layout names daemon/spawn-env.ts and doctor/runtime-checks.ts"
affects: [docs/policy-reference.md, docs/integration/openshell.md, docs/integration/host-binaries.md, AGENTS.md]
key-files:
  created: []
  modified:
    - docs/policy-reference.md
    - docs/integration/openshell.md
    - docs/integration/host-binaries.md
    - AGENTS.md
    - .planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-07-SUMMARY.md
decisions:
  - "The doctor paragraph quotes the gateway outcomes and the root conditions from src/doctor/runtime-checks.ts; the one-item report fix is described as first-time setup or repair of the existing config, as INIT_FIX reads"
  - "The cutover subsection sits after the last doctor-item bullet (after the host-binaries record bullet), before Shutdown"
requirements: [ONB-03, ONB-04]
metrics:
  tasks: 4
  commits: 4
  completed: 2026-11-08
plan_head_before: e894e6e9d816a34d686cfc6fe66b9d7bb96d7f21
commits: 4
status: complete
actuals:
  tokens: 4200
  tasks: 4
  commits: 4
---

# Phase 15 Plan 09: docs for the roots, the environment and the doctor items (ONB-03, ONB-04) Summary

The runtime-config section, the doctor-item rules and the driver-roots cutover now match the shipped code, and the superseded gateway-dial wording is gone.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 0 | drop a host-local path from the 15-07 summary (orchestrator pre-step) | e894e6e | 15-07-SUMMARY.md |
| 1 | config-file section names the two optional roots and the derivation | a6470d2 | docs/policy-reference.md |
| 2 | doctor-item rules and the driver-roots cutover | bc4989d | docs/integration/openshell.md |
| 3 | dated eleven-item record; runbook checked | 4daa9ce | docs/integration/host-binaries.md |
| 4 | AGENTS.md layout entries | f6e547b | AGENTS.md |

## What was added

- `docs/policy-reference.md`: `secretRoot` and `sandboxStateRoot` as optional keys with their derived defaults (`<stateDir>/secrets`, `<stateDir>/sandboxes`); the lexical overlap rule (`SCHEMA_INVALID` at load) and the doctor's check of effective roots; the sentence that the CLI, the daemon and the driver read the file, that a missing `stateDir` or `workspaceRoot` is `SCHEMA_INVALID`, and that the three `REALM_DRIVER_*_ROOT` variables are not read and a stale one is ignored.
- `docs/integration/openshell.md`: the doctor paragraph names fourteen items and the rules of `runtime-roots` (including the 107-byte socket rule and the config-in-workspace rule), `driver-socket`, and `gateway` (`openshell status -o json`, the string `status`, each failing outcome with a fixed phrase), the 2026-11-08 OpenShell 0.1.5 observation, and the one-item report with exit 0. New subsection `### Driver roots in config.json (phase 15)` with the cutover (save the unit and config, remove three `Environment=` lines, optionally set `XDG_CONFIG_HOME=<config home>`, `daemon-reload`, restart driver and daemon, how to reverse), the same-file rule, the stale-variable rule, naming the roots to clear the warning, and the container-reaping caveat.
- `docs/integration/host-binaries.md:56`: the eleven-item count is visibly dated.
- `AGENTS.md`: `spawn-env.ts` in the `daemon/` bullet, `runtime-checks.ts` in the `doctor/` bullet. Ten `##` headings unchanged.
- `docs/integration/omp-lifecycle-runbook.md`: no change. Line 12 lists `image`, `stateDir`, `workspaceRoot` under `<check-dir>/c/realm/config.json`, and line 24 says the roots come from that file and a stale `REALM_DRIVER_*_ROOT` variable is ignored.

## Verification

`npm run check:docs` through the heavy-slot lock exits 0 (host paths ok, agents sync ok, default-mode: 27 files scanned). The four task greps pass: heading count 1, `sandboxStateRoot` in policy-reference, no `then-eleven`, no `endpoint accepts a connection`, both layout files named. Lint and the module-size gate were not run: no source file changed.

## Deviations from Plan

**1. [Orchestrator pre-step] Host-local path removed from 15-07-SUMMARY.md line 78**
- `check:docs` failed on a host-local path in that summary; it was replaced with "the main checkout" and committed alone (e894e6e).

**2. [Plan text vs tree] The cutover subsection sits after the host-binaries record bullet (after the last doctor-item bullet)**
- The plan said "after :231"; that line is the opt-in pin bullet in the middle of the list, so the subsection follows the list's final bullet to keep the doctor bullets together.

**3. [Plan text vs tree] The one-item report fix**
- The plan said the fix "names `realm init`". The source's fix reads as first-time setup with `realm init` when neither file exists, and repair of the existing config otherwise. The doc states that.

**4. [Plan vs code] Driver-restart reap claim corrected after orchestrator verification**
- Plan step (f) asked for the bullet "A driver restart reaps every realm container". That came from research that predates decision D19-5; it is false. Fixed in 8d4d9c0.

**Total deviations:** 4, one a plan-vs-code correction.

## Corrections after orchestrator verification

- False: the last bullet of `### Driver roots in config.json (phase 15)` in docs/integration/openshell.md said a driver restart reaps every realm container of the account.
- Why: plan step (f) copied it from 15-RESEARCH.md, which predates D19-5. The driver start no longer sweeps; `DriverLifecycle.adoptSurvivors` keeps conforming containers and removes the rest with their secrets and scratch volumes.
- Fix: commit 8d4d9c0 replaced the bullet, citing D19-5 and `adoptSurvivors`. A grep of openshell.md, host-binaries.md, policy-reference.md and AGENTS.md found no other sentence claiming a restart reaps all containers; the remaining sweep and reaper mentions describe the daemon-side startup reaper and dated evidence.
- `npm run check:docs` after the fix: exit 0.

## Issues Encountered

The shell session starts in the main checkout, so shell commands began with `cd` to the pinned root. All file-tool paths were absolute in the pinned root.

## Known Stubs

None.

## Threat Flags

None. The cutover text recommends no root variable and no secret value, gives a reversal path, and uses placeholders (`<config home>`, `<state dir>`) for locations.

## Next Phase Readiness

Documentation for plans 15-06 and 15-07 behavior is in place. Plans that change the doctor items or the config keys later must update the openshell.md paragraph and the policy-reference section named here.

---
*Phase: 15-zero-config-onboarding-and-fail-closed-default*
*Completed: 2026-11-08*

## Self-Check: PASSED
