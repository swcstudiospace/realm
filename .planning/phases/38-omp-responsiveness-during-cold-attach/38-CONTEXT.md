# Phase 38: Omp responsiveness during cold attach - Context

**Gathered:** 2026-11-18, from `.planning/MILESTONE-CONTEXT.md` (D-v6-2), the v6.0 section of `.planning/REQUIREMENTS.md` (OMPR-01 to OMPR-03), the Phase 38 block of `.planning/ROADMAP.md`, the Phase 36 evidence (`.planning/milestones/v5.0-phases/36-live-re-verification-of-v1-0-open-items/36-DISPOSITIONS.md`, OI-11, F-4 and F-5; `36-CONTEXT.md` D-36-06), `docs/integration/omp.md` (UI-01 detail), and a fresh read of the branch `gsd/v6-plan`: `src/omp/extension.ts`, `src/omp/plugin.ts`, `src/omp/reattach.ts`, `src/omp/host-tools.ts`, `src/host/attach.ts`, `src/host/boot-observer.ts`, `src/daemon/ensure.ts`, `src/daemon/client.ts`, `src/cli/main.ts` (the daemon launch), `src/daemon/node-runtime.ts`, `test/integration/omp-responsiveness.test.ts`, `test/support/responsiveness.ts`, `test/support/omp-rpc.ts`, `test/omp/plugin.test.ts`, `test/omp/extension.test.ts`.
**Status:** Planned (three plans, nothing executed). Plans 38-02 and 38-03 are conditional on the measurement of plan 38-01. This phase does not edit ROADMAP, STATE or REQUIREMENTS. Requirement ids OMPR-01 to OMPR-03 are already registered.
**Format and depth:** the v5.0 phases under `.planning/milestones/v5.0-phases/` (CONTEXT with decisions and open questions, plans with frontmatter, threat model per plan, blocking-human live window with the owner authorization of 2026-11-18).

<domain>
## Phase Boundary

The Omp cold attach is measured on a quiet host and, only if the measurement exceeds the harness thresholds, fixed and measured again. The measurement is the existing harness `test/integration/omp-responsiveness.test.ts` with its verdict (`responsivenessProblems`, `test/support/responsiveness.ts`) unchanged: `get_state` every 250 ms from Omp process start until the status item reads `realm active`; all probes answered, maximum at most 1000 ms, 95th percentile at most 500 ms, at least 40 probes, a window of at least 10 s, `realm active` reached, one-minute load per CPU below 0.5.

This is the carried finding OI-11 (loaded-host run of 2026-11-18: 97 probes over 24001 ms, 6 unanswered, maximum 9868 ms, 95th percentile 8910 ms, longest gap 11369 ms, load 9.00 on 8 CPUs) and finding F-5 ("the cause is not established"). The owner's decision D-v6-2 (2026-11-18, Linear SPE-34662) says: measure on a quiet host; if the measurement shows blocking over the thresholds, make the Omp extension path non-blocking (answer before `up` completes, as Phase 33 did for `realm mcp`) and re-prove; record the numbers either way; OI-11 closes on a quiet-host result, not on a loaded-host run.

What this phase adds beyond a bare re-run, because the code read below shows the Omp extension hook is already detached (E-38-01): the harness gains diagnostics that say WHERE a stall sits (before Omp serves anything, or after), and the decision rule that turns the numbers into "change the product", "correct the harness" or "no change" is frozen in code and text before any quiet-host number exists (D-38-02).

### Out of scope, stated so no task drifts into it

- UI-01 (accepted limitation, the owner's call, Phase 27 D-27-08). The measurement supplies evidence for a ruling; no document says UI-01 is satisfied.
- Any measurement on a loaded host as a result. A loaded run is a labelled mechanics run only (`REALM_OMP_RESPONSIVENESS_ALLOW_LOADED`); it neither triggers a code change nor closes OI-11.
- Changing the thresholds (1000 ms, 500 ms, 40 probes, 10 s, 0.5 load per CPU, 250 ms probe interval) or the verdict function `responsivenessProblems`.
- Process priority tuning of the daemon or of its children (a loaded-host mitigation; D-38-05 rejected list).
- Weakening fail closed: the order "mode applied, then client adopted, then painted" in `attach` (`src/omp/plugin.ts`), the `tool_call` guard, the `REALM_NOT_ACTIVE` refusal of every Realm tool with no client.
- Any model-driven tool call through Omp, FS-02, TD-06, TD-10, the product spec, `CHANGELOG.md`, version fields, `release/milestone.json`.
- Phases 39 to 43.
</domain>

<decisions>
## Implementation Decisions

### Evidence (every fact below: source, read date 2026-11-18, tier)

Tiers: **Observed** = read in this worktree today; **Measured** = recorded by an earlier live run and cited from the Phase 36 ledger or `docs/integration/omp.md`; **Derived** = arithmetic on Measured numbers; **[INFERENCE]** = reasoning from those, to be proven or refuted by a named task.

| ID | Fact | Source | Tier |
| --- | --- | --- | --- |
| E-38-01 | The `session_start` and `session_switch` handlers return synchronously. They call `beginSession`, which arms the status poll and starts the attach with `runDetached(session, attach(session))` (or `attachCycle` with re-attach on). No hook awaits the attach, `ensure`, `up` or a spawn. `test/omp/plugin.test.ts` "OMP-01: session start attaches the daemon for the session cwd and returns while connecting (P5-D8)" pins that the handler returns while the attach is pending and only the connecting paint has landed. | `src/omp/plugin.ts` lines 692 to 740 (`beginSession`, the two `pi.on` registrations), 321 (`runDetached`); `test/omp/plugin.test.ts` | Observed |
| E-38-02 | The attach starts in a microtask: `Promise.resolve().then(...)` whose callback calls `options.attachDaemon(ctx.cwd)`, then `client.status()`, then `setHostMode(...)`, all inside `Promise.race` against the startup budget (200 000 ms). Until the race settles `session.client` is null, so every Realm tool call is refused with `REALM_NOT_ACTIVE` before any daemon call (`callDaemon`, line 748) and the `tool_call` guard cannot read a status (`readStatus` rejects with `REALM_NOT_ACTIVE`) and refuses guarded tools. Existing tests: "B2 / T2: with no daemon attached the Realm write is refused with REALM_NOT_ACTIVE, no daemon is called" and "B2: a Realm write with no session passes the guard, and the tool refuses it without a daemon call". | `src/omp/plugin.ts` lines 417 to 500, 748 to 775, 830 to 880, 930 to 958; `test/omp/plugin.test.ts` lines 1191, 1259 | Observed |
| E-38-03 | The synchronous work on the Omp loop in the attach path is small and bounded: `selectionOf` (`realpathSync` of the workspace root, `src/daemon/client.ts` line 142); one `statSync` and one small `readSync` of `daemon.log` per 100 ms poll (`daemonLogSize`, `readLogFrom`, `src/daemon/ensure.ts`); once, when the socket is absent, `launchFilteredDaemon` (`src/cli/main.ts` lines 434 to 459): a PATH scan with `statSync` (`findNodeBinary`, only under Bun), `mkdirSync`, `openSync`, `fchmodSync`, then `child_process.spawn(..., { detached: true })` and `unref()`. There is no `Atomics.wait`, no `execSync`, no `spawnSync` and no synchronous socket I/O in `src/omp`, `src/host/attach.ts`, `src/host/boot-observer.ts`, `src/daemon/client.ts`, `src/daemon/channel.ts` (client side) or `src/daemon/ensure.ts`. The presence marker write (`src/host/presence.ts`) is a handful of small synchronous file operations after the attach settles. | grep for `Sync(` and `Atomics` over the files named, 2026-11-18 | Observed |
| E-38-04 | `src/omp/extension.ts` line 16 imports `startDetachedDaemon` from `../cli/main.js`. The static import closure of `src/omp/extension.ts` is about 96 modules against 9 for `src/omp/plugin.ts`, and 44 of them lie in `src/cli`, `src/doctor`, `src/mcp`, `src/acp`, `src/runtime` and `src/audit` (the CLI, the MCP server, the ACP agent, the doctor checks, the runtime driver channel). None is needed by the Omp path except the one daemon-launch function. The load is synchronous module evaluation inside the Omp process, before the extension factory returns. The count is a regex walk of `import` and `export ... from` specifiers (type-only imports excluded); plan 38-02 Task 1 recomputes it exactly. | `src/omp/extension.ts`; planning-time walk, 2026-11-18 | Observed (approximate count) |
| E-38-05 | `src/cli/main.ts` is the one module of the CLI and Omp wiring allowed to call `spawn(` and to import `node:child_process` (lint rule P6-D1: `CHILD_PROCESS_ALLOWED`, `SPECIAL_SRC`, `SPAWN_MESSAGE` in `eslint.config.js`; `src/cli/main.ts` is in `FORBIDDEN_MODULES` of `scripts/check/gate-closure.mjs`). `src/cli/main.ts` is 923 lines (module-size limit 1000). `launchFilteredDaemon`, `startDetachedDaemon`, `defaultSpawnDaemon`, `withDaemonLog`, `SpawnDaemon` and `SpawnedProcess` (lines 165 to 177, 285 to 293, 396 to 410, 434 to 465) live there. | `eslint.config.js`, `scripts/check/gate-closure.mjs`, `src/cli/main.ts` | Observed |
| E-38-06 | The harness sends the first `get_state` at Omp process start, before Omp's `ready` frame. The baseline test waits for `ready` (`omp.ready(OMP_READY_TIMEOUT_MS)`) and probes after it. So the cold-attach window includes Omp's own boot (binary start, profile, extension load, first RPC read), and a probe sent at t = 0 has a latency equal to the time Omp takes to start serving. Any boot over 1000 ms exceeds the maximum threshold by itself, with or without an extension. | `test/integration/omp-responsiveness.test.ts` (`measureBaseline`, the cold-attach test, `probeLoop`); `test/support/omp-rpc.ts` (`ready`) | Observed |
| E-38-07 | OI-11, loaded host (load 8.16 before the baseline, 9.00 before the extension session, 11.54 after; 8 CPUs): baseline 41 probes, 0 unanswered, maximum 271 ms, median 6 ms, 95th percentile 201 ms, longest gap 514 ms. Cold attach: 97 probes over 24001 ms, 91 answered, 6 unanswered (a probe is unanswered after 10 000 ms), maximum 9868 ms, median 18 ms, 95th percentile 8910 ms, longest gap 11369 ms, `realm active` reached. | `36-DISPOSITIONS.md` OI-11, F-5 | Measured (loaded host, labelled) |
| E-38-08 | The OI-11 numbers fit one stall of about 11.4 s with no answer at all, then a burst: probes are sent at 0, 250, ... ms; the six probes sent at 0 to 1250 ms time out at 10 000 ms after their send, which is before 11 369 ms (unanswered: 6, as measured); the probe sent at 1500 ms would time out at 11 500 ms, after 11 369 ms, so it is answered with latency 11 369 - 1500 = 9869 ms (maximum measured: 9868 ms); the median of 18 ms says every probe after the burst was answered promptly. So Omp served nothing for the first 11.4 s of the window and then answered every queued probe at once. | arithmetic on E-38-07 | Derived |
| E-38-09 | `docs/integration/omp.md`, UI-01 detail: on 2026-10-23 the attach alone failed in about 1.3 s with a worst event-loop lag of 71 ms under Node and 239 ms under Bun, yet inside Omp the failure painted about 6 s after launch and a `get_state` sent one second after launch was answered only after it; separate probes (a plugin-free extension, a `tool_call` handler, a registered command, a managed timer, a detached spawn) each answered `get_state` within about one second. On 2026-10-28 (Omp 18.12.6, load near 30) Omp took 25 s to paint its first screen and keystrokes then echoed within 0.2 to 1.2 s through a 24 s cold attach. | `docs/integration/omp.md` lines 209 to 213 | Measured |
| E-38-10 | From E-38-08 and E-38-09: the stall begins at process start and ends before the attach finishes, in an extension that on its own parts (hook, command, timer, spawn) does not delay `get_state`. What differs between the realm extension and each of those probes is the module graph it loads (E-38-04) and the daemon, podman and sandbox work it starts. [INFERENCE] The stall is Omp's own boot plus the extension's synchronous load, not the hook; this cannot be separated from the data of 2026-11-18, which has no `ready` frame time and no control without the extension. | E-38-04, E-38-06, E-38-08, E-38-09 | [INFERENCE] |
| E-38-11 | `OmpSession` records frames in arrival order with no timestamp; `status()` returns the last `setStatus` text for key `realm`. The probe loop records only send time and latency. So the data cannot say when `ready` arrived or when the first `connecting` paint arrived. | `test/support/omp-rpc.ts` lines 359 to 410 | Observed |
| E-38-12 | Host at planning time (2026-11-18): 8 CPUs, load averages 7.85, 14.30, 12.16 (not quiet: about 1.0 to 1.8 per CPU). Omp 18.22.2. The host is shared with other agents; earlier windows found it quiet never (F-4: 1.67, 0.76, 1.47 per CPU). Quiet is rare, so the window protocol waits for it (D-38-04). | `nproc`, `uptime`, `omp --version`, 36-DISPOSITIONS F-4 | Observed |

### D-38-01. What the code reading changes about the plan (OMPR-02 wording)

OMPR-02 says "the Omp extension path is made non-blocking (it answers before `up` completes, as `realm mcp` does since Phase 33)". For `realm mcp` that meant moving the handshake ahead of `ensure` and `up`. The Omp hook already does that (E-38-01, E-38-02): the handler returns at once and every Realm tool call is refused with `REALM_NOT_ACTIVE` until a client is adopted. There is no await on `ensure` or `up` in an extension hook, and no synchronous wait (E-38-03). So the plan does not assume that a non-blocking restructuring of the hook is needed. It measures, localizes the stall, and changes code only where the localized cause is in the extension's own work. The candidates the code reading leaves are:

- **C1, the eager load of the CLI graph** (E-38-04, E-38-05): about 96 modules evaluated synchronously in the Omp process to reach one function.
- **C2, the synchronous prefix of the attach** on the session_start turn: `selectionOf` and the first probe in a microtask (E-38-02, E-38-03); small, and changed (K2) only together with C1 when a stall during the attach cannot be localized.
- **C3, Omp-side work triggered by the attach's end**: `setHostMode` calls `pi.setActiveTools`, which Omp executes (the fail-closed removal of built-ins). Not changeable in the extension without moving the order that fail closed depends on (D-38-05, rejected).
- **C4, CPU contention** from the daemon, podman and the sandbox started by the attach, on a loaded host. Absent by definition on a quiet host.
- **C5, Omp's own boot inside the harness window** (E-38-06): a harness effect, not an extension effect.

C4 cannot occur in a valid run. C5 and C1 explain E-38-08 equally well from the data in hand; only the diagnostics of D-38-03 separate them.

### D-38-02. The frozen decision rule (OMPR-01, OMPR-02)

Frozen in this document and, in plan 38-01 Task 1, in code (`test/support/responsiveness-decision.ts`) with a hermetic test that pins every constant and every row below, before any quiet-host run exists. No task edits a constant or a row after seeing a number; a wrong rule is a finding and a replan, never a silent edit. Plan 38-01 Task 3 reads the rule to the owner before the first attempt, and plan 38-03 applies it unchanged.

**Constants.** Probe interval 250 ms; maximum latency 1000 ms; 95th percentile 500 ms; minimum probes 40; minimum window 10 000 ms; the unanswered bound 10 000 ms per probe (all existing in `test/support/responsiveness.ts` and the harness, unchanged). New: `MIN_VALID_RUNS = 3`, `MAX_ATTEMPTS = 6`, `BOOT_EXCESS_MAX_MS = 250` (one probe interval: a difference smaller than the measurement resolution cannot be told from noise).

**A valid run** (one attempt of the window that counts toward the decision) has all of: the one-minute load per CPU below 0.5 at the harness's before-baseline reading AND at its before-extension-session reading (the second is recorded by the harness today but not enforced; plan 38-01 Task 2 makes it a validity condition of the run record, not a test assertion; both use the harness function `quietHost`, which accepts a load per CPU at most equal to the 0.5 ceiling, while the window's wait is stricter: strictly below 0.5); the baseline test of the same run passed; no realm daemon of the account running at the start; `realm active` reached within 360 s; the run's control (below) produced a first answer. A run that is not valid is recorded with its reason and counts for nothing: it is not a pass and not a fail. At most `MAX_ATTEMPTS` attempts are made in the window; fewer than `MIN_VALID_RUNS` valid runs gives outcome VOID.

**Per valid run, three measures:**

1. `verdict` = `responsivenessProblems(summary)` of the cold attach, the existing verdict. Empty is a pass. It splits into the shortness problems (fewer than 40 probes, window under 10 s) and the latency problems (any unanswered, maximum over 1000 ms, 95th percentile over 500 ms).
2. `X`, the boot excess: the time of the first answered probe of the cold attach (send time plus latency, from process start) minus the largest first-answer time among the valid control runs of the window. The control is Omp with no extension, probed from process start (D-38-03).
3. `VP`, the serving verdict: the latency problems recomputed over only the probes sent at or after the first answer of the cold attach (Omp is serving from then on).

**Per valid run, the case:**

| Case | Condition | Meaning |
| --- | --- | --- |
| `pass` | `verdict` empty | no problem |
| `short-window` | only shortness problems, no latency problem | the attach finished before the window minimum; a harness defect |
| `serving-stall` | a latency problem and `VP` not empty | Omp stalls after it started serving, during the attach: extension path |
| `boot-delay` | a latency problem, `VP` empty, `X` over `BOOT_EXCESS_MAX_MS` | the extension delays Omp's start beyond its own boot: extension load path |
| `own-boot` | a latency problem, `VP` empty, `X` at most `BOOT_EXCESS_MAX_MS` | Omp's own boot is inside the window and exceeds the maximum by itself: a harness defect |

**Outcome of the window:**

| Outcome | Condition | Consequence |
| --- | --- | --- |
| `VOID` | fewer than 3 valid runs in 6 attempts | no verdict. OI-11 stays Carried (no quiet slot) with the load readings. Plans 38-02 and 38-03 do not run. OMPR-01 is not met and is reported as not met. |
| `PASS` | 3 valid runs, every case `pass` | OMPR-02: no code change was needed. Plans 38-02 and 38-03 do not run. OI-11 closes. |
| `CODE` | 3 valid runs, at least one `serving-stall` or `boot-delay` | Plan 38-02 changes the extension path (D-38-05) and plan 38-03 re-proves; or, when every such stall ends where Omp applies the tool set (D-38-05 no-change row), plan 38-02 records the named cause and plan 38-03 does not run. |
| `HARNESS` | 3 valid runs, no `serving-stall` or `boot-delay`, at least one `own-boot` or `short-window` | The stall is not the extension's. Plan 38-02 corrects the harness window only (D-38-06), no product code; plan 38-03 re-proves on the corrected window. |

`CODE` takes precedence over `HARNESS` when both appear. The thresholds of the verdict never move: the corrected harness of a `HARNESS` outcome applies the same constants to the corrected window. The uncorrected runs stay recorded as findings; the closure rests on the re-proof only.

**Re-proof rule (plan 38-03).** The same protocol on the changed build (`CODE`) or the corrected harness (`HARNESS`): 3 valid runs of 6 attempts, every case `pass` means closed. Anything else means one named finding with its attribution and OI-11 stays Carried with the numbers. One change iteration only: a second code change is a new phase and the owner's call.

### D-38-03. Wave 1 harness additions: diagnostics only, verdict untouched (plan 38-01 Tasks 1 and 2)

`responsivenessProblems` keeps its behavior and its output strings byte for byte (the existing `test/support/responsiveness.test.ts` is the pin). Its latency conditions are factored into an exported `latencyProblems(summary, bounds)` that it calls, so the decision rule and the verdict share one definition. Additions:

- `test/support/omp-rpc.ts`: `OmpSession.frameArrivalsMs`, a readonly array parallel to `frames`, each entry `performance.now()` at arrival minus the session's construction time. Additive; no caller changes.
- `test/support/responsiveness-decision.ts` (new, pure, no process, no clock): `firstAnswerMs`, `servingProblems`, `bootExcessMs`, `startupOrder(frames, arrivals)` (the ready frame time and the first and last `realm` `setStatus` frame times, and whether `ready` precedes the first realm paint), `classifyRun`, `decideWindow`, the three constants. Hermetic test `test/support/responsiveness-decision.test.ts` covers every row of both tables, the boundaries (`X` = 250 and 251; `MIN_VALID_RUNS` 2 and 3), the precedence, and pins the constants.
- `test/integration/omp-responsiveness.test.ts`: a third gated test, the control (Omp with no extension, same arguments as the baseline, probed from process start with the same probe loop; stop when at least one probe is answered and 12 s have elapsed, or 60 s); the cold-attach test records per run the load readings, the frame timeline (ready, first and last realm paint), the first answer time, the serving verdict and the case, and writes `omp-responsiveness.attach.record.json` and `omp-responsiveness.attach.timeline.txt` (and the control writes `omp-responsiveness.control.record.json`) to the evidence directory. The cold-attach test's own assertions are unchanged.

### D-38-04. The quiet-host wait and the window protocol (plan 38-01 Tasks 3 to 5, plan 38-03)

Owner authorization of 2026-11-18: live windows are authorized when a phase needs them, under the same rules (realmlive account, shared live lock, residue checks before and after, evidence outside the repository). The window waits for quiet: before the first attempt, three readings of the one-minute load average per CPU, 60 s apart, all below 0.5; if the load rises above 0.5 between attempts the person waits again. There is no deadline in the plan; the person may stop the wait, and then the outcome is VOID. The person runs as root only to copy the tree, then as the realmlive account with `env -i` and exactly the variables the tests need; the built tree is copied to the realmlive home (no checkout path dependence); the residue snapshot (containers, realm sandboxes, daemon processes, control socket, hosts entries, workspace entries, state directory entries) is taken before the window, after each attempt and at the end; any change in the counts is a stop (the Phase 18 stop rule). The harness never sets a gate variable; the person sets them for the command. Evidence is checked for secrets before it is cited. The person may ask the owner to pause other work on the host to reach a quiet slot; no process of another agent is stopped by this plan.

### D-38-05. Wave 2, outcome CODE: the extension-path change set, selected by the case (plan 38-02)

Selection by evidence, not by preference:

- **K1, a light daemon-launch module** (case `boot-delay`; also chosen with K2 for a `serving-stall` that is not localized to Omp-side work). Move `launchFilteredDaemon`, `startDetachedDaemon`, `defaultSpawnDaemon`, `withDaemonLog` and the types `SpawnDaemon` and `SpawnedProcess` from `src/cli/main.ts` to a new `src/daemon/launch.ts`, import them from there in `src/cli/main.ts` and `src/omp/extension.ts`, and migrate every importer (clean cutover, no re-export from `src/cli/main.ts`): the nine test and test-support files that import `SpawnDaemon`, `launchFilteredDaemon` or `startDetachedDaemon` from `src/cli/main.js` (`test/cli/cli.test.ts`, `test/cli/mcp-attach.test.ts`, `test/daemon/e2e.test.ts`, `test/daemon/launch-runtime.test.ts`, `test/daemon/spawn-env.test.ts`, `test/integration/enforce-default.test.ts`, `test/integration/host-boot-isolation.test.ts`, `test/support/boot-matrix-rig.ts`, `test/support/stdio-world.ts`) and the comment in `src/daemon/spawn-env.ts`. After it `src/omp/extension.ts` reaches no module under `src/cli`, `src/doctor`, `src/mcp` or `src/acp`. This changes the lint invariant P6-D1 (the only module allowed to `spawn(`): `eslint.config.js` `CHILD_PROCESS_ALLOWED`, `SPECIAL_SRC` and `SPAWN_MESSAGE` name `src/daemon/launch.ts` instead of `src/cli/main.ts` (which no longer imports `node:child_process`), `FORBIDDEN_MODULES` of the gate closure script gains `src/daemon/launch.ts`, and the documents that name the spawn site are updated. Behavior of the daemon launch (allowlisted environment, the Bun Node lookup, the log file at mode 0600, `unref`) is unchanged and pinned by `test/daemon/launch-runtime.test.ts`, `test/daemon/spawn-env.test.ts`.
- **K2, a macrotask before the attach** (case `serving-stall` that is not localized to Omp-side work, together with K1: the extension-owned candidates C1 and C2 are all applied because the data cannot separate them). The attach's first step (`options.attachDaemon`) moves from the microtask after the hook returns to a `setImmediate` turn, guarded by `isCurrent()` so a session that ended in between never starts an attach or a spawn. Net change to `src/omp/plugin.ts` at most 6 lines (the file is 991 lines; the limit is 1000, so a larger change goes to a new module).
- **No change** (a `serving-stall` run whose stall ends within 500 ms of the last realm status paint): the stall ends where the attach ends, which is where Omp applies the host tool set change (C3, `setActiveTools`); no extension change can remove it without moving the fail-closed order. Plan 38-02 records the attribution; if that run is the only reason for `CODE`, the plan stops, plan 38-03 does not run, and OI-11 is Carried with a named cause. This is a finding, not a pass.

The selection is made by the table in plan 38-02 Task 1, applied as written; it is not tuned to the numbers.

Rejected, with the reason: reordering `setHostMode` after the paint or after client adoption (the mode must be applied before the client is adopted and published: P16 b; it would let a call reach a daemon before the tool set matches the policy); lowering the daemon's or its children's priority (`nice`) to favor Omp (a loaded-host mitigation, changes attach duration, outside a quiet-host measurement); moving the attach into a worker thread or a separate process (the plugin holds the client, the timers and the paint; a new process model is a design change with no evidence behind it); a dynamic `import()` of `src/cli/main.js` at spawn time (moves the same synchronous evaluation to the middle of the attach instead of removing it).

### D-38-06. Wave 2, outcome HARNESS: correct the window, not the product (plan 38-02)

The corrected cold-attach verdict window starts at the `ready` frame (as the baseline does) and ends when `realm active` is reached AND at least `MIN_WINDOW_MS` have elapsed since `ready` (so a quiet attach that finishes in under 10 s is probed for the full minimum instead of failing as `short-window`). Probes sent before `ready` are kept in the CSV and summarized separately as the boot samples (their first answer time is recorded as the Omp boot time); they are not part of the verdict. The constants and `responsivenessProblems` are unchanged. `classifyRun` takes the ready time: the verdict and the shortness conditions are read over the window samples, the boot excess `X` is still read from the first answer over all samples, so a corrected run is `pass` only when the corrected verdict is empty and `X` is at most `BOOT_EXCESS_MAX_MS`; a latency problem in the window is `serving-stall`; `X` over the bound is `boot-delay`; `own-boot` cannot arise. This is a method correction justified by E-38-06 and the control data; it is stated as such in the docs, with both the uncorrected and the corrected numbers. Open question OQ-38-01 asks the owner whether this reading is acceptable; the default is yes because the thresholds are unchanged and the extension is still measured over its whole attach.

### D-38-07. Fail closed and the not-active window of the Omp path (plans 38-02, 38-03)

No change may let a mutation run before the session is ready. Existing tests pin it (E-38-02). If K1 or K2 is built, plan 38-02 adds `test/omp/attach-window.test.ts`: with a stand-in daemon that holds `up` open (and, for K2, with the session ended before the deferred turn), the handler returns, the status item reads connecting, a Realm `write` and `exec` are refused with `REALM_NOT_ACTIVE` and never reach the stand-in, a guarded built-in call is blocked, no daemon is spawned for an ended session, and after `up` completes the same session adopts the client and the next call is forwarded. The status vocabulary (`STATUS_LABELS`, `displayStatus`), the not-active refusal and the audit lines are unchanged; the existing Omp, boot-matrix and contract tests are the proof (`test/omp/plugin.test.ts`, `test/omp/extension.test.ts`, `test/omp/tools.test.ts`, `test/host/boot-no-down.test.ts`, `test/host/manifest.test.ts`, `test/integration/omp-guard.test.ts`).

### D-38-08. Records, labels and the OI-11 row (OMPR-03)

The numbers and host facts go in `38-MEASUREMENT.md` (this phase) and in `docs/integration/omp.md`, in every outcome: date, Omp version, CPU count, the load readings, the number of probes, unanswered, maximum, median, 95th percentile, longest gap, window, the control first-answer time, the boot excess, the case of each run, the outcome, the commit. The final label of OI-11 is one of: `Closed (quiet host, thresholds passed, no code change)`; `Closed (quiet host, thresholds passed after the extension-path change)`; `Closed (quiet host, thresholds passed on the corrected window)`; `Carried (quiet host, thresholds failed after the change; cause named)`; `Carried (quiet host, thresholds failed; cause named, no extension-side change possible)` (plan 38-02 found that every stall ends where Omp applies the tool set and made no change); `Carried (no quiet slot)`. The OI-11 row is the Phase 36 ledger's (`36-DISPOSITIONS.md` Part C). That ledger is archived; an append-only dated update line under Part C records the new label and cites `38-MEASUREMENT.md`; no earlier line is edited (OQ-38-02). `docs/integration/omp.md` gets a dated paragraph under "UI-01 detail" and a changed status cell of row UI-01 that states what was measured and keeps the sentence that the status of UI-01 is the owner's call. Live evidence stays outside the repository and is cited by date and file name (no path).

### D-38-09. Hygiene constraints for every plan

- Gates: `src/contract` imports no `host/` or `capability/`; modules reachable from the exec gate closure do not reach `node:child_process`; `src/cli/main.ts` and `src/omp/plugin.ts` stay under the 1000-line limit (`node scripts/check/module-size.mjs`); the export-usage gate (`node scripts/check/export-usage-gate.mjs`): a test-only export of a new `src` module needs an allowlist entry in `scripts/check/export-usage-allowlist.json` and a stale entry fails.
- Lint: no unnecessary conditions after assert narrowing, `restrict-template-expressions` (numbers go through `String(...)`), `no-base-to-string`, `prefer-const`, `void test(...)` for tests.
- Tests pass as a regular non-root user. The new hermetic tests use no clock and no real socket outside a temporary directory, no gate variable, and no file basename containing `mcp` or `acp` (the taxonomy test; `cli/mcp-attach.test.ts` is the one exception).
- The error catalogue stays at 29 codes; this phase adds none.
- Markdown: no host-local absolute path; raw angle tokens outside code fences are escaped; HTML-like plan task blocks hold no angle brackets. `node scripts/check/host-paths.mjs` and `npm run check:docs` pass (the default-mode docs guard included).
- Capability tokens default to enforce: a live Omp session reaches the daemon only with the host label `omp` (the extension's client attaches as `omp`, `src/omp/extension.ts`); no policy edit is part of this phase.
- Commit conventions: a breaking change carries the `!` marker and lands as a merge commit. K1 changes only internal module locations and test imports; if a documented contract changed incompatibly the commit subject carries `!`. This phase expects none.
- Docs are updated in the same pull request as the code. No `CHANGELOG.md`, no version field.

### D-38-10. Threat model (summary; each plan carries its STRIDE rows)

| ID | Category | Threat | Mitigation |
| --- | --- | --- | --- |
| T-38-01 | Tampering | A non-blocking or deferred attach lets a mutation run before the session is ready | D-38-07: client stays null until adopted, existing B2 tests, new attach-window test; no reorder of `setHostMode` |
| T-38-02 | Repudiation | A loaded, void or failed run is relabelled as a pass, or the rule is bent after the numbers are seen | D-38-02: the rule is frozen in code and text first; a hermetic test pins it; void runs are recorded with reasons; a failure is a finding |
| T-38-03 | Information disclosure | Evidence (frames, stderr, timeline) holds a token or a host path | secret search over EVIDENCE_DIR before citing; no path in the repository; the harness never prints a secret |
| T-38-04 | Denial of service | A window leaves a daemon, a container, a socket or a presence marker behind, or runs while another live run holds the stack | shared lock, before and after residue snapshots, the harness cleanup (`realm down`, state entries removed), stop on any count change |
| T-38-05 | Elevation of privilege | K1 widens the `child_process` allowlist beyond the one moved function | the allowlist names exactly `src/daemon/launch.ts`; the lint rule and `FORBIDDEN_MODULES` keep `src/cli/main.ts` and the new module out of the exec gate closure; `test/daemon/launch-runtime.test.ts` pins the environment allowlist |
| T-38-06 | Tampering | The harness correction (HARNESS) is used to hide a real stall | D-38-06: boot samples kept and summarized; the correction applies only when `VP` is empty and the boot excess is within one probe interval against the control |

## Canonical References

- `.planning/MILESTONE-CONTEXT.md` (D-v6-2, constraints, limits); `.planning/REQUIREMENTS.md` (OMPR-01 to OMPR-03); `.planning/ROADMAP.md` (Phase 38 block)
- `.planning/milestones/v5.0-phases/36-live-re-verification-of-v1-0-open-items/36-DISPOSITIONS.md` (OI-11, F-4, F-5, Part C), `36-CONTEXT.md` (D-36-06)
- `.planning/milestones/v5.0-phases/33-cold-attach/33-CONTEXT.md` (serve-early for `realm mcp`: the precedent, and the window protocol)
- `.planning/milestones/v5.0-phases/35-capability-token-evidence/35-01-PLAN.md` (the copy, the scrubbed environment, the non-root run)
- `docs/integration/omp.md` (UI-01 row and detail), `docs/integration/host-plugin-contract.md`
- `src/omp/extension.ts`, `src/omp/plugin.ts`, `src/omp/host-tools.ts`, `src/omp/reattach.ts`, `src/host/attach.ts`, `src/daemon/ensure.ts`, `src/cli/main.ts`
- `test/integration/omp-responsiveness.test.ts`, `test/support/responsiveness.ts`, `test/support/responsiveness.test.ts`, `test/support/omp-rpc.ts`, `test/support/omp-live.ts`, `test/omp/plugin.test.ts`, `test/omp/extension.test.ts`
- `eslint.config.js`, `scripts/check/gate-closure.mjs`, `scripts/check/module-size.mjs`, `scripts/check/export-usage-gate.mjs`

## Existing Code Insights

- The decision of what blocks Omp cannot be read out of Omp's binary; the code in this repository shows the hook is detached and the sync work is small (E-38-01 to E-38-03). The one large synchronous cost the extension owns is its module graph (E-38-04). Everything else in the window is Omp's own boot (E-38-06) or work in other processes.
- `plugin.ts` stays free of environment and runtime reads; K2 uses the global `setImmediate` only, no new option.
- `launchFilteredDaemon` already takes the spawn and the Node lookup as parameters, so K1 is a move, not a redesign.
- `test/support/omp-rpc.ts` is shared by the live Omp tests; the arrivals array is additive.

## Wave Structure

| Wave | Plan | What | Condition |
| --- | --- | --- | --- |
| 1 | 38-01 | Decision rule in code, harness diagnostics and control, the quiet-host window (three valid runs), the record, the decision, and the docs for PASS and VOID | always |
| 2 | 38-02 | The change set: K1 and/or K2 with tests, docs, gates (CODE); or the harness window correction (HARNESS); or the recorded attribution with no change | only if 38-01 recorded CODE or HARNESS |
| 3 | 38-03 | The re-proof window, the final label, the docs and the ledger | only if 38-02 changed code or the harness |

## Requirement coverage

| Requirement | Plan | Where |
| --- | --- | --- |
| OMPR-01 | 38-01 | the window (Tasks 3 to 5) and the record (Task 6): number of probes, maximum, 95th percentile, host facts, pass or finding |
| OMPR-02 | 38-01 (PASS: no change recorded), 38-02 (CODE or HARNESS), 38-03 (the repeat) | the decision rule, the change set, the re-proof |
| OMPR-03 | 38-01 (every outcome: numbers in the phase and in `docs/integration/omp.md`), 38-03 (the final label after a change) | D-38-08 |

## Open Questions (none blocks plan 38-01)

- **OQ-38-01 (harness correction).** If the control shows Omp's own boot exceeds the harness maximum, may the verdict window start at the `ready` frame (as the baseline does) with the thresholds unchanged? Default taken: yes, labelled a method correction with both numbers shown (D-38-06). It is only reached in outcome `HARNESS`, after the data exist.
- **OQ-38-02 (the archived ledger).** OMPR-03 asks that the OI-11 row reads closed. The Phase 36 ledger is archived with the v5.0 phases. Default taken: an append-only dated update line under Part C of `36-DISPOSITIONS.md`, no earlier line edited, and the same row in `38-MEASUREMENT.md`. If the owner prefers the archive untouched, `38-MEASUREMENT.md` alone carries the row and `docs/integration/omp.md` cites it.
- **OQ-38-03 (a quiet slot may not come).** The host has not been quiet in four earlier tries (F-4) and is not quiet at planning time (E-38-12). The window has no deadline; a person decides how long to wait or asks the owner to pause other work. If no slot comes, the outcome is VOID, OMPR-01 is reported unmet and OI-11 stays open with the readings. No relaxation of the 0.5 ceiling is available to the executor.
- **OQ-38-04 (Omp as the realmlive account).** The window runs Omp as the realmlive account (its Podman 5.7.1 stack is the production stack; the daemon the extension starts runs as the account that runs Omp). Plan 36-03 ran it that way on 2026-11-18, so it is expected to work; Task 4 records `omp --version` as that account. If it cannot run, the window is BLOCKED with that reason; running Omp as another account on a stack it cannot reach would not be a cold attach on the production stack.

## Success Criteria (from the roadmap, made observable)

1. At least three valid quiet-host cold-attach runs (or the VOID outcome with the load readings) are recorded with probes, maximum, 95th percentile, median, longest gap, window, the control first-answer time, the boot excess, and host facts (load before and after, CPU count, Omp version, date, commit), in `38-MEASUREMENT.md` and in `docs/integration/omp.md`.
2. The outcome follows the frozen rule: PASS records that no code change was needed; CODE or HARNESS leads to the change set and a re-proof with the same rule; no run is relabelled.
3. The status vocabulary, the not-active refusal and the audit lines are unchanged (existing Omp, boot and contract tests pass; the attach-window test exists if the path changed).
4. The OI-11 row carries one of the labels of D-38-08, on the quiet-host evidence, or stays open with the numbers and a named reason.

## Deferred Ideas

- Lowering the priority of the daemon and its children during a cold attach on a loaded host (a mitigation, not a fix; needs its own measurement).
- A progress channel from the daemon to the Omp status item during `up` (a product feature).
- A keystroke-echo probe (a UI-level measure) beside `get_state`; UI-01 is the owner's call.
</decisions>
