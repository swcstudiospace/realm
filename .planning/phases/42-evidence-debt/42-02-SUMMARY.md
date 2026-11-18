---
phase: 42-evidence-debt
plan: "02"
subsystem: breaking-change-guard-records
tags: [breaking-change, enforce, ci-proposal, replay, enf-04]
requires: ["01"]
provides:
  - "docs/integration/runtime-decision.md: section Evidence debt (Phase 42) with D42-1 (the guard, its five limits, the replay, the CI state, the ENF-04 closure)"
  - "The replay of the guard on the recorded history of PR 162 and PR 168 (Observed, 2026-11-18)"
  - "The exact CI workflow proposal, options A, B and C, for the owner"
requirements: [DEBT-03]
metrics:
  completed: 2026-11-18
status: partial-awaiting-owner
---

# 42-02 summary: the replay, D42-1 and the CI proposal

Status: Tasks 1 and 5 are done in their report-only form. Task 2 (the owner's wiring answer), Task 3 (a person applies a workflow change) and Task 4 (throwaway pull request controls) have not run. No file under `.github/workflows` was edited, staged or proposed as a diff to apply.

## Files

- `docs/integration/runtime-decision.md`: appended the section and record D42-1.
- `.planning/phases/42-evidence-debt/42-02-SUMMARY.md`: this file.
- `AGENTS.md` and `CONTRIBUTING.md` are unchanged: neither claims CI enforcement, as the plan requires without an owner answer of A or B.

## Replay (Observed, 2026-11-18, local git only, `--enforce`)

| Case | Flags (besides `--enforce`) | Exit | Header | Findings |
| --- | --- | --- | --- | --- |
| PR 162 range, marked title | `--base 5baf9ae --head df6ecec --merge-method merge --title "feat(capability)!: ..."` | 0 | `ok (landing merge, 2 commits, 1 breaking)`, signals `commit-marker (1)`, `commit-footer (1)` | none |
| PR 162 range, unmarked title | same with `--merge-method squash --title "feat(capability): ..."` | 1 | `violations (landing squash)` | `title-unmarked` |
| PR 162 range, unmarked title | same with `--merge-method merge` | 0 | `ok (landing merge)` | none |
| PR 168 squash commit | `--base ad10c08 --head e4f7bea --merge-method squash --title "feat(capability): per-client enforce proofs ... (34-03) (#168)"` | 0 | `ok (1 commits, 0 breaking)`, signals none | none |
| PR 168 with the ticked template line (`REALM_PR_JSON`, base `ad10c08`, head `e4f7bea`) | `merge_method: squash` | 1 | `violations`, signal `declared` | `title-unmarked` |
| same | `merge_method: merge` | 1 | `violations`, signal `declared` | `commit-unmarked` |
| same | `merge_method: unknown` | 1 | `violations`, signal `declared` | `commit-unmarked`, `title-unmarked` |

All outcomes match the plan's expectations. One difference of detail: the plan expected the PR 162 signals to be `commit-marker (1)` only; the flip commit `2637d9a` also has a `BREAKING CHANGE:` footer, so the guard also reports `commit-footer (1)`. The range holds two commits: the flip and the unmarked test-only `df6ecec`. The outcome is the same. The guard needed no change.

The observed limit, in the plan's words: PR 168's three commits carried no marker and its title carried none, and the guard cannot see a breaking change nobody marked or declared.

## The CI proposal (for the owner; an agent applies nothing under `.github/workflows`)

Why the existing gates cannot enforce: the `verify` job checks out one commit with no `fetch-depth` (for a pull request, the merge commit), so the base and head commits are absent. The pull request event runs on opened, synchronize and reopened only, so editing a title or ticking the template line starts nothing. The checkout has `persist-credentials: false`. `npm run check:gates` and `npm run check:docs` therefore cannot run the guard with a range. Both needs, history and the `edited` activity type, are under `.github/workflows/**`, which a person reviews at the exact head.

**Option A (recommended): a new file `.github/workflows/breaking-change-guard.yml`.** A title or body edit re-runs only this small job, not the Node matrix, the site build and the audit.

```yaml
name: Breaking change guard

on:
  pull_request:
    branches:
      - main
    types:
      - opened
      - synchronize
      - reopened
      - edited

permissions:
  contents: read

concurrency:
  group: breaking-change-guard-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  guard:
    name: Breaking change marker
    # Fork pull requests are skipped, as in ci.yml: this repository's own code is the only code that runs.
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions:
      contents: read
    steps:
      - name: Checkout source with history
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false

      - name: Set up Node.js 22.x
        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 22.x

      - name: Check the breaking-change marker
        run: |
          set -euo pipefail
          node scripts/check/breaking-change-guard.mjs --enforce
```

Nothing from the event reaches a shell line: the script reads the title, body and the two commit ids from the event file named by `GITHUB_EVENT_PATH`. The merge method is unknown in CI, so the landing is `unknown` and the strict rule applies (a marked title and a marked commit when the change is breaking). The job is not in the `needs` chain of `ci.yml`, and `main` has no branch protection, so the red check is read by the ship flow, as the Greptile score is; AGENTS.md step 3 would name it once applied.

**Option B: a step and an activity type in `ci.yml`.** Change the trigger to `pull_request` with `branches: [main]` and `types: [opened, synchronize, reopened, edited]`; set the `verify` checkout to `fetch-depth: 0`; add after Check docs a step `Breaking change marker` with `if: github.event_name == 'pull_request' && matrix.node-version == '22.x'`, whose run is `set -euo pipefail` and `node scripts/check/breaking-change-guard.mjs --enforce`. Cost: every title or body edit re-runs the whole workflow (verify on two Node versions, site, audit), and `concurrency` cancels in-flight pull request runs. Benefit: the guard is part of "ci.yml must be green" and the build job's `needs` chain, with no new file.

**Option C: no workflow change.** The guard stays report-only in CI. The ship flow (user configuration outside this repository) runs `node scripts/check/breaking-change-guard.mjs --enforce --base BASE --head HEAD --title TITLE --merge-method METHOD` before the merge: BASE and HEAD are the pull request's base and head commits, TITLE the title that becomes the squash subject, METHOD the configured merge method. This works with any option and is the only form that knows the merge method.

Risk common to A and B: `base.sha` of the event is the base branch tip at event time, and the merge-ref checkout may be built against an older tip, so the base commit can be missing. The guard then reports `range-unavailable`, which fails under `--enforce` (fail closed); a re-run after the merge ref refreshes fixes it. If that proves frequent, a step `git fetch --no-tags origin BASE_SHA` is a further workflow change, not proposed now.

## Owner decisions still open (Task 2)

1. CI wiring: A, B or C. With no answer: C, and D42-1 already says CI does not run the guard and the proposal stands.
2. Whether the ship flow runs the enforce command before every merge (OQ-42-04); user configuration, not changed here.
3. Whether a follow-up marked commit or a note for PR 168 is wanted (OQ-42-06). Default no; D42-1 states the partial as a closed process gap and an open historical fact.
4. For A or B: who applies the change and reviews its exact head. After it merges, Task 4 controls (red on an unmarked title, green after editing the title, red on a ticked declaration with no marked commit) run on a throwaway pull request, and AGENTS.md and CONTRIBUTING.md step 3 then name the job.

## Checks run

`node scripts/check/host-paths.mjs`, `node scripts/check/agents-sync.mjs`, `node scripts/check/default-mode.mjs`: all pass.

## Hand-off for the orchestrator

Register DEBT-03 as satisfied in its report-only form (the proposal recorded, wiring pending the owner), the ENF-04 traceability note "Complete; the partial closed as a process gap by Phase 42, historical entry unchanged", and tell the owner the ship-flow command and the open proposal. ROADMAP, STATE and REQUIREMENTS are not edited here.
