---
phase: quick-261108-nci
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .github/workflows/mutation.yml
autonomous: true
requirements: [QR-08]
must_haves:
  truths:
    - "The mutation job's permissions block grants contents: read only; actions: write is gone (D-1308)."
    - "Top-level permissions stays contents: read."
    - "The change is a git cherry-pick -x of 33dd980, so authorship and provenance are preserved."
    - "The diff against the pre-pick tree is exactly one deleted line in .github/workflows/mutation.yml."
  artifacts:
    - .github/workflows/mutation.yml
  key_links:
    - ".github/workflows/mutation.yml job permissions -> contents: read only"
---

<objective>
Drop the unneeded `actions: write` permission from the mutation workflow by cherry-picking PR #47's commit `33dd980` ("ci(mutation): drop unneeded actions write permission") onto the integration lane (QR-08, D-1308). The mutation job makes no GitHub API calls, so it keeps `contents: read` only.

Purpose: least-privilege token for the scheduled mutation job.
Output: one new commit on the current branch carrying exactly a one-line deletion in `.github/workflows/mutation.yml`, plus the quick-task SUMMARY.

Constraints (owner, LOCKED): `.github/workflows/mutation.yml` is the only file in scope, and only that one line. Do not edit CHANGELOG.md, package.json, package-lock.json or `release/**`. `.planning/config.json` has an uncommitted orchestrator change: never stage it. Nothing is merged by this task; the change still needs human review before merge (`.github/workflows/**`).
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@AGENTS.md
@.planning/quick/261108-nci-drop-actions-write-from-the-mutation-wor/261108-nci-CONTEXT.md
@.github/workflows/mutation.yml
</context>

<tasks>

<task type="auto">
  <name>Task 1: Cherry-pick 33dd980 and confirm the one-line result</name>
  <files>.github/workflows/mutation.yml</files>
  <action>
Planning-time facts, re-verified against the tree: `33dd980` exists in the shared object store, touches only `.github/workflows/mutation.yml` with a single deletion (`-      actions: write`, hunk `@@ -21,7 +21,6 @@`), and `.github/workflows/mutation.yml` currently shows `permissions: contents: read` at the top level (line 12-13) and `contents: read` plus `actions: write` under the job's `permissions:` (lines 22-24).

1. Check that nothing is staged: `git diff --cached --name-only` must print nothing. The working tree carries an uncommitted ` M .planning/config.json` and untracked quick-task directories; leave them alone and never `git add` them (no `git add -A`, no `git commit -a`).
2. Run `git cherry-pick -x 33dd980` (QR-08, D-1308). Keep the original author. `-x` appends the "(cherry picked from commit ...)" line. Do not use `--no-commit` and do not edit the message subject.
3. If it conflicts, resolve `.github/workflows/mutation.yml` so the only difference from the pre-pick file is the deletion of the single line `actions: write` under the job's `permissions:`, stage only that file, and `git cherry-pick --continue`. Do not abort, and do not take any other hunk.
4. Confirm the result:
   - `git show --stat HEAD` lists only `.github/workflows/mutation.yml`, `1 deletion(-)`, no insertions.
   - `git show HEAD -- .github/workflows/mutation.yml` shows exactly the removal of `      actions: write` and nothing else.
   - The file's top-level `permissions:` is still `contents: read` and the job `permissions:` holds `contents: read` only (read the permissions blocks in the file).
   - `git status --short` still shows ` M .planning/config.json` unstaged and unchanged by this task.
  </action>
  <verify>
    <automated>git show --stat --format=%s HEAD && git show HEAD --format= -- .github/workflows/mutation.yml && git diff --cached --quiet && ! grep -n "actions: write" .github/workflows/mutation.yml</automated>
  </verify>
  <done>HEAD is a cherry-pick of 33dd980 with a `(cherry picked from commit ...)` trailer; its only change is the one deleted `actions: write` line in `.github/workflows/mutation.yml`; the file has no `actions: write`, top-level `permissions: contents: read`, and job `permissions: contents: read` only; `.planning/config.json` remains unstaged.</done>
</task>

<task type="auto">
  <name>Task 2: Lint the workflow with actionlint (if installed)</name>
  <files>.github/workflows/mutation.yml</files>
  <action>
`actionlint` is installed on this host (`command -v actionlint` resolved at planning time); re-check with `command -v actionlint` and, if it has gone missing, record "actionlint not installed" in the SUMMARY and install nothing.

The workflow runs on the self-hosted label `omega-ci`, which actionlint does not know. Write a temporary actionlint config that declares it, kept OUTSIDE the repository (create it under the system temp directory via `mktemp`, shell variable only; never write that path into any committed or planning file), with content:

```
self-hosted-runner:
  labels:
    - omega-ci
```

Then run `actionlint -config-file "$CFG" .github/workflows/mutation.yml` and delete the temp config afterwards. Report the actionlint exit code and any findings in the SUMMARY. Findings unrelated to the removed line are pre-existing: report them, do not fix them (scope is one line). If the run fails because of the removed line or the permissions block, stop and report.

No file in the repository changes in this task.
  </action>
  <verify>
    <automated>CFG=$(mktemp) && printf 'self-hosted-runner:\n  labels:\n    - omega-ci\n' > "$CFG" && actionlint -config-file "$CFG" .github/workflows/mutation.yml; rc=$?; rm -f "$CFG"; exit $rc</automated>
  </verify>
  <done>actionlint exits 0 on `.github/workflows/mutation.yml` with `omega-ci` declared (or the SUMMARY states actionlint was not installed and nothing was installed); the temp config is removed; no repository file changed.</done>
</task>

<task type="auto">
  <name>Task 3: Run the standard gates and write the SUMMARY</name>
  <files>.github/workflows/mutation.yml</files>
  <action>
Run the repository gates named in AGENTS.md on the resulting tree: `npm run typecheck`, `npm run lint`, `npm run check:gates`. All three must pass; the change is workflow-only, so they are expected to be unaffected. Report any failure verbatim and do not paper over it.

Then write the quick-task SUMMARY (`.planning/quick/261108-nci-drop-actions-write-from-the-mutation-wor/261108-nci-SUMMARY.md`) stating: the cherry-pick commit hash and its `-x` trailer, that the diff is exactly one deleted line, the confirmed permissions blocks, the actionlint result (or that it was not installed), the three gate results, and that the change needs human review before merge because it touches `.github/workflows/**` and that nothing was merged. Use repo-root-relative paths only; no host-local absolute paths (`npm run check:docs` scans `.planning/`). Commit the SUMMARY with the GSD commit flow for quick tasks, staging only the quick-task directory files; never stage `.planning/config.json`, CHANGELOG.md, package files or `release/**`.
  </action>
  <verify>
    <automated>npm run typecheck && npm run lint && npm run check:gates</automated>
  </verify>
  <done>typecheck, lint and check:gates all pass; the SUMMARY exists, records the evidence above, and is committed without staging any file outside the quick-task directory.</done>
</task>

</tasks>

<verification>
- `git show HEAD -- .github/workflows/mutation.yml` is a single-line deletion of `actions: write`.
- The workflow permissions are `contents: read` at top level and on the job; nothing else changed.
- actionlint (with `omega-ci` declared via an out-of-repo config) passes, or its absence is recorded.
- `npm run typecheck`, `npm run lint` and `npm run check:gates` pass.
</verification>

<success_criteria>
`actions: write` is removed from the mutation job via a provenance-preserving `git cherry-pick -x 33dd980`; the diff is exactly one line in `.github/workflows/mutation.yml`; gates are green; `.planning/config.json` was never staged; the SUMMARY notes the human-review requirement.
</success_criteria>

<output>
Create `.planning/quick/261108-nci-drop-actions-write-from-the-mutation-wor/261108-nci-SUMMARY.md` when done
</output>
