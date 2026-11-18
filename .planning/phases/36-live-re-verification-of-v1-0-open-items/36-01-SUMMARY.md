---
phase: 36-live-re-verification-of-v1-0-open-items
plan: "01"
status: executed
requirements: [V1LIVE-01]
---

# Plan 36-01 summary: Muse Code test, Hermes gate repair, Omp responsiveness test

Executed 2026-11-18 on the base commit e32bb05 (the work is an uncommitted change on top of it). No file under `src` changed. Evidence (TAP output, the Omp samples CSV and summary) is kept in EVIDENCE_DIR, a new directory outside the repository, mode 0700, files 0600; its path is not recorded here.

## What was built

| File | Change |
| --- | --- |
| `test/support/host-live-muse.ts` | new: Muse helpers (version parse, settings check, list check, gate reason, isolated environment) |
| `test/integration/host-live-muse-helpers.test.ts` | new: six hermetic cases (always run) |
| `test/integration/host-live-muse.test.ts` | new: the gated Muse validator-tier test (REALM_LIVE_MUSE=1) |
| `test/support/host-live.ts` | `HostLiveSpec.versionRoot` (new optional field, new exported type `HostVersionRoot`), `Wave2SpecInit.versionRoot`, the hermes record carries it, `versionOnce` runs the prepare command; new constant `VERSION_PREPARE_TIMEOUT_MS` |
| `test/support/host-live-wave2.ts` | the two hermes validators carry `timeoutMs: 300_000` |
| `test/integration/host-live-helpers.test.ts` | two cases appended (fake hermes bootstrap, version-root and timeout pins) |
| `test/support/responsiveness.ts` | new: pure latency summary, quiet-host check, verdict, evidence text |
| `test/support/responsiveness.test.ts` | new: nine hermetic cases |
| `test/integration/omp-responsiveness.test.ts` | new: gated baseline test and cold-attach test (REALM_LIVE_OMP_RESPONSIVENESS=1) |

Shared files touched, anchored by symbol: in `test/support/host-live.ts` the `HostLiveSpec` interface (one field plus the new `HostVersionRoot` interface), `Wave2SpecInit` and `wave2Spec` (one field), the `hermes` entry of `HOST_LIVE` (one argument), and `versionOnce` (the env construction and one prepare call). `runHostProduction` and everything else was not touched. `docs/integration/mcp.md` was not touched.

## Run records

### Muse Code (OI-07), validator tier: RUN, PASSED

- Date 2026-11-18, base commit e32bb05, Muse Code 1.4.23 (recorded 1.4.23).
- Command: `REALM_LIVE_MUSE=1 node --test --test-concurrency=1 dist/test/integration/host-live-muse.test.js`.
- Result: 1 test, pass 1, fail 0, skipped 0, duration about 2.0 s.
- Diagnostics: A plugin bundle validated (`valid realm native`, all counts 0); B the snippet entry was written to the isolated settings file; C `mcp list` and `mcp get` printed the documented entry and started no server; D `muse exec --provider echo --trust-workspace` exit 0 in 960 ms, 1 server start (argv `mcp`: 1), host methods `initialize`, `notifications/initialized`, `tools/list`, tools `exec,list,read,retry,status,write`; E a stub `realm` that does not speak MCP failed the run (exit 1, `failed during startup`), 1 stub invocation; F the operator's real Muse settings file (present on this machine) is byte-equal before and after (SHA-256 compared).
- With the variable unset the test skips: `REALM_LIVE_MUSE=1 is not set; the live Muse Code rehearsal needs an explicit operator opt-in`.
- Not covered (named gap, 36-CONTEXT D-36-04): a Muse boot against the production stack; no model-driven tool call.

### Hermes (OI-08), gate repair and the wave 2 hermes scenario: RUN, PASSED (no longer skipped)

- Date 2026-11-18, base commit e32bb05, the gate observed Hermes Agent 0.23.1 (the recorded 0.23.2 differs; informational, the diagnostic says so).
- Command: `REALM_LIVE_HERMES=1 REALM_TEST_TIMEOUT_SCALE=3 node --test --test-concurrency=1 dist/test/integration/host-live-wave2.test.js`.
- Result: 9 tests, pass 1 (hermes), fail 0, skipped 8 (the other hosts, each naming its unset opt-in). The hermes test took about 26 s; the whole file about 66 s (including the one-time version probe that now bootstraps the data root).
- Diagnostics printed by the existing scenario: `Hermes Agent 0.23.1: a different version than the recorded 0.23.2; it runs and is recorded`; `after the host's own commands: file untouched by the host; realm host status installed`. The scenario asserts steps A to F (dry run, install, validators with the stub argv, uninstall, byte-equality of the operator's real `config.yaml`), so a pass includes the hash equality; the existing test prints no more than the two lines above, and the plan's file list did not include that test, so no diagnostic was added.
- Supporting evidence, not the pass criterion: one manual run against a fake server that answers the handshake, in a scratch `HERMES_HOME` (cold bootstrap, about 20 s for the first command). `hermes mcp list` printed the `realm` row, status `✓ enabled`. `hermes mcp test realm` printed `✓ Connected (822ms)` and `✓ Tools discovered: 6` (exec, list, read, retry, status, write), exit 0. The scratch root was removed.
- Hermetic proof of the repair: a fake hermes that fails `--version` until its data root is bootstrapped makes `collectHostLiveGate` return skip false and version 0.23.1; a fake that never bootstraps still returns the `--version did not run to a successful exit` skip.

### Omp responsiveness (OI-11): helper and tests written; baseline mechanics RUN (LOADED, not a measurement); cold attach NOT RUN (production gate)

- Date 2026-11-18, base commit e32bb05, Omp 18.22.2.
- Command: `REALM_LIVE_OMP=1 REALM_LIVE_OMP_RESPONSIVENESS=1 REALM_OMP_RESPONSIVENESS_ALLOW_LOADED=1 REALM_OMP_EVIDENCE_DIR=EVIDENCE_DIR/omp node --test --test-concurrency=1 dist/test/integration/omp-responsiveness.test.js`.
- Result: 2 tests, pass 1 (baseline), fail 0, skipped 1 (cold attach: `REALM_LIVE_PRODUCTION=1 is not set; the production live suite needs an explicit operator opt-in`).
- This run proves the mechanics only (the probe loop, the evidence files, the teardown); it is NOT an unloaded measurement. The host was loaded: load average 9.97 on 8 cpus before the baseline (1.25 per cpu, ceiling 0.5), labelled `loaded`. Numbers, all loaded: 41 probes, 0 unanswered, maximum 114 ms, median 5 ms, 95th percentile 14 ms, longest gap between answers 265 ms. The evidence files (samples CSV, summary text, frames, stderr, transcript) were written.
- Without the escape variable the baseline refused the loaded host (load average 9.11 on 8 cpus) with the sentence naming the load per cpu and the escape variable, as designed (failing test, expected).
- Not run here: the cold-attach test, which needs a quiet host, the production stack and no running realm daemon. Its first run is Plan 36-03 Task 3.

## Gates and checks

Run (after all edits): `npx tsc -p tsconfig.json` (clean, also the build), `npm run check:gates` (gate closure: 4 modules; module size: 148 files; export usage: 0 failing, 179 allowlisted, 0 stale; lockfile integrity: no violations), `npm run check:docs` (ok), targeted `eslint` on every new and edited file (clean), the five touched or new test files with the opt-ins unset (48 pass, 3 skipped naming their opt-ins, 0 fail), and the three hermetic files as the unprivileged account nobody (48 pass, 0 fail). `git status` shows no change under `src`; every new file is test code, except this summary and the copied plan files.

Not run, by the assignment: the full suite (`npm test`) and the whole-tree `eslint .`; CI runs both. Taxonomy: no new test basename contains mcp or acp.

## For Plan 36-03 (the window)

- Run the cold-attach test: `REALM_LIVE_OMP=1 REALM_LIVE_OMP_RESPONSIVENESS=1 REALM_LIVE_PRODUCTION=1` plus the production variables, on a quiet host (load per cpu at most 0.5, no escape variable), with no realm daemon of the account running (stop it with `realm down` first), by a person.
- The test fails, never passes vacuously, when the window is shorter than 10 s, fewer than 40 probes were sent, any probe is unanswered, the maximum exceeds 1000 ms or the 95th percentile exceeds 500 ms.
- Record the Hermes result in the support matrix and registry only after the window (not changed here).
