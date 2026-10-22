// Omp extension wiring (Phase 5, P5-D4 to P5-D6, P5-D8, P5-D14).
//
// The plugin composes, never constructs: the only runtime objects built here
// are the RealmHandle from src/realm/compose.ts (which owns the controller
// and the dispatcher) and the UI renders from src/core/status.ts. No adapter
// (execution, bridge, clock, runner) is constructed here; every adapter
// arrives through RealmPluginOptions and is forwarded untouched.
//
// Verified host surface (docs/integration/omp.md, Phase 5 verification pass,
// read 2026-10-22). Only these names are used:
//   - pi.on(event, handler) with the session_start, session_shutdown, and tool_call names.
//     session_shutdown tears down the captured session: it unsubscribes the event bus, destroys
//     the realm container (controller.destroy), and closes the handle.
//   - The tool_call return { block?, reason? } with first-block-wins dispatch
//     and fail-closed timeouts.
//   - ctx.ui.setStatus(key, text) per-key storage, plus ctx.ui.notify for the
//     advisory warning. The exact setStatus key-plus-text signature was found
//     only upstream (OQ-P5-01): it stays upstream-sourced.
//   - Managed timers ctx.setTimeout() / ctx.clearTimer(), cleared on session
//     shutdown by the host.
//   - pi.registerCommand(name, { description, handler }) for the retry command.
// No status endpoint, tooltip, or setActiveTools enforcement is used: no
// status endpoint was found on any source read (not documented), and neither
// setActiveTools removal nor a tool_call block is documented to cover every
// host execution path (OQ-P5-01, OQ-P5-02).
//
// Deviations recorded here (see SUMMARY for rationale):
//   - P5-D5: reason and last-transition time are written to a second setStatus
//     item (REALM_DETAIL_KEY), not a tooltip: no tooltip surface was verified.
//   - Required mode is the fail-closed policy mode (advisory is the default);
//     the guard reads the controller mutation gate, so it mirrors
//     decideMutation without redefining it.
//   - The startup budget is read from the same policy value the run enforces: the plugin
//     loads the policy once and passes that value to createRealmHandle (MED-04).

import { RealmError } from "../core/errors.js";
import { loadPolicyFile } from "../core/policy.js";
import type { StateSnapshot } from "../core/state-machine.js";
import { STATUS_LABELS, displayStatus } from "../core/status.js";
import { createRealmHandle, type CreateRealmHandleOptions, type RealmHandle } from "../realm/compose.js";
import { loadRuntimeConfig } from "../runtime/config.js";

// ---- Verified host surface (minimal structural reads) ----------------------
// Each interface names only members the plugin calls. A richer host object is
// assignable; the plugin never reads past these members.

export interface OmpStatusUi {
  setStatus(key: string, text: string): void;
  notify(message: string): void;
}

export interface OmpSessionContext {
  readonly ui: OmpStatusUi;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface HostToolCall {
  // The host boundary is untrusted; the guard checks the type at runtime (LOW-01).
  readonly toolName: unknown;
}

export interface HostToolVerdict {
  readonly block?: boolean;
  readonly reason?: string;
}

export interface RealmRetryCommand {
  readonly description: string;
  handler: () => Promise<string>;
}

export interface OmpExtensionApi {
  on(event: "session_start", handler: (ctx: OmpSessionContext) => void): void;
  on(event: "session_shutdown", handler: () => void): void;
  on(event: "tool_call", handler: (call: HostToolCall) => HostToolVerdict | undefined): void;
  registerCommand(name: string, definition: RealmRetryCommand): void;
}

// ---- Plugin options and session --------------------------------------------

// Runtime input, policy path, and adapters. The workspace root is read from the
// validated runtime input, the same value the dispatcher binds (see startRealmSession).
export type RealmPluginOptions = CreateRealmHandleOptions;

export interface ActiveSession {
  readonly handle: RealmHandle;
  readonly ui: OmpStatusUi;
  // Removes the event-bus subscription installed at start (HI-01).
  readonly unsubscribe: () => void;
}

// The single status key (P5-D5). Every render targets this key plus the detail
// key below, so the indicator can never present two competing labels.
export const REALM_STATUS_KEY = "realm";
export const REALM_DETAIL_KEY = "realm.detail";
export const REALM_RETRY_COMMAND = "realm-retry";

// Host tools the tool_call guard inspects. read, list, status, and retry pass
// untouched; anything else is not a realm mutation and is left alone.
export const GUARDED_HOST_TOOLS: readonly string[] = Object.freeze(["write", "edit"]);

// ---- Status rendering (OMP-02, OMP-03; P5-D5) -------------------------------
// One shared label from displayStatus, the only label source. The leading
// marker (● active family, ○ disconnected family) and the [degraded] flag are
// text, so the state stays readable without colour. Degraded keeps the active
// label with its flag; it is never a third label.
//
// Each real transition paints once. The event bus renders a transition and the
// create settle renders the snapshot again, so the last painted pair is kept per
// indicator and a render equal to it is skipped (OMP-03). A changed detail, such
// as ANDA_UNREACHABLE followed by anda reachable, always paints.

const lastPainted = new WeakMap<OmpStatusUi, string>();

export function renderRealmStatus(ui: OmpStatusUi, snapshot: StateSnapshot): void {
  const display = displayStatus(snapshot);
  const marker = display.label === STATUS_LABELS.active ? "●" : "○";
  const flag = display.degraded ? " [degraded]" : "";
  const label = `${marker} ${display.label}${flag}`;
  const detail = `${display.reason} · ${display.lastTransitionAt}`;
  const pair = JSON.stringify([label, detail]);
  if (lastPainted.get(ui) === pair) {
    return;
  }
  // Cached only after both writes succeed: a throw above leaves the cache stale, so the
  // next render repaints both keys instead of skipping them (MED-03).
  ui.setStatus(REALM_STATUS_KEY, label);
  ui.setStatus(REALM_DETAIL_KEY, detail);
  lastPainted.set(ui, pair);
}

// ---- Registration -----------------------------------------------------------

export function registerRealmPlugin(pi: OmpExtensionApi, options: RealmPluginOptions): void {
  let session: ActiveSession | null = null;

  // Ends the captured session as a teardown (spec OPERATION teardown). The event bus is
  // unsubscribed first, so nothing paints after shutdown. controller.destroy then stops and
  // removes the session container, and handle.close releases the handle. Neither call is
  // awaited; the host's shutdown budget does not wait on container teardown.
  const endSession = (): void => {
    const ended = session;
    session = null;
    if (ended !== null) {
      ended.unsubscribe();
      void ended.handle.controller
        .destroy()
        .catch(() => undefined)
        .then(() => ended.handle.close())
        .catch(() => undefined);
    }
  };

  pi.on("session_start", (ctx) => {
    // A second start replaces the first, so the previous container is ended, not orphaned.
    endSession();
    session = startRealmSession(ctx, options);
  });

  pi.on("session_shutdown", () => {
    endSession();
  });

  pi.on("tool_call", (call) => guardHostToolCall(call.toolName, session));

  pi.registerCommand(REALM_RETRY_COMMAND, {
    description: "Retry the realm startup through the shared tool dispatcher.",
    handler: () => retryRealm(session),
  });
}

// Detached autostart under the startup budget (OMP-01; P5-D8). The session
// start handler returns without awaiting: create runs on, the budget timer is
// armed from policy.startupBudgetMs, and expiry renders the disconnected
// display with STARTUP_BUDGET_EXCEEDED while the session continues (nothing
// is thrown at the host). Settle clears the timer and renders the snapshot.
// A synchronous startup failure (policy, runtime input, workspace) paints the
// disconnected display with its catalogue code and returns null (HI-02).

function startRealmSession(ctx: OmpSessionContext, options: RealmPluginOptions): ActiveSession | null {
  let handle: RealmHandle;
  let budgetMs: number;
  let workspaceRoot: string;
  try {
    // One policy read (MED-04): the same parsed value arms the timer and is enforced by the run.
    const policy = loadPolicyFile(options.policyPath);
    budgetMs = policy.startupBudgetMs;
    // The workspace root comes from the validated runtime input, the same value the dispatcher binds.
    workspaceRoot = loadRuntimeConfig(options.runtimeInput).workspaceRoot;
    handle = createRealmHandle({ ...options, policy });
  } catch (error: unknown) {
    renderRealmStatus(ctx.ui, {
      state: "error",
      // A catalogue code when the failure carries one; otherwise the fallback create applies.
      reason: error instanceof RealmError ? error.code : "OPENSHELL_START_FAILED",
      lastTransitionAt: nowIso(options.clock),
    });
    return null;
  }
  renderRealmStatus(ctx.ui, handle.controller.snapshot());
  const unsubscribe = handle.controller.events.subscribe(() => {
    renderRealmStatus(ctx.ui, handle.controller.snapshot());
  });
  const session: ActiveSession = { handle, ui: ctx.ui, unsubscribe };
  // settled guards the expiry paint (MED-02): a timer that fires after create has settled
  // must not overwrite the snapshot with STARTUP_BUDGET_EXCEEDED.
  let settled = false;
  const timer = ctx.setTimeout(() => {
    if (settled) {
      return;
    }
    renderRealmStatus(ctx.ui, {
      state: "error",
      // Existing catalogue code (STARTUP_BUDGET_EXCEEDED); no new code added.
      reason: "STARTUP_BUDGET_EXCEEDED",
      lastTransitionAt: nowIso(options.clock),
    });
  }, budgetMs);
  void handle.controller.create(workspaceRoot).then(
    () => {
      settled = true;
      settleRealmSession(ctx, session, timer);
    },
    () => {
      settled = true;
      settleRealmSession(ctx, session, timer);
    },
  );
  return session;
}

function settleRealmSession(ctx: OmpSessionContext, session: ActiveSession, timer: unknown): void {
  ctx.clearTimer(timer);
  renderRealmStatus(session.ui, session.handle.controller.snapshot());
}

// The clock is a host adapter. A throwing or invalid clock falls back to wall time so the
// expiry and startup-failure paints always land (LOW-04).
function nowIso(clock: () => Date): string {
  try {
    return clock().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

// ---- tool_call guard (OMP-05; P5-D6) ----------------------------------------
// Residual risk (OQ-P5-02): the block holds inside the extension pipeline —
// the tool_call hook returns { block: true } and the host fails closed on
// error or timeout, which the tests prove by asserting the block verdict.
// Any host path that bypasses the extension pipeline (launch-time tool flags,
// SDK sessions, or a host that ignores the hook) is NOT covered by this
// guard and must not be claimed as covered. Required mode means the
// fail-closed policy mode; advisory mode warns and lets the call through.
// The guard mirrors decideMutation through the controller mutation gate and
// adds no decision logic of its own.

export function guardHostToolCall(toolName: unknown, session: ActiveSession | null): HostToolVerdict | undefined {
  if (typeof toolName !== "string") {
    // A call the guard cannot classify is refused, never waved through (LOW-01).
    return { block: true, reason: "realm bad tool call" };
  }
  if (!GUARDED_HOST_TOOLS.includes(toolName)) {
    return undefined;
  }
  if (session === null) {
    return { block: true, reason: "realm not started" };
  }
  const gate = session.handle.controller.mutationGate();
  if (gate.outcome === "refused") {
    return { block: true, reason: gate.code };
  }
  if (gate.outcome === "proceed-with-warning") {
    session.ui.notify(gate.warning);
  }
  return undefined;
}

// ---- Retry command (OMP-04; P5-D14) -----------------------------------------
// Dispatcher-owned retry: the command calls ToolDispatcher.call with retry
// and nothing else, then re-renders. No state logic lives here.

function retryRealm(session: ActiveSession | null): Promise<string> {
  if (session === null) {
    return Promise.resolve("realm not started");
  }
  return session.handle.dispatcher
    .call({ retry: {} })
    .then((outcome) => {
      renderRealmStatus(session.ui, session.handle.controller.snapshot());
      if (outcome.outcome === "refused") {
        return `realm retry refused: ${outcome.code}`;
      }
      if (outcome.tool !== "retry") {
        throw new Error(`realm retry resolved with unexpected tool: ${outcome.tool}`);
      }
      return `realm retry: ${outcome.value.state} (${outcome.value.reason})`;
    });
}
