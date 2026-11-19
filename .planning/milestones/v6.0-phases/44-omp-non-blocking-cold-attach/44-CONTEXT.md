# Phase 44: Omp non-blocking cold attach (owner-directed from loaded-host evidence) - Context

**Gathered:** 2026-11-19, from the owner decision relayed by Main (HITL 2026-11-18/19), `.planning/phases/38-omp-responsiveness-during-cold-attach/38-MEASUREMENT.md` and `38-VERIFICATION.md` (the quiet-host window of 2026-11-18 23:32 UTC to 2026-11-19 01:18 UTC, outcome VOID), the conditional plans `38-02-PLAN.md` and `38-03-PLAN.md` (never executed), `38-CONTEXT.md` (D-38-01 to D-38-10, E-38-01 to E-38-12), `.planning/MILESTONE-CONTEXT.md` (D-v6-2), and a fresh read of the branch `gsd/phase-44-plan` at origin/main `d2edfe7` (v0.6.4): `src/omp/extension.ts` (159 lines), `src/omp/plugin.ts` (991 lines), `src/cli/main.ts` (923 lines), `src/daemon/ensure.ts`, `src/daemon/node-runtime.ts`, `src/daemon/spawn-env.ts`, `src/host/attach.ts`, `eslint.config.js`, `scripts/check/gate-closure.mjs`, `test/integration/omp-responsiveness.test.ts` (530 lines), `test/support/responsiveness.ts`, `test/support/responsiveness-decision.ts`, `test/support/omp-rpc.ts`, `test/omp/plugin.test.ts`, `test/omp/extension.test.ts`, `docs/integration/omp.md`.
**Status:** Planned (three plans, nothing executed). Requirement ids OMPR-04 to OMPR-06 are defined in this file and are NOT yet in `.planning/REQUIREMENTS.md`; the orchestrator registers them from the section "Text for the orchestrator" below. This phase does not edit ROADMAP, STATE or REQUIREMENTS.
**Format and depth:** the v5.0 and v6.0 phases (CONTEXT with decisions and open questions, plans with frontmatter, threat model per plan, blocking-human live window with the owner authorization of 2026-11-18).

<domain>
## Phase Boundary

The Omp extension path is changed so that Omp's event loop is free for as much of the cold attach as the extension controls, the harness that measures it is corrected where the Phase 38 evidence supports a correction, and the effect of the change is measured by a paired before/after comparison on the loaded host that is all this machine offers, labelled `loaded, paired` and never cited as a quiet-host measurement.

This is the owner's decision of 2026-11-18/19 (D-44-01 below): the Phase 38 quiet-host window ended `VOID` under its frozen rule (one valid run in six attempts, case `serving-stall`), and the owner chose to take that single valid run together with the loaded runs of Phase 36 as sufficient evidence to plan the fix now. Phase 38's outcome is not relabelled. OMPR-01 (three valid quiet-host runs) stays unmet. OI-11 stays Carried; Phase 44 does not close it.

Three changes and one proof:

1. **Harness correction (OMPR-04).** The cold-attach verdict window starts at Omp's `ready` frame, not at process start, with the thresholds and `responsivenessProblems` unchanged; a control-relative comparison and the host's CPU pressure are recorded as a labelled secondary measure; the baseline instability found in the window (D-44-03) is recorded as a finding; the attribution of the one valid run is written down with its evidence tiers.
2. **Omp path change (OMPR-05).** K1: the daemon-launch functions move out of `src/cli/main.ts` into `src/daemon/launch.ts`, so the extension's static import closure shrinks from about 98 modules to about 42 (the CLI, doctor, MCP, ACP, runtime driver and session-execution modules leave it). K2: the attach starts one event-loop turn after the session handler returns, through an injected deferral, with an `isCurrent()` guard. Fail closed, the not-active refusal, the status vocabulary and the audit lines are unchanged, shown by an attach-window test and the unedited Omp suites.
3. **Paired loaded re-proof (OMPR-06).** At least five valid pairs of the before build and the changed build, interleaved, each arm with its own no-extension control in the same test, a frozen rule written as code before the first run, and a blocking-human live window (realmlive account, shared lock, residue checks, evidence outside the repository).

### Out of scope, stated so no task drifts into it

- Closing OI-11, satisfying OMPR-01, or any statement that a quiet-host measurement was made. UI-01 (the owner's call, Phase 27 D-27-08).
- Editing a threshold (1000 ms, 500 ms, 40 probes, 10 s, 0.5 load per CPU, 250 ms probe interval), `responsivenessProblems`, or the constants and tables of `test/support/responsiveness-decision.ts` that Phase 38 froze. They stay valid for any future quiet-host window; the harness correction of D-44-03 changes which samples that window reads, not what it demands.
- Reordering `setHostMode`, lowering process priority of the daemon or its children, a worker thread or second process for the attach, a dynamic `import()` of the CLI at spawn time (all rejected in `38-CONTEXT.md` D-38-05; unchanged).
- Anything that runs before a session is ready (no mutation, no tool call reaches the daemon before a client is adopted).
- A third arm (K1 only), a quiet-host window, any model-driven tool call, FS-02, TD-06, TD-10, the product spec, `CHANGELOG.md`, version fields, `release/milestone.json`, Phases 39 to 43.
</domain>

<decisions>
## Implementation Decisions

### Evidence (every fact below: source, read date 2026-11-19, tier)

Tiers: **Observed** = read in this worktree today; **Measured** = recorded by an earlier live run and cited from `38-MEASUREMENT.md` or the Phase 36 ledger; **Derived** = arithmetic on Measured numbers; **[INFERENCE]** = reasoning from those, to be proven or refuted by a named task. Every Measured number carries its load label: all of the Phase 38 numbers except attempt 1 were taken on hosts that were not quiet at some reading or whose baseline failed.

| ID | Fact | Source | Tier |
| --- | --- | --- | --- |
| E-44-01 | The Phase 38 window ended `VOID`: six attempts, one valid. Attempt 1 read quiet at both readings (0.25 and 0.16 load per CPU), baseline passed, no daemon at the start, `realm active` reached, control answered; case `serving-stall`. The other five attempts were invalid (host not quiet at a later reading, or the in-test baseline failed its bounds). Residue after every attempt: containers 0, sandboxes 0, workspace entries 0, daemons 0. | `38-MEASUREMENT.md` | Measured |
| E-44-02 | Attempt 1, cold attach: 151 probes, 141 answered, 10 unanswered, window 37 500 ms, maximum 9906 ms, median 201 ms, 95th percentile 8213 ms, longest gap 12 498 ms. Omp ready at 11 320 ms from process start; first realm status paint at 11 396 ms; first answered probe at 12 498 ms; last realm status paint and `realm active` at 37 804 ms. Serving verdict (probes sent at or after the first answer): maximum 1403 ms, 95th percentile 705 ms. Control of the same attempt (Omp with no extension): ready at 8999 ms, first answer at 9394 ms. Boot excess 3104 ms. Loads (one minute, 8 CPUs): 1.99, 1.43, 1.31 before the baseline, after it and before the session; 26.35 after the session. | `38-MEASUREMENT.md` attempt 1 | Measured (quiet readings, one run) |
| E-44-03 | The first answer is the probe sent at 2592 ms answered after 9906 ms (2592 + 9906 = 12 498). The ten unanswered probes were sent at 0 to 2292 ms; each times out 10 000 ms after its send, before 12 498 ms. Probes sent after 2592 ms were answered in a burst from 12 498 ms on. After the first answer the latencies fall with the probe interval (1403, 1110, 890, 614, 416 ms, then 14 ms for the probe sent at 13 903 ms): a stall that ends at about 13 900 ms. | `38-MEASUREMENT.md` attempt 1, samples reading | Measured |
| E-44-04 | The boot excess splits by the frame times (frame times are taken from the session's construction, a few milliseconds after the probe loop origin). Before ready: cold ready 11 320 minus control ready 8999 is 2321 ms. After ready: the first answer came 12 498 - 11 320 = 1178 ms after ready in the cold run against 9394 - 8999 = 395 ms in the control, an excess of 783 ms. 2321 + 783 = 3104 ms, the recorded boot excess. | arithmetic on E-44-02 | Derived |
| E-44-05 | Of the 3104 ms excess, about 2.3 s lies before Omp's `ready` frame (the extension's load runs before ready) and about 0.8 s lies between the first realm status paint (76 ms after ready) and the first answered probe. The first realm status paint is the `connecting` paint of `beginSession`, i.e. the extension's `session_start` handler had already run; the 1.1 s after it is the span in which Omp had not yet started answering. [INFERENCE] One run on a host with one-minute load 1.3 to 2.0 cannot say how much of either component is the extension and how much is run-to-run variation of Omp's own boot (the four controls ranged 9394 to 15 396 ms to first answer, a spread larger than the excess). The paired design of D-44-06 exists to separate them. | E-44-02, E-44-03, E-44-04, E-44-08 | [INFERENCE] |
| E-44-06 | Corrected window on the recorded numbers: probes are sent every 250 ms from process start; the first probe tick at or after ready (11 320 ms) is at 11 500 ms, answered at 12 498 ms (latency 998 ms); the probe at 12 499 ms was answered after 1403 ms. So the corrected window (from ready) still holds a latency over 1000 ms: the corrected verdict for attempt 1 is not a pass; the stall that the harness correction cannot remove runs from about 12.5 s to 13.9 s and is inside the window under either definition. Not recomputed from the samples file (kept outside the repository). | arithmetic on E-44-02, E-44-03 | Derived |
| E-44-07 | Loaded host, Phase 36 run 4 (load 8.16 to 11.54 on 8 CPUs, labelled loaded): 97 probes over 24 001 ms, 6 unanswered, maximum 9868 ms, median 18 ms, 95th percentile 8910 ms, longest gap 11 369 ms, `realm active` reached. The same shape as attempt 1: no answer for about 11 s from process start, then a burst. | `36-DISPOSITIONS.md` OI-11, `38-CONTEXT.md` E-38-07, E-38-08 | Measured (loaded host, labelled) |
| E-44-08 | Controls with no extension, probed from process start: first answers at 9394, 15 396, 10 616 and 10 892 ms, ready frames at 8999, 13 011, 10 121 and 10 076 ms (four of four). A window that starts at process start contains 9 to 15 s of Omp's own boot on this host, and every probe sent in it is unanswerable by Omp whatever the extension does. | `38-MEASUREMENT.md` controls | Measured |
| E-44-09 | The in-test baseline (Omp with no extension, probed after ready for 10 s) missed its bounds in five of nine runs at 0.17 to 0.36 load per CPU: 95th percentile 1001, 512, 599, 791 and 1312 ms (all over the 500 ms bound), maxima up to 1587 ms (over the 1000 ms bound in two). The cause is not established. At planning time the host's CPU pressure stall information (`/proc/pressure/cpu`, "some" line) reads avg10 47.90, avg60 32.01, avg300 36.53, with a load average of 11.5 on 8 CPUs. [INFERENCE] The load average per CPU does not describe the contention Omp sees on this shared host: PSI shows runnable pressure at times when the load average per CPU is low. | `38-MEASUREMENT.md` observations; `/proc/pressure/cpu` and `/proc/loadavg` read today | Measured; Observed |
| E-44-10 | Static import closure of `src/omp/extension.ts`: 98 modules by a regex walk of value imports (type-only imports excluded), of which 44 lie in `src/cli`, `src/doctor`, `src/mcp`, `src/acp`, `src/runtime` and `src/audit`. Reached only because `src/omp/extension.ts` line 16 imports `startDetachedDaemon` from `../cli/main.js`. With the launch functions in `src/daemon/launch.ts` (their value imports are `node:child_process`, `node:fs`, `../core/errors.js`, `./node-runtime.js`, `./spawn-env.js` and `./ensure.js`) the closure is about 42 modules: none under `src/cli`, `src/doctor`, `src/mcp` or `src/acp`, and under `src/runtime` only `host-paths.ts`, `config-file.ts` and `config.ts`, plus `src/audit/redact.ts`. The exact count is taken by plan 44-02 Task 1 with `gateClosure`. | walk over the worktree, 2026-11-19; `src/omp/extension.ts`, `src/daemon/ensure.ts` | Observed (approximate counts) |
| E-44-11 | The Omp hooks are detached and the synchronous work of the attach is small (E-38-01 to E-38-03, re-read: `beginSession` at line 692 of `src/omp/plugin.ts` calls `runDetached(session, attachAndReport(session))` or `attachCycle(session)`; the attach starts from a resolved promise at line 449 to 450; no `Atomics.wait`, `execSync` or `spawnSync` in the Omp, attach, client or ensure code). The extension's own synchronous work at load is `readHostRuntime` (one config file read), `packageVersion` (one `package.json` read, memoized), `resolveBoot`, `parseHostPluginManifest`, `createBootObserver`, `createLogger`. | `src/omp/plugin.ts`, `src/omp/extension.ts` | Observed |
| E-44-12 | `createRealmPlugin` has seven callers: `src/omp/extension.ts` and, in tests, `test/omp/boot-conformance.test.ts`, `test/omp/host-tools.test.ts` (three calls), `test/omp/plugin.test.ts` (line 407 through `pluginOptions`, line 2629), `test/support/omp-boot-hook.ts`. `reattach` is already an optional option whose absence keeps the old behavior (`src/omp/plugin.ts` lines 105 to 107). `plugin.ts` reads no environment; it already writes to `process.stderr` in one fallback. No file under `src` uses `setImmediate` or `queueMicrotask`. | grep, 2026-11-19 | Observed |
| E-44-13 | `src/cli/main.ts` holds the launch code at lines 165 to 177 (`SpawnedProcess`, `SpawnDaemon`), 285 to 293 (`defaultSpawnDaemon`), 396 to 410 (`withDaemonLog`), 425 to 431 (`spawnDetachedDaemon`, which stays: it reads `ResolvedDeps`), 434 to 459 (`launchFilteredDaemon`) and 463 to 465 (`startDetachedDaemon`). Nine test and support files import `SpawnDaemon`, `launchFilteredDaemon` or `startDetachedDaemon` from `src/cli/main.js` (listed in D-44-04), one comment in `src/daemon/spawn-env.ts` and one paragraph of `docs/integration/runtime-decision.md` name them. The lint invariant that only named modules call `spawn(` and import `node:child_process` is in `eslint.config.js` lines 15 to 36 (`CHILD_PROCESS_ALLOWED`, `SPECIAL_SRC`, `SPAWN_MESSAGE`), line 122 (the import message), the per-file blocks at lines 245 and 360 (the `src/cli/main.ts` blocks, the first of which omits the spawn rule), and the gate-module pattern group (`../cli/main*`). `scripts/check/gate-closure.mjs` line 21 lists `src/cli/main.ts` in `FORBIDDEN_MODULES`. | `src/cli/main.ts`, `eslint.config.js`, `scripts/check/gate-closure.mjs` | Observed |
| E-44-14 | `OmpSession` already exposes `frameArrivalsMs` (Phase 38); `startupOrder` returns the ready time and the first and last realm status times; `classifyRun`, `decideWindow`, `firstAnswerMs`, `servingProblems`, `bootExcessMs` and the constants `MIN_VALID_RUNS` 3, `MAX_ATTEMPTS` 6, `BOOT_EXCESS_MAX_MS` 250, `CONTROL_MIN_WINDOW_MS` 12 000, `CONTROL_MAX_WINDOW_MS` 60 000 exist in `test/support/responsiveness-decision.ts`. The cold-attach test asserts the quiet host, the baseline, the no-daemon check, `realm active` and `responsivenessProblems` over all samples from process start; the control and the cold test write `omp-responsiveness.control.record.json` and `omp-responsiveness.attach.record.json`. | `test/support/responsiveness-decision.ts`, `test/integration/omp-responsiveness.test.ts` | Observed |

### D-44-01. Owner override of the VOID outcome (recorded, not a relabel)

The Phase 38 frozen rule (`38-CONTEXT.md` D-38-02) produced `VOID`: one valid run in six attempts, fewer than the three it needs. That outcome stands as recorded in `38-MEASUREMENT.md` and `38-VERIFICATION.md`: OMPR-01 is not met, OI-11 is `Carried (no quiet slot)`, plans 38-02 and 38-03 did not run by the rule.

On 2026-11-18/19 the owner (HITL) decided to take the single valid run (case `serving-stall`: serving maximum 1403 ms after the first answer, first answer 3104 ms later than the no-extension control) together with the loaded runs of Phase 36 as sufficient to plan the Omp non-blocking fix now, and added Phase 44 to milestone v6.0. This is an override of the rule's consequence by the owner. It is not a new outcome of the rule, and no document may say the rule produced `CODE`. Every document this phase writes that cites the evidence says: "owner override of the VOID outcome (D-44-01); the evidence is one valid run and loaded-host runs; no quiet-host verdict was reached". The override authorizes the change and the paired loaded re-proof. It does not authorize relaxing the 0.5 load-per-CPU ceiling, closing OI-11, or changing the status of UI-01.

### D-44-02. Conflicts with Phase 38 and how they are closed

`38-02-PLAN.md` and `38-03-PLAN.md` stay unexecuted and are marked superseded by Phase 44 (plan 44-01 Task 1 adds the status line to both files; the orchestrator adds the same words to the Phase 38 ROADMAP block, see the text below). Conflict table:

| Phase 38 item | Conflict | Phase 44 treatment |
| --- | --- | --- |
| 38-02 Task 1, the gate: runs only on outcome CODE or HARNESS | The outcome was VOID; the gate is closed by the rule and opened by the owner | Replaced by D-44-01; plan 44-01 Task 2 writes the attribution from the existing evidence (no selection table is applied) |
| 38-02 Task 2 (K1) and Task 3 (K2 and the attach-window test) | K2 there is a bare `setImmediate` in `plugin.ts`, selected by a table | Kept as K1 and K2 in plan 44-02, with K2 changed to an injected deferral (D-44-05) and both applied together because the data cannot separate them (E-44-05) |
| 38-02 Task 4, the harness window correction (only on HARNESS) | Conditional on a recorded case | Made unconditional and widened in plan 44-01 (D-44-03), because E-44-08 and E-44-09 support it without a decision-rule outcome |
| 38-02 Tasks 5 and 6, docs and gate run | none | Kept in plan 44-02 |
| 38-03, the re-proof on a quiet host with the frozen window rule | The quiet host is not available (the window waited 7967 s for it) | Replaced by the paired loaded A/B of D-44-06 and plan 44-03 |
| D-38-02 constants and tables | The corrected window changes which samples a future quiet window reads | The constants and tables are untouched and pinned by their existing test; `classifyRun` gains an optional ready time (D-44-03); the first window's runs are not re-evaluated |
| D-38-08 OI-11 labels | `Closed ...` labels need a quiet window | Phase 44 never writes a `Closed` label; it writes the label of D-44-09 |

### D-44-03. The harness correction where the evidence supports it (OMPR-04; plan 44-01)

What the evidence supports:

- **Window starts at Omp ready** (E-44-08: four of four controls answer nothing for 9.4 to 15.4 s from process start; E-38-06: the baseline already starts at ready). Probes sent before the `ready` frame arrive keep being sent from process start (the process-start window is the cold-attach definition of 38) but are classified as boot samples and written to the samples CSV with a marker column; they are summarized separately (their first answer is the Omp boot time) and are not part of the verdict. The verdict, the 40-probe and 10-s conditions are read over the window samples (probes sent at or after ready). The stop rule becomes: `realm active` shown AND at least `MIN_WINDOW_MS` elapsed since ready, or 360 s. `classifyRun` takes an optional `readyAtMs`; absent, it behaves exactly as in Phase 38; present, the verdict and shortness conditions are read over the window samples, the boot excess `X` is still read from the first answer over all samples, and the case is `pass` when the corrected verdict is empty and `X` is at most `BOOT_EXCESS_MAX_MS`, `serving-stall` when the window has a latency problem, `boot-delay` when `X` exceeds the bound, `short-window` when only shortness problems remain; `own-boot` cannot arise on the corrected window.
- **Control-relative secondary measure, labelled** (E-44-09: the absolute 500 ms bound is missed with no extension in five of nine runs on this host, so a reader of the absolute numbers cannot separate the host from the product). The cold-attach summary and record gain a section headed "secondary, control-relative, not a verdict": the window's maximum and 95th percentile minus those of the in-run baseline (and of the paired control in the paired arm). It never replaces the absolute verdict and is never cited as a pass.
- **Host CPU pressure recorded** (E-44-09): at each load reading the records also carry the "some" line of `/proc/pressure/cpu` (avg10, avg60, avg300) when it is readable, as numbers; absent when not. It is evidence for the baseline finding, not a validity condition.
- **The baseline is not loosened.** In the quiet-window tests the baseline still fails the run when it misses its bounds, as validity logic (Phase 38 behavior). The finding F-44-01 records that five of nine baselines missed at quiet load readings, that the cause is not established, that PSI is now recorded, and that no threshold was edited. The paired arm does not assert the baseline; it records the control-relative numbers instead (D-44-06).

Not supported, so not done: relaxing any threshold; dropping the baseline assertion from the quiet-window test; treating a control-relative comparison as a verdict.

### D-44-04. The Omp path change, K1 (OMPR-05; plan 44-02)

Move `SpawnedProcess`, `SpawnDaemon`, `defaultSpawnDaemon`, `withDaemonLog`, `launchFilteredDaemon` and `startDetachedDaemon` unchanged from `src/cli/main.ts` to a new `src/daemon/launch.ts`. `spawnDetachedDaemon(deps)` stays in `src/cli/main.ts` (it reads `ResolvedDeps`) and calls `launchFilteredDaemon` imported from the new module. `src/omp/extension.ts` imports `startDetachedDaemon` from `../daemon/launch.js`. Clean cutover: nothing is re-exported from `src/cli/main.ts`; the nine test and support files that import these names from `src/cli/main.js` are migrated in the same change (`test/cli/cli.test.ts`, `test/cli/mcp-attach.test.ts`, `test/daemon/e2e.test.ts`, `test/daemon/launch-runtime.test.ts`, `test/daemon/spawn-env.test.ts`, `test/integration/enforce-default.test.ts`, `test/integration/host-boot-isolation.test.ts`, `test/support/boot-matrix-rig.ts`, `test/support/stdio-world.ts`), plus the comment in `src/daemon/spawn-env.ts` and the paragraph "Startup output" of `docs/integration/runtime-decision.md`.

Lint and gates change by swapping the named module, not by widening: `CHILD_PROCESS_ALLOWED`, `SPECIAL_SRC`, `SPAWN_MESSAGE` and the child_process import message name `src/daemon/launch.ts` where they name `src/cli/main.ts` for the spawn and `node:child_process` rights; `src/cli/main.ts` loses its exemption from the spawn rule (its block at line 245 stops omitting `SPAWN`) and the new module gets the per-file block the CLI had (dynamic, named-only, openshellBinary and guard rules); the gate-module pattern group gains `../daemon/launch*`; `FORBIDDEN_MODULES` in the gate closure script gains `src/daemon/launch.ts`. Behavior of the launch (allowlisted environment, the Bun Node lookup, the log file at mode 0600, `unref`) is unchanged and pinned by `test/daemon/launch-runtime.test.ts` and `test/daemon/spawn-env.test.ts`. A hermetic closure test (`test/omp/extension-load.test.ts`) fails before the move and passes after.

### D-44-05. The Omp path change, K2: an injected deferral (OMPR-05; plan 44-02)

`38-02` proposed a bare `setImmediate` in `plugin.ts`. This phase injects it, because `plugin.ts` reads no runtime global for scheduling today (E-44-12) and a manual deferral makes the not-active window and the ended-session guard testable without a clock. `RealmPluginOptions` gains an optional `deferStart` function that takes a start callback and returns nothing; `reattach` is the precedent for an optional option whose absence keeps the old behavior (E-44-12). In `attach`, the first step today is a promise that is already resolved, whose continuation calls `options.attachDaemon` with `ctx.cwd`; with a deferral it becomes a promise whose executor passes a callback to `deferStart`; the callback checks `isCurrent()` and, if the attempt is no longer current, rejects with `REALM_NOT_ACTIVE` without calling `attachDaemon` (the existing code after the race already treats that as superseded and releases a late client); otherwise it calls `attachDaemon`. Absent `deferStart`, the start is the existing microtask, so the six test callers that do not pass it are unchanged. The extension edge passes a function that calls `setImmediate` with the start callback; `src/omp/extension.ts` is already an environment and runtime edge. Net growth of `plugin.ts` at most 10 lines (991 now; limit 1000; a larger change goes to a new module). `test/omp/extension.test.ts` gains a test that the real entry passes a deferral (the attach does not start in the handler's own turn). The order inside the attach (status read, `setHostMode` inside the budget, client adopted, published, painted) is not touched.

### D-44-06. The paired loaded A/B re-proof design (OMPR-06; plans 44-01 and 44-03)

**Why paired.** A quiet host is not available and the loaded absolute numbers are dominated by Omp's own boot (E-44-08) and host contention (E-44-09). What can be compared is the same measurement on two builds under the same host conditions, each against its own no-extension control run moments earlier in the same test. Differences between builds, not absolute latencies, are the claim.

**Arms.** BEFORE: the tree at the merge commit of plan 44-01 (harness and paired module present, no product change). AFTER: the tree at the head of plan 44-02 (K1 and K2 on top). The window verifies that the diff between the two commits touches only the files plan 44-02 lists. Both are built, copied to the realmlive home as two separate run trees (never one tree switched), and run with the same Omp binary, the same node, the same scrubbed environment.

**The paired arm test** (new, fourth test of `test/integration/omp-responsiveness.test.ts`, gated like the cold-attach test plus `REALM_OMP_PAIRED_ARM` naming the arm (`before` or `after`) and `REALM_OMP_PAIRED_PAIR` naming the pair number; it never sets a gate variable and does not require a quiet host and does not use the loaded-host escape variable). One test, in this order: (1) the no-daemon check; (2) the control (Omp with no extension, probed from process start until a probe was answered and 5 s have passed since the first answer, at most 60 s); (3) the cold attach (Omp with the built extension, probed from process start until `realm active` and 10 s after ready, at most 360 s); (4) `get_available_commands` answered after the attach; (5) the record `omp-responsiveness.paired.record.json` and both samples CSVs. It asserts only mechanics (control answered, `realm active` reached, the session answers a command, no daemon at the start); it asserts no latency, because the verdict is the paired analysis's. The record carries the fixed label `loaded, paired`, the arm and pair, the load readings and CPU pressure before and after each part, the control and cold timelines, and the metrics of D-44-07.

**Pairs and order.** One pair is one BEFORE run and one AFTER run back to back. The order alternates: odd pairs run BEFORE first, even pairs AFTER first, so a drift in load across a pair does not favour one arm. Between any two runs (arms) the person waits until `realm down` has completed, the residue snapshot is clean, at least 120 s have passed since the previous run ended, and the one-minute load per CPU is at most the loaded ceiling of D-44-07. A run that fails a mechanics assertion is recorded with its reason and counts for nothing.

**Window size.** At least `MIN_VALID_PAIRS` = 5 valid pairs, at most `MAX_PAIR_ATTEMPTS` = 10 pair attempts. A pair is valid when both runs are valid and the start loads satisfy D-44-07. The window stops at the fifth valid pair or the tenth attempt. No valid pair is discarded or repeated to change the outcome.

**Label.** Every number from this window is labelled `loaded, paired`, with the load facts. It is never called a quiet-host measurement, even if every reading happened to be below 0.5 per CPU: a quiet-host claim needs the Phase 38 window rule, which this phase does not run.

### D-44-07. The frozen paired decision rule (OMPR-06)

Frozen here and, in plan 44-01 Task 4, in code (`test/support/paired-ab.ts`) with a hermetic test that pins every constant and every row before the first paired run. The owner is read the rule in plan 44-03 Task 2. No task edits a constant or a row after a paired number exists; a wrong rule is a finding and a replan.

**Constants.** `MIN_VALID_PAIRS` 5; `MAX_PAIR_ATTEMPTS` 10; `PAIR_LOAD_CEILING_PER_CPU` 2.0 (a run starts only at or below this one-minute load per CPU: loaded, but not saturated; the recorded attempts of Phase 38 started at 0.2 to 0.3 and saw 1.0 to 1.6 mid-window); `PAIR_LOAD_GAP_PER_CPU` 0.5 (the two runs of a pair start within this difference of one-minute load per CPU); `SERVING_CONTROL_WINDOW_MS` 5000 (the control's serving window after its first answer); `REPRODUCTION_MIN_MS` 250 (one probe interval: the BEFORE arm must show at least this median excess for an effect to be measurable); `GAIN_MIN_MS` 250; `GAIN_PAIR_FRACTION` 0.8; `GAIN_MEDIAN_SHARE` 0.5; `STALL_TOLERANCE_MS` 250; `REGRESS_PAIR_FRACTION` 0.2. The probe, answer-timeout and other harness constants are the existing ones.

**Per run, from its samples and frame times** (all in ms from process start of that run; a run missing a ready time or a first answer in either part is invalid):

- `X`, the boot excess: cold first answer minus control first answer (the Phase 38 definition, one control).
- `X1`, the before-ready component: cold ready minus control ready. `X2`, the after-ready component: (cold first answer minus cold ready) minus (control first answer minus control ready). `X` equals `X1` plus `X2`.
- `S`, the serving stall: the largest latency among cold probes sent at or after the cold first answer (an unanswered probe counts as the answer timeout, 10 000 ms), minus the largest latency among control probes sent from the control's first answer to `SERVING_CONTROL_WINDOW_MS` after it; never below 0.

**Pair validity.** Both runs valid (mechanics held, no daemon at the start, `realm active` reached, a control first answer, ready times present, residue clean as attested by the person), both start loads at or below the ceiling, and the two start loads per CPU within the gap.

**Outcome of the window, over N valid pairs, with `mB` the median of `X` over the BEFORE runs, `gain` per pair `X(before) - X(after)`:**

| Outcome | Condition (first row that holds, in this order) | Consequence |
| --- | --- | --- |
| `VOID` | N is below 5 | No effect claim. OMPR-06 reported unmet; the change stays (D-44-01) with the record that it was not re-proved. |
| `NOT-REPRODUCED` | `mB` at most `REPRODUCTION_MIN_MS` | The BEFORE build did not show the excess in this window, so no improvement can be measured. A finding; the change stays; no effect is claimed. |
| `REGRESSION` | the median of `X(after)` exceeds `mB` by more than `GAIN_MIN_MS`, or the median of `S(after)` exceeds the median of `S(before)` by more than `STALL_TOLERANCE_MS`, or more than `REGRESS_PAIR_FRACTION` of the pairs (rounded down) have `S(after)` above `S(before)` by more than `STALL_TOLERANCE_MS` | A finding with the per-pair numbers; the owner decides on a revert; nothing is reverted by this phase. |
| `EFFECT` | at least `GAIN_PAIR_FRACTION` of N (rounded up) pairs have a gain of at least `GAIN_MIN_MS`, and the median gain is at least `GAIN_MEDIAN_SHARE` of `mB` | The change reduced the control-relative excess under these loaded conditions. Never a quiet-host claim. |
| `NO-EFFECT` | none of the above | The BEFORE build reproduced the excess and the change did not reduce it. A finding; the change stays by the owner's decision; no effect is claimed. |

Descriptive numbers, not gating: the medians of `X1`, `X2` and `S` per arm and the per-pair table; the secondary control-relative window numbers of D-44-03.

**What each outcome can claim.** `EFFECT`: the median control-relative first-answer excess fell from `mB` to the AFTER median on this host in this window, with the pairs listed. It does not claim the thresholds hold, that `get_state` is answered within 1000 ms during a cold attach, or anything about a quiet host. No outcome closes OI-11.

### D-44-08. Fail closed and the not-active window (OMPR-05)

As D-38-07, unchanged: no change may let a mutation run before the session is ready. `test/omp/attach-window.test.ts` (plan 44-02 Task 3) holds the attach open with a stand-in daemon that holds `up` and a manual `deferStart`, and shows: the handler returns before the deferral runs; before the deferral runs no `attachDaemon` call, no socket and no spawn exist; with the deferral run and `up` held, a Realm `write` and `exec` are refused with `REALM_NOT_ACTIVE` and never reach the stand-in, a guarded built-in is blocked by the `tool_call` guard, and the host tool set is unchanged; a session ended (shutdown) or superseded (a second start) before the deferral runs never calls `attachDaemon`; after `up` completes the same session adopts the client and the next call is forwarded. The status vocabulary, the not-active refusal and the audit lines are unchanged, shown by the existing suites (`test/omp/plugin.test.ts`, `test/omp/extension.test.ts`, `test/omp/tools.test.ts`, `test/omp/host-tools.test.ts`, `test/omp/boot-conformance.test.ts`, `test/host/boot-no-down.test.ts`, `test/host/manifest.test.ts`, `test/integration/omp-guard.test.ts`, `test/integration/enforce-default.test.ts`) passing with assertions unedited except import paths.

### D-44-09. Records, labels and the OI-11 row (OMPR-06)

Numbers and host facts go in `44-MEASUREMENT.md` (this phase) and in a dated paragraph of `docs/integration/omp.md` placed after the Phase 38 paragraphs without editing them, giving: the owner override, the harness correction, the code change (what the tests prove, not an effect), the paired window's facts (date, commit of each arm, Omp version, CPU count, the start loads and PSI of every run, the number of attempts and valid pairs) and the per-pair numbers, the outcome and the label `loaded, paired`. The row of UI-01 in that page gets its evidence cell extended and keeps its status word and the sentence that UI-01's status is the owner's call.

OI-11's label after Phase 44 is `Carried (no quiet slot; owner override D-44-01; paired loaded A/B: OUTCOME)`, where OUTCOME is the window's outcome word. A dated line is appended under Part C of the archived `36-DISPOSITIONS.md` after the Phase 38 line, no earlier line edited. OI-11 reads Closed only if a later quiet-host window under the Phase 38 rule (with the corrected window of D-44-03) produces `PASS`; that window is not part of this phase.

### D-44-10. Hygiene constraints for every plan

- Gates: `src/contract` imports no `host/` or `capability/`; modules reachable from the exec gate closure do not reach `node:child_process`; `src/cli/main.ts` and `src/omp/plugin.ts` stay under 1000 lines (`node scripts/check/module-size.mjs`); the export-usage gate (`node scripts/check/export-usage-gate.mjs`): a test-only export of a new `src` module needs an allowlist entry in `scripts/check/export-usage-allowlist.json` and a stale entry fails (expected none: every export of `src/daemon/launch.ts` is used by `src/cli/main.ts` or `src/omp/extension.ts`).
- Lint: no unnecessary conditions after assert narrowing, `restrict-template-expressions` (numbers through `String(...)`), `no-base-to-string`, `prefer-const`, `void test(...)` for tests.
- Tests pass as a regular non-root user; the new hermetic tests use a temporary directory and in-process stand-ins only, no gate variable, no file basename containing `mcp` or `acp` (the taxonomy test; `cli/mcp-attach.test.ts` is the one exception).
- The error catalogue stays at 29 codes; this phase adds none.
- Markdown: no host-local absolute path; raw angle tokens outside code fences are escaped; HTML-like plan task blocks hold no angle brackets; frontmatter list entries that contain a colon and a space are quoted (the docs site build broke on that in `38-03-PLAN.md`, fixed in PR 206). `node scripts/check/host-paths.mjs` and `npm run check:docs` pass (the default-mode docs guard included).
- Capability tokens default to enforce: the live Omp session attaches as the host id `omp` (`src/omp/extension.ts`); no policy edit is part of this phase.
- Commit conventions: a breaking change carries the `!` marker and lands as a merge commit. K1 and K2 change internal module locations and an optional internal option only, so no `!` is expected; if a documented contract changes incompatibly the subject carries it. Plan 44-01 merges before plan 44-02 so the BEFORE commit is clean (D-44-06).
- Docs are updated in the same pull request as the code. No `CHANGELOG.md`, no version field.
- Live window rules (as Phases 33, 35 and 36): the owner's authorization of 2026-11-18 (live windows are authorized when a phase needs them), the realmlive account and its rootless Podman 5.7.1 stack, the shared live lock, one live run at a time, a fresh copy of each built tree under the realmlive home, `env -i` with exactly the named variables, residue snapshots before, after every run and at the end, evidence outside the repository (mode 0700, files 0600), a secret search before anything is cited, and the Phase 18 stop rule.

### D-44-11. Threat model (summary; each plan carries its STRIDE rows)

| ID | Category | Threat | Mitigation |
| --- | --- | --- | --- |
| T-44-01 | Tampering | A deferred or lighter attach lets a mutation run before the session is ready | D-44-08: client null until adopted, attach-window test, `setHostMode` order untouched, existing B2 tests unedited |
| T-44-02 | Repudiation | The owner override is read as a quiet-host verdict, the VOID relabelled, or a paired result cited as quiet | D-44-01 wording rule; fixed label `loaded, paired` in the record; `Closed` labels never written; omp.md and the ledger carry the override sentence |
| T-44-03 | Tampering | The paired rule is bent after the numbers are seen | D-44-07: frozen in code and a hermetic test before the window; read to the owner; a disagreement stops the task |
| T-44-04 | Elevation of privilege | K1 widens the child_process allowlist | the allowlist swaps one named module for another; both are forbidden in the exec gate closure; the closure test pins that `launch.ts` is the only child_process importer in the extension closure; launch tests pin the allowlisted environment |
| T-44-05 | Information disclosure | Evidence or records hold a token, a host path or a secret | records hold numbers, booleans and closed phrases; the secret search; nothing with a path enters the repository |
| T-44-06 | Denial of service | A paired window leaves a daemon, container, socket, presence marker or workspace entry on the shared stack, or runs while another live run holds it | the shared lock; before, per-run and final snapshots; any count change stops the window; the harness cleanup |
| T-44-07 | Tampering | The BEFORE and AFTER trees differ in more than the change (a different harness, build or environment) | the window verifies the diff between the two commits touches only the plan 44-02 files; same node, Omp binary and environment; two separate copies; order alternated |
| T-44-08 | Repudiation | A harness correction hides a real stall | D-44-03: boot samples kept and summarized; uncorrected numbers still written; the correction changes no threshold; E-44-06 shows the corrected window still reads a stall for attempt 1 |

## Canonical References

- `.planning/MILESTONE-CONTEXT.md` (D-v6-2, constraints, limits); `.planning/REQUIREMENTS.md` (OMPR-01 to OMPR-03); `.planning/ROADMAP.md` (Phase 38 block)
- `.planning/phases/38-omp-responsiveness-during-cold-attach/` (`38-CONTEXT.md`, `38-MEASUREMENT.md`, `38-VERIFICATION.md`, `38-01-SUMMARY.md`, `38-02-PLAN.md`, `38-03-PLAN.md`)
- `.planning/milestones/v5.0-phases/36-live-re-verification-of-v1-0-open-items/36-DISPOSITIONS.md` (OI-11, F-4, F-5, Part C), `36-CONTEXT.md` (D-36-06)
- `.planning/milestones/v5.0-phases/35-capability-token-evidence/35-01-PLAN.md` (the copy, the scrubbed environment, the non-root run), `.planning/milestones/v5.0-phases/33-cold-attach/33-CONTEXT.md` (the serve-early precedent for `realm mcp`)
- `docs/integration/omp.md` (UI-01 row and detail), `docs/integration/runtime-decision.md` (Startup output)
- `src/omp/extension.ts`, `src/omp/plugin.ts`, `src/cli/main.ts`, `src/daemon/ensure.ts`, `src/daemon/node-runtime.ts`, `src/daemon/spawn-env.ts`, `src/host/attach.ts`
- `test/integration/omp-responsiveness.test.ts`, `test/support/responsiveness.ts`, `test/support/responsiveness-decision.ts`, `test/support/omp-rpc.ts`, `test/support/omp-live.ts`, `test/omp/plugin.test.ts`, `test/omp/extension.test.ts`, `test/daemon/launch-runtime.test.ts`, `test/daemon/spawn-env.test.ts`
- `eslint.config.js`, `scripts/check/gate-closure.mjs`, `scripts/check/module-size.mjs`, `scripts/check/export-usage-gate.mjs`

## Existing Code Insights

- The attach's value is already off the hook (E-44-11); what the extension still controls is how much code it evaluates before Omp is ready (K1: the pre-ready component, E-44-05) and how much synchronous prefix it runs in the turn right after `session_start` (K2: the post-ready component). Both are hypotheses with a measured shape and one run behind them; the paired window is the test.
- `launchFilteredDaemon` already takes the spawn and the Node lookup as parameters, so K1 is a move, not a redesign.
- The harness already records `frameArrivalsMs`, the startup order and a per-run record; the corrected window and the paired record extend them additively.
- A quiet slot cost 7967 s and yielded one valid run; a pair costs about five minutes with its settle time, so ten arms fit in a long evening window.

## Wave Structure

| Wave | Plan | What | Depends on |
| --- | --- | --- | --- |
| 1 | 44-01 | Mark 38-02 and 38-03 superseded; the attribution record; the harness correction (ready window, control-relative secondary, PSI); the paired arm test and the frozen paired rule as code with its hermetic test; docs for the method. Autonomous. Merges first (its merge commit is BEFORE). | none |
| 2 | 44-02 | K1 (launch module, full cutover, lint and gate swap, closure test), K2 (injected deferral, edge wiring), attach-window test, docs, gate run. Autonomous. Its head is AFTER. | 44-01 |
| 3 | 44-03 | The paired loaded window (blocking human), the record, the outcome by the frozen rule, docs, the ledger line, the final label. | 44-01, 44-02 |

## Requirement coverage

| Requirement | Plan | Where |
| --- | --- | --- |
| OMPR-04 | 44-01 | Tasks 1 to 3: supersession, attribution, ready window, control-relative secondary, PSI, finding F-44-01 |
| OMPR-05 | 44-02 | Tasks 1 to 6: K1, K2, the attach-window test, lint and gates, docs |
| OMPR-06 | 44-01 (the rule and the arm as code), 44-03 (the window, the record, the label) | D-44-06, D-44-07, D-44-09 |

## Open Questions (none blocks plan 44-01)

- **OQ-44-01 (a K1-only arm).** The data cannot separate K1 from K2 (E-44-05); the paired window measures them together and reports `X1` and `X2` as descriptive components. A third arm (K1 only) would separate them at the cost of 50 percent more runs. Default taken: no third arm; the component medians are the separation evidence. The owner may ask for the arm; it needs a third copy of the tree and a rule extension decided before the window.
- **OQ-44-02 (landing before the re-proof).** The change is owner-directed, so plan 44-02 lands (hermetic checks, gates) before the paired window. If the window reads `REGRESSION`, nothing is reverted automatically; the owner decides. Default taken: land first.
- **OQ-44-03 (the load ceiling).** The paired ceiling of 2.0 load per CPU is a judgement from the loads seen in Phase 38 (E-44-01, E-44-09); the person may find the host never starts a run below it. Default taken: the constant stays as frozen; a run above it is invalid and recorded; if fewer than five valid pairs result, the outcome is `VOID` and the owner is told the ceiling was the cause.
- **OQ-44-04 (Omp as the realmlive account).** As OQ-38-04: Omp runs as the realmlive account on its production stack; the Phase 38 window ran that way on 2026-11-18. If it cannot, the window is BLOCKED with that reason.
- **OQ-44-05 (Linear).** Phase 38 is Linear SPE-34662. Whether Phase 44 uses the same issue or a new one is Main's call; no issue is created by this phase.

## Success Criteria (from the roadmap text below, made observable)

1. The harness reads the cold-attach verdict over the window that starts at Omp ready, records the control-relative secondary measure and the CPU pressure, leaves every threshold and the Phase 38 constants and tables untouched (pinned by the existing hermetic tests), and the baseline finding F-44-01 is recorded.
2. The extension's static import closure no longer reaches `src/cli`, `src/doctor`, `src/mcp` or `src/acp`, the attach starts through an injected deferral with an ended-session guard, the attach-window test and the unedited Omp suites pass, and lint and gates are updated without widening.
3. The frozen paired rule exists as code with a passing test before any paired run; the window records at least five valid pairs (or `VOID`), every number labelled `loaded, paired`; the outcome follows the rule.
4. omp.md, the measurement file and the ledger line carry the owner override sentence and the label of D-44-09; no document says OI-11 is closed, OMPR-01 is met, or a quiet-host measurement was made.

## Deferred Ideas

- A quiet-host window under the Phase 38 rule with the corrected window, if the host is ever quiet (closes OI-11 on a `PASS`).
- A K1-only arm (OQ-44-01); a keystroke-echo probe beside `get_state`; lowering the priority of the daemon during a cold attach (all as in Phase 38).
- Isolating the baseline instability (F-44-01) with a dedicated CPU-pinned run, if PSI shows it is host contention.
</decisions>

## Text for the orchestrator

The orchestrator applies the following; this phase edits none of these files. Nothing here is in ROADMAP.md, REQUIREMENTS.md or STATE.md yet, and `gsd-tools phase add` was not run.

### ROADMAP.md

Milestone list line (add after the Phase 43 line, in the v6.0 list):

```
- [ ] **Phase 44: Omp non-blocking cold attach (owner-directed from loaded-host evidence)** - The Omp extension path is made lighter and later at the start of the attach (the daemon-launch module split so the extension no longer loads the CLI graph, the attach started one turn after the session handler), the responsiveness harness reads its verdict from the Omp ready frame with a labelled control-relative secondary measure, and the change is re-proved by a paired before/after comparison on the loaded host, labelled loaded and paired, on the owner's override of the VOID outcome of Phase 38 (D-44-01, 2026-11-18/19).
```

Detail block (add after the Phase 43 block):

```
### Phase 44: Omp non-blocking cold attach (owner-directed from loaded-host evidence)

**Goal:** The Omp extension answers `get_state` as early in the cold attach as the extension controls (it loads about 42 modules instead of about 98 and starts the attach one event-loop turn after the session handler, fail closed kept), the harness verdict window starts at Omp ready, and the effect is measured by a paired before/after comparison on the loaded host (at least five valid pairs, interleaved, each against its own no-extension control), labelled loaded and paired and never cited as a quiet-host measurement; built on the owner's override of the Phase 38 VOID outcome (2026-11-18/19). OI-11 stays Carried.
**Depends on:** Phase 38
**Requirements**: OMPR-04, OMPR-05, OMPR-06
**Success Criteria** (what must be TRUE):
  1. The responsiveness harness reads its cold-attach verdict over the window that starts at Omp's ready frame, records a control-relative comparison and the host CPU pressure as a labelled secondary measure, and leaves every threshold and the Phase 38 decision constants unchanged; the baseline instability is recorded as a finding.
  2. The static import closure of the Omp extension reaches no CLI, doctor, MCP or ACP module and reaches `node:child_process` only through `src/daemon/launch.ts`; the attach starts through an injected deferral that skips an ended or superseded session; no mutation runs before the session is ready, shown by an attach-window test and the unedited Omp, boot and contract suites.
  3. The paired decision rule exists as code with a passing hermetic test before the first paired run; the window records at least five valid pairs (or the outcome VOID), every number labelled loaded and paired, and the outcome (EFFECT, NO-EFFECT, REGRESSION, NOT-REPRODUCED or VOID) follows the rule.
  4. The records and the OI-11 row state the owner override of the VOID outcome and read Carried with the paired outcome; no document says OI-11 is closed, OMPR-01 is met, or a quiet-host measurement was made.
**Plans:** 3 plans

Plans:
- [ ] 44-01-PLAN.md: supersede 38-02 and 38-03, attribution, harness correction (ready window, control-relative secondary, CPU pressure), the paired arm test and the frozen paired rule as code (wave 1)
- [ ] 44-02-PLAN.md: K1 launch module split with full cutover and lint and gate swap, K2 injected deferral, attach-window test, docs (wave 2)
- [ ] 44-03-PLAN.md: the paired loaded window (blocking human), the record, the outcome, docs, ledger line and label (wave 3)
```

Progress table row (add after the Phase 43 row):

```
| 44. Omp non-blocking cold attach | 0/3 | Not started | - |
```

Phase 38 block and milestone text (suggested edits): in the Phase 38 `Plans` list, mark the two plan lines `38-02` and `38-03` as "superseded by Phase 44 (D-44-01), not executed", and add to the Phase 38 goal paragraph the sentence: "Outcome VOID (one valid run in six attempts, 2026-11-19); the Omp fix was taken over by Phase 44 on the owner's override." The v6.0 milestone paragraph of ROADMAP.md that lists the phases gains "and makes the Omp path non-blocking on the loaded-host evidence by the owner's override of the Phase 38 VOID outcome (Phase 44)". The Phase 38 progress row stays as Main sets it.

### REQUIREMENTS.md

Rows (add in the v6.0 section after OMPR-03):

```
- [ ] **OMPR-04**: The responsiveness harness reads the cold-attach verdict over the window that starts at Omp's ready frame (probes before it are recorded as boot samples), with every threshold and the Phase 38 decision constants unchanged; a control-relative comparison and the host CPU pressure are recorded as a labelled secondary measure that is never a verdict; the baseline instability (five of nine no-extension baselines missed their 500 ms bound at 0.17 to 0.36 load per CPU) is recorded as a finding with its cause unestablished; the attribution of the one valid quiet-host run is written down with evidence tiers (owner override of the VOID outcome, D-44-01)
- [ ] **OMPR-05**: The Omp extension path is changed on the owner's override of the VOID outcome: the daemon-launch functions move to src/daemon/launch.ts with every importer migrated and no re-export, so the extension's static import closure reaches no CLI, doctor, MCP or ACP module; the attach starts through an injected deferral, one event-loop turn after the session handler, skipping an ended or superseded session; fail closed is kept (no mutation or tool call reaches the daemon before the session is ready), shown by an attach-window test and the unedited Omp suites; the lint and gate allowlists name the new module in place of the old one without widening
- [ ] **OMPR-06**: The change is measured by a paired before/after comparison on the loaded host (at least five valid pairs, interleaved, each arm against its own no-extension control in the same test) under a decision rule fixed as code before the first run; the outcome (EFFECT, NO-EFFECT, REGRESSION, NOT-REPRODUCED or VOID), the per-pair numbers and the host facts are recorded in the phase and in docs/integration/omp.md, labelled loaded and paired and never cited as a quiet-host measurement; OI-11 is recorded Carried with the owner override and the paired outcome
```

Count line (replace the v6.0 line in the Traceability section):

```
v6.0 requirements: 19 total (OMPR-01..06, EXEC-01..03, HOSTID-01..03, TEAR-01..02, DEBT-01..03, KIMI-01..02), 19 mapped to phases 38 to 44
```

(the "all Planned" tail of the current line is for Main to restate with the real statuses.)

Traceability rows (add after the OMPR-03 row):

```
| OMPR-04 | Phase 44 | Planned |
| OMPR-05 | Phase 44 | Planned |
| OMPR-06 | Phase 44 | Planned |
```

Suggested status words for the existing rows, Main's call: OMPR-01 stays open (VOID, not met); OMPR-02 and OMPR-03 are carried as "Phase 38: not triggered by the rule, superseded by OMPR-05 and OMPR-06 under D-44-01; numbers recorded (OMPR-03 satisfied by 38-MEASUREMENT.md and omp.md)".
