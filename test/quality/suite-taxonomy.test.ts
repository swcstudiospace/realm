import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { podmanSkipReason, type PodmanProbe } from "../../src/runtime/podman-version.js";

// This file runs from dist/test/quality, so three levels up is the package root.
const TEST_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "test");

// D-45 category directories. Each must hold at least one *.test.ts file.
// Phase 5 adds the realm, mcp, acp, omp, surfaces, and docs suites (TOOL-05, OMP-01 to OMP-05).
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
  "tools",
  "realm",
  "mcp",
  "acp",
  "omp",
  "surfaces",
  "docs",
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
  {
    category: "tools",
    files: [
      "tools/dispatch.test.ts",
      "tools/queue-timeout.test.ts",
      "tools/workspace.test.ts",
    ],
  },
  { category: "realm composition", files: ["realm/compose.test.ts"] },
  { category: "mcp surface", files: ["mcp/server.test.ts"] },
  { category: "acp surface", files: ["acp/agent.test.ts"] },
  { category: "omp plugin", files: ["omp/plugin.test.ts"] },
  {
    category: "surface equivalence",
    files: ["surfaces/equivalence.test.ts"],
  },
  { category: "phase notes", files: ["docs/phase5-notes.test.ts"] },
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
  "runtime/egress.test.ts",
  "session/reap.test.ts",
  "tools/dispatch.test.ts",
  "tools/queue-timeout.test.ts",
  "tools/workspace.test.ts",
  "anda/handshake.test.ts",
  "anda/reconnect.test.ts",
  "anda/no-shim.test.ts",
  "anda/boundary-decision.test.ts",
  "realm/compose.test.ts",
  "mcp/server.test.ts",
  "acp/agent.test.ts",
  "omp/plugin.test.ts",
  "surfaces/equivalence.test.ts",
  "docs/phase5-notes.test.ts",
  "quality/suite-taxonomy.test.ts",
] as const;

function gateReasonOf(probe: PodmanProbe): string {
  const reason = podmanSkipReason(probe);
  if (reason === false) {
    throw new Error("the Podman probe was expected to produce a stated reason, but the gate allowed the suite");
  }
  return reason;
}

void test("every D-45 test file exists", () => {
  const missing = D45_FILES.filter((file) => !existsSync(join(TEST_DIR, file)));
  assert.deepEqual(missing, [], "D-45 test files missing from test/");
});

for (const category of CATEGORY_DIRS) {
  void test(`the ${category} category directory holds at least one *.test.ts file`, () => {
    const tests = readdirSync(join(TEST_DIR, category)).filter((name) => name.endsWith(".test.ts"));
    assert.ok(tests.length > 0, `test/${category} holds no *.test.ts file`);
  });
}

void test("the F-5 category map resolves every named category to test files that exist", () => {
  const missing = CATEGORY_MAP.flatMap(({ category, files }) =>
    files.filter((file) => !existsSync(join(TEST_DIR, file))).map((file) => `${category}: ${file}`),
  );
  assert.deepEqual(missing, [], "F-5 category map entries with no test file");
});

void test("the Podman gate maps a missing binary to a stated reason naming PODMAN_MISSING", () => {
  assert.match(gateReasonOf({ kind: "unavailable" }), /PODMAN_MISSING/);
});

void test("the Podman gate maps a Podman release below 5.x to a stated reason naming PODMAN_UNSUPPORTED_VERSION", () => {
  assert.match(
    gateReasonOf({ kind: "output", stdout: "podman version 4.9.3\n" }),
    /PODMAN_UNSUPPORTED_VERSION/,
  );
});

void test("the Podman gate lets the integration suite run on Podman 5.x", () => {
  assert.equal(podmanSkipReason({ kind: "output", stdout: "podman version 5.0.0\n" }), false);
});

void test("MCP and ACP contract tests are Phase 5 deliverables, not Phase 2 (Q-4; ROADMAP Phase 5 success criterion 5), so no MCP or ACP test file exists here", () => {
  const transport = readdirSync(TEST_DIR, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".test.ts"))
    .filter((name) => /(^|[-.])(mcp|acp)([-.]|$)/i.test(basename(name)))
    .filter((name) => name !== "cli/mcp-attach.test.ts");
  assert.deepEqual(transport, [], "no MCP or ACP test file may exist before Phase 5 other than the CLI-01 attach test");
});
