import { test } from "node:test";
import assert from "node:assert/strict";
import { SchemaInvalidError } from "../../src/contract/validate.js";
import { isSafeRelPath } from "../../src/host/recipe.js";
import { HOST_ALIASES, HOST_RUNTIMES, recipePending, resolveHomes, resolveHomeSpecs, resolveHostId } from "../../src/host/runtimes.js";
import { HOST_IDS, type HostEnv, type HostId, type HostRuntimeEntry, type HostTier } from "../../src/host/types.js";
import { fixtureEntry } from "../support/fixture-host.js";

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
  antigravity: [],
  omp: [[".omp/agent", "config"]],
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
    assert.equal(entry.homeVerified, id !== "antigravity", id);
    assert.equal(entry.envOverride, id === "claude" ? "CLAUDE_CONFIG_DIR" : id === "omp" ? "PI_CODING_AGENT_DIR" : null, id);
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

void test("Phase 22: only omp has a recipe, a bundle copy of adapters/omp into extensions/realm", () => {
  const omp = HOST_RUNTIMES.omp;
  assert.deepEqual(omp.recipe, { kind: "bundle-copy", source: "omp", dest: "extensions/realm" });
  assert.deepEqual(omp.conflicts, [".omp/plugins/node_modules/agent-realm"]);
  assert.equal(omp.tier, "reference");
  assert.equal(omp.integration, "extension");
  assert.equal(omp.homeVerified, true);
  assert.ok(Object.isFrozen(omp));
  assert.ok(Object.isFrozen(omp.recipe));
  assert.ok(Object.isFrozen(omp.conflicts));
  for (const id of HOST_IDS) {
    assert.equal(recipePending(id), id !== "omp", id);
    assert.equal(HOST_RUNTIMES[id].recipe === null, id !== "omp", id);
    assert.equal(HOST_RUNTIMES[id].conflicts === undefined, id !== "omp", id);
  }
});

void test("every conflicts entry in the table is a safe relative path", () => {
  for (const id of HOST_IDS) {
    for (const path of HOST_RUNTIMES[id].conflicts ?? []) {
      assert.equal(isSafeRelPath(path), true, `${id}: ${path}`);
    }
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

void test("the omp home defaults to <home>/.omp/agent and an absolute PI_CODING_AGENT_DIR replaces it", () => {
  assert.deepEqual(resolveHomes(HOST_RUNTIMES.omp, env()), ["/home/u/.omp/agent"]);
  assert.deepEqual(resolveHomes(HOST_RUNTIMES.omp, env({ PI_CODING_AGENT_DIR: "/opt/omp-agent" })), ["/opt/omp-agent"]);
});

void test("an empty or relative PI_CODING_AGENT_DIR is SCHEMA_INVALID", () => {
  for (const bad of ["", "rel/agent"]) {
    assert.throws(
      () => resolveHomes(HOST_RUNTIMES.omp, env({ PI_CODING_AGENT_DIR: bad })),
      (error: unknown) => error instanceof SchemaInvalidError && error.code === "SCHEMA_INVALID",
    );
  }
});

// ---- Phase 24: home roles, one pairs-based resolver, envBase ----------------------------------------------------

const invalid = (error: unknown): boolean => error instanceof SchemaInvalidError && error.code === "SCHEMA_INVALID";

// What resolveHomes returned before roles existed: an absolute override replaced the whole list.
function legacyHomes(entry: HostRuntimeEntry, over: HostEnv): readonly string[] {
  if (entry.envOverride !== null) {
    const value = over.env[entry.envOverride];
    if (value !== undefined) {
      return [value];
    }
  }
  return entry.homes.map((home) => `${over.home}/${home.rel}`);
}

function threeHomes(extra: Partial<HostRuntimeEntry>): HostRuntimeEntry {
  return {
    ...fixtureEntry(null),
    homes: [
      { rel: ".s", role: "skills" },
      { rel: ".c", role: "config" },
      { rel: ".", role: "mcp" },
    ],
    ...extra,
  };
}

void test("resolveHomes equals its pre-role result for every table entry, without and with an absolute override", () => {
  for (const id of HOST_IDS) {
    const entry = HOST_RUNTIMES[id];
    assert.deepEqual(resolveHomes(entry, env()), legacyHomes(entry, env()), id);
    if (entry.envOverride !== null) {
      const over = env({ [entry.envOverride]: "/opt/override" });
      assert.deepEqual(resolveHomes(entry, over), legacyHomes(entry, over), id);
    }
  }
  assert.deepEqual(resolveHomes(HOST_RUNTIMES.kimi, env()), ["/home/u/.config/agents", "/home/u/.kimi"]);
});

void test("resolveHomeSpecs pairs each path with its role in table order", () => {
  assert.deepEqual(resolveHomeSpecs(HOST_RUNTIMES.kimi, env()), [
    { path: "/home/u/.config/agents", role: "skills" },
    { path: "/home/u/.kimi", role: "config" },
  ]);
  assert.deepEqual(resolveHomeSpecs(HOST_RUNTIMES.claude, env({ CLAUDE_CONFIG_DIR: "/opt/claude" })), [{ path: "/opt/claude", role: "config" }]);
  assert.deepEqual(resolveHomeSpecs(HOST_RUNTIMES.antigravity, env()), []);
});

void test("an absolute envOverride replaces every config and mcp home and never a skills home", () => {
  const entry = threeHomes({ envOverride: "FIXTURE_DIR" });
  assert.deepEqual(resolveHomeSpecs(entry, env({ FIXTURE_DIR: "/opt/x" })), [
    { path: "/home/u/.s", role: "skills" },
    { path: "/opt/x", role: "config" },
    { path: "/opt/x", role: "mcp" },
  ]);
  assert.deepEqual(resolveHomes(entry, env({ FIXTURE_DIR: "/opt/x" })), ["/home/u/.s", "/opt/x"]);
  assert.deepEqual(resolveHomeSpecs(entry, env()), [
    { path: "/home/u/.s", role: "skills" },
    { path: "/home/u/.c", role: "config" },
    { path: "/home/u", role: "mcp" },
  ]);
  // An mcp home is never a detection home.
  assert.deepEqual(resolveHomes(entry, env()), ["/home/u/.s", "/home/u/.c"]);
  // `..` inside an absolute value is the operator's and is used as given.
  assert.deepEqual(resolveHomeSpecs(entry, env({ FIXTURE_DIR: "/opt/a/../b" }))[1], { path: "/opt/a/../b", role: "config" });
});

void test("an empty or relative envOverride value is SCHEMA_INVALID, an unset one changes nothing", () => {
  const entry = threeHomes({ envOverride: "FIXTURE_DIR" });
  for (const bad of ["", "rel", "./rel"]) {
    assert.throws(() => resolveHomeSpecs(entry, env({ FIXTURE_DIR: bad })), invalid, bad);
  }
  assert.deepEqual(resolveHomeSpecs(entry, env({ OTHER: "/opt/x" })), resolveHomeSpecs(entry, env()));
});

void test("an absolute envBase replaces the config homes with <base>/<sub> and nothing else", () => {
  const entry = threeHomes({ envBase: { name: "XDG_FIXTURE", sub: "opencode" } });
  assert.deepEqual(resolveHomeSpecs(entry, env({ XDG_FIXTURE: "/opt/base" })), [
    { path: "/home/u/.s", role: "skills" },
    { path: "/opt/base/opencode", role: "config" },
    { path: "/home/u", role: "mcp" },
  ]);
  const single: HostRuntimeEntry = { ...fixtureEntry(null), homes: [{ rel: ".config/opencode", role: "config" }], envBase: { name: "XDG_FIXTURE", sub: "opencode" } };
  assert.deepEqual(resolveHomes(single, env({ XDG_FIXTURE: "/opt/base" })), ["/opt/base/opencode"]);
  assert.deepEqual(resolveHomes(single, env()), ["/home/u/.config/opencode"]);
});

void test("an empty or relative envBase value is SCHEMA_INVALID", () => {
  const entry = threeHomes({ envBase: { name: "XDG_FIXTURE", sub: "opencode" } });
  for (const bad of ["", "rel/base"]) {
    assert.throws(() => resolveHomeSpecs(entry, env({ XDG_FIXTURE: bad })), invalid, bad);
  }
});

void test("the two variables of two different entries never interact", () => {
  const withOverride = threeHomes({ envOverride: "FIXTURE_DIR" });
  const withBase = threeHomes({ envBase: { name: "XDG_FIXTURE", sub: "d" } });
  const both = env({ FIXTURE_DIR: "/opt/x", XDG_FIXTURE: "/opt/base" });
  assert.deepEqual(resolveHomes(withOverride, both), ["/home/u/.s", "/opt/x"]);
  assert.deepEqual(resolveHomes(withBase, both), ["/home/u/.s", "/opt/base/d"]);
});

void test("a relative or empty env.home is SCHEMA_INVALID before any variable is read", () => {
  const entry = threeHomes({ envOverride: "FIXTURE_DIR" });
  assert.throws(() => resolveHomeSpecs(entry, env({ FIXTURE_DIR: "/opt/x" }, "rel")), invalid);
  assert.throws(() => resolveHomeSpecs(entry, env({}, "")), invalid);
});
