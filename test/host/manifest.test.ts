import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SchemaInvalidError } from "../../src/contract/validate.js";
import { defaultManifestFor, parseHostPluginManifest } from "../../src/host/manifest.js";
import { HOST_IDS } from "../../src/host/types.js";

const mcp = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: 1, hostId: "claude", integration: "mcp-config", pluginName: "realm", pluginVersion: "1.2.3",
  launch: { command: "realm", args: ["mcp"] }, capabilities: [{ capability: "daemon.attach" }], ...over,
});
const ext = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: 1, hostId: "omp", integration: "extension", pluginName: "realm", pluginVersion: "1.2.3",
  entry: "dist/src/omp/extension.js", capabilities: [{ capability: "daemon.attach" }], ...over,
});

function assertRefused(input: unknown, label: string): void {
  assert.throws(
    () => parseHostPluginManifest(input),
    (error: unknown) =>
      error instanceof SchemaInvalidError && error.code === "SCHEMA_INVALID" && error.detail === "host plugin manifest is not valid",
    label,
  );
}

const refusals: [string, unknown][] = [
  ["null", null],
  ["array", []],
  ["string", "x"],
  ["unknown top key", mcp({ extra: 1 })],
  ["env key", mcp({ env: {} })],
  ["token key", mcp({ token: "t" })],
  ["secret key", mcp({ secret: "s" })],
  ["credentials key", mcp({ credentials: "c" })],
  ["launch.env", mcp({ launch: { command: "realm", args: [], env: { A: "b" } } })],
  ["wrong schemaVersion", mcp({ schemaVersion: 2 })],
  ["wrong pluginName", mcp({ pluginName: "other" })],
  ["hostId gemini", mcp({ hostId: "gemini" })],
  ["hostId vscode", mcp({ hostId: "vscode" })],
  ["bad version", mcp({ pluginVersion: "1.2" })],
  ["bad integration", mcp({ integration: "x" })],
  ["command with path", mcp({ launch: { command: "/usr/bin/realm", args: [] } })],
  ["command with space", mcp({ launch: { command: "realm mcp", args: [] } })],
  ["arg with space", mcp({ launch: { command: "realm", args: ["a b"] } })],
  ["arg 65 chars", mcp({ launch: { command: "realm", args: ["a".repeat(65)] } })],
  ["9 args", mcp({ launch: { command: "realm", args: Array.from({ length: 9 }, () => "a") } })],
  ["mcp without launch", mcp({ launch: undefined })],
  ["mcp with entry", mcp({ entry: "a.js" })],
  ["mcp with boot", mcp({ boot: {} })],
  ["mcp net.egress above ceiling", mcp({ capabilities: [{ capability: "net.egress", scope: "h:1" }] })],
  ["17 capabilities", mcp({ capabilities: Array.from({ length: 17 }, (_, i) => ({ capability: "fs.read", scope: String(i) })) })],
  ["duplicate capability", mcp({ capabilities: [{ capability: "fs.read" }, { capability: "fs.read" }] })],
  ["unknown capability", mcp({ capabilities: [{ capability: "fs.delete" }] })],
  ["capability extra key", mcp({ capabilities: [{ capability: "fs.read", x: 1 }] })],
  ["entry parent segment", ext({ entry: "../x.js" })],
  ["entry nested parent", ext({ entry: "a/../x.js" })],
  ["entry absolute", ext({ entry: "/abs.js" })],
  ["entry backslash", ext({ entry: "a\\x.js" })],
  ["entry not js", ext({ entry: "x.ts" })],
  ["extension without entry", ext({ entry: undefined })],
  ["extension with launch", ext({ launch: { command: "realm", args: [] } })],
  ["boot startupBudgetMs 0", ext({ boot: { startupBudgetMs: 0 } })],
  ["boot startupBudgetMs too big", ext({ boot: { startupBudgetMs: 200001 } })],
  ["boot retryCap 9", ext({ boot: { reattach: { retryCap: 9 } } })],
  ["boot base above cap", ext({ boot: { reattach: { baseDelayMs: 5, capDelayMs: 4 } } })],
  ["boot cap too big", ext({ boot: { reattach: { capDelayMs: 60001 } } })],
  ["boot enabled not boolean", ext({ boot: { reattach: { enabled: "yes" } } })],
  ["boot unknown key", ext({ boot: { env: {} } })],
];

for (const [label, input] of refusals) {
  void test(`refuses: ${label}`, () => {
    assertRefused(input, label);
  });
}

void test("refuses own __proto__, constructor and prototype keys", () => {
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const polluted = JSON.parse(`{"${key}": {}}`) as Record<string, unknown>;
    assertRefused({ ...mcp(), ...polluted }, key);
  }
});

void test("the refusal message never echoes input", () => {
  assert.throws(
    () => parseHostPluginManifest(mcp({ token: "sk-SECRET-VALUE", pluginVersion: "sk-SECRET-VALUE" })),
    (error: unknown) => error instanceof Error && !error.message.includes("SECRET"),
  );
});

void test("version pattern accepts and refuses expected strings", () => {
  for (const v of ["0.0.1", "1.2.3-rc.1", "1.2.3+build.5", "10.20.30-a.b+c"]) {
    assert.equal(parseHostPluginManifest(mcp({ pluginVersion: v })).pluginVersion, v);
  }
  for (const v of ["1", "1.2", "v1.2.3", "1.2.3.4", "", "1.2.3-", "1.2.3 "]) {
    assertRefused(mcp({ pluginVersion: v }), v);
  }
});

void test("accepts a valid boot block and returns a deeply frozen manifest", () => {
  const m = parseHostPluginManifest(
    ext({
      capabilities: [{ capability: "net.egress", scope: "h:1" }],
      boot: { startupBudgetMs: 5000, reattach: { enabled: true, retryCap: 8, baseDelayMs: 100, capDelayMs: 60000 } },
    }),
  );
  assert.equal(m.boot?.reattach?.retryCap, 8);
  assert.ok(Object.isFrozen(m) && Object.isFrozen(m.capabilities) && Object.isFrozen(m.capabilities[0]) && Object.isFrozen(m.boot));
});

void test("every default manifest parses and round-trips", () => {
  for (const id of HOST_IDS) {
    const m = defaultManifestFor(id, "1.0.0");
    assert.equal(m.hostId, id);
    assert.deepEqual(parseHostPluginManifest(JSON.parse(JSON.stringify(m))), m);
    if (id === "omp") {
      assert.equal(m.integration, "extension");
      assert.ok(m.capabilities.some((c) => c.capability === "host.tools.restrict"));
      assert.equal(m.launch, undefined);
    } else {
      assert.equal(m.integration, "mcp-config");
      assert.deepEqual(m.launch, { command: "realm", args: ["mcp"] });
      assert.deepEqual(m.capabilities.map((c) => c.capability), ["daemon.attach", "fs.read", "fs.write", "fs.list", "exec.argv", "exec.shell"]);
    }
  }
});

void test("the omp default entry equals package.json omp.extensions[0] without './'", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { omp: { extensions: string[] } };
  assert.equal(defaultManifestFor("omp", "1.0.0").entry, (pkg.omp.extensions[0] as string).replace(/^\.\//, ""));
});
