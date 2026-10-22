# Phase 6: CLI, Daemon, and Host Packaging - Context

**Gathered:** 2026-10-22
**Status:** Ready for planning
**Mode:** Brief-driven (decisions D1 to D9 settled in the phase brief; not reopened here). Open questions are `OQ-P6-xx`.

<domain>
## Phase Boundary

Phase 6 puts a standalone CLI and a long-running local daemon in front of the Phase 5 composition root:

1. **Control channel (new, RT-06).** Newline-delimited JSON over a user-only Unix socket at `controlSocketPath(stateDir)` (`src/session/paths.ts`: `<stateDir>/run/control.sock`). The run directory is created 0700 and the socket chmod 0600. The daemon refuses to start when the directory has other permissions or a foreign owner. Neither the control socket nor any Podman or Docker socket is mounted into the container. Request ids correlate replies; error codes come from `src/core/errors.ts` only. Methods: `status`, `up`, `down`, `doctor`. Every socket operation has a timeout.
2. **Daemon process (new, CLI-01).** `realm up` spawns a detached long-running daemon when none is running, then talks to it over the socket. `realm down` asks the daemon to tear down and then exits it. `realm status` and `realm doctor` query the daemon, or run locally when the daemon is absent and say so. The daemon calls the existing `reapStartup` on start with its bounded sweep (the wiring deferred from Phase 4).
3. **CLI (new, CLI-01, CLI-02).** Argument parsing with exit codes from one module using only `node:net`, `node:fs`, `node:child_process` (argv form, no shell). `realm up` with Podman missing reports disconnected with `PODMAN_MISSING` through the existing probe (`src/runtime/podman-probe.ts`) and exits promptly with a bounded wait. `realm mcp` (stdio) serves the Phase 5 MCP server from the composition root.
4. **Doctor extension (CLI-03).** `src/doctor/checks.ts` gains `control-channel` (and the missing `agentos`) items; each failing check carries its fix text. The `bin` field in `package.json` points at the compiled CLI under `dist/src/cli/`. No new npm dependency.
5. **Host snippets (new, CLI-04).** Config snippets under `docs/hosts/snippets/` for Omp, Muse Code, Claude Code, Grok Build, and Hermes Agent, each matching its host note in `docs/integration/hosts.md`. `hosts.md` is updated first with the Muse Code official URLs and read date; Claude Code, Grok Build, and Hermes Agent snippets are written only from the official pages cited in `hosts.md`, and where a page does not document the format the snippet says so and gives only the documented fields.
6. **End-to-end proof (RT-06, CLI-01, CLI-02, CLI-03).** Up, status, down, the `PODMAN_MISSING` path, socket permissions, and the no-container-mounts invariant, all with fakes. No live Podman, OpenShell, or daemon is started in tests.

Out of this phase (see `<deferred>`): any new error code (the catalogue stays at 22 codes); any new policy key; Windows support; loopback-port transport (RT-06 allows it, D3 chooses the socket).

**Verification boundary.** No live container, OpenShell gateway, or Omp host exists on this host. Every behavior is tested with the existing fakes in `test/support/` and in-memory socket pairs. A phase verification can only report "unit-verified, live-gated". It must not report live verification.

</domain>

<spec_lock>
## Requirements Lock (source: `.planning/REQUIREMENTS.md` and `.planning/ROADMAP.md` Phase 6)

Phase requirements: **RT-06, CLI-01, CLI-02, CLI-03, CLI-04** (5 IDs). Their text lives in `.planning/REQUIREMENTS.md` and is not restated here. No phase-level `*-SPEC.md` exists, so `spec_loaded = false`.

Success criteria are taken from `.planning/ROADMAP.md` Phase 6 (SC1 to SC5).

</spec_lock>

<decisions>
## Implementation Decisions

The phase brief settles nine decisions, recorded here as **P6-D1 to P6-D9** (brief labels D1–D9; the `P6-` prefix avoids colliding with earlier `D-NN` numbers). They are NON-NEGOTIABLE for planning. New Phase 6 decisions continue as P6-D10 onward.

### Settled inputs (from the phase brief; not reopened)

- **P6-D1 (brief D1): Daemon lifecycle.** `realm up` spawns a detached long-running daemon process when none is running, then talks to it over the control socket. `realm down` asks the daemon to tear down and then exits it. `realm status` and `realm doctor` query the daemon, or run locally when the daemon is absent and say so.
- **P6-D2 (brief D2): Control protocol.** Newline-delimited JSON over the Unix socket, with request ids and typed error codes from `src/core/errors.ts` only. Methods: `status`, `up`, `down`, `doctor`. Every socket operation has a timeout.
- **P6-D3 (brief D3): Socket permissions.** Directory created 0700 and the socket chmod 0600 under the realm state directory (`controlSocketPath` in `src/session/paths.ts` already defines the path under `run/`). Refuse to start when the directory has other permissions or a foreign owner.
- **P6-D4 (brief D4): Startup reaper wiring (deferred from Phase 4).** The daemon calls the existing `reapStartup` on start, with its bounded sweep. This is the wiring Phase 4 left to Phase 6.
- **P6-D5 (brief D5): CLI-02 path.** `realm up` with Podman missing reports disconnected with `PODMAN_MISSING` through the existing probe (`src/runtime/podman-probe.ts`) and exits promptly, with a bounded wait.
- **P6-D6 (brief D6): Doctor.** Reuse `src/doctor/checks.ts`; add the control channel check; each failing check carries its fix text.
- **P6-D7 (brief D7): Bin.** Add a `bin` entry in `package.json` that points at the compiled CLI under `dist/src/cli/`. No new npm dependency. Use only `node:net`, `node:fs`, `node:child_process` (argv form, no shell).
- **P6-D8 (brief D8): Host snippets.** `docs/hosts/snippets/<host>.md` (or `.json`/`.toml`/`.yaml` as the host documents). Muse Code: official docs are at `https://dev.meta.ai/docs/muse-code/` (extending and configuration pages; `settings.json` with `schema_version` 1 and `mcp_servers`; stdio and streamable_http transports) and `docs/integration/hosts.md` must be updated with those URLs and read date before the Muse Code snippet is written. Claude Code, Grok Build, and Hermes Agent: read their official pages cited in `docs/integration/hosts.md` for the MCP configuration format before writing their snippets; where the page does not document the format, the snippet says so and gives only the documented fields.
- **P6-D9 (brief D9): MCP entry.** The snippets point at the realm MCP server entry (stdio). The MCP server entry is created by a small command in the CLI (`realm mcp`, stdio) that serves the Phase 5 MCP server from the composition root. Add it to the CLI plan.

### New Phase 6 decisions (planner; within the settled frame)

- **P6-D10: Channel module layout.** `src/daemon/channel.ts` owns the wire format and the filesystem guards: `CONTROL_METHODS` (`status`, `up`, `down`, `doctor`), request/reply encode/decode, `ensureSocketDir` (create-or-check 0700 plus owner check, refuse otherwise), `SOCKET_MODE = 0o600` applied after listen, and `SOCKET_TIMEOUT_MS` bounding every socket operation via the existing `withTimeout` (`src/core/timeout.ts`). No daemon logic lives here (plan 06-01). **Reversibility:** reversible (paths and constants only).
- **P6-D11: Refusal code for a bad socket directory.** A run directory with wrong permissions or a foreign owner refuses with the existing catalogue code `SCHEMA_INVALID`; no code is added (the catalogue stays at 22). The refusal names the expected mode and the observed state, never a secret. **Reversibility:** reversible (code choice only).
- **P6-D12: Daemon handle reuse for `realm mcp`.** `src/daemon/daemon.ts` exports `buildDaemonHandle` (composition root wiring with the production adapters) beside `startDaemon`. The CLI `mcp` command builds its handle through `buildDaemonHandle` and serves it with the Phase 5 `createMcpServer` over stdio; it invents no second wiring (P5-D11 carries forward). **Reversibility:** reversible.
- **P6-D13: CLI exit codes.** `0` success; `1` the daemon (or local path) reported a catalogue-coded failure such as disconnected-with-`PODMAN_MISSING`; `2` usage error. The human-readable reason goes to stderr; the code on stdout is the machine-readable `ErrorCode`. **Reversibility:** costly (scripts hard-code them).
- **P6-D14: AgentOS doctor item.** CLI-03 names AgentOS but no doctor item inspects it. Plan 06-05 adds an `agentos` item beside `control-channel`: with no live session there is nothing to probe, so it reports `warn` with the fix `Run realm up, then rerun doctor.` An injected `agentosAlive` probe lets tests exercise pass and fail. This is recorded as a deliberate addition, not a reinterpretation of CLI-03. **Reversibility:** reversible.
- **P6-D15: No-mounts proof method.** The invariant "neither the control socket nor any Podman or Docker socket is mounted into the container" is proven statically: the e2e test asserts the container-create argv (`buildCreateArgv` in `src/runtime/openshell.ts`) and the policy document (`buildPolicyDocument`) never carry the control socket path or any `.sock` path. No container starts in tests. **Reversibility:** reversible (test method only).

### Test suite taxonomy (QUAL-02; extends the Phase 5 taxonomy)

- New suites, each citing its requirement ID in test titles:
  - `test/daemon/channel.test.ts` (RT-06): NDJSON framing with request ids; catalogue-code-only errors; every socket operation bounded; 0700/0600 enforcement; refusal on wrong mode or foreign owner; no Podman or Docker socket path crosses the module.
  - `test/docs/host-snippets.test.ts` (CLI-04): `hosts.md` records the Muse Code URLs and read date; each of the five snippets exists and matches its host note (exact `settings.json`/`schema_version`/`mcp_servers` shape for Muse Code; "not documented" markers where the official page is silent for the others).
  - `test/daemon/daemon.test.ts` (CLI-01, RT-06): single-owner start; `reapStartup` runs before serving with the bounded sweep; graceful shutdown on `down` (drains, stops controller, removes socket, exits); `status`/`up`/`down`/`doctor` dispatch over an in-memory socket pair.
  - `test/cli/cli.test.ts` (CLI-01, CLI-02): argv parsing per command; exit codes 0/1/2; `up` with Podman missing reports disconnected with `PODMAN_MISSING` and returns within the bound (no hang); `mcp` serves the Phase 5 server over piped stdio against a fake-backed handle.
  - `test/doctor/control-channel.test.ts` (CLI-03): `control-channel` and `agentos` items with pass/warn/fail plus fix text on every non-pass; full eight-item report order preserved.
  - `test/daemon/e2e.test.ts` (RT-06, CLI-01, CLI-02, CLI-03): up then status-active then down-to-disconnected through CLI-over-fake-daemon; `PODMAN_MISSING` path; socket permission assertions; `buildCreateArgv`/`buildPolicyDocument` carry no `.sock` path.
- `test/support/` gains no new fake: the first choice is the existing `fake-tools.ts`, `fake-execution.ts`, `fake-bridge.ts`, `fake-libpod.ts` helpers.

### Claude's Discretion

- Helper names and internal splits inside `src/daemon/channel.ts` and `src/daemon/daemon.ts`.
- The exact CLI argv spelling beyond the five command names (`up`, `down`, `status`, `doctor`, `mcp`).
- The exact NDJSON field names, provided requests carry an id and replies carry the id plus either a result or a catalogue code.
- The exact fix strings, provided each names the corrective action.
- The exact snippet file extensions, provided each matches what its host documents.

### Open questions (recorded; each has a default that the plan applies)

- **OQ-P6-01:** the numeric `SOCKET_TIMEOUT_MS` value. Default: 5000, matching `DEFAULT_PROBE_TIMEOUT_MS` in `src/doctor/checks.ts`.
- **OQ-P6-02:** whether `realm status`/`doctor` with no daemon should run fully locally or report "daemon absent" plus a local subset. Default per P6-D1: query the daemon; when absent, say so and run the local subset (doctor checks that need no daemon; status reports disconnected with reason `daemon absent` — local text, not a catalogue code).
- **OQ-P6-03:** stale-socket cleanup when a previous daemon died without removing the socket. Default: connect attempt first; on refusal, remove the stale socket and proceed (single-owner start still enforced by the directory guards).
- **OQ-P6-04:** the exact Muse Code MCP field layout beyond `schema_version`/`mcp_servers`/transports. Default: whatever the official extending/configuration pages document; anything unconfirmed is marked not-documented, never invented.

### Requirement coverage map (for the planner)

| ID | Decisions | Primary test files |
|---|---|---|
| RT-06 | P6-D2, P6-D3, P6-D10, P6-D11, P6-D15 | `test/daemon/channel.test.ts`, `test/daemon/e2e.test.ts` |
| CLI-01 | P6-D1, P6-D4, P6-D12, P6-D13 | `test/daemon/daemon.test.ts`, `test/cli/cli.test.ts`, `test/daemon/e2e.test.ts` |
| CLI-02 | P6-D5, P6-D13 | `test/cli/cli.test.ts`, `test/daemon/e2e.test.ts` |
| CLI-03 | P6-D6, P6-D14 | `test/doctor/control-channel.test.ts`, `test/daemon/e2e.test.ts` |
| CLI-04 | P6-D8, P6-D9 | `test/docs/host-snippets.test.ts` |

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product spec and planning state
- `docs/specs/realm-spec.xml` §HOST_INTEGRATIONS, §STATES, §GRACEFUL_DEGRADATION.
- `.planning/REQUIREMENTS.md`: RT-06, CLI-01 to CLI-04 text and the traceability table.
- `.planning/ROADMAP.md`: Phase 6 goal and success criteria SC1 to SC5.
- `.planning/PROJECT.md`: constraints (ESM, strict, no host paths, no telemetry, no unverified dependency, no secrets).

### Integration notes (gates; read before writing code)
- `docs/integration/hosts.md`: per-host official URLs, read date 2026-10-21, Q1–Q5 answers (Muse Code currently not documented; plan 06-02 updates it per P6-D8).
- `docs/integration/mcp.md`, `acp.md`, `omp.md`, `anda.md`: Phase 5 records the surfaces the daemon and CLI reuse.

### Prior phases (frozen; read before touching related code)
- `.planning/phases/05-omp-plugin-mcp-and-acp-surfaces/05-CONTEXT.md`: P5-D7 (composition root), P5-D11 (surfaces hold no tool logic; only `ToolDispatcher.call`), P5-D15 (one shared LockTable).
- `.planning/phases/04-reaper-egress-guard-and-shared-dispatcher/04-CONTEXT.md`: D-84/D-86 (reap order and null-container sweep), D-87 (single-owner precondition, cross-process check deferred to Phase 6).
- `.planning/phases/03-container-runtime-and-bridges/03-CONTEXT.md`: D-52 (RuntimeConfig keys), D-53 (probe failure codes and timeouts), D-69 (doctor items).
- `.planning/phases/02-policy-state-and-filesystem-lockdown/02-CONTEXT.md`: D-44 (doctor shape: id, status, detail, fix null-only-on-pass).

### Frozen code (extend beside it; never edit frozen tables)
- `src/session/paths.ts`: `resolveStateDir`, `sessionsDirOf`, `controlSocketPath`, `recordFileName`.
- `src/runtime/podman-probe.ts`: `probePodman`, `PodmanProbeOptions`, `RunCommand`, `ConnectSocket`, `PODMAN_MISSING` path.
- `src/doctor/checks.ts`: `runChecks`, `DoctorOptions`, `CheckResult`, `REGISTERED` (7 items; Phase 6 appends deliberately), `DEFAULT_PROBE_TIMEOUT_MS`.
- `src/realm/compose.ts`: `createRealmHandle`, `CreateRealmHandleOptions`, `RealmHandle` (controller, dispatcher, `close()`).
- `src/session/reap.ts`: `reapStartup`, `ReapDeps`, `REAP_SWEEP_TIMEOUT_MS`.
- `src/runtime/sweep.ts`: `removeAllRealmContainers`, `SWEEP_CALL_TIMEOUT_MS`.
- `src/mcp/server.ts`: `createMcpServer`, `McpDispatcher`, `MCP_PROTOCOL_VERSION`.
- `src/runtime/session-execution.ts`: `SessionExecution`, `spawnOpenShellRunner`.
- `src/anda/client.ts`: `AndaBridge`.
- `src/runtime/agentos.ts`: `AgentOsSupervisor`, `AgentOsDriver`.
- `src/runtime/openshell.ts`: `buildCreateArgv`, `buildPolicyDocument`, `OpenShellRunner`.
- `src/core/errors.ts` (22 codes, `ERROR_CATALOGUE`, `makeRealmError`). No code is added.
- `src/core/timeout.ts`: `withTimeout`.
- `src/core/status.ts`: `displayStatus`, `STATUS_LABELS` (the only label mapping).
- Test helpers: `test/support/fake-tools.ts`, `fake-execution.ts`, `fake-bridge.ts`, `fake-libpod.ts`; static-guard method: `test/tools/no-bypass.test.ts`.
- `package.json`: scripts (`typecheck`, `lint`, `test`, `build`), `engines node >=22`, `omp.extensions`. No `bin` field yet; no new dependency is added.

No external specs or ADRs beyond the above are referenced.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `controlSocketPath(stateDir)`: the socket path; the channel module never computes it any other way (P6-D3).
- `probePodman({runCommand, connectSocket, env, timeoutMs})`: the exact probe the CLI `up` path reuses for CLI-02 (P6-D5); argv run with no shell, socket dial bounded.
- `runChecks(options)`: the doctor runner the daemon `doctor` method and the local CLI path both call (P6-D6); every seam already injectable.
- `createRealmHandle(options)`: the single wiring the daemon and `realm mcp` share (P6-D12); tests use the existing fakes at the adapter seam.
- `reapStartup({store, sweep})` with `REAP_SWEEP_TIMEOUT_MS`: the deferred wiring the daemon performs before serving (P6-D4).
- `createMcpServer(dispatcher, input, output, diagnostics)`: the stdio server `realm mcp` serves (P6-D9).
- `withTimeout(work, ms, code)`: the bound for every socket operation (P6-D2).
- `buildCreateArgv` / `buildPolicyDocument`: the argv the no-mounts proof inspects (P6-D15).

### Established Patterns
- Injected I/O everywhere. No new module reads `process.env` (D-46 carries forward); env arrives as `EnvironmentLike`.
- A typed error by `makeRealmError(code)`. No raw message crosses a boundary.
- Each file opens with a header comment naming its decisions in the `src/core/events.ts` style.
- One owner per file per wave. `src/core/*`, `src/session/paths.ts`, `src/contract/*` are consumed, never reshaped.

### Integration Points
- `src/daemon/channel.ts` (new, plan 06-01): wire format plus socket-dir guards; no daemon logic.
- `src/daemon/daemon.ts` (new, plan 06-03): `startDaemon` plus `buildDaemonHandle`; owns the single-owner start, the reaper call, and graceful shutdown.
- `src/cli/main.ts` (new, plan 06-04): argv parsing, exit codes, daemon spawn (argv form, detached), socket client, and the `mcp` stdio command.
- `src/doctor/checks.ts` (extended, plan 06-05): `control-channel` and `agentos` items; `package.json` gains `bin` in the same plan.
- `docs/hosts/snippets/` (new, plan 06-02): five host snippets; `docs/integration/hosts.md` updated first.

</code_context>

<specifics>
## Specific Ideas

- The channel test should drive requests over a real Unix socket pair (or `node:net` in-memory server) with injected fs stat mocks for the permission cases, and assert every reply carries the request id.
- The doc-snippet test should assert exact cited strings (`schema_version`, `mcp_servers`, the Muse Code URLs, the read date), not just file presence. A test that only checks presence cannot catch an invented field.
- The daemon test should prove `reapStartup` ran before the first served request, using a recording sweep fake.
- The CLI `PODMAN_MISSING` test must assert a wall-clock bound (prompt exit, no hang) with a short injected timeout.
- The e2e no-mounts test should grep the create argv and policy document for `.sock` and for the control socket path, not just assert a flag.

</specifics>

<deferred>
## Deferred Ideas

- A loopback-port transport alternative (RT-06 permits it; P6-D3 chooses the socket only).
- Live Podman/OpenShell/daemon acceptance: gated; reported as live-gated, never claimed.
- Windows support: out of scope.
- Teardown-timeout catalogue code: unchanged (`REALM_STOPPING`).
- Wildcard egress hosts, per-tool timeout keys: still later decisions; unchanged by this phase.
- Doctor items for the MCP/ACP surfaces: none planned.
- `realm logs` or log-tailing commands: not in CLI-01; not planned.

**Reviewed Todos (not folded):** none.

</deferred>

---

*Phase: 06-cli-daemon-and-host-packaging*
*Context gathered: 2026-10-22*
