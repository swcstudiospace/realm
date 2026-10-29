# Baseline verification matrix: phase 9.7 and the stabilisation run

Written 2026-10-28. The baseline is the tree at commit def7669 (clean, no uncommitted change), run before any change of this run. The final column is the merged tree at the end of the run (the working tree equals commit 810c78a, which is feat/realm-v2-0 merged with origin/main at v0.1.3). The host is shared with other heavy work, so the seconds carry load noise (load average 27 at the baseline, up to 73 at the end).

| Check | Baseline (def7669) | Final (merged tree) | After the Greptile review (PR head 2c401b5) |
|---|---|---|---|
| `npm run typecheck` | exit 0, 161 s | exit 0, 211 s | exit 0, 126 s |
| `npm run lint` | exit 0, 213 s | exit 0, 420 s | exit 0, 229 s |
| `npm test` | exit 0, 1642 tests, 1635 pass, 0 fail, 7 skipped, 265 s | exit 0, 1828 tests, 1818 pass, 0 fail, 10 skipped, 359 s | exit 0, 1843 tests, 1833 pass, 0 fail, 10 skipped, 305 s |
| `npm run test:scripts` | exit 0, 80 of 80, 11 s | exit 0, 109 of 109, 15 s | exit 0, 109 of 109, 16 s |
| `npm run check:docs` | exit 0 | exit 0 | exit 0, 7 s |
| `npm run check:pack` | exit 0, 89 s | exit 0, 144 s | exit 0, 163 s |
| `npm run check:mcp` | exit 0, 10 s | exit 0, 9 s | exit 0, 8 s |
| TODO or FIXME markers under src, test, scripts | none | none added | none added since d9298c0 (diff audit, 21 files) |
| Suppression directives (ts-ignore, ts-expect-error, ts-nocheck, eslint-disable) | none | none added (diff audit) | none added since d9298c0 (diff audit) |

The last column is the pull request head after the three Greptile rounds (commit 2c401b5; the load average was 17 when that chain started). The seconds carry the same load noise as the others.

The skipped tests are the gated live suites (the nine production scenarios and the Podman gate). They skip by default and in CI, and were run by hand against the production stack; the results are in 09.7-VERIFICATION.md.

## Known-error findings
The baseline was green: no check failed. The errors this run fixed came from the A10 boundary review, the A18 supply-chain review, the open rows of `docs/integration/hardening-plan.md` and the RT-04 status gap, triaged into 34 rows (E-01 to E-34) in `.planning/phases/09.7-review-finding-remediation/09.7-CONTEXT.md`, and from four defects that only the live proof could find (listed in 09.7-01-SUMMARY.md).

## Repeat runs
No test failed at the baseline, so there was nothing to repeat. One chain hung for 45 minutes during the run because of a test-only flaw (an injected never-settling command affected every doctor check); it was fixed in test code and the chain re-run. The final chain was run twice on the final code (once before and once after the merge with main), with identical counts.

## Evidence
The raw logs are kept in the orchestrator's private evidence directory (3.5 GB), not in the repository. Names and values quoted in the planning files come from them.
