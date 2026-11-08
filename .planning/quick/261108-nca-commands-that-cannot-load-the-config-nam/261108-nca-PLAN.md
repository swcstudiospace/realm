---
phase: quick-261108-nca
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/cli/config-problems.ts
  - src/cli/main.ts
  - src/cli/audit.ts
  - src/cli/checkpoint.ts
  - test/cli/config-refusal.test.ts
  - AGENTS.md
autonomous: true
requirements: [ONB-04]
must_haves:
  truths:
    - "realm up, status, down, audit verify (--session or no selector) and checkpoint, run with a config that cannot load, print the shipped sentence, then the key-level reasons, then 'Run realm doctor for the full report.'"
    - "Exit code stays 2 and stdout stays empty for all of them; realm doctor output is unchanged."
    - "No config value and no path appears in stdout or stderr."
    - "The reasons come from configProblemsOf and describeRuntimeConfigProblems, with no second derivation."
  artifacts:
    - src/cli/config-problems.ts
    - test/cli/config-refusal.test.ts
  key_links:
    - "src/cli/main.ts, src/cli/audit.ts and src/cli/checkpoint.ts all import from src/cli/config-problems.ts"
---

<objective>
A command that cannot load the realm config names the failing key and points at `realm doctor` (ONB-04 follow-up).

Purpose: on 2026-11-08 a non-digest `image` made `realm up` and `realm status` print only the generic "cannot resolve a state directory" text. The operator could not tell which key was wrong.
Output: one shared module, three call sites switched to it, one new test file, and a line in the AGENTS.md layout.
</objective>

<context>
@AGENTS.md
@.planning/quick/261108-nca-commands-that-cannot-load-the-config-nam/261108-nca-CONTEXT.md
@src/cli/main.ts
@src/cli/audit.ts
@src/cli/checkpoint.ts
@src/runtime/config.ts

Line numbers below were checked against the tree at planning time. Re-check them before editing.
- `src/cli/main.ts`:
  - imports at lines 14 (`lstatSync`) and 34 (`describeRuntimeConfigProblems`);
  - `configProblemsOf` and `configFileIsAbsent` at lines 514-536;
  - `auditStateDir` at about line 682;
  - the `runAuditCommand(parsed.words, () => auditStateDir(deps))` call at line 714;
  - the generic message in `runCli` at line 756.
- `src/cli/audit.ts`: `NO_STATE_DIR` at line 33, `runAuditCommand` at line 122, its use at lines 135-138.
- `src/cli/checkpoint.ts`: `stateDirOf` at line 99, the generic message at line 117.
- `grep -rn "cannot resolve a state directory" docs README.md` returned no match at planning time, so no doc quotes the old message.
- `test/cli/cli.test.ts:957` and `test/cli/audit.test.ts:453` assert the shipped sentence by prefix or regex only. Keeping that sentence as the prefix leaves them passing, so do not edit them.
- Nothing outside `src/cli/main.ts` calls `runAuditCommand`; the callback signature may change.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Shared config-problem module and the three call sites</name>
  <files>src/cli/config-problems.ts, src/cli/main.ts, src/cli/audit.ts, src/cli/checkpoint.ts</files>
  <behavior>
    - Non-digest image: the message starts with the shipped sentence, then `; image is absent or not a digest-pinned reference. Run realm doctor for the full report.`
    - Absent config file: the reason is `config.json is absent`.
    - Present non-JSON config file: the reason is `config.json is not a readable JSON file`.
    - Several reasons are joined by "; ".
    - No reasons: the shipped sentence, then `. Run realm doctor for the full report.`
  </behavior>
  <action>
Create `src/cli/config-problems.ts`. It is the single home of the derivation, moved out of `main.ts`. It imports `lstatSync` from `node:fs`, `describeRuntimeConfigProblems` and `loadRuntimeConfig` from `../runtime/config.js`, `readRuntimeConfigFile` from `../runtime/config-file.js`, `resolveConfigPath` from `../runtime/host-paths.js`, and `EnvironmentLike` from `../session/paths.js`. It reads no `process.env`; the environment arrives as an argument.

Move these two functions over unchanged: `configProblemsOf(raw, readFailed, configPath)` and its helper `configFileIsAbsent`. Keep the D-1506 comment about "key-level phrases only, never a value, never a path". Keep `configFileIsAbsent` non-exported.

Exports (keep them minimal):
1. `configProblemsOf`, which `runCli` still needs for the doctor branch.
2. `type StateDirOutcome = { readonly stateDir: string } | { readonly problems: readonly string[] }`.
3. `resolveStateDirOutcome(deps: { env: EnvironmentLike; readConfig?: (path: string) => unknown }): StateDirOutcome`. It does what `auditStateDir` and `stateDirOf` do:
   - resolve the path;
   - read the raw value with `deps.readConfig ?? readRuntimeConfigFile`;
   - run `loadRuntimeConfig`;
   - return `{ stateDir }` on success;
   - on any failure, return `{ problems: configProblemsOf(raw, readFailed, configPath) }`, with `readFailed` and `configPath` tracked exactly as `runCli` does at lines 725-733.
4. `noStateDirectoryText(prefix: string, problems: readonly string[]): string`. It returns `` `${prefix}: cannot resolve a state directory (the realm config file under an absolute XDG_CONFIG_HOME or HOME must be present and valid)` ``, then `; ${problems.join("; ")}` when `problems` is non-empty, then `. Run realm doctor for the full report.`. It adds no trailing newline. The shipped sentence is the exact first part, so the prefix assertions in `cli.test.ts` and `audit.test.ts` still hold.

Edit `src/cli/main.ts`:
- Delete the local `configProblemsOf`, `configFileIsAbsent` and `auditStateDir`.
- Import `configProblemsOf`, `noStateDirectoryText` and `resolveStateDirOutcome` from `./config-problems.js`.
- Remove the `lstatSync` import (line 14) and `describeRuntimeConfigProblems` (line 34) if nothing else in the file uses them. `loadRuntimeConfig` stays; `runCli` still calls it.
- At line 756, replace the string literal with `` `${noStateDirectoryText(`realm ${command}`, configProblemsOf(raw, readFailed, configPath))}\n` ``. Exit code 2 and empty stdout stay.
- At line 714, pass `() => resolveStateDirOutcome(deps)`.
- Leave the doctor branch exactly as it is.

Edit `src/cli/audit.ts`:
- Delete `NO_STATE_DIR`.
- Change the `resolveStateDir` parameter type to `() => StateDirOutcome`, importing the type from `./config-problems.js`.
- Update the comment above `runAuditCommand`, which says "returns undefined when the config is absent or invalid".
- At lines 135-138, branch on the outcome. Use `"problems" in outcome` to return `{ exitCode: 2, stdout: "", stderr: `${noStateDirectoryText("realm audit verify", outcome.problems)}\n` }`; otherwise take `outcome.stateDir`.
- `--file` still never reads the config.

Edit `src/cli/checkpoint.ts`:
- Replace `stateDirOf` with a call to `resolveStateDirOutcome(deps)` (`CheckpointDeps` already has `env` and `readConfig`).
- On a `problems` outcome, return exit 2, empty stdout, and stderr `` `${noStateDirectoryText("realm checkpoint", outcome.problems)}\n` ``.
- Otherwise use `outcome.stateDir` as `stateRoot`.
- Remove the `loadRuntimeConfig`, `readRuntimeConfigFile` and `resolveConfigPath` imports if they become unused. Update the comment above the old `stateDirOf`.

Never interpolate `raw`, a path or an error message into any output. Add no suppression comments and no silent catches: the one catch inside `resolveStateDirOutcome` turns a failure into `readFailed` or into the problems result, which is a handled outcome. Add no dependency.
  </action>
  <verify>
    <automated>npm run typecheck && npm run build && node --test dist/test/cli/cli.test.js dist/test/cli/audit.test.js</automated>
  </verify>
  <done>
All three modules import the derivation from `src/cli/config-problems.ts`, and `main.ts` holds no copy. `npm run typecheck` is clean, with no unused import or local. The shipped `cli.test.ts` and `audit.test.ts` pass unedited.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Behaviour tests for the three refusal paths, and the layout line</name>
  <files>test/cli/config-refusal.test.ts, AGENTS.md</files>
  <behavior>
    - For each of `status`, `up --workspace <abs>`, `down`, `audit verify --session <id>`, `audit verify` with no selector, and `checkpoint create --workspace <abs> --id <valid id>`, run through `runCli` with these configs:
      - a config whose `image` is not digest-pinned;
      - an absent config;
      - a present config file holding non-JSON text.
    - Each run gives exit code 2 and empty stdout.
    - The shipped prefix `realm <command words>: cannot resolve a state directory` holds, with the command text as that command prints it: `realm status`, `realm up`, `realm down`, `realm audit verify`, `realm checkpoint`.
    - The non-digest case contains `image is absent or not a digest-pinned reference` and ends with `Run realm doctor for the full report.`
    - The absent case contains `config.json is absent`.
    - The non-JSON case contains `config.json is not a readable JSON file`.
    - Sentinel case: put a sentinel string as the bad key's value, for example the `image` value `SENTINEL-do-not-print@sha256:xyz` in a config whose other keys are valid. Then assert that the sentinel, and the scratch config path, appear in neither stdout nor stderr for each command. Do the same for a non-JSON file whose text contains the sentinel.
  </behavior>
  <action>
Create `test/cli/config-refusal.test.ts` with `node:test`. Assert on observable output only; never read module source text. Follow the layout of `test/cli/audit.test.ts`, which imports `runCli` from `../../src/cli/main.js`.

Write a helper that makes a scratch `XDG_CONFIG_HOME` with `mkdtempSync(join(tmpdir(), "realm-config-refusal-"))`, optionally writes `realm/config.json` with the given text, and removes it in an `after` hook. Build `env` as `{ XDG_CONFIG_HOME: dir }`. Drive the cases by writing a real file, not by injecting `readConfig`. The absent case uses a directory with no `realm/` subdirectory, so the read-failed path and `configFileIsAbsent` run for real. The non-JSON case writes plain text.

Make no daemon dial possible: pass no `connect`, no `spawn` and no `send`. The refusal happens before any of them is used. Use a workspace like `/realm-test-workspace` for `up` and `checkpoint`. Use a checkpoint id that satisfies `isSessionId` in `src/session/paths.ts`, for example `chk-1`; confirm the pattern there. For `audit verify --session` use a session id of the same safe form.

Drive a table of `{ label, argv, prefix }` through the three config cases, so each of the six commands gets every assertion in one loop.

Add a line to the `AGENTS.md` `cli/` bullet in the Layout section: `cli/config-problems.ts`, the shared key-level reasons a command that cannot load the config prints, with a pointer to `realm doctor`. Keep it to one line. Do not touch the other `##` headings. Do not edit `CHANGELOG.md` (the release owns it).
  </action>
  <verify>
    <automated>npm run build && node --test dist/test/cli/config-refusal.test.js dist/test/cli/cli.test.js dist/test/cli/audit.test.js && npm run check:docs</automated>
  </verify>
  <done>
The new test file passes. Each of the six commands has a passing case for the invalid-image, absent-config and non-JSON configs, and a passing sentinel case. `npm run check:docs` is green with the AGENTS.md line. The shipped prefix tests in `cli.test.ts` and `audit.test.ts` still pass unedited.
  </done>
</task>

<task type="auto">
  <name>Task 3: Gates</name>
  <files>src/cli/config-problems.ts</files>
  <action>
Run the three gates and fix anything they report in the files this plan touched. Do not widen scope.

`npm run check:gates` includes the module-size ratchet. `main.ts` shrinks here, but check `scripts/check/module-size-allowlist.json`. If `main.ts` was listed and now sits at or below 1000 lines, the entry must be removed in this change. If it is still listed, lower the ceiling to the re-measured count only when the gate demands it.
  </action>
  <verify>
    <automated>npm run typecheck && npm run lint && npm run check:gates</automated>
  </verify>
  <done>`npm run typecheck`, `npm run lint` and `npm run check:gates` all exit 0.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| config.json to CLI stderr | File contents are untrusted and must never reach the terminal. Only fixed phrases cross. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-nca-01 | Information disclosure | `noStateDirectoryText` and `configProblemsOf` | medium | mitigate | Output is built only from fixed phrases returned by `describeRuntimeConfigProblems` and the two fixed file-state phrases. No raw value, error message or path is interpolated. Task 2's sentinel tests assert this for each command. |
| T-nca-02 | Tampering | exit codes and stdout of the refusal | low | accept | Exit 2 and empty stdout are unchanged, and the tests assert both. |
</threat_model>

<verification>
- The new `test/cli/config-refusal.test.ts` passes, and the shipped `test/cli/cli.test.ts` and `test/cli/audit.test.ts` pass unedited.
- `realm doctor` output is unchanged: the doctor branch in `runCli` is untouched apart from the import source of `configProblemsOf`.
- `npm run typecheck`, `npm run lint` and `npm run check:gates` pass.
</verification>

<success_criteria>
A command that cannot load the config names the failing key and points at `realm doctor`. It keeps exit 2 and empty stdout, and prints no config value or path. The derivation lives in one place.
</success_criteria>

<output>
Create `.planning/quick/261108-nca-commands-that-cannot-load-the-config-nam/261108-nca-SUMMARY.md` when done.
</output>
