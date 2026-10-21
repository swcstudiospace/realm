import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ERROR_CATALOGUE,
  ERROR_CODES,
  makeRealmError,
  RealmError,
  type ErrorCode,
} from "../../src/core/errors.js";

// The D-10 catalogue, pinned as literals so the test does not read the table under test.
const EXPECTED_CODES: readonly ErrorCode[] = [
  "REALM_UNBOUND",
  "REALM_NOT_ACTIVE",
  "REALM_STOPPING",
  "REALM_INVALID_TRANSITION",
  "STARTUP_BUDGET_EXCEEDED",
  "TOOL_TIMEOUT",
  "PODMAN_MISSING",
  "PODMAN_MACHINE_DOWN",
  "PODMAN_UNSUPPORTED_VERSION",
  "OPENSHELL_START_FAILED",
  "AGENTOS_CRASH_LOOP",
  "ANDA_UNREACHABLE",
  "ANDA_VERSION_MISMATCH",
  "POLICY_DENIED",
  "PATH_ESCAPE",
  "CREDENTIAL_PATH_DENIED",
  "LOCK_CONFLICT",
  "WRITE_NOT_ATOMIC",
  "EGRESS_DENIED",
  "SHELL_NOT_ALLOWED",
  "SCHEMA_INVALID",
];

// D-10: retryable true exactly for these nine codes.
const RETRYABLE_TRUE: readonly ErrorCode[] = [
  "REALM_NOT_ACTIVE",
  "STARTUP_BUDGET_EXCEEDED",
  "TOOL_TIMEOUT",
  "PODMAN_MACHINE_DOWN",
  "OPENSHELL_START_FAILED",
  "AGENTOS_CRASH_LOOP",
  "ANDA_UNREACHABLE",
  "LOCK_CONFLICT",
  "WRITE_NOT_ATOMIC",
];

// D-10, amended by plan 01-06: retryable false for the other twelve codes.
const RETRYABLE_FALSE: readonly ErrorCode[] = [
  "REALM_UNBOUND",
  "REALM_STOPPING",
  "REALM_INVALID_TRANSITION",
  "PODMAN_MISSING",
  "PODMAN_UNSUPPORTED_VERSION",
  "ANDA_VERSION_MISMATCH",
  "POLICY_DENIED",
  "PATH_ESCAPE",
  "CREDENTIAL_PATH_DENIED",
  "EGRESS_DENIED",
  "SHELL_NOT_ALLOWED",
  "SCHEMA_INVALID",
];

const sorted = (xs: readonly string[]): string[] => [...xs].sort();

test("the catalogue holds exactly the 21 codes: the 20 D-10 codes plus PODMAN_UNSUPPORTED_VERSION", () => {
  assert.equal(EXPECTED_CODES.length, 21);
  assert.equal(ERROR_CODES.length, 21);
  assert.deepEqual(sorted(ERROR_CODES), sorted(EXPECTED_CODES));
});

test("the catalogue record has exactly the 21 codes and no others", () => {
  const keys = Object.keys(ERROR_CATALOGUE);
  assert.equal(keys.length, 21);
  assert.deepEqual(sorted(keys), sorted(EXPECTED_CODES));
  assert.equal(Object.isFrozen(ERROR_CATALOGUE), true);
});

test("the retryable true and false lists partition the catalogue", () => {
  assert.equal(RETRYABLE_TRUE.length, 9);
  assert.equal(RETRYABLE_FALSE.length, 12);
  assert.deepEqual(sorted([...RETRYABLE_TRUE, ...RETRYABLE_FALSE]), sorted(EXPECTED_CODES));
});

test("the retryable values produced by the catalogue match the D-10 lists exactly", () => {
  const actualTrue = ERROR_CODES.filter((code) => makeRealmError(code).retryable);
  const actualFalse = ERROR_CODES.filter((code) => !makeRealmError(code).retryable);
  assert.deepEqual(sorted(actualTrue), sorted(RETRYABLE_TRUE));
  assert.deepEqual(sorted(actualFalse), sorted(RETRYABLE_FALSE));
});

for (const code of EXPECTED_CODES) {
  const retryable = RETRYABLE_TRUE.includes(code);
  test(`${code} builds a RealmError with its code, a non-empty reason, and retryable=${retryable}`, () => {
    const err = makeRealmError(code);
    assert.ok(err instanceof RealmError);
    assert.ok(err instanceof Error);
    assert.equal(err.name, "RealmError");
    assert.equal(err.code, code);
    assert.ok(err.reason.trim().length > 0, `${code} reason must be non-empty`);
    assert.equal(err.reason, ERROR_CATALOGUE[code].reason);
    assert.equal(err.message, err.reason);
    assert.equal(err.retryable, retryable);
  });
}

test("ERROR_CODES is frozen at runtime", () => {
  assert.equal(Object.isFrozen(ERROR_CODES), true);
});

test("every catalogue entry is frozen, not only the record that holds it", () => {
  for (const code of ERROR_CODES) {
    assert.equal(Object.isFrozen(ERROR_CATALOGUE[code]), true, `${code} entry must be frozen`);
  }
});

test("editing a catalogue entry in place throws a TypeError", () => {
  const entry: { retryable: boolean } = ERROR_CATALOGUE.REALM_UNBOUND;
  assert.throws(() => {
    entry.retryable = true;
  }, TypeError);
  assert.equal(makeRealmError("REALM_UNBOUND").retryable, false);
});

test("replacing or adding a catalogue key throws a TypeError", () => {
  const record = ERROR_CATALOGUE as Record<string, unknown>;
  assert.throws(() => {
    record.REALM_UNBOUND = { reason: "changed", retryable: true };
  }, TypeError);
  assert.throws(() => {
    record.NOT_A_CODE = { reason: "added", retryable: false };
  }, TypeError);
  assert.equal(Object.keys(ERROR_CATALOGUE).length, 21);
});
