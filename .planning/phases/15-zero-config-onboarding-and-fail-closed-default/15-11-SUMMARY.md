---
phase: 15
plan: 11
subsystem: cli
tags: [init, preflight, socket-path, symlink, mode, onboarding, ONB-01]
requires: ["15-10"]
provides:
  - "realm init refuses a state directory whose daemon sockets exceed 107 bytes before any write (src/cli/init.ts:299-311)"
  - "five ONB-01 tests named by the plan are present in test/cli/init.test.ts:567, :587, :602, :613, :624"
affects: [src/cli/init.ts, test/cli/init.test.ts]
key-files:
  modified:
    - src/cli/init.ts
    - test/cli/init.test.ts
requirements: [ONB-01]
status: "code and test titles present at HEAD 5f5b185; no test run recorded; NOT VERIFIED"
---

# Phase 15 Plan 11: realm init preflight and tests (ONB-01) Summary

The socket-path preflight and the five named tests exist in the tree. No evidence records a test run, so no step is marked PASS.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | socket-path preflight and two boundary tests | 0f141fe (no 15-11-named commit) | src/cli/init.ts, test/cli/init.test.ts |
| 2 | symlink, config-inside-workspace, config-dir mode tests | 0f141fe (no 15-11-named commit) | test/cli/init.test.ts |

## What is present (read at HEAD 5f5b185)

- Task 1 action 3: `const UNIX_SOCKET_PATH_MAX_BYTES = 107;` at src/cli/init.ts:236, with the sun_path comment above it.
- Task 1 action 1-2: preflight at init.ts:299-311 derives `controlSocketPath(stateDir)` and the channel control and ssh sockets, then throws `SCHEMA_INVALID` naming the socket and "pass a shorter --state-dir".
- Task 1 tests: init.test.ts:567 (over 107 bytes, refused, nothing written) and :587 (exactly 107 bytes, accepted).
- Task 2 tests: init.test.ts:602 (symlinked workspace, `--workspace must be an existing directory`), :613 (config.json inside workspace), :624 (existing config directory keeps 0755).

## Verification

- Evidence files: none. `/home/realmlive/realm-evidence/phase15/` has no file named `15-11-*`, and no file in it mentions 15-11.
- Git: no commit message names 15-11. The socket check and all five tests first appear in 0f141fe (2026-11-13, phase 15 code commit). Working tree diff touches only 15-VERIFICATION.md.
- `npm run build && node --test dist/test/cli/init.test.js`: NOT RUN (this assignment forbids tests). Result: NOT VERIFIED.
- Acceptance "count of `UNIX_SOCKET_PATH_MAX_BYTES = 107` is 1": the line is seen at init.ts:236; the count was not run. NOT VERIFIED.
- "No existing init test changes its assertions": NOT VERIFIED (no pre-0f141fe diff compared).
- "Test count larger by at least five": five new titles seen; total count NOT VERIFIED.
- Plan truth "refused run leaves no file or directory behind" and the 0600/0700 publish rules: existing tests cited by the plan were not read here. NOT VERIFIED.

## Deviations from plan

1. Arithmetic. PLAN.md Task 1 action 4 says control +17, channel +42, ssh +34, threshold 65 bytes. The comment above init.ts:299 says channel +49, ssh +41, control +17, threshold 58. The code is the shipped behaviour; the plan numbers were not checked against a run.
2. Sandbox name. The plan says the daemon session id is the literal `"daemon"` (cited src/daemon/main.ts:25). That line is the `SIGNALS` constant and holds no such literal. init.ts:299 derives the name with `sessionIdOfWorkspace(realWorkspace)`. Not reconciled here.
3. Boundary tests. The plan sized state directories as fixed 66 and 65 byte strings and guarded on `f.root < 60`. init.test.ts:567 and :587 derive the size from `channelSocketExtraBytes` and guard on `< 40`.
4. channel.ts. The plan says not to change it. Whether 0f141fe left it unchanged is NOT VERIFIED.

## Not verified

- Any pass or fail of the five tests on this host.
- The plan's Done claim that the rules hold on shipped behaviour.
- Plan 15-11 has no live run; no L-series evidence applies.

## Known deviations that do not apply to this plan

omp 18.20.0 versus 18.12.6, the L-C POLICY_DENIED attempt and its retry, the L-C2 config restore, and the P15-O4 driver change belong to other plans and are not part of 15-11.

## Self-Check

NOT RUN.
