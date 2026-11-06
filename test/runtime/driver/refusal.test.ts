// The refusal log's two membership guards. A value that bypasses the types, an RPC or a check outside its closed set, is refused as
// SCHEMA_INVALID and writes no line. Each test varies one value and keeps the other valid, so each guard is covered on its own.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError } from "../../../src/core/errors.js";
import { logAdoptionKept, logAdoptionRemoved, refusal, type DriverRpc, type RefusalCheck, type RefusalScope } from "../../../src/runtime/driver/refusal.js";
import type { AdoptionCause } from "../../../src/runtime/driver/lifecycle.js";

void test("PRD-ISO-02: a refusal for an RPC outside the driver's closed set throws SCHEMA_INVALID and writes no line", () => {
  const lines: string[] = [];
  const scope: RefusalScope = { rpc: "NotADriverRpc" as unknown as DriverRpc, log: (line) => lines.push(line) };
  assert.throws(
    () => refusal(scope, "create.sandbox"),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  assert.deepEqual(lines, []);
});

void test("PRD-ISO-02: a refusal for a check outside the refusal checks throws SCHEMA_INVALID and writes no line", () => {
  const lines: string[] = [];
  const scope: RefusalScope = { rpc: "CreateSandbox", log: (line) => lines.push(line) };
  assert.throws(
    () => refusal(scope, "create.not_a_check" as unknown as RefusalCheck),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  assert.deepEqual(lines, []);
});

void test("RES-02: an adoption line for a kept container names its id and nothing else", () => {
  const lines: string[] = [];
  logAdoptionKept((line) => lines.push(line), "c-realm-1");
  assert.deepEqual(lines, ["realm compute driver adoption adopted: container=c-realm-1"]);
});

void test("RES-02: an adoption line for a removed container names its id and the closed cause it was removed for", () => {
  const lines: string[] = [];
  logAdoptionRemoved((line) => lines.push(line), "c-realm-2", "no-record");
  logAdoptionRemoved((line) => lines.push(line), "c-realm-3", "cap-drop");
  assert.deepEqual(lines, [
    "realm compute driver adoption removed: container=c-realm-2 cause=no-record",
    "realm compute driver adoption removed: container=c-realm-3 cause=cap-drop",
  ]);
});

void test("RES-02: a removal cause outside the closed set throws SCHEMA_INVALID and writes no line", () => {
  const lines: string[] = [];
  assert.throws(
    () => {
      logAdoptionRemoved((line) => lines.push(line), "c-realm-4", "not-a-cause" as unknown as AdoptionCause);
    },
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  assert.deepEqual(lines, []);
});

void test("RES-02: a container id outside the id shape throws SCHEMA_INVALID and writes no line", () => {
  const lines: string[] = [];
  assert.throws(
    () => {
      logAdoptionKept((line) => lines.push(line), "c-realm-5\nforged=1");
    },
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  assert.deepEqual(lines, []);
});
