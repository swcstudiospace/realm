# ADR-0002. Merge Realm status into the additional UI widget

- **Status:** accepted
- **Date:** 2026-11-21
- **Deciders:** A03
- **Task:** Ta08e-arch

## Context and Problem Statement

Realm status paints under the bar through ctx.ui.setStatus realm key in src/omp/plugin.ts. US-113 requires the merged UI in the additional region rendered by the Omp host with 0 under-bar paints and 4 of 4 truthful states.

## Decision Drivers

Same status text contract from renderRealmStatus; adapters/omp/index.js stays a shim with no realm logic; off-path retains last truthful text unchanged.

## Considered Options

- Keep setStatus and accept under-bar paint
- dual paint to both surfaces
- new HTTP status endpoint not documented on the host

## Decision Outcome

Chosen option: "Paint Realm status only via the Omp additional-UI widget region with 0 under-bar status paints".

### Positive Consequences

- TBD

### Negative Consequences

- TBD

## Consequences

Extends the Omp status UI interface with an additional-UI sink; single paint funnel routes to the widget only. Host signature is upstream-sourced per docs/integration/omp.md Q3 and must be spike-verified before live proof. No new dependency, no breaking contract change.
