// The Hermes recipe (WAVE2-05) on fixture hosts built from the real table row: the `yaml-map` entry `mcp_servers.realm` in
// <HERMES_HOME or ~/.hermes>/config.yaml (25-CONTEXT D-25-04, E-HM1..E-HM3), owned by key and by parsed value, with no comment marker.
// Temporary directories only; no Hermes runs: its own writer and its own re-quoting are simulated from the observed golden. The shared
// YAML case table (test/support/host-yaml-cases.ts) is installed and uninstalled through the real row by defineHostYamlSuite.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { defaultHostReader, type HostFsReader } from "../../src/host/install.js";
import { defaultManifestFor } from "../../src/host/manifest.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { HERMES_DOC_FILE, HERMES_REAL_SHAPED_FILE, HERMES_REAL_SHAPED_PARTS, HERMES_SAVE_MCP_SERVER_FILE } from "../support/host-config-goldens.js";
import { treeHash } from "../support/fixture-host.js";
import { BLOCK, ENTRY_2 } from "../support/host-yaml-cases.js";
import {
  buildRig,
  defineHostYamlSuite,
  filesUnder,
  MARKER,
  nothingWritten,
  refusedWith,
  writeSeed,
  type YamlSuiteDescriptor,
} from "../support/host-recipe-suite.js";

// What the host's own writer left before Realm: the golden without its `mcp_servers` block.
const SEED = HERMES_SAVE_MCP_SERVER_FILE.replace(/mcp_servers:[\s\S]*$/, "");

const DESCRIPTOR: YamlSuiteDescriptor = {
  id: "hermes",
  req: "WAVE2-05",
  file: "config.yaml",
  installHomeRel: ".hermes",
  detectHomeRel: ".hermes",
  binary: "hermes",
  override: { variable: "HERMES_HOME", homeOf: (value) => value },
  seed: SEED,
};

defineHostYamlSuite(DESCRIPTOR);

void test("WAVE2-05 hermes: the seed is the golden minus its mcp_servers block, and the golden is exactly what an install over it writes", () => {
  assert.ok(SEED.endsWith("_config_version: 53\n"));
  assert.equal(SEED.includes("mcp_servers"), false);
  assert.equal(`${SEED}${BLOCK}`, HERMES_SAVE_MCP_SERVER_FILE, "the host's own writer and Realm write the same entry");
});

void test("WAVE2-05 hermes: the table row registers the recipe value that equals defaultManifestFor('hermes').launch", () => {
  const recipe = HOST_RUNTIMES.hermes.recipe;
  assert.ok(recipe !== null && recipe.kind === "yaml-map");
  const launch = defaultManifestFor("hermes", "0.0.0").launch;
  assert.ok(launch !== undefined);
  assert.deepEqual(recipe.value, { command: launch.command, args: [...launch.args] });
  assert.deepEqual(recipe.path, ["mcp_servers", "realm"], "mcp_servers, not mcpServers (E-HM1)");
  assert.equal(recipe.file, "config.yaml");
  assert.equal(recipe.homeRole, undefined);
  assert.equal(HOST_RUNTIMES.hermes.envOverride, "HERMES_HOME");
  assert.deepEqual(HOST_RUNTIMES.hermes.binaries, ["hermes"]);
  assert.equal(HOST_RUNTIMES.hermes.shadows, undefined);
});

void test("WAVE2-05 hermes: a file shaped like the real one installs and uninstalls to the original bytes, and the diff is exactly the entry's lines", async (t) => {
  assert.ok(HERMES_REAL_SHAPED_FILE.split("\n").length > 250, "a long file");
  const r = buildRig(t, DESCRIPTOR, { seed: HERMES_REAL_SHAPED_FILE });
  assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "installed");
  const installed = readFileSync(r.file, "utf8");
  assert.equal(installed, `${HERMES_REAL_SHAPED_PARTS.head}${HERMES_REAL_SHAPED_PARTS.servers}${ENTRY_2}${HERMES_REAL_SHAPED_PARTS.tail}`);
  assert.equal(installed.length - HERMES_REAL_SHAPED_FILE.length, ENTRY_2.length);
  assert.equal(installed.replace(ENTRY_2, ""), HERMES_REAL_SHAPED_FILE);
  assert.equal(installed.split("\n").length - HERMES_REAL_SHAPED_FILE.split("\n").length, ENTRY_2.split("\n").length - 1, "six new lines");
  assert.equal((await r.adapter.status(r.env)).status, "installed");
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  assert.equal(readFileSync(r.file, "utf8"), HERMES_REAL_SHAPED_FILE);
});

void test("WAVE2-05 hermes: the host's own output (_save_mcp_server) already holds the entry: a no-op that Realm does not claim", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { seed: HERMES_SAVE_MCP_SERVER_FILE });
  const before = treeHash(r.host.root);
  assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "noop");
  nothingWritten(r, DESCRIPTOR, before);
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "noop");
  assert.equal(readFileSync(r.file, "utf8"), HERMES_SAVE_MCP_SERVER_FILE, "the host's own entry stays");
});

void test("WAVE2-05 hermes: the documented file (a sibling with a flow-style args) takes the entry below it and gives it back", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { seed: HERMES_DOC_FILE });
  assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "installed");
  assert.equal(readFileSync(r.file, "utf8"), `${HERMES_DOC_FILE}${ENTRY_2}`);
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  assert.equal(readFileSync(r.file, "utf8"), HERMES_DOC_FILE);
});

void test("WAVE2-05 hermes: the host's own rewrite of the entry (re-quoted, flow args, an added blank line) keeps `realm host status` ok", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { seed: HERMES_REAL_SHAPED_FILE });
  await r.adapter.install(r.env, { dryRun: false });
  const rewritten = readFileSync(r.file, "utf8").replace(ENTRY_2, '  realm:\n    command: "realm"\n    args: ["mcp", "--host", "hermes"]\n\n');
  writeFileSync(r.file, rewritten);
  const status = await r.adapter.status(r.env);
  assert.equal(status.status, "installed");
  assert.deepEqual(status.entries, [{ path: "config.yaml", state: "ok" }]);
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  // The blank line the host added stays: it lies outside the entry's lines.
  assert.equal(readFileSync(r.file, "utf8"), `${HERMES_REAL_SHAPED_PARTS.head}${HERMES_REAL_SHAPED_PARTS.servers}\n${HERMES_REAL_SHAPED_PARTS.tail}`);
});

void test("WAVE2-05 hermes: a rewrite that adds `enabled: true` to the entry is drifted, and uninstall refuses (OQ-25-10, asserted so it stays visible)", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { seed: SEED });
  await r.adapter.install(r.env, { dryRun: false });
  writeFileSync(r.file, readFileSync(r.file, "utf8").replace("    command: realm\n", "    command: realm\n    enabled: true\n"));
  const status = await r.adapter.status(r.env);
  assert.equal(status.status, "drifted");
  assert.deepEqual(status.entries, [{ path: "config.yaml", state: "drifted" }]);
  const before = treeHash(r.host.root);
  await assert.rejects(r.adapter.uninstall(r.env, { dryRun: false }), refusedWith("drifted", "POLICY_DENIED"));
  await assert.rejects(r.adapter.install(r.env, { dryRun: false }), refusedWith("foreign-content", "POLICY_DENIED"));
  assert.equal(treeHash(r.host.root), before, "a refusal changes nothing");
});

void test("WAVE2-05 hermes: a file Realm creates is `mcp_servers:` plus the entry only, mode 0600, and uninstall removes it", async (t) => {
  const r = buildRig(t, DESCRIPTOR);
  assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "installed");
  assert.equal(readFileSync(r.file, "utf8"), BLOCK);
  assert.equal(readFileSync(r.file, "utf8"), "mcp_servers:\n  realm:\n    command: realm\n    args:\n      - mcp\n      - --host\n      - hermes\n");
  assert.equal(statSync(r.file).mode & 0o777, 0o600);
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  assert.equal(existsSync(r.file), false);
  assert.deepEqual(filesUnder(r.homeDir), []);
});

void test("WAVE2-05 hermes: other files in HERMES_HOME (a .env with secrets) are never read or changed", async (t) => {
  const touched: string[] = [];
  const guard = (path: string): void => {
    if (path.endsWith(".env")) {
      touched.push(path);
      throw new Error("the .env file must never be read");
    }
  };
  const reader: HostFsReader = {
    realpath: (path) => {
      guard(path);
      return defaultHostReader.realpath(path);
    },
    lstat: (path) => {
      guard(path);
      return defaultHostReader.lstat(path);
    },
    stat: (path) => {
      guard(path);
      return defaultHostReader.stat(path);
    },
    readFile: (path, maxBytes) => {
      guard(path);
      return defaultHostReader.readFile(path, maxBytes);
    },
    readdir: (path) => {
      guard(path);
      return defaultHostReader.readdir(path);
    },
  };
  const r = buildRig(t, DESCRIPTOR, { seed: SEED, deps: { reader } });
  const secrets = `TOKEN=${MARKER}\n`;
  writeSeed(join(r.homeDir, ".env"), secrets);
  await r.adapter.install(r.env, { dryRun: false });
  await r.adapter.uninstall(r.env, { dryRun: false });
  assert.equal(readFileSync(join(r.homeDir, ".env"), "utf8"), secrets);
  assert.deepEqual(touched, []);
});

void test("WAVE2-05 hermes: the Agent Plugins bundle adapters/hermes-agent is not read by an install and is unchanged", async (t) => {
  const bundle = fileURLToPath(new URL("../../../adapters/hermes-agent", import.meta.url));
  const bundleBefore = existsSync(bundle) ? treeHash(bundle) : "absent";
  const touched: string[] = [];
  let adaptersDir = "\u0000";
  const guard = (path: string): void => {
    if (path.includes("hermes-agent") || path.startsWith(adaptersDir)) {
      touched.push(path);
      throw new Error("the adapters directory must never be read");
    }
  };
  const reader: HostFsReader = {
    realpath: (path) => {
      guard(path);
      return defaultHostReader.realpath(path);
    },
    lstat: (path) => {
      guard(path);
      return defaultHostReader.lstat(path);
    },
    stat: (path) => {
      guard(path);
      return defaultHostReader.stat(path);
    },
    readFile: (path, maxBytes) => {
      guard(path);
      return defaultHostReader.readFile(path, maxBytes);
    },
    readdir: (path) => {
      guard(path);
      return defaultHostReader.readdir(path);
    },
  };
  const r = buildRig(t, DESCRIPTOR, { seed: SEED, deps: { reader } });
  adaptersDir = r.host.adaptersDir;
  await r.adapter.install(r.env, { dryRun: false });
  await r.adapter.uninstall(r.env, { dryRun: false });
  assert.deepEqual(touched, []);
  assert.equal(existsSync(bundle) ? treeHash(bundle) : "absent", bundleBefore);
});
