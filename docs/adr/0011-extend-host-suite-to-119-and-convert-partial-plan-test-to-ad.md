# ADR-0011. Extend host suite to 119 and convert partial-plan test to advisory

- **Status:** accepted
- **Date:** 2026-11-22
- **Deciders:** A03
- **Task:** Tb559r-arch

## Context and Problem Statement

The partial late-plan test asserts silence but W3 requires an advisory; the host suite must prove the advisory hermetically

## Decision Drivers

TEST-01; AC-77; human decision omptest=extend; fatal-path silence unchanged

## Considered Options

- Keep silence and add a duplicate test (rejected: two truths)
- weaken suite scope (rejected: coverage drops)

## Decision Outcome

Chosen option: "Add omp.test.ts as sixth target and convert the line 454 partial-plan test to a W3 advisory expectation modeled on omp-flight.test.ts".

### Positive Consequences

- TBD

### Negative Consequences

- TBD

## Consequences

Suite reports 119 of 119 with zero failures; advisory expectation covers AC-79 hermetically and fatal silence holds
