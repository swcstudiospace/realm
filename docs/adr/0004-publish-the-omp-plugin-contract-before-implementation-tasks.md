# ADR-0004. Publish the Omp plugin contract before implementation tasks

- **Status:** accepted
- **Date:** 2026-11-21
- **Deciders:** A03
- **Task:** Ta08e-arch

## Context and Problem Statement

US-112 and US-113 need cross-boundary interfaces A05 and A06 can build against in parallel without integration surprises, and A02 NFR-S2 and NFR-A2 must bind to measurable clauses.

## Decision Drivers

Contract-first ordering; 4 operations; single-writer A03; digest-pinned consumers; new contract is additive by construction.

## Considered Options

- Amend API-RealmControl with plugin operations
- leave toggle and paint targets informal in the blueprint

## Decision Outcome

Chosen option: "Publish API-RealmOmpPlugin 1.0.0 as the versioned contract for toggle status-paint and startup-diagnose before implementers CLAIM tasks".

### Positive Consequences

- TBD

### Negative Consequences

- TBD

## Consequences

Adds docs/architecture/contracts/api-realm-omp-plugin.yaml 1.0.0 with 4 operations. Existing RealmControl 1.0.0 and GSD-Linear 1.0.0 unchanged apart from a quoting repair. No breaking change, L2.
