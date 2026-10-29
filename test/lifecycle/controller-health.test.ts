// Probe outcomes of the lifecycle controller as the daemon health loop relies on them (RT-04, owner ruling N1). A probe that
// cannot answer moves an active session to error with the code the port threw, and the result of a probe that began in an
// earlier life of the session is never applied to a later one.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Policy } from "../../src/contract/validate.js";
import { makeRealmError, type ErrorCode } from "../../src/core/errors.js";
import type { ProbeResult } from "../../src/core/ports.js";
import { displayStatus, STATUS_LABELS } from "../../src/core/status.js";
import { bindWorkspaceUnderPolicy } from "../../src/fs/root.js";
import { LifecycleController } from "../../src/lifecycle/controller.js";
import { AgentOsSupervisor } from "../../src/runtime/agentos.js";
import { SessionStore } from "../../src/session/store.js";
import { FakeAgentOsDriver } from "../support/fake-agentos.js";
import { FakeBridge } from "../support/fake-bridge.js";
import { FakeExecutionService } from "../support/fake-execution.js";

const SESSION = "session-health";
const CLOCK_TIME = "2026-10-21T09:30:00.000Z";

interface HeldProbe {
  readonly resolve: (result: ProbeResult) => void;
  readonly reject: (code: ErrorCode) => void;
}

// An execution service whose probe can be held open, so a test decides when and how an in-flight probe ends. When a
// supervisor is set, the probe asks it first, as SessionExecution.probe does: a held supervisor throws its code out of the probe.
class HoldableProbeExecution extends FakeExecutionService {
  private hold = false;
  private readonly held: HeldProbe[] = [];
  probeCalls = 0;
  supervisor: AgentOsSupervisor | undefined;

  holdProbes(): void {
    this.hold = true;
  }

  heldCount(): number {
    return this.held.length;
  }

  releaseNext(result: ProbeResult): void {
    const next = this.held.shift();
    assert.ok(next, "a probe is held");
    next.resolve(result);
  }

  failNextHeld(code: ErrorCode): void {
    const next = this.held.shift();
    assert.ok(next, "a probe is held");
    next.reject(code);
  }

  override async probe(containerId: string, sandbox: string): Promise<ProbeResult> {
    this.probeCalls += 1;
    if (this.supervisor !== undefined) {
      await this.supervisor.check();
    }
    if (!this.hold) {
      return super.probe(containerId, sandbox);
    }
    return new Promise<ProbeResult>((resolve, reject) => {
      this.held.push({
        resolve,
        reject: (code) => {
          reject(makeRealmError(code));
        },
      });
    });
  }
}

function policyFor(roots: readonly string[]): Policy {
  return {
    mode: "advisory",
    workspaceRoots: roots,
    credentialAllow: [],
    egressAllow: [],
    shellEnabled: false,
    startupBudgetMs: 10000,
    toolQueueMs: 2000,
  };
}

function fixture(t: TestContext) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-health-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const workspace = join(base, "workspace");
  mkdirSync(workspace);
  const pinnedRoot = bindWorkspaceUnderPolicy([workspace], workspace);
  const store = new SessionStore(join(base, "state"));
  const exec = new HoldableProbeExecution();
  const bridge = new FakeBridge();
  const controller = new LifecycleController({
    sessionId: SESSION,
    policy: policyFor([workspace]),
    store,
    exec,
    bridge,
    clock: () => new Date(CLOCK_TIME),
    pinnedRoot,
  });
  return { workspace, store, exec, bridge, controller };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

void test("RT-04: a healthy probe keeps an active session active", async (t) => {
  const { controller, exec, workspace } = fixture(t);
  await controller.create(workspace);

  const snapshot = await controller.probe();

  assert.equal(snapshot.state, "active");
  assert.equal(exec.probeCalls, 1);
});

void test("RT-04: an unhealthy probe moves an active session to error and records it", async (t) => {
  const { controller, exec, store, workspace } = fixture(t);
  await controller.create(workspace);
  const container = exec.resources()[0];
  assert.ok(container);
  exec.setHealth(container.containerId, "unhealthy");

  const snapshot = await controller.probe();

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "probe failed");
  assert.equal(store.load(SESSION)?.state, "error");
});

void test("RT-04, N1: a probe that throws AGENTOS_CRASH_LOOP moves an active session to error with that code, and the label reads disconnected", async (t) => {
  const { controller, exec, store, workspace } = fixture(t);
  await controller.create(workspace);
  exec.failNext("probe", "AGENTOS_CRASH_LOOP");

  const snapshot = await controller.probe();

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "AGENTOS_CRASH_LOOP");
  assert.equal(store.load(SESSION)?.state, "error");
  const shown = displayStatus(controller.snapshot());
  assert.equal(shown.label, STATUS_LABELS.disconnected);
  assert.equal(shown.reason, "AGENTOS_CRASH_LOOP");
});

function supervisedBy(driver: FakeAgentOsDriver): AgentOsSupervisor {
  return new AgentOsSupervisor({
    driver,
    sessionId: SESSION,
    callTimeoutMs: 50,
    random: () => 1,
    sleep: () => Promise.resolve(),
    now: () => 0,
  });
}

void test("OBS-04: a probe over a supervisor whose runner is gone and whose gateway is silent moves an active session to error with OPENSHELL_GATEWAY_LOST", async (t) => {
  const { controller, exec, store, workspace } = fixture(t);
  await controller.create(workspace);
  const driver = new FakeAgentOsDriver();
  const supervisor = supervisedBy(driver);
  await supervisor.start();
  exec.supervisor = supervisor;
  driver.exitRunner();
  driver.gatewayDown();

  const snapshot = await controller.probe();

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "OPENSHELL_GATEWAY_LOST");
  assert.equal(store.load(SESSION)?.state, "error");
  const shown = displayStatus(controller.snapshot());
  assert.equal(shown.label, STATUS_LABELS.disconnected);
  assert.equal(shown.reason, "OPENSHELL_GATEWAY_LOST");
});

void test("OBS-04: the same probe with the gateway answering still gives AGENTOS_CRASH_LOOP", async (t) => {
  const { controller, exec, workspace } = fixture(t);
  await controller.create(workspace);
  const driver = new FakeAgentOsDriver();
  const supervisor = supervisedBy(driver);
  await supervisor.start();
  exec.supervisor = supervisor;
  driver.exitRunner();

  const snapshot = await controller.probe();

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "AGENTOS_CRASH_LOOP");
});

void test("RT-04: a probe in unbound or error makes no port call", async (t) => {
  const { controller, exec, workspace } = fixture(t);

  assert.equal((await controller.probe()).state, "unbound");
  await controller.create(workspace);
  exec.failNext("probe", "AGENTOS_CRASH_LOOP");
  assert.equal((await controller.probe()).state, "error");
  const callsInError = exec.probeCalls;

  assert.equal((await controller.probe()).state, "error");

  assert.equal(exec.probeCalls, callsInError, "an errored session is not probed again");
});

void test("RT-04: a healthy probe keeps a degraded session degraded", async (t) => {
  const { controller, exec, bridge, workspace } = fixture(t);
  await controller.create(workspace);
  bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
  assert.equal(controller.snapshot().state, "degraded");

  const snapshot = await controller.probe();

  assert.equal(snapshot.state, "degraded");
  assert.equal(snapshot.reason, "ANDA_UNREACHABLE");
  assert.equal(exec.probeCalls, 1, "a degraded session is probed");
});

void test("RT-04: an unhealthy probe moves a degraded session to error and records it", async (t) => {
  const { controller, exec, bridge, store, workspace } = fixture(t);
  await controller.create(workspace);
  bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
  const container = exec.resources()[0];
  assert.ok(container);
  exec.setHealth(container.containerId, "unhealthy");

  const snapshot = await controller.probe();

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "probe failed");
  assert.equal(store.load(SESSION)?.state, "error");
});

void test("RT-04, N1: a probe that throws AGENTOS_CRASH_LOOP moves a degraded session to error with that code, and the label reads disconnected", async (t) => {
  const { controller, exec, bridge, store, workspace } = fixture(t);
  await controller.create(workspace);
  bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
  assert.equal(controller.snapshot().state, "degraded");
  exec.failNext("probe", "AGENTOS_CRASH_LOOP");

  const snapshot = await controller.probe();

  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "AGENTOS_CRASH_LOOP");
  assert.equal(store.load(SESSION)?.state, "error");
  const shown = displayStatus(controller.snapshot());
  assert.equal(shown.label, STATUS_LABELS.disconnected);
  assert.equal(shown.reason, "AGENTOS_CRASH_LOOP");
});

void test("RT-04: an unhealthy result that lands after a stop does not change the stopped session", async (t) => {
  const { controller, exec, store, workspace } = fixture(t);
  await controller.create(workspace);
  exec.holdProbes();
  const probing = controller.probe();
  await settle();
  assert.equal(exec.heldCount(), 1);

  await controller.stop();
  exec.releaseNext("unhealthy");
  const late = await probing;

  assert.equal(late.state, "unbound");
  assert.equal(controller.snapshot().state, "unbound");
  assert.equal(store.load(SESSION)?.state, "unbound");
});

void test("RT-04: a failure that lands after a stop does not move the stopped session to error", async (t) => {
  const { controller, exec, store, workspace } = fixture(t);
  await controller.create(workspace);
  exec.holdProbes();
  const probing = controller.probe();
  await settle();

  await controller.stop();
  exec.failNextHeld("AGENTOS_CRASH_LOOP");
  const late = await probing;

  assert.equal(late.state, "unbound");
  assert.equal(store.load(SESSION)?.state, "unbound");
});

void test("RT-04: an unhealthy result from an earlier life is not applied to a session that became active again", async (t) => {
  const { controller, exec, store, workspace } = fixture(t);
  await controller.create(workspace);
  exec.holdProbes();
  const probing = controller.probe();
  await settle();

  await controller.stop();
  assert.equal((await controller.create(workspace)).state, "active");
  exec.releaseNext("unhealthy");
  const late = await probing;

  assert.equal(late.state, "active", "the new life is untouched by the old probe");
  assert.equal(controller.snapshot().state, "active");
  assert.equal(store.load(SESSION)?.state, "active");
});

void test("RT-04: a failure from an earlier life is not applied to a session that became active again", async (t) => {
  const { controller, exec, workspace } = fixture(t);
  await controller.create(workspace);
  exec.holdProbes();
  const probing = controller.probe();
  await settle();

  await controller.stop();
  assert.equal((await controller.create(workspace)).state, "active");
  exec.failNextHeld("AGENTOS_CRASH_LOOP");
  const late = await probing;

  assert.equal(late.state, "active");
  assert.equal(controller.snapshot().reason, "container running");
});
