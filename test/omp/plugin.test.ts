import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRealmError, type ErrorCode } from "../../src/core/errors.js";
import type { StateSnapshot } from "../../src/core/state-machine.js";
import { STATUS_LABELS, displayStatus } from "../../src/core/status.js";
import type { DaemonClient, DaemonStatus } from "../../src/daemon/client.js";
import type { PolicyMode } from "../../src/contract/validate.js";
import type { ToolOutcome } from "../../src/tools/dispatch.js";
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
  type HostToolCall,
  type HostToolVerdict,
  type OmpExtensionApi,
  type OmpSessionContext,
  type OmpStatusUi,
  type RealmPluginOptions,
  type RealmRetryCommand,
} from "../../src/omp/plugin.js";

// OMP-01 to OMP-05 plugin proof (P5-D4 to P5-D6, P5-D8, P5-D14). Every test runs the real plugin
// wiring against a FakeDaemon injected through attachDaemon. The doubles are the FakePi host
// (capturing handlers and commands), the FakeCtx managed timers (manual: a test fires them), and the
// FakeDaemon client. Required mode is the fail-closed policy mode; advisory is the default.

const CLOCK_ISO = "2026-10-21T09:30:00.000Z";
const ACTIVE: StateSnapshot = { state: "active", reason: "container running", lastTransitionAt: CLOCK_ISO };
const CONNECTING: StateSnapshot = { state: "connecting", reason: "connecting", lastTransitionAt: CLOCK_ISO };
const ACTIVE_LABEL = `● ${STATUS_LABELS.active}`;
const DEGRADED_LABEL = `● ${STATUS_LABELS.active} [degraded]`;
const DISCONNECTED_LABEL = `○ ${STATUS_LABELS.disconnected}`;
const WORKSPACE = "/ws";
const SEPARATOR = " · ";

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

// The status item text is "<label> · <reason> · <time>". The label is the first segment.
function labelOf(text: string): string {
  return text.split(SEPARATOR)[0] ?? "";
}

// The detail is everything after the label: "<reason> · <time>".
function detailOf(text: string): string {
  return text.slice(labelOf(text).length + SEPARATOR.length);
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

  constructor(snapshot: StateSnapshot, mode: PolicyMode) {
    this.snapshot = snapshot;
    this.mode = mode;
  }

  status(): Promise<DaemonStatus> {
    this.calls.push("status");
    if (this.hangStatus) {
      return new Promise<DaemonStatus>(() => undefined);
    }
    return Promise.resolve(this.value());
  }

  up(): Promise<DaemonStatus> {
    this.calls.push("up");
    return Promise.resolve(this.value());
  }

  call(): Promise<ToolOutcome> {
    this.calls.push("call");
    return Promise.reject(new Error("the plugin never dispatches tools"));
  }

  close(): void {
    this.calls.push("close");
  }

  count(name: string): number {
    return this.calls.filter((call) => call === name).length;
  }

  private value(): DaemonStatus {
    return { snapshot: this.snapshot, display: displayStatus(this.snapshot), mode: this.mode };
  }
}

class FakePi implements OmpExtensionApi {
  readonly startHandlers: Array<(event: unknown, ctx: OmpSessionContext) => void> = [];
  readonly shutdownHandlers: Array<() => void> = [];
  readonly toolCallHandlers: Array<(call: HostToolCall) => Promise<HostToolVerdict | undefined>> = [];
  readonly commands = new Map<string, RealmRetryCommand>();

  on(event: "session_start", handler: (event: unknown, ctx: OmpSessionContext) => void): void;
  on(event: "session_shutdown", handler: () => void): void;
  on(event: "tool_call", handler: (call: HostToolCall) => Promise<HostToolVerdict | undefined>): void;
  on(event: string, handler: unknown): void {
    if (event === "session_start") {
      this.startHandlers.push(handler as (event: unknown, ctx: OmpSessionContext) => void);
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
}

interface FixtureOptions {
  // advisory is the default policy mode; fail-closed is required mode.
  readonly mode?: PolicyMode;
  readonly snapshot?: StateSnapshot;
  // One entry per attach, in order: a code rejects that attach with it; an absent entry resolves.
  readonly attachErrors?: readonly ErrorCode[];
  // Replaces the default attach; it receives the fixture daemon. The fixture still records each attach's workspace root.
  readonly attach?: (daemon: FakeDaemon) => Promise<DaemonClient>;
}

interface Fixture {
  readonly ui: FakeUi;
  readonly ctx: FakeCtx;
  readonly pi: FakePi;
  readonly daemon: FakeDaemon;
  readonly attachCalls: string[];
}

function makeFixture(options: FixtureOptions = {}): Fixture {
  const ui = new FakeUi();
  const ctx = new FakeCtx(ui, WORKSPACE);
  const pi = new FakePi();
  const daemon = new FakeDaemon(options.snapshot ?? ACTIVE, options.mode ?? "advisory");
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
      return Promise.resolve(daemon);
    },
  };
  registerRealmPlugin(pi, pluginOptions);
  return { ui, ctx, pi, daemon, attachCalls };
}

function startHandlerOf(pi: FakePi): (ctx: OmpSessionContext) => void {
  const handler = pi.startHandlers[0];
  assert.ok(handler !== undefined, "session_start handler is registered");
  // The host calls a session_start handler with the event first and the context second.
  return (ctx) => {
    handler({ type: "session_start" }, ctx);
  };
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

// The repaint poll armed at session start.
function pollOf(ctx: FakeCtx): ArmedTimer {
  const entry = ctx.intervals.find((interval) => interval.ms === STATUS_POLL_MS);
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
      return daemon;
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

void test("OMP-01 (a): an attach failure settles disconnected with the catalogue code as the reason (P5-D8)", async () => {
  const fixture = makeFixture({ attachErrors: ["ANDA_UNREACHABLE"] });
  startHandlerOf(fixture.pi)(fixture.ctx);

  await waitForDetail(fixture.ui, "ANDA_UNREACHABLE");
  assert.equal(lastLabel(fixture.ui), DISCONNECTED_LABEL);
  assert.match(lastDetail(fixture.ui) ?? "", /^ANDA_UNREACHABLE · /);
  // No daemon was attached, so the guard has no client and refuses a guarded write.
  assert.deepEqual(await toolCallOf(fixture.pi)({ toolName: "write" }), { block: true, reason: "REALM_NOT_ACTIVE" });
});

void test("OMP-01 (a): an attach that outlives the startup budget settles disconnected and releases its late client (P5-D8)", async () => {
  const gate = makeGate();
  const fixture = makeFixture({
    attach: async (daemon) => {
      await gate.promise;
      return daemon;
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
  assert.deepEqual(await toolCallOf(fixture.pi)({ toolName: "write" }), { block: true, reason: "REALM_NOT_ACTIVE" });
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
  assert.deepEqual(await toolCallOf(fixture.pi)({ toolName: "write" }), { block: true, reason: "realm not started" });
  assert.equal(fixture.ui.calls.length, paintsAtShutdown, "no paint after shutdown");
  assert.equal(fixture.daemon.count("status"), 1, "a refused call after shutdown reads no status");
});

void test("OMP-02: every status read paints one shared label across every transition, in one status item (P5-D5)", async () => {
  const fixture = makeFixture();
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  const toolCall = toolCallOf(fixture.pi);

  fixture.daemon.snapshot = { state: "error", reason: "ANDA_UNREACHABLE", lastTransitionAt: CLOCK_ISO };
  await toolCall({ toolName: "write" });
  fixture.daemon.snapshot = ACTIVE;
  await toolCall({ toolName: "write" });
  fixture.daemon.snapshot = { state: "degraded", reason: "ANDA_VERSION_MISMATCH", lastTransitionAt: CLOCK_ISO };
  await toolCall({ toolName: "write" });

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
  assert.equal(statusTexts(fixture.ui).at(-1), `${DEGRADED_LABEL} · ANDA_VERSION_MISMATCH · ${CLOCK_ISO}`);
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
    await toolCall({ toolName: "write" });
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

void test("OMP-05: required mode refuses host write and edit while the realm is non-active (P5-D6)", async () => {
  const fixture = makeFixture({ mode: "fail-closed", snapshot: CONNECTING });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForSettledDetails(fixture);
  const toolCall = toolCallOf(fixture.pi);

  assert.deepEqual(await toolCall({ toolName: "write" }), { block: true, reason: "REALM_NOT_ACTIVE" });
  assert.deepEqual(await toolCall({ toolName: "edit" }), { block: true, reason: "REALM_NOT_ACTIVE" });
  assert.deepEqual(await guardHostToolCall("write", null), { block: true, reason: "realm not started" });
  assert.deepEqual(fixture.ui.notifications, [], "refusal carries no advisory warning");
  assert.ok(fixture.daemon.count("status") >= 3, "each guarded call reads the daemon status");
});

void test("OMP-05 (c): required mode blocks a write when the status snapshot says not active (P5-D6)", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  const toolCall = toolCallOf(fixture.pi);

  fixture.daemon.snapshot = { state: "unbound", reason: "no workspace", lastTransitionAt: CLOCK_ISO };
  assert.deepEqual(await toolCall({ toolName: "write" }), { block: true, reason: "REALM_UNBOUND" });
  fixture.daemon.snapshot = { state: "stopping", reason: "stopping", lastTransitionAt: CLOCK_ISO };
  assert.deepEqual(await toolCall({ toolName: "edit" }), { block: true, reason: "REALM_STOPPING" });
  fixture.daemon.snapshot = CONNECTING;
  assert.deepEqual(await toolCall({ toolName: "write" }), { block: true, reason: "REALM_NOT_ACTIVE" });
  assert.deepEqual(fixture.ui.notifications, [], "required refusals carry no advisory warning");
});

void test("OMP-05: advisory mode warns visibly and lets the guarded call through (P5-D6)", async () => {
  const fixture = makeFixture({ snapshot: CONNECTING });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForSettledDetails(fixture);
  const toolCall = toolCallOf(fixture.pi);

  assert.equal(await toolCall({ toolName: "write" }), undefined);
  assert.equal(await toolCall({ toolName: "edit" }), undefined);
  assert.equal(fixture.ui.notifications.length, 2);
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

void test("OMP-05 (d): required mode blocks a write when the status fetch times out (P5-D6)", async () => {
  const fixture = makeFixture({ mode: "fail-closed" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  fixture.daemon.hangStatus = true;

  const verdict = toolCallOf(fixture.pi)({ toolName: "write" });
  expireTimer(fixture.ctx, GUARD_STATUS_BUDGET_MS);

  assert.deepEqual(await verdict, { block: true, reason: "TOOL_TIMEOUT" });
  assert.deepEqual(fixture.ui.notifications, [], "required mode does not warn on an unreadable status");
});

void test("OMP-05 (d): advisory mode only warns when the status fetch times out and lets the call through (P5-D6)", async () => {
  const fixture = makeFixture();
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  fixture.daemon.hangStatus = true;

  const verdict = toolCallOf(fixture.pi)({ toolName: "edit" });
  expireTimer(fixture.ctx, GUARD_STATUS_BUDGET_MS);

  assert.equal(await verdict, undefined, "advisory mode never blocks on an unreadable status");
  assert.equal(fixture.ui.notifications.length, 1);
  assert.match(fixture.ui.notifications[0] ?? "", /TOOL_TIMEOUT/);
  assert.match(fixture.ui.notifications[0] ?? "", /advisory policy/);
});

void test("OMP-05 / LOW-01: a tool name the guard cannot classify is refused, never waved through (P5-D6)", async () => {
  assert.deepEqual(await guardHostToolCall(undefined, null), { block: true, reason: "realm bad tool call" });
  assert.deepEqual(await guardHostToolCall({ name: "write" }, null), { block: true, reason: "realm bad tool call" });
  assert.equal(await guardHostToolCall("read", null), undefined);
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
      return daemon;
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

  const verdict = toolCallOf(fixture.pi)({ toolName: "write" });
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

  assert.equal(await toolCallOf(fixture.pi)({ toolName: "write" }), undefined);
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

  assert.throws(() => { renderRealmStatus(ui, snapshot); }, /rpc transport/);
  renderRealmStatus(ui, snapshot);
  renderRealmStatus(ui, snapshot);

  assert.deepEqual(writes, [
    { key: REALM_STATUS_KEY, text: `${DISCONNECTED_LABEL} · STARTUP_BUDGET_EXCEEDED · ${CLOCK_ISO}` },
  ]);
});
