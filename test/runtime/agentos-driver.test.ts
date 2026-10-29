import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import {
  createOpenShellAgentOsDriver,
  GATEWAY_STATUS_TIMEOUT_MS,
  type OpenShellAgentOsDriverOptions,
} from "../../src/runtime/agentos-driver.js";
import type { RunnerChild } from "../../src/runtime/agentos-workload.js";
import { OPENSHELL_BINARY, type OpenShellRunner } from "../../src/runtime/openshell.js";

const SESSION = "sess-driver";
const RUNNER = "/usr/local/lib/realm/agentos-runner.js";
const PROBE = "/usr/local/lib/realm/agentos-probe.js";
const TIMEOUT_MS = 2500;
const PROBE_INTERVAL_MS = 5;

// The runner child's argv for one session: the pinned exec form that runs the runner in that session's sandbox (D-92).
function runnerExecFor(sessionId: string): string[] {
  return [
    OPENSHELL_BINARY,
    "sandbox",
    "exec",
    "--name",
    `realm-${sessionId}`,
    "--workdir",
    "/workspace",
    "--no-tty",
    "--no-login-shell",
    "--",
    "node",
    RUNNER,
  ];
}
const RUNNER_EXEC = runnerExecFor(SESSION);

// One scripted OpenShell answer: an exit code, or "reject" for a runner that rejects.
type Answer = number | "reject";

interface Answers {
  // Answers for each probe, in order. The last one repeats. Default [0].
  readonly probes?: readonly Answer[];
  // Makes every spawned runner child exit as soon as it is spawned.
  readonly childExitsOnSpawn?: boolean;
  readonly startTimeoutMs?: number;
  // Holds every probe until the test releases it, so a stop can overtake a start that is waiting for its runner.
  readonly probeGate?: Promise<void>;
}

interface Recorded {
  readonly argv: readonly string[];
  readonly timeoutMs: number;
}

// A runner child the test controls. exit() ends it as the OS would; terminate() records the kill in the step log.
interface FakeChild extends RunnerChild {
  exit(): void;
}

interface Harness {
  readonly options: OpenShellAgentOsDriverOptions;
  // Every step in order: spawn, probe, terminate.
  readonly steps: string[];
  readonly calls: Recorded[];
  readonly spawns: string[][];
  readonly children: FakeChild[];
}

// Takes the scripted answer for the nth call. The last answer repeats once the script runs out.
function entry<T>(script: readonly T[], n: number): T {
  const value = script[Math.min(n, script.length - 1)];
  assert.ok(value !== undefined, "a scripted answer is required");
  return value;
}

function fakeChild(steps: string[]): FakeChild {
  let exited = false;
  let markExited: () => void = () => undefined;
  const gone = new Promise<void>((resolve) => {
    markExited = () => {
      resolve();
    };
  });
  const end = (): void => {
    exited = true;
    markExited();
  };
  return {
    exit: end,
    hasExited: () => exited,
    exited: gone,
    terminate: () => {
      steps.push("terminate");
      end();
      return Promise.resolve();
    },
  };
}

// A promise the test releases by hand.
function gate(): { readonly open: Promise<void>; readonly release: () => void } {
  let release: () => void = () => undefined;
  const open = new Promise<void>((resolve) => {
    release = () => {
      resolve();
    };
  });
  return { open, release };
}

function harness(answers: Answers = {}): Harness {
  const steps: string[] = [];
  const calls: Recorded[] = [];
  const spawns: string[][] = [];
  const children: FakeChild[] = [];
  const probes = answers.probes ?? [0];
  let probeCount = 0;
  const runner: OpenShellRunner = (argv, options) => {
    calls.push({ argv: [...argv], timeoutMs: options.timeoutMs });
    steps.push("probe");
    const scripted = entry(probes, probeCount);
    probeCount += 1;
    if (scripted === "reject") {
      return Promise.reject(new Error("runner failed"));
    }
    if (answers.probeGate !== undefined) {
      return answers.probeGate.then(() => ({ exitCode: scripted }));
    }
    return Promise.resolve({ exitCode: scripted });
  };
  const spawnRunner = (argv: readonly string[]): FakeChild => {
    steps.push("spawn");
    spawns.push([...argv]);
    const child = fakeChild(steps);
    if (answers.childExitsOnSpawn === true) {
      child.exit();
    }
    children.push(child);
    return child;
  };
  const options: OpenShellAgentOsDriverOptions = {
    runner,
    spawnRunner,
    runnerPath: RUNNER,
    probePath: PROBE,
    startTimeoutMs: answers.startTimeoutMs ?? TIMEOUT_MS,
    callTimeoutMs: TIMEOUT_MS,
    probeIntervalMs: PROBE_INTERVAL_MS,
  };
  return { options, steps, calls, spawns, children };
}

// The driver as the caller of one session sees it: every call names SESSION.
function driverOf(h: Harness) {
  const driver = createOpenShellAgentOsDriver(h.options);
  return {
    start: () => driver.start(SESSION),
    alive: () => driver.alive(SESSION),
    stop: () => driver.stop(SESSION),
    runnerExited: () => driver.runnerExited(SESSION),
    gatewayAnswers: () => driver.gatewayAnswers(),
  };
}

function childAt(h: Harness, index: number): FakeChild {
  const child = h.children[index];
  assert.ok(child !== undefined, `expected runner child ${String(index)}`);
  return child;
}

async function assertCode(work: Promise<unknown>, code: ErrorCode): Promise<void> {
  await assert.rejects(work, (error: unknown) => error instanceof RealmError && error.code === code);
}

function refusedWith(code: ErrorCode): (error: unknown) => boolean {
  return (error: unknown) => error instanceof RealmError && error.code === code;
}

void test("start spawns the session's runner child with its exact exec argv, and the first probe follows it", async () => {
  const h = harness();
  await driverOf(h).start();
  assert.deepEqual(h.spawns, [RUNNER_EXEC]);
  assert.deepEqual(h.steps, ["spawn", "probe"]);
  assert.equal(h.calls.some((call) => call.argv[2] === "create"), false, "start creates no sandbox");
});

void test("the readiness probe is retried until it exits 0", async () => {
  const h = harness({ probes: [1, 1, 0] });
  await driverOf(h).start();
  assert.deepEqual(h.steps, ["spawn", "probe", "probe", "probe"]);
});

void test("a probe that never passes gives OPENSHELL_START_FAILED at the deadline and kills the runner child", async () => {
  // A start budget wide enough that a stalled event loop on a loaded host is very unlikely to expire it before the second probe.
  const h = harness({ probes: [1], startTimeoutMs: 400 });
  await assertCode(driverOf(h).start(), "OPENSHELL_START_FAILED");
  assert.ok(h.steps.filter((step) => step === "probe").length >= 2, "the probe is retried until the deadline");
  assert.equal(childAt(h, 0).hasExited(), true);
  assert.equal(h.steps.at(-1), "terminate");
});

void test("a runner child that exits before its probe passes fails the start", async () => {
  const h = harness({ probes: [1], childExitsOnSpawn: true });
  await assertCode(driverOf(h).start(), "OPENSHELL_START_FAILED");
  assert.deepEqual(h.steps, ["spawn", "terminate"]);
});

void test("a runner child that cannot be spawned gives OPENSHELL_START_FAILED and no probe", async () => {
  const h = harness({});
  const driver = createOpenShellAgentOsDriver({
    ...h.options,
    spawnRunner: () => {
      throw new Error("spawn failed");
    },
  });
  await assertCode(driver.start(SESSION), "OPENSHELL_START_FAILED");
  assert.deepEqual(h.steps, []);
});

void test("runnerExited is false while the child runs and true once it exits while the sandbox is up", async () => {
  const h = harness();
  const driver = driverOf(h);
  await driver.start();
  assert.equal(driver.runnerExited(), false);
  childAt(h, 0).exit();
  assert.equal(driver.runnerExited(), true);
});

void test("a stop does not read as a runner exit, even though the stop kills the child", async () => {
  const h = harness();
  const driver = driverOf(h);
  await driver.start();
  await driver.stop();
  assert.equal(driver.runnerExited(), false);
});

void test("stop kills the runner child and runs no OpenShell command: SessionExecution deletes the sandbox", async () => {
  const h = harness();
  const driver = driverOf(h);
  await driver.start();
  const callsBeforeStop = h.calls.length;
  await driver.stop();
  assert.deepEqual(h.steps, ["spawn", "probe", "terminate"]);
  assert.equal(h.calls.length, callsBeforeStop, "stop issues no OpenShell call");
});

void test("a second stop kills nothing more", async () => {
  const h = harness();
  const driver = driverOf(h);
  await driver.start();
  await driver.stop();
  await driver.stop();
  assert.deepEqual(h.steps, ["spawn", "probe", "terminate"]);
});

void test("a stop during start waits for the start it overtakes, and the start is not reported as up (N2)", async () => {
  const probe = gate();
  const h = harness({ probeGate: probe.open });
  const driver = driverOf(h);
  const started = driver.start();
  // The start reaches its readiness probe, which the gate holds.
  await new Promise<void>((resolve) => setImmediate(resolve));
  const stopped = driver.stop();
  let stopSettled = false;
  void stopped.then(
    () => {
      stopSettled = true;
    },
    () => {
      stopSettled = true;
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(stopSettled, false, "the stop waits for the start it overtakes");
  probe.release();
  await assertCode(started, "OPENSHELL_START_FAILED");
  await stopped;
  assert.equal(h.spawns.length, 1);
  assert.deepEqual(h.steps, ["spawn", "probe", "terminate"]);
});

void test("a start called while another start is in flight joins it: one runner child exists (N3)", async () => {
  const probe = gate();
  const h = harness({ probeGate: probe.open });
  const driver = driverOf(h);
  const first = driver.start();
  const second = driver.start();
  probe.release();
  await Promise.all([first, second]);
  assert.deepEqual(h.steps, ["spawn", "probe"]);
  assert.deepEqual(h.spawns, [RUNNER_EXEC]);
});

void test("two starts called during a stop leave one runner child (F6)", async () => {
  const h = harness();
  const driver = driverOf(h);
  const first = driver.start();
  const stopped = driver.stop();
  const second = driver.start();
  const third = driver.start();
  await assertCode(first, "OPENSHELL_START_FAILED");
  await stopped;
  await Promise.all([second, third]);
  assert.equal(h.spawns.length, 1, "the two starts during the stop share one runner spawn");
  assert.equal(h.children.length, 1, "exactly one runner child is held");
  assert.equal(childAt(h, 0).hasExited(), false, "the one child is the held runner, not terminated");
});

void test("two sessions run two runners, each named for its own sandbox, and stopping one leaves the other running", async () => {
  const h = harness();
  const driver = createOpenShellAgentOsDriver(h.options);
  await driver.start("sess-a");
  await driver.start("sess-b");
  assert.deepEqual(h.spawns, [runnerExecFor("sess-a"), runnerExecFor("sess-b")]);
  await driver.stop("sess-a");
  assert.equal(driver.runnerExited("sess-b"), false);
  assert.equal(childAt(h, 0).hasExited(), true, "the stopped session's runner child is terminated");
  assert.equal(childAt(h, 1).hasExited(), false, "the other session's runner child is not terminated");
});

void test("alive reports exit 0 as alive, and any other exit or a rejected probe as not alive", async () => {
  const h = harness({ probes: [0, 1, "reject"] });
  const driver = driverOf(h);
  assert.equal(await driver.alive(), true);
  assert.equal(await driver.alive(), false);
  assert.equal(await driver.alive(), false);
});

void test("OBS-04: gatewayAnswers runs `openshell status` with the 10 s bound and reads only the exit code", async () => {
  const h = harness({ probes: [0, 1, "reject"] });
  const driver = driverOf(h);
  assert.equal(GATEWAY_STATUS_TIMEOUT_MS, 10_000);
  assert.equal(await driver.gatewayAnswers(), true, "exit 0 is a gateway that answers");
  assert.equal(await driver.gatewayAnswers(), false, "a non-zero exit is a gateway that does not answer");
  assert.equal(await driver.gatewayAnswers(), false, "a rejected run is a gateway that does not answer");
  assert.equal(h.calls.length, 3);
  for (const call of h.calls) {
    assert.deepEqual(call.argv, [OPENSHELL_BINARY, "status"]);
    assert.equal(call.timeoutMs, GATEWAY_STATUS_TIMEOUT_MS);
  }
  assert.equal(h.spawns.length, 0, "the gateway check starts no runner child");
});

void test("OBS-04: an `openshell status` that never exits is bounded by GATEWAY_STATUS_TIMEOUT_MS and reads as a gateway that does not answer", async (t: TestContext) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    t.mock.timers.reset();
  });
  const h = harness({ probeGate: gate().open });
  let settled = false;
  const answer = driverOf(h)
    .gatewayAnswers()
    .then((answers) => {
      settled = true;
      return answers;
    });
  t.mock.timers.tick(GATEWAY_STATUS_TIMEOUT_MS - 1);
  await nextTurn();
  assert.equal(settled, false, "the hung status must not end before the bound");
  t.mock.timers.tick(1);
  assert.equal(await answer, false);
});

void test("a session id outside the safe set is refused with SCHEMA_INVALID by each runner call, before any runner call", async () => {
  const h = harness();
  const driver = createOpenShellAgentOsDriver(h.options);
  await assertCode(driver.start("../escape"), "SCHEMA_INVALID");
  await assertCode(driver.alive("../escape"), "SCHEMA_INVALID");
  assert.throws(() => driver.runnerExited("../escape"), refusedWith("SCHEMA_INVALID"));
  assert.equal(h.calls.length, 0);
});

void test("a non-positive or non-finite call timeout is refused with RangeError", () => {
  const { options } = harness();
  for (const callTimeoutMs of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
    assert.throws(() => createOpenShellAgentOsDriver({ ...options, callTimeoutMs }), RangeError);
  }
});

void test("the runner argv carries no privileged flag, no mount, and no host socket", async () => {
  const h = harness();
  await driverOf(h).start();
  const argv = h.spawns[0] ?? [];
  for (const forbidden of ["--privileged", "--cap-add", "-v", "--volume", "--mount"]) {
    assert.equal(argv.includes(forbidden), false, `the runner argv must not carry ${forbidden}`);
  }
  assert.equal(
    argv.some((token) => token.includes("podman.sock") || token.includes("docker.sock")),
    false,
  );
});
