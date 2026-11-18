import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Policy } from "../../src/contract/validate.js";
import { RealmError } from "../../src/core/errors.js";
import type { ExecutionService } from "../../src/core/ports.js";
import { bindWorkspaceUnderPolicy } from "../../src/fs/root.js";
import { TEARDOWN_TIMEOUT_MS } from "../../src/lifecycle/bounds.js";
import { LifecycleController } from "../../src/lifecycle/controller.js";
import { AgentOsSupervisor } from "../../src/runtime/agentos.js";
import { DEFAULT_REQUEST_TIMEOUT_MS, FORCE_REMOVE_STOP_GRACE_SECONDS } from "../../src/runtime/libpod-client.js";
import { realmSandboxName, type OpenShellRunner } from "../../src/runtime/openshell.js";
import { SessionExecution, type SessionContainers } from "../../src/runtime/session-execution.js";
import {
  AGENTOS_STOP_DEADLINE_MS,
  CONTAINER_STOP_GRACE_MS,
  SANDBOX_DELETE_DEADLINE_MS,
  SESSION_END_WORST_CASE_MS,
} from "../../src/runtime/teardown-stages.js";
import { SessionStore } from "../../src/session/store.js";
import { FakeAgentOsDriver } from "../support/fake-agentos.js";
import { FakeExecutionService } from "../support/fake-execution.js";
import { testTimeout } from "../support/timing.js";

const SESSION = "session-teardown-stages";
const CLOCK_TIME = "2026-11-18T09:30:00.000Z";
const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;

type Stage = "agentos" | "inspect" | "stop" | "remove" | "delete";

function policyFor(workspaceRoot: string): Policy {
  return {
    mode: "advisory",
    workspaceRoots: [workspaceRoot],
    credentialAllow: [],
    egressAllow: [],
    shellEnabled: false,
    startupBudgetMs: 10000,
    toolQueueMs: 2000,
  };
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

interface Outcome {
  settled: boolean;
  code: string | undefined;
  atMs: number;
}

// The stage chain of one session end, under the real controller and the real SessionExecution. Every collaborator below the
// execution (the AgentOS stop, the three libpod calls, the sandbox delete) is a held call that the test releases after it has
// advanced the mock clock by the cost the stage is scripted to take. Only setTimeout is mocked, so setImmediate stays real.
async function rig(t: TestContext) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-stages-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const workspace = join(base, "workspace");
  mkdirSync(workspace);
  const store = new SessionStore(join(base, "state"));
  const fake = new FakeExecutionService();

  const calls: Stage[] = [];
  const stopGraces: number[] = [];
  const removeForced: boolean[] = [];
  const releases = new Map<Stage, () => void>();
  const hold = (stage: Stage): Promise<void> => {
    calls.push(stage);
    return new Promise<void>((resolve) => {
      releases.set(stage, resolve);
    });
  };
  const unexpected = (what: string): never => {
    throw new Error(`the stop path called ${what}`);
  };
  const libpod: SessionContainers = {
    info: () => unexpected("info"),
    listContainersByLabel: () => unexpected("listContainersByLabel"),
    inspectContainer: async () => {
      await hold("inspect");
      return { State: { Running: true } };
    },
    stopContainer: async (_id, graceMs) => {
      stopGraces.push(graceMs);
      await hold("stop");
    },
    removeContainer: async (_id, options) => {
      removeForced.push(options.force);
      await hold("remove");
    },
  };
  const runner: OpenShellRunner = async (argv) => {
    assert.ok(argv.includes("delete"), "the only runner call of an end is the sandbox delete");
    await hold("delete");
    return { exitCode: 0, stdout: "", stderr: "", truncated: false };
  };
  const supervisor = new AgentOsSupervisor({
    driver: new FakeAgentOsDriver(runner),
    sessionId: SESSION,
    callTimeoutMs: 10_000,
    random: () => 0,
    sleep: () => Promise.resolve(),
    now: () => 0,
  });
  supervisor.stop = async () => {
    await hold("agentos");
  };
  const real = new SessionExecution({
    libpod,
    runner,
    agentosFor: () => supervisor,
    config: { image: IMAGE, stateDir: join(base, "state") },
    egressAllow: [],
  });
  const exec: ExecutionService = {
    create: (request) => fake.create(request),
    start: (id, sandbox) => fake.start(id, sandbox),
    probe: (id, sandbox) => fake.probe(id, sandbox),
    stop: (id, sandbox) => real.stop(id, sandbox),
    destroy: (id, sandbox) => real.destroy(id, sandbox),
  };
  const controller = new LifecycleController({
    sessionId: SESSION,
    policy: policyFor(workspace),
    pinnedRoot: bindWorkspaceUnderPolicy([workspace], workspace),
    store,
    exec,
    clock: () => new Date(CLOCK_TIME),
  });
  const created = await controller.create(workspace);
  assert.equal(created.state, "active", "the session reaches active on the real clock");
  assert.equal(realmSandboxName(SESSION), `realm-${SESSION}`);

  t.mock.timers.enable({ apis: ["setTimeout"] });
  let virtualMs = 0;
  const outcome: Outcome = { settled: false, code: undefined, atMs: -1 };
  // The clock moves in steps that end on a whole second of virtual time, with the promise queue drained between steps, so the virtual time at which the end
  // settled is read to the second and a timer that fires in the middle of a stage is seen at the time it fires.
  const advance = async (ms: number): Promise<void> => {
    let left = ms;
    while (left > 0 && !outcome.settled) {
      const step = Math.min(left, 1000 - (virtualMs % 1000));
      t.mock.timers.tick(step);
      virtualMs += step;
      left -= step;
      await flush();
      await flush();
    }
    await flush();
  };

  // The rejection is caught at once, so one that arrives in the middle of a tick is never unhandled.
  const watch = (work: Promise<unknown>): void => {
    void work.then(
      () => {
        outcome.settled = true;
        outcome.atMs = virtualMs;
      },
      (error: unknown) => {
        outcome.settled = true;
        outcome.atMs = virtualMs;
        outcome.code = error instanceof RealmError ? error.code : "NOT_A_REALM_ERROR";
      },
    );
  };

  // Waits for the stage's held call, spends its cost on the mock clock, and releases it unless the stage is to hang.
  // Returns false when the whole end settled before the stage was reached or while its cost was being spent.
  const runStage = async (stage: Stage, costMs: number, release = true): Promise<boolean> => {
    for (let attempt = 0; !releases.has(stage); attempt += 1) {
      if (outcome.settled) {
        return false;
      }
      if (attempt >= 100) {
        assert.fail(`the ${stage} stage was never called (virtual time ${String(virtualMs)} ms, calls ${calls.join(",")})`);
      }
      await flush();
    }
    await advance(costMs);
    if (outcome.settled) {
      return false;
    }
    if (release) {
      releases.get(stage)?.();
      await flush();
      await flush();
    }
    return true;
  };
  const summary = (): string =>
    outcome.settled
      ? `the end settled at ${String(outcome.atMs)} ms of virtual time with code ${outcome.code ?? "none"}`
      : `the end had not settled at ${String(virtualMs)} ms of virtual time`;

  return { controller, exec, store, calls, stopGraces, removeForced, outcome, watch, runStage, summary, advance };
}

void test("R0: the teardown bound is not below the worst case of the stages that run in turn", testTimeout(10_000), () => {
  assert.ok(
    TEARDOWN_TIMEOUT_MS >= SESSION_END_WORST_CASE_MS,
    `TEARDOWN_TIMEOUT_MS is ${String(TEARDOWN_TIMEOUT_MS)} ms against a stage worst case of ${String(SESSION_END_WORST_CASE_MS)} ms`,
  );
});

void test("R1: every stage just inside its own bound still ends the session, with no REALM_STOPPING", testTimeout(30_000), async (t) => {
  const r = await rig(t);
  r.watch(r.controller.stop());
  const chain: readonly (readonly [Stage, number])[] = [
    ["agentos", AGENTOS_STOP_DEADLINE_MS - 1],
    ["inspect", DEFAULT_REQUEST_TIMEOUT_MS - 1],
    ["stop", DEFAULT_REQUEST_TIMEOUT_MS + CONTAINER_STOP_GRACE_MS - 1],
    ["delete", SANDBOX_DELETE_DEADLINE_MS - 1],
  ];
  for (const [stage, cost] of chain) {
    if (!(await r.runStage(stage, cost))) {
      break;
    }
  }
  assert.ok(r.outcome.settled && r.outcome.code === undefined, `${r.summary()}, every stage inside its own bound`);
  assert.equal(r.controller.snapshot().state, "unbound");
  assert.deepEqual(r.calls, ["agentos", "inspect", "stop", "delete"]);
});

void test("R2: a slow but ordinary host (the container ignores SIGTERM and spends its whole grace) still ends the session", testTimeout(30_000), async (t) => {
  const r = await rig(t);
  r.watch(r.controller.stop());
  const chain: readonly (readonly [Stage, number])[] = [
    ["agentos", 8_000],
    ["inspect", 3_000],
    ["stop", CONTAINER_STOP_GRACE_MS],
    ["delete", 14_000],
  ];
  for (const [stage, cost] of chain) {
    if (!(await r.runStage(stage, cost))) {
      break;
    }
  }
  assert.ok(r.outcome.settled && r.outcome.code === undefined, r.summary());
  assert.equal(r.controller.snapshot().state, "unbound");
});

void test("R3: a stage that runs out of its own bound reports its own code before the teardown bound expires", testTimeout(30_000), async (t) => {
  const r = await rig(t);
  r.watch(r.controller.stop());
  // The AgentOS stop and the delete never settle, so each is cut off by its own bound.
  const chain: readonly (readonly [Stage, number, boolean])[] = [
    ["agentos", AGENTOS_STOP_DEADLINE_MS, false],
    ["inspect", DEFAULT_REQUEST_TIMEOUT_MS - 1, true],
    ["stop", DEFAULT_REQUEST_TIMEOUT_MS + CONTAINER_STOP_GRACE_MS - 1, true],
    ["delete", SANDBOX_DELETE_DEADLINE_MS, false],
  ];
  for (const [stage, cost, release] of chain) {
    if (!(await r.runStage(stage, cost, release))) {
      break;
    }
  }
  assert.ok(r.outcome.settled, r.summary());
  assert.equal(r.outcome.code, "AGENTOS_STOP_FAILED", r.summary());
  assert.ok(r.outcome.atMs < TEARDOWN_TIMEOUT_MS, `${r.summary()}, the teardown bound is ${String(TEARDOWN_TIMEOUT_MS)} ms`);
  assert.equal(r.controller.snapshot().state, "stopping", "the session stays in stopping so a repeated destroy resumes teardown");
});

void test("R4: stop mode asks libpod for the grace the constant names, and that grace is the force-removal grace or less", testTimeout(30_000), async (t) => {
  const r = await rig(t);
  r.watch(r.controller.stop());
  for (const stage of ["agentos", "inspect", "stop", "delete"] as const) {
    assert.ok(await r.runStage(stage, 0), `${stage}: ${r.summary()}`);
  }
  assert.ok(r.outcome.settled && r.outcome.code === undefined, r.summary());
  assert.deepEqual(r.stopGraces, [CONTAINER_STOP_GRACE_MS]);
  assert.ok(
    CONTAINER_STOP_GRACE_MS <= FORCE_REMOVE_STOP_GRACE_SECONDS * 1000,
    `the stop grace is ${String(CONTAINER_STOP_GRACE_MS)} ms and the runtime ignores SIGTERM, so more than ${String(FORCE_REMOVE_STOP_GRACE_SECONDS * 1000)} ms is dead time`,
  );
});

void test("R4: remove mode force-removes the container and never stops it", testTimeout(30_000), async (t) => {
  const r = await rig(t);
  r.watch(r.exec.destroy("container-under-test", realmSandboxName(SESSION)));
  for (const stage of ["agentos", "inspect", "remove", "delete"] as const) {
    assert.ok(await r.runStage(stage, 0), `${stage}: ${r.summary()}`);
  }
  assert.ok(r.outcome.settled && r.outcome.code === undefined, r.summary());
  assert.deepEqual(r.removeForced, [true]);
  assert.deepEqual(r.stopGraces, []);
  assert.equal(r.calls.includes("stop"), false);
});

void test("R5: a stop with no failing stage and no cost ends at once and is not delayed by the bound", testTimeout(30_000), async (t) => {
  const r = await rig(t);
  r.watch(r.controller.stop());
  for (const stage of ["agentos", "inspect", "stop", "delete"] as const) {
    assert.ok(await r.runStage(stage, 0), `${stage}: ${r.summary()}`);
  }
  assert.ok(r.outcome.settled && r.outcome.code === undefined, r.summary());
  assert.equal(r.outcome.atMs, 0);
  assert.equal(r.controller.snapshot().state, "unbound");
});
