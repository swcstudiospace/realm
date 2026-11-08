---
phase: quick-261108-nca
plan: 01
subsystem: cli
tags: [cli, config, refusal, onb-04]
status: complete
requires: [quick-261108-nc8, plan-15-07]
provides: [config-problems-module, key-level-state-directory-refusal]
affects: [src/cli/main.ts, src/cli/audit.ts, src/cli/checkpoint.ts]
key-files:
  created:
    - src/cli/config-problems.ts
    - test/cli/config-refusal.test.ts
  modified:
    - src/cli/main.ts
    - src/cli/audit.ts
    - src/cli/checkpoint.ts
    - AGENTS.md
decisions:
  - "One derivation: configProblemsOf moved to src/cli/config-problems.ts; readConfigOutcome returns the loaded config or the problem list from one read of the file."
  - "The shipped sentence stays the prefix of the refusal, so the existing prefix assertions in cli.test.ts and audit.test.ts pass unedited."
  - "The refusal is built by noStateDirectoryText from fixed phrases only; no config value or path is interpolated."
metrics:
  tasks: 3
  commits: 1
  code_commit: eb056f1
---

# Phase quick-261108-nca Plan 01: Commands that cannot load the config name the key Summary

A command that cannot load the realm config now names the failing key and points at `realm doctor`, while keeping exit 2 and empty stdout.

## What changed

- `src/cli/config-problems.ts` (new): the single home of the key-level reasons. Exports `configProblemsOf`, `readConfigOutcome` (returns `{ config }` or `{ problems }` from one read), and `noStateDirectoryText(prefix, problems)`, which renders `<shipped sentence>; <reasons joined by "; ">. Run realm doctor for the full report.`
- `src/cli/main.ts`: the local `configProblemsOf`, `configFileIsAbsent` and `auditStateDir` are removed. The generic refusal in `runCli` now uses `noStateDirectoryText`. The doctor branch is unchanged. `lstatSync` and `describeRuntimeConfigProblems` imports are dropped.
- `src/cli/audit.ts`: `NO_STATE_DIR` is removed. `runAuditCommand` takes `resolveConfig: () => ConfigOutcome` and refuses with exit 2 and the derived reasons. `--file` still never reads the config.
- `src/cli/checkpoint.ts`: `runtimeConfigOf` is replaced by `readConfigOutcome`. The refusal uses `noStateDirectoryText("realm checkpoint", ...)`. The stale `stateDirOf` reference from the plan was already gone; the intent is unchanged.
- `test/cli/config-refusal.test.ts` (new): six commands (`status`, `up`, `down`, `audit verify --session`, `audit verify`, `checkpoint create`) times three configs (non-digest image, absent file, non-JSON file). Each case asserts exit 2, empty stdout, and the exact stderr. The non-digest and non-JSON texts contain a sentinel value, and each case asserts that neither the sentinel nor the scratch config directory appears in stdout or stderr.
- `AGENTS.md`: one layout line for `cli/config-problems.ts`.

## Docs check

`grep -rn "cannot resolve a state directory" docs README.md AGENTS.md` returned no match, so no doc quoted the old text. `test/cli/cli.test.ts` and `test/cli/audit.test.ts` reference the shipped sentence only as a prefix or regex; they were left unedited and pass.

## Deviations

- Plan named the shared shape `StateDirOutcome` with `stateDir`. Checkpoint needs `config.workspaceRoot` as well, so the shared outcome carries the whole loaded `RuntimeConfig`. Same single-read intent.
- `runCli` keeps its own single read of the config, because the doctor branch needs the raw value. It calls the same `configProblemsOf`.
- The test loop registers tests with `void test(...)`, matching the existing test files; this satisfies `@typescript-eslint/no-floating-promises` without a suppression comment.

## Verification (exit codes)

- `npm run typecheck`: exit 0
- `npm run lint`: first run exit 1 (floating promise in the new test loop, fixed with `void`); second run exit 0
- `npm run check:gates`: exit 0 (gate closure: 4 modules, no violations; module size: 107 files, no violations)
- `npm run build`: exit 0
- `node --test dist/test/cli/config-refusal.test.js dist/test/cli/cli.test.js dist/test/cli/audit.test.js`: exit 0, 97 pass, 0 fail
- `npm run check:docs`: see the completion report

## Commit

- `eb056f1` fix(cli): name the failing config key when a state-directory command cannot load the config
- `.planning/config.json` (owner change) was not staged. Docs artifacts (PLAN, SUMMARY, STATE) are not in the commit.

## Self-Check: PASSED
