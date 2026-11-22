---
phase: 42-evidence-debt
verified: 2026-11-22
verdict: passed
status: passed
score: "3/3 requirements covered (DEBT-01, DEBT-02, DEBT-03): DEBT-01 met (Set B as uid 5002: 5542 tests, 0 failed, 83 skipped); DEBT-02 met (script, 46 tests, docs, and the CI workflow of option A written; the workflow awaits the owner's review of its exact head and has not run on a real pull request); DEBT-03 partial (the record, the replay, the ENF-04 closure and the workflow are written; enforcement in CI starts only when the workflow is reviewed and merged, and the ship flow's own enforce run is unconfirmed)"
ref: "origin/main 62b85fe (PR 187 cb6e38e, PR 200 9b1697b, PR 203), plus the recording change that carries this file and the workflow"
behavior_unverified: 4
overrides_applied: 0
covered_files:
  - ".planning/phases/42-evidence-debt/42-CONTEXT.md"
  - ".planning/phases/42-evidence-debt/42-01-PLAN.md"
  - ".planning/phases/42-evidence-debt/42-01-SUMMARY.md"
  - ".planning/phases/42-evidence-debt/42-02-PLAN.md"
  - ".planning/phases/42-evidence-debt/42-02-SUMMARY.md"
  - ".planning/phases/42-evidence-debt/42-03-PLAN.md"
  - ".planning/phases/42-evidence-debt/42-03-SUMMARY.md"
  - "scripts/check/breaking-change-guard.mjs"
  - "scripts/check/breaking-change-guard.test.mjs"
  - "scripts/release/changelog.mjs"
  - "package.json"
  - "AGENTS.md"
  - "CONTRIBUTING.md"
  - ".github/PULL_REQUEST_TEMPLATE.md"
  - ".github/workflows/ci.yml"
  - ".github/workflows/breaking-change-guard.yml"
  - "docs/integration/runtime-decision.md"
  - "docs/integration/capability-token-evidence.md"
  - "test/docs/capability-token-evidence.test.ts"
  - "test/runtime/exec-watchdog.test.ts"
covered_digest: "v3:sha256:7de492854ba8630253786bd9d0345c8e23ee006c14358e7460b8f0bc624ccf10"
---

# Phase 42 Verification: evidence debt

Method: a read of the files above on the recording branch, against the requirement statements DEBT-01 to DEBT-03 in `.planning/REQUIREMENTS.md` and the truths of plans 42-01 to 42-03, on 2026-11-18. The Set B result is copied from the window's evidence (kept outside the repository; this file names no path of it) as reported to the recording task. The replay of the guard on PR 162 and PR 168 was run by the executor of plan 42-02 on local git history. The workflow file was checked with a YAML parser and `actionlint`; the verifier ran no live step and no workflow run.

What this phase is, stated once: a process and evidence phase. It added a guard for the `!` marker convention, replayed it on the history that produced the ENF-04 partial, wrote the decision record D42-1, ran the whole unit suite once as a regular user, and, on the owner's decision of 2026-11-18 (option A), added one workflow file that runs the guard in CI. It changed no file under `src`, no schema and no default, and did not edit `ci.yml`.

## Requirements coverage

| Req | Statement | Status | Evidence |
| --- | --- | --- | --- |
| DEBT-01 | The whole unit suite runs as a non-root user (uid 5002) and the result is recorded (EVID-01 Set B), including any failure as a finding | MET | The Set B row of `docs/integration/capability-token-evidence.md` (EVID-01): commit `62b85fe`, Node v24.18.0, uid 5002 gid 5002, `ptrace_scope` 1, scrubbed environment, 5542 tests, 5459 passed, 0 failed, 83 skipped (counted as not-run). The first run on `d80c79a` is recorded as a finding: 41 stale compiled Anda tests (a stale-build artefact) and 1 test assumption (the exec watchdog BASH_ENV case under a scrubbed environment), fixed in PR 203 and rerun from a clean rebuild with 0 failures. The DEBT-01 paragraph of D42-1 repeats it. |
| DEBT-02 | A script under `scripts/check`, with tests, reports every commit subject in a pull request range that is breaking and lacks the `!` marker, unless the pull request lands as a merge commit; it is wired into the gate conventions of the repository | MET; the CI workflow is written and not yet reviewed by the owner or run | `scripts/check/breaking-change-guard.mjs` and its 46 tests (PR 187): the rule matrix, the git-backed scenarios, injection-safe output and the parity test against the real changelog generator. Wired through `npm run check:breaking`, `AGENTS.md`, `CONTRIBUTING.md` and the pull request template line; its tests run in `npm run test:scripts` in CI. `.github/workflows/breaking-change-guard.yml` (owner decision, option A) runs it with `--enforce` on pull requests into `main`. It is not in `check:gates` or `check:docs`, which cannot supply a range. |
| DEBT-03 | The guard is enforcing where the existing gate conventions allow it without a workflow change; where enforcement needs a change under `.github/workflows/**` it stays report-only and the needed change is recorded for human review | PARTIAL: the record and the workflow are written, enforcement is pending review and merge | The needed change is recorded exactly in `42-02-SUMMARY.md` and applied as the new workflow file after the owner chose option A; the workflow needs a person's review of its exact head before merge (`.github/workflows/**`), so until then the guard is report-only everywhere. D42-1 states what the guard checks, what it proves and the five things it cannot do, states the ENF-04 closure and the CI state. The replay (Observed, 2026-11-18): PR 162's range passes with the marked title or a merge landing and fails with an unmarked title under squash; PR 168's squash commit passes with no signal; the same commit with the template line ticked fails under every landing. The ship flow's own `--enforce` run with the real merge method is user configuration outside the repository and is unconfirmed. |

"Met" for DEBT-02 means the script exists, is tested, is wired into the gate conventions and has its CI workflow written; it does not mean a pull request has been blocked by it. "Closed" for the ENF-04 partial means a process gap closed for pull requests opened after the guard is in force, in the sense D42-1 gives; it is not a claim that PR 168's changes are flagged in the 0.5.x notes (they are not, and are not rewritten).

## Key facts checked

- The header pattern in the guard is the changelog generator's, and the parity test fails if either side changes alone (a scratch edit of the pattern failed 20 of 46 tests).
- Report-only exits 0 on every finding; `--enforce` exits 1 on a violation or an unproven finding; an input error exits 2 in both modes.
- The workflow runs `node scripts/check/breaking-change-guard.mjs --enforce` with no flag and no environment variable from the event. The guard reads the pull request title, body and the base and head commits from the event file when `GITHUB_EVENT_NAME` is `pull_request` (the runner sets both variables), and with no merge method in the event the landing is `unknown`, so the strict rule applies (a marked title and a marked commit). Its triggers are opened, synchronize, reopened and edited; it has `contents: read`, a fork guard, `fetch-depth: 0`, `persist-credentials: false`, Node 22.x, a concurrency group per pull request that cancels in-progress runs, and a 5-minute timeout. The action references are the pinned SHAs `ci.yml` uses.
- The Set B row carries a date, a commit and a Node version, and the evidence page's own guard test keeps rejecting a recorded row without them. A skipped test is not a pass: the 83 skipped tests are outside the passing total.
- No file under `src`, no schema and no default changed in the phase; `ci.yml` is unchanged.

## Residuals and limits

- **The guard cannot see an unmarked, undeclared breaking change.** PR 168 is the observed case: three commits and a title with no marker, no signal, a pass. The guard closes the gap between a declared or marked change and its markers at the merge, not the gap of a change nobody declared. The template line is a person's step.
- **It checks the inputs of the merge, not the merge.** The merge method belongs to the ship flow, and a squash title can be pre-filled or edited at the merge box. The CI check does not know the method and so applies the strict rule to every breaking pull request, including one that will land as a merge commit and would pass the merge rule alone.
- **A red check is read by the ship flow, not enforced by GitHub.** `main` has no branch protection, and the workflow is not part of the `ci.yml` jobs the build job waits for.
- **Open items.** (1) The owner's review of the exact head of the workflow file, as `.github/workflows/**` requires, and its merge. (2) Whether the ship flow runs `node scripts/check/breaking-change-guard.mjs --enforce --base BASE --head HEAD --title TITLE --merge-method METHOD` before every merge (OQ-42-04): not confirmed. (3) The throwaway pull request controls of plan 42-02 Task 4 (red on an unmarked title, green after the title edit, red on a ticked declaration with no marked commit): not run. (4) A follow-up note for PR 168: default no.
- **Set B is one run** on one machine, one Node version (24.18.0) and one day; Set C (the script tests) was not recorded in the window; the skipped tests are inferred, not measured, to be the gated live and integration tests.

## behavior_unverified

1. The guard in CI on a real pull request event: the event file shape, the merge-ref checkout lacking the event's base commit (the guard then fails closed with `range-unavailable`) and the re-run on an edited title are not observed.
2. The ship flow's enforce run: not confirmed to be configured, so no merge has been gated by the guard.
3. The throwaway pull request controls of plan 42-02 Task 4: not run.
4. The grouping of the 83 skipped tests of Set B by reason: kept in the evidence directory, not on the page.


## Re-verification at main 7ae9afc (2026-11-22, autonomous)

Full local suite executed on main 7ae9afc: 5945 tests, 5849 pass, 0 fail, 96 skipped (Podman-gated). Prior verdict (passed) stands; covered files changed only by later merged phases.

_Re-verifier: Omp (main session)_
