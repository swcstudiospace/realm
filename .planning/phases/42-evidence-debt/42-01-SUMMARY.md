---
phase: 42-evidence-debt
plan: "01"
requirements: [DEBT-02]
---

# 42-01 summary: the breaking-change marker guard

Landed as PR 187 (`cb6e38e`) on 2026-11-18. The plan built a report-only guard for the `!` marker convention and wired it into the gate conventions without touching `.github/workflows`, `src` or `scripts/release`.

## What changed

- `scripts/check/breaking-change-guard.mjs`: reads a pull request (title, body, base, head, merge method) and the non-merge commits of the range, derives four signals (`commit-marker`, `commit-footer`, `body-footer`, `declared`), applies the rule of the landing (`merge`, `squash`, `unknown`) and prints a header line, a signals line and one line per finding. Findings are violations (`commit-unmarked`, `title-unmarked`) or unproven (`title-not-supplied`, `range-unavailable`). Report-only is the default and exits 0; `--enforce` (or `REALM_BREAKING_GUARD=enforce`) exits 1 on any finding; a usage or input error exits 2. Untrusted text is printed only as a JSON string literal cut to 200 characters; git is spawned with an argument array and a timeout, never a shell.
- `scripts/check/breaking-change-guard.test.mjs`: 46 tests, all passing: the rule matrix, temporary git repositories with an explicit identity and no global git config, the input shapes, injection-safe output, an entrypoint run, and a parity test that runs the real `generateChangelog` and asserts that the guard's marker decision for each subject equals whether the generator kept the commit.
- `package.json`: the `check:breaking` entry only. It is not part of `check:gates` or `check:docs`, because the CI checkout has one commit and no pull request context.
- `AGENTS.md` (Commands, Conventions, Merge and release flow step 5), `CONTRIBUTING.md` (the gates table, Branches and pull requests step 5, Commit messages) and `.github/PULL_REQUEST_TEMPLATE.md` (the Breaking change line, the `declared` signal).

## Checks and limits

- The tests also passed as a regular user (`nobody`) from a copy of the scripts. Three seeded defects each failed the suite and were reverted: a squash rule that accepts any title (12 tests failed), report-only exiting 1 (4 failed) and a header pattern without the bang group (20 failed, including the parity test).
- `npm run test:scripts` runs the file in CI on Node 22.x and 24.x.
- The guard is a report. It cannot see a breaking change nobody marked or declared, it checks the inputs of the merge and not the commit that reaches `main`, and CI does not run it (plan 42-02 records the proposal and the open owner decision).
