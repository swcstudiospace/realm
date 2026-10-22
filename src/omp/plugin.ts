// Omp extension wiring (Phase 5, P5-D4 to P5-D6, P5-D8, P5-D14; daemon attach).
//
// The plugin composes, never constructs. It holds no lifecycle, policy, or runtime object: the
// daemon owns the sandbox, the policy, and the session, and this host attaches to it through the
// DaemonClient that RealmPluginOptions.attachDaemon resolves. src/omp/extension.ts is the edge that
// builds that client and the only module in the Omp wiring that reads the environment.
//
// Verified host surface (docs/integration/omp.md, Phase 5 verification pass). Only these names are used:
//   - pi.on(event, handler) with the session_start, session_shutdown, and tool_call names.
//   - The tool_call return { block?, reason? }. The handler returns a Promise; the host fails
//     closed on error or timeout (toolCallTimeoutMs, upstream-sourced).
//   - ctx.cwd: the session working directory, bound as the workspace root at attach.
//   - ctx.ui.setStatus(key, text) per-key storage, plus ctx.ui.notify for the advisory warning.
//     The exact setStatus key-plus-text signature was found only upstream (OQ-P5-01).
//   - Managed timers ctx.setTimeout() / ctx.clearTimer().
//   - pi.registerCommand(name, { description, handler }) for the retry command.
// No status endpoint, tooltip, or setActiveTools enforcement is used: no status endpoint was found
// on any source read (not documented), and neither setActiveTools removal nor a tool_call block is
// documented to cover every host execution path (OQ-P5-01, OQ-P5-02).
//
// Deviations recorded here:
//   - P5-D5: reason and last-transition time are written to a second setStatus item (REALM_DETAIL_KEY),
//     not a tooltip: no tooltip surface was verified.
//   - Required mode is the fail-closed policy mode (advisory is the default). The mode is the policy
//     mode the daemon reports in its status value; the plugin reads no policy file.
//   - The startup budget is STARTUP_BUDGET_MS. The policy is daemon-owned, so the plugin cannot read
//     policy.startupBudgetMs; the constant mirrors the policy schema default.
//   - No push channel carries transitions. The indicator repaints on attach, on retry, and on every
//     guarded call, which reads the daemon status.

import { makeRealmError, RealmError } from "../core/errors.js";
import type { MutationDenyCode } from "../core/policy.js";
import type { DaemonClient, DaemonStatus } from "../daemon/client.js";
import type { PolicyMode } from "../contract/validate.js";
import type { StateSnapshot } from "../core/state-machine.js";
import { STATUS_LABELS, displayStatus } from "../core/status.js";

// ---- Verified host surface (minimal structural reads) ----------------------
// Each interface names only members the plugin calls. A richer host object is
// assignable; the plugin never reads past these members.

export interface OmpStatusUi {
  setStatus(key: string, text: string): void;
  notify(message: string): void;
}

export interface OmpSessionContext {
  readonly cwd: string;
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
  on(event: "tool_call", handler: (call: HostToolCall) => Promise<HostToolVerdict | undefined>): void;
  registerCommand(name: string, definition: RealmRetryCommand): void;
}

// ---- Daemon status and plugin options --------------------------------------

export interface RealmPluginOptions {
  // Resolves the daemon client bound to workspaceRoot: ensures a daemon answers, connects, and runs
  // the idempotent up. Rejects with a RealmError when the attach fails.
  readonly attachDaemon: (workspaceRoot: string) => Promise<DaemonClient>;
}

export interface ActiveSession {
  readonly ctx: OmpSessionContext;
  // Live client, or null while the host is disconnected.
  client: DaemonClient | null;
  // Policy mode from the last status the daemon reported; null until one arrives.
  mode: PolicyMode | null;
}

// Startup budget for attach plus its first status read. The daemon owns the policy, so this mirrors
// the policy schema default for startupBudgetMs.
export const STARTUP_BUDGET_MS = 10_000;

// Bound on one guarded status read. It sits well inside the host's tool_call budget, so a hung
// daemon yields a verdict instead of a host timeout.
export const GUARD_STATUS_BUDGET_MS = 5_000;

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
// Each real transition paints once. Attach, retry, and every guarded status read render the
// snapshot, so the last painted pair is kept per indicator and a render equal to it is skipped
// (OMP-03). A changed detail, such as ANDA_UNREACHABLE followed by anda reachable, always paints.

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

type AttachOutcome =
  | { readonly outcome: "attached"; readonly snapshot: StateSnapshot }
  | { readonly outcome: "failed"; readonly code: string }
  | { readonly outcome: "superseded" };

export function registerRealmPlugin(pi: OmpExtensionApi, options: RealmPluginOptions): void {
  // The live session, or null after shutdown. A settle compares against it: an attach that ends
  // after shutdown, or after a newer attach started, releases its client and paints nothing.
  let live: ActiveSession | null = null;
  let attempt = 0;

  // Ends the captured session. The client is closed, never taken down: the daemon keeps the
  // sandbox, and a host shutdown is only a detach of this host.
  const endSession = (): void => {
    const ended = live;
    live = null;
    if (ended !== null && ended.client !== null) {
      ended.client.close();
      ended.client = null;
    }
  };

  // Runs the attach path for a session: ensure, connect, and read status under one budget.
  // The retry command calls this same path. Never rejects; every failure becomes an outcome.
  const attach = async (session: ActiveSession): Promise<AttachOutcome> => {
    attempt += 1;
    const mine = attempt;
    const isCurrent = (): boolean => live === session && attempt === mine;
    session.client?.close();
    session.client = null;
    const { ctx } = session;
    renderRealmStatus(ctx.ui, { state: "connecting", reason: "connecting", lastTransitionAt: nowIso() });

    let rejectBudget: (reason: unknown) => void = () => undefined;
    const budget = new Promise<never>((_resolve, reject) => {
      rejectBudget = reject;
    });
    const timer = ctx.setTimeout(() => {
      rejectBudget(makeRealmError("STARTUP_BUDGET_EXCEEDED"));
    }, STARTUP_BUDGET_MS);
    // The attach and its first status read share one budget; a client is adopted only with its status.
    const pending = Promise.resolve()
      .then(() => options.attachDaemon(ctx.cwd))
      .then(async (client) => ({ client, status: await client.status() }));

    let attached: { readonly client: DaemonClient; readonly status: DaemonStatus } | null = null;
    let code = "OPENSHELL_START_FAILED";
    try {
      attached = await Promise.race([pending, budget]);
    } catch (error: unknown) {
      code = error instanceof RealmError ? error.code : "OPENSHELL_START_FAILED";
    }
    ctx.clearTimer(timer);

    if (!isCurrent()) {
      // Ended or superseded: release whatever this attempt produces, late or not.
      void pending.then(({ client }) => client.close(), () => undefined);
      return { outcome: "superseded" };
    }
    if (attached === null) {
      // The budget or the attach failed. A client that lands later is released, never adopted.
      void pending.then(({ client }) => client.close(), () => undefined);
      renderRealmStatus(ctx.ui, { state: "error", reason: code, lastTransitionAt: nowIso() });
      return { outcome: "failed", code };
    }
    session.client = attached.client;
    session.mode = attached.status.mode;
    renderRealmStatus(ctx.ui, attached.status.snapshot);
    return { outcome: "attached", snapshot: attached.status.snapshot };
  };

  // Dispatcher-owned retry: the command re-runs the attach path and reports its outcome.
  const retryRealm = async (): Promise<string> => {
    const session = live;
    if (session === null) {
      return "realm not started";
    }
    const outcome = await attach(session);
    if (outcome.outcome === "attached") {
      return `realm retry: ${outcome.snapshot.state} (${outcome.snapshot.reason})`;
    }
    if (outcome.outcome === "failed") {
      return `realm retry refused: ${outcome.code}`;
    }
    return "realm retry superseded";
  };

  pi.on("session_start", (ctx) => {
    // A second start replaces the first, so the previous client is closed, not orphaned.
    endSession();
    const session: ActiveSession = { ctx, client: null, mode: null };
    live = session;
    // Detached: the handler returns while the attach runs, and the outcome paints itself.
    void attach(session);
  });

  pi.on("session_shutdown", () => {
    endSession();
  });

  pi.on("tool_call", (call) => guardHostToolCall(call.toolName, live));

  pi.registerCommand(REALM_RETRY_COMMAND, {
    description: "Retry the realm startup through the daemon attach path.",
    handler: retryRealm,
  });
}

// The clock is wall time: the snapshot carries the daemon's own transition instants, and only the
// connecting and failure paints, which have no daemon snapshot, stamp the host time.
function nowIso(): string {
  return new Date().toISOString();
}

// ---- tool_call guard (OMP-05; P5-D6) ----------------------------------------
// Residual risk (OQ-P5-02): the block holds inside the extension pipeline. The tool_call hook
// returns { block: true } and the host fails closed on error or timeout. Any host path that
// bypasses the extension pipeline (launch-time tool flags, SDK sessions, or a host that ignores the
// hook) is NOT covered by this guard and must not be claimed as covered. Required mode is the
// fail-closed policy mode; advisory mode warns and lets the call through.
//
// The state comes from a daemon status read bounded by GUARD_STATUS_BUDGET_MS. stateVerdict
// mirrors decideMutation (src/core/policy.ts) and the gate outcomes of src/lifecycle/mutation-gate.ts;
// the mirror adds no rule of its own. The daemon reports the mode as 'advisory' or 'fail-closed'; fail-closed is
// the required branch. When the state cannot be read, the last known mode decides: advisory warns; fail-closed,
// or no mode yet, blocks.

export async function guardHostToolCall(
  toolName: unknown,
  session: ActiveSession | null,
): Promise<HostToolVerdict | undefined> {
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
  let status: DaemonStatus;
  try {
    status = await readStatus(session);
  } catch (error: unknown) {
    return unreadableVerdict(session, error);
  }
  session.mode = status.mode;
  renderRealmStatus(session.ctx.ui, status.snapshot);
  return stateVerdict(session, status.mode, status.snapshot.state);
}

// One status read under a managed timer. The timer expiry rejects with TOOL_TIMEOUT, so a hung
// daemon can never hold the host's tool call.
function readStatus(session: ActiveSession): Promise<DaemonStatus> {
  const client = session.client;
  if (client === null) {
    return Promise.reject(makeRealmError("REALM_NOT_ACTIVE"));
  }
  const { ctx } = session;
  return new Promise<DaemonStatus>((resolve, reject) => {
    const timer = ctx.setTimeout(() => {
      reject(makeRealmError("TOOL_TIMEOUT"));
    }, GUARD_STATUS_BUDGET_MS);
    Promise.resolve()
      .then(() => client.status())
      .then(
        (value) => {
          ctx.clearTimer(timer);
          resolve(value);
        },
        (error: unknown) => {
          ctx.clearTimer(timer);
          reject(error);
        },
      );
  });
}

function unreadableVerdict(session: ActiveSession, error: unknown): HostToolVerdict | undefined {
  const code = error instanceof RealmError ? error.code : "REALM_NOT_ACTIVE";
  if (session.mode === "advisory") {
    session.ctx.ui.notify(`realm status unavailable (${code}); the write proceeds under advisory policy`);
    return undefined;
  }
  return { block: true, reason: code };
}

function stateVerdict(
  session: ActiveSession,
  mode: PolicyMode,
  state: StateSnapshot["state"],
): HostToolVerdict | undefined {
  if (state === "active") {
    return undefined;
  }
  if (mode === "advisory") {
    session.ctx.ui.notify(`realm is ${state}; the write proceeds under advisory policy`);
    return undefined;
  }
  return { block: true, reason: denyCodeFor(state) };
}

function denyCodeFor(state: Exclude<StateSnapshot["state"], "active">): MutationDenyCode {
  switch (state) {
    case "unbound":
      return "REALM_UNBOUND";
    case "stopping":
      return "REALM_STOPPING";
    case "connecting":
    case "degraded":
    case "error":
      return "REALM_NOT_ACTIVE";
  }
}
