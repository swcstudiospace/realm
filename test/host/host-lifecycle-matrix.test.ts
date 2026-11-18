// TEST-HOST-03: the generic lifecycle contract on every real row, in fixture roots under the realpath of os.tmpdir(). The 19 rows with a
// recipe run one scenario built from the row (dry run, install, receipt, audit chain, log, reinstall, neighbor survival, byte-exact
// restoration, override variable); the three rows without a recipe run the refusal scenario. A planted secret must reach no sink. The
// seeded-defect table then injects one defect at a time through the adapter's own seams and must trip exactly the named code, on a
// JSON host (cursor) and a TOML host (codex), so a defect is not an artifact of one format.
//
// Fixtures and fakes only: no host runs, no network, no process environment and no real home are touched. This proves the installer
// engine on fixtures, not a real host's rewrite behavior (that is the gated T2 tier; GAP-26-01).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { appendAudit } from "../../src/audit/log.js";
import { HOST_IDS, type HostId } from "../../src/host/types.js";
import { LIFECYCLE_VIOLATIONS, leakingLogger, lifecycleContract, type LifecycleOptions, type LifecycleViolation } from "../support/host-contract.js";
import { MARKER } from "../support/host-recipe-suite.js";

for (const id of HOST_IDS) {
  void test(`TEST-HOST-03 ${id}: the lifecycle contract holds on the real row`, async (t) => {
    const violations = await lifecycleContract(t, id);
    assert.equal(violations.join(","), "", `${id} violates: ${violations.join(",")}`);
  });
}

interface LifecycleDefect {
  readonly name: string;
  readonly expected: readonly LifecycleViolation[];
  // A fresh set of injected collaborators per run, so a defect that fires once fires once per run.
  readonly make: () => LifecycleOptions;
}

const DEFECTS: readonly LifecycleDefect[] = [
  {
    name: "an audit function that appends the planted secret to the path",
    expected: ["audit-secret"],
    make: (): LifecycleOptions => ({
      audit: (stateDir, input) => {
        appendAudit(stateDir, { ...input, path: `${input.path ?? ""}${MARKER}` });
      },
    }),
  },
  {
    name: "a logger that adds the planted secret as a field of every call",
    expected: ["log-secret"],
    make: (): LifecycleOptions => ({ logger: leakingLogger }),
  },
  {
    name: "a stage hook that removes the seeded neighbor while an uninstall runs",
    expected: ["unowned-removed"],
    make: (): LifecycleOptions => {
      let fired = false;
      return {
        stageHook: (stage, _path, scene) => {
          if (fired || stage !== "after-change" || scene.op !== "uninstall" || scene.rig !== "neighbor") {
            return;
          }
          fired = true;
          writeFileSync(scene.recipeFile, readFileSync(scene.recipeFile, "utf8").replaceAll(MARKER, ""));
        },
      };
    },
  },
  {
    name: "a stage hook that writes a file in the fixture root beside the home while an install runs",
    expected: ["outside-write"],
    make: (): LifecycleOptions => {
      let fired = false;
      return {
        stageHook: (stage, _path, scene) => {
          if (fired || stage !== "after-change" || scene.op !== "install") {
            return;
          }
          fired = true;
          writeFileSync(join(scene.root, "beside-home.txt"), "written beside the home\n");
        },
      };
    },
  },
  {
    name: "a stage hook that leaves a stray file next to the recipe file while an uninstall runs",
    expected: ["uninstall-not-restoring"],
    make: (): LifecycleOptions => {
      let fired = false;
      return {
        stageHook: (stage, _path, scene) => {
          if (fired || stage !== "after-change" || scene.op !== "uninstall" || scene.rig !== "restore") {
            return;
          }
          fired = true;
          writeFileSync(join(dirname(scene.recipeFile), "stray.tmp"), "left behind\n");
        },
      };
    },
  },
];

// A JSON host and a TOML host.
const DEFECT_HOSTS: readonly HostId[] = ["cursor", "codex"];

for (const item of DEFECTS) {
  for (const id of DEFECT_HOSTS) {
    void test(`TEST-HOST-03 defect on ${id}: ${item.name}`, async (t) => {
      const found = await lifecycleContract(t, id, item.make());
      assert.equal(found.join(","), item.expected.join(","), `${id}: ${item.name}: found ${found.join(",") || "no violation"}`);
    });
  }
}

void test("TEST-HOST-03: the violation list is closed and every seeded defect names a closed code", () => {
  assert.equal(LIFECYCLE_VIOLATIONS.length, 14);
  assert.equal(new Set(LIFECYCLE_VIOLATIONS).size, 14);
  for (const item of DEFECTS) {
    for (const code of item.expected) {
      assert.ok(LIFECYCLE_VIOLATIONS.includes(code), `${item.name}: ${code} is a closed code`);
    }
  }
});
