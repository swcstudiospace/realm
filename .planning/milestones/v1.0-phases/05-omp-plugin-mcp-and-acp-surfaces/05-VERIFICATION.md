---
phase: 05-omp-plugin-mcp-and-acp-surfaces
verified: 2026-10-22T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
reverified: 2026-11-17
reverify_open: 1
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

## Re-verification 2026-11-17

**Method.** Read-only re-read of the evidence recorded after this report (v2.0 and v3.0): `docs/integration/{omp,mcp,acp,openshell}.md`, `.planning/milestones/v2.0-MILESTONE-AUDIT.md`, `.planning/milestones/v2.0-REQUIREMENTS.md`, `.planning/REQUIREMENTS.md`, `.planning/phases/12-.../12-VERIFICATION.md`, `.planning/phases/16-.../16-VERIFICATION.md` and `16-CONTEXT.md`, `.planning/phases/22-.../22-VERIFICATION.md`, plus `src/realm/compose.ts`, `src/fs/root.ts` and `src/omp/plugin.ts` for the design points. No test, build or gate was run, and the raw live evidence files under `<home>/realm-evidence/` were not opened here: the counts below are the ones the cited reports record. The original report above is unchanged.

**Result.** 15 rows: 11 covered-by-later-evidence, 3 superseded, 1 still-open. The open row is the "session stays responsive during startup" clause of Human Verification 1, which is the owner-accepted limitation UI-01. Status therefore stays `human_needed` with `reverify_open: 1`.

### Human Verification items

| Item (quoted) | Current evidence (file, recorded result, date) | Verdict |
| --- | --- | --- |
| **1a.** "Live Omp autostart within budget (SC1, OMP-01)": "the indicator reaches `realm active` without any manual step" | `docs/integration/omp.md`, requirement table row OMP-LIVE-01 and "Live Omp checks (2026-10-28)" step 3: Omp 18.12.6 in a tmux pane, isolated profile, Podman 5.7.1, final build; the status item read `● realm active · container running` after attach (same observation covers OMP-01 and OMP-02). `.planning/phases/22-omp-plugin-on-boot/22-VERIFICATION.md` (2026-11-17) and `docs/integration/omp.md` "Boot observability": live rehearsal on Omp 18.22.0 (`test/integration/omp-boot-install.test.ts`, one test, pass): with no daemon and no `realm up`, a session in a project directory under the policy roots loads the installed shim, starts the daemon and the sandbox, and the status becomes `realm active`. `.planning/milestones/v2.0-REQUIREMENTS.md` OMP-01: "Complete (live 2026-10-28 ...)". | covered-by-later-evidence |
| **1b.** "The session UI stays responsive during startup (handler returned without awaiting)" | Still not demonstrated. `docs/integration/omp.md` "UI-01 detail": 2026-10-23, a `get_state` sent one second after launch was answered only after the attach failure (about 6 s), cause not isolated; 2026-10-28 (Omp 18.12.6, load average near 30), keystrokes echoed within 0.2 to 1.2 s through a 24 s cold attach, "a measurement and not a proof". `.planning/REQUIREMENTS.md` UI-01 and `.planning/milestones/v2.0-MILESTONE-AUDIT.md` carry it as an accepted limitation (owner decision 2026-10-23), "the requirement's status is the owner's to change". The Phase 22 rehearsal (2026-11-17) records no responsiveness measurement. | still-open: no run shows the Omp event loop is never blocked during attach, and the 6 s `get_state` delay of 2026-10-23 is unexplained. Needs a measurement on an unloaded host, or an owner ruling that closes UI-01. |
| **2.** "Live startup overrun settle (SC1, OMP-01)": settles to `realm disconnected` with `STARTUP_BUDGET_EXCEEDED`, "the Omp session continues normally" | Design changed. The plugin no longer reads `policy.startupBudgetMs`: its attach and first status read share a fixed 200 s constant (`BOOT_BOUNDS.startupBudgetMs`, `src/host/boot.ts`; `docs/integration/omp.md` "Attach at session start"), and the budget that settles a slow start is the daemon's. Live, daemon side: `docs/integration/openshell.md` production live scenario 9 ("Startup budget (daemon side)"), `startupBudgetMs` = 1: `realm up` exits 1 with `STARTUP_BUDGET_EXCEEDED`, `realm status` reports state `error`, label `realm disconnected`, reason `STARTUP_BUDGET_EXCEEDED`, exactly one daemon still runs; 31 of 31 on 2026-10-28 and 33 of 33 on 2026-10-30. Live, Omp side, same display path: 2026-10-23 refused attaches painted `○ realm disconnected · POLICY_DENIED` and `○ realm disconnected · PODMAN_MACHINE_DOWN`, stderr empty, no hang, and `realm-retry` was accepted (OMP-LIVE-02, `docs/integration/omp.md`). The same doc and `v2.0-REQUIREMENTS.md` OMP-01 state the residual: the plugin's own 200 s timer expiry is unit-verified only, not live. | superseded (budget enforcement moved to the daemon with a fixed plugin timer; decision recorded in `docs/integration/openshell.md` scenario 9 and `.planning/milestones/v2.0-REQUIREMENTS.md` OMP-01). The unit-only plugin timer is a disclosed residual, not a live pass. |
| **3.** "Live status indicator rendering (SC2, OMP-02, OMP-03)": one label; `●`/`○` + `[degraded]` cue "readable without colour"; reason plus last-transition time beside it; Limitations (a), (b) | `docs/integration/omp.md` "Live verification (2026-10-23, Omp 18.12.5)": `extension_ui_request` `setStatus` frames with `statusKey` `realm`, text `○ realm disconnected · POLICY_DENIED · <time>` and `○ realm disconnected · PODMAN_MACHINE_DOWN · <time>`, item first `connecting`. "Live Omp checks (2026-10-28)": `● realm active · container running`, then `○ realm disconnected · AGENTOS_CRASH_LOOP` 10.8 s after the runner kill, `connecting`, `● realm active`, `realm disconnected` with `REALM_NOT_ACTIVE` after `realm down`. `.planning/milestones/v2.0-MILESTONE-AUDIT.md` and `v2.0-REQUIREMENTS.md` OMP-02: "live 2026-10-28: one label at a time through connecting, active, error and disconnected; marker glyph and label read in a text pane; the colour cue was not captured". Reason and time sit in the one item's text (`docs/integration/omp.md` Entry and attach, status paragraph; the two-key design of this report is superseded, see Limitation (a)). Not observed live: the `[degraded]` suffix and a colour or monochrome terminal rendering. The marker and label were read as plain text, which is the without-colour reading; `[degraded]` travels the same text path [INFERENCE]. | covered-by-later-evidence (with the disclosed narrowing: `[degraded]` and the colour cue not captured live, accepted in the v2.0 OMP-02 closure) |
| **4.** "Live retry command (SC3, OMP-04)" | `docs/integration/omp.md` "Live Omp checks (2026-10-28)" steps 5 and 7 and row OMP-LIVE-03: `/realm-retry` from the error state went to `connecting` then `● realm active` in 4 s; after `realm down` from another shell, `connecting` then `● realm active` in the same Omp session in 24 s. 2026-10-23: `realm-retry` listed by `get_available_commands`, accepted (`success: true`), item repainted `connecting`. `v2.0-REQUIREMENTS.md` OMP-04: "Complete (live 2026-10-28 ...)". | covered-by-later-evidence |
| **5a.** "Live required-mode write refusal end to end (SC4, OMP-05)": in-pipeline attempts blocked with the gate reason, nothing lands outside the realm; advisory warns and lets the call through | Scripted-provider live runs, not an LLM (owner decision D2, `.planning/REQUIREMENTS.md` OMP-05 row: "Complete (2026-10-30, HARN-04, owner decision D2): scripted provider drove Omp 18.12.6's own write through the Realm plugin; not LLM-driven"). `docs/integration/omp.md` "Scripted-provider and abrupt-end observations": fail-closed write blocked with `REALM_NOT_ACTIVE`, no file; advisory notice `realm status unavailable (REALM_NOT_ACTIVE); ...` (its daemon-down assertion is marked historical, superseded by the owner's 2026-11-12 ruling). Current source: `.planning/phases/12-scripted-provider-harness-and-omp-enforcement-spike/12-VERIFICATION.md` (2026-11-14, `12-omp-guard.txt`, Omp 18.20.0): 8 tests, 7 pass, 0 fail, 1 skipped (the HARN-03 warm case, skipped without its opt-in); C1 and C1b (advisory), C2 (fail-closed refused, no file), C3 (active), C4 and C4b (native `edit`) and O2 all ok. `.planning/phases/16-omp-runs-in-the-sandbox/16-VERIFICATION.md`: OMPX-05 production live run, `16-ompx05-live.txt` `# tests 1`, `# pass 1`, `# fail 0` (a write lands in the sandbox and the host root, with admission and result audit lines). Enforcement mechanism observed on Omp 18.12.6 (`docs/integration/omp.md` S2a, S4): `setActiveTools` removal refused at execution with `Tool <name> not found`, a `tool_call` block fails closed. Note: `docs/integration/omp.md` Guard suite (HARN-02), text of 2026-10-31, still says C1, C1b, C4 and C4b are "not run on the current source"; the later Phase 12 verification (2026-11-14) records them passing, so that paragraph is stale. | covered-by-later-evidence |
| **5b.** "repeat one attempt via each known bypass path (launch-time tool flags, SDK session if available) ... Record which bypass paths (if any) the `tool_call` guard does not cover (Limitation (c))" | The record exists. `docs/integration/omp.md` "OQ-P5-01 and OQ-P5-02" (Omp 18.12.6, VERIFIED_BY_EXECUTION): covered by `tool_call`: every model-issued call, nested `write xd://<tool>` (S3), eval-bridge calls (S7), subagent session calls (S6); not covered: what `eval`'s own code writes (S7) and the user's own shell command (S8). Not executed, stated as unknown or INFERENCE: SDK session with `restrictToolNames`, a session without the extension (`--no-extensions`), the Python eval prelude, tools from other extensions or MCP servers. Decision that bounds the claim: `.planning/phases/12-.../12-CONTEXT.md` D3 (2026-10-29), `docs/integration/omp.md` "What the product can truthfully claim (D3)" (containment of model-issued tool calls, not of the host), `.planning/phases/16-.../16-CONTEXT.md` ("do not claim process containment") and `16-VERIFICATION.md` residual 5 ("Guard, not containment"). The fail-closed rule is now an allowlist plus a `tool_call` backstop, not the `write`/`edit` guard alone. | superseded (the product claim was narrowed to model-issued calls by D3; paths where the extension is not loaded are outside it). Disclosed residual: the SDK-session and launch-flag bypasses were never executed. |
| **6.** "Live MCP client drive (SC5, TOOL-05)": handshake per Q5, one call per tool, results match the dispatcher, stdout only MCP messages | Real hosts, 2026-10-29, connection checks, no model call (`.planning/milestones/v2.0-MILESTONE-AUDIT.md` section 1; `docs/integration/mcp.md` Q6): after the era and result fixes (release 0.2.1) Claude Code 2.1.308 `claude mcp list` Connected, Grok Build 1.0.46 `grok mcp doctor` handshake accepted and 6 tools discovered. Tool calls: `docs/integration/openshell.md` production live scenario 6 drives the built `realm mcp` over stdio (`initialize`, `notifications/initialized`, `tools/list` naming `exec`, `read`, `write`, `list`, `status`, `retry`, then calls); 31 of 31 (2026-10-28), 33 of 33 (2026-10-30), re-run on a796b34 on 2026-11-15 (37 of 37 over scenarios 5, 6, 10). A throwaway client drove `realm mcp` then `realm acp` on the production stack on 2026-10-29: 67 checks, 0 failed, ACP result equals MCP result for exec, write, read, list, status and five refusals (`docs/integration/acp.md` "Live check (2026-10-29)"). Stdout purity was not located as a named live assertion; both real hosts parsed the stream [INFERENCE]. Anda's own MCP client was not driven (the Anda engine is out of scope in `docs/integration/omp.md` and `openshell.md`); the item named it as an example. | covered-by-later-evidence |
| **7.** "Live ACP client drive (SC5, TOOL-05)": initialize → session → `realm/tool` calls for all six tools plus a refusal; `protocolVersion: 1`, unbatched lifecycle replies, outcome-equal with MCP | Design changed and live evidence recorded. `docs/integration/acp.md` Q5: the method is `_realm/tool` (the unprefixed `realm/tool` answers `-32601`), and Realm "is a tool bridge, not a full ACP agent": it implements `initialize` and `_realm/tool` only; `session/new` and `session/prompt` answer `-32601`, "no ACP host exists that could start" a session (Not in this note). Live check 2026-10-29, production stack (Podman 5.7.1, OpenShell 0.1.5 gateway, Realm compute driver): 67 checks, 0 failed, including 16 equality checks ACP against MCP, refusals with the same catalogue code and retryable flag, one status snapshot seen by both, and the capability advert. `.planning/milestones/v2.0-REQUIREMENTS.md` TOOL-05: "Complete (live 2026-10-29: 67 checks, 0 failed ... the extension method is `_realm/tool`; no session methods, by design)". Equality of refusals that carry a cause code is covered by `test/surfaces/daemon-equivalence.test.ts` per `docs/integration/acp.md` (test named there; not re-run). The client was a throwaway Realm-aware client, not a third-party ACP host. | covered-by-later-evidence (the "session" step and the `realm/tool` name are superseded by the `_realm/tool` bridge design, `docs/integration/acp.md` Q5) |

### Known Limitations (a)–(f)

| Item (quoted) | Current evidence | Verdict |
| --- | --- | --- |
| **(a)** "OMP-03 tooltip — no documented tooltip API; reason + time are a second status item (P5-D5 deviation)" | Already marked superseded in this report (gap closure 2026-10-22: one status item, detail in its text). Confirmed by `docs/integration/omp.md` Entry and attach (status item keyed `realm`, text `<marker> <label> · <reason> · <last-transition time> · <mode disclosure>`, "There is no too…") and the live frames of 2026-10-23 and 2026-10-28. `v2.0-REQUIREMENTS.md` OMP-03: "Complete (accepted approximation, 2026-10-22: one status item, detail in its text; no tooltip API on this host)". | superseded |
| **(b)** "`ctx.ui.setStatus` is upstream-sourced only (OQ-P5-01)" | `docs/integration/omp.md` "OQ-P5-01 and OQ-P5-02": OQ-P5-01 closed for Omp 18.12.6; `ctx.ui.setStatus(key, text)` exercised in live runs that produced `setStatus` frames with key `realm` (2026-10-23, 2026-10-28). The official pages still do not state the signature (not re-read). | covered-by-later-evidence |
| **(c)** "Host write/edit interception is not documented as enforced: the `tool_call` guard is the only control (OQ-P5-02)" | Answered by observation: `docs/integration/omp.md` enforcement spike (OMPX-01, Omp 18.12.6, 12 of 12 twice on 2026-10-29): S2a removal enforced at execution, S3, S4, S6, S7, S8. Live guard and production runs under row 5a. Remaining bypasses are bounded by D3 (row 5b). | covered-by-later-evidence (pipeline); bypass residual as row 5b |
| **(d)** "No live Omp session, MCP client, or ACP client has been driven" | Driven live: Omp 18.12.5 (2026-10-23), 18.12.6 (2026-10-28, 2026-10-29), 18.20.0 (2026-11-14, Phase 12), 18.22.0 (2026-11-17, Phase 22); MCP via Claude Code, Grok Build and the production suite; ACP via the 67-check client (rows 1 to 7). The one live clause still unproven is row 1b. | covered-by-later-evidence (open clause tracked in row 1b) |
| **(e)** "workspace must be listed in `policy.workspaceRoots` or `create` refuses with `POLICY_DENIED` (D-22)" | A deployment note, not an open item. Observed live: 2026-10-23 workspace outside every policy root painted `○ realm disconnected · POLICY_DENIED` (`docs/integration/omp.md`); `docs/integration/omp.md` "Outside every policy root" and "Installed by `realm host install omp`" (Phase 22 rehearsal 2026-11-17: a directory outside every policy root paints `POLICY_DENIED` and creates no sandbox or container). | covered-by-later-evidence |
| **(f)** "`compose.ts` binds the workspace with `bindRoot`, without the policy check that `LifecycleController.create` enforces" | Fixed in code: `src/realm/compose.ts` `createRealmHandle` now calls `bindWorkspaceUnderPolicy(policy.workspaceRoots, config.workspaceRoot)` at construction (header comment: "the dispatcher never receives a root the policy excludes (D-22); otherwise POLICY_DENIED"); `src/fs/root.ts` `bindWorkspaceUnderPolicy` throws `POLICY_DENIED` outside every policy root; test `test/realm/compose.test.ts` case "CR-01: createRealmHandle refuses a workspace outside every policy root with POLICY_DENIED before any dispatcher exists (D-22)". Code and test title read; no run result recorded in the files read. | covered-by-later-evidence |

### Gaps

The report lists none ("None. Every unit-verifiable item is met"), so there is nothing to map. The "Gates" line (904 pass, 0 fail, 9 live-gated skips) is a pre-v2.0 count and is not re-asserted here.

### Open items after re-verification

1. Human Verification 1b (responsiveness during attach, UI-01): needs a measurement on an unloaded host showing the Omp loop is not blocked, or an owner ruling that closes UI-01. Until then this phase keeps `status: human_needed`.

Disclosed residuals that did not block a verdict: plugin 200 s timer expiry is unit-only (row 2); `[degraded]` suffix and colour cue not captured live (row 3); SDK-session and launch-flag bypasses never executed (row 5b); stale "not run" paragraph in `docs/integration/omp.md` Guard suite (row 5a).

_Re-verified: 2026-11-17_
_Re-verifier: Claude (read-only re-verification)_
