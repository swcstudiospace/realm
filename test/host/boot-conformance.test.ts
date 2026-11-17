import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultManifestFor } from "../../src/host/manifest.js";
import type { HostBootHookFactory } from "../../src/host/types.js";
import {
  BOOT_CONFORMANCE_IDS,
  defineBootConformance,
  runBootConformance,
} from "../support/host-boot-conformance.js";
import {
  downOnShutdownHook,
  noBudgetHook,
  referenceBootHook,
  unboundedReattachHook,
  waveThroughHook,
} from "../support/reference-boot-hook.js";

const manifest = defaultManifestFor("omp", "1.0.0");

// The reference hook passes each case as its own node:test case.
defineBootConformance("reference hook", referenceBootHook, manifest);

void test("the harness defines C1 to C9", () => {
  assert.deepEqual(
    BOOT_CONFORMANCE_IDS.map((id) => id.slice(0, 2)),
    ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9"],
  );
});

void test("the reference hook passes every case", async () => {
  const results = await runBootConformance(referenceBootHook, manifest);
  assert.deepEqual(
    results.filter((result) => !result.ok),
    [],
  );
  assert.equal(results.length, BOOT_CONFORMANCE_IDS.length);
});

// Each broken variant must fail exactly the case that is meant to catch it. A case that cannot fail would show up here.
const MUTANTS: readonly { readonly name: string; readonly hook: HostBootHookFactory; readonly failing: readonly string[] }[] = [
  { name: "noBudgetHook", hook: noBudgetHook, failing: ["C1-attach-budget"] },
  { name: "downOnShutdownHook", hook: downOnShutdownHook, failing: ["C6-shutdown-client-only"] },
  { name: "waveThroughHook", hook: waveThroughHook, failing: ["C5-guard-fail-closed"] },
  { name: "unboundedReattachHook", hook: unboundedReattachHook, failing: ["C8-reattach-bounded"] },
];

for (const mutant of MUTANTS) {
  void test(`${mutant.name} fails exactly ${mutant.failing.join(", ")}`, async () => {
    const results = await runBootConformance(mutant.hook, manifest);
    const failing = results.filter((result) => !result.ok);
    assert.deepEqual(
      failing.map((result) => result.id),
      mutant.failing,
      failing.map((result) => `${result.id}: ${result.detail}`).join("\n"),
    );
  });
}
