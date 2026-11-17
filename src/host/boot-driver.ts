// The production boot driver (Phase 23, BOOT-02): the HostBootHook port implemented for every `mcp-config` host, the
// `{ call }` dispatcher the MCP server and the ACP agent are handed, and the outcome the entry point decides exit and exposure
// on. Every bound comes from resolveBoot (src/host/boot.ts); nothing here is hard-coded.
//
// One attempt is the attach (src/host/attach.ts) plus one status readback, together under the startup budget. The readback is
// validated against the workspace: a reply naming another session or another root is not adopted (its client is closed and
// the state is error). Retry is decided by attachFailureDisposition. Re-attach is off unless the manifest enables it: one
// attempt, link "off", and retry() performs exactly one more. With it on, a lost link waits an equal-jitter delay and attaches
// again, at most retryCap waits per streak, each attempt under the budget, a terminal code ends the streak.
//
// The status poll runs while a client is adopted. It paints the state the daemon reports (only when the text changed) and is
// the one detector of a lost link; with re-attach off it never arms a wait. Every timer goes through deps.timers and is cleared
// at shutdown. A late attach that settles after shutdown, supersession or the budget has its client closed.
//
// Shutdown closes the client and nothing else: the sandbox outlives every host, so no `down` is ever sent from here.

import { ERROR_CODES, makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import type { PolicyMode, ToolName } from "../contract/validate.js";
import type { State } from "../core/states.js";
import type { DaemonClient, DaemonStatus } from "../daemon/client.js";
import { sessionIdOfWorkspace } from "../session/paths.js";
import type { ToolOutcome } from "../tools/dispatch.js";
import {
  attachFailureDisposition,
  backstopVerdict,
  equalJitterDelayMs,
  isLinkLostCode,
  reattachTransitionAllowed,
  resolveBoot,
  withStartupBudget,
  type BootLink,
  type ResolvedBoot,
} from "./boot.js";
import type {
  HostBootDeps,
  HostBootEvent,
  HostBootHook,
  HostGuardVerdict,
  HostLinkStatus,
  HostPluginManifest,
  HostRuntimeEntry,
  HostTimers,
} from "./types.js";

// The six Realm tools. The guard passes these on the link state alone; any other name is classified by the daemon's mode.
export const STDIO_TOOLS: readonly ToolName[] = Object.freeze(["exec", "read", "write", "list", "status", "retry"] as const);

// What an entry point decides exit and exposure on.
export interface BootDriverOutcome {
  // ready: an adopted client whose up succeeded. refused: an adopted client whose up was refused and whose readback confirmed
  // this root and session. failed: no adopted client.
  readonly kind: "ready" | "refused" | "failed";
  readonly code?: ErrorCode;
  // The last readback, or null.
  readonly status: DaemonStatus | null;
  // True while a re-attach wait or attempt is pending.
  readonly retrying: boolean;
  // True when the attach resolved with a refusal: the daemon itself said no, even if the readback then refused the client.
  // A rejected attach (no daemon, budget, channel failure) is false.
  readonly daemonAnswered: boolean;
}

export interface BootDriver extends HostBootHook {
  // The dispatcher the stdio servers receive. Never throws: a blocked or failed call is a refused ToolOutcome.
  readonly call: (tool: unknown) => Promise<ToolOutcome>;
  readonly outcome: () => BootDriverOutcome;
}

export type BootDriverFactory = (deps: HostBootDeps, manifest: HostPluginManifest) => BootDriver;

type Adopted = { readonly daemon: DaemonClient; readonly refusal: RealmError | null; readonly status: DaemonStatus };
type Outcome =
  | { readonly kind: "attached" }
  | { readonly kind: "superseded" }
  | { readonly kind: "refused"; readonly code: ErrorCode; readonly retryable: boolean }
  | { readonly kind: "failed"; readonly code: ErrorCode; readonly retryable: boolean };

// One attach attempt. It is dead once it is superseded, shut down or out of budget; a client it still holds then is closed.
interface Attempt {
  dead: boolean;
  client: DaemonClient | null;
  cancel: (() => void) | null;
}

const MAX_ATTEMPT = 9;
const MAX_DURATION_MS = 600_000;

const codeOf = (error: unknown): ErrorCode => (error instanceof RealmError ? error.code : "REALM_NOT_ACTIVE");
const isErrorCode = (value: string): value is ErrorCode => ERROR_CODES.some((code) => code === value);
const isRealmTool = (name: string): name is ToolName => STDIO_TOOLS.some((tool) => tool === name);
const block = (reason: string): HostGuardVerdict => ({ block: true, reason });

function expectedSession(root: string): string | null {
  try {
    return sessionIdOfWorkspace(root);
  } catch {
    return null;
  }
}

// The tool name of a D-13 map: a plain object with exactly one own key. Anything else is null.
function toolNameOf(tool: unknown): string | null {
  if (typeof tool !== "object" || tool === null || Array.isArray(tool)) {
    return null;
  }
  const prototype: unknown = Object.getPrototypeOf(tool);
  if (prototype !== Object.prototype && prototype !== null) {
    return null;
  }
  const keys = Object.keys(tool);
  const only = keys[0];
  return keys.length === 1 && only !== undefined ? only : null;
}

export function createBootDriver(deps: HostBootDeps, boot: ResolvedBoot): BootDriver {
  const enabled = boot.reattach.enabled;
  let root: string | null = null;
  let live = false;
  let shut = false;
  let client: DaemonClient | null = null;
  let epoch = 0;
  let link: BootLink = "off";
  let state: State = "unbound";
  let mode: PolicyMode | null = null;
  let lastCode: ErrorCode | undefined;
  let refusal: { readonly code: ErrorCode; readonly state: State } | null = null;
  let lastStatus: DaemonStatus | null = null;
  let daemonAnswered = false;
  let lost = false;
  let streak = 0;
  let poll: unknown = null;
  let wait: unknown = null;
  let reading = false;
  let lastText = "";
  let current: Attempt | null = null;
  let sessionStart = deps.now().getTime();
  // Armed one-shot timers, each with the action that settles its wait when the session ends first.
  const armed = new Map<unknown, () => void>();

  const sinceMs = (from: number): number => Math.min(MAX_DURATION_MS, Math.max(0, Math.trunc(deps.now().getTime() - from)));
  const readbackState = (): State | null => lastStatus?.snapshot.state ?? null;
  const emit = (phase: HostBootEvent["phase"], attempt: number, from: number, code: ErrorCode | undefined, at: State | null): void => {
    if (deps.observe === undefined) {
      return;
    }
    const event: HostBootEvent = {
      phase,
      attempt: Math.min(MAX_ATTEMPT, Math.max(1, attempt)),
      durationMs: sinceMs(from),
      state: at,
      ...(code === undefined ? {} : { code }),
    };
    try {
      deps.observe(event);
    } catch {
      // A throwing observer changes nothing.
    }
  };

  const show = (next: State, why: ErrorCode | undefined): void => {
    state = next;
    lastCode = why;
    const text = `realm ${state}${why === undefined ? "" : ` (${why})`} mode: ${mode ?? "unknown"}`;
    if (text !== lastText) {
      lastText = text;
      deps.sink.setStatus("realm", text);
    }
  };
  const go = (to: BootLink): void => {
    link = enabled && reattachTransitionAllowed(link, to) ? to : link;
  };
  const arm = (ms: number, onFire: () => void, onEnd: () => void): unknown => {
    const handle: unknown = deps.timers.setTimeout(() => {
      armed.delete(handle);
      onFire();
    }, ms);
    armed.set(handle, onEnd);
    return handle;
  };
  const disarm = (handle: unknown): void => {
    if (armed.delete(handle)) {
      deps.timers.clear(handle);
    }
  };
  const stopPoll = (): void => {
    if (poll !== null) {
      deps.timers.clear(poll);
      poll = null;
    }
  };
  const release = (): void => {
    const held = client;
    client = null;
    held?.close();
  };
  const dropClient = (attempt: Attempt): void => {
    const held = attempt.client;
    attempt.client = null;
    held?.close();
  };
  // Ends an attempt: a client it holds is closed now, one that lands later is closed on arrival, and its race is released.
  const kill = (attempt: Attempt): void => {
    attempt.dead = true;
    dropClient(attempt);
    const cancel = attempt.cancel;
    attempt.cancel = null;
    cancel?.();
    if (current === attempt) {
      current = null;
    }
  };
  // Ends the session's side effects: timers cleared and their waits settled, the poll stopped, the pending attempt ended, the
  // client closed (never taken down).
  const endAll = (): void => {
    epoch += 1;
    stopPoll();
    wait = null;
    const pending = [...armed];
    armed.clear();
    for (const [handle, onEnd] of pending) {
      deps.timers.clear(handle);
      onEnd();
    }
    if (current !== null) {
      kill(current);
    }
    release();
  };

  // One status read, bounded by the guard budget on the host's own timers.
  const readStatus = (daemon: DaemonClient): Promise<DaemonStatus> =>
    new Promise<DaemonStatus>((resolve, reject) => {
      const timer = arm(
        boot.guardStatusBudgetMs,
        () => {
          reject(makeRealmError("TOOL_TIMEOUT"));
        },
        () => {
          reject(makeRealmError("REALM_NOT_ACTIVE"));
        },
      );
      const finish = (done: () => void): void => {
        disarm(timer);
        done();
      };
      void Promise.resolve()
        .then(() => daemon.status())
        .then(
          (value) => {
            finish(() => {
              resolve(value);
            });
          },
          (error: unknown) => {
            finish(() => {
              reject(makeRealmError(codeOf(error)));
            });
          },
        );
    });

  const failed = (error: unknown): Outcome => {
    const code: ErrorCode = error instanceof RealmError ? error.code : "SCHEMA_INVALID";
    show("error", code);
    return { kind: "failed", code, retryable: attachFailureDisposition(error) === "retryable" };
  };

  // Attach and the first status read, together under the startup budget. A client is kept only when the readback confirms it.
  const attempt = async (workspace: string): Promise<Outcome> => {
    epoch += 1;
    const mine = epoch;
    if (current !== null) {
      kill(current);
    }
    stopPoll();
    release();
    refusal = null;
    lastStatus = null;
    daemonAnswered = false;
    show("connecting", undefined);
    const token: Attempt = { dead: false, client: null, cancel: null };
    current = token;
    const gate = new Promise<never>((_resolve, reject) => {
      token.cancel = () => {
        reject(makeRealmError("REALM_NOT_ACTIVE"));
      };
    });
    const work = (async (): Promise<Adopted> => {
      const attached = await deps.attachDaemon(workspace);
      if (token.dead) {
        attached.client.close();
        throw makeRealmError("REALM_NOT_ACTIVE");
      }
      token.client = attached.client;
      let status: DaemonStatus;
      try {
        status = await attached.client.status();
      } catch (error: unknown) {
        dropClient(token);
        throw error;
      }
      if (token.dead) {
        throw makeRealmError("REALM_NOT_ACTIVE");
      }
      return { daemon: attached.client, refusal: attached.refusal, status };
    })();
    let adopted: Adopted;
    try {
      adopted = await withStartupBudget(Promise.race([work, gate]), boot.startupBudgetMs);
    } catch (error: unknown) {
      const superseded = token.dead || epoch !== mine;
      kill(token);
      return superseded ? { kind: "superseded" } : failed(error);
    }
    token.cancel = null;
    if (token.dead || epoch !== mine) {
      kill(token);
      return { kind: "superseded" };
    }
    const { daemon, status, refusal: attachRefusal } = adopted;
    daemonAnswered = attachRefusal !== null;
    // A reply naming another project's root or session is not adopted. A refused up keeps its client only when the reply names
    // the root; a reply without the field is adopted only when up succeeded.
    const rootOk = status.boundRoot === undefined ? attachRefusal === null : status.boundRoot === workspace;
    if (!rootOk || status.sessionId !== expectedSession(workspace)) {
      kill(token);
      return failed(makeRealmError("SCHEMA_INVALID"));
    }
    token.client = null;
    current = null;
    client = daemon;
    mode = status.mode;
    lastStatus = status;
    if (attachRefusal === null) {
      show(status.snapshot.state, undefined);
    } else {
      refusal = { code: attachRefusal.code, state: status.snapshot.state };
      show("error", attachRefusal.code);
    }
    poll = deps.timers.setInterval(() => {
      void tick();
    }, boot.statusPollMs);
    return attachRefusal === null
      ? { kind: "attached" }
      : { kind: "refused", code: attachRefusal.code, retryable: attachFailureDisposition(attachRefusal) === "retryable" };
  };

  const scheduleWait = (why: ErrorCode): void => {
    const n = streak + 1;
    const delay = equalJitterDelayMs(n, boot.reattach.baseDelayMs, boot.reattach.capDelayMs, deps.random);
    streak = n;
    const expire = (): void => {
      wait = null;
      if (link === "reconnecting" && streak === n) {
        go("attaching");
        void cycle();
      }
    };
    wait = arm(delay, expire, () => {
      wait = null;
    });
    deps.sink.notify(`realm link lost (${why}); re-attach attempt ${String(n)} at ${new Date(deps.now().getTime() + delay).toISOString()}`);
    show("connecting", why);
  };

  const settle = (outcome: Outcome): void => {
    if (!enabled || outcome.kind === "superseded") {
      return;
    }
    if (outcome.kind === "attached") {
      streak = 0;
      lost = false;
      go("linked");
    } else if (outcome.retryable && streak < boot.reattach.retryCap) {
      stopPoll();
      release();
      go("reconnecting");
      scheduleWait(outcome.code);
    } else {
      go("failed");
      deps.sink.notify(`realm link failed (${outcome.code})`);
    }
  };

  const cycle = async (): Promise<void> => {
    const workspace = root;
    if (workspace === null || shut) {
      return;
    }
    const attemptNo = streak + 1;
    const startedAt = deps.now().getTime();
    const wasLost = lost;
    const outcome = await attempt(workspace);
    if (outcome.kind === "superseded") {
      return;
    }
    const readback = readbackState();
    if (outcome.kind === "attached") {
      emit(wasLost ? "reattached" : "attached", attemptNo, startedAt, undefined, readback);
    } else if (outcome.kind === "refused") {
      emit("refused", attemptNo, startedAt, outcome.code, readback);
    } else {
      emit("failed", attemptNo, startedAt, outcome.code, null);
    }
    settle(outcome);
  };

  // A lost link. Reported once per loss; with re-attach on and the link up, the client is released and one wait is armed.
  const loseLink = (why: ErrorCode): void => {
    if (!lost) {
      lost = true;
      emit("link-lost", streak + 1, sessionStart, why, readbackState());
    }
    if (enabled && link === "linked") {
      stopPoll();
      release();
      go("reconnecting");
      scheduleWait(why);
    } else {
      show("error", why);
    }
  };

  // One poll tick: repaints a changed state, or reports a lost link.
  const tick = async (): Promise<void> => {
    const daemon = client;
    if (daemon === null || reading) {
      return;
    }
    reading = true;
    try {
      const status = await readStatus(daemon).catch((error: unknown) => codeOf(error));
      if (client !== daemon) {
        return;
      }
      if (typeof status === "string") {
        if (isLinkLostCode(status)) {
          loseLink(status);
        } else {
          show("error", status);
        }
        return;
      }
      lost = false;
      mode = status.mode;
      lastStatus = status;
      if (refusal !== null && refusal.state === status.snapshot.state) {
        show("error", refusal.code);
      } else {
        refusal = null;
        show(status.snapshot.state, undefined);
      }
    } finally {
      reading = false;
    }
  };

  const begin = async (workspace: string): Promise<void> => {
    if (shut) {
      return;
    }
    endAll();
    root = workspace;
    live = true;
    link = enabled ? "attaching" : "off";
    streak = 0;
    refusal = null;
    mode = null;
    lost = false;
    sessionStart = deps.now().getTime();
    await cycle();
  };

  const retry = async (): Promise<void> => {
    if (!live || shut || (enabled && link === "attaching")) {
      return;
    }
    disarm(wait);
    wait = null;
    streak = 0;
    go("attaching");
    await cycle();
  };

  const guard = async (toolName: unknown): Promise<HostGuardVerdict | undefined> => {
    if (typeof toolName !== "string") {
      return backstopVerdict(toolName, mode, STDIO_TOOLS);
    }
    if (shut) {
      return block("REALM_NOT_ACTIVE");
    }
    if (toolName === "retry") {
      return undefined;
    }
    const daemon = client;
    if (isRealmTool(toolName)) {
      return daemon !== null && (link === "off" || link === "linked") ? undefined : block(lastCode ?? "REALM_NOT_ACTIVE");
    }
    if (daemon === null) {
      return block("REALM_NOT_ACTIVE");
    }
    try {
      const status = await readStatus(daemon);
      if (client !== daemon) {
        return block("REALM_NOT_ACTIVE");
      }
      mode = status.mode;
      return backstopVerdict(toolName, status.mode, STDIO_TOOLS);
    } catch (error: unknown) {
      return block(codeOf(error));
    }
  };

  const refused = (name: string | null, code: ErrorCode, retryable: boolean): ToolOutcome => ({
    outcome: "refused",
    tool: name !== null && isRealmTool(name) ? name : null,
    code,
    retryable,
  });
  // Whether a Realm tool call should wait for a fresh attach: no client, or a link that is down.
  const needsAttach = (): boolean => client === null || link === "failed" || link === "reconnecting";
  const retryableNow = (): boolean => link === "reconnecting" || link === "attaching";

  const call = async (tool: unknown): Promise<ToolOutcome> => {
    const name = toolNameOf(tool);
    if (name === null) {
      return refused(null, "SCHEMA_INVALID", false);
    }
    const verdict = await guard(name);
    if (verdict !== undefined) {
      const retryable = retryableNow();
      return refused(name, isErrorCode(verdict.reason) ? verdict.reason : "SCHEMA_INVALID", retryable);
    }
    if (name === "retry" && needsAttach()) {
      await retry();
    }
    const daemon = client;
    if (daemon === null) {
      return refused(name, lastCode ?? "REALM_NOT_ACTIVE", retryableNow());
    }
    try {
      return await daemon.call(tool);
    } catch (error: unknown) {
      const code = codeOf(error);
      const lostLink = isLinkLostCode(code);
      if (lostLink && client === daemon) {
        loseLink(code);
      }
      return refused(name, code, lostLink);
    }
  };

  return {
    start: begin,
    async switchWorkspace(workspace) {
      if (!live || workspace !== root) {
        await begin(workspace);
      }
    },
    status: (): HostLinkStatus => (lastCode === undefined ? { state, mode, link } : { state, mode, link, code: lastCode }),
    guard,
    retry,
    shutdown() {
      if (!shut) {
        shut = true;
        live = false;
        endAll();
        link = "off";
        emit("closed", streak + 1, sessionStart, undefined, readbackState());
      }
      return Promise.resolve();
    },
    call,
    outcome(): BootDriverOutcome {
      const retrying = live && enabled && (link === "reconnecting" || link === "attaching");
      const common = { status: lastStatus, retrying, daemonAnswered };
      if (!shut && client !== null) {
        return refusal === null ? { kind: "ready", ...common } : { kind: "refused", code: refusal.code, ...common };
      }
      return { kind: "failed", code: shut ? "REALM_NOT_ACTIVE" : (lastCode ?? "REALM_NOT_ACTIVE"), ...common };
    },
  };
}

// The one driver factory every mcp-config host shares: the manifest's boot block carries the per-host bounds.
const DRIVER_FACTORY: BootDriverFactory = (deps, manifest) => createBootDriver(deps, resolveBoot(manifest));

// The production factory for a host: the driver for `mcp-config` hosts, null for an `extension` host (Omp keeps its
// in-process plugin, src/omp/plugin.ts).
export function bootHookOf(entry: HostRuntimeEntry): BootDriverFactory | null {
  return entry.integration === "mcp-config" ? DRIVER_FACTORY : null;
}

// Real timers for a process that hosts a driver. Each handle is unref'd, so a pending poll or wait never holds the process.
export const systemTimers: HostTimers = {
  setTimeout: (cb, ms) => setTimeout(cb, ms).unref(),
  setInterval: (cb, ms) => setInterval(cb, ms).unref(),
  clear: (handle) => {
    if (typeof handle === "object" && handle !== null) {
      clearTimeout(handle as NodeJS.Timeout);
    }
  },
};
