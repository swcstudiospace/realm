# ADR-0016. Quality baseline and pattern ratchet for T5471

- **Status:** accepted
- **Date:** 2026-11-26
- **Deciders:** A03
- **Task:** T5471-arch

## Context and Problem Statement

T5471 US-132 and US-133: State-of-the-Art quality needs a measured baseline before any pattern change, per spec 15.1 to 15.3

## Decision Drivers

8 gates each exit 0; no guessed numbers; frozen catalogue unchanged

## Considered Options

- No baseline, pattern changes judged ad hoc
- reverted on failure

## Decision Outcome

Chosen option: "Record the 8-gate baseline on fix/stdio-host-shutdown-log, then ratchet patterns against it with 0 regressions and 0 frozen catalogue changes".

### Positive Consequences

- The 8-gate baseline gives every later pattern change a measured bar; a failed pattern is reverted or carried with one tested reason.

### Negative Consequences

- Baseline bookkeeping costs one measured run per branch; no runtime or package change.

## Consequences

A08 records the 8 exit codes downstream; a failed pattern is reverted or carried with 1 tested reason
