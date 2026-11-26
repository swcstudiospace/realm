# ADR-0014. Merge pull request 256 conditionally on local and CI green with Greptile absence recorded

- **Status:** accepted
- **Date:** 2026-11-23
- **Deciders:** A03
- **Task:** Tcffd1-arch

## Context and Problem Statement

PR 256 on swarm/Tb559r-capt09 (354f00a, 5 docs files) needs a conditional merge while Greptile is offline

## Decision Drivers

Local gates exit 0; CI Verify 22.x/24.x+docs+breaking+audit green; ship flow squash; 0 fake 5 of 5 claims

## Considered Options

- block merge until Greptile returns
- fake Greptile verdict
- conditional merge with recorded absence

## Decision Outcome

Chosen option: "Merge PR 256 once via ultrathink ship flow with local+CI green and Greptile absence recorded".

### Positive Consequences

- PR 256 merges 1 time with squash through the ultrathink ship flow to main from the 354f00a line with 5 docs files
- The PR body records 1 Greptile absence note with offline evidence and 0 claims of 5 of 5 reviews — 0 fake verdicts, the honest substitutes for the missing review gate
- Merge is blocked until local gates (`check:docs`, `test:scripts`, `build`, `lint`, 1 compiled boot-report run) each exit 0 and CI Verify (Node 22.x + 24.x, docs site, breaking-change, audit) is green
- After merge, `npm run check:docs` on the main tree exits 0
### Negative Consequences

- Review depth is lower than with Greptile live: the merge rests on local + CI evidence and 1 recorded absence note, not an independent review verdict
- A later Greptile pass could still raise findings on the merged change; the ship flow must not claim 5 of 5 coverage it never received

## Consequences

1 squash merge to main; PR body carries Greptile absence note; check:docs exit 0 on main; Greptile absence remains the user-accepted substitute
