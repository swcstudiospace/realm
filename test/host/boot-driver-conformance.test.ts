import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultManifestFor } from "../../src/host/manifest.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { HOST_IDS, type HostId } from "../../src/host/types.js";
import { BOOT_CONFORMANCE_IDS, defineBootConformance, runBootConformance } from "../support/host-boot-conformance.js";
import { driverFactoryOf } from "../support/host-boot-mutants.js";

// Every mcp-config host, taken from the table and not typed: the driver is host-neutral, so each runs the same nine cases.
const HOSTS: readonly HostId[] = HOST_IDS.filter((id) => HOST_RUNTIMES[id].integration === "mcp-config");

void test("the driver runs for the 21 mcp-config hosts, every host of the table but omp", () => {
  assert.equal(HOSTS.length, 21);
  assert.deepEqual(
    HOST_IDS.filter((id) => !HOSTS.includes(id)),
    ["omp"],
  );
});

for (const id of HOSTS) {
  defineBootConformance(`boot driver (${id})`, driverFactoryOf(HOST_RUNTIMES[id]), defaultManifestFor(id, "1.0.0"));
}

void test("the production driver passes all nine conformance cases as data", async () => {
  for (const id of HOSTS) {
    const results = await runBootConformance(driverFactoryOf(HOST_RUNTIMES[id]), defaultManifestFor(id, "1.0.0"));
    assert.equal(results.length, 9, id);
    assert.deepEqual(results.map((result) => result.id), [...BOOT_CONFORMANCE_IDS], id);
    assert.deepEqual(results.filter((result) => !result.ok), [], id);
  }
});
