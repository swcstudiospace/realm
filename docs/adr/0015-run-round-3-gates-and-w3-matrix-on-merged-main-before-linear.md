# ADR-0015. Run round 3 gates and W3 matrix on merged main before Linear close-out

- **Status:** accepted
- **Date:** 2026-11-23
- **Deciders:** A03
- **Task:** Tcffd1-arch

## Context and Problem Statement

US-131 needs r3 gates, the W3 matrix on a519184+0d5032f, planning-hash and Linear close-out evidence in one trail

## Decision Drivers

Gates exit 0 before Linear closes; planning hashes 29bc314a/4b26403c with 0 edits; final report lists PR 255 and PR 259 states

## Considered Options

- close Linear early
- skip W3 matrix
- gate-then-close with hash verification

## Decision Outcome

Chosen option: "Run 7 r3/release plans on merged main and 9-of-9 W3 checks on the ultrathink stack before closing Linear sub-issues".

### Positive Consequences

- 7 r3/release plans (`qa.r3`, `rev.r3`, `sec.r3`, `build`, `rel`, `obs`, `docs`) each exit 0 on the merged main tree (AC-92), and the W3 matrix reports 9 of 9 green on the ultrathink stack `a519184 + 0d5032f` (AC-93)
- Planning hashes verify read-only with 0 edits: STATE `29bc314a`, ROADMAP `4b26403c` (AC-94)
- 4 Linear sub-issues (`SPE-36512`, `SPE-36513`, `SPE-36515`, `SPE-36516`) close only after the gates pass, each with 1 commit ref; 0 closes before gates pass (AC-95)
- The final resume report names 1 state each for PR #255 and PR #259, 2 of 2 (AC-96)
### Negative Consequences

- Close-out waits for 2 different trees (merged main for r3, ultrathink stack for W3), so reporting must name both trees or the evidence trail is ambiguous
- Linear closes stay blocked until all 16 checks are green; a slow plan blocks the whole close-out, not 1 sub-issue

## Consequences

4 sub-issues close only with passing gates; 0 closes before gates pass; evidence trail covers r3, W3, hashes, Linear, report
