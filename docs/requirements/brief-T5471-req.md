# Cleaned Brief — T5471-req (2026-11-26)

**Task:** `T5471-req` · **Correlation:** `5471bbdd-a599-46f0-90e0-030b02946517` · **Capability:** `req.spec`
**Source brief (verbatim quotes below):** task.assign Brief + acceptance list.
**PII scan:** `req_pii_scan` SUCCESS, found [], has_pii false, regimes_hint [] — redacted copy equals source text.
**Ambiguity scan:** `req_ambiguity_scan` SUCCESS, score 0, 0 of 5 sentences flagged, terms [], needs_clarification false.

## Stakeholder-quoted sentences

- "Program our codebases code quality and programming patterns State-of-the-Art, Best-in-Class, Production-Grade and Enterprise-Ready."
- "Please fix the blockers and continue programming our Linear Issues and Sub Issues"
- "Gates review, quality, security, release enforced per risk class"

## Cleaned interpretation (measurable)

"State-of-the-Art / Best-in-Class / Production-Grade / Enterprise-Ready" is operationalized in this spec as: 8 standard gates exit 0, CI green on Node 22 and 24, vulnerability audit exit 0 with 0 dependency drift, 0 suppression comments, 0 silent catches beyond the 10 named QUAL-01 exceptions, 0 modules over the size ratchet, 100% traceability, and 0 Linear items without a recorded state. Adjectives alone never count as evidence.

## Constraints

- Risk class medium; scope change above 20% of committed stories needs human approval (L3) — this section adds 4 stories to 31 existing, below that ceiling.
- A02 writes only requirements.spec, user.stories, acceptance.criteria, plus the nfr and traceability records that point at them. No product code, no architecture, no schedule.
- Live phases 56–58 remain blocked on the realmlive stack; they are recorded as blockers, not fixed here.
- "fix the blockers" = every open Linear issue/sub-issue ends with done-with-evidence or blocked-with-named-cause. No Linear write is performed by this spec task; routing is recorded for A01.

## Open questions

- Q1: Which exact Linear workspace counts as current for the dedup scan? Awaiting A01 list_issues result; spec assumes SPE-* issues for phases 55–59 plus Tb559 series.
- Q2: Current branch `fix/stdio-host-shutdown-log` head evidence for the 8 gates has not been run in this spec task; baseline numbers are recorded by downstream A08, not guessed here.

## Success measures

- 4 new stories (US-132–US-135), 12 new automated criteria (AC-97–AC-108), 0 manual-only criteria.
- Traceability 100% for the new set; NFR coverage complete across perf, security, a11y, i18n, compliance.
