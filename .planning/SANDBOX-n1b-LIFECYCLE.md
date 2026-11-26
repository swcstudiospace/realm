# n1b Lifecycle & Resource Controls — read-only discovery (SPE-38066, ut-4b4c9b9f07 n1.5/n1.6)

Scope: `src/core/states.ts`, `src/core/timeout.ts`, `src/observe/logger.ts`,
`src/audit/redact.ts`, `src/daemon/main.ts` (teardown), `src/session/workspace-binding.ts`,
`src/runtime/session-execution.ts`. Every claim carries file:line; unverified items are listed at the end.

## 1. The 5-state machine — exactly what it allows

`src/core/states.ts:8-14` freezes `STATES = ["unbound","connecting","active","error","stopping"]` —
5 states, in table order. Header notes the removed `degraded` (D-11 spec had 8 states / 13 edges,
owner decision 2026-11-17 Phase 28; `src/core/states.ts:1,31-32`).

`src/core/states.ts:33-43` freezes exactly 9 allowed edges (each edge frozen,
`src/core/states.ts:24-29`), with **no self-transitions** (`src/core/states.ts:3`):

| from → to | |
|---|---|
| unbound → connecting | `src/core/states.ts:34` |
| connecting → active, error, stopping | `src/core/states.ts:35-37` |
| active → error, stopping | `src/core/states.ts:38-39` |
| error → connecting, stopping | `src/core/states.ts:40-41` |
| stopping → unbound | `src/core/states.ts:42` |

Notably absent (rejected): active→connecting, error→active, stopping→connecting,
unbound→anything-but-connecting, any self-loop. `isTransitionAllowed` is a table scan
(`src/core/states.ts:46-48`); `checkTransition` returns null or `REALM_INVALID_TRANSITION`
(`src/core/states.ts:50-55`).

Behavioural wrapper `src/core/state-machine.ts:2-4,20-28`: starts `unbound` with reason
`"no workspace"` (`src/core/state-machine.ts:10,26-27`). `transition()` throws before any
change on a disallowed edge incl. self-transitions, leaves state/reason/time/events unchanged
(`src/core/state-machine.ts:50-56`); on success it commits state+reason+clock first, then
publishes exactly one `state.transition` event with `{from,to,reason,at}` plus a held
`recoveredCode` if `holdRecoveredCode` was called (`src/core/state-machine.ts:45-48,57-65`).

**Deviation from the 8-state story:** the honest D-11 table was 8 states / 13 edges including
`degraded`; production is frozen at 5 states / 9 edges, no `degraded` member, edge, or reveal
(`src/core/states.ts:1,8-14,31-43`). Any doc/plan still describing degraded, connecting→degraded,
error→degraded etc. is stale vs this freeze.

## 2. Execution-state machine (SessionExecution)

`src/runtime/session-execution.ts:154-171` — lifecycle methods over injected libpod/runner/supervisor;
no host env read (`src/runtime/session-execution.ts:1-4`). No `State` import: the 5-state machine
above is separate; execution adds its own container/sandbox states.

- **create** (`src/runtime/session-execution.ts:193-267`): fail-closed `requireAgentOs` +
  `requireSecretRoot`/`requireSandboxStateRoot` (absolute-path `SCHEMA_INVALID`) +
  `isAbsolute(workspaceRoot)` + sandbox-name length, all before any libpod/OpenShell/policy call
  (`src/runtime/session-execution.ts:194-208`). Registers a `PendingCreate` before the first await so a
  concurrent stop waits for it (`src/runtime/session-execution.ts:209-214`); B-1 comment records the
  container→sandbox mapping before any libpod call on it (`src/runtime/session-execution.ts:253-255`).
  Create deadline `OPENSHELL_CREATE_DEADLINE_MS = 60_000` (`src/runtime/session-execution.ts:67,229-239`).
  Any throw from create onward deletes the named sandbox immediately; a failed delete is reported as
  `AGENTOS_STOP_FAILED` with the original code as cause, else the original error rethrows
  (`src/runtime/session-execution.ts:245-252`). A create marked `stopped` by a concurrent stop runs
  cleanup then throws `OPENSHELL_START_FAILED` instead of returning success
  (`src/runtime/session-execution.ts:256-261`). `verifyOrRemove` (`src/runtime/session-execution.ts:487-519`)
  inspects + checks hardening/conformance; on any failure it best-effort force-removes the container
  and throws `HardeningFailedError` / `OPENSHELL_START_FAILED` with removal-vs-inspect cause precedence
  (`src/runtime/session-execution.ts:491-518`). No unverified container is ever returned as running
  (`src/runtime/session-execution.ts:6-9`).
- **start** (`src/runtime/session-execution.ts:271-278`): requires running inspect
  (`isRunning` = `State.Running===true`, `src/runtime/session-execution.ts:522-527`), else
  `OPENSHELL_START_FAILED`; only then `agentos.start()`. Starts nothing else on the container.
- **probe** (`src/runtime/session-execution.ts:283-290`): null/not-running → `"unhealthy"`;
  else `agentos.check()` boolean → healthy/unhealthy. Libpod/`AGENTOS_CRASH_LOOP` failures throw with
  their own code, never a generic unhealthy (`src/runtime/session-execution.ts:280-282`).
- **stop/destroy** → `endSession` (`src/runtime/session-execution.ts:299-316`): name validated first
  (`requireSandbox`, `src/runtime/session-execution.ts:642-650`), so a refused call reaches no later
  step. Order: `settleCreatesFor` → `stopAgentOs` → `endContainer` (container step + sandbox delete),
  then `throwIfStopFailed` aggregates every step; first defined cause wins
  (`src/runtime/session-execution.ts:310-315,624-640`). Destroy mirrors stop but `removeContainer(force)`
  (`src/runtime/session-execution.ts:303-307,372-373`); a gone container counts as removed for remove
  (`src/runtime/session-execution.ts:356-357`). `stop` of an already-gone container is a no-op success
  (`src/runtime/session-execution.ts:368-370`); inspect rejection is a failed step and skips the container
  step (`src/runtime/session-execution.ts:361-367`).
  - `settleCreatesFor` (`src/runtime/session-execution.ts:318-344`): marks in-flight creates `stopped`,
    waits under `stopDeadlineMs` via `withTimeout(..., "AGENTOS_STOP_FAILED")`; expiry means
    `settled=false` → stop reports `AGENTOS_STOP_FAILED` (`src/runtime/session-execution.ts:329-336`).
  - `containerStep` (`src/runtime/session-execution.ts:356-385`): stop uses
    `stopContainer(id, CONTAINER_STOP_GRACE_MS=2_000)` (`src/runtime/teardown-stages.ts:16`);
    a `PODMAN_MACHINE_DOWN` miss is rescued by `containerEnded` polling, else a failed step
    (`src/runtime/session-execution.ts:378-384`).
  - `containerEnded` (`src/runtime/session-execution.ts:387-412`): bounded poll (`CONTAINER_CONFIRM_POLL_MS=500`,
    `src/runtime/teardown-stages.ts:28`) wrapped in `withTimeout(..., CONTAINER_END_CONFIRM_MS=10_000,
    "AGENTOS_STOP_FAILED")` (`src/runtime/teardown-stages.ts:25`); unreadable state is re-read until the
    bound; ended = null or `hasEnded` (configured/created/exited/stopped, `src/runtime/session-execution.ts:529-533`).
  - `stopAgentOs` (`src/runtime/session-execution.ts:414-434`): `withTimeout(agentos.stop(), stopDeadlineMs)`;
    no supervisor bound → step counts as stopped (`src/runtime/session-execution.ts:419-421`). A timed-out
    driver stop keeps running in the driver but reports failure, never success (`src/runtime/session-execution.ts:414-416`).
  - `deleteSessionSandbox`/`deleteNamedSandbox` (`src/runtime/session-execution.ts:436-458`):
    `withTimeout(deleteSandbox(runner, sandbox, SANDBOX_DELETE_DEADLINE_MS=15_000), SANDBOX_DELETE_DEADLINE_MS)`
    (`src/runtime/teardown-stages.ts:19`); already-deleted names are not deleted twice
    (`deletedSandboxes`, `src/runtime/session-execution.ts:165-166,439-456`).

## 3. Wall-clock / bounded waits

- `withTimeout` (`src/core/timeout.ts:7-18`): `Promise.race(work, timer)`; on expiry rejects with the
  catalogue `makeRealmError(code)`; `.finally(() => clearTimeout)` so no timer outlives the call.
  The loser promise is not cancelled — only the race settles.
- `sleep` (`src/core/timeout.ts:20-26`): resolves after ms, never rejects, not cancellable.
- `dialWithin` (`src/core/timeout.ts:28-50`): Unix-socket dial; on timeout destroys the socket and
  rejects with `RealmError(timeoutCode)`; on socket error destroys and rejects with the raw error
  (non-RealmError, so callers distinguish timeout vs failure via `instanceof RealmError`).
- `stopDeadlineMs`: default `AGENTOS_STOP_DEADLINE_MS = 15_000` (`src/runtime/teardown-stages.ts:10`),
  overridable via options; constructor rejects non-positive/non-finite (`src/runtime/session-execution.ts:185-188`).
  Worst-case end = sum of createWait + agentosStop + containerStep + containerConfirm + sandboxDelete
  (`src/runtime/teardown-stages.ts:30-53`).
- Daemon budgets (`src/daemon/main.ts:53-57`): `AGENTOS_START_TIMEOUT_MS=180_000`,
  `AGENTOS_CALL_TIMEOUT_MS=30_000` (probe/delete), `HEALTH_REATTACH={attempts:3, delayMs:10_000}` —
  up to 3 re-attaches with 10s delay after a probe failure.
- Workspace binding wait (`src/session/workspace-binding.ts:161-192`): `deadline = Date.now() +
  max(0, waitMs)`, FIFO poll every `POLL_INTERVAL_MS=5` (`src/session/workspace-binding.ts:48`);
  expiry: `TOOL_TIMEOUT` if `waitMs>0` else `LOCK_CONFLICT` (`src/session/workspace-binding.ts:182-187`).
- `spawnOpenShellRunner` (`src/runtime/session-execution.ts:736-789`): per-run `setTimeout(options.timeoutMs)`
  kills the child and its POSIX process group (`killProcessTree`, `src/runtime/session-execution.ts:680-699`);
  failure yields `OpenShellRunnerError("timed-out"|"failed")` with no child text
  (`src/runtime/session-execution.ts:765-775,730-735`).
- `runSandboxExec` (`src/runtime/session-execution.ts:809-832`): validates positive-integer timeoutMs
  (`SCHEMA_INVALID`), runs with an in-sandbox watchdog; runner rejection → `REALM_NOT_ACTIVE`,
  `timed-out` or late resolution (`now()-startedAt >= timeoutMs`) → `TOOL_TIMEOUT`; never carries child text
  (`src/runtime/session-execution.ts:797-807,816-830`).
- Fallback ordering inside a bound: confirmation wait is spent only after a `PODMAN_MACHINE_DOWN` miss
  (`src/runtime/teardown-stages.ts:40-42`); create wait only while a create is in flight
  (`src/runtime/teardown-stages.ts:32`).

## 4. Cleanup guarantees — who sweeps what

- **SessionExecution (runtime)**: create-failure → immediate named-sandbox delete
  (`src/runtime/session-execution.ts:245-252`); hardening failure → force-remove container, sweep is the
  backstop for survivors (`src/runtime/session-execution.ts:487-490`); stop/destroy → agentos stop,
  container step, sandbox delete, every step attempted even if an earlier one failed
  (`src/runtime/session-execution.ts:292-315,346-354`). Idempotence: `pendingDeletes` cache holds the
  container→sandbox name until a successful delete; `deletedSandboxes` suppresses a second delete call
  (`src/runtime/session-execution.ts:165-169,436-458`).
- **Daemon entry (`src/daemon/main.ts`)**: `runDaemon` closes both log sinks in `finally` after
  `awaitStop` and in the start-failure branch after `emitFailure` (`src/daemon/main.ts:119-134`);
  close-failure is itself logged to stderr under its own name (`src/daemon/main.ts:88-98`).
  `awaitStop` (`src/daemon/main.ts:263-312`): SIGTERM/SIGINT and control-channel `done` race onto one
  `started.stop()`; signal dedupes via `shutdownRequested`, settles once, unregisters handlers on settle
  (`src/daemon/main.ts:266-295`); `done` alone never settles a signal-initiated shutdown, and a server
  failure settles 1 (`src/daemon/main.ts:296-311`). Only the uncaught-failure handler calls
  `process.exit(1)`; otherwise the exit code is set on `process.exitCode` and the loop drains
  (`src/daemon/main.ts:1-6,323-337`).
- **Workspace binding (`src/session/workspace-binding.ts`)**: per-session lock at
  `<stateDir>/bindings/<sessionId>.lock` (`src/session/workspace-binding.ts:1-3`), published via
  tmp-file + `link(2)` — EEXIST means held, so a lock either does not exist or holds the full record
  (`src/session/workspace-binding.ts:5-8,240-251`); temp name removed on every path and an unremovable
  temp refuses with `CLEANUP_FAILED`, releasing any lock this call published
  (`src/session/workspace-binding.ts:194-196,253-266`). Takeover only when the owner is provably gone
  (pid dead / startTicks differ / bootId differs; live-but-unreadable counts as live), capped at
  `LOCK_TAKEOVER_ATTEMPTS=3`, else `LOCK_CONFLICT` (`src/session/workspace-binding.ts:10-15,268-289,321-344,46`).
  Malformed/empty/non-regular-FIFO locks are refused `LOCK_CONFLICT`, never followed or taken over
  (`src/session/workspace-binding.ts:14-15,291-319`). In-process FIFO per lock path
  (`src/session/workspace-binding.ts:91-112,114-134`); `releaseBinding` returns `CLEANUP_FAILED` rather
  than throwing, so `finally` never throws (`src/session/workspace-binding.ts:83-89,383-397`).

## 5. Logging surfaces — requests.log / daemon.log shape

- Logger (`src/observe/logger.ts:1-5,13-57`): one JSON object per line, keys ordered
  `ts, level, event, code?, ...fields`; reserved keys `ts/level/event` cannot be overridden by fields,
  `code` is typed `ErrorCode` (`src/observe/logger.ts:59,33-40`); hand-assembled so integer-like keys
  cannot reorder the prefix (`src/observe/logger.ts:136-164`). Level gate by rank
  (`src/observe/logger.ts:17,80-85`). Never throws: build/sink failures are counted in
  `droppedLines(byCategory)` — `open|write|rotate|close|stderr|sink|emit|child`
  (`src/observe/logger.ts:19-22,86-101,117`). Field values are `string|number|boolean|null|
  readonly(string|number)[]|undefined` (`src/observe/logger.ts:31`).
- Redaction inside the logger: every string value and every secret-looking key passes through the audit
  redactor; sensitive keys become `REDACTED` outright (`src/observe/logger.ts:3,158-161`).
- `requests.log` = request/lifecycle/control lines via `requestLogger` → rotating file sink at
  `requestLogPath(stateDir)`, stderr fallback counted in `fallbacks.lines` so no line is dropped, level
  from `REALM_LOG_LEVEL` via `parseLogLevel` (`src/daemon/main.ts:84-87,228-259`); an invalid level
  warns once as `daemon.log-level` (`src/daemon/main.ts:255-257`).
- `daemon.log` = entry records via `entryWriter` rotating file sink, stderr fallback counted the same way
  (`src/daemon/main.ts:199-226`); injected writer (tests) receives every line, no file opened.
  `daemon.startup` carries reap/adopt/sweep/audit-reconciliation counts with container ids (not secrets)
  and a 10-name cap on unfinished audit/sweep lists (`src/daemon/main.ts:141-185`);
  `audit.head` / `audit.unreadable` log the audit chain head per session
  (`src/daemon/main.ts:187-197`); `daemon.failed` carries only a catalogue code (`src/daemon/main.ts:352-356`).

## 6. Secret-redaction patterns (`src/audit/redact.ts`)

- Two layers before serialization (`src/audit/redact.ts:1-5`): key layer replaces the value of any
  credential-named key; value layer replaces credential-shaped substrings. Never throws — any input that
  cannot be walked safely becomes `REDACTED` (`src/audit/redact.ts:5,51-60`); nothing reports the value it
  redacted (`src/audit/redact.ts:7`); `REDACTED="[REDACTED]"` (`src/audit/redact.ts:9`).
- Key layer `SENSITIVE_KEY_PATTERN = /token|secret|password|passwd|api[_-]?key|authorization|cookie|
  credential|private[_-]?key/i`, case-insensitive (`src/audit/redact.ts:14-16`); applied per key in
  `redactAt` and in the logger (`src/audit/redact.ts:96-98`, `src/observe/logger.ts:159`); keys themselves
  are also passed through `redactString` (`src/audit/redact.ts:96`).
- Value layer `SECRET_VALUE_PATTERNS` (`src/audit/redact.ts:18-32`): `Bearer <token>`, PEM private-key
  block (to END or `$`), `AKIA[0-9A-Z]{16}`, `gh[pousr]_[A-Za-z0-9_]{20,}`, `sk-[A-Za-z0-9_-]{20,}`,
  `rcap1.<8+ base64url>[.<mac>]?` (capability token; also matches truncated MAC).
- `SECRET_ASSIGNMENT_PATTERN` (`src/audit/redact.ts:34-48`): `NAME=value` where NAME contains
  token/secret/password/key → only the value becomes `REDACTED`, NAME kept; lookahead anchored at a run
  start to avoid quadratic backtracking on long name runs.
- `redactAt` (`src/audit/redact.ts:62-104`): depth cap `REDACT_MAX_DEPTH=8` → `REDACTED` beyond;
  cycles → `REDACTED`; strings via `redactString`; bigint → decimal string; symbols/functions →
  `REDACTED`; objects copied to a null-prototype record so `__proto__` stays an ordinary property;
  input never mutated (`src/audit/redact.ts:51-52`).

## Unverified

- [UNVERIFIED] File-sink rotation parameters and whether `requests.log`/`daemon.log` rotate at identical
  sizes — `createFileSink` not in scope.
- [UNVERIFIED] Actual `DEFAULT_REQUEST_TIMEOUT_MS` and `FORCE_REMOVE_STOP_GRACE_SECONDS` values feeding
  `SESSION_END_WORST_CASE_MS` (`src/runtime/teardown-stages.ts:5,38-39`) — `libpod-client.ts` out of scope.
- [UNVERIFIED] `sessionOfRealmSandbox`/`realmSandboxName` derivation and `deleteSandbox` internals used
  by `endsNest` — `openshell.ts` out of scope.
- [UNVERIFIED] Who operationally triggers the startup reap/orphan sweep (daemon `startDaemon` internals)
  — only the startup report shape and emit path are in scope.
- [UNVERIFIED] `upLockWaitMs`/`downLockWaitMs` concrete defaults passed as `waitMs` — callers out of scope.
