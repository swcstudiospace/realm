# ADR-0001. Optional Omp plugin toggle defaults on

- **Status:** accepted
- **Date:** 2026-11-21
- **Deciders:** A03
- **Task:** Ta08e-arch

## Context and Problem Statement

The Omp plugin registers 5 tools and paints status at every load with no operator switch. US-112 needs 1 persisted setting that defaults on and silences the plugin fully when off.

## Decision Drivers

Default-on keeps current behaviour; off registers 0 tools paints 0 times mutates 0 bytes; orthogonal to reattach.enabled; hermetic fake proves the off path.

## Considered Options

- Env-only toggle
- separate settings file
- runtime config.json closed-keys change

## Decision Outcome

Chosen option: "Add persisted boot.enabled default true gating all Omp registration and paints".

### Positive Consequences

- TBD

### Negative Consequences

- TBD

## Consequences

Adds BootBounds.enabled and ResolvedBoot.enabled; createRealmPlugin gates tool loop retry lifecycle handlers and paint funnel; hermetic FakePi tests count 0 registration when off. No new dependency, no breaking change.
