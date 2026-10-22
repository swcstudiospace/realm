import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ERROR_CODES } from "../../src/core/errors.js";
import type { StateSnapshot } from "../../src/core/state-machine.js";
import { STATUS_LABELS } from "../../src/core/status.js";
import {
  GUARDED_HOST_TOOLS,
  REALM_DETAIL_KEY,
  REALM_RETRY_COMMAND,
  REALM_STATUS_KEY,
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
import { FakeBridge } from "../support/fake-bridge.js";
import { FakeExecutionService } from "../support/fake-execution.js";
function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

// OMP-01 to OMP-05 plugin proof (P5-D4 to P5-D6, P5-D8, P5-D14). Every test
// builds the real LifecycleController and the real ToolDispatcher through
// registerRealmPlugin -> createRealmHandle. The only doubles are the FakePi
// host (capturing registered handlers, timers, and commands), the
// FakeExecutionService, the FakeBridge, a fixed clock, and a stub runner.
// Required mode is the fail-closed policy mode; advisory is the default.

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const CLOCK_ISO = "2026-10-21T09:30:00.000Z";
const ACTIVE_LABEL = `● ${STATUS_LABELS.active}`;
const DEGRADED_LABEL = `● ${STATUS_LABELS.active} [degraded]`;
const DISCONNECTED_LABEL = `○ ${STATUS_LABELS.disconnected}`;



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
class FakeCtx implements OmpSessionContext {
  readonly timeouts: number[] = [];
  readonly cleared: unknown[] = [];
  private readonly timers = new Map<number, NodeJS.Timeout>();
  private sequence = 0;

  constructor(readonly ui: OmpStatusUi) {}

  setTimeout(callback: () => void, ms: number): unknown {
    this.timeouts.push(ms);
    this.sequence += 1;
    const id = this.sequence;
    this.timers.set(id, setTimeout(callback, ms));
    return id;
  }

  clearTimer(handle: unknown): void {
    this.cleared.push(handle);
    // clearTimeout no-ops for values without a live timer, so no guard.
    clearTimeout(this.timers.get(handle as number));
  }
}

class FakePi implements OmpExtensionApi {
  readonly startHandlers: Array<(ctx: OmpSessionContext) => void> = [];
  readonly shutdownHandlers: Array<() => void> = [];
  readonly toolCallHandlers: Array<(call: HostToolCall) => HostToolVerdict | undefined> = [];
  readonly commands = new Map<string, RealmRetryCommand>();

  on(event: "session_start", handler: (ctx: OmpSessionContext) => void): void;
  on(event: "session_shutdown", handler: () => void): void;
  on(event: "tool_call", handler: (call: HostToolCall) => HostToolVerdict | undefined): void;
  on(event: string, handler: unknown): void {
    if (event === "session_start") {
      this.startHandlers.push(handler as (ctx: OmpSessionContext) => void);
      return;
    }
    if (event === "session_shutdown") {
      this.shutdownHandlers.push(handler as () => void);
      return;
    }
    this.toolCallHandlers.push(handler as (call: HostToolCall) => HostToolVerdict | undefined);
  }

  registerCommand(name: string, definition: RealmRetryCommand): void {
    this.commands.set(name, definition);
  }
}

interface PluginFixture {
  readonly ui: FakeUi;
  readonly ctx: FakeCtx;
  readonly pi: FakePi;
  readonly exec: FakeExecutionService;
  readonly bridge: FakeBridge;
  readonly policyPath: string;
}

interface FixtureOptions {
  // advisory is the default policy mode; fail-closed is required mode.
  readonly mode?: "advisory" | "fail-closed";
  readonly startupBudgetMs?: number;
  readonly execDelayMs?: number;
  readonly clock?: () => Date;
}

function policyText(mode: string, startupBudgetMs: number, workspaceRoot: string): string {
  // controller.create refuses a workspace outside every policy workspace root with
  // POLICY_DENIED (D-22), so the fixture always names the workspace as a policy root.
  return JSON.stringify({
    mode,
    workspaceRoots: [workspaceRoot],
    credentialAllow: [],
    egressAllow: [],
    shellEnabled: false,
    startupBudgetMs,
    toolQueueMs: 2000,
  });
}

function makeFixture(t: TestContext, options: FixtureOptions = {}): PluginFixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-omp-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const ws = join(base, "ws");
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, "doc.txt"), "original");
  const stateDir = join(base, "state");
  const policyPath = join(base, "policy.json");
  writeFileSync(policyPath, policyText(options.mode ?? "advisory", options.startupBudgetMs ?? 10000, ws));
  const exec = new FakeExecutionService();
  if (options.execDelayMs !== undefined) {
    exec.setDelay("create", options.execDelayMs);
  }
  const bridge = new FakeBridge();
  const ui = new FakeUi();
  const ctx = new FakeCtx(ui);
  const pi = new FakePi();
  const pluginOptions: RealmPluginOptions = {
    runtimeInput: {
      image: IMAGE,
      workloadArgv: ["/usr/bin/agent", "--serve"],
      stateDir,
      workspaceRoot: ws,
    },
    policyPath,
    sessionId: "sess-omp",
    exec,
    bridge,
    clock: options.clock ?? (() => new Date(CLOCK_ISO)),
    runOpenShell: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "", truncated: false }),
  };
  registerRealmPlugin(pi, pluginOptions);
  return { ui, ctx, pi, exec, bridge, policyPath };
}

function startHandlerOf(pi: FakePi): (ctx: OmpSessionContext) => void {
  const handler = pi.startHandlers[0];
  assert.ok(handler !== undefined, "session_start handler is registered");
  return handler;
}

function toolCallOf(pi: FakePi): (call: HostToolCall) => HostToolVerdict | undefined {
  const handler = pi.toolCallHandlers[0];
  assert.ok(handler !== undefined, "tool_call handler is registered");
  return handler;
}

function retryCommandOf(pi: FakePi): RealmRetryCommand {
  const command = pi.commands.get(REALM_RETRY_COMMAND);
  assert.ok(command !== undefined, "retry command is registered");
  return command;
}

async function waitForDetail(ui: FakeUi, needle: string): Promise<string> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const found = ui.texts(REALM_DETAIL_KEY).find((text) => text.includes(needle));
    if (found !== undefined) {
      return found;
    }
    await sleep(10);
  }
  assert.fail(`timed out waiting for detail containing ${needle}`);
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) {
      return;
    }
    await sleep(10);
  }
  assert.fail("timed out waiting for condition");
}

function shutdownHandlerOf(pi: FakePi): () => void {
  const handler = pi.shutdownHandlers[0];
  assert.ok(handler !== undefined, "session_shutdown handler is registered");
  return handler;
}

test("OMP-01: session start launches the realm detached; the handler returns while still connecting (P5-D8)", async (t) => {
  const fixture = makeFixture(t, { execDelayMs: 300 });
  const start = startHandlerOf(fixture.pi);

  start(fixture.ctx);

  // The UI path never awaits the realm: the handler returned synchronously
  // while the launch render (unbound) and the connecting transition render
  // both landed.
  assert.deepEqual(fixture.ui.texts(REALM_STATUS_KEY), [DISCONNECTED_LABEL, DISCONNECTED_LABEL]);
  assert.deepEqual(fixture.ui.texts(REALM_DETAIL_KEY), [
    `no workspace · ${CLOCK_ISO}`,
    `connecting · ${CLOCK_ISO}`,
  ]);
  // The budget timer is armed from the policy default.
  assert.deepEqual(fixture.ctx.timeouts, [10000]);

  // Let the delayed create settle so teardown removes a quiet directory.
  await waitForDetail(fixture.ui, "container running");
  assert.equal(fixture.ui.texts(REALM_STATUS_KEY).at(-1), ACTIVE_LABEL);
});

test("OMP-01: a start inside the budget reaches realm active (P5-D8)", async (t) => {
  const fixture = makeFixture(t);
  startHandlerOf(fixture.pi)(fixture.ctx);

  await waitForDetail(fixture.ui, "container running");

  assert.equal(fixture.ui.texts(REALM_STATUS_KEY).at(-1), ACTIVE_LABEL);
  assert.equal(fixture.ui.texts(REALM_DETAIL_KEY).at(-1), `container running · ${CLOCK_ISO}`);
  // Settle clears the budget timer.
  assert.equal(fixture.ctx.cleared.length, 1);
});

test("OMP-01: a startup overrun settles the display to disconnected with STARTUP_BUDGET_EXCEEDED and the session continues (P5-D8)", async (t) => {
  const fixture = makeFixture(t, { startupBudgetMs: 60, execDelayMs: 500 });
  startHandlerOf(fixture.pi)(fixture.ctx);
  assert.deepEqual(fixture.ctx.timeouts, [60]);

  await sleep(150);

  // The budget fired while create was still in flight: the display settled
  // to disconnected with the catalogue reason, and no throw reached the host
  // (the handler returned; the process is still here asserting).
  assert.equal(fixture.ui.texts(REALM_STATUS_KEY).at(-1), DISCONNECTED_LABEL);
  const overrun = fixture.ui.texts(REALM_DETAIL_KEY).at(-1);
  assert.ok(overrun !== undefined && overrun.startsWith("STARTUP_BUDGET_EXCEEDED"), `overrun detail names the code: ${overrun}`);

  // The session continues: the late create settles, the timer is cleared,
  // and the display re-renders from the snapshot (error maps disconnected).
  await waitForDetail(fixture.ui, "STARTUP_BUDGET_EXCEEDED");
  await sleep(550);
  assert.equal(fixture.ui.texts(REALM_STATUS_KEY).at(-1), DISCONNECTED_LABEL);
  assert.equal(fixture.ctx.cleared.length, 1);
});

test("OMP-02: the indicator shows exactly one shared label from displayStatus at launch and every transition (P5-D5)", async (t) => {
  const fixture = makeFixture(t);
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");

  fixture.bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
  fixture.bridge.emit({ kind: "up" });
  fixture.bridge.emit({ kind: "mismatch", code: "ANDA_VERSION_MISMATCH" });

  // Pinned literal table: the only renders allowed are the shared mapping
  // plus the text degraded flag, never a second label.
  const allowed = new Set([ACTIVE_LABEL, DEGRADED_LABEL, DISCONNECTED_LABEL]);
  const labels = fixture.ui.texts(REALM_STATUS_KEY);
  assert.ok(labels.length >= 6, `launch plus every transition renders, saw ${labels.length}`);
  for (const label of labels) {
    assert.ok(allowed.has(label), `label comes from the shared mapping: ${label}`);
  }
  assert.ok(labels.includes(ACTIVE_LABEL), "active renders");
  assert.ok(labels.includes(DISCONNECTED_LABEL), "disconnected renders");
  assert.ok(labels.includes(DEGRADED_LABEL), "degraded keeps the active label with its flag");
  const keys = new Set(fixture.ui.calls.map((call) => call.key));
  assert.deepEqual(keys, new Set([REALM_STATUS_KEY, REALM_DETAIL_KEY]));
});

test("OMP-03: the reason and last-transition time appear beside the label on every transition (P5-D5)", async (t) => {
  const fixture = makeFixture(t);
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");

  fixture.bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
  fixture.bridge.emit({ kind: "up" });
  fixture.bridge.emit({ kind: "mismatch", code: "ANDA_VERSION_MISMATCH" });

  // Tooltip deviation: no tooltip surface was verified, so the reason and
  // the ISO instant ride in the second status item on every transition.
  assert.deepEqual(fixture.ui.texts(REALM_DETAIL_KEY), [
    `no workspace · ${CLOCK_ISO}`,
    `connecting · ${CLOCK_ISO}`,
    `container running · ${CLOCK_ISO}`,
    `ANDA_UNREACHABLE · ${CLOCK_ISO}`,
    `anda reachable · ${CLOCK_ISO}`,
    `ANDA_VERSION_MISMATCH · ${CLOCK_ISO}`,
  ]);
});

test("OMP-04: the retry command moves error to connecting then active through the dispatcher (P5-D14)", async (t) => {
  const fixture = makeFixture(t);
  const command = retryCommandOf(fixture.pi);
  assert.ok(command.description.length > 0, "retry command carries a description");
  // The first connect fails with a retryable code, so the session settles in error. A version
  // mismatch is not a usable script here: it is sticky (D-64) and create refuses to retry it.
  // The retry then meets the bridge's default healthy handshake.
  fixture.bridge.failNext("connect", "ANDA_UNREACHABLE");
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "ANDA_UNREACHABLE");
  assert.equal(fixture.ui.texts(REALM_STATUS_KEY).at(-1), DISCONNECTED_LABEL);
  assert.equal(fixture.ui.texts(REALM_DETAIL_KEY).at(-1), `ANDA_UNREACHABLE · ${CLOCK_ISO}`);

  const detailsBefore = fixture.ui.texts(REALM_DETAIL_KEY).length;
  const result = await command.handler();

  assert.match(result, /active/, "retry reports the active state");
  const after = fixture.ui.texts(REALM_DETAIL_KEY).slice(detailsBefore);
  const connectingAt = after.findIndex((text) => text.startsWith("connecting"));
  const activeAt = after.findIndex((text) => text.includes("container running"));
  assert.ok(connectingAt !== -1 && activeAt !== -1 && connectingAt < activeAt, `retry passes through connecting then active: ${after.join(" | ")}`);
  assert.equal(fixture.ui.texts(REALM_STATUS_KEY).at(-1), ACTIVE_LABEL);
});

test("OMP-04: the retry command before session start reports realm not started", async (t) => {
  const fixture = makeFixture(t);
  assert.equal(await retryCommandOf(fixture.pi).handler(), "realm not started");
});

test("OMP-05: required mode refuses host write and edit while the realm is non-active (P5-D6)", async (t) => {
  const fixture = makeFixture(t, { mode: "fail-closed" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  const toolCall = toolCallOf(fixture.pi);

  // The start handler returned synchronously, so the realm is still
  // connecting: both guarded host tools refuse with the deny code.
  assert.deepEqual(toolCall({ toolName: "write" }), { block: true, reason: "REALM_NOT_ACTIVE" });
  assert.deepEqual(toolCall({ toolName: "edit" }), { block: true, reason: "REALM_NOT_ACTIVE" });
  assert.deepEqual(guardHostToolCall("write", null), { block: true, reason: "realm not started" });
  assert.deepEqual(fixture.ui.notifications, [], "refusal carries no advisory warning");

  await waitForDetail(fixture.ui, "container running");
});

test("OMP-05: advisory mode warns visibly and lets the guarded call through (P5-D6)", async (t) => {
  const fixture = makeFixture(t);
  startHandlerOf(fixture.pi)(fixture.ctx);
  const toolCall = toolCallOf(fixture.pi);

  assert.equal(toolCall({ toolName: "write" }), undefined);
  assert.equal(toolCall({ toolName: "edit" }), undefined);
  assert.equal(fixture.ui.notifications.length, 2);
  for (const warning of fixture.ui.notifications) {
    assert.match(warning, /connecting/, "warning names the state");
    assert.match(warning, /advisory policy/, "warning states the advisory policy");
  }

  // Settle before teardown removes the fixture directory.
  await waitForDetail(fixture.ui, "container running");
});

test("OMP-05: read, list, status, and retry pass the guard untouched (P5-D6)", async (t) => {
  const fixture = makeFixture(t, { mode: "fail-closed" });
  startHandlerOf(fixture.pi)(fixture.ctx);
  const toolCall = toolCallOf(fixture.pi);

  for (const toolName of ["read", "list", "status", "retry"]) {
    assert.equal(toolCall({ toolName }), undefined, `${toolName} passes the guard`);
  }
  assert.ok(!GUARDED_HOST_TOOLS.includes("status"), "status is not a guarded tool");
  assert.deepEqual(fixture.ui.notifications, [], "pass-through attaches no warning");

  // Settle before teardown removes the fixture directory.
  await waitForDetail(fixture.ui, "container running");
});

test("OMP-05: the package manifest points at the compiled plugin entry (P5-D4)", () => {
  // The compiled test runs from dist/test/omp/, so the repository root is three levels up.
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    readonly omp?: { readonly extensions?: readonly string[] };
  };
  assert.deepEqual(manifest.omp?.extensions, ["./dist/src/omp/plugin.js"]);
  assert.ok(
    existsSync(join(root, "dist", "src", "omp", "plugin.js")),
    "the omp field resolves to the built entry",
  );
});

// ---- Review fixes: HI-01, HI-02, MED-02, MED-03, LOW-01, LOW-04 --------------

test("OMP-01 / HI-01: session shutdown closes the realm container, drops the bus subscription, and refuses guarded calls after (P5-D8)", async (t) => {
  const fixture = makeFixture(t);
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");
  assert.ok(fixture.exec.resources().length > 0, "the started realm holds a container");

  shutdownHandlerOf(fixture.pi)();
  const paintsAtShutdown = fixture.ui.calls.length;
  // Shutdown ends the session as a teardown: controller.destroy stops and removes the realm
  // container, then the handle is closed. A stopped container that is still present is a leak.
  await waitUntil(() => fixture.exec.resources().length === 0);
  assert.equal(fixture.exec.resources().length, 0, "the realm container is removed, not merely stopped");
  assert.equal(fixture.exec.callCount("destroy"), 1, "shutdown destroys the realm container once");
  assert.equal(fixture.exec.callCount("stop"), 1, "shutdown stops the realm container once before destroy");

  // The subscription is gone: a transition after shutdown paints nothing.
  fixture.bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
  assert.equal(fixture.ui.calls.length, paintsAtShutdown, "no paint after shutdown");
  assert.deepEqual(toolCallOf(fixture.pi)({ toolName: "write" }), { block: true, reason: "realm not started" });
});

test("OMP-01 / HI-02: a synchronous startup failure paints disconnected with a catalogue code and does not throw at the host (P5-D8)", (t) => {
  const fixture = makeFixture(t);
  writeFileSync(fixture.policyPath, "{ not json");

  assert.doesNotThrow(() => startHandlerOf(fixture.pi)(fixture.ctx));
  assert.equal(fixture.ui.texts(REALM_STATUS_KEY).at(-1), DISCONNECTED_LABEL);
  const detail = fixture.ui.texts(REALM_DETAIL_KEY).at(-1) ?? "";
  const code = detail.split(" · ")[0] ?? "";
  assert.ok((ERROR_CODES as readonly string[]).includes(code), `detail names a catalogue code: ${detail}`);
  assert.deepEqual(toolCallOf(fixture.pi)({ toolName: "edit" }), { block: true, reason: "realm not started" });
});

test("OMP-01 / MED-02: a budget timer that fires after create settled does not overwrite the settled snapshot (P5-D8)", async (t) => {
  const fixture = makeFixture(t);
  const expiries: Array<() => void> = [];
  const arm = fixture.ctx.setTimeout.bind(fixture.ctx);
  fixture.ctx.setTimeout = (callback, ms) => {
    expiries.push(callback);
    return arm(callback, ms);
  };
  startHandlerOf(fixture.pi)(fixture.ctx);
  await waitForDetail(fixture.ui, "container running");

  // A host may run an already-queued timer after clearTimer; it must not paint over the snapshot.
  const expire = expiries[0];
  assert.ok(expire !== undefined, "the budget timer was armed");
  expire();
  assert.equal(fixture.ui.texts(REALM_STATUS_KEY).at(-1), ACTIVE_LABEL);
  assert.equal(fixture.ui.texts(REALM_DETAIL_KEY).at(-1), `container running · ${CLOCK_ISO}`);
});

test("OMP-01 / LOW-04: a throwing clock still lets the budget expiry paint STARTUP_BUDGET_EXCEEDED (P5-D8)", async (t) => {
  let clockBroken = false;
  const fixture = makeFixture(t, {
    execDelayMs: 300,
    clock: () => {
      if (clockBroken) {
        throw new Error("host clock failed");
      }
      return new Date(CLOCK_ISO);
    },
  });
  const expiries: Array<() => void> = [];
  const arm = fixture.ctx.setTimeout.bind(fixture.ctx);
  fixture.ctx.setTimeout = (callback, ms) => {
    expiries.push(callback);
    return arm(callback, ms);
  };
  startHandlerOf(fixture.pi)(fixture.ctx);

  const expire = expiries[0];
  assert.ok(expire !== undefined, "the budget timer was armed");
  clockBroken = true;
  try {
    expire();
  } finally {
    clockBroken = false;
  }
  const overrun = fixture.ui.texts(REALM_DETAIL_KEY).at(-1) ?? "";
  assert.ok(overrun.startsWith("STARTUP_BUDGET_EXCEEDED · "), `overrun painted with a wall-clock time: ${overrun}`);
  assert.equal(fixture.ui.texts(REALM_STATUS_KEY).at(-1), DISCONNECTED_LABEL);
  await waitForDetail(fixture.ui, "container running");
});

test("OMP-02 / MED-03: a throwing detail write leaves the paint cache stale so the next render repaints both keys (P5-D5)", () => {
  const writes: Array<{ readonly key: string; readonly text: string }> = [];
  let failDetail = true;
  const ui: OmpStatusUi = {
    setStatus(key, text) {
      if (key === REALM_DETAIL_KEY && failDetail) {
        failDetail = false;
        throw new Error("rpc transport");
      }
      writes.push({ key, text });
    },
    notify() {},
  };
  const snapshot: StateSnapshot = { state: "error", reason: "STARTUP_BUDGET_EXCEEDED", lastTransitionAt: CLOCK_ISO };

  assert.throws(() => renderRealmStatus(ui, snapshot), /rpc transport/);
  renderRealmStatus(ui, snapshot);

  const details = writes.filter((write) => write.key === REALM_DETAIL_KEY).map((write) => write.text);
  assert.deepEqual(details, [`STARTUP_BUDGET_EXCEEDED · ${CLOCK_ISO}`]);
  assert.equal(writes.at(-1)?.key, REALM_DETAIL_KEY, "the detail key is written on the repaint");
});

test("OMP-05 / LOW-01: a tool name the guard cannot classify is refused, never waved through (P5-D6)", () => {
  assert.deepEqual(guardHostToolCall(undefined, null), { block: true, reason: "realm bad tool call" });
  assert.deepEqual(guardHostToolCall({ name: "write" }, null), { block: true, reason: "realm bad tool call" });
  assert.equal(guardHostToolCall("read", null), undefined);
});
