// The Omp conformance double (Phase 22, OMPB-02): a HostBootHookFactory that drives the real plugin (src/omp/plugin.ts,
// createRealmPlugin) through an in-memory Omp host API, so test/support/host-boot-conformance.ts runs against the code Omp
// ships and not against a second implementation. Nothing here reads the environment, arms a real timer or opens a socket: every
// timer the plugin arms goes through HostBootDeps.timers, and every daemon call goes through the fake daemon the harness supplies.
//
// The port maps onto host events: start -> session_start, switchWorkspace -> session_switch, guard -> tool_call, retry -> the
// registered realm-retry command, shutdown -> session_shutdown, status -> the plugin's read-only view().
//
// Two things the double models on purpose, both about the edge and not about the plugin:
//   - Adoption. src/omp/extension.ts owns the attach path, and the root and session checks that keep a reply for another project
//     from being adopted live there. The plugin trusts what attachDaemon returns. The double therefore wraps deps.attachDaemon
//     with the same rule the edge applies: a reply whose boundRoot is another root (or absent on a refused up), or whose session
//     is not the workspace's, is closed and refused with POLICY_DENIED before the plugin sees it.
//   - Poll phase. The plugin arms its repaint poll once per session. The harness advances one poll period after it breaks a link
//     and expects the lost link's wait to be armed at the end of that window, which holds when the poll starts at the moment of the
//     attach. The double re-arms the poll on every settled attach, so a re-attach restarts the poll where the attach happened. It
//     changes when a tick lands in fake time only; the plugin's own poll behavior is unchanged.

import { ERROR_CODES, makeRealmError } from "../../src/core/errors.js";
import type { DaemonStatus } from "../../src/daemon/client.js";
import { resolveBoot } from "../../src/host/boot.js";
import type {
  HostBootDeps,
  HostBootHook,
  HostBootHookFactory,
  HostGuardVerdict,
  HostLinkStatus,
} from "../../src/host/types.js";
import {
  createRealmPlugin,
  REALM_RETRY_COMMAND,
  type DaemonAttach,
  type HostToolCall,
  type HostToolVerdict,
  type OmpExtensionApi,
  type OmpSessionContext,
  type RealmRetryCommand,
} from "../../src/omp/plugin.js";
import type { HostToolDefinition } from "../../src/omp/tools.js";
import { sessionIdOfWorkspace } from "../../src/session/paths.js";

// The built-ins Omp starts with, as the plugin tests' host starts with them (docs/integration/omp.md, spikes S2c and S6).
const OMP_BUILTIN_TOOLS: readonly string[] = [
  "read", "ask", "glob", "grep", "wait", "todo", "web_search", "write", "edit", "bash", "eval", "ast_edit", "lsp", "debug", "task",
];

// The Omp host API the plugin calls, kept in memory: the four events, the retry command and the tool registry. A tool registered
// under a built-in's name takes that built-in's place (spike S1). Every method settles in microtasks.
export class MemoryOmpHost implements OmpExtensionApi {
  readonly startHandlers: Array<(event: unknown, ctx: OmpSessionContext) => void> = [];
  readonly switchHandlers: Array<(event: unknown, ctx: OmpSessionContext) => void> = [];
  readonly shutdownHandlers: Array<() => void> = [];
  readonly toolCallHandlers: Array<(call: HostToolCall) => Promise<HostToolVerdict | undefined>> = [];
  readonly commands = new Map<string, RealmRetryCommand>();
  // Every tool name registerTool was given, in order.
  readonly registrations: string[] = [];
  private readonly builtins = new Set<string>(OMP_BUILTIN_TOOLS);
  private readonly registered = new Set<string>();
  private active = new Set<string>(OMP_BUILTIN_TOOLS);

  on(event: "session_start" | "session_switch", handler: (event: unknown, ctx: OmpSessionContext) => void): void;
  on(event: "session_shutdown", handler: () => void): void;
  on(event: "tool_call", handler: (call: HostToolCall) => Promise<HostToolVerdict | undefined>): void;
  on(event: string, handler: unknown): void {
    if (event === "session_start") {
      this.startHandlers.push(handler as (event: unknown, ctx: OmpSessionContext) => void);
    } else if (event === "session_switch") {
      this.switchHandlers.push(handler as (event: unknown, ctx: OmpSessionContext) => void);
    } else if (event === "session_shutdown") {
      this.shutdownHandlers.push(handler as () => void);
    } else {
      this.toolCallHandlers.push(handler as (call: HostToolCall) => Promise<HostToolVerdict | undefined>);
    }
  }

  registerCommand(name: string, definition: RealmRetryCommand): void {
    this.commands.set(name, definition);
  }

  registerTool(tool: HostToolDefinition): void {
    this.registrations.push(tool.name);
    this.builtins.delete(tool.name);
    this.registered.add(tool.name);
    this.active.add(tool.name);
  }

  getAllTools(): readonly { readonly name: string }[] {
    return [...this.builtins, ...this.registered].map((name) => ({ name }));
  }

  getActiveTools(): readonly string[] {
    return [...this.active];
  }

  setActiveTools(names: string[]): Promise<void> {
    const known = new Set(this.getAllTools().map((tool) => tool.name));
    this.active = new Set(names.filter((name) => known.has(name)));
    return Promise.resolve();
  }
}

// The repaint poll the plugin armed, behind a handle of its own so the double can re-arm it without the plugin noticing.
class PollHandle {
  constructor(
    readonly callback: () => void,
    readonly ms: number,
    public real: unknown,
  ) {}
}

function expectedSession(root: string): string | null {
  try {
    return sessionIdOfWorkspace(root);
  } catch {
    return null;
  }
}

function only<T>(list: readonly T[], what: string): T {
  const first = list[0];
  if (first === undefined) {
    throw new Error(`the plugin registered no ${what}`);
  }
  return first;
}

export const ompBootHook: HostBootHookFactory = (deps: HostBootDeps, manifest): HostBootHook => {
  const boot = resolveBoot(manifest);
  const pi = new MemoryOmpHost();
  const polls = new Set<PollHandle>();
  // Resolvers of start and switchWorkspace calls waiting for the plugin to settle an attach (or to end the session first).
  let waiters: Array<() => void> = [];
  let sessionEnds = 0;

  const wake = (): void => {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) {
      resolve();
    }
  };
  const nextSettle = (): Promise<void> =>
    new Promise<void>((resolve) => {
      waiters.push(resolve);
    });

  // Restarts every repaint poll where this attach happened (see the header).
  const rephasePolls = (): void => {
    for (const poll of polls) {
      deps.timers.clear(poll.real);
      poll.real = deps.timers.setInterval(poll.callback, poll.ms);
    }
  };

  // The edge's adoption rule, applied to the harness's scripted attach.
  const attachDaemon = async (workspaceRoot: string): Promise<DaemonAttach> => {
    const attached = await deps.attachDaemon(workspaceRoot);
    let status: DaemonStatus;
    try {
      status = await attached.client.status();
    } catch (error: unknown) {
      attached.client.close();
      throw error;
    }
    const rootOk = status.boundRoot === undefined ? attached.refusal === null : status.boundRoot === workspaceRoot;
    if (!rootOk || status.sessionId !== expectedSession(workspaceRoot)) {
      attached.client.close();
      throw makeRealmError("POLICY_DENIED");
    }
    return attached;
  };

  const plugin = createRealmPlugin(pi, {
    attachDaemon,
    reattach: { enabled: boot.reattach.enabled, random: deps.random },
    bounds: boot,
    onAttach: (outcome) => {
      if (outcome.outcome === "attached") {
        rephasePolls();
      }
      wake();
    },
    onSessionEnd: () => {
      sessionEnds += 1;
      wake();
    },
  });

  const contextFor = (root: string): OmpSessionContext => ({
    cwd: root,
    // The widget region sink (ADR-0002): Omp paints call setWidget; the fake records them via the
    // host-neutral sink's status list so conformance assertions read one array. The 2-method
    // HostStatusSink shape (src/host/types.ts) is unchanged; this bridge is test-only.
    ui: {
      setWidget: (key: string, text: string): void => {
        deps.sink.setStatus(key, text);
      },
      notify: (message: string): void => {
        deps.sink.notify(message);
      },
    },
    setTimeout: (callback, ms) => deps.timers.setTimeout(callback, ms),
    setInterval: (callback, ms) => {
      const poll = new PollHandle(callback, ms, deps.timers.setInterval(callback, ms));
      polls.add(poll);
      return poll;
    },
    clearTimer: (handle) => {
      if (handle instanceof PollHandle) {
        polls.delete(handle);
        deps.timers.clear(handle.real);
        return;
      }
      deps.timers.clear(handle);
    },
  });

  return {
    async start(workspaceRoot) {
      const context = contextFor(workspaceRoot);
      for (const handler of pi.startHandlers) {
        handler({ type: "session_start" }, context);
      }
      await nextSettle();
    },
    async switchWorkspace(workspaceRoot) {
      const endsBefore = sessionEnds;
      const context = contextFor(workspaceRoot);
      for (const handler of pi.switchHandlers) {
        handler({ type: "session_switch" }, context);
      }
      // A switch that keeps the attachment ends no session and starts no attach.
      if (sessionEnds !== endsBefore) {
        await nextSettle();
      }
    },
    status(): HostLinkStatus {
      const view = plugin.view();
      const code = view.code === undefined ? undefined : ERROR_CODES.find((candidate) => candidate === view.code);
      const base = { state: view.state, mode: view.mode, link: view.link };
      return code === undefined ? base : { ...base, code };
    },
    async guard(toolName): Promise<HostGuardVerdict | undefined> {
      const verdict = await only(pi.toolCallHandlers, "tool_call handler")({ toolName });
      return verdict?.block === true ? { block: true, reason: verdict.reason ?? "" } : undefined;
    },
    async retry() {
      const command = pi.commands.get(REALM_RETRY_COMMAND);
      if (command === undefined) {
        throw new Error("the plugin registered no retry command");
      }
      await command.handler();
    },
    shutdown() {
      for (const handler of pi.shutdownHandlers) {
        handler();
      }
      return Promise.resolve();
    },
  };
};
