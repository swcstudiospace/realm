// The Claude Code recipe (ADPT-04) on fixture hosts built from the real table row: the entry `claude mcp add --scope user realm --
// realm mcp --host claude` writes, merged into <home or CLAUDE_CONFIG_DIR>/.claude.json. Temporary directories only; no Claude binary runs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { readReceipt } from "../../src/host/receipt.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { CLAUDE_MCP_ADD_ENTRY, CLAUDE_MCP_ADD_FILE } from "../support/host-config-goldens.js";
import {
  buildRig,
  defineHostRecipeSuite,
  executable,
  nothingWritten,
  parseDoc,
  refusedWith,
  render,
  withEntry,
  type JsonFormat,
  type JsonSuiteDescriptor,
} from "../support/host-recipe-suite.js";
import { treeHash } from "../support/fixture-host.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// Claude Code writes ~/.claude.json with no trailing newline (E-C1).
const CLAUDE_FORMAT: JsonFormat = { indent: "  ", eol: "\n", trailing: false };

const DESCRIPTOR: JsonSuiteDescriptor = {
  id: "claude",
  req: "ADPT-04",
  file: ".claude.json",
  // The user-scope file is a sibling of ~/.claude, so the install home is HOME itself.
  installHomeRel: ".",
  detectHomeRel: ".claude",
  binary: "claude",
  override: { variable: "CLAUDE_CONFIG_DIR", homeOf: (value) => value },
  parentKey: "mcpServers",
  entry: CLAUDE_MCP_ADD_ENTRY,
  seedDoc: {
    firstStartTime: "2026-11-17T07:59:15.023Z",
    firstStartVersion: "2.1.322",
    machineID: "0000000000000000000000000000000000000000000000000000000000000001",
    migrationVersion: 15,
    seenNotifications: {},
    mcpServers: { "other-server": { type: "stdio", command: "other", args: ["--flag"], env: {} } },
    userID: "0000000000000000000000000000000000000000000000000000000000000002",
  },
  seedFormat: CLAUDE_FORMAT,
};

defineHostRecipeSuite(DESCRIPTOR);

void test("ADPT-04 claude: the golden `claude mcp add` entry is exactly the recipe value", () => {
  const golden = parseDoc(CLAUDE_MCP_ADD_FILE);
  const servers = golden["mcpServers"] as Record<string, unknown>;
  assert.deepEqual(servers["realm"], CLAUDE_MCP_ADD_ENTRY);
  const recipe = HOST_RUNTIMES.claude.recipe;
  assert.ok(recipe !== null && recipe.kind === "json-merge");
  assert.deepEqual(recipe.value, CLAUDE_MCP_ADD_ENTRY);
  assert.deepEqual([...recipe.keyPath], ["mcpServers", "realm"]);
  assert.equal(recipe.file, ".claude.json");
  assert.equal(recipe.homeRole, "mcp");
});

void test("ADPT-04 claude: install with no ~/.claude directory but the binary present succeeds, because the install home is the user home", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { home: false, path: true });
  executable(join(r.binDir, "claude"));
  assert.equal(existsSync(join(r.host.home, ".claude")), false);
  const found = await r.adapter.detect(r.env);
  assert.equal(found.via, "binary");
  const installed = await r.adapter.install(r.env, { dryRun: false });
  assert.equal(installed.outcome, "installed");
  assert.equal(existsSync(join(r.host.home, ".claude")), false, "no ~/.claude directory is created");
  assert.equal(existsSync(join(r.host.home, ".claude.json")), true);
});

void test("ADPT-04 claude: a fresh HOME gets { mcpServers: { realm } } in the default format with mode 0600, the receipt records the created file, and uninstall removes it", async (t) => {
  const r = buildRig(t, DESCRIPTOR);
  const before = r.watched();
  await r.adapter.install(r.env, { dryRun: false });
  assert.equal(readFileSync(r.file, "utf8"), render({ mcpServers: { realm: CLAUDE_MCP_ADD_ENTRY } }));
  assert.equal(readFileSync(r.file, "utf8").endsWith("\n"), true);
  const receipt = await readReceipt(r.host.stateDir, "claude");
  assert.equal(receipt?.receipt.entries[0]?.createdFile, true);
  assert.deepEqual(receipt.receipt.entries[0].createdParents, [["mcpServers"]]);
  assert.equal(receipt.receipt.configHome, r.host.home);
  await r.adapter.uninstall(r.env, { dryRun: false });
  assert.equal(existsSync(r.file), false);
  assert.equal(r.watched(), before);
});

void test("ADPT-04 claude: a file that already holds the golden `claude mcp add` output installs as a no-op that Realm does not claim", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { seed: CLAUDE_MCP_ADD_FILE });
  const before = treeHash(r.host.root);
  const again = await r.adapter.install(r.env, { dryRun: false });
  assert.equal(again.outcome, "noop");
  nothingWritten(r, DESCRIPTOR, before);
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "noop");
  assert.equal(readFileSync(r.file, "utf8"), CLAUDE_MCP_ADD_FILE, "the host's own entry stays");
});

// A document shaped like a real ~/.claude.json: many top-level keys, seven servers, and a large `projects` object whose entries
// carry their own `mcpServers`. `mcpServers` sits in the middle, so a rewrite that moved it would show.
function machineDoc(): Record<string, unknown> {
  const projects: Record<string, unknown> = {};
  for (let index = 0; index < 60; index += 1) {
    projects[`/work/project-${String(index)}`] = {
      allowedTools: [],
      mcpServers: index % 7 === 0 ? { local: { type: "stdio", command: "local", args: [], env: {} } } : {},
      history: [{ display: `prompt ${String(index)}`, pastedContents: {} }],
      hasTrustDialogAccepted: true,
      lastCost: index / 8,
    };
  }
  const servers: Record<string, unknown> = {};
  for (let index = 0; index < 7; index += 1) {
    servers[`server-${String(index)}`] = { type: "stdio", command: "npx", args: ["-y", `package-${String(index)}`], env: { TOKEN: `value-${String(index)}` } };
  }
  return {
    numStartups: 412,
    installMethod: "native",
    autoUpdates: false,
    firstStartTime: "2026-01-01T00:00:00.000Z",
    userID: "0000000000000000000000000000000000000000000000000000000000000002",
    mcpServers: servers,
    projects,
    cachedGrowthBookFeatures: { feature_a: true, feature_b: { variant: 2 }, feature_c: null },
    migrationVersion: 15,
  };
}

void test("ADPT-04 claude: a document shaped like the machine's real file changes exactly one top-level key, keeps every key's order, adds no trailing newline and restores byte for byte", async (t) => {
  const doc = machineDoc();
  const seed = render(doc, CLAUDE_FORMAT);
  assert.ok(seed.length > 10_000, "a large file");
  const r = buildRig(t, DESCRIPTOR, { seed });
  await r.adapter.install(r.env, { dryRun: false });
  const text = readFileSync(r.file, "utf8");
  assert.equal(text.endsWith("\n"), false, "no trailing newline is added");
  const after = parseDoc(text);
  assert.deepEqual(Object.keys(after), Object.keys(doc), "the top-level key order is intact");
  const changed = Object.keys(doc).filter((key) => !isDeepStrictEqual(doc[key], after[key]));
  assert.deepEqual(changed, ["mcpServers"]);
  const servers = after["mcpServers"] as Record<string, unknown>;
  assert.deepEqual(Object.keys(servers), [...Object.keys(doc["mcpServers"] as Record<string, unknown>), "realm"]);
  assert.deepEqual(servers["realm"], CLAUDE_MCP_ADD_ENTRY);
  assert.equal(text, render(withEntry(DESCRIPTOR, doc), CLAUDE_FORMAT));
  await r.adapter.uninstall(r.env, { dryRun: false });
  assert.equal(readFileSync(r.file, "utf8"), seed);
});

void test("ADPT-04 claude: the entry of `claude mcp add realm -- realm mcp` (args [mcp]) is foreign-content, never overwritten", async (t) => {
  const seed = render({ mcpServers: { realm: { type: "stdio", command: "realm", args: ["mcp"], env: {} } } });
  const r = buildRig(t, DESCRIPTOR, { seed });
  const before = treeHash(r.host.root);
  await assert.rejects(r.adapter.install(r.env, { dryRun: false }), refusedWith("foreign-content", "POLICY_DENIED"));
  nothingWritten(r, DESCRIPTOR, before);
});

void test("ADPT-04 claude: --config-home names the directory that holds the file, and skips detection", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { home: false });
  const dir = join(r.host.root, "chosen");
  mkdirSync(dir);
  assert.equal((await r.adapter.detect(r.env)).detected, false);
  const installed = await r.adapter.install(r.env, { dryRun: false, configHome: dir });
  assert.equal(installed.outcome, "installed");
  assert.equal(existsSync(join(dir, ".claude.json")), true);
  assert.equal(existsSync(join(r.host.home, ".claude.json")), false);
  assert.equal((await readReceipt(r.host.stateDir, "claude"))?.receipt.configHome, dir);
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  assert.equal(existsSync(join(dir, ".claude.json")), false);
});

void test("ADPT-04 claude: the shipped plugin bundle adapters/claude-plugin is never touched", async (t) => {
  const bundle = join(REPO_ROOT, "adapters", "claude-plugin");
  const before = treeHash(bundle);
  assert.notEqual(before, "absent", "the bundle exists");
  const r = buildRig(t, DESCRIPTOR);
  await r.adapter.install(r.env, { dryRun: false });
  await r.adapter.uninstall(r.env, { dryRun: false });
  assert.equal(treeHash(bundle), before);
});
