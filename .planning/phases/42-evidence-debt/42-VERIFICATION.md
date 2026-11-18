---
phase: 42-evidence-debt
verified: 2026-11-18
verdict: passed
status: passed
score: "3/3 requirements covered (DEBT-01, DEBT-02, DEBT-03): DEBT-01 met (Set B as uid 5002: 5542 tests, 0 failed, 83 skipped); DEBT-02 met as a report-only guard (script, 46 tests, docs; not wired into CI, an owner decision is open); DEBT-03 partial (the record, the replay and the ENF-04 closure are written, nothing enforces in this repository yet, the CI wiring and the ship-flow enforce run are open owner decisions)"
ref: "origin/main 62b85fe (PR 187 cb6e38e, PR 200 9b1697b, PR 203), plus the recording change that carries this file"
behavior_unverified: 3
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
  - "docs/integration/runtime-decision.md"
  - "docs/integration/capability-token-evidence.md"
  - "test/docs/capability-token-evidence.test.ts"
  - "test/runtime/exec-watchdog.test.ts"
---

# Phase 42 Verification: evidence debt

Method: a read of the files above on the recording branch, against the requirement statements DEBT-01 to DEBT-03 in `.planning/REQUIREMENTS.md` and the truths of plans 42-01 to 42-03, on 2026-11-18. The Set B result is copied from the window's evidence (kept outside the repository; this file names no path of it) as reported to the recording task. The replay of the guard on PR 162 and PR 168 was run by the executor of plan 42-02 on local git history. The verifier ran no live step.

What this phase is, stated once: a process and evidence phase. It added a report-only guard for the `!` marker convention, replayed it on the history that produced the ENF-04 partial, wrote the decision record D42-1, and ran the whole unit suite once as a regular user. It changed no file under `src`, no schema, no default and nothing under `.github/workflows`.

## Requirements coverage

| Req | Statement | Status | Evidence |
| --- | --- | --- | --- |
| DEBT-01 | The whole unit suite runs as a non-root user (uid 5002) and the result is recorded (EVID-01 Set B), including any failure as a finding | MET | The Set B row of `docs/integration/capability-token-evidence.md` (EVID-01): commit `62b85fe`, Node v24.18.0, uid 5002 gid 5002, `ptrace_scope` 1, scrubbed environment, 5542 tests, 5459 passed, 0 failed, 83 skipped (counted as not-run). The first run on `d80c79a` is recorded as a finding: 41 stale compiled Anda tests (a stale-build artefact) and 1 test assumption (the exec watchdog BASH_ENV case under a scrubbed environment), fixed in PR 203 and rerun from a clean rebuild with 0 failures. The DEBT-01 paragraph of D42-1 repeats it. |
| DEBT-02 | A script under `scripts/check`, with tests, reports every commit subject in a pull request range that is breaking and lacks the `!` marker, unless the pull request lands as a merge commit; it is wired into the gate conventions of the repository | MET as a report-only guard; CI wiring not done (open item) | `scripts/check/breaking-change-guard.mjs` and its 46 tests (PR 187): the rule matrix, the git-backed scenarios, injection-safe output and the parity test against the real changelog generator. Wired through `npm run check:breaking`, `AGENTS.md`, `CONTRIBUTING.md` and the pull request template line; its tests run in `npm run test:scripts` in CI. It is not in `check:gates` or `check:docs` and no CI job runs it. |
| DEBT-03 | The guard is enforcing where the existing gate conventions allow it without a workflow change; where enforcement needs a change under `.github/workflows/**` it stays report-only and the needed change is recorded for human review | PARTIAL: the record is complete, enforcement exists only through a path outside this repository | The needed change is recorded exactly (options A, B and C, with the workflow text for A) in `42-02-SUMMARY.md`; D42-1 states what the guard checks, what it proves and the five things it cannot do, and states the ENF-04 closure. The replay (Observed, 2026-11-18): PR 162's range passes with the marked title or a merge landing and fails with an unmarked title under squash; PR 168's squash commit passes with no signal; the same commit with the template line ticked fails under every landing. Nothing in this repository enforces: the only enforcing path is the ship flow running `--enforce`, which is user configuration outside the repository and unconfirmed. |

"Met" for DEBT-02 means the script exists, is tested and is wired into the gate conventions as a report; it does not mean a pull request is blocked. "Closed" for the ENF-04 partial means a process gap closed for pull requests opened after the guard, in the sense D42-1 gives; it is not a claim that PR 168's changes are flagged in the 0.5.x notes (they are not, and are not rewritten).

## Key facts checked

- The header pattern in the guard is the changelog generator's, and the parity test fails if either side changes alone (a scratch edit of the pattern failed 20 of 46 tests).
- Report-only exits 0 on every finding; `--enforce` exits 1 on a violation or an unproven finding; an input error exits 2 in both modes.
- The Set B row carries a date, a commit and a Node version, and the evidence page's own guard test keeps rejecting a recorded row without them. A skipped test is not a pass: the 83 skipped tests are outside the passing total.
- No file under `src`, no schema, no default and no file under `.github/workflows` changed in the phase.

## Residuals and limits

- **The guard cannot see an unmarked, undeclared breaking change.** PR 168 is the observed case: three commits and a title with no marker, no signal, a pass. The guard closes the gap between a declared or marked change and its markers at the merge, not the gap of a change nobody declared. The template line is a person's step.
- **It checks the inputs of the merge, not the merge.** The merge method belongs to the ship flow, and a squash title can be pre-filled or edited at the merge box.
- **Report-only is not enforcement, and `main` has no branch protection.** Even a red check would be read by the ship flow, not enforced by GitHub.
- **Open owner decisions** (listed in `42-02-SUMMARY.md`): the CI wiring (option A, a new workflow file, recommended; B, a step in `ci.yml`; C, none), whether the ship flow runs `node scripts/check/breaking-change-guard.mjs --enforce --base BASE --head HEAD --title TITLE --merge-method METHOD` before every merge, and whether PR 168 gets a follow-up note (default no). Until the owner answers, CI does not run the guard.
- **Set B is one run** on one machine, one Node version (24.18.0) and one day; Set C (the script tests) was not recorded in the window; the skipped tests are inferred, not measured, to be the gated live and integration tests.

## behavior_unverified

1. The guard in CI: no workflow runs it, so its behaviour on a real pull request event (the event file shape, the merge-ref checkout lacking the base commit) is not observed.
2. The ship flow's enforce run: not confirmed to be configured, so no merge has been gated by the guard.
3. The grouping of the 83 skipped tests of Set B by reason: kept in the evidence directory, not on the page.
