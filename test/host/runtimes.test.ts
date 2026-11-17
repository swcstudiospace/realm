import { test } from "node:test";
import assert from "node:assert/strict";
import { SchemaInvalidError } from "../../src/contract/validate.js";
import { isSafeKeySegment, isSafeRelPath } from "../../src/host/recipe.js";
import { defaultManifestFor } from "../../src/host/manifest.js";
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
const EXPECTED_HOMES: Record<HostId, readonly (readonly [string, "config" | "skills" | "mcp"])[]> = {
  antigravity: [],
  omp: [[".omp/agent", "config"]],
  claude: [[".claude", "config"], [".", "mcp"]],
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

// Phase 24: the hosts with a recipe, and the per-host override variable, base variable and binaries.
const WITH_RECIPE: readonly HostId[] = ["omp", "claude", "opencode", "codex", "kimi", "kimi-code"];
const EXPECTED_OVERRIDES: Partial<Record<HostId, string>> = {
  claude: "CLAUDE_CONFIG_DIR",
  omp: "PI_CODING_AGENT_DIR",
  codex: "CODEX_HOME",
  kimi: "KIMI_SHARE_DIR",
  "kimi-code": "KIMI_CODE_HOME",
};
const EXPECTED_BINARIES: Partial<Record<HostId, readonly string[]>> = {
  omp: ["omp"],
  claude: ["claude"],
  opencode: ["opencode"],
  codex: ["codex"],
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
    assert.equal(entry.envOverride, EXPECTED_OVERRIDES[id] ?? null, id);
    assert.deepEqual(entry.envBase, id === "opencode" ? { name: "XDG_CONFIG_HOME", sub: "opencode" } : undefined, id);
    assert.deepEqual([...entry.binaries], EXPECTED_BINARIES[id] ?? [], id);
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

void test("Phase 24: recipes for omp, claude, opencode, codex, kimi and kimi-code; recipePending is true for exactly the other 13, none of which has conflicts, envBase or a recipe", () => {
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
    const hasRecipe = WITH_RECIPE.includes(id);
    assert.equal(recipePending(id), !hasRecipe, id);
    assert.equal(HOST_RUNTIMES[id].recipe === null, !hasRecipe, id);
    assert.equal(HOST_RUNTIMES[id].conflicts === undefined, id !== "omp", id);
    if (!hasRecipe) {
      assert.equal(HOST_RUNTIMES[id].envBase, undefined, id);
    }
  }
  assert.equal(HOST_IDS.filter((id) => recipePending(id)).length, 13);
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
  // An `mcp` home is never a detection home, so it was not part of the list either.
  return entry.homes.filter((home) => home.role !== "mcp").map((home) => `${over.home}/${home.rel}`);
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

void test("resolveHomes equals its pre-role result for every table entry, without and with an absolute override (a skills home is the one exception: an override never replaces it)", () => {
  for (const id of HOST_IDS) {
    const entry = HOST_RUNTIMES[id];
    assert.deepEqual(resolveHomes(entry, env()), legacyHomes(entry, env()), id);
    if (entry.envOverride !== null && entry.homes.every((home) => home.role !== "skills")) {
      const over = env({ [entry.envOverride]: "/opt/override" });
      assert.deepEqual(resolveHomes(entry, over), legacyHomes(entry, over), id);
    }
  }
  assert.deepEqual(resolveHomes(HOST_RUNTIMES.kimi, env()), ["/home/u/.config/agents", "/home/u/.kimi"]);
  assert.deepEqual(resolveHomes(HOST_RUNTIMES.kimi, env({ KIMI_SHARE_DIR: "/opt/override" })), ["/home/u/.config/agents", "/opt/override"]);
});

void test("resolveHomeSpecs pairs each path with its role in table order", () => {
  assert.deepEqual(resolveHomeSpecs(HOST_RUNTIMES.kimi, env()), [
    { path: "/home/u/.config/agents", role: "skills" },
    { path: "/home/u/.kimi", role: "config" },
  ]);
  assert.deepEqual(resolveHomeSpecs(HOST_RUNTIMES.claude, env({ CLAUDE_CONFIG_DIR: "/opt/claude" })), [
    { path: "/opt/claude", role: "config" },
    { path: "/opt/claude", role: "mcp" },
  ]);
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

// ---- Phase 24: the claude, opencode, codex, kimi and kimi-code rows ---------------------------------------------------------------

void test("Phase 24: the wave-1 rows hold exactly the recipes of 24-CONTEXT D-24-02 to D-24-05, and no other tier changes", () => {
  assert.deepEqual(HOST_RUNTIMES.claude.recipe, {
    kind: "json-merge",
    file: ".claude.json",
    keyPath: ["mcpServers", "realm"],
    value: { type: "stdio", command: "realm", args: ["mcp", "--host", "claude"], env: {} },
    homeRole: "mcp",
  });
  assert.deepEqual(HOST_RUNTIMES.opencode.recipe, {
    kind: "json-merge",
    file: "opencode.json",
    keyPath: ["mcp", "realm"],
    value: { type: "local", command: ["realm", "mcp", "--host", "opencode"] },
  });
  assert.deepEqual(HOST_RUNTIMES.codex.recipe, {
    kind: "text-block",
    file: "config.toml",
    block: '[mcp_servers.realm]\ncommand = "realm"\nargs = ["mcp", "--host", "codex"]',
    tomlTable: ["mcp_servers", "realm"],
  });
  for (const id of ["kimi", "kimi-code"] as const) {
    assert.deepEqual(HOST_RUNTIMES[id].recipe, {
      kind: "json-merge",
      file: "mcp.json",
      keyPath: ["mcpServers", "realm"],
      value: { command: "realm", args: ["mcp", "--host", id] },
    });
    assert.deepEqual([...HOST_RUNTIMES[id].binaries], [], `${id}: the command name kimi is shared by two products, so there is no binary detection`);
  }
  assert.equal(HOST_RUNTIMES.kimi.tier, "proven");
  assert.equal(HOST_RUNTIMES["kimi-code"].tier, "config-only");
});

// The argv a recipe registers, read back from the recipe value (the codex block is parsed from its own lines).
function registeredArgv(id: HostId): readonly string[] {
  const recipe = HOST_RUNTIMES[id].recipe;
  assert.ok(recipe !== null, id);
  const strings = (value: unknown): readonly string[] => {
    assert.ok(Array.isArray(value) && value.every((item) => typeof item === "string"), id);
    return value;
  };
  if (recipe.kind === "text-block") {
    const lines = recipe.block.split("\n");
    const command: unknown = JSON.parse(/^command = (".*")$/.exec(lines[1] ?? "")?.[1] ?? "null");
    assert.ok(typeof command === "string", id);
    return [command, ...strings(JSON.parse(/^args = (\[.*\])$/.exec(lines[2] ?? "")?.[1] ?? "null"))];
  }
  assert.ok(recipe.kind === "json-merge", id);
  assert.ok(typeof recipe.value === "object" && recipe.value !== null, id);
  const command: unknown = Reflect.get(recipe.value, "command");
  if (id === "opencode") {
    return strings(command);
  }
  assert.ok(typeof command === "string", id);
  return [command, ...strings(Reflect.get(recipe.value, "args"))];
}

void test("Phase 24: every recipe registers exactly defaultManifestFor(id).launch, a bare command with no path", () => {
  for (const id of ["claude", "opencode", "codex", "kimi", "kimi-code"] as const) {
    const launch = defaultManifestFor(id, "0.0.0").launch;
    assert.ok(launch !== undefined, id);
    assert.deepEqual(registeredArgv(id), [launch.command, ...launch.args], id);
    assert.equal(launch.command, "realm");
    for (const part of registeredArgv(id)) {
      assert.equal(part.includes("/") || part.includes("\\"), false, `${id}: ${part}`);
    }
  }
});

void test("Phase 24: recipe paths and key segments are safe, the codex block opens with its table header, and the home role exists", () => {
  for (const id of WITH_RECIPE) {
    const entry = HOST_RUNTIMES[id];
    const recipe = entry.recipe;
    assert.ok(recipe !== null, id);
    if (recipe.kind === "bundle-copy") {
      assert.equal(isSafeRelPath(recipe.dest), true, id);
      continue;
    }
    assert.equal(isSafeRelPath(recipe.file), true, id);
    assert.ok(entry.homes.some((home) => home.role === (recipe.homeRole ?? "config")), `${id}: the recipe's home role has a home`);
    if (recipe.kind === "json-merge") {
      assert.ok(recipe.keyPath.every((segment) => isSafeKeySegment(segment)), id);
    } else {
      const table = recipe.tomlTable;
      assert.ok(table !== undefined, id);
      assert.ok(table.every((segment) => isSafeKeySegment(segment)), id);
      assert.equal(recipe.block.split("\n")[0], `[${table.join(".")}]`, id);
    }
  }
  assert.equal(HOST_RUNTIMES.claude.recipe?.kind === "json-merge" ? HOST_RUNTIMES.claude.recipe.homeRole : undefined, "mcp");
});

function assertDeepFrozen(value: unknown, path: string): void {
  if (typeof value !== "object" || value === null) {
    return;
  }
  assert.ok(Object.isFrozen(value), `${path} is frozen`);
  for (const [key, child] of Object.entries(value)) {
    assertDeepFrozen(child, `${path}.${key}`);
  }
}

function mutate(target: unknown, key: string): void {
  assert.ok(typeof target === "object" && target !== null);
  Object.defineProperty(target, key, { value: "mutated" });
}

void test("Phase 24: every entry, home, envBase, conflicts list and recipe is frozen at every level, and a mutation throws a TypeError", () => {
  for (const id of HOST_IDS) {
    assertDeepFrozen(HOST_RUNTIMES[id], id);
  }
  const claude = HOST_RUNTIMES.claude;
  const recipe = claude.recipe;
  assert.ok(recipe !== null && recipe.kind === "json-merge");
  const value = recipe.value;
  assert.ok(typeof value === "object" && value !== null);
  const args: unknown = Reflect.get(value, "args");
  assert.throws(() => { mutate(recipe, "file"); }, TypeError);
  assert.throws(() => { mutate(value, "command"); }, TypeError);
  assert.throws(() => { mutate(args, "0"); }, TypeError);
  assert.throws(() => { Array.prototype.push.call(args, "x"); }, TypeError);
  assert.throws(() => { mutate(recipe.keyPath, "0"); }, TypeError);
  assert.throws(() => { mutate(Reflect.get(value, "env"), "extra"); }, TypeError);
  assert.throws(() => { mutate(claude.homes[0], "rel"); }, TypeError);
  assert.throws(() => { mutate(HOST_RUNTIMES.opencode.envBase, "sub"); }, TypeError);
  assert.throws(() => { mutate(HOST_RUNTIMES.omp.conflicts, "0"); }, TypeError);
  const codex = HOST_RUNTIMES.codex.recipe;
  assert.ok(codex !== null && codex.kind === "text-block");
  assert.throws(() => { mutate(codex.tomlTable, "0"); }, TypeError);
});

// One row per host: its override variable (or XDG base), the default home and what the variable moves.
const HOME_CASES: readonly {
  readonly id: HostId;
  readonly variable: string;
  readonly dflt: readonly { readonly path: string; readonly role: "config" | "skills" | "mcp" }[];
  readonly moved: readonly { readonly path: string; readonly role: "config" | "skills" | "mcp" }[];
}[] = [
  {
    id: "claude",
    variable: "CLAUDE_CONFIG_DIR",
    dflt: [{ path: "/home/u/.claude", role: "config" }, { path: "/home/u", role: "mcp" }],
    moved: [{ path: "/opt/v", role: "config" }, { path: "/opt/v", role: "mcp" }],
  },
  {
    id: "codex",
    variable: "CODEX_HOME",
    dflt: [{ path: "/home/u/.codex", role: "config" }],
    moved: [{ path: "/opt/v", role: "config" }],
  },
  {
    id: "kimi",
    variable: "KIMI_SHARE_DIR",
    dflt: [{ path: "/home/u/.config/agents", role: "skills" }, { path: "/home/u/.kimi", role: "config" }],
    moved: [{ path: "/home/u/.config/agents", role: "skills" }, { path: "/opt/v", role: "config" }],
  },
  {
    id: "kimi-code",
    variable: "KIMI_CODE_HOME",
    dflt: [{ path: "/home/u/.kimi-code", role: "config" }],
    moved: [{ path: "/opt/v", role: "config" }],
  },
  {
    id: "opencode",
    variable: "XDG_CONFIG_HOME",
    dflt: [{ path: "/home/u/.config/opencode", role: "config" }],
    moved: [{ path: "/opt/v/opencode", role: "config" }],
  },
];

void test("Phase 24: each wave-1 row resolves its default home, an absolute override or base, and refuses an empty or relative one", () => {
  for (const c of HOME_CASES) {
    const entry = HOST_RUNTIMES[c.id];
    assert.deepEqual(resolveHomeSpecs(entry, env()), c.dflt, c.id);
    assert.deepEqual(resolveHomeSpecs(entry, env({ [c.variable]: "/opt/v" })), c.moved, c.id);
    for (const bad of ["", "rel/dir", "./dir"]) {
      assert.throws(() => resolveHomeSpecs(entry, env({ [c.variable]: bad })), invalid, `${c.id}: ${bad}`);
    }
    assert.deepEqual(resolveHomeSpecs(entry, env({ UNRELATED_VARIABLE: "/opt/v" })), c.dflt, c.id);
  }
});

void test("Phase 24: the two kimi variables move only their own row, the claude override moves both of its homes, and opencode ignores its own directory variable", () => {
  assert.deepEqual(resolveHomes(HOST_RUNTIMES["kimi-code"], env({ KIMI_SHARE_DIR: "/opt/v" })), ["/home/u/.kimi-code"]);
  assert.deepEqual(resolveHomes(HOST_RUNTIMES.kimi, env({ KIMI_CODE_HOME: "/opt/v" })), ["/home/u/.config/agents", "/home/u/.kimi"]);
  assert.deepEqual(resolveHomes(HOST_RUNTIMES.claude, env({ CLAUDE_CONFIG_DIR: "/opt/v" })), ["/opt/v"]);
  assert.deepEqual(resolveHomes(HOST_RUNTIMES.opencode, env({ OPENCODE_CONFIG_DIR: "/opt/v" })), ["/home/u/.config/opencode"]);
  assert.deepEqual(resolveHomes(HOST_RUNTIMES.opencode, env({ XDG_CONFIG_HOME: "/opt/v" })), ["/opt/v/opencode"]);
});
