# Cleaned brief — T8345-req

**Task:** `T8345-req` · **Correlation:** `8345f9e5-8a56-40a5-9967-0368d907cca7` · **Capability:** `req.spec`
**Source brief:** "Ship it: commit the window and gap updates, open a PR with green CI, and skip Greptile. Branch fix/stdio-host-shutdown-log: commit the 7 files (3 WINDOW.md addenda, 3 VERIFICATION-UPDATE-20261127.md, GAP-43-03 close in host-plugin-gaps.md), open a PR into main, ensure CI verify/site/audit + Breaking-change guard green, merge via the project's ultrathink ship flow (squash default), explicitly skip the Greptile 5/5 rule per owner billing waiver. Do not edit product code; docs/planning only."

**PII scan:** `req_pii_scan` found 0 patterns, 0 regimes hinted. Redacted text equals source text.
**Ambiguity scan:** `req_ambiguity_scan` score 0.0 over 6 sentences, 0 flagged terms, needs_clarification false.

## Goal

Land the 7-file docs update on branch `fix/stdio-host-shutdown-log` to `main` in 1 pull request with green CI, with the Greptile 5/5 rule waived under the owner billing waiver.

## Stakeholders

- Owner (billing waiver authority) — quoted: "per owner billing waiver".
- Maintainer (ship operator) — quoted: "merge via the project's ultrathink ship flow (squash default)".
- CI (verify/site/audit + Breaking-change guard) — quoted: "ensure CI verify/site/audit + Breaking-change guard green".

## Constraints

- "Do not edit product code; docs/planning only."
- "commit the 7 files (3 WINDOW.md addenda, 3 VERIFICATION-UPDATE-20261127.md, GAP-43-03 close in host-plugin-gaps.md)".
- "explicitly skip the Greptile 5/5 rule" (waiver, not a silent skip).
- "open a PR into main" from `fix/stdio-host-shutdown-log`.

## Success measures

- 1 pull request to `main` from `fix/stdio-host-shutdown-log`.
- 5 CI runs green (verify 22.x, verify 24.x, site, audit, guard) with 0 failures.
- 1 squash merge to `main` with 0 product-code edits and 1 recorded Greptile waiver line.

## Open questions

- None. Ambiguity 0.0 and manual-only share 0% require no clarification round.
