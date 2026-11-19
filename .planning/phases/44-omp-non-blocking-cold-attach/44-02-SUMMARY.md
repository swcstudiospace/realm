# 44-02 summary: Omp path change (K1 launch split, K2 deferred attach start)

Executed on the owner's override of the Phase 38 VOID outcome (D-44-01). No live step; no effect is claimed or measured here (plan 44-03 records it).

## Files changed

- New: `src/daemon/launch.ts`, `test/omp/extension-load.test.ts`, `test/omp/attach-window.test.ts`.
- K1 cutover: `src/cli/main.ts` (moved code and its imports removed, no re-export), `src/omp/extension.ts`, `src/daemon/spawn-env.ts` (comment), `test/cli/cli.test.ts`, `test/cli/mcp-attach.test.ts`, `test/daemon/e2e.test.ts`, `test/daemon/launch-runtime.test.ts`, `test/daemon/spawn-env.test.ts`, `test/integration/enforce-default.test.ts`, `test/integration/host-boot-isolation.test.ts`, `test/support/boot-matrix-rig.ts`, `test/support/stdio-world.ts` (import paths only).
- Lint and gate swap: `eslint.config.js`, `scripts/check/gate-closure.mjs`, `scripts/check/gate-closure.test.mjs`.
- K2: `src/omp/plugin.ts` (+9 net lines, 991 to 1000), `src/omp/extension.ts` (`deferStart` set to `setImmediate`), `test/omp/extension.test.ts` (one test added), `test/omp/plugin.test.ts` (two waits, see below).
- Docs: `docs/integration/omp.md`, `docs/integration/runtime-decision.md`.

## Closure numbers (`gateClosure` of the extension entry)

| Measure | Before | After |
| --- | --- | --- |
| `src/omp/extension.ts`, all imports (type-only included, as the gate counts) | 117 | 88 |
| `src/omp/extension.ts`, value imports (what the compiled module loads; planning-time walk said 98 and about 42) | 98 | 43 |
| `src/omp/plugin.ts`, all / value | 66 / 9 | 66 / 9 |
| `src/host/attach.ts`, all / value | 64 / 13 | 64 / 13 |

Value closure of the extension by directory, before: cli 8, doctor 6, mcp 2, acp 2, runtime 24, audit 4, daemon 5, session 5, core 6, host 21, observe 4, fs 3, capability 3, contract 1, omp 4. After: omp 4, daemon 6, runtime 3 (`config-file.ts`, `config.ts`, `host-paths.ts`), session 1, core 5, host 15, observe 4, contract 1, audit 1, fs 3. The only value-closure module importing `node:child_process` after: `src/daemon/launch.ts` (before: `src/cli/main.ts`, `src/doctor/checks.ts`, `src/runtime/session-execution.ts`, `src/runtime/driver/channel.ts`).

Net lines: `src/cli/main.ts` 923 to 842; `src/omp/plugin.ts` 991 to 1000.

## Deviations from the plan as written

1. The closure test uses the value closure, not the all-imports closure. The plan says `gateClosure` "counts a little more"; in fact it also counts `import type`, and `src/daemon/client.ts` has a type-only import of `src/tools/dispatch.ts`, which value-imports `session-execution.ts`. The all-imports closure of the extension, the plugin and `attach.ts` therefore still reaches `session-execution.ts` and the driver after the move, so the plan's assertions could not hold on it. `specifiersOf` and `gateClosure` gained an opt-in `valueOnly` option (default off; the gate and `gateViolations` never set it and still count type-only imports and fail closed). It is covered in `scripts/check/gate-closure.test.mjs`.
2. `eslint.config.js`: besides the swap, `src/daemon/launch.ts` was added to the `process.env` edge exemption (its `startDetachedDaemon` reads `process.env`, moved unchanged; `main.ts` had that right as an entry edge) and `!../daemon/launch.js` was added to the `src/omp` adapter import pattern. The `child_process` and `spawn` allowlists name `launch.ts` in place of `main.ts` and add nothing; `main.ts` now gets the full generic rule set including the spawn rule, and its `node:child_process` pattern exception was dropped.
3. Plan 44-01 is not on `origin/main` (no `44-01-SUMMARY.md`, no method paragraph in `docs/integration/omp.md`); the dated Phase 44 paragraph follows the Phase 38 quiet-host paragraph instead.
4. `docs/integration/runtime-decision.md`: besides the Startup output paragraph, the "daemon log records" and "Directory modes" paragraphs named `src/cli/main.ts` for the moved code and were corrected.
5. `SpawnedProcess` is exported from `launch.ts` but not imported by `main.ts` (unused there); only `SpawnDaemon` is.

## Existing-test edits beyond import paths

`test/omp/plugin.test.ts`, two tests relied on the attach's start being a microtask that has already run when the next step happens: "timers: session shutdown clears the attach budget and the poll, and a late attach is released unpainted" (shutdown right after start) and "onAttach: a superseded attempt reports nothing" (second start right after the first). The start now skips an ended or superseded attempt, so each gained one `await yieldTurn()` after the first start so the first attempt begins before the shutdown or second start. No assertion changed.

## Checks

- `npx tsc -p tsconfig.json`: clean. `npx eslint .`: clean (after fixing two unused parameters in the new test).
- `npm run check:gates`: gate closure 4 modules no violations, module size no violations, export-usage 0 failing and 0 stale, lockfile ok. `npm run check:docs`: ok.
- `node --test scripts/check/gate-closure.test.mjs`: 11 pass.
- Suites (`dist/test/omp`, `host`, `daemon`, `cli`, `quality`, and the enforce-default, host-boot-isolation and omp-guard integration files): 2505 tests; the only two failures were the two tests above before their wait fix; after it `plugin.test` passes 123 of 123, and a final rerun of `dist/test/omp`, `host` and `quality` passes 1811 of 1811 (daemon, cli and the three integration files passed in the full run, with the two failures above as the only ones).
- Non-root: `runuser -u omprunner` with `env -i`: attach-window, extension-load, extension, plugin, launch-runtime, spawn-env and cli tests pass.
- Negative lint check: a scratch `src/omp/scratch-spawn.ts` importing `node:child_process` and calling `spawn` was refused by two rules; a scratch `src/cli/scratch-spawn.ts` calling `spawn` was refused; both removed.
- Mutation check: removing the `isCurrent()` start guard from `plugin.ts` fails the ended-session and superseded-session cases of `attach-window.test.ts`; restored.

## For plan 44-03

The diff between the BEFORE commit and the head of this change must touch only the files listed above (plus this summary). The head commit is recorded by the parent when it commits; this work was left uncommitted.
