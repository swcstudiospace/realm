// Omp extension wiring (Phase 5, P5-D4 to P5-D6, P5-D8, P5-D14; daemon attach).
//
// The plugin composes, never constructs. It holds no lifecycle, policy, or runtime object: the
// daemon owns the sandbox, the policy, and the session, and this host attaches to it through the
// DaemonClient, and any refusal it carries, that RealmPluginOptions.attachDaemon resolves. src/omp/extension.ts is the edge that
// builds that client and the only module in the Omp wiring that reads the environment.
//
// The host surface and its evidence are recorded in docs/integration/omp.md:
//   - pi.on handles session_start, session_switch, session_shutdown and tool_call.
//   - session_switch keeps the attachment when its payload has no working directory.
//   - ctx.cwd selects the workspace; ctx.ui.setStatus and notify carry status and warnings.
//   - Managed timers are cleared by the host at shutdown and by the plugin when it ends the session.
//   - pi.registerCommand registers retry; pi.registerTool registers the five Realm tools.
//   - getAllTools/getActiveTools/setActiveTools maintain the fail-closed allowlist.
// bash remains on the allowlist and the tool_call backstop refuses it. Neither removal nor
// the hook covers every host path (OQ-P5-02). The host fails closed on hook errors or timeouts.
// One status item carries label, reason and time (P5-D5); changes are polled without a push channel.
// The daemon owns policy; STARTUP_BUDGET_MS mirrors its default. Bounded re-attach adds no handshake (O4).

import { makeRealmError, RealmError } from "../core/errors.js";
import type { MutationDenyCode } from "../core/policy.js";
import type { DaemonClient, DaemonStatus } from "../daemon/client.js";
import type { PolicyMode } from "../contract/validate.js";
import type { StateSnapshot } from "../core/state-machine.js";
import { STATUS_LABELS, displayStatus } from "../core/status.js";
import {
  PASS_THROUGH_HOST_TOOLS,
  REALM_WRITE_NAME,
  realmToolDefinitions,
  type DaemonCall,
  type HostToolDefinition,
} from "./tools.js";
import {
  equalJitterDelayMs,
  LINK_LOST_CODES,
  REATTACH_BASE_DELAY_MS,
  REATTACH_DELAY_CAP_MS,
  REATTACH_RETRY_CAP,
  reattachTransitionAllowed,
  RETRYABLE_ATTACH_CODES,
  type ReattachState,
} from "./reattach.js";
import { hostToolSetOf, modeOf, setHostMode, type HostToolSet } from "./host-tools.js";

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
  on(event: "session_start" | "session_switch", handler: (_event: unknown, ctx: OmpSessionContext) => void): void;
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

// The attach result. refusal is the up error when the daemon answered but refused the realm (for example a Podman probe
// refusal). The client is adopted for tool calls either way; refusal is null when the up succeeded.
export interface DaemonAttach {
  readonly client: DaemonClient;
  readonly refusal: RealmError | null;
}

export interface RealmPluginOptions {
  // Resolves the daemon client bound to workspaceRoot: ensures a daemon answers, connects, and runs
  // the idempotent up. Rejects with a RealmError when the attach fails. A refused up that leaves a live daemon resolves with its
  // refusal, so the client is still adopted and the refusal is shown.
  readonly attachDaemon: (workspaceRoot: string) => Promise<DaemonAttach>;
  // Bounded re-attach after a dropped link (O4). Absent or disabled, the plugin attaches once and behaves as before. random must
  // return a value in [0, 1]; the extension edge passes Math.random.
  readonly reattach?: { readonly enabled: boolean; readonly random: () => number };
}

export interface ActiveSession {
  readonly ctx: OmpSessionContext;
  // The working directory this session attached for. A switch re-attaches only when the new context names another one.
  readonly attachedCwd: string;
  // The host tool set this plugin shares across sessions (see HostToolSet).
  readonly tools: HostToolSet;
  // Live client, or null while the host is disconnected.
  client: DaemonClient | null;
  // Last mode successfully applied and read back for this session; null until the first success.
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
  // The refusal the last attach reported, with the state the daemon reported alongside it. It stays on screen while the
  // daemon keeps reporting that state; a status read that reports a different state replaces it. Null when none stands.
  refusal: { readonly code: string; readonly state: StateSnapshot["state"] } | null;
  // The re-attach sub-state: "off" while re-attach is disabled, otherwise linked, reconnecting, attaching or failed (ReattachState).
  link: ReattachState;
  // Re-attach waits armed in the current streak. It resets on linked and on a user retry.
  reattachCount: number;
  // The pending re-attach wait, or null when none is armed.
  wait: { readonly handle: unknown } | null;
  // Reports a loss of the client this session holds. Null while re-attach is disabled.
  onLinkLost: ((code: string) => void) | null;
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
// write is never hidden: it replaces the built-in write (spike S1), reaches the daemon in every state, and the daemon decides it
// (advisory: the write lands with its warning; fail-closed: refused). The names in PASS_THROUGH_HOST_TOOLS pass the guard; in
// fail-closed mode the backstop refuses every other tool name.
export const GUARDED_HOST_TOOLS: readonly string[] = Object.freeze(["edit"]);

// ---- Status rendering (OMP-02, OMP-03; P5-D5) -------------------------------
// One shared label with a readable marker, degraded flag, reason, time and mode disclosure.
// Cache the full text per UI so any change repaints and identical status reads stay quiet.
// A known mode is current only after a successful status read and active-tool readback.
// On a failed read or application, it describes the last success, not the present tool set.

const lastPainted = new WeakMap<OmpStatusUi, string>();

export function renderRealmStatus(ui: OmpStatusUi, snapshot: StateSnapshot, mode: PolicyMode | null, confirmed: boolean, reconnectCode?: string): void {
  const display = displayStatus(snapshot);
  const marker = display.label === STATUS_LABELS.active ? "●" : "○";
  const flag = display.degraded ? " [degraded]" : "";
  const modeText = mode === null ? "mode: unknown" : `${confirmed ? "applied mode" : "last successfully applied mode"}: ${mode}${mode === "fail-closed" ? " (Omp host-tool guard; not host process containment)" : ""}`;
  const text = `${marker} ${display.label}${flag} · ${display.reason}${reconnectCode === undefined ? "" : ` (${reconnectCode})`} · ${display.lastTransitionAt} · ${modeText}`;
  if (lastPainted.get(ui) === text) {
    return;
  }
  // Cached only after the write succeeds: a throw above leaves the cache stale, so the next
  // render repaints instead of skipping it (MED-03).
  ui.setStatus(REALM_STATUS_KEY, text);
  lastPainted.set(ui, text);
}

// Paints a refusal the attach reported, in the same error rendering a thrown attach error uses: the reason is the refusal's code.
// The stamp is kept while the same code stands, so repaint ticks stay quiet.
function paintRefusal(session: ActiveSession, code: string, confirmed = false): void {
  const at = session.errorStamp?.code === code ? session.errorStamp.at : nowIso();
  session.errorStamp = { code, at };
  renderRealmStatus(session.ctx.ui, { state: "error", reason: code, lastTransitionAt: at }, session.mode, confirmed);
}

// Paints one successful status read. While the daemon reports the state a refusal was reported in, the refusal stays on
// screen. A read that reports a different state replaces it with the snapshot.
function paintStatusRead(session: ActiveSession, snapshot: StateSnapshot): void {
  const refusal = session.refusal;
  if (refusal !== null && refusal.state === snapshot.state) {
    paintRefusal(session, refusal.code, true);
    return;
  }
  session.refusal = null;
  session.errorStamp = null;
  renderRealmStatus(session.ctx.ui, snapshot, session.mode, true);
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

// Moves the sub-state when the move is legal. An illegal move is refused, named in a notice, and applies nothing.
function moveLink(session: ActiveSession, to: ReattachState): void {
  if (!reattachTransitionAllowed(session.link, to)) {
    session.ctx.ui.notify(`realm link transition ${session.link} -> ${to} rejected`);
    return;
  }
  session.link = to;
}

// Closes the session's client and forgets it. The daemon keeps its sandbox: closing only ends this host's link.
function releaseClient(session: ActiveSession): void {
  const client = session.client;
  session.client = null;
  client?.close();
}

// Cancels the pending re-attach wait, if one is armed.
function cancelWait(session: ActiveSession): void {
  if (session.wait !== null) {
    disarmTimer(session, session.wait.handle);
    session.wait = null;
  }
}

// The catalogue code of a failed call. A failure that is not a RealmError reads as a daemon that did not answer, as refusalOf does.
function codeOfError(error: unknown): string {
  return error instanceof RealmError ? error.code : "REALM_NOT_ACTIVE";
}

// Reports a loss of the client the session holds. A failure from a client the session no longer holds is ignored, so a stale
// failure never tears down a newer link.
function reportLinkLoss(session: ActiveSession, code: string, isCurrent: () => boolean): void {
  if (session.onLinkLost !== null && LINK_LOST_CODES.includes(code) && isCurrent()) {
    session.onLinkLost(code);
  }
}

// The retry command's reply for one attach outcome.
function describeRetry(outcome: AttachOutcome): string {
  if (outcome.outcome === "attached") {
    return `realm retry: ${outcome.snapshot.state} (${outcome.snapshot.reason})`;
  }
  if (outcome.outcome === "failed") {
    return `realm retry refused: ${outcome.code}`;
  }
  return "realm retry superseded";
}


// ---- Registration -----------------------------------------------------------

type AttachOutcome =
  | { readonly outcome: "attached"; readonly snapshot: StateSnapshot }
  | { readonly outcome: "failed"; readonly code: string }
  | { readonly outcome: "superseded" };

// Registers the Realm tools, the retry command and the lifecycle handlers. Returns the host tool set this registration shares,
// so a host or a test can read what the plugin owes.
export function registerRealmPlugin(pi: OmpExtensionApi, options: RealmPluginOptions): HostToolSet {
  // The live session, or null after shutdown. A settle compares against it: an attach that ends
  // after shutdown, or after a newer attach started, releases its client and paints nothing.
  let live: ActiveSession | null = null;
  let attempt = 0;
  // The host tool set, shared by every session of this registration.
  const hostTools = hostToolSetOf(pi);
  // The re-attach policy, or null while re-attach is off (the default). The plugin reads no environment: the edge passes the switch.
  const reattachOption = options.reattach;
  const reattach = reattachOption !== undefined && reattachOption.enabled ? { random: reattachOption.random } : null;

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
    session.refusal = null;
    const { ctx } = session;
    const previousError = reattach !== null ? session.errorStamp : null;
    renderRealmStatus(ctx.ui, { state: "connecting", reason: "connecting", lastTransitionAt: previousError?.at ?? nowIso() }, session.mode, false, previousError?.code);

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
    // The attach and its first status read share one budget. A client is adopted once the daemon answers its status, even when
    // the host tool set refuses the mode that status reports: the refusal is painted and the last published mode stays (P16 b).
    // The host tool set follows the mode inside the same budget, and only while this attempt may still change it.
    const pending = Promise.resolve()
      .then(() => options.attachDaemon(ctx.cwd))
      .then(async ({ client, refusal }) => {
        try {
          const status = await client.status();
          const mode = modeOf(status);
          const hostCode = await setHostMode(session.tools, mode, () => isCurrent() && !spent).then(
            () => null,
            () => "POLICY_DENIED" as const,
          );
          return { client, refusal, status, hostCode };
        } catch (error: unknown) {
          client.close();
          throw error;
        }
      });

    let attached: {
      readonly client: DaemonClient;
      readonly status: DaemonStatus;
      readonly refusal: RealmError | null;
      readonly hostCode: "POLICY_DENIED" | null;
    } | null = null;
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
      paintRefusal(session, code);
      return { outcome: "failed", code };
    }
    // The daemon answered, so the client is adopted for tool calls, a refused up included. The mode is published only once the tool set has taken it.
    session.client = attached.client;
    session.refusal =
      attached.refusal === null ? null : { code: attached.refusal.code, state: attached.status.snapshot.state };
    if (attached.hostCode === null) {
      session.mode = attached.status.mode;
      if (attached.refusal === null) {
        session.errorStamp = null;
        renderRealmStatus(ctx.ui, attached.status.snapshot, session.mode, true);
      } else {
        session.errorStamp = null;
        paintRefusal(session, attached.refusal.code, true);
      }
    } else {
      paintRefusal(session, attached.hostCode);
    }
    // The daemon keeps its startup-reap notice for its lifetime; each attach shows it once.
    if (attached.status.notice !== undefined) {
      ctx.ui.notify(attached.status.notice);
    }
    if (attached.hostCode !== null) {
      return { outcome: "failed", code: attached.hostCode };
    }
    if (attached.refusal !== null) {
      return { outcome: "failed", code: attached.refusal.code };
    }
    return { outcome: "attached", snapshot: attached.status.snapshot };
  };

  // Settles one re-attach attempt: its outcome decides the next sub-state. Nothing changes once the session has ended.
  const settleAttempt = (session: ActiveSession, outcome: AttachOutcome): void => {
    if (reattach === null || live !== session || outcome.outcome === "superseded") {
      return;
    }
    if (outcome.outcome === "attached") {
      session.reattachCount = 0;
      moveLink(session, "linked");
      return;
    }
    if (RETRYABLE_ATTACH_CODES.includes(outcome.code) && session.reattachCount < REATTACH_RETRY_CAP) {
      releaseClient(session);
      moveLink(session, "reconnecting");
      scheduleWait(session, outcome.code);
      return;
    }
    moveLink(session, "failed");
    session.ctx.ui.notify(`realm link failed (${outcome.code}); run /${REALM_RETRY_COMMAND} to try again`);
  };

  // Arms the next re-attach wait: one timer, one notice, and the connecting paint. Its expiry runs the attempt. Its end action only
  // clears the handle, so shutdown cancels the wait without attaching.
  const scheduleWait = (session: ActiveSession, code: string): void => {
    if (reattach === null) {
      return;
    }
    const attemptNo = session.reattachCount + 1;
    const delayMs = equalJitterDelayMs(attemptNo, REATTACH_BASE_DELAY_MS, REATTACH_DELAY_CAP_MS, reattach.random);
    session.reattachCount = attemptNo;
    const handle = armTimer(
      session,
      delayMs,
      () => {
        session.wait = null;
        waitExpired(session, attemptNo);
      },
      () => {
        session.wait = null;
      },
    );
    session.wait = { handle };
    session.refusal = null;
    session.errorStamp = { code, at: session.errorStamp?.code === code ? session.errorStamp.at : nowIso() };
    const nextAt = new Date(Date.now() + delayMs).toISOString();
    session.ctx.ui.notify(
      `realm link lost (${code}); re-attach attempt ${String(attemptNo)} of ${String(REATTACH_RETRY_CAP)} at ${nextAt}`,
    );
    renderRealmStatus(session.ctx.ui, { state: "connecting", reason: "connecting", lastTransitionAt: session.errorStamp.at }, session.mode, false, code);
  };

  // A wait that expires attaches once, and only while it is the armed wait of a live session. Anything else has moved on.
  const waitExpired = (session: ActiveSession, expected: number): void => {
    if (live !== session || session.link !== "reconnecting" || session.reattachCount !== expected) {
      return;
    }
    moveLink(session, "attaching");
    void attachCycle(session);
  };

  // One re-attach attempt: the attach path, then its outcome sets the next sub-state.
  const attachCycle = async (session: ActiveSession): Promise<AttachOutcome> => {
    const outcome = await attach(session);
    settleAttempt(session, outcome);
    return outcome;
  };

  // A loss of the linked client: the client is released, the link waits, and one wait is armed. In any other sub-state, or with
  // no client held, the loss is already handled or the session is FAILED, so the signal changes nothing.
  const linkLost = (session: ActiveSession, code: string): void => {
    if (reattach === null || live !== session || session.link !== "linked" || session.client === null) {
      return;
    }
    releaseClient(session);
    moveLink(session, "reconnecting");
    scheduleWait(session, code);
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
        const code = codeOfError(error);
        // A lost link is not painted as an error: the re-attach wait paints connecting once the mode is restored.
        const lost = session.link === "linked" && LINK_LOST_CODES.includes(code);
        if (!lost) {
          const at = session.errorStamp?.code === code ? session.errorStamp.at : nowIso();
          session.errorStamp = { code, at };
          renderRealmStatus(session.ctx.ui, { state: "error", reason: code, lastTransitionAt: at }, session.mode, false);
        }
        try {
          await reassertLastMode(session, isCurrent);
        } catch {
          if (isCurrent()) {
            const denied = "POLICY_DENIED";
            const deniedAt = session.errorStamp?.code === denied ? session.errorStamp.at : nowIso();
            session.errorStamp = { code: denied, at: deniedAt };
            renderRealmStatus(session.ctx.ui, { state: "error", reason: denied, lastTransitionAt: deniedAt }, session.mode, false);
          }
        }
        if (lost) {
          reportLinkLoss(session, code, isCurrent);
        }
        return;
      }
      if (!isCurrent()) {
        return;
      }
      // The poll moves the host tool set with the mode it reports, so a change does not wait for a guarded call.
      try {
        await setHostMode(session.tools, modeOf(status), isCurrent);
      } catch {
        if (isCurrent()) {
          const code = "POLICY_DENIED";
          const at = session.errorStamp?.code === code ? session.errorStamp.at : nowIso();
          session.errorStamp = { code, at };
          renderRealmStatus(session.ctx.ui, { state: "error", reason: code, lastTransitionAt: at }, session.mode, false);
        }
        return;
      }
      if (!isCurrent()) {
        return;
      }
      session.mode = status.mode;
      paintStatusRead(session, status.snapshot);
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
    if (reattach === null) {
      return describeRetry(await attach(session));
    }
    if (session.link === "attaching") {
      // An attach is already in flight, and a second one would race it. The move is refused and reported by moveLink.
      moveLink(session, "attaching");
      return "realm retry: an attach is already in progress";
    }
    cancelWait(session);
    session.reattachCount = 0;
    moveLink(session, "attaching");
    return describeRetry(await attachCycle(session));
  };

  // Begins a session for the context's working directory: a second begin replaces the first, so the previous client and its
  // timers are released, not orphaned. The attach runs detached; its outcome paints itself.
  const beginSession = (ctx: OmpSessionContext): void => {
    endSession();
    const session: ActiveSession = {
      ctx,
      attachedCwd: ctx.cwd,
      tools: hostTools,
      client: null,
      mode: null,
      timers: new Map(),
      poll: null,
      refreshing: false,
      errorStamp: null,
      refusal: null,
      link: reattach === null ? "off" : "attaching",
      reattachCount: 0,
      wait: null,
      onLinkLost: reattach === null ? null : (code: string) => {
        linkLost(session, code);
      },
    };
    live = session;
    session.poll = {
      handle: ctx.setInterval(() => {
        void repaint(session);
      }, STATUS_POLL_MS),
    };
    // Detached: the handler returns while the attach runs, and the outcome paints itself.
    if (reattach === null) {
      void attach(session);
    } else {
      void attachCycle(session);
    }
  };

  pi.on("session_start", (_event, ctx) => {
    beginSession(ctx);
  });

  // session_switch (docs/integration/omp.md, row S2b): the host reports a switch with the context of the session it switched to.
  // The payload is read defensively. Without a working directory, or with the directory already attached, the attachment is
  // kept. Another directory ends the attachment and begins one for it, as session_start does.
  pi.on("session_switch", (_event, ctx) => {
    const cwd: unknown = (ctx as Partial<OmpSessionContext> | undefined)?.cwd;
    if (live === null || typeof cwd !== "string" || cwd === live.attachedCwd) {
      return;
    }
    beginSession(ctx);
  });

  pi.on("session_shutdown", () => {
    endSession();
  });

  // The Realm tools (OMPX-02) register at load in every mode. Which built-ins stay callable follows the mode the daemon reports.
  // A call reaches the daemon whenever a client is adopted, whatever state the realm reports (B1, B9); with no client it is refused
  // before any daemon call (B2). An advisory write that lands in a non-active state carries the daemon's warning, shown on every call.
  const callDaemon: DaemonCall = async (call) => {
    const session = live;
    const client = session?.client ?? null;
    if (session === null || client === null) {
      throw makeRealmError("REALM_NOT_ACTIVE");
    }
    const outcome = await client.call(call).catch((error: unknown) => {
      // A lost link is reported to the re-attach wait. A mutation in flight may have taken effect: it is reported as unknown and
      // is never dispatched again. A read keeps the code it failed with.
      if (session.onLinkLost !== null && LINK_LOST_CODES.includes(codeOfError(error))) {
        reportLinkLoss(session, codeOfError(error), () => live === session && session.client === client);
        if ("write" in call || "exec" in call) {
          throw makeRealmError("AUDIT_OUTCOME_UNKNOWN");
        }
      }
      throw error;
    });
    if (outcome.outcome === "done" && outcome.tool === "write" && outcome.value.warning !== null && live === session) {
      session.ctx.ui.notify(outcome.value.warning);
    }
    return outcome;
  };
  for (const tool of realmToolDefinitions(callDaemon)) {
    pi.registerTool(tool);
  }

  pi.on("tool_call", (call) => guardHostToolCall(call.toolName, live, hostTools));

  pi.registerCommand(REALM_RETRY_COMMAND, {
    description: "Retry the realm startup through the daemon attach path.",
    handler: retryRealm,
  });
  return hostTools;
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
// The Realm tools pass the guard. read, list, exec and status reach the daemon, whose own dispatcher waits out connecting
// and runs the mutation gate. The Realm write also reaches the daemon in every state (B1 to B3): the guard reads the status
// only to keep the host tool set in step with the mode, and the daemon decides the write.
//
// Edit is the mutation check. It reads the daemon status: the state decides, and the mode decides a non-active state
// (advisory warns, fail-closed blocks). It mirrors decideMutation (src/core/policy.ts) and the gate outcomes of
// src/lifecycle/mutation-gate.ts; the mirror adds no rule of its own. Every other host tool reads the status too and is
// decided by the mode it reports: fail-closed refuses it, advisory passes it. The backstop (OMPX-03) refuses every other
// tool name in fail-closed mode and while no mode is known, with the catalogue code POLICY_DENIED. Removal is the primary control:
// Omp refuses a removed tool before this hook runs. bash is the one built-in fail-closed keeps active, so this hook is what refuses
// it, with a catalogue code Omp's own refusal lacks.
//
// The state comes from a daemon status read bounded by GUARD_STATUS_BUDGET_MS. When the status cannot be read, a guarded call
// (edit) is refused in every mode (CR-01): the advisory allowance needs a reachable daemon, which an unreadable status does not
// confirm. The Realm write is refused under advisory and otherwise reaches the daemon, which decides it. Any other host tool
// whose status cannot be read is refused, because its mode is unconfirmed.

export async function guardHostToolCall(
  toolName: unknown,
  session: ActiveSession | null,
  tools: HostToolSet,
): Promise<HostToolVerdict | undefined> {
  if (typeof toolName !== "string") {
    // A call the guard cannot classify is refused, never waved through (LOW-01).
    return { block: true, reason: "realm bad tool call" };
  }
  if (session === null) {
    if (GUARDED_HOST_TOOLS.includes(toolName)) {
      return { block: true, reason: "realm not started" };
    }
    return PASS_THROUGH_HOST_TOOLS.includes(toolName) ? undefined : { block: true, reason: "POLICY_DENIED" };
  }
  if (PASS_THROUGH_HOST_TOOLS.includes(toolName) && toolName !== REALM_WRITE_NAME) {
    return undefined;
  }
  // Any other host tool is decided by the mode the daemon reports now, so the status is read here, not taken from an earlier read.
  const client = session.client;
  // The session can move to another client while this guard awaits (a retry, a reattach or a shutdown). Any verdict built on
  // the earlier client is stale, so a moved session refuses the call with REALM_NOT_ACTIVE instead.
  const moved = (): boolean => session.client !== client;
  const isCurrent = (): boolean => session.client === client;
  let status: DaemonStatus;
  try {
    status = await readStatus(session);
  } catch (error: unknown) {
    if (moved()) {
      return { block: true, reason: "REALM_NOT_ACTIVE" };
    }
    try {
      await reassertLastMode(session, isCurrent);
    } catch {
      if (!moved()) {
        paintRefusal(session, "POLICY_DENIED");
      }
      return { block: true, reason: "POLICY_DENIED" };
    }
    if (moved()) {
      return { block: true, reason: "REALM_NOT_ACTIVE" };
    }
    if (client !== null) {
      paintRefusal(session, codeOfError(error));
    }
    reportLinkLoss(session, codeOfError(error), isCurrent);
    if (toolName === REALM_WRITE_NAME && session.mode !== "advisory") {
      // Fail-closed never hides the Realm write, so the daemon decides it. With no client the daemon call is refused there (B2).
      return undefined;
    }
    if (toolName === REALM_WRITE_NAME || GUARDED_HOST_TOOLS.includes(toolName)) {
      // Advisory is the exception: its allowance needs a reachable daemon, which an unreadable status does not confirm.
      return unreadableVerdict(error);
    }
    return { block: true, reason: "POLICY_DENIED" };
  }
  if (moved()) {
    return { block: true, reason: "REALM_NOT_ACTIVE" };
  }
  try {
    await setHostMode(tools, modeOf(status), isCurrent);
  } catch {
    if (!moved()) {
      paintRefusal(session, "POLICY_DENIED");
    }
    return { block: true, reason: "POLICY_DENIED" };
  }
  // setHostMode resolves without a change when its turn comes after the session moved, so the check runs again here.
  if (moved()) {
    return { block: true, reason: "REALM_NOT_ACTIVE" };
  }
  // The mode is published only once the tool set has taken it (P16 b): a refused change leaves the last published mode in place.
  session.mode = status.mode;
  paintStatusRead(session, status.snapshot);
  if (toolName === REALM_WRITE_NAME) {
    return undefined;
  }
  if (GUARDED_HOST_TOOLS.includes(toolName)) {
    const verdict = stateVerdict(session, status.mode, status.snapshot.state);
    if (verdict !== undefined) {
      return verdict;
    }
  }
  // Fail-closed refuses a tool outside the allowlist, edit included, even with an active realm. Advisory passes it.
  return status.mode === "advisory" ? undefined : { block: true, reason: "POLICY_DENIED" };
}

// The realm cannot be read, so it counts as disconnected. The tool set still follows the last published mode, so a drift is
// restored (P16 c). The Realm write is never hidden (B9).
function reassertLastMode(session: ActiveSession, isCurrent: () => boolean): Promise<void> {
  if (session.mode === null) {
    return Promise.resolve();
  }
  return setHostMode(session.tools, session.mode, isCurrent);
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

function unreadableVerdict(error: unknown): HostToolVerdict {
  const code = error instanceof RealmError ? error.code : "REALM_NOT_ACTIVE";
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
