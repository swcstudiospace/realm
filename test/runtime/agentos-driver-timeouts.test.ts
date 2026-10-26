import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpenShellAgentOsDriver } from "../../src/runtime/agentos-driver.js";
import type { RunnerChild } from "../../src/runtime/agentos-workload.js";
import type { OpenShellRunner } from "../../src/runtime/openshell.js";

const IMAGE = `localhost/realm-agentos@sha256:${"c".repeat(64)}`;
// A runner child that does not exit on its own, so the budgets are the only thing these tests read.
const RUNNING_CHILD: RunnerChild = { hasExited: () => false, terminate: () => Promise.resolve() };

function recordingRunner(): { readonly runner: OpenShellRunner; readonly calls: { binary: string; timeoutMs: number }[] } {
  const calls: { binary: string; timeoutMs: number }[] = [];
  const runner: OpenShellRunner = (argv, options) => {
    calls.push({ binary: String(argv[0]), timeoutMs: options.timeoutMs });
    return Promise.resolve({ exitCode: 0 });
  };
  return { runner, calls };
}

void test("create is bounded by the start budget; the readiness probe, the alive probe and the delete by the call budget", async () => {
  const { runner, calls } = recordingRunner();
  const driver = createOpenShellAgentOsDriver({
    runner,
    spawnRunner: () => RUNNING_CHILD,
    imageRef: IMAGE,
    policyPath: "/state/runtime/agentos.policy.json",
    cpus: 2,
    memory: "4Gi",
    startTimeoutMs: 180_000,
    callTimeoutMs: 30_000,
  });
  await driver.start();
  await driver.alive();
  await driver.stop();
  assert.deepEqual(
    calls.map((call) => call.timeoutMs),
    [180_000, 30_000, 30_000, 30_000],
  );
});

void test("a non-positive create budget is refused with a RangeError before any runner call", () => {
  const { runner, calls } = recordingRunner();
  assert.throws(
    () =>
      createOpenShellAgentOsDriver({
        runner,
        spawnRunner: () => RUNNING_CHILD,
        imageRef: IMAGE,
        policyPath: "/state/runtime/agentos.policy.json",
        cpus: 2,
        memory: "4Gi",
        startTimeoutMs: 0,
        callTimeoutMs: 30_000,
      }),
    RangeError,
  );
  assert.equal(calls.length, 0);
});
