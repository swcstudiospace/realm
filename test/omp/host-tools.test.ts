import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { makeRealmError, RealmError } from "../../src/core/errors.js";
import type { PolicyMode } from "../../src/contract/validate.js";
import { displayStatus } from "../../src/core/status.js";
import type { StateSnapshot } from "../../src/core/state-machine.js";
import type { DaemonClient, DaemonStatus } from "../../src/daemon/client.js";
import { HOST_TOOL_SET_BUDGET_MS, hostToolSetOf, setHostMode } from "../../src/omp/host-tools.js";
import {
  registerRealmPlugin,
  type OmpExtensionApi,
  type OmpSessionContext,
  type OmpStatusUi,
} from "../../src/omp/plugin.js";
import type { HostToolDefinition } from "../../src/omp/tools.js";

// Regression proofs for the host tool set (OMPX-03, OMPX-04) and the plugin paths that drive it. The first test bounds a host
// setter that never settles; the second routes a status write that throws to the notice surface.

const CLOCK_ISO = "2026-10-21T09:30:00.000Z";
const REGISTERED: readonly string[] = ["bash", "edit", "exec", "glob", "list", "read", "status", "web_search", "write"];
// The fail-closed set: bash, the read-only built-ins that are registered, and the Realm tools.
const FAIL_CLOSED_TOOLS: readonly string[] = ["bash", "exec", "glob", "list", "read", "status", "write"];
const ACTIVE_SNAPSHOT: StateSnapshot = { state: "active", reason: "container running", lastTransitionAt: CLOCK_ISO };
const UNBOUND_SNAPSHOT: StateSnapshot = { state: "unbound", reason: "no workspace", lastTransitionAt: CLOCK_ISO };
const STATUS_WRITE_FAILED = "realm status update failed: unexpected error";

// Yields one turn of the event loop. No wall-clock wait: every chain under test settles on promises.
function yieldTurn(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

void test("a host tool setter that never settles fails its change at the budget and does not poison the next change", { timeout: 10_000 }, async (t: TestContext) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let active: string[] = [...REGISTERED];
  let setterCalls = 0;
  const pi = {
    getAllTools: (): { name: string }[] => REGISTERED.map((name) => ({ name })),
    getActiveTools: (): string[] => [...active],
    setActiveTools: (names: string[]): Promise<void> => {
      setterCalls += 1;
      if (setterCalls === 1) {
        return new Promise<void>(() => undefined);
      }
      active = [...names];
      return Promise.resolve();
    },
  };
  const tools = hostToolSetOf(pi);

  let settled = false;
  const first = setHostMode(tools, "fail-closed", () => true).finally(() => {
    settled = true;
  });
  await yieldTurn();
  assert.equal(setterCalls, 1);

  t.mock.timers.tick(HOST_TOOL_SET_BUDGET_MS - 1);
  await yieldTurn();
  assert.equal(settled, false);

  t.mock.timers.tick(1);
  await assert.rejects(first, (error: unknown) => error instanceof RealmError && error.code === "TOOL_TIMEOUT");
  assert.equal(tools.inFlight, 0);

  await setHostMode(tools, "fail-closed", () => true);
  assert.equal(setterCalls, 2);
  assert.deepEqual([...active].sort(), [...FAIL_CLOSED_TOOLS].sort());
});

void test("a host tool setter that applies after its budget keeps the removal record in step with the host", { timeout: 10_000 }, async (t: TestContext) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let active: string[] = [...REGISTERED];
  let setterCalls = 0;
  const late: { release: (() => void) | undefined } = { release: undefined };
  const pi = {
    getAllTools: (): { name: string }[] => REGISTERED.map((name) => ({ name })),
    getActiveTools: (): string[] => [...active],
    setActiveTools: (names: string[]): Promise<void> => {
      setterCalls += 1;
      if (setterCalls === 1) {
        return new Promise<void>((resolve) => {
          late.release = () => {
            active = [...names];
            resolve();
          };
        });
      }
      active = [...names];
      return Promise.resolve();
    },
  };
  const tools = hostToolSetOf(pi);

  const first = setHostMode(tools, "fail-closed", () => true);
  await yieldTurn();
  t.mock.timers.tick(HOST_TOOL_SET_BUDGET_MS);
  await assert.rejects(first, (error: unknown) => error instanceof RealmError && error.code === "TOOL_TIMEOUT");

  // The host applies the fail-closed set after the budget has already expired.
  late.release?.();
  await yieldTurn();
  assert.deepEqual([...tools.removed].sort(), ["edit", "web_search"]);

  await setHostMode(tools, "advisory", () => true);
  assert.ok(active.includes("edit") && active.includes("web_search"), "the advisory change restores the tools the late setter removed");
});

// A status UI whose writes can be made to throw. A refused write is still recorded as an attempt.
class StatusWriteUi implements OmpStatusUi {
  failing = false;
  readonly attempts: string[] = [];
  readonly notifications: string[] = [];

  setStatus(_key: string, text: string): void {
    this.attempts.push(text);
    if (this.failing) {
      throw new Error("status write refused");
    }
  }

  notify(message: string): void {
    this.notifications.push(message);
  }
}

// A session context whose interval is recorded, so a test fires one repaint tick by hand.
class PollingCtx implements OmpSessionContext {
  readonly intervals: Array<() => void> = [];
  private sequence = 0;

  constructor(
    readonly ui: OmpStatusUi,
    readonly cwd: string,
  ) {}

  setTimeout(): unknown {
    this.sequence += 1;
    return this.sequence;
  }

  setInterval(callback: () => void): unknown {
    this.intervals.push(callback);
    return this.intervals.length;
  }

  clearTimer(): void {
    // Nothing runs on a timer here, so clearing has no effect.
  }
}

// A daemon that reports whatever snapshot and mode the test sets.
class StatusDaemon implements DaemonClient {
  snapshot: StateSnapshot = ACTIVE_SNAPSHOT;
  mode: PolicyMode = "fail-closed";

  status(): Promise<DaemonStatus> {
    return Promise.resolve(this.value());
  }

  up(): Promise<DaemonStatus> {
    return this.status();
  }

  call(): Promise<never> {
    return Promise.reject(makeRealmError("REALM_NOT_ACTIVE"));
  }

  metrics(): Promise<never> {
    return Promise.reject(makeRealmError("REALM_NOT_ACTIVE"));
  }

  close(): void {
    // Nothing is held open.
  }

  private value(): DaemonStatus {
    return { snapshot: this.snapshot, display: displayStatus(this.snapshot), mode: this.mode, sessionId: "p0123456789ab" };
  }
}

// A host whose tool set is the registered names, with a working setter.
class HostPi implements OmpExtensionApi {
  startHandler: ((event: unknown, ctx: OmpSessionContext) => void) | null = null;
  active: string[] = [...REGISTERED];
  private readonly registered = new Set<string>(REGISTERED);

  on(event: string, handler: unknown): void {
    if (event === "session_start") {
      this.startHandler = handler as (event: unknown, ctx: OmpSessionContext) => void;
    }
  }

  registerCommand(): void {
    // The retry command is not exercised here.
  }

  registerTool(tool: HostToolDefinition): void {
    this.registered.add(tool.name);
  }

  getAllTools(): { name: string }[] {
    return [...this.registered].map((name) => ({ name }));
  }

  getActiveTools(): string[] {
    return [...this.active];
  }

  setActiveTools(names: string[]): Promise<void> {
    this.active = [...names];
    return Promise.resolve();
  }
}

function startSession(pi: HostPi, ctx: OmpSessionContext): void {
  const start = pi.startHandler;
  if (start === null) {
    throw new Error("the plugin registered no session_start handler");
  }
  start(null, ctx);
}

void test("a status write that throws during attach is surfaced as a notice, not an unhandled rejection", async () => {
  const ui = new StatusWriteUi();
  ui.failing = true;
  const pi = new HostPi();
  registerRealmPlugin(pi, { attachDaemon: () => Promise.resolve({ client: new StatusDaemon(), refusal: null }) });

  startSession(pi, new PollingCtx(ui, "/ws"));
  await yieldTurn();

  assert.equal(ui.attempts.length, 1);
  assert.deepEqual(ui.notifications, [STATUS_WRITE_FAILED]);
});

void test("a status write that throws during a repaint tick is surfaced as a notice, not an unhandled rejection", async () => {
  const ui = new StatusWriteUi();
  const daemon = new StatusDaemon();
  const ctx = new PollingCtx(ui, "/ws");
  const pi = new HostPi();
  registerRealmPlugin(pi, { attachDaemon: () => Promise.resolve({ client: daemon, refusal: null }) });

  startSession(pi, ctx);
  await yieldTurn();
  assert.deepEqual(ui.notifications, []);

  // The daemon now reports a different state, so the repaint must write the status item, and that write throws.
  daemon.snapshot = UNBOUND_SNAPSHOT;
  ui.failing = true;
  const before = ui.attempts.length;
  const [poll] = ctx.intervals;
  if (poll === undefined) {
    throw new Error("the plugin armed no repaint poll");
  }
  poll();
  await yieldTurn();

  assert.equal(ui.attempts.length, before + 1);
  assert.deepEqual(ui.notifications, [STATUS_WRITE_FAILED]);
});
