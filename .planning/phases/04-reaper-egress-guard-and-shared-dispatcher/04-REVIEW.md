---
phase: 04-reaper-egress-guard-and-shared-dispatcher
depth: deep
files_reviewed:
  - src/tools/dispatch.ts
  - src/tools/workspace.ts
  - src/runtime/egress.ts
  - src/runtime/sweep.ts
  - src/session/reap.ts
  - src/runtime/session-execution.ts
  - src/runtime/openshell.ts
  - src/core/events.ts
  - src/session/store.ts
  - src/audit/log.ts
  - src/runtime/config.ts
status: issues_found
---

# Phase 4 Code Review Report

**Reviewed:** 2026-10-21
**Depth:** deep (per-file analysis plus cross-module tracing into
`src/fs/locks.ts`, `src/core/timeout.ts`, `src/runtime/libpod-client.ts`)
**Files Reviewed:** 11
**Status:** issues_found — 0 critical, 3 high, 8 medium, 9 low

## Summary

Reviewed the Phase 4 surface: shared tool dispatcher, workspace handlers,
egress allowlist, zero-orphan sweep, startup reaper, session execution
composition, OpenShell adapter, event bus, session store, audit log, and
runtime config. The security posture is generally fail-closed (label
ambiguity, unknown config keys, malformed argv all refuse), and the
audit-before-execution ordering is honored in both the dispatcher and the
workspace handlers. No critical (exploitable / data-loss) defect was
confirmed. The findings below are ordered by severity. The three high items
are: `stop()` abandoning the container when `agentos.stop()` throws,
`destroy()` never stopping AgentOS, and the implicit default-to-`retry` in
`ToolDispatcher.#run`.

## High

### H-01: `SessionExecution.stop()` abandons the container when `agentos.stop()` throws

**File:** `src/runtime/session-execution.ts:150-155`
**What is wrong:** `stop()` awaits `this.agentos.stop()` first, and only
then inspects and stops the container. If the supervisor's `stop()` rejects
(supervisor socket gone, AgentOS already dead, unexpected error), `stop()`
throws before reaching `stopContainer`, leaving a running container behind
with no further in-process cleanup — the down sweep is the only backstop,
and it runs only at startup/shutdown paths. Stopping the workload container
is the primary effect; stopping the supervisor is secondary.
**Fix:**
```ts
async stop(containerId: string): Promise<void> {
  try {
    await this.agentos.stop();
  } catch {
    // Best effort: the container stop below is the primary effect.
  }
  if ((await this.libpod.inspectContainer(containerId)) === null) {
    return;
  }
  await this.libpod.stopContainer(containerId, CONTAINER_STOP_GRACE_MS);
}
```
If callers need to observe supervisor-stop failures, record them on the
returned probe/status rather than skipping the container stop.

### H-02: `SessionExecution.destroy()` force-removes the container without stopping AgentOS

**File:** `src/runtime/session-execution.ts:157-160`
**What is wrong:** `start()` brings up AgentOS via the supervisor and
`stop()` tears it down (`agentos.stop()` then `stopContainer`), but
`destroy()` calls only `removeContainer`. If `destroy()` is ever invoked on
a started session, the supervisor-managed AgentOS process is left running
with its container gone — an orphaned host-side workload and a supervisor
whose state disagrees with reality (a later `probe()` on the same object
would consult a live supervisor for a dead container). The asymmetry with
`stop()` looks like an omission, not a design choice.
**Fix:**
```ts
async destroy(containerId: string): Promise<void> {
  try {
    await this.agentos.stop();
  } catch {
    // Best effort: removal below is authoritative.
  }
  await this.libpod.removeContainer(containerId, { force: true });
}
```
If `destroy()` is by contract only ever called on never-started sessions,
state that precondition in the doc comment so the asymmetry is declared.

### H-03: `ToolDispatcher.#run` defaults any unrecognized validated call to `retry`

**File:** `src/tools/dispatch.ts:126-146`
**What is wrong:** The dispatch chain is `if ("exec") … if ("read") …
if ("write") … if ("list") … if ("status") … return this.#retry();`. The
final `return this.#retry()` makes `retry` the implicit default for
anything that passed `validate("tools", raw)` but matched no known key —
including a hypothetical multi-key object if the schema ever loosens, or a
new tool variant added to the schema before the dispatcher learns it. A
misrouted call then runs `controller.create()` (a state-changing,
audited create) under the wrong tool name in the audit log. Fail-closed
demands an explicit throw here.
**Fix:**
```ts
if ("status" in call) {
  return this.#status();
}
if ("retry" in call) {
  return this.#retry();
}
throw makeRealmError("SCHEMA_INVALID");
```
Same concern applies to multi-key objects (`{exec, read}` silently takes
the first branch); if the contract schema does not already enforce
exactly-one-key, add that check in `call()` before dispatching.

## Medium

### M-01: `#retry` captures `state` before the audit window and acts on the stale value

**File:** `src/tools/dispatch.ts:186-204`
**What is wrong:** `#retry` snapshots `state` once, writes the admission
line, then the closure tests the stale `state === "error"` to decide
whether to run `controller.create()`. A transition between the snapshot
and the closure (small window, but the admission append is I/O) means the
create decision is made on outdated state: e.g. `error → connecting`
still fires `create()`, or a fresh `error` takes the snapshot path and
reports a stale snapshot as a successful retry.
**Fix:** re-snapshot inside the audited closure:
```ts
const value = await this.#audited("retry", null, () =>
  this.deps.controller.snapshot().state === "error"
    ? withTimeout(this.deps.controller.create(...), TOOL_CALL_TIMEOUT_MS, "TOOL_TIMEOUT")
    : Promise.resolve(this.deps.controller.snapshot()),
);
```

### M-02: Identical inner/outer timeouts on exec leave no layered bound for a non-conforming runner

**File:** `src/tools/dispatch.ts:171-180`, `src/runtime/session-execution.ts:320-338`
**What is wrong:** `#exec` wraps
`runSandboxExec(runner, …, TOOL_CALL_TIMEOUT_MS)` (which hands the same
`TOOL_CALL_TIMEOUT_MS` to the runner) in
`withTimeout(…, TOOL_CALL_TIMEOUT_MS, "TOOL_TIMEOUT")`. `withTimeout` is
`Promise.race` with no cancellation (`src/core/timeout.ts:8-15`), so when
the outer race wins — i.e. exactly when the runner ignores its deadline —
the caller receives `TOOL_TIMEOUT` while the OpenShell child keeps
running: the docstring promise "a timed-out call keeps nothing running"
holds only for conforming runners. The identical budgets also mean the two
timers fire in the same millisecond with nondeterministic ordering.
**Fix:** give the outer bound a small headroom so a conforming runner
always wins the race and kills first, and document that a runner that
ignores `timeoutMs` leaks its child:
```ts
withTimeout(runSandboxExec(...), TOOL_CALL_TIMEOUT_MS + 1_000, "TOOL_TIMEOUT")
```
(or, preferably, have `#exec` pass `TOOL_CALL_TIMEOUT_MS` to the runner
and bound the whole call at `TOOL_CALL_TIMEOUT_MS + slack`).

### M-03: Egress validation accepts leading-zero IPv4 octets, inviting octal-interpretation bypass

**File:** `src/runtime/egress.ts:113-119`
**What is wrong:** `OCTET_PATTERN` (`/^(?:0|[1-9][0-9]{0,2})$/`) permits
`010`, `0177`, etc., and `parseIpv4` converts with `Number` (decimal).
Any downstream consumer that parses with C/`inet_aton` octal semantics
would read `0177.0.0.1` as `127.0.0.1`: an allowlist entry the validator
scores routable could be enforced as loopback (or vice versa for a denied
range), splitting the validator's model from the enforcer's. The refused
ranges (`127/8`, `169.254/16`, `0.0.0.0`) are only sound under decimal
semantics.
**Fix:** refuse leading zeros (canonical decimal form only):
```ts
const OCTET_PATTERN = /^(?:0|[1-9][0-9]{0,2})$/;
// add:
if (/^0[0-9]/.test(label)) return undefined; // no octal-looking octets
```
for each label in `parseIpv4`, or tighten the pattern to
`/^(?:0|[1-9][0-9]{0,2})$/` plus an explicit `label.length > 1 &&
label.startsWith("0") → reject` check.

### M-04: `runOpenShellCreate` poll treats an ambiguous label match as "not yet visible"

**File:** `src/runtime/openshell.ts:196-214`
**What is wrong:** When the label lookup returns 2+ containers for one
session (the fail-closed signal `singleId` exists to catch), the poll loop
does not call `singleId` until `found.length > 0` — and then `singleId`
throws. But between polls the loop just sleeps and retries until the full
`OPENSHELL_CREATE_DEADLINE_MS` (60 s) expires: an already-known fatal
condition burns the whole deadline before surfacing `OPENSHELL_START_FAILED`.
**Fix:** fail fast inside the loop:
```ts
const found = await lookupWithinDeadline(deps.containers, request.sessionId, left);
if (found !== null && found.length > 1) {
  throw makeRealmError("OPENSHELL_START_FAILED"); // ambiguous, fail closed now
}
if (found !== null && found.length > 0) {
  return singleId(found);
}
```

### M-05: Create-path label polling swallows libpod errors until the 60 s deadline

**File:** `src/runtime/openshell.ts:262-278`
**What is wrong:** `lookupWithinDeadline` maps every libpod failure
(socket down, daemon refusing, permission error) to `null` ("not visible
yet"), so a permanently broken libpod connection always costs the full
create deadline before the caller learns the start failed. Fail-closed is
correct; slow-to-fail is an availability/diagnostics problem for every
`realm up`.
**Fix:** distinguish transport failure from empty results — e.g. count
consecutive lookup errors and throw `OPENSHELL_START_FAILED` (or the
client's own code, per the module's "libpod failure propagates its own
code" rule) after N consecutive failures instead of polling to the
deadline.

### M-06: Startup sweep has no timeout — a hung libpod hangs daemon start forever

**File:** `src/runtime/sweep.ts:15-27`, `src/session/reap.ts:26-33`
**What is wrong:** `removeAllRealmContainers` awaits two
`listContainersByLabel` calls and N `removeContainer` calls with no
deadline, and `reapStartup` awaits the sweep with no bound. A wedged
Podman socket turns `realm up` into an indefinite hang before any record
is even inspected. Every other OpenShell-facing path in this phase
carries an explicit deadline (`OPENSHELL_CREATE_DEADLINE_MS`,
`TOOL_CALL_TIMEOUT_MS`).
**Fix:** wrap the sweep in `withTimeout(…, SWEEP_DEADLINE_MS,
"OPENSHELL_START_FAILED")` (or `REALM_STOPPING`), consistent with the
module's existing error vocabulary.

### M-07: `waitLeavingConnecting` wakes on any session's transition — no sessionId filter

**File:** `src/tools/dispatch.ts:264-278`, `src/core/events.ts:29-56`
**What is wrong:** The listener resolves when `event.from ===
"connecting"` for any event on the bus. If `DispatcherController.events`
is ever a bus shared across sessions, session B leaving `connecting`
releases session A's queued write/exec early. Both paths re-check state
after the wait (`#exec` re-snapshots; `#write` re-runs the mutation
gate), so this fails closed today — but the wake is spurious and the
correctness depends on those re-checks rather than on the wait itself.
**Fix:** subscribe with a session predicate, or document that the bus is
strictly per-controller-instance (single session) so cross-session wake
is impossible by construction:
```ts
const unsubscribe = events.subscribe((event) => {
  if (event.sessionId === this.deps.sessionId && event.from === "connecting") finish();
});
```

### M-08: `runSandboxExec` maps spawn/setup failure to `REALM_NOT_ACTIVE`

**File:** `src/runtime/session-execution.ts:320-338`
**What is wrong:** Any `OpenShellRunnerError` with kind `"failed"`
(missing `openshell` binary, spawn `ENOENT`, bad argv rejected by the
runner) becomes `REALM_NOT_ACTIVE`. Operators triaging a broken install
will chase session lifecycle instead of the real cause, and automated
retries keyed on `NOT_ACTIVE` will retry something that can never succeed
by waiting.
**Fix:** distinguish runner failure from a dead session:
```ts
throw makeRealmError(timedOut ? "TOOL_TIMEOUT" : "OPENSHELL_START_FAILED");
```
(`REALM_NOT_ACTIVE` should be reserved for "session exists but is not
running".)

## Low

### L-01: `writeTargetOf` reports multi-segment missing paths as `PATH_ESCAPE`

**File:** `src/tools/workspace.ts:164-172`
**What is wrong:** When canonicalization in write mode finds more than one
missing segment (nested creation), the function throws `PATH_ESCAPE` —
a traversal accusation for what is usually just "parent directory does not
exist". Misleading codes misdirect operators and any alerting keyed on
escape attempts.
**Fix:** throw a dedicated code (`SCHEMA_INVALID` or a
`PARENT_NOT_FOUND`-style code if the catalogue gains one) for
`resolved.missing.length !== 1`.

### L-02: `BoundedOutput.add` accumulates an empty buffer per chunk after the cap

**File:** `src/runtime/session-execution.ts:241-258`
**What is wrong:** Once `size` reaches `OPENSHELL_OUTPUT_LIMIT_BYTES`,
every further chunk still pushes `chunk.subarray(0, 0)` — an empty
`Buffer` object per `data` event. A chatty child emitting millions of
small chunks after the cap grows the `chunks` array without bound (object
overhead, not byte content), partially defeating the "memory stays
bounded" guarantee in the class comment. `Buffer.concat` then also walks
the dead entries.
**Fix:**
```ts
add(chunk: Buffer): void {
  if (this.cut) return; // already at cap; keep draining, keep nothing
  const room = OPENSHELL_OUTPUT_LIMIT_BYTES - this.size;
  ...
}
```

### L-03: `SessionStore.delete` on a planted `*.json` directory aborts `reapStartup` midway

**File:** `src/session/store.ts:99-107`, `src/session/reap.ts:28-30`
**What is wrong:** `list()` accepts any regular-file-suffixed name, but
`delete()` uses `rmSync(..., { force: true })` without `recursive`, so a
directory named `<id>.json` (requires state-dir write access — already a
compromise, hence low) makes `rmSync` throw and `reapStartup` abort with
the remaining records unprocessed. The next boot self-heals, but the
current reap reports failure despite the containers being gone.
**Fix:** in `reapStartup`, catch per-record delete failures and continue
(or use `rmSync(..., { recursive: true, force: true })` after the
`recordFileName` validation, which already constrains the name).

### L-04: `IMAGE_PATTERN` rejects registry references with an explicit port

**File:** `src/runtime/config.ts:16`
**What is wrong:** The pattern `^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$`
has no `:` alternative, so `registry.example.com:5000/agent@sha256:…`
is `SCHEMA_INVALID`. If pinned-registry-with-port images are a supported
deployment shape, valid configs are refused at load with no recourse.
**Fix:** if ports are legitimate, allow a single `:port` in the registry
segment (e.g. `^[a-z0-9][a-z0-9._/-]*(:[0-9]{1,5})?@sha256:[a-f0-9]{64}$`
scoped to the host part); otherwise document that registries must be
addressed without a port.

### L-05: Duplicate egress rules render duplicate policy entries

**File:** `src/runtime/egress.ts:62-83`
**What is wrong:** `renderNetworkPolicies` sorts but never dedupes, so
`[{host,port},{host,port}]` emits `egress_0` and `egress_1` with identical
content. Harmless to enforcement, but the policy document is a
documented contract ("changing it is a costly change") and duplicates add
noise to review/diff of rendered policy.
**Fix:** dedupe on `${host}:${port}` after validation, before indexing.

### L-06: Audit log has no durability guarantee (`fsync`) on the result line

**File:** `src/audit/log.ts:96-130`
**What is wrong:** `writeAuditLine` loops `writeSync` to completion but
never `fsync`s. A host crash between a mutating tool call and page-cache
flush can leave the effect without its result line — an admission line
with no matching result, which Phase 7 review must already tolerate
(defect path) but should not see on the crash path either.
**Fix:** `fsyncSync(fd)` before `closeSync(fd)` in the success path
(audit volume is low; the cost is negligible), or document the
crash-window as accepted.

### L-07: `selectOpenShellEnvironment` does not validate value types

**File:** `src/runtime/session-execution.ts:187-197`
**What is wrong:** Values are copied unchecked from `EnvironmentLike`. A
non-string value (number, object) survives the freeze and reaches
`spawn(..., { env })`, which throws a `TypeError` that the runner's
`try/catch` around `spawn` does map to `"failed"` — but the failure
surface is a runtime throw deep in spawn rather than a clean refusal at
selection.
**Fix:** copy only `typeof value === "string"` entries:
```ts
if (typeof value === "string") selected[name] = value;
```

### L-08: `spawnOpenShellRunner` validates neither `argv` shape nor `timeoutMs`

**File:** `src/runtime/session-execution.ts:269-315`
**What is wrong:** An empty `argv` is handled (`file === undefined →
"failed"`) but a caller-supplied `timeoutMs` of `0`, negative, `NaN`, or
`Infinity` flows straight into `setTimeout` (warning/1 ms/immediate
behaviour respectively). Internal callers validate today; the runner is
also the seam where tests inject fakes, so the contract should be
self-defending.
**Fix:** reject `OpenShellRunnerError("failed")` (or throw
`SCHEMA_INVALID`) when `!Number.isInteger(options.timeoutMs) ||
options.timeoutMs <= 0`, mirroring `runSandboxExec`'s guard.

### L-09: Stale policy files survive failed creates; `writePolicyDocument` never cleans up

**File:** `src/runtime/session-execution.ts:100-124`,
`src/runtime/openshell.ts:232-254`
**What is wrong:** `create()` writes `<stateDir>/runtime/<sessionId>.policy.json`
before `runOpenShellCreate`. If the create (or the subsequent
`verifyOrRemove`, which deletes the container but not the file) fails, the
policy file remains. Retries overwrite the same path, so staleness is
bounded — but repeated failed creates for distinct sessions accumulate
dead policy files, and a later create for the same session reuses a path
whose content was rendered from an older egress list until overwritten.
**Fix:** either remove the policy file on create failure (best effort,
before rethrow) or document that `runtime/*.policy.json` is a cache
rewritten on every `create()` and swept by the reaper (it currently is
not — `reapStartup` deletes only session records).

---

_Reviewed: 2026-10-21_
_Reviewer: Review_Phase04_ReportOnly_
_Depth: deep_
