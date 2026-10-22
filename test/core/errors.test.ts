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
  "OPENSHELL_LABEL_AMBIGUOUS",
  "AGENTOS_CRASH_LOOP",
  "AGENTOS_NOT_CONFIGURED",
  "AGENTOS_STOP_FAILED",
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
  "AUDIT_WRITE_FAILED",
];

// D-10: retryable true for these codes. AUDIT_WRITE_FAILED is retryable because the tool call did not run.
const RETRYABLE_TRUE: readonly ErrorCode[] = [
  "REALM_NOT_ACTIVE",
  "STARTUP_BUDGET_EXCEEDED",
  "TOOL_TIMEOUT",
  "PODMAN_MACHINE_DOWN",
  "OPENSHELL_START_FAILED",
  "AGENTOS_CRASH_LOOP",
  "AGENTOS_STOP_FAILED",
  "ANDA_UNREACHABLE",
  "LOCK_CONFLICT",
  "WRITE_NOT_ATOMIC",
  "AUDIT_WRITE_FAILED",
];

// D-10, amended by plan 01-06 and the 2026-10-22 closure: retryable false for the other fourteen codes.
const RETRYABLE_FALSE: readonly ErrorCode[] = [
  "REALM_UNBOUND",
  "REALM_STOPPING",
  "REALM_INVALID_TRANSITION",
  "PODMAN_MISSING",
  "PODMAN_UNSUPPORTED_VERSION",
  "OPENSHELL_LABEL_AMBIGUOUS",
  "AGENTOS_NOT_CONFIGURED",
  "ANDA_VERSION_MISMATCH",
  "POLICY_DENIED",
  "PATH_ESCAPE",
  "CREDENTIAL_PATH_DENIED",
  "EGRESS_DENIED",
  "SHELL_NOT_ALLOWED",
  "SCHEMA_INVALID",
];

const sorted = (xs: readonly string[]): string[] => [...xs].sort();

test("the catalogue holds exactly the 25 codes: the 20 D-10 codes, PODMAN_UNSUPPORTED_VERSION, AUDIT_WRITE_FAILED, and the three 2026-10-22 closure codes", () => {
  assert.equal(EXPECTED_CODES.length, 25);
  assert.equal(ERROR_CODES.length, 25);
  assert.deepEqual(sorted(ERROR_CODES), sorted(EXPECTED_CODES));
});

test("the catalogue record has exactly the 25 codes and no others", () => {
  const keys = Object.keys(ERROR_CATALOGUE);
  assert.equal(keys.length, 25);
  assert.deepEqual(sorted(keys), sorted(EXPECTED_CODES));
  assert.equal(Object.isFrozen(ERROR_CATALOGUE), true);
});

test("the retryable true and false lists partition the catalogue", () => {
  assert.equal(RETRYABLE_TRUE.length, 11);
  assert.equal(RETRYABLE_FALSE.length, 14);
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
  assert.equal(Object.keys(ERROR_CATALOGUE).length, 25);
});

test("AUDIT_WRITE_FAILED has the approved reason and is retryable, because the tool call did not run", () => {
  assert.equal(
    ERROR_CATALOGUE.AUDIT_WRITE_FAILED.reason,
    "audit log could not be written; the tool call did not run",
  );
  assert.equal(ERROR_CATALOGUE.AUDIT_WRITE_FAILED.retryable, true);
});

test("AGENTOS_NOT_CONFIGURED, AGENTOS_STOP_FAILED, and OPENSHELL_LABEL_AMBIGUOUS have their approved reasons and retryable flags", () => {
  const notConfigured = makeRealmError("AGENTOS_NOT_CONFIGURED");
  assert.equal(
    notConfigured.reason,
    "AgentOS is not configured, so no sandbox session can start. Bind an AgentOS driver before starting a realm.",
  );
  assert.equal(notConfigured.retryable, false);
  const stopFailed = makeRealmError("AGENTOS_STOP_FAILED");
  assert.equal(
    stopFailed.reason,
    "AgentOS did not stop cleanly. Its sandbox container is stopped regardless, and the stop can be retried.",
  );
  assert.equal(stopFailed.retryable, true);
  const labelAmbiguous = makeRealmError("OPENSHELL_LABEL_AMBIGUOUS");
  assert.equal(
    labelAmbiguous.reason,
    "More than one container matches this session label, so the sandbox cannot be identified. No container was chosen.",
  );
  assert.equal(labelAmbiguous.retryable, false);
});

test("makeRealmError with a cause code carries it as causeCode and keeps the primary reason and retryable flag", () => {
  const err = makeRealmError("OPENSHELL_START_FAILED", "PODMAN_MACHINE_DOWN");
  assert.ok(err instanceof RealmError);
  assert.equal(err.code, "OPENSHELL_START_FAILED");
  assert.equal(err.causeCode, "PODMAN_MACHINE_DOWN");
  assert.equal(err.reason, ERROR_CATALOGUE.OPENSHELL_START_FAILED.reason);
  assert.equal(err.message, err.reason);
  assert.equal(err.retryable, true);
});

test("causeCode is absent when no cause is given, including an explicit undefined cause", () => {
  for (const err of [
    makeRealmError("REALM_UNBOUND"),
    makeRealmError("REALM_UNBOUND", undefined),
    new RealmError("REALM_UNBOUND"),
  ]) {
    assert.equal(Object.hasOwn(err, "causeCode"), false);
    assert.equal(err.causeCode, undefined);
  }
});

test("causeCode round-trips for every primary and cause code pair, and no reason contains a cause code", () => {
  for (const code of ERROR_CODES) {
    for (const cause of ERROR_CODES) {
      const err = makeRealmError(code, cause);
      assert.equal(err.code, code);
      assert.equal(err.causeCode, cause);
      assert.equal(err.reason, ERROR_CATALOGUE[code].reason);
      assert.equal(err.retryable, ERROR_CATALOGUE[code].retryable);
      assert.equal(err.message, err.reason);
      assert.equal(err.reason.includes(cause), false, `${code} reason must not contain cause ${cause}`);
    }
  }
});
