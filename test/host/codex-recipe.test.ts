// The Codex recipe (ADPT-06) on fixture hosts built from the real table row: an owned `[mcp_servers.realm]` block between the
// Realm markers in <CODEX_HOME or ~/.codex>/config.toml, guarded against a duplicate table. Temporary directories only; no Codex runs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { CODEX_MCP_ADD_TOML, CODEX_REAL_SHAPED_TOML } from "../support/host-config-goldens.js";
import { treeHash } from "../support/fixture-host.js";
import {
  buildRig,
  defineHostTextSuite,
  expectedText,
  nothingWritten,
  refusedWith,
  type TextSuiteDescriptor,
} from "../support/host-recipe-suite.js";

const BEGIN = "# BEGIN realm host-plugin";
const END = "# END realm host-plugin";
// The block is exactly the table `codex mcp add realm -- realm mcp --host codex` writes, without its trailing newline (E-X1).
const BLOCK = CODEX_MCP_ADD_TOML.slice(0, -1);

const DESCRIPTOR: TextSuiteDescriptor = {
  id: "codex",
  req: "ADPT-06",
  file: "config.toml",
  installHomeRel: ".codex",
  detectHomeRel: ".codex",
  binary: "codex",
  override: { variable: "CODEX_HOME", homeOf: (value) => value },
  block: BLOCK,
  seed: CODEX_REAL_SHAPED_TOML,
};

defineHostTextSuite(DESCRIPTOR);

void test("ADPT-06 codex: the block in the recipe is the golden `codex mcp add` table, and the tomlTable guard names it", () => {
  const recipe = HOST_RUNTIMES.codex.recipe;
  assert.ok(recipe !== null && recipe.kind === "text-block");
  assert.equal(recipe.block, BLOCK);
  assert.deepEqual(recipe.tomlTable, ["mcp_servers", "realm"]);
  assert.equal(recipe.file, "config.toml");
});

void test("ADPT-06 codex: the text between the markers equals the golden table, line for line", async (t) => {
  const r = buildRig(t, DESCRIPTOR);
  await r.adapter.install(r.env, { dryRun: false });
  const lines = readFileSync(r.file, "utf8").split("\n");
  assert.equal(lines[0], BEGIN);
  assert.equal(lines.indexOf(END), lines.length - 2, "the END marker is the last line before the final newline");
  assert.equal(lines.slice(1, lines.indexOf(END)).join("\n"), CODEX_MCP_ADD_TOML.slice(0, -1));
  assert.equal(lines.at(-1), "");
});

void test("ADPT-06 codex: a table written by `codex mcp add realm` is foreign-content and is never duplicated, with or without other tables around it", async (t) => {
  for (const seed of [CODEX_MCP_ADD_TOML, `${CODEX_REAL_SHAPED_TOML}\n${CODEX_MCP_ADD_TOML}`, CODEX_MCP_ADD_TOML.trimEnd()]) {
    const r = buildRig(t, DESCRIPTOR, { seed });
    const before = treeHash(r.host.root);
    for (const dryRun of [true, false]) {
      await assert.rejects(r.adapter.install(r.env, { dryRun }), refusedWith("foreign-content", "POLICY_DENIED"));
    }
    nothingWritten(r, DESCRIPTOR, before);
    assert.equal(readFileSync(r.file, "utf8"), seed);
  }
});

void test("ADPT-06 codex: install into a file shaped like a real user config appends one block at the end and leaves every prior byte", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { seed: CODEX_REAL_SHAPED_TOML });
  await r.adapter.install(r.env, { dryRun: false });
  const text = readFileSync(r.file, "utf8");
  assert.equal(text.startsWith(CODEX_REAL_SHAPED_TOML), true, "every prior byte is first");
  assert.equal(text, expectedText(BLOCK, CODEX_REAL_SHAPED_TOML));
  assert.equal(text.split("[mcp_servers.realm]").length - 1, 1, "exactly one realm table");
  assert.equal(text.includes("[mcp_servers.railway]"), true, "the other MCP table stays");
  assert.equal(text.slice(CODEX_REAL_SHAPED_TOML.length), `${BEGIN}\n${BLOCK}\n${END}\n`);
});

void test("ADPT-06 codex: a file that ends inside [features] without a newline keeps hooks = true in that table", async (t) => {
  const seed = "[features]\nhooks = true";
  const r = buildRig(t, DESCRIPTOR, { seed });
  await r.adapter.install(r.env, { dryRun: false });
  const lines = readFileSync(r.file, "utf8").split("\n");
  // The block comes after a newline of its own and opens with its own table header, so it cannot capture the key above it.
  assert.deepEqual(lines.slice(0, 4), ["[features]", "hooks = true", BEGIN, "[mcp_servers.realm]"]);
  await r.adapter.uninstall(r.env, { dryRun: false });
  assert.equal(readFileSync(r.file, "utf8"), seed);
});

void test("ADPT-06 codex: a file with mcp_servers.realm2 and mcp_servers.railway installs, and both stay", async (t) => {
  const seed = '[mcp_servers.realm2]\ncommand = "a"\n\n[mcp_servers.railway]\ncommand = "b"\nargs = ["x"]\n';
  const r = buildRig(t, DESCRIPTOR, { seed });
  assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "installed");
  const text = readFileSync(r.file, "utf8");
  assert.equal(text.startsWith(seed), true);
  assert.equal(text.includes("[mcp_servers.realm2]\ncommand = \"a\""), true);
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  assert.equal(readFileSync(r.file, "utf8"), seed);
});
