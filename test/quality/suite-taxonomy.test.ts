import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { podmanSkipReason, type PodmanProbe } from "../integration/podman-version.js";

// This file runs from dist/test/quality, so three levels up is the package root.
const TEST_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "test");

// D-45 category directories. Each must hold at least one *.test.ts file.
const CATEGORY_DIRS = [
  "core",
  "fs",
  "session",
  "audit",
  "lifecycle",
  "contract",
  "doctor",
  "integration",
] as const;

// F-5 category map: each named category is carried by the files listed under it.
const CATEGORY_MAP: ReadonlyArray<{ readonly category: string; readonly files: readonly string[] }> = [
  { category: "state-machine", files: ["core/state-machine.test.ts"] },
  { category: "path and symlink", files: ["fs/canonicalize.test.ts", "fs/toctou.test.ts"] },
  {
    category: "schema rejection",
    files: ["contract/tools.schema.test.ts", "contract/tool-input-gate.test.ts"],
  },
  { category: "audit redaction", files: ["audit/redaction.test.ts"] },
  { category: "integration", files: ["integration/podman-gate.test.ts"] },
];

// Every D-45 test file. Requirement citations are searched only in these files.
const D45_FILES = [
  "core/state-machine.test.ts",
  "core/status.test.ts",
  "core/events.test.ts",
  "core/policy.test.ts",
  "core/fail-closed.test.ts",
  "core/timeout.test.ts",
  "fs/glob.test.ts",
  "fs/canonicalize.test.ts",
  "fs/toctou.test.ts",
  "fs/deny-credentials.test.ts",
  "fs/lock.test.ts",
  "fs/atomic-write.test.ts",
  "fs/write.test.ts",
  "fs/read-list.test.ts",
  "session/store.test.ts",
  "audit/redaction.test.ts",
  "audit/log.test.ts",
  "contract/tool-input-gate.test.ts",
  "contract/exec-policy.test.ts",
  "lifecycle/controller.test.ts",
  "lifecycle/idempotent.test.ts",
  "lifecycle/no-host-env.test.ts",
  "doctor/checks.test.ts",
  "quality/suite-taxonomy.test.ts",
] as const;

// The 16 Phase 2 requirement IDs (plan 02-06 must_haves; matches .planning/REQUIREMENTS.md).
const PHASE_2_REQUIREMENT_IDS = [
  "CORE-01",
  "CORE-02",
  "CORE-03",
  "CORE-04",
  "CORE-06",
  "FS-01",
  "FS-02",
  "FS-03",
  "FS-04",
  "FS-05",
  "RT-07",
  "TOOL-01",
  "TOOL-02",
  "AUD-01",
  "AUD-02",
  "QUAL-02",
] as const;

function gateReasonOf(probe: PodmanProbe): string {
  const reason = podmanSkipReason(probe);
  if (reason === false) {
    throw new Error("the Podman probe was expected to produce a stated reason, but the gate allowed the suite");
  }
  return reason;
}

test("every D-45 test file exists", () => {
  const missing = D45_FILES.filter((file) => !existsSync(join(TEST_DIR, file)));
  assert.deepEqual(missing, [], "D-45 test files missing from test/");
});

for (const category of CATEGORY_DIRS) {
  test(`the ${category} category directory holds at least one *.test.ts file`, () => {
    const tests = readdirSync(join(TEST_DIR, category)).filter((name) => name.endsWith(".test.ts"));
    assert.ok(tests.length > 0, `test/${category} holds no *.test.ts file`);
  });
}

test("the F-5 category map resolves every named category to test files that exist", () => {
  const missing = CATEGORY_MAP.flatMap(({ category, files }) =>
    files.filter((file) => !existsSync(join(TEST_DIR, file))).map((file) => `${category}: ${file}`),
  );
  assert.deepEqual(missing, [], "F-5 category map entries with no test file");
});

test("the Podman gate maps a missing binary to a stated reason naming PODMAN_MISSING", () => {
  assert.match(gateReasonOf({ kind: "unavailable" }), /PODMAN_MISSING/);
});

test("the Podman gate maps a Podman release below 5.x to a stated reason naming PODMAN_UNSUPPORTED_VERSION", () => {
  assert.match(
    gateReasonOf({ kind: "output", stdout: "podman version 4.9.3\n" }),
    /PODMAN_UNSUPPORTED_VERSION/,
  );
});

test("the Podman gate lets the integration suite run on Podman 5.x", () => {
  assert.equal(podmanSkipReason({ kind: "output", stdout: "podman version 5.0.0\n" }), false);
});

test("the integration gate test applies the Podman mapping to its own probe and keeps the suite gated on it", () => {
  const gate = readFileSync(join(TEST_DIR, "integration/podman-gate.test.ts"), "utf8");
  assert.ok(gate.includes("podmanSkipReason(probe)"), "podman-gate.test.ts must apply podmanSkipReason to its probe");
  assert.ok(gate.includes("{ skip: gate }"), "podman-gate.test.ts must pass the gate to the suite");
});

test("MCP and ACP contract tests are Phase 5 deliverables, not Phase 2 (Q-4; ROADMAP Phase 5 success criterion 5), so no MCP or ACP test file exists here", () => {
  const transport = readdirSync(TEST_DIR, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".test.ts"))
    .filter((name) => /(^|[-.])(mcp|acp)([-.]|$)/i.test(basename(name)));
  assert.deepEqual(transport, [], "no MCP or ACP test file may exist before Phase 5");
});

test("all 16 Phase 2 requirement IDs are cited by at least one D-45 test file (QUAL-02 taxonomy and category part)", () => {
  const uncovered = PHASE_2_REQUIREMENT_IDS.filter(
    (id) => !D45_FILES.some((file) => readFileSync(join(TEST_DIR, file), "utf8").includes(id)),
  );
  assert.deepEqual(uncovered, [], `Phase 2 requirement IDs cited by no D-45 test file: ${uncovered.join(", ")}`);
});
