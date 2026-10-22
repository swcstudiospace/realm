---
phase: 05-omp-plugin-mcp-and-acp-surfaces
verified: 2026-10-22T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
---

# Phase 5: Omp Plugin, MCP, and ACP Surfaces — Verification Report

**Phase Goal:** Omp sessions autostart the realm within a startup budget and show its state, and MCP and ACP expose the same tool logic through the shared dispatcher.
**Verified:** 2026-10-22
**Status:** human_needed (all 5 unit-verifiable success criteria pass in code and unit evidence; 7 live behaviors need a real Omp session or an external MCP/ACP client — see Human Verification Required)

## Goal Achievement

### Observable Truths

| # | Truth (Roadmap SC) | Status | Evidence |
|---|--------------------|--------|----------|
| 1 | SC1: session start launches the realm detached within `startupBudgetMs`; overrun settles disconnected with `STARTUP_BUDGET_EXCEEDED` and the session continues | ✓ VERIFIED (unit) | `src/omp/plugin.ts` (`startRealmSession`: handler returns without awaiting, budget timer from `policy.startupBudgetMs`, expiry renders disconnected display with `STARTUP_BUDGET_EXCEEDED`, `settleRealmSession` clears timer); `test/omp/plugin.test.ts` — 3 `OMP-01` cases (detached launch, in-budget active, overrun settle) |
| 2 | SC2: status indicator shows exactly one `displayStatus` label at launch and every transition with a non-colour cue, plus reason and last-transition time beside it | ✓ VERIFIED (unit, with recorded P5-D5 deviation) | `src/omp/plugin.ts` (`renderRealmStatus`: `displayStatus` only label source, `●`/`○` marker + `[degraded]` text flag, `REALM_STATUS_KEY` + `REALM_DETAIL_KEY` pair, last-painted skip); `test/omp/plugin.test.ts` — `OMP-02` one-label and `OMP-03` reason-plus-time cases. See Known Limitation (a): detail is a second status item, not a tooltip |
| 3 | SC3: retry command moves disconnected or error to connecting, then to active or error | ✓ VERIFIED (unit) | `src/omp/plugin.ts` (`retryRealm`: `dispatcher.call({ retry: {} })` only, then re-render; `REALM_RETRY_COMMAND` via `pi.registerCommand`); `test/omp/plugin.test.ts` — 2 `OMP-04` cases (error→connecting→active through dispatcher, pre-start `realm not started`) |
| 4 | SC4: while disconnected, a file write is refused in required mode or proceeds with a visible warning in advisory mode; no silent unsandboxed mutation | ✓ VERIFIED (unit, with recorded OQ-P5-02 residual risk) | `src/omp/plugin.ts` (`guardHostToolCall`: only `write`/`edit` guarded, `mutationGate` mirror — refused→`{ block: true }`, warn→`ui.notify`); `test/omp/plugin.test.ts` — 3 `OMP-05` cases (required refuse, advisory warn-through, read/list/status/retry untouched); `test/realm/compose.test.ts` — `OMP-05` mode-gate case. See Known Limitation (c) |
| 5 | SC5: the same tool call returns equivalent results through MCP and ACP, and neither surface contains tool logic | ✓ VERIFIED (unit) | `src/mcp/server.ts` + `src/acp/agent.ts` (envelope parse → `ToolDispatcher.call` unchanged map, nothing else); `test/surfaces/equivalence.test.ts` — 2 `TOOL-05` cases (six tools outcome-equal on one `makeHarness` dispatcher, schema-invalid + required-mode refusals outcome-equal); `test/surfaces/no-logic.test.ts` — 5 `TOOL-05` guard cases (no D-99 symbol, no dispatcher-internal, `call`-only, single `spawn(` site, self-testing plant) |

### Required Artifacts

All present, substantive, wired: `src/realm/compose.ts` (factory + `RealmHandle` + single-owner precondition), `src/mcp/server.ts` (`2026-07-28` probe-plus-initialize, stdout purity), `src/acp/agent.ts` (v1 + `realm/tool` extension, batch rule), `src/omp/plugin.ts` (autostart, status, retry, guard + residual-risk comment), `package.json` (`omp.extensions: ["./dist/src/omp/extension.js"]`, matching `tsconfig` `rootDir: .` + `outDir: dist` and asserted byte-equal by the manifest test), extended `docs/integration/{mcp,acp,omp,anda,and-decision}.md`, `test/quality/suite-taxonomy.test.ts` (Phase 5 entries). New tests: `test/{realm/compose,mcp/server,acp/agent,omp/plugin,surfaces/equivalence,surfaces/no-logic,docs/phase5-notes}.test.ts`.

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `src/realm/compose.ts` | `src/lifecycle/controller.ts` | `createRealmHandle` → `new LifecycleController` with shared `LockTable` | WIRED (identity assertion in compose test) |
| `src/realm/compose.ts` | `src/tools/dispatch.ts` | same `locks` + controller instance into `new ToolDispatcher` | WIRED (identity + mode-gate cases) |
| `src/mcp/server.ts` | `src/tools/dispatch.ts` | `ToolDispatcher.call` only (unchanged `ToolCall` map) | WIRED (routing + `call`-only tests) |
| `src/acp/agent.ts` | `src/tools/dispatch.ts` | `realm/tool` params → `ToolDispatcher.call` unchanged | WIRED (routing + unknown-method-never-dispatches test) |
| `src/omp/plugin.ts` | `src/realm/compose.ts` | `createRealmHandle(options)`; no adapter constructed in plugin | WIRED (all plugin tests build through it) |
| `src/omp/plugin.ts` | `src/core/status.ts` | `displayStatus` as the only label source | WIRED (shared-label + status-equality tests on both surfaces) |
| `src/omp/plugin.ts` | `src/tools/dispatch.ts` | retry via `dispatcher.call({ retry: {} })` per P5-D14 | WIRED (retry test) |
| `package.json` | `dist/src/omp/extension.js` | `omp.extensions` entry | WIRED (manifest test asserts exact entry and built file exists) |
| `test/docs/phase5-notes.test.ts` | `docs/integration/{mcp,acp,omp}.md` | exact-string pins (`2026-07-28`, `protocolVersion: 1`, `realm/tool`, verified Omp names) | WIRED (8 doc tests) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| MCP `tools/call` reply | `ToolOutcome` payload | live `ToolDispatcher.call` against `makeHarness` fakes | Yes — dispatcher-equal asserted | ✓ FLOWING |
| ACP `realm/tool` reply | `ToolOutcome` payload | live `ToolDispatcher.call` against the same dispatcher | Yes — dispatcher-equal asserted | ✓ FLOWING |
| Status label/detail | `displayStatus(snapshot)` | controller snapshot / event bus | Yes — shared-label asserted on both surfaces | ✓ FLOWING |
| Retry result | dispatcher `retry` outcome | `ToolDispatcher.call({ retry: {} })` | Yes — state + reason string asserted | ✓ FLOWING |
| Doc-test pins | cited strings in notes | `docs/integration/*.md` sections | Yes — exact-match assertions | ✓ FLOWING |

Behavioral spot-checks: SKIPPED — the run rules forbid executing tests, typecheck, lint, or git commands; behavioral evidence is taken from the test sources read on disk (event-driven waits, timeout options, dispatcher-equality assertions), not from a run.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| TOOL-05 | 05-02, 05-03, 05-04, 05-06 | MCP server and ACP adapter call the same dispatcher, hold no tool logic, equivalent results | ✓ SATISFIED (unit) | MCP framing/handshake/routing/drive, ACP v1/batch/routing/drive, equivalence + no-logic guard, doc pins, taxonomy citation |
| OMP-01 | 05-01, 05-02, 05-05 | Detached autostart under `startupBudgetMs`; overrun settles disconnected, session continues | ✓ SATISFIED (unit) | compose handle + detached/overrun plugin tests, Q1/Q2 doc pins |
| OMP-02 | 05-02, 05-05 | Exactly one label, text + colour cue, readable without colour | ✓ SATISFIED (unit) | one-label test, Q3 doc pin |
| OMP-03 | 05-02, 05-05 | Reason + last-transition time beside the state | ✓ SATISFIED (unit, P5-D5 deviation) | second-status-item implementation + test; see Limitation (a) |
| OMP-04 | 05-02, 05-05 | Retry moves disconnected/error to connecting then active/error | ✓ SATISFIED (unit) | dispatcher-owned retry tests |
| OMP-05 | 05-01, 05-02, 05-05 | Disconnected write refused (required) / warned (advisory); never silent | ✓ SATISFIED (unit, residual risk) | guard tests + compose mode-gate; see Limitation (c) |

No orphaned requirements: all six Phase 5 IDs (`TOOL-05`, `OMP-01`–`OMP-05`) are claimed by plans and lead test titles; the taxonomy test enforces the citation.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No `TODO`/`FIXME`/`XXX`/`PLACEHOLDER`/stub markers found in the Phase 5 sources or tests read | — | None |
| `src/omp/plugin.ts` | header + guard | Upstream-only API (`setStatus` signature) and bypass-path residual risk are documented in-code, not hidden | ℹ️ Info | Callers on both sides (code reader, note reader) see the limit |
| `src/realm/compose.ts` | `bindRoot` call | Binds without the policy check `create` enforces — recorded as a finding, not a bypass (gate still refuses pre-mutation) | ⚠️ Finding | See Limitation (f) |

### Gates (reported by orchestrator; not re-run by verifier)

Per the run rules the verifier ran no gates. The orchestrator reports: typecheck PASS, lint PASS, full `node --test` suite PASS (904 pass, 0 fail, 9 live-gated skips).

### Known Limitations (a)–(f) (not hidden; each names its affected requirement)

- **(a) OMP-03 tooltip — no documented tooltip API; reason + time are a second status item (P5-D5 deviation).** Affects **OMP-03 / SC2**. No tooltip surface was verified on the official pages read, so `renderRealmStatus` writes `reason · lastTransitionAt` to `REALM_DETAIL_KEY` beside the `REALM_STATUS_KEY` label instead of a tooltip. The deviation is recorded in `src/omp/plugin.ts` and covered by the `OMP-03` beside-the-label test.
  Superseded 2026-10-22 by the gap closure: one status item, detail in its text, 2 s refresh.
- **(b) `ctx.ui.setStatus` is upstream-sourced only (OQ-P5-01).** Affects **OMP-02 / SC2**. The key-plus-text signature was found only in upstream `hooks.md`, not on the official pages read; `docs/integration/omp.md` Q3 marks the limit and the plugin uses only that call. A host whose `setStatus` differs needs a live check (Human Verification 3).
- **(c) Host write/edit interception is not documented as enforced: the `tool_call` guard is the only control (OQ-P5-02, residual risk).** Affects **OMP-05 / SC4**. Neither `setActiveTools` removal nor a `tool_call` block is documented to cover every host execution path (launch-time tool flags, SDK sessions, a host ignoring the hook). The residual risk is recorded both in `src/omp/plugin.ts` and in `docs/integration/omp.md` Q4 (`OPEN`). Unit proof covers the extension pipeline only.
- **(d) No live Omp session, MCP client, or ACP client has been driven.** Affects **all six requirements / SC1–SC5**. Every behavior is proven in-process with fakes (`fake-execution`, `fake-bridge`, `makeHarness`) and in-memory stdio streams; the Phase 5 CONTEXT boundary declares the phase "unit-verified, live-gated". All live acceptance is deferred to Human Verification 1–7.
- **(e) Deployment requirement: the workspace must be listed in `policy.workspaceRoots` or `create` refuses with `POLICY_DENIED` (D-22).** Affects **OMP-01 / SC1**. Enforcement lives in `LifecycleController.bindWorkspace` (`src/lifecycle/controller.ts:373-383`: every policy root canonicalized, workspace inside a policy root or `POLICY_DENIED`). An Omp deployment whose configured workspace is not under a policy root will settle disconnected at startup — expected, not a bug.
- **(f) `compose.ts` binds the workspace with `bindRoot`, without the policy check that `LifecycleController.create` enforces with `bindWorkspace`; flagged as a finding.** Affects **OMP-01 / SC1 (deployment posture)**. `createRealmHandle` canonicalizes `config.workspaceRoot` for the dispatcher up front but performs no `workspaceRoots` membership check; the membership check runs later inside `controller.create`. No unsandboxed mutation results — non-active tool calls are still refused by the mutation gate (OMP-05) — but operators should know the dispatcher's bound root is canonicalized, not policy-authorized, until `create` runs.

### Gaps

None. Every unit-verifiable item is met in code and unit evidence. The P5-D5 tooltip deviation and the OQ-P5-02 residual risk are settled, recorded decisions — not gaps — and Limitation (f) is a documented finding that the mutation gate still covers.

### Human Verification Required

All items need a live host: a real Omp session with the extension loaded (`package.json` `omp.extensions` entry installed), a reachable MCP client (e.g. the Anda MCP client), and an ACP client speaking generation v1. No fakes, no in-memory streams.

### 1. Live Omp autostart within budget (SC1, OMP-01)

**Test:** Open a real Omp session with the realm configured and a policy whose `startupBudgetMs` comfortably exceeds startup; observe the session start.
**Expected:** The session UI stays responsive during startup (handler returned without awaiting) and the indicator reaches `realm active` without any manual step.
**Why human:** No live Omp session exists on this host; the detached launch was proven only against `FakePi` timers.

### 2. Live startup overrun settle (SC1, OMP-01)

**Test:** In a real Omp session, point the realm at a startup that cannot finish inside a tiny `startupBudgetMs` (e.g. an unreachable bridge), then start the session.
**Expected:** The indicator settles to `realm disconnected` with reason `STARTUP_BUDGET_EXCEEDED` and the last-transition time beside it, and the Omp session continues normally (no hang, no exception surfaced).
**Why human:** Timer expiry against a real hung `create` cannot be observed without a live host.

### 3. Live status indicator rendering (SC2, OMP-02, OMP-03)

**Test:** In a real Omp session, watch the `realm` + `realm.detail` status items from launch through a full transition cycle (connecting → active → degraded/error), including on a colour-blind-safe or monochrome rendering.
**Expected:** Exactly one label (`realm active` / `realm disconnected`) is ever shown, the `●`/`○` + `[degraded]` cue is readable without colour, and the reason plus last-transition time stay beside it on every transition (Limitations (a), (b): confirm the host renders both keys and the upstream `setStatus` signature holds).
**Why human:** Real host status-line rendering is unverifiable from unit tests.

### 4. Live retry command (SC3, OMP-04)

**Test:** In a real Omp session, drive the realm to disconnected or error, then invoke the `realm-retry` command from the host command palette.
**Expected:** The realm moves to connecting and then to active (or error, with the refusal reason shown), and the indicator re-renders to match.
**Why human:** Host command registration and dispatch (`pi.registerCommand`) were exercised only against `FakePi`.

### 5. Live required-mode write refusal end to end (SC4, OMP-05)

**Test:** In a real Omp session in required mode with the realm disconnected, attempt a host `write` and a host `edit` through the normal model-tool path; repeat one attempt via each known bypass path (launch-time tool flags, SDK session if available).
**Expected:** In-pipeline attempts are blocked with the gate reason and nothing lands outside the realm; advisory mode warns visibly and lets the call through. Record which bypass paths (if any) the `tool_call` guard does not cover (Limitation (c)).
**Why human:** Enforcement outside the extension pipeline is undocumented and can only be settled by probing the real host.

### 6. Live MCP client drive (SC5, TOOL-05)

**Test:** Point a real MCP client (e.g. Anda's MCP client over stdio with revision `2026-07-28` semantics) at the built server and issue `server/discover` (or `initialize`) plus one call per tool.
**Expected:** Handshake succeeds per `docs/integration/mcp.md` Q5 and every tool result matches the dispatcher's outcome; stdout carries only MCP messages.
**Why human:** No MCP client exists on this host; all drives used in-memory streams.

### 7. Live ACP client drive (SC5, TOOL-05)

**Test:** Point a real ACP generation-v1 client at the built adapter and run initialize → session → `realm/tool` calls for all six tools plus one refusal case.
**Expected:** `protocolVersion: 1` negotiation, unbatched lifecycle replies, and outcome-equal results with the MCP half; refusals carry the same catalogue codes.
**Why human:** No ACP client exists on this host; all drives used in-memory streams.

---

_Verified: 2026-10-22_
_Verifier: Claude (gsd-verifier)_
