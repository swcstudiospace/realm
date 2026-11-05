import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { SpawnOptions } from "node:child_process";
import { RealmError } from "../../src/core/errors.js";
import {
  spawnRunnerChild,
  type RunnerProcess,
  type SpawnProcess,
} from "../../src/runtime/agentos-workload.js";
import { selectOpenShellEnvironment } from "../../src/runtime/session-execution.js";

const RUNNER = "/usr/local/lib/realm/agentos-runner.js";
// The exec form the realm starts the runner with after create (D-92, D4).
const EXEC_ARGV = [
  "openshell",
  "sandbox",
  "exec",
  "--name",
  "realm-daemon",
  "--workdir",
  "/workspace",
  "--no-tty",
  "--no-login-shell",
  "--",
  "node",
  RUNNER,
];

interface Spawned {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: SpawnOptions;
}

// A process the test controls. kill() records each signal, and a signal listed in exitsOn ends the process the way a
// cooperative runner does. pid is absent unless a test gives one; such a test mocks process.kill, so no real group is
// signalled.
class FakeProcess extends EventEmitter implements RunnerProcess {
  readonly signals: NodeJS.Signals[] = [];
  private readonly exitsOn: readonly NodeJS.Signals[];
  readonly pid: number | undefined;

  constructor(exitsOn: readonly NodeJS.Signals[], pid: number | undefined) {
    super();
    this.exitsOn = exitsOn;
    this.pid = pid;
  }

  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    if (this.exitsOn.includes(signal)) {
      this.exit();
    }
    return true;
  }

  exit(): void {
    this.emit("exit", 0, null);
  }
}

function recorder(exitsOn: readonly NodeJS.Signals[] = [], pid?: number): {
  readonly spawnProcess: SpawnProcess;
  readonly spawned: Spawned[];
  readonly processes: FakeProcess[];
} {
  const spawned: Spawned[] = [];
  const processes: FakeProcess[] = [];
  const spawnProcess: SpawnProcess = (file, args, options) => {
    spawned.push({ file, args: [...args], options: { ...options } });
    const proc = new FakeProcess(exitsOn, pid);
    processes.push(proc);
    return proc;
  };
  return { spawnProcess, spawned, processes };
}

void test("the runner child is spawned with the exact exec argv, no shell, and its output ignored", () => {
  const { spawnProcess, spawned } = recorder();
  spawnRunnerChild({ PATH: "/usr/bin" }, spawnProcess)(EXEC_ARGV);
  const [call] = spawned;
  assert.equal(call?.file, "openshell");
  assert.ok(call);
  assert.deepEqual(call.args, EXEC_ARGV.slice(1));
  assert.equal(call.options.shell, false);
  assert.equal(call.options.stdio, "ignore");
});

void test("the child receives only the environment names the OpenShell calls receive", () => {
  const { spawnProcess, spawned } = recorder();
  const environment = selectOpenShellEnvironment({
    PATH: "/usr/bin",
    HOME: "/home/realm",
    XDG_RUNTIME_DIR: "/run/user/1001",
    REALM_SECRET: "must-not-pass",
  });
  spawnRunnerChild(environment, spawnProcess)(EXEC_ARGV);
  assert.deepEqual(spawned[0]?.options.env, { PATH: "/usr/bin", HOME: "/home/realm", XDG_RUNTIME_DIR: "/run/user/1001" });
});

void test("an empty argv is refused with SCHEMA_INVALID, and nothing is spawned", () => {
  const { spawnProcess, spawned } = recorder();
  assert.throws(
    () => spawnRunnerChild({}, spawnProcess)([]),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  assert.equal(spawned.length, 0);
});

void test("hasExited is false while the child runs, and true once it exits", () => {
  const { spawnProcess, processes } = recorder();
  const child = spawnRunnerChild({}, spawnProcess)(EXEC_ARGV);
  assert.equal(child.hasExited(), false);
  processes[0]?.exit();
  assert.equal(child.hasExited(), true);
});

void test("a spawn that fails before a pid exists counts as an exit", () => {
  const { spawnProcess, processes } = recorder();
  const child = spawnRunnerChild({}, spawnProcess)(EXEC_ARGV);
  processes[0]?.emit("error", new Error("spawn failed"));
  assert.equal(child.hasExited(), true);
});

void test("terminate sends SIGTERM and sends no SIGKILL when the child exits on it", async () => {
  const { spawnProcess, processes } = recorder(["SIGTERM"]);
  const child = spawnRunnerChild({}, spawnProcess)(EXEC_ARGV);
  await child.terminate(1000);
  assert.deepEqual(processes[0]?.signals, ["SIGTERM"]);
  assert.equal(child.hasExited(), true);
});

void test("terminate escalates to SIGKILL when the child ignores SIGTERM past the grace", async () => {
  const { spawnProcess, processes } = recorder(["SIGKILL"]);
  const child = spawnRunnerChild({}, spawnProcess)(EXEC_ARGV);
  await child.terminate(20);
  assert.deepEqual(processes[0]?.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.hasExited(), true);
});

void test("terminate is bounded: a child that survives SIGKILL is abandoned, not waited for", async () => {
  const { spawnProcess, processes } = recorder([]);
  const child = spawnRunnerChild({}, spawnProcess)(EXEC_ARGV);
  await child.terminate(20);
  assert.deepEqual(processes[0]?.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.hasExited(), false);
});

// The group id a test gives its fake child. process.kill is mocked for these tests, so no real group receives a signal.
const GROUP_PID = 4242;

// A group signal that fails with the given code. process.kill is only called for the group, so the direct signal is not
// affected.
function groupSignalFails(t: TestContext, code: string): void {
  t.mock.method(process, "kill", (): true => {
    throw Object.assign(new Error(code), { code });
  });
}

void test("terminate reports CLEANUP_FAILED when the process group cannot be signalled, and still signals the child", async (t) => {
  groupSignalFails(t, "EPERM");
  const { spawnProcess, processes } = recorder(["SIGTERM"], GROUP_PID);
  const child = spawnRunnerChild({}, spawnProcess)(EXEC_ARGV);
  const cleanup = await child.terminate(1000);
  assert.equal(cleanup?.code, "CLEANUP_FAILED");
  assert.deepEqual(processes[0]?.signals, ["SIGTERM"]);
  assert.equal(child.hasExited(), true);
});

void test("a process group that is already gone (ESRCH) is not a failure, and the child is signalled directly", async (t) => {
  groupSignalFails(t, "ESRCH");
  const { spawnProcess, processes } = recorder(["SIGTERM"], GROUP_PID);
  const child = spawnRunnerChild({}, spawnProcess)(EXEC_ARGV);
  assert.equal(await child.terminate(1000), undefined);
  assert.deepEqual(processes[0]?.signals, ["SIGTERM"]);
  assert.equal(child.hasExited(), true);
});

void test("a child that outlives SIGKILL is reported as CLEANUP_FAILED once terminate gives up on it", async () => {
  const { spawnProcess, processes } = recorder([]);
  const child = spawnRunnerChild({}, spawnProcess)(EXEC_ARGV);
  const cleanup = await child.terminate(20);
  assert.deepEqual(processes[0]?.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(cleanup?.code, "CLEANUP_FAILED");
  assert.equal(child.hasExited(), false);
});
