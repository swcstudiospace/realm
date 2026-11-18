// The Prime Agent recipe (HOSTID-01, D-40-02) on fixture hosts built from the real table row: `mcpServers.realm` in settings.json of the
// agent directory, which is `~/.prime/agent` or the directory PRIME_AGENT_CODING_AGENT_DIR names (E-40-06). Temporary directories
// only; no Prime Agent runs: its own `mcp add other` is simulated with the file the observation showed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { PRIME_MCP_ADD_ENTRY, PRIME_MCP_ADD_FILE, PRIME_REWRITTEN_FILE } from "../support/host-config-goldens.js";
import { buildRig, defineHostRecipeSuite, isRecord, parseDoc, type JsonFormat, type JsonSuiteDescriptor } from "../support/host-recipe-suite.js";

// Prime Agent writes insertion-ordered keys, two-space indent and no trailing newline.
const PRIME_FORMAT: JsonFormat = { indent: "  ", eol: "\n", trailing: false };

const SEED_DOC = {
  defaultProvider: "echo",
  mcpServers: { other: { type: "stdio", command: "o", args: ["--x"] } },
};

const DESCRIPTOR: JsonSuiteDescriptor = {
  id: "prime-agent",
  req: "HOSTID-01",
  file: "settings.json",
  installHomeRel: ".prime/agent",
  detectHomeRel: ".prime/agent",
  binary: "prime-agent",
  // The variable names the agent directory itself.
  override: { variable: "PRIME_AGENT_CODING_AGENT_DIR", homeOf: (value) => value },
  parentKey: "mcpServers",
  entry: { type: "stdio", command: "realm", args: ["mcp", "--host", "prime-agent"] },
  seedDoc: SEED_DOC,
  seedFormat: PRIME_FORMAT,
};

defineHostRecipeSuite(DESCRIPTOR);

void test("HOSTID-01 prime-agent: the row is the golden entry of `prime-agent mcp add`, with no seed and no rival key", () => {
  const recipe = HOST_RUNTIMES["prime-agent"].recipe;
  assert.ok(recipe !== null && recipe.kind === "json-merge");
  assert.equal(recipe.file, "settings.json");
  assert.deepEqual([...recipe.keyPath], ["mcpServers", "realm"]);
  assert.deepEqual(recipe.value, PRIME_MCP_ADD_ENTRY);
  assert.equal(recipe.seed, undefined);
  assert.equal(recipe.refuseIfPresent, undefined);
  assert.equal(HOST_RUNTIMES["prime-agent"].envOverride, "PRIME_AGENT_CODING_AGENT_DIR");
  assert.equal(HOST_RUNTIMES["prime-agent"].tier, "config-only");
});

void test("HOSTID-01 prime-agent: the file a fresh install creates equals the golden `prime-agent mcp add` file apart from the trailing newline", async (t) => {
  const r = buildRig(t, DESCRIPTOR);
  await r.adapter.install(r.env, { dryRun: false });
  const text = readFileSync(r.file, "utf8");
  assert.equal(text, `${PRIME_MCP_ADD_FILE}\n`);
  assert.deepEqual(parseDoc(text), parseDoc(PRIME_MCP_ADD_FILE));
});

void test("HOSTID-01 prime-agent: a file the host rewrote after adding another server reads installed and uninstalls leaving the other server", async (t) => {
  const r = buildRig(t, DESCRIPTOR);
  await r.adapter.install(r.env, { dryRun: false });
  writeFileSync(r.file, PRIME_REWRITTEN_FILE);
  assert.equal((await r.adapter.status(r.env)).status, "installed");
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  const left = parseDoc(readFileSync(r.file, "utf8"));
  const parent = left["mcpServers"];
  assert.ok(isRecord(parent));
  assert.deepEqual(Object.keys(parent), ["other"]);
});
