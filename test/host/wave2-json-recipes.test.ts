// The wave-2 JSON recipes (WAVE2-03) on fixture hosts built from the REAL table rows of cursor, copilot, qwen, augment, pi, cline,
// antigravity and kilo (25-CONTEXT D-25-02): one shared suite per host (lifecycle, drift, concurrency, modes, doctor, override,
// symlinks, hostile content). Temporary directories only; no host runs. The per-host cases are in wave2-json-specifics.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import type { HostId } from "../../src/host/types.js";
import {
  ANTIGRAVITY_MCP_DOC_FILE,
  AUGMENT_MCP_ADD_JSON_FILE,
  CLINE_MCP_DOC_FILE,
  COPILOT_MCP_ADD_FILE,
  COPILOT_NORMALIZED_FILE,
  CURSOR_MCP_DOC_FILE,
  KILO_JSON_REWRITTEN_FILE,
  PI_MCP_ADD_FILE,
  QWEN_HOST_MIGRATED_FILE,
  QWEN_MCP_ADD_FILE,
} from "../support/host-config-goldens.js";
import { DEFAULT_FORMAT, defineHostRecipeSuite, isRecord, parseDoc, type JsonSuiteDescriptor } from "../support/host-recipe-suite.js";

// The document with the realm entry removed from its parent object (a host file as it was before Realm registered anything).
function withoutRealm(text: string, parentKey: string): Record<string, unknown> {
  const doc = parseDoc(text);
  const parent = doc[parentKey];
  assert.ok(isRecord(parent), "the golden has the parent object");
  return { ...doc, [parentKey]: Object.fromEntries(Object.entries(parent).filter(([name]) => name !== "realm")) };
}

const PI_SEED_DOC = { mcpServers: { other: { command: "other-cmd", args: [] } } };
// An augment settings object as the host keeps it: other keys, no mcpServers yet, no trailing newline.
const AUGMENT_SEED_DOC = { model: "example-model", hooks: { PreToolUse: [] } };

const DESCRIPTORS: readonly JsonSuiteDescriptor[] = [
  {
    id: "cursor",
    req: "WAVE2-03",
    file: "mcp.json",
    installHomeRel: ".cursor",
    detectHomeRel: ".cursor",
    binary: "cursor-agent",
    // No relocation variable is documented (E-CU2): the override tests are not registered.
    override: null,
    parentKey: "mcpServers",
    entry: { type: "stdio", command: "realm", args: ["mcp", "--host", "cursor"] },
    seedDoc: parseDoc(CURSOR_MCP_DOC_FILE),
    seedFormat: DEFAULT_FORMAT,
  },
  {
    id: "copilot",
    req: "WAVE2-03",
    file: "mcp-config.json",
    installHomeRel: ".copilot",
    detectHomeRel: ".copilot",
    binary: "copilot",
    override: { variable: "COPILOT_HOME", homeOf: (value) => value },
    parentKey: "mcpServers",
    entry: { tools: ["*"], type: "local", command: "realm", args: ["mcp", "--host", "copilot"] },
    seedDoc: withoutRealm(COPILOT_NORMALIZED_FILE, "mcpServers"),
    seedFormat: DEFAULT_FORMAT,
  },
  {
    id: "qwen",
    req: "WAVE2-03",
    file: "settings.json",
    installHomeRel: ".qwen",
    detectHomeRel: ".qwen",
    binary: "qwen",
    override: { variable: "QWEN_HOME", homeOf: (value) => value },
    parentKey: "mcpServers",
    entry: { command: "realm", args: ["mcp", "--host", "qwen"] },
    seedDoc: withoutRealm(QWEN_HOST_MIGRATED_FILE, "mcpServers"),
    // Qwen writes no trailing newline (E-QW1).
    seedFormat: { indent: "  ", eol: "\n", trailing: false },
  },
  {
    id: "augment",
    req: "WAVE2-03",
    file: "settings.json",
    installHomeRel: ".augment",
    detectHomeRel: ".augment",
    binary: "auggie",
    override: { variable: "AUGMENT_CACHE_DIR", homeOf: (value) => value },
    parentKey: "mcpServers",
    entry: { type: "stdio", command: "realm", args: ["mcp", "--host", "augment"] },
    seedDoc: AUGMENT_SEED_DOC,
    seedFormat: { indent: "  ", eol: "\n", trailing: false },
  },
  {
    id: "pi",
    req: "WAVE2-03",
    file: "mcp.json",
    installHomeRel: ".pi/agent",
    detectHomeRel: ".pi/agent",
    binary: "pi",
    override: { variable: "PI_CODING_AGENT_DIR", homeOf: (value) => value },
    parentKey: "mcpServers",
    entry: { command: "realm", args: ["mcp", "--host", "pi"] },
    seedDoc: PI_SEED_DOC,
    seedFormat: DEFAULT_FORMAT,
  },
  {
    id: "cline",
    req: "WAVE2-03",
    file: "data/settings/cline_mcp_settings.json",
    installHomeRel: ".cline",
    detectHomeRel: ".cline",
    binary: "cline",
    override: { variable: "CLINE_DIR", homeOf: (value) => value },
    parentKey: "mcpServers",
    entry: { command: "realm", args: ["mcp", "--host", "cline"] },
    seedDoc: parseDoc(CLINE_MCP_DOC_FILE),
    seedFormat: DEFAULT_FORMAT,
  },
  {
    id: "antigravity",
    req: "WAVE2-03",
    file: "mcp_config.json",
    installHomeRel: ".gemini/config",
    detectHomeRel: ".gemini/config",
    binary: "agy",
    // No relocation variable is documented (E-AG1): the override tests are not registered.
    override: null,
    parentKey: "mcpServers",
    entry: { command: "realm", args: ["mcp", "--host", "antigravity"] },
    seedDoc: parseDoc(ANTIGRAVITY_MCP_DOC_FILE),
    seedFormat: DEFAULT_FORMAT,
  },
  {
    id: "kilo",
    req: "WAVE2-03",
    file: "kilo.json",
    installHomeRel: ".config/kilo",
    detectHomeRel: ".config/kilo",
    binary: "kilo",
    // XDG_CONFIG_HOME is a base: the home is <base>/kilo.
    override: { variable: "XDG_CONFIG_HOME", homeOf: (value) => join(value, "kilo") },
    parentKey: "mcp",
    entry: { type: "local", command: ["realm", "mcp", "--host", "kilo"] },
    seedDoc: withoutRealm(KILO_JSON_REWRITTEN_FILE, "mcp"),
    seedFormat: DEFAULT_FORMAT,
  },
];

for (const descriptor of DESCRIPTORS) {
  defineHostRecipeSuite(descriptor);
}

void test("WAVE2-03: the descriptors cover exactly the eight wave-2 JSON hosts, in the order of the table", () => {
  assert.deepEqual(DESCRIPTORS.map((d) => d.id), ["cursor", "copilot", "qwen", "augment", "pi", "cline", "antigravity", "kilo"]);
  for (const d of DESCRIPTORS) {
    const recipe = HOST_RUNTIMES[d.id].recipe;
    assert.ok(recipe !== null && recipe.kind === "json-merge", d.id);
    assert.equal(recipe.file, d.file, d.id);
    assert.deepEqual([...recipe.keyPath], [d.parentKey, "realm"], d.id);
    assert.equal(isDeepStrictEqual(recipe.value, d.entry), true, `${d.id}: the descriptor entry is the table value`);
    assert.equal(HOST_RUNTIMES[d.id].envOverride ?? HOST_RUNTIMES[d.id].envBase?.name ?? null, d.override === null ? null : d.override.variable, d.id);
  }
});

interface GoldenCase {
  readonly id: HostId;
  readonly text: string;
  readonly parentKey: string;
  // A key the observation carried that the recipe does not write (augment `env`, observed because the command was given one).
  readonly omit?: string;
}

const GOLDEN_CASES: readonly GoldenCase[] = [
  { id: "copilot", text: COPILOT_MCP_ADD_FILE, parentKey: "mcpServers" },
  { id: "copilot", text: COPILOT_NORMALIZED_FILE, parentKey: "mcpServers" },
  { id: "qwen", text: QWEN_MCP_ADD_FILE, parentKey: "mcpServers" },
  { id: "qwen", text: QWEN_HOST_MIGRATED_FILE, parentKey: "mcpServers" },
  { id: "pi", text: PI_MCP_ADD_FILE, parentKey: "mcpServers" },
  { id: "augment", text: AUGMENT_MCP_ADD_JSON_FILE, parentKey: "mcpServers", omit: "env" },
  { id: "kilo", text: KILO_JSON_REWRITTEN_FILE, parentKey: "mcp" },
];

void test("WAVE2-03: every golden realm entry equals the recipe value (the augment env of the observation excluded)", () => {
  for (const c of GOLDEN_CASES) {
    const parent = parseDoc(c.text)[c.parentKey];
    assert.ok(isRecord(parent), c.id);
    const realm = parent["realm"];
    assert.ok(isRecord(realm), c.id);
    const observed = Object.fromEntries(Object.entries(realm).filter(([name]) => name !== c.omit));
    const recipe = HOST_RUNTIMES[c.id].recipe;
    assert.ok(recipe !== null && recipe.kind === "json-merge", c.id);
    assert.equal(isDeepStrictEqual(observed, recipe.value), true, c.id);
  }
});
