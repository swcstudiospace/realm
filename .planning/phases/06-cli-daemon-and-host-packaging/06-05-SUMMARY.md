---
phase: 06-cli-daemon-and-host-packaging
plan: 06-05
subsystem: infra
tags: [doctor, control-channel, agentos, cli, bin]

# Dependency graph
requires:
  - phase: 06-01
    provides: control socket surface (controlSocketPath, SOCKET_TIMEOUT_MS) reused by the control-channel item
provides:
  - control-channel and agentos doctor items with fix text on every non-pass
  - package.json bin entry pointing at the compiled CLI
  - test/doctor/control-channel.test.ts covering both items, order, and fix texts
affects: [06-cli-daemon-and-host-packaging, doctor, cli-packaging]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
actuals:
  tokens: 4400
  tasks: 2
  commits: 0

# Tech tracking
tech-stack:
  added: []
  patterns: ["injected liveness probe defaulting to warn (agentosAlive)", "dial-bound control-channel check with ENOENT-warns daemon-down semantics"]

key-files:
  created:
    - test/doctor/control-channel.test.ts
  modified:
    - src/doctor/checks.ts
    - package.json

key-decisions:
  - "Control-channel dial failure other than ENOENT fails closed as REALM_NOT_ACTIVE so a tampered socket never passes (T-06-12)"
  - "Missing run directory or socket warns (stopped daemon is normal); wrong mode fails with a chmod 700 fix"
  - "agentosAlive absent warns with the realm-up fix; probe false/reject fails as AGENTOS_CRASH_LOOP (T-06-13: details name codes and modes only)"
  - "bin uses the ./dist/src/cli/main.js form to match the omp.extensions dist convention"

patterns-established:
  - "Doctor Phase 6 items appended after anda-bridge; REGISTERED order preserved under D-44"

requirements-completed: [CLI-03]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "control-channel and agentos doctor items with fix text on every non-pass, eight-item report order preserved"
    requirement: "CLI-03"
    verification:
      - kind: unit
        ref: "test/doctor/control-channel.test.ts"
        status: unknown
    human_judgment: true
    rationale: "Tests were written but not executed in this assignment (execution is the verifier's job per assignment constraints); a human or CI run must confirm pass before sign-off."
  - id: D2
    description: "package.json bin points at the compiled CLI under dist/src/cli/ with no new dependency"
    requirement: "CLI-03"
    verification: []
    human_judgment: true
    rationale: "One-line manifest change; needs a pack/install check by the verifier to confirm the entry resolves."

# Metrics
duration: n/a (single execution session, no commits per assignment constraints)
completed: 2026-10-22
status: complete
---

# Phase 06 Plan 05: Doctor Control-Channel and AgentOS Items plus bin Entry Summary

**Eight-item doctor report with control-channel and agentos checks carrying fix texts, plus the package.json bin entry at the compiled CLI**

## Performance

- **Duration:** single execution session
- **Started:** 2026-10-22
- **Completed:** 2026-10-22
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `control-channel` doctor item: stats the run directory for 0700 and dials `controlSocketPath` with the injected `connectSocket` bounded by `SOCKET_TIMEOUT_MS`; absent run directory or socket warns (daemon down is normal), wrong mode or refused dial fails closed with a fix.
- `agentos` doctor item: warns with `Run realm up, then rerun doctor.` when no `agentosAlive` probe is configured; injected probe drives pass (live) and fail (down or silent, `AGENTOS_CRASH_LOOP`) with fixes.
- Twelve CLI-03-titled tests in `test/doctor/control-channel.test.ts` covering pass/warn/fail shapes, dial-path and timeout-bound assertions, non-echo of socket errors, full eight-item order, and fix-on-every-non-pass.
- `package.json` gains `"bin": { "realm": "./dist/src/cli/main.js" }` with no other field changed and no new dependency.

## Task Commits

No commits were made: this assignment forbids git commands and commits. All changes sit uncommitted in the working tree for the main agent to verify and commit.

1. **Task 1: control-channel and agentos doctor items with fix texts (P6-D6, P6-D14)** - uncommitted (tdd)
2. **Task 2: package.json bin field at the compiled CLI (P6-D7)** - uncommitted (auto)

## Files Created/Modified

- `src/doctor/checks.ts` - `CheckId` gains `control-channel` and `agentos`; `DoctorOptions` gains the optional `agentosAlive` probe (`AgentOsAliveProbe`); both items appended to `REGISTERED` after `anda-bridge`; `FIX_CONTROL_ABSENT`, `FIX_CONTROL_REFUSED`, `FIX_AGENTOS_UP` constants plus inline chmod/move-aside fixes naming the run directory path.
- `test/doctor/control-channel.test.ts` - new suite, all titles cite CLI-03, all probes injected (no process runs, no socket opens).
- `package.json` - `bin` field only.

## Decisions Made

- Dial failures other than `ENOENT` fail closed with `REALM_NOT_ACTIVE` detail (T-06-12: a tampered or foreign socket never passes).
- `ENOENT` on the dial, a missing run directory, and an unconfigured `agentosAlive` all warn rather than fail, since a stopped daemon is a normal state.
- Reused the existing `STATE_DIR_MODE` (0700) constant for the run-directory mode check instead of importing `RUN_DIR_MODE`, keeping the key links to exactly `controlSocketPath` and `SOCKET_TIMEOUT_MS` as the plan specified.
- Details name catalogue codes, modes, and rules only; the refused-socket detail never echoes the socket error text (T-06-13).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Restored accidentally dropped Phase 3 seams in DoctorOptions**
- **Found during:** Task 1 (DoctorOptions edit)
- **Issue:** The edit adding `agentosAlive` replaced the range holding the Phase 3 seams, deleting `env`, `runCommand`, `connectSocket`, and `fetchInformation` from the interface.
- **Fix:** Re-applied the original Phase 3 seam block verbatim above the new `agentosAlive` field; verified the full interface by re-reading before continuing.
- **Files modified:** src/doctor/checks.ts
- **Verification:** Re-read of `DoctorOptions` confirms all eight fields present; no other code was touched in between.
- **Committed in:** uncommitted (part of Task 1 working-tree changes)

---

**Total deviations:** 1 auto-fixed (self-caught editing slip, no trace in the final diff)
**Impact on plan:** None - final code matches the plan exactly.

## Issues Encountered

- The pre-existing suites `test/doctor/checks.test.ts` ("only the seven checks are registered") and `test/doctor/runtime-checks.test.ts` ("no AgentOS or control-channel item is registered") assert the old seven-item report and will fail against the new eight-item `REGISTERED`. They are outside this plan's `files_modified` and assignment constraints forbid editing them, so they were left untouched. A sibling plan or the verifier must update those two assertions to the eight-item order.
- Verification commands from the plan (`tsc`, `node --test`, `node -e` bin check, grep for CLI-03 titles) were not run: assignment constraints forbid running tests, typecheck, lint, build, or git commands. The verifier owns execution.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Doctor now covers all eight CLI-03 prerequisites with fix texts; ready for the e2e plan to exercise the full report through the CLI-over-fake-daemon path.
- Blocker for green CI: update the two stale seven-item assertions noted above and run the plan's verification commands.

---
*Phase: 06-cli-daemon-and-host-packaging*
*Completed: 2026-10-22*
