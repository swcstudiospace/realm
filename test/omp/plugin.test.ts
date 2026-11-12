import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ERROR_CODES, makeRealmError, type ErrorCode } from "../../src/core/errors.js";
import type { StateSnapshot } from "../../src/core/state-machine.js";
import { STATUS_LABELS, displayStatus } from "../../src/core/status.js";
import type { DaemonClient, DaemonStatus } from "../../src/daemon/client.js";
import type { MetricsSnapshot } from "../../src/observe/metrics.js";
import type { PolicyMode } from "../../src/contract/validate.js";
import type { ToolOutcome } from "../../src/tools/dispatch.js";
import type { HostToolDefinition } from "../../src/omp/tools.js";
import {
  GUARD_STATUS_BUDGET_MS,
  GUARDED_HOST_TOOLS,
  REALM_RETRY_COMMAND,
  REALM_STATUS_KEY,
  STARTUP_BUDGET_MS,
  STATUS_POLL_MS,
  guardHostToolCall,
  registerRealmPlugin,
  renderRealmStatus,
  type DaemonAttach,
  type ActiveSession,
  type HostToolCall,
  type HostToolVerdict,
  type OmpExtensionApi,
  type OmpSessionContext,
  type OmpStatusUi,
  type RealmPluginOptions,
  type RealmRetryCommand,
} from "../../src/omp/plugin.js";
import {
  equalJitterDelayMs,
  LINK_LOST_CODES,
  REATTACH_BASE_DELAY_MS,
  REATTACH_DELAY_CAP_MS,
  REATTACH_RETRY_CAP,
  reattachTransitionAllowed,
  RETRYABLE_ATTACH_CODES,
  type ReattachState,
} from "../../src/omp/reattach.js";
import { hostToolSetOf, type HostToolSet } from "../../src/omp/host-tools.js";

// OMP-01 to OMP-05 plugin proof (P5-D4 to P5-D6, P5-D8, P5-D14). Every test runs the real plugin
// wiring against a FakeDaemon injected through attachDaemon. The doubles are the FakePi host
// (capturing handlers and commands), the FakeCtx managed timers (manual: a test fires them), and the
// FakeDaemon client. Required mode is the fail-closed policy mode, which is also the policy default; advisory is an explicit opt-in.

const CLOCK_ISO = "2026-10-21T09:30:00.000Z";
const ACTIVE: StateSnapshot = { state: "active", reason: "container running", lastTransitionAt: CLOCK_ISO };
const CONNECTING: StateSnapshot = { state: "connecting", reason: "connecting", lastTransitionAt: CLOCK_ISO };
const UNBOUND: StateSnapshot = { state: "unbound", reason: "no workspace", lastTransitionAt: CLOCK_ISO };
const ACTIVE_LABEL = `● ${STATUS_LABELS.active}`;
const DEGRADED_LABEL = `● ${STATUS_LABELS.active} [degraded]`;
const DISCONNECTED_LABEL = `○ ${STATUS_LABELS.disconnected}`;
const WORKSPACE = "/ws";
const SEPARATOR = " · ";
const FAIL_CLOSED_STATUS = "applied mode: fail-closed (Omp host-tool guard; not host process containment)";
const LAST_FAIL_CLOSED_STATUS = "last successfully applied mode: fail-closed (Omp host-tool guard; not host process containment)";
const ADVISORY_STATUS = "applied mode: advisory";
const LAST_ADVISORY_STATUS = "last successfully applied mode: advisory";
const UNKNOWN_STATUS = "mode: unknown";

// Yields one turn of the event loop. No wall-clock wait: the awaited conditions settle on promises.
// Every promise chain in these tests settles in microtasks, so one turn flushes a completed tick.
function yieldTurn(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

interface Gate {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

// A promise the test opens by hand. The executor captures the resolver, so no wall clock is involved.
function makeGate(): Gate {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = () => { done(); };
  });
  return { promise, resolve };
}

class FakeUi implements OmpStatusUi {
  readonly calls: Array<{ readonly key: string; readonly text: string }> = [];
  readonly notifications: string[] = [];

  setStatus(key: string, text: string): void {
    this.calls.push({ key, text });
  }

  notify(message: string): void {
    this.notifications.push(message);
  }

  texts(key: string): string[] {
    return this.calls.filter((call) => call.key === key).map((call) => call.text);
  }
}

// The status item is "<label> · <reason> · <time> · <mode disclosure>".
function labelOf(text: string): string {
  return text.split(SEPARATOR)[0] ?? "";
}

// Existing detail checks cover the reason and time; mode checks use the complete status text.
function detailOf(text: string): string {
  return text.split(SEPARATOR).slice(1, -1).join(SEPARATOR);
}

function statusTexts(ui: FakeUi): string[] {
  return ui.texts(REALM_STATUS_KEY);
}

function labelsOf(ui: FakeUi): string[] {
  return statusTexts(ui).map(labelOf);
}

function detailsOf(ui: FakeUi): string[] {
  return statusTexts(ui).map(detailOf);
}

function lastLabel(ui: FakeUi): string | undefined {
  const last = statusTexts(ui).at(-1);
  return last === undefined ? undefined : labelOf(last);
}

function lastDetail(ui: FakeUi): string | undefined {
  const last = statusTexts(ui).at(-1);
  return last === undefined ? undefined : detailOf(last);
}

interface ArmedTimer {
  readonly ms: number;
  readonly callback: () => void;
  readonly handle: number;
}

class FakeCtx implements OmpSessionContext {
  readonly timeouts: number[] = [];
  readonly armed: ArmedTimer[] = [];
  readonly intervals: ArmedTimer[] = [];
  readonly cleared: unknown[] = [];
  private sequence = 0;

  constructor(
    readonly ui: OmpStatusUi,
    readonly cwd: string,
  ) {}

  // Timers are manual: a test fires an armed callback itself, so no wall clock runs in this file.
  setTimeout(callback: () => void, ms: number): unknown {
    this.timeouts.push(ms);
    this.sequence += 1;
    const handle = this.sequence;
    this.armed.push({ ms, callback, handle });
    return handle;
  }

  setInterval(callback: () => void, ms: number): unknown {
    this.sequence += 1;
    const handle = this.sequence;
    this.intervals.push({ ms, callback, handle });
    return handle;
  }

  clearTimer(handle: unknown): void {
    this.cleared.push(handle);
    // Nothing runs on a timer here, so clearing only records the handle.
  }
}

class FakeDaemon implements DaemonClient {
  // Every method the plugin invokes, in order. down is not a client method, so it never appears.
  readonly calls: string[] = [];
  snapshot: StateSnapshot;
  mode: PolicyMode;
  hangStatus = false;
  notice: string | undefined = undefined;
  // When set, every status read is refused by the channel with this code, as a dropped link is.
  failStatus: ErrorCode | undefined = undefined;

  constructor(snapshot: StateSnapshot, mode: PolicyMode) {
    this.snapshot = snapshot;
    this.mode = mode;
  }

  status(): Promise<DaemonStatus> {
    this.calls.push("status");
    if (this.failStatus !== undefined) {
      return Promise.reject(makeRealmError(this.failStatus));
    }
    if (this.hangStatus) {
      return new Promise<DaemonStatus>(() => undefined);
    }
    return Promise.resolve(this.value());
  }

  up(): Promise<DaemonStatus> {
    this.calls.push("up");
    return Promise.resolve(this.value());
  }

  // The outcome the next dispatch answers with. Unset, a dispatch rejects, so a test that expects none fails loudly.
  callOutcome: ToolOutcome | undefined = undefined;
  // When set, every dispatch is refused by the daemon with this catalogue code, as client.call rejects with the daemon's refusal.
  callError: ErrorCode | undefined = undefined;
  readonly dispatched: unknown[] = [];

  call(tool: unknown): Promise<ToolOutcome> {
    this.calls.push("call");
    this.dispatched.push(tool);
    if (this.callError !== undefined) {
      return Promise.reject(makeRealmError(this.callError));
    }
    if (this.callOutcome === undefined) {
      return Promise.reject(new Error("no dispatch outcome was configured"));
    }
    return Promise.resolve(this.callOutcome);
  }

  metrics(): Promise<MetricsSnapshot> {
    return Promise.reject(new Error("the plugin never reads metrics"));
  }

  close(): void {
    this.calls.push("close");
  }

  count(name: string): number {
    return this.calls.filter((call) => call === name).length;
  }

  private value(): DaemonStatus {
    const base = { snapshot: this.snapshot, display: displayStatus(this.snapshot), mode: this.mode, sessionId: "p0123456789ab" };
    return this.notice === undefined ? base : { ...base, notice: this.notice };
  }
}

// The built-in tool names of Omp 18.12.6 (docs/integration/omp.md, Enforcement spike S2c and S6): the fake's starting set.
const OMP_BUILTIN_TOOLS: readonly string[] = ["read", "ask", "glob", "grep", "wait", "todo", "web_search", "write", "edit", "bash", "eval", "ast_edit", "lsp", "debug", "task"];

class FakePi implements OmpExtensionApi {
  readonly startHandlers: Array<(event: unknown, ctx: OmpSessionContext) => void> = [];
  readonly switchHandlers: Array<(event: unknown, ctx: OmpSessionContext) => void> = [];
  readonly shutdownHandlers: Array<() => void> = [];
  readonly toolCallHandlers: Array<(call: HostToolCall) => Promise<HostToolVerdict | undefined>> = [];
  readonly commands = new Map<string, RealmRetryCommand>();

  on(event: "session_start" | "session_switch", handler: (event: unknown, ctx: OmpSessionContext) => void): void;
  on(event: "session_shutdown", handler: () => void): void;
  on(event: "tool_call", handler: (call: HostToolCall) => Promise<HostToolVerdict | undefined>): void;
  on(event: string, handler: unknown): void {
    if (event === "session_start") {
      this.startHandlers.push(handler as (event: unknown, ctx: OmpSessionContext) => void);
      return;
    }
    if (event === "session_switch") {
      this.switchHandlers.push(handler as (event: unknown, ctx: OmpSessionContext) => void);
      return;
    }
    if (event === "session_shutdown") {
      this.shutdownHandlers.push(handler as () => void);
      return;
    }
    this.toolCallHandlers.push(handler as (call: HostToolCall) => Promise<HostToolVerdict | undefined>);
  }

  registerCommand(name: string, definition: RealmRetryCommand): void {
    this.commands.set(name, definition);
  }

  readonly tools = new Map<string, HostToolDefinition>();
  // Every tool name registerTool was given, in order, so a test can see that a re-attach registers nothing again.
  readonly registrations: string[] = [];
  // Each setActiveTools call, as the plugin passed it.
  readonly activeSets: string[][] = [];
  // When set, setActiveTools is accepted and changes nothing, so the plugin's read-back must catch it.
  ignoreRemoval = false;
  // A rejecting host setter models a different failure from a setter that returns without applying.
  rejectSetter = false;
  // When set, a setter applies its change only once this gate opens, so a test can hold a setter past its owner.
  holdSetters: Promise<void> | null = null;
  activeReads = 0;
  activeReadOverride: ((count: number, actual: string[]) => string[]) | null = null;
  private readonly builtins = new Set<string>(OMP_BUILTIN_TOOLS);
  private readonly active = new Set<string>(OMP_BUILTIN_TOOLS);

  registerTool(tool: HostToolDefinition): void {
    this.tools.set(tool.name, tool);
    this.registrations.push(tool.name);
    // An extension tool under a built-in's name takes that built-in's place (spike S1).
    this.builtins.delete(tool.name);
    this.active.add(tool.name);
  }

  // Omp stops reporting a built-in, as when the extension that owned it unloads.
  dropBuiltin(name: string): void {
    this.builtins.delete(name);
    this.active.delete(name);
  }

  getAllTools(): { readonly name: string }[] {
    return [...this.builtins, ...this.tools.keys()].map((name) => ({ name }));
  }

  getActiveTools(): string[] {
    this.activeReads += 1;
    const actual = [...this.active];
    return this.activeReadOverride?.(this.activeReads, actual) ?? actual;
  }

  setActiveTools(names: string[]): Promise<void> {
    this.activeSets.push([...names]);
    if (this.rejectSetter) {
      return Promise.reject(new Error("host setter rejected"));
    }
    const apply = (): void => {
      if (this.ignoreRemoval) {
        return;
      }
      const known = new Set(this.getAllTools().map((tool) => tool.name));
      this.active.clear();
      for (const name of names) {
        if (known.has(name)) {
          this.active.add(name);
        }
      }
    };
    if (this.holdSetters === null) {
      apply();
      return Promise.resolve();
    }
    return this.holdSetters.then(apply);
  }
}

interface FixtureOptions {
  // The mode the fake daemon reports. Omitted means fail-closed, the policy default; advisory tests say so.
  readonly mode?: PolicyMode;
  readonly snapshot?: StateSnapshot;
  // One entry per attach, in order: a code rejects that attach with it; an absent entry resolves.
  readonly attachErrors?: readonly ErrorCode[];
  // Replaces the default attach; it receives the fixture daemon. The fixture still records each attach's workspace root.
  readonly attach?: (daemon: FakeDaemon) => Promise<DaemonAttach>;
  // Bounded re-attach (O4). Omitted means the attach-once behaviour the existing tests pin.
  readonly reattach?: { readonly enabled: boolean; readonly random: () => number };
}

interface Fixture {
  readonly ui: FakeUi;
  readonly ctx: FakeCtx;
  readonly pi: FakePi;
  readonly tools: HostToolSet;
  readonly daemon: FakeDaemon;
  readonly attachCalls: string[];
}

function makeFixture(options: FixtureOptions = {}): Fixture {
  const ui = new FakeUi();
  const ctx = new FakeCtx(ui, WORKSPACE);
  const pi = new FakePi();
  const daemon = new FakeDaemon(options.snapshot ?? ACTIVE, options.mode ?? "fail-closed");
  const attachCalls: string[] = [];
  const pendingErrors = [...(options.attachErrors ?? [])];
  const pluginOptions: RealmPluginOptions = {
    attachDaemon: (workspaceRoot: string) => {
      attachCalls.push(workspaceRoot);
      if (options.attach !== undefined) {
        return options.attach(daemon);
      }
      const code = pendingErrors.shift();
      if (code !== undefined) {
        return Promise.reject(makeRealmError(code));
      }
      return Promise.resolve({ client: daemon, refusal: null });
    },
    ...(options.reattach === undefined ? {} : { reattach: options.reattach }),
  };
  const tools = registerRealmPlugin(pi, pluginOptions);
  return { ui, ctx, pi, daemon, attachCalls, tools };
}

// The host calls a session_switch handler with the event first and the context of the session switched to second. The
// payload is not assumed: a test passes a context without a working directory to read it defensively.
function switchHandlerOf(pi: FakePi): (ctx: OmpSessionContext) => void {
  const handler = pi.switchHandlers[0];
  assert.ok(handler !== undefined, "session_switch handler is registered");
  return (ctx) => {
    handler({ type: "session_switch" }, ctx);
  };
}

function startHandlerOf(pi: FakePi): (ctx: OmpSessionContext) => void {
  const handler = pi.startHandlers[0];
  assert.ok(handler !== undefined, "session_start handler is registered");
  // The host calls a session_start handler with the event first and the context second.
  return (ctx) => {
    handler({ type: "session_start" }, ctx);
  };
}

function toolSetOf(pi: OmpExtensionApi): HostToolSet {
  return hostToolSetOf(pi);
}

function toolCallOf(pi: FakePi): (call: HostToolCall) => Promise<HostToolVerdict | undefined> {
  const handler = pi.toolCallHandlers[0];
  assert.ok(handler !== undefined, "tool_call handler is registered");
  return handler;
}

function retryCommandOf(pi: FakePi): RealmRetryCommand {
  const command = pi.commands.get(REALM_RETRY_COMMAND);
  assert.ok(command !== undefined, "retry command is registered");
  return command;
}

function shutdownHandlerOf(pi: FakePi): () => void {
  const handler = pi.shutdownHandlers[0];
  assert.ok(handler !== undefined, "session_shutdown handler is registered");
  return handler;
}

async function waitForDetail(ui: FakeUi, needle: string): Promise<string> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const found = detailsOf(ui).find((detail) => detail.includes(needle));
    if (found !== undefined) {
      return found;
    }
    await yieldTurn();
  }
  assert.fail(`timed out waiting for detail containing ${needle}`);
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

// The most recently armed timer with this duration, cleared or not. Tests fire it by hand to
// model a host that runs a timer callback at its expiry.
function armedTimer(ctx: FakeCtx, ms: number): ArmedTimer {
  const entry = ctx.armed.findLast((armed) => armed.ms === ms);
  assert.ok(entry !== undefined, `a ${String(ms)} ms timer was armed`);
  return entry;
}

function expireTimer(ctx: FakeCtx, ms: number): void {
  const entry = armedTimer(ctx, ms);
  entry.callback();
  ctx.clearTimer(entry.handle);
}

// The most recent repaint poll: the one armed by the latest session start.
function pollOf(ctx: FakeCtx): ArmedTimer {
  const entry = ctx.intervals.findLast((interval) => interval.ms === STATUS_POLL_MS);
  assert.ok(entry !== undefined, `a ${String(STATUS_POLL_MS)} ms poll was armed`);
  return entry;
}

// Waits until the start attach has settled: the connecting render and the settled render are both painted.
async function waitForSettledDetails(fixture: Fixture): Promise<void> {
  await waitUntil(() => statusTexts(fixture.ui).length >= 2);
}

void test("OMP-01: session start attaches the daemon for the session cwd and returns while connecting (P5-D8)", async () => {
  const gate = makeGate();
  const fixture = makeFixture({
    attach: async (daemon) => {
      await gate.promise;
      return { client: daemon, refusal: null };
    },
  });

  startHandlerOf(fixture.pi)(fixture.ctx);

  // The handler returned while the attach is still in flight: only the connecting render has landed.
  assert.deepEqual(labelsOf(fixture.ui), [DISCONNECTED_LABEL]);
  assert.ok(detailsOf(fixture.ui)[0]?.startsWith("connecting · "), "connecting detail paints first");
  assert.ok(fixture.ctx.timeouts.includes(STARTUP_BUDGET_MS), "the attach runs under the startup budget");
  // attachDaemon is invoked from a microtask, so the workspace root is observed after one turn of the event loop.
  await yieldTurn();
  assert.deepEqual(fixture.attachCalls, [WORKSPACE]);

  gate.resolve();
  await waitUntil(() => lastLabel(fixture.ui) === ACTIVE_LABEL);
  assert.equal(lastDetail(fixture.ui), `container running · ${CLOCK_ISO}`);
});

void test("OMP-01: a successful attach renders the status the daemon reports and never ups the realm (P5-D5)", async () => {
  const fixture = makeFixture();
  startHandlerOf(fixture.pi)(fixture.ctx);

  await waitForDetail(fixture.ui, "container running");
  assert.equal(lastLabel(fixture.ui), ACTIVE_LABEL);
  assert.equal(lastDetail(fixture.ui), `container running · ${CLOCK_ISO}`);
  assert.equal(fixture.daemon.count("status"), 1, "attach reads status once");
  assert.equal(fixture.daemon.count("call"), 0, "the plugin dispatches no tools");
  // The settled attach clears its budget timer.
  assert.ok(fixture.ctx.cleared.length >= 1);
});

void test("CRASH-04: an attach whose status carries a notice shows it through ui.notify once", async () => {
  const fixture = makeFixture();
  const notice = "A previous daemon's sandbox was destroyed at startup: 1 container(s), 0 session record(s).";
  fixture.daemon.notice = notice;
  startHandlerOf(fixture.pi)(fixture.ctx);

  await waitForDetail(fixture.ui, "container running");
  assert.deepEqual(fixture.ui.notifications, [notice]);
  // A later repaint tick reads the same status and does not show the notice again.
  const readsBefore = fixture.daemon.count("status");
  pollOf(fixture.ctx).callback();
  await waitUntil(() => fixture.daemon.count("status") > readsBefore);
  await yieldTurn();
  assert.deepEqual(fixture.ui.notifications, [notice]);
});

void test("CRASH-04: an attach whose status carries no notice never calls ui.notify", async () => {
  const fixture = makeFixture();
  startHandlerOf(fixture.pi)(fixture.ctx);

  await waitForDetail(fixture.ui, "container running");
  assert.deepEqual(fixture.ui.notifications, []);
});

void test("OMP-01 (a): an attach failure settles disconnected with the catalogue code as the reason (P5-D8)", async () => {
  const fixture = makeFixture({ attachErrors: ["ANDA_UNREACHABLE"] });
  startHandlerOf(fixture.pi)(fixture.ctx);

  await waitForDetail(fixture.ui, "ANDA_UNREACHABLE");
  assert.equal(lastLabel(fixture.ui), DISCONNECTED_LABEL);
  assert.match(lastDetail(fixture.ui) ?? "", /^ANDA_UNREACHABLE · /);
  // No daemon was attached, so the guard has no client and refuses a guarded edit.
  assert.deepEqual(await toolCallOf(fixture.pi)({ toolName: "edit" }), { block: true, reason: "REALM_NOT_ACTIVE" });
});

void test("OMP-01 (c): a refused up with a live status paints the refusal code and still forwards tool calls (P5-D8)", async () => {
  const fixture = makeFixture({
    snapshot: UNBOUND,
    attach: (daemon) => Promise.resolve({ client: daemon, refusal: makeRealmError("PODMAN_UNSUPPORTED_VERSION") }),
  });
  startHandlerOf(fixture.pi)(fixture.ctx);

  await waitForDetail(fixture.ui, "PODMAN_UNSUPPORTED_VERSION");
  assert.equal(lastLabel(fixture.ui), DISCONNECTED_LABEL);
  assert.match(lastDetail(fixture.ui) ?? "", /^PODMAN_UNSUPPORTED_VERSION · /);
  assert.ok(
    !statusTexts(fixture.ui).some((text) => text.includes(displayStatus(UNBOUND).reason)),
    "the refusal replaces the daemon's own unbound reason",
  );

  // The client is adopted, so a Realm tool call still reaches the daemon.
  fixture.daemon.callOutcome = { outcome: "refused", tool: "status", code: "REALM_UNBOUND", retryable: false };
  await toolOf(fixture.pi, "status").execute("call-1", {});
  assert.deepEqual(fixture.daemon.dispatched.at(-1), { status: {} }, "a Realm tool call reaches the adopted daemon");
  assert.equal(fixture.daemon.count("close"), 0, "the live client is not released");
});

void test("OMP-01 (c): a status read that reports a different state replaces the refusal, and a read of the same state keeps it (P5-D8)", async () => {
  const fixture = makeFixture({
    snapshot: UNBOUND,
    attach: (daemon) => Promise.resolve({ client: daemon, refusal: makeRealmError("PODMAN_UNSUPPORTED_VERSION") }),
  });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "PODMAN_UNSUPPORTED_VERSION");

  // A repaint tick that reads the same state keeps the refusal on screen, and paints nothing new.
  const paintsBefore = statusTexts(fixture.ui).length;
  const readsBefore = fixture.daemon.count("status");
  pollOf(fixture.ctx).callback();
  await waitUntil(() => fixture.daemon.count("status") > readsBefore);
  await yieldTurn();
  assert.match(lastDetail(fixture.ui) ?? "", /^PODMAN_UNSUPPORTED_VERSION · /);
  assert.equal(statusTexts(fixture.ui).length, paintsBefore, "a repeat tick of the same state paints nothing");

  // A status read that reports a different state replaces the refusal text.
  fixture.daemon.snapshot = ACTIVE;
  pollOf(fixture.ctx).callback();
  await waitForDetail(fixture.ui, "container running");
  assert.equal(lastLabel(fixture.ui), ACTIVE_LABEL);
  assert.equal(lastDetail(fixture.ui)?.includes("PODMAN_UNSUPPORTED_VERSION"), false);
});

void test("OMP-01 (a): an attach that outlives the startup budget settles disconnected and releases its late client (P5-D8)", async () => {
  const gate = makeGate();
  const fixture = makeFixture({
    attach: async (daemon) => {
      await gate.promise;
      return { client: daemon, refusal: null };
    },
  });
  startHandlerOf(fixture.pi)(fixture.ctx);

  expireTimer(fixture.ctx, STARTUP_BUDGET_MS);
  await waitForDetail(fixture.ui, "STARTUP_BUDGET_EXCEEDED");
  assert.equal(lastLabel(fixture.ui), DISCONNECTED_LABEL);
  assert.match(lastDetail(fixture.ui) ?? "", /^STARTUP_BUDGET_EXCEEDED · /);

  // The attach lands after the budget: it is closed, never adopted, so the guard still has no client.
  gate.resolve();
  await waitUntil(() => fixture.daemon.count("close") === 1);
  assert.equal(fixture.daemon.count("close"), 1, "the late client is released");
  assert.equal(fixture.pi.activeSets.length, 0, "a setter queued by the timed-out attempt never applies (P16 a)");
  assert.deepEqual(await toolCallOf(fixture.pi)({ toolName: "edit" }), { block: true, reason: "REALM_NOT_ACTIVE" });
});

void test("OMP-01: an attachDaemon that throws synchronously paints disconnected with its code and never throws at the host (P5-D8)", async () => {
  const fixture = makeFixture({
    attach: () => {
      throw makeRealmError("SCHEMA_INVALID");
    },
  });

  assert.doesNotThrow(() => { startHandlerOf(fixture.pi)(fixture.ctx); });
  await waitForDetail(fixture.ui, "SCHEMA_INVALID");
  assert.equal(lastLabel(fixture.ui), DISCONNECTED_LABEL);
});

void test("OMP-01 (b): session shutdown closes the client, never calls down, and refuses guarded calls after (P5-D8)", async () => {
  const fixture = makeFixture();
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");

  shutdownHandlerOf(fixture.pi)();
  assert.equal(fixture.daemon.count("close"), 1, "shutdown closes the client once");
  assert.equal(fixture.daemon.count("down"), 0, "shutdown never sends down: the daemon keeps the sandbox");
  assert.equal(fixture.daemon.count("call"), 0, "shutdown dispatches no tool");

  const paintsAtShutdown = fixture.ui.calls.length;
  fixture.daemon.snapshot = { state: "error", reason: "ANDA_UNREACHABLE", lastTransitionAt: CLOCK_ISO };
  assert.deepEqual(await toolCallOf(fixture.pi)({ toolName: "edit" }), { block: true, reason: "realm not started" });
  assert.equal(fixture.ui.calls.length, paintsAtShutdown, "no paint after shutdown");
  assert.equal(fixture.daemon.count("status"), 1, "a refused call after shutdown reads no status");
});

void test("OMP-02: every status read paints one shared label across every transition, in one status item (P5-D5)", async () => {
  const fixture = makeFixture();
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  const toolCall = toolCallOf(fixture.pi);

  fixture.daemon.snapshot = { state: "error", reason: "ANDA_UNREACHABLE", lastTransitionAt: CLOCK_ISO };
  await toolCall({ toolName: "edit" });
  fixture.daemon.snapshot = ACTIVE;
  await toolCall({ toolName: "edit" });
  fixture.daemon.snapshot = { state: "degraded", reason: "ANDA_VERSION_MISMATCH", lastTransitionAt: CLOCK_ISO };
  await toolCall({ toolName: "edit" });

  // Pinned table: the only labels are the shared mapping plus the text degraded flag.
  const allowed = new Set([ACTIVE_LABEL, DEGRADED_LABEL, DISCONNECTED_LABEL]);
  const labels = labelsOf(fixture.ui);
  for (const label of labels) {
    assert.ok(allowed.has(label), `label comes from the shared mapping: ${label}`);
  }
  assert.ok(labels.includes(DISCONNECTED_LABEL), "disconnected renders");
  assert.ok(labels.includes(ACTIVE_LABEL), "active renders");
  assert.equal(labels.at(-1), DEGRADED_LABEL, "degraded keeps the active label with its flag");
  // One status item carries the label, the reason, and the time: no second key competes with it.
  const keys = new Set(fixture.ui.calls.map((call) => call.key));
  assert.deepEqual(keys, new Set([REALM_STATUS_KEY]));
  assert.equal(statusTexts(fixture.ui).at(-1), `${DEGRADED_LABEL} · ANDA_VERSION_MISMATCH · ${CLOCK_ISO} · ${FAIL_CLOSED_STATUS}`);
});

void test("OMP-03: the reason and last-transition time follow the label in the one status item on every transition (P5-D5)", async () => {
  const fixture = makeFixture();
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  const toolCall = toolCallOf(fixture.pi);

  // Tooltip deviation (P5-D5): the host offers no tooltip, so the reason and the ISO instant ride in the
  // text of the one status item on every transition.
  const transitions: Array<{ readonly snapshot: StateSnapshot; readonly label: string; readonly detail: string }> = [
    {
      snapshot: { state: "error", reason: "ANDA_UNREACHABLE", lastTransitionAt: CLOCK_ISO },
      label: DISCONNECTED_LABEL,
      detail: `ANDA_UNREACHABLE · ${CLOCK_ISO}`,
    },
    { snapshot: ACTIVE, label: ACTIVE_LABEL, detail: `container running · ${CLOCK_ISO}` },
    {
      snapshot: { state: "degraded", reason: "ANDA_VERSION_MISMATCH", lastTransitionAt: CLOCK_ISO },
      label: DEGRADED_LABEL,
      detail: `ANDA_VERSION_MISMATCH · ${CLOCK_ISO}`,
    },
  ];
  for (const transition of transitions) {
    fixture.daemon.snapshot = transition.snapshot;
    await toolCall({ toolName: "edit" });
    assert.equal(lastLabel(fixture.ui), transition.label, `label for ${transition.detail}`);
    assert.equal(lastDetail(fixture.ui), transition.detail);
  }
});

void test("OMP-02: a daemon transition reaches the indicator on the poll, with no guarded call (P5-D5)", async () => {
  const fixture = makeFixture();
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");

  fixture.daemon.snapshot = { state: "error", reason: "ANDA_UNREACHABLE", lastTransitionAt: CLOCK_ISO };
  pollOf(fixture.ctx).callback();
  await waitUntil(() => lastLabel(fixture.ui) === DISCONNECTED_LABEL);
  assert.equal(lastDetail(fixture.ui), `ANDA_UNREACHABLE · ${CLOCK_ISO}`);

  fixture.daemon.snapshot = { state: "degraded", reason: "ANDA_VERSION_MISMATCH", lastTransitionAt: CLOCK_ISO };
  pollOf(fixture.ctx).callback();
  await waitUntil(() => lastLabel(fixture.ui) === DEGRADED_LABEL);
  assert.equal(lastDetail(fixture.ui), `ANDA_VERSION_MISMATCH · ${CLOCK_ISO}`);
  assert.equal(fixture.daemon.count("call"), 0, "the repaint dispatches no tool");
});

void test("OMP-02: session start arms one poll at the bounded interval, and an unchanged poll paints nothing (P5-D5)", async () => {
  const fixture = makeFixture();
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");

  assert.equal(fixture.ctx.intervals.length, 1, "one poll per session");
  assert.equal(pollOf(fixture.ctx).ms, STATUS_POLL_MS);
  const paintsBefore = fixture.ui.calls.length;
  const readsBefore = fixture.daemon.count("status");
  pollOf(fixture.ctx).callback();
  await yieldTurn();
  assert.equal(fixture.daemon.count("status"), readsBefore + 1, "the poll reads the daemon status");
  assert.equal(fixture.ui.calls.length, paintsBefore, "an unchanged snapshot paints nothing");
});

void test("OMP-02: a poll tick that lands while a read is in flight does not stack reads (P5-D5)", async () => {
  const fixture = makeFixture();
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  fixture.daemon.hangStatus = true;

  pollOf(fixture.ctx).callback();
  pollOf(fixture.ctx).callback();
  await yieldTurn();
  assert.equal(fixture.daemon.count("status"), 2, "attach read plus one poll read, not a second poll read");
});

void test("OMP-02: a failed poll read paints its code once, and a repeat of the same failure stays quiet (P5-D5)", async () => {
  const fixture = makeFixture();
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  fixture.daemon.hangStatus = true;

  pollOf(fixture.ctx).callback();
  expireTimer(fixture.ctx, GUARD_STATUS_BUDGET_MS);
  await waitUntil(() => lastLabel(fixture.ui) === DISCONNECTED_LABEL);
  assert.match(lastDetail(fixture.ui) ?? "", /^TOOL_TIMEOUT · /);
  assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(LAST_FAIL_CLOSED_STATUS));
  const paintsAfterFirstFailure = fixture.ui.calls.length;

  pollOf(fixture.ctx).callback();
  expireTimer(fixture.ctx, GUARD_STATUS_BUDGET_MS);
  await yieldTurn();
  assert.equal(fixture.daemon.count("status"), 3, "the second tick read the daemon again");
  assert.equal(fixture.ui.calls.length, paintsAfterFirstFailure, "the same failure, with the same stamp, paints nothing");
});

void test("OMP-02: a poll tick that fires after shutdown reads no status and paints nothing (P5-D5)", async () => {
  const fixture = makeFixture();
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  const poll = pollOf(fixture.ctx);

  shutdownHandlerOf(fixture.pi)();
  const paintsAtShutdown = fixture.ui.calls.length;
  const readsAtShutdown = fixture.daemon.count("status");
  poll.callback();
  await yieldTurn();
  assert.equal(fixture.daemon.count("status"), readsAtShutdown, "no read after shutdown");
  assert.equal(fixture.ui.calls.length, paintsAtShutdown, "no paint after shutdown");
});

void test("OMP-04: the retry command re-runs the attach path and moves error to connecting then active (P5-D14)", async () => {
  const fixture = makeFixture({ attachErrors: ["ANDA_UNREACHABLE"] });
  const command = retryCommandOf(fixture.pi);
  assert.ok(command.description.length > 0, "retry command carries a description");
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "ANDA_UNREACHABLE");
  assert.equal(lastLabel(fixture.ui), DISCONNECTED_LABEL);

  const detailsBefore = detailsOf(fixture.ui).length;
  const result = await command.handler();

  assert.match(result, /active/, "retry reports the active state");
  assert.deepEqual(fixture.attachCalls, [WORKSPACE, WORKSPACE], "retry runs the same attach with the session cwd");
  const after = detailsOf(fixture.ui).slice(detailsBefore);
  const connectingAt = after.findIndex((text) => text.startsWith("connecting"));
  const activeAt = after.findIndex((text) => text.includes("container running"));
  assert.ok(connectingAt !== -1 && activeAt !== -1 && connectingAt < activeAt, `retry passes through connecting then active: ${after.join(" | ")}`);
  assert.equal(lastLabel(fixture.ui), ACTIVE_LABEL);
});

void test("OMP-04: the retry command before session start reports realm not started", async () => {
  const fixture = makeFixture();
  assert.equal(await retryCommandOf(fixture.pi).handler(), "realm not started");
});

void test("OMP-05: required mode refuses host edit while the realm is non-active; the Realm write reaches the daemon (P5-D6)", async () => {
  const fixture = makeFixture({ mode: "fail-closed", snapshot: CONNECTING });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForSettledDetails(fixture);
  const toolCall = toolCallOf(fixture.pi);

  assert.equal(await toolCall({ toolName: "write" }), undefined, "the Realm write goes to the daemon gate, not the guard");
  assert.deepEqual(await toolCall({ toolName: "edit" }), { block: true, reason: "REALM_NOT_ACTIVE" });
  assert.equal(
    await guardHostToolCall("write", null, toolSetOf(fixture.pi)),
    undefined,
    "a Realm write with no session passes to the tool",
  );
  assert.deepEqual(fixture.ui.notifications, [], "refusal carries no advisory warning");
  assert.equal(fixture.daemon.count("status"), 3, "the attach, the Realm write and the guarded edit each read the daemon status once");
});

void test("OMP-05 (c): required mode blocks an edit when the status snapshot says not active (P5-D6)", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  const toolCall = toolCallOf(fixture.pi);

  fixture.daemon.snapshot = { state: "unbound", reason: "no workspace", lastTransitionAt: CLOCK_ISO };
  assert.deepEqual(await toolCall({ toolName: "edit" }), { block: true, reason: "REALM_UNBOUND" });
  fixture.daemon.snapshot = { state: "stopping", reason: "stopping", lastTransitionAt: CLOCK_ISO };
  assert.deepEqual(await toolCall({ toolName: "edit" }), { block: true, reason: "REALM_STOPPING" });
  fixture.daemon.snapshot = CONNECTING;
  assert.deepEqual(await toolCall({ toolName: "edit" }), { block: true, reason: "REALM_NOT_ACTIVE" });
  assert.deepEqual(fixture.ui.notifications, [], "required refusals carry no advisory warning");
});

void test("OMP-05: advisory mode warns visibly and lets the guarded call through (P5-D6)", async () => {
  const fixture = makeFixture({ mode: "advisory", snapshot: CONNECTING });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForSettledDetails(fixture);
  const toolCall = toolCallOf(fixture.pi);

  // The Realm write reaches the daemon, which carries its warning (B1), so the guard itself warns only for the edit.
  assert.equal(await toolCall({ toolName: "write" }), undefined, "the Realm write passes the guard to the daemon");
  assert.equal(await toolCall({ toolName: "edit" }), undefined);
  assert.equal(fixture.ui.notifications.length, 1, "the guarded edit warns");
  for (const warning of fixture.ui.notifications) {
    assert.match(warning, /connecting/, "warning names the state");
    assert.match(warning, /advisory policy/, "warning states the advisory policy");
  }
});

void test("OMP-05: read, list, status, and retry pass the guard untouched without reading status (P5-D6)", async () => {
  const fixture = makeFixture({ mode: "fail-closed", snapshot: CONNECTING });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForSettledDetails(fixture);
  const toolCall = toolCallOf(fixture.pi);
  const statusReadsBefore = fixture.daemon.count("status");

  for (const toolName of ["read", "list", "status", "retry"]) {
    assert.equal(await toolCall({ toolName }), undefined, `${toolName} passes the guard`);
  }
  assert.ok(!GUARDED_HOST_TOOLS.includes("status"), "status is not a guarded tool");
  assert.equal(fixture.daemon.count("status"), statusReadsBefore, "pass-through reads no status");
  assert.deepEqual(fixture.ui.notifications, [], "pass-through attaches no warning");
});

void test("OMP-05 (d): required mode blocks an edit when the status fetch times out (P5-D6)", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  fixture.daemon.hangStatus = true;

  const verdict = toolCallOf(fixture.pi)({ toolName: "edit" });
  expireTimer(fixture.ctx, GUARD_STATUS_BUDGET_MS);

  assert.deepEqual(await verdict, { block: true, reason: "TOOL_TIMEOUT" });
  assert.deepEqual(fixture.ui.notifications, [], "required mode does not warn on an unreadable status");
});

void test("OMP-05 (d): advisory mode refuses an edit when the status fetch times out and warns nothing (P5-D6, CR-01)", async () => {
  const fixture = makeFixture({ mode: "advisory" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  fixture.daemon.hangStatus = true;

  const verdict = toolCallOf(fixture.pi)({ toolName: "edit" });
  expireTimer(fixture.ctx, GUARD_STATUS_BUDGET_MS);

  assert.deepEqual(await verdict, { block: true, reason: "TOOL_TIMEOUT" }, "advisory refuses an edit the daemon has not confirmed");
  assert.deepEqual(fixture.ui.notifications, [], "a refused edit raises no warning");
});

void test("OMP-05 / LOW-01: a tool name the guard cannot classify is refused, never waved through (P5-D6)", async () => {
  assert.deepEqual(await guardHostToolCall(undefined, null, toolSetOf(new FakePi())), { block: true, reason: "realm bad tool call" });
  assert.deepEqual(await guardHostToolCall({ name: "write" }, null, toolSetOf(new FakePi())), { block: true, reason: "realm bad tool call" });
  assert.equal(await guardHostToolCall("read", null, toolSetOf(new FakePi())), undefined);
});

void test("OMP-05: the package manifest points at the compiled edge entry (P5-D4)", () => {
  // The compiled test runs from dist/test/omp/, so the repository root is three levels up.
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    readonly omp?: { readonly extensions?: readonly string[] };
  };
  assert.deepEqual(manifest.omp?.extensions, ["./dist/src/omp/extension.js"]);
  assert.ok(existsSync(join(root, "dist", "src", "omp", "extension.js")), "the omp field resolves to the built entry");
});

// ---- Timer cleanup (CORE-06 for the host edge) ----------------------------------

void test("timers: session shutdown clears the attach budget and the poll, and a late attach is released unpainted (P5-D8)", async () => {
  const gate = makeGate();
  const fixture = makeFixture({
    attach: async (daemon) => {
      await gate.promise;
      return { client: daemon, refusal: null };
    },
  });
  startHandlerOf(fixture.pi)(fixture.ctx);
  const budgetHandle = armedTimer(fixture.ctx, STARTUP_BUDGET_MS).handle;
  const pollHandle = pollOf(fixture.ctx).handle;

  shutdownHandlerOf(fixture.pi)();
  assert.ok(fixture.ctx.cleared.includes(budgetHandle), "the attach budget timer is cleared");
  assert.ok(fixture.ctx.cleared.includes(pollHandle), "the poll is cleared");

  gate.resolve();
  await waitUntil(() => fixture.daemon.count("close") === 1);
  assert.deepEqual(labelsOf(fixture.ui), [DISCONNECTED_LABEL], "only the connecting paint landed");
  assert.equal(fixture.daemon.count("status"), 1, "the late attach reads status once and adopts nothing");
});

void test("timers: session shutdown settles an in-flight guard read as refused and clears its timer (P5-D6)", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  fixture.daemon.hangStatus = true;

  const verdict = toolCallOf(fixture.pi)({ toolName: "edit" });
  const guardHandle = armedTimer(fixture.ctx, GUARD_STATUS_BUDGET_MS).handle;
  shutdownHandlerOf(fixture.pi)();

  assert.deepEqual(await verdict, { block: true, reason: "REALM_NOT_ACTIVE" }, "the pending read fails closed at shutdown");
  assert.ok(fixture.ctx.cleared.includes(guardHandle), "the guard read's timer is cleared");
});

void test("timers: a settled attach and a settled guard read leave no timer armed (CORE-06)", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  const budgetHandle = armedTimer(fixture.ctx, STARTUP_BUDGET_MS).handle;
  assert.ok(fixture.ctx.cleared.includes(budgetHandle), "the settled attach clears its budget");

  assert.deepEqual(await toolCallOf(fixture.pi)({ toolName: "edit" }), { block: true, reason: "POLICY_DENIED" });
  const guardHandle = armedTimer(fixture.ctx, GUARD_STATUS_BUDGET_MS).handle;
  assert.ok(fixture.ctx.cleared.includes(guardHandle), "the settled guard read clears its timeout");
  assert.equal(fixture.ctx.intervals.length, 1, "the poll is the only interval and stays armed until shutdown");
  assert.ok(!fixture.ctx.cleared.includes(pollOf(fixture.ctx).handle), "the poll is not cleared while attached");
});

// ---- Review fixes: MED-02, MED-03 ----------------------------------------------

void test("OMP-01 / MED-02: a budget timer that fires after the attach settled does not overwrite the settled status (P5-D8)", async () => {
  const fixture = makeFixture();
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");

  // A host may run an already-queued timer after clearTimer; it must not paint over the status.
  const paintsBefore = fixture.ui.calls.length;
  armedTimer(fixture.ctx, STARTUP_BUDGET_MS).callback();
  assert.equal(fixture.ui.calls.length, paintsBefore, "the late expiry paints nothing");
  assert.equal(lastLabel(fixture.ui), ACTIVE_LABEL);
  assert.equal(lastDetail(fixture.ui), `container running · ${CLOCK_ISO}`);
});

void test("OMP-02 / MED-03: a throwing status write leaves the paint cache stale so the next render repaints (P5-D5)", () => {
  const writes: Array<{ readonly key: string; readonly text: string }> = [];
  let failWrite = true;
  const ui: OmpStatusUi = {
    setStatus(key, text) {
      if (failWrite) {
        failWrite = false;
        throw new Error("rpc transport");
      }
      writes.push({ key, text });
    },
    notify() {},
  };
  const snapshot: StateSnapshot = { state: "error", reason: "STARTUP_BUDGET_EXCEEDED", lastTransitionAt: CLOCK_ISO };

  assert.throws(() => { renderRealmStatus(ui, snapshot, null, false); }, /rpc transport/);
  renderRealmStatus(ui, snapshot, null, false);
  renderRealmStatus(ui, snapshot, null, false);

  assert.deepEqual(writes, [
    { key: REALM_STATUS_KEY, text: `${DISCONNECTED_LABEL} · STARTUP_BUDGET_EXCEEDED · ${CLOCK_ISO} · ${UNKNOWN_STATUS}` },
  ]);
});

// ---- OMPX-02, OMPX-03, OMPX-04: Realm tools and built-in removal -----------------

// The fail-closed allowlist (docs/integration/omp.md, Enforcement spike rule 1): the read-only built-ins, the Realm tools, and bash,
// which the tool_call guard refuses with a catalogue code (OMPX-03).
const FAIL_CLOSED_ALLOWLIST = ["ask", "bash", "exec", "glob", "grep", "list", "read", "status", "todo", "wait", "write"];
// Built-ins a fail-closed attach must remove, including web_search (network outside the realm's egress policy).
const REMOVED_BUILTINS = ["ast_edit", "debug", "edit", "eval", "lsp", "task", "web_search"];
const REALM_TOOLS = ["exec", "list", "read", "status", "write"];

function sortedNames(names: readonly string[]): string[] {
  return [...names].sort();
}

function toolOf(pi: FakePi, name: string): HostToolDefinition {
  const tool = pi.tools.get(name);
  assert.ok(tool !== undefined, `${name} tool is registered`);
  return tool;
}

void test("OMPX-02: the Realm tools register as exec, read, write, list and status, with no glob tool and retry kept as the command", () => {
  const fixture = makeFixture();
  assert.deepEqual(sortedNames([...fixture.pi.tools.keys()]), REALM_TOOLS);
  assert.ok(!fixture.pi.tools.has("glob"), "no glob tool is registered");
  assert.ok(!fixture.pi.tools.has("retry"), "retry is a command, not a tool");
  assert.deepEqual([...fixture.pi.commands.keys()], [REALM_RETRY_COMMAND], "realm-retry is the only command");
  for (const tool of fixture.pi.tools.values()) {
    assert.equal(tool.loadMode, "essential", `${tool.name} is offered to the model`);
    assert.equal(tool.parameters["type"], "object", `${tool.name} declares an object schema`);
  }
});

void test("OMPX-02: a Realm tool hands its input to the daemon as one frozen ToolCall and returns the daemon's outcome", async () => {
  const fixture = makeFixture();
  const refusal: ToolOutcome = { outcome: "refused", tool: "read", code: "PATH_ESCAPE", retryable: false };
  fixture.daemon.callOutcome = refusal;
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");

  const result = await toolOf(fixture.pi, "read").execute("call-1", { path: "notes/a.txt", maxBytes: 16 });
  assert.deepEqual(fixture.daemon.dispatched.at(-1), { read: { path: "notes/a.txt", maxBytes: 16 } });
  assert.equal(result.isError, true, "a refusal is an error result");
  assert.deepEqual(result.details, refusal);
  assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify(refusal) }]);

  fixture.daemon.callOutcome = { outcome: "refused", tool: "status", code: "REALM_UNBOUND", retryable: false };
  await toolOf(fixture.pi, "status").execute("call-2", {});
  assert.deepEqual(fixture.daemon.dispatched.at(-1), { status: {} });
  await toolOf(fixture.pi, "exec").execute("call-3", { argv: ["ls", "-l"] });
  assert.deepEqual(fixture.daemon.dispatched.at(-1), { exec: { argv: ["ls", "-l"] } });
  await toolOf(fixture.pi, "write").execute("call-4", { path: "a.txt", content: "hi" });
  assert.deepEqual(fixture.daemon.dispatched.at(-1), { write: { path: "a.txt", content: "hi" } });
  await toolOf(fixture.pi, "list").execute("call-5", { path: "src", depth: 1 });
  assert.deepEqual(fixture.daemon.dispatched.at(-1), { list: { path: "src", depth: 1 } });
});

void test("OMPX-02: a Realm tool called with no attached daemon refuses with REALM_NOT_ACTIVE and makes no daemon call", async () => {
  const fixture = makeFixture();
  const result = await toolOf(fixture.pi, "status").execute("call-1", {});
  assert.equal(result.isError, true);
  assert.deepEqual(result.details, { outcome: "refused", tool: "status", code: "REALM_NOT_ACTIVE", retryable: true });
  assert.deepEqual(fixture.daemon.calls, [], "no daemon call is made");
});

void test("OMPX-03: fail-closed attach removes every built-in outside the allowlist, reads the set back, and keeps the Realm tools", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");

  assert.equal(fixture.pi.activeSets.length, 1, "one removal per attach");
  assert.deepEqual(sortedNames(fixture.pi.activeSets[0] ?? []), FAIL_CLOSED_ALLOWLIST);
  const active = sortedNames(fixture.pi.getActiveTools());
  assert.deepEqual(active, FAIL_CLOSED_ALLOWLIST, "the read-back matches the allowlist");
  for (const name of REMOVED_BUILTINS) {
    assert.ok(!active.includes(name), `${name} is removed`);
  }
});

void test("OMPX-03 / B8: a removal that does not hold paints POLICY_DENIED, keeps the client that answered, and refuses a host bash call", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  fixture.pi.ignoreRemoval = true;
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "POLICY_DENIED");

  assert.equal(lastLabel(fixture.ui), DISCONNECTED_LABEL);
  assert.match(lastDetail(fixture.ui) ?? "", /^POLICY_DENIED · /);
  assert.equal(fixture.daemon.count("close"), 0, "the daemon answered its status, so its client is adopted, not released (B8)");
  assert.deepEqual(await toolCallOf(fixture.pi)({ toolName: "bash" }), { block: true, reason: "POLICY_DENIED" });
  fixture.daemon.callOutcome = { outcome: "refused", tool: "status", code: "REALM_UNBOUND", retryable: false };
  await toolOf(fixture.pi, "status").execute("call-1", {});
  assert.deepEqual(fixture.daemon.dispatched.at(-1), { status: {} }, "a Realm tool call still reaches the adopted daemon");
});

void test("OMPX-03: before the first attach settles no mode is known, so a host bash call is refused with POLICY_DENIED", async () => {
  const gate = makeGate();
  const fixture = makeFixture({
    mode: "fail-closed",
    attach: async (daemon) => {
      await gate.promise;
      return { client: daemon, refusal: null };
    },
  });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await yieldTurn();

  assert.equal(fixture.pi.activeSets.length, 0, "nothing is removed before the attach reads the mode");
  assert.deepEqual(await toolCallOf(fixture.pi)({ toolName: "bash" }), { block: true, reason: "POLICY_DENIED" });
  gate.resolve();
  await waitForDetail(fixture.ui, "container running");
  assert.equal(fixture.pi.activeSets.length, 1, "the removal runs once the mode is read");
});

void test("OMPX-03: in fail-closed mode the tool_call backstop refuses a host bash call with a catalogue code and passes the read-only tools", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  const toolCall = toolCallOf(fixture.pi);

  const bash = await toolCall({ toolName: "bash" });
  assert.deepEqual(bash, { block: true, reason: "POLICY_DENIED" });
  assert.ok((ERROR_CODES as readonly string[]).includes(bash.reason), "the refusal carries a catalogue code");
  for (const toolName of ["web_search", "eval", "task", "ast_edit", "debug", "lsp"]) {
    assert.deepEqual(await toolCall({ toolName }), { block: true, reason: "POLICY_DENIED" }, `${toolName} is refused`);
  }
  assert.deepEqual(await toolCall({ toolName: "edit" }), { block: true, reason: "POLICY_DENIED" }, "edit is refused with an active realm");
  for (const toolName of ["glob", "grep", "ask", "todo", "wait", "read", "exec", "list", "status"]) {
    assert.equal(await toolCall({ toolName }), undefined, `${toolName} passes`);
  }
  assert.equal(await toolCall({ toolName: "write" }), undefined, "the Realm write passes the mutation check with an active realm");
});

void test("OMPX-04 / B9: advisory attach with the realm not active changes no tool: the Realm write and the built-ins stay active, a host bash call passes, and the guarded edit keeps the notice", async () => {
  const fixture = makeFixture({ mode: "advisory", snapshot: CONNECTING });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForSettledDetails(fixture);

  assert.equal(fixture.pi.activeSets.length, 0, "nothing is removed, so the active set is never set");
  const active = fixture.pi.getActiveTools();
  for (const name of ["write", "bash", ...REMOVED_BUILTINS, "glob", "grep"]) {
    assert.ok(active.includes(name), `${name} stays active`);
  }
  assert.equal(fixture.pi.tools.size, REALM_TOOLS.length, "the Realm tools stay registered");
  const toolCall = toolCallOf(fixture.pi);
  assert.equal(await toolCall({ toolName: "bash" }), undefined, "bash passes in advisory mode");
  assert.equal(await toolCall({ toolName: "edit" }), undefined, "edit passes with a warning in advisory mode");
  assert.equal(fixture.ui.notifications.length, 1);
  assert.match(fixture.ui.notifications[0] ?? "", /advisory policy/);
});

void test("B1 / T1: advisory with the realm not active forwards the Realm write to the daemon, shows its warning on every call, and returns the bytes and digest", async () => {
  const fixture = makeFixture({ mode: "advisory", snapshot: CONNECTING });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForSettledDetails(fixture);
  const warning = "realm is connecting; the write proceeds under advisory policy";
  const outcome: ToolOutcome = { outcome: "done", tool: "write", value: { sha256: "a".repeat(64), bytes: 5, warning } };
  fixture.daemon.callOutcome = outcome;
  const write = toolOf(fixture.pi, "write");

  for (const callId of ["call-1", "call-2"]) {
    const result = await write.execute(callId, { path: "notes.txt", content: "hello" });
    assert.equal(result.isError, false, "the advisory write succeeds");
    assert.deepEqual(result.details, outcome, "the result carries the daemon's digest and byte count");
    assert.equal(result.content[0]?.text, JSON.stringify(outcome));
  }
  assert.deepEqual(fixture.daemon.dispatched, [
    { write: { path: "notes.txt", content: "hello" } },
    { write: { path: "notes.txt", content: "hello" } },
  ]);
  assert.deepEqual(fixture.ui.notifications, [warning, warning], "the warning is shown on every call");
  assert.ok(fixture.pi.getActiveTools().includes("write"), "the Realm write stays in the active set");
});

void test("B2 / T2: with no daemon attached the Realm write is refused with REALM_NOT_ACTIVE, no daemon is called, and the write stays active", async () => {
  const fixture = makeFixture({ mode: "advisory", attachErrors: ["ANDA_UNREACHABLE"] });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "ANDA_UNREACHABLE");

  assert.equal(await toolCallOf(fixture.pi)({ toolName: "write" }), undefined, "the guard passes the Realm write to the tool");
  const result = await toolOf(fixture.pi, "write").execute("call-1", { path: "notes.txt", content: "hello" });
  assert.equal(result.isError, true);
  assert.deepEqual(result.details, { outcome: "refused", tool: "write", code: "REALM_NOT_ACTIVE", retryable: true });
  assert.deepEqual(fixture.daemon.dispatched, [], "the daemon is never called");
  assert.ok(fixture.pi.getActiveTools().includes("write"), "the Realm write stays in the active set");
  assert.deepEqual(fixture.ui.notifications, [], "no warning is shown");
});

void test("B3 / T3: reachable, realm not active, fail-closed: the daemon's REALM_NOT_ACTIVE refusal reaches the caller, and the write stays active", async () => {
  const fixture = makeFixture({ mode: "fail-closed", snapshot: CONNECTING });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForSettledDetails(fixture);
  fixture.daemon.callError = "REALM_NOT_ACTIVE";

  const result = await toolOf(fixture.pi, "write").execute("call-1", { path: "notes.txt", content: "hello" });
  assert.equal(result.isError, true);
  assert.deepEqual(result.details, { outcome: "refused", tool: "write", code: "REALM_NOT_ACTIVE", retryable: true });
  assert.equal(fixture.daemon.count("call"), 1, "the daemon decided the write");
  assert.ok(fixture.pi.getActiveTools().includes("write"), "the Realm write stays in the active set");
  assert.deepEqual(fixture.ui.notifications, [], "a refusal carries no warning");
});

void test("B4 / T4: a host write failure from the daemon propagates as an error and is never reported as success", async () => {
  const fixture = makeFixture({ mode: "advisory" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  fixture.daemon.callError = "WRITE_NOT_ATOMIC";

  const result = await toolOf(fixture.pi, "write").execute("call-1", { path: "notes.txt", content: "hello" });
  assert.equal(result.isError, true, "the failed write is an error result");
  assert.equal(result.details.outcome, "refused");
  assert.match(result.content[0]?.text ?? "", /"code":"WRITE_NOT_ATOMIC"/);
  assert.ok(fixture.pi.getActiveTools().includes("write"), "the Realm write stays in the active set");
  assert.deepEqual(fixture.ui.notifications, [], "no warning is shown for a failed write");
});

void test("B9 / T5: the Realm write stays active across every realm transition, and the poll never hides it", async () => {
  const fixture = makeFixture({ mode: "advisory", snapshot: CONNECTING });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForSettledDetails(fixture);
  assert.ok(fixture.pi.getActiveTools().includes("write"), "the Realm write is active while the realm connects");

  fixture.daemon.snapshot = ACTIVE;
  pollOf(fixture.ctx).callback();
  await waitUntil(() => lastLabel(fixture.ui) === ACTIVE_LABEL);
  assert.ok(fixture.pi.getActiveTools().includes("write"), "the Realm write is active with the realm active");
  assert.equal(fixture.pi.activeSets.length, 0, "advisory mode with nothing removed never sets the active set");
});

void test("B9 / T6: advisory with an unreadable status refuses the Realm write before any daemon call, and the write stays active", async () => {
  const fixture = makeFixture({ mode: "advisory" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");

  fixture.daemon.hangStatus = true;
  const verdict = toolCallOf(fixture.pi)({ toolName: "write" });
  expireTimer(fixture.ctx, GUARD_STATUS_BUDGET_MS);
  assert.deepEqual(await verdict, { block: true, reason: "TOOL_TIMEOUT" }, "the Realm write is refused under advisory");
  assert.equal(fixture.daemon.count("call"), 0, "the refused Realm write makes no daemon call");
  assert.ok(fixture.pi.getActiveTools().includes("write"), "the Realm write stays in the active set");
});

void test("B2: a Realm write with no session passes the guard, and the tool refuses it without a daemon call", async () => {
  assert.equal(await guardHostToolCall("write", null, toolSetOf(new FakePi())), undefined, "the guard passes the Realm write");
  const fixture = makeFixture();
  const result = await toolOf(fixture.pi, "write").execute("call-1", { path: "notes.txt", content: "hello" });
  assert.deepEqual(result.details, { outcome: "refused", tool: "write", code: "REALM_NOT_ACTIVE", retryable: true });
  assert.deepEqual(fixture.daemon.calls, [], "no daemon call is made");
});

void test("P16 (b): the mode is published only after the tool set takes it, so a refused change leaves the last published mode", async () => {
  const fixture = makeFixture({ mode: "advisory" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  const toolCall = toolCallOf(fixture.pi);

  fixture.daemon.mode = "fail-closed";
  fixture.pi.ignoreRemoval = true;
  assert.deepEqual(await toolCall({ toolName: "bash" }), { block: true, reason: "POLICY_DENIED" }, "the refused change denies the call");
  fixture.pi.ignoreRemoval = false;

  fixture.daemon.hangStatus = true;
  const noticesBeforeEdit = fixture.ui.notifications.length;
  const verdict = toolCall({ toolName: "edit" });
  expireTimer(fixture.ctx, GUARD_STATUS_BUDGET_MS);
  assert.deepEqual(await verdict, { block: true, reason: "TOOL_TIMEOUT" }, "the unreadable status refuses edit under the last published mode, advisory");
  assert.equal(fixture.ui.notifications.length, noticesBeforeEdit, "the refused edit adds no notification");
});

void test("P16 (c): in the same mode, a built-in that Omp puts back is removed again on the next guarded call", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");

  await fixture.pi.setActiveTools([...fixture.pi.getActiveTools(), "edit"]);
  assert.deepEqual(await toolCallOf(fixture.pi)({ toolName: "bash" }), { block: true, reason: "POLICY_DENIED" });
  assert.ok(!fixture.pi.getActiveTools().includes("edit"), "edit is removed again");
});

void test("P16 (d): a Realm tool that drops out of the active set is put back by the next guarded call in the same mode", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");

  await fixture.pi.setActiveTools(fixture.pi.getActiveTools().filter((name) => name !== "write"));
  assert.deepEqual(await toolCallOf(fixture.pi)({ toolName: "bash" }), { block: true, reason: "POLICY_DENIED" });
  assert.ok(fixture.pi.getActiveTools().includes("write"), "the Realm write is put back");
});

void test("P16 (e): a status whose mode cannot be read is refused: no host tool changes and the guarded call is refused", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");

  const setsBefore = fixture.pi.activeSets.length;
  fixture.daemon.mode = "unreadable" as unknown as PolicyMode;
  assert.deepEqual(await toolCallOf(fixture.pi)({ toolName: "bash" }), { block: true, reason: "POLICY_DENIED" });
  assert.equal(fixture.pi.activeSets.length, setsBefore, "an unreadable mode changes no host tool");
});

// ---- Host tool lifecycle (OMPX-03, OMPX-04; P16 a to g) ---------------------

const POLICY_DENIED_VERDICT: HostToolVerdict = { block: true, reason: "POLICY_DENIED" };
// Every tool the fake Omp reports once the Realm tools are registered, each name once.
const EVERY_TOOL: readonly string[] = [...new Set([...OMP_BUILTIN_TOOLS, "exec", "list", "status"])];

function sameActive(pi: FakePi, expected: readonly string[]): boolean {
  return sortedNames(pi.getActiveTools()).join(",") === sortedNames(expected).join(",");
}

// A session the guard reads directly, with the client and the mode it last published.
function sessionOf(fixture: Fixture, client: DaemonClient | null, mode: PolicyMode | null): ActiveSession {
  return { ctx: fixture.ctx, attachedCwd: fixture.ctx.cwd, tools: fixture.tools, client, mode, timers: new Map(), poll: null, refreshing: false, errorStamp: null, refusal: null, link: "off", reattachCount: 0, wait: null, onLinkLost: null };
}

// The policy mode the plugin last published. With the status unreadable, the Realm write is the one guarded call whose verdict
// still follows the published mode: fail-closed lets it reach the daemon (undefined), advisory refuses it. The probe changes no host tool.
async function publishedModeOf(fixture: Fixture): Promise<PolicyMode> {
  fixture.daemon.hangStatus = true;
  const verdict = toolCallOf(fixture.pi)({ toolName: "write" });
  expireTimer(fixture.ctx, GUARD_STATUS_BUDGET_MS);
  const result = await verdict;
  fixture.daemon.hangStatus = false;
  return result === undefined ? "fail-closed" : "advisory";
}

void test("OMPX-03 (T2): a host bash call in fail-closed is refused with POLICY_DENIED whatever state the status reads", async () => {
  for (const snapshot of [ACTIVE, CONNECTING, UNBOUND]) {
    const fixture = makeFixture({ mode: "fail-closed", snapshot });
    const verdict = await guardHostToolCall("bash", sessionOf(fixture, fixture.daemon, null), fixture.tools);
    assert.deepEqual(verdict, POLICY_DENIED_VERDICT, `bash is refused while the realm is ${snapshot.state}`);
  }
});

void test("OMPX-03 (T2): a host bash call in fail-closed is refused with POLICY_DENIED when the status cannot be read, and when no mode is known", async () => {
  const published = makeFixture({ mode: "fail-closed" });
  published.daemon.hangStatus = true;
  const withMode = guardHostToolCall("bash", sessionOf(published, published.daemon, "fail-closed"), published.tools);
  expireTimer(published.ctx, GUARD_STATUS_BUDGET_MS);
  assert.deepEqual(await withMode, POLICY_DENIED_VERDICT, "the last published mode, fail-closed, refuses bash");

  const unknown = makeFixture({ mode: "fail-closed" });
  unknown.daemon.hangStatus = true;
  const noMode = guardHostToolCall("bash", sessionOf(unknown, unknown.daemon, null), unknown.tools);
  expireTimer(unknown.ctx, GUARD_STATUS_BUDGET_MS);
  assert.deepEqual(await noMode, POLICY_DENIED_VERDICT, "with no mode known, bash is refused");
});

void test("OMPX-03 (T2): advisory passes a host bash call whose status reads, and a call with no session is refused with POLICY_DENIED", async () => {
  const fixture = makeFixture({ mode: "advisory" });
  assert.equal(await guardHostToolCall("bash", sessionOf(fixture, fixture.daemon, null), fixture.tools), undefined);
  assert.deepEqual(await guardHostToolCall("bash", null, fixture.tools), POLICY_DENIED_VERDICT);
});

void test("P16 (a): a setter that resolves after its attach budget expired is read back, and the next session reconciles the set", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  const gate = makeGate();
  fixture.pi.holdSetters = gate.promise;
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitUntil(() => fixture.pi.activeSets.length === 1);
  expireTimer(fixture.ctx, STARTUP_BUDGET_MS);
  await waitForDetail(fixture.ui, "STARTUP_BUDGET_EXCEEDED");
  assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(UNKNOWN_STATUS));

  gate.resolve();
  await waitUntil(() => fixture.tools.inFlight === 0);
  assert.ok(sameActive(fixture.pi, FAIL_CLOSED_ALLOWLIST), "the late setter applied the plan");
  assert.deepEqual(sortedNames(fixture.tools.removed), REMOVED_BUILTINS, "the owed list is read back from Omp");

  fixture.pi.holdSetters = null;
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  assert.ok(sameActive(fixture.pi, FAIL_CLOSED_ALLOWLIST), "the next session's read leaves the planned set");
  assert.deepEqual(sortedNames(fixture.tools.removed), REMOVED_BUILTINS);
  assert.equal(await publishedModeOf(fixture), "fail-closed");
});

void test("P16 (a): a setter that resolves after session shutdown is read back, paints nothing, and the next session reconciles the set", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  const gate = makeGate();
  fixture.pi.holdSetters = gate.promise;
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitUntil(() => fixture.pi.activeSets.length === 1);
  shutdownHandlerOf(fixture.pi)();
  const paintsAtShutdown = statusTexts(fixture.ui).length;
  assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(UNKNOWN_STATUS));

  gate.resolve();
  await waitUntil(() => fixture.tools.inFlight === 0);
  assert.ok(sameActive(fixture.pi, FAIL_CLOSED_ALLOWLIST), "the setter that outlived the shutdown applied the plan");
  assert.deepEqual(sortedNames(fixture.tools.removed), REMOVED_BUILTINS);
  assert.equal(statusTexts(fixture.ui).length, paintsAtShutdown, "the ended attempt paints nothing");

  fixture.pi.holdSetters = null;
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  assert.ok(sameActive(fixture.pi, FAIL_CLOSED_ALLOWLIST), "the next session finds the planned set");
  assert.equal(fixture.pi.activeSets.length, 1, "the next session changes nothing");
  assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(FAIL_CLOSED_STATUS));
});

void test("P16 (a): a setter that resolves after a new session start is read back, and the new session's read finds the plan in place", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  const gate = makeGate();
  fixture.pi.holdSetters = gate.promise;
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitUntil(() => fixture.pi.activeSets.length === 1);
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitUntil(() => fixture.tools.inFlight === 2);

  gate.resolve();
  await waitForDetail(fixture.ui, "container running");
  assert.equal(fixture.pi.activeSets.length, 1, "the new session finds the set already at the plan and changes nothing");
  assert.ok(sameActive(fixture.pi, FAIL_CLOSED_ALLOWLIST));
  assert.deepEqual(sortedNames(fixture.tools.removed), REMOVED_BUILTINS);
});

void test("P16 (lifecycle a): active-tool drift in the same mode is restored on the next guarded call", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");

  await fixture.pi.setActiveTools([...fixture.pi.getActiveTools().filter((name) => name !== "write"), "edit"]);
  assert.deepEqual(await toolCallOf(fixture.pi)({ toolName: "bash" }), POLICY_DENIED_VERDICT);
  assert.ok(sameActive(fixture.pi, FAIL_CLOSED_ALLOWLIST), "write is back and edit is off");
  assert.deepEqual(sortedNames(fixture.tools.removed), REMOVED_BUILTINS);
});

void test("P16 (lifecycle b): fail-closed, advisory, then fail-closed moves the active set and the published mode at each step", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  const toolCall = toolCallOf(fixture.pi);
  assert.ok(sameActive(fixture.pi, FAIL_CLOSED_ALLOWLIST), "fail-closed holds the allowlist");
  assert.equal(await publishedModeOf(fixture), "fail-closed");

  fixture.daemon.mode = "advisory";
  assert.equal(await toolCall({ toolName: "bash" }), undefined, "advisory passes bash");
  assert.ok(sameActive(fixture.pi, EVERY_TOOL), "advisory gives back every tool");
  assert.deepEqual(sortedNames(fixture.tools.removed), []);
  assert.equal(await publishedModeOf(fixture), "advisory");

  fixture.daemon.mode = "fail-closed";
  assert.deepEqual(await toolCall({ toolName: "bash" }), POLICY_DENIED_VERDICT);
  assert.ok(sameActive(fixture.pi, FAIL_CLOSED_ALLOWLIST), "fail-closed removes the built-ins again");
  assert.deepEqual(sortedNames(fixture.tools.removed), REMOVED_BUILTINS);
  assert.equal(await publishedModeOf(fixture), "fail-closed");
});

void test("P16 (lifecycle c): a failed restore followed by an unavailable daemon leaves the planned set, and edit is refused on an unreadable status whatever the last published mode", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  const toolCall = toolCallOf(fixture.pi);

  await fixture.pi.setActiveTools(fixture.pi.getActiveTools().filter((name) => name !== "write"));
  fixture.pi.ignoreRemoval = true;
  assert.deepEqual(await toolCall({ toolName: "bash" }), POLICY_DENIED_VERDICT, "the restore of write does not hold");
  assert.ok(!fixture.pi.getActiveTools().includes("write"), "write stays off while the restore fails");
  assert.deepEqual(sortedNames(fixture.tools.removed), REMOVED_BUILTINS, "the removals still owed are kept");

  fixture.pi.ignoreRemoval = false;
  fixture.daemon.hangStatus = true;
  const failClosedEdit = toolCall({ toolName: "edit" });
  expireTimer(fixture.ctx, GUARD_STATUS_BUDGET_MS);
  assert.deepEqual(await failClosedEdit, { block: true, reason: "TOOL_TIMEOUT" }, "fail-closed, as published, blocks edit");
  assert.ok(sameActive(fixture.pi, FAIL_CLOSED_ALLOWLIST), "the unavailable-status path restores the plan");

  fixture.daemon.hangStatus = false;
  fixture.daemon.mode = "advisory";
  assert.equal(await toolCall({ toolName: "bash" }), undefined, "a readable advisory status publishes advisory");
  fixture.daemon.hangStatus = true;
  const noticesBeforeAdvisoryEdit = fixture.ui.notifications.length;
  const advisoryEdit = toolCall({ toolName: "edit" });
  expireTimer(fixture.ctx, GUARD_STATUS_BUDGET_MS);
  assert.deepEqual(await advisoryEdit, { block: true, reason: "TOOL_TIMEOUT" }, "advisory, as published, refuses edit on an unreadable status");
  fixture.daemon.hangStatus = false;
  assert.equal(fixture.ui.notifications.length, noticesBeforeAdvisoryEdit, "the refused advisory edit adds no notification");
});

void test("P16 (lifecycle d): a deferred setter outlives its timeout, a retry and a shutdown; a new session is refused while it holds, then the next poll reconciles", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  const gate = makeGate();
  fixture.pi.holdSetters = gate.promise;
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitUntil(() => fixture.pi.activeSets.length === 1);
  expireTimer(fixture.ctx, STARTUP_BUDGET_MS);
  await waitForDetail(fixture.ui, "STARTUP_BUDGET_EXCEEDED");

  const retry = retryCommandOf(fixture.pi).handler();
  await waitUntil(() => fixture.tools.inFlight === 2);
  shutdownHandlerOf(fixture.pi)();
  assert.equal(await retry, "realm retry superseded");

  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "POLICY_DENIED");
  assert.equal(fixture.pi.activeSets.length, 1, "the refused read changes nothing while the setter holds");

  gate.resolve();
  await waitUntil(() => fixture.tools.inFlight === 0);
  pollOf(fixture.ctx).callback();
  await waitForDetail(fixture.ui, "container running");
  assert.ok(sameActive(fixture.pi, FAIL_CLOSED_ALLOWLIST), "the poll of the new session leaves the planned set");
  assert.deepEqual(sortedNames(fixture.tools.removed), REMOVED_BUILTINS);
  assert.equal(await publishedModeOf(fixture), "fail-closed");
});

void test("P16 (lifecycle e): a registered tool that disappears from the registry is not restored, and leaves the owed list", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  assert.ok(fixture.tools.removed.includes("edit"), "edit is owed while fail-closed removes it");

  fixture.pi.dropBuiltin("edit");
  fixture.daemon.mode = "advisory";
  assert.equal(await toolCallOf(fixture.pi)({ toolName: "bash" }), undefined);
  assert.ok(!fixture.pi.getActiveTools().includes("edit"), "edit is not restored");
  assert.ok(!(fixture.pi.activeSets.at(-1) ?? []).includes("edit"), "the advisory set never names edit");
  assert.deepEqual(fixture.tools.removed, [], "edit leaves the owed list, and the other removals are restored");
});

void test("P16 (lifecycle f): a tool the user deactivated stays deactivated across a mode cycle", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  await fixture.pi.setActiveTools(fixture.pi.getActiveTools().filter((name) => name !== "glob"));

  for (const mode of ["advisory", "fail-closed", "advisory", "fail-closed"] as const) {
    fixture.daemon.mode = mode;
    await toolCallOf(fixture.pi)({ toolName: "bash" });
    assert.ok(!fixture.pi.getActiveTools().includes("glob"), `glob stays off after the plan for ${mode}`);
    assert.equal(await publishedModeOf(fixture), mode, `${mode} is published`);
  }
});

void test("P16 (lifecycle g): a refused setter never publishes the new mode", async () => {
  const fixture = makeFixture({ mode: "advisory" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  assert.equal(await publishedModeOf(fixture), "advisory");

  fixture.daemon.mode = "fail-closed";
  fixture.pi.ignoreRemoval = true;
  assert.deepEqual(await toolCallOf(fixture.pi)({ toolName: "bash" }), POLICY_DENIED_VERDICT, "the refused change denies bash");
  fixture.pi.ignoreRemoval = false;
  assert.ok(sameActive(fixture.pi, EVERY_TOOL), "the set is unchanged");
  assert.deepEqual(sortedNames(fixture.tools.removed), []);
  assert.equal(await publishedModeOf(fixture), "advisory", "the refused fail-closed mode is not published");
});

// Pins the conservative rule: a non-edit host tool whose status cannot be read is refused, whatever the last published mode. The
// plan leaves this for the owner to confirm (P16-D6 says host tool behaviour follows the last published mode).
void test("OMPX-03 (T2): advisory refuses a host bash call while the status cannot be read, because the mode is unconfirmed", async () => {
  const fixture = makeFixture({ mode: "advisory" });
  fixture.daemon.hangStatus = true;
  const verdict = guardHostToolCall("bash", sessionOf(fixture, fixture.daemon, "advisory"), fixture.tools);
  expireTimer(fixture.ctx, GUARD_STATUS_BUDGET_MS);
  assert.deepEqual(await verdict, POLICY_DENIED_VERDICT);
});

// ---- O4: bounded re-attach (16-04; spec SANDBOX_OMP_PLUGIN_CONNECTION) ------------------------------------------
// Every timer here is manual, and every jitter draw comes from a seeded PRNG, so no test reads the wall clock or Math.random.

// mulberry32: a small seeded PRNG returning values in [0, 1). It is the injected random of every re-attach test.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Every timer the fake host armed and has not cleared.
function pendingTimers(ctx: FakeCtx): ArmedTimer[] {
  return ctx.armed.filter((timer) => !ctx.cleared.includes(timer.handle));
}

// The re-attach waits pending: every pending timer except the attach budget, which always runs at STARTUP_BUDGET_MS.
function pendingWaits(ctx: FakeCtx): ArmedTimer[] {
  return pendingTimers(ctx).filter((timer) => timer.ms !== STARTUP_BUDGET_MS);
}

// The one pending wait. The test fails unless exactly one is pending.
function soleWait(ctx: FakeCtx): ArmedTimer {
  const waits = pendingWaits(ctx);
  assert.equal(waits.length, 1, "exactly one re-attach wait is pending");
  const [wait] = waits;
  assert.ok(wait !== undefined, "a re-attach wait is pending");
  return wait;
}

// Fires the pending wait the way a host does: the callback runs, then the host clears the handle.
function fireWait(ctx: FakeCtx): void {
  const wait = soleWait(ctx);
  wait.callback();
  ctx.clearTimer(wait.handle);
}

// Resolves once a drop has armed its wait. The wait is pending and the status item paints connecting, which the plugin does only
// after it arms the wait. A guard read still in flight is also pending, so the pending count alone would resolve too early.
async function waitArmed(fixture: Fixture): Promise<void> {
  await waitUntil(() => pendingWaits(fixture.ctx).length === 1 && (lastDetail(fixture.ui) ?? "").startsWith("connecting"));
}

// Drives a streak whose every attach fails: each wait fires in turn, and the last attach exhausts the cap. Returns the wait lengths.
async function exhaustStreak(fixture: Fixture): Promise<number[]> {
  const delays: number[] = [];
  for (let index = 0; index < REATTACH_RETRY_CAP; index += 1) {
    await waitArmed(fixture);
    delays.push(soleWait(fixture.ctx).ms);
    fireWait(fixture.ctx);
  }
  await waitUntil(() => fixture.ui.notifications.some((text) => text.includes(`/${REALM_RETRY_COMMAND}`)));
  return delays;
}

void test("O4 R1: a dropped link is detected on the poll, paints connecting, and re-attaches after one jittered wait to active", async () => {
  const fixture = makeFixture({ reattach: { enabled: true, random: seededRandom(1) } });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");

  fixture.daemon.failStatus = "REALM_NOT_ACTIVE";
  pollOf(fixture.ctx).callback();
  await waitArmed(fixture);
  const wait = soleWait(fixture.ctx);
  assert.ok(wait.ms >= 500 && wait.ms <= 1000, `attempt 1 waits within [500, 1000] ms, got ${String(wait.ms)}`);
  assert.equal(lastLabel(fixture.ui), DISCONNECTED_LABEL);
  assert.match(lastDetail(fixture.ui) ?? "", /^connecting \(REALM_NOT_ACTIVE\) · /);
  assert.equal(fixture.daemon.count("close"), 1, "the dropped client is closed once");

  fixture.daemon.failStatus = undefined;
  fireWait(fixture.ctx);
  await waitUntil(() => lastLabel(fixture.ui) === ACTIVE_LABEL);
  assert.equal(fixture.attachCalls.length, 2, "the wait re-attaches once");
  assert.deepEqual(pendingTimers(fixture.ctx), [], "no timer is pending once the link is back");
});

void test("O4 R2: delays grow with equal jitter and cap at 60 s", async () => {
  const ceilings = [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000];
  const runStreak = async (random: () => number): Promise<number[]> => {
    const fixture = makeFixture({
      attach: () => Promise.reject(makeRealmError("REALM_NOT_ACTIVE")),
      reattach: { enabled: true, random },
    });
    startHandlerOf(fixture.pi)(fixture.ctx);
    const delays = await exhaustStreak(fixture);
    assert.equal(fixture.attachCalls.length, 1 + REATTACH_RETRY_CAP, "one attach at start and one per wait");
    return delays;
  };

  assert.deepEqual(await runStreak(() => 1), ceilings, "with random at 1 each wait is its ceiling");
  assert.deepEqual(
    await runStreak(() => 0),
    ceilings.map((ceiling) => ceiling / 2),
    "with random at 0 each wait is half its ceiling",
  );
  const seeded = await runStreak(seededRandom(2));
  seeded.forEach((delay, index) => {
    const ceiling = ceilings[index] ?? 0;
    assert.ok(
      delay >= ceiling / 2 && delay <= ceiling,
      `wait ${String(index + 1)} is ${String(delay)}, within [${String(ceiling / 2)}, ${String(ceiling)}]`,
    );
  });
});

void test("O4 R3: retry exhaustion reaches FAILED with the catalogue code, notifies the action, and leaves no pending timer", async () => {
  const fixture = makeFixture({
    attach: () => Promise.reject(makeRealmError("REALM_NOT_ACTIVE")),
    reattach: { enabled: true, random: seededRandom(3) },
  });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await exhaustStreak(fixture);
  assert.equal(fixture.attachCalls.length, 1 + REATTACH_RETRY_CAP, "one attach at start and one per wait");
  assert.equal(lastLabel(fixture.ui), DISCONNECTED_LABEL);
  assert.match(lastDetail(fixture.ui) ?? "", /^REALM_NOT_ACTIVE · /, "the label carries the catalogue code");
  assert.ok(
    fixture.ui.notifications.some((text) => text.includes("REALM_NOT_ACTIVE") && text.includes(`/${REALM_RETRY_COMMAND}`)),
    "FAILED notifies the code and the /realm-retry action",
  );
  assert.deepEqual(pendingTimers(fixture.ctx), [], "FAILED leaves no timer pending");
  await yieldTurn();
  assert.equal(fixture.attachCalls.length, 1 + REATTACH_RETRY_CAP, "FAILED makes no automatic attempt");
});

void test("O4 R4: a non-retryable refusal reaches FAILED at once with no wait", async () => {
  const cases: ReadonlyArray<{ readonly code: string; readonly attach: (daemon: FakeDaemon) => Promise<DaemonAttach> }> = [
    {
      code: "PODMAN_MISSING",
      attach: (daemon) => Promise.resolve({ client: daemon, refusal: makeRealmError("PODMAN_MISSING") }),
    },
    { code: "SCHEMA_INVALID", attach: () => Promise.reject(makeRealmError("SCHEMA_INVALID")) },
  ];
  for (const { code, attach } of cases) {
    const fixture = makeFixture({ attach, reattach: { enabled: true, random: seededRandom(4) } });
    startHandlerOf(fixture.pi)(fixture.ctx);
    await waitUntil(() => fixture.ui.notifications.some((text) => text.includes(`/${REALM_RETRY_COMMAND}`)));
    assert.equal(fixture.attachCalls.length, 1, `${code}: no re-attach is made`);
    assert.deepEqual(pendingTimers(fixture.ctx), [], `${code}: no wait is armed`);
    assert.match(lastDetail(fixture.ui) ?? "", new RegExp(`^${code} · `), `${code}: the label carries its own code`);
  }
});

void test("O4 R5: shutdown during a backoff clears the wait and starts no attach", async () => {
  const fixture = makeFixture({ reattach: { enabled: true, random: seededRandom(5) } });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  fixture.daemon.failStatus = "REALM_NOT_ACTIVE";
  pollOf(fixture.ctx).callback();
  await waitArmed(fixture);
  const wait = soleWait(fixture.ctx);

  shutdownHandlerOf(fixture.pi)();
  assert.ok(fixture.ctx.cleared.includes(wait.handle), "shutdown clears the pending wait");
  assert.deepEqual(pendingTimers(fixture.ctx), [], "no timer survives shutdown");
  wait.callback();
  await yieldTurn();
  assert.equal(fixture.attachCalls.length, 1, "no attach runs after shutdown, even when the wait's callback runs late");
});

void test("O4 R6: a second loss signal during a wait arms no second timer; realm-retry cancels the wait and attaches once; the counter resets", async () => {
  const fixture = makeFixture({ reattach: { enabled: true, random: seededRandom(6) } });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  fixture.daemon.failStatus = "REALM_NOT_ACTIVE";
  pollOf(fixture.ctx).callback();
  await waitArmed(fixture);
  const first = soleWait(fixture.ctx);

  // A second signal from the guard and one from the poll. The client is already released, so neither arms a timer.
  assert.deepEqual(await toolCallOf(fixture.pi)({ toolName: "edit" }), { block: true, reason: "REALM_NOT_ACTIVE" });
  pollOf(fixture.ctx).callback();
  await yieldTurn();
  assert.deepEqual(pendingWaits(fixture.ctx).map((timer) => timer.handle), [first.handle], "still the one first wait");
  assert.equal(fixture.attachCalls.length, 1, "no attach runs while the wait is pending");

  fixture.daemon.failStatus = undefined;
  const result = await retryCommandOf(fixture.pi).handler();
  assert.match(result, /active/, "realm-retry reports the active state");
  assert.ok(fixture.ctx.cleared.includes(first.handle), "realm-retry cancels the pending wait");
  assert.equal(fixture.attachCalls.length, 2, "realm-retry attaches once");
  assert.deepEqual(pendingWaits(fixture.ctx), [], "no wait survives the retry");

  fixture.daemon.failStatus = "REALM_NOT_ACTIVE";
  pollOf(fixture.ctx).callback();
  await waitArmed(fixture);
  assert.ok(fixture.ui.notifications.at(-1)?.includes("attempt 1 of 8"), "the counter reset, so the next drop is attempt 1");
});

void test("O4 R7: with the option absent or disabled, a drop behaves exactly as today", async () => {
  const variants: ReadonlyArray<FixtureOptions> = [{}, { reattach: { enabled: false, random: seededRandom(7) } }];
  for (const variant of variants) {
    const fixture = makeFixture(variant);
    startHandlerOf(fixture.pi)(fixture.ctx);
    await waitForDetail(fixture.ui, "container running");
    fixture.daemon.failStatus = "REALM_NOT_ACTIVE";
    pollOf(fixture.ctx).callback();
    await waitUntil(() => lastLabel(fixture.ui) === DISCONNECTED_LABEL);
    assert.match(lastDetail(fixture.ui) ?? "", /^REALM_NOT_ACTIVE · /, "the poll paints the code, as before");
    assert.equal(fixture.attachCalls.length, 1, "no re-attach runs");
    assert.deepEqual(pendingTimers(fixture.ctx), [], "no wait is armed");
    assert.deepEqual(fixture.ui.notifications, [], "no re-attach notice is shown");
  }
});

void test("O4 R8: an in-flight write that loses the link reports AUDIT_OUTCOME_UNKNOWN and is not dispatched again", async () => {
  const fixture = makeFixture({ reattach: { enabled: true, random: seededRandom(8) } });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");

  fixture.daemon.callError = "REALM_NOT_ACTIVE";
  const result = await toolOf(fixture.pi, "write").execute("call-r8", { path: "a.txt", content: "x" });
  assert.deepEqual(result.details, { outcome: "refused", tool: "write", code: "AUDIT_OUTCOME_UNKNOWN", retryable: false });
  assert.equal(result.isError, true);
  assert.equal(fixture.daemon.dispatched.length, 1, "the write reaches the daemon once and is never dispatched again");
  assert.equal(pendingWaits(fixture.ctx).length, 1, "the loss arms one re-attach wait");
});

void test("O4 R8b: a read that loses the link keeps the code it failed with and still arms one wait", async () => {
  const fixture = makeFixture({ reattach: { enabled: true, random: seededRandom(9) } });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");

  fixture.daemon.callError = "TOOL_TIMEOUT";
  const result = await toolOf(fixture.pi, "read").execute("call-r8b", { path: "a.txt", maxBytes: 16 });
  const details = result.details as ToolOutcome;
  assert.ok(details.outcome === "refused" && details.code === "TOOL_TIMEOUT", "the read keeps TOOL_TIMEOUT");
  assert.equal(pendingWaits(fixture.ctx).length, 1, "the loss arms one re-attach wait");
});

void test("O4 R9: a hung status read is bounded by GUARD_STATUS_BUDGET_MS and counts as a loss; every wait stays at or below 60 s", async () => {
  const fixture = makeFixture({ reattach: { enabled: true, random: seededRandom(10) } });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");

  fixture.daemon.hangStatus = true;
  pollOf(fixture.ctx).callback();
  assert.equal(armedTimer(fixture.ctx, GUARD_STATUS_BUDGET_MS).ms, GUARD_STATUS_BUDGET_MS, "the status read is armed with its bound");
  expireTimer(fixture.ctx, GUARD_STATUS_BUDGET_MS);
  await waitArmed(fixture);
  assert.ok(fixture.ui.notifications.at(-1)?.includes("TOOL_TIMEOUT"), "the timed-out read is reported as the loss");
  assert.ok(soleWait(fixture.ctx).ms <= REATTACH_DELAY_CAP_MS, "the wait is at or below 60 s");

  fixture.daemon.hangStatus = false;
  fireWait(fixture.ctx);
  await waitUntil(() => lastLabel(fixture.ui) === ACTIVE_LABEL);
});

void test("O4 R10: re-up is idempotent: a re-attach registers no tool again and arms no second poll", async () => {
  const fixture = makeFixture({ reattach: { enabled: true, random: seededRandom(11) } });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  const registeredAtStart = fixture.pi.registrations.length;

  for (let cycle = 0; cycle < 2; cycle += 1) {
    fixture.daemon.failStatus = "REALM_NOT_ACTIVE";
    pollOf(fixture.ctx).callback();
    await waitArmed(fixture);
    fixture.daemon.failStatus = undefined;
    fireWait(fixture.ctx);
    await waitUntil(() => lastLabel(fixture.ui) === ACTIVE_LABEL);
  }
  assert.equal(fixture.attachCalls.length, 3, "two re-attaches after the start attach");
  assert.equal(fixture.pi.registrations.length, registeredAtStart, "no tool is registered again");
  assert.equal(fixture.ctx.intervals.length, 1, "one poll interval, armed at session start");
});

void test("O4 R11: a transition outside the table is rejected and reported through ui.notify, and applies nothing", async () => {
  assert.equal(reattachTransitionAllowed("failed", "reconnecting"), false, "failed to reconnecting is not in the table");
  const gate = makeGate();
  const fixture = makeFixture({
    attach: async (daemon) => {
      await gate.promise;
      return { client: daemon, refusal: null };
    },
    reattach: { enabled: true, random: seededRandom(12) },
  });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitUntil(() => fixture.attachCalls.length === 1);

  // A retry while the start attach is in flight asks for attaching -> attaching, which the table refuses.
  assert.equal(await retryCommandOf(fixture.pi).handler(), "realm retry: an attach is already in progress");
  assert.ok(fixture.ui.notifications.some((text) => text.includes("attaching -> attaching")), "the refused move is named");
  assert.equal(fixture.attachCalls.length, 1, "the refused retry starts no second attach");

  gate.resolve();
  await waitForDetail(fixture.ui, "container running");
  assert.equal(lastLabel(fixture.ui), ACTIVE_LABEL);
});

void test("O4 T1: the equal-jitter delay lies in [ceiling/2, ceiling] for each attempt, and the ceiling caps at 60 s from attempt 7", () => {
  assert.equal(REATTACH_RETRY_CAP, 8);
  assert.equal(REATTACH_BASE_DELAY_MS, 1000);
  assert.equal(REATTACH_DELAY_CAP_MS, 60000);
  const ceilings = [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000];
  ceilings.forEach((ceiling, index) => {
    const attempt = index + 1;
    assert.equal(
      equalJitterDelayMs(attempt, REATTACH_BASE_DELAY_MS, REATTACH_DELAY_CAP_MS, () => 0),
      ceiling / 2,
      `attempt ${String(attempt)} at its floor`,
    );
    assert.equal(
      equalJitterDelayMs(attempt, REATTACH_BASE_DELAY_MS, REATTACH_DELAY_CAP_MS, () => 1),
      ceiling,
      `attempt ${String(attempt)} at its ceiling`,
    );
  });
  assert.equal(equalJitterDelayMs(50, REATTACH_BASE_DELAY_MS, REATTACH_DELAY_CAP_MS, () => 1), 60000, "a late attempt stays at the cap");

  const random = seededRandom(20);
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    const ceiling = Math.min(REATTACH_DELAY_CAP_MS, REATTACH_BASE_DELAY_MS * 2 ** (attempt - 1));
    const delay = equalJitterDelayMs(attempt, REATTACH_BASE_DELAY_MS, REATTACH_DELAY_CAP_MS, random);
    assert.ok(
      delay >= ceiling / 2 && delay <= ceiling,
      `attempt ${String(attempt)}: ${String(delay)} lies within [${String(ceiling / 2)}, ${String(ceiling)}]`,
    );
  }
});

void test("O4 T1: invalid jitter inputs are a RangeError", () => {
  const half = (): number => 0.5;
  assert.throws(() => equalJitterDelayMs(0, 1000, 60000, half), RangeError, "attempt 0 is refused");
  assert.throws(() => equalJitterDelayMs(1.5, 1000, 60000, half), RangeError, "a non-integer attempt is refused");
  assert.throws(() => equalJitterDelayMs(-1, 1000, 60000, half), RangeError, "a negative attempt is refused");
  assert.throws(() => equalJitterDelayMs(1, -1, 60000, half), RangeError, "a negative base is refused");
  assert.throws(() => equalJitterDelayMs(1, 1000, -1, half), RangeError, "a negative cap is refused");
  assert.throws(() => equalJitterDelayMs(1, 61000, 60000, half), RangeError, "a base above the cap is refused");
  assert.throws(() => equalJitterDelayMs(1, 1000, 60000, () => -0.1), RangeError, "a random value below 0 is refused");
  assert.throws(() => equalJitterDelayMs(1, 1000, 60000, () => 1.1), RangeError, "a random value above 1 is refused");
  assert.throws(() => equalJitterDelayMs(1, 1000, 60000, () => Number.NaN), RangeError, "a NaN random value is refused");
});

void test("O4 T1: the re-attach transition table allows exactly the listed moves and refuses the rest", () => {
  const listed: ReadonlyArray<readonly [ReattachState, ReattachState]> = [
    ["linked", "reconnecting"],
    ["linked", "attaching"],
    ["reconnecting", "attaching"],
    ["attaching", "linked"],
    ["attaching", "reconnecting"],
    ["attaching", "failed"],
    ["failed", "attaching"],
  ];
  const states: readonly ReattachState[] = ["off", "linked", "reconnecting", "attaching", "failed"];
  for (const from of states) {
    for (const to of states) {
      const expected = listed.some(([listedFrom, listedTo]) => listedFrom === from && listedTo === to);
      assert.equal(reattachTransitionAllowed(from, to), expected, `${from} -> ${to}`);
    }
  }
});

void test("O4 T1: the lost-link and retryable code sets are the ones the plan names", () => {
  assert.deepEqual([...LINK_LOST_CODES], ["REALM_NOT_ACTIVE", "TOOL_TIMEOUT"]);
  assert.deepEqual([...RETRYABLE_ATTACH_CODES], [
    "REALM_NOT_ACTIVE",
    "TOOL_TIMEOUT",
    "STARTUP_BUDGET_EXCEEDED",
    "DAEMON_START_TIMEOUT",
  ]);
});

// Omp session_switch (plan 10 T2; docs/integration/omp.md, row S2b).
void test("plan 10 T2 (a): a session switch to another directory re-attaches with that directory and closes the previous client (MULTI-03)", async () => {
  const fixture = makeFixture({ attach: (daemon) => Promise.resolve({ client: daemon, refusal: null }) });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitUntil(() => lastLabel(fixture.ui) === ACTIVE_LABEL);

  switchHandlerOf(fixture.pi)(new FakeCtx(fixture.ui, "/ws-b"));
  // attachDaemon is invoked from a microtask, so the new directory is observed after one turn of the event loop.
  await yieldTurn();

  assert.deepEqual(fixture.attachCalls, [WORKSPACE, "/ws-b"], "the switch re-attaches with the new directory");
  assert.ok(fixture.daemon.calls.includes("close"), "the previous client is closed");
  await waitUntil(() => lastLabel(fixture.ui) === ACTIVE_LABEL);
});

void test("plan 10 T2 (b): a session switch that keeps the working directory keeps the attachment (MULTI-03)", async () => {
  const fixture = makeFixture({ attach: (daemon) => Promise.resolve({ client: daemon, refusal: null }) });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitUntil(() => lastLabel(fixture.ui) === ACTIVE_LABEL);

  switchHandlerOf(fixture.pi)(new FakeCtx(fixture.ui, WORKSPACE));

  assert.deepEqual(fixture.attachCalls, [WORKSPACE], "the same directory does not attach again");
  assert.equal(fixture.daemon.calls.filter((call) => call === "close").length, 0, "the attachment is kept");
});

void test("plan 10 T2 (c): a session switch whose context carries no working directory keeps the attachment (MULTI-03)", async () => {
  const fixture = makeFixture({ attach: (daemon) => Promise.resolve({ client: daemon, refusal: null }) });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitUntil(() => lastLabel(fixture.ui) === ACTIVE_LABEL);

  switchHandlerOf(fixture.pi)({} as OmpSessionContext);

  assert.deepEqual(fixture.attachCalls, [WORKSPACE], "a payload without a directory does not attach again");
  assert.equal(fixture.daemon.calls.filter((call) => call === "close").length, 0, "the attachment is kept");
});

void test("status disclosure follows read-back on attach and mode-only poll changes", async () => {
  const fixture = makeFixture();
  const gate = makeGate();
  fixture.pi.holdSetters = gate.promise;
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitUntil(() => fixture.pi.activeSets.length === 1);
  assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(UNKNOWN_STATUS));
  assert.ok(sameActive(fixture.pi, EVERY_TOOL));

  gate.resolve();
  await waitUntil(() => statusTexts(fixture.ui).at(-1)?.endsWith(FAIL_CLOSED_STATUS) === true);
  assert.ok(sameActive(fixture.pi, FAIL_CLOSED_ALLOWLIST));
  fixture.pi.holdSetters = null;
  const initialPaints = statusTexts(fixture.ui).length;
  pollOf(fixture.ctx).callback();
  await yieldTurn();
  assert.equal(statusTexts(fixture.ui).length, initialPaints);

  fixture.daemon.mode = "advisory";
  pollOf(fixture.ctx).callback();
  await waitUntil(() => statusTexts(fixture.ui).at(-1)?.endsWith(ADVISORY_STATUS) === true);
  assert.ok(sameActive(fixture.pi, EVERY_TOOL));
  assert.equal(statusTexts(fixture.ui).length, initialPaints + 1);
  fixture.daemon.mode = "fail-closed";
  pollOf(fixture.ctx).callback();
  await waitUntil(() => statusTexts(fixture.ui).at(-1)?.endsWith(FAIL_CLOSED_STATUS) === true);
  assert.ok(sameActive(fixture.pi, FAIL_CLOSED_ALLOWLIST));
  assert.equal(statusTexts(fixture.ui).length, initialPaints + 2);
});

void test("guarded mode change waits for the setter and read-back before repainting", async () => {
  const fixture = makeFixture({ mode: "advisory" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  const gate = makeGate();
  fixture.pi.holdSetters = gate.promise;
  fixture.daemon.mode = "fail-closed";
  const pending = toolCallOf(fixture.pi)({ toolName: "bash" });
  await waitUntil(() => fixture.pi.activeSets.length === 1);
  assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(ADVISORY_STATUS));
  assert.ok(sameActive(fixture.pi, EVERY_TOOL));
  gate.resolve();
  assert.deepEqual(await pending, POLICY_DENIED_VERDICT);
  assert.ok(sameActive(fixture.pi, FAIL_CLOSED_ALLOWLIST));
  assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(FAIL_CLOSED_STATUS));
});

void test("initial rejected or nonholding setter reports unknown and preserves POLICY_DENIED", async () => {
  for (const failure of ["reject", "mismatch"] as const) {
    const fixture = makeFixture();
    fixture.pi.rejectSetter = failure === "reject";
    fixture.pi.ignoreRemoval = failure === "mismatch";
    startHandlerOf(fixture.pi)(fixture.ctx);
    await waitForDetail(fixture.ui, "POLICY_DENIED");
    assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(UNKNOWN_STATUS), failure);
    assert.ok(sameActive(fixture.pi, EVERY_TOOL), failure);
    assert.deepEqual(await toolCallOf(fixture.pi)({ toolName: "bash" }), POLICY_DENIED_VERDICT);
    assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(UNKNOWN_STATUS), failure);
  }
});

void test("already-correct host tools require a successful read-back before publication", async () => {
  const fixture = makeFixture({ mode: "advisory" });
  fixture.pi.activeReadOverride = (count, actual) => count >= 3 ? [] : actual;
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "POLICY_DENIED");
  assert.equal(fixture.pi.activeSets.length, 0, "no setter was needed");
  assert.ok(fixture.pi.activeReads >= 4, "the unchanged set was read back");
  assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(UNKNOWN_STATUS));
  fixture.pi.activeReadOverride = null;
  pollOf(fixture.ctx).callback();
  await waitUntil(() => statusTexts(fixture.ui).at(-1)?.endsWith(ADVISORY_STATUS) === true);
  assert.ok(sameActive(fixture.pi, EVERY_TOOL));
});

void test("failed poll mode changes retain last applied posture and unreadable guard decisions", async () => {
  for (const previous of ["advisory", "fail-closed"] as const) {
    for (const failure of ["reject", "mismatch"] as const) {
      const fixture = makeFixture({ mode: previous });
      startHandlerOf(fixture.pi)(fixture.ctx);
      await waitForDetail(fixture.ui, "container running");
      fixture.daemon.mode = previous === "advisory" ? "fail-closed" : "advisory";
      fixture.pi.rejectSetter = failure === "reject";
      fixture.pi.ignoreRemoval = failure === "mismatch";
      pollOf(fixture.ctx).callback();
      await waitForDetail(fixture.ui, "POLICY_DENIED");
      const retained = previous === "advisory" ? LAST_ADVISORY_STATUS : LAST_FAIL_CLOSED_STATUS;
      assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(retained), `${previous}, ${failure}`);
      assert.ok(sameActive(fixture.pi, previous === "advisory" ? EVERY_TOOL : FAIL_CLOSED_ALLOWLIST));
      fixture.pi.rejectSetter = false;
      fixture.pi.ignoreRemoval = false;
      fixture.daemon.hangStatus = true;
      const noticesBeforeEdit = fixture.ui.notifications.length;
      const pending = toolCallOf(fixture.pi)({ toolName: "edit" });
      expireTimer(fixture.ctx, GUARD_STATUS_BUDGET_MS);
      assert.deepEqual(await pending, { block: true, reason: "TOOL_TIMEOUT" }, `${previous}, ${failure}: an unreadable status refuses edit`);
      assert.equal(fixture.ui.notifications.length, noticesBeforeEdit, `${previous}, ${failure}: the refused edit adds no notification`);
      assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(retained));
    }
  }
});

void test("failed guarded mode changes never paint the requested posture", async () => {
  for (const previous of ["advisory", "fail-closed"] as const) {
    for (const failure of ["reject", "mismatch"] as const) {
      const fixture = makeFixture({ mode: previous });
      startHandlerOf(fixture.pi)(fixture.ctx);
      await waitForDetail(fixture.ui, "container running");
      fixture.daemon.mode = previous === "advisory" ? "fail-closed" : "advisory";
      fixture.pi.rejectSetter = failure === "reject";
      fixture.pi.ignoreRemoval = failure === "mismatch";
      assert.deepEqual(await toolCallOf(fixture.pi)({ toolName: "bash" }), POLICY_DENIED_VERDICT);
      const text = statusTexts(fixture.ui).at(-1) ?? "";
      assert.match(text, /POLICY_DENIED/);
      assert.ok(text.endsWith(previous === "advisory" ? LAST_ADVISORY_STATUS : LAST_FAIL_CLOSED_STATUS));
      assert.ok(sameActive(fixture.pi, previous === "advisory" ? EVERY_TOOL : FAIL_CLOSED_ALLOWLIST));
      fixture.pi.rejectSetter = false;
      fixture.pi.ignoreRemoval = false;
      fixture.daemon.hangStatus = true;
      const noticesBeforeEdit = fixture.ui.notifications.length;
      const pending = toolCallOf(fixture.pi)({ toolName: "edit" });
      expireTimer(fixture.ctx, GUARD_STATUS_BUDGET_MS);
      assert.deepEqual(await pending, { block: true, reason: "TOOL_TIMEOUT" }, `${previous}, ${failure}: an unreadable status refuses edit`);
      assert.equal(fixture.ui.notifications.length, noticesBeforeEdit, `${previous}, ${failure}: the refused edit adds no notification`);
      assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(previous === "advisory" ? LAST_ADVISORY_STATUS : LAST_FAIL_CLOSED_STATUS));
    }
  }
});

void test("disconnect keeps last applied mode and error until successful reconnect", async () => {
  const reconnect = makeGate();
  let attaches = 0;
  const fixture = makeFixture({
    mode: "advisory",
    reattach: { enabled: true, random: seededRandom(1) },
    attach: async (daemon) => {
      attaches += 1;
      if (attaches === 2) await reconnect.promise;
      return { client: daemon, refusal: null };
    },
  });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  fixture.daemon.failStatus = "REALM_NOT_ACTIVE";
  pollOf(fixture.ctx).callback();
  await waitArmed(fixture);
  assert.match(statusTexts(fixture.ui).at(-1) ?? "", /connecting \(REALM_NOT_ACTIVE\) · /);
  assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(LAST_ADVISORY_STATUS));
  const disconnectedText = statusTexts(fixture.ui).at(-1);
  fixture.daemon.failStatus = undefined;
  fixture.daemon.mode = "fail-closed";
  fireWait(fixture.ctx);
  await waitUntil(() => attaches === 2);
  assert.equal(statusTexts(fixture.ui).at(-1), disconnectedText, "the retry retains the error code and its time");
  reconnect.resolve();
  await waitUntil(() => statusTexts(fixture.ui).at(-1)?.endsWith(FAIL_CLOSED_STATUS) === true);
  assert.ok(sameActive(fixture.pi, FAIL_CLOSED_ALLOWLIST));
});

void test("a superseded guarded setter cannot paint into the switched session", async () => {
  const nextAttach = makeGate();
  let attaches = 0;
  const fixture = makeFixture({
    mode: "fail-closed",
    attach: async (daemon) => {
      attaches += 1;
      if (attaches === 2) await nextAttach.promise;
      return { client: daemon, refusal: null };
    },
  });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  const setter = makeGate();
  fixture.pi.holdSetters = setter.promise;
  fixture.daemon.mode = "advisory";
  const pending = toolCallOf(fixture.pi)({ toolName: "bash" });
  await waitUntil(() => fixture.pi.activeSets.length === 2);
  switchHandlerOf(fixture.pi)(new FakeCtx(fixture.ui, "/ws-b"));
  assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(UNKNOWN_STATUS));
  const switchedPaints = statusTexts(fixture.ui).length;
  setter.resolve();
  assert.deepEqual(await pending, { block: true, reason: "REALM_NOT_ACTIVE" });
  assert.equal(statusTexts(fixture.ui).length, switchedPaints);
  fixture.pi.holdSetters = null;
  nextAttach.resolve();
  await waitUntil(() => statusTexts(fixture.ui).at(-1)?.endsWith(ADVISORY_STATUS) === true);
  assert.ok(sameActive(fixture.pi, EVERY_TOOL));
});

void test("invalid daemon mode reports the error without publishing it", async () => {
  const fixture = makeFixture({ mode: "advisory" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  fixture.daemon.mode = "invalid" as unknown as PolicyMode;
  pollOf(fixture.ctx).callback();
  await waitForDetail(fixture.ui, "POLICY_DENIED");
  assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(LAST_ADVISORY_STATUS));
  assert.ok(sameActive(fixture.pi, EVERY_TOOL));
  const paints = statusTexts(fixture.ui).length;
  pollOf(fixture.ctx).callback();
  await yieldTurn();
  assert.equal(statusTexts(fixture.ui).length, paints, "the same failure and timestamp stay quiet");
});

void test("a failed UI write for a mode-only change remains retryable", () => {
  const writes: string[] = [];
  let reject = false;
  const ui: OmpStatusUi = {
    setStatus(_key, text) {
      if (reject) throw new Error("rpc transport");
      writes.push(text);
    },
    notify() {},
  };
  renderRealmStatus(ui, ACTIVE, "fail-closed", true);
  reject = true;
  assert.throws(() => { renderRealmStatus(ui, ACTIVE, "advisory", true); }, /rpc transport/);
  reject = false;
  renderRealmStatus(ui, ACTIVE, "advisory", true);
  renderRealmStatus(ui, ACTIVE, "advisory", true);
  assert.equal(writes.length, 2);
  assert.ok(writes[0]?.endsWith(FAIL_CLOSED_STATUS));
  assert.ok(writes[1]?.endsWith(ADVISORY_STATUS));
});

void test("an invalid initial mode and an unreadable status remain unknown", async () => {
  const fixture = makeFixture();
  fixture.daemon.mode = "invalid" as unknown as PolicyMode;
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "POLICY_DENIED");
  assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(UNKNOWN_STATUS));
  assert.ok(sameActive(fixture.pi, EVERY_TOOL));
  assert.deepEqual(await toolCallOf(fixture.pi)({ toolName: "bash" }), POLICY_DENIED_VERDICT);
  assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(UNKNOWN_STATUS));
});

void test("a same-state attach refusal survives a later successful mode reconciliation", async () => {
  const fixture = makeFixture({
    snapshot: UNBOUND,
    attach: (daemon) => Promise.resolve({ client: daemon, refusal: makeRealmError("PODMAN_UNSUPPORTED_VERSION") }),
  });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "PODMAN_UNSUPPORTED_VERSION");
  fixture.daemon.mode = "advisory";
  fixture.pi.rejectSetter = true;
  assert.deepEqual(await toolCallOf(fixture.pi)({ toolName: "bash" }), POLICY_DENIED_VERDICT);
  assert.match(statusTexts(fixture.ui).at(-1) ?? "", /POLICY_DENIED/);
  assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(LAST_FAIL_CLOSED_STATUS));
  fixture.pi.rejectSetter = false;
  assert.equal(await toolCallOf(fixture.pi)({ toolName: "bash" }), undefined);
  assert.match(statusTexts(fixture.ui).at(-1) ?? "", /PODMAN_UNSUPPORTED_VERSION/);
  assert.ok(statusTexts(fixture.ui).at(-1)?.endsWith(ADVISORY_STATUS));
  assert.ok(sameActive(fixture.pi, EVERY_TOOL));
});

void test("reconnect error is disclosed without changing the shared connecting reason", () => {
  const ui = new FakeUi();
  const connecting = { ...CONNECTING, reason: "daemon detail is normalized" };
  renderRealmStatus(ui, connecting, "advisory", false);
  assert.equal(statusTexts(ui).at(-1), `${DISCONNECTED_LABEL} · connecting · ${CLOCK_ISO} · ${LAST_ADVISORY_STATUS}`);
  renderRealmStatus(ui, connecting, "advisory", false, "REALM_NOT_ACTIVE");
  assert.equal(statusTexts(ui).at(-1), `${DISCONNECTED_LABEL} · connecting (REALM_NOT_ACTIVE) · ${CLOCK_ISO} · ${LAST_ADVISORY_STATUS}`);
  renderRealmStatus(ui, connecting, "advisory", false, "REALM_NOT_ACTIVE");
  assert.equal(statusTexts(ui).length, 2, "unchanged full reconnect status stays deduplicated");
});
