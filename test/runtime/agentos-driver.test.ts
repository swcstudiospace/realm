import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import { createOpenShellAgentOsDriver, type OpenShellAgentOsDriverOptions } from "../../src/runtime/agentos-driver.js";
import type { RunnerChild } from "../../src/runtime/agentos-workload.js";
import { OPENSHELL_BINARY, type OpenShellRunner } from "../../src/runtime/openshell.js";

const IMAGE = `localhost/realm-agentos@sha256:${"a".repeat(64)}`;
const POLICY = "/realm-state/agentos/policy.json";
const RUNNER = "/usr/local/lib/realm/agentos-runner.js";
const PROBE = "/usr/local/lib/realm/agentos-probe.js";
const TIMEOUT_MS = 2500;
const PROBE_INTERVAL_MS = 5;
// The runner child's argv: the pinned exec form that runs the runner in the sandbox after create (D-92).
const RUNNER_EXEC = [
  OPENSHELL_BINARY,
  "sandbox",
  "exec",
  "--name",
  "realm-agentos",
  "--workdir",
  "/workspace",
  "--no-tty",
  "--no-login-shell",
  "--",
  "node",
  RUNNER,
];
const DELETE = [OPENSHELL_BINARY, "sandbox", "delete", "realm-agentos"];

type Verb = "create" | "delete" | "probe";
// One scripted OpenShell answer: an exit code, or "reject" for a runner that rejects.
type Answer = number | "reject";

interface Answers {
  // Answers for each create, in order. The last one repeats. Default [0].
  readonly creates?: readonly Answer[];
  // Answers for each probe, in order. The last one repeats. Default [0].
  readonly probes?: readonly Answer[];
  // Answers for each delete, in order. The last one repeats. Default [0].
  readonly deletes?: readonly Answer[];
  // Makes every spawned runner child exit as soon as it is spawned.
  readonly childExitsOnSpawn?: boolean;
  readonly startTimeoutMs?: number;
  // Holds the create until the test releases it, so a stop can overtake a create that is in flight.
  readonly createGate?: Promise<void>;
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
  // Every step in order: create, spawn, probe, terminate, delete.
  readonly steps: string[];
  readonly calls: Recorded[];
  readonly spawns: string[][];
  readonly children: FakeChild[];
}

// Takes the scripted answer for the nth call of one kind. The last answer repeats once the script runs out.
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

// A promise the test releases by hand. Used to hold an OpenShell create in flight.
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
  const counts: Record<Verb, number> = { create: 0, delete: 0, probe: 0 };
  const creates = answers.creates ?? [0];
  const probes = answers.probes ?? [0];
  const deletes = answers.deletes ?? [0];
  const runner: OpenShellRunner = (argv, options) => {
    calls.push({ argv: [...argv], timeoutMs: options.timeoutMs });
    const verb: Verb = argv[2] === "create" ? "create" : argv[2] === "delete" ? "delete" : "probe";
    steps.push(verb);
    const script = verb === "create" ? creates : verb === "delete" ? deletes : probes;
    const scripted = entry(script, counts[verb]);
    counts[verb] += 1;
    if (scripted === "reject") {
      return Promise.reject(new Error("runner failed"));
    }
    if (verb === "create" && answers.createGate !== undefined) {
      return answers.createGate.then(() => ({ exitCode: scripted }));
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
    imageRef: IMAGE,
    policyPath: POLICY,
    cpus: 2,
    memory: "4Gi",
    runnerPath: RUNNER,
    probePath: PROBE,
    startTimeoutMs: answers.startTimeoutMs ?? TIMEOUT_MS,
    callTimeoutMs: TIMEOUT_MS,
    probeIntervalMs: PROBE_INTERVAL_MS,
  };
  return { options, steps, calls, spawns, children };
}

function driverOf(h: Harness) {
  return createOpenShellAgentOsDriver(h.options);
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

void test("create runs the sandbox through --from with no command after it and no --no-keep", async () => {
  const h = harness();
  await driverOf(h).start();
  const argv = h.calls[0]?.argv ?? [];
  assert.equal(argv[argv.indexOf("--name") + 1], "realm-agentos");
  assert.equal(argv[argv.indexOf("--from") + 1], IMAGE);
  assert.equal(argv.includes("--"), false, "the create argv carries no command separator");
  assert.equal(argv.includes("--no-keep"), false);
});

void test("after create exits 0 the runner child starts with the exact exec argv, and the first probe follows it", async () => {
  const h = harness();
  await driverOf(h).start();
  assert.deepEqual(h.spawns, [RUNNER_EXEC]);
  assert.deepEqual(h.steps, ["create", "spawn", "probe"]);
});

void test("the readiness probe is retried until it exits 0", async () => {
  const h = harness({ probes: [1, 1, 0] });
  await driverOf(h).start();
  assert.deepEqual(h.steps, ["create", "spawn", "probe", "probe", "probe"]);
});

void test("a probe that never passes gives OPENSHELL_START_FAILED at the deadline and kills the runner child", async () => {
  const h = harness({ probes: [1], startTimeoutMs: 60 });
  await assertCode(driverOf(h).start(), "OPENSHELL_START_FAILED");
  assert.ok(h.steps.filter((step) => step === "probe").length >= 2, "the probe is retried until the deadline");
  assert.equal(childAt(h, 0).hasExited(), true);
  assert.equal(h.steps.at(-1), "terminate");
});

void test("a runner child that exits before its probe passes fails the start", async () => {
  const h = harness({ probes: [1], childExitsOnSpawn: true });
  await assertCode(driverOf(h).start(), "OPENSHELL_START_FAILED");
  assert.deepEqual(h.steps, ["create", "spawn", "terminate"]);
});

void test("a create that exits non-zero gives OPENSHELL_START_FAILED and starts no runner", async () => {
  const h = harness({ creates: [1] });
  await assertCode(driverOf(h).start(), "OPENSHELL_START_FAILED");
  assert.deepEqual(h.steps, ["create"]);
});

void test("a create that rejects gives OPENSHELL_START_FAILED and starts no runner", async () => {
  const h = harness({ creates: ["reject"] });
  await assertCode(driverOf(h).start(), "OPENSHELL_START_FAILED");
  assert.deepEqual(h.steps, ["create"]);
});

void test("a runner child that cannot be spawned gives OPENSHELL_START_FAILED after create", async () => {
  const h = harness();
  const driver = createOpenShellAgentOsDriver({
    ...h.options,
    spawnRunner: () => {
      throw new Error("spawn failed");
    },
  });
  await assertCode(driver.start(), "OPENSHELL_START_FAILED");
  assert.deepEqual(h.steps, ["create"]);
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

void test("stop kills the runner child and then deletes the sandbox", async () => {
  const h = harness();
  const driver = driverOf(h);
  await driver.start();
  await driver.stop();
  assert.deepEqual(h.steps, ["create", "spawn", "probe", "terminate", "delete"]);
  assert.deepEqual(h.calls.at(-1)?.argv, DELETE);
});

void test("a second stop after a successful delete makes no second delete call", async () => {
  const h = harness();
  const driver = driverOf(h);
  await driver.start();
  await driver.stop();
  await driver.stop();
  assert.deepEqual(h.steps, ["create", "spawn", "probe", "terminate", "delete"]);
});

void test("a failed delete gives AGENTOS_STOP_FAILED, and a later stop retries the delete", async () => {
  const h = harness({ deletes: [1, 0] });
  const driver = driverOf(h);
  await driver.start();
  await assertCode(driver.stop(), "AGENTOS_STOP_FAILED");
  await driver.stop();
  assert.deepEqual(h.steps, ["create", "spawn", "probe", "terminate", "delete", "delete"]);
});

void test("a stop during create waits for the create, deletes the sandbox that create produced, and the start is not reported as active (N2)", async () => {
  const create = gate();
  const h = harness({ createGate: create.open });
  const driver = driverOf(h);
  const started = driver.start();
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
  assert.equal(stopSettled, false, "the stop waits for the create it overtakes");
  create.release();
  await assertCode(started, "OPENSHELL_START_FAILED");
  await stopped;
  assert.deepEqual(h.steps, ["create", "delete"], "the create's sandbox is deleted, and no runner is spawned");
});

void test("a start called while another start is in flight joins it: one create and one runner child exist (N3)", async () => {
  const create = gate();
  const h = harness({ createGate: create.open });
  const driver = driverOf(h);
  const first = driver.start();
  const second = driver.start();
  create.release();
  await Promise.all([first, second]);
  assert.deepEqual(h.steps, ["create", "spawn", "probe"]);
  assert.deepEqual(h.spawns, [RUNNER_EXEC]);
});

void test("two starts called during a stop leave one runner child (F6)", async () => {
  const create = gate();
  const h = harness({ createGate: create.open });
  const driver = driverOf(h);
  const first = driver.start();
  const stopped = driver.stop();
  const second = driver.start();
  const third = driver.start();
  create.release();
  await assertCode(first, "OPENSHELL_START_FAILED");
  await stopped;
  await Promise.all([second, third]);
  assert.equal(h.spawns.length, 1, "the two starts during the stop share one runner spawn");
  assert.equal(h.children.length, 1, "exactly one runner child is held");
  assert.equal(h.children[0]?.hasExited(), false, "the one child is the held runner, not terminated");
});

void test("alive reports exit 0 as alive, and any other exit or a rejected probe as not alive", async () => {
  const h = harness({ probes: [0, 1, "reject"] });
  const driver = driverOf(h);
  assert.equal(await driver.alive(), true);
  assert.equal(await driver.alive(), false);
  assert.equal(await driver.alive(), false);
});

void test("an empty image reference is refused at construction with SCHEMA_INVALID", () => {
  const { options } = harness();
  assert.throws(() => createOpenShellAgentOsDriver({ ...options, imageRef: "" }), refusedWith("SCHEMA_INVALID"));
});

void test("a sandbox name outside the realm- prefix is refused with SCHEMA_INVALID", () => {
  const { options } = harness();
  assert.throws(
    () => createOpenShellAgentOsDriver({ ...options, sandboxName: "agentos" }),
    refusedWith("SCHEMA_INVALID"),
  );
});

void test("a non-positive or non-finite call timeout is refused with RangeError", () => {
  const { options } = harness();
  for (const callTimeoutMs of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
    assert.throws(() => createOpenShellAgentOsDriver({ ...options, callTimeoutMs }), RangeError);
  }
});

void test("the create argv carries no privileged flag, no mount, and no host socket", async () => {
  const h = harness();
  await driverOf(h).start();
  const argv = h.calls[0]?.argv ?? [];
  for (const forbidden of ["--privileged", "--cap-add", "-v", "--volume", "--mount"]) {
    assert.equal(argv.includes(forbidden), false, `the create argv must not carry ${forbidden}`);
  }
  assert.equal(
    argv.some((token) => token.includes("podman.sock") || token.includes("docker.sock")),
    false,
  );
});
