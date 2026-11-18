// The Grok Build recipe (HOSTID-01, D-40-02, D-40-05) on fixture hosts built from the real table row: the table `[mcp_servers.realm]`
// of `~/.grok/config.toml`, owned by its header, with the multi-line text `grok mcp add` writes (E-40-07). Grok documents no
// relocation variable. Temporary directories only; no Grok runs: its own `grok mcp add second` is simulated with the file the
// observation showed (the comment dropped, the realm table kept in its multi-line form).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { GROK_HAND_GROWN_TOML, GROK_MCP_ADD_TOML, GROK_REWRITTEN_TOML } from "../support/host-config-goldens.js";
import { treeHash } from "../support/fixture-host.js";
import { buildRig, defineHostTomlSuite, expectedTable, nothingWritten, refusedWith, type TomlSuiteDescriptor } from "../support/host-recipe-suite.js";

// A hand-grown user file with no realm table: a comment, a model key and another server.
const SEED = '# my config\nmodel = "grok-x"\n\n[mcp_servers.other]\ncommand = "o"\n';

const DESCRIPTOR: TomlSuiteDescriptor = {
  id: "grok-build",
  req: "HOSTID-01",
  file: "config.toml",
  installHomeRel: ".grok",
  detectHomeRel: ".grok",
  binary: "grok",
  override: null,
  table: GROK_MCP_ADD_TOML,
  seed: SEED,
};

defineHostTomlSuite(DESCRIPTOR);

void test("HOSTID-01 grok-build: the owned text is the golden `grok mcp add` table, header-owned, with no marker and no override variable", () => {
  const entry = HOST_RUNTIMES["grok-build"];
  const recipe = entry.recipe;
  assert.ok(recipe !== null && recipe.kind === "toml-table");
  assert.equal(recipe.file, "config.toml");
  assert.deepEqual(recipe.table, ["mcp_servers", "realm"]);
  assert.equal(`${recipe.text}\n`, GROK_MCP_ADD_TOML);
  assert.equal(JSON.stringify(recipe).includes("BEGIN"), false);
  assert.equal(entry.envOverride, null);
  assert.equal(entry.envBase, undefined);
  assert.equal(entry.tier, "config-only");
});

void test("HOSTID-01 grok-build: the installed table equals the golden byte for byte", async (t) => {
  const fresh = buildRig(t, DESCRIPTOR);
  await fresh.adapter.install(fresh.env, { dryRun: false });
  assert.equal(readFileSync(fresh.file, "utf8"), GROK_MCP_ADD_TOML);
  const seeded = buildRig(t, DESCRIPTOR, { seed: SEED });
  await seeded.adapter.install(seeded.env, { dryRun: false });
  assert.equal(readFileSync(seeded.file, "utf8"), expectedTable(GROK_MCP_ADD_TOML, SEED));
});

void test("HOSTID-01 grok-build: the file Grok rewrote after `grok mcp add second` reads installed and uninstalls leaving the other tables", async (t) => {
  const r = buildRig(t, DESCRIPTOR);
  await r.adapter.install(r.env, { dryRun: false });
  // The comment is dropped, the realm table is byte-identical, another table is appended.
  writeFileSync(r.file, GROK_REWRITTEN_TOML);
  assert.equal(readFileSync(r.file, "utf8").includes(GROK_MCP_ADD_TOML), true);
  const status = await r.adapter.status(r.env);
  assert.equal(status.status, "installed");
  assert.deepEqual(status.entries, [{ path: "config.toml", state: "ok" }]);
  assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "noop");
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  const left = readFileSync(r.file, "utf8");
  assert.equal(left.includes("[mcp_servers.realm]"), false);
  assert.equal(left.includes("[mcp_servers.other]"), true);
  assert.equal(left.includes("[mcp_servers.second]"), true);
  assert.equal(left.includes('model = "grok-x"'), true);
});

void test("HOSTID-01 grok-build: a hand-written single-line realm table with no receipt is foreign content and stays untouched", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { seed: GROK_HAND_GROWN_TOML });
  const before = treeHash(r.host.root);
  for (const dryRun of [true, false]) {
    await assert.rejects(r.adapter.install(r.env, { dryRun }), refusedWith("foreign-content", "POLICY_DENIED"));
  }
  nothingWritten(r, DESCRIPTOR, before);
  assert.equal(readFileSync(r.file, "utf8"), GROK_HAND_GROWN_TOML);
});
