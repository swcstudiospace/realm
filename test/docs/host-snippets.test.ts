import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file runs from dist/test/docs, so three levels up is the package root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function readDoc(...segments: string[]): string {
  return readFileSync(join(ROOT, ...segments), "utf8");
}

void test("CLI-04: hosts.md records the Muse Code official URLs and the new read date", () => {
  const text = readDoc("docs", "integration", "hosts.md");
  assert.ok(
    text.includes("https://dev.meta.ai/docs/muse-code/extending"),
    "must name the Muse Code extending page",
  );
  assert.ok(
    text.includes("https://dev.meta.ai/docs/muse-code/configuration"),
    "must name the Muse Code configuration page",
  );
  assert.ok(text.includes("2026-10-22"), "must carry the Muse Code read date");
});

void test("CLI-04: hosts.md records the settings.json, schema_version, mcp_servers, and transport facts", () => {
  const text = readDoc("docs", "integration", "hosts.md");
  assert.ok(text.includes("settings.json"), "must name settings.json");
  assert.ok(text.includes("schema_version"), "must name schema_version");
  assert.ok(text.includes("mcp_servers"), "must name mcp_servers");
  assert.ok(
    text.includes("streamable_http"),
    "must name the streamable_http transport",
  );
});

void test("CLI-04: muse-code.md gives only the documented settings shape pointing at the realm mcp stdio entry", () => {
  const snippet = readDoc("docs", "hosts", "snippets", "muse-code.md");
  assert.ok(
    snippet.includes('"schema_version": 1'),
    "must pin schema_version 1",
  );
  assert.ok(snippet.includes('"mcp_servers"'), "must use the mcp_servers block");
  assert.ok(
    snippet.includes('"transport": "stdio"'),
    "must use the stdio transport",
  );
  assert.ok(snippet.includes('"command": "realm"'), "must run the realm command");
  assert.ok(snippet.includes('"args": ["mcp"]'), "must pass the mcp argv");
  assert.ok(
    snippet.includes("https://dev.meta.ai/docs/muse-code/extending"),
    "must cite the official URL",
  );
  assert.ok(snippet.includes("2026-10-22"), "must cite the read date");
});

void test("CLI-04: omp.md loads the built Realm extension by path and names no unverified MCP key layout", () => {
  const snippet = readDoc("docs", "hosts", "snippets", "omp.md");
  assert.ok(
    snippet.includes("dist/src/omp/extension.js"),
    "must point at the built extension entry",
  );
  assert.ok(snippet.includes('"omp": {'), "must name the omp key in package.json");
  assert.ok(snippet.includes("omp -e "), "must show the one-session -e load");
  assert.ok(snippet.includes("--dry-run"), "must show the dry-run install check");
  assert.ok(
    snippet.includes("https://omp.sh/docs/extension-authoring"),
    "must cite the official URL",
  );
  assert.ok(
    snippet.includes("## Not documented"),
    "must mark the unverified key layout",
  );
});

void test("CLI-04: claude-code.md gives only the documented add and .mcp.json shapes pointing at the realm mcp stdio entry", () => {
  const snippet = readDoc("docs", "hosts", "snippets", "claude-code.md");
  assert.ok(snippet.includes("mcpServers"), "must name the mcpServers key");
  assert.ok(snippet.includes(".mcp.json"), "must name the .mcp.json file");
  assert.ok(
    snippet.includes("claude mcp add"),
    "must name the documented add command",
  );
  assert.ok(snippet.includes("realm mcp"), "must point at the realm mcp entry");
  assert.ok(
    snippet.includes("https://code.claude.com/docs/en/mcp.md"),
    "must cite the official URL",
  );
  assert.ok(
    snippet.includes("not documented"),
    "must mark ACP as not documented",
  );
});

void test("CLI-04: grok-build.md marks the direct config key not-documented and names the documented Claude Code route", () => {
  const snippet = readDoc("docs", "hosts", "snippets", "grok-build.md");
  assert.ok(
    snippet.includes("not documented"),
    "must mark the direct key not documented",
  );
  assert.ok(
    snippet.includes("~/.grok/config.toml"),
    "must name the config file it refuses to invent in",
  );
  assert.ok(
    snippet.includes("automatically reads Claude Code"),
    "must name the documented compatibility route",
  );
  assert.ok(snippet.includes("realm mcp"), "must point at the realm mcp entry");
});

void test("CLI-04: hermes-agent.md gives only the documented mcp_servers shape pointing at the realm mcp stdio entry", () => {
  const snippet = readDoc("docs", "hosts", "snippets", "hermes-agent.md");
  assert.ok(snippet.includes("mcp_servers"), "must use the mcp_servers key");
  assert.ok(
    snippet.includes("~/.hermes/config.yaml"),
    "must name the config file",
  );
  assert.ok(snippet.includes('command: "realm"'), "must run the realm command");
  assert.ok(snippet.includes('args: ["mcp"]'), "must pass the mcp argv");
  assert.ok(
    snippet.includes(
      "https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp",
    ),
    "must cite the official URL",
  );
  assert.ok(
    snippet.includes("not documented"),
    "must mark ACP consumption as not documented",
  );
});

void test("CLI-04: no snippet carries a credential placeholder", () => {
  for (const name of [
    "omp.md",
    "muse-code.md",
    "claude-code.md",
    "grok-build.md",
    "hermes-agent.md",
  ]) {
    const snippet = readDoc("docs", "hosts", "snippets", name);
    assert.ok(!snippet.includes("Bearer"), `${name} must carry no Bearer token`);
    assert.ok(
      !snippet.includes("Authorization"),
      `${name} must carry no Authorization header`,
    );
  }
});
