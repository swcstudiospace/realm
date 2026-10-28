import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError } from "../../src/core/errors.js";
import { buildCreateArgv } from "../../src/runtime/openshell.js";

const BASE = {
  sessionId: "agentos",
  policyPath: "/realm-state/agentos/policy.json",
  cpus: 2,
  imageRef: "example.invalid/realm-sandbox@sha256:0000000000000000000000000000000000000000000000000000000000000000",
};

void test("the memory quantities the OpenShell CLI accepts pass, and a lowercase gigabyte suffix it rejects is refused", () => {
  for (const memory of ["4Gi", "512Mi", "8G", "1073741824"]) {
    assert.ok(buildCreateArgv({ ...BASE, memory }).includes(memory), `${memory} must be accepted`);
  }
  for (const memory of ["4g", "4gi", "4b"]) {
    assert.throws(
      () => buildCreateArgv({ ...BASE, memory }),
      (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
      `${memory} must be refused`,
    );
  }
});
