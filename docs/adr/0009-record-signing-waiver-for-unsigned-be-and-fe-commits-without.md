# ADR-0009. Record signing waiver for unsigned BE and FE commits without provisioning a key

- **Status:** accepted
- **Date:** 2026-11-22
- **Deciders:** A03
- **Task:** Tb559r-arch

## Context and Problem Statement

Every origin/main commit reports unsigned (G?=N) with zero signing keys configured, so be_patch_shape_check fails on commits_signed for reasons outside this change

## Decision Drivers

SIGN-01; AC-74; human decision signing=waiver; zero keys, zero force on main

## Considered Options

- Provision a signing key (rejected: permission and trust scope)
- block merge forever (rejected: no owner key exists)

## Decision Outcome

Chosen option: "Record one waiver per commit 90b18ce and 0d5032f with zero keys provisioned".

### Positive Consequences

- TBD

### Negative Consequences

- TBD

## Consequences

Gate reports zero commits_signed failures once both records land; waiver is narrow to these two commits
