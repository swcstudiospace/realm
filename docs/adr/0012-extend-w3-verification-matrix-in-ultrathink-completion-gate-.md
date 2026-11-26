# ADR-0012. Extend W3 verification matrix in Ultrathink completion gate contract

- **Status:** accepted
- **Date:** 2026-11-22
- **Deciders:** A03
- **Task:** Tb559r-arch

## Context and Problem Statement

AC-78 to AC-81 require silence on complete plans, one named advisory, no second prompt and one named failure; contract 1.0.0 cannot express them

## Decision Drivers

UTR-05; UTR-06; AC-78; AC-79; AC-80; AC-81

## Considered Options

- Add a new operation (rejected: would break the count and force a major review)
- leave fields informal (rejected: unenforceable)

## Decision Outcome

Chosen option: "Extend AdvisoryResponse additively at 1.1.0 to name graph, rows, action, render count and named failure".

### Positive Consequences

- TBD

### Negative Consequences

- TBD

## Consequences

Contract 1.1.0 with five operations and optional fields; non-breaking minor bump; A05 and A08 pin the digest
