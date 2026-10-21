import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { podmanSkipReason, type PodmanProbe } from "../../src/runtime/podman-version.js";

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
  "runtime",
  "anda",
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
  {
    category: "runtime boundary",
    files: [
      "runtime/podman-version.test.ts",
      "runtime/podman-probe.test.ts",
      "runtime/config.test.ts",
      "runtime/openshell-argv.test.ts",
      "runtime/openshell-policy.test.ts",
      "runtime/openshell-routing.test.ts",
      "runtime/session-execution.test.ts",
      "runtime/down-sweep.test.ts",
      "runtime/hardening.test.ts",
      "runtime/agentos-supervisor.test.ts",
      "runtime/libpod-client.test.ts",
    ],
  },
  {
    category: "anda bridge",
    files: ["anda/handshake.test.ts", "anda/reconnect.test.ts", "anda/no-shim.test.ts", "anda/boundary-decision.test.ts"],
  },
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
  "doctor/runtime-checks.test.ts",
  "core/backoff.test.ts",
  "lifecycle/bridge-states.test.ts",
  "lifecycle/mutation-gate.test.ts",
  "runtime/podman-version.test.ts",
  "runtime/podman-probe.test.ts",
  "runtime/config.test.ts",
  "runtime/openshell-argv.test.ts",
  "runtime/openshell-policy.test.ts",
  "runtime/openshell-routing.test.ts",
  "runtime/session-execution.test.ts",
  "runtime/down-sweep.test.ts",
  "runtime/hardening.test.ts",
  "runtime/agentos-supervisor.test.ts",
  "runtime/libpod-client.test.ts",
  "runtime/decision-note.test.ts",
  "anda/handshake.test.ts",
  "anda/reconnect.test.ts",
  "anda/no-shim.test.ts",
  "anda/boundary-decision.test.ts",
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

// The ten Phase 3 requirement IDs (plan 03-10 must_haves; matches .planning/REQUIREMENTS.md).
const PHASE_3_REQUIREMENT_IDS = [
  "CORE-05",
  "RT-01",
  "RT-02",
  "RT-03",
  "RT-04",
  "RT-09",
  "ANDA-01",
  "ANDA-02",
  "ANDA-03",
  "ANDA-04",
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

// Only a test title counts as coverage. A requirement ID in a comment, an assertion message or a file name
// does not. A title counts when the ID is in its leading ID list: the words before its first colon, while
// they are IDs, "and", or commas. So "RT-03, RT-04: ..." covers both RT-03 and RT-04.
const TEST_TITLE_START = /\btest\(\s*["'`]([^\n]*)/g;

function leadingIdsOf(title: string): readonly string[] {
  const head = title.split(":")[0] ?? "";
  const lead = /^(?:[A-Z]+-\d+|and|[\s,])+/.exec(head)?.[0] ?? "";
  return lead.match(/[A-Z]+-\d+/g) ?? [];
}

function titleLeadingIds(source: string): Set<string> {
  const ids = new Set<string>();
  for (const match of source.matchAll(TEST_TITLE_START)) {
    for (const id of leadingIdsOf(match[1] ?? "")) {
      ids.add(id);
    }
  }
  return ids;
}

test("the title check counts an ID only when a title leads with it, so a comment or a mid-title mention does not count", () => {
  const source = [
    "// RT-09 is discussed in this comment only",
    'test("the sweep removes RT-09 containers", () => {});',
    'test("RT-03, RT-04: the leading list counts both", () => {});',
  ].join("\n");
  assert.deepEqual([...titleLeadingIds(source)].sort(), ["RT-03", "RT-04"]);
});

test("all 10 Phase 3 requirement IDs lead the title of a test in a named D-45 test file (QUAL-02, Phase 3)", () => {
  const citing = D45_FILES.filter((file) => file !== "quality/suite-taxonomy.test.ts");
  const leading = new Set<string>();
  for (const file of citing) {
    for (const id of titleLeadingIds(readFileSync(join(TEST_DIR, file), "utf8"))) {
      leading.add(id);
    }
  }
  const uncovered = PHASE_3_REQUIREMENT_IDS.filter((id) => !leading.has(id));
  assert.deepEqual(uncovered, [], `Phase 3 requirement IDs named by no D-45 test title: ${uncovered.join(", ")}`);
});
