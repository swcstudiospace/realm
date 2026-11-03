import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createOpenShellAgentOsDriver } from "../../src/runtime/agentos-driver.js";
import { boundedWait } from "../support/timing.js";
import type { RunnerChild } from "../../src/runtime/agentos-workload.js";
import type { OpenShellRunner } from "../../src/runtime/openshell.js";

const SESSION = "sess-budget";

// A runner child that does not exit on its own, so the budgets are the only thing these tests read.
const RUNNING_CHILD: RunnerChild = {
  hasExited: () => false,
  exited: new Promise<void>(() => undefined),
  terminate: () => Promise.resolve(),
};

function recordingRunner(): { readonly runner: OpenShellRunner; readonly calls: { binary: string; timeoutMs: number }[] } {
  const calls: { binary: string; timeoutMs: number }[] = [];
  const runner: OpenShellRunner = (argv, options) => {
    calls.push({ binary: String(argv[0]), timeoutMs: options.timeoutMs });
    return Promise.resolve({ exitCode: 0 });
  };
  return { runner, calls };
}

// A runner stand-in: a sleeping process that leads its own process group, as the production spawn makes the runner, so the record
// the driver writes names a live leader. The test kills the group when it ends and waits for the exit, so nothing outlives it.
function sleepingRunner(t: TestContext): RunnerChild {
  const proc = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  const exited = new Promise<void>((resolve) => {
    proc.once("exit", () => {
      resolve();
    });
    proc.once("error", () => {
      resolve();
    });
  });
  const killGroup = (): void => {
    if (proc.pid !== undefined) {
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        // The group is already gone.
      }
    }
  };
  t.after(async () => {
    killGroup();
    await boundedWait(exited, "the runner stand-in exits", 5000);
  });
  return {
    pid: proc.pid,
    hasExited: () => proc.exitCode !== null || proc.signalCode !== null,
    exited,
    terminate: async () => {
      killGroup();
      await boundedWait(exited, "the runner stand-in exits", 5000);
    },
  };
}

void test("the readiness probe and the alive probe are each bounded by the call budget, and stop issues no OpenShell call", async (t) => {
  const { runner, calls } = recordingRunner();
  const stateDir = mkdtempSync(join(tmpdir(), "realm-budget-state-"));
  t.after(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });
  const driver = createOpenShellAgentOsDriver({
    runner,
    spawnRunner: () => sleepingRunner(t),
    startTimeoutMs: 180_000,
    callTimeoutMs: 30_000,
    driverSocketPath: "/nonexistent-realm-driver/driver.sock",
    stateDir,
  });
  await driver.start(SESSION);
  await driver.alive(SESSION);
  await driver.stop(SESSION);
  assert.deepEqual(
    calls.map((call) => call.timeoutMs),
    [30_000, 30_000],
  );
});

void test("a non-positive start budget is refused with a RangeError before any runner call", () => {
  const { runner, calls } = recordingRunner();
  assert.throws(
    () =>
      createOpenShellAgentOsDriver({
        runner,
        spawnRunner: () => RUNNING_CHILD,
        startTimeoutMs: 0,
        callTimeoutMs: 30_000,
        driverSocketPath: "/nonexistent-realm-driver/driver.sock",
      }),
    RangeError,
  );
  assert.equal(calls.length, 0);
});
