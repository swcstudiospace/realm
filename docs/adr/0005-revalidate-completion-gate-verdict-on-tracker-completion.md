# ADR-0005. Revalidate completion gate verdict on tracker completion

- **Status:** accepted
- **Date:** 2026-11-22
- **Deciders:** A03
- **Task:** Tb559-arch

## Context and Problem Statement

Tracker completion rewrites spec with 0 pending rows but staged verdict stays partial_failure, release returns not_ready forever

## Decision Drivers

UTR-01, UTR-02, AC-65, AC-66, AC-67

## Considered Options

- Drop staged verdict on complete()
- never revalidate (rejected: stale verdict survives reload)

## Decision Outcome

Chosen option: "gate release revalidates staged artifacts against current tracker rows; stale partial_failure retires, pending rows keep not_ready".

### Positive Consequences

- `release()` reflects the current tracker status; a completed tracker retires the stale `partial_failure` verdict with 0 manual steps.

### Negative Consequences

- None beyond the synchronous revalidation cost accepted in NFR-P2 (5 s validate / 10 s release); no timer or background revalidator is introduced.

## Consequences

Release reflects current tracker status; 1 pending row still not_ready; warning preserved
