// A minimal HostBootHook that conforms to the contract, plus four deliberately broken variants. It is a test double that proves
// the conformance harness (host-boot-conformance.ts) can pass and can fail; it is not a production host. Omp stays the real
// reference until Phase 22. Every bound comes from resolveBoot, and the hook imports nothing from src/omp.

import type { PolicyMode } from "../../src/contract/validate.js";
import { makeRealmError, RealmError, type ErrorCode } from "../../src/core/errors.js";
import type { State } from "../../src/core/states.js";
import type { DaemonClient, DaemonStatus } from "../../src/daemon/client.js";
import { attachFailureDisposition, backstopVerdict, equalJitterDelayMs, reattachTransitionAllowed, resolveBoot, withStartupBudget, type BootLink } from "../../src/host/boot.js";
import type { HostBootDeps, HostBootHook, HostBootHookFactory, HostGuardVerdict, HostLinkStatus, HostPluginManifest } from "../../src/host/types.js";
import { sessionIdOfWorkspace } from "../../src/session/paths.js";

// Each fault is a one-line-class change of the reference.
interface Faults {
  readonly noBudget?: boolean;
  readonly downOnShutdown?: boolean;
  readonly waveThrough?: boolean;
  readonly unboundedReattach?: boolean;
}
type Adopted = { readonly daemon: DaemonClient; readonly refusal: RealmError | null; readonly status: DaemonStatus };
type Outcome =
  | { readonly kind: "attached" }
  | { readonly kind: "superseded" }
  | { readonly kind: "failed"; readonly code: ErrorCode; readonly retryable: boolean };

// Tool names the guard never refuses on its own. A real host lists its own.
const PASS_THROUGH: readonly string[] = ["realm_status", "realm_list", "realm_retry"];
const codeOf = (error: unknown): ErrorCode => (error instanceof RealmError ? error.code : "REALM_NOT_ACTIVE");

function expectedSession(root: string): string | null {
  try {
    return sessionIdOfWorkspace(root);
  } catch {
    return null;
  }
}

function buildHook(deps: HostBootDeps, manifest: HostPluginManifest, faults: Faults): HostBootHook {
  const boot = resolveBoot(manifest);
  const enabled = boot.reattach.enabled;
  const retryCap = faults.unboundedReattach === true ? Number.POSITIVE_INFINITY : boot.reattach.retryCap;
  let root: string | null = null;
  let live = false;
  let client: DaemonClient | null = null;
  let epoch = 0;
  let link: BootLink = "off";
  let state: State = "unbound";
  let mode: PolicyMode | null = null;
  let lastCode: ErrorCode | undefined;
  let refusal: { readonly code: ErrorCode; readonly state: State } | null = null;
  let streak = 0;
  let poll: unknown = null;
  let wait: unknown = null;
  let reading = false;
  let lastText = "";
  // Armed one-shot timers, each with the action that settles its wait when the session ends first.
  const armed = new Map<unknown, () => void>();

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
  // Ends the session's side effects: timers cleared and their waits settled, the poll stopped, the client closed (never taken down).
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
    release();
  };

  // One status read, bounded by the guard budget on the host's own timers.
  const readStatus = (daemon: DaemonClient): Promise<DaemonStatus> =>
    new Promise<DaemonStatus>((resolve, reject) => {
      const timer = arm(boot.guardStatusBudgetMs, () => { reject(makeRealmError("TOOL_TIMEOUT")); }, () => { reject(makeRealmError("REALM_NOT_ACTIVE")); });
      const finish = (done: () => void): void => {
        disarm(timer);
        done();
      };
      void Promise.resolve()
        .then(() => daemon.status())
        .then((value) => { finish(() => { resolve(value); }); }, (error: unknown) => { finish(() => { reject(makeRealmError(codeOf(error))); }); });
    });

  const failed = (error: unknown): Outcome => {
    const code: ErrorCode = error instanceof RealmError ? error.code : "OPENSHELL_START_FAILED";
    show("error", code);
    return { kind: "failed", code, retryable: attachFailureDisposition(error) === "retryable" };
  };

  // Attach and the first status read, together under the startup budget. A client is kept only when the attach returned it.
  const attempt = async (workspace: string): Promise<Outcome> => {
    epoch += 1;
    const mine = epoch;
    stopPoll();
    release();
    refusal = null;
    show("connecting", undefined);
    const work = (async (): Promise<Adopted> => {
      const attached = await deps.attachDaemon(workspace);
      try {
        return { daemon: attached.client, refusal: attached.refusal, status: await attached.client.status() };
      } catch (error: unknown) {
        attached.client.close();
        throw error;
      }
    })();
    let adopted: Adopted;
    try {
      adopted = await (faults.noBudget === true ? work : withStartupBudget(work, boot.startupBudgetMs));
    } catch (error: unknown) {
      // A client that lands after the budget is released, never adopted.
      void work.then((late) => { late.daemon.close(); }, () => undefined);
      return epoch === mine ? failed(error) : { kind: "superseded" };
    }
    const { daemon, status } = adopted;
    if (epoch !== mine) {
      daemon.close();
      return { kind: "superseded" };
    }
    // A reply naming another project's root or session is not adopted. A refused up keeps its client only when the reply names the root.
    const rootOk = status.boundRoot === undefined ? adopted.refusal === null : status.boundRoot === workspace;
    if (!rootOk || status.sessionId !== expectedSession(workspace)) {
      daemon.close();
      return failed(makeRealmError("POLICY_DENIED"));
    }
    client = daemon;
    mode = status.mode;
    const refused = adopted.refusal;
    if (refused === null) {
      show(status.snapshot.state, undefined);
    } else {
      refusal = { code: refused.code, state: status.snapshot.state };
      show("error", refused.code);
    }
    if (status.notice !== undefined) {
      deps.sink.notify(status.notice);
    }
    poll = deps.timers.setInterval(() => { void tick(); }, boot.statusPollMs);
    return refused === null ? { kind: "attached" } : { kind: "failed", code: refused.code, retryable: boot.retryableAttachCodes.includes(refused.code) };
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
    wait = arm(delay, expire, () => { wait = null; });
    deps.sink.notify(`realm link lost (${why}); re-attach attempt ${String(n)} at ${new Date(deps.now().getTime() + delay).toISOString()}`);
    show("connecting", why);
  };

  const settle = (outcome: Outcome): void => {
    if (!enabled || outcome.kind === "superseded") {
      return;
    }
    if (outcome.kind === "attached") {
      streak = 0;
      go("linked");
    } else if (outcome.retryable && streak < retryCap) {
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
    if (root !== null) {
      settle(await attempt(root));
    }
  };

  // One repaint tick. A lost link, with re-attach on, releases the client and arms one wait.
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
        if (enabled && link === "linked" && boot.linkLostCodes.includes(status)) {
          stopPoll();
          release();
          go("reconnecting");
          scheduleWait(status);
        } else {
          show("error", status);
        }
        return;
      }
      mode = status.mode;
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
    endAll();
    root = workspace;
    live = true;
    link = enabled ? "attaching" : "off";
    streak = 0;
    refusal = null;
    mode = null;
    await cycle();
  };

  return {
    start: begin,
    async switchWorkspace(workspace) {
      if (!live || workspace !== root) {
        await begin(workspace);
      }
    },
    status: (): HostLinkStatus => (lastCode === undefined ? { state, mode, link } : { state, mode, link, code: lastCode }),
    async guard(toolName): Promise<HostGuardVerdict | undefined> {
      try {
        if (typeof toolName !== "string") {
          return faults.waveThrough === true ? undefined : backstopVerdict(toolName, mode, PASS_THROUGH);
        }
        const daemon = client;
        if (PASS_THROUGH.includes(toolName)) {
          return undefined;
        }
        if (daemon === null) {
          return { block: true, reason: "REALM_NOT_ACTIVE" };
        }
        const status = await readStatus(daemon);
        if (client !== daemon) {
          return { block: true, reason: "REALM_NOT_ACTIVE" };
        }
        mode = status.mode;
        return backstopVerdict(toolName, status.mode, PASS_THROUGH);
      } catch (error: unknown) {
        return { block: true, reason: codeOf(error) };
      }
    },
    async retry() {
      if (!live || (enabled && link === "attaching")) {
        return;
      }
      disarm(wait);
      wait = null;
      streak = 0;
      go("attaching");
      await cycle();
    },
    async shutdown() {
      live = false;
      if (faults.downOnShutdown === true && client !== null) {
        await client.call({ down: {} }).then(() => undefined, () => undefined);
      }
      endAll();
      link = "off";
    },
  };
}

export const referenceBootHook: HostBootHookFactory = (deps, manifest) => buildHook(deps, manifest, {});
// Attach is not wrapped in the startup budget.
export const noBudgetHook: HostBootHookFactory = (deps, manifest) => buildHook(deps, manifest, { noBudget: true });
// Shutdown also takes the sandbox down.
export const downOnShutdownHook: HostBootHookFactory = (deps, manifest) => buildHook(deps, manifest, { downOnShutdown: true });
// The guard lets a non-string tool name through.
export const waveThroughHook: HostBootHookFactory = (deps, manifest) => buildHook(deps, manifest, { waveThrough: true });
// Re-attach ignores the retry cap.
export const unboundedReattachHook: HostBootHookFactory = (deps, manifest) => buildHook(deps, manifest, { unboundedReattach: true });
