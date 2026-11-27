# ADR-0018. Ship 7-file docs update with GAP-43-03 closed and Greptile waived for billing

- **Status:** accepted
- **Date:** 2026-11-27
- **Deciders:** A03
- **Task:** T8345-arch

## Context and Problem Statement

US-136 docs-only ship: 3 WINDOW addenda, 3 VERIFICATION-UPDATE records, GAP-43-03 closure on branch fix/stdio-host-shutdown-log; CI verify/site/audit/guard green; Greptile 5/5 waived by owner billing waiver

## Decision Drivers

Docs and planning only with 0 product-code edits; 1 green CI PR to main with squash via ultrathink ship flow; Greptile waiver recorded verbatim in PR body, not silent

## Considered Options

- Silent Greptile skip
- product-code ship
- direct push to main

## Decision Outcome

Chosen option: "Ship the 7-file evidence set docs-only with 1 recorded Greptile billing-waiver line".

### Positive Consequences

- TBD

### Negative Consequences

- TBD

## Consequences

Docs-only change with 0 runtime topology, 0 contract, 0 NFR deltas; waiver line is the only Greptile record; evidence set ships in 1 PR
