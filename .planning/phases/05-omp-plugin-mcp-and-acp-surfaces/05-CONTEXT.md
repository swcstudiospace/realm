# Phase 5: Omp Plugin, MCP, and ACP Surfaces - Context

**Gathered:** 2026-10-22
**Status:** Ready for planning
**Mode:** Brief-driven (decisions P5-D1 to P5-D8 settled in the phase brief; not reopened here). Open questions are `OQ-P5-xx`.

<domain>
## Phase Boundary

Phase 5 exposes the Phase 4 `ToolDispatcher` through three host surfaces that hold no tool logic:

1. **Composition root (new).** One module builds `LifecycleController` and `ToolDispatcher` from `RuntimeConfig` and the real runtime adapters, exposing a `RealmHandle` with the controller, the dispatcher, and `close()`. Tests use the existing fakes in `test/support/`. No real Podman or OpenShell is started in tests.
2. **Documentation decisions (new Q&A).** `mcp.md` Q5 (protocol revision handling), `acp.md` version plus extension method, `omp.md` Q1–Q4 exact API answers verified against the official pages, `anda.md`/`anda-decision.md` MCP-consumption path.
3. **MCP stdio server (TOOL-05).** Newline-delimited JSON-RPC 2.0 over stdio, no new npm dependency, calling the same dispatcher. Must work with a stdio MCP client (Anda consumes Realm over MCP).
4. **ACP stdio adapter (TOOL-05).** stdio transport, protocol generation v1, no new npm dependency. Realm's six tools ride a documented Realm extension method (for example `realm/tool`), recorded in `acp.md` as a Realm extension, not standard ACP.
5. **Omp extension (OMP-01 to OMP-05).** Lives in this single root package: `package.json` gains an `omp` field pointing at compiled entry files under `dist`. Autostart is detached within `startupBudgetMs`; overrun settles disconnected with `STARTUP_BUDGET_EXCEEDED` and the session continues. Status shows exactly one CORE-02 label. The `retry` command and the `tool_call` guard enforce the policy mode.
6. **Contract equivalence proof (TOOL-05).** The same call through MCP and through ACP returns equivalent results against one dispatcher, and a static guard proves the surfaces contain no tool logic, in the style of the D-99 guards in `test/tools/no-bypass.test.ts`.

Out of this phase (see `<deferred>`): the daemon and control channel (RT-06, Phase 6); the CLI (Phase 6); live Podman/OpenShell proofs (gated, host runs Podman 4.9.3); any new error code (the catalogue stays at 22 codes); any new policy key (the schema stays frozen).

**Verification boundary.** No live container, OpenShell gateway, Omp host, MCP client, or ACP client exists on this host. Every behavior is tested in-process with the existing fakes (`fake-tools.ts`, `fake-execution.ts`, `fake-bridge.ts`) and in-memory stdio streams. A phase verification can only report "unit-verified, live-gated". It must not report live verification.

</domain>

<spec_lock>
## Requirements Lock (source: `.planning/REQUIREMENTS.md` and `.planning/ROADMAP.md` Phase 5)

Phase requirements: **TOOL-05, OMP-01, OMP-02, OMP-03, OMP-04, OMP-05** (6 IDs). Their text lives in `.planning/REQUIREMENTS.md` and is not restated here. No phase-level `*-SPEC.md` exists, so `spec_loaded = false`. Where a requirement's literal wording conflicts with a settled decision, the settled decision governs and the conflict is recorded below (P5-D5 for OMP-03, P5-D6 for OMP-05). The requirement text is not edited in this phase.

Success criteria are taken from `.planning/ROADMAP.md` Phase 5 (SC1 to SC5).

</spec_lock>

<decisions>
## Implementation Decisions

The phase brief settles eight decisions, recorded here as **P5-D1 to P5-D8** (brief labels D1–D8; the `P5-` prefix avoids colliding with Phase 1–4 `D-NN` numbers). They are NON-NEGOTIABLE for planning. New Phase 5 decisions continue as P5-D9 onward.

### Settled inputs (from the phase brief; not reopened)

- **P5-D1 (brief D1): Anda consumes Realm over MCP.** The MCP server must work with a stdio MCP client. Source: `docs/integration/anda.md` Q5 records that the Anda MCP client speaks stdio with MCP revision 2026-07-28 and older `initialize`-based revisions. The server therefore answers both the modern probe and the `initialize` handshake (detail in P5-D9).
- **P5-D2 (brief D2): MCP is stdio JSON-RPC 2.0 with no new npm dependency.** Transport facts come from `docs/integration/mcp.md` Q2 (newline-delimited JSON-RPC over stdin/stdout, no embedded newlines, nothing but MCP messages on stdout, stderr for logs, shutdown by closing stdin). The protocol revision handling is chosen from `mcp.md` Q1–Q5 and recorded in `mcp.md` Q5 (P5-D9). No revision string may be used that the notes do not cite: the only spec-verified revision string is `2026-07-28`; `2024-11-05` appears only as upstream Omp documentation, not verified against the MCP pages.
- **P5-D3 (brief D3): ACP is stdio, protocol generation v1, no new npm dependency.** Generation facts come from `docs/integration/acp.md` Q1 (v1 `protocolVersion: 1` with `clientInfo`/`agentInfo`; agent selects the highest version it supports at or below the requested one) and Q2 (stdio defined; Streamable HTTP is draft-only; batching lifecycle-sensitive messages is discouraged). The standard ACP defines no client-invoked tool method, so Realm exposes its six tools through a documented Realm extension method (for example `realm/tool`), recorded in `acp.md` as a Realm extension, not standard ACP.
- **P5-D4 (brief D4): The Omp plugin lives in this single root package.** `package.json` gains an `omp` field pointing at compiled entry files under `dist` (`mcp.md`… no: `omp.md` Q1). Exact `ExtensionAPI` names (event registration, `ctx.ui.setStatus`, command registration, `tool_call` hook behaviour, startup timing) are verified by reading the official pages at `https://omp.sh/docs/extension-authoring` and the upstream docs cited in `docs/integration/omp.md` BEFORE coding (plan 05-02 reads, plan 05-05 codes). Nothing is invented: anything not documented becomes a recorded limitation. The `tool_call` block in required mode is an OPEN evidentiary item (P5-D6), not a decided control.
- **P5-D5 (brief D5): Status labels are the two CORE-02 labels.** `realm active` and `realm disconnected` come from the existing shared mapping in `src/core/status.ts` (`displayStatus`, `STATUS_LABELS`). Other states map through that mapping. The reason and the time of the last transition go in a second status item or command output, because no tooltip API is documented (`omp.md` Q3: the surface found is UI-level `ctx.ui.setStatus(key, text)`; no health or status endpoint for a plugin). This is recorded as a deviation from OMP-03's literal "tooltip" wording.
- **P5-D6 (brief D6): Host write/edit guard.** When the policy mode is required and realm is not active, the plugin refuses built-in `write` and `edit` through the documented `tool_call` handler. In advisory mode it warns. Whether a `tool_call` block satisfies the required rule is an OPEN item (`omp.md` Q4 carries this as deferred to Phase 5): the plan must include a test that proves the block and a recorded residual-risk statement for any path the block cannot cover.
- **P5-D7 (brief D7): Composition root.** One module builds `LifecycleController` and `ToolDispatcher` from `RuntimeConfig` and the real runtime adapters, exposing a `RealmHandle` with the controller, the dispatcher, and `close()`. Tests use the existing fakes in `test/support/`. No real Podman or OpenShell is started in tests.
- **P5-D8 (brief D8): Startup budget.** The plugin starts the realm on session start WITHOUT awaiting it on the UI path. A timer bounded by `startupBudgetMs` (policy key, default 10000) settles the state to disconnected with `STARTUP_BUDGET_EXCEEDED` on overrun. Only existing error codes from `src/core/errors.ts` are used; none is added.

### New Phase 5 decisions (planner; within the settled frame)

- **P5-D9: MCP revision handling (answers `mcp.md` Q5).** The server implements revision `2026-07-28` semantics: stateless per-request handling; answers the `server/discover` probe for modern clients; answers the `initialize` handshake for `initialize`-based clients (both behaviours are cited in `mcp.md` Q1–Q2, "Backward Compatibility"). This is the Q5 record plan 05-02 writes. It covers P5-D1 because Anda's client speaks exactly these two revisions (`anda.md` Q5). No other revision string is used. **Reversibility:** costly (client interop depends on it).
- **P5-D10: ACP generation v1 with a `realm/tool` extension method.** The adapter speaks ACP v1 `initialize` (`protocolVersion: 1`, `clientInfo`/`agentInfo` per `acp.md` Q1) over stdio framing per `acp.md` Q2, and carries each `ToolCall` (the frozen `src/contract/tools.schema.json` map shape) inside one Realm extension method named `realm/tool`, recorded in `acp.md` as a Realm extension. Lifecycle-sensitive messages are never batched (Q2 batch rule). **Reversibility:** costly for the method name (clients hard-code it); reversible for the framing.
- **P5-D11: Surface layout.** `src/mcp/server.ts` exports the MCP stdio server; `src/acp/agent.ts` exports the ACP stdio agent; `src/omp/plugin.ts` (source) compiles to the `dist` entry the `omp` field names; `src/realm/compose.ts` exports `createRealmHandle` and the `RealmHandle` type. Each surface module imports the dispatcher type only; the only tool entry point they call is `ToolDispatcher.call` (D-88). **Reversibility:** reversible (paths only).
- **P5-D12: No-tool-logic static guard (extends D-99).** The guard asserts the D-99 symbols (`buildExecArgv`, `lockedWrite`, `readFileCapped`, `listDir`, `spawnOpenShellRunner`) plus the dispatcher-internal symbols named in plan 05-06 are referenced only from their allowlisted modules, and that no file under `src/mcp/`, `src/acp/`, or `src/omp/` references any of them. `spawn(` still appears only in `src/runtime/session-execution.ts`. Same grep-source method as `test/tools/no-bypass.test.ts`. **Reversibility:** reversible.
- **P5-D13: Equivalence means outcome-equal.** The same `ToolCall` through MCP and through ACP against one dispatcher must return `ToolOutcome` values that are deep-equal after transport-envelope stripping (TOOL-05 "equivalent results"). Transport envelopes (JSON-RPC ids, ACP message wrappers) are compared separately for shape only. **Reversibility:** reversible (test strictness only).
- **P5-D14: OMP-04 retry path reuses the dispatcher.** The Omp `retry` command calls `ToolDispatcher.call({ retry: {} })`, which follows the D-95 by-state table (error runs `create`, the rest return the snapshot or the refusal). The plugin adds no retry logic of its own. **Reversibility:** reversible.
- **P5-D15: One shared lock table through the handle.** `createRealmHandle` constructs one `LockTable` and passes it to both the controller (`LifecycleDeps.locks`) and the dispatcher (`ToolDispatcherDeps.locks`), preserving D-96. Tests assert both hold the same instance, mirroring the Phase 4 assertion. **Reversibility:** reversible.

### Requirement-text conflicts resolved by the settled decisions

- **OMP-03 literal vs P5-D5:** the requirement says "tooltip". No tooltip API is documented (`omp.md` Q3). The reason and last-transition time are shown in a second status item or command output. Unit-verified as "displayed alongside the label"; the literal tooltip property is reported as not available. The requirement text is not edited.
- **OMP-05 enforcement vs P5-D6:** `omp.md` Q4 records that no documented mechanism provably removes host `write`/`edit` in required mode. The `tool_call` block is the implemented mechanism; its test proves the block fires, and the residual-risk statement names what it cannot cover (a host path that bypasses the extension's `tool_call` pipeline entirely). Reported, not edited.

### Test suite taxonomy (QUAL-02; extends the Phase 4 taxonomy)

- New suites, each citing its requirement ID in test titles:
  - `test/realm/compose.test.ts` (OMP-01 wiring, OMP-05 gate path): handle builds controller plus dispatcher from `RuntimeConfig`; both hold the same `LockTable`; `close()` is idempotent; no real process starts.
  - `test/docs/phase5-notes.test.ts` (FOUND-03 carry): `mcp.md` Q5 records revision `2026-07-28` with probe-plus-`initialize` handling; `acp.md` records v1 plus the `realm/tool` extension; `omp.md` Q1–Q4 answers name only verified APIs; `anda.md`/`anda-decision.md` record the MCP-consumption path. Mirrors the decision-note test method.
  - `test/mcp/server.test.ts` (TOOL-05): stdio framing (no stdout pollution, stderr for logs); each of the six tools routes to `ToolDispatcher.call`; a stdio-client-shaped driver completes a call.
  - `test/acp/agent.test.ts` (TOOL-05): v1 `initialize` negotiation; `realm/tool` carries each `ToolCall`; lifecycle messages unbatched; refusals surface catalogue codes.
  - `test/omp/plugin.test.ts` (OMP-01 to OMP-05): detached autostart within `startupBudgetMs`; `STARTUP_BUDGET_EXCEEDED` settle with session continuation; exactly one label at launch and every transition; reason plus time in the second item; retry moves disconnected or error to connecting then active or error; required-mode `tool_call` block on `write`/`edit` with advisory warning.
  - `test/surfaces/equivalence.test.ts` (TOOL-05): same call through MCP and ACP against one dispatcher returns outcome-equal results for all six tools, including one refusal case.
  - `test/surfaces/no-logic.test.ts` (TOOL-05): the P5-D12 static guard.
- `test/support/` gains no new fake unless an existing helper cannot cover a case; the first choice is `makeHarness` from `test/support/fake-tools.ts` (it already builds a real dispatcher over fake stages).

### Claude's Discretion

- Helper names, internal splits within a surface module, and the exact stdio line-reader implementation.
- The exact `omp` field entry path under `dist` (must match the compiled output of `src/omp/plugin.ts`).
- The exact reason text for each refusal, provided the frozen catalogue reason is included for the code.
- The exact `realm/tool` envelope field layout, provided it carries the whole `ToolCall` map unchanged.
- Test helper layout under `test/support/`.
- Number of plans is fixed at six by the brief; wave grouping follows the brief.

### Open questions (recorded; each has a default that the plan applies)

- **OQ-P5-01 (blocks nothing in unit test):** the exact `ExtensionAPI` names on the installed Omp host (event registration, `ctx.ui.setStatus`, command registration, `tool_call` semantics, startup timing). Default until plan 05-02 reads the official pages: the names quoted in `omp.md` Q2–Q3. Plan 05-05 codes only against what 05-02 records; anything unconfirmed becomes a recorded limitation.
- **OQ-P5-02 (residual risk, OMP-05):** whether a `tool_call` block on `write`/`edit` holds required mode against every host execution path. Default: it holds inside the extension pipeline (proven by test); any path that bypasses the pipeline is named in the residual-risk statement.
- **OQ-P5-03 (residual risk, live-gated):** whether the Omp host, an MCP client, and an ACP client accept the exact bytes the surfaces emit. Default: shapes follow the cited notes; live acceptance is gated and reported as live-gated.
- **OQ-P5-04:** the `startupBudgetMs` value for the plugin timer (policy default 10000). Default: the policy value unchanged; not a new constant.
- **OQ-P5-05:** second status item vs command output for reason plus time (P5-D5). Default: whichever verified API 05-02 records; the test asserts the content, not the widget.

### Requirement coverage map (for the planner)

| ID | Decisions | Primary test files |
|---|---|---|
| TOOL-05 | P5-D1, P5-D2, P5-D3, P5-D9, P5-D10, P5-D11, P5-D12, P5-D13 | `test/mcp/server.test.ts`, `test/acp/agent.test.ts`, `test/surfaces/equivalence.test.ts`, `test/surfaces/no-logic.test.ts` |
| OMP-01 | P5-D4, P5-D7, P5-D8 | `test/realm/compose.test.ts`, `test/omp/plugin.test.ts` |
| OMP-02 | P5-D4, P5-D5 | `test/omp/plugin.test.ts` |
| OMP-03 | P5-D4, P5-D5 | `test/omp/plugin.test.ts` |
| OMP-04 | P5-D4, P5-D14 | `test/omp/plugin.test.ts` |
| OMP-05 | P5-D4, P5-D6 | `test/realm/compose.test.ts`, `test/omp/plugin.test.ts` |

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product spec and planning state
- `docs/specs/realm-spec.xml` §OMP_PLUGIN, §HOST_INTEGRATIONS, §STATES, §GRACEFUL_DEGRADATION.
- `.planning/REQUIREMENTS.md`: TOOL-05, OMP-01 to OMP-05 text and the traceability table.
- `.planning/ROADMAP.md`: Phase 5 goal and success criteria SC1 to SC5.
- `.planning/PROJECT.md`: constraints (ESM, strict, no host paths, no telemetry, no unverified dependency, no secrets).

### Integration notes (gates; read Q1–Q5/Q1–Q4 as listed)
- `docs/integration/mcp.md`: Q1 (revision `2026-07-28`; `initialize` handshake; `server/discover` probe), Q2 (stdio framing rules), Q4 (Omp host transports, informational), Q5 (undecided; Phase 5 records P5-D9).
- `docs/integration/acp.md`: Q1 (v1 vs v2; version negotiation), Q2 (stdio defined; batch rule), Q3–Q4 (remote discrepancy; auth and session methods, informational).
- `docs/integration/omp.md`: Q1 (manifest `omp.extensions` array; plugin tree; `mcp.json` declaration), Q2 (event registration; timing budgets; context timers), Q3 (UI-level status surface; no endpoint), Q4 (OPEN host write-tool removal; candidates and their documented limits).
- `docs/integration/anda.md` Q5 and `docs/integration/anda-decision.md`: the MCP-consumption path (P5-D1).
- External, to be read in plan 05-02 before any surface code: `https://omp.sh/docs/extension-authoring` and the upstream docs cited in `omp.md` (extensions, extension-loading, hooks, sdk, marketplace, mcp-config).

### Prior phases (frozen; read before touching related code)
- `.planning/phases/04-reaper-egress-guard-and-shared-dispatcher/04-CONTEXT.md`: D-88 (dispatcher deps), D-89 (pipeline order), D-91 (`toolQueueMs`), D-95 (retry table), D-96 (one lock table), D-99 (no-bypass guard and method).
- `.planning/phases/03-container-runtime-and-bridges/03-CONTEXT.md`: D-52 (RuntimeConfig keys), D-63 (mutation gate), D-64 (controller states).
- `.planning/phases/02-policy-state-and-filesystem-lockdown/02-CONTEXT.md`: D-23 (mode decision), D-24 (exec gate), D-27 (display mapping), D-28 (startup budget).

### Frozen code (extend beside it; never edit frozen tables)
- `src/tools/dispatch.ts`: `ToolDispatcher`, `ToolDispatcherDeps`, `DispatcherController`, `ToolOutcome`, `TOOL_CALL_TIMEOUT_MS`. The only tool entry point; surfaces call `call`, nothing else.
- `src/lifecycle/controller.ts`: `LifecycleController`, `LifecycleDeps`, `snapshot()`, `mutationGate()`, `create(workspaceRoot)`, `stop()`, public `events` bus. Not reshaped in Phase 5.
- `src/core/status.ts`: `STATUS_LABELS`, `displayStatus`, `StatusSnapshot`, `DisplayStatus`. The only label mapping.
- `src/core/policy.ts`: `decideMutation`, `checkExecPolicy`, `loadPolicyFile`. Mode logic is reused, not redefined.
- `src/core/errors.ts` (22 codes, `ERROR_CATALOGUE`). No code is added; `STARTUP_BUDGET_EXCEEDED` covers the budget overrun.
- `src/contract/validate.ts`: `Policy` (with `startupBudgetMs` default 10000, `toolQueueMs` default 2000), `ToolCall`, `ToolName`, `validate("tools", raw)`.
- `src/contract/tools.schema.json`: the six-tool map shape the extension method carries.
- `src/runtime/config.ts`: `RuntimeConfig`, `loadRuntimeConfig` (closed keys, absolute `workloadArgv[0]`).
- `src/runtime/session-execution.ts`: `SessionExecution` (the `ExecutionService`), `spawnOpenShellRunner`.
- `src/session/store.ts`: `SessionStore`; `src/session/paths.ts`: `resolveStateDir`, `sessionsDirOf`, `controlSocketPath`, `recordFileName`.
- Test helpers: `test/support/fake-tools.ts` (`makeHarness`, `ADVISORY`, `REQUIRED`), `fake-execution.ts`, `fake-bridge.ts`; static-guard method: `test/tools/no-bypass.test.ts`.

No external specs or ADRs beyond the above are referenced.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ToolDispatcher.call(raw)` with `ToolDispatcherDeps` (`sessionId`, `boundRoot`, `policy`, `controller`, `locks`, `stateDir`, `runOpenShell`): the single entry point every surface uses (D-88).
- `displayStatus(snapshot)`: the only label mapping; the plugin renders it, never its own labels (CORE-02).
- `decideMutation` / `gateMutation`: the mode decision the `tool_call` guard mirrors; the plugin adds no decision logic of its own.
- `LifecycleDeps` (`sessionId`, `policy`, `store`, `exec`, `bridge`, `clock`, optional `locks`): the controller's composition seam.
- `loadRuntimeConfig` / `loadPolicyFile` / `bindRoot` / `SessionStore` / `spawnOpenShellRunner`: the real adapters the handle wires.
- `makeHarness` (`test/support/fake-tools.ts`): a real dispatcher over fake stages with a recorded call order; first choice for surface tests.
- `test/tools/no-bypass.test.ts`: the grep-source static-guard method P5-D12 copies.

### Established Patterns
- Injected I/O everywhere. No new module reads `process.env` ( Phase 3 D-46 carries forward).
- A typed error by `makeRealmError(code)`. No raw message crosses a boundary.
- One owner per file per wave. `src/tools/dispatch.ts`, `src/lifecycle/controller.ts`, `src/core/*` are consumed, never reshaped.
- Each file opens with a header comment naming its decisions in the `src/core/events.ts` style.

### Integration Points
- `src/realm/compose.ts` (new, plan 05-01): `createRealmHandle` plus the `RealmHandle` type; owns the single `LockTable` (P5-D15).
- `src/mcp/server.ts` (new, plan 05-03): the MCP stdio server over one dispatcher (P5-D9, P5-D11).
- `src/acp/agent.ts` (new, plan 05-04): the ACP v1 stdio agent over one dispatcher with the `realm/tool` extension (P5-D10, P5-D11).
- `src/omp/plugin.ts` (new source, plan 05-05): the extension entry compiled to the `dist` path the `omp` field names (P5-D4, P5-D11); `package.json` gains the `omp` field in the same plan.
- `docs/integration/mcp.md`, `acp.md`, `omp.md`, `anda.md`, `anda-decision.md` (extended, plan 05-02): the recorded choices no surface codes without.

</code_context>

<specifics>
## Specific Ideas

- The compose test should assert the shared `LockTable` instance first: it is the D-96 invariant the whole phase leans on.
- The doc-decision test should assert exact cited strings (`2026-07-28`, `protocolVersion: 1`, `realm/tool`, the verified Omp names), not just section presence. A test that only checks presence cannot catch an invented revision string.
- The MCP test should drive the server over in-memory stdin/stdout streams with a stdio-client-shaped driver, and assert nothing but MCP messages reaches stdout.
- The equivalence test should run all six tools plus one refusal through both surfaces against ONE dispatcher from `makeHarness`, and compare outcome-equal payloads.
- The `tool_call` guard test should prove the block fires for `write` and `edit` in required mode while non-active, warns in advisory mode, and leaves non-mutating tools alone.
- The residual-risk statement for OQ-P5-02 lives in `src/omp/plugin.ts` as a doc comment AND in `omp.md`, so the code reader and the note reader both find it.

</specifics>

<deferred>
## Deferred Ideas

- The daemon, the control channel, and the single-daemon owner rule (RT-06, OQ-P4-06): Phase 6. The handle documents the single-owner precondition but enforces no cross-process lock.
- The CLI (`realm up/down/status/doctor`) and host config snippets (CLI-01 to CLI-04): Phase 6.
- Live Omp, MCP-client, and ACP-client acceptance (OQ-P5-03): gated; reported as live-gated, never claimed.
- Wildcard egress hosts, per-tool timeout keys, `allowed_ips`: still later decisions; unchanged by this phase.
- Egress through the OpenShell TypeScript SDK: not used; the argv path stays pinned.
- Doctor items for the new surfaces: none planned.
- Teardown-timeout catalogue code: unchanged (`REALM_STOPPING`).

**Reviewed Todos (not folded):** none.

</deferred>

---

*Phase: 05-omp-plugin-mcp-and-acp-surfaces*
*Context gathered: 2026-10-22*
