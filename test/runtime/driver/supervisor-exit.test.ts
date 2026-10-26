// The host supervisor's exit (phase 9.5, wave 3, D). A supervisor that exits before the sandbox is Ready refuses the create. One
// that exits while the sandbox runs stops the container and reports the sandbox failed. An exit the driver caused is not a failure.
// A real child process reports its own exit. No test reads source text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRealmError, RealmError, type ErrorCode } from "../../../src/core/errors.js";
import { ComputeDriver } from "../../../src/runtime/driver/compute-driver.js";
import { spawnSupervisor } from "../../../src/runtime/driver/supervisor.js";
import { FakeLibpod, FakeRuntime, diskLifecycle, driverConfig, validSandbox } from "./fakes.js";

const SANDBOX = "realm-session-1";

function codeIs(code: ErrorCode): (error: unknown) => boolean {
  return (error) => error instanceof RealmError && error.code === code;
}

// Lets every microtask an exit queued run before the test looks at the result: a macrotask turn runs after them all.
function settle(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

void test("a supervisor that exits before Ready refuses the create, and its container is stopped and removed (phase 9.5, D)", async () => {
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const lifecycle = await diskLifecycle(config, libpod);
  const runtime = new FakeRuntime();
  runtime.exitOnSpawn = true;
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime });
  await assert.rejects(driver.createSandbox(validSandbox()), codeIs("OPENSHELL_START_FAILED"));
  const [supervisor] = runtime.supervisors;
  assert.ok(supervisor !== undefined);
  assert.equal(supervisor.stops, 1, "the exited supervisor is stopped once by the discard");
  assert.deepEqual(lifecycle.deletes, [SANDBOX]);
  assert.equal(libpod.containers.has(SANDBOX), false);
});

void test("a supervisor that exits while the sandbox runs stops its container and reports the sandbox failed (phase 9.5, D)", async () => {
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const lifecycle = await diskLifecycle(config, libpod);
  const runtime = new FakeRuntime();
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime });
  await driver.createSandbox(validSandbox());
  const [supervisor] = runtime.supervisors;
  assert.ok(supervisor !== undefined);
  supervisor.exit();
  await settle();
  assert.deepEqual(lifecycle.stops, [SANDBOX]);
  assert.equal(supervisor.stops, 0, "the driver does not stop a supervisor that has already exited");
  const { sandbox } = await driver.getSandbox({ name: SANDBOX });
  const ready = sandbox.status.conditions.find((condition) => condition.type === "Ready");
  assert.ok(ready);
  assert.equal(ready.status, "False");
  assert.equal(ready.reason, "supervisor-exited");
});

void test("a supervisor that exits and whose container stop fails still leaves the sandbox reported failed (phase 9.5, D)", async () => {
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const disk = await diskLifecycle(config, libpod);
  const lifecycle = {
    ...disk,
    stop: (): Promise<void> => Promise.reject(new Error("stop refused")),
  };
  const runtime = new FakeRuntime();
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime });
  await driver.createSandbox(validSandbox());
  const [supervisor] = runtime.supervisors;
  assert.ok(supervisor !== undefined);
  supervisor.exit();
  await settle();
  const { sandbox } = await driver.getSandbox({ name: SANDBOX });
  const ready = sandbox.status.conditions.find((condition) => condition.type === "Ready");
  assert.ok(ready);
  assert.equal(ready.status, "False");
  assert.equal(ready.reason, "supervisor-exited");
});

void test("a delete ends the supervisor without a failure: the lifecycle is not asked to stop the container (phase 9.5, D)", async () => {
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const lifecycle = await diskLifecycle(config, libpod);
  const runtime = new FakeRuntime();
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime });
  await driver.createSandbox(validSandbox());
  assert.deepEqual(await driver.deleteSandbox({ name: SANDBOX }), { deleted: true });
  await settle();
  assert.deepEqual(lifecycle.stops, []);
  assert.deepEqual(lifecycle.deletes, [SANDBOX]);
});

void test("a delete that fails after its supervisor was stopped leaves the sandbox reported Ready False, not Ready with no supervisor (phase 9.5, B2)", async () => {
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const disk = await diskLifecycle(config, libpod);
  const lifecycle = { ...disk, delete: (): Promise<void> => Promise.reject(makeRealmError("CLEANUP_FAILED")) };
  const runtime = new FakeRuntime();
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime });
  await driver.createSandbox(validSandbox());
  await assert.rejects(driver.deleteSandbox({ name: SANDBOX }), codeIs("CLEANUP_FAILED"));
  const [supervisor] = runtime.supervisors;
  assert.equal(supervisor?.stops, 1, "the supervisor was stopped before the delete failed");
  const { sandbox } = await driver.getSandbox({ name: SANDBOX });
  const ready = sandbox.status.conditions.find((condition) => condition.type === "Ready");
  assert.ok(ready);
  assert.equal(ready.status, "False");
  assert.equal(ready.reason, "supervisor-exited");
});

void test("a real supervisor process that exits is observed: exited settles and hasExited turns true (phase 9.5, D)", async () => {
  const handle = await spawnSupervisor({ binary: process.execPath, args: ["-e", "process.exit(3)"], env: {} });
  await handle.exited;
  assert.equal(handle.hasExited(), true);
  await handle.stop();
});

void test("a real supervisor process that is running is not reported exited until stop ends it (phase 9.5, D)", async () => {
  const handle = await spawnSupervisor({ binary: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], env: {} });
  assert.equal(handle.hasExited(), false);
  await handle.stop();
  await handle.exited;
  assert.equal(handle.hasExited(), true);
});
