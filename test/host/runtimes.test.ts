import { test } from "node:test";
import assert from "node:assert/strict";
import { SchemaInvalidError } from "../../src/contract/validate.js";
import { HOST_ALIASES, HOST_RUNTIMES, recipePending, resolveHomes, resolveHostId } from "../../src/host/runtimes.js";
import { HOST_IDS, type HostEnv, type HostId, type HostTier } from "../../src/host/types.js";

// Pinned from 21-DISCOVERY.md (GSD Core `next`, commit 69d604e, 2026-11-16).
const EXPECTED_IDS = [
  "omp", "claude", "opencode", "kilo", "codex", "copilot", "antigravity", "cursor", "windsurf", "augment",
  "trae", "qwen", "hermes", "codebuddy", "cline", "kimi", "kimi-code", "zcode", "pi",
];
const EXPECTED_FLAGS = [
  "--claude", "--opencode", "--kilo", "--codex", "--copilot", "--antigravity", "--cursor", "--windsurf", "--augment",
  "--trae", "--qwen", "--hermes", "--codebuddy", "--cline", "--kimi", "--kimi-code", "--zcode", "--pi",
];
const EXPECTED_TIERS: Record<HostId, HostTier> = {
  omp: "reference", claude: "proven", opencode: "proven", codex: "proven", kimi: "proven",
  kilo: "config-only", copilot: "config-only", antigravity: "config-only", cursor: "config-only",
  windsurf: "config-only", augment: "config-only", trae: "config-only", qwen: "config-only",
  hermes: "config-only", codebuddy: "config-only", cline: "config-only", "kimi-code": "config-only",
  zcode: "config-only", pi: "config-only",
};
const EXPECTED_HOMES: Record<HostId, readonly (readonly [string, "config" | "skills"])[]> = {
  omp: [], antigravity: [],
  claude: [[".claude", "config"]],
  opencode: [[".config/opencode", "config"]],
  kilo: [[".config/kilo", "config"], [".kilo", "config"]],
  codex: [[".codex", "config"]],
  copilot: [[".copilot", "config"]],
  cursor: [[".cursor", "config"]],
  windsurf: [[".codeium/windsurf", "config"]],
  augment: [[".augment", "config"]],
  trae: [[".trae", "config"]],
  qwen: [[".qwen", "config"]],
  hermes: [[".hermes", "config"]],
  codebuddy: [[".codebuddy", "config"]],
  cline: [[".cline", "config"]],
  kimi: [[".config/agents", "skills"], [".kimi", "config"]],
  "kimi-code": [[".kimi-code", "config"]],
  zcode: [[".zcode", "config"]],
  pi: [[".pi/agent", "config"]],
};

const env = (over: Record<string, string> = {}, home = "/home/u"): HostEnv => ({ home, env: over, pathDirs: [] });

void test("HOST_IDS lists the 19 hosts in order", () => {
  assert.deepEqual([...HOST_IDS], EXPECTED_IDS);
  assert.deepEqual(Object.keys(HOST_RUNTIMES).sort(), [...EXPECTED_IDS].sort());
});

void test("the 18 non-Omp flags match the GSD Core installer flags; no gemini or vscode", () => {
  const flags = HOST_IDS.filter((id) => id !== "omp").map((id) => HOST_RUNTIMES[id].flag);
  assert.deepEqual(new Set(flags), new Set(EXPECTED_FLAGS));
  assert.equal(flags.length, 18);
  assert.equal(resolveHostId("gemini"), undefined);
  assert.equal(resolveHostId("vscode"), undefined);
});

void test("resolveHostId resolves ids and aliases only, case-sensitively", () => {
  assert.equal(resolveHostId("devin-desktop"), "windsurf");
  assert.equal(resolveHostId("claude"), "claude");
  assert.equal(resolveHostId("--claude"), undefined);
  assert.equal(resolveHostId("Claude"), undefined);
  assert.equal(resolveHostId("__proto__"), undefined);
  assert.equal(resolveHostId("constructor"), undefined);
  assert.equal(resolveHostId("toString"), undefined);
});

void test("aliases never collide with another id or alias", () => {
  const seen = new Set<string>(HOST_IDS);
  for (const id of HOST_IDS) {
    for (const alias of HOST_RUNTIMES[id].aliases) {
      assert.equal(seen.has(alias), false, alias);
      seen.add(alias);
    }
  }
  assert.deepEqual({ ...HOST_ALIASES }, { "devin-desktop": "windsurf" });
});

void test("tiers match the pinned map", () => {
  for (const id of HOST_IDS) {
    assert.equal(HOST_RUNTIMES[id].tier, EXPECTED_TIERS[id], id);
  }
});

void test("homes, verification, override and binaries are pinned", () => {
  for (const id of HOST_IDS) {
    const entry = HOST_RUNTIMES[id];
    assert.deepEqual(entry.homes.map((h) => [h.rel, h.role]), EXPECTED_HOMES[id], id);
    assert.equal(entry.homeVerified, id !== "antigravity" && id !== "omp", id);
    assert.equal(entry.envOverride, id === "claude" ? "CLAUDE_CONFIG_DIR" : null, id);
    const binaries = id === "omp" ? ["omp"] : id === "claude" ? ["claude"] : [];
    assert.deepEqual([...entry.binaries], binaries, id);
    assert.equal(entry.integration, id === "omp" ? "extension" : "mcp-config", id);
  }
});

void test("every home rel is a relative POSIX path without traversal", () => {
  for (const id of HOST_IDS) {
    for (const { rel } of HOST_RUNTIMES[id].homes) {
      assert.equal(rel.startsWith("/"), false);
      assert.equal(rel.startsWith("~"), false);
      assert.equal(rel.includes("\\"), false);
      assert.equal(rel.split("/").includes(".."), false);
    }
  }
});

void test("Phase 21 invariant: every recipe is null", () => {
  for (const id of HOST_IDS) {
    assert.equal(HOST_RUNTIMES[id].recipe, null);
    assert.equal(recipePending(id), true);
  }
});

void test("the table is deeply frozen", () => {
  assert.ok(Object.isFrozen(HOST_RUNTIMES));
  const kimi = HOST_RUNTIMES.kimi;
  assert.ok(Object.isFrozen(kimi) && Object.isFrozen(kimi.homes) && Object.isFrozen(kimi.homes[0]) && Object.isFrozen(kimi.aliases));
});

void test("resolveHomes joins the home with each candidate", () => {
  assert.deepEqual(resolveHomes(HOST_RUNTIMES.kilo, env()), ["/home/u/.config/kilo", "/home/u/.kilo"]);
  assert.deepEqual(resolveHomes(HOST_RUNTIMES.antigravity, env()), []);
});

void test("an absolute CLAUDE_CONFIG_DIR replaces the claude default", () => {
  assert.deepEqual(resolveHomes(HOST_RUNTIMES.claude, env({ CLAUDE_CONFIG_DIR: "/opt/claude" })), ["/opt/claude"]);
  assert.deepEqual(resolveHomes(HOST_RUNTIMES.claude, env()), ["/home/u/.claude"]);
});

void test("relative or empty overrides and relative homes are SCHEMA_INVALID", () => {
  for (const bad of [() => resolveHomes(HOST_RUNTIMES.claude, env({ CLAUDE_CONFIG_DIR: "rel" })),
    () => resolveHomes(HOST_RUNTIMES.claude, env({ CLAUDE_CONFIG_DIR: "" })),
    () => resolveHomes(HOST_RUNTIMES.codex, env({}, "home/u"))]) {
    assert.throws(bad, (error: unknown) => error instanceof SchemaInvalidError && error.code === "SCHEMA_INVALID");
  }
});
