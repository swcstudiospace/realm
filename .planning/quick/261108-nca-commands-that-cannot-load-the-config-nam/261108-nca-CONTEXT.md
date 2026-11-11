# QUICK-HINT: a command that cannot load the config says which key is wrong (ONB-04 follow-up)

## Why

Observed on the live host on 2026-11-08. A `config.json` whose `image` was not a digest-pinned reference made `realm up` and `realm status` print only:

`realm status: cannot resolve a state directory (the realm config file under an absolute XDG_CONFIG_HOME or HOME must be present and valid)`

Plan 15-07 fixed this for plain `realm doctor` (it now prints one `runtime-roots` item such as `image is absent or not a digest-pinned reference`, exit 0; verified against the built CLI). The commands an operator runs FIRST (`up`, `status`, `down`, `audit verify`, `checkpoint`) still print the generic text, so the operator cannot tell which key is wrong and is not pointed at `realm doctor`. Plan 15-07 kept those messages "exactly as shipped" to limit its scope; this task is the conservative follow-up. It changes no exit code and no stdout.

## Facts (re-verify the line numbers against the tree before editing)

- The generic text exists in three places: `src/cli/main.ts` (about line 756, the state-directory commands through `runCli`), `src/cli/audit.ts` (about line 34) and `src/cli/checkpoint.ts` (about line 117).
- `src/cli/main.ts` already has `configProblemsOf(raw, readFailed, configPath)` (plan 15-07) that yields value-free phrases: `config.json is absent`, `config.json is not a readable JSON file`, or the key-level phrases from `describeRuntimeConfigProblems` (`src/runtime/config.ts`, plan 15-04). `runCli` already holds `raw` and `readFailed` for the doctor branch.
- Tests pin the shipped text by prefix only: `test/cli/cli.test.ts` about line 957 (`startsWith("realm status: cannot resolve a state directory")`) and `test/cli/audit.test.ts` about line 453 (`/cannot resolve a state directory/`). Keep the shipped sentence as the PREFIX of the new message so every shipped prefix assertion still passes, and do not edit those assertions unless the plan shows a real conflict.
- `process.env` is read only at the entry edges (`src/cli/main.ts` `main`, `src/daemon/main.ts`, `src/omp/extension.ts`, `src/runtime/driver/main.ts`); the CLI modules use `deps.env`.

## Required behaviour

1. For every command that prints the generic text today, keep the exact shipped sentence first, then append the key-level reason, then a fixed pointer. Shape: `<shipped sentence>; <reasons joined by "; ">. Run realm doctor for the full report.` where the reasons are the same phrases the doctor's one-item report uses. When no reason can be derived, append only the pointer.
2. Reasons come from the one place that derives them (`configProblemsOf` and `describeRuntimeConfigProblems`). Do not write a second copy of the derivation. If `audit.ts` and `checkpoint.ts` cannot reach the raw config value without a refactor, move `configProblemsOf` and its helper into a small shared module under `src/cli/` and import it from all three; keep exports minimal.
3. Never print a config VALUE or a path: only the fixed phrases. Add a test per changed command that puts a sentinel string into a bad key's value and asserts the sentinel appears in neither stdout nor stderr.
4. Exit codes (2 for `status`, `up`, `down`, `audit verify`, `checkpoint` as shipped) and stdout are unchanged. The `doctor` output is unchanged.
5. Tests (node:test, behaviour only): for each of the three modules, an invalid config (non-digest image) gives the shipped prefix, the `image is ...` reason and the doctor pointer; an absent config gives `config.json is absent`; a present non-JSON file gives the readable-JSON reason.
6. Docs in the same change only if a doc quotes the old message: `grep -rn "cannot resolve a state directory" docs README.md` returned no match at planning time; re-check.

## Out of scope

`CHANGELOG.md`, `package-lock.json`, `.github/**`, `release/**`, `docs/specs/realm-spec.xml`, `.planning/phases/`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, the doctor itself, and the daemon. Do not touch the live stack.
