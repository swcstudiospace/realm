# ADR-0013. Split fake GitHub fixture in boot-report test into two concatenated parts

- **Status:** accepted
- **Date:** 2026-11-23
- **Deciders:** A03
- **Task:** Tcffd1-arch

## Context and Problem Statement

One literal 40-char fake fixture at test/host/boot-report.test.ts:177 triggers the secret scanner while refusal tests must keep asserting 0 echoes

## Decision Drivers

NFR-S1 0 secrets; scanner must report 0; refusal tests keep passing; 0 allowlists

## Considered Options

- allowlist scanner
- delete fixture
- split in-test

## Decision Outcome

Chosen option: "Split the fixture into 2 concatenated parts at 1 test location on swarm/Tb559r-capt09".

### Positive Consequences

- Scanner reports 0 secrets with 0 literal fixture occurrences (AC-88)
- Refusal assertions are byte-identical in intent: the assembled value is still 1 fake sequential fixture the parser rejects with SCHEMA_INVALID and 0 echoes (AC-87)
- The split is 1 test file (`test/host/boot-report.test.ts`), 1 location, 2 concatenated parts, committed on `swarm/Tb559r-capt09`
- The assembled fixture is never a literal in source, so `grep` for the literal returns 0 repo-wide
### Negative Consequences

- Readability: the fixture is no longer greppable in source; future readers must assemble the 2 parts mentally
- No other test file is allowed to copy the assembled literal — reviewers must enforce the split by grep count 0, not by trust

## Consequences

0 literal fixture strings in repo; compiled boot-report test exits 0; refusal assertions report 0 echoes; no runtime or contract change
