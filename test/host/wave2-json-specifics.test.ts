// Per-host cases of the wave-2 JSON recipes (WAVE2-03), on fixture hosts built from the REAL table rows (25-CONTEXT D-25-02, D-25-05,
// F3, F4): host-rewritten files, JSONC refusal, sibling files, subdirectories, detection look-alikes and the host's own override
// variable against the GSD-only names. Temporary directories only; no host runs. The shared lifecycle is in wave2-json-recipes.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { defaultHostReader, type HostFsReader } from "../../src/host/install.js";
import { defaultManifestFor } from "../../src/host/manifest.js";
import { readReceipt } from "../../src/host/receipt.js";
import { HOST_RUNTIMES, resolveHomes } from "../../src/host/runtimes.js";
import type { HostEnv, HostId } from "../../src/host/types.js";
import {
  AUGMENT_SETTINGS_JSONC,
  CLINE_CLI_NESTED_FILE,
  COPILOT_NORMALIZED_FILE,
  KILO_JSON_REWRITTEN_FILE,
  QWEN_HOST_MIGRATED_FILE,
} from "../support/host-config-goldens.js";
import { treeHash } from "../support/fixture-host.js";
import {
  buildRig,
  executable,
  filesUnder,
  isRecord,
  nothingWritten,
  parseDoc,
  refusedWith,
  render,
  writeSeed,
  type HostSuiteBase,
} from "../support/host-recipe-suite.js";

// ---- shared facts of the eight rows (the suites above prove each row; here only what the cases below need) ------------------------

function base(id: HostId, file: string, home: string, binary: string, variable: string | null, homeOf: (value: string) => string = (value) => value): HostSuiteBase {
  return {
    id,
    req: "WAVE2-03",
    file,
    installHomeRel: home,
    detectHomeRel: home,
    binary,
    override: variable === null ? null : { variable, homeOf },
  };
}

const BASES = {
  cursor: base("cursor", "mcp.json", ".cursor", "cursor-agent", null),
  copilot: base("copilot", "mcp-config.json", ".copilot", "copilot", "COPILOT_HOME"),
  qwen: base("qwen", "settings.json", ".qwen", "qwen", "QWEN_HOME"),
  augment: base("augment", "settings.json", ".augment", "auggie", "AUGMENT_CACHE_DIR"),
  pi: base("pi", "mcp.json", ".pi/agent", "pi", "PI_CODING_AGENT_DIR"),
  cline: base("cline", "data/settings/cline_mcp_settings.json", ".cline", "cline", "CLINE_DIR"),
  antigravity: base("antigravity", "mcp_config.json", ".gemini/config", "agy", null),
  kilo: base("kilo", "kilo.json", ".config/kilo", "kilo", "XDG_CONFIG_HOME", (value) => join(value, "kilo")),
} as const;

const WAVE2_IDS = ["cursor", "copilot", "qwen", "augment", "pi", "cline", "antigravity", "kilo"] as const;

function recipeValue(id: HostId): Record<string, unknown> {
  const recipe = HOST_RUNTIMES[id].recipe;
  assert.ok(recipe !== null && recipe.kind === "json-merge", id);
  assert.ok(isRecord(recipe.value), id);
  return recipe.value;
}

// The server `name` under `parentKey` of a JSON text.
function serverIn(text: string, parentKey: string, name: string): unknown {
  const parent = parseDoc(text)[parentKey];
  assert.ok(isRecord(parent), `${parentKey} is an object`);
  return parent[name];
}

// A document with the realm server removed from its mcpServers object.
function withoutRealm(text: string): Record<string, unknown> {
  const doc = parseDoc(text);
  const parent = doc["mcpServers"];
  assert.ok(isRecord(parent), "mcpServers is an object");
  return { ...doc, mcpServers: Object.fromEntries(Object.entries(parent).filter(([name]) => name !== "realm")) };
}

// A reader that records and fails every call on a path `match` accepts, and passes the others to the real file system.
function guardedReader(match: (path: string) => boolean, touched: string[]): HostFsReader {
  const guard = (path: string): void => {
    if (match(path)) {
      touched.push(path);
      throw new Error("a path that does not belong to the recipe was read");
    }
  };
  return {
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
}

const NO_TRAILING = { indent: "  ", eol: "\n", trailing: false } as const;

// ---- all eight --------------------------------------------------------------------------------------------------------------------------

for (const id of WAVE2_IDS) {
  void test(`WAVE2-03 ${id}: the registered entry is defaultManifestFor(${id}).launch with the bare command, and status reports the launch as not-on-path then on-path`, async (t) => {
    const launch = defaultManifestFor(id, "0.0.0").launch;
    assert.ok(launch !== undefined);
    assert.equal(launch.command, "realm");
    assert.deepEqual([...launch.args], ["mcp", "--host", id]);
    const value = recipeValue(id);
    if (id === "kilo") {
      assert.deepEqual(value["command"], [launch.command, ...launch.args]);
    } else {
      assert.equal(value["command"], launch.command);
      assert.deepEqual(value["args"], [...launch.args]);
    }

    const r = buildRig(t, BASES[id]);
    await r.adapter.install(r.env, { dryRun: false });
    const parentKey = id === "kilo" ? "mcp" : "mcpServers";
    assert.equal(isDeepStrictEqual(serverIn(readFileSync(r.file, "utf8"), parentKey, "realm"), value), true);
    assert.equal((await r.adapter.status(r.env)).launch, "not-on-path");
    executable(join(r.binDir, "realm"));
    assert.equal((await r.adapter.status({ ...r.env, pathDirs: [r.binDir] })).launch, "on-path");
  });
}

// ---- copilot ----------------------------------------------------------------------------------------------------------------------------

void test("WAVE2-03 copilot: another server that Copilot normalized is kept byte for byte, status is ok, and uninstall restores the file", async (t) => {
  const seedDoc = withoutRealm(COPILOT_NORMALIZED_FILE);
  const seed = render(seedDoc);
  const other = serverIn(COPILOT_NORMALIZED_FILE, "mcpServers", "other");
  const r = buildRig(t, BASES.copilot, { seed });
  assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "installed");
  assert.equal(readFileSync(r.file, "utf8"), render({ mcpServers: { other, realm: recipeValue("copilot") } }));
  assert.deepEqual((await r.adapter.status(r.env)).entries, [{ path: "mcp-config.json", state: "ok" }]);
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  assert.equal(readFileSync(r.file, "utf8"), seed);
});

void test("WAVE2-03 copilot: Copilot's own rewrite after install (tools first, realm before another server) is not drift", async (t) => {
  const r = buildRig(t, BASES.copilot, { seed: render(withoutRealm(COPILOT_NORMALIZED_FILE)) });
  await r.adapter.install(r.env, { dryRun: false });
  writeSeed(r.file, COPILOT_NORMALIZED_FILE);
  const status = await r.adapter.status(r.env);
  assert.equal(status.status, "installed");
  assert.deepEqual(status.entries, [{ path: "mcp-config.json", state: "ok" }]);
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  assert.deepEqual(parseDoc(readFileSync(r.file, "utf8")), withoutRealm(COPILOT_NORMALIZED_FILE));
});

void test("WAVE2-03 copilot: a hand-written realm entry without the canonical tools is foreign-content and is not rewritten", async (t) => {
  const seed = render({ mcpServers: { realm: { type: "local", command: "realm", args: ["mcp", "--host", "copilot"] } } });
  const r = buildRig(t, BASES.copilot, { seed });
  const before = treeHash(r.host.root);
  for (const dryRun of [true, false]) {
    await assert.rejects(r.adapter.install(r.env, { dryRun }), refusedWith("foreign-content", "POLICY_DENIED"));
  }
  nothingWritten(r, BASES.copilot, before);
  assert.equal(readFileSync(r.file, "utf8"), seed);
});

void test("WAVE2-03 copilot: the lock file Copilot keeps beside the file is never read, created or removed by Realm", async (t) => {
  const touched: string[] = [];
  const r = buildRig(t, BASES.copilot, { deps: { reader: guardedReader((path) => path.endsWith(".copilot-mcp.lock"), touched) } });
  const lock = join(r.homeDir, "mcp-config.json.copilot-mcp.lock");
  writeSeed(lock, "lock-owner\n");
  await r.adapter.install(r.env, { dryRun: false });
  assert.equal((await r.adapter.status(r.env)).status, "installed");
  assert.deepEqual(filesUnder(r.homeDir), ["mcp-config.json", "mcp-config.json.copilot-mcp.lock"]);
  await r.adapter.uninstall(r.env, { dryRun: false });
  assert.equal(readFileSync(lock, "utf8"), "lock-owner\n");
  assert.deepEqual(filesUnder(r.homeDir), ["mcp-config.json.copilot-mcp.lock"]);
  assert.deepEqual(touched, []);
});

// ---- qwen -------------------------------------------------------------------------------------------------------------------------------

void test("WAVE2-03 qwen: a settings file Qwen migrated (ui.theme, $version) keeps every other key and the missing trailing newline", async (t) => {
  const seedDoc = withoutRealm(QWEN_HOST_MIGRATED_FILE);
  const seed = render(seedDoc, NO_TRAILING);
  const r = buildRig(t, BASES.qwen, { seed });
  await r.adapter.install(r.env, { dryRun: false });
  const text = readFileSync(r.file, "utf8");
  assert.equal(text, render({ ...seedDoc, mcpServers: { realm: recipeValue("qwen") } }, NO_TRAILING));
  const doc = parseDoc(text);
  assert.deepEqual(doc["ui"], { theme: "example-theme" });
  assert.equal(doc["$version"], 4);
  await r.adapter.uninstall(r.env, { dryRun: false });
  assert.equal(readFileSync(r.file, "utf8"), seed);
});

void test("WAVE2-03 qwen: a settings file with // comments is unparseable (Qwen strips them itself) and nothing is written", async (t) => {
  const seed = '{\n  // theme\n  "theme": "example-theme",\n  "mcpServers": {}\n}';
  const r = buildRig(t, BASES.qwen, { seed });
  const before = treeHash(r.host.root);
  for (const dryRun of [true, false]) {
    await assert.rejects(r.adapter.install(r.env, { dryRun }), refusedWith("unparseable", "SCHEMA_INVALID"));
  }
  nothingWritten(r, BASES.qwen, before);
});

void test("WAVE2-03 qwen: QWEN_HOME moves the file to <dir>/settings.json and ~/.qwen stays untouched", async (t) => {
  const r = buildRig(t, BASES.qwen, { override: true });
  const defaultHome = join(r.host.home, ".qwen");
  const before = treeHash(defaultHome);
  await r.adapter.install(r.env, { dryRun: false });
  assert.equal(r.file, join(r.overrideDir, "settings.json"));
  assert.equal(existsSync(r.file), true);
  assert.equal(treeHash(defaultHome), before);
});

// ---- augment ----------------------------------------------------------------------------------------------------------------------------

void test("WAVE2-03 augment: a shared settings file that Auggie keeps as JSONC (a comment, a trailing comma) is unparseable and nothing is written", async (t) => {
  const r = buildRig(t, BASES.augment, { seed: AUGMENT_SETTINGS_JSONC });
  const before = treeHash(r.host.root);
  for (const dryRun of [true, false]) {
    await assert.rejects(r.adapter.install(r.env, { dryRun }), refusedWith("unparseable", "SCHEMA_INVALID"));
  }
  nothingWritten(r, BASES.augment, before);
  assert.equal(readFileSync(r.file, "utf8"), AUGMENT_SETTINGS_JSONC);
});

void test("WAVE2-03 augment: a one-line settings file keeps every key and value through install and uninstall (the engine re-renders it with the file's detected indent)", async (t) => {
  const doc = { model: "example-model", hooks: { PreToolUse: [] } };
  const seed = JSON.stringify(doc);
  const r = buildRig(t, BASES.augment, { seed });
  await r.adapter.install(r.env, { dryRun: false });
  assert.deepEqual(parseDoc(readFileSync(r.file, "utf8")), { ...doc, mcpServers: { realm: recipeValue("augment") } });
  assert.equal(readFileSync(r.file, "utf8").endsWith("\n"), false, "the trailing-newline state is kept");
  await r.adapter.uninstall(r.env, { dryRun: false });
  assert.deepEqual(parseDoc(readFileSync(r.file, "utf8")), doc);
});

void test("WAVE2-03 augment: AUGMENT_CACHE_DIR moves the file, and the GSD-only AUGMENT_CONFIG_DIR changes nothing", async (t) => {
  const moved = buildRig(t, BASES.augment, { override: true });
  const gsdOnly = join(moved.host.root, "gsd-only");
  const env: HostEnv = { ...moved.env, env: { ...moved.env.env, AUGMENT_CONFIG_DIR: gsdOnly } };
  await moved.adapter.install(env, { dryRun: false });
  assert.equal(moved.file, join(moved.overrideDir, "settings.json"));
  assert.equal(existsSync(moved.file), true);
  assert.equal(existsSync(gsdOnly), false);

  const plain = buildRig(t, BASES.augment);
  const plainEnv: HostEnv = { ...plain.env, env: { AUGMENT_CONFIG_DIR: join(plain.host.root, "gsd-only") } };
  await plain.adapter.install(plainEnv, { dryRun: false });
  assert.equal(existsSync(join(plain.host.home, ".augment", "settings.json")), true);
  assert.equal(existsSync(join(plain.host.root, "gsd-only")), false);
});

// ---- pi ---------------------------------------------------------------------------------------------------------------------------------

void test("WAVE2-03 pi: PI_CODING_AGENT_DIR resolves the pi and omp homes to the same directory, and a pi install there writes only mcp.json beside extensions/", async (t) => {
  const e: HostEnv = { home: "/home/u", env: { PI_CODING_AGENT_DIR: "/opt/agent" }, pathDirs: [] };
  assert.deepEqual(resolveHomes(HOST_RUNTIMES.pi, e), ["/opt/agent"]);
  assert.deepEqual(resolveHomes(HOST_RUNTIMES.omp, e), ["/opt/agent"]);

  const r = buildRig(t, BASES.pi, { override: true });
  const shim = join(r.homeDir, "extensions", "realm", "index.js");
  writeSeed(shim, "// an omp extension shim\n");
  await r.adapter.install(r.env, { dryRun: false });
  assert.deepEqual(filesUnder(r.homeDir), ["extensions/realm/index.js", "mcp.json"]);
  assert.equal(readFileSync(shim, "utf8"), "// an omp extension shim\n");
  await r.adapter.uninstall(r.env, { dryRun: false });
  assert.deepEqual(filesUnder(r.homeDir), ["extensions/realm/index.js"]);
  assert.equal(readFileSync(shim, "utf8"), "// an omp extension shim\n");
});

void test("WAVE2-03 pi: an mcp.json with a // comment is unparseable (pi mcp add refuses it as well) and nothing is written", async (t) => {
  const r = buildRig(t, BASES.pi, { seed: '{\n  // servers\n  "mcpServers": {}\n}\n' });
  const before = treeHash(r.host.root);
  for (const dryRun of [true, false]) {
    await assert.rejects(r.adapter.install(r.env, { dryRun }), refusedWith("unparseable", "SCHEMA_INVALID"));
  }
  nothingWritten(r, BASES.pi, before);
});

// ---- cline ------------------------------------------------------------------------------------------------------------------------------

void test("WAVE2-03 cline: with ~/.cline present and no data/, install creates data/settings (file mode 0600), the receipt records the directories, and uninstall removes them but not ~/.cline", async (t) => {
  const r = buildRig(t, BASES.cline);
  assert.deepEqual(filesUnder(r.homeDir), []);
  await r.adapter.install(r.env, { dryRun: false });
  assert.deepEqual(filesUnder(r.homeDir), ["data/settings/cline_mcp_settings.json"]);
  assert.equal(statSync(r.file).mode & 0o777, 0o600);
  const receipt = await readReceipt(r.host.stateDir, "cline");
  assert.deepEqual(receipt?.receipt.entries[0]?.createdDirs, [["data"], ["data", "settings"]]);
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  assert.equal(existsSync(join(r.homeDir, "data")), false, "the directories Realm created are gone");
  assert.equal(existsSync(r.homeDir), true, "~/.cline itself is never removed");
});

void test("WAVE2-03 cline: with ~/.cline absent install is config-home-missing and creates nothing", async (t) => {
  const r = buildRig(t, BASES.cline, { home: false, path: true });
  executable(join(r.binDir, "cline"));
  assert.equal((await r.adapter.detect(r.env)).detected, true);
  const before = treeHash(r.host.root);
  for (const dryRun of [true, false]) {
    await assert.rejects(r.adapter.install(r.env, { dryRun }), refusedWith("config-home-missing", "POLICY_DENIED"));
  }
  nothingWritten(r, BASES.cline, before);
  assert.equal(existsSync(join(r.host.home, ".cline")), false);
});

void test("WAVE2-03 cline: a realm entry in the nested transport shape the Cline CLI writes is foreign-content and is not rewritten", async (t) => {
  const r = buildRig(t, BASES.cline, { seed: CLINE_CLI_NESTED_FILE });
  const before = treeHash(r.host.root);
  for (const dryRun of [true, false]) {
    await assert.rejects(r.adapter.install(r.env, { dryRun }), refusedWith("foreign-content", "POLICY_DENIED"));
  }
  nothingWritten(r, BASES.cline, before);
  assert.equal(readFileSync(r.file, "utf8"), CLINE_CLI_NESTED_FILE);
  assert.equal((await r.adapter.status(r.env)).status, "detected");
});

void test("WAVE2-03 cline: CLINE_DIR moves the whole tree; CLINE_DATA_DIR and CLINE_MCP_SETTINGS_PATH change nothing (documented gap, OQ-25-08)", async (t) => {
  const moved = buildRig(t, BASES.cline, { override: true });
  const defaultHome = join(moved.host.home, ".cline");
  const before = treeHash(defaultHome);
  await moved.adapter.install(moved.env, { dryRun: false });
  assert.equal(moved.file, join(moved.overrideDir, "data", "settings", "cline_mcp_settings.json"));
  assert.equal(existsSync(moved.file), true);
  assert.equal(treeHash(defaultHome), before);

  const plain = buildRig(t, BASES.cline);
  const dataDir = join(plain.host.root, "own-data");
  const settingsPath = join(plain.host.root, "own-settings.json");
  const env: HostEnv = { ...plain.env, env: { CLINE_DATA_DIR: dataDir, CLINE_MCP_SETTINGS_PATH: settingsPath } };
  await plain.adapter.install(env, { dryRun: false });
  assert.equal(existsSync(join(plain.host.home, ".cline", "data", "settings", "cline_mcp_settings.json")), true);
  assert.equal(existsSync(dataDir), false);
  assert.equal(existsSync(settingsPath), false);
});

// ---- antigravity ------------------------------------------------------------------------------------------------------------------------

void test("WAVE2-03 antigravity: a bare ~/.gemini (the retired Gemini CLI home) does not detect the host and install refuses not-detected; ~/.gemini/config does detect it", async (t) => {
  const bare = buildRig(t, BASES.antigravity, { home: false });
  mkdirSync(join(bare.host.home, ".gemini"), { recursive: true });
  assert.equal((await bare.adapter.detect(bare.env)).detected, false);
  const before = treeHash(bare.host.root);
  for (const dryRun of [true, false]) {
    await assert.rejects(bare.adapter.install(bare.env, { dryRun }), refusedWith("not-detected", "POLICY_DENIED"));
  }
  nothingWritten(bare, BASES.antigravity, before);

  const configured = buildRig(t, BASES.antigravity);
  const found = await configured.adapter.detect(configured.env);
  assert.equal(found.detected, true);
  assert.equal(found.via, "home");
});

void test("WAVE2-03 antigravity: install writes ~/.gemini/config/mcp_config.json with no type key", async (t) => {
  const r = buildRig(t, BASES.antigravity);
  await r.adapter.install(r.env, { dryRun: false });
  assert.equal(r.file, join(r.host.home, ".gemini", "config", "mcp_config.json"));
  const entry = serverIn(readFileSync(r.file, "utf8"), "mcpServers", "realm");
  assert.ok(isRecord(entry));
  assert.deepEqual(Object.keys(entry), ["command", "args"]);
});

void test("WAVE2-03 antigravity: with only ~/.gemini and agy on PATH the host is detected by its binary and install is config-home-missing", async (t) => {
  const r = buildRig(t, BASES.antigravity, { home: false, path: true });
  mkdirSync(join(r.host.home, ".gemini"), { recursive: true });
  executable(join(r.binDir, "agy"));
  assert.equal((await r.adapter.detect(r.env)).via, "binary");
  const before = treeHash(r.host.root);
  for (const dryRun of [true, false]) {
    await assert.rejects(r.adapter.install(r.env, { dryRun }), refusedWith("config-home-missing", "POLICY_DENIED"));
  }
  nothingWritten(r, BASES.antigravity, before);
});

// ---- kilo -------------------------------------------------------------------------------------------------------------------------------

void test("WAVE2-03 kilo: a sibling kilo.jsonc is never read and is byte-identical after install and uninstall", async (t) => {
  const jsonc = '{\n  // a user comment\n  "mcp": {\n    "a": { "type": "local", "command": ["a-command"] }\n  },\n}\n';
  const touched: string[] = [];
  const r = buildRig(t, BASES.kilo, { deps: { reader: guardedReader((path) => path.endsWith(".jsonc"), touched) } });
  writeSeed(join(r.homeDir, "kilo.jsonc"), jsonc);
  assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "installed");
  assert.equal(readFileSync(join(r.homeDir, "kilo.jsonc"), "utf8"), jsonc);
  assert.deepEqual(filesUnder(r.homeDir), ["kilo.json", "kilo.jsonc"]);
  assert.equal((await r.adapter.status(r.env)).status, "installed");
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  assert.equal(readFileSync(join(r.homeDir, "kilo.jsonc"), "utf8"), jsonc);
  assert.deepEqual(filesUnder(r.homeDir), ["kilo.jsonc"]);
  assert.deepEqual(touched, [], "no operation looked at the .jsonc path");
});

void test("WAVE2-03 kilo: a kilo.json with a comment or a trailing comma is unparseable and not rewritten", async (t) => {
  for (const seed of ['{\n  // a user comment\n  "mcp": {}\n}\n', '{\n  "mcp": {},\n}\n']) {
    const r = buildRig(t, BASES.kilo, { seed });
    const before = treeHash(r.host.root);
    for (const dryRun of [true, false]) {
      await assert.rejects(r.adapter.install(r.env, { dryRun }), refusedWith("unparseable", "SCHEMA_INVALID"), seed);
    }
    nothingWritten(r, BASES.kilo, before);
  }
});

void test("WAVE2-03 kilo: the file Kilo rewrote ($schema first, permission last) is accepted, stays ok after install, and uninstall restores the user's other keys", async (t) => {
  const seedDoc = { $schema: "https://app.kilo.ai/config.json", permission: { bash: "allow" } };
  const r = buildRig(t, BASES.kilo, { seed: render(seedDoc) });
  await r.adapter.install(r.env, { dryRun: false });
  writeSeed(r.file, KILO_JSON_REWRITTEN_FILE);
  const status = await r.adapter.status(r.env);
  assert.equal(status.status, "installed");
  assert.deepEqual(status.entries, [{ path: "kilo.json", state: "ok" }]);
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  assert.deepEqual(parseDoc(readFileSync(r.file, "utf8")), seedDoc);
});

void test("WAVE2-03 kilo: a host with only ~/.kilo is detected (a skills home) but install is config-home-missing and creates nothing", async (t) => {
  const r = buildRig(t, BASES.kilo, { home: false });
  mkdirSync(join(r.host.home, ".kilo"), { recursive: true });
  const found = await r.adapter.detect(r.env);
  assert.equal(found.detected, true);
  assert.equal(found.via, "home");
  const before = treeHash(r.host.root);
  for (const dryRun of [true, false]) {
    await assert.rejects(r.adapter.install(r.env, { dryRun }), refusedWith("config-home-missing", "POLICY_DENIED"));
  }
  nothingWritten(r, BASES.kilo, before);
  assert.equal(existsSync(join(r.host.home, ".config")), false);
});

void test("WAVE2-03 kilo: XDG_CONFIG_HOME writes <base>/kilo/kilo.json and leaves ~/.config/kilo untouched, and the GSD-only KILO_CONFIG_DIR changes nothing", async (t) => {
  const moved = buildRig(t, BASES.kilo, { override: true });
  const gsdOnly = join(moved.host.root, "gsd-only");
  const env: HostEnv = { ...moved.env, env: { ...moved.env.env, KILO_CONFIG_DIR: gsdOnly } };
  const defaultHome = join(moved.host.home, ".config", "kilo");
  const before = treeHash(defaultHome);
  await moved.adapter.install(env, { dryRun: false });
  assert.equal(moved.file, join(moved.overrideDir, "kilo", "kilo.json"));
  assert.equal(existsSync(moved.file), true);
  assert.equal(treeHash(defaultHome), before);
  assert.equal(existsSync(gsdOnly), false);
});

// ---- cursor -----------------------------------------------------------------------------------------------------------------------------

void test("WAVE2-03 cursor: a ~/.cursor that holds only Cursor's other files is detected and mcp.json is written beside them without touching them; CURSOR_CONFIG_DIR changes nothing", async (t) => {
  const r = buildRig(t, BASES.cursor);
  writeSeed(join(r.homeDir, "cli-config.json"), '{"version":1}\n');
  writeSeed(join(r.homeDir, "argv.json"), '{"enable-crash-reporter":false}\n');
  assert.equal((await r.adapter.detect(r.env)).detected, true);
  const env: HostEnv = { ...r.env, env: { CURSOR_CONFIG_DIR: join(r.host.root, "gsd-only"), XDG_CONFIG_HOME: join(r.host.root, "xdg") } };
  await r.adapter.install(env, { dryRun: false });
  assert.deepEqual(filesUnder(r.homeDir), ["argv.json", "cli-config.json", "mcp.json"]);
  assert.equal(readFileSync(join(r.homeDir, "cli-config.json"), "utf8"), '{"version":1}\n');
  assert.equal(readFileSync(join(r.homeDir, "argv.json"), "utf8"), '{"enable-crash-reporter":false}\n');
  assert.equal(existsSync(join(r.host.root, "gsd-only")), false);
  assert.equal(existsSync(join(r.host.root, "xdg")), false);
  await r.adapter.uninstall(env, { dryRun: false });
  assert.deepEqual(filesUnder(r.homeDir), ["argv.json", "cli-config.json"]);
});
