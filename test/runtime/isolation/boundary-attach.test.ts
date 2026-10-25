// The Bound and Attached lifecycle of a boundary handle (phase 9.5, PRD-ISO-01). A refused attach changes nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { status } from "@grpc/grpc-js";
import { DriverStatusError } from "../../../src/runtime/driver/grpc-status.js";
import { BoundaryRegistry, type BoundaryOpening } from "../../../src/runtime/driver/isolation/boundary.js";

const LAUNCH: BoundaryOpening = {
  sandboxName: "realm-session-1",
  gatewaySandboxId: "gateway-sandbox-a",
  generationId: "generation-1",
  sessionId: "session-1",
  resourceId: "resource-1",
};

function failedPrecondition(error: unknown): boolean {
  return error instanceof DriverStatusError && error.failure.code === status.FAILED_PRECONDITION;
}

function notFound(error: unknown): boolean {
  return error instanceof DriverStatusError && error.failure.code === status.NOT_FOUND;
}

void test("PRD-ISO-01: a newly opened boundary is Bound, and markAttached moves it to Attached", () => {
  const registry = new BoundaryRegistry();
  const handle = registry.open(LAUNCH);
  assert.equal(registry.resolve(handle).lifecycle, "Bound");
  const attached = registry.markAttached(handle);
  assert.equal(attached.lifecycle, "Attached");
  assert.equal(attached.handle, handle);
  assert.equal(registry.resolve(handle).lifecycle, "Attached");
});

void test("PRD-ISO-01: a second markAttached on the same boundary is refused and changes nothing", () => {
  const registry = new BoundaryRegistry();
  const handle = registry.open(LAUNCH);
  registry.markAttached(handle);
  assert.throws(() => registry.markAttached(handle), failedPrecondition);
  assert.equal(registry.resolve(handle).lifecycle, "Attached");
});

void test("PRD-ISO-01: a second boundary of the same sandbox generation cannot attach while the first is Attached", () => {
  const registry = new BoundaryRegistry();
  const first = registry.open(LAUNCH);
  const second = registry.open({ ...LAUNCH, sessionId: "session-2" });
  registry.markAttached(first);
  assert.throws(() => registry.markAttached(second), failedPrecondition);
  assert.equal(registry.resolve(second).lifecycle, "Bound");
});

void test("PRD-ISO-01: another generation of the same sandbox may attach while the first generation is Attached", () => {
  const registry = new BoundaryRegistry();
  const first = registry.open(LAUNCH);
  const next = registry.open({ ...LAUNCH, generationId: "generation-2" });
  registry.markAttached(first);
  assert.equal(registry.markAttached(next).lifecycle, "Attached");
});

void test("PRD-ISO-06: an invalidated handle cannot be attached, and the registry keeps no trace of it", () => {
  const registry = new BoundaryRegistry();
  const handle = registry.open(LAUNCH);
  registry.invalidateAll(LAUNCH.sandboxName);
  assert.throws(() => registry.markAttached(handle), notFound);
  assert.equal(registry.size, 0);
});

void test("PRD-ISO-01: after an Attached boundary is invalidated, its generation can attach again under a new handle", () => {
  const registry = new BoundaryRegistry();
  const handle = registry.open(LAUNCH);
  registry.markAttached(handle);
  registry.invalidateAll(LAUNCH.sandboxName);
  const reopened = registry.open(LAUNCH);
  assert.notEqual(reopened, handle);
  assert.equal(registry.markAttached(reopened).lifecycle, "Attached");
});

void test("PRD-ISO-06: invalidation is keyed by the driver's sandbox name, not by the gateway identity the bearer carries", () => {
  const registry = new BoundaryRegistry();
  const handle = registry.open(LAUNCH);
  assert.equal(registry.invalidateAll(LAUNCH.gatewaySandboxId), 0);
  assert.equal(registry.resolve(handle).lifecycle, "Bound");
  assert.equal(registry.invalidateAll(LAUNCH.sandboxName), 1);
});
