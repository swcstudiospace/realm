---
phase: 48-grok-attribution-and-production-tiers
plan: "02"
subsystem: host-live-harness
tags: [muse-code, prime-agent, grok-build, production-tier, attribution, HTIER-01, HTIER-02, HTIER-03, HTIER-04, HTIER-05]
requires: ["48-01"]
provides:
  - "A gated production-tier test for Muse Code (command drive) and Grok Build (health-check drive), both cold, from a new project directory, with the wire recorder as the registered realm"
  - "Two Grok Build attribution tests (both files, and the Claude file alone) that read the attach audit line, the presence directory and the attached boot report"
  - "Prime Agent wired as the blocker B-48-02 (a fixed skip sentence and a registry gap), not as a drive"
  - "The registry T3 records and the regenerated support matrix block"
affects: [48-03, 48-04]
key-files:
  created:
    - test/support/host-live-production.ts
    - test/integration/host-live-wave2-production.test.ts
  modified:
    - test/support/host-live.ts
    - test/support/host-live-session.ts
    - test/support/host-live-muse.ts
    - test/support/host-registry.ts
    - test/integration/host-live-muse.test.ts
    - test/integration/host-live-wave2.test.ts
    - test/integration/host-live-helpers.test.ts
    - test/integration/host-live-muse-helpers.test.ts
    - test/integration/host-live-session-helpers.test.ts
    - docs/integration/host-support-matrix.md
completed: 2026-11-19
---

# Phase 48 Plan 02: Production-tier wiring for Muse Code, Prime Agent and Grok Build

Nothing was run on the production stack, no Podman, daemon or live lock was started, no gate variable was set by any file, no credential and no model turn was used. No file under `src`, `adapters`, `package.json` or the lockfile changed. No host is promoted (plan 48-04 owns that).

## 1. Wiring decision per host (Task 1, from the 48-01 drive table)

| Host | Wired as | Drive and argument list | Configuration isolation | Names the recorder gives the real `realm mcp` (names only) | Assertion mode |
| --- | --- | --- | --- | --- | --- |
| Muse Code (HTIER-02) | command drive | `muse exec --provider echo --trust-workspace` followed by the fixed prompt of the validator tier (`SESSION_PROMPT`), from a new project directory under the pinned workspace root; exit 0 | the `muse` directory below the scenario's own `XDG_CONFIG_HOME` (as the recipe resolves it), created; the operator's real `~/.config/muse/settings.json` (and the one under a real `XDG_CONFIG_HOME`) hashed before and after | restored when the host does not forward them: `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `REALM_DRIVER_SOCKET` | full wire; no cold connect bound (failure bound only) |
| Grok Build (HTIER-04, HTIER-01) | command (health-check) drive | `grok mcp doctor --leader-socket SCENARIO_ROOT/grok-leader.sock` (a per-run leader socket inside the scenario, so no leader outlives it); exit 0 or 1 accepted (doctor exits 1 after its rows in the validator tier too: the wire and the daemon decide) | `HOME` set to a directory of the scenario (`grok-home`); both the recipe install and the host run in it; the operator's real `~/.grok/config.toml` and `~/.claude.json` hashed before and after | `HOME` forced to the account's value (the host forwards its own isolated one), plus the same three names as Muse restored when absent | full wire (doctor sends `tools/list`, 48-01 OQ-48-1); never handshake only |
| Prime Agent (HTIER-03) | blocker B-48-02, no drive | none | n/a | n/a | n/a |

Prime Agent: `HOST_LIVE["prime-agent"].productionTier` stays false with the fixed sentence `PRIME_AGENT_PRODUCTION_GAP` (starts `B-48-02:`); its registry T3 is a `gap` whose note starts `B-48-02:`; its test in `host-live-wave2-production.test.ts` is a skip with that sentence (or the opt-in sentence when `REALM_LIVE_PRIME_AGENT` is unset) and a body that throws if ever reached. No drive was invented.

## 2. What changed

| File | Change |
| --- | --- |
| `test/support/host-live-production.ts` (new) | pure pieces: `productionWireProblem` (full and `handshake-only` modes; exactly one server start, argv exactly `mcp --host ID`, handshake of either era, `tools/list` and the six names), `attachAuditOf` (one named host, or the words `none`, `several`, `unlabelled`; never a guess), `bootAuditLinesOf`, `presenceDirsOf`, `attributionProblems`, `AttributionCheck`, `museProductionDrive`, `grokProductionDrive`, `doctorCheckNames`, `SERVER_ENV_NAMES`, `GROK_LEADER_SOCKET`, `GROK_WARM_VARIABLE` |
| `test/support/host-live.ts` | `HostProductionId` gains `muse-code`, `grok-build`; `productionOverrides` (Muse: `muse` dir below the config home; Grok: `HOME` = `GROK_HOME_DIR` inside the scenario; unknown host still throws); `HostCommandDrive` gains optional `rootArgs`, `force`, `exitCodes`, `boundedConnect`, `output`, `wire` (all inert when absent); `HostProductionOptions.attribution`; `runHostProduction` installs and uninstalls every recipe of the attribution (loop), reads the audit lines and presence directories before the host command, forces the account `HOME`, checks the server start, and runs `checkAttribution`; `PRIME_AGENT_PRODUCTION_GAP`; `wave2Spec` takes `productionGap`; Grok Build `productionTier` true |
| `test/support/host-live-session.ts` | the recorder gains `forceEnv` (value replaces a forwarded one; names logged, never values; pair file mode 0600) and its `child-start` line carries `argv`; `readRecorderStarts` |
| `test/support/host-live-muse.ts` | `museProductionSkipReason`, `collectMuseProductionSkip` (host opt-in, built CLI, production prerequisites, receipt; `podman --version` only after `REALM_LIVE_PRODUCTION=1`) |
| `test/support/host-registry.ts` | T3 of the three hosts (below) |
| `test/integration/host-live-muse.test.ts` | the Muse Code production test next to the unedited validator test |
| `test/integration/host-live-wave2-production.test.ts` (new) | Prime Agent blocker test; Grok production, attribution and control tests |
| `test/integration/host-live-wave2.test.ts` | header comment only |
| `test/integration/host-live-helpers.test.ts`, `host-live-muse-helpers.test.ts`, `host-live-session-helpers.test.ts` | the existing rows that counted production-capable hosts were adjusted (Grok Build now true; the wave 2 config-only row skips Prime Agent and Grok Build; the production host list and `productionOverrides` row are typed for the new ids); new hermetic rows for every builder, mode, gate sentence and helper |
| `docs/integration/host-support-matrix.md` | generated block only: three T3 cells (Muse Code and Grok Build `not-run`, Prime Agent `gap`) |

Registry (`HOST_RUNTIMES` untouched, OD-48-1): Muse Code `not-run` (names the gate `REALM_LIVE_PRODUCTION=1` plus `REALM_LIVE_MUSE=1`, the drive and the words no dated result), Grok Build `not-run` (gate, drive, the attribution test and the control), Prime Agent `gap` (`B-48-02: ...`). The notes name no path and no value.

## 3. The attribution tests (HTIER-01)

Same file, same gate (production plus `REALM_LIVE_GROK_BUILD`), both skipped with a fixed sentence while the shared state directory holds a Realm receipt for `claude` (they install the Claude file):

- both files: `realm host install grok-build` and `realm host install claude` in the same isolated home; the registered command resolves to the wire recorder; one start with arguments exactly `mcp --host grok-build`; the attach audit line, the presence directory and the attached boot report must all name `grok-build`. The audit line is mandatory (read, not inferred): it fails if no, several, or an unlabelled attach line is found.
- control: the Claude file alone, another new project directory; the same three places must name `claude`.
- the plain Grok production test reads the same three places as diagnostics only.

## 4. Deviations from the plan, and why

1. **Where the audit line lives.** The plan names `sessionIdOfWorkspace` and `auditLinesWithCorrelation`. The attach is written by the daemon's host boot recorder, not by a workspace session: `audit/host-boot.jsonl` below the state directory, tool `host.boot`, path `HOST/TRANSPORT/attached`, correlation id the boot id (which the test cannot know). The helper therefore counts the lines of that file before the host command and reads the attach lines added after it (`bootAuditLinesOf`, `attachAuditOf`). Attach lines of another host written by an unrelated process in the same window would read `several`, honestly.
2. **A health check that leaves before the realm is ready writes no attach line, no presence marker and no attached boot report** (the attach settles only while the host lives; the harness comments say the same). The attribution tests are cold as planned, but a cold `grok mcp doctor` may therefore fail the mandatory audit assertion in the window. I added `REALM_LIVE_GROK_WARM=1` (the Kimi warm-control mechanism, labelled `[warm diagnostic variant]`, never set by a test) so plan 48-03 can rerun the two attribution tests with the session up before the host command if the cold run shows no attach. That is an unplanned switch; whether to use it is a 48-03 decision.
3. **Recorder extensions (test support only).** `forceEnv` is needed because Grok forwards its own (isolated) `HOME`, and the existing restore adds names only when absent. The `child-start` line carries `argv` so "exactly `mcp --host ID` and no second realm server" is read from the recorder, not inferred. Both are inert for the five existing hosts.
4. **Muse Code and Grok Build restore the three server names** (`XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `REALM_DRIVER_SOCKET`) as the legacy Kimi drive does. The plan named only the Grok `HOME`. The recorder logs the restored names, so a host that forwards them restores nothing and shows an empty list; a host that does not is not hidden.
5. **No cold connect bound** for the Muse and Grok commands (failure bound only, the elapsed milliseconds are a diagnostic): a real cold attach took 26 s for Muse in Phase 40, above the 25 s bound the health-check hosts use.
6. **Grok exit code.** `grok mcp doctor` exits 0 or 1 after its rows; both are accepted and printed, and the wire and the daemon decide.
7. **The spec flip is in `host-live.ts`**, where `HOST_LIVE` lives, not `host-live-wave2.ts`.
8. `handshake-only` exists as a named mode with hermetic rows but no wired host uses it (doctor and Muse send `tools/list`).
9. No function builds an environment from a base URL, so the loopback-URL refusal row of the plan has nothing to cover.
10. A scripted Python patch was used for part of the edits (session recorder, some test rows) instead of the edit tool; the diff is reviewed.

## 5. Checks run (as root, so the non-root run was not exercised; no host CLI, no Podman, no network; `env -i` for the test runs)

| Check | Result |
| --- | --- |
| `tsc -p tsconfig.json` (full build to `dist`) | passed, no errors |
| `node --test` on host-live-helpers, host-live-muse-helpers, host-live-session-helpers, host-live-timeline-helpers, host-live-kimi-helpers, host-live-wave2-production, host-live-muse, host-live-wave2, host-live-kimi, enforce-default, host-registry, wave1-boot-matrix, host-support-matrix, host-docs, runtimes | 223 tests, 201 passed, 22 skipped (the gated live tests, no opt-in: each with its fixed reason), 0 failed |
| `npm run check:docs` | ok (host paths, agents sync, default mode) |
| `npm run check:gates` | ok (gate closure, module size, export usage, lockfile) |
| `eslint` on every changed or new test file | clean (two rounds; three findings in the new helper rows fixed) |
| `git status` for `src`, `package.json`, `package-lock.json` | nothing |

`test/integration/enforce-default.test.ts` and `test/docs/wave1-boot-matrix.test.ts` ran unedited and passed. The wave 1 page test and the runtime tier pins passed unedited.

## 6. Plan 48-03 window: exact environment and commands

Shared production variables, as for the other production tiers (`productionSkipReason`): `REALM_LIVE_PRODUCTION=1`, `REALM_LIVE_IMAGE` (the digest-pinned image), `REALM_LIVE_DRIVER_CONFIG` (absolute path of the driver's `config.json`), `REALM_DRIVER_SOCKET` (the driver socket), `XDG_RUNTIME_DIR` with the rootless Podman socket, Podman 5.x and the `openshell` CLI on `PATH`, and a built CLI (`dist/src/cli/main.js`). The tests set none of them. Compiled files are under `dist/test/integration`.

| Host | Opt-in and executable | File | Name pattern (`--test-name-pattern`) |
| --- | --- | --- | --- |
| Muse Code | `REALM_LIVE_MUSE=1`, `REALM_MUSE_BIN` (absolute path, optional; default `muse` on `PATH`) | `host-live-muse.test.js` | `muse production` (the validator test is named `V1LIVE-01 muse validator` and is not selected) |
| Grok Build, plain production | `REALM_LIVE_GROK_BUILD=1`, `REALM_GROK_BUILD_BIN` (optional; default `grok`) | `host-live-wave2-production.test.js` | `grok-build production:` (with the colon) |
| Grok Build, both-files attribution | same | same | `grok-build production attribution` |
| Grok Build, Claude-file control | same | same | `grok-build production control` |
| Prime Agent | `REALM_LIVE_PRIME_AGENT=1` | same | `prime-agent production` (a skip: B-48-02) |

Example for the Grok tests (all three): `REALM_LIVE_PRODUCTION=1 REALM_LIVE_GROK_BUILD=1 ... node --test --test-name-pattern "grok-build production" dist/test/integration/host-live-wave2-production.test.js`. The attribution tests install the Claude file, so they skip while a Realm receipt for `claude` exists in the shared state directory; the window must not hold a real `claude` receipt. Optional: `REALM_LIVE_GROK_WARM=1` for the warm diagnostic variant of the two attribution tests (deviation 2). The window must hash or snapshot `~/.grok/config.toml`, `~/.claude.json` and the Muse settings file itself as well; the tests hash them before and after and print nothing of their content.

## 7. Requirement status

- HTIER-02 (Muse Code): wired, command drive, gated, not run.
- HTIER-03 (Prime Agent): blocked, B-48-02, recorded as a gap in the registry and as the fixed skip sentence; nothing to run.
- HTIER-04 (Grok Build): wired, health-check drive, gated, not run.
- HTIER-01 (live half): the harness has the both-files attach and the Claude-file-alone control; nothing was run.
- HTIER-05: registry, live specs and the generated matrix block agree; enforce-default unedited and green.

Nothing was run on the production stack.
