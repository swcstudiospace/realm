import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ServiceDefinition } from "@grpc/grpc-js";
import { loadComputeDriverService, protoIncludeDirectory } from "../../../src/runtime/driver/compute-driver.js";

const RPCS = [
  "AuthenticateSandbox",
  "CreateSandbox",
  "DeleteSandbox",
  "DeleteWorkspace",
  "EnsureWorkspace",
  "GetCapabilities",
  "GetSandbox",
  "ListSandboxes",
  "StartSandbox",
  "StopSandbox",
  "ValidateSandboxCreate",
  "WatchSandboxes",
];

function methodNamed(service: ServiceDefinition, name: string): ServiceDefinition[string] {
  const definition = service[name];
  if (definition === undefined) {
    throw new Error(`the service has no ${name} method`);
  }
  return definition;
}

void test("PRD-LIB-01: the pinned loader resolves the vendored ComputeDriver service with all twelve RPCs", () => {
  const service = loadComputeDriverService();
  assert.deepEqual(Object.keys(service).sort(), RPCS);
  const watch = methodNamed(service, "WatchSandboxes");
  assert.equal(watch.responseStream, true);
  assert.equal(watch.path, "/openshell.compute.v1.ComputeDriver/WatchSandboxes");
});

// PROVENANCE.md records a SHA-256 for every vendored file. The bytes on disk must still match those digests.
void test("PRD-LIB-01: each vendored proto matches the SHA-256 recorded in PROVENANCE.md", () => {
  const directory = protoIncludeDirectory();
  const provenance = readFileSync(join(directory, "PROVENANCE.md"), "utf8");
  const rows = [...provenance.matchAll(/^\| `([a-z_]+\.proto)` \|.*`([0-9a-f]{64})` \|$/gm)];
  assert.equal(rows.length, 7);
  for (const [, file = "", digest = ""] of rows) {
    const actual = createHash("sha256")
      .update(readFileSync(join(directory, file)))
      .digest("hex");
    assert.equal(actual, digest, `${file} digest`);
  }
});
