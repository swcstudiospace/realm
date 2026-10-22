---
phase: 06-cli-daemon-and-host-packaging
plan: 06-04
subsystem: cli
tags: [cli, daemon, podman-probe, mcp-stdio, exit-codes, argv]

# Dependency graph
requires:
  - phase: 06-01
    provides: control-socket wire format (sendRequest, SOCKET_TIMEOUT_MS) the CLI dials
  - phase: 05-omp-plugin-mcp-and-acp-surfaces
    provides: createMcpServer stdio server and McpDispatcher surface reused by realm mcp
provides:
  - src/cli/main.ts: argv parsing, exit codes 0/1/2, detached spawn, probe-first up, local status/doctor, mcp stdio entry
  - test/cli/cli.test.ts: CLI-01 spawn/dial/exit cases, CLI-02 bounded PODMAN_MISSING case, mcp stdio case
affects: [06-03-daemon, 06-05-doctor-bin, 06-06-e2e, cli-04-host-snippets]

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
actuals:
  tokens: 5900
  tasks: 3
  commits: 0

# Tech tracking
tech-stack:
  added: []
  patterns: [injected-seams-no-process-in-tests, catalogue-code-on-stdout-reason-on-stderr, static-daemon-handle-import-with-refusal-on-missing-runtime-input]

key-files:
  created: [src/cli/main.ts, test/cli/cli.test.ts]
  modified: []

key-decisions:
  - "Any probe failure blocks spawn, not just PODMAN_MISSING (a daemon without a working Podman cannot serve; T-06-10)"
  - "defaultBuildHandle statically imports the 06-03 buildDaemonHandle and passes { runtimeInput, policyPath, sessionId, libpodSocketPath?, env }: policyPath defaults to <stateDir>/policy.json, sessionId to mcp, libpodSocketPath derived by the probe rule (<XDG_RUNTIME_DIR>/podman/podman.sock, absolute dir only), and mcp refuses SCHEMA_INVALID without caller-supplied runtimeInput. Live mcp still gates on the AgentOS driver seam (no in-repo implementation)."
  - "realm mcp defaults to process stdio; tests inject PassThrough streams, so no test starts a process"

patterns-established:
  - "CLI result object: runCli returns { exitCode, stdout, stderr }; main() is the only writer and the only process.env reader"

requirements-completed: [CLI-01, CLI-02]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "up/down/status/doctor/mcp parse with exits 0/1/2; up spawns detached argv-form child when no daemon answers"
    requirement: "CLI-01"
    verification:
      - kind: unit
        ref: "test/cli/cli.test.ts#realm up with no daemon spawns the detached child then reports over the socket (CLI-01)"
        status: unknown
      - kind: unit
        ref: "test/cli/cli.test.ts#unknown argv exits 2 with usage on stderr (CLI-01)"
        status: unknown
    human_judgment: false
  - id: D2
    description: "up with Podman missing reports PODMAN_MISSING, exits 1, never spawns, returns within a wall-clock bound"
    requirement: "CLI-02"
    verification:
      - kind: unit
        ref: "test/cli/cli.test.ts#realm up with Podman missing reports PODMAN_MISSING and exits promptly with no spawn (CLI-02)"
        status: unknown
    human_judgment: false
  - id: D3
    description: "realm mcp serves the Phase 5 MCP server over stdio from the shared handle; stdout carries only MCP messages"
    requirement: "CLI-01"
    verification:
      - kind: unit
        ref: "test/cli/cli.test.ts#realm mcp serves the Phase 5 server over stdio from the shared handle (CLI-01; CLI-04 entry)"
        status: unknown
    human_judgment: false

# Metrics
duration: single orchestrated session
completed: 2026-10-22
status: complete
---

# Phase 06 Plan 04: CLI Summary

**`realm` CLI with up/down/status/doctor/mcp, exits 0/1/2, detached argv-form spawn, probe-first up with bounded PODMAN_MISSING, and the Phase 5 MCP server over stdio**

## Performance

- **Duration:** single orchestrated session
- **Started:** 2026-10-22
- **Completed:** 2026-10-22
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- `src/cli/main.ts`: five-command parsing with strict single-arg usage (exit 2), state dir resolved from the passed environment, socket dial bounded by `SOCKET_TIMEOUT_MS`, probe-first `up` that never spawns on probe failure, spawn-then-retry within the bound, local `status`/`doctor` that name the absent daemon, and `mcp` serving `createMcpServer` from the shared handle with stdin-close shutdown
- `test/cli/cli.test.ts`: nine tests citing CLI-01/CLI-02 — spawn argv/detached/stdio assertions, down dispatch, local status/doctor content, usage exits, bounded PODMAN_MISSING (exit 1, no spawn, no dial, wall-clock bound), mcp tools/list plus tools/call through a fake-backed handle with the wiring request pinned, mcp refusal without runtime configuration, and a static allowlist guard (only `node:net`/`node:fs`/`node:child_process`, one `process.env` read, no `shell: true`)
- No new runtime import, no new error code, no new npm dependency; machine-readable codes on stdout, human reasons on stderr, no env value printed

## Task Commits

No per-task commits were made: the wave orchestrator owns all commits in this phase.

1. **Task 1: Argv parsing, exit codes, and daemon spawn** - uncommitted (orchestrator commits)
2. **Task 2: PODMAN_MISSING fast path with bounded wait** - uncommitted (orchestrator commits)
3. **Task 3: realm mcp stdio entry from the composition root** - uncommitted (orchestrator commits)

## Files Created/Modified

- `src/cli/main.ts` - CLI: parsing, exit codes, spawn, socket client, probe path, mcp entry (P6-D1, P6-D5, P6-D7, P6-D9, P6-D12, P6-D13)
- `test/cli/cli.test.ts` - CLI-01 spawn/dial/exit cases, CLI-02 bounded PODMAN_MISSING case, mcp stdio case

## Decisions Made

- Any probe failure (`PODMAN_MISSING`, `PODMAN_MACHINE_DOWN`, `PODMAN_UNSUPPORTED_VERSION`) blocks the spawn, not just `PODMAN_MISSING`: a daemon without a working Podman cannot serve, and T-06-10 names the probe as the gate before `up` proceeds.
- Local `status`/`doctor` with no daemon exit 0 with a local report that says the daemon is absent (OQ-P6-02 default): `disconnected` on stdout plus `daemon absent (REALM_NOT_ACTIVE)` on stderr for status; the checks JSON on stdout plus the absent note naming the local check count on stderr for doctor.
- `realm mcp` defaults to `process.stdin/stdout/stderr`; tests inject `PassThrough` streams, so no test starts a process.
- `main()` holds this module's single `process.env` read (the entry edge); `runCli` and every command path take `env` as a parameter. The static-guard test pins the single occurrence.
- `defaultBuildHandle` statically imports the 06-03 `buildDaemonHandle` and passes `{ runtimeInput, policyPath, sessionId, libpodSocketPath?, env }`: `policyPath` defaults to `<stateDir>/policy.json` (a missing file falls back to validated defaults per `loadPolicyFile`), `sessionId` defaults to `"mcp"`, `libpodSocketPath` is derived by the probe rule (`<XDG_RUNTIME_DIR>/podman/podman.sock`, absolute dir only; omitted when underivable since 06-03 refuses half-wired handles at build time), and `runtimeInput` has no safe default (image, workload, workspace are host decisions) so `mcp` refuses `SCHEMA_INVALID` without it instead of inventing configuration. Live `mcp` still gates on the AgentOS driver seam, which has no in-repo implementation.

Cross-plan note (not a deviation): 06-03 landed mid-wave, so the initial widened-string lazy import was replaced with the static import above, the mcp test now pins the wiring request, and a refusal test covers the missing-`runtimeInput` path. Production `realm mcp` still needs caller-supplied `runtimeInput`; there is no config-file story in Phase 6 scope.

## Deviations from Plan

None - plan executed exactly as written, plus the 06-03-driven seam update above (same-plan files, requested by the sibling plan's landed API). Two style-rule reminders were evaluated during implementation (`PodmanProbeResult` named type instead of `ReturnType`; the single-use `sleep` helper inlined). The `Promise.withResolvers` suggestion was declined because the repo targets ES2023, whose lib lacks it. These are in-plan code-shape choices, not deviations.

## Issues Encountered

- An `edit` range mistake briefly duplicated the `podman-probe` import and dropped the `SpawnDaemon` type, leaving the file unparseable; re-read and two correcting edits restored it. No other issues.
- `test/cli/cli.test.ts` initially imported a non-existent `ControlRequestShim` type; removed before finishing.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 06-03 consumed (`buildDaemonHandle` statically imported; production `mcp` needs caller-supplied `runtimeInput`). Ready for 06-05 (`bin` points at the compiled `dist/src/cli/main.js`, whose direct-invocation guard calls `main()`) and 06-06 e2e (CLI-over-fake-daemon through the injected `send`/`spawn` seams).
- Verification pending: `npx tsc -p tsconfig.json && node --test dist/test/cli/cli.test.js` plus the `CLI-01`/`CLI-02` title grep — deliberately not run here per wave constraints; the orchestrator gates on it. Coverage entries are therefore `unknown`, which routes them to human/orchestrator verification rather than auto-pass.

---
*Phase: 06-cli-daemon-and-host-packaging*
*Completed: 2026-10-22*
