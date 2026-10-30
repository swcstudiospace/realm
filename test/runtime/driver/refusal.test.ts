// The refusal log's two membership guards. A value that bypasses the types, an RPC or a check outside its closed set, is refused as
// SCHEMA_INVALID and writes no line. Each test varies one value and keeps the other valid, so each guard is covered on its own.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError } from "../../../src/core/errors.js";
import { refusal, type DriverRpc, type RefusalCheck, type RefusalScope } from "../../../src/runtime/driver/refusal.js";

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
