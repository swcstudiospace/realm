// The Muse Code recipe (HOSTID-01, D-40-02 to D-40-04) on fixture hosts built from the real table row: `mcpServers.realm` in
// <XDG_CONFIG_HOME or ~/.config>/muse/settings.json, written with `required: true`, the seed `schema_version: 1` only into a file
// Realm creates (E-40-04) and a refusal while the rival `mcp_servers` spelling is present (E-40-05). Temporary directories only; no
// Muse runs: its own `muse mcp add other` and `muse mcp remove other` are simulated with the files the observation showed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { MUSE_MCP_ADD_ENTRY, MUSE_MCP_ADD_FILE, MUSE_RECIPE_ENTRY, MUSE_RECIPE_FILE, MUSE_REWRITTEN_FILE } from "../support/host-config-goldens.js";
import { treeHash } from "../support/fixture-host.js";
import {
  buildRig,
  defineHostRecipeSuite,
  isRecord,
  nothingWritten,
  parseDoc,
  refusedWith,
  render,
  type JsonFormat,
  type JsonSuiteDescriptor,
} from "../support/host-recipe-suite.js";

// Muse writes sorted keys, two-space indent and no trailing newline.
const MUSE_FORMAT: JsonFormat = { indent: "  ", eol: "\n", trailing: false };

function withoutRealm(text: string): Record<string, unknown> {
  const doc = parseDoc(text);
  const parent = doc["mcpServers"];
  assert.ok(isRecord(parent), "the golden has the parent object");
  return { ...doc, mcpServers: Object.fromEntries(Object.entries(parent).filter(([name]) => name !== "realm")) };
}

const DESCRIPTOR: JsonSuiteDescriptor = {
  id: "muse-code",
  req: "HOSTID-01",
  file: "settings.json",
  installHomeRel: ".config/muse",
  detectHomeRel: ".config/muse",
  binary: "muse",
  // XDG_CONFIG_HOME is a base: the home is <base>/muse.
  override: { variable: "XDG_CONFIG_HOME", homeOf: (value) => join(value, "muse") },
  parentKey: "mcpServers",
  entry: { type: "stdio", command: "realm", args: ["mcp", "--host", "muse-code"], required: true },
  seedDoc: withoutRealm(MUSE_REWRITTEN_FILE),
  seedFormat: MUSE_FORMAT,
  createdSeed: { schema_version: 1 },
  rival: "mcp_servers",
};

defineHostRecipeSuite(DESCRIPTOR);

void test("HOSTID-01 muse-code: the row is the golden entry of `muse mcp add` plus required, with the seed and the rival key", () => {
  const recipe = HOST_RUNTIMES["muse-code"].recipe;
  assert.ok(recipe !== null && recipe.kind === "json-merge");
  assert.equal(recipe.file, "settings.json");
  assert.deepEqual([...recipe.keyPath], ["mcpServers", "realm"]);
  assert.deepEqual(recipe.value, MUSE_RECIPE_ENTRY);
  assert.deepEqual(recipe.value, { ...MUSE_MCP_ADD_ENTRY, required: true });
  assert.deepEqual(recipe.seed, { schema_version: 1 });
  assert.deepEqual(recipe.refuseIfPresent, ["mcp_servers"]);
  assert.deepEqual(parseDoc(MUSE_MCP_ADD_FILE)["mcpServers"], { realm: MUSE_MCP_ADD_ENTRY });
  assert.equal(HOST_RUNTIMES["muse-code"].tier, "proven");
});

void test("HOSTID-01 muse-code: a file Realm creates holds schema_version then the entry, and the dry run writes nothing", async (t) => {
  const r = buildRig(t, DESCRIPTOR);
  const before = treeHash(r.host.root);
  const plan = await r.adapter.install(r.env, { dryRun: true });
  assert.equal(plan.outcome, "planned");
  nothingWritten(r, DESCRIPTOR, before);
  await r.adapter.install(r.env, { dryRun: false });
  const text = readFileSync(r.file, "utf8");
  assert.equal(text, render({ schema_version: 1, mcpServers: { realm: MUSE_RECIPE_ENTRY } }));
  const doc = parseDoc(text);
  assert.deepEqual(Object.keys(doc), ["schema_version", "mcpServers"]);
  assert.equal(isDeepStrictEqual(parseDoc(MUSE_RECIPE_FILE), { mcpServers: { realm: MUSE_RECIPE_ENTRY }, schema_version: 1 }), true, "Muse's own canonical form holds the same members");
});

void test("HOSTID-01 muse-code: an existing file with no schema_version gets only the entry and stays without the seed", async (t) => {
  const seed = render({ mcpServers: { other: { type: "stdio", command: "other-cmd", args: [] } } }, MUSE_FORMAT);
  const r = buildRig(t, DESCRIPTOR, { seed });
  await r.adapter.install(r.env, { dryRun: false });
  const doc = parseDoc(readFileSync(r.file, "utf8"));
  assert.equal(Object.hasOwn(doc, "schema_version"), false, "Realm never adds the seed to a file it did not create");
  assert.deepEqual(Object.keys(doc), ["mcpServers"]);
  await r.adapter.uninstall(r.env, { dryRun: false });
  assert.equal(readFileSync(r.file, "utf8"), seed);
});

void test("HOSTID-01 muse-code: the file Muse rewrote after `muse mcp add other` reads installed and uninstalls to the file without the realm entry", async (t) => {
  const r = buildRig(t, DESCRIPTOR);
  await r.adapter.install(r.env, { dryRun: false });
  // Muse re-serialises the whole file (sorted keys, no trailing newline) and keeps the realm entry value-identical, required included.
  writeFileSync(r.file, MUSE_REWRITTEN_FILE);
  const status = await r.adapter.status(r.env);
  assert.equal(status.status, "installed");
  assert.deepEqual(status.entries, [{ path: "settings.json", state: "ok" }]);
  assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "noop");
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  const left = parseDoc(readFileSync(r.file, "utf8"));
  assert.deepEqual(left, withoutRealm(MUSE_REWRITTEN_FILE));
  assert.equal(left["schema_version"], 1, "the host's own member stays");
});

void test("HOSTID-01 muse-code: `muse mcp remove other` leaves the recipe file, which still reads installed", async (t) => {
  const r = buildRig(t, DESCRIPTOR);
  await r.adapter.install(r.env, { dryRun: false });
  writeFileSync(r.file, MUSE_REWRITTEN_FILE);
  writeFileSync(r.file, MUSE_RECIPE_FILE);
  assert.equal((await r.adapter.status(r.env)).status, "installed");
});

void test("HOSTID-01 muse-code: a created file that holds only the seed after the entry is removed is deleted on uninstall", async (t) => {
  const r = buildRig(t, DESCRIPTOR);
  await r.adapter.install(r.env, { dryRun: false });
  assert.equal(existsSync(r.file), true);
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  assert.equal(existsSync(r.file), false, "the file Realm created is gone");
});

void test("HOSTID-01 muse-code: an old mcp_servers realm entry refuses install and dry run as foreign-content and changes nothing", async (t) => {
  const old = render({ schema_version: 1, mcp_servers: { realm: { command: "realm", args: ["mcp"] } } }, MUSE_FORMAT);
  const r = buildRig(t, DESCRIPTOR, { seed: old });
  const before = treeHash(r.host.root);
  for (const dryRun of [true, false]) {
    await assert.rejects(r.adapter.install(r.env, { dryRun }), refusedWith("foreign-content", "POLICY_DENIED"));
  }
  assert.equal(readFileSync(r.file, "utf8"), old);
  assert.equal(treeHash(r.host.root), before);
});
