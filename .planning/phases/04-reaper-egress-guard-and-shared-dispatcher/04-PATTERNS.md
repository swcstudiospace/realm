# Phase 4: Reaper, Egress Guard, and Shared Dispatcher - Pattern Map

**Mapped:** 2026-10-21
**Files analyzed:** 5 new source files; 4 modified source files (plus 2 conditional on planner decisions C-2 and C-4); 6 new test files; 10 modified test files; 1 modified support helper; 1 optional new support helper; 1 modified decision note
**Analogs found:** 5 / 5 new source files have a role-match or partial analog. The egress renderer, the dispatcher queue wait, the startup reaper loop, and bounded exec output capture have none (see No Analog Found).

## Analog Status Since Phase 3

Phase 3 files are present and are the analogs for this map. Every analog path below was checked with `git ls-files` and is tracked, so none is a gitignored mirror. Confirmed absent before Phase 4: `src/tools/`, `src/runtime/egress.ts`, `src/runtime/sweep.ts`, `src/session/reap.ts`, `test/tools/`. `removeAllRealmContainers` has no caller in `src/`; its only callers are `test/runtime/down-sweep.test.ts` and `test/integration/podman-gate.test.ts`.

## Conventions to Copy

1. **Imports.** Relative imports carry the `.js` suffix. Builtins use `node:`. Type-only names use the inline `type` modifier. A module under `src/runtime/` may import `core`, `contract`, `fs`, and `session/paths`. A module under `src/session/` must not import `runtime` (D-50), so `reapStartup` receives the sweep as an argument.
2. **Header comment.** Each module opens with a comment that names its decision IDs, as `src/core/events.ts` does (lines 1-4: `// Typed event bus (D-26, CORE-04). ...`).
3. **Errors.** `makeRealmError(code)` is the only construction path (`src/core/errors.ts` line 160). Hand validation uses a local `reject()` that throws `SCHEMA_INVALID` and names no value (`src/runtime/config.ts` lines 54-56). A runner or port failure never becomes a message or cause that crosses a boundary.
4. **Frozen output.** Argv arrays are returned with `Object.freeze([...])` (`buildCreateArgv`, `src/runtime/openshell.ts` line 88). Result objects are frozen the same way.
5. **Session id to name.** Each builder calls `recordFileName(sessionId)` first (`src/runtime/openshell.ts` lines 74 and 197). `recordFileName` (`src/session/paths.ts` lines 37-42) validates the id and returns `${sessionId}.json`. `buildExecArgv` applies the same check before it builds `realm-<sessionId>`.
6. **Time bounds.** `withTimeout(work, ms, code)` (`src/core/timeout.ts` line 6) does not cancel `work`. The owner of the I/O must stop it. For exec the owner is the runner: `spawnOpenShellRunner` (`src/runtime/session-execution.ts` lines 241-275) kills the process tree in its own timer. The dispatcher's race is a second bound, not the kill.
7. **Injected seams.** Dependencies arrive as one interface, as `LifecycleDeps` does (`src/lifecycle/controller.ts` lines 58-70). No new module reads `process.env` (D-88).
8. **Tests.** `node:test` and `node:assert/strict`. Each test title starts with its requirement ID in parentheses. The QUAL-02 check counts an ID only when a title leads with it (`test/quality/suite-taxonomy.test.ts`, lines 222-241). Temporary directories use `realpathSync(mkdtempSync(...))` with `t.after` cleanup (`test/runtime/openshell-routing.test.ts` lines 34-37).

## File Classification: Source, new

Match key: **exact** = move of an existing file; **role-match** = same role and layer; **partial** = same concern, different role; **none** = no analog.

| New file | Role | Data flow | Closest analog | Match | Copy from (symbols and lines) |
|---|---|---|---|---|---|
| `src/runtime/egress.ts` | utility (validator and renderer) | transform | `src/runtime/config.ts`: `IMAGE_PATTERN` (line 20), `reject()` (lines 54-56), `loadRuntimeConfig` (lines 34-52) | partial | `validateEgressAllow(rules)` copies the reject-only style of `loadRuntimeConfig`. Import `EgressRule` as a type from `src/contract/validate.ts` (lines 24-27). `renderNetworkPolicies` returns a frozen object, sorts by host then port, and keys each entry `egress_<n>` (D-78). Refusals are `SCHEMA_INVALID` only. The host check and the hostname regex follow the constant-plus-test style of `IMAGE_PATTERN`. |
| `src/runtime/sweep.ts` | service (zero-orphan sweep) | request-response | `removeAllRealmContainers` and `SweepClient` (`src/runtime/session-execution.ts` lines 189-205) | exact (move) | Move the function and the `SweepClient` type with no change in behavior. Return the removed count (D-84). Move `MANAGED_LABEL_VALUE` (line 34) into `src/runtime/openshell.ts` beside `MANAGED_LABEL_KEY` (line 28), so `buildCreateArgv` and the sweep share one constant. |
| `src/session/reap.ts` | service (startup reaper) | batch | `SessionStore` (`src/session/store.ts` lines 21-63) for the store; `LifecycleDeps` (`src/lifecycle/controller.ts` lines 58-70) for the dependency-object style | partial | `reapStartup({ store, sweep })` runs in this order: `await sweep()`; then `store.list()`; then `store.delete(id)` for each id (D-84). If the sweep throws, no record is deleted. Import only `session` modules and types. The sweep is a parameter, so there is no `runtime` import (D-50). |
| `src/tools/dispatch.ts` | service (single entry point) | request-response | Controller explicit state check in `probe` (`src/lifecycle/controller.ts` lines 267-271); `gateMutation` and `runGatedMutation` (`src/lifecycle/mutation-gate.ts` lines 23-41); `checkExecPolicy` (`src/core/policy.ts` lines 160-167); `validate` (`src/contract/validate.ts` line 263) | role-match | Stage order is D-89. Each stage returns a refusal as a structured error and stops. Exec checks `controller.snapshot().state === "active"` directly. Writes use `gateMutation` (the Phase 3 wrapper, D-63). `TOOL_CALL_TIMEOUT_MS = 30_000` follows the numeric-separator style of `OPENSHELL_CREATE_DEADLINE_MS` (`src/runtime/session-execution.ts` line 31). Exec passes `timeoutMs` to the runner (D-91). Export `ToolDispatcher`. |
| `src/tools/workspace.ts` | service (file handlers) | file-I/O | `lockedWrite` (`src/fs/write.ts` lines 27-43); `readFileCapped` (`src/fs/read.ts` lines 16-34); `listDir` (`src/fs/list.ts` lines 13-40) | role-match | The only file under `src/tools/` that imports these three (D-88). Each handler calls `canonicalize` with the mode it needs (`read` mode in `read.ts` line 35) and `assertCredentialAccess` (`src/fs/credentials.ts`). Result shapes are the Phase 2 shapes (D-98). Audit lines carry byte count and sha256, never content (D-42). |

## File Classification: Source, modified

| File | Change | Anchor (symbol and line) | Pinned by |
|---|---|---|---|
| `src/runtime/openshell.ts` | Change a signature; add a builder; move a constant; widen the outcome | `buildPolicyDocument()` (line 183) becomes `buildPolicyDocument(egress, workloadBinary)` and renders `network_policies` through `renderNetworkPolicies` (D-81). `writePolicyDocument` (line 196) calls `buildPolicyDocument()` at line 205, so it must also take `egress` and the workload binary. D-81 does not name this change, and it is required. Add `buildExecArgv(sessionId, argv)` beside `buildCreateArgv` (lines 72-116), with the same shape: id check, frozen argv, and `--` before the payload (D-92). `OpenShellRunOutcome` (lines 46-48) gains `stdout`, `stderr`, and `truncated` (D-94). `OpenShellRunOptions` (lines 41-44) gains an opt-in capture flag (C-6). | `test/runtime/openshell-policy.test.ts`; `test/runtime/openshell-argv.test.ts`; `test/runtime/session-execution.test.ts` line 164 |
| `src/runtime/session-execution.ts` | Remove the sweep; widen the runner; pass egress | Remove `SweepClient` and `removeAllRealmContainers` (lines 189-205) and `MANAGED_LABEL_VALUE` (line 34). `create()` (lines 87-110) calls `writePolicyDocument(runtime.stateDir, sessionId)` at line 91. It must also pass the egress list and `runtime.workloadArgv[0]`. `spawnOpenShellRunner` (lines 241-275) uses `stdio: "ignore"` (line 255) and resolves `{ exitCode: code ?? 1 }` (line 272). It rejects with the plain errors `RUNNER_FAILED` and `RUNNER_TIMED_OUT` (lines 43-44). `OPENSHELL_ENV_NAMES` (line 41) and `selectOpenShellEnvironment` (line 208) stay, because the doctor imports the latter. | `test/runtime/session-execution.test.ts` (fixture lines 26-80; runner tests lines 269-310) |
| `src/runtime/config.ts` | Add two load checks | Add a named denylist (`network`, `networkMode`, `hostNetwork`, `netns`, `driverConfig`, `driverConfigJson`) checked before the unknown-key loop (lines 36-40), so the refusal is named (D-80). `requireArgv` (lines 74-86) gains an absolute-path check on element 0, copying `requireAbsolutePath` (lines 89-94) (D-79). `ACCEPTED_KEYS` (line 24) is unchanged. | `test/runtime/config.test.ts` lines 98-106 and 134-139 |
| `src/session/store.ts` | Add `list()` | Copy the guard shape of `load` (lines 43-61). An absent sessions directory returns an empty array, not null. Enumerate with `readdirSync`, keep names that end in `.json` and whose stem passes `recordFileName` (in a try/catch), and parse no contents (D-85). The file already imports from `node:fs` (line 10). | `test/session/store.test.ts` lines 98-117 |
| `src/doctor/checks.ts` | None (D-101) | Imports `OPENSHELL_BINARY` (line 24) and `selectOpenShellEnvironment` (line 33). Affects C-5. | `test/doctor/runtime-checks.test.ts` |

Conditional on planner decisions (see Conflicts):

| File | Change | Anchor | Pinned by |
|---|---|---|---|
| `src/core/events.ts` | `subscribe` returns an unsubscribe function (C-2) | `EventBus` (lines 21-24) and `createEventBus` `subscribe` (lines 26-31) | `test/core/events.test.ts` |
| `src/audit/log.ts` | Optional phase field on `AuditEntryInput` (C-4) | `AuditEntryInput` (lines 34-41) | `test/audit/log.test.ts` |

Not changed: `src/lifecycle/controller.ts` is not reshaped. Phase 4 consumes `events` (line 74), `snapshot()` (line 104), `mutationGate()` (line 115), and `create(workspaceRoot)` (line 142). `src/runtime/libpod-client.ts`, `src/core/policy.ts`, `src/core/errors.ts`, `src/core/timeout.ts`, and `src/contract/*` are unchanged.

## File Classification: Support helpers

| Helper | Change | Analog | Notes |
|---|---|---|---|
| `test/support/fake-openshell.ts` | Modified. Return `stdout`, `stderr`, `truncated`; keep the logged argv and timeoutMs (lines 17-20 and 65-67) | itself | The `{ exitCode }` returns at lines 76, 78, and 80 must gain the new fields. The `hang` step (line 84) is what the TOOL-04 kill test uses. |
| `test/support/fake-tools.ts` | Optional, new | `FakeExecutionService` (`test/support/fake-execution.ts`, lines 11-40) | Only if a dispatcher case cannot be built from `FakeOpenShell`, `FakeLibpod`, and the real controller with `FakeBridge` (`test/support/fake-bridge.ts`, line 24). |

## File Classification: Tests, new (D-102)

| New test | Title IDs | Closest analog | Match | Copy from |
|---|---|---|---|---|
| `test/runtime/egress.test.ts` | RT-05 | `test/runtime/config.test.ts` lines 98-106 (reject cases); `test/core/policy.schema.test.ts` (accept and reject pairs) | partial | Exact hostnames and IPv4 accepted. IPv6, wildcard, localhost, loopback, link-local, and unspecified refused with `SCHEMA_INVALID`. Empty renders `{}`. Non-empty renders the exact D-78 shape. No `:` in any host. Deterministic order. |
| `test/session/reap.test.ts` | RT-08 | `test/runtime/down-sweep.test.ts`: `startFixture` (lines 13-28), `requestsOn` (lines 30-32), `assertCode` (lines 34-36) | role-match | First assertion is the order check: list containers, remove containers, then delete records. Also: a null container id; a record with a container id; a foreign unlabelled container untouched; a second reap is a no-op; a surviving container gives `REALM_STOPPING` and keeps every record. |
| `test/tools/dispatch.test.ts` | TOOL-03 | `test/lifecycle/mutation-gate.test.ts` (CORE-05 titles, lines 38-65); `FakeExecutionService` call log (`test/support/fake-execution.ts`, lines 11-16) | role-match | Record the call order across fake stages: schema, state, lock, audit admission, execution, result audit. Assert that schema runs before state and that no later stage runs after a refusal. |
| `test/tools/queue-timeout.test.ts` | TOOL-04 | `test/lifecycle/startup-budget.test.ts` (scripted delays); `FakeExecutionService.setDelay`; `liveTimers` (`test/core/timeout.test.ts`) | partial | A runner that never settles gives `TOOL_TIMEOUT`, and the runner receives its kill. A queued call times out after `toolQueueMs`. Timer cleared on settle. `degraded` does not wait. |
| `test/tools/workspace.test.ts` | TOOL-03 | `test/fs/write.test.ts` lines 58-101 (ifMatch cases) and lines 130-141 (lock held by another owner) | role-match | An `ifMatchSha256` mismatch gives `LOCK_CONFLICT` and leaves the file unchanged (D-34). Audit line has byte count and sha256 and no content (D-42). `read` and `list` pass the credential and root checks. |
| `test/tools/no-bypass.test.ts` | TOOL-03 | `test/runtime/openshell-routing.test.ts` (fixture lines 34-60; route names line 21); the `readFileSync` source reads in `test/quality/suite-taxonomy.test.ts` (lines 181-184) | partial | D-99 static guard over `src/`. The allowlist follows C-5. |

## File Classification: Tests, modified

| File | Change | Anchor | Note |
|---|---|---|---|
| `test/runtime/down-sweep.test.ts` | Migrate the import (line 8) to `src/runtime/sweep.js`; assert the returned count | line 8; tests at lines 38, 59, 71 | Behavior unchanged (D-84). |
| `test/integration/podman-gate.test.ts` | Migrate the import (line 29) and `scopedSweep` (lines 229-248); add gated bodies | line 29; line 248 | Gated bodies for RT-05, RT-08, and TOOL-03 (D-102). Each skips with `PODMAN_UNSUPPORTED_VERSION` on 4.9.3. |
| `test/runtime/openshell-policy.test.ts` | Keep the empty-map assertion (lines 40-42); add a non-empty case; update the calls to `buildPolicyDocument` | lines 19-80 | D-103. The empty assertion is migrated, not deleted. |
| `test/runtime/openshell-argv.test.ts` | Add exact exec argv `deepEqual`; add D-80 refusals | `WORKLOAD` (line 27); refusal table (lines 117-121) | RT-03, AUD-02. |
| `test/runtime/openshell-routing.test.ts` | Add the D-99 structural assertions if they are not in `no-bypass` | `LIBPOD_ROUTE_NAMES` (line 21) | Route set unchanged. |
| `test/runtime/config.test.ts` | Add relative `workloadArgv[0]` and denylist cases | lines 98-106 and 134-139 | D-79, D-80. |
| `test/runtime/session-execution.test.ts` | Update the `buildPolicyDocument()` call at line 164; add capture tests | line 164; runner tests at lines 269-310 | Existing runner tests cover the ignore-stdio path through the runner; keep them passing. |
| `test/session/store.test.ts` | Add `list()` cases | lines 98-117 | RT-08, D-85. |
| `test/quality/suite-taxonomy.test.ts` | Add `tools` to `CATEGORY_DIRS` (lines 12-24); add entries to `CATEGORY_MAP` (line 26) and `D45_FILES` (line 58); add `PHASE_4_REQUIREMENT_IDS` (RT-05, RT-08, TOOL-03, TOOL-04) with a test that mirrors the Phase 3 check (lines 231-241) | lines 12-24, 58, 126, 231 | D-102. The Phase 2 and Phase 3 lists stay. |
| `test/runtime/decision-note.test.ts` | Assert the Phase 4 section of `docs/integration/runtime-decision.md` | existing file | D-100. |

## Conflicts and Resolutions

Each conflict gives the decision text, the code fact, the resolution toward the Phase 2 and Phase 3 convention, and whether the planner must decide.

**C-1. Controller create argument (D-95). Resolved, no decision needed.** D-95 writes `controller.create(boundRoot)`. The controller takes `create(workspaceRoot: string)` (`src/lifecycle/controller.ts` line 142), and `bindWorkspace` binds it again (line 376). Resolution: pass `boundRoot.realPath`. The controller is not changed.

**C-2. The event bus cannot unsubscribe (D-91, D-97). Planner decision required.** `EventBus.subscribe` returns `void` and has no removal (`src/core/events.ts` lines 21-31). A queued call that adds a listener cannot remove it when it settles, so listeners accumulate and their closures stay alive. The Phase 3 bridge port already solves this. `BridgePort.subscribe` returns `() => void` (`src/core/ports.ts` lines 45-46), and the controller stores that function and calls it on release (`src/lifecycle/controller.ts` lines 486-490 and 545-548). Resolution: change `EventBus.subscribe` to return `() => void`. Existing callers ignore the return value, so they still compile. The publisher already iterates a copy of the listener list, so removal during delivery is safe. The alternative is a second dispatcher-only hook, which duplicates the bus. D-97's "no new controller method" still holds.

**C-3. Where egress is validated (D-77 says "at config load"). Planner decision required.** `RuntimeConfig` has no egress field (`src/runtime/config.ts` lines 10-18). `egressAllow` lives on `Policy` (`src/contract/validate.ts` lines 30-38), and `loadPolicyFile` returns `Policy` (`src/core/policy.ts` line 28). Resolution: `SessionExecutionOptions` (`src/runtime/session-execution.ts` line 52) gains `egressAllow`, and the `SessionExecution` constructor runs `validateEgressAllow`, so an invalid list throws before any create. `loadPolicyFile` is not edited. The composition root that builds `SessionExecution` is out of this phase, so the constructor is the earliest shared point.

**C-4. The audit entry cannot carry the stage (D-89, D-90). Planner decision required.** `AuditEntryInput` (`src/audit/log.ts` lines 34-41) has no `lock` field and no admission or result marker. D-89 records `lock: "none"`. On success the admission line and the result line both have outcome `ok`, so D-90's "distinguish by outcome" does not work. Resolution: add an optional `phase` field, valued admission or result, to `AuditEntryInput`. The other fields stay. This changes the D-42 format, which D-90 says is unchanged, so the planner must accept it or drop the `lock` field and the two-line claim.

**C-5. The D-99 allowlist misses the doctor (D-99). Resolved in the test design.** `src/doctor/checks.ts` references `OPENSHELL_BINARY` (lines 24 and 381) and calls `execFile` (line 497) for its read-only `openshell sandbox create --help` probe. D-99's allowlist (`src/tools/*`, `src/runtime/openshell.ts`, `src/runtime/session-execution.ts`, and their own modules) does not name the doctor, so a guard that forbids the `openshell` literal fails on the current tree. Resolution: the guard asserts on the D-99 symbols (`buildExecArgv`, `lockedWrite`, `readFileCapped`, `listDir`, `spawnOpenShellRunner`), which the doctor does not use, and on `spawn(` in `src/`. The doctor is added to the allowlist for the `OPENSHELL_BINARY` literal only. `buildCreateArgv` in the doctor (line 411) is not forbidden.

**C-6. Runner output and error kind (D-94). Resolved in the design; the new error class is public surface.** `spawnOpenShellRunner` ignores stdio (`stdio: "ignore"`, line 255), so exec output cannot be captured without changing the create path. Both rejections are plain `Error` objects with fixed messages (lines 43-44). D-94 needs a timeout (`TOOL_TIMEOUT`) and a rejection (`REALM_NOT_ACTIVE`) mapped differently. Matching on message text is fragile. Resolution: (a) add `captureOutput?: boolean` to `OpenShellRunOptions`. When it is false, stdio stays `ignore`, so the create path is unchanged. (b) Reject with a small `OpenShellRunnerError` class carrying a `kind` of failed or timed-out, with no child text in its message. The class is new in `src/runtime/openshell.ts`.

**C-7. Lock table identity (D-96). No conflict.** The controller uses `deps.locks` when it is given and makes its own table otherwise (`LifecycleDeps.locks` is optional, `src/lifecycle/controller.ts` lines 67-70). The composition passes one instance to both, and a test asserts identity.

**C-8. Exec gate and write gate (D-89). Resolved in the design.** `decideMutation` (`src/core/policy.ts` line 129) is the mode logic and must not decide exec. Exec uses a direct `active` check. Writes use `gateMutation`. This keeps the Phase 3 rule that the gate wrapper adds no decision logic (D-63).

## Pattern Assignments (short)

- **Egress render (D-78).** No analog renderer exists. The closest precedent for a fixed document is `buildPolicyDocument` (`src/runtime/openshell.ts` lines 168-191), whose comment says the shape is a documented contract.
- **Reaper order (D-84).** Containers before records. The analog is the two-phase `destroy` in the controller (`src/lifecycle/controller.ts` line 347), which keeps the record until teardown finishes.
- **Dispatcher refusal (D-89).** The analog is `probe` (`src/lifecycle/controller.ts` lines 267-271): an explicit state check that returns or refuses, never a caught throw (Phase 3 D-64).
- **Queue wait (D-91).** The analog is `connectBridge` (`src/lifecycle/controller.ts` line 400), which bounds a wait with `withTimeout` and settles through one path.
- **Sweep proof (D-84).** `removeAllRealmContainers` lists before and after removal and throws `REALM_STOPPING` when survivors remain. `test/runtime/down-sweep.test.ts` lines 71-81 pin that behavior, and the count return adds to it.
- **Argv builder (D-92).** `buildCreateArgv` (`src/runtime/openshell.ts` lines 72-116) is the template: validate, build a frozen array, put the workload after `--`. `buildExecArgv` takes the same form, with the verb `sandbox exec`, `--workdir /workspace`, `--no-tty`, and `--no-login-shell`.

## Shared Patterns

### Refusal before side effects
**Source:** `src/lifecycle/controller.ts` lines 142-146 (`create` refuses in `stopping`); `src/lifecycle/mutation-gate.ts` lines 37-41 (refusal returns with no run).
**Apply to:** every `ToolDispatcher` stage and the reaper's sweep check.

### Session id checked before a name is built
**Source:** `src/session/paths.ts` lines 37-42.
**Apply to:** `buildExecArgv` (new), `writePolicyDocument` (existing), and `SessionStore.list` (new, through a try/catch).

### Frozen argv
**Source:** `src/runtime/openshell.ts` line 88.
**Apply to:** `buildExecArgv`.

### Injected functions for cross-layer calls
**Source:** `DoctorOptions` injected seams (`src/doctor/checks.ts`, line 37, the `canWrite` style).
**Apply to:** `reapStartup({ store, sweep })` in `src/session/reap.ts` (D-84) and `ToolDispatcher` deps (D-88).

## No Analog Found

| File or piece | Role | Data flow | Reason |
|---|---|---|---|
| `src/runtime/egress.ts` renderer | utility | transform | No OpenShell policy renderer exists. `buildPolicyDocument` is the only precedent. |
| Dispatcher queue wait (TOOL-04) | service | event-driven | No wait-for-transition precedent. Closest is `connectBridge` with `withTimeout`. |
| Startup reaper loop (RT-08) | service | batch | No startup reaper exists. Closest is the controller's two-phase destroy. |
| Bounded exec output capture (D-94) | runner | streaming | `spawnOpenShellRunner` only ignores stdio today. Bounded capture is new. |

## Planner Decisions Required

1. **C-2:** Make `EventBus.subscribe` return an unsubscribe function (recommended), or add a dispatcher-only hook.
2. **C-3:** Validate egress in the `SessionExecution` constructor through a new `egressAllow` option (recommended), or change `loadPolicyFile`.
3. **C-4:** Add an optional `phase` field to the audit entry (recommended), or drop the `lock` field and the two-line claim.
4. **C-6:** Confirm the `OpenShellRunnerError` class and the opt-in `captureOutput` flag.
5. **Gated, not blocking the unit build:** OQ-P4-01 (IPv6 proxy behavior), OQ-P4-02 (gateway acceptance of the rendered document), OQ-P4-04 (exec verb against a real sandbox). Each is reported as live-gated, and no task depends on it passing here.

## Metadata

**Analog search scope:** `src/` (every Phase 2 and Phase 3 module named above) and `test/` (every Phase 2 and Phase 3 test file named above, plus `test/support/`).
**Tracked check:** `git ls-files` on every analog path listed here. All are tracked.
**Decisions read:** D-75 to D-103, OQ-P4-01 to OQ-P4-12, the Phase 3 pattern map, and the Phase 2 and Phase 3 analog symbols.
**Pattern extraction date:** 2026-10-21
