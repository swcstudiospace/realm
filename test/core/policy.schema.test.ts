import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validate,
  type SchemaInvalidError,
  type ValidationResult,
} from "../../src/contract/validate.js";

function value<T>(result: ValidationResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a value, got ${result.error.message}`);
  }
  return result.value;
}

function rejection<T>(result: ValidationResult<T>): SchemaInvalidError {
  if (result.ok) {
    throw new Error("expected SCHEMA_INVALID, got a value");
  }
  return result.error;
}

// D-15 defaults, pinned as literals so the test does not read the schema under test.
const DEFAULTS = {
  mode: "fail-closed",
  workspaceRoots: [],
  credentialAllow: [],
  egressAllow: [],
  shellEnabled: false,
  startupBudgetMs: 200000,
  toolQueueMs: 2000,
};

void test("an empty object resolves to the D-15 defaults", () => {
  assert.deepEqual(value(validate("policy", {})), DEFAULTS);
});

void test("defaults are fresh per call and the caller's input is not mutated", () => {
  const input: Record<string, unknown> = {};
  const first = value(validate("policy", input));
  (first.workspaceRoots as string[]).push("/leaked");
  assert.deepEqual(value(validate("policy", {})).workspaceRoots, []);
  assert.deepEqual(input, {});
});

void test("D4: the schema default mode is fail-closed, and advisory still loads as advisory when named", () => {
  assert.equal(value(validate("policy", {})).mode, "fail-closed");
  assert.equal(value(validate("policy", { workspaceRoots: ["/ws"] })).mode, "fail-closed");
  assert.equal(value(validate("policy", { mode: "advisory" })).mode, "advisory");
});

void test("mode fail-closed is accepted", () => {
  assert.equal(value(validate("policy", { mode: "fail-closed" })).mode, "fail-closed");
});

void test("any other mode string is rejected and the key is named", () => {
  const error = rejection(validate("policy", { mode: "strict" }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/mode/);
});

void test("startupBudgetMs of zero is rejected as non-positive", () => {
  const error = rejection(validate("policy", { startupBudgetMs: 0 }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/startupBudgetMs/);
});

void test("toolQueueMs of zero is rejected as non-positive", () => {
  const error = rejection(validate("policy", { toolQueueMs: 0 }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/toolQueueMs/);
});

void test("a positive integer budget is accepted", () => {
  const policy = value(validate("policy", { startupBudgetMs: 1, toolQueueMs: 1 }));
  assert.equal(policy.startupBudgetMs, 1);
  assert.equal(policy.toolQueueMs, 1);
});

void test("an unknown key is rejected and named", () => {
  const error = rejection(validate("policy", { allowAll: true }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/allowAll/);
});

void test("egressAllow accepts host and port objects", () => {
  const policy = value(
    validate("policy", { egressAllow: [{ host: "api.example.com", port: 443 }] }),
  );
  assert.deepEqual(policy.egressAllow, [{ host: "api.example.com", port: 443 }]);
});

void test("egressAllow rejects an unknown key inside a rule", () => {
  const error = rejection(
    validate("policy", { egressAllow: [{ host: "a.example", port: 1, scheme: "https" }] }),
  );
  assert.match(error.detail, /scheme/);
});

void test("egressAllow rejects a port outside 1 to 65535", () => {
  const error = rejection(validate("policy", { egressAllow: [{ host: "a.example", port: 70000 }] }));
  assert.match(error.detail, /\/port/);
});
