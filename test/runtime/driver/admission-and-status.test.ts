import { test } from "node:test";
import assert from "node:assert/strict";
import { status } from "@grpc/grpc-js";
import { ERROR_CATALOGUE, ERROR_CODES, makeRealmError, type ErrorCode } from "../../../src/core/errors.js";
import { DRIVER_ADMISSION_ACKNOWLEDGEMENT } from "../../../src/runtime/driver/admission.js";
import {
  DRIVER_STATUS,
  DriverStatusError,
  driverFailureOf,
  driverNotFound,
  driverUnimplemented,
  toServerError,
} from "../../../src/runtime/driver/grpc-status.js";

// The default policy of the OpenShell 0.1.5 build, as its acknowledgement serialises it (DriverAdmissionConfig::default).
const EXPECTED_DEFAULT_POLICY = {
  allow_driver_config: false,
  resource_admission: {
    enabled: true,
    required_labels: {
      "openshell.ai/sandbox-attachable": "true",
      "openshell.ai/sandbox-attachable-workspace": "${workspace}",
    },
  },
};

void test("PRD-GW-03: the admission acknowledgement is the exact value captured from the OpenShell 0.1.5 build", () => {
  assert.equal(
    DRIVER_ADMISSION_ACKNOWLEDGEMENT,
    'v1:{"allow_driver_config":false,"resource_admission":{"enabled":true,"required_labels":{"openshell.ai/sandbox-attachable":"true","openshell.ai/sandbox-attachable-workspace":"${workspace}"}}}',
  );
});

void test("PRD-GW-03: the acknowledgement is the versioned form of the default policy", () => {
  assert.ok(DRIVER_ADMISSION_ACKNOWLEDGEMENT.startsWith("v1:"));
  assert.deepEqual(JSON.parse(DRIVER_ADMISSION_ACKNOWLEDGEMENT.slice("v1:".length)), EXPECTED_DEFAULT_POLICY);
});

void test("the status table covers every catalogue code with a valid gRPC status", () => {
  const valid = new Set<number>(Object.values(status).filter((value): value is number => typeof value === "number"));
  for (const code of ERROR_CODES) {
    assert.ok(valid.has(DRIVER_STATUS[code]), `${code} maps to a gRPC status`);
  }
});

void test("a catalogue error keeps its catalogue reason as the details, and maps through the table", () => {
  for (const code of ERROR_CODES) {
    const failure = driverFailureOf(makeRealmError(code));
    assert.equal(failure.code, DRIVER_STATUS[code], code);
    assert.equal(failure.details, ERROR_CATALOGUE[code].reason, code);
  }
});

void test("the mapping of the codes the driver returns most often", () => {
  const expected: readonly [ErrorCode, status][] = [
    ["SCHEMA_INVALID", status.INVALID_ARGUMENT],
    ["SANDBOX_NAME_IN_USE", status.ALREADY_EXISTS],
    ["REALM_INVALID_TRANSITION", status.FAILED_PRECONDITION],
    ["REALM_NOT_ACTIVE", status.UNAVAILABLE],
    ["LOCK_CONFLICT", status.ABORTED],
    ["CLEANUP_FAILED", status.INTERNAL],
  ];
  for (const [code, grpc] of expected) {
    assert.equal(DRIVER_STATUS[code], grpc, code);
  }
});

void test("an error with no catalogue code is INTERNAL with a fixed text that copies no raw message", () => {
  const failure = driverFailureOf(new Error("/var/run/podman/podman.sock: connect refused for sandbox secret-token"));
  assert.equal(failure.code, status.INTERNAL);
  assert.equal(failure.details, "internal driver error");
  assert.ok(!failure.details.includes("secret-token"));
});

void test("a driver-decided status keeps its own gRPC code and details", () => {
  assert.deepEqual(driverFailureOf(new DriverStatusError(driverNotFound("sandbox not found"))), {
    code: status.NOT_FOUND,
    details: "sandbox not found",
  });
  assert.equal(driverFailureOf(new DriverStatusError(driverUnimplemented("nope"))).code, status.UNIMPLEMENTED);
});

void test("a wire error carries the gRPC code and details", () => {
  const error = toServerError({ code: status.FAILED_PRECONDITION, details: "refused" });
  assert.equal(error.code, status.FAILED_PRECONDITION);
  assert.equal(error.details, "refused");
  assert.equal(error.message, "refused");
});

