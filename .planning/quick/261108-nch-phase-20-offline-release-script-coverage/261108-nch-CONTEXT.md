# Quick task R: Phase 20 offline release-script coverage (REL-03, REL-04)

Specs: `.planning/phases/20-release-pipeline-hardening/20-01-PLAN.md` (tasks L2 and L3), `20-VERIFICATION.md` lines 30-45. Read `scripts/release/changelog.mjs`, `scripts/release/changelog.test.mjs` and the checked-in workflows under `.github/workflows/` (READ ONLY: the rollback workflow and `pages.yml`). Tests run under `npm run test:scripts` (node:test over `scripts/**/*.test.mjs`; Node built-ins only, no dependencies).

## Locked decisions

1. REL-03. The recorded 12 shell cases ran as copies outside the repository. Add `scripts/release/rollback.test.mjs` with two helpers: `readWorkflowRun(workflowText, stepName)` extracts the `run:` block of a named step from the checked-in YAML text without a YAML dependency and fails loudly when the step is missing; `runWorkflowStep(script, env, fixture)` creates a scratch directory, puts fake `git` and `gh` executables first on PATH that append their argv to a record file, runs the extracted block with bash, and returns exit code, stdout, stderr and the recorded calls. Cases: invalid and injected tag input; equal tags; a missing tag; a tag off the default branch (ancestry); a draft, prerelease or missing release; a successful validation that happens BEFORE any mutation; the exact argv `release edit <tag> --prerelease` and `workflow run pages.yml --ref <default> -f source_ref=<docs_tag>`; Pages `source_ref` empty, valid and invalid. Every rejection asserts that no `release edit` and no `workflow run` call was recorded. This proves local shell and argv behaviour only; say so in the file header.
2. REL-04. In `scripts/release/changelog.test.mjs` add `commitStaged(root, subject, body)` (commit a tree the caller already prepared, without rewriting file contents) and fixtures using a real `git mv` rename, a shared file whose surviving feature content stays next to removed content, and a history feature -> canonical `Revert "..."` commit -> revert of that revert. Assert through `generateChangelog()` which entries survive and that the published changelog tail is preserved. Production code (`dropRemoved` in `changelog.mjs`) is believed correct. Change it only if a fixture proves a defect, and say so in the SUMMARY.

## Files in scope

`scripts/release/rollback.test.mjs` (new), `scripts/release/changelog.test.mjs`. Nothing else.

## Execution notes

- Verify with `flock -w 7200 <heavy-slot lock> npm run test:scripts`. Tests use only node:test, node:assert/strict, node:fs, node:child_process, node:os and node:path; scratch directories are removed in t.after.
- Do not edit CHANGELOG.md, package.json, package-lock.json, `.github/**` or `release/**`. `.planning/config.json` has an uncommitted orchestrator change: never stage it.
