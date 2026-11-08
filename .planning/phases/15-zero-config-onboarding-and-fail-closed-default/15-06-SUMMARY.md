---
phase: 15
plan: 06
subsystem: doctor-runtime-checks
tags: [doctor, runtime-roots, driver-socket, gateway, openshell-status, spawn-env, onboarding]
requires: ["15-04", "15-05"]
provides:
  - "runtime-roots fails for a channel socket path over 107 bytes, a non-canonical root, a foreign-owned root, overlapping effective roots, stateDir inside the workspace and a config.json inside the workspace"
  - "driver-socket takes its path as an argument (driverSocketPath before REALM_DRIVER_SOCKET) and checks the socket and parent owner"
  - "gateway runs openshell status -o json under selectOpenShellEnvironment with a bounded wait and reads only the string status"
  - "a config that does not load is one runtime-roots item whose detail is the problem phrases from configProblems"
  - "REALM_DRIVER_GATEWAY_ENDPOINT and REALM_DRIVER_GATEWAY_CA are gone from the daemon allowlist, the doctor and its tests"
affects: [src/cli/main.ts (plan 15-07 passes configPath, configProblems and driverSocketPath into DoctorOptions)]
key-files:
  created: []
  modified:
    - src/doctor/runtime-checks.ts
    - src/doctor/checks.ts
    - src/runtime/openshell.ts
    - src/daemon/spawn-env.ts
    - test/doctor/runtime-root-checks.test.ts
    - test/doctor/checks.test.ts
    - test/doctor/dial-defaults.test.ts
    - test/daemon/spawn-env.test.ts
decisions:
  - "driverSocketPath wins over REALM_DRIVER_SOCKET; no <stateDir>/gateway/driver.sock fallback (as the plan decided)"
  - "The gateway item reads the status field only; the exit code alone never passes it, and no detail carries command output, an error message or an errno"
  - "runtimeChecks throws SCHEMA_INVALID when a config is handed in without runCommand, so the gateway item never guesses how to run openshell; runChecks always supplies defaultRunCommand"
  - "The socket-path check measures the two host paths under a fixed session named daemon, as the plan specified"
requirements: [ONB-04]
metrics:
  tasks: 4
  commits: 4
  completed: 2026-11-08
plan_head_before: f0412bd208a5415e29a3a8a969c24eea28d772cb
commits: 4
status: complete
actuals:
  tokens: 21000
  tasks: 4
  commits: 4
---

# Phase 15 Plan 06: doctor checks for the roots, the driver socket and the gateway (ONB-04, D-1506) Summary

`realm doctor` now reports `runtime-roots`, `driver-socket` and `gateway` to the design in `15-RESEARCH.md` section 3.4: the roots check refuses the layouts the driver would refuse, the driver socket check includes ownership, and the gateway item asks `openshell status -o json` instead of dialling a TLS endpoint the daemon no longer receives. A config that cannot be loaded yields one item whose detail names the failing keys.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | runtime-roots: channel path, canonical, owner, overlap, config location | 819c20a | src/doctor/runtime-checks.ts, test/doctor/runtime-root-checks.test.ts |
| 2 | driver-socket: path argument, socket and parent owner | 78e5292 | src/doctor/runtime-checks.ts, test/doctor/runtime-root-checks.test.ts |
| 3 | gateway runs openshell status; TLS dial and allowlist names removed | 35ae71f | src/doctor/runtime-checks.ts, src/doctor/checks.ts, src/daemon/spawn-env.ts, test/doctor/runtime-root-checks.test.ts, test/doctor/dial-defaults.test.ts, test/daemon/spawn-env.test.ts |
| 4 | one-item config report and DoctorOptions wiring | bb6ed18 | src/doctor/runtime-checks.ts, src/doctor/checks.ts, test/doctor/runtime-root-checks.test.ts, test/doctor/checks.test.ts |

## What was added

- `runtimeRootsCheck(config, stat, realpath, configPath?)`. Per-root order: unset, relative, absent, unreadable, symlink, not a directory, `realpath` throws (`cannot be inspected`), not canonical, not owned by this account (every root, not only the workspace), then the 0700 mode of the private roots. Layout findings follow: `secretRoot is too long for a socket path under session daemon` (built from `channelPathsOf(secretDirOf(...))` and `assertSocketPathsFit`, the driver's own helpers), `secretRoot overlaps sandboxStateRoot`, `<key> overlaps workspaceRoot`, `stateDir overlaps workspaceRoot`, and `config.json is inside workspaceRoot`. Every detail is a fixed phrase naming a key or a condition, never a path.
- `driverSocketCheck(socketPath, stat, connect, timeoutMs)`: no env read; fails a socket or a parent directory owned by another uid. `runtimeChecks` computes `options.driverSocketPath ?? options.env.REALM_DRIVER_SOCKET`.
- `gatewayCheck(env, runCommand, timeoutMs)`: `connected` passes; `not_configured` is `no gateway is registered for this account`; any other status is `gateway is not connected`; non-JSON, a JSON value that is not an object with a string `status` is `gateway status is not JSON`; a non-zero exit is `gateway status exited with status <N>`; a rejecting run is `openshell cannot be started`; a probe that outlives `timeoutMs` (raced locally, because the seam may ignore it) is `gateway status did not answer in time`.
- `runtimeChecks` one-item branch: detail is `configProblems.join("; ")` when non-empty, else `runtime config is absent`; fix is still the `realm init` guidance, and no stat, driver dial or `openshell` run happens.
- `DoctorOptions` gains `configPath`, `configProblems`, `driverSocketPath`; `connectGateway` is removed; `runChecks` passes them and `runCommand: options.runCommand ?? defaultRunCommand` to `runtimeChecks`. The `REGISTERED` order and the runtime append are unchanged.
- `src/daemon/spawn-env.ts`: the `REALM_DRIVER_GATEWAY_ENDPOINT` and `REALM_DRIVER_GATEWAY_CA` entries are deleted and the header comment rewritten. In `test/daemon/spawn-env.test.ts` both names moved from the allowed constant to the refused list (so the exact-names test asserts them absent) and the two real-process legs assert the child sees `null` for both.

## Verification

- `npm run typecheck` and `npm run build`: pass (run through the heavy-slot lock).
- `node --test dist/test/doctor/runtime-root-checks.test.js dist/test/doctor/checks.test.js dist/test/doctor/control-channel.test.js dist/test/doctor/runtime-checks.test.js dist/test/daemon/e2e.test.js`: 109 tests, 109 pass, 0 fail, 0 skipped.
- `node --test dist/test/doctor/runtime-root-checks.test.js dist/test/daemon/spawn-env.test.js dist/test/doctor/dial-defaults.test.js` (after task 3): 40 tests, 40 pass.
- Acceptance greps: `grep -rn "connectGateway" src test` and `grep -rn "connectGateway\|defaultConnectGateway\|REALM_DRIVER_GATEWAY_ENDPOINT" src/doctor src/daemon` return no match.
- The 107-byte boundary is tested both ways: the padded root's longest channel path is exactly 107 bytes (pass) and 108 (fail).
- Not run (not named by this plan): `test/cli/cli.test.ts`, which pins plain `realm doctor` exit 0 (P15-O3). This plan does not touch the CLI.

## Deviations from Plan

**1. [Rule 3 - Blocking] The allowlist also held `REALM_DRIVER_GATEWAY_CA`; both names were removed**
- **Found during:** Task 3
- **Issue:** The plan names only `REALM_DRIVER_GATEWAY_ENDPOINT`. At HEAD, commit e34da60 had also added `REALM_DRIVER_GATEWAY_CA` for the TLS dial this plan deletes (orchestrator note 4 and 7b).
- **Fix:** Both entries are removed from `ALLOWED_EXACT`, the e34da60 header comment is replaced, and the spawn-env test asserts both absent. `grep -rn "REALM_DRIVER_GATEWAY_ENDPOINT\|REALM_DRIVER_GATEWAY_CA" src` leaves only `src/runtime/driver/main.ts` (the driver's own unit-supplied variables, read from the driver's environment, not the daemon's). No daemon-side reader existed.
- **Files modified:** src/daemon/spawn-env.ts, test/daemon/spawn-env.test.ts
- **Committed in:** 35ae71f

**2. [Rule 3 - Blocking] Three dial tests for the removed `defaultConnectGateway` were deleted from a file the plan does not list**
- **Found during:** Task 3
- **Issue:** `test/doctor/dial-defaults.test.ts` imported `defaultConnectGateway` and held three `Q0-016` tests for its `SCHEMA_INVALID` rejections. Removing the function broke the import.
- **Fix:** The import and the three tests were removed; the driver and socket dialer tests in that file are untouched.
- **Files modified:** test/doctor/dial-defaults.test.ts
- **Committed in:** 35ae71f

**3. [Plan text vs tree] File structure differs from the plan's line references**
- The plan's line numbers (`:85-115`, `:255-271`) pointed at an older layout; the tree held the same code at different lines. Intent was applied unchanged.

**4. [Rule 2 - Missing critical] `runtimeChecks` refuses a config without `runCommand`**
- **Issue:** Plan task 3 step 3 says `runCommand` is required when a config is present but leaves the missing case open.
- **Fix:** `runtimeChecks` throws `SCHEMA_INVALID` (a catalogue code) in that case rather than falling back to a guessed runner. `runChecks` always passes `defaultRunCommand`, so no caller in the tree hits it.
- **Committed in:** 35ae71f

**5. [Rule 1 - Boundary] `OPENSHELL_BINARY` may not be imported into `src/doctor/runtime-checks.ts`**
- **Found during:** orchestrator verification (full `npm run lint`)
- **Issue:** Plan task 3 told the executor to import `OPENSHELL_BINARY` into `runtime-checks.ts`. The ESLint rule D-99/C-5 (`openshellBinary` in `eslint.config.js`) allows that identifier only in `src/tools/`, `src/runtime/openshell.ts`, `src/runtime/session-execution.ts` and `src/doctor/checks.ts`. The plan text is wrong on this point.
- **Fix:** `src/runtime/openshell.ts` gained `gatewayStatusJsonCommand()`, returning a frozen `{ file, args }` for `openshell status -o json`. `gatewayCheck` runs `command.file` and `command.args` and names no binary. A test beside the OBS-04 one pins the file, the args and the frozen state. The rule, its allowlist and `buildGatewayStatusArgv` are unchanged.
- **Committed in:** 8d0be55

**Total deviations:** 5 (2 blocking, 1 missing critical, 1 plan-vs-tree, 1 boundary rule). **Impact:** none beyond the plan's intent.

## Corrections after orchestrator verification

This summary first said the plan was verified with targeted tests only. The orchestrator's full-gate run on the plan tip (7f6ef64) found that `npm run lint` and `npm run check:gates` failed for three reasons the targeted tests could not show:

1. **Lint, ESLint rule D-99/C-5:** `src/doctor/runtime-checks.ts` imported and used `OPENSHELL_BINARY` (deviation 5).
2. **Lint, `@typescript-eslint/no-unnecessary-condition`:** `test/doctor/runtime-root-checks.test.ts` used `item?.detail` after an assertion had narrowed `item`.
3. **Gate, module-size ratchet:** `src/doctor/checks.ts` grew to 1059 lines against its allowlisted ceiling of 1051 (`scripts/check/module-size-allowlist.json`), because the three new `DoctorOptions` fields and the longer `runtimeChecks({...})` call added lines.

Commit 8d0be55 (`fix(15-06)`) closed all three. The runtime option building moved into `runtimeCheckOptionsOf` in `src/doctor/runtime-checks.ts` (same conditional-spread rules, no behaviour change), so `runChecks` makes one call and `src/doctor/checks.ts` is 1050 lines. The three `DoctorOptions` fields and their comments stay for plan 15-07. The allowlist, the lint rule and every suppression policy are untouched. The `item` assertion in the test now narrows first and reads `item.detail` without a chain.

Results observed after the fix, each run through the heavy-slot lock: `npm run typecheck` exit 0; `npm run lint` exit 0; `npm run check:gates` exit 0 (module size: 106 files, no violations); `npm run build` exit 0; the eight targeted test files (runtime-root-checks, checks, control-channel, runtime-checks, daemon e2e, spawn-env, dial-defaults, openshell-argv) pass, 138 tests, 0 failures. The full `npm test` was not run here; the orchestrator runs it.

## Issues Encountered

None. `src/cli/main.ts` does not yet pass `configPath`, `configProblems` or `driverSocketPath` into `DoctorOptions`; plan 15-07 owns that wiring, so on the CLI path an invalid config still reports `runtime config is absent` until 15-07 lands.

## Known Stubs

None.

## Threat Flags

None. The new child process (`openshell status -o json`) is the one the plan's threat model describes: argv with no shell, the OpenShell environment allowlist, a bounded wait, and output parsed for one field and discarded.

## Next Phase Readiness

Plan 15-07 can pass `configPath`, `configProblems` (from `describeRuntimeConfigProblems`, or `config.json is absent`) and `driverSocketPath` into `DoctorOptions`. Documentation mentions of the two removed daemon environment names are left to plan 15-09, as instructed.

---
*Phase: 15-zero-config-onboarding-and-fail-closed-default*
*Completed: 2026-11-08*

## Self-Check: PASSED
