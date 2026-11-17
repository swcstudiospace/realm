// The CodeBuddy recipe (WAVE2-04) on fixture hosts built from the real table row: `mcpServers.realm` in <CODEBUDDY_CONFIG_DIR or ~/.codebuddy>/.mcp.json
// (25-CONTEXT E-CB1..E-CB3, D-25-06), with the `shadows` guard: a new .mcp.json hides the legacy mcp.json and ~/.codebuddy.json (observed), so an
// install that would create it next to either is refused. Temporary directories only; no CodeBuddy runs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultManifestFor } from "../../src/host/manifest.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import type { HostEnv } from "../../src/host/types.js";
import { CODEBUDDY_ADD_JSON_FILE } from "../support/host-config-goldens.js";
import { eventsOf, treeHash } from "../support/fixture-host.js";
import {
  buildRig,
  DEFAULT_FORMAT,
  defineHostRecipeSuite,
  filesUnder,
  isRecord,
  nothingWritten,
  parseDoc,
  refusedWith,
  render,
  writeSeed,
  type JsonSuiteDescriptor,
} from "../support/host-recipe-suite.js";

const ENTRY = { type: "stdio", command: "realm", args: ["mcp", "--host", "codebuddy"] } as const;

// The golden `add-json` output with the realm entry removed: what the file was before Realm registered anything.
function seedDoc(): Record<string, unknown> {
  const doc = parseDoc(CODEBUDDY_ADD_JSON_FILE);
  const servers = doc["mcpServers"];
  assert.ok(isRecord(servers));
  return { ...doc, mcpServers: { other: { type: "stdio", command: "other-cmd", args: [] }, ...Object.fromEntries(Object.entries(servers).filter(([name]) => name !== "realm")) } };
}

const DESCRIPTOR: JsonSuiteDescriptor = {
  id: "codebuddy",
  req: "WAVE2-04",
  file: ".mcp.json",
  installHomeRel: ".codebuddy",
  detectHomeRel: ".codebuddy",
  binary: "codebuddy",
  override: { variable: "CODEBUDDY_CONFIG_DIR", homeOf: (value) => value },
  parentKey: "mcpServers",
  entry: ENTRY,
  seedDoc: seedDoc(),
  seedFormat: DEFAULT_FORMAT,
};

defineHostRecipeSuite(DESCRIPTOR);

const LEGACY_SERVERS = '{\n  "mcpServers": {\n    "mine": { "command": "mine" }\n  }\n}\n';

void test("WAVE2-04 codebuddy: the table row carries the shadows, the override variable and the recipe that equals defaultManifestFor('codebuddy').launch", () => {
  const row = HOST_RUNTIMES.codebuddy;
  const recipe = row.recipe;
  assert.ok(recipe !== null && recipe.kind === "json-merge");
  const launch = defaultManifestFor("codebuddy", "0.0.0").launch;
  assert.ok(launch !== undefined);
  assert.deepEqual(recipe.value, { type: "stdio", command: launch.command, args: [...launch.args] });
  assert.deepEqual(recipe.keyPath, ["mcpServers", "realm"]);
  assert.equal(recipe.file, ".mcp.json");
  assert.equal(row.envOverride, "CODEBUDDY_CONFIG_DIR");
  assert.deepEqual(row.shadows, [
    { rel: "mcp.json", base: "config" },
    { rel: ".codebuddy.json", base: "home" },
  ]);
  assert.deepEqual(row.binaries, ["codebuddy"]);
  assert.equal(row.conflicts, undefined);
});

void test("WAVE2-04 codebuddy: the golden `add-json` output already holds the entry: a no-op that Realm does not claim", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { seed: CODEBUDDY_ADD_JSON_FILE });
  const before = treeHash(r.host.root);
  assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "noop");
  nothingWritten(r, DESCRIPTOR, before);
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "noop");
  assert.equal(readFileSync(r.file, "utf8"), CODEBUDDY_ADD_JSON_FILE, "the host's own entry stays");
});

void test("WAVE2-04 codebuddy: a legacy mcp.json in the config home and no .mcp.json is refused, byte-identical, nothing created (E-CB2)", async (t) => {
  const r = buildRig(t, DESCRIPTOR);
  const legacy = join(r.homeDir, "mcp.json");
  writeSeed(legacy, LEGACY_SERVERS);
  const before = treeHash(r.host.root);
  for (const dryRun of [true, false]) {
    await assert.rejects(r.adapter.install(r.env, { dryRun }), refusedWith("foreign-content", "POLICY_DENIED"));
  }
  nothingWritten(r, DESCRIPTOR, before);
  assert.equal(readFileSync(legacy, "utf8"), LEGACY_SERVERS);
  assert.deepEqual(filesUnder(r.homeDir), ["mcp.json"]);
  assert.equal((await r.adapter.status(r.env)).status, "detected");
  const refusals = r.log.lines.filter((line) => line.includes("host.install.refused"));
  assert.equal(refusals.length, 2);
  assert.ok(refusals.every((line) => line.includes('"reason":"foreign-content"') && line.includes('"code":"POLICY_DENIED"')));
  assert.equal(refusals.some((line) => line.includes("mcp.json")), false, "no path in the refusal line");
});

void test("WAVE2-04 codebuddy: a legacy ~/.codebuddy.json in the user's home and no .mcp.json is refused the same way (E-CB2)", async (t) => {
  const r = buildRig(t, DESCRIPTOR);
  const legacy = join(r.host.home, ".codebuddy.json");
  writeSeed(legacy, LEGACY_SERVERS);
  const before = treeHash(r.host.root);
  for (const dryRun of [true, false]) {
    await assert.rejects(r.adapter.install(r.env, { dryRun }), refusedWith("foreign-content", "POLICY_DENIED"));
  }
  nothingWritten(r, DESCRIPTOR, before);
  assert.equal(readFileSync(legacy, "utf8"), LEGACY_SERVERS);
  assert.deepEqual(filesUnder(r.homeDir), []);
});

void test("WAVE2-04 codebuddy: a dangling symlink at either legacy name counts as present", async (t) => {
  for (const [where, name] of [["config", "mcp.json"], ["home", ".codebuddy.json"]] as const) {
    const r = buildRig(t, DESCRIPTOR);
    const link = join(where === "config" ? r.homeDir : r.host.home, name);
    symlinkSync(join(r.host.root, "nowhere"), link);
    const before = treeHash(r.host.root);
    await assert.rejects(r.adapter.install(r.env, { dryRun: false }), refusedWith("foreign-content", "POLICY_DENIED"), where);
    nothingWritten(r, DESCRIPTOR, before);
  }
});

void test("WAVE2-04 codebuddy: with both legacy files and an existing valid .mcp.json, the guard is skipped: install succeeds and the legacy files are untouched (E-CB1)", async (t) => {
  const seed = render(seedDoc(), DEFAULT_FORMAT);
  const r = buildRig(t, DESCRIPTOR, { seed });
  const legacyConfig = join(r.homeDir, "mcp.json");
  const legacyHome = join(r.host.home, ".codebuddy.json");
  writeSeed(legacyConfig, LEGACY_SERVERS);
  writeSeed(legacyHome, LEGACY_SERVERS);
  assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "installed");
  assert.equal(parseDoc(readFileSync(r.file, "utf8"))["mcpServers"] !== undefined, true);
  assert.equal(readFileSync(legacyConfig, "utf8"), LEGACY_SERVERS);
  assert.equal(readFileSync(legacyHome, "utf8"), LEGACY_SERVERS);
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  assert.equal(readFileSync(r.file, "utf8"), seed);
  assert.equal(readFileSync(legacyConfig, "utf8"), LEGACY_SERVERS);
  assert.equal(readFileSync(legacyHome, "utf8"), LEGACY_SERVERS);
});

void test("WAVE2-04 codebuddy: the guard runs for install only: a legacy file that appears later changes neither status nor uninstall", async (t) => {
  const r = buildRig(t, DESCRIPTOR);
  assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "installed");
  writeSeed(join(r.homeDir, "mcp.json"), LEGACY_SERVERS);
  writeSeed(join(r.host.home, ".codebuddy.json"), LEGACY_SERVERS);
  assert.equal((await r.adapter.status(r.env)).status, "installed");
  assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "noop", "the recipe file exists, so the guard is skipped");
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  assert.equal(existsSync(r.file), false);
  assert.equal(readFileSync(join(r.homeDir, "mcp.json"), "utf8"), LEGACY_SERVERS);
});

void test("WAVE2-04 codebuddy: a .mcp.json with a // comment or a trailing comma is unparseable and nothing is written (E-CB3, OQ-25-06)", async (t) => {
  for (const seed of [
    '{\n  // a comment\n  "mcpServers": {}\n}\n',
    '{\n  "mcpServers": {\n    "a": { "command": "a" },\n  }\n}\n',
    '{\n  "mcpServers": {} /* note */\n}\n',
  ]) {
    const r = buildRig(t, DESCRIPTOR, { seed });
    const before = treeHash(r.host.root);
    await assert.rejects(r.adapter.install(r.env, { dryRun: false }), refusedWith("unparseable", "SCHEMA_INVALID"), seed);
    nothingWritten(r, DESCRIPTOR, before);
    assert.equal(readFileSync(r.file, "utf8"), seed);
  }
});

void test("WAVE2-04 codebuddy: after the host's own rewrite (re-indent, an injected type, disabledMcpServers) the status is ok and uninstall leaves the host's additions (E-CB3)", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { seed: render(seedDoc(), DEFAULT_FORMAT) });
  await r.adapter.install(r.env, { dryRun: false });
  const doc = parseDoc(readFileSync(r.file, "utf8"));
  const servers = doc["mcpServers"];
  assert.ok(isRecord(servers));
  const rewritten = {
    ...doc,
    mcpServers: { ...servers, other: { type: "stdio", ...(isRecord(servers["other"]) ? servers["other"] : {}) }, added: { type: "stdio", command: "added" } },
    disabledMcpServers: ["a"],
  };
  writeFileSync(r.file, render(rewritten, { indent: "    ", eol: "\n", trailing: false }));
  const status = await r.adapter.status(r.env);
  assert.equal(status.status, "installed");
  assert.deepEqual(status.entries, [{ path: ".mcp.json", state: "ok" }]);
  assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
  const left = parseDoc(readFileSync(r.file, "utf8"));
  assert.deepEqual(left["disabledMcpServers"], ["a"]);
  const leftServers = left["mcpServers"];
  assert.ok(isRecord(leftServers));
  assert.equal(Object.hasOwn(leftServers, "realm"), false);
  assert.deepEqual(leftServers["added"], { type: "stdio", command: "added" });
});

void test("WAVE2-04 codebuddy: CODEBUDDY_HOME changes nothing: the host ignores it (E-CB3), so does Realm", async (t) => {
  const r = buildRig(t, DESCRIPTOR);
  const env: HostEnv = { ...r.env, env: { ...r.env.env, CODEBUDDY_HOME: join(r.host.root, "ignored") } };
  assert.equal((await r.adapter.install(env, { dryRun: false })).outcome, "installed");
  assert.deepEqual(filesUnder(r.homeDir), [".mcp.json"]);
  assert.equal(existsSync(join(r.host.root, "ignored")), false);
  assert.equal((await r.adapter.uninstall(env, { dryRun: false })).outcome, "removed");
});

void test("WAVE2-04 codebuddy: with CODEBUDDY_CONFIG_DIR set, the legacy ~/.codebuddy.json in the user's home still guards the install (OQ-25-11, asserted so it stays visible)", async (t) => {
  const r = buildRig(t, DESCRIPTOR, { override: true });
  writeSeed(join(r.host.home, ".codebuddy.json"), LEGACY_SERVERS);
  const before = treeHash(r.host.root);
  await assert.rejects(r.adapter.install(r.env, { dryRun: false }), refusedWith("foreign-content", "POLICY_DENIED"));
  nothingWritten(r, DESCRIPTOR, before);
  // The legacy mcp.json of the overridden directory guards it too, and the default home's one does not.
  const second = buildRig(t, DESCRIPTOR, { override: true });
  writeSeed(join(second.host.home, ".codebuddy", "mcp.json"), LEGACY_SERVERS);
  assert.equal((await second.adapter.install(second.env, { dryRun: false })).outcome, "installed");
  const third = buildRig(t, DESCRIPTOR, { override: true });
  writeSeed(join(third.homeDir, "mcp.json"), LEGACY_SERVERS);
  await assert.rejects(third.adapter.install(third.env, { dryRun: false }), refusedWith("foreign-content", "POLICY_DENIED"));
});

void test("WAVE2-04 codebuddy: the refusal is logged as host.install.refused and names no path", async (t) => {
  const r = buildRig(t, DESCRIPTOR);
  writeSeed(join(r.homeDir, "mcp.json"), LEGACY_SERVERS);
  await assert.rejects(r.adapter.install(r.env, { dryRun: true }), refusedWith("foreign-content", "POLICY_DENIED"));
  assert.deepEqual(eventsOf(r.log.lines), ["host.install.refused"]);
  assert.equal(r.log.lines.join("\n").includes(r.host.root), false);
});
