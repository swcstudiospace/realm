import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpenShellAgentOsDriver } from "../../src/runtime/agentos-driver.js";
import { realmSandboxName, type OpenShellRunner, type SandboxCreateRequest } from "../../src/runtime/openshell.js";

const SESSION = "daemon";
const NAME = realmSandboxName(SESSION);
const POLICY = "/var/lib/realm/policy.json";
const IMAGE = `localhost/realm-agentos@sha256:${"a".repeat(64)}`;

function request(): SandboxCreateRequest {
  return { sessionId: SESSION, policyPath: POLICY, cpus: 1, memory: "1Gi", imageRef: IMAGE };
}

// A runner that answers each `sandbox list` with the next scripted listing (the last one repeats), exits listExit for it, and
// answers the create with createExit. Every argv is recorded in order.
function scriptedRunner(listings: readonly string[], listExit = 0, createExit = 0) {
  const calls: string[][] = [];
  let listed = 0;
  const runner: OpenShellRunner = (argv) => {
    calls.push([...argv]);
    if (argv[2] === "list") {
      const stdout = listings[Math.min(listed, listings.length - 1)] ?? "";
      listed += 1;
      return Promise.resolve({ exitCode: listExit, stdout, stderr: "" });
    }
    return Promise.resolve({ exitCode: createExit, stdout: "", stderr: "" });
  };
  return { runner, calls };
}

function driverWith(runner: OpenShellRunner, nameReleaseMs: number) {
  return createOpenShellAgentOsDriver({
    runner,
    spawnRunner: () => {
      throw new Error("create never spawns a runner");
    },
    startTimeoutMs: 1000,
    callTimeoutMs: 1000,
    nameReleaseMs,
  });
}

const isCreate = (argv: readonly string[]): boolean => argv[2] === "create";

void test("create runs when the gateway does not list the session's sandbox name", async () => {
  const { runner, calls } = scriptedRunner([`realm-other\n`]);
  await driverWith(runner, 50).create(request(), 5000);
  assert.equal(calls.filter(isCreate).length, 1, "the create must run once");
});

void test("create waits for the gateway to release the name, then runs", async () => {
  const { runner, calls } = scriptedRunner([`${NAME}\n`, ""]);
  await driverWith(runner, 5000).create(request(), 10000);
  const createAt = calls.findIndex(isCreate);
  assert.equal(calls.slice(0, createAt).filter((argv) => argv[2] === "list").length, 2, "the name must be listed until it is released");
  assert.equal(calls.filter(isCreate).length, 1, "the create must run once, after the release");
});

void test("create is refused, without running, when the gateway still lists the name at the bound", async () => {
  const { runner, calls } = scriptedRunner([`${NAME}\n`]);
  await assert.rejects(driverWith(runner, 50).create(request(), 5000), { code: "OPENSHELL_START_FAILED" });
  assert.equal(calls.filter(isCreate).length, 0, "no create may run while the name is held");
});

void test("create is refused, without running, when the gateway's sandbox list cannot be read", async () => {
  const { runner, calls } = scriptedRunner([""], 1);
  await assert.rejects(driverWith(runner, 5000).create(request(), 5000), { code: "OPENSHELL_START_FAILED" });
  assert.equal(calls.filter(isCreate).length, 0, "no create may run when the name cannot be checked");
});
