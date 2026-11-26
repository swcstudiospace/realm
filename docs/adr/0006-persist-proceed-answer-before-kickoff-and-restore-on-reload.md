# ADR-0006. Persist proceed answer before kickoff and restore on reload

- **Status:** accepted
- **Date:** 2026-11-22
- **Deciders:** A03
- **Task:** Tb559-arch

## Context and Problem Statement

Proceed answer lives only in chat; SIGTERM mid-kickoff loses it, reload repeats the prompt

## Decision Drivers

UTR-03, UTR-04, AC-68, AC-69, AC-70, NFR-S3

## Considered Options

- Keep chat-only answer (rejected: loses on reload)
- ask again after reload (rejected: re-asks settled Q1-Q3)

## Decision Outcome

Chosen option: "persist ANSWER with settled answers and kickedOff before kickoff step 1; reload restores without re-asking".

### Positive Consequences

- TBD

### Negative Consequences

- TBD

## Consequences

Reload restores 3 of 3 answers, kickedOff true, 0 re-asks; 0 secrets persisted
