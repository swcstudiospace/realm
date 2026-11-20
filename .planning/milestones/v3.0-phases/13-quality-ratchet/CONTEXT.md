# Phase 13 — Quality ratchet: CONTEXT (consolidation)

Canonical detail reused, not rewritten: `13-CONTEXT.md` (locked D-1301..D-1308),
`13-RESEARCH.md`, `13-01-PLAN.md`, `13-SUMMARY.md`, `13-VERIFICATION.md`.
This file is the uniform `CONTEXT.md` entry point for the 7-phase set.

## Goal
Ship the supply-chain/quality ratchet: audit + Dependabot, pack-smoke on the
real tarball, coverage floors, scaled/fake-clock tests, dead-export reference
analysis, fast-check properties, and scheduled mutation — all under D6.

## Owner decisions D1–D6 relevance
- D1: proposal 8 parts A–C in scope. D6: owner signs off
  `.github/workflows/**` + `.github/dependabot.yml`; each PR cites D6.
  Repository settings (TD-10) stay owner's — not in this phase.
- D2/D3/D4/D5: no direct requirement here. D5 catalogue additions are not
  used. QR-07 properties must not be read as closing FS-02 (owner call).

## Honest status (RECOVERY + REQUIREMENTS traceability)
Implemented-unverified overall; `13-VERIFICATION.md` = human_needed 5/6.
QR-03 Finish/repair smoke is in `75631f4` but human workflow review + GitHub
repair-run evidence remain open. QR-04: raised-floor exit-1 shown on host;
Node 22.x/24.x CI floor provenance open (D-1304). QR-05: one-CPU container
pass recorded; CI provenance open. QR-08: permission drop D-1308 applied
(`9e2142f`/`33dd980`); workflow human review + run artifact open. Never claim
live CI/Podman proof from these records.

## Grey areas / decisions
- `package.json`, `package-lock.json`, `ci.yml` shared across plans: serialize.
- Dead-export removal slice by directory; frozen catalogue/`ports`/schema
  validator types out of scope (D-1306).
- First coverage landing report-only; floors from CI measurement minus 1.0
  tolerance (D-1304); never hand-lower floors.
- Mutation stays non-blocking, artifact-only (D-1308); Stryker-isolation
  fallback to in-repo script if it cannot run on compiled output.

## Success criteria (verbatim, from 13-CONTEXT.md §Acceptance)
1. `ci.yml` runs the audit; `.github/dependabot.yml` covers the three targets (QR-01, QR-02).
2. `pack-smoke` fails when one of the four files is missing from the tarball, and the release job reruns `check:pack` on the release tarball after the version sync (QR-03).
3. `npm run test:coverage` prints the coverage output and CI fails below a recorded floor, shown by a run against a raised floor; the dead-export work is done by reference analysis with the frozen catalogue unchanged (QR-04, QR-06).
4. The libpod TTL test and the idempotent lifecycle test use injected clocks or a hold gate; the ACP caps and the other fixed waits use the helper; the suite passes CPU-limited (QR-05).
5. The property tests run in `npm test`, a broken canonicalizer fails one, and the scheduled workflow exists (QR-07, QR-08).
