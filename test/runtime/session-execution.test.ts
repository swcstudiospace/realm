import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRealmError, RealmError, type ErrorCode } from "../../src/core/errors.js";
import { AgentOsSupervisor } from "../../src/runtime/agentos.js";
import { LifecycleController } from "../../src/lifecycle/controller.js";
import { bindWorkspaceUnderPolicy } from "../../src/fs/root.js";
import { SessionStore } from "../../src/session/store.js";
import { createOpenShellAgentOsDriver, DEFAULT_AGENTOS_PROBE_PATH, DEFAULT_AGENTOS_RUNNER_PATH } from "../../src/runtime/agentos-driver.js";
import type { RunnerChild } from "../../src/runtime/agentos-workload.js";
import { renderNetworkPolicies } from "../../src/runtime/egress.js";
import { HARDENING_PROFILE } from "../../src/runtime/hardening.js";
import { LibpodClient } from "../../src/runtime/libpod-client.js";
import {
  buildExecArgv,
  buildPolicyDocument,
  OPENSHELL_BINARY,
  OPENSHELL_OUTPUT_LIMIT_BYTES,
  OpenShellRunnerError,
  realmSandboxName,
  type OpenShellRunner,
} from "../../src/runtime/openshell.js";
import {
  AGENTOS_WORKLOAD_BINARY,
  HardeningFailedError,
  runSandboxExec,
  SessionExecution,
  type SessionContainers,
  selectOpenShellEnvironment,
  spawnOpenShellRunner,
} from "../../src/runtime/session-execution.js";
import { FakeAgentOsDriver } from "../support/fake-agentos.js";
import { FakeContainerStore, FakeLibpod } from "../support/fake-libpod.js";
import { FakeOpenShell } from "../support/fake-openshell.js";
import { FakeBridge } from "../support/fake-bridge.js";

const SESSION = "sess-01";
const DIGEST = `sha256:${"a".repeat(64)}`;
const IMAGE = `registry.example.com/realm/session@${DIGEST}`;
const WORKLOAD = ["/usr/bin/agent", "--serve"];
const EGRESS = [{ host: "api.example.com", port: 443 }];
// The D-80 flags no argv on the execution path may carry (RT-05). Each is compared as a whole argv element.
const FORBIDDEN_FLAGS = ["--env", "--provider", "--driver-config-json", "--forward", "--expose", "--template", "--auto-providers"];

const ZERO_STATUS =
  "CapInh:\t0000000000000000\nCapPrm:\t0000000000000000\nCapEff:\t0000000000000000\n" +
  "CapBnd:\t0000000000000000\nCapAmb:\t0000000000000000\n";

interface Fixture {
  readonly base: string;
  readonly stateDir: string;
  readonly workspaceRoot: string;
  readonly store: FakeContainerStore;
  readonly libpod: FakeLibpod;
  readonly openshell: FakeOpenShell;
  readonly driver: FakeAgentOsDriver;
  readonly supervisor: AgentOsSupervisor;
  readonly supervisorFor: (sessionId: string) => AgentOsSupervisor;
  readonly exec: SessionExecution;
  // The same libpod and runner with no AgentOS supervisor bound (the AGENTOS_NOT_CONFIGURED paths).
  readonly unbound: SessionExecution;
  // One entry per OpenShell run: the policy document's text when the run starts, or undefined when no
  // document exists yet.
  readonly policyAtRun: (string | undefined)[];
  readonly procStatus: { text: string };
}

async function fixture(t: TestContext, options: { readonly rootless?: boolean } = {}): Promise<Fixture> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-session-exec-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const stateDir = join(base, "state");
  const workspaceRoot = join(base, "workspace");
  const socketPath = join(base, "podman.sock");
  const store = new FakeContainerStore();
  const libpod = new FakeLibpod({ store, rootless: options.rootless ?? true });
  await libpod.start(socketPath);
  t.after(() => libpod.stop());

  const openshell = new FakeOpenShell(store);
  const policyAtRun: (string | undefined)[] = [];
  const runner: OpenShellRunner = (argv, options) => {
    const policy = argv[argv.indexOf("--policy") + 1];
    policyAtRun.push(policy !== undefined && existsSync(policy) ? readFileSync(policy, "utf8") : undefined);
    return openshell.runner(argv, options);
  };
  const driver = new FakeAgentOsDriver(runner);
  // One supervisor per session over the one fake driver, as the daemon builds them. A session names its own supervisor.
  const supervisors = new Map<string, AgentOsSupervisor>();
  const supervisorFor = (sessionId: string): AgentOsSupervisor => {
    let made = supervisors.get(sessionId);
    if (made === undefined) {
      made = new AgentOsSupervisor({
        driver,
        sessionId,
        callTimeoutMs: 1000,
        random: () => 0,
        sleep: () => Promise.resolve(),
        now: () => 0,
      });
      supervisors.set(sessionId, made);
    }
    return made;
  };
  const supervisor = supervisorFor(SESSION);
  const libpodClient = new LibpodClient(socketPath);
  const procStatus = { text: ZERO_STATUS };
  const exec = new SessionExecution({
    libpod: libpodClient,
    runner,
    agentosFor: (sessionId) => supervisorFor(sessionId),
    config: { image: IMAGE, stateDir },
    egressAllow: EGRESS,
    readProcStatus: () => procStatus.text,
  });
  const unbound = new SessionExecution({
    libpod: libpodClient,
    runner,
    config: { image: IMAGE, stateDir },
    egressAllow: EGRESS,
  });
  return {
    base,
    stateDir,
    workspaceRoot,
    store,
    libpod,
    openshell,
    driver,
    supervisor,
    supervisorFor,
    exec,
    unbound,
    policyAtRun,
    procStatus,
  };
}

// A libpod inspect object that conforms to every D-51 property, with the overrides merged into
// HostConfig. The mount sources are the workspace root and the state directory.
function conformingInspect(f: Fixture, hostOverrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    ImageDigest: DIGEST,
    State: { Running: true, Status: "running", Pid: 4242 },
    HostConfig: {
      Privileged: false,
      CapAdd: [],
      SecurityOpt: ["no-new-privileges"],
      ReadonlyRootfs: true,
      Tmpfs: { "/tmp": "rw", "/run": "rw" },
      PidsLimit: HARDENING_PROFILE.pidsLimit,
      Memory: HARDENING_PROFILE.memoryBytes,
      NanoCpus: HARDENING_PROFILE.nanoCpus,
      NetworkMode: HARDENING_PROFILE.networkMode,
      ...hostOverrides,
    },
    Mounts: [
      { Type: "bind", Source: f.workspaceRoot, Destination: "/workspace", RW: true },
      { Type: "bind", Source: f.stateDir, Destination: "/realm-state", RW: false },
    ],
  };
}

// Scripts the next container inspect (the create-time verification reads it once).
function scriptInspect(f: Fixture, body: Record<string, unknown>): void {
  f.libpod.respondNext("inspectContainer", { status: 200, body: JSON.stringify(body) });
}

async function createSession(f: Fixture, key: string = SESSION): Promise<{ readonly containerId: string }> {
  scriptInspect(f, conformingInspect(f));
  return f.exec.create({ idempotencyKey: key, workspaceRoot: f.workspaceRoot });
}

async function assertCode(work: Promise<unknown>, code: ErrorCode): Promise<void> {
  await assert.rejects(work, (error: unknown) => error instanceof RealmError && error.code === code);
}

// Asserts that work rejects with AGENTOS_STOP_FAILED, keeping causeCode as the cause of the failed step.
async function assertStopFailedWithCause(work: Promise<unknown>, causeCode: ErrorCode): Promise<void> {
  await assert.rejects(
    work,
    (error: unknown) => error instanceof RealmError && error.code === "AGENTOS_STOP_FAILED" && error.causeCode === causeCode,
  );
}

void test("CORE-06, RT-03: a second create with the same session reuses the labelled container and runs the OpenShell create once", async (t) => {
  const f = await fixture(t);
  const first = await createSession(f);
  const second = await createSession(f);
  assert.equal(second.containerId, first.containerId);
  assert.equal(f.openshell.callCount(), 1);
  assert.equal(f.store.list().length, 1);
});

void test("RT-01, RT-03: a failed hardening check destroys the container and throws OPENSHELL_START_FAILED naming the first failed property", async (t) => {
  const f = await fixture(t);
  scriptInspect(f, conformingInspect(f, { Privileged: true, Memory: 1 }));
  await assert.rejects(
    f.exec.create({ idempotencyKey: SESSION, workspaceRoot: f.workspaceRoot }),
    (error: unknown) =>
      error instanceof HardeningFailedError &&
      error.code === "OPENSHELL_START_FAILED" &&
      error.property === "privileged",
  );
  assert.equal(f.store.list().length, 0);
});

void test("RT-01, RT-03: an inspect that cannot be read fails closed, removes the container, and throws OPENSHELL_START_FAILED", async (t) => {
  const f = await fixture(t);
  f.libpod.respondNext("inspectContainer", { status: 500 });
  await assertCode(f.exec.create({ idempotencyKey: SESSION, workspaceRoot: f.workspaceRoot }), "OPENSHELL_START_FAILED");
  assert.equal(f.store.list().length, 0);
});

void test("RT-01, RT-03: an inspect that cannot be read refuses the start and keeps the libpod code as causeCode", async (t) => {
  const f = await fixture(t);
  f.libpod.respondNext("inspectContainer", { status: 500 });
  await assert.rejects(
    f.exec.create({ idempotencyKey: SESSION, workspaceRoot: f.workspaceRoot }),
    (error: unknown) =>
      error instanceof RealmError && error.code === "OPENSHELL_START_FAILED" && error.causeCode === "SCHEMA_INVALID",
  );
});

void test("RT-01, RT-03: a container that fails hardening and survives its removal refuses with the removal's code as causeCode", async (t) => {
  const f = await fixture(t);
  scriptInspect(f, conformingInspect(f, { Privileged: true }));
  f.libpod.respondNext("removeContainer", { status: 500 });
  await assert.rejects(
    f.exec.create({ idempotencyKey: SESSION, workspaceRoot: f.workspaceRoot }),
    (error: unknown) =>
      error instanceof HardeningFailedError && error.property === "privileged" && error.causeCode === "SCHEMA_INVALID",
  );
});

void test("RT-01, D-51: a non-empty bounding set in the host's status fails cap-drop through create, and the container is removed", async (t) => {
  const f = await fixture(t);
  scriptInspect(f, conformingInspect(f));
  f.procStatus.text = ZERO_STATUS.replace("CapBnd:\t0000000000000000", "CapBnd:\t0000000000000008");
  await assert.rejects(
    f.exec.create({ idempotencyKey: SESSION, workspaceRoot: f.workspaceRoot }),
    (error: unknown) => error instanceof HardeningFailedError && error.property === "cap-drop",
  );
  assert.equal(f.store.list().length, 0, "the container with a non-empty bounding set is removed");
});

void test("RT-03, CORE-06: the policy document is written before the OpenShell create runs", async (t) => {
  const f = await fixture(t);
  await createSession(f);
  assert.equal(f.policyAtRun.length, 1, "one OpenShell run, the create");
  assert.notEqual(f.policyAtRun[0], undefined, "the policy document exists when the create runs");
  const policy = join(f.stateDir, "runtime", `${SESSION}.policy.json`);
  assert.equal(readFileSync(policy, "utf8"), `${JSON.stringify(buildPolicyDocument(EGRESS, AGENTOS_WORKLOAD_BINARY), null, 2)}\n`);
});

void test("RT-05, RT-03: create writes the egress list and the workload binary into the policy the create runs against", async (t) => {
  const f = await fixture(t);
  await createSession(f);
  const written = f.policyAtRun[0];
  assert.ok(written !== undefined, "the policy document exists when the create runs");
  assert.equal(written, `${JSON.stringify(buildPolicyDocument(EGRESS, AGENTOS_WORKLOAD_BINARY), null, 2)}\n`);
  const policy = JSON.parse(written) as { readonly network_policies: unknown };
  assert.deepEqual(policy.network_policies, renderNetworkPolicies(EGRESS, AGENTOS_WORKLOAD_BINARY));
});

void test("RT-03, CORE-06: a session create runs exactly one sandbox create, named realm-<sessionId>, with no workload command and no --no-keep", async (t) => {
  const f = await fixture(t);
  await createSession(f);
  const creates = f.openshell.calls().map((call) => call.argv).filter((argv) => argv[2] === "create");
  assert.equal(creates.length, 1, "exactly one sandbox create");
  const create = creates[0] ?? [];
  assert.equal(create[create.indexOf("--name") + 1], realmSandboxName(SESSION));
  assert.equal(create.includes("--"), false, "the create carries no workload command");
  assert.equal(create.includes("--no-keep"), false, "the create carries no --no-keep");
});

void test("RT-05, RT-03: a create for the daemon's session writes only that session's policy document, with the AgentOS workload binary", async (t) => {
  const f = await fixture(t);
  await createSession(f, "daemon");
  const runtimeDir = join(f.stateDir, "runtime");
  assert.deepEqual(readdirSync(runtimeDir), ["daemon.policy.json"]);
  assert.equal(
    readFileSync(join(runtimeDir, "daemon.policy.json"), "utf8"),
    `${JSON.stringify(buildPolicyDocument(EGRESS, AGENTOS_WORKLOAD_BINARY), null, 2)}\n`,
  );
});

void test("RT-04, D-18: a session start runs the AgentOS runner as an exec child in the session's sandbox, and starts only after its probe exits 0", async (t) => {
  const f = await fixture(t);
  const spawned: (readonly string[])[] = [];
  const child: RunnerChild = {
    hasExited: () => false,
    exited: new Promise<void>(() => undefined),
    terminate: () => Promise.resolve(),
  };
  const driver = createOpenShellAgentOsDriver({
    runner: f.openshell.runner,
    spawnRunner: (argv) => {
      spawned.push([...argv]);
      return child;
    },
    startTimeoutMs: 10_000,
    callTimeoutMs: 1000,
    probeIntervalMs: 1,
  });
  const supervisor = new AgentOsSupervisor({ driver, sessionId: SESSION, callTimeoutMs: 10_000, random: () => 0, sleep: () => Promise.resolve(), now: () => 0 });
  const exec = new SessionExecution({
    libpod: new LibpodClient(join(f.base, "podman.sock")),
    runner: f.openshell.runner,
    agentosFor: () => supervisor,
    config: { image: IMAGE, stateDir: f.stateDir },
    egressAllow: EGRESS,
    readProcStatus: () => f.procStatus.text,
  });
  const { containerId } = await createWith(f, exec);
  // The first probe finds the runner not yet up and the second finds it up, so the start must wait for the second.
  f.openshell.next({ output: { exitCode: 1 } }, { output: { exitCode: 0 } });
  await exec.start(containerId, realmSandboxName(SESSION));
  assert.deepEqual(spawned, [buildExecArgv(SESSION, ["node", DEFAULT_AGENTOS_RUNNER_PATH])]);
  const probes = f.openshell.calls().map((call) => call.argv).filter((argv) => argv[2] === "exec");
  const probeArgv = buildExecArgv(SESSION, ["node", DEFAULT_AGENTOS_PROBE_PATH]);
  assert.deepEqual(probes, [probeArgv, probeArgv]);
});

void test("RT-05: an invalid egress allowlist throws SCHEMA_INVALID at construction, before any OpenShell run, container, policy write or libpod request", async (t) => {
  const f = await fixture(t);
  const invalid: readonly unknown[] = [
    [{ host: "*.example.com", port: 443 }],
    [{ host: "localhost", port: 443 }],
    "api.example.com:443",
  ];
  for (const egressAllow of invalid) {
    assert.throws(
      () =>
        new SessionExecution({
          libpod: new LibpodClient(join(f.base, "podman.sock")),
          runner: f.openshell.runner,
          agentosFor: () => f.supervisor,
          config: { image: IMAGE, stateDir: f.stateDir },
          egressAllow,
        }),
      (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
    );
  }
  assert.equal(f.openshell.callCount(), 0, "no OpenShell run starts");
  assert.equal(f.store.list().length, 0, "no container is created");
  assert.equal(existsSync(join(f.stateDir, "runtime")), false, "no policy document is written");
  assert.equal(f.libpod.requests().length, 0, "the libpod client receives no request");
});

void test("RT-05, D-80: no argv the execution path spawns, for create or exec, carries a forbidden flag", async (t) => {
  const f = await fixture(t);
  await createSession(f);
  f.openshell.next({ output: { exitCode: 0 } });
  await runSandboxExec(f.openshell.runner, SESSION, WORKLOAD, 1000);
  const spawned = f.openshell.calls();
  assert.deepEqual(spawned.map((call) => call.argv[2]), ["create", "exec"]);
  for (const call of spawned) {
    for (const flag of FORBIDDEN_FLAGS) {
      assert.equal(call.argv.includes(flag), false, `${flag} is absent from the ${String(call.argv[2])} argv`);
    }
  }
});

void test("RT-03, RT-04: start refuses a container that is not running and starts AgentOS only through the supervisor", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  f.store.setRunning(containerId, false);
  await assertCode(f.exec.start(containerId, realmSandboxName(SESSION)), "OPENSHELL_START_FAILED");
  assert.deepEqual(f.driver.calls(), ["create"], "the refused start made no AgentOS call beyond the create");

  f.store.setRunning(containerId, true);
  await f.exec.start(containerId, realmSandboxName(SESSION));
  assert.equal(f.driver.callCount("start"), 1);
  assert.equal(f.openshell.callCount(), 1);
});

void test("RT-01, RT-04: probe is healthy only when the container runs and AgentOS reports alive", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  assert.equal(await f.exec.probe(containerId, realmSandboxName(SESSION)), "unhealthy", "AgentOS was never started");
  await f.exec.start(containerId, realmSandboxName(SESSION));
  assert.equal(await f.exec.probe(containerId, realmSandboxName(SESSION)), "healthy");
  f.store.setRunning(containerId, false);
  assert.equal(await f.exec.probe(containerId, realmSandboxName(SESSION)), "unhealthy", "a stopped container is never healthy");
  assert.equal(await f.exec.probe("missing-container", realmSandboxName(SESSION)), "unhealthy");
});

void test("RT-01, RT-04: a probe whose inspect cannot be read rejects with the libpod code instead of reporting unhealthy", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  await f.exec.start(containerId, realmSandboxName(SESSION));
  f.libpod.respondNext("inspectContainer", { status: 500 });
  await assertCode(f.exec.probe(containerId, realmSandboxName(SESSION)), "SCHEMA_INVALID");
});

void test("RT-04, D-59: a runner that exits while the session is active makes probe fail with AGENTOS_CRASH_LOOP, and the runner is not restarted", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  await f.exec.start(containerId, realmSandboxName(SESSION));
  f.driver.exitRunner();
  await assertCode(f.exec.probe(containerId, realmSandboxName(SESSION)), "AGENTOS_CRASH_LOOP");
  assert.equal(f.driver.callCount("start"), 1, "the supervisor does not restart the runner");
});

void test("RT-01, RT-03: a reused container whose inspect does not conform is verified on the reuse path, removed, and refused", async (t) => {
  const f = await fixture(t);
  await createSession(f);
  scriptInspect(f, conformingInspect(f, { Privileged: true }));
  await assert.rejects(
    f.exec.create({ idempotencyKey: SESSION, workspaceRoot: f.workspaceRoot }),
    (error: unknown) =>
      error instanceof HardeningFailedError && error.code === "OPENSHELL_START_FAILED" && error.property === "privileged",
  );
  assert.equal(f.store.list().length, 0, "the non-conforming reused container is removed");
  assert.equal(
    f.openshell.calls().filter((call) => call.argv[2] === "create").length,
    1,
    "the reuse path runs no second OpenShell create",
  );
});

void test("RT-01, D-51: a state directory mounted read-write fails the mounts property through create, and the container is removed", async (t) => {
  const f = await fixture(t);
  const inspect = conformingInspect(f);
  inspect.Mounts = [
    { Type: "bind", Source: f.workspaceRoot, Destination: "/workspace", RW: true },
    { Type: "bind", Source: f.stateDir, Destination: "/realm-state", RW: true },
  ];
  scriptInspect(f, inspect);
  await assert.rejects(
    f.exec.create({ idempotencyKey: SESSION, workspaceRoot: f.workspaceRoot }),
    (error: unknown) => error instanceof HardeningFailedError && error.property === "mounts",
  );
  assert.equal(f.store.list().length, 0, "the container with a read-write state mount is removed");
});

void test("RT-01, D-51: a libpod that reports rootless false fails the rootless property through create, and the container is removed", async (t) => {
  const f = await fixture(t, { rootless: false });
  await assert.rejects(
    createSession(f),
    (error: unknown) =>
      error instanceof HardeningFailedError && error.code === "OPENSHELL_START_FAILED" && error.property === "rootless",
  );
  assert.equal(f.store.list().length, 0, "the container of a rootless-false engine is removed");
});

void test("RT-03: stop stops the container, destroy removes it, and a repeated stop or destroy leaves the store unchanged", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  await f.exec.stop(containerId, realmSandboxName(SESSION));
  assert.equal(f.store.get(containerId)?.running, false);
  await f.exec.stop(containerId, realmSandboxName(SESSION));
  assert.equal(f.store.get(containerId)?.running, false, "a repeated stop keeps the container stopped");
  await f.exec.destroy(containerId, realmSandboxName(SESSION));
  assert.equal(f.store.get(containerId), undefined);
  const removals = routeCount(f, "removeContainer");
  await f.exec.destroy(containerId, realmSandboxName(SESSION));
  assert.equal(routeCount(f, "removeContainer"), removals + 1, "a repeated destroy still sends its remove request");
  assert.equal(f.store.list().length, 0, "a repeated destroy leaves the store empty");
  const stops = routeCount(f, "stopContainer");
  await f.exec.stop(containerId, realmSandboxName(SESSION));
  assert.equal(routeCount(f, "stopContainer"), stops, "a stop of a removed container sends no stop request");
});

void test("F2: a stop or destroy that names no realm sandbox, absent or not realm-prefixed, is refused with AGENTOS_STOP_FAILED, and no libpod, OpenShell, or AgentOS call is made", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  const libpodRequests = f.libpod.requests().length;
  const openshellRuns = f.openshell.callCount();
  // The absent case passes no name on purpose, so the untyped caller the guard exists for is what runs here.
  const unnamed = undefined as unknown as string;
  for (const sandbox of [unnamed, "other-sandbox"]) {
    await assertCode(f.exec.stop(containerId, sandbox), "AGENTOS_STOP_FAILED");
    await assertCode(f.exec.destroy(containerId, sandbox), "AGENTOS_STOP_FAILED");
  }
  assert.equal(f.libpod.requests().length, libpodRequests, "no libpod request is sent");
  assert.equal(f.openshell.callCount(), openshellRuns, "no OpenShell run starts");
  assert.deepEqual(f.driver.calls(), ["create"], "no AgentOS call is made beyond the create before the loop");
  assert.equal(f.store.get(containerId)?.running, true, "the container is left running");
});

void test("F5: an AgentOS step that timed out with no code and a container step that failed with a libpod code reports that libpod code", async (t) => {
  const f = await fixture(t);
  const armed = armableLibpod(f);
  const exec = new SessionExecution({
    libpod: armed.libpod,
    runner: f.openshell.runner,
    agentosFor: () => f.supervisor,
    config: { image: IMAGE, stateDir: f.stateDir },
    egressAllow: EGRESS,
    stopDeadlineMs: 20,
    readProcStatus: () => f.procStatus.text,
  });
  const { containerId } = await createWith(f, exec);
  // The AgentOS stop never settles, so its step times out with no cause code. The container step then fails with a libpod code.
  f.supervisor.stop = () => new Promise<void>(() => undefined);
  armed.arm("stopContainer");
  await assertStopFailedWithCause(exec.stop(containerId, realmSandboxName(SESSION)), "PODMAN_MACHINE_DOWN");
});

void test("RT-03, RT-01: a stop whose AgentOS stop throws still stops the container, then reports AGENTOS_STOP_FAILED", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  f.supervisor.stop = () => Promise.reject(new Error("scripted supervisor socket gone"));
  await assertCode(f.exec.stop(containerId, realmSandboxName(SESSION)), "AGENTOS_STOP_FAILED");
  assert.equal(f.store.get(containerId)?.running, false, "the container is stopped although the AgentOS stop failed");
});

void test("RT-03, RT-01: a failed AgentOS stop keeps the supervisor's catalogue code as the causeCode of AGENTOS_STOP_FAILED", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  f.supervisor.stop = () => Promise.reject(new RealmError("AGENTOS_CRASH_LOOP"));
  await assert.rejects(
    f.exec.stop(containerId, realmSandboxName(SESSION)),
    (error: unknown) =>
      error instanceof RealmError && error.code === "AGENTOS_STOP_FAILED" && error.causeCode === "AGENTOS_CRASH_LOOP",
  );
});

void test("RT-03, RT-04, RT-01: destroy stops AgentOS while the container still exists, and removes the container even when that stop throws", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  await f.exec.start(containerId, realmSandboxName(SESSION));
  const seen: boolean[] = [];
  const stopAgentOs = f.supervisor.stop.bind(f.supervisor);
  f.supervisor.stop = async () => {
    seen.push(f.store.get(containerId) !== undefined);
    await stopAgentOs();
  };
  await f.exec.destroy(containerId, realmSandboxName(SESSION));
  assert.equal(f.driver.callCount("stop"), 1, "destroy stops the AgentOS driver");
  assert.deepEqual(seen, [true], "AgentOS stops while the container still exists");
  assert.equal(f.store.get(containerId), undefined, "the container is removed after AgentOS stops");

  const second = await createSession(f, "sess-02");
  f.supervisorFor("sess-02").stop = () => Promise.reject(new Error("scripted supervisor socket gone"));
  await assertCode(f.exec.destroy(second.containerId, realmSandboxName("sess-02")), "AGENTOS_STOP_FAILED");
  assert.equal(f.store.get(second.containerId), undefined, "the container is removed even though the AgentOS stop failed");
});

void test("RT-04, D-47: without an AgentOS supervisor, create, start, and probe each refuse with AGENTOS_NOT_CONFIGURED before any libpod request, OpenShell run, or policy write", async (t) => {
  const f = await fixture(t);
  await assertCode(f.unbound.create({ idempotencyKey: SESSION, workspaceRoot: f.workspaceRoot }), "AGENTOS_NOT_CONFIGURED");
  await assertCode(f.unbound.start("sandbox-container", realmSandboxName(SESSION)), "AGENTOS_NOT_CONFIGURED");
  await assertCode(f.unbound.probe("sandbox-container", realmSandboxName(SESSION)), "AGENTOS_NOT_CONFIGURED");
  assert.deepEqual(f.libpod.requests(), [], "no libpod request is sent");
  assert.equal(f.openshell.callCount(), 0, "no OpenShell run starts");
  assert.equal(existsSync(f.stateDir), false, "no policy document is written");
  assert.equal(f.store.list().length, 0, "no container is created");
});

void test("RT-03, D-47: without an AgentOS supervisor, stop stops the container and resolves, and destroy removes it, with no AgentOS call", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  await f.unbound.stop(containerId, realmSandboxName(SESSION));
  assert.equal(f.store.get(containerId)?.running, false, "the container is stopped");
  await f.unbound.destroy(containerId, realmSandboxName(SESSION));
  assert.equal(f.store.get(containerId), undefined, "the container is removed");
  assert.deepEqual(f.driver.calls(), ["create"], "the only AgentOS call is the create that ran before the unbound stop");
});

function routeCount(f: Fixture, route: string): number {
  return f.libpod.requests().filter((request) => request.route === route).length;
}

void test("AUD-02, D-67: the OpenShell environment names only PATH, HOME and XDG_RUNTIME_DIR from the supplied source", () => {
  assert.deepEqual(
    selectOpenShellEnvironment({
      PATH: "/usr/bin:/bin",
      HOME: "/home/realm",
      XDG_RUNTIME_DIR: undefined,
      REALM_SECRET_TOKEN: "must-not-pass",
    }),
    { PATH: "/usr/bin:/bin", HOME: "/home/realm" },
  );
});

void test("RT-03: the OpenShell runner starts argv[0] without a shell and gives the child only the supplied environment", async () => {
  const runner = spawnOpenShellRunner({ PATH: process.env["PATH"] ?? "/usr/bin:/bin", MARKER: "minimal" });
  const outcome = await runner(
    [
      process.execPath,
      "-e",
      "process.exit(Object.keys(process.env).sort().join(',') === 'MARKER,PATH' ? 0 : 3)",
    ],
    { timeoutMs: 10_000 },
  );
  assert.equal(outcome.exitCode, 0);
});

void test("RT-03: the OpenShell runner kills the process and the helpers it forked when timeoutMs expires, then rejects", async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-runner-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const pidFile = join(dir, "pids");
  const runner = spawnOpenShellRunner({ PATH: process.env["PATH"] ?? "/usr/bin:/bin", PID_FILE: pidFile });
  // The child forks a helper that stays in the child's process group, then both wait forever. The child
  // writes both pids on one newline-terminated line, so a reader never sees a partial write.
  const script = [
    "const fs = require('node:fs');",
    "const helper = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    "fs.writeFileSync(process.env.PID_FILE, process.pid + ' ' + helper.pid + '\\n');",
    "setInterval(() => {}, 1000);",
  ].join(" ");
  // Attached at once, so a rejection before the pids are read is never unhandled.
  const outcome = runner([process.execPath, "-e", script], { timeoutMs: 2000 }).then(
    () => "resolved",
    (error: unknown) => error,
  );
  const [childText, helperText] = (await waitForFile(pidFile, 5000)).trim().split(" ");
  assert.ok((await outcome) instanceof Error, "a runner that misses its budget must reject");
  assert.equal(await waitUntilGone(Number(childText), 3000), true, "the child must be killed at timeoutMs");
  assert.equal(await waitUntilGone(Number(helperText), 3000), true, "a helper the child forked must be killed with it");
});

void test("RT-03: the OpenShell runner rejects a binary that cannot start, and the rejection does not echo the path", async () => {
  const runner = spawnOpenShellRunner({ PATH: "/usr/bin:/bin" });
  const missing = "/nonexistent/realm-openshell-binary";
  const error = await runner([missing, "sandbox"], { timeoutMs: 5000 }).then(
    () => null,
    (failure: unknown) => failure,
  );
  assert.ok(error instanceof Error);
  assert.equal(error.message.includes(missing), false);
});

void test("RT-03: when the OpenShell runner cannot signal the child's process group, it rejects as failed, not as a clean timeout", async (t) => {
  t.mock.method(process, "kill", () => {
    throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
  });
  const error = await nodeRunner()([process.execPath, "-e", "setTimeout(() => {}, 10000)"], { timeoutMs: 200 }).then(
    () => null,
    (failure: unknown) => failure,
  );
  assert.ok(error instanceof OpenShellRunnerError);
  assert.equal(error.kind, "failed");
});

// The production runner with the minimal environment, for children that are plain node scripts.
function nodeRunner(): OpenShellRunner {
  return spawnOpenShellRunner({ PATH: process.env["PATH"] ?? "/usr/bin:/bin" });
}

void test("TOOL-03: exec spawns the pinned exec argv with output capture on and returns the runner outcome as it is", async (t) => {
  const f = await fixture(t);
  f.openshell.next({ output: { exitCode: 0, stdout: "hello", stderr: "warn", truncated: false } });
  const outcome = await runSandboxExec(f.openshell.runner, SESSION, WORKLOAD, 1500);
  assert.deepEqual(outcome, { exitCode: 0, stdout: "hello", stderr: "warn", truncated: false });
  const [call] = f.openshell.calls();
  assert.deepEqual(call?.argv, buildExecArgv(SESSION, WORKLOAD));
  assert.equal(call.captureOutput, true);
  assert.equal(call.timeoutMs, 1500);
  assert.equal(f.store.list().length, 0, "exec creates no container");
});

void test("TOOL-03: a non-zero remote exit code is a successful call carrying exitCode, not an error", async (t) => {
  const f = await fixture(t);
  f.openshell.next({ output: { exitCode: 7, stdout: "partial", stderr: "", truncated: false } });
  const outcome = await runSandboxExec(f.openshell.runner, SESSION, WORKLOAD, 1500);
  assert.equal(outcome.exitCode, 7);
  assert.equal(outcome.stdout, "partial");
});

void test("TOOL-03: a runner rejection during exec maps to REALM_NOT_ACTIVE, and the error carries no child text", async (t) => {
  const f = await fixture(t);
  f.openshell.next("reject-failed");
  await assertCode(runSandboxExec(f.openshell.runner, SESSION, WORKLOAD, 1500), "REALM_NOT_ACTIVE");
  f.openshell.next("reject");
  await assert.rejects(
    runSandboxExec(f.openshell.runner, SESSION, WORKLOAD, 1500),
    (error: unknown) => error instanceof RealmError && error.code === "REALM_NOT_ACTIVE" && !error.message.includes("ENOENT"),
  );
});

void test("TOOL-03: a deadline expiry during exec maps to TOOL_TIMEOUT", async (t) => {
  const f = await fixture(t);
  f.openshell.next("reject-timed-out");
  await assertCode(runSandboxExec(f.openshell.runner, SESSION, WORKLOAD, 1500), "TOOL_TIMEOUT");
});

void test("TOOL-03: exec refuses a non-positive timeout before any OpenShell run starts", async (t) => {
  const f = await fixture(t);
  await assertCode(runSandboxExec(f.openshell.runner, SESSION, WORKLOAD, 0), "SCHEMA_INVALID");
  assert.equal(f.openshell.callCount(), 0);
});

void test("TOOL-03: captured output is bounded at 262144 bytes per stream, and truncated is set when a stream is cut", async () => {
  const outcome = await nodeRunner()(
    [process.execPath, "-e", "process.stdout.write(Buffer.alloc(300000, 97)); process.stderr.write('bbbbb');"],
    { timeoutMs: 10_000, captureOutput: true },
  );
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.stdout, "a".repeat(OPENSHELL_OUTPUT_LIMIT_BYTES));
  assert.equal(outcome.stderr, "bbbbb");
  assert.equal(outcome.truncated, true);
});

void test("TOOL-03: captured output below the bound is returned whole with truncated false, and a non-zero exit is an outcome", async () => {
  const outcome = await nodeRunner()(
    [process.execPath, "-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(3);"],
    { timeoutMs: 10_000, captureOutput: true },
  );
  assert.deepEqual(outcome, { exitCode: 3, stdout: "out", stderr: "err", truncated: false });
});

void test("TOOL-03: without captureOutput the runner outcome carries the exit code only, so the create path keeps its output out", async () => {
  const outcome = await nodeRunner()([process.execPath, "-e", "process.stdout.write('quiet');"], { timeoutMs: 10_000 });
  assert.deepEqual(outcome, { exitCode: 0 });
});

void test("TOOL-03: a capturing run that misses timeoutMs has its process and forked helper killed, and rejects as a timed-out OpenShellRunnerError", async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-runner-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const pidFile = join(dir, "pids");
  const runner = spawnOpenShellRunner({ PATH: process.env["PATH"] ?? "/usr/bin:/bin", PID_FILE: pidFile });
  const script = [
    "const fs = require('node:fs');",
    "const helper = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    "fs.writeFileSync(process.env.PID_FILE, process.pid + ' ' + helper.pid + '\\n');",
    "setInterval(() => {}, 1000);",
  ].join(" ");
  // Attached at once, so a rejection before the pids are read is never unhandled.
  const outcome = runner([process.execPath, "-e", script], { timeoutMs: 2000, captureOutput: true }).then(
    () => "resolved",
    (error: unknown) => error,
  );
  const [childText, helperText] = (await waitForFile(pidFile, 5000)).trim().split(" ");
  const error = await outcome;
  assert.ok(error instanceof OpenShellRunnerError, "a run that misses its budget rejects with OpenShellRunnerError");
  assert.equal(error.kind, "timed-out");
  assert.equal(await waitUntilGone(Number(childText), 3000), true, "the child must be killed at timeoutMs");
  assert.equal(await waitUntilGone(Number(helperText), 3000), true, "a helper the child forked must be killed with it");
});

// Real time on purpose: the child is an operating-system process, and no fake clock can advance
// it. These helpers poll the pid file and the process table until the runner's kill is observed.
async function waitForFile(path: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (existsSync(path)) {
      const text = readFileSync(path, "utf8");
      if (text.endsWith("\n")) {
        return text;
      }
    }
    if (Date.now() > deadline) {
      throw new Error("the child never wrote its pids");
    }
    await sleep(20);
  }
}

// True once the process has exited. A killed process whose parent has not reaped it is a zombie, and
// kill(pid, 0) still succeeds for a zombie, so on Linux its state is read from /proc.
function hasExited(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return true;
  }
  return procState(pid) === "Z";
}

// The one-letter state field of /proc/<pid>/stat, or undefined where /proc is not available.
function procState(pid: number): string | undefined {
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    const afterName = stat.lastIndexOf(")") + 2;
    return stat.slice(afterName, afterName + 1);
  } catch {
    return undefined;
  }
}

async function waitUntilGone(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (hasExited(pid)) {
      return true;
    }
    if (Date.now() > deadline) {
      return false;
    }
    await sleep(20);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// The argv of every sandbox delete the session made through its OpenShell runner, in order.
function sandboxDeletes(f: Fixture): (readonly string[])[] {
  return f.openshell
    .calls()
    .map((call) => call.argv)
    .filter((argv) => argv[2] === "delete");
}

void test("B2: stop deletes the session's realm sandbox, and a repeated stop makes no second delete call", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  await f.exec.stop(containerId, realmSandboxName(SESSION));
  await f.exec.stop(containerId, realmSandboxName(SESSION));
  assert.deepEqual(sandboxDeletes(f), [[OPENSHELL_BINARY, "sandbox", "delete", realmSandboxName(SESSION)]]);
});

void test("B2: destroy deletes the session's realm sandbox the caller names, before the container goes", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  await f.exec.destroy(containerId, realmSandboxName(SESSION));
  assert.equal(f.store.get(containerId), undefined, "the container is removed");
  assert.deepEqual(sandboxDeletes(f), [[OPENSHELL_BINARY, "sandbox", "delete", realmSandboxName(SESSION)]]);
});

void test("B2: a failed sandbox delete is reported as AGENTOS_STOP_FAILED, the container is still stopped, and the next stop retries the delete", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  f.openshell.next("exit-1");
  await assertCode(f.exec.stop(containerId, realmSandboxName(SESSION)), "AGENTOS_STOP_FAILED");
  assert.equal(f.store.get(containerId)?.running, false, "the container is stopped although the delete failed");
  await f.exec.stop(containerId, realmSandboxName(SESSION));
  assert.equal(sandboxDeletes(f).length, 2, "the next stop retries the delete");
});

void test("N5: a driver stop that outlives the stop budget is reported as AGENTOS_STOP_FAILED, never as success, and the container is still stopped", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  const budgeted = new SessionExecution({
    libpod: new LibpodClient(join(f.base, "podman.sock")),
    runner: f.openshell.runner,
    agentosFor: () => f.supervisor,
    config: { image: IMAGE, stateDir: f.stateDir },
    egressAllow: EGRESS,
    stopDeadlineMs: 20,
  });
  // A driver stop that never settles: the stop budget is the only thing that ends the step.
  f.supervisor.stop = () => new Promise<void>(() => undefined);
  // The stop must reject with the catalogue reason. Resolving would report success while the sandbox delete is outstanding.
  await assert.rejects(
    budgeted.stop(containerId, realmSandboxName(SESSION)),
    (error: unknown) =>
      error instanceof RealmError &&
      error.code === "AGENTOS_STOP_FAILED" &&
      error.reason === makeRealmError("AGENTOS_STOP_FAILED").reason,
  );
  assert.equal(f.store.get(containerId)?.running, false, "the container is stopped although the budget ran out");
});

// A promise the test releases by hand, to hold an OpenShell create in flight.
function gate(): { readonly open: Promise<void>; readonly release: () => void } {
  let release: () => void = () => undefined;
  const open = new Promise<void>((resolve) => {
    release = () => {
      resolve();
    };
  });
  return { open, release };
}

// A libpod surface that delegates to the fixture's client. Once arm(step) is called, every later call to that step rejects
// with a libpod error, so one step fails after the create has recorded the sandbox name.
type ArmableStep = "inspectContainer" | "stopContainer" | "removeContainer";

function armableLibpod(f: Fixture): { readonly libpod: SessionContainers; readonly arm: (step: ArmableStep) => void } {
  const client = new LibpodClient(join(f.base, "podman.sock"));
  let armed: ArmableStep | undefined;
  const failIf = (step: ArmableStep): Promise<never> | undefined =>
    armed === step ? Promise.reject(makeRealmError("PODMAN_MACHINE_DOWN")) : undefined;
  const libpod: SessionContainers = {
    info: client.info.bind(client),
    listContainersByLabel: client.listContainersByLabel.bind(client),
    inspectContainer: (id) => failIf("inspectContainer") ?? client.inspectContainer(id),
    stopContainer: (id, timeoutMs) => failIf("stopContainer") ?? client.stopContainer(id, timeoutMs),
    removeContainer: (id, options) => failIf("removeContainer") ?? client.removeContainer(id, options),
  };
  return {
    libpod,
    arm: (step) => {
      armed = step;
    },
  };
}

// An AgentOS supervisor whose driver runs the sandbox create through the given runner, so a test that holds the runner holds
// the create too.
function supervisorThrough(runner: OpenShellRunner): AgentOsSupervisor {
  return new AgentOsSupervisor({
    driver: new FakeAgentOsDriver(runner),
    sessionId: SESSION,
    callTimeoutMs: 1000,
    random: () => 0,
    sleep: () => Promise.resolve(),
    now: () => 0,
  });
}

// A SessionExecution over the fixture's config, with the given libpod surface and runner. The runner runs the sandbox
// create (through the driver) and the sandbox delete.
function sessionExecWith(f: Fixture, libpod: SessionContainers, runner: OpenShellRunner = f.openshell.runner): SessionExecution {
  const supervisor = supervisorThrough(runner);
  return new SessionExecution({
    libpod,
    runner,
    agentosFor: () => supervisor,
    config: { image: IMAGE, stateDir: f.stateDir },
    egressAllow: EGRESS,
    readProcStatus: () => f.procStatus.text,
  });
}

// Creates the session's container through the given instance, so that instance holds the sandbox name it will delete.
async function createWith(f: Fixture, exec: SessionExecution): Promise<{ readonly containerId: string }> {
  scriptInspect(f, conformingInspect(f));
  return exec.create({ idempotencyKey: SESSION, workspaceRoot: f.workspaceRoot });
}

void test("B-1: a libpod error in stop does not skip the session sandbox delete, and the stop reports AGENTOS_STOP_FAILED with that libpod code", async (t) => {
  const f = await fixture(t);
  const armed = armableLibpod(f);
  const exec = sessionExecWith(f, armed.libpod);
  const { containerId } = await createWith(f, exec);
  armed.arm("stopContainer");
  await assertStopFailedWithCause(exec.stop(containerId, realmSandboxName(SESSION)), "PODMAN_MACHINE_DOWN");
  assert.deepEqual(sandboxDeletes(f), [[OPENSHELL_BINARY, "sandbox", "delete", realmSandboxName(SESSION)]]);
});

void test("B-1: a libpod error in destroy does not skip the session sandbox delete, and the destroy reports AGENTOS_STOP_FAILED with that libpod code", async (t) => {
  const f = await fixture(t);
  const armed = armableLibpod(f);
  const exec = sessionExecWith(f, armed.libpod);
  const { containerId } = await createWith(f, exec);
  armed.arm("removeContainer");
  await assertStopFailedWithCause(exec.destroy(containerId, realmSandboxName(SESSION)), "PODMAN_MACHINE_DOWN");
  assert.deepEqual(sandboxDeletes(f), [[OPENSHELL_BINARY, "sandbox", "delete", realmSandboxName(SESSION)]]);
});

void test("B-1: inspectContainer rejects in stop; the sandbox delete still runs, and the stop reports AGENTOS_STOP_FAILED with the libpod code", async (t) => {
  const f = await fixture(t);
  const armed = armableLibpod(f);
  const exec = sessionExecWith(f, armed.libpod);
  const { containerId } = await createWith(f, exec);
  armed.arm("inspectContainer");
  await assertStopFailedWithCause(exec.stop(containerId, realmSandboxName(SESSION)), "PODMAN_MACHINE_DOWN");
  assert.deepEqual(sandboxDeletes(f), [[OPENSHELL_BINARY, "sandbox", "delete", realmSandboxName(SESSION)]]);
});

void test("B-1: inspectContainer rejects in destroy; the sandbox delete still runs, and the stop reports AGENTOS_STOP_FAILED with the libpod code", async (t) => {
  const f = await fixture(t);
  const armed = armableLibpod(f);
  const exec = sessionExecWith(f, armed.libpod);
  const { containerId } = await createWith(f, exec);
  armed.arm("inspectContainer");
  await assertStopFailedWithCause(exec.destroy(containerId, realmSandboxName(SESSION)), "PODMAN_MACHINE_DOWN");
  assert.deepEqual(sandboxDeletes(f), [[OPENSHELL_BINARY, "sandbox", "delete", realmSandboxName(SESSION)]]);
});

void test("F5: a failed sandbox delete in the same stop as a failed libpod stop reports AGENTOS_STOP_FAILED, with the libpod code as its cause", async (t) => {
  const f = await fixture(t);
  const armed = armableLibpod(f);
  const exec = sessionExecWith(f, armed.libpod);
  const { containerId } = await createWith(f, exec);
  armed.arm("stopContainer");
  f.openshell.next("exit-1");
  await assertStopFailedWithCause(exec.stop(containerId, realmSandboxName(SESSION)), "PODMAN_MACHINE_DOWN");
  assert.deepEqual(sandboxDeletes(f), [[OPENSHELL_BINARY, "sandbox", "delete", realmSandboxName(SESSION)]], "the delete was attempted");
});

void test("F4: a create whose OpenShell run succeeds and whose label lookup then fails deletes the sandbox it made, and refuses with the lookup's cause", async (t) => {
  const f = await fixture(t);
  const client = new LibpodClient(join(f.base, "podman.sock"));
  let lookups = 0;
  // The first label lookup is the create's check for an existing container. The second is the poll after the OpenShell create,
  // and it fails with a non-transient libpod error.
  const libpod: SessionContainers = {
    info: client.info.bind(client),
    inspectContainer: client.inspectContainer.bind(client),
    stopContainer: client.stopContainer.bind(client),
    removeContainer: client.removeContainer.bind(client),
    listContainersByLabel: (key, value) => {
      lookups += 1;
      return lookups === 1 ? client.listContainersByLabel(key, value) : Promise.reject(makeRealmError("SCHEMA_INVALID"));
    },
  };
  const exec = sessionExecWith(f, libpod);
  await assert.rejects(
    exec.create({ idempotencyKey: SESSION, workspaceRoot: f.workspaceRoot }),
    (error: unknown) =>
      error instanceof RealmError && error.code === "OPENSHELL_START_FAILED" && error.causeCode === "SCHEMA_INVALID",
  );
  assert.deepEqual(sandboxDeletes(f), [[OPENSHELL_BINARY, "sandbox", "delete", realmSandboxName(SESSION)]]);
});

void test("B-3: a stop whose wait for an in-flight create outlasts its deadline reports AGENTOS_STOP_FAILED with the catalogue reason, and still deletes the named sandbox", async (t) => {
  const f = await fixture(t);
  const name = realmSandboxName(SESSION);
  const hold = gate();
  const heldRunner: OpenShellRunner = (argv, options) =>
    argv[2] === "create" ? hold.open.then(() => f.openshell.runner(argv, options)) : f.openshell.runner(argv, options);
  const supervisor = supervisorThrough(heldRunner);
  const exec = new SessionExecution({
    libpod: new LibpodClient(join(f.base, "podman.sock")),
    runner: heldRunner,
    agentosFor: () => supervisor,
    config: { image: IMAGE, stateDir: f.stateDir },
    egressAllow: EGRESS,
    stopDeadlineMs: 20,
    readProcStatus: () => f.procStatus.text,
  });
  // The create registers before its first await, so the stop below already sees it in flight.
  const created = exec.create({ idempotencyKey: SESSION, workspaceRoot: f.workspaceRoot });
  await assert.rejects(
    exec.stop(name, name),
    (error: unknown) =>
      error instanceof RealmError &&
      error.code === "AGENTOS_STOP_FAILED" &&
      error.reason === makeRealmError("AGENTOS_STOP_FAILED").reason,
  );
  assert.deepEqual(sandboxDeletes(f), [[OPENSHELL_BINARY, "sandbox", "delete", name]]);
  // Queued only after the stop: the stop's own inspect would otherwise consume it. The create's verification reads it after release.
  scriptInspect(f, conformingInspect(f));
  hold.release();
  await created.catch(() => undefined);
  // The late create deleted nothing before it finished: it deletes the sandbox it made and removes its container, then throws.
  assert.deepEqual(
    sandboxDeletes(f),
    [
      [OPENSHELL_BINARY, "sandbox", "delete", name],
      [OPENSHELL_BINARY, "sandbox", "delete", name],
    ],
    "the late sandbox is deleted once its create finishes",
  );
  assert.equal(f.store.list().filter((container) => container.running).length, 0, "the late container is removed");
  // The late sandbox is already gone, so the second stop succeeds with no third delete.
  await exec.stop(name, name);
  assert.equal(sandboxDeletes(f).length, 2, "the second stop makes no third delete");
});

void test("B-2: a destroy whose sandbox delete fails keeps the name owed, so a second destroy after the container is gone deletes the sandbox", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  f.openshell.next("exit-1");
  await assertCode(f.exec.destroy(containerId, realmSandboxName(SESSION)), "AGENTOS_STOP_FAILED");
  assert.equal(f.store.get(containerId), undefined, "the container is removed although the delete failed");
  await f.exec.destroy(containerId, realmSandboxName(SESSION));
  assert.deepEqual(sandboxDeletes(f), [
    [OPENSHELL_BINARY, "sandbox", "delete", realmSandboxName(SESSION)],
    [OPENSHELL_BINARY, "sandbox", "delete", realmSandboxName(SESSION)],
  ]);
});

void test("B-2: destroy of an already-removed container whose id is the realm sandbox name deletes the sandbox", async (t) => {
  const f = await fixture(t);
  const name = realmSandboxName(SESSION);
  await f.exec.destroy(name, name);
  assert.deepEqual(sandboxDeletes(f), [[OPENSHELL_BINARY, "sandbox", "delete", name]]);
});

void test("B-3: a stop during a session create waits for the create, deletes the sandbox it produced, and the create is not reported as active", async (t) => {
  const f = await fixture(t);
  const name = realmSandboxName(SESSION);
  const hold = gate();
  const heldRunner: OpenShellRunner = (argv, options) =>
    argv[2] === "create" ? hold.open.then(() => f.openshell.runner(argv, options)) : f.openshell.runner(argv, options);
  const exec = sessionExecWith(f, new LibpodClient(join(f.base, "podman.sock")), heldRunner);
  // The container the create produces is inspected by its own create, before the stop can act on it.
  scriptInspect(f, conformingInspect(f));
  const created = exec.create({ idempotencyKey: SESSION, workspaceRoot: f.workspaceRoot });
  // The stop names the sandbox, because the container id does not exist until the create returns.
  const stopped = exec.stop(name, name);
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
  assert.equal(stopSettled, false, "the stop waits for the create it names");
  hold.release();
  await assert.rejects(created, (error: unknown) => error instanceof RealmError && error.code === "OPENSHELL_START_FAILED");
  await stopped;
  assert.deepEqual(sandboxDeletes(f), [[OPENSHELL_BINARY, "sandbox", "delete", name]]);
  assert.equal(f.store.list().filter((container) => container.running).length, 0, "no container is left running");
});

void test("RT-04, D-28: the startup budget covers the runner start on the session path: a start that outruns it gives STARTUP_BUDGET_EXCEEDED and the session is in error", async (t) => {
  const f = await fixture(t);
  mkdirSync(f.workspaceRoot, { recursive: true });
  // The runner start hangs, so the controller's startup budget ends the wait. The budget is shorter than the supervisor's
  // own call budget (1000 ms), so the controller, not the supervisor, reports the expiry.
  f.driver.script("start", "hang");
  scriptInspect(f, conformingInspect(f));
  const controller = new LifecycleController({
    sessionId: SESSION,
    policy: {
      mode: "advisory",
      workspaceRoots: [f.workspaceRoot],
      credentialAllow: [],
      egressAllow: [],
      shellEnabled: false,
      startupBudgetMs: 500,
      toolQueueMs: 2000,
    },
    pinnedRoot: bindWorkspaceUnderPolicy([f.workspaceRoot], f.workspaceRoot),
    store: new SessionStore(f.stateDir),
    exec: f.exec,
    bridge: new FakeBridge(),
    clock: () => new Date("2026-10-21T09:30:00.000Z"),
  });
  const snapshot = await controller.create(f.workspaceRoot);
  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "STARTUP_BUDGET_EXCEEDED");
  assert.equal(f.driver.callCount("start"), 1, "the runner start was issued and never answered");
});

void test("RT-03, RT-04, D-18: a session named s1 gets its own sandbox: create, runner exec, probe exec and delete all name realm-s1, and realm-daemon is never named", async (t) => {
  const f = await fixture(t);
  const name = realmSandboxName("s1");
  const spawned: (readonly string[])[] = [];
  const child: RunnerChild = {
    hasExited: () => false,
    exited: new Promise<void>(() => undefined),
    terminate: () => Promise.resolve(),
  };
  const driver = createOpenShellAgentOsDriver({
    runner: f.openshell.runner,
    spawnRunner: (argv) => {
      spawned.push([...argv]);
      return child;
    },
    startTimeoutMs: 10_000,
    callTimeoutMs: 1000,
    probeIntervalMs: 1,
  });
  // One supervisor per session, the same object for the same session on every call.
  const supervisors = new Map<string, AgentOsSupervisor>();
  const exec = new SessionExecution({
    libpod: new LibpodClient(join(f.base, "podman.sock")),
    runner: f.openshell.runner,
    agentosFor: (sessionId) => {
      let supervisor = supervisors.get(sessionId);
      if (supervisor === undefined) {
        supervisor = new AgentOsSupervisor({
          driver,
          sessionId,
          callTimeoutMs: 10_000,
          random: () => 0,
          sleep: () => Promise.resolve(),
          now: () => 0,
        });
        supervisors.set(sessionId, supervisor);
      }
      return supervisor;
    },
    config: { image: IMAGE, stateDir: f.stateDir },
    egressAllow: EGRESS,
    readProcStatus: () => f.procStatus.text,
  });
  scriptInspect(f, conformingInspect(f));
  const { containerId } = await exec.create({ idempotencyKey: "s1", workspaceRoot: f.workspaceRoot });
  // The start's readiness probe and the probe's liveness check each answer exit 0.
  f.openshell.next({ output: { exitCode: 0 } }, { output: { exitCode: 0 } });
  await exec.start(containerId, name);
  assert.equal(await exec.probe(containerId, name), "healthy");
  await exec.stop(containerId, name);

  const argvs = f.openshell.calls().map((call) => call.argv);
  const creates = argvs.filter((argv) => argv[2] === "create");
  const execs = argvs.filter((argv) => argv[2] === "exec");
  const deletes = argvs.filter((argv) => argv[2] === "delete");
  assert.equal(creates.length, 1, "one sandbox create");
  assert.equal(creates[0]?.[creates[0].indexOf("--name") + 1], name);
  assert.deepEqual(
    execs.map((argv) => argv[argv.indexOf("--name") + 1]),
    [name, name],
    "the runner's readiness probe and the probe's liveness check both name realm-s1",
  );
  assert.deepEqual(deletes, [[OPENSHELL_BINARY, "sandbox", "delete", name]]);
  assert.deepEqual(spawned, [buildExecArgv("s1", ["node", DEFAULT_AGENTOS_RUNNER_PATH])]);
  const everyName = [...argvs, ...spawned].flat();
  assert.equal(everyName.includes("realm-daemon"), false, "no argv names the daemon's sandbox");
  assert.equal(everyName.some((token) => token.startsWith("realm-daemon")), false);
});
