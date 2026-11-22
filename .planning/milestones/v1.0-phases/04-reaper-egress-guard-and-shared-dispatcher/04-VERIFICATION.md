---
phase: 04-reaper-egress-guard-and-shared-dispatcher
verified: 2026-10-21T00:00:00Z
status: human_needed
score: 21/21 must-haves verified
reverified: 2026-11-17
reverify_open: 2
---

# Phase 4: Reaper, Egress Guard, and Shared Dispatcher — Verification Report

**Phase Goal:** Crashed sessions leave nothing behind, the container can reach only allowlisted hosts, and every tool call passes through one dispatcher.
**Verified:** 2026-10-21
**Status:** human_needed (all 21 unit-verifiable must-haves pass in code and unit evidence; 5 live behaviors need a Podman 5.x host — see Human Verification Required)

## Goal Achievement

### Observable Truths

| # | Truth (Roadmap SC) | Status | Evidence |
|---|--------------------|--------|----------|
| 1 | SC1: sweep removes every realm-labelled container, spares foreign ones, returns the removed count, proves zero survivors or reports `REALM_STOPPING`, and repeats as a no-op | ✓ VERIFIED (unit) | `src/runtime/sweep.ts` (`removeAllRealmContainers`: list → force-remove each → re-list, survivors throw `REALM_STOPPING`, returns first-list length); `test/runtime/down-sweep.test.ts` — 3 labelled + 1 foreign, survivor, repeat no-op cases, all titled `RT-08` |
| 2 | SC1: `SessionStore.list()` enumerates session ids from file names only, including corrupt records, ignoring non-matching names | ✓ VERIFIED (unit) | `src/session/store.ts:66` (`list()`, regular files only, no content read, absent dir → `[]`); `test/session/store.test.ts` — 3 `RT-08` `list()` cases |
| 3 | SC1: `reapStartup` removes containers before records, reaps a crash during `realm up` in both record states, is a no-op on repeat, and deletes nothing when the sweep fails | ✓ VERIFIED (unit) | `src/session/reap.ts` (sweep first, then `store.list()` + `delete`; imports no `src/runtime/` module); `test/session/reap.test.ts` — 6 `RT-08` cases incl. null-container-id crash, failure retention, repeat no-op |
| 4 | SC1 (live): after a crash during `realm up`, the next start on a live host reaps the labelled container and the stale record with zero orphans left | ⚠️ LIVE-GATED | `test/integration/podman-gate.test.ts:328` (`RT-08 live` body drives `reapStartup` against the live daemon; skips with `PODMAN_UNSUPPORTED_VERSION` on 4.9.3) — needs human run on Podman 5.x |
| 5 | SC2: egress allowlist entries with exact hostnames/IPv4 + ports 1–65535 validate; IPv6, wildcards, localhost, loopback, link-local, unspecified, bad ports refuse with `SCHEMA_INVALID` | ✓ VERIFIED (unit) | `src/runtime/egress.ts` (`validateEgressAllow`, frozen copy, value-naming refusal); `test/runtime/egress.test.ts` — 12 `RT-05` accept/refuse cases incl. no-value-in-error and frozen-copy |
| 6 | SC2: empty allowlist renders `{}`, non-empty renders deterministic `egress_<n>` entries with only the D-78 fields and no colon-bearing host | ✓ VERIFIED (unit) | `src/runtime/egress.ts` (`renderNetworkPolicies`: validates first, host-then-port order, code-unit compare); `test/runtime/egress.test.ts` — empty/shape/forbidden-key/determinism/port-order cases |
| 7 | SC2: host networking is rejected at config load; relative `workloadArgv[0]` refused, absolute accepted | ✓ VERIFIED (unit) | `src/runtime/config.ts:34` (`DENIED_KEYS`: network, networkMode, hostNetwork, netns, driverConfig, driverConfigJson, checked before the closed set); `requireArgv` absolute element-0 check; `test/runtime/config.test.ts` — 4 `RT-05` cases incl. `egressAllow`-key-refused (allowlist validated where the runtime is built, D-106) |
| 8 | SC2: policy document renders `network_policies` through D-78, stays valid JSON at mode 0600, and is written before the create argv; invalid allowlist writes nothing | ✓ VERIFIED (unit) | `src/runtime/openshell.ts:231,245` (`buildPolicyDocument(egress, workloadBinary)`, `writePolicyDocument` renders before `mkdir`); `src/runtime/session-execution.ts:102` (create passes `egressAllow` + `workloadArgv[0]` before create argv); constructor validates `egressAllow` before any side effect (D-106, C-3); `test/runtime/openshell-policy.test.ts`, `test/runtime/session-execution.test.ts` (`RT-05, RT-03` write-before-create, constructor-refusal) |
| 9 | SC2: exec argv is exactly the D-92 pinned form; no builder emits a D-80 forbidden flag | ✓ VERIFIED (unit) | `src/runtime/openshell.ts:141` (`buildExecArgv`: `exec --name realm-<id> --workdir /workspace --no-tty --no-login-shell -- <workload>`); `test/runtime/openshell-argv.test.ts` — exact-form, sandbox-name parity, per-flag absence, refusal cases |
| 10 | SC2 (live): from inside the container a non-allowlisted host fails, only configured host+port pairs succeed, and IPv6 is unreachable | ⚠️ LIVE-GATED | `test/integration/podman-gate.test.ts:299,308,317` (3 `RT-05 live` bodies: allowlisted reachable, `.invalid` unreachable, `::1` unreachable; all skip on 4.9.3). IPv6 posture is recorded partial per D-76: validator refuses IPv6 literals, hardening keeps `NetworkMode: none`, but supervisor-proxy enforcement is unverified — needs human run on Podman 5.x |
| 11 | SC3: every tool call runs schema → state → lock → admission → execution → result in order; a refusal stops all later stages with no execution | ✓ VERIFIED (unit) | `src/tools/dispatch.ts:111` (`call`: schema first, `SCHEMA_INVALID` with zero side effects; `buildExecArgv` refusal before admission; `#audited` admission-before-execution); `test/tools/dispatch.test.ts` — exec/write stage-order, zero-side-effect, malformed-argv, admission-failure cases |
| 12 | SC3: exec runs only in active in both modes; write follows the mode gate in degraded; read/list/status/retry are ungated | ✓ VERIFIED (unit) | `src/tools/dispatch.ts:159,149,183,193` (`#exec` active-only incl. D-109, `#write` connecting-wait + `mutationGate`, `#status`/`#retry` ungated, retry-by-state); `test/tools/dispatch.test.ts` — `SHELL_NOT_ALLOWED`-before-state, exec-active-only, advisory-warning, required-refusal-no-audit, retry-by-state cases |
| 13 | SC3: workspace handlers honor `ifMatchSha256`/`LOCK_CONFLICT`, audit lines carry byte count + sha256 and never content, read/list keep Phase 2 shapes | ✓ VERIFIED (unit) | `src/tools/workspace.ts` (write gate → canonicalize + credential → lock probe → admission → `lockedWrite` authoritative acquire → result; `audited` helper; unexpected non-`RealmError` rethrown); `test/tools/workspace.test.ts` — 19 `TOOL-03` cases incl. UTF-8 byte count, capped-read sha256-of-whole-file, allowlisted credential path |
| 14 | SC3: audit entries carry the admission/result stage so the two lines per call are distinguishable | ✓ VERIFIED (unit) | `src/audit/log.ts:36,42` (`AuditPhase`, optional `phase`; phaseless lines keep the old shape); `test/audit/log.test.ts` — 2 `TOOL-03` phase cases, all pre-existing assertions unchanged |
| 15 | SC3: one shared dispatcher — no second entry point; only `workspace.ts` imports the file functions; the runner spawn lives in one module; `SessionExecution` exposes no tool surface | ✓ VERIFIED (unit) | `src/tools/dispatch.ts:217` (`#audited` typed to exec/status/retry only; file tools self-audit, no double-write); `test/tools/no-bypass.test.ts` — 5 `TOOL-03` static guards (D-99 symbol allowlist, single `spawn(`, `OPENSHELL_BINARY` doctor exception, tools-import rule, synthetic-violation self-test); `test/runtime/openshell-routing.test.ts:171,181,192` — dispatcher routing + no-tool-surface cases |
| 16 | SC3: exec through the runner returns bounded stdout/stderr with truncation, maps runner rejection to `REALM_NOT_ACTIVE`, and a non-zero exit is success | ✓ VERIFIED (unit) | `src/runtime/session-execution.ts:323` (`runSandboxExec`: pinned argv, `captureOutput: true`, kinded mapping); `spawnOpenShellRunner` keeps ≤262144 bytes/stream, keeps draining, kills process group on timeout (D-94); `test/runtime/session-execution.test.ts` — bound/truncation, pinned-argv, no-child-text, non-zero-exit cases |
| 17 | SC3 (live): an exec through the shared dispatcher runs in the live sandbox | ⚠️ LIVE-GATED | `test/integration/podman-gate.test.ts:355` (`TOOL-03 live` body, stub controller pinned to active, real runner through pinned argv; skips on 4.9.3) — needs human run on Podman 5.x |
| 18 | SC4: a call exceeding its timeout returns `TOOL_TIMEOUT` with the runner killed; the bound is a constant, not a policy key | ✓ VERIFIED (unit) | `src/tools/dispatch.ts:57` (`TOOL_CALL_TIMEOUT_MS = 30000`); exec path double-bounded (runner `timeoutMs` kill + `withTimeout` race); `runSandboxExec` maps `timed-out` → `TOOL_TIMEOUT`; `OpenShellRunnerError` kinded with fixed text; `test/tools/queue-timeout.test.ts:21` (timed-out signal → `TOOL_TIMEOUT` + admission/result pair + kill deadline passed to runner). Accepted evidence approach: the 30s hang itself is not awaited; the killing signal the runner produces is what the test drives |
| 19 | SC4: a call in connecting waits at most `toolQueueMs` (default 2000); degraded never waits; timer and listener are cleaned up on settle | ✓ VERIFIED (unit) | `src/tools/dispatch.ts:264` (`waitLeavingConnecting`: `setTimeout(finish, toolQueueMs)` + subscribe, both cleared/removed on either outcome); `src/core/events.ts:22` (`subscribe` returns `() => void`); `test/tools/queue-timeout.test.ts:33,45,57` (default-2000 expiry with elapsed-time assertion, proceed-on-active, `listeners() === 0` + degraded fast-return); `test/core/events.test.ts` — unsubscribe cases |
| 20 | Traceability: taxonomy counts the `tools` category and all 4 Phase 4 IDs lead a test title in a named D-45 file | ✓ VERIFIED (unit) | `test/quality/suite-taxonomy.test.ts:266` (`PHASE_4_REQUIREMENT_IDS` title-lead check); the 04-07/04-06 ordering hazard is closed — `dispatch.test.ts` and `queue-timeout.test.ts` exist on disk with `TOOL-03`/`TOOL-04` title leads |
| 21 | Decision record: Phase 4 section records the OQ-P3-16 resolution, exec pin, IPv6 partial status, single-owner precondition, audit note, and OQ-P4-01–12 defaults | ✓ VERIFIED (unit) | `docs/integration/runtime-decision.md` Phase 4 section (D-100; v0.1.2 URL + 2026-10-21 read date; `--help` evidence; D-76 partial; D-87/OQ-P4-06 residual); `test/runtime/decision-note.test.ts:89,97,104,110,116,121` — 6 Phase 4 assertions + ordered 12-row table |

**Score:** 21/21 must-haves verified in code and unit evidence (3 items live-gated, listed below — unit halves verified, live halves need a 5.x host).

### Required Artifacts

All present, substantive, wired: `src/runtime/{egress,sweep}.ts`, `src/session/reap.ts`, `src/tools/{dispatch,workspace}.ts`, extended `src/runtime/{openshell,config,session-execution}.ts`, `src/session/store.ts` (`list()`), `src/core/events.ts` (unsubscribe), `src/audit/log.ts` (`phase`), `test/support/fake-openshell.ts` (capture fields + `reject-failed`/`reject-timed-out` steps). New tests: `test/{runtime/egress,session/reap,tools/workspace,tools/no-bypass,tools/dispatch,tools/queue-timeout}.test.ts`; extended: `test/runtime/{down-sweep,openshell-argv,openshell-policy,config,session-execution,openshell-routing,decision-note}.test.ts`, `test/{session/store,audit/log,core/events}.test.ts`, `test/integration/podman-gate.test.ts`, `test/quality/suite-taxonomy.test.ts`, `docs/integration/runtime-decision.md`. No frozen Phase 1–3 contract touched; error catalogue stays at 22 codes (`TOOL_TIMEOUT`, `REALM_STOPPING` pre-existing; no addition per D-101); no new policy key (`TOOL_CALL_TIMEOUT_MS` is a constant; `toolQueueMs` pre-existing default 2000 asserted in test).

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| dispatcher | workspace handlers | `dispatch.ts:135,138` routes write/read/list to `writeWorkspaceFile`/`readWorkspaceFile`/`listWorkspaceDir`; file tools self-audit, dispatcher audits exec/status/retry only | WIRED |
| dispatcher | OpenShell runner | `#exec` → `runSandboxExec(runOpenShell, sessionId, workload, TOOL_CALL_TIMEOUT_MS)` with `buildExecArgv` pre-refusal; `withTimeout` second bound | WIRED |
| dispatcher | controller | `events` (one queue wait + unsubscribe), `snapshot`, `mutationGate`, `create`; same `LockTable` instance via `WorkspaceDeps` (D-96) | WIRED |
| session-execution | sweep | sweep lives beside, not inside: `session-execution.ts` re-exports from `sweep.ts`; `podman-gate.test.ts:36` imports the moved module | WIRED |
| reaper | sweep | injected `sweep: () => Promise<number>` argument; `reap.ts` imports no `src/runtime/` module (D-50, pinned by no-bypass allowlist) | WIRED |
| openshell policy doc | egress renderer | `buildPolicyDocument` → `renderNetworkPolicies(egress, workloadBinary)`; create passes constructor-validated `egressAllow` before the create argv | WIRED |
| config load | egress validator | `egressAllow` key refused in runtime config; allowlist validated at `SessionExecution` construction (D-106) before any create, and at render time | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `renderNetworkPolicies` | entries | `validateEgressAllow` output (refusals throw before render) | ✓ real validated list, frozen copy | FLOWING |
| `writePolicyDocument` | file bytes | `buildPolicyDocument(egress, workloadBinary)` JSON | ✓ real policy at 0600 before create argv | FLOWING |
| `reapStartup` | ids removed | `store.list()` file-name enumeration + label sweep | ✓ real containers + records, containers first | FLOWING |
| dispatcher exec value | `OpenShellRunOutcome` | live runner via `runSandboxExec` (fakes in unit) | ✓ unit: fake runner; live: 5.x host | FLOWING (unit) / LIVE-GATED |
| dispatcher write value | `WriteOutcome` | real `lockedWrite` on real temp files in tests | ✓ real disk + hash | FLOWING |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| RT-05 | 04-01, 04-03, 04-05, 04-07 | Default-deny egress; host+port allowlist; no IPv6; host networking refused at load; non-allowlisted fails | ✓ SATISFIED (unit; proxy enforcement live-gated) | `test/runtime/egress.test.ts`, `config.test.ts` (RT-05), `openshell-argv/policy.test.ts`, `session-execution.test.ts` (RT-05), `podman-gate.test.ts` (RT-05 live ×3) |
| RT-08 | 04-02, 04-07 | Startup reap of labelled containers + stale records incl. crash during `realm up` | ✓ SATISFIED (unit; daemon run live-gated) | `test/runtime/down-sweep.test.ts`, `test/session/reap.test.ts` + `store.test.ts` (RT-08), `podman-gate.test.ts` (RT-08 live) |
| TOOL-03 | 04-04, 04-05, 04-06, 04-07 | Single dispatcher: schema, state, lock, audit before every sandbox call | ✓ SATISFIED (unit; sandbox run live-gated) | `test/tools/{dispatch,workspace,no-bypass}.test.ts`, `test/runtime/openshell-routing.test.ts`, `session-execution.test.ts` (TOOL-03), `podman-gate.test.ts` (TOOL-03 live) |
| TOOL-04 | 04-06 | Every call times out (`TOOL_TIMEOUT`); bounded queue wait in connecting | ✓ SATISFIED (unit) | `test/tools/queue-timeout.test.ts` (4 TOOL-04 tests), `test/runtime/session-execution.test.ts` (kill-on-timeout, real-process) |

No orphaned requirements: all 4 Phase 4 IDs are claimed by plans and cited in test titles (taxonomy check enforces this).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No `TODO`/`FIXME`/`XXX`, placeholder returns, empty handlers, hardcoded-empty data, or `console.log`-only implementations in Phase 4 sources | — | None found (grep sweep of `src/tools/`, `src/runtime/egress.ts`, `src/runtime/sweep.ts`, `src/session/reap.ts`) |

### Gates (reported by orchestrator; not re-run by verifier)

Per the run rules the verifier ran no gates. The orchestrator reports: `npm run typecheck` PASS; `npm run lint` PASS; full `node --test` suite PASS on two consecutive runs (828 pass, 0 fail, 9 skipped — the 9 skips are the Podman-gated live bodies skipping with `PODMAN_UNSUPPORTED_VERSION` because host Podman is 4.9.3 and OpenShell requires 5.x).

### Accepted Scope Boundaries (not gaps)

- **`reapStartup` has no in-`src/` caller.** The process that calls the reaper at startup does not exist yet — it arrives with the Phase 6 daemon/CLI and the RT-06 control channel. The Phase 4 CONTEXT boundary defers exactly this ("the process that calls the reaper at startup and the control socket (RT-06, Phase 6)"), and the single-owner precondition (D-87, OQ-P4-06 residual) is documented in `reap.ts` and the decision note. Unit surface + gated live body are the Phase 4 contract; wiring is Phase 6 work.
- **IPv6 enforcement is partial by design (D-76).** Realm cannot set container sysctls; it enforces what it can (IPv6 literals unrenderable, `NetworkMode: none` preserved) and gates the supervisor-proxy property on a live host.
- **04-06 deviation kept:** the queue-timeout kill test drives the exact `OpenShellRunnerError("timed-out")` signal the killing runner produces instead of awaiting a 30s hang; the 30s bound itself is covered by assertion (`timeoutMs === TOOL_CALL_TIMEOUT_MS` reaching the runner) plus the runner-level real-process kill tests.

### Gaps

None. Every unit-verifiable item is met in code and unit evidence.

### Human Verification Required

All items need a host with Podman 5.x (OpenShell requirement), a rootless Podman API socket, the `openshell` CLI on `PATH`, a digest-pinned image, and a JSON string-array workload. Common setup for every item below:

```sh
podman --version            # must report 5.x or newer
export REALM_LIVE_IMAGE='ghcr.io/example/realm-agent@sha256:<64-hex-digits>'
export REALM_LIVE_WORKLOAD='["/usr/bin/agent","--serve"]'
export REALM_LIVE_EGRESS_HOST='registry.example.com'
export REALM_LIVE_EGRESS_PORT='443'
npx tsc -p tsconfig.json
node --test dist/test/integration/podman-gate.test.js
```

Expected: the five bodies below RUN (not skip) and pass; afterwards `podman ps -a --filter label=io.realm.managed` shows no remaining realm containers.

### 1. Live egress: allowlisted host+port reachable (SC2)

**Test:** Run the suite above; observe `RT-05 live: an allowlisted host and port is reachable from inside the sandbox through the supervisor proxy` execute and pass.
**Expected:** The probe to `REALM_LIVE_EGRESS_HOST:REALM_LIVE_EGRESS_PORT` from inside the sandbox succeeds, proving the rendered `network_policies` entry is honored by the 0.1.2 gateway.
**Why human:** Needs a real Podman 5.x daemon, the OpenShell gateway's supervisor proxy, and real network — none exists on this host (4.9.3).

### 2. Live egress: non-allowlisted host and IPv6 unreachable (SC2)

**Test:** Same run; observe `RT-05 live: a non-allowlisted host is not reachable` and `RT-05 live: IPv6 is not reachable from inside the sandbox` execute and pass.
**Expected:** `never-allowlisted.invalid:443` and `[::1]:80` both fail from inside the sandbox, proving default-deny and the D-76 IPv6 posture end to end.
**Why human:** Supervisor-proxy enforcement is unverifiable without the live gateway (OQ-P4-01).

### 3. Live crash reap on the next start (SC1)

**Test:** Same run; observe `RT-08 live: a crash during up is reaped on the next start on a live host` execute and pass.
**Expected:** After simulating a crash during `realm up` (record with null container id + live labelled container), `reapStartup` removes the container and deletes the record (`containersRemoved >= 1`, `recordsDeleted >= 1`), and no realm-labelled container remains.
**Why human:** Needs a real daemon holding a real orphaned container; the fake-libpod ordering proof cannot show the label applied by the real Podman driver (OQ-P3-01).

### 4. Live dispatcher exec in the sandbox (SC3)

**Test:** Same run; observe `TOOL-03 live: an exec through the shared dispatcher runs in the live sandbox` execute and pass.
**Expected:** `ToolDispatcher.call({ exec: ... })` returns `done` with the live runner's outcome through the pinned `--name/--workdir/--no-tty/--no-login-shell --` argv, proving the dispatcher-to-sandbox path including `/bin/sh` availability for shell form (OQ-P4-04).
**Why human:** Needs a gateway-created sandbox; the pinned exec verb was verified only against the local 0.1.2 `--help` output.

### 5. Live policy acceptance and hung-exec timeout (SC2, SC4)

**Test:** Same run plus, optionally, a manual hung-exec probe: point a live workload at a `sleep 60` exec through the dispatcher and time the refusal.
**Expected:** The 0.1.2 gateway accepts the D-78 `network_policies` document at `--policy` create (OQ-P4-02); a hung exec returns `TOOL_TIMEOUT` at ~30s with no surviving sandbox process (runner `timeoutMs` kill + dispatcher `withTimeout` race).
**Why human:** Gateway document acceptance and wall-clock kill behavior cannot be observed without the live stack.

---

_Verified: 2026-10-21_
_Verifier: Claude (gsd-verifier)_

## Re-verification 2026-11-17

**Method.** Read-only against the repo. No test, build or gate was run; every verdict rests on a record read for this pass. Evidence sources: `docs/integration/openshell.md` ("Running the production live suite", scenarios 1 to 9 and its dated results), `docs/integration/runtime-decision.md` (Phase 4 status line, OQ-P4-01 to OQ-P4-05, D19-1), `docs/integration/acp.md` (live check of 2026-10-29), `test/integration/production-driver.test.ts` and `test/integration/podman-gate.test.ts` (as on disk), `.planning/milestones/v2.0-MILESTONE-AUDIT.md`, `.planning/milestones/v2.0-REQUIREMENTS.md`, `.planning/milestones/v2.0-phases/09.6-integration-live-proof/09.6-VERIFICATION.md`, `.planning/phases/19-resume-and-checkpoint/19-VERIFICATION.md`, `.planning/phases/19-resume-and-checkpoint/19-01-SUMMARY.md`, and the sources `src/session/reap.ts`, `src/daemon/startup.ts`, `src/runtime/session-execution.ts`, `src/runtime/openshell.ts`, `src/tools/dispatch.ts`.

**What changed since 2026-10-21.** The five human items named a host with Podman 5.x. That host exists: the production live suite (`test/integration/production-driver.test.ts`) ran on rootless Podman 5.7.1 with the OpenShell 0.1.5 gateway and the Realm compute driver. Recorded results: 31 of 31 assertions on 2026-10-28 (nine scenarios), 33 of 33 on 2026-10-30 (ten scenarios), scenarios 5, 6 and 10 re-run serially on 2026-11-15 (37 tests, 37 passed, 0 skipped; evidence file `&lt;home&gt;/realm-evidence/phase14/14-live-main3.txt`, as cited in `docs/integration/openshell.md`), and 40 tests, 40 passed, 0 skipped on the Phase 19 build `2ff6df9` on 2026-11-16 (`19-VERIFICATION.md`, "Live evidence read"; each full-suite file runs all 17 top-level tests, the count of 40 includes the subtests of scenarios 1 and 3). The five live bodies this report points at (`RT-05 live` x3, `RT-08 live`, `TOOL-03 live` in `test/integration/podman-gate.test.ts`) no longer exist: they were removed on 2026-10-28 and replaced by those scenarios (`docs/integration/runtime-decision.md`, Phase 4 status line; header of `test/integration/podman-gate.test.ts`, which now holds only the RT-02 version probe).

| Item (quoted) | Current evidence | Verdict |
|---|---|---|
| Truth 10 and Human item 1: "Live egress: allowlisted host+port reachable (SC2)" | Production live scenario 3 (`docs/integration/openshell.md`): with `egressAllow` of `1.1.1.1:443` and `example.com:443`, `1.1.1.1:443` and `example.com:443` (family 4) connect from inside the sandbox. Passed in the 2026-10-28 run (31/31), the 2026-10-30 run (33/33) and the 2026-11-16 Phase 19 run (40/40, 0 skipped, `19-VERIFICATION.md`). `docs/integration/runtime-decision.md` D-78 evidence list records "With an allowlist, the allowed `host:port` connects". Milestone record: `v2.0-REQUIREMENTS.md` RT-05 "Complete (live 2026-10-28, scenario 3 ...)". | covered-by-later-evidence |
| Truth 10 and Human item 2: "`never-allowlisted.invalid:443` and `[::1]:80` both fail from inside the sandbox, proving default-deny and the D-76 IPv6 posture end to end" | Scenario 3: `8.8.8.8:443` and `example.org:443` fail with `EACCES`; the IPv6 literal `2606:4700:4700::1111:443` fails with `EACCES`; `dns.resolve6` for `example.com` returns `ENODATA`; a made-up name under `example.net` resolves to an address inside `198.18.0.0/15` (synthetic resolver, policy enforced at connect time). Scenario 1: IPv6 disabled inside the sandbox; egress deny-all by default (`docs/integration/openshell.md` scenario text and the verified-properties list; `docs/integration/runtime-decision.md` D-78 evidence list, "verified on the rebuilt image, 2026-10-28"). The host packet capture on ports 53 and 853 showed no DNS packet for a made-up, a `.invalid` or a denied name (same sources). Same pass records as the row above. This closes the "recorded partial per D-76 ... supervisor-proxy enforcement is unverified" caveat and OQ-P4-01 for the 0.1.5 gateway. Note: `docs/integration/runtime-decision.md` still prints "Live-gated" in the OQ-P4-01 status cell; the live result is in the Phase 4 status line and the D-78 list. | covered-by-later-evidence |
| Human item 5 (first half): "The 0.1.2 gateway accepts the D-78 `network_policies` document at `--policy` create (OQ-P4-02)" | The 0.1.2 gateway was never run for this: the installed OpenShell files are 0.1.5 (`docs/integration/host-binaries.md`). The policy document is still written before create (`src/runtime/session-execution.ts:225`, `writePolicyDocument`, rendered by `src/runtime/openshell.ts:365` through `renderNetworkPolicies`), and scenario 3 shows the 0.1.5 gateway accepted it and enforced exactly its host:port pairs (rows above). The question as worded (0.1.2) is superseded by the pin move to 0.1.5 (`docs/integration/host-binaries.md`; `docs/integration/openshell.md`, which states the production stack is the 0.1.5 gateway). | covered-by-later-evidence (pin superseded to 0.1.5) |
| Truth 17 and Human item 4: "Live dispatcher exec in the sandbox (SC3)" including "`/bin/sh` availability for shell form (OQ-P4-04)" | Scenario 6: `realm mcp` over stdio, `exec` argv form (`echo` plus marker, exit 0; `sh -c 'exit 3'`, exit code 3), then `write` and `read` against the live sandbox; the dispatcher reaches the sandbox through the pinned `openshell sandbox exec` form. Scenario 1 runs `openshell sandbox exec -- sh -c 'exit 7'` directly (exit 7, so `/bin/sh` exists in the image). Shell form through the dispatcher: `docs/integration/acp.md` live check of 2026-10-29 (67 checks, 0 failed, exec cases "echo, exit code, stderr, shell form" equal across MCP and ACP). Pass records: 2026-10-28, 2026-10-30, re-run 2026-11-15 (scenario 6, 37/37), 2026-11-16 (40/40). `docs/integration/runtime-decision.md` OQ-P4-04 "passed live on the production stack, 2026-10-28". Milestone record: `v2.0-REQUIREMENTS.md` TOOL-03. | covered-by-later-evidence |
| OQ-P4-05 (Phase 4 table in `docs/integration/runtime-decision.md`): "Does `sandbox exec` return the remote exit code through the CLI exit status?" (live-gated, part of the dispatcher exec path) | Scenario 1 asserts exit 7 from `sh -c 'exit 7'`; scenario 6 asserts exit code 3 reported through the dispatcher. Same pass records as the row above. | covered-by-later-evidence |
| Human item 5 (second half): "a hung exec returns `TOOL_TIMEOUT` at ~30s" (SC4, TOOL-04) | Scenario 7: `exec sleep 45` through `realm mcp` returns a tool error with code `TOOL_TIMEOUT` and `retryable` true after between 25 and 40 s; the following `exec echo ok` exits 0; `realm status` still `active`; `realm mcp` exits 0 on stdin close (`docs/integration/openshell.md` scenario 7; assertions at `test/integration/production-driver.test.ts` scenario 7, lines 953-990). Constants: `TOOL_CALL_TIMEOUT_MS = 30_000` at `src/tools/dispatch.ts:61`. Passed in the 2026-10-28, 2026-10-30 and 2026-11-16 runs; `v2.0-REQUIREMENTS.md` TOOL-04 "Complete (live 2026-10-28, scenario 7 ...)". | covered-by-later-evidence |
| Human item 5 (clause): "a hung exec returns `TOOL_TIMEOUT` ... with no surviving sandbox process (runner `timeoutMs` kill + dispatcher `withTimeout` race)" | Scenario 7 proves the timeout code, the elapsed window and that the session stays usable. Nothing read asserts that the timed-out command (`sleep 45`) is gone inside the sandbox: the scenario never lists sandbox processes after the timeout, and `docs/integration/openshell.md` and `docs/integration/runtime-decision.md` record no such check. What is missing: a live probe that, after the `TOOL_TIMEOUT`, the sandbox holds no process from the timed-out exec (for example a process listing through `openshell sandbox exec` after 45 s). | still-open |
| Truth 4 and Human item 3 (live reap on the next start): "after a crash during `realm up`, the next start on a live host reaps the labelled container and the stale record with zero orphans left" | Scenario 5 (`docs/integration/openshell.md`; `test/integration/production-driver.test.ts` scenario 5): the daemon is SIGKILLed, the container survives, the next `realm up` reaches `active` with exactly one sandbox and one container; a stray container carrying the sandbox label is removed and named in `daemon.startup`, and no record is deleted (`19-VERIFICATION.md`, criteria 2 and 3). Scenario 11: a container that fails its verdict is removed and its record deleted (`containersRemoved` 1, `recordsDeleted` 1, cause `pids-limit`). Scenario 5 `ok` in all seven full-suite files after run 1 of the 2ff6df9 build, run 2 included (`19-VERIFICATION.md`). Earlier passes: 2026-10-28 and 2026-10-30; milestone record `v2.0-REQUIREMENTS.md` RT-08 "Complete (live 2026-10-28, scenario 5 ...)"; `09.6-VERIFICATION.md` item 5. Zero-residue after each scenario is asserted by the suite's cleanup (`docs/integration/openshell.md`, "Cleanup"). | covered-by-later-evidence |
| Human item 3 expected result: "`reapStartup` removes the container and deletes the record (`containersRemoved >= 1`, `recordsDeleted >= 1`)" for a surviving conforming container; and truth 3 and the key link from reaper to sweep (`reapStartup`, injected `sweep`) | Design changed. `reapStartup` no longer exists; the exports of `src/session/reap.ts` are `reapStartupSelective` and its types. Decision D19-1 (`docs/integration/runtime-decision.md`, 2026-11-03, owner ruling 2026-11-06): a container named by a record whose verdict passes is adopted and its record kept; every other realm container is removed with a cause and each removal is proven by a listing; a record that is not adopted is deleted only after every removal is proven. The unit tests carry `D19-1` titles (`test/session/reap.test.ts`). The sweep that removes every labelled container remains for `realm down` (`src/runtime/sweep.ts`, `test/runtime/down-sweep.test.ts` on disk). | superseded (D19-1, selective adoption; `19-VERIFICATION.md` RES-02) |
| Human item 3 state: "record with null container id + live labelled container" (a crash inside `realm up`, the D-86 case) | `src/session/reap.ts` `judge` handles it in code: a record whose `containerId` is not a string is deleted with cause `no-container`, and the labelled container, having no record, is removed with cause `no-record`; the reap header states "A record with a null container id (a crash during realm up, D-86) is reaped by the label sweep". What is missing: no live scenario kills the daemon between the record write (container id null) and the container create. Scenario 5 kills it after `active`; scenario 9 (startup budget) does not crash the daemon. At unit level no test in `test/session/reap.test.ts` builds a record with a null container id (`recordFor` accepts one, but no case passes `null`). The branch is exercised only through the absent-container case ("a record whose container is not adopted is deleted only after every removal is proven", record naming `c-old`) and the no-record case. A live run, or a unit case with `containerId: null`, is needed to close this state. | still-open |
| "Accepted Scope Boundaries": "`reapStartup` has no in-`src/` caller ... wiring is Phase 6 work" | Stale and closed: the reaper is called at startup from `src/daemon/startup.ts:153` (`reapStartupSelective`, hydration after the gate; `19-VERIFICATION.md` key-link table). `v1.0-MILESTONE-AUDIT.md` already flagged the line as stale. The single-owner precondition (D-87, OQ-P4-06) is unchanged and remains an accepted residual in `src/session/reap.ts`. | superseded (Phase 6 daemon wiring, then D19-1) |
| Preamble of "Human Verification Required": "the five bodies below RUN (not skip)" in `node --test dist/test/integration/podman-gate.test.js` with `REALM_LIVE_*` variables | Superseded procedure: the bodies were removed (`docs/integration/runtime-decision.md` Phase 4 status line, 2026-10-28). The current procedure is `npm run build` then `node --test dist/test/integration/production-driver.test.js`, with the prerequisites listed in `docs/integration/openshell.md` ("Running the production live suite"). The "9 skipped" in Gates was the count of the old gated bodies and no longer applies. | superseded (live bodies moved to the production suite, 2026-10-28) |
| Unit truth 15: "`test/tools/no-bypass.test.ts` — 5 `TOOL-03` static guards" | The file is no longer on disk. The structural no-bypass proof with the dispatcher routing half (D-46, D-99) lives in `test/runtime/openshell-routing.test.ts` (header comment names D-99, TOOL-03); the dispatcher, workspace and queue-timeout tests named in the report remain at `test/tools/`. Not one of the unresolved live items; recorded because the report cites the old file. | superseded (guard consolidated into `test/runtime/openshell-routing.test.ts`) |

**Verdict counts.** covered-by-later-evidence: 7. superseded: 4. still-open: 2 (a live check that a timed-out exec leaves no process in the sandbox, and a live or unit case for a session record with a null container id).

**Status.** Left at `human_needed`: two narrow items remain open, so the frontmatter carries `reverify_open: 2` and no `status: passed`. All five original human items are otherwise answered by the production live suite, and RT-05, RT-08, TOOL-03 and TOOL-04 are recorded Complete on live evidence in `v2.0-REQUIREMENTS.md` (the two open items are residual sub-clauses, not the requirement-level behaviors).

_Re-verified: 2026-11-17_
_Re-verifier: Claude (read-only)_
