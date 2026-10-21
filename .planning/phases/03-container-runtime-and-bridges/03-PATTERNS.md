# Phase 3: Container Runtime and Bridges - Pattern Map

**Mapped:** 2026-10-21
**Files analyzed:** 13 new source files and 5 support helpers (D-49); 19 new test files, one of them moved (D-70); 2 new decision notes (CONTEXT Specifics); 3 modified source files; 8 modified test-side files (including the Phase 2 controller and idempotency tests that D-64 migrates)
**Analogs found:** 13 / 13 new source files have a partial or better analog (1 exact move, 2 role-match, 10 partial). 18 / 19 new test files have a partial or better analog. The one without is the libpod client test, whose Unix-socket transport has no precedent in the repo.

## Analog Status Since Phase 2

Phase 2 files now exist and are the analogs for this map. All analog paths below are git-tracked (checked read-only): `src/core/timeout.ts`, `src/core/policy.ts`, `src/core/events.ts`, `src/core/state-machine.ts`, `src/core/states.ts`, `src/fs/atomic-write.ts`, `src/fs/root.ts`, `src/session/paths.ts`, `src/session/store.ts`, `src/contract/validate.ts`, `test/support/fake-execution.ts`, and the Phase 2 tests named in the tables. The ports module, the controller, the doctor module, and the taxonomy test are modified in place and are classified in the modified tables below.

Absent before Phase 3 (glob-verified): `src/runtime/`, `src/anda/`, the core backoff module, the lifecycle mutation gate, `test/runtime/`, `test/anda/`, `docs/integration/runtime-decision.md`, and `docs/integration/anda-decision.md`. A search of `src/` and `test/` finds no `createServer`, `socketPath`, `backoff`, `jitter`, `runCommand`, or `connectSocket`. The only process spawns are test-side `execFile` calls (the Podman gate test, `test/audit/log.test.ts`, `test/fs/read-list.test.ts`).

## Conventions to Copy

### 1. Imports
From the controller module, imports block:

```ts
import { randomUUID } from "node:crypto";
import type { Policy } from "../contract/validate.js";
import { type ErrorCode, makeRealmError, RealmError } from "../core/errors.js";
import type { ExecutionService, ProbeResult } from "../core/ports.js";
```

Relative imports carry the `.js` suffix (NodeNext). Builtins use `node:`. Type-only names use the inline `type` modifier (`verbatimModuleSyntax` is on).

### 2. Errors
`makeRealmError(code)` is the only construction path (`src/core/errors.ts`, lines 160-162). Every code Phase 3 uses already exists in the frozen 22-code catalogue: `PODMAN_MISSING`, `PODMAN_MACHINE_DOWN`, `PODMAN_UNSUPPORTED_VERSION`, `OPENSHELL_START_FAILED`, `AGENTOS_CRASH_LOOP`, `ANDA_UNREACHABLE`, `ANDA_VERSION_MISMATCH`, `STARTUP_BUDGET_EXCEEDED`, `REALM_STOPPING`, `POLICY_DENIED`, `LOCK_CONFLICT`, `SCHEMA_INVALID`. No code is added. A probe reason is `ERROR_CATALOGUE[code].reason` plus the specific detail (D-53).

A raw port failure never becomes a `RealmError` message or cause. The controller maps it to a fixed code (`PORT_FAILURE_CODE`, file header). Every runtime adapter follows the same rule.

### 3. Time bounds
`withTimeout(work, ms, code)` (`src/core/timeout.ts`) rejects the caller. It does not cancel `work`. The controller header states that a timed-out call is never awaited again. Each adapter must therefore cancel its own I/O on expiry: the libpod client destroys its socket (D-54), and the Anda client aborts its request (D-62). Timer cleanup is tested with the `liveTimers` helper at the top of `test/core/timeout.test.ts`.

### 4. Frozen tables
`Object.freeze` the outer value and every entry, and use `as const`: `freezeEdges` and `STATES` in `src/core/states.ts`. This applies to the provisional libpod route table (D-48), `HARDENING_PROFILE` (D-51), and the doctor check list.

### 5. Injected seams and environment
Injected dependencies follow the existing seams: `LifecycleDeps.clock` (controller, line 44), `DoctorOptions.canWrite` (doctor module, line 37), and `EnvironmentLike` (`src/session/paths.ts`, line 7). No `runtime` or `anda` module reads `process.env`. The environment is an argument (D-53, D-67).

### 6. Modes, atomic writes, and file names
- Directory mode `0o700` is `DIRECTORY_MODE` (`src/session/store.ts`, line 19). Record mode `0600` comes from `TEMP_FILE_MODE = 0o600` (`src/fs/atomic-write.ts`, line 51), applied by `fchmodSync` (line 105). A file written through `atomicWriteFile` is therefore already 0600.
- The write sequence is in `SessionStore.save` (lines 27-40): `mkdirSync(dir, { recursive: true, mode })`, `bindRoot(dir)`, `observeSha256(target)`, `atomicWriteFile(target, text, { expectedPriorSha256 })`.
- Session id to file name: `SESSION_ID_PATTERN` (`src/session/paths.ts`, line 10) and `recordFileName` (lines 37-40) throw `SCHEMA_INVALID`. Apply the same check before building any `<sessionId>` file name, including the policy file (D-57) and the `realm-<sessionId>` sandbox name (D-55).

### 7. Tests
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
```

Titles end with requirement IDs in parentheses, for example `(CORE-04, D-26)` in `test/core/events.test.ts`. Temporary directories use `realpathSync(mkdtempSync(join(tmpdir(), "realm-...")))` with `t.after` cleanup (the `layout` helper in `test/doctor/checks.test.ts`, and `fixture` in `test/lifecycle/controller.test.ts`). `@ts-expect-error` and `@ts-ignore` are banned (D-08). A negative type check becomes a runtime key-set check (`test/lifecycle/no-host-env.test.ts`, line 98).

### 8. Fakes
`FakeExecutionService` (`test/support/fake-execution.ts`) is an in-memory table keyed by idempotency key. It has a `calls()` log, `setDelay`, `failNext`, `beforeCall`, and a no-op `destroy` for a missing resource. It has no environment parameter. Every new fake follows this shape.

### 9. Dependency direction (D-50, extending D-20)

| Module | May import |
|---|---|
| `core/*` | nothing outside `core` |
| `runtime/*` | `core`, `contract`, `fs` (atomic replace), `session/paths` |
| `anda/*` | `core`, `contract` |
| `lifecycle/*` | `core`, `session`, `fs`, `contract`; never `runtime` or `anda` |
| `doctor/*` | `core`, `session`, `fs`, `contract`, `runtime`, `anda` |

Phase 2 rules that new files inherit (D-19, D-45): one owner per file; frozen files (`src/core/states.ts`, `src/core/errors.ts`, `src/core/policy.schema.json`, `src/contract/*`) gain new files beside them and no table edits; tests mirror `src/` under `test/<dir>/<file>.test.ts`; `test/support/*` holds helpers, not tests.

## File Classification: Source, new (D-49)

Match key: **exact** = the file is a move of an existing file; **role-match** = same role and layer; **partial** = same concern or convention, different role; **none** = no analog.

| New file | Role | Data flow | Closest analog | Match | Convention to copy and notes |
|---|---|---|---|---|---|
| `src/core/backoff.ts` | utility (pure) | transform | `src/core/timeout.ts` (one exported function, no imports) | partial | No backoff precedent. Export a pure schedule with `random` and `sleep` as injected parameters (section 5). Full jitter: `random() * min(cap, base * 2^attempt)`. Callers pass their defaults (AgentOS: base 500, cap 8000; Anda: base 500, cap 30000). Imports nothing. |
| `src/runtime/config.ts` | config type and load validation | load, transform | `src/core/policy.ts` `loadPolicyFile` (load, then check) and `src/fs/root.ts` `bindRoot` (absolute-path rule, lines 20-22) | partial | No `RuntimeConfig` schema exists, so validation is hand-written, not ajv. The image regex and rules come from D-52. The error code for relative paths is not fixed (F-P3-02). No environment read. |
| `src/runtime/podman-version.ts` | utility (pure parser and gate) | transform | `test/integration/podman-version.ts` | exact (move) | Move the whole file. `OPENSHELL_MIN_PODMAN_MAJOR`, `parsePodmanVersion`, `PodmanProbe`, and `podmanSkipReason` keep their bodies unchanged, so the moved assertions hold. Rewrite the header comment: it says the probe lives in the Podman gate, and D-53 moves the I/O out. Delete the old file. |
| `src/runtime/podman-probe.ts` | service (injected I/O probe) | request-response, process spawn | The Podman gate's `probePodman` (gate test, lines 14-24: `execFile`, 5000 ms timeout, failures mapped to unavailable) | partial | Same mapping: ENOENT, non-zero exit, and timeout give `PODMAN_MISSING`. D-53 requires injected `runCommand` and `connectSocket`, and no injected-process analog exists. The minimal environment (`PATH`, `HOME`, `XDG_RUNTIME_DIR`) is passed in, following `EnvironmentLike`. The socket path is built with `join`, as `controlSocketPath` does (`src/session/paths.ts`, line 33). |
| `src/runtime/libpod-routes.ts` | config (provisional route table) | none | `src/core/states.ts` (`Object.freeze` plus `as const`) | partial | The only file that holds libpod route strings (D-48). The header marks each route provisional (podman.md Q5). No `exec` route string appears here. |
| `src/runtime/libpod-client.ts` | service (closed client over a Unix socket) | request-response | `src/session/store.ts` `SessionStore` (class with readonly field and constructor argument, lines 21-24, and `makeRealmError` on failure) and `src/core/timeout.ts` | partial | No HTTP or Unix-socket client exists in the repo. The public method set is exactly D-54: `info`, `listContainersByLabel`, `inspectContainer`, `stopContainer`, `removeContainer`. On timeout the socket is destroyed (section 3). `removeContainer` treats 404 as success, matching the no-op `destroy` of `FakeExecutionService`. |
| `src/runtime/hardening.ts` | config and verifier | transform | `src/core/states.ts` (frozen table) and `src/core/policy.ts` `checkExecPolicy` (decision on input shape, line 160) | partial | `HARDENING_PROFILE` is frozen. `verifyInspect(profile, inspect)` returns the failed property names, empty on conformance. A missing or unknown field is a failure; never default it (D-51). No inspect-verifier precedent. |
| `src/runtime/openshell.ts` | service (argv builder, policy builder, bounded runner) | transform, file write, process spawn | Argv: `src/core/policy.ts` `checkExecPolicy` (the `"argv" in exec` form). Policy write: `src/session/store.ts` `save` (lines 27-40) | partial | Argv is an array with no shell (D-55). The runner is greenfield: no spawn helper exists in `src/`. The policy file name uses the session-id check (section 6), then `atomicWriteFile` (0600). The directory is `runtime/` under the state directory (D-57). |
| `src/runtime/agentos.ts` | model (`AgentOsDriver` port) and service (supervisor) | event-driven, retry loop | The ports module (interface-only file, `ExecutionService` at lines 16-22) for the port. `src/core/timeout.ts` for each driver call | partial | Port is `start`, `alive`, `stop` (D-59). No retry-loop precedent. No concrete driver is written (OQ-P3-05, OQ-P3-06). |
| `src/runtime/session-execution.ts` | service (`ExecutionService` implementation) | request-response | The ports module (the port) and `test/support/fake-execution.ts` (reference semantics) | role-match | Implements the frozen port. Same semantics as the fake: create is idempotent by key (D-56), and destroy of an absent container is a no-op. Takes the libpod client, the OpenShell runner, and the supervisor as arguments. Reads no `process.env` (D-67). |
| `src/anda/client.ts` | service (HTTP client, `BridgePort` implementation) | request-response, event-driven | The ports module (new `BridgePort`), the core backoff module, and `src/core/timeout.ts` | partial | No HTTP client exists in the repo. Imports only `core` and `contract` (D-50). Every timer is cleared on `close()` (D-62). Only the anonymous `GET /.well-known/information` route is used (D-61). |
| `src/anda/shape.ts` | utility (pure check) | transform | `src/contract/validate.ts` result union (`ValidationOk` line 109, `ValidationFailure` line 114, `ValidationResult` line 119) | partial | A hand-written shape check (D-61). No schema: adding one means extending the frozen `SCHEMA_FILES` and `SchemaValues` in `validate.ts` (F-P3-03). Detail text names the field, never the value (the privacy rule in the `validate.ts` header). |
| `src/lifecycle/mutation-gate.ts` | service (pure wrapper) | transform | `src/core/policy.ts` `decideMutation` (line 129), `MutationDecision` (lines 123-126), and `MutationDenyCode` (line 121) | role-match | Wraps `decideMutation` and adds no decision logic (D-63). Synchronous, and never waits. `refused.code` reuses `MutationDenyCode`. Imports `core` and `contract` only. |

## File Classification: Source, modified

| File | Change category | Anchor | Notes |
|---|---|---|---|
| `src/core/ports.ts` | add interface (additive) | `ExecutionService`, lines 16-22 | Add `BridgePort` (connect with a deadline, current snapshot, subscribe, close) and `BridgeEvent`: `{ kind: "up" \| "down" \| "mismatch"; code?: ErrorCode; at: string }`, where `at` matches `StateSnapshot.lastTransitionAt` (`src/core/state-machine.ts`, line 10). `ExecutionService` is unchanged (D-39). Interface only, no runtime values. `BridgeEvent` lives here and not in the `RealmEvent` union (F-P3-04). |
| `src/lifecycle/controller.ts` | add required dependency; add behavior; no renames | `LifecycleDeps` (line 39), `create` (line 82), `stop` (line 216), `destroy` (line 241) | (a) `LifecycleDeps` gains a required `bridge: BridgePort` (D-64). (b) `create` calls `connect` after `exec.start`, inside the same startup deadline and the existing `withTimeout` mapping. Success keeps `connecting` to `active`. `ANDA_UNREACHABLE` and `ANDA_VERSION_MISMATCH` go through `failCreate` and `enterError` (lines 282-311). A mismatch is not retried. (c) Subscribe before the first handshake, and unsubscribe in `destroy` (D-65). (d) A private listener applies the D-64 guard: transition only from `active`, `degraded`, or `connecting`, and discard other states by an explicit check, never a caught throw. (e) `stop` closes the bridge before `exec.stop`, inside `TEARDOWN_TIMEOUT_MS`. `destroy` closes it too. (f) Add `mutationGate()`, which reads the current state (D-63). (g) `probe` (line 168) stays exec-only. The operation names are frozen. `events` (line 52) stays state-transition only. |
| `src/doctor/checks.ts` | add checks; extend options; registry may become async | `CheckId` union, `DoctorOptions` (lines 30-38), the registry constant, `runChecks` (lines 53-56) | (a) `CheckId` gains `podman`, `podman-service`, `openshell`, `anda-bridge` (D-69). No AgentOS or control-channel id. (b) The four checks are appended to the registry in report order. (c) `DoctorOptions` gains optional injected seams (`runCommand`, `connectSocket`, and the Anda fetch seam), in the `canWrite` style (line 37). (d) If any check awaits, `runChecks` returns a Promise (F-P3-01). (e) Each check returns a `CheckResult`, with `fix` null only on pass. (f) Importing `runtime` and `anda` is allowed by D-50. |
| `test/support/fake-execution.ts` | none expected | the class | `ExecutionService` is unchanged (D-39), so the class needs no edit. It is named in the Change list, but no required change was found (F-P3-06). |

## File Classification: Support helpers, new (test/support/, D-49)

These are helpers exercised by the tests, not test files (D-70). Match key as above.

| New helper | Role | Data flow | Closest analog | Match | Convention to copy and notes |
|---|---|---|---|---|---|
| `test/support/fake-libpod.ts` | fake Unix-socket server emulating libpod | request-response over a socket | none (no socket server in the repo) | none | Greenfield. Use `node:http` with `socketPath`. Import the route strings from the libpod routes module so the provisional table stays single. Record every request and every socket close. |
| `test/support/fake-anda.ts` | fake HTTP server | request-response | none (no HTTP server in the repo) | none | Greenfield. Scripted responses: correct shape, wrong shape, and unreachable (close the socket). Records method, path, and headers, so tests can assert that no credential header was sent. |
| `test/support/fake-bridge.ts` | in-memory `BridgePort` | event-driven | `test/support/fake-execution.ts` | role-match | Same shape as the execution fake: `setDelay`, `failNext`, and a `calls()` log. Adds `emit({ kind })` for up, down, and mismatch. Default is zero latency and healthy, which the startup-budget test requires (see the modified tests). |
| `test/support/fake-agentos.ts` | in-memory `AgentOsDriver` | event-driven | `test/support/fake-execution.ts` | role-match | Scripted `start`, `alive`, and `stop` outcomes. Records each call. |
| `test/support/fake-openshell.ts` | scripted runner recording argv | process spawn (fake) | `test/support/fake-execution.ts` (call log) | partial | Records argv arrays exactly, with no shell. Scripted result per call. A successful create must also add a container to the fake libpod state, so the two fakes share one store. |

## File Classification: Tests, new (D-70)

| New test file | Requirement IDs in titles | Role | Closest analog | Match | Convention to copy and notes |
|---|---|---|---|---|---|
| `test/core/backoff.test.ts` | ANDA-03, RT-04 (AgentOS backoff) | unit | `test/core/timeout.test.ts` (`liveTimers`, QUAL-01 titles) | partial | Injected `random` returning 0 and 1 for the jitter bounds. Cap. Zero jitter at the boundary. |
| `test/runtime/podman-version.test.ts` | RT-02 | unit (moved) | `test/integration/podman-version.test.ts` | exact (move) | Move the file and change only the import to `../../src/runtime/podman-version.js`. `../../src/core/errors.js` still resolves from `test/runtime/`. Delete the old file. |
| `test/runtime/podman-probe.test.ts` | RT-02 | unit | The Podman gate's probe mapping; `test/integration/podman-version.test.ts` reason assertions | partial | Fake `runCommand` and `connectSocket`. ENOENT gives `PODMAN_MISSING`. 4.9.3 gives `PODMAN_UNSUPPORTED_VERSION`. A refused socket gives `PODMAN_MACHINE_DOWN`. 5.x with a socket passes. Each reason checked with `assert.match`. Probing stops at the first failure. |
| `test/runtime/config.test.ts` | RT-01 | unit | `test/core/policy.schema.test.ts` (accept and reject pairs) | partial | A tag-only image is rejected, and a digest image is accepted. `andaUrl` with userinfo is rejected. An empty `workloadArgv` is rejected. Relative paths are rejected (code per F-P3-02). |
| `test/runtime/libpod-client.test.ts` | RT-03, RT-09 | unit with fake socket | none for the transport. `test/core/timeout.test.ts` for timer checks | none (transport) | The method set from the prototype's own property names equals the D-54 list. No `exec` substring appears in the route constants. A timeout destroys the socket, and the fake records the close. |
| `test/runtime/hardening.test.ts` | RT-01 | unit | `test/contract/validate.test.ts` (accept and reject table) | partial | One failing case per D-51 property. A conforming inspect returns an empty list. A missing field fails closed. |
| `test/runtime/openshell-argv.test.ts` | RT-03, AUD-02 | unit | `test/contract/exec-policy.test.ts` (argv decision cases) | partial | `deepEqual` on the exact pinned argv (D-55). The workload follows `--`. No `--env` and no `--provider` element. |
| `test/runtime/openshell-policy.test.ts` | RT-03 | unit | `test/session/store.test.ts` (record mode); `test/audit/log.test.ts` line 70 (`statSync(...).mode & 0o777`, 0o600) | partial | `JSON.parse` round trip. `version` is 1. `landlock` is `hard_requirement`. `run_as_user` is not root. `network_policies` is empty. Mode 0600. |
| `test/runtime/openshell-routing.test.ts` | RT-03 | structural | the taxonomy test (`readFileSync` over sources); `test/lifecycle/no-host-env.test.ts` line 98 (key-set check) | partial | No bypass: the workload start goes only through the argv builder. The libpod client's keys contain no exec. AgentOS starts only through the supervisor. Uses the OpenShell and AgentOS fake call logs. |
| `test/runtime/agentos-supervisor.test.ts` | RT-04 | unit | `test/lifecycle/startup-budget.test.ts` (scripted delays); `FakeExecutionService.setDelay` | partial | Five consecutive failures give `AGENTOS_CRASH_LOOP`. The counter resets after 60000 ms of `alive` (injected clock). A hung driver times out. Injected random and sleep. |
| `test/runtime/session-execution.test.ts` | CORE-06, RT-07 | unit | `test/lifecycle/idempotent.test.ts` (repeat create, one resource) | role-match | A labelled container is reused with no second create (call count on the OpenShell fake). A failed verification destroys and gives `OPENSHELL_START_FAILED`. The policy file is written before create. |
| `test/runtime/down-sweep.test.ts` | RT-09 | unit | `test/lifecycle/controller.test.ts` destroy assertions; `test/session/store.test.ts` | partial | Three labelled containers and one foreign container. The foreign one is untouched. A repeated sweep is a no-op. A remaining container gives `REALM_STOPPING`. The sweep logic is greenfield. |
| `test/lifecycle/mutation-gate.test.ts` | CORE-05 | unit | `test/core/fail-closed.test.ts` (`NON_ACTIVE_STATES`, `NON_ACTIVE_CODES`, warning names the state, lines 30-51) | role-match | Every state in both modes. The return value is not a Promise. The warning names the state. No timer is scheduled. |
| `test/lifecycle/bridge-states.test.ts` | ANDA-03, CORE-05 | unit | `test/lifecycle/controller.test.ts` (fixture, snapshot shape); `test/core/state-machine.test.ts` (disallowed pairs) | role-match | Uses the bridge fake's emit. `active` to `degraded` on down (`ANDA_UNREACHABLE`). `degraded` to `active` on up. Mismatch gives `error`. Startup exhaustion gives `error`. Events in disallowed states are discarded without a throw. |
| `test/anda/handshake.test.ts` | ANDA-02 | unit with fake HTTP | `test/contract/validate.test.ts` (shape rejection) | partial | Correct shape connects. A wrong shape gives `ANDA_VERSION_MISMATCH` with one request only (no retry). The fake records headers, and the test asserts that no credential header was sent. |
| `test/anda/reconnect.test.ts` | ANDA-03 | unit with fake HTTP | `test/core/timeout.test.ts` (`liveTimers`) | partial | Unreachable gives `ANDA_UNREACHABLE`. Retries use growing bounded delays (injected random). Recovery publishes up. `close()` leaves no timer. |
| `test/anda/boundary-decision.test.ts` | ANDA-01 | doc check | the taxonomy test (`readFileSync` from `TEST_DIR`, line 9) | partial | Reads the Anda decision note. Asserts it records the HTTP boundary, the shape limitation, the no-shim decision, and the licence conflict. |
| `test/anda/no-shim.test.ts` | ANDA-04 | structural | the taxonomy test (`existsSync` checks) | partial | `src/anda/native/` does not exist. The decision note cites `GET /.well-known/information`. |
| `test/doctor/runtime-checks.test.ts` | RT-02, ANDA-02, D-69 | unit | `test/doctor/checks.test.ts` (`layout`, `resultOf`, `fixOf` helpers) | role-match | Pass, warn, and fail outcomes for `podman`, `podman-service`, `openshell`, and `anda-bridge`, each with its fix text. No AgentOS id is registered. |

## File Classification: Tests, modified

| File | Change category | Anchor | Notes |
|---|---|---|---|
| `test/integration/podman-gate.test.ts` | change import; replace the Phase 1 body; add gated bodies | import lines 4-8; probe lines 14-24; the test title | Import from `../../src/runtime/podman-version.js`. Replace the title "Phase 1: probe only; bodies arrive in Phase 3". Add three bodies under `{ skip: gate }`: RT-01 hardening, RT-03 routing, and RT-09 zero orphans (D-48). Each skip reason names `PODMAN_UNSUPPORTED_VERSION` on 4.9.3. The probe itself is unchanged unless F-P3-07 says otherwise. |
| `test/quality/suite-taxonomy.test.ts` | extend lists; change import | import line 6; `CATEGORY_DIRS`; `CATEGORY_MAP`; `D45_FILES`; test at line 138 | (a) Import from `../../src/runtime/podman-version.js`. (b) Add `runtime` and `anda` to `CATEGORY_DIRS` and `CATEGORY_MAP` (D-70). (c) Add all 19 new test files to `D45_FILES`. (d) Add a Phase 3 ID list: CORE-05, RT-01, RT-02, RT-03, RT-04, RT-09, ANDA-01, ANDA-02, ANDA-03, ANDA-04, with a test that mirrors line 138. Keep the Phase 2 test of 16 IDs. |
| `test/lifecycle/controller.test.ts` | migrate constructor: add `bridge` | `fixture` (construction near line 54) and the inline construction at line 303 | Add a default bridge fake: connect succeeds, zero latency. The Phase 2 assertions that expect `active` after create still hold. Return the bridge from `fixture`. |
| `test/lifecycle/idempotent.test.ts` | migrate constructor: add `bridge` | construction at line 39 | Same default fake. Idempotency assertions unchanged. |
| `test/lifecycle/no-host-env.test.ts` | migrate constructor: add `bridge` | construction at line 40 | The key-set check (line 98) stays on the exec port. Extending it to the bridge port is optional. |
| `test/lifecycle/startup-budget.test.ts` | migrate constructor: add `bridge` | construction at line 82; real-timer test at line 130 | The default bridge must add zero latency. The test uses a 200 ms budget against an 800 ms `exec.start`, and its single-container assertion depends on that timing. |
| `test/doctor/checks.test.ts` | migrate call sites to `await`; change registry assertions (conflict) | `REGISTERED_IDS` (line 8), `UNINSPECTABLE_ITEMS` (line 9), 16 `runChecks` calls at lines 50 through 180, final test at lines 179-188 | If `runChecks` becomes async, each call gets `await` and `resultOf` takes the awaited array. Assertions unchanged. The registry test conflicts with D-69 (F-P3-01). |

## Other New Paths Named by CONTEXT (not in D-49 or D-70)

| New file | Role | Closest analog | Match | Notes |
|---|---|---|---|---|
| `docs/integration/runtime-decision.md` | decision note | `docs/integration/podman.md`, `docs/integration/openshell.md` (research notes, tracked) | none (no decision-note format exists) | Records the layering (S-08) and its conflict with RT-01 and RT-03 wording (D-46, D-47). Also the Podman gate (S-09), the OpenShell pin (S-10), the AgentOS mode (S-11), and each OQ-P3 item with its default and blocked module. |
| `docs/integration/anda-decision.md` | decision note | `docs/integration/anda.md` (research note, tracked) | none | Records the HTTP boundary (S-12), the shape limitation (D-61), the no-shim decision (D-66), and the licence conflict (OQ-P3-11). Read by the boundary test. |

## Must Not Be Created (D-49, D-66, spec superseded names)

- `src/anda/native/` (ANDA-04, no shim).
- `src/runtime/egress.ts` (Phase 4), `src/session/reap.ts` (Phase 4), `src/tools/` (Phase 4), `src/cli/` (Phase 6), and any control-socket code (Phase 6).
- `src/anda/backoff.ts` and `src/core/controller.ts`, named by `docs/specs/realm-spec.xml` (wave list). D-49 supersedes them with the core backoff module and the lifecycle controller.
- `src/runtime/execution-service.ts`, also named by the spec. `session-execution.ts` replaces it (CONTEXT, code context).

## Pattern Assignments (short)

- **Libpod client timeout:** `withTimeout` is the outer bound. The client destroys its own socket on expiry (section 3).
- **Create idempotency (D-56):** list by label first, then create, then poll at 250 ms until the deadline. The Phase 2 analog is `create` in the controller (line 82), which reuses `priorContainerId` from the recorded session and never creates a second container.
- **Bridge event guard (D-64):** an explicit state check, never a caught throw. The analog is `probe` in the controller (lines 168-171), which returns the snapshot unless the state is `active` or `degraded`.
- **Mutation gate (D-63):** wraps `decideMutation`, and returns synchronously.
- **Teardown sweep (D-68):** a loop that lists by label, removes with force, and lists again to prove zero orphans. The analog is the two-phase `destroy` in the controller (line 241), which resumes from `stopping`.
- **Policy file write (D-57):** the `SessionStore.save` sequence (section 6), with `expectedPriorSha256` from `observeSha256`.

## Planner Findings (resolve before planning)

These are conflicts or gaps between the decisions and the existing code. None is resolved here.

**F-P3-01 (decision required; blocks the doctor work). The Phase 2 doctor test conflicts with D-69.** The test asserts that the registered ids equal the three Phase 2 ids (line 183), and that no item text matches `/podman|openshell|agentos|anda|control/i` (line 186). D-69 registers four checks whose ids and details contain those words. The Integration Points also say Phase 2 tests pass "without modification of their assertions", and both cannot hold. Options: (a) update the expected ids to the seven registered ids, and keep the absence check for `agentos` and `control`. Record the change in the phase report. (b) Keep `runChecks` for the three Phase 2 checks and add a second runner for Phase 3. That contradicts D-69's "same runner". Recommendation: (a). Under (a), the sync-to-async change at 16 call sites follows from any awaited probe.

**F-P3-02 (decision required). The error code for relative `stateDir` and `workspaceRoot` is not fixed.** D-52 gives `SCHEMA_INVALID` for a tag-only image and is silent on relative paths. The existing `bindRoot` gives `POLICY_DENIED` for relative paths (`src/fs/root.ts`, lines 20-22). Pick one, and use it in the config test titles.

**F-P3-03 (decision required). No schema exists for the Anda shape.** A schema would extend the frozen `SCHEMA_FILES` and `SchemaValues` in `src/contract/validate.ts`, which the frozen-file rule forbids. Recommendation: the hand-written check in the Anda shape module (D-61 text).

**F-P3-04. Keep bridge events off the state bus.** The controller's `events` bus carries `RealmEvent`, which is `StateTransitionEvent` only (`src/core/events.ts`, line 17). The Phase 2 event tests treat every delivery as a state transition. Put `BridgeEvent` in the ports module, and handle it in a private controller listener.

**F-P3-05. `withTimeout` does not cancel work.** Confirmed in `src/core/timeout.ts`, which only rejects. D-54 and D-62 require the adapters to destroy the socket and abort the request. The libpod and reconnect tests must assert that cancellation happens, and not only that the timeout code is returned.

**F-P3-06. The fake execution module is named as modified, but needs no edit.** `ExecutionService` is unchanged (D-39). Drop it from the modified list, or name the method it needs.

**F-P3-07 (planner choice). The Podman gate keeps its own probe.** Its probe runs `execFile` directly (gate test, lines 14-24). The D-53 probe needs injected I/O. Recommendation: leave the gate's probe as it is, since a test fixture should not depend on the module under test. Only the import and the bodies change.

**F-P3-08. Two runtime directory names.** D-57 writes policy files under `runtime/` in the state directory. The Phase 2 control-socket path uses `run/` (`src/session/paths.ts`, line 33). No collision, but the two names differ for runtime artifacts under one root. Use `runtime/` as D-57 says, and record the choice in the runtime decision note.

**F-P3-09. Superseded spec file names.** `docs/specs/realm-spec.xml` (wave lines 382-386) names files that D-49 and D-19 supersede. Do not create the Anda backoff module under `src/anda/`, or a `src/core/controller.ts`. Egress, reap, and dispatch are out of Phase 3 (D-49).

**F-P3-10. No analog exists for four pieces.** The Unix-socket HTTP fake, the plain HTTP fake, the bounded process runner, and the supervisor loop have no precedent in `src/`, `test/`, or `docs/integration/`. Write them from the D-54, D-55, D-59, and D-62 text, and say so in the phase report.

## Metadata

**Analog search scope:** `src/` (all Phase 2 modules), `test/` (all Phase 2 test files and `test/support/`), `docs/integration/`, `docs/specs/realm-spec.xml` (wave list), `package.json` (the `test` glob `dist/test/**/*.test.js` already covers the new `test/runtime` and `test/anda` directories, so no script change is needed), and `tsconfig.json` (`include` covers `src/**/*.ts` and `test/**/*.ts`).
**Tracked check:** `git ls-files` (read-only) confirmed that every analog path used here is tracked.
**Phase decisions read:** D-46 through D-71, OQ-P3-01 through OQ-P3-16, and the canonical references in `03-CONTEXT.md`.
**Pattern extraction date:** 2026-10-21

## PATTERN MAPPING COMPLETE

**Phase:** 3 - Container Runtime and Bridges
**New source files:** 13 (D-49), plus 5 support helpers (D-49)
**New test files:** 19 (D-70, including 1 moved)
**Modified:** 3 source files, 8 test-side files (including the fake execution helper)
**New decision notes:** 2
**Analogs missing:** the Unix-socket server, the HTTP fake, the process runner, the backoff schedule, the supervisor loop, and the decision-note format (F-P3-10)
**Planner decisions required:** F-P3-01 (blocking the doctor work), F-P3-02, F-P3-03, and F-P3-07
