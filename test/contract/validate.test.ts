import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validate,
  type SchemaInvalidError,
  type ValidationResult,
} from "../../src/contract/validate.js";
import { ERROR_CATALOGUE, RealmError } from "../../src/core/errors.js";
import type { State } from "../../src/core/states.js";

function value<T>(result: ValidationResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a value, got ${result.error.message}`);
  }
  return result.value;
}

function rejection(result: ValidationResult<unknown>): SchemaInvalidError {
  if (result.ok) {
    throw new Error("expected SCHEMA_INVALID, got a value");
  }
  return result.error;
}

const RECORD = {
  realmId: "realm-1",
  sessionId: "session-1",
  workspaceRoot: "/work/project",
  state: "active",
  controlSocketPath: "/run/realm/session-1.sock",
  containerId: null,
};

void test("a valid input returns the typed value", () => {
  const record = value(validate("sessionRecord", RECORD));
  const state: State = record.state;
  assert.equal(state, "active");
  assert.equal(record.realmId, "realm-1");
});

void test("an invalid input returns a RealmError with code SCHEMA_INVALID", () => {
  const result = validate("sessionRecord", { ...RECORD, state: "running" });
  assert.equal(result.ok, false);
  const error = rejection(result);
  assert.ok(error instanceof RealmError);
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.equal(error.retryable, false);
  assert.equal(error.reason, ERROR_CATALOGUE.SCHEMA_INVALID.reason);
});

void test("the detail names the offending key for a missing required field", () => {
  const record = Object.fromEntries(
    Object.entries(RECORD).filter(([name]) => name !== "sessionId"),
  );
  const error = rejection(validate("sessionRecord", record));
  assert.match(error.detail, /sessionId/);
  assert.match(error.message, /sessionId/);
});

void test("the detail names the offending path for a nested value", () => {
  const error = rejection(validate("tools", { write: { path: "../escape", content: "x" } }));
  assert.match(error.detail, /\/write\/path/);
  assert.match(error.message, /\/write\/path/);
});

void test("an unknown key is rejected with SCHEMA_INVALID and the key is named", () => {
  const error = rejection(validate("sessionRecord", { ...RECORD, token: "t" }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /token/);
});

void test("a non-object input names the root", () => {
  const error = rejection(validate("policy", "not-an-object"));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\(root\)/);
});

void test("an out-of-range value is rejected and the path is named", () => {
  const error = rejection(validate("policy", { toolQueueMs: 0 }));
  assert.match(error.detail, /\/toolQueueMs/);
});

void test("a function input returns SCHEMA_INVALID instead of throwing", () => {
  const SECRET = "sk-live-SECRET-4242-fn";
  const error = rejection(validate("policy", (): string => SECRET));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.equal(error.reason, ERROR_CATALOGUE.SCHEMA_INVALID.reason);
  for (const text of [error.message, error.detail, String(error), JSON.stringify(error)]) {
    assert.equal(text.includes(SECRET), false, `value leaked into: ${text}`);
  }
});

void test("a symbol nested in the input returns SCHEMA_INVALID and never echoes its description", () => {
  const SECRET = "sk-live-SECRET-4242-sym";
  const error = rejection(validate("policy", { mode: Symbol(SECRET) }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\S/);
  for (const text of [error.message, error.detail, String(error), JSON.stringify(error)]) {
    assert.equal(text.includes(SECRET), false, `value leaked into: ${text}`);
  }
});

void test("a secret-shaped offending value never appears in the error", () => {
  const SECRET = "sk-live-SECRET-4242-zq";
  const results = [
    validate("policy", { mode: SECRET }),
    validate("policy", { startupBudgetMs: SECRET }),
    validate("policy", { allowAll: SECRET }),
    validate("sessionRecord", { ...RECORD, state: SECRET }),
    validate("sessionRecord", { ...RECORD, containerId: { token: SECRET } }),
    validate("sessionRecord", { ...RECORD, token: SECRET }),
    validate("tools", { write: { path: `../${SECRET}`, content: "x" } }),
    validate("tools", { exec: { argv: [SECRET], shell: true, script: SECRET } }),
    validate("tools", { read: { path: "a.txt", maxBytes: SECRET } }),
  ];
  for (const result of results) {
    const error = rejection(result);
    assert.equal(error.code, "SCHEMA_INVALID");
    const serialized = JSON.stringify(error);
    for (const text of [error.message, error.detail, error.reason, serialized, String(error)]) {
      assert.equal(text.includes(SECRET), false, `value leaked into: ${text}`);
    }
  }
});
