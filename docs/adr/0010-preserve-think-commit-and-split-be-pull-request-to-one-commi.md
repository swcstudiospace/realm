# ADR-0010. Preserve think commit and split BE pull request to one commit

- **Status:** accepted
- **Date:** 2026-11-22
- **Deciders:** A03
- **Task:** Tb559r-arch

## Context and Problem Statement

Local BE and FE both contain c53a15c but remote FE and PR 258 do not; a rebase that drops c53a15c would lose the think commit

## Decision Drivers

SPLIT-01; SPLIT-02; AC-75; AC-76; human decision prsplit=split; Draft until gates green; ultrathink ship flow

## Considered Options

- Keep two commits in PR 259 (rejected: PR scope)
- drop c53a15c (rejected: loss forbidden)
- force main (rejected: never)

## Decision Outcome

Chosen option: "Preserve c53a15c on swarm/Tb559-think and rebase BE onto 0d5032f so PR 259 holds 90b18ce only".

### Positive Consequences

- The think commit `c53a15c` is preserved on `swarm/Tb559-think` with 0 loss, and PR #259 holds exactly 1 commit (`90b18ce`) after rebase onto `0d5032f`.

### Negative Consequences

- PR #259 stays Draft until gates are green; `force-with-lease` applies to swarm branches only and never to `main`.

## Consequences

PR 259 holds one commit; one preserved branch holds the think commit; force-with-lease only on swarm branches
