# Phase 55: Omp plugin health check - Context

**Gathered:** 2026-11-20, from `.planning/MILESTONE-CONTEXT.md` (D-v9-2, Constraints, Limits), `.planning/REQUIREMENTS.md` v9.0 (HEALTH-01..02), `.planning/ROADMAP.md` Phase 55, `src/doctor/checks.ts`, `src/doctor/checks-host.ts`, `src/doctor/host-checks.ts`, `docs/integration/omp-lifecycle-runbook.md`, `docs/integration/omp.md`.
**Status:** Planned (one plan, nothing executed).

## Phase Boundary

`realm doctor` already reports host-plugin receipts (`host-plugins`), capability-token state and runtime roots; no check reports whether the Omp plugin is installed, the right version, and loaded. This phase adds one read-only doctor check for the Omp plugin install and health state (pass when installed and healthy; warn or fail with fix text for not installed, wrong version, not loaded) and a runbook section mapping each failing outcome to its remedy. Hermetic-first: the check runs on injected fakes, no live window needed for the core; a live proof, if any, runs inside a Phase 56 to 58 window or its own. Phase 59 (concurrent binding) is explicitly excluded: it is gated on the owner ratification of `53-DESIGN.md` (D-v9-6) and this phase writes no binding code.

**Out of scope:** installing, removing or repairing the plugin except through the existing `doctor --fix` rules; Phase 59 binding lock; any `src` file outside `src/doctor/` and its enumerating tests; OMPV-04 or UI-01.

## Decisions

- **D-55-1 (owner D-v9-2):** add the check plus the runbook section (HEALTH-01, HEALTH-02).
- **D-55-2:** the check reads Omp plugin state through the same seams as the existing doctor checks (injected probes, no process environment); what Omp exposes about its own install is recorded by the planner, and the check reports warn or fail with its fix rather than guessing.
- **D-55-3:** the check list is an enumerating surface: `src/doctor/checks.ts`, its enumerating tests and the doctor docs update in the same pull request; the check is read-only and bounded like every other doctor probe (a timeout on every read, no host-local absolute path in committed files).
- **D-55-4:** no runbook step signals a process the operator did not start; every claim carries an evidence label and is checked against the code or a run.
