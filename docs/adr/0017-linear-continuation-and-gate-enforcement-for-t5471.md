# ADR-0017. Linear continuation and gate enforcement for T5471

- **Status:** accepted
- **Date:** 2026-11-26
- **Deciders:** A03
- **Task:** T5471-arch

## Context and Problem Statement

T5471 US-134 and US-135: Linear continuation plus review, quality, security and release enforcement per spec 15.4 to 15.5

## Decision Drivers

duplicate scan before creation; 0 releases on red; 0 items without a state

## Considered Options

- Close items without evidence
- release on majority verdict

## Decision Outcome

Chosen option: "Every open Linear item carries done-with-evidence or blocked-with-named-cause, and 4 of 4 gate verdicts gate every release with the most-restrictive verdict winning".

### Positive Consequences

- Every open Linear item carries done-with-evidence or blocked-with-named-cause; duplicate scan prevents parallel duplicates.

### Negative Consequences

- Linear writes remain owner-gated (A01); this ADR records no tracker state.

## Consequences

A01 owns Linear writes; a red verdict names 1 gate and holds release
