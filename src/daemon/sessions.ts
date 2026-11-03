// Per-project sessions of the daemon (Phase 18, MULTI-02, MULTI-03, MULTI-06). The daemon holds one SessionEntry per admitted
// project, keyed by session id. resolveSelection is the one place that binds, verifies and derives a project's identity for
// the daemon. withSessionLock serializes the admission and the teardown of one id, in process, FIFO. reserveAdmission and
// settleFailedCreate keep the admission ledger in step with the registry and with the containers. SessionHealth is the health
// loop of one session (RT-04, N1).

import type { Policy } from "../contract/validate.js";
import { ERROR_CODES, type ErrorCode, makeRealmError, RealmError } from "../core/errors.js";
import { INITIAL_REASON, type StateSnapshot } from "../core/state-machine.js";
import { bindWorkspaceUnderPolicy, isInsideRoot, type PinnedRoot, verifyPinnedAt } from "../fs/root.js";
import { PROBE_FAILED_REASON, type Metrics } from "../observe/metrics.js";
import type { Logger } from "../observe/logger.js";
import type { RealmHandle } from "../realm/compose.js";
import { sessionIdOfWorkspace } from "../session/paths.js";
import { SessionStore } from "../session/store.js";
import { removeWorkspaceEntry } from "../session/workspace-registry.js";
import type { AdmissionLedger } from "./admission.js";
import type { ControlSelection } from "./channel.js";

// The period of the health probe of an active session (RT-04, owner ruling N1). A runner that exited while the session is
// active is reported by the probe as AGENTOS_CRASH_LOOP, and the session moves to error.
export const HEALTH_PROBE_INTERVAL_MS = 10_000;

// Slack on a request's own bound, for the daemon's reply and the socket round trip (CONTROL_TIMEOUT_MS is the client bound).
export const DAEMON_REPLY_ALLOWANCE_MS = 5_000;

// The lock wait an up may spend queued behind another request for the same id: its client bound, less two probes (the probe
// and the create's own probe budget) and the reply allowance. With the defaults this is 215 s.
export function upLockWaitMs(upClientMs: number, probeTimeoutMs: number, replyAllowanceMs: number): number {
  return upClientMs - 2 * probeTimeoutMs - replyAllowanceMs;
}

// The lock wait a down may spend queued: its client bound less the reply allowance. With the defaults this is 40 s.
export function downLockWaitMs(downClientMs: number, replyAllowanceMs: number): number {
  return downClientMs - replyAllowanceMs;
}

// One admitted project. The handle is that project's own controller, dispatcher and lock table; the pinned root is the
// directory the session was admitted for.
export interface SessionEntry {
  readonly sessionId: string;
  readonly pinned: PinnedRoot;
  readonly handle: RealmHandle;
  readonly health: SessionHealth;
}

// The admitted projects of one daemon, keyed by session id.
export class SessionRegistry {
  readonly #entries = new Map<string, SessionEntry>();

  get(sessionId: string): SessionEntry | undefined {
    return this.#entries.get(sessionId);
  }

  set(sessionId: string, entry: SessionEntry): void {
    this.#entries.set(sessionId, entry);
  }

  delete(sessionId: string): void {
    this.#entries.delete(sessionId);
  }

  values(): IterableIterator<SessionEntry> {
    return this.#entries.values();
  }

  get size(): number {
    return this.#entries.size;
  }
}

export interface ResolveSelectionInput {
  readonly selection: ControlSelection;
  readonly policy: Policy;
  // The configured workspace root, bound once. Every admitted workspace must lie inside it (equality is accepted).
  readonly ceiling: PinnedRoot;
  readonly registry: SessionRegistry;
}

export interface ResolvedSelection {
  readonly sessionId: string;
  readonly pinned: PinnedRoot;
  readonly entry: SessionEntry | null;
}

// Binds, verifies and derives the identity of the project a selection names. An admitted session is checked against its
// pinned directory: a renamed or swapped directory is POLICY_DENIED. An unknown session is bound under the policy roots and the
// configured workspace root, and its id must be the one the selection names (SCHEMA_INVALID otherwise). No runtime I/O.
export function resolveSelection(input: ResolveSelectionInput): ResolvedSelection {
  const { selection, policy, ceiling, registry } = input;
  const entry = registry.get(selection.sessionId);
  if (entry !== undefined) {
    const pinned = verifyPinnedAt(entry.pinned, selection.workspaceRoot);
    if (sessionIdOfWorkspace(entry.pinned.realPath) !== selection.sessionId) {
      throw makeRealmError("POLICY_DENIED");
    }
    return { sessionId: selection.sessionId, pinned, entry };
  }
  const pinned = bindWorkspaceUnderPolicy(policy.workspaceRoots, selection.workspaceRoot);
  if (!isInsideRoot(ceiling, pinned.realPath)) {
    throw makeRealmError("POLICY_DENIED");
  }
  const sessionId = sessionIdOfWorkspace(pinned.realPath);
  if (sessionId !== selection.sessionId) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return { sessionId, pinned, entry: null };
}

// The waiters of each held session id, in arrival order. A key is present while the id's lock is held.
const queues = new Map<string, Array<() => void>>();

// True while another request holds the lock of the id. A request that finds it held is a waiter.
export function isSessionLockHeld(sessionId: string): boolean {
  return queues.has(sessionId);
}

// Runs fn under the in-process lock of the session id. A request that finds the lock free runs at once. Otherwise it queues:
// when its own timer fires before the grant, it leaves the queue and rejects with TOOL_TIMEOUT, and fn never runs. The timer is
// cleared at the grant. The lock is released when fn settles, and the next waiter is granted synchronously.
export function withSessionLock<T>(sessionId: string, fn: () => Promise<T>, waitMs: number): Promise<T> {
  const waiting = queues.get(sessionId);
  if (waiting === undefined) {
    queues.set(sessionId, []);
    return runHeld(sessionId, fn);
  }
  return new Promise<T>((resolve, reject) => {
    const grant = (): void => {
      clearTimeout(timer);
      resolve(runHeld(sessionId, fn));
    };
    const timer = setTimeout(() => {
      const queue = queues.get(sessionId);
      const index = queue?.indexOf(grant) ?? -1;
      if (queue !== undefined && index >= 0) {
        queue.splice(index, 1);
        reject(makeRealmError("TOOL_TIMEOUT"));
      }
    }, waitMs);
    waiting.push(grant);
  });
}

async function runHeld<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    releaseHeld(sessionId);
  }
}

function releaseHeld(sessionId: string): void {
  const next = queues.get(sessionId)?.shift();
  if (next === undefined) {
    queues.delete(sessionId);
    return;
  }
  next();
}

// Reserves the session's slot and reports whether this call created the reservation: true only when the id was not committed
// before the call. The reservation is synchronous and is the only path to AdmissionLedger.reserve.
export function reserveAdmission(ledger: AdmissionLedger, sessionId: string): boolean {
  const committed = ledger.isCommitted(sessionId);
  ledger.reserve(sessionId);
  return !committed;
}

// Settles a create that failed after the handle existed. A reservation this request holds stays as unproven when a container may
// exist (the handle is not unbound) or a record names the id; the entry stays registered. Otherwise no container exists, so the
// reservation is released and the entry and its workspace entry are removed. A reservation this request did not create is left
// as it is.
export function settleFailedCreate(
  ledger: AdmissionLedger,
  registry: SessionRegistry,
  stateDir: string,
  sessionId: string,
  handle: RealmHandle,
  fresh: boolean,
): void {
  if (!fresh) {
    return;
  }
  const containerMayExist = handle.controller.snapshot().state !== "unbound";
  if (containerMayExist || new SessionStore(stateDir).load(sessionId) !== null) {
    ledger.markUnproven(sessionId);
    return;
  }
  ledger.release(sessionId);
  registry.get(sessionId)?.health.dispose();
  registry.delete(sessionId);
  removeWorkspaceEntry(stateDir, sessionId);
}

// The snapshot of a session with no entry: unbound, with the daemon's initial reason and the clock's time.
export function unboundSnapshot(clock: () => Date): StateSnapshot {
  return { state: "unbound", reason: INITIAL_REASON, lastTransitionAt: clock().toISOString() };
}

// The catalogue code of an error, or SCHEMA_INVALID for an error that is not a RealmError.
export function codeOf(error: unknown): ErrorCode {
  return error instanceof RealmError ? error.code : "SCHEMA_INVALID";
}

// The reason as a catalogue code, when it is one.
export function catalogueCode(reason: string): ErrorCode | undefined {
  for (const code of ERROR_CODES) {
    if (code === reason) {
      return code;
    }
  }
  return undefined;
}

export interface SessionHealthOptions {
  readonly sessionId: string;
  readonly handle: RealmHandle;
  readonly metrics: Metrics;
  readonly logger: Logger;
  // True once the daemon is stopping: a tick then probes nothing.
  readonly isStopping: () => boolean;
  // Observer for a probe that threw. It must not throw.
  readonly onProbeFailure: ((code: ErrorCode) => void) | undefined;
}

// The health loop of one session. It runs while the session is in service, active or degraded (a degraded session still serves
// tool calls, so a dead runner there must not keep a truthful-looking label). An event that puts the session in service arms the
// timer unless one is already armed, and any event that leaves service clears it. A tick probes through the controller, which
// owns the transition to error. Ticks never overlap. The timer is unref'd, so it never keeps the process alive. dispose() stops
// the timer and removes the lifecycle subscription, and is called when the session is torn down.
export class SessionHealth {
  readonly #options: SessionHealthOptions;
  readonly #unsubscribe: () => void;
  #timer: NodeJS.Timeout | undefined;
  #probing = false;

  constructor(options: SessionHealthOptions) {
    this.#options = options;
    this.#unsubscribe = options.handle.controller.events.subscribe((event) => {
      this.#options.metrics.recordTransition(event.from, event.to);
      // The reason is free text, so only a catalogue code is taken from it.
      const code = catalogueCode(event.reason);
      this.#options.logger.info("lifecycle.transition", {
        from: event.from,
        to: event.to,
        ...(code === undefined ? {} : { code }),
        sessionId: this.#options.sessionId,
      });
      if (event.to === "active" || event.to === "degraded") {
        if (this.#timer === undefined) {
          this.#start();
        }
      } else {
        this.#stop();
      }
    });
  }

  dispose(): void {
    this.#unsubscribe();
    this.#stop();
  }

  #start(): void {
    this.#stop();
    this.#timer = setInterval(() => {
      void this.#tick();
    }, HEALTH_PROBE_INTERVAL_MS);
    this.#timer.unref();
  }

  #stop(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  async #tick(): Promise<void> {
    const { handle, metrics, logger, sessionId } = this.#options;
    const { state } = handle.controller.snapshot();
    if (this.#probing || this.#options.isStopping() || (state !== "active" && state !== "degraded")) {
      return;
    }
    this.#probing = true;
    try {
      const snapshot = await handle.controller.probe();
      if (snapshot.state === "error") {
        const code = catalogueCode(snapshot.reason);
        if (code !== undefined) {
          metrics.recordHealthProbeFailure(code);
        } else if (snapshot.reason === PROBE_FAILED_REASON) {
          metrics.recordHealthProbeFailure(snapshot.reason);
        }
        logger.warn("health.probe_failed", {
          ...(code === undefined ? { reason: snapshot.reason } : { code }),
          sessionId,
        });
      }
    } catch (error: unknown) {
      const code = codeOf(error);
      metrics.recordHealthProbeFailure(code);
      logger.warn("health.probe_failed", { code, sessionId });
      this.#options.onProbeFailure?.(code);
    } finally {
      this.#probing = false;
    }
  }
}
