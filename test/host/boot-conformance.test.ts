import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultManifestFor } from "../../src/host/manifest.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import type { HostBootHookFactory, HostId } from "../../src/host/types.js";
import {
  BOOT_CONFORMANCE_IDS,
  defineBootConformance,
  runBootConformance,
} from "../support/host-boot-conformance.js";
import { decorateDriver, driverFactoryOf, guardOpen, retryNoop, switchNoop, type HookPatch } from "../support/host-boot-mutants.js";
import {
  adoptsForeignHook,
  downOnShutdownHook,
  dropsRefusedClientHook,
  noBudgetHook,
  reattachAlwaysHook,
  reattachSameRootHook,
  referenceBootHook,
  repaintsDuplicatesHook,
  retriesTerminalHook,
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

// Each broken variant must fail exactly the cases that are meant to catch it. A case that cannot fail would show up here. A row
// with more than one case says why the second one fails too: it is the same defect seen by a second assertion.
const MUTANTS: readonly { readonly name: string; readonly hook: HostBootHookFactory; readonly failing: readonly string[] }[] = [
  { name: "noBudgetHook", hook: noBudgetHook, failing: ["C1-attach-budget"] },
  { name: "downOnShutdownHook", hook: downOnShutdownHook, failing: ["C6-shutdown-client-only"] },
  { name: "waveThroughHook", hook: waveThroughHook, failing: ["C5-guard-fail-closed"] },
  { name: "unboundedReattachHook", hook: unboundedReattachHook, failing: ["C8-reattach-bounded"] },
  { name: "repaintsDuplicatesHook", hook: repaintsDuplicatesHook, failing: ["C2-attach-ok-readback"] },
  { name: "dropsRefusedClientHook", hook: dropsRefusedClientHook, failing: ["C3-refused-up-retention"] },
  // C4 fails on the first status assertion (a terminal failure leaves the link connecting, not error). C8 fails too: its
  // terminal-code step ends with link reconnecting instead of failed, the same defect in the bounded-streak case.
  { name: "retriesTerminalHook", hook: retriesTerminalHook, failing: ["C4-terminal-attach-failure", "C8-reattach-bounded"] },
  // C1 fails because the retryable budget failure arms a re-attach wait, so a timer remains after the budget failure. C7 fails
  // because a lost link attaches again (roots.length is 2, not 1). Both are the same defect: re-attach on with the manifest off.
  { name: "reattachAlwaysHook", hook: reattachAlwaysHook, failing: ["C1-attach-budget", "C7-reattach-off-by-default"] },
  { name: "reattachSameRootHook", hook: reattachSameRootHook, failing: ["C9-switch-workspace"] },
  // C3 fails on its unrooted refusal (the client is adopted, so it is not closed). C9 fails on the foreign root and session
  // replies (the client is adopted, so it is not closed). Both are the same skipped root and session check.
  { name: "adoptsForeignHook", hook: adoptsForeignHook, failing: ["C3-refused-up-retention", "C9-switch-workspace"] },
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

// The same defects, seeded into the production driver by decorating it. The undecorated driver passes first, so a row cannot
// fail by a broken base.
const DECORATED_HOSTS: readonly HostId[] = ["claude", "kimi-code"];

const PATCHES: readonly { readonly name: string; readonly patch: HookPatch; readonly failing: readonly string[] }[] = [
  // The guard resolves undefined for every name: C5 sees a non-string name let through. C3 (a guard through the kept client),
  // C6 (a guard after shutdown) and C9 (a guard through the refused client) each assert that their guard call is blocked, so
  // the same defect fails them on that assertion.
  {
    name: "guardOpen",
    patch: guardOpen,
    failing: ["C3-refused-up-retention", "C5-guard-fail-closed", "C6-shutdown-client-only", "C9-switch-workspace"],
  },
  { name: "switchNoop", patch: switchNoop, failing: ["C9-switch-workspace"] },
  // C3 asserts that a retry releases the held client and attaches again, C4 that a retry performs exactly one new attach.
  { name: "retryNoop", patch: retryNoop, failing: ["C3-refused-up-retention", "C4-terminal-attach-failure"] },
];

for (const id of DECORATED_HOSTS) {
  const manifestOfHost = defaultManifestFor(id, "1.0.0");
  const driver = driverFactoryOf(HOST_RUNTIMES[id]);

  void test(`the undecorated production driver (${id}) passes every case`, async () => {
    const results = await runBootConformance(driver, manifestOfHost);
    assert.deepEqual(
      results.filter((result) => !result.ok).map((result) => `${result.id}: ${result.detail}`),
      [],
    );
  });

  for (const row of PATCHES) {
    void test(`${row.name} over the production driver (${id}) fails exactly ${row.failing.join(", ")}`, async () => {
      const results = await runBootConformance(decorateDriver(driver, row.patch), manifestOfHost);
      const failing = results.filter((result) => !result.ok);
      assert.deepEqual(
        failing.map((result) => result.id),
        row.failing,
        failing.map((result) => `${result.id}: ${result.detail}`).join("\n"),
      );
    });
  }
}
