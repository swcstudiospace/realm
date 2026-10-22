---
phase: 05-omp-plugin-mcp-and-acp-surfaces
depth: standard
files_reviewed:
  - src/realm/compose.ts
  - src/mcp/server.ts
  - src/acp/agent.ts
  - src/omp/plugin.ts
  - package.json
  - tsconfig.json
  - src/lifecycle/controller.ts
  - src/lifecycle/mutation-gate.ts
  - src/core/policy.ts
  - src/core/status.ts
  - src/fs/root.ts
  - src/tools/dispatch.ts
  - src/tools/workspace.ts
  - docs/integration/omp.md
status: issues_found
---

# Phase 5 Code Review Report

**Reviewed:** 2026-10-22
**Depth:** standard (with cross-module tracing for the six focus areas)
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Reviewed the five Phase 5 surfaces plus the modules they compose against.
The MCP framing hygiene is good (newline-delimited replies, fixed-text
diagnostics, no credential echo, notifications never dispatched) and the
`tool_call` guard fails closed for the tools it watches. The blocking theme
is that **policy enforcement lives only in `LifecycleController.create`
(`bindWorkspace`), while `createRealmHandle` binds the same root with bare
`bindRoot` and hands it to a dispatcher whose read/list paths are never
gated** — so files outside `policy.workspaceRoots` are readable (and, in
default advisory mode, writable) before/without any policy check. The plugin
also has no shutdown path at all despite its header comment claiming a
`session_shutdown` subscription: `close()` is never called, so containers
leak. No source or test file was modified; no tests, typecheck, lint, or git
commands were run.

Severity scale used below: **critical** (policy bypass / data-loss risk),
**high** (incorrect behavior, must fix), **medium** (robustness/correctness
gap, should fix), **low** (hardening/suggestion).

## Findings

### CR-01: Dispatcher serves files outside `policy.workspaceRoots` — compose binds without the policy check (item f)

**File:** `src/realm/compose.ts:42` (`bindRoot(config.workspaceRoot)`)

**Issue:** `createRealmHandle` binds the workspace with bare `bindRoot`
(absolute path + is-a-directory only) and injects the resulting
`PinnedRoot` into the `ToolDispatcher`. The `workspaceRoots` allowlist is
enforced only later, inside `LifecycleController.bindWorkspace`
(`src/lifecycle/controller.ts:376-382`), which runs during `create()`. But
the dispatcher's `read` and `list` paths are **not state-gated at all**
(`src/tools/dispatch.ts` `#run`: read/list call straight into
`readWorkspaceFile`/`listWorkspaceDir`; only `write` consults the mutation
gate and only `exec` requires `active`). Consequence: over MCP or ACP, `read`
and `list` succeed against **any absolute directory** even when
`create()` would refuse it with `POLICY_DENIED` — including a workspace the
operator deliberately excluded from `policy.workspaceRoots`. Worse, in the
default advisory mode `decideMutation` returns `allow-with-warning` for
`unbound`, so a `write` before `create()` (or against a policy-denied root)
**proceeds with only a warning** (`src/core/policy.ts` `decideMutation`,
`src/tools/workspace.ts:71-74`). Required mode is safe (unbound → deny), but
the default configuration is not. This contradicts the requirement that every
mutation lands inside the realm under policy or fails closed.

**Fix:** Enforce the allowlist at bind time in the composition root, not just
at `create()` time. Either (a) move `bindWorkspace` (or a policy-roots check
helper) somewhere `compose.ts` can call it so the dispatcher never receives
an out-of-policy root:

```ts
// src/realm/compose.ts
import { bindWorkspaceRoot } from "../lifecycle/bind-workspace.js"; // extracted helper
const boundRoot = bindWorkspaceRoot(policy, config.workspaceRoot);
```

or (b) gate `read`/`list` on the controller state the same way `write` is
gated, so no file tool runs while `unbound` regardless of mode. Option (a)
is preferable: it closes the read path too and removes the double-bind
TOCTOU between compose's `bindRoot` and `create()`'s re-bind (a symlink swap
between the two binds the dispatcher and the container to different
directories).

---

### HI-01: Plugin never subscribes `session_shutdown` and never calls `close()` — header comment claims otherwise, containers leak

**File:** `src/omp/plugin.ts:11-13` (comment), `src/omp/plugin.ts:138-150`
(`registerRealmPlugin`)

**Issue:** The header comment states `session_shutdown` is "subscribed only
to drop the captured session reference", but `registerRealmPlugin`
subscribes only to `session_start` and `tool_call` and registers the retry
command. There is no `pi.on("session_shutdown", …)` anywhere in the file,
and nothing ever calls `session.handle.close()` (which delegates to
`controller.stop()`). On session end the captured `ActiveSession` — and its
running container — is retained; a subsequent `session_start` overwrites the
reference and orphans the previous container. The budget timer survives on
host auto-clear only (upstream-sourced behavior, not something the plugin
verifies). Every session leaks one container and one event-bus subscription.

**Fix:** Subscribe to shutdown and tear down deterministically; correct the
comment if the host truly guarantees cleanup (it currently promises what the
code does not do):

```ts
pi.on("session_shutdown", () => {
  const s = session;
  session = null;
  if (s !== null) {
    void s.handle.close().catch(() => undefined);
  }
});
```

Also unsubscribe the `events.subscribe` callback installed in
`startRealmSession` (`src/omp/plugin.ts:158-160`) when the session ends,
otherwise the render closure keeps the old `ctx.ui` alive.

---

### HI-02: Startup throws before any status is painted — blank indicator instead of "disconnected"

**File:** `src/omp/plugin.ts:150-156` (`startRealmSession`)

**Issue:** `loadPolicyFile`, `loadRuntimeConfig`, and `createRealmHandle`
(all of which throw: `POLICY_DENIED`, `SCHEMA_INVALID`) run **before** the
first `renderRealmStatus` call. A bad policy path, an out-of-roots policy
file, or a non-directory workspace root throws synchronously out of the
`session_start` handler, so the indicator is never painted at all — violating
"the user can always see whether the realm is active or disconnected". The
guard then blocks everything (`session` stays `null` → "realm not started",
which is fail-closed and correct), but the user sees a blank indicator with
no reason. The exception also propagates into host event dispatch, whose
handling of a throwing `session_start` handler is not established in-repo.

**Fix:** Wrap startup so a synchronous failure still paints `disconnected`
with the catalogue code, then rethrow or swallow per the host contract:

```ts
let handle: RealmHandle;
try {
  handle = createRealmHandle(options);
} catch (error: unknown) {
  renderRealmStatus(ctx.ui, {
    state: "error",
    reason: error instanceof RealmError ? error.code : "OPENSHELL_START_FAILED",
    lastTransitionAt: options.clock().toISOString(),
  });
  throw error;
}
```

---

### MED-01: ACP executes tool calls delivered as JSON-RPC notifications and discards the result

**File:** `src/acp/agent.ts` (`handleLine`, `REALM_TOOL_METHOD` branch)

**Issue:** MCP's `handleLine` returns early for id-less messages
(`src/mcp/server.ts`: "A notification carries no id, so it takes no
reply") **before** dispatch, so a `tools/call` notification never executes.
ACP computes `notify` but still calls `await dispatcher.call(...)` and only
skips the `send`. A notification therefore performs `write`/`exec` side
effects with no response envelope — an asymmetry between the two surfaces,
and a violation of least surprise: senders that use notifications as
fire-and-forget probes get silent mutations. Lifecycle-sensitive traffic
should never be implicit.

**Fix:** Mirror the MCP behavior — return before dispatch when `notify` is
true for the tool method (or for all methods):

```ts
if (method === REALM_TOOL_METHOD) {
  if (notify) {
    log("realm acp agent ignored realm/tool notification");
    return;
  }
  ...
}
```

---

### MED-02: Budget-expiry paint races successful settle — no generation guard, last-writer-wins

**File:** `src/omp/plugin.ts:161-173` (timer arm) and `src/omp/plugin.ts:176-179`
(`settleRealmSession`)

**Issue:** The expiry callback unconditionally paints
`error/STARTUP_BUDGET_EXCEEDED`, and `settleRealmSession` unconditionally
paints the snapshot. If `create()` resolves in the same tick the timer fires
(or the host runs an already-queued timer after `clearTimer`), the error
paint can land **after** the good snapshot and stick: `lastPainted` then
holds the error pair, and with no further transition nothing corrects the
indicator even though the session is `active`. The paint direction on
expiry-vs-success is decided by scheduling luck.

**Fix:** Guard the expiry callback with a settled flag / generation counter:

```ts
let settled = false;
const timer = ctx.setTimeout(() => {
  if (settled) return;
  renderRealmStatus(...);
}, budgetMs);
void handle.controller.create(workspaceRoot).then(
  () => { settled = true; settleRealmStatus... },
  () => { settled = true; settleRealmStatus... },
);
```

---

### MED-03: `lastPainted` is cached before the writes — a throwing `setStatus` poisons the dedup cache

**File:** `src/omp/plugin.ts:118-135` (`renderRealmStatus`)

**Issue:** `lastPainted.set(ui, pair)` runs **before** the two
`ui.setStatus` calls. If the second `setStatus(REALM_DETAIL_KEY, …)` throws
(host RPC transport failure — and `setStatus` is fire-and-forget over RPC
per `docs/integration/omp.md` Q3, so delivery isn't even confirmed), the
pair is recorded as painted although the detail key was never written.
Consequences, both bad: (1) the status key and the detail key **disagree**
indefinitely — the exact invariant the review was asked to check; (2) every
future render of the same snapshot is skipped by the dedup, so the mismatch
is never self-healed. Two non-atomic writes with a pre-commit cache is the
wrong order.

**Fix:** Cache after both writes succeed:

```ts
ui.setStatus(REALM_STATUS_KEY, label);
ui.setStatus(REALM_DETAIL_KEY, detail);
lastPainted.set(ui, pair);
```

A single failure then leaves the cache stale (repaints on next transition),
which is the safe direction. If the host reads the two keys non-atomically
between the writes, a transient mismatch is still possible — note it as an
accepted host limitation, since no batch `setStatus` API was found.

---

### MED-04: Policy file is loaded twice on startup — TOCTOU between timer budget and enforcement budget

**File:** `src/omp/plugin.ts:151` and `src/realm/compose.ts:41`

**Issue:** `startRealmSession` loads the policy once for `startupBudgetMs`
(timer arm) and `createRealmHandle` loads it again for the run. An edit to
the policy file between the two loads (or a file that changes under a
network mount) arms the timer with one budget while enforcement uses
another — and a policy that becomes unreadable between the loads throws out
of `createRealmHandle` after the timer is already armed. The plugin comment
acknowledges the double load ("the plugin loads it once for the timer arm
and the factory loads it again") but treats identical content as given.

**Fix:** Load once and thread the value through. `createRealmHandle` already
returns only `{ controller, dispatcher, close }`; read
`startupBudgetMs` off the loaded policy via an accessor, or restructure so
`startRealmSession` loads the policy and passes it in:

```ts
const policy = loadPolicyFile(options.policyPath); // once
const budgetMs = policy.startupBudgetMs;
const handle = createRealmHandle({ ...options, policy }); // accept a pre-loaded policy
```

---

### LOW-01: `guardHostToolCall` does no runtime type check on `toolName` at the host boundary

**File:** `src/omp/plugin.ts:58-60` (`HostToolCall`), `src/omp/plugin.ts:193-196`

**Issue:** `toolName` arrives from the host (untrusted boundary) but is only
TypeScript-typed as `string`. A non-string value (`undefined`, an object)
makes `GUARDED_HOST_TOOLS.includes(toolName)` return `false`, so the guard
returns `undefined` (allow) for a call it could not even classify. In
practice the host always sends a string, and unknown-string tools are
deliberately allowed (only `write`/`edit` are realm mutations per D-03), so
the blast radius is small — but a fail-closed guard should refuse what it
cannot parse rather than wave it through.

**Fix:**

```ts
export function guardHostToolCall(toolName: unknown, session: ActiveSession | null): HostToolVerdict | undefined {
  if (typeof toolName !== "string" || !GUARDED_HOST_TOOLS.includes(toolName)) {
    return typeof toolName === "string" ? undefined : { block: true, reason: "realm bad tool call" };
  }
  ...
}
```

At minimum, narrow the parameter to `unknown` so future callers cannot pass
an unvalidated string without noticing.

---

### LOW-02: ACP coerces non-standard ids to `null`, mismatching the request id

**File:** `src/acp/agent.ts:53-56` (`usableId`)

**Issue:** An id of boolean/object type (invalid per JSON-RPC but parseable
JSON) is not `string | number`, so the reply carries `id: null` while the
request carried something else. The client cannot correlate the error. MCP
handles this correctly (no reply when the id is unusable). Harmless in
practice — spec-compliant clients never send such ids — but the ACP surface
should match MCP: treat an unusable id as unanswerable (log only, no `send`).

**Fix:** Return a sentinel for unusable ids and skip `send` in that case,
mirroring `src/mcp/server.ts` `handleLine`'s diagnostics-only path.

---

### LOW-03: `input.setEncoding("utf8")` mutates the caller's stream; startup log line goes through the injectable `log`

**File:** `src/acp/agent.ts:160-167` (`runAcpAgent`)

**Issue:** Two minor boundary issues: (1) `setEncoding` permanently changes
the passed-in `Readable`'s mode as a side effect — a caller sharing the
stream gets object-mode/buffer expectations broken. (2) The "listening" and
"stdin closed" lifecycle lines go through the injectable `log`, so a test or
embedder that routes `log` to `output` would contaminate stdout with
non-protocol bytes, breaking the "stdout carries only ACP messages"
invariant the module header promises. The default (`process.stderr`) is
correct; the option makes it violable.

**Fix:** (1) Avoid `setEncoding`; decode chunks with `Buffer`/`TextDecoder`
locally. (2) Document on `AcpAgentOptions.log` that it MUST NOT write to
`output` — "diagnostics sink; writing here to `output` breaks the stdout
protocol invariant" — and/or route the two lifecycle lines unconditionally
to `process.stderr`.

---

### LOW-04: Timer callback trusts `options.clock()` unconditionally

**File:** `src/omp/plugin.ts:165-169`

**Issue:** The budget-expiry callback calls `options.clock().toISOString()`.
`clock` is a host-supplied adapter: if it throws, or returns an invalid
`Date` (`toISOString` throws `RangeError`), the exception escapes into the
host timer context and the `STARTUP_BUDGET_EXCEEDED` paint never happens —
the indicator silently keeps showing "connecting" forever. Same class of
issue as HI-02 but confined to the expiry path.

**Fix:** Fall back to wall-clock on failure:

```ts
const now = (() => { try { return options.clock().toISOString(); } catch { return new Date().toISOString(); } })();
```

---

## Verified without finding (focus areas, for the record)

- **tool_call fail-closed behaviour:** For the watched tools (`write`,
  `edit`), every path out of `guardHostToolCall` when the realm is not
  usable is a `block: true` verdict (`session === null`, gate `refused`).
  Exceptions escaping the handler (throwing `mutationGate`, throwing
  `notify`) propagate to the host, which fails closed on handler error or
  `toolCallTimeoutMs` expiry — verified on the official hooks page and the
  upstream extension-loading doc per `docs/integration/omp.md` Q2/Q4, and
  the error direction is fail-closed in both cases (an advisory allow that
  throws on `notify` becomes a block — safe direction). Residual,
  explicitly documented in-code (OQ-P5-02): host paths that bypass the
  extension pipeline (launch-time tool flags, SDK sessions) are not covered
  by this guard. Upstream dependency, not a code defect.
- **MCP stdout purity:** `writeReply` is the sole writer to `output`
  (single newline-terminated JSON object; `JSON.stringify` never emits a raw
  newline); malformed/invalid lines produce fixed-text diagnostics only, so
  no credential echo; notifications never dispatch (no silent side effects).
- **MCP/ACP input validation:** `tools/call` requires string `name` in the
  tool set and a record `arguments`; unknown methods rejected before
  dispatch; batches rejected (ACP) / unparseable as single messages (MCP);
  dispatcher re-validates every `ToolCall` against the frozen schema, so
  surface/description drift fails closed. `package.json` `omp.extensions`
  (`./dist/src/omp/plugin.js`) matches `tsconfig.json` (`rootDir: "."`,
  `outDir: "dist"`).
- **Status label source:** `renderRealmStatus` derives both keys from the
  single `displayStatus` mapping (`src/core/status.ts`), so the label can
  never present two competing values from one render; degraded keeps the
  active label plus flag. The remaining disagreement risk is the
  non-atomic two-write sequence covered in MED-03.
- **Known limitations correctly stated, not hidden:** OMP-03 tooltip
  deviation (second status item), `ctx.ui.setStatus` upstream-sourced
  (OQ-P5-01), tool_call-only enforcement (OQ-P5-02), no live-session/MCP/ACP
  driver, and the `workspaceRoots`/`POLICY_DENIED` deployment requirement
  (D-22) are all disclosed in code comments and docs.

## Info / non-findings deliberately not raised

- `TOOL_INPUT_SCHEMAS` duplicates the frozen `tools.schema.json` $defs; drift
  fails closed at the dispatcher, so this is documentation risk only.
- Infinite-vocabulary notes (host tool-name case sensitivity, e.g. `Write`
  vs `write`) were not raised: the built-in names `write`/`edit` match the
  investigated host surface, and exact-match is the documented contract.
- Performance characteristics are out of scope for this review.

---

_Reviewed: 2026-10-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
