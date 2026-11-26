# ADR-0007. Render incomplete plan notice as advisory and continue

- **Status:** accepted
- **Date:** 2026-11-22
- **Deciders:** A03
- **Task:** Tb559-arch

## Context and Problem Statement

Blocking STOP-proceed prompt violates advisory design and breaks gsd-autonomous autonomy

## Decision Drivers

UTR-05, UTR-06, AC-71, AC-72, AC-73

## Considered Options

- Keep blocking prompt (rejected: violates AC-32-33 design, breaks autonomy)
- suppress warning (rejected: loses visibility)

## Decision Outcome

Chosen option: "incomplete verdict renders planAdvisoryNote via aside and continues under gsd-autonomous autonomy; 0 STOP proceed confirm strings".

### Positive Consequences

- TBD

### Negative Consequences

- TBD

## Consequences

1 advisory note names pending count, 1 warning line stays visible, 0 manual proceed steps
