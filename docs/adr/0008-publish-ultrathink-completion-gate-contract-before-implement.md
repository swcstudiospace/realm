# ADR-0008. Publish Ultrathink completion gate contract before implementation

- **Status:** accepted
- **Date:** 2026-11-22
- **Deciders:** A03
- **Task:** Tb559-arch

## Context and Problem Statement

Gate, persistence, advisory behavior needs one versioned contract before parallel implementation

## Decision Drivers

Contract-first rule; US-122 US-123 US-124

## Considered Options

- Implement without contract (rejected: divergent gate semantics)

## Decision Outcome

Chosen option: "publish API-UltrathinkCompletionGate 1.0.0 before A05 claims; 5 operations, non-breaking initial version".

### Positive Consequences

- TBD

### Negative Consequences

- TBD

## Consequences

A05 A08 pin consumer digest; breaking change requires major bump plus migration plus acks
