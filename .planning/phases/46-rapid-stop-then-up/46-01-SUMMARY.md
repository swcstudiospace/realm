---
phase: 46-rapid-stop-then-up
plan: "01"
status: executed
requirements: [STOP-01, STOP-04]
---

# Plan 46-01 summary

Executed in the worktree for Phase 46 (from the planning commit). No live step ran: no daemon, container, gateway or production stack was started by this plan, and no file under src changed. The live test skips with a reason when its gate is closed; the first live run is plan 46-02.

## What changed, per file

- `test/support/rapid-stop-up.ts` (new): the pure helpers. Gate (`rapidSkipReason`, the six variable names), parsing (`parseRapidVariants`, `parseIterations`, `parseMaxFailures`, `targetOf`, `controlDecision`; constants 50, 20 and 3000 ms), the up classifier (`classifyUp`), the stop classifier (`classifyStop`), the chain state machine (`newChainState`, `failureKindsOf`, `chainStep`), the window outcome (`windowOutcome`, the four words of D-46-02), the timeline (`mergeTimeline`, `timelineAround`, `supervisorLifespans`, `lateSupervisors`, `pidsOfListing`, `startupRowsOf`, `startupSeenAt`, `reapRemovedAfter`) and the evidence lines (`evidenceLine`, `iterationEvidenceLine`, `summaryOf`). No process, file or environment access.
- `test/integration/rapid-stop-up-helpers.test.ts` (new): 66 hermetic cases, a group per helper, a table for every branch, the scripted chains (49 clean then one start-failed then 50 clean gives REPRODUCED with the consecutive count reset; 50 clean in each of a, b and c gives NOT-REPRODUCED), the row-absent and dirty stops never clean and never a reproduction, and `evidenceLine` refusing a path, a colon, a slash, a backslash and ids. No gate variable, no Podman, no real sleep, no file.
- `test/integration/rapid-stop-up-live.test.ts` (new): the gated live chain test (variants a, b, c, s; the samplers; the timeline files; the cleanup). It imports from src only `requestLogPath` and `OPENSHELL_SANDBOX_NAME_LABEL_KEY`, the two names the Phase 41 test imports, and it sets no gate variable.
- `docs/integration/openshell.md`: one paragraph directly after the Phase 41 daemon stop live test paragraph (the Phase 41 paragraph is unedited). It names the harness, the gate variables, the variants and the four outcome words with what each claims. It states no result and no host-local path.
- `.planning/phases/46-rapid-stop-then-up/46-01-SUMMARY.md`: this file.

## The live test, as built

- Chain: `createScenarioEnvironment`, a settle (the driver unit has no host supervisor, the gateway lists no realm sandbox, Podman lists no container for the name), no daemon left, then for a, b and s a settled `realm up`, wait for active and one scratch exec. Iteration: find the one daemon by exact argv match (zero or two fail the chain before any signal), take the byte offsets of the request log and of the daemon log, SIGTERM, poll the pid every 50 ms (90 s bound; a zombie counts as gone), and the instant the pid is gone `realm up` for the same workspace, then `realm status` once (for the notice), wait for active and one exec. `chainStep` decides; a failure runs the chain cleanup (`cleanupScenario`: realm down and the residue wait) and starts a new chain; every variant ends with the cleanup and a residue check.
- Variant b: one busy node worker per CPU from before the signal until the next up has reached active or failed (Phase 41 `loadWorkers` rule; the load per CPU before and after is in every line).
- Variant c: no daemon runs when an iteration starts (a lingering one is stopped by SIGTERM before the measured window) and the stack is settled; the first up is started and not awaited, the daemon pid is awaited (30 s), 3 s later SIGTERM, the first up is awaited (recorded, not judged), then the second up must reach active; `realm down` and the residue wait follow every iteration.
- Variant s: variant a with the three-part settle (60 s per part) before each up; a settle that does not finish is a host stop (VOID), not a failure. It runs when named in `REALM_RAPID_VARIANTS` or, with the default list, when a, b or c recorded a failure; the reason is written to the summary either way.
- Evidence directory (directories made by the test mode 0700, files mode 0600): `summary.txt` (rewritten after every iteration; outcome word, per-variant counts, control decision, commit, node version, package version, CPU count, sample intervals; the only file numbers are copied from), `iterations.txt` (one closed-phrase line per iteration), `facts.txt` (the image reference and Podman probe, which may hold ids), and per chain a directory with, per iteration: the up output and status text, the whole request log slice and daemon log slice for the window from the signal to the end of the next up, the driver and gateway unit journals (`unset` when the unit variable is not set), the Podman events as JSON, the gateway status before and after, the three sample files (driver unit children every 100 ms, session containers every 250 ms, gateway sandbox names every 500 ms) and the merged timeline on the test's own UTC millisecond clock. A source that cannot be read is written as an unavailable line and never fails the iteration.
- The test passes only when every chosen variant ran to its target with no failure of any kind; a reproduction, another failure or a host stop fails it after the evidence is written. The outcome word is in `summary.txt` in every case.

## Task 3: the capture list against M1 to M5 and OBS-C

- M1 (late supervisor stop or driver delete still running when the new create starts): confirmed by `lateAfterExit` and `lateAfterNextUp` above 0 in the iteration line (a supervisor of the previous sandbox, first seen at or before the daemon exit, still listed under the driver unit after the exit and after the next up started), the child samples and driver journal lines for the old name stamped after the new create began; refuted by both counts 0 with the child sample covering the window and no such journal line.
- M2 (the new daemon's startup reap destroyed a leftover container and its un-awaited gateway delete reached the new sandbox): confirmed by `notice=yes` and `containersRemoved` above 0 from the startup report row of the new daemon, a gateway delete in the gateway journal stamped after the new create began, and the new container leaving the Podman events right after; refuted by `notice=no` and `containersRemoved=0`.
- M3 (the previous `sandbox delete` exited 0 before the gateway and driver released the name): confirmed by the driver create failure line or the name-release line in the daemon log slice (the daemon's stderr goes to the same file as its entry records, `daemon.log`, so the slice holds it; checked in `src/daemon/launch.ts`), the sandbox-list sample showing the name leave and return or a failed list, and `already exists` or a deleting phase in the gateway journal at create time; refuted by none of these.
- M4 (the stop was not a full teardown, so the reap legitimately destroyed what survived): confirmed by a `dirty` or `row-absent` stop in the line (a `daemon.stopped` row with `failedTeardowns` above 0 or no row) and a container for the name in the container samples after the daemon's exit; refuted by a clean stop and no container after the exit.
- M5 (a start-path failure that does not involve the previous sandbox): confirmed by a failing iteration whose timeline shows no old supervisor, no old container and no late delete near the new create, and by the control s failing at the rate of a; refuted by every such observation being present, or by the control s staying clean while a fails.
- OBS-C (a variant c stop with no `daemon.stopped` row): every iteration line carries `startupSeen` (whether the daemon's startup report row was already in the daemon log at the signal, read from the log offset taken before the first up) and, for a row-absent stop, `stoppingSeen`; the whole request log slice and daemon log slice are kept. No capture was missing; the one thing added by this task is `startupSeen` on every record, and `containersRemoved` and the notice boolean from the next daemon's startup row and the status text.
- The daemon's stderr goes to `daemon.log` (the CLI opens it as the daemon's standard output and error), so the daemon log slice already captures the driver's create failure and name-release lines; no other stderr file exists to capture.

## Deviations from the plan text

- `IterationFailure` keeps a list of kinds (`kinds`), the up kind first, instead of one kind, so an iteration that fails in both its up and its stop keeps both; `windowOutcome` reads `start-failed` anywhere in the list.
- `classifyStop` has the four kinds of the plan plus `not-exited` (the caller sets it when the daemon is still alive at the 90 s bound; no row is read). A `daemon.stopped` row with no numeric `failedTeardowns`, or one with no `daemon.stopping` row before it, is `dirty` (never clean). A code that is not in the catalogue is recorded as `unlisted`, never as text.
- `UpOutcome` has a fifth kind `not-run` (the up could not start because the daemon did not exit), and `FailureKind` has `stop-timeout`; an iteration whose up did not run is never clean.
- `lateSupervisors` counts only supervisors first seen at or before the daemon's exit, so the new sandbox's own supervisor is not read as late.
- `controlDecision` returns closed slugs (`named-in-list`, `not-named-in-list`, `failure-in-abc`, `no-failure-in-abc`, `variant-list-invalid`) so the reason can go into an evidence line.
- `evidenceLine` is stricter than the plan: a string value must be a closed name (letters, digits, dot, hyphen, underscore, plus; starting with a letter), so a colon, a space or any slash is refused, and a run of 12 or more hex digits (the short and the 64-digit id forms) is refused. The commit, the node version and the package version go through a separate `fact` check in the live test.
- `NOT-REPRODUCED` needs 50 consecutive clean iterations whatever `REALM_RAPID_ITERATIONS` says, so a window run at a reduced target and clean reads VOID; the test itself still passes in that case (it passes when every variant reached its target with no failure), which is what plan 46-04's 20-iteration check needs.
- The CLI has no version command, so the "CLI version" fact is the version field of the package file of the built tree; the commit is `git rev-parse HEAD` run in that tree, `unknown` when it fails.
- The gateway status (`openshell status`) is read once before and once after each iteration (before only for a, b and s), not sampled; if the CLI refuses the call it is written as an unavailable line.
- Variant c awaits the interrupted first up before starting the second up, as the plan orders it; `gapToUpMs` (the daemon's exit to the second up's start) is in every line, so a long wait on the first up is visible and not hidden.

## Checks run

- `npx tsc -p tsconfig.json`: clean.
- `node --test` on `rapid-stop-up-helpers`, `rapid-stop-up-live` and `daemon-stop-live-helpers` (compiled): 101 tests, 100 pass, 1 skipped (the live test, reason names `REALM_LIVE_PRODUCTION=1`), 0 fail. The same two new files under `env -i`: pass. The same two new files as the regular account (omprunner) under `env -i` from a copy of the built tree: 67 tests, 66 pass, 1 skipped, 0 fail.
- `npx eslint` on the three new ts files: no findings.
- `node scripts/check/host-paths.mjs`, `npm run check:docs`, `npm run check:gates` (gate closure, module size, export usage, lockfile integrity): pass.
- No live step ran.

## What plan 46-02 can rely on

The live chain test is one file, `dist/test/integration/rapid-stop-up-live.test.js`, run from a fresh copy of the built tree as the realmlive account under the shared live lock, one live run at a time, with a scrubbed environment (the daemon and the openshell CLI receive only PATH, HOME and XDG_RUNTIME_DIR from it). The environment, exactly:

- the production gate (as for the Phase 41 test): `REALM_LIVE_PRODUCTION=1`, `REALM_LIVE_IMAGE` (the digest-pinned image the running driver was given), `REALM_LIVE_DRIVER_CONFIG` (absolute path of the config file the running driver reads), `REALM_DRIVER_SOCKET` (absolute path of the socket the running driver binds), `PATH` (with the openshell CLI), `HOME`, `XDG_RUNTIME_DIR` (the rootless Podman 5.x socket under it);
- the opt-in the test never sets: `REALM_LIVE_RAPID=1`;
- `REALM_RAPID_EVIDENCE_DIR`: an existing absolute directory outside the repository;
- optional: `REALM_RAPID_VARIANTS` (comma list over a, b, c, s; default a, b, c), `REALM_RAPID_ITERATIONS` (1 to 50, default 50), `REALM_RAPID_MAX_FAILURES` (1 to 5, default 3), `REALM_LIVE_DRIVER_UNIT` (the compute driver's systemd user unit) and `REALM_RAPID_GATEWAY_UNIT` (the gateway's systemd user unit). Plan 46-02 should set both unit variables so the supervisor samples and the journals exist.

The command, with the values filled in by the operator:

```
env -i PATH=... HOME=... XDG_RUNTIME_DIR=... REALM_LIVE_PRODUCTION=1 REALM_LIVE_IMAGE=... REALM_LIVE_DRIVER_CONFIG=... REALM_DRIVER_SOCKET=... REALM_LIVE_RAPID=1 REALM_RAPID_EVIDENCE_DIR=... REALM_LIVE_DRIVER_UNIT=... REALM_RAPID_GATEWAY_UNIT=... node --test dist/test/integration/rapid-stop-up-live.test.js
```

The window is roughly 25 s per iteration, so about 75 minutes for a, b and c at 50 each; the test timeout is derived from the variant counts. The window may be split with `REALM_RAPID_VARIANTS` (one variant per session); a chain never spans a split. Use a separate evidence directory for each session: `summary.txt` is rewritten when a session starts (and `iterations.txt` is appended to), so two sessions in one directory would overwrite each other's summary. After the run, read `summary.txt` in the evidence directory first: its outcome word and counts are the only numbers to copy; run the secret search on any evidence file before citing it.

## Not done as written

Nothing is omitted. Not committed, by instruction.
