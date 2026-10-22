---
phase: 06-cli-daemon-and-host-packaging
plan: 06-01
subsystem: infra
tags: [node:net, ndjson, unix-socket, control-channel]

# Dependency graph
requires:
  - phase: 02-policy-state-and-filesystem-lockdown
    provides: controlSocketPath (the only socket path source) and the 0700 directory precedent
provides:
  - Control-channel wire format (NDJSON + request ids + catalogue-code replies) with SOCKET_TIMEOUT_MS-bounded socket IO
  - Run-directory guards (0700 create-or-check, 0600 chmod, SCHEMA_INVALID refusal) for the daemon (06-03) and CLI (06-04) plans
affects: [06-03-daemon, 06-04-cli, 06-05-doctor]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 6400
  tasks: 2
  commits: 0

# Tech tracking
tech-stack:
  added: []
  patterns: [injected stat/chmod/getuid seams for hermetic filesystem tests, catalogue-code-only socket boundary]

key-files:
  created: [src/daemon/channel.ts, test/daemon/channel.test.ts]
  modified: []

key-decisions:
  - "Transport failures that are neither timeouts nor decode refusals surface REALM_NOT_ACTIVE; timeouts surface TOOL_TIMEOUT; decode/refusal surfaces SCHEMA_INVALID — every failure leaving the module carries a catalogue code only"
  - "The thrown run-dir refusal stays a bare catalogue RealmError; the expected-vs-observed naming lives in the pure describeRunDirRefusal helper for startup/doctor fix lines"
  - "Kept `new Promise` executors: lib is ES2023, which lacks Promise.withResolvers types, and verification cannot run in this wave to prove otherwise"

patterns-established:
  - "Channel tests drive the real module over live Unix sockets in tmp dirs with injected fs seams for the permission cases"
  - "Structural test pins the channel import allowlist (node:net, node:fs, errors, timeout, paths) and the no-Podman/Docker/container-socket surface"

requirements-completed: [RT-06]

# Coverage metadata (#1602) — verification NOT run in this wave per plan constraints
# (no tests/typecheck/lint executed by the executor); statuses are unknown so
# verify-work routes these to automated verification before sign-off.
coverage:
  - id: D1
    description: "NDJSON wire format with request ids, catalogue-code-only errors, malformed-line rejection, and TOOL_TIMEOUT-bounded socket operations"
    requirement: "RT-06"
    verification:
      - kind: unit
        ref: "test/daemon/channel.test.ts#RT-06 round-trip / unknown method / malformed line / TOOL_TIMEOUT / garbage and id mismatch"
        status: unknown
    human_judgment: false
  - id: D2
    description: "Run-directory guards: 0700 create-or-check, 0600 chmod, SCHEMA_INVALID refusal on wrong mode/foreign owner/non-directory, structural no-container-socket pin"
    requirement: "RT-06"
    verification:
      - kind: unit
        ref: "test/daemon/channel.test.ts#RT-06 ensureSocketDir / chmodSocket / describeRunDirRefusal / structural pin"
        status: unknown
    human_judgment: false

# Metrics
duration: unmeasured (one execution wave, 2026-10-22)
completed: 2026-10-22
status: complete
---

# Phase 06 Plan 01: Control Channel Summary

**NDJSON control-channel wire format with request ids and catalogue-code-only errors, plus 0700/0600 socket guards bounded by SOCKET_TIMEOUT_MS — no daemon logic.**

## Performance

- **Duration:** unmeasured (one execution wave)
- **Started:** 2026-10-22
- **Completed:** 2026-10-22
- **Tasks:** 2
- **Files modified:** 2 created, 0 modified

## Accomplishments

- `src/daemon/channel.ts`: CONTROL_METHODS, encode/decode helpers, `sendRequest`/`readRequestLine`/`writeReplyLine` bounded by `withTimeout`, `ensureSocketDir`, `chmodSocket`, `describeRunDirRefusal` (P6-D2, P6-D3, P6-D10, P6-D11)
- `test/daemon/channel.test.ts`: 11 RT-06-titled tests covering live-socket id round-trip for all four methods, catalogue-code-only errors, malformed-line rejection, timeout bound, guards, and the structural pin
- Every failure leaving the module carries an existing catalogue code only; no new error code, policy key, or dependency added

## Task Commits

No per-task commits were made: this plan runs in wave 1 under shared constraints that forbid git commands for executors — the orchestrator gates, verifies (`tsc` + `node --test`), and commits. Files are left in the working tree:

1. **Task 1: NDJSON protocol with ids and catalogue-code errors (P6-D2, P6-D10)** — uncommitted (`src/daemon/channel.ts`, `test/daemon/channel.test.ts`)
2. **Task 2: Socket directory guards 0700/0600 with refusal (P6-D3, P6-D11)** — uncommitted (same files, extended)

## Files Created/Modified

- `src/daemon/channel.ts` - Wire format plus filesystem guards; imports node:net, node:fs, core/errors, core/timeout, session/paths only
- `test/daemon/channel.test.ts` - RT-06 suite: framing, error, timeout, permission, and no-socket-path cases

## Decisions Made

- Transport failures that are neither timeouts nor decode refusals surface `REALM_NOT_ACTIVE` (peer absent or went away); `withTimeout` expiry surfaces `TOOL_TIMEOUT`; malformed bytes, unknown methods, and id mismatches surface `SCHEMA_INVALID`. Rationale: the phase truth "every failure surfaces an existing catalogue ErrorCode only" leaves no room for raw `ECONNREFUSED`/syntax errors, and `REALM_NOT_ACTIVE` is the closest catalogue semantic for a missing peer.
- The thrown run-dir refusal stays a bare `makeRealmError("SCHEMA_INVALID")` (typed errors carry nothing but the code); the "names the expected mode and the observed state" requirement lives in the pure `describeRunDirRefusal` helper, which later startup/doctor surfaces reuse for fix lines. Modes and uids are not secrets, so naming them there is safe.
- `replyForMalformedLine` returns a reply only for actually-malformed lines with a recoverable id (null for well-formed lines and id-less garbage), so the future daemon can use it as a never-throws boundary mapper.
- `readRequestLine`/`writeReplyLine` are bare line-IO primitives for the accepted-socket side (plan 06-03); no listen/serve loop, no lifecycle, no reaping lives here per P6-D10.
- Kept `new Promise` executors instead of `Promise.withResolvers()`: `lib` is ES2023, which has no `withResolvers` types (ES2024), and this wave cannot run typecheck to prove an alternative compiles.

## Deviations from Plan

None - plan executed exactly as written. No deviation Rules 1-4 were triggered: no bugs to auto-fix, no missing critical functionality beyond the plan, no blocking issues, no architectural changes. The items above are within-plan implementation choices under "Claude's Discretion" (helper names, exact NDJSON field layout), recorded here for the record.

## Issues Encountered

- Two self-inflicted edit-range mistakes while inlining helpers temporarily broke `sendRequest`'s body (duplicate `ensureSocketDir` block, a swallowed `catch` line). Both were repaired by re-reading the affected ranges and re-issuing anchored edits; the final file was re-read end to end and is coherent. No plan impact.
- Style-rule reminders fired for `isRecord`, tiny functions, inline casts, and `Promise.withResolvers`. Resolved: single-use helpers inlined; local `isRecord`/`isControlId`/`isErrorCode` guards kept (the import allowlist forbids sharing a guard module, and `src/mcp/server.ts` sets the local-guard precedent); `as` casts replaced with `in`-narrowing except the intentional negative-test double assertion.

## Known Stubs

None - no TODO/FIXME/placeholder text, no hardcoded empty values, no unwired data sources in either file.

## Threat Flags

None new - this module IS the T-06-01/T-06-02/T-06-03 mitigation surface from the plan's threat register, implemented as specified (foreign-owner/mode refusal, 0700+0600 enforcement, `withTimeout` on every socket op).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready: plans 06-03 (daemon) and 06-04 (CLI) can build on `sendRequest`, `readRequestLine`/`writeReplyLine`, `ensureSocketDir`, `chmodSocket`, and `CONTROL_METHODS` without modification.
- Concern: verification was NOT run in this wave per the shared executor constraints (`tsc -p tsconfig.json && node --test dist/test/daemon/channel.test.js` plus the RT-06 title grep). Coverage statuses above are `unknown` so verify-work routes them to automated verification. The most type-fragile spots were reviewed by hand: `mkdirSync` options overload resolution, `process.getuid` optional typing (captured into a const before use), `match[1]` under `noUncheckedIndexedAccess` (handled via `flatMap`), and `assert.ok` narrowing on `reply.error`.

---
*Phase: 06-cli-daemon-and-host-packaging*
*Completed: 2026-10-22*
