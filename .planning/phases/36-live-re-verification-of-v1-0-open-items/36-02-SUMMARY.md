---
phase: 36-live-re-verification-of-v1-0-open-items
plan: "02"
status: complete-with-owner-decision-open
completed: 2026-11-18
requirements: [V1LIVE-01, V1LIVE-02]
---

# Plan 36-02 summary

Base commit e32bb057a9f6 (origin main at the start). Node v24.18.0, npm 11.16.0. No file under `src` or `test` changed; no docs file changed; the archived v1.0 reports are untouched. Files added: the four phase planning files copied from the planning branch (CONTEXT and the three plans), `36-DISPOSITIONS.md` and this summary.

## Runs

- OI-12 (2026-11-18): `npm run build`, then `node --test --test-name-pattern="a JSON-RPC notification|neither a string" dist/test/mcp/server.test.js`: 2 tests, 2 pass, 0 fail. Row: Closed by test (hermetic, dated).
- OI-09 hermetic half (2026-11-18): `node --test --test-name-pattern="null containerId|null-containerId" dist/test/session/reap.test.js`: 2 tests, 2 pass, 0 fail. The OI-09 row stays Pending Plan 36-03 (live half).
- OI-14 (2026-11-18, scratch copy outside the repository, evidence outside the repository): `npm ci --ignore-scripts --no-audit --no-fund` exit 0 (145 packages); `npm audit signatures` exit 0 (145 verified registry signatures, 39 verified attestations, none invalid or missing); independent SHA-512 recomputation of the 10 direct tarballs against the lockfile: 10 of 10 equal. Row: Re-verified (dated run, command, commit). The scratch directory was removed; `git status` showed no change to `package.json`, `package-lock.json` or `src`.

## Owner decision (OI-13, OQ-36-01)

No answer was available to the executor. Per the plan's default (decline or no answer), no docs file was changed, `docs/integration/mcp.md` has no Q11, and the row reads Needs the owner (decision text proposed). The proposed text and the lift condition are in Part B of the ledger.

## Ledger

Seven rows final (OI-01 to OI-04 by Phase 27 record, OI-12, OI-13, OI-14), seven Pending Plan 36-03.

## Rows Plan 36-03 must close

OI-05, OI-06, OI-07 (cite the Plan 36-01 Muse run record), OI-08 (cite the Plan 36-01 Hermes run record), OI-09 (live half; cite the hermetic half above), OI-10, OI-11, plus Part C of the ledger. If the owner answers OQ-36-01 before then, OI-13 is updated per Task 5 of Plan 36-02.
