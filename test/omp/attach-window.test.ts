import { test } from "node:test";
import assert from "node:assert/strict";
import type { StateSnapshot } from "../../src/core/state-machine.js";
import { STATUS_LABELS, displayStatus } from "../../src/core/status.js";
import type { DaemonClient, DaemonStatus } from "../../src/daemon/client.js";
import type { MetricsSnapshot } from "../../src/observe/metrics.js";
import type { PolicyMode } from "../../src/contract/validate.js";
import type { ToolOutcome } from "../../src/tools/dispatch.js";
import type { HostToolDefinition } from "../../src/omp/tools.js";
import {
  REALM_STATUS_KEY,
  createRealmPlugin,
  type DaemonAttach,
  type HostToolCall,
  type HostToolVerdict,
  type OmpExtensionApi,
  type OmpSessionContext,
  type OmpStatusUi,
  type RealmPluginOptions,
} from "../../src/omp/plugin.js";

// OMPR-05 (K2): the not-active window of the Omp path. The extension starts the attach one event-loop turn after the
// session_start handler returns (deferStart). Here the deferral is a manual one the test releases, and the daemon is a
// stand-in whose up is held open until the test opens it, so no clock, socket or process is involved. The window proves that
// fail closed is intact: until a client is adopted a Realm call is refused with REALM_NOT_ACTIVE and never reaches the daemon,
// the host tool set is untouched, and the guard blocks a guarded built-in. A session that ended or was superseded before the
// deferral ran starts no attach, so no daemon would be spawned for it.

const CLOCK_ISO = "2026-11-19T09:30:00.000Z";
const ACTIVE: StateSnapshot = { state: "active", reason: "container running", lastTransitionAt: CLOCK_ISO };
const ACTIVE_LABEL = `● ${STATUS_LABELS.active}`;
const WORKSPACE = "/ws";
const SEPARATOR = " · ";

// One turn of the event loop: every promise chain here settles in microtasks, so a turn flushes a completed tick.
function yieldTurn(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) {
      return;
    }
    await yieldTurn();
  }
  assert.fail("timed out waiting for condition");
}

interface Gate {
  readonly promise: Promise<void>;
  readonly open: () => void;
}

// A promise the test opens by hand.
function makeGate(): Gate {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    open = () => {
      done();
    };
  });
  return { promise, open };
}

class FakeUi implements OmpStatusUi {
  readonly texts: string[] = [];

  setWidget(key: string, text: string | string[]): void {
    if (key === REALM_STATUS_KEY) {
      this.texts.push(Array.isArray(text) ? text.join("\n") : text);
    }
  }

  notify(): void {
    // Notices are not part of this window.
  }

  last(): string {
    return this.texts.at(-1) ?? "";
  }
}

class FakeCtx implements OmpSessionContext {
  readonly armed: unknown[] = [];
  readonly cleared: unknown[] = [];
  private sequence = 0;

  constructor(
    readonly ui: FakeUi,
    readonly cwd: string,
  ) {}

  // Timers are manual: nothing here fires one.
  setTimeout(): unknown {
    this.sequence += 1;
    this.armed.push(this.sequence);
    return this.sequence;
  }

  setInterval(): unknown {
    this.sequence += 1;
    this.armed.push(this.sequence);
    return this.sequence;
  }

  clearTimer(handle: unknown): void {
    this.cleared.push(handle);
  }
}

// The stand-in daemon client: it records every method the plugin invokes.
class StandIn implements DaemonClient {
  readonly calls: string[] = [];
  readonly dispatched: unknown[] = [];
  outcome: ToolOutcome = { outcome: "refused", tool: "write", code: "REALM_UNBOUND", retryable: false };

  status(): Promise<DaemonStatus> {
    this.calls.push("status");
    const mode: PolicyMode = "fail-closed";
    return Promise.resolve({ snapshot: ACTIVE, display: displayStatus(ACTIVE), mode, sessionId: "p0123456789ab" });
  }

  up(): Promise<DaemonStatus> {
    this.calls.push("up");
    return this.status();
  }

  call(tool: unknown): Promise<ToolOutcome> {
    this.calls.push("call");
    this.dispatched.push(tool);
    return Promise.resolve(this.outcome);
  }

  metrics(): Promise<MetricsSnapshot> {
    return Promise.reject(new Error("the plugin never reads metrics"));
  }

  close(): void {
    this.calls.push("close");
  }
}

const OMP_BUILTIN_TOOLS: readonly string[] = ["read", "glob", "grep", "write", "edit", "bash", "eval", "ast_edit"];

class FakePi implements OmpExtensionApi {
  readonly startHandlers: Array<(event: unknown, ctx: OmpSessionContext) => void> = [];
  readonly shutdownHandlers: Array<() => void> = [];
  readonly toolCallHandlers: Array<(call: HostToolCall) => Promise<HostToolVerdict | undefined>> = [];
  readonly tools = new Map<string, HostToolDefinition>();
  readonly activeSets: string[][] = [];
  private readonly builtins = new Set<string>(OMP_BUILTIN_TOOLS);
  private readonly active = new Set<string>(OMP_BUILTIN_TOOLS);

  on(event: "session_start" | "session_switch", handler: (event: unknown, ctx: OmpSessionContext) => void): void;
  on(event: "session_shutdown", handler: () => void): void;
  on(event: "tool_call", handler: (call: HostToolCall) => Promise<HostToolVerdict | undefined>): void;
  on(event: string, handler: unknown): void {
    if (event === "session_start") {
      this.startHandlers.push(handler as (event: unknown, ctx: OmpSessionContext) => void);
    } else if (event === "session_shutdown") {
      this.shutdownHandlers.push(handler as () => void);
    } else if (event === "tool_call") {
      this.toolCallHandlers.push(handler as (call: HostToolCall) => Promise<HostToolVerdict | undefined>);
    }
  }

  registerCommand(): void {
    // The retry command is not part of this window.
  }

  registerTool(tool: HostToolDefinition): void {
    this.tools.set(tool.name, tool);
    this.builtins.delete(tool.name);
    this.active.add(tool.name);
  }

  getAllTools(): { readonly name: string }[] {
    return [...this.builtins, ...this.tools.keys()].map((name) => ({ name }));
  }

  getActiveTools(): string[] {
    return [...this.active];
  }

  setActiveTools(names: string[]): Promise<void> {
    this.activeSets.push([...names]);
    const known = new Set(this.getAllTools().map((tool) => tool.name));
    this.active.clear();
    for (const name of names) {
      if (known.has(name)) {
        this.active.add(name);
      }
    }
    return Promise.resolve();
  }
}

interface Rig {
  readonly pi: FakePi;
  readonly ui: FakeUi;
  readonly standIn: StandIn;
  // The workspace root of every attachDaemon call: where a daemon would be ensured, spawned and dialled.
  readonly attachCalls: string[];
  // The start callbacks the plugin handed to deferStart, in order; a test runs them by hand.
  readonly deferred: Array<() => void>;
  // Opens the stand-in's held up.
  readonly openUp: () => void;
  readonly ctxOf: (cwd: string) => FakeCtx;
  readonly start: (ctx: OmpSessionContext) => void;
}

function makeRig(options: { readonly deferred: boolean }): Rig {
  const pi = new FakePi();
  const ui = new FakeUi();
  const standIn = new StandIn();
  const attachCalls: string[] = [];
  const deferred: Array<() => void> = [];
  const up = makeGate();
  const pluginOptions: RealmPluginOptions = {
    attachDaemon: async (workspaceRoot: string): Promise<DaemonAttach> => {
      attachCalls.push(workspaceRoot);
      await up.promise;
      return { client: standIn, refusal: null };
    },
    ...(options.deferred
      ? {
          deferStart: (start: () => void): void => {
            deferred.push(start);
          },
        }
      : {}),
  };
  createRealmPlugin(pi, pluginOptions);
  const handler = pi.startHandlers[0];
  assert.ok(handler !== undefined, "session_start handler is registered");
  return {
    pi,
    ui,
    standIn,
    attachCalls,
    deferred,
    openUp: up.open,
    ctxOf: (cwd) => new FakeCtx(ui, cwd),
    start: (ctx) => {
      handler({ type: "session_start" }, ctx);
    },
  };
}

function toolOf(pi: FakePi, name: string): HostToolDefinition {
  const tool = pi.tools.get(name);
  assert.ok(tool !== undefined, `${name} tool is registered`);
  return tool;
}

function toolCallOf(pi: FakePi): (call: HostToolCall) => Promise<HostToolVerdict | undefined> {
  const handler = pi.toolCallHandlers[0];
  assert.ok(handler !== undefined, "tool_call handler is registered");
  return handler;
}

function detailOf(text: string): string {
  return text.split(SEPARATOR).slice(1, -1).join(SEPARATOR);
}

const NOT_ACTIVE = { outcome: "refused", code: "REALM_NOT_ACTIVE", retryable: true };

void test("OMPR-05: the session_start handler returns while the deferral is held and nothing has started", async () => {
  const rig = makeRig({ deferred: true });
  rig.start(rig.ctxOf(WORKSPACE));
  await yieldTurn();
  await yieldTurn();

  assert.equal(rig.ui.texts.length, 1, "only the connecting render has landed");
  assert.ok(detailOf(rig.ui.last()).startsWith("connecting"), "the status item shows connecting");
  assert.equal(rig.deferred.length, 1, "the attach waits for the deferral");
  assert.deepEqual(rig.attachCalls, [], "attachDaemon has not been called, so nothing was ensured, spawned or dialled");
  assert.deepEqual(rig.standIn.calls, [], "the stand-in has seen no connection");
  assert.deepEqual(rig.pi.activeSets, [], "the host tool set has not been changed");
});

void test("OMPR-05: a session that ended before the deferral ran never attaches and leaves no timer or client behind", async () => {
  const rig = makeRig({ deferred: true });
  const ctx = rig.ctxOf(WORKSPACE);
  rig.start(ctx);
  const shutdown = rig.pi.shutdownHandlers[0];
  assert.ok(shutdown !== undefined, "session_shutdown handler is registered");
  shutdown();
  const [start] = rig.deferred;
  assert.ok(start !== undefined);
  start();
  await yieldTurn();
  await yieldTurn();

  assert.deepEqual(rig.attachCalls, [], "no attach for an ended session");
  assert.deepEqual(rig.standIn.calls, []);
  assert.deepEqual([...ctx.armed].sort(), [...ctx.cleared].sort(), "every timer the attempt armed was cleared");
  assert.deepEqual(rig.pi.activeSets, [], "the host tool set has not been changed");
});

void test("OMPR-05: a second session_start before the deferral runs supersedes the first, and one attach runs for the second", async () => {
  const rig = makeRig({ deferred: true });
  rig.start(rig.ctxOf("/first"));
  rig.start(rig.ctxOf("/second"));
  assert.equal(rig.deferred.length, 2, "each session handed the edge its own start");
  for (const start of rig.deferred) {
    start();
  }
  await yieldTurn();
  await yieldTurn();

  assert.deepEqual(rig.attachCalls, ["/second"], "attachDaemon ran once, for the second session's directory");
});

void test("OMPR-05: with the deferral run and the up held open, Realm calls are refused and the guard blocks the built-in", async () => {
  const rig = makeRig({ deferred: true });
  rig.start(rig.ctxOf(WORKSPACE));
  rig.deferred[0]?.();
  await waitUntil(() => rig.attachCalls.length === 1);
  assert.deepEqual(rig.attachCalls, [WORKSPACE]);

  const write = await toolOf(rig.pi, "write").execute("call-1", { path: "a.txt", content: "hi" });
  assert.equal(write.isError, true);
  assert.deepEqual(write.details, { ...NOT_ACTIVE, tool: "write" });
  const exec = await toolOf(rig.pi, "exec").execute("call-2", { argv: ["ls"] });
  assert.equal(exec.isError, true);
  assert.deepEqual(exec.details, { ...NOT_ACTIVE, tool: "exec" });
  assert.deepEqual(rig.standIn.calls, [], "no tool request reaches the daemon");
  assert.deepEqual(await toolCallOf(rig.pi)({ toolName: "edit" }), { block: true, reason: "REALM_NOT_ACTIVE" });
  assert.deepEqual(rig.pi.activeSets, [], "the host tool set has not been changed");
  assert.ok(detailOf(rig.ui.last()).startsWith("connecting"), "the item still shows connecting");
});

void test("OMPR-05: when the daemon answers, the same session adopts the client and the next Realm call is forwarded", async () => {
  const rig = makeRig({ deferred: true });
  rig.start(rig.ctxOf(WORKSPACE));
  rig.deferred[0]?.();
  await waitUntil(() => rig.attachCalls.length === 1);
  rig.openUp();
  await waitUntil(() => rig.ui.last().startsWith(ACTIVE_LABEL));

  rig.standIn.outcome = { outcome: "refused", tool: "write", code: "REALM_UNBOUND", retryable: false };
  const result = await toolOf(rig.pi, "write").execute("call-3", { path: "a.txt", content: "hi" });
  assert.deepEqual(rig.standIn.dispatched, [{ write: { path: "a.txt", content: "hi" } }], "the call is forwarded to the stand-in");
  assert.deepEqual(result.details, rig.standIn.outcome);
});

void test("OMPR-05: without a deferStart option the attach starts in a microtask, as before", async () => {
  const rig = makeRig({ deferred: false });
  rig.start(rig.ctxOf(WORKSPACE));
  await yieldTurn();

  assert.deepEqual(rig.attachCalls, [WORKSPACE]);
  assert.deepEqual(rig.deferred, []);
  rig.openUp();
  await waitUntil(() => rig.ui.last().startsWith(ACTIVE_LABEL));
});
