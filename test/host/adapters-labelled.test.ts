// The guard on shipped launchers (Phase 34, D-34-07, T-34-15; made total by Phase 40, D-40-08): capability tokens are enforced by
// default, so a launcher the repository ships must not be a bare `realm mcp`. Every launcher in the adapter files (JSON, YAML and
// Markdown), and every `realm mcp` command line or args array in a code fence of docs/hosts/snippets and README.md, carries a
// canonical mcp-config host id; there is no named exception. A bare launcher, an alias, an unknown id, or the id of another host
// in a host's own file fails here with its file and line. Reads files only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { HOST_IDS, type HostId } from "../../src/host/types.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// The canonical ids a stdio session may name with --host (not an alias).
const MCP_CONFIG_IDS: readonly HostId[] = HOST_IDS.filter((id) => HOST_RUNTIMES[id].integration === "mcp-config");

// Each shipped file that is one host's own launcher, and the id it carries (a copy of another host's label fails). The Claude bundle is
// shared with Grok Build by the Grok Build page and stays labelled claude (GAP-40-01).
const OWN_ID_OF_FILE: readonly (readonly [string, HostId])[] = [
  ["adapters/muse-code/mcp-settings.snippet.json", "muse-code"],
  ["docs/hosts/snippets/muse-code.md", "muse-code"],
  ["adapters/prime-agent/MCP.md", "prime-agent"],
  ["docs/hosts/snippets/prime-agent.md", "prime-agent"],
  ["docs/hosts/snippets/grok-build.md", "grok-build"],
  ["adapters/claude-plugin/.mcp.json", "claude"],
  ["adapters/hermes-agent/mcp.json", "hermes"],
  ["adapters/hermes-agent/mcp.snippet.yaml", "hermes"],
];
const SHARED_GROK_BUNDLE = "adapters/claude-plugin/.mcp.json";

interface Launcher {
  readonly file: string;
  readonly line: number;
  // The arguments after `mcp`.
  readonly args: readonly string[];
}

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "node_modules") {
        found.push(...filesUnder(path));
      }
    } else {
      found.push(path);
    }
  }
  return found;
}

const rel = (path: string): string => relative(REPO_ROOT, path).split(sep).join("/");
const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

// The launchers of one block of text: shell command lines (code fences only; a JSON description may say realm mcp), string arrays that are the value of an args or command key (JSON, TOML
// and inline YAML) and YAML block lists whose first element is mcp.
function launchersIn(file: string, text: string, firstLine: number, shellLines: boolean): Launcher[] {
  const found: Launcher[] = [];
  const at = (index: number): number => firstLine + lineOf(text, index) - 1;
  for (const match of shellLines ? text.matchAll(/\brealm mcp\b([^\n]*)/g) : []) {
    found.push({ file, line: at(match.index), args: (match[1] ?? "").split(/\s+/).filter((token) => token !== "") });
  }
  for (const match of text.matchAll(/(?:"args"|\bargs|"command")\s*[:=]\s*(\[\s*"[^"\n]*"(?:\s*,\s*"[^"\n]*")*\s*\])/g)) {
    const items = [...(match[1] ?? "").matchAll(/"([^"\n]*)"/g)].map((item) => item[1] ?? "");
    if (items[0] === "mcp") {
      found.push({ file, line: at(match.index), args: items.slice(1) });
    } else if (items[0] === "realm" && items[1] === "mcp") {
      found.push({ file, line: at(match.index), args: items.slice(2) });
    }
  }
  for (const match of text.matchAll(/^([ \t]*)-[ \t]+mcp[ \t]*\n((?:\1-[ \t]+\S+[ \t]*(?:\n|$))*)/gm)) {
    const items = (match[2] ?? "").split("\n").map((entry) => entry.replace(/^\s*-\s+/, "").trim()).filter((entry) => entry !== "");
    found.push({ file, line: at(match.index), args: items });
  }
  return found;
}

// The text of each code fence of a Markdown file, with the line its body starts on.
function fencesOf(text: string): { readonly body: string; readonly firstLine: number }[] {
  const fences: { body: string; firstLine: number }[] = [];
  const lines = text.split("\n");
  let open: { start: number; lines: string[] } | undefined;
  lines.forEach((line, index) => {
    if (line.trimStart().startsWith("```")) {
      if (open === undefined) {
        open = { start: index + 2, lines: [] };
      } else {
        fences.push({ body: open.lines.join("\n"), firstLine: open.start });
        open = undefined;
      }
    } else if (open !== undefined) {
      open.lines.push(line);
    }
  });
  return fences;
}

function launchersOfFile(path: string): Launcher[] {
  const file = rel(path);
  const text = readFileSync(path, "utf8");
  if (file.endsWith(".md")) {
    return fencesOf(text).flatMap((fence) => launchersIn(file, fence.body, fence.firstLine, true));
  }
  return launchersIn(file, text, 1, false);
}

function shippedLaunchers(): Launcher[] {
  const adapters = filesUnder(join(REPO_ROOT, "adapters")).filter((path) => /\.(json|ya?ml|md)$/.test(path));
  const snippets = readdirSync(join(REPO_ROOT, "docs", "hosts", "snippets"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(REPO_ROOT, "docs", "hosts", "snippets", name));
  return [...adapters, ...snippets, join(REPO_ROOT, "README.md")].flatMap(launchersOfFile);
}

// The host id a launcher carries, or null when it has no --host. A --host that is not a canonical id is reported by the caller.
function hostFlagOf(launcher: Launcher): { readonly present: boolean; readonly value: string | undefined } {
  const at = launcher.args.indexOf("--host");
  return { present: at >= 0, value: launcher.args[at + 1] };
}

const LAUNCHERS = shippedLaunchers();

void test("the scan finds the shipped launchers: the adapters, the snippets and no vacuous pass", () => {
  assert.ok(LAUNCHERS.length >= 20, `found ${String(LAUNCHERS.length)} launchers`);
  for (const file of [
    "adapters/claude-plugin/.mcp.json",
    "adapters/hermes-agent/mcp.json",
    "adapters/hermes-agent/mcp.snippet.yaml",
    "adapters/muse-code/mcp-settings.snippet.json",
    "adapters/prime-agent/MCP.md",
    "docs/hosts/snippets/claude-code.md",
    "docs/hosts/snippets/hermes-agent.md",
    "docs/hosts/snippets/grok-build.md",
    "docs/hosts/snippets/qwen.md",
  ]) {
    assert.ok(
      LAUNCHERS.some((launcher) => launcher.file === file),
      `${file} holds a launcher the scan reads`,
    );
  }
});

void test("every shipped launcher carries a canonical mcp-config host id: the guard is total, with no named exception", () => {
  for (const launcher of LAUNCHERS) {
    const flag = hostFlagOf(launcher);
    const where = `${launcher.file}:${String(launcher.line)}`;
    assert.ok(flag.present, `${where}: a bare realm mcp launcher; the enforced capability-token default refuses it. Add --host ID`);
    assert.ok(
      MCP_CONFIG_IDS.some((id) => id === flag.value),
      `${where}: --host ${String(flag.value)} is not a canonical mcp-config id (an alias or an unknown id is refused by realm mcp)`,
    );
  }
});

for (const [file, id] of OWN_ID_OF_FILE) {
  void test(`${file}: every launcher names its own host id ${id}, and the file holds one`, () => {
    const inFile = LAUNCHERS.filter((launcher) => launcher.file === file);
    assert.ok(inFile.length > 0, `${file} holds a launcher`);
    for (const launcher of inFile) {
      assert.equal(hostFlagOf(launcher).value, id, `${file}:${String(launcher.line)} names another host's id`);
    }
  });
}

void test("the three Phase 40 hosts have ids and recipes, so no host is left without a label", () => {
  const knownIds: readonly string[] = HOST_IDS;
  for (const host of ["muse-code", "prime-agent", "grok-build"] as const) {
    assert.ok(knownIds.includes(host), `${host} has a host id`);
    assert.notEqual(HOST_RUNTIMES[host].recipe, null, `${host} has a recipe`);
  }
});

void test("the shipped Muse Code snippet is the muse-code recipe: the realm entry deep-equals the recipe value and the seed members are the recipe's", () => {
  const recipe = HOST_RUNTIMES["muse-code"].recipe;
  assert.ok(recipe !== null && recipe.kind === "json-merge");
  const snippet = JSON.parse(readFileSync(join(REPO_ROOT, "adapters", "muse-code", "mcp-settings.snippet.json"), "utf8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(snippet).sort(), ["mcpServers", "schema_version"]);
  assert.deepEqual({ schema_version: snippet["schema_version"] }, recipe.seed);
  const servers = snippet["mcpServers"] as Record<string, unknown>;
  assert.deepEqual(Object.keys(servers), ["realm"]);
  assert.deepEqual(servers["realm"], recipe.value);
  assert.equal(Object.hasOwn(snippet, "mcp_servers"), false, "the old spelling is never shipped");
});

void test("the Claude plugin bundle stays labelled claude, shared with Grok Build by its page; the Hermes bundle is labelled hermes", () => {
  const labelOf = (file: string): (string | undefined)[] =>
    LAUNCHERS.filter((launcher) => launcher.file === file).map((launcher) => hostFlagOf(launcher).value);
  assert.deepEqual(labelOf(SHARED_GROK_BUNDLE), ["claude"]);
  assert.deepEqual(labelOf("adapters/hermes-agent/mcp.json"), ["hermes"]);
  assert.deepEqual(labelOf("adapters/hermes-agent/mcp.snippet.yaml"), ["hermes"]);
  const grokPage = readFileSync(join(REPO_ROOT, "docs", "hosts", "snippets", "grok-build.md"), "utf8");
  assert.ok(grokPage.includes("adapters/claude-plugin") && grokPage.includes("claude"), "the Grok Build page says the shared bundle is labelled claude");
});
