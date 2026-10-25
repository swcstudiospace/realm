// Boundary handles: a launch opens one handle, a second open of the same launch returns it, a different resource is refused,
// and a driver delete of the sandbox makes every handle of that sandbox fail without changing any other state.

import { test } from "node:test";
import assert from "node:assert/strict";
import { status } from "@grpc/grpc-js";
import { RealmError } from "../../../src/core/errors.js";
import { ComputeDriver } from "../../../src/runtime/driver/compute-driver.js";
import { BoundaryRegistry, type BoundaryOpening } from "../../../src/runtime/driver/isolation/boundary.js";
import { DriverStatusError } from "../../../src/runtime/driver/grpc-status.js";
import { FakeLibpod, FakeLifecycle, driverConfig } from "../driver/fakes.js";

// The driver's name for the sandbox differs from the gateway sandbox identity, as it does for a live launch.
const LAUNCH: BoundaryOpening = {
  sandboxName: "realm-session-1",
  gatewaySandboxId: "gateway-sandbox-a",
  generationId: "generation-1",
  sessionId: "session-1",
  resourceId: "resource-a",
};

function expectStatus(code: status): (error: unknown) => boolean {
  return (error: unknown) => error instanceof DriverStatusError && error.failure.code === code;
}

function expectCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof RealmError && error.code === code;
}

void test("PRD-ISO-01: reopening the same session and generation returns the same handle", () => {
  const registry = new BoundaryRegistry();
  const first = registry.open(LAUNCH);
  assert.equal(registry.open(LAUNCH), first);
  assert.equal(registry.size, 1);
  assert.equal(registry.resolve(first).resourceId, "resource-a");
});

void test("PRD-ISO-01: a new session or a new generation gets its own handle", () => {
  const registry = new BoundaryRegistry();
  const first = registry.open(LAUNCH);
  const otherSession = registry.open({ ...LAUNCH, sessionId: "session-2" });
  const otherGeneration = registry.open({ ...LAUNCH, generationId: "generation-2" });
  assert.notEqual(otherSession, first);
  assert.notEqual(otherGeneration, first);
  assert.equal(registry.size, 3);
});

void test("PRD-ISO-01: reopening the same launch with a different resource fails and leaves the binding as it was", () => {
  const registry = new BoundaryRegistry();
  const handle = registry.open(LAUNCH);
  assert.throws(
    () => registry.open({ ...LAUNCH, resourceId: "resource-b" }),
    expectStatus(status.FAILED_PRECONDITION),
  );
  assert.equal(registry.size, 1);
  assert.equal(registry.resolve(handle).resourceId, "resource-a");
});

void test("PRD-ISO-01: an empty identifier in an opening is refused as a schema error", () => {
  const registry = new BoundaryRegistry();
  assert.throws(() => registry.open({ ...LAUNCH, sessionId: "" }), expectCode("SCHEMA_INVALID"));
  assert.throws(() => registry.open({ ...LAUNCH, resourceId: "" }), expectCode("SCHEMA_INVALID"));
  assert.throws(() => registry.open({ ...LAUNCH, gatewaySandboxId: "" }), expectCode("SCHEMA_INVALID"));
  assert.equal(registry.size, 0);
});

void test("PRD-ISO-06: a handle that was never issued fails with NOT_FOUND and changes nothing", () => {
  const registry = new BoundaryRegistry();
  registry.open(LAUNCH);
  assert.throws(() => registry.resolve("not-a-handle"), expectStatus(status.NOT_FOUND));
  assert.equal(registry.size, 1);
});

void test("PRD-ISO-06: after DeleteSandbox a previously opened handle fails and no other state changes", async () => {
  const registry = new BoundaryRegistry();
  const libpod = new FakeLibpod();
  libpod.add("realm-session-1", true);
  const driver = new ComputeDriver(driverConfig(), { lifecycle: new FakeLifecycle(libpod), libpod, boundaries: registry });
  const stale = registry.open(LAUNCH);
  const sibling = registry.open({ ...LAUNCH, sandboxName: "agent-1" });

  assert.deepEqual(await driver.deleteSandbox({ name: "realm-session-1" }), { deleted: true });

  const before = registry.size;
  assert.throws(() => registry.resolve(stale), expectStatus(status.NOT_FOUND));
  assert.equal(registry.size, before);
  assert.equal(registry.resolve(sibling).sandboxName, "agent-1");
});

void test("PRD-ISO-06: DeleteSandbox invalidates the handles of a sandbox even when it has no container", async () => {
  const registry = new BoundaryRegistry();
  const libpod = new FakeLibpod();
  const driver = new ComputeDriver(driverConfig(), { lifecycle: new FakeLifecycle(libpod), libpod, boundaries: registry });
  const stale = registry.open(LAUNCH);

  assert.deepEqual(await driver.deleteSandbox({ name: "realm-session-1" }), { deleted: false });
  assert.throws(() => registry.resolve(stale), expectStatus(status.NOT_FOUND));
  assert.equal(registry.size, 0);
});

void test("PRD-ISO-06: handles are invalidated before the container work, so a refused container delete still leaves them invalid", async () => {
  const registry = new BoundaryRegistry();
  const libpod = new FakeLibpod();
  libpod.add("realm-session-1", true);
  const refusingLifecycle = {
    create: () => Promise.reject(new RealmError("REALM_INVALID_TRANSITION")),
    delete: () => Promise.reject(new RealmError("CLEANUP_FAILED")),
  };
  const driver = new ComputeDriver(driverConfig(), { lifecycle: refusingLifecycle, libpod, boundaries: registry });
  const stale = registry.open(LAUNCH);

  await assert.rejects(driver.deleteSandbox({ name: "realm-session-1" }), expectCode("CLEANUP_FAILED"));
  assert.throws(() => registry.resolve(stale), expectStatus(status.NOT_FOUND));
});

void test("PRD-ISO-06: a reopen after delete is a new handle and the old one stays invalid", async () => {
  const registry = new BoundaryRegistry();
  const libpod = new FakeLibpod();
  const driver = new ComputeDriver(driverConfig(), { lifecycle: new FakeLifecycle(libpod), libpod, boundaries: registry });
  const stale = registry.open(LAUNCH);

  await driver.deleteSandbox({ name: "realm-session-1" });
  const fresh = registry.open(LAUNCH);
  assert.notEqual(fresh, stale);
  assert.throws(() => registry.resolve(stale), expectStatus(status.NOT_FOUND));
  assert.equal(registry.resolve(fresh).resourceId, "resource-a");
});
