import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpenShellAgentOsDriver } from "../../src/runtime/agentos-driver.js";
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

void test("the readiness probe and the alive probe are each bounded by the call budget, and stop issues no OpenShell call", async () => {
  const { runner, calls } = recordingRunner();
  const driver = createOpenShellAgentOsDriver({
    runner,
    spawnRunner: () => RUNNING_CHILD,
    startTimeoutMs: 180_000,
    callTimeoutMs: 30_000,
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
      }),
    RangeError,
  );
  assert.equal(calls.length, 0);
});
