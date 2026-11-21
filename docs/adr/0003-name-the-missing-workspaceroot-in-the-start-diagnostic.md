# ADR-0003. Name the missing workspaceRoot in the start diagnostic

- **Status:** accepted
- **Date:** 2026-11-21
- **Deciders:** A03
- **Task:** Ta08e-arch

## Context and Problem Statement

A stored config pointing workspaceRoot at a nonexistent directory exits POLICY_DENIED without naming the directory, so the operator cannot repair. AC-34 requires 1 diagnostic naming 1 missing directory.

## Decision Drivers

Operator-local stderr and doctor output only; audit and log keep fixed text with 0 values; config-shape failures stay SCHEMA_INVALID.

## Considered Options

- Keep a pathless refusal
- log the path in audit lines
- auto-rewrite the stored config at startup

## Decision Outcome

Chosen option: "Name the missing workspaceRoot directory in the operator-local POLICY_DENIED diagnostic with one remedy".

### Positive Consequences

- TBD

### Negative Consequences

- TBD

## Consequences

bindRoot failure gains a bounded operator diagnostic naming the missing directory and the fix-config remedy. Config repair stays an operator action. No new catalogue code, no schema change, no breaking change.
