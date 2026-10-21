import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validate,
  sessionRecordStateEnum,
  type SchemaInvalidError,
  type ValidationResult,
} from "../../src/contract/validate.js";
import { STATES } from "../../src/core/states.js";

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

function without(key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(RECORD).filter(([name]) => name !== key));
}

const RECORD = {
  realmId: "realm-1",
  sessionId: "session-1",
  workspaceRoot: "/work/project",
  state: "unbound",
  controlSocketPath: "/run/realm/session-1.sock",
  containerId: null,
};

test("a record with containerId null is accepted (container not yet created)", () => {
  assert.deepEqual(value(validate("sessionRecord", RECORD)), RECORD);
});

test("a record with a containerId string is accepted", () => {
  const record = { ...RECORD, containerId: "c-123" };
  assert.deepEqual(value(validate("sessionRecord", record)), record);
});

test("a record without containerId is accepted because the field is optional", () => {
  assert.equal(value(validate("sessionRecord", without("containerId"))).realmId, "realm-1");
});

test("a non-string containerId is rejected and named", () => {
  const error = rejection(validate("sessionRecord", { ...RECORD, containerId: 7 }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/containerId/);
});

test("a record missing sessionId is rejected and the key is named", () => {
  const error = rejection(validate("sessionRecord", without("sessionId")));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /sessionId/);
});

for (const key of ["realmId", "sessionId", "workspaceRoot", "state", "controlSocketPath"]) {
  test(`a record missing required ${key} is rejected`, () => {
    const error = rejection(validate("sessionRecord", without(key)));
    assert.match(error.detail, new RegExp(key));
  });
}

test("an empty object is rejected because required fields exist", () => {
  const error = rejection(validate("sessionRecord", {}));
  assert.equal(error.code, "SCHEMA_INVALID");
});

test("an empty realmId is rejected", () => {
  const error = rejection(validate("sessionRecord", { ...RECORD, realmId: "" }));
  assert.match(error.detail, /\/realmId/);
});

test("every one of the six D-11 states is accepted", () => {
  for (const state of STATES) {
    assert.equal(value(validate("sessionRecord", { ...RECORD, state })).state, state);
  }
});

test("the session-record state enum holds exactly the STATES set, in both directions", () => {
  const enumStates = new Set<string>(sessionRecordStateEnum());
  const statesSet = new Set<string>(STATES);
  for (const state of enumStates) {
    assert.ok(statesSet.has(state), `enum state ${state} is not in STATES`);
  }
  for (const state of statesSet) {
    assert.ok(enumStates.has(state), `STATES state ${state} is not in the enum`);
  }
  assert.equal(enumStates.size, statesSet.size);
});

test("the state enum rejects near-miss spellings of the six states and names the key", () => {
  for (const near of ["Unbound", "unbound ", "stop", "", "running"]) {
    const error = rejection(validate("sessionRecord", { ...RECORD, state: near }));
    assert.equal(error.code, "SCHEMA_INVALID");
    assert.match(error.detail, /\/state/);
  }
});

test("a state outside the six is rejected and named", () => {
  const error = rejection(validate("sessionRecord", { ...RECORD, state: "running" }));
  assert.match(error.detail, /\/state/);
});

for (const key of ["token", "secret", "env", "schemaVersion"]) {
  test(`an unknown ${key} key is rejected and named`, () => {
    const error = rejection(validate("sessionRecord", { ...RECORD, [key]: "x" }));
    assert.equal(error.code, "SCHEMA_INVALID");
    assert.match(error.detail, new RegExp(key));
  });
}
