// CAPT-09, D-32-02, D-32-13 item 8: the recipes and the default manifests stay bare. The capability token reaches a host process
// through the daemon at attach, never through a host-owned file, so the 21 default mcp-config manifests launch `realm mcp --host ID`
// with no env member, the 18 install recipes register that same bare value, and nothing an install writes or records carries an
// env, token or key member. Adding an environment delivery later fails here first. Rows come from the real tables at run time.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHostAdapter } from "../../src/host/adapter.js";
import { defaultManifestFor } from "../../src/host/manifest.js";
import { receiptPath } from "../../src/host/receipt.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { HOST_IDS, type HostId, type HostRuntimeEntry } from "../../src/host/types.js";
import { nullLogger } from "../../src/observe/logger.js";
import { makeFixtureHost } from "../support/fixture-host.js";
import { registeredArgvOf } from "../support/host-contract.js";

const VERSION = "1.2.3";
const FORBIDDEN_MEMBERS: readonly string[] = ["env", "token", "key", "capability"];
const FORBIDDEN_TEXT: readonly string[] = ["env", "token", "rcap1", "secret", "key", "REALM_"];

// The only places a forbidden substring may appear in a whole recipe. Each is found in its named hosts (so a stale entry fails) and
// removed before the scan; nothing else is loosened.
interface Allowed {
  readonly text: string;
  readonly hosts: "json-merge" | readonly HostId[];
  readonly reason: string;
}
const ALLOWED: readonly Allowed[] = [
  { text: '"keyPath":', hosts: "json-merge", reason: "the structural member that names where the entry lives in the document; it holds no value of Realm's" },
  { text: '"env":{}', hosts: ["claude"], reason: "the golden `claude mcp add` entry carries an empty env object; empty means no variable is delivered" },
];

const MCP_CONFIG: readonly HostId[] = HOST_IDS.filter((id) => HOST_RUNTIMES[id].integration === "mcp-config");
const WITH_RECIPE: readonly HostId[] = MCP_CONFIG.filter((id) => HOST_RUNTIMES[id].recipe !== null);

function bareLauncher(id: HostId): { readonly command: string; readonly args: readonly string[] } {
  return { command: "realm", args: ["mcp", "--host", id] };
}

// Every member name at any depth.
function memberNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(memberNames);
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([name, child]) => [name, ...memberNames(child)]);
  }
  return [];
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

void test("CAPT-09: the 21 default mcp-config manifests launch the bare value with no env, cwd, token or key member", (t) => {
  assert.equal(MCP_CONFIG.length, 21, "the table holds 21 mcp-config hosts");
  t.diagnostic(`mcp-config manifests checked: ${String(MCP_CONFIG.length)}`);
  for (const id of MCP_CONFIG) {
    const manifest = defaultManifestFor(id, VERSION);
    assert.deepEqual(manifest.launch, bareLauncher(id), `${id}: the launch value`);
    assert.deepEqual(Object.keys(manifest.launch ?? {}).sort(), ["args", "command"], `${id}: the launch has no other member`);
    const top = Object.keys(manifest).map((name) => name.toLowerCase());
    for (const forbidden of FORBIDDEN_MEMBERS) {
      assert.ok(!top.includes(forbidden), `${id}: the manifest has no member named ${forbidden}`);
    }
    for (const name of memberNames(manifest).map((member) => member.toLowerCase())) {
      assert.ok(!["env", "token", "key"].includes(name), `${id}: a member named ${name} appears in the manifest`);
    }
  }
});

void test("CAPT-09: the table holds exactly 18 mcp-config recipes, 3 recipe-pending mcp-config rows and one extension row (omp)", (t) => {
  const pending = MCP_CONFIG.filter((id) => HOST_RUNTIMES[id].recipe === null);
  const extensions = HOST_IDS.filter((id) => HOST_RUNTIMES[id].integration === "extension");
  t.diagnostic(`mcp-config recipes: ${String(WITH_RECIPE.length)}, pending: ${String(pending.length)}, extension: ${extensions.join(",")}`);
  assert.equal(WITH_RECIPE.length, 18, `recipes: ${WITH_RECIPE.join(",")}`);
  assert.equal(pending.length, 3, `pending: ${pending.join(",")}`);
  assert.deepEqual(extensions, ["omp"]);
});

void test("CAPT-09: each of the 18 recipes registers the bare launcher for its own host id", () => {
  for (const id of WITH_RECIPE) {
    assert.deepEqual(registeredArgvOf(HOST_RUNTIMES[id]), ["realm", "mcp", "--host", id], `${id}: the registered launch`);
  }
});

void test("CAPT-09: no recipe text carries env, token, rcap1, secret, key or REALM_ beyond the named exceptions", () => {
  const used = new Set<Allowed>();
  for (const id of WITH_RECIPE) {
    const recipe = HOST_RUNTIMES[id].recipe;
    assert.ok(recipe !== null);
    let text = JSON.stringify(recipe);
    for (const allowed of ALLOWED) {
      const applies = allowed.hosts === "json-merge" ? recipe.kind === "json-merge" : allowed.hosts.includes(id);
      if (applies) {
        assert.ok(text.includes(allowed.text), `${id}: the allowed text ${allowed.text} is not in the recipe`);
        text = text.replaceAll(allowed.text, "");
        used.add(allowed);
      }
    }
    const lower = text.toLowerCase();
    for (const forbidden of FORBIDDEN_TEXT) {
      assert.ok(!lower.includes(forbidden.toLowerCase()), `${id}: the recipe carries ${forbidden}`);
    }
  }
  assert.equal(used.size, ALLOWED.length, "every allowed exception is used by at least one recipe");
  const claude = HOST_RUNTIMES.claude.recipe;
  assert.ok(claude !== null && claude.kind === "json-merge");
  assert.ok(typeof claude.value === "object" && claude.value !== null);
  assert.deepEqual(Reflect.get(claude.value, "env"), {}, "claude's env object is empty");
});

// Applies every one of the 18 recipes to a fixture config home and reads back what was written and recorded.
for (const id of WITH_RECIPE) {
  void test(`CAPT-09 ${id}: an applied recipe writes no rcap1 or REALM_ text and records a receipt with no env member`, async (t) => {
    const host = makeFixtureHost(t, { createConfigHome: false });
    const entry: HostRuntimeEntry = HOST_RUNTIMES[id];
    const adapter = createHostAdapter(entry, defaultManifestFor(id, VERSION), {
      stateDir: host.stateDir,
      adaptersDir: host.adaptersDir,
      logger: nullLogger,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    const configHome = join(host.root, "config-home");
    mkdirSync(configHome);
    const result = await adapter.install(host.env, { dryRun: false, configHome });
    assert.equal(result.outcome, "installed", id);
    const written = filesUnder(configHome);
    assert.ok(written.length > 0, `${id}: the install wrote at least one file`);
    for (const file of written) {
      const text = readFileSync(file, "utf8");
      assert.ok(!text.includes("rcap1"), `${id}: a token shape in a written file`);
      assert.ok(!text.includes("REALM_"), `${id}: a REALM_ name in a written file`);
    }
    const receiptText = readFileSync(receiptPath(host.stateDir, id), "utf8");
    assert.ok(!receiptText.includes("rcap1") && !receiptText.includes("REALM_"), `${id}: the receipt text`);
    const names = memberNames(JSON.parse(receiptText) as unknown).map((name) => name.toLowerCase());
    for (const forbidden of ["env", "token", "key", "secret"]) {
      assert.ok(!names.includes(forbidden), `${id}: the receipt has a member named ${forbidden}`);
    }
  });
}
