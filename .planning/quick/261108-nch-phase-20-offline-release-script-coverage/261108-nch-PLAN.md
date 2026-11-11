---
phase: quick-261108-nch
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/release/rollback.test.mjs
  - scripts/release/changelog.test.mjs
autonomous: true
requirements: [REL-03, REL-04]

estimate:
  tokens: 70000
  raw_tokens: 40000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "The checked-in rollback.yml and pages.yml run blocks are executed under bash with fake git and gh, not copies of them"
    - "Every rejected rollback or Pages input records no `release edit` and no `workflow run` call"
    - "A valid rollback records validation calls before `release edit <tag> --prerelease`, then `workflow run pages.yml --ref <default> -f source_ref=<docs_tag>`"
    - "A real git mv rename, a shared file with surviving content, and feature -> Revert -> revert-of-revert histories produce the expected changelog entries, and the published tail is preserved"
  artifacts:
    - path: scripts/release/rollback.test.mjs
      provides: "readWorkflowRun, runWorkflowStep and the REL-03 cases"
    - path: scripts/release/changelog.test.mjs
      provides: "commitStaged and three REL-04 fixtures"
  key_links:
    - from: scripts/release/rollback.test.mjs
      to: .github/workflows/rollback.yml
      via: "readWorkflowRun reads the checked-in YAML text by step name"
    - from: scripts/release/rollback.test.mjs
      to: .github/workflows/pages.yml
      via: "readWorkflowRun extracts the Validate source ref step"
---

<objective>
Offline coverage for two Phase 20 release requirements. REL-03: run the real `run:` blocks of `.github/workflows/rollback.yml` and `.github/workflows/pages.yml` under bash with fake `git` and `gh` executables, so the 12 shell cases recorded as outside-the-repo copies become repository tests. REL-04: add three real-git fixtures for `dropRemoved` in `scripts/release/changelog.mjs` (rename, shared file, revert-of-revert).

Purpose: the phase 20 verification records REL-03 shell validation as run on copies, and REL-04 coverage that lacks rename, mixed-file and revert-of-revert histories.
Output: new `scripts/release/rollback.test.mjs`; extended `scripts/release/changelog.test.mjs`.

Scope is exactly those two files. Do not edit `.github/**`, `release/**`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `AGENTS.md`, `.planning/phases/**`, `.planning/REQUIREMENTS.md` or `.planning/ROADMAP.md`. `.planning/config.json` has an uncommitted orchestrator change: never stage it.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@AGENTS.md
@.planning/quick/261108-nch-phase-20-offline-release-script-coverage/261108-nch-CONTEXT.md
@scripts/release/changelog.mjs
@scripts/release/changelog.test.mjs
@.github/workflows/rollback.yml
@.github/workflows/pages.yml
</context>

<constraints_for_executor>
- Test files use only `node:test`, `node:assert/strict`, `node:fs`, `node:child_process`, `node:os`, `node:path` and `node:url` (for `fileURLToPath`). No dependencies. `eslint.config.js` declares only `console` and `process` as globals for `scripts/**/*.mjs`: do not use `Buffer`, `URL`, `setTimeout` or other globals unimported. No suppression comments.
- Scratch directories come from `mkdtempSync(path.join(os.tmpdir(), ...))`, are pushed into a `tempRoots` array and removed in `afterEach`, as `changelog.test.mjs` already does. Every `spawnSync`/`execFileSync` call carries a `timeout`.
- No host-local absolute path literals in any committed file or in `.planning/` (`npm run check:docs`).
- Tests assert observable behaviour only (exit code, stdout, stderr, recorded argv, files on disk, generated changelog text). No assertions on the text of the workflow files beyond locating a step by name.
- Heavy commands run under the host lock from the executor's own notes.
</constraints_for_executor>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: REL-03 rollback and Pages shell cases in scripts/release/rollback.test.mjs</name>
  <files>scripts/release/rollback.test.mjs</files>
  <behavior>
    - readWorkflowRun throws when the step is missing, when the name matches more than one step, when the step has no block `run: |`, or when the extracted block contains the literal `${{` (GitHub would have expanded it; running it raw would not be the workflow's behaviour).
    - A valid rollback sequence exits 0 and records the validation calls, then `gh release edit v0.3.4 --prerelease`, then `gh workflow run pages.yml --ref main -f source_ref=v0.3.3`, in that order.
    - Every rejection exits non-zero and records no `gh release edit` and no `gh workflow run`.
  </behavior>
  <action>
Create `scripts/release/rollback.test.mjs`. Header comment states plainly: this proves local shell and argv behaviour only, against the checked-in workflow text with fake `git` and `gh`; it does not prove GitHub executes the workflow, that `gh release view --jq` evaluates the expression, or that a rollback or Pages deployment works (those stay owner-gated, L4). Per REL-03 in `.planning/phases/20-release-pipeline-hardening/20-VERIFICATION.md`.

Helpers (names fixed by the locked decision):

1. `readWorkflowRun(workflowText, stepName)`: no YAML dependency. Split into lines; find lines whose trimmed text equals `- name: <stepName>`; throw naming the step when zero or more than one. The step spans from that line to the next line that starts with the same indent followed by `- ` (or end of file). Inside it, find the `run: |` line; throw if absent. The block is the following lines indented deeper than the `run:` line (blank lines kept), dedented by the first block line's indent, joined with newlines. Throw if the result contains `${{`. Workflow files are read once with `readFileSync` from `.github/workflows/` resolved relative to `import.meta.url` via `fileURLToPath` (path.resolve of the test directory, `..`, `..`).

2. `runWorkflowStep(script, env, fixture)`: create a scratch directory (tracked in `tempRoots`), a `bin` subdirectory and a `record` file. Write executable (mode 0o755) `#!/bin/bash` scripts `bin/git` and `bin/gh`. Each appends one line to the record file: the tool name, then every argv element, joined by the unit separator `\x1f` (use `IFS=$'\x1f'` with `"$*"`), so quoting and injection are observable exactly. Behaviour is driven by fixture fields passed as `FAKE_*` environment variables, with defaults for the success path:
   - `git fetch ...`: exit 0.
   - `git rev-parse --verify --quiet refs/tags/<tag>^{commit}`: print a fixed 40-hex sha and exit 0, or exit 1 with no output when `fixture.tagMissing`.
   - `git merge-base --is-ancestor ...`: exit 0, or exit 1 when `fixture.ancestor === false`.
   - `gh release view <tag> --json ... --jq ...`: print the fixture release state label (`published`, `draft` or `prerelease`, default `published`) and exit 0; for `fixture.release === 'missing'` print `release not found` to stderr and exit 1.
   - `gh release edit` and `gh workflow run`: exit 0.
   - any other argv: record it, print `unexpected fake call` to stderr and exit 99, so a call the workflow was not expected to make fails loudly.
   Run with `spawnSync('bash', ['-c', script], { cwd: scratch, env, encoding: 'utf8', timeout: 30000 })`, where `env` is only `PATH` (`bin` first, then `process.env.PATH`), the caller's `env` entries and the `FAKE_*` entries; do not inherit the rest of the process environment (no real GH_TOKEN). Return `{ status, stdout, stderr, calls, scratch }` where `calls` is the record file parsed into arrays of argv (tool name first).

3. A `rollbackSequence()` helper concatenates, in workflow order, the extracted blocks of the four `rollback.yml` steps: `Validate tags`, `Validate the known-good documentation source`, `Mark release as prerelease`, `Dispatch Pages for the known-good tag`. One bash process runs them so an early failure stops later steps exactly as a failed job step does, and the record shows true ordering. Default env: `TAG=v0.3.4`, `DOCS_TAG=v0.3.3`, `DEFAULT_BRANCH=main`, `GH_TOKEN=fake`, `GH_REPO=owner/repo`. An `assertNoMutation(calls)` helper fails when any recorded call is `gh release edit ...` or `gh workflow run ...`.

Cases (use `test()` with table-driven loops where several inputs share an expectation):
- Success: status 0; ordered calls are `git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main`, `git fetch --no-tags origin +refs/tags/v0.3.3:refs/tags/v0.3.3`, the `rev-parse`, the `merge-base --is-ancestor <sha> refs/remotes/origin/main`, `gh release view v0.3.3 --json isDraft,isPrerelease --jq <expression>` (assert the first four argv elements; do not assert the jq text), then exactly `gh release edit v0.3.4 --prerelease`, then exactly `gh workflow run pages.yml --ref main -f source_ref=v0.3.3`. Assert the index of `release edit` is greater than the index of every validation call (validation before any mutation). Repeat with `DEFAULT_BRANCH=trunk` to show the ref and fetch refspec follow the input.
- Invalid `TAG` and invalid `DOCS_TAG` (separate loops): empty string, `v1.2`, `1.2.3`, `v1.2.3-rc1`, `v1.2.3 `, a newline-joined `v1.2.3\nv1.2.4`, `v1.2.3; touch injected`, `$(touch injected)`, and a backtick form. Each: non-zero status, stderr contains `::error::` and names the input (`The tag input` / `The docs_tag input`), no `injected` file in the scratch directory, `assertNoMutation`, and no `git` or `gh` call at all (the format check precedes every command).
- Equal tags (`TAG` equals `DOCS_TAG`): non-zero, stderr contains `must name a different release`, no calls.
- Missing tag (`tagMissing`): non-zero, stderr contains `does not exist`, no `merge-base` and no `gh release view` recorded, `assertNoMutation`.
- Tag off the default branch (`ancestor: false`): non-zero, stderr contains `not on the default branch`, no `gh release view` recorded, `assertNoMutation`.
- Release `draft`, `prerelease`, `missing`: non-zero; for the first two stderr contains `is draft` / `is prerelease`; for `missing` just non-zero and no mutation. `assertNoMutation` each.
- Per-step argv, run on their own so the argv is exact when the mutation steps run alone: `Mark release as prerelease` with `TAG=v0.3.4` records exactly `[['gh','release','edit','v0.3.4','--prerelease']]`; `Dispatch Pages for the known-good tag` records exactly `[['gh','workflow','run','pages.yml','--ref','main','-f','source_ref=v0.3.3']]`.
- `pages.yml` step `Validate source ref` with `SOURCE_REF`: empty string and `v0.3.3` exit 0 with no calls; invalid values (`main`, `v1.2`, `refs/heads/main`, `v1.2.3/../x`, `v1.2.3 `, `v1.2.3$(touch injected)`, `v1.2.3; touch injected`) exit non-zero, stderr contains `source_ref must be empty or match`, no `injected` file, no calls.
- readWorkflowRun guard cases: unknown step name throws; a synthetic workflow text with a block containing `${{` throws; a synthetic text with a duplicated step name throws.

If a case exposes a real defect in a workflow file (as opposed to a wrong fixture or expectation, which you fix in the test), do not edit `.github/**` (out of scope) and do not weaken the assertion: stop, and report the failing case, input and observed output to the orchestrator in the final result.
  </action>
  <verify>
    <automated>node --test scripts/release/rollback.test.mjs</automated>
  </verify>
  <done>`scripts/release/rollback.test.mjs` exists with the two helpers, the header limitation note, every case above, and passes; every rejection case asserts no `release edit` and no `workflow run` call; the file imports only Node built-ins.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: REL-04 commitStaged and rename, shared-file and revert-of-revert fixtures in scripts/release/changelog.test.mjs</name>
  <files>scripts/release/changelog.test.mjs</files>
  <behavior>
    - Rename fixture: a real `git mv` of a removed feature's file keeps the rename refactor and drops the feature and its removal.
    - Shared-file fixture: a removal that edits only the removed feature's lines in a file also holding another feature keeps the other feature and drops the removed one and the removal.
    - Revert chain fixture: feature -> real `git revert` -> real `git revert` of that revert keeps the feature exactly once.
    - In all three the published tail (`SEED_TAIL`) is preserved verbatim at the end of `CHANGELOG.md`.
  </behavior>
  <action>
Edit `scripts/release/changelog.test.mjs` only; leave all 26 existing tests passing and unchanged in behaviour.

1. Add `commitStaged(cwd, subject, body)`: commits whatever the caller already staged, with the same identity and `commit.gpgsign=false` `-c` options as `commit()` and the same `-m subject [-m body]` handling, returns `git rev-parse HEAD` trimmed. It never writes or re-adds files, so a `git mv` or `git rm` stays a real rename or deletion. Refactor `commit()` to write its counter file, run `git add -A`, then call `commitStaged` (keep its signature and return value; the existing tests must not change). Add a small `IDENTITY` constant of the `-c` options if it avoids repeating them for `git revert`.

2. Add `assertTailPreserved(root)`: asserts `readChangelog(root).endsWith(`\n${SEED_TAIL}`)` with message `published sections must stay unchanged`, and that exactly one `## [Unreleased]` line exists.

3. Fixture A, test `keeps a real git mv rename of a removed feature's module and drops the feature and its removal`: `makeRepo([])`; `feature = commit(root, 'feat: add driver', 'driver.txt')`; `git mv driver.txt renamed.txt`; `rename = commitStaged(root, 'refactor: rename driver module')`; assert via `git show --name-status -M --format= <rename>` that the output matches `/^R\d+\tdriver\.txt\trenamed\.txt$/m` (proves a real rename, not a new file); `git rm -q renamed.txt`; `commitStaged(root, 'refactor: drop driver', `Removes: ${feature}`)`; run `generateChangelog` for `0.2.0` / `2026-10-29`; expect the section body, normalized, to equal `### Changed\n- refactor: rename driver module (SHA)` and `assertTailPreserved`.

4. Fixture B, test `keeps the surviving feature in a shared file when the removal edits only the removed lines`: `makeRepo([])`; write `shared.txt` as `driver: on\n`, `git add shared.txt`, `driverSha = commitStaged(root, 'feat: add driver')`; append `exporter: on\n`, add, `commitStaged(root, 'feat: add exporter')`; rewrite the file to `exporter: on\n`, add, `commitStaged(root, 'refactor: drop driver', `Removes: ${driverSha}`)`. Assert the file on disk is `exporter: on\n` and that `git show --name-status --format= HEAD` is `M\tshared.txt` (a modification, not a deletion). Expect the section body, normalized, to equal `### Added\n- feat: add exporter (SHA)` and `assertTailPreserved`.

5. Fixture C, test `keeps a feature after a canonical revert and the revert of that revert`: `makeRepo([])`, then stage and commit the seed changelog first so a revert cannot delete it: `git add CHANGELOG.md` and `commitStaged(root, 'chore(release): v0.1.9 [skip ci]')`. Then `feature = commit(root, 'feat: add driver', 'driver.txt')`; `git revert --no-edit <feature>` with the identity options (real canonical `Revert "feat: add driver"` message with `This reverts commit <sha>.`); read its sha, then `git revert --no-edit <that sha>` (subject `Revert "Revert "feat: add driver""`). Assert the two subjects start with `Revert "` via `git log --format=%s -n 2`. Run `generateChangelog` for `0.2.0`; expect the section body, normalized, to equal `### Added\n- feat: add driver (SHA)` (the feature survives once, neither revert listed) and `assertTailPreserved`. Add a companion assertion in the same test, run on a second `makeRepo`-built history that stops after the first revert, that the feature and its revert are both absent (body is the no-changes placeholder the generator writes; read that placeholder text from the existing test `writes the no-changes placeholder under Changed when only release commits exist` rather than guessing it).

`dropRemoved`/`dropReverted` in `scripts/release/changelog.mjs` are believed correct. Do not edit `changelog.mjs` unless a fixture above fails for a reason that proves a defect in it; then fix only that defect, keep the fix minimal, and state the fixture, the observed output and the change in the SUMMARY. A fixture that fails because the fixture itself is wrong is fixed in the test.
  </action>
  <verify>
    <automated>node --test scripts/release/changelog.test.mjs</automated>
  </verify>
  <done>`commitStaged` exists and `commit()` delegates to it; the three new tests pass together with the 26 existing ones; each new test asserts which entries survive and that the published changelog tail is preserved; `scripts/release/changelog.mjs` is unchanged unless the SUMMARY names a proven defect.</done>
</task>

<task type="auto">
  <name>Task 3: Run the script suite and the repository gates</name>
  <files></files>
  <action>
No file changes. Run the commands below, fix failures inside the two in-scope test files only, and record the results in the SUMMARY. If a gate fails for a reason outside the two files, report it rather than editing out-of-scope files. Stage only `scripts/release/rollback.test.mjs` and `scripts/release/changelog.test.mjs` (and `scripts/release/changelog.mjs` only if Task 2 proved a defect); never stage `.planning/config.json`. Commit subject: `test(release): cover rollback shell steps and changelog removal fixtures` (Conventional Commit type `test`).
  </action>
  <verify>
    <automated>npm run test:scripts && npm run typecheck && npm run lint && npm run check:gates</automated>
  </verify>
  <done>`npm run test:scripts`, `npm run typecheck`, `npm run lint` and `npm run check:gates` all exit 0, and `git status` shows no staged file outside the allowed set.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| test process -> bash | Extracted workflow `run:` blocks execute locally with attacker-shaped input strings |
| test process -> PATH | Fake `git` and `gh` shadow real binaries |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-nch-01 | Tampering | runWorkflowStep | medium | mitigate | Child env is built from `PATH` plus fixture values only (no inherited `GH_TOKEN`), cwd is a scratch directory, fake `gh` and `git` make no network call, and unexpected argv exits 99. Injection inputs only `touch` a name inside the scratch directory, which the test asserts does not exist and then removes. |
| T-nch-02 | Information disclosure | scratch directories | low | mitigate | Removed in `afterEach`; no secrets are written. |
| T-nch-03 | Repudiation | claims of coverage | low | mitigate | Header comment and SUMMARY state this is local shell and argv evidence only; REL-03 live proof stays L4. |
| T-nch-SC | Tampering | npm installs | n/a | accept | No package is installed or added. |
</threat_model>

<verification>
Final step: `npm run typecheck`, `npm run lint` and `npm run check:gates` (run with `npm run test:scripts` as in Task 3). Confirm the diff touches only the allowed files and that no `/root`, `/home`, `/tmp` or `/Users` literal appears in them.
</verification>

<success_criteria>
- `scripts/release/rollback.test.mjs` runs the checked-in `rollback.yml` and `pages.yml` blocks with fake `git` and `gh` and covers: invalid and injected tags, equal tags, missing tag, off-branch tag, draft/prerelease/missing release, validation before mutation, exact `release edit` and `workflow run` argv, and Pages `source_ref` empty, valid and invalid; every rejection records no mutation call.
- `scripts/release/changelog.test.mjs` has `commitStaged` and the rename, shared-file and revert-of-revert fixtures, each asserting surviving entries and the preserved published tail.
- All four gates pass; production code unchanged unless a fixture proved a defect, which the SUMMARY states.
</success_criteria>

<output>
Create `.planning/quick/261108-nch-phase-20-offline-release-script-coverage/261108-nch-SUMMARY.md` when done.
</output>
