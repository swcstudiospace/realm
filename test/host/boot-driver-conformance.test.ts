import assert from "node:assert/strict";
import { test } from "node:test";
import { bootHookOf } from "../../src/host/boot-driver.js";
import { defaultManifestFor } from "../../src/host/manifest.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import type { HostBootHookFactory, HostId } from "../../src/host/types.js";
import { BOOT_CONFORMANCE_IDS, defineBootConformance, runBootConformance } from "../support/host-boot-conformance.js";

// A proven host and a config-only host: the driver is host-neutral, so both run the same nine cases.
const HOSTS: readonly HostId[] = ["claude", "kimi-code"];

function factoryOf(id: HostId): HostBootHookFactory {
  const factory = bootHookOf(HOST_RUNTIMES[id]);
  assert.ok(factory !== null, `${id} has a production boot driver`);
  return factory;
}

for (const id of HOSTS) {
  defineBootConformance(`boot driver (${id})`, (deps, manifest) => factoryOf(id)(deps, manifest), defaultManifestFor(id, "1.0.0"));
}

void test("the production driver passes all nine conformance cases as data", async () => {
  for (const id of HOSTS) {
    const results = await runBootConformance(factoryOf(id), defaultManifestFor(id, "1.0.0"));
    assert.equal(results.length, 9);
    assert.deepEqual(results.map((result) => result.id), [...BOOT_CONFORMANCE_IDS]);
    assert.deepEqual(results.filter((result) => !result.ok), [], id);
  }
});
