// Fakes for the host boot-hook conformance harness (Phase 21, HOST-04): a scripted daemon client, a scripted attach, a status
// sink and deterministic fake timers. Nothing here opens a socket, spawns a process or arms a real timer.

import { makeRealmError, type ErrorCode, type RealmError } from "../../src/core/errors.js";
import type { StateSnapshot } from "../../src/core/state-machine.js";
import type { State } from "../../src/core/states.js";
import { displayStatus } from "../../src/core/status.js";
import type { PolicyMode } from "../../src/contract/validate.js";
import type { DaemonClient, DaemonStatus } from "../../src/daemon/client.js";
import type { HostBootDeps, HostStatusSink, HostTimers } from "../../src/host/types.js";
import type { MetricsSnapshot } from "../../src/observe/metrics.js";
import { sessionIdOfWorkspace } from "../../src/session/paths.js";
import type { ToolOutcome } from "../../src/tools/dispatch.js";

const TRANSITION_STAMP = "2026-01-01T00:00:00.000Z";

export type DaemonMethod = "status" | "up" | "call" | "metrics" | "close";

// One recorded call. `arg` is the call's argument, or undefined for a method that takes none.
export interface DaemonLogEntry {
  readonly method: DaemonMethod;
  readonly arg: unknown;
}

export interface FakeDaemonOptions {
  // The workspace root the daemon is pinned to.
  readonly root: string;
  readonly mode?: PolicyMode;
  readonly state?: State;
  // The boundRoot a status reply carries. Absent: the root. null: the reply omits the field, as a daemon that predates it does.
  readonly boundRoot?: string | null;
  // The session id a status reply carries. Absent: the session id of the root.
  readonly sessionId?: string;
}

// A DaemonClient that answers from a script and logs every call. It has no `down` method: a hook that tries to take the
// sandbox down can only do so through `call`, which the log shows.
export class FakeDaemon implements DaemonClient {
  readonly log: DaemonLogEntry[] = [];
  // How many times close() was called. close() is idempotent; this counts calls, not effects.
  closeCalls = 0;
  private closed = false;
  private mode: PolicyMode;
  private state: State;
  private readonly boundRoot: string | null;
  private readonly sessionId: string;
  private failure: ErrorCode | null = null;
  private hanging = false;

  constructor(options: FakeDaemonOptions) {
    this.mode = options.mode ?? "fail-closed";
    this.state = options.state ?? "active";
    this.boundRoot = options.boundRoot === undefined ? options.root : options.boundRoot;
    this.sessionId = options.sessionId ?? sessionIdOfWorkspace(options.root);
  }

  // Makes every later status() reject with a RealmError of this code. null restores normal replies.
  failStatus(code: ErrorCode | null): void {
    this.failure = code;
  }

  // Makes every later status() never settle (true), or answer again (false).
  hangStatus(hanging: boolean): void {
    this.hanging = hanging;
  }

  setMode(mode: PolicyMode): void {
    this.mode = mode;
  }

  setState(state: State): void {
    this.state = state;
  }

  private reply(): DaemonStatus {
    const snapshot: StateSnapshot = { state: this.state, reason: "fake", lastTransitionAt: TRANSITION_STAMP };
    const base = { snapshot, display: displayStatus(snapshot), mode: this.mode, sessionId: this.sessionId };
    return this.boundRoot === null ? base : { ...base, boundRoot: this.boundRoot };
  }

  private answer(method: DaemonMethod): Promise<DaemonStatus> {
    if (this.closed) {
      return Promise.reject(makeRealmError("REALM_NOT_ACTIVE"));
    }
    if (method === "status" && this.hanging) {
      return new Promise<DaemonStatus>(() => undefined);
    }
    if (method === "status" && this.failure !== null) {
      return Promise.reject(makeRealmError(this.failure));
    }
    return Promise.resolve(this.reply());
  }

  status(): Promise<DaemonStatus> {
    this.log.push({ method: "status", arg: undefined });
    return this.answer("status");
  }

  up(): Promise<DaemonStatus> {
    this.log.push({ method: "up", arg: undefined });
    return this.answer("up");
  }

  call(tool: unknown): Promise<ToolOutcome> {
    this.log.push({ method: "call", arg: tool });
    if (this.closed) {
      return Promise.reject(makeRealmError("REALM_NOT_ACTIVE"));
    }
    return Promise.resolve({ outcome: "refused", tool: null, code: "POLICY_DENIED", retryable: false });
  }

  metrics(): Promise<MetricsSnapshot> {
    this.log.push({ method: "metrics", arg: undefined });
    return Promise.reject(makeRealmError("REALM_NOT_ACTIVE"));
  }

  close(): void {
    this.log.push({ method: "close", arg: undefined });
    this.closeCalls += 1;
    this.closed = true;
  }

  // The methods called so far, in order.
  methods(): readonly DaemonMethod[] {
    return this.log.map((entry) => entry.method);
  }
}

// ---- Scripted attach --------------------------------------------------------

export type AttachOutcome =
  | { readonly kind: "ok"; readonly daemon: FakeDaemon }
  | { readonly kind: "refused"; readonly daemon: FakeDaemon; readonly code: ErrorCode }
  | { readonly kind: "fail"; readonly code: ErrorCode }
  | { readonly kind: "hang" };

export const ok = (daemon: FakeDaemon): AttachOutcome => ({ kind: "ok", daemon });
export const refused = (daemon: FakeDaemon, code: ErrorCode): AttachOutcome => ({ kind: "refused", daemon, code });
export const fail = (code: ErrorCode): AttachOutcome => ({ kind: "fail", code });
export const hang = (): AttachOutcome => ({ kind: "hang" });

export interface ScriptedAttach {
  readonly attachDaemon: HostBootDeps["attachDaemon"];
  // The workspace root of every attach call, in order.
  readonly roots: string[];
}

// Builds HostBootDeps.attachDaemon from outcomes consumed one per call. A call past the end rejects with REALM_NOT_ACTIVE.
export function scriptedAttach(outcomes: readonly AttachOutcome[]): ScriptedAttach {
  const roots: string[] = [];
  const attachDaemon: HostBootDeps["attachDaemon"] = (workspaceRoot) => {
    roots.push(workspaceRoot);
    const outcome = outcomes[roots.length - 1];
    if (outcome === undefined) {
      return Promise.reject(makeRealmError("REALM_NOT_ACTIVE"));
    }
    switch (outcome.kind) {
      case "ok":
        return Promise.resolve({ client: outcome.daemon, refusal: null });
      case "refused": {
        const refusal: RealmError = makeRealmError(outcome.code);
        return Promise.resolve({ client: outcome.daemon, refusal });
      }
      case "fail":
        return Promise.reject(makeRealmError(outcome.code));
      case "hang":
        return new Promise<never>(() => undefined);
    }
  };
  return { attachDaemon, roots };
}

// ---- Status sink ------------------------------------------------------------

export interface RecordedStatus {
  readonly key: string;
  readonly text: string;
}

export class RecordingSink implements HostStatusSink {
  readonly statuses: RecordedStatus[] = [];
  readonly notices: string[] = [];

  setStatus(key: string, text: string): void {
    this.statuses.push({ key, text });
  }

  // Omp widget paints (ADR-0002) record into the same statuses list, so boot-conformance
  // assertions on painted text keep reading one array. This lets the sink satisfy OmpStatusUi.
  setWidget(key: string, text: string | string[]): void {
    this.statuses.push({ key, text: Array.isArray(text) ? text.join("\n") : text });
  }

  notify(message: string): void {
    this.notices.push(message);
  }
}

// ---- Fake timers ------------------------------------------------------------

interface TimerEntry {
  readonly id: number;
  at: number;
  readonly every: number | null;
  readonly callback: () => void;
}

// Lets every promise reaction already queued run. A fired timer's async work is microtask-only in the fakes, so one macrotask
// turn drains it.
export function flushMicrotasks(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

// Deterministic timers and clock. advance(ms) fires due timers in (time, creation) order, running the work each one starts
// before the next fires, and finishes with the clock exactly ms later. `now` and `random` are arrow properties so they can be
// handed to HostBootDeps directly.
export class FakeTimers implements HostTimers {
  // The value `random()` returns. A test sets it to 0 or 1 to pin the jitter at its two ends.
  randomValue = 0.5;
  private elapsed = 0;
  private nextId = 1;
  private readonly entries = new Map<number, TimerEntry>();
  private readonly epochMs = Date.UTC(2026, 0, 1);

  readonly now = (): Date => new Date(this.epochMs + this.elapsed);
  readonly random = (): number => this.randomValue;

  private arm(callback: () => void, ms: number, every: number | null): number {
    const id = this.nextId;
    this.nextId += 1;
    this.entries.set(id, { id, at: this.elapsed + Math.max(0, ms), every, callback });
    return id;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    return this.arm(callback, ms, null);
  }

  setInterval(callback: () => void, ms: number): unknown {
    return this.arm(callback, ms, Math.max(1, ms));
  }

  clear(handle: unknown): void {
    if (typeof handle === "number") {
      this.entries.delete(handle);
    }
  }

  // Timers armed and not yet fired or cleared, intervals included.
  pendingCount(): number {
    return this.entries.size;
  }

  // The pending one-shot timers only: the waits, not the repaint poll.
  pendingTimeouts(): number {
    return [...this.entries.values()].filter((entry) => entry.every === null).length;
  }

  // Milliseconds until the earliest pending one-shot timer, or null when none is pending.
  nextTimeoutDueIn(): number | null {
    let due: number | null = null;
    for (const entry of this.entries.values()) {
      if (entry.every === null && (due === null || entry.at - this.elapsed < due)) {
        due = entry.at - this.elapsed;
      }
    }
    return due;
  }

  async advance(ms: number): Promise<void> {
    const target = this.elapsed + ms;
    for (;;) {
      let next: TimerEntry | undefined;
      for (const entry of this.entries.values()) {
        if (entry.at <= target && (next === undefined || entry.at < next.at || (entry.at === next.at && entry.id < next.id))) {
          next = entry;
        }
      }
      if (next === undefined) {
        break;
      }
      this.elapsed = Math.max(this.elapsed, next.at);
      if (next.every === null) {
        this.entries.delete(next.id);
      } else {
        next.at += next.every;
      }
      next.callback();
      await flushMicrotasks();
    }
    this.elapsed = target;
    await flushMicrotasks();
  }
}
