# Phase 46: Rapid stop then up (F-41-1) - Context

**Gathered:** 2026-11-19, from `.planning/MILESTONE-CONTEXT.md` (D-v7-3), the STOP-01 to STOP-04 text of `.planning/REQUIREMENTS.md` (v7.0), the Phase 46 block of `.planning/ROADMAP.md`, `.planning/milestones/v6.0-phases/41-daemon-teardown-flake/41-VERIFICATION.md`, `41-02-SUMMARY.md` and `41-CONTEXT.md`, `.planning/milestones/v6.0-MILESTONE-AUDIT.md` (finding F-41-1), the F-41-1 paragraph of `docs/integration/runtime-decision.md`, the Phase 41 live test (`test/integration/daemon-stop-live.test.ts`, `test/support/daemon-stop-live.ts`), the production live helpers (`test/support/production-live.ts`, `test/integration/production-driver.test.ts` settle step), and a fresh read of the code named in the evidence table, at the branch head of this worktree.
**Status:** Planned (four plans, nothing executed). This phase edits none of ROADMAP, STATE or REQUIREMENTS; the orchestrator registers the plans.
**Format and depth:** the v6.0 phases (CONTEXT with evidence and decisions, plans with frontmatter, a threat model per plan, owner-authorized live windows with residue checks and evidence outside the repository).
**Linear:** SPE-34731.

## Phase Boundary

Finding F-41-1 (Phase 41, 2026-11-18): in a live loop of stop-then-`realm up` on one sandbox name with no settle, iteration 5 of variant a failed at `realm up` with `OPENSHELL_START_FAILED` right after iteration 4's stop, with a status notice that a previous daemon's sandbox was destroyed. The cause was never established; the only statement in the repository is an [INFERENCE] (a late supervisor or driver teardown of the previous iteration reached the new sandbox). A second observation from the same window is open: one variant c stop wrote no `daemon.stopped` row that the test found.

This phase does four things, in order, and each later one depends on the evidence of the one before:

1. **Reproduce (STOP-01).** A gated live harness that loops stop-then-`up` on one sandbox name with no settle, under three variants (a plain stop, a stop under CPU load, a stop in the middle of an up) and one control, keeps the timeline of every component outside the repository, and records either a reproduction or 50 consecutive clean iterations per variant.
2. **Establish the cause (STOP-02).** From that timeline, name the component whose late teardown, or which missing wait, reaches the new sandbox, with timestamps and the cause code the refusal carries; replace the INFERENCE paragraph in `docs/integration/runtime-decision.md`.
3. **Fix or bound it (STOP-03).** A change with an explicit timeout on every wait, fail closed and the no-orphan guarantee kept, the `daemon.stopped` contract and the 29-code error catalogue unchanged, proved by a hermetic test that fails first.
4. **Prove it live (STOP-04).** At least 20 consecutive stop-then-`up` iterations on one sandbox name with zero `OPENSHELL_START_FAILED`, `failedTeardowns` 0 in every `daemon.stopped` row and zero residue; the variant c missing row explained or recorded as a finding.

A non-reproduction, a different failure and a VOID window are legal outcomes. None is relabelled: the roadmap and STOP-01 say that if 50 consecutive iterations per variant do not reproduce it, the phase records the non-reproduction, pins the suspected mechanism hermetically and carries F-41-1 with that evidence instead of claiming a fix.

### Out of scope, stated so no task drifts into it

- Any change to the `daemon.stopped` row shape (`code`, `failedTeardowns`), to the teardown stage bounds of Phase 41 (`src/runtime/teardown-stages.ts`, `src/lifecycle/bounds.ts`) other than a wait this phase must add, or to the 29-code error catalogue (no new code; the refusal that a wait produces uses an existing code).
- The ship-flow, release, version and CHANGELOG (docs are updated in the same pull request; no CHANGELOG edit, no version field).
- Any widening of what the daemon, the driver or a sandbox may do; fail closed and the no-orphan guarantee are kept.
- A model-driven tool call, Omp responsiveness (Phase 45), the legacy kimi work (Phase 47), Grok attribution (Phase 48).
- Changing the Phase 41 live test or its results; the Phase 41 records are cited, never edited.

## Implementation Decisions

### Evidence (every fact below: source, read date 2026-11-19, tier)

Tiers: **OBSERVED** (a live result recorded in the repository by an earlier phase), **READ** (code or document read in this worktree), **INFERENCE** (a reading that no live data has shown).

| ID | Fact | Source | Tier |
| --- | --- | --- | --- |
| E-46-01 | Variant a iteration 5 failed at `realm up`: exit 1, `OPENSHELL_START_FAILED` ("OpenShell failed to start inside the session container"), right after iteration 4's stop on the same sandbox name, with a status notice that a previous daemon's sandbox was destroyed. Recorded as failed, not retried. | `41-VERIFICATION.md` (Findings), `runtime-decision.md` (F-41-1 paragraph) | OBSERVED |
| E-46-02 | Ten live stops on the fixed build (variant a 4 stops, b 3, c 3) reported `failedTeardowns` 0 in every row that was logged, no `code`, none near the 60 s bound, and the host read clean before and after. One variant c stop wrote no `daemon.stopped` row that the test found; the variant's verdict does not judge the row. | `41-VERIFICATION.md`, `41-02-SUMMARY.md` | OBSERVED |
| E-46-03 | The Phase 41 live test had no settle between iterations. The older production live suite waits for the compute driver to run no host supervisor before it reuses a sandbox name, and says why: "the driver stops a deleted sandbox's host supervisor some seconds after the sandbox, its container and its secret entries are gone ... no late teardown of the previous scenario can reach it". | `test/integration/production-driver.test.ts` (`settleBeforeScenario`) | READ |
| E-46-04 | The sandbox name of a session is `realm-` plus the session id; the session id derives from the workspace root, so one workspace gives one name on every iteration. The sandbox state directory, the secret directory and the container name derive from that name, so an old and a new sandbox of one name share every path. | `src/runtime/openshell.ts` (`realmSandboxName`), `src/runtime/driver/sandbox-binding.ts`, `docs/integration/openshell.md` (sandbox binding) | READ |
| E-46-05 | The compute driver's `DeleteSandbox` stops the host supervisor first (SIGTERM, then SIGKILL after a bounded wait of 5 s), then runs the lifecycle delete, then clears the registry; it is idempotent. The supervisor handle's `exited` promise is also consumed by `onSupervisorExit`, which marks the sandbox record failed ("Set when the sandbox's host supervisor exits"). | `docs/integration/openshell.md` (driver table), `src/runtime/driver/compute-driver.ts` (lines around 239, 477, 535 to 580), `src/runtime/driver/supervisor.ts` | READ |
| E-46-06 | The daemon's teardown of a session ends with a bounded `openshell sandbox delete NAME` (`SANDBOX_DELETE_DEADLINE_MS`, 15 s) that resolves true when the CLI exits 0. Whether the gateway has finished its own deletion, and the driver its `DeleteSandbox`, when that exit happens is not recorded anywhere. | `src/runtime/session-execution.ts` (`deleteNamedSandbox`), `src/runtime/openshell.ts` (`deleteSandbox`), `src/runtime/teardown-stages.ts` | READ |
| E-46-07 | Before a create, the AgentOS driver waits up to 30 s (`NAME_RELEASE_BOUND_MS`, polling `openshell sandbox list` every 1 s) for the gateway to stop listing the session's sandbox name; a name still listed at the bound, or a list that cannot be read, refuses the create. A create whose CLI exit is non-zero writes a failure line to stderr and throws `OPENSHELL_START_FAILED` with no cause code. A name that the gateway no longer lists is not proof that the driver has finished the previous sandbox of that name. | `src/runtime/agentos-driver.ts` (`nameReleased`, line 421 to 431) | READ |
| E-46-08 | A new daemon's startup reap removes the leftover realm containers and then, in `settle`, issues the gateway sandbox delete of each removed container's name **without awaiting it** (`void deleteGatewaySandbox(...)`). The comment says the session's next create waits for the name to be released. The reap's notice ("a previous daemon's sandbox was destroyed") is built from this reap's report. A delete of a name that is issued while a new sandbox of that name is being created is a race that nothing in the code orders. | `src/daemon/startup.ts` (`startupReapSeamsOver`, `settle`), `src/daemon/daemon.ts` (`startupNotice`) | READ |
| E-46-09 | `startDaemon` awaits `runStartupMaintenance` (the reap, the sweep, the reconciliation, up to the 10 s budget after the reap) before it returns; `runDaemon` registers its SIGTERM and SIGINT handlers only after `startDaemon` returns (`awaitStop`). A SIGTERM that arrives while the daemon is still in startup therefore meets the default signal disposition: the process dies with no `daemon.stopping` and no `daemon.stopped` row and no teardown. | `src/daemon/main.ts` (`runDaemon`, `awaitStop`), `src/daemon/daemon.ts` (end of `startDaemon`) | READ; the consequence is an INFERENCE until a live stop lands in that window |
| E-46-10 | `daemon.stopped` is written once, after `stopSessions`, with `code` (the first failure) only on failure and `failedTeardowns`; stages are bounded and the whole teardown by `TEARDOWN_TIMEOUT_MS` (60 s). | `src/daemon/daemon.ts` (`closeEverything`), `src/daemon/teardown.ts`, `src/lifecycle/bounds.ts` | READ |
| E-46-11 | The Phase 41 live test reads the request log from a byte offset taken at the signal and filters rows by the signal timestamp (`stopRecordsOf`); its repeat cap is 20 (`MAX_REPEATS`), below the 50 consecutive iterations STOP-01 needs; its stop is a SIGTERM to the one daemon found by exact argv match, never `realm down`. | `test/support/daemon-stop-live.ts`, `test/integration/daemon-stop-live.test.ts` | READ |
| E-46-12 | Live windows run as the realmlive account's rootless Podman 5.7.1 stack under the shared live lock, one live run at a time, with residue snapshots and evidence outside the repository (mode 0700 directories, 0600 files); the root account's Podman 4.9.3 cannot pass the production gate. The compute driver's systemd user unit is named by `REALM_LIVE_DRIVER_UNIT`. | `44-CONTEXT.md` D-44-10, `test/integration/production-driver.test.ts` | READ |

### Mechanism candidates (none is a finding; each is a question the live timeline must answer)

The previous INFERENCE names one family. The code reading above gives five concrete, distinguishable mechanisms. Plan 46-01 makes the harness record the observations that tell them apart; plan 46-02 reads them; plan 46-03 names which is true, or records that none is shown.

| ID | Mechanism | Component | Discriminating observation in the timeline |
| --- | --- | --- | --- |
| M1 | The late host-supervisor stop or driver `DeleteSandbox` of the previous sandbox is still running when the new sandbox of the same name is created: a shared state, secret or exit-marker path, or the registry record, is touched by the old teardown and the new create fails or its sandbox is marked failed. (E-46-03, E-46-05) | compute driver | A host supervisor child of the driver unit that is alive after the old daemon's exit and still alive when the next create starts; driver journal lines for the old name that carry a timestamp after the new create began. |
| M2 | The new daemon's startup reap found a leftover container of the old sandbox, destroyed it, and its un-awaited gateway delete of that name reached the new sandbox of the same name. (E-46-08) | daemon startup reap | The new daemon's startup report names removed containers (the notice is present); a gateway sandbox delete for the name is issued after the new create began; the new container disappears from Podman events right after. |
| M3 | The previous teardown's `openshell sandbox delete` exited 0 before the gateway and driver had released the name; the name-release wait saw the name gone (or the list unreadable) while the driver still held the old record, so the create is refused at the driver or the gateway with "already exists". (E-46-06, E-46-07) | gateway and AgentOS driver wait | The daemon log has the create failure line (agentos-driver) or the nameRelease line; the sample of `openshell sandbox list` shows the name leaving and returning, or a non-zero list; the gateway journal shows `already exists` or a Deleting phase at create time. |
| M4 | The previous daemon's stop was not a full teardown: the container or the sandbox survived the stop, so the new daemon's reap legitimately destroyed it (the notice), and the destruction raced the new up. (E-46-01) | daemon stop, then reap | The old stop's `daemon.stopped` row has failedTeardowns above 0 or is absent; a container for the name exists in the Podman sample after the old daemon's exit. |
| M5 | A failure in the start path that does not involve the previous sandbox at all (for example the same intermittent start failure that a fresh `up` can have under load), with the notice a coincidence. (E-46-01 says the cause is not established, so this is not excluded) | start path | A failure whose timeline shows no old process, no old container and no late delete at any time near the new create, and a failure rate under the settled control variant S that equals the unsettled rate. |

Not a candidate but an open observation: **OBS-C** (one variant c stop wrote no `daemon.stopped` row). E-46-09 gives a reading (a signal during startup meets the default disposition); other readings are a window or offset error in the test's own log slice (E-46-11), a stop that exceeded the harness bound, or a rotated log. The harness records the whole log slice and the daemon's startup state for every variant c stop so the reading is decided by data.

### D-46-01. The reproduction harness (STOP-01; plan 46-01)

A new gated live test and pure helper module, not an edit of the Phase 41 test (its repeat cap and its per-iteration residue wait would defeat the purpose, and its recorded results stay as they are):

- `test/support/rapid-stop-up.ts`: pure helpers, parameters in and values out, no process, no file, no environment read (the pattern of `test/support/daemon-stop-live.ts`): the gate reason, the variant and count parsing, the `up` outcome classifier, the chain state machine and window outcome, the timeline merge, the supervisor lifespan summary, the closed-phrase evidence lines.
- `test/integration/rapid-stop-up-helpers.test.ts`: the hermetic tests of every branch, runnable on any host.
- `test/integration/rapid-stop-up-live.test.ts`: the gated live test. Gate: the production gate (`productionSkipReason`), `REALM_LIVE_RAPID=1` (an operator opt-in the test never sets), `REALM_RAPID_EVIDENCE_DIR` (absolute, existing), a valid variant list; the optional `REALM_LIVE_DRIVER_UNIT` (existing name) and `REALM_RAPID_GATEWAY_UNIT` (new, optional) name the systemd user units whose journals and process children are read.

The loop is a chain on one sandbox name, with no settle between a stop and the next `up`:

1. A settled cold `up` (the first `up` of a chain is allowed to follow a clean state), then one scratch exec so the sandbox is real.
2. Iteration k: SIGTERM to the one daemon (exact argv match, as Phase 41; zero or two daemons fail the chain), poll for the daemon's exit at 50 ms, and **the instant the pid is gone** run `realm up` for the same workspace; require the session active and one exec to succeed; record the iteration.
3. No retry. A failing iteration stops the chain, the full timeline of that iteration is written, the scenario is cleaned (`realm down`, then the residue wait), and a new chain starts at step 1 until the variant has hit its failure cap (3) or its consecutive-clean target. A failure resets the consecutive count.

Variants:

- **a** a plain stop after a scratch session with one exec, then the immediate `up`.
- **b** the same, with the CPU burners of Phase 41 running during the stop and during the following `up` (the load is the synthetic one of Phase 41; the load facts are recorded).
- **c** the stop is sent 3 s after an `up` started (the sandbox container exists or is being created), then the immediate `up`. The stop here is allowed to take the daemon into any state.
- **s** (control, only when at least one failure was recorded in a, b or c, 20 iterations): variant a with a settle before each `up`: the driver unit has no host-supervisor child, the gateway lists no realm sandbox, and Podman lists no container for the name. The point is to separate M1 to M4 (a settle removes them) from M5 (a settle does not).

Counts: 50 consecutive clean iterations per variant a, b, c is the non-reproduction bound of STOP-01; up to 3 failures per variant are kept with timelines. Roughly 25 s per iteration puts the whole window near 75 minutes of live time; the window may be split across sessions, each under the lock, and a chain never spans a split.

The timeline of every iteration, written outside the repository (directory mode 0700, files 0600), on one UTC millisecond clock the harness owns:

- the signal time, the daemon exit time, the `up` start and end times, and the `up` stdout, stderr and exit status in full;
- the slice of the daemon request log (every row between the signal and the end of the next `up`), and the slice of the daemon log (stderr) for the same window, whole, never filtered to the stop rows (this is what answers OBS-C);
- the driver unit's journal and the gateway unit's journal for the window (`journalctl --user --unit UNIT --since --until --output short-iso-precise`, when the unit variables are set; unset is recorded as unset);
- the Podman events of the window (`podman events --since --until --format json`) and a 100 ms sample of the driver unit's child processes (pid, start time, the command name only) and a 250 ms sample of the session's containers (state only);
- a 500 ms sample of `openshell sandbox list` (names only, the exit status of the call) and the gateway status;
- the commit, the node version (Phase 41 did not record it), the CLI and image versions, and the load average at each end.

No evidence text carries a path, an environment value, a token or a container id (the Phase 41 rule); evidence files hold ids because they are outside the repository, and the records written into the repository hold numbers, booleans and closed phrases only.

### D-46-02. The window outcome words (frozen before the first run)

| Outcome | When | What the record may say |
| --- | --- | --- |
| REPRODUCED | Any variant recorded at least one `up` that exits non-zero with `OPENSHELL_START_FAILED` right after a stop with no settle | The count of failures and iterations per variant, the failing iteration's timeline, the rate; not the cause (plan 46-03 decides it) |
| OTHER-FAILURE | Failures with a code other than `OPENSHELL_START_FAILED`, or a stop whose `daemon.stopped` row has `failedTeardowns` above 0 or a `code`, or an `up` that times out | A new named finding with its timeline; it is never counted as a reproduction or as a clean iteration |
| NOT-REPRODUCED | Each of a, b and c recorded 50 consecutive clean iterations and no failure of any kind | The counts per variant, the load facts, the sample bound; not that the defect is absent |
| VOID | The window ended before either of the above for a host reason (lock lost, a residue count changed outside the harness, the stack down, the host unavailable, fewer than 50 clean and no failure) | Why, and the counts reached; none of the three words above |

A REPRODUCED window with a failure under the control variant s is an extra finding that the settle does not remove the failure; it is read in plan 46-03 as support for M5, not discarded.

### D-46-03. The cause record (STOP-02; plan 46-03 Task 1)

Written from the evidence only, in `46-EVIDENCE.md` and then in `docs/integration/runtime-decision.md` in place of the F-41-1 INFERENCE paragraph. It names, for the failing iteration(s), the component, the action that was late or missing, its timestamps relative to the signal and to the new create, and the cause code the refusal carries (the `up` output shows `OPENSHELL_START_FAILED` and any cause code; the daemon log carries the failure line of the AgentOS driver, if any). Every candidate in the table above is marked CONFIRMED, REFUTED or NOT TESTED by a row of evidence. If the window was NOT-REPRODUCED the record says so, and the paragraph keeps an INFERENCE label for the mechanism the hermetic pin shows is possible in the code, rewritten to cite the 50-iteration result.

### D-46-04. The fix shape and its limits (STOP-03; plan 46-03)

The fix is chosen only after the cause is recorded, and is the smallest change in the module that owns the late action. The allowed shapes, each with its limits:

- **F-reap** (M2): the startup reap's gateway deletes are ordered with the next create of the same name (awaited inside the startup budget, or tracked per name so the create of that name waits for them), each wait with an explicit timeout. Fail closed: a delete that does not finish by its bound leaves the name owed and the create refused with the existing `OPENSHELL_START_FAILED`, as today for a name still listed.
- **F-driver** (M1, M3): the driver's create of a name waits (bounded) for the same name's in-flight delete or supervisor stop to finish, or the daemon's create waits until the driver reports the old sandbox gone; the wait has an explicit timeout; a timeout refuses the create and leaves nothing behind.
- **F-stop** (M4): the stop does not return until the names it owes are released, within the existing teardown bound; a name not released is reported through the existing `daemon.stopped` fields, not a new one.
- **F-signal** (OBS-C, E-46-09): the daemon registers its signal handlers before the startup maintenance so a SIGTERM during startup runs the same teardown and logs the same two rows; this is done only if the live data shows the missing row is this case, and it must not let the daemon serve before the reap has finished.
- **None** (a NOT-REPRODUCED window, or M5): no behavior change is made on a guess. A hermetic pin of the mechanism the code permits is recorded; if that pin is red on the unchanged code and the interleaving is reachable in production, a bounded change under the same limits may be made and is labelled "fixed hermetically, not reproduced live"; otherwise F-41-1 stays carried.

Limits for every shape: an explicit timeout on every new wait (a named constant with its bound derived, not guessed, beside the Phase 41 stage bounds so `TEARDOWN_TIMEOUT_MS` and `CONTROL_TIMEOUT_MS.down` stay consistent and their pinned formula test still passes); fail closed; the no-orphan guarantee (a timeout never leaves a container, a sandbox or a supervisor that the next start's reap cannot clear); the `daemon.stopped` contract and the 29 codes unchanged; no widened permission; no new module-size or export-usage regression.

### D-46-05. Red first (STOP-03)

The hermetic test is written and run against the unchanged source before the fix; its failure is recorded in the plan summary (the first failing assertion, the command, the exit status). It uses in-process stand-ins and scripted clocks only (no Podman, no gateway, no gate variable, no real sleep), the pattern of `test/runtime/teardown-stages.test.ts`, `test/daemon/stop-bounds.test.ts` and `test/runtime/agentos-create-name-release.test.ts`. It encodes the interleaving the timeline showed: for M2 an un-awaited reap delete resolved after the create began; for M1 and M3 a driver or gateway that still holds the old record when the create starts; for F-signal a signal delivered during a pending startup. It also keeps a case that shows the fix does not extend a bound past its constant.

### D-46-06. The live verification (STOP-04; plan 46-04)

On the fixed build, the same harness: variant a for at least 20 consecutive stop-then-`up` iterations with zero `OPENSHELL_START_FAILED`, `failedTeardowns` 0 in every `daemon.stopped` row, and zero residue (containers, gateway sandboxes, pinned workspace entries, daemon processes, and the driver's host supervisors) at the end of the window and between chains. Every variant that failed in plan 46-02 is rerun at the original count (50 consecutive); if plan 46-02 was NOT-REPRODUCED, variants a, b and c run 20 each as a no-regression check and the verdict says so. A failure on the fixed build means the fix is not accepted: STOP-04 stays unmet, the new timeline is recorded, and the orchestrator raises a gap-closure plan; nothing is retried to a pass.

### D-46-07. The variant c missing row (STOP-04, second half)

Explained or recorded as a finding, from the harness's whole log slice of every variant c stop in plans 46-02 and 46-04. The explanation must name which of these the data shows: the signal landed during startup (default disposition, no row; E-46-09), the log slice or offset was wrong, the daemon was killed by the harness bound, or the log was not written. If the answer is the startup window and the product behavior is wrong (a SIGTERM during the reap kills the daemon with no teardown, which can leave a container the next start destroys), it is either fixed under F-signal or recorded as a finding with the owner's choice; it is never silently dropped.

### D-46-08. Hygiene constraints for every plan

- Gates: `src/contract` imports no `host/` or `capability/`; modules reachable from the exec gate closure do not reach `node:child_process`; `src/cli/main.ts` and `src/omp/plugin.ts` stay under 1000 lines (`node scripts/check/module-size.mjs`); the export-usage gate (`node scripts/check/export-usage-gate.mjs`) needs an allowlist entry for a test-only export of a new `src` module and fails on a stale entry; `npm run check:gates` passes.
- Lint: no unnecessary conditions after assert narrowing, numbers through `String(...)` in templates, `void test(...)` for tests, no `no-base-to-string`.
- Tests pass as a regular non-root user; the new hermetic tests use a temporary directory and in-process stand-ins only, no gate variable, no file basename containing `mcp` or `acp`. The live test skips with a reason that names the first missing prerequisite and never sets a gate variable itself.
- Markdown: no host-local absolute path; raw angle tokens outside code fences are escaped; plan task blocks hold no angle brackets at all; frontmatter list entries that contain a colon and a space are quoted. `node scripts/check/host-paths.mjs` and `npm run check:docs` pass.
- The error catalogue stays at 29 codes (`test/core/errors.test.ts`); the `daemon.stopped` pin (`test/daemon/stop-bounds.test.ts`) and the formula pins (`test/runtime/teardown-stages.test.ts`) pass unedited.
- Docs are updated in the same pull request as the code. No `CHANGELOG.md`, no version field. A change to a documented contract that is incompatible carries `!` in its commit subject so the release notes list it.
- Live window rules (Phases 33, 35, 36, 41, 44): the owner's standing authorization of 2026-11-18 for live windows, the realmlive account and its rootless Podman 5.7.1 stack, the shared live lock, one live run at a time, a fresh copy of the built tree under the realmlive home, `env -i` with exactly the named variables, residue snapshots before, after every chain and at the end, evidence outside the repository (directories 0700, files 0600), a secret search before anything is cited, and the Phase 18 stop rule (a count that changes outside the harness stops the window).

### D-46-09. Threat model (summary; each plan carries its STRIDE rows)

| ID | Category | Threat | Mitigation |
| --- | --- | --- | --- |
| T-46-A | Repudiation | A non-reproduction cited as a fix, or a hermetic pin cited as a live result | The outcome words are frozen (D-46-02); the records say what each outcome claims; the carried state is stated when no fix is shown |
| T-46-B | Tampering | A failing iteration retried, dropped or relabelled to change the outcome | No retry; every failure kept with its timeline; the window state machine is code with a hermetic test; a disagreement stops the task |
| T-46-C | Denial of service | The window leaves residue on the shared stack, runs beside another live run, or a timeout in the fix leaves an orphan | The shared lock; residue snapshots before, between chains and at the end; the fix's timeout paths are tested for no orphan |
| T-46-D | Information disclosure | Evidence holds a path, a token, a container id or an environment value in the repository | Evidence stays outside the repository; repository records hold numbers and closed phrases; the secret search before citing |
| T-46-E | Elevation of privilege | The fix widens the driver's or the daemon's authority, or the harness runs as root | A wait only; no new permission or code; the realmlive account with a scrubbed environment; root only to copy the tree |
| T-46-F | Integrity | A new wait that fails open when the gateway or the list is unreadable | Fail closed: an unreadable list or an unfinished wait refuses the create with the existing code |

## Canonical References

- `.planning/MILESTONE-CONTEXT.md` (D-v7-3, limits, out of scope); `.planning/REQUIREMENTS.md` (STOP-01 to STOP-04); `.planning/ROADMAP.md` (Phase 46).
- `.planning/milestones/v6.0-phases/41-daemon-teardown-flake/41-VERIFICATION.md`, `41-02-SUMMARY.md`, `41-CONTEXT.md`; `.planning/milestones/v6.0-MILESTONE-AUDIT.md`.
- `docs/integration/runtime-decision.md` (the Phase 41 live result and the F-41-1 paragraph), `docs/integration/openshell.md` (the driver table, sandbox binding, the daemon stop live test paragraph), `docs/policy-reference.md` (the stop bounds).
- `src/daemon/daemon.ts`, `src/daemon/main.ts`, `src/daemon/startup.ts`, `src/daemon/teardown.ts`, `src/runtime/session-execution.ts`, `src/runtime/agentos-driver.ts`, `src/runtime/openshell.ts`, `src/runtime/teardown-stages.ts`, `src/runtime/driver/compute-driver.ts`, `src/runtime/driver/supervisor.ts`, `src/session/reap.ts`.
- `test/support/daemon-stop-live.ts`, `test/integration/daemon-stop-live.test.ts`, `test/support/production-live.ts`, `test/integration/production-driver.test.ts`, `test/runtime/teardown-stages.test.ts`, `test/daemon/stop-bounds.test.ts`, `test/runtime/agentos-create-name-release.test.ts`, `test/session/reap.test.ts`.
- Phase 44 precedents for format: `.planning/milestones/v6.0-phases/44-omp-non-blocking-cold-attach/44-03-PLAN.md` (the live window plan), `44-CONTEXT.md` (D-44-10).

## Existing Code Insights

- The stop and the next start meet in three places that are not ordered by anything but timing: the teardown's `sandbox delete` exit (E-46-06), the driver's own delete and supervisor stop behind it (E-46-05), and the new daemon's reap with its un-awaited gateway delete (E-46-08). The harness exists to see which of the three, if any, overlaps the new create.
- The name-release wait (E-46-07) is the only existing guard on the create side and it looks at the gateway's list, not at the driver. It is a bound with a refusal, so any fix that adds a wait follows its pattern (a named bound, a poll, a refusal with the existing code).
- Handler registration after `startDaemon` (E-46-09) is a separate, smaller defect candidate that the variant c data decides.

## Wave Structure

| Wave | Plan | Type | Notes |
| --- | --- | --- | --- |
| 1 | 46-01 | auto | The harness, its hermetic tests, the docs paragraph. No live step. |
| 2 | 46-02 | HUMAN-NEEDED (live window) | Needs 46-01 merged. Outcome REPRODUCED, OTHER-FAILURE, NOT-REPRODUCED or VOID. |
| 3 | 46-03 | auto, gated on the 46-02 outcome | Not run on VOID. Cause record, red-first test, fix or pin, docs. |
| 4 | 46-04 | HUMAN-NEEDED (live window) | Needs 46-03 merged. The 20-iteration verification and the variant c explanation. |

## Requirement coverage

| Requirement | Plans | Closed by |
| --- | --- | --- |
| STOP-01 | 46-01 (the instrument), 46-02 (the window) | 46-02 outcome: a reproduction with its timeline, or 50 clean per variant plus the hermetic pin of 46-03 Task 2 |
| STOP-02 | 46-02 (the data), 46-03 (the record) | The cause paragraph in `runtime-decision.md` in place of the INFERENCE paragraph; or the stated non-reproduction wording |
| STOP-03 | 46-03 | A fix or bound with a red-first hermetic test and the limits of D-46-04; on a NOT-REPRODUCED window only the pin, labelled as such, and F-41-1 stays carried |
| STOP-04 | 46-01 (the row capture), 46-04 | The 20-iteration live verification on the fixed build and the variant c explanation |

## Open Questions

- **OQ-46-01** (no owner decision needed to start): the node version and the commit of the window are recorded (Phase 41 did not record the node version); the harness reads `process.version`.
- **OQ-46-02** (answered by the data): whether the control variant s is run depends on a failure in a, b or c; with no failure it is skipped and its absence is recorded, not counted as a pass.

## Owner decisions needed

None blocks plan 46-01 or 46-02. Defaults are given; the owner may override at the point named.

1. **OD-46-1, a driver contract change.** If the cause is M1 or M3 and the fix is a wait inside the compute driver (F-driver), the driver's documented create and delete behavior changes (a create of a name waits for the old sandbox's teardown). Default: allowed if the wait is bounded, fail closed and the RPC contract table in `docs/integration/openshell.md` is updated in the same change, with `!` only if an existing documented behavior is incompatible. The owner decides at plan 46-03 Task 1 if the change would alter an RPC's documented result.
2. **OD-46-2, extra latency on every `up`.** A fix that adds a wait to every start (rather than only when the old sandbox is still owed) costs time on the common path. Default: the wait is conditional on the evidence of an owed name and costs nothing when nothing is owed; an unconditional wait needs the owner's approval.
3. **OD-46-3, a NOT-REPRODUCED outcome.** Default: carry F-41-1 with the 50-iteration evidence and the hermetic pin, mark STOP-03 as bounded by the pin only, and run the 20-iteration verification as a no-regression check. The owner may instead extend the window (more iterations, a heavier load variant) or retire the finding.
4. **OD-46-4, a SIGTERM during startup (F-signal).** If the live data shows the missing row is E-46-09, the product behavior is a real defect of a different kind (a daemon killed in its startup with no teardown). Default: fix it under F-signal in plan 46-03 with a red-first test, as it shares the stop path; the owner may instead record it as a finding for a later phase.
5. **OD-46-5, the iteration targets.** 50 consecutive clean per variant (a, b, c) is the roadmap's number and is the default for the repro window; the owner may reduce variant c (a mid-up stop is an observation in Phase 41) to 20 to shorten the window, and the record then says the non-reproduction bound for c is 20.

## Success Criteria (from the roadmap text, made observable)

1. The repro window ends in one frozen outcome word with the counts per variant, the timeline kept outside the repository, and the node version, commit and load facts recorded.
2. `docs/integration/runtime-decision.md` no longer carries the F-41-1 INFERENCE paragraph as the whole account: it carries the cause with timestamps and the cause code, or the stated non-reproduction with the mechanism the pin shows.
3. The fix or bound is in the code with an explicit timeout on every wait, fail closed and no orphan, `daemon.stopped` and the 29 codes unchanged, and a hermetic test that failed first.
4. A live run shows at least 20 consecutive stop-then-`up` iterations with zero `OPENSHELL_START_FAILED`, `failedTeardowns` 0 in every row and zero residue; the variant c missing row is explained or a finding.

## Deferred Ideas

- A heavier or recorded-real load shape than the synthetic CPU burners, if the window is NOT-REPRODUCED and the owner wants it (OD-46-3).
- A `realm doctor` item that reports a name still owed at the gateway or a driver supervisor still running after a stop.
- Making the older production live suite's driver-supervisor settle a product wait rather than a test wait, if M1 is confirmed and a conditional wait proves cheap.

## Text for the orchestrator

The orchestrator applies the following; this phase edits none of these files.

### ROADMAP.md (Phase 46 Plans block)

**Plans:** 4 plans

Plans:
- [ ] 46-01-PLAN.md: Rapid stop-then-up live harness, hermetic helpers, the timeline of every component (STOP-01, STOP-04)
- [ ] 46-02-PLAN.md: HUMAN-NEEDED live reproduction window, 50 consecutive iterations per variant, frozen outcome word (STOP-01, STOP-02)
- [ ] 46-03-PLAN.md: Cause record, red-first hermetic test, fix or bound, runtime-decision paragraph (STOP-02, STOP-03)
- [ ] 46-04-PLAN.md: HUMAN-NEEDED 20-iteration live verification and the variant c row explanation (STOP-04)

### REQUIREMENTS.md

No new requirement ids. The traceability rows STOP-01 to STOP-04 stay Phase 46; they move to Complete only through the closing criteria above. A NOT-REPRODUCED outcome leaves STOP-03 Partial (bounded by the pin) and F-41-1 Carried, and the owner decides at OD-46-3.
