import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExecutionService, ProbeResult } from "../../src/core/ports.js";
import { SessionExecution } from "../../src/runtime/session-execution.js";

// D-39 freezes ExecutionService. Its method names and arities are pinned here as a runtime shape, so a
// signature change fails this test. The record is typed as keyof ExecutionService, so a method added to
// or removed from the interface also fails the type check.
const FROZEN_ARITY: Readonly<Record<keyof ExecutionService, number>> = Object.freeze({
  create: 1,
  start: 2,
  probe: 2,
  stop: 2,
  destroy: 2,
});

// A fake that implements the interface. It records each call, so every parameter is used and the test can
// check that each frozen method is callable with its frozen arguments.
function recordingFake(calls: string[]): ExecutionService {
  return {
    create: (req) => {
      calls.push(`create ${req.idempotencyKey}`);
      return Promise.resolve({ containerId: "container" });
    },
    start: (containerId, sandbox) => {
      calls.push(`start ${containerId} ${sandbox}`);
      return Promise.resolve();
    },
    probe: (containerId, sandbox): Promise<ProbeResult> => {
      calls.push(`probe ${containerId} ${sandbox}`);
      return Promise.resolve("healthy");
    },
    stop: (containerId, sandbox) => {
      calls.push(`stop ${containerId} ${sandbox}`);
      return Promise.resolve();
    },
    destroy: (containerId, sandbox) => {
      calls.push(`destroy ${containerId} ${sandbox}`);
      return Promise.resolve();
    },
  };
}

void test("D-39: the ExecutionService fake exposes exactly the frozen method names, each with its frozen arity", async () => {
  const calls: string[] = [];
  const service = recordingFake(calls);
  assert.deepEqual(Object.keys(service).sort(), Object.keys(FROZEN_ARITY).sort());
  for (const name of Object.keys(FROZEN_ARITY) as (keyof ExecutionService)[]) {
    const method: unknown = Reflect.get(service, name);
    assert.equal(typeof method, "function", `${name} must be a function`);
    assert.equal(
      (method as (...args: unknown[]) => unknown).length,
      FROZEN_ARITY[name],
      `${name} must keep its frozen arity`,
    );
  }
  await service.create({ idempotencyKey: "key", workspaceRoot: "/workspace" });
  await service.start("container", "realm-key");
  await service.probe("container", "realm-key");
  await service.stop("container", "realm-key");
  await service.destroy("container", "realm-key");
  assert.deepEqual(calls, [
    "create key",
    "start container realm-key",
    "probe container realm-key",
    "stop container realm-key",
    "destroy container realm-key",
  ]);
});

void test("D-39: the production SessionExecution class carries the frozen method names and arities", () => {
  const prototype: object = SessionExecution.prototype;
  // The class also has private helpers, so only the frozen members are pinned here.
  for (const name of Object.keys(FROZEN_ARITY) as (keyof ExecutionService)[]) {
    const method: unknown = Reflect.get(prototype, name);
    assert.equal(typeof method, "function", `${name} must be a method`);
    assert.equal(
      (method as (...args: unknown[]) => unknown).length,
      FROZEN_ARITY[name],
      `${name} must keep its frozen arity`,
    );
  }
});
