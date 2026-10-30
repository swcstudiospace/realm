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
//   - Managed timers ctx.setTimeout() / ctx.setInterval() / ctx.clearTimer(). The host clears its
//     managed callbacks on session shutdown; the plugin also clears every timer it armed there.
//   - pi.registerCommand(name, { description, handler }) for the retry command.
//   - pi.registerTool(definition) for the five Realm tools (OMPX-02). The definitions and the frozen ToolCall shape are in tools.ts.
//   - pi.getAllTools(), pi.getActiveTools() and pi.setActiveTools(names) for the fail-closed allowlist (OMPX-03; spike S2a).
// Tool removal (OMPX-03): a fail-closed attach removes every built-in outside the allowlist with setActiveTools and reads it
// back. That mechanism is the one the Enforcement spike proved on Omp 18.12.6 (docs/integration/omp.md); no tooltip surface is used.
// The tool_call guard stays as the backstop. Neither removal nor a hook is documented to cover every host path (OQ-P5-02).
//
// Deviations recorded here:
//   - P5-D5: the label, the reason, and the last-transition time share one status item
//     (REALM_STATUS_KEY). The host offers no tooltip, so the reason and time ride in that item's text.
//   - Required mode is the fail-closed policy mode (the default; advisory is an explicit opt-in). The mode is the policy
//     mode the daemon reports in its status value; the plugin reads no policy file.
//   - The startup budget is STARTUP_BUDGET_MS. The policy is daemon-owned, so the plugin cannot read
//     policy.startupBudgetMs; the constant mirrors the policy schema default.
//   - No push channel carries transitions from the daemon. While attached, the indicator repaints on
//     attach, on retry, on every guarded call, and on a bounded poll (STATUS_POLL_MS) of the daemon status.

import { makeRealmError, RealmError } from "../core/errors.js";
import type { MutationDenyCode } from "../core/policy.js";
import type { DaemonClient, DaemonStatus } from "../daemon/client.js";
import type { PolicyMode } from "../contract/validate.js";
import type { StateSnapshot } from "../core/state-machine.js";
import { STATUS_LABELS, displayStatus } from "../core/status.js";
import {
  PASS_THROUGH_HOST_TOOLS,
  failClosedToolNames,
  realmToolDefinitions,
  sameToolNames,
  type DaemonCall,
  type HostToolDefinition,
} from "./tools.js";

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
  setInterval(callback: () => void, ms: number): unknown;
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
  on(event: "session_start", handler: (_event: unknown, ctx: OmpSessionContext) => void): void;
  on(event: "session_shutdown", handler: () => void): void;
  on(event: "tool_call", handler: (call: HostToolCall) => Promise<HostToolVerdict | undefined>): void;
  registerCommand(name: string, definition: RealmRetryCommand): void;
  // Omp tools (OMPX-02). A tool registered under a built-in's name takes that built-in's place (spike S1).
  registerTool(tool: HostToolDefinition): void;
  // The names Omp reports, and the allowlist setter used by fail-closed removal (OMPX-03; spike S2a).
  getAllTools(): readonly { readonly name: string }[];
  getActiveTools(): readonly string[];
  setActiveTools(names: string[]): Promise<void>;
}

// ---- Daemon status and plugin options --------------------------------------

export interface RealmPluginOptions {
  // Resolves the daemon client bound to workspaceRoot: ensures a daemon answers, connects, and runs
  // the idempotent up. Rejects with a RealmError when the attach fails.
  readonly attachDaemon: (workspaceRoot: string) => Promise<DaemonClient>;
}

export interface ActiveSession {
  readonly ctx: OmpSessionContext;
  // The host tool set this plugin shares across sessions (see HostToolSet).
  readonly tools: HostToolSet;
  // Live client, or null while the host is disconnected.
  client: DaemonClient | null;
  // Policy mode from the last status the daemon reported; null until one arrives.
  mode: PolicyMode | null;
  // Managed timers armed and not yet cleared, each with the action that ends its wait at shutdown.
  // Shutdown clears every handle and runs its action, so no timer outlives the session.
  readonly timers: Map<unknown, () => void>;
  // The repaint poll, or null when none is armed.
  poll: { readonly handle: unknown } | null;
  // True while a repaint poll read is in flight, so a slow daemon never stacks reads.
  refreshing: boolean;
  // The error the poll last painted, with the stamp it carried. A repeat of the same error reuses the
  // stamp, so the repaint stays quiet until the transition really changes.
  errorStamp: { readonly code: string; readonly at: string } | null;
}

// Startup budget for attach plus its first status read. The daemon owns the policy, so this mirrors
// the policy schema default for startupBudgetMs.
export const STARTUP_BUDGET_MS = 200_000;

// Bound on one guarded status read. It sits well inside the host's tool_call budget, so a hung
// daemon yields a verdict instead of a host timeout.
export const GUARD_STATUS_BUDGET_MS = 5_000;

// Interval of the repaint poll while attached. With no push channel from the daemon, a transition
// reaches the indicator within this bound. Each tick is one local status read.
export const STATUS_POLL_MS = 2_000;

// The single status key (P5-D5). The label, reason, and time are one item, so the indicator can
// never present two competing labels.
export const REALM_STATUS_KEY = "realm";
export const REALM_RETRY_COMMAND = "realm-retry";

// Host tools the tool_call guard checks against the daemon status: edit, the built-in that writes outside the realm. The Realm
// write is not guarded here. It replaces the built-in write (spike S1) and reaches the daemon, whose dispatcher waits out
// connecting and runs the mutation gate, so a write is decided there rather than refused early. The pass-through names
// (PASS_THROUGH_HOST_TOOLS) pass the guard; in fail-closed mode the backstop refuses every other tool name.
export const GUARDED_HOST_TOOLS: readonly string[] = Object.freeze(["edit"]);

// ---- Status rendering (OMP-02, OMP-03; P5-D5) -------------------------------
// One shared label from displayStatus, the only label source. The leading
// marker (● active family, ○ disconnected family) and the [degraded] flag are
// text, so the state stays readable without colour. Degraded keeps the active
// label with its flag; it is never a third label. The reason and the last
// transition time follow the label in the same text.
//
// Each real transition paints once. Attach, retry, every guarded status read, and every poll tick
// render the snapshot, so the last painted text is kept per indicator and a render equal to it is
// skipped (OMP-03). A changed reason or time always paints.

const lastPainted = new WeakMap<OmpStatusUi, string>();

export function renderRealmStatus(ui: OmpStatusUi, snapshot: StateSnapshot): void {
  const display = displayStatus(snapshot);
  const marker = display.label === STATUS_LABELS.active ? "●" : "○";
  const flag = display.degraded ? " [degraded]" : "";
  const text = `${marker} ${display.label}${flag} · ${display.reason} · ${display.lastTransitionAt}`;
  if (lastPainted.get(ui) === text) {
    return;
  }
  // Cached only after the write succeeds: a throw above leaves the cache stale, so the next
  // render repaints instead of skipping it (MED-03).
  ui.setStatus(REALM_STATUS_KEY, text);
  lastPainted.set(ui, text);
}

// ---- Managed timers ----------------------------------------------------------
// Every timer the plugin arms goes through these two helpers, so the session can clear them all.
// onExpiry runs when the timer fires; onEnd runs when the session ends first, so a pending wait
// settles instead of hanging after shutdown.

function armTimer(session: ActiveSession, ms: number, onExpiry: () => void, onEnd: () => void): unknown {
  const handle: unknown = session.ctx.setTimeout(() => {
    session.timers.delete(handle);
    onExpiry();
  }, ms);
  session.timers.set(handle, onEnd);
  return handle;
}

// Clears a timer whose wait has settled. A handle already fired or cleared is not in the map, so
// it is never cleared twice.
function disarmTimer(session: ActiveSession, handle: unknown): void {
  if (session.timers.delete(handle)) {
    session.ctx.clearTimer(handle);
  }
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
  // The host tool set, shared by every session of this registration.
  const hostTools: HostToolSet = { pi, mode: null, removed: [], queue: Promise.resolve() };

  // Ends the captured session. Every timer it armed is cleared and its wait settled, and the poll
  // is cleared, so the host runs no callback for an ended session. The client is closed, never taken
  // down: the daemon keeps the sandbox, and a host shutdown is only a detach of this host.
  const endSession = (): void => {
    const ended = live;
    live = null;
    if (ended === null) {
      return;
    }
    const armed = [...ended.timers];
    ended.timers.clear();
    for (const [handle, onEnd] of armed) {
      ended.ctx.clearTimer(handle);
      onEnd();
    }
    if (ended.poll !== null) {
      ended.ctx.clearTimer(ended.poll.handle);
      ended.poll = null;
    }
    if (ended.client !== null) {
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
    // Set once the budget runs out or the session ends. From then on this attempt starts no host tool change.
    let spent = false;
    const timer = armTimer(
      session,
      STARTUP_BUDGET_MS,
      () => {
        spent = true;
        rejectBudget(makeRealmError("STARTUP_BUDGET_EXCEEDED"));
      },
      () => {
        spent = true;
        rejectBudget(makeRealmError("REALM_NOT_ACTIVE"));
      },
    );
    // The attach and its first status read share one budget; a client is adopted only with its status. The host tool set
    // follows the mode that status reports, inside the same budget, and only while this attempt may still change it.
    const pending = Promise.resolve()
      .then(() => options.attachDaemon(ctx.cwd))
      .then(async (client) => {
        try {
          const status = await client.status();
          await setHostMode(session.tools, status.mode, () => isCurrent() && !spent);
          return { client, status };
        } catch (error: unknown) {
          client.close();
          throw error;
        }
      });

    let attached: { readonly client: DaemonClient; readonly status: DaemonStatus } | null = null;
    let code = "OPENSHELL_START_FAILED";
    try {
      attached = await Promise.race([pending, budget]);
    } catch (error: unknown) {
      code = error instanceof RealmError ? error.code : "OPENSHELL_START_FAILED";
    }
    disarmTimer(session, timer);

    if (!isCurrent()) {
      // Ended or superseded: release whatever this attempt produces, late or not.
      void pending.then(({ client }) => { client.close(); }, () => undefined);
      return { outcome: "superseded" };
    }
    if (attached === null) {
      // The budget or the attach failed. A client that lands later is released, never adopted.
      void pending.then(({ client }) => { client.close(); }, () => undefined);
      renderRealmStatus(ctx.ui, { state: "error", reason: code, lastTransitionAt: nowIso() });
      return { outcome: "failed", code };
    }
    session.client = attached.client;
    session.mode = attached.status.mode;
    renderRealmStatus(ctx.ui, attached.status.snapshot);
    // The daemon keeps its startup-reap notice for its lifetime; each attach shows it once.
    if (attached.status.notice !== undefined) {
      ctx.ui.notify(attached.status.notice);
    }
    return { outcome: "attached", snapshot: attached.status.snapshot };
  };

  // One repaint tick: reads the daemon status and paints any transition the tick finds. It paints
  // only for the client it read through; a client replaced or ended meanwhile paints nothing.
  const repaint = async (session: ActiveSession): Promise<void> => {
    const client = session.client;
    if (client === null || session.refreshing) {
      return;
    }
    const isCurrent = (): boolean => live === session && session.client === client;
    session.refreshing = true;
    try {
      let status: DaemonStatus;
      try {
        status = await readStatus(session);
      } catch (error: unknown) {
        if (!isCurrent()) {
          return;
        }
        const code = error instanceof RealmError ? error.code : "REALM_NOT_ACTIVE";
        const at = session.errorStamp?.code === code ? session.errorStamp.at : nowIso();
        session.errorStamp = { code, at };
        renderRealmStatus(session.ctx.ui, { state: "error", reason: code, lastTransitionAt: at });
        return;
      }
      if (!isCurrent()) {
        return;
      }
      session.mode = status.mode;
      // The poll moves the host tool set with the mode it reports, so a change does not wait for a guarded call.
      try {
        await setHostMode(session.tools, status.mode, isCurrent);
      } catch {
        if (isCurrent()) {
          const code = "POLICY_DENIED";
          const at = session.errorStamp?.code === code ? session.errorStamp.at : nowIso();
          session.errorStamp = { code, at };
          renderRealmStatus(session.ctx.ui, { state: "error", reason: code, lastTransitionAt: at });
        }
        return;
      }
      if (!isCurrent()) {
        return;
      }
      session.errorStamp = null;
      renderRealmStatus(session.ctx.ui, status.snapshot);
    } finally {
      session.refreshing = false;
    }
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

  pi.on("session_start", (_event, ctx) => {
    // A second start replaces the first, so the previous client and its timers are released, not orphaned.
    endSession();
    const session: ActiveSession = {
      ctx,
      tools: hostTools,
      client: null,
      mode: null,
      timers: new Map(),
      poll: null,
      refreshing: false,
      errorStamp: null,
    };
    live = session;
    session.poll = {
      handle: ctx.setInterval(() => {
        void repaint(session);
      }, STATUS_POLL_MS),
    };
    // Detached: the handler returns while the attach runs, and the outcome paints itself.
    void attach(session);
  });

  pi.on("session_shutdown", () => {
    endSession();
  });

  // The Realm tools (OMPX-02) register at load in every mode. Which built-ins stay callable follows the mode the daemon reports.
  const callDaemon: DaemonCall = (call) => {
    const client = live?.client ?? null;
    if (client === null) {
      return Promise.reject(makeRealmError("REALM_NOT_ACTIVE"));
    }
    return client.call(call);
  };
  for (const tool of realmToolDefinitions(callDaemon)) {
    pi.registerTool(tool);
  }

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

// ---- tool_call guard (OMP-05; P5-D6; OMPX-03 backstop) ----------------------
// Residual risk (OQ-P5-02): the block holds inside the extension pipeline. The tool_call hook
// returns { block: true } and the host fails closed on error or timeout. Any host path that
// bypasses the extension pipeline (launch-time tool flags, SDK sessions, or a host that ignores the
// hook) is NOT covered by this guard and must not be claimed as covered. Required mode is the
// fail-closed policy mode (the default); advisory mode, set explicitly in the policy file, warns and lets the call through.
//
// The Realm tools pass the guard. write, read, list, exec and status reach the daemon, whose own dispatcher waits out
// connecting and runs the mutation gate, so a write is decided there and is not refused early here.
//
// Edit is the mutation check. It reads the daemon status: the state decides, and the mode decides a non-active state
// (advisory warns, fail-closed blocks). It mirrors decideMutation (src/core/policy.ts) and the gate outcomes of
// src/lifecycle/mutation-gate.ts; the mirror adds no rule of its own. Every other host tool reads the status too and is
// decided by the mode it reports: fail-closed refuses it, advisory passes it. The backstop (OMPX-03) refuses every other
// tool name in fail-closed mode and while no mode is known, with the catalogue code POLICY_DENIED. Removal of the built-ins
// is the primary control: a removed tool is refused by Omp before this hook runs, so the backstop answers the calls that
// do reach it, such as a tool another extension registers.
//
// The state comes from a daemon status read bounded by GUARD_STATUS_BUDGET_MS. When edit's state cannot be read, the last
// known mode decides: advisory (explicit opt-in) warns; fail-closed, or no mode yet, blocks. Any other host tool whose status
// cannot be read is refused, because its mode is unconfirmed.

export async function guardHostToolCall(
  toolName: unknown,
  session: ActiveSession | null,
): Promise<HostToolVerdict | undefined> {
  if (typeof toolName !== "string") {
    // A call the guard cannot classify is refused, never waved through (LOW-01).
    return { block: true, reason: "realm bad tool call" };
  }
  const guarded = GUARDED_HOST_TOOLS.includes(toolName);
  const passThrough = PASS_THROUGH_HOST_TOOLS.includes(toolName);
  if (session === null) {
    if (guarded) {
      return { block: true, reason: "realm not started" };
    }
    return passThrough ? undefined : { block: true, reason: "POLICY_DENIED" };
  }
  if (passThrough) {
    return undefined;
  }
  // Any other host tool is decided by the mode the daemon reports now, so the status is read here, not taken from an earlier read.
  const client = session.client;
  // The session can move to another client while this guard awaits (a retry, a reattach or a shutdown). Any verdict built on
  // the earlier client is stale, so a moved session refuses the call with REALM_NOT_ACTIVE instead.
  const moved = (): boolean => session.client !== client;
  let status: DaemonStatus;
  try {
    status = await readStatus(session);
  } catch (error: unknown) {
    if (moved()) {
      return { block: true, reason: "REALM_NOT_ACTIVE" };
    }
    return guarded ? unreadableVerdict(session, error) : { block: true, reason: "POLICY_DENIED" };
  }
  if (moved()) {
    return { block: true, reason: "REALM_NOT_ACTIVE" };
  }
  session.mode = status.mode;
  renderRealmStatus(session.ctx.ui, status.snapshot);
  try {
    await setHostMode(session.tools, status.mode, () => session.client === client);
  } catch {
    return { block: true, reason: "POLICY_DENIED" };
  }
  // setHostMode resolves without a change when its turn comes after the session moved, so the check runs again here.
  if (moved()) {
    return { block: true, reason: "REALM_NOT_ACTIVE" };
  }
  if (guarded) {
    const verdict = stateVerdict(session, status.mode, status.snapshot.state);
    if (verdict !== undefined) {
      return verdict;
    }
  }
  // Fail-closed refuses a tool outside the allowlist, edit included, even with an active realm. Advisory passes it.
  return status.mode === "advisory" ? undefined : { block: true, reason: "POLICY_DENIED" };
}

// The host's tool set as this plugin left it (OMPX-03, OMPX-04). Omp keeps every removal for the life of the process, so one
// set serves every session of the registration: a new session, a retry or a restarted daemon starts from what was last applied.
export interface HostToolSet {
  readonly pi: OmpExtensionApi;
  // The mode the tool set reflects; null until one has been applied.
  mode: PolicyMode | null;
  // Built-ins this plugin removed and has not put back. An advisory change restores them.
  removed: string[];
  // Changes run one at a time, so a setter already in flight finishes before the next one starts.
  queue: Promise<void>;
}

// Brings the host tool set to mode. A change starts only if isCurrent still holds when its turn in the queue comes, so a
// superseded attempt, an attempt past its budget, or a shut-down session changes nothing. Rejects with POLICY_DENIED when the
// set does not read back as wanted.
export function setHostMode(tools: HostToolSet, mode: PolicyMode, isCurrent: () => boolean): Promise<void> {
  const change = tools.queue.then(() => applyHostMode(tools, mode, isCurrent));
  tools.queue = change.then(
    () => undefined,
    () => undefined,
  );
  return change;
}

async function applyHostMode(tools: HostToolSet, mode: PolicyMode, isCurrent: () => boolean): Promise<void> {
  if (tools.mode === mode || !isCurrent()) {
    return;
  }
  const { pi } = tools;
  try {
    if (mode === "fail-closed") {
      // The allowlist (spike rule 1). Recorded before the setter runs, so a removal that only partly holds is still owed a restore.
      const wanted = failClosedToolNames(pi.getAllTools().map((tool) => tool.name));
      const removing = pi.getActiveTools().filter((name) => !wanted.includes(name));
      tools.removed = [...new Set([...tools.removed, ...removing])];
      await pi.setActiveTools(wanted);
      if (!sameToolNames(pi.getActiveTools(), wanted)) {
        throw new Error("the removal did not hold");
      }
    } else if (tools.removed.length > 0) {
      // Advisory keeps the built-ins available, so the ones this plugin removed come back.
      const wanted = [...new Set([...pi.getActiveTools(), ...tools.removed])];
      await pi.setActiveTools(wanted);
      if (!sameToolNames(pi.getActiveTools(), wanted)) {
        throw new Error("the restore did not hold");
      }
      tools.removed = [];
    }
  } catch {
    throw makeRealmError("POLICY_DENIED");
  }
  tools.mode = mode;
}

// One status read under a managed timer. The timer expiry rejects with TOOL_TIMEOUT, so a hung
// daemon can never hold the host's tool call. Session shutdown rejects with REALM_NOT_ACTIVE, so an
// in-flight read never outlives its session.
function readStatus(session: ActiveSession): Promise<DaemonStatus> {
  const client = session.client;
  if (client === null) {
    return Promise.reject(makeRealmError("REALM_NOT_ACTIVE"));
  }
  return new Promise<DaemonStatus>((resolve, reject) => {
    const timer = armTimer(
      session,
      GUARD_STATUS_BUDGET_MS,
      () => {
        reject(makeRealmError("TOOL_TIMEOUT"));
      },
      () => {
        reject(makeRealmError("REALM_NOT_ACTIVE"));
      },
    );
    Promise.resolve()
      .then(() => client.status())
      .then(
        (value) => {
          disarmTimer(session, timer);
          resolve(value);
        },
        (error: unknown) => {
          disarmTimer(session, timer);
          reject(error instanceof Error ? error : makeRealmError("REALM_NOT_ACTIVE"));
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
