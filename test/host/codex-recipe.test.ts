// The Codex recipe (ADPT-06) on fixture hosts built from the real table row: the table `[mcp_servers.realm]`, owned by its header and
// written with no marker, in <CODEX_HOME or ~/.codex>/config.toml. Codex rewrites that file with a comment-dropping TOML editor
// (observed 2026-11-17, codex-cli 0.154.0), which is why a comment marker cannot be the ownership. Temporary directories only; no
// Codex runs: its own `mcp add other` and `mcp remove realm` are simulated by editing the file the way the observation showed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readReceipt, receiptPath } from "../../src/host/receipt.js";
import { sha256Text } from "../../src/host/recipe.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { CODEX_MCP_ADD_TOML, CODEX_REAL_SHAPED_TOML } from "../support/host-config-goldens.js";
import { treeHash } from "../support/fixture-host.js";
import {
  buildRig,
  defineHostTomlSuite,
  expectedTable,
  nothingWritten,
  refusedWith,
  type TomlSuiteDescriptor,
} from "../support/host-recipe-suite.js";

// The owned table is exactly what `codex mcp add realm -- realm mcp --host codex` writes (E-X1), trailing newline included.
const TABLE = CODEX_MCP_ADD_TOML;
const USER_FILE = '# user comment\nmodel = "x"\n';
const OTHER = '[mcp_servers.other]\ncommand = "echo"\nargs = ["hi"]\n';

const DESCRIPTOR: TomlSuiteDescriptor = {
  id: "codex",
  req: "ADPT-06",
  file: "config.toml",
  installHomeRel: ".codex",
  detectHomeRel: ".codex",
  binary: "codex",
  override: { variable: "CODEX_HOME", homeOf: (value) => value },
  table: TABLE,
  seed: CODEX_REAL_SHAPED_TOML,
};

defineHostTomlSuite(DESCRIPTOR);

void test("ADPT-06 codex: the recipe is the golden `codex mcp add` table, owned by its header, with no marker text", () => {
  const recipe = HOST_RUNTIMES.codex.recipe;
  assert.ok(recipe !== null && recipe.kind === "toml-table");
  assert.equal(recipe.file, "config.toml");
  assert.deepEqual(recipe.table, ["mcp_servers", "realm"]);
  assert.equal(`${recipe.text}\n`, TABLE);
  assert.equal(JSON.stringify(recipe).includes("BEGIN"), false);
});

void test("ADPT-06 codex: a fresh install writes exactly the table and nothing else, no comment line", async (t) => {
  const r = buildRig(t, DESCRIPTOR);
  await r.adapter.install(r.env, { dryRun: false });
  assert.equal(readFileSync(r.file, "utf8"), TABLE);
  assert.equal(readFileSync(r.file, "utf8").includes("#"), false);
});

void test("ADPT-06 codex: a seeded install keeps every comment and other table and appends the table after one blank line", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { seed: CODEX_REAL_SHAPED_TOML });
  await r.adapter.install(r.env, { dryRun: false });
  const text = readFileSync(r.file, "utf8");
  assert.equal(text.startsWith(CODEX_REAL_SHAPED_TOML), true, "every prior byte is first");
  assert.equal(text, expectedTable(TABLE, CODEX_REAL_SHAPED_TOML));
  assert.equal(text.slice(CODEX_REAL_SHAPED_TOML.length), `\n${TABLE}`);
  assert.equal(text.split("[mcp_servers.realm]").length - 1, 1, "exactly one realm table");
  assert.equal(text.includes("[mcp_servers.railway]"), true, "the other MCP table stays");
  assert.equal(text.includes("# Hand-edited Codex configuration."), true, "and so do the comments");
});

void test("ADPT-06 codex: a reinstall is an idempotent no-op that changes no byte and writes no audit line", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { seed: USER_FILE });
  await r.adapter.install(r.env, { dryRun: false });
  const tree = treeHash(r.host.root);
  const again = await r.adapter.install(r.env, { dryRun: false });
  assert.equal(again.outcome, "noop");
  assert.equal(again.changed, false);
  assert.equal(treeHash(r.host.root), tree);
});

void test("ADPT-06 codex: a table written by `codex mcp add realm` is foreign-content and is never duplicated or claimed, with or without other tables around it", async (t) => {
  for (const seed of [TABLE, `${CODEX_REAL_SHAPED_TOML}\n${TABLE}`, TABLE.trimEnd(), `${TABLE}\n${OTHER}`]) {
    const r = buildRig(t, DESCRIPTOR, { seed });
    const before = treeHash(r.host.root);
    for (const dryRun of [true, false]) {
      await assert.rejects(r.adapter.install(r.env, { dryRun }), refusedWith("foreign-content", "POLICY_DENIED"));
    }
    nothingWritten(r, DESCRIPTOR, before);
    assert.equal(readFileSync(r.file, "utf8"), seed);
  }
});

void test("ADPT-06 codex: a duplicate table added after install is drifted, uninstall refuses it, a reinstall refuses it, and the file stays", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { seed: USER_FILE });
  await r.adapter.install(r.env, { dryRun: false });
  const duplicated = `${readFileSync(r.file, "utf8")}\n[mcp_servers.realm]\ncommand = "other"\n`;
  writeFileSync(r.file, duplicated);
  const status = await r.adapter.status(r.env);
  assert.equal(status.status, "drifted");
  assert.deepEqual(status.entries, [{ path: "config.toml", state: "drifted" }]);
  await assert.rejects(r.adapter.uninstall(r.env, { dryRun: false }), refusedWith("drifted", "POLICY_DENIED"));
  await assert.rejects(r.adapter.install(r.env, { dryRun: false }), refusedWith("foreign-content", "POLICY_DENIED"));
  assert.equal(readFileSync(r.file, "utf8"), duplicated);
});

void test("ADPT-06 codex: `codex mcp add other` (a table inserted after ours) leaves the owned table byte-identical and status ok, and uninstall removes only our table", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { seed: USER_FILE });
  await r.adapter.install(r.env, { dryRun: false });
  const installed = readFileSync(r.file, "utf8");
  assert.equal(installed, `${USER_FILE}\n${TABLE}`);
  // Codex keeps the table text and puts the new table after it.
  const rewritten = `${installed}\n${OTHER}`;
  writeFileSync(r.file, rewritten);
  assert.equal(readFileSync(r.file, "utf8").includes(TABLE), true, "the owned table is byte-identical");
  const status = await r.adapter.status(r.env);
  assert.equal(status.status, "installed");
  assert.deepEqual(status.entries, [{ path: "config.toml", state: "ok" }]);
  assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "noop");

  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  assert.equal(readFileSync(r.file, "utf8"), `${USER_FILE}\n${OTHER}`);
  assert.equal(existsSync(receiptPath(r.host.stateDir, "codex")), false);
});

void test("ADPT-06 codex: comments around the table that Codex drops are not Realm's, so dropping them is not drift", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { seed: `# about the model\nmodel = "x"\n\n# about realm\n` });
  await r.adapter.install(r.env, { dryRun: false });
  // The first install put the table after the comment lines. Codex rewrites the file without a comment line that precedes a table.
  writeFileSync(r.file, readFileSync(r.file, "utf8").replace("# about realm\n", "").replace("# about the model\n", ""));
  assert.equal((await r.adapter.status(r.env)).status, "installed");
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  // Realm gives back its own separator line; the blank line left by the dropped comment is the user's file now.
  assert.equal(readFileSync(r.file, "utf8"), 'model = "x"\n\n');
});

void test("ADPT-06 codex: `codex mcp remove realm` makes the entry missing, and uninstall is then a no-op that deletes the receipt and keeps the file", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { seed: USER_FILE });
  await r.adapter.install(r.env, { dryRun: false });
  const withOther = `${readFileSync(r.file, "utf8")}\n${OTHER}`;
  writeFileSync(r.file, withOther);
  // Codex removes the table and leaves the rest of the file as it was.
  const removedByCodex = withOther.replace(`${TABLE}\n`, "");
  assert.equal(removedByCodex.includes("[mcp_servers.realm]"), false);
  writeFileSync(r.file, removedByCodex);
  const status = await r.adapter.status(r.env);
  assert.equal(status.status, "drifted");
  assert.deepEqual(status.entries, [{ path: "config.toml", state: "missing" }]);

  const dry = await r.adapter.uninstall(r.env, { dryRun: true });
  assert.equal(dry.outcome, "planned");
  assert.equal(existsSync(receiptPath(r.host.stateDir, "codex")), true, "a dry run keeps the receipt");
  const noop = await r.adapter.uninstall(r.env, { dryRun: false });
  assert.equal(noop.outcome, "noop");
  assert.equal(noop.changed, false);
  assert.equal(readFileSync(r.file, "utf8"), removedByCodex, "the file is not touched");
  assert.equal(existsSync(receiptPath(r.host.stateDir, "codex")), false, "the stale receipt is deleted");
  // With the receipt gone, the host is simply detected and Realm can install again.
  assert.equal((await r.adapter.status(r.env)).status, "detected");
  assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "installed");
});

void test("ADPT-06 codex: an edited owned table (changed value, an added key, a comment inside) is drifted, and uninstall refuses it", async (t) => {
  for (const edit of [
    (text: string) => text.replace('command = "realm"', 'command = "evil"'),
    (text: string) => text.replace('args = ["mcp", "--host", "codex"]', 'args = ["mcp", "--host", "codex"]\nenv = { A = "1" }'),
    (text: string) => text.replace('command = "realm"', '# note\ncommand = "realm"'),
    (text: string) => text.replace('args = ["mcp", "--host", "codex"]\n', ""),
  ]) {
    const r = buildRig(t, DESCRIPTOR, { seed: USER_FILE });
    await r.adapter.install(r.env, { dryRun: false });
    const edited = edit(readFileSync(r.file, "utf8"));
    writeFileSync(r.file, edited);
    const status = await r.adapter.status(r.env);
    assert.equal(status.status, "drifted");
    assert.deepEqual(status.entries, [{ path: "config.toml", state: "drifted" }]);
    await assert.rejects(r.adapter.uninstall(r.env, { dryRun: false }), refusedWith("drifted", "POLICY_DENIED"));
    assert.equal(readFileSync(r.file, "utf8"), edited);
    assert.equal(existsSync(receiptPath(r.host.stateDir, "codex")), true, "the receipt stays");
  }
});

void test("ADPT-06 codex: a CRLF file keeps CRLF through install, a table added after it, and uninstall", async (t) => {
  const seed = '# user comment\r\nmodel = "x"\r\n';
  const r = buildRig(t, DESCRIPTOR, { seed });
  await r.adapter.install(r.env, { dryRun: false });
  const installed = readFileSync(r.file, "utf8");
  assert.equal(installed, `${seed}\r\n${TABLE.replaceAll("\n", "\r\n")}`);
  assert.equal(installed.replaceAll("\r\n", "").includes("\n"), false, "no bare LF");
  const withOther = `${installed}\r\n${OTHER.replaceAll("\n", "\r\n")}`;
  writeFileSync(r.file, withOther);
  assert.equal((await r.adapter.status(r.env)).status, "installed");
  await r.adapter.uninstall(r.env, { dryRun: false });
  assert.equal(readFileSync(r.file, "utf8"), `${seed}\r\n${OTHER.replaceAll("\n", "\r\n")}`);
});

void test("ADPT-06 codex: a dry run of install and of uninstall writes no host file, no receipt and no audit line", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { seed: USER_FILE });
  const before = treeHash(r.host.root);
  const planned = await r.adapter.install(r.env, { dryRun: true });
  assert.equal(planned.outcome, "planned");
  assert.deepEqual(planned.actions.map((action) => [action.path, action.action]), [["config.toml", "update"]]);
  nothingWritten(r, DESCRIPTOR, before);
  await r.adapter.install(r.env, { dryRun: false });
  const installedTree = treeHash(r.host.root);
  const plannedRemoval = await r.adapter.uninstall(r.env, { dryRun: true });
  assert.equal(plannedRemoval.outcome, "planned");
  assert.equal(treeHash(r.host.root), installedTree);
});

void test("ADPT-06 codex: the receipt names the kind and the table hash and holds no table text", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { seed: USER_FILE });
  await r.adapter.install(r.env, { dryRun: false });
  const receipt = await readReceipt(r.host.stateDir, "codex");
  assert.equal(receipt?.receipt.recipeKind, "toml-table");
  assert.equal(receipt?.receipt.entries[0]?.ownedSha256, sha256Text(TABLE));
  assert.equal(receipt?.receipt.entries[0]?.separatorAdded, true);
  const raw = readFileSync(receiptPath(r.host.stateDir, "codex"), "utf8");
  assert.equal(raw.includes("--host"), false);
  assert.equal(raw.includes("command"), false);
});

void test("ADPT-06 codex: a file that ends inside [features] without a newline keeps hooks = true in that table", async (t) => {
  const seed = "[features]\nhooks = true";
  const r = buildRig(t, DESCRIPTOR, { seed });
  await r.adapter.install(r.env, { dryRun: false });
  const lines = readFileSync(r.file, "utf8").split("\n");
  // The table comes after a line ending and a blank line of its own and opens with its own header, so it cannot capture the key above it.
  assert.deepEqual(lines.slice(0, 4), ["[features]", "hooks = true", "", "[mcp_servers.realm]"]);
  await r.adapter.uninstall(r.env, { dryRun: false });
  assert.equal(readFileSync(r.file, "utf8"), seed);
});

void test("ADPT-06 codex: a file with mcp_servers.realm2 and mcp_servers.railway installs, and both stay", async (t) => {
  const seed = '[mcp_servers.realm2]\ncommand = "a"\n\n[mcp_servers.railway]\ncommand = "b"\nargs = ["x"]\n';
  const r = buildRig(t, DESCRIPTOR, { seed });
  assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "installed");
  const text = readFileSync(r.file, "utf8");
  assert.equal(text.startsWith(seed), true);
  assert.equal(text.includes('[mcp_servers.realm2]\ncommand = "a"'), true);
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  assert.equal(readFileSync(r.file, "utf8"), seed);
});
