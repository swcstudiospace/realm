import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import { AgentOsSupervisor } from "../../src/runtime/agentos.js";
import { HARDENING_PROFILE } from "../../src/runtime/hardening.js";
import { LibpodClient } from "../../src/runtime/libpod-client.js";
import { buildPolicyDocument, type OpenShellRunner } from "../../src/runtime/openshell.js";
import {
  HardeningFailedError,
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
const WORKLOAD = ["/usr/bin/agent", "--serve"];

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
  // One entry per OpenShell run: whether the policy document already existed when it ran.
  readonly policyPresentAtRun: boolean[];
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
  const policyPresentAtRun: boolean[] = [];
  const runner: OpenShellRunner = (argv, options) => {
    const policy = argv[argv.indexOf("--policy") + 1];
    policyPresentAtRun.push(policy !== undefined && existsSync(policy));
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
  const exec = new SessionExecution({
    libpod: new LibpodClient(socketPath),
    runner,
    agentos: supervisor,
    config: { image: IMAGE, workloadArgv: WORKLOAD, stateDir },
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
    policyPresentAtRun,
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

test("CORE-06, RT-03: a second create with the same session reuses the labelled container and runs the OpenShell create once", async (t) => {
  const f = await fixture(t);
  const first = await createSession(f);
  const second = await createSession(f);
  assert.equal(second.containerId, first.containerId);
  assert.equal(f.openshell.callCount(), 1);
  assert.equal(f.store.list().length, 1);
});

test("RT-01, RT-03: a failed hardening check destroys the container and throws OPENSHELL_START_FAILED naming the first failed property", async (t) => {
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

test("RT-01, RT-03: an inspect that cannot be read fails closed, removes the container, and throws OPENSHELL_START_FAILED", async (t) => {
  const f = await fixture(t);
  f.libpod.respondNext("inspectContainer", { status: 500 });
  await assertCode(f.exec.create({ idempotencyKey: SESSION, workspaceRoot: f.workspaceRoot }), "OPENSHELL_START_FAILED");
  assert.equal(f.store.list().length, 0);
});

test("RT-03, CORE-06: the policy document is written before the OpenShell create runs", async (t) => {
  const f = await fixture(t);
  await createSession(f);
  assert.deepEqual(f.policyPresentAtRun, [true]);
  const policy = join(f.stateDir, "runtime", `${SESSION}.policy.json`);
  assert.equal(readFileSync(policy, "utf8"), `${JSON.stringify(buildPolicyDocument(), null, 2)}\n`);
});

test("RT-03, RT-04: start refuses a container that is not running and starts AgentOS only through the supervisor", async (t) => {
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

test("RT-01, RT-04: probe is healthy only when the container runs and AgentOS reports alive", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  assert.equal(await f.exec.probe(containerId), "unhealthy", "AgentOS was never started");
  await f.exec.start(containerId);
  assert.equal(await f.exec.probe(containerId), "healthy");
  f.store.setRunning(containerId, false);
  assert.equal(await f.exec.probe(containerId), "unhealthy", "a stopped container is never healthy");
  assert.equal(await f.exec.probe("missing-container"), "unhealthy");
});

test("RT-01, RT-03: a reused container whose inspect does not conform is verified on the reuse path, removed, and refused", async (t) => {
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

test("RT-01, D-51: a state directory mounted read-write fails the mounts property through create, and the container is removed", async (t) => {
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

test("RT-01, D-51: a libpod that reports rootless false fails the rootless property through create, and the container is removed", async (t) => {
  const f = await fixture(t, { rootless: false });
  await assert.rejects(
    createSession(f),
    (error: unknown) =>
      error instanceof HardeningFailedError && error.code === "OPENSHELL_START_FAILED" && error.property === "rootless",
  );
  assert.equal(f.store.list().length, 0, "the container of a rootless-false engine is removed");
});

test("RT-03: stop stops the container, destroy removes it, and a repeated stop or destroy leaves the store unchanged", async (t) => {
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

function routeCount(f: Fixture, route: string): number {
  return f.libpod.requests().filter((request) => request.route === route).length;
}

test("AUD-02, D-67: the OpenShell environment names only PATH, HOME and XDG_RUNTIME_DIR from the supplied source", () => {
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

test("AUD-02, D-67: session-execution reads no host environment and its runner never uses a shell", () => {
  const source = readFileSync(join(ROOT, "src", "runtime", "session-execution.ts"), "utf8");
  assert.equal(source.includes("process.env"), false);
  assert.equal(source.includes("shell: true"), false);
});

test("RT-03: the OpenShell runner starts argv[0] without a shell and gives the child only the supplied environment", async () => {
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

test("RT-03: the OpenShell runner kills the process and the helpers it forked when timeoutMs expires, then rejects", async (t) => {
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

test("RT-03: the OpenShell runner rejects a binary that cannot start, and the rejection does not echo the path", async () => {
  const runner = spawnOpenShellRunner({ PATH: "/usr/bin:/bin" });
  const missing = "/nonexistent/realm-openshell-binary";
  const error = await runner([missing, "sandbox"], { timeoutMs: 5000 }).then(
    () => null,
    (failure: unknown) => failure,
  );
  assert.ok(error instanceof Error);
  assert.equal(error.message.includes(missing), false);
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
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
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
