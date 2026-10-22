import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import { AgentOsSupervisor } from "../../src/runtime/agentos.js";
import { renderNetworkPolicies } from "../../src/runtime/egress.js";
import { HARDENING_PROFILE } from "../../src/runtime/hardening.js";
import { LibpodClient } from "../../src/runtime/libpod-client.js";
import { buildExecArgv, buildPolicyDocument, OPENSHELL_OUTPUT_LIMIT_BYTES, OpenShellRunnerError, type OpenShellRunner } from "../../src/runtime/openshell.js";
import {
  HardeningFailedError,
  runSandboxExec,
  SessionExecution,
  selectOpenShellEnvironment,
  spawnOpenShellRunner,
} from "../../src/runtime/session-execution.js";
import { FakeAgentOsDriver } from "../support/fake-agentos.js";
import { FakeContainerStore, FakeLibpod } from "../support/fake-libpod.js";
import { FakeOpenShell } from "../support/fake-openshell.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SESSION = "sess-01";
const DIGEST = `sha256:${"a".repeat(64)}`;
const IMAGE = `registry.example.com/realm/session@${DIGEST}`;
const WORKLOAD_BINARY = "/usr/bin/agent";
const WORKLOAD = [WORKLOAD_BINARY, "--serve"];
const EGRESS = [{ host: "api.example.com", port: 443 }];
// The D-80 flags no argv on the execution path may carry (RT-05). Each is compared as a whole argv element.
const FORBIDDEN_FLAGS = ["--env", "--provider", "--driver-config-json", "--forward", "--expose", "--template", "--auto-providers"];

interface Fixture {
  readonly base: string;
  readonly stateDir: string;
  readonly workspaceRoot: string;
  readonly store: FakeContainerStore;
  readonly libpod: FakeLibpod;
  readonly openshell: FakeOpenShell;
  readonly driver: FakeAgentOsDriver;
  readonly supervisor: AgentOsSupervisor;
  readonly exec: SessionExecution;
  // The same libpod and runner with no AgentOS supervisor bound (the AGENTOS_NOT_CONFIGURED paths).
  readonly unbound: SessionExecution;
  // One entry per OpenShell run: the policy document's text when the run starts, or undefined when no
  // document exists yet.
  readonly policyAtRun: (string | undefined)[];
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
  const driver = new FakeAgentOsDriver();
  const supervisor = new AgentOsSupervisor({
    driver,
    callTimeoutMs: 1000,
    random: () => 0,
    sleep: () => Promise.resolve(),
    now: () => 0,
  });
  const libpodClient = new LibpodClient(socketPath);
  const exec = new SessionExecution({
    libpod: libpodClient,
    runner,
    agentos: supervisor,
    config: { image: IMAGE, workloadArgv: WORKLOAD, stateDir },
    egressAllow: EGRESS,
  });
  const unbound = new SessionExecution({
    libpod: libpodClient,
    runner,
    config: { image: IMAGE, workloadArgv: WORKLOAD, stateDir },
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
    exec,
    unbound,
    policyAtRun,
  };
}

// A libpod inspect object that conforms to every D-51 property, with the overrides merged into
// HostConfig. The mount sources are the workspace root and the state directory.
function conformingInspect(f: Fixture, hostOverrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    ImageDigest: DIGEST,
    State: { Running: true, Status: "running" },
    HostConfig: {
      Privileged: false,
      CapDrop: ["ALL"],
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

void test("RT-03, CORE-06: the policy document is written before the OpenShell create runs", async (t) => {
  const f = await fixture(t);
  await createSession(f);
  assert.equal(f.policyAtRun.length, 1, "one OpenShell run, the create");
  assert.notEqual(f.policyAtRun[0], undefined, "the policy document exists when the create runs");
  const policy = join(f.stateDir, "runtime", `${SESSION}.policy.json`);
  assert.equal(readFileSync(policy, "utf8"), `${JSON.stringify(buildPolicyDocument(EGRESS, WORKLOAD_BINARY), null, 2)}\n`);
});

void test("RT-05, RT-03: create writes the egress list and the workload binary into the policy the create runs against", async (t) => {
  const f = await fixture(t);
  await createSession(f);
  const written = f.policyAtRun[0];
  assert.ok(written !== undefined, "the policy document exists when the create runs");
  assert.equal(written, `${JSON.stringify(buildPolicyDocument(EGRESS, WORKLOAD_BINARY), null, 2)}\n`);
  const policy = JSON.parse(written) as { readonly network_policies: unknown };
  assert.deepEqual(policy.network_policies, renderNetworkPolicies(EGRESS, WORKLOAD_BINARY));
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
          agentos: f.supervisor,
          config: { image: IMAGE, workloadArgv: WORKLOAD, stateDir: f.stateDir },
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
  await assertCode(f.exec.start(containerId), "OPENSHELL_START_FAILED");
  assert.deepEqual(f.driver.calls(), []);

  f.store.setRunning(containerId, true);
  await f.exec.start(containerId);
  assert.equal(f.driver.callCount("start"), 1);
  assert.equal(f.openshell.callCount(), 1);
});

void test("RT-01, RT-04: probe is healthy only when the container runs and AgentOS reports alive", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  assert.equal(await f.exec.probe(containerId), "unhealthy", "AgentOS was never started");
  await f.exec.start(containerId);
  assert.equal(await f.exec.probe(containerId), "healthy");
  f.store.setRunning(containerId, false);
  assert.equal(await f.exec.probe(containerId), "unhealthy", "a stopped container is never healthy");
  assert.equal(await f.exec.probe("missing-container"), "unhealthy");
});

void test("RT-01, RT-04: a probe whose inspect cannot be read rejects with the libpod code instead of reporting unhealthy", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  await f.exec.start(containerId);
  f.libpod.respondNext("inspectContainer", { status: 500 });
  await assertCode(f.exec.probe(containerId), "SCHEMA_INVALID");
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
  assert.equal(f.openshell.callCount(), 1, "the reuse path runs no second OpenShell create");
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
  await f.exec.stop(containerId);
  assert.equal(f.store.get(containerId)?.running, false);
  await f.exec.stop(containerId);
  assert.equal(f.store.get(containerId)?.running, false, "a repeated stop keeps the container stopped");
  await f.exec.destroy(containerId);
  assert.equal(f.store.get(containerId), undefined);
  const removals = routeCount(f, "removeContainer");
  await f.exec.destroy(containerId);
  assert.equal(routeCount(f, "removeContainer"), removals + 1, "a repeated destroy still sends its remove request");
  assert.equal(f.store.list().length, 0, "a repeated destroy leaves the store empty");
  const stops = routeCount(f, "stopContainer");
  await f.exec.stop(containerId);
  assert.equal(routeCount(f, "stopContainer"), stops, "a stop of a removed container sends no stop request");
});

void test("RT-03, RT-01: a stop whose AgentOS stop throws still stops the container, then reports AGENTOS_STOP_FAILED", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  f.supervisor.stop = () => Promise.reject(new Error("scripted supervisor socket gone"));
  await assertCode(f.exec.stop(containerId), "AGENTOS_STOP_FAILED");
  assert.equal(f.store.get(containerId)?.running, false, "the container is stopped although the AgentOS stop failed");
});

void test("RT-03, RT-01: a failed AgentOS stop keeps the supervisor's catalogue code as the causeCode of AGENTOS_STOP_FAILED", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  f.supervisor.stop = () => Promise.reject(new RealmError("AGENTOS_CRASH_LOOP"));
  await assert.rejects(
    f.exec.stop(containerId),
    (error: unknown) =>
      error instanceof RealmError && error.code === "AGENTOS_STOP_FAILED" && error.causeCode === "AGENTOS_CRASH_LOOP",
  );
});

void test("RT-03, RT-04, RT-01: destroy stops AgentOS while the container still exists, and removes the container even when that stop throws", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  await f.exec.start(containerId);
  const seen: boolean[] = [];
  const stopAgentOs = f.supervisor.stop.bind(f.supervisor);
  f.supervisor.stop = async () => {
    seen.push(f.store.get(containerId) !== undefined);
    await stopAgentOs();
  };
  await f.exec.destroy(containerId);
  assert.equal(f.driver.callCount("stop"), 1, "destroy stops the AgentOS driver");
  assert.deepEqual(seen, [true], "AgentOS stops while the container still exists");
  assert.equal(f.store.get(containerId), undefined, "the container is removed after AgentOS stops");

  const second = await createSession(f, "sess-02");
  f.supervisor.stop = () => Promise.reject(new Error("scripted supervisor socket gone"));
  await assertCode(f.exec.destroy(second.containerId), "AGENTOS_STOP_FAILED");
  assert.equal(f.store.get(second.containerId), undefined, "the container is removed even though the AgentOS stop failed");
});

void test("RT-04, D-47: without an AgentOS supervisor, create, start, and probe each refuse with AGENTOS_NOT_CONFIGURED before any libpod request, OpenShell run, or policy write", async (t) => {
  const f = await fixture(t);
  await assertCode(f.unbound.create({ idempotencyKey: SESSION, workspaceRoot: f.workspaceRoot }), "AGENTOS_NOT_CONFIGURED");
  await assertCode(f.unbound.start("sandbox-container"), "AGENTOS_NOT_CONFIGURED");
  await assertCode(f.unbound.probe("sandbox-container"), "AGENTOS_NOT_CONFIGURED");
  assert.deepEqual(f.libpod.requests(), [], "no libpod request is sent");
  assert.equal(f.openshell.callCount(), 0, "no OpenShell run starts");
  assert.equal(existsSync(f.stateDir), false, "no policy document is written");
  assert.equal(f.store.list().length, 0, "no container is created");
});

void test("RT-03, D-47: without an AgentOS supervisor, stop stops the container and resolves, and destroy removes it, with no AgentOS call", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  await f.unbound.stop(containerId);
  assert.equal(f.store.get(containerId)?.running, false, "the container is stopped");
  await f.unbound.destroy(containerId);
  assert.equal(f.store.get(containerId), undefined, "the container is removed");
  assert.deepEqual(f.driver.calls(), [], "no AgentOS driver call is made");
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

void test("AUD-02, D-67: session-execution reads no host environment and its runner never uses a shell", () => {
  const source = readFileSync(join(ROOT, "src", "runtime", "session-execution.ts"), "utf8");
  assert.equal(source.includes("process.env"), false);
  assert.equal(source.includes("shell: true"), false);
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
