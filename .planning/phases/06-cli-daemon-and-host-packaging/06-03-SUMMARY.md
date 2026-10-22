---
phase: 06-cli-daemon-and-host-packaging
plan: 06-03
subsystem: daemon
tags: [node:net, unix-socket, lifecycle, reap, control-channel, tdd]

# Dependency graph
requires:
  - phase: 06-01
    provides: control channel wire format, socket guards, and timeout bound (channel.ts)
provides:
  - Daemon module (src/daemon/daemon.ts): buildDaemonHandle, startDaemon, graceful shutdown
  - Daemon test suite (test/daemon/daemon.test.ts): CLI-01 and RT-06 ownership, reap-order, dispatch, and shutdown cases
affects: [06-04 (CLI consumes buildDaemonHandle/startDaemon), e2e proof]

# Actuals (#2632) — same estimateTokens scale (chars/4 over the realized diff).
actuals:
  tokens: 9200
  tasks: 3
  commits: 0

# Tech tracking
tech-stack:
  added: []
  patterns: ["reap-before-serve gate (serve only after reapStartup resolves)", "single-owner socket bind with LOCK_CONFLICT refusal", "catalogue-code-only replies on every dispatch path"]

key-files:
  created: [src/daemon/daemon.ts, test/daemon/daemon.test.ts]
  modified: []

key-decisions:
  - "Second owner refuses with LOCK_CONFLICT; an EADDRINUSE bind race maps to LOCK_CONFLICT too"
  - "No andaUrl and no injected bridge builds an internal unreachable bridge, so status/doctor work while up reports ANDA_UNREACHABLE"
  - "Missing sweep/libpod seams refuse with SCHEMA_INVALID instead of silently skipping the reap"
  - "down replies after controller close with the true outcome; a concurrent second down is a no-op"
  - "Probe defaults mirror the doctor defaults (argv-form execFile, env spread copy)"

patterns-established:
  - "Daemon serve gate: connections accepted at listen wait on a gate that opens only after reapStartup resolves"
  - "Source-guard test pins P6-D1: daemon.ts contains no process.argv, process.env, process.exit, or detached spawn"

requirements-completed: [CLI-01, RT-06]

# Coverage (#1602) — verification status is unknown: this wave prohibits running
# tests, so the orchestrator gate run determines pass/fail. Refs are exact test titles.
coverage:
  - id: D1
    description: "buildDaemonHandle shares the createRealmHandle path; controller snapshot and dispatcher status answer through displayStatus"
    requirement: "CLI-01"
    verification:
      - kind: unit
        ref: "test/daemon/daemon.test.ts#CLI-01: buildDaemonHandle wires the shared composition root and answers snapshot plus dispatcher status (P6-D12)"
        status: unknown
    human_judgment: false
  - id: D2
    description: "Single-owner start binds the socket and answers status; a second start refuses with LOCK_CONFLICT"
    requirement: "RT-06"
    verification:
      - kind: integration
        ref: "test/daemon/daemon.test.ts#RT-06: startDaemon with no owner binds the socket and answers status over a real socket pair"
        status: unknown
      - kind: integration
        ref: "test/daemon/daemon.test.ts#RT-06: a second startDaemon against the same state directory refuses with LOCK_CONFLICT (single owner)"
        status: unknown
    human_judgment: false
  - id: D3
    description: "Reap sweep runs before serving; failed sweep rejects startup with records untouched"
    requirement: "CLI-01"
    verification:
      - kind: integration
        ref: "test/daemon/daemon.test.ts#CLI-01: startDaemon runs the reap sweep before serving and deletes pre-existing records (P6-D4)"
        status: unknown
      - kind: integration
        ref: "test/daemon/daemon.test.ts#CLI-01: a failed sweep rejects startup before any record is touched (P6-D4)"
        status: unknown
    human_judgment: false
  - id: D4
    description: "All four methods dispatch over the socket with catalogue-code failures (up probe-then-start, doctor, unknown/malformed refusal)"
    requirement: "CLI-01"
    verification:
      - kind: integration
        ref: "test/daemon/daemon.test.ts#CLI-01: up with a failing probe answers the probe code without starting (P6-D5)"
        status: unknown
      - kind: integration
        ref: "test/daemon/daemon.test.ts#CLI-01: up with a healthy probe starts the session and answers the active snapshot"
        status: unknown
      - kind: integration
        ref: "test/daemon/daemon.test.ts#CLI-01: up with a missing workspaceRoot refuses with SCHEMA_INVALID"
        status: unknown
      - kind: integration
        ref: "test/daemon/daemon.test.ts#CLI-01: doctor dispatches runChecks over the socket"
        status: unknown
      - kind: integration
        ref: "test/daemon/daemon.test.ts#RT-06: unknown methods and malformed lines refuse with SCHEMA_INVALID and carry the id"
        status: unknown
    human_judgment: false
  - id: D5
    description: "down drains, closes, removes the socket, and resolves done; a second down is a no-op"
    requirement: "CLI-01"
    verification:
      - kind: integration
        ref: "test/daemon/daemon.test.ts#CLI-01: down drains, closes, removes the socket, and resolves done"
        status: unknown
      - kind: integration
        ref: "test/daemon/daemon.test.ts#CLI-01: a second down is a no-op that still answers"
        status: unknown
    human_judgment: false
  - id: D6
    description: "Source guard pins P6-D1: no argv parsing, no daemon spawning, no process environment read"
    requirement: "CLI-01"
    verification:
      - kind: unit
        ref: "test/daemon/daemon.test.ts#RT-06: daemon.ts parses no argv, spawns no daemon, and reads no process environment (P6-D1)"
        status: unknown
    human_judgment: false

# Metrics
duration: single execution wave
completed: 2026-10-22
status: complete
---

# Phase 06 Plan 03: Daemon Summary

**Single-owner daemon with reap-before-serve, four-method channel dispatch, and graceful down shutdown, sharing the composition-root wiring with realm mcp**

## Performance

- **Duration:** single execution wave
- **Started:** 2026-10-22
- **Completed:** 2026-10-22
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- `buildDaemonHandle` builds the exact `createRealmHandle` path with production adapters (SessionExecution over the libpod client, AndaBridge over the configured URL, spawnOpenShellRunner, Date clock); tests inject the existing fakes at the same seam (P6-D12)
- `startDaemon` enforces single ownership per state directory: stale-socket connect-then-remove, then listen plus 0600 chmod; a live rival refuses with LOCK_CONFLICT
- Reap-before-serve: `reapStartup` with the bounded `removeAllRealmContainers` sweep runs before the serve gate opens; a failed sweep rejects startup with records untouched (P6-D4, T-06-06)
- All four CONTROL_METHODS dispatch over the 06-01 channel with catalogue-code-only replies: status via displayStatus, up via probe-then-create, down via drain-then-close, doctor via runChecks (T-06-08)
- Graceful shutdown on down: stops accepting, drains in-flight within SOCKET_TIMEOUT_MS, delegates teardown to the RealmHandle close path, removes the socket, resolves done; a concurrent second down is a no-op (T-06-07)
- Threat mitigations T-06-06 (reap before serve), T-06-07 (single owner plus bounded drain), and T-06-08 (shared wiring, no second dispatcher path) are implemented as specified

## Task Commits

Per-task commits were not made in this wave: the wave constraints prohibit running git commands, and the orchestrator gates and commits afterward.

1. **Task 1: buildDaemonHandle plus single-owner start** - uncommitted (orchestrator commits)
2. **Task 2: Reap-before-serve and method dispatch** - uncommitted (orchestrator commits)
3. **Task 3: Graceful shutdown on down** - uncommitted (orchestrator commits)

## Files Created/Modified

- `src/daemon/daemon.ts` - buildDaemonHandle, startDaemon, method dispatch, graceful shutdown (P6-D1, P6-D4, P6-D12)
- `test/daemon/daemon.test.ts` - CLI-01 and RT-06 ownership, reap-order, dispatch, and shutdown cases

## Decisions Made

- Second owner refuses with LOCK_CONFLICT; an EADDRINUSE bind race between the stale probe and listen maps to LOCK_CONFLICT rather than a generic failure
- No andaUrl and no injected bridge builds a module-private unreachable bridge (connect rejects ANDA_UNREACHABLE), so status and doctor keep working while up reports unreachable through the controller
- Omitting both the sweep seam and any libpod seam refuses with SCHEMA_INVALID at startup rather than silently skipping the P6-D4 reap
- down replies after controller close with the true outcome; a concurrent second down answers the current snapshot without re-running teardown
- down keeps its own in-flight count during the drain, so the drain waits only for other requests (inFlight above one)
- Probe defaults mirror the doctor defaults exactly (argv-form execFile, env spread copy, plain dial); no new helper contract was introduced

## Deviations from Plan

None - plan executed exactly as written. Style-level adjustments during writing (inline narrowing instead of a local record guard, typed error members instead of inline casts, removal of a dead connection-tracking set) changed no behavior.

## Issues Encountered

- The mid-write discovery that `src/cli/main.ts` (sibling plan 06-04, same wave) guesses `buildDaemonHandle(env)` with an env-only signature. That guess cannot satisfy P6-D12 (the handle needs runtimeInput, policyPath, sessionId). Messaged Exec06_04 with the exact 06-03 export contract so its `defaultBuildHandle` passes full options. No 06-03 change was needed: the plan-specified options object is the correct contract.
- Verification (tsc plus node --test) was not run: this wave prohibits running builds, tests, linters, and git commands. The gate run belongs to the orchestrator. Test titles cite CLI-01 or RT-06 as the plan requires; grep for those IDs plus the tsc/test invocation in the plan verification block is the orchestrator's check.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 06-04 (CLI) can consume `buildDaemonHandle` and `startDaemon` through the contract messaged to Exec06_04: build `{ runtimeInput, policyPath, sessionId, libpodSocketPath, env }` from CLI-resolved values; every other seam is optional
- The e2e proof can drive up/status/down/doctor over a real socket pair with scripted probe and sweep seams; no live Podman, OpenShell, or daemon is needed in tests
- Live Podman/OpenShell/daemon acceptance remains gated as the phase brief requires; the suite proves unit-level behavior only

---
*Phase: 06-cli-daemon-and-host-packaging*
*Completed: 2026-10-22*
