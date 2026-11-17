// The OpenCode recipe (ADPT-05) on fixture hosts built from the real table row: the V1-shaped entry mcp.realm in
// <XDG_CONFIG_HOME or ~/.config>/opencode/opencode.json (24-CONTEXT D-24-03). Temporary directories only; no OpenCode runs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { defaultHostReader, type HostFsReader } from "../../src/host/install.js";
import { defaultManifestFor } from "../../src/host/manifest.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { OPENCODE_V1_FILE, OPENCODE_V2_DOC_FILE } from "../support/host-config-goldens.js";
import { treeHash } from "../support/fixture-host.js";
import {
  buildRig,
  defineHostRecipeSuite,
  DEFAULT_FORMAT,
  executable,
  filesUnder,
  nothingWritten,
  parseDoc,
  refusedWith,
  writeSeed,
  type JsonSuiteDescriptor,
} from "../support/host-recipe-suite.js";

const ENTRY = { type: "local", command: ["realm", "mcp", "--host", "opencode"] } as const;

const DESCRIPTOR: JsonSuiteDescriptor = {
  id: "opencode",
  req: "ADPT-05",
  file: "opencode.json",
  installHomeRel: ".config/opencode",
  detectHomeRel: ".config/opencode",
  binary: "opencode",
  // XDG_CONFIG_HOME is a base: the home is <base>/opencode.
  override: { variable: "XDG_CONFIG_HOME", homeOf: (value) => join(value, "opencode") },
  parentKey: "mcp",
  entry: ENTRY,
  seedDoc: { $schema: "https://opencode.ai/config.json", model: "provider/model-name" },
  seedFormat: DEFAULT_FORMAT,
};

defineHostRecipeSuite(DESCRIPTOR);

void test("ADPT-05 opencode: the default file is <home>/.config/opencode/opencode.json, and the registered command array is the manifest launch", async (t) => {
  const r = buildRig(t, DESCRIPTOR);
  assert.equal(r.file, join(r.host.home, ".config", "opencode", "opencode.json"));
  await r.adapter.install(r.env, { dryRun: false });
  assert.deepEqual(parseDoc(readFileSync(r.file, "utf8")), { mcp: { realm: ENTRY } });
  const launch = defaultManifestFor("opencode", "0.0.0").launch;
  assert.ok(launch !== undefined);
  const recipe = HOST_RUNTIMES.opencode.recipe;
  assert.ok(recipe !== null && recipe.kind === "json-merge");
  assert.deepEqual(recipe.value, { type: "local", command: [launch.command, ...launch.args] });
  assert.deepEqual([...recipe.keyPath], ["mcp", "realm"]);
});

void test("ADPT-05 opencode: with XDG_CONFIG_HOME set the file is <base>/opencode/opencode.json and <home>/.config/opencode is untouched", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { override: true });
  const defaultHome = join(r.host.home, ".config", "opencode");
  const before = treeHash(defaultHome);
  await r.adapter.install(r.env, { dryRun: false });
  assert.equal(existsSync(join(r.overrideDir, "opencode", "opencode.json")), true);
  assert.equal(r.file, join(r.overrideDir, "opencode", "opencode.json"));
  assert.equal(treeHash(defaultHome), before);
});

void test("ADPT-05 opencode: ~/.config/opencode absent is config-home-missing and writes nothing; --config-home to a created directory installs", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { home: false, path: true });
  executable(join(r.binDir, "opencode"));
  assert.equal((await r.adapter.detect(r.env)).via, "binary");
  const before = treeHash(r.host.root);
  for (const dryRun of [true, false]) {
    await assert.rejects(r.adapter.install(r.env, { dryRun }), refusedWith("config-home-missing", "POLICY_DENIED"));
  }
  nothingWritten(r, DESCRIPTOR, before);
  assert.equal(existsSync(join(r.host.home, ".config")), false, "no config directory is created");

  const dir = join(r.host.root, "chosen");
  mkdirSync(dir);
  assert.equal((await r.adapter.install(r.env, { dryRun: false, configHome: dir })).outcome, "installed");
  assert.deepEqual(filesUnder(dir), ["opencode.json"]);
});

void test("ADPT-05 opencode: a JSONC opencode.json (a comment, a trailing comma) is refused as unparseable and not rewritten", async (t) => {
  for (const seed of ['{\n  // pick a model\n  "model": "x"\n}\n', '{\n  "model": "x",\n}\n', '{\n  /* block */\n  "model": "x"\n}\n']) {
    const r = buildRig(t, DESCRIPTOR, { seed });
    const before = treeHash(r.host.root);
    await assert.rejects(r.adapter.install(r.env, { dryRun: false }), refusedWith("unparseable", "SCHEMA_INVALID"), seed);
    nothingWritten(r, DESCRIPTOR, before);
  }
});

void test("ADPT-05 opencode: a sibling opencode.jsonc is never read and is byte-identical after install and uninstall", async (t) => {
  const jsonc = '{\n  // a user comment\n  "mcp": {\n    "realm": { "type": "local", "command": ["something-else"] }\n  },\n}\n';
  const touched: string[] = [];
  const guard = (path: string): void => {
    if (path.endsWith(".jsonc")) {
      touched.push(path);
      throw new Error("the jsonc file must never be read");
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
  const r = buildRig(t, DESCRIPTOR, { deps: { reader } });
  writeSeed(join(r.homeDir, "opencode.jsonc"), jsonc);
  assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "installed");
  assert.equal(readFileSync(join(r.homeDir, "opencode.jsonc"), "utf8"), jsonc);
  assert.deepEqual(filesUnder(r.homeDir), ["opencode.json", "opencode.jsonc"]);
  assert.equal((await r.adapter.status(r.env)).status, "installed");
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  assert.equal(readFileSync(join(r.homeDir, "opencode.jsonc"), "utf8"), jsonc);
  assert.deepEqual(filesUnder(r.homeDir), ["opencode.jsonc"]);
  assert.deepEqual(touched, [], "no operation looked at the .jsonc path");
});

void test("ADPT-05 opencode: the golden V1 file (the shape `opencode mcp list` parsed) installs as a no-op", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { seed: OPENCODE_V1_FILE });
  const before = treeHash(r.host.root);
  assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "noop");
  nothingWritten(r, DESCRIPTOR, before);
  assert.deepEqual(parseDoc(OPENCODE_V1_FILE), { mcp: { realm: ENTRY } });
});

void test("ADPT-05 opencode: the V2 documentation file gets mcp.realm beside mcp.servers, which stays untouched (a user-made mcp.servers.realm is not seen: OQ-24-07)", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { seed: OPENCODE_V2_DOC_FILE });
  const original = parseDoc(OPENCODE_V2_DOC_FILE);
  await r.adapter.install(r.env, { dryRun: false });
  const after = parseDoc(readFileSync(r.file, "utf8"));
  const mcp = after["mcp"] as Record<string, unknown>;
  assert.deepEqual(Object.keys(mcp), ["servers", "realm"]);
  assert.equal(isDeepStrictEqual(mcp["servers"], (original["mcp"] as Record<string, unknown>)["servers"]), true);
  assert.deepEqual(mcp["realm"], ENTRY);
  assert.equal(after["$schema"], "https://opencode.ai/config.json");
  await r.adapter.uninstall(r.env, { dryRun: false });
  assert.equal(readFileSync(r.file, "utf8"), OPENCODE_V2_DOC_FILE);
});

void test("ADPT-05 opencode: a file holding only $schema and model keeps both, and uninstall restores the original bytes", async (t) => {
  const seed = '{\n  "$schema": "https://opencode.ai/config.json",\n  "model": "provider/model-name"\n}\n';
  const r = buildRig(t, DESCRIPTOR, { seed });
  await r.adapter.install(r.env, { dryRun: false });
  const after = parseDoc(readFileSync(r.file, "utf8"));
  assert.deepEqual(Object.keys(after), ["$schema", "model", "mcp"]);
  assert.equal(after["model"], "provider/model-name");
  await r.adapter.uninstall(r.env, { dryRun: false });
  assert.equal(readFileSync(r.file, "utf8"), seed);
});
