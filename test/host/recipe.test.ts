import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RealmError } from "../../src/core/errors.js";
import {
  HostRefusal,
  ownedPart,
  planRecipe,
  recipeTargetPaths,
  resumeDecision,
  sha256Text,
  type BundleFile,
  type HostRefusalReason,
  type PlanState,
  type RecipePlan,
} from "../../src/host/recipe.js";
import type { ReceiptEntry } from "../../src/host/receipt.js";
import type { InstallRecipe } from "../../src/host/types.js";
import { FIXTURE_JSON_VALUE, FIXTURE_TEXT_BLOCK, fixtureRecipe } from "../support/fixture-host.js";

const BLOCK_BEGIN = "# BEGIN realm host-plugin";
const BLOCK_END = "# END realm host-plugin";
// Canonical JSON (keys sorted) of the fixture value, which is what a json-merge receipt hashes.
const CANONICAL_FIXTURE_VALUE = '{"args":["mcp"],"command":"realm","type":"stdio"}';

type Json = Extract<InstallRecipe, { kind: "json-merge" }>;
type Text = Extract<InstallRecipe, { kind: "text-block" }>;
type Bundle = Extract<InstallRecipe, { kind: "bundle-copy" }>;

const json = fixtureRecipe("json-merge") as Json;
const text = fixtureRecipe("text-block") as Text;
const bundle = fixtureRecipe("bundle-copy") as Bundle;

function state(operation: PlanState["operation"], files: Record<string, string | null>, extra: Partial<PlanState> = {}): PlanState {
  return {
    operation,
    files: new Map(Object.entries(files)),
    dirs: new Set([""]),
    listings: new Map(),
    receipt: [],
    bundle: [],
    ...extra,
  };
}

function afterOf(plan: RecipePlan, path: string): string | null {
  const change = plan.changes.find((candidate) => candidate.path === path);
  assert.ok(change, `a change for ${path}`);
  return change.after;
}

function refused(work: () => unknown, reason: HostRefusalReason, code: string): void {
  assert.throws(work, (error: unknown) => error instanceof HostRefusal && error.refusal === reason && error.code === code, reason);
}

function schemaInvalid(work: () => unknown): void {
  assert.throws(work, (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID");
}

// Installs, then returns the state an uninstall would see.
function installed(recipe: InstallRecipe, files: Record<string, string | null>, extra: Partial<PlanState> = {}): { plan: RecipePlan; files: Record<string, string | null> } {
  const plan = planRecipe(recipe, state("install", files, extra));
  const next = { ...files };
  for (const change of plan.changes) {
    next[change.path] = change.after;
  }
  return { plan, files: next };
}

void test("recipe.ts imports no file system API, so planning is pure by construction", () => {
  const source = readFileSync(new URL("../../../src/host/recipe.ts", import.meta.url), "utf8");
  const imports = source.split("\n").filter((line) => line.startsWith("import "));
  assert.ok(imports.length > 0);
  for (const line of imports) {
    assert.doesNotMatch(line, /from "(node:)?fs(\/promises)?"/);
  }
});

// ---- json-merge ------------------------------------------------------------------

void test("json-merge creates an absent file with the key and records the created file and parents", () => {
  const plan = planRecipe(json, state("install", { "settings.json": null }));
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0]?.action, "create");
  assert.equal(afterOf(plan, "settings.json"), `${JSON.stringify({ mcpServers: { realm: FIXTURE_JSON_VALUE } }, null, 2)}\n`);
  const entry = plan.entries[0];
  assert.equal(entry?.createdFile, true);
  assert.deepEqual(entry.createdParents, [["mcpServers"]]);
  assert.equal(entry.beforeSha256, null);
  assert.equal(entry.ownedSha256, sha256Text(CANONICAL_FIXTURE_VALUE));
});

void test("json-merge keeps unrelated keys in order and the file's indentation and trailing newline", () => {
  const original = { z: 1, a: { nested: [1, 2] }, m: "x" };
  for (const [label, indent, trailing] of [
    ["two spaces", 2, true],
    ["four spaces", 4, true],
    ["tab", "\t", true],
    ["no trailing newline", 2, false],
  ] as const) {
    const before = `${JSON.stringify(original, null, indent)}${trailing ? "\n" : ""}`;
    const plan = planRecipe(json, state("install", { "settings.json": before }));
    const expected = `${JSON.stringify({ ...original, mcpServers: { realm: FIXTURE_JSON_VALUE } }, null, indent)}${trailing ? "\n" : ""}`;
    assert.equal(afterOf(plan, "settings.json"), expected, label);
    assert.equal(plan.changes[0]?.action, "update", label);
  }
});

void test("json-merge keeps CRLF line endings", () => {
  const before = JSON.stringify({ a: 1 }, null, 2).replace(/\n/g, "\r\n") + "\r\n";
  const plan = planRecipe(json, state("install", { "settings.json": before }));
  const after = afterOf(plan, "settings.json") ?? "";
  assert.ok(after.includes("\r\n"));
  assert.ok(!/[^\r]\n/.test(after), "no bare LF");
});

void test("json-merge is a no-op when the value is already present, and claims nothing it did not write", () => {
  const before = `${JSON.stringify({ mcpServers: { realm: { args: ["mcp"], command: "realm", type: "stdio" } } }, null, 2)}\n`;
  const plan = planRecipe(json, state("install", { "settings.json": before }));
  assert.equal(plan.changes[0]?.action, "noop");
  assert.deepEqual(plan.entries, []);
});

void test("json-merge refuses a different value it does not own and an intermediate that is not an object", () => {
  const foreign = `${JSON.stringify({ mcpServers: { realm: { command: "other" } } }, null, 2)}\n`;
  refused(() => planRecipe(json, state("install", { "settings.json": foreign })), "foreign-content", "POLICY_DENIED");
  for (const intermediate of [[], 5, null, "x"]) {
    const before = JSON.stringify({ mcpServers: intermediate });
    refused(() => planRecipe(json, state("install", { "settings.json": before })), "foreign-content", "POLICY_DENIED");
  }
});

void test("json-merge updates a value the receipt owns, and only that", () => {
  const first = installed({ ...json, value: { command: "old" } }, { "settings.json": '{\n  "keep": true\n}\n' });
  const plan = planRecipe(json, state("install", first.files, { receipt: first.plan.entries }));
  assert.equal(plan.changes[0]?.action, "update");
  const parsed: unknown = JSON.parse(afterOf(plan, "settings.json") ?? "");
  assert.deepEqual(parsed, { keep: true, mcpServers: { realm: FIXTURE_JSON_VALUE } });
  assert.equal(plan.entries[0]?.ownedSha256, sha256Text(CANONICAL_FIXTURE_VALUE));
});

void test("json-merge refuses unparseable files: invalid JSON, comments, non-object roots, lossy numbers", () => {
  const cases = ["{", '{"a":1, // comment\n}', "[]", "5", '"s"', "null", "", '{"n": 12345678901234567890}', '{"n": 1e999}'];
  for (const before of cases) {
    refused(() => planRecipe(json, state("install", { "settings.json": before })), "unparseable", "SCHEMA_INVALID");
  }
  // A long number inside a string is just text.
  const fine = planRecipe(json, state("install", { "settings.json": '{"s": "12345678901234567890"}\n' }));
  assert.equal(fine.changes[0]?.action, "update");
});

void test("json-merge key paths are validated", () => {
  const bad: (readonly string[])[] = [
    [],
    ["__proto__"],
    ["a", "constructor"],
    ["prototype"],
    ["a b"],
    [""],
    ["a", "b", "c", "d", "e", "f", "g"],
    ["a/b"],
  ];
  for (const keyPath of bad) {
    schemaInvalid(() => planRecipe({ ...json, keyPath }, state("install", { "settings.json": null })));
  }
  schemaInvalid(() => planRecipe({ ...json, file: "../escape.json" }, state("install", { "../escape.json": null })));
  schemaInvalid(() => planRecipe({ ...json, file: "/abs.json" }, state("install", { "/abs.json": null })));
  schemaInvalid(() => planRecipe({ ...json, value: undefined }, state("install", { "settings.json": null })));
  schemaInvalid(() => planRecipe({ ...json, value: Number.NaN }, state("install", { "settings.json": null })));
});

void test("json-merge install then uninstall removes a file Realm created", () => {
  const first = installed(json, { "settings.json": null });
  const plan = planRecipe(json, state("uninstall", first.files, { receipt: first.plan.entries }));
  assert.equal(plan.changes[0]?.action, "remove");
  assert.equal(plan.changes[0].after, null);
});

void test("json-merge install then uninstall restores a normalized pre-existing file byte for byte", () => {
  for (const indent of [2, 4, "\t"] as const) {
    const original = `${JSON.stringify({ z: 1, a: [true, null], m: { deep: "x" } }, null, indent)}\n`;
    const first = installed(json, { "settings.json": original });
    const plan = planRecipe(json, state("uninstall", first.files, { receipt: first.plan.entries }));
    assert.equal(plan.changes[0]?.action, "update");
    assert.equal(afterOf(plan, "settings.json"), original);
  }
});

void test("json-merge uninstall keeps keys the user added after install and a parent that is no longer empty", () => {
  const first = installed(json, { "settings.json": '{\n  "a": 1\n}\n' });
  const edited = JSON.parse(first.files["settings.json"] ?? "") as { mcpServers: Record<string, unknown> };
  edited.mcpServers["other"] = { command: "x" };
  const plan = planRecipe(json, state("uninstall", { "settings.json": `${JSON.stringify(edited, null, 2)}\n` }, { receipt: first.plan.entries }));
  assert.deepEqual(JSON.parse(afterOf(plan, "settings.json") ?? ""), { a: 1, mcpServers: { other: { command: "x" } } });
});

void test("json-merge uninstall refuses drift and plans nothing, and treats a missing owned part as already removed", () => {
  const first = installed(json, { "settings.json": null });
  const drifted = `${JSON.stringify({ mcpServers: { realm: { command: "evil" } } }, null, 2)}\n`;
  refused(() => planRecipe(json, state("uninstall", { "settings.json": drifted }, { receipt: first.plan.entries })), "drifted", "POLICY_DENIED");
  const gone = planRecipe(json, state("uninstall", { "settings.json": "{}\n" }, { receipt: first.plan.entries }));
  assert.equal(gone.changes[0]?.action, "noop");
  const missingFile = planRecipe(json, state("uninstall", { "settings.json": null }, { receipt: first.plan.entries }));
  assert.equal(missingFile.changes[0]?.action, "noop");
  const none = planRecipe(json, state("uninstall", { "settings.json": "{}" }));
  assert.deepEqual(none.changes, []);
});

// ---- text-block ------------------------------------------------------------------

const BODY = `${BLOCK_BEGIN}\n${FIXTURE_TEXT_BLOCK}\n${BLOCK_END}\n`;

void test("text-block creates an absent file and appends to an existing one", () => {
  const created = planRecipe(text, state("install", { "config.toml": null }));
  assert.equal(afterOf(created, "config.toml"), BODY);
  assert.equal(created.entries[0]?.createdFile, true);

  const withNewline = planRecipe(text, state("install", { "config.toml": "a = 1\n" }));
  assert.equal(afterOf(withNewline, "config.toml"), `a = 1\n${BODY}`);
  assert.equal(withNewline.entries[0]?.separatorAdded, undefined);

  const without = planRecipe(text, state("install", { "config.toml": "a = 1" }));
  assert.equal(afterOf(without, "config.toml"), `a = 1\n${BODY}`);
  assert.equal(without.entries[0]?.separatorAdded, true);

  const empty = planRecipe(text, state("install", { "config.toml": "" }));
  assert.equal(afterOf(empty, "config.toml"), BODY);
});

void test("text-block keeps CRLF line endings", () => {
  const plan = planRecipe(text, state("install", { "config.toml": "a = 1\r\nb = 2\r\n" }));
  const after = afterOf(plan, "config.toml") ?? "";
  assert.ok(after.startsWith("a = 1\r\nb = 2\r\n"));
  assert.ok(after.endsWith(`${BLOCK_END}\r\n`));
  assert.ok(!/[^\r]\n/.test(after), "no bare LF");
});

void test("text-block install then uninstall is byte-identical for files with and without a final newline", () => {
  for (const original of ["a = 1\n", "a = 1", "a = 1\r\nb = 2\r\n", "a = 1\r\nb = 2", "", "# only a comment\n\n"]) {
    const first = installed(text, { "config.toml": original });
    const plan = planRecipe(text, state("uninstall", first.files, { receipt: first.plan.entries }));
    assert.equal(afterOf(plan, "config.toml"), original, JSON.stringify(original));
  }
  const created = installed(text, { "config.toml": null });
  const gone = planRecipe(text, state("uninstall", created.files, { receipt: created.plan.entries }));
  assert.equal(gone.changes[0]?.action, "remove");
});

void test("text-block is a no-op for an identical block and updates only a block the receipt owns", () => {
  const first = installed(text, { "config.toml": "a = 1\n" });
  const same = planRecipe(text, state("install", first.files, { receipt: first.plan.entries }));
  assert.equal(same.changes[0]?.action, "noop");
  assert.equal(same.entries.length, 1);
  const unowned = planRecipe(text, state("install", first.files));
  assert.equal(unowned.changes[0]?.action, "noop");
  assert.deepEqual(unowned.entries, []);

  const updated = planRecipe({ ...text, block: "[new]\nkey = 1" }, state("install", first.files, { receipt: first.plan.entries }));
  const after = afterOf(updated, "config.toml") ?? "";
  assert.equal(after, `a = 1\n${BLOCK_BEGIN}\n[new]\nkey = 1\n${BLOCK_END}\n`);
  refused(() => planRecipe({ ...text, block: "[new]\nkey = 1" }, state("install", first.files)), "foreign-content", "POLICY_DENIED");
});

void test("text-block refuses malformed marker layouts", () => {
  const layouts = [
    `${BLOCK_BEGIN}\nx\n`,
    `x\n${BLOCK_END}\n`,
    `${BLOCK_END}\n${BLOCK_BEGIN}\n`,
    `${BODY}${BODY}`,
    `${BLOCK_BEGIN}\n${BLOCK_BEGIN}\n${BLOCK_END}\n`,
  ];
  for (const layout of layouts) {
    refused(() => planRecipe(text, state("install", { "config.toml": layout })), "unparseable", "SCHEMA_INVALID");
  }
  // A line that merely mentions a marker is not a marker.
  const lookalike = planRecipe(text, state("install", { "config.toml": `${BLOCK_BEGIN} extra\n` }));
  assert.equal(lookalike.changes[0]?.action, "update");
});

void test("text-block validates the block", () => {
  schemaInvalid(() => planRecipe({ ...text, block: "" }, state("install", { "config.toml": null })));
  schemaInvalid(() => planRecipe({ ...text, block: `a\n${BLOCK_BEGIN}\nb` }, state("install", { "config.toml": null })));
  schemaInvalid(() => planRecipe({ ...text, block: `a\n${BLOCK_END}` }, state("install", { "config.toml": null })));
  const tooLong = Array.from({ length: 201 }, (_, index) => `l${String(index)}`).join("\n");
  schemaInvalid(() => planRecipe({ ...text, block: tooLong }, state("install", { "config.toml": null })));
  const longest = Array.from({ length: 200 }, (_, index) => `l${String(index)}`).join("\n");
  assert.equal(planRecipe({ ...text, block: longest }, state("install", { "config.toml": null })).changes[0]?.action, "create");
});

void test("text-block uninstall refuses a modified block and treats a missing block as already removed", () => {
  const first = installed(text, { "config.toml": "a = 1\n" });
  const edited = (first.files["config.toml"] ?? "").replace("command", "cmd");
  refused(() => planRecipe(text, state("uninstall", { "config.toml": edited }, { receipt: first.plan.entries })), "drifted", "POLICY_DENIED");
  refused(
    () => planRecipe(text, state("uninstall", { "config.toml": `${BLOCK_BEGIN}\n` }, { receipt: first.plan.entries })),
    "drifted",
    "POLICY_DENIED",
  );
  const noBlock = planRecipe(text, state("uninstall", { "config.toml": "a = 1\n" }, { receipt: first.plan.entries }));
  assert.equal(noBlock.changes[0]?.action, "noop");
  // An edit outside the block is not drift.
  const outside = (first.files["config.toml"] ?? "").replace("a = 1", "a = 2");
  const plan = planRecipe(text, state("uninstall", { "config.toml": outside }, { receipt: first.plan.entries }));
  assert.equal(afterOf(plan, "config.toml"), "a = 2\n");
});

// ---- bundle-copy -----------------------------------------------------------------

const FILES: readonly BundleFile[] = [
  { rel: "sub/b.txt", content: "B" },
  { rel: "a.txt", content: "A" },
];
const A = "plugins/realm/a.txt";
const B = "plugins/realm/sub/b.txt";

void test("bundle-copy creates every file in path order and records the directories it created", () => {
  const plan = planRecipe(bundle, state("install", { [A]: null, [B]: null }, { bundle: FILES }));
  assert.deepEqual(plan.changes.map((change) => [change.path, change.action]), [[A, "create"], [B, "create"]]);
  assert.deepEqual(plan.entries[0]?.createdDirs, [["plugins"], ["plugins", "realm"], ["plugins", "realm", "sub"]]);
  assert.equal(plan.entries[1]?.createdDirs, undefined);
  assert.deepEqual(recipeTargetPaths(bundle, "install", FILES, []), [A, B]);
});

void test("bundle-copy refuses a different file it does not own, and no-ops an identical one without claiming it", () => {
  refused(() => planRecipe(bundle, state("install", { [A]: "OTHER", [B]: null }, { bundle: FILES })), "foreign-content", "POLICY_DENIED");
  const plan = planRecipe(bundle, state("install", { [A]: "A", [B]: null }, { bundle: FILES }));
  assert.equal(plan.changes[0]?.action, "noop");
  assert.deepEqual(plan.entries.map((entry) => entry.path), [B]);
});

void test("bundle-copy updates an owned file that is unchanged", () => {
  const first = installed(bundle, { [A]: null, [B]: null }, { bundle: [{ rel: "a.txt", content: "A0" }, { rel: "sub/b.txt", content: "B" }] });
  const plan = planRecipe(bundle, state("install", first.files, { bundle: FILES, receipt: first.plan.entries, dirs: new Set(["", "plugins", "plugins/realm", "plugins/realm/sub"]) }));
  assert.deepEqual(plan.changes.map((change) => change.action), ["update", "noop"]);
  assert.equal(afterOf(plan, A), "A");
  assert.equal(plan.entries.length, 2);
  // The directories created by the first install stay recorded.
  assert.deepEqual(plan.entries[0]?.createdDirs, [["plugins"], ["plugins", "realm"], ["plugins", "realm", "sub"]]);
  // The same change against a file the receipt does not own is refused.
  refused(() => planRecipe(bundle, state("install", first.files, { bundle: FILES })), "foreign-content", "POLICY_DENIED");
});

void test("bundle-copy removes a file an earlier install owned that the bundle no longer ships", () => {
  const first = installed(bundle, { [A]: null, [B]: null }, { bundle: FILES });
  const plan = planRecipe(bundle, state("install", first.files, { bundle: [{ rel: "a.txt", content: "A" }], receipt: first.plan.entries, dirs: new Set(["", "plugins", "plugins/realm", "plugins/realm/sub"]) }));
  assert.deepEqual(plan.changes.map((change) => [change.path, change.action]), [[A, "noop"], [B, "remove"]]);
});

void test("bundle-copy refuses an oversized bundle", () => {
  const many: BundleFile[] = Array.from({ length: 257 }, (_, index) => ({ rel: `f${String(index)}.txt`, content: "x" }));
  refused(() => planRecipe(bundle, state("install", {}, { bundle: many })), "unparseable", "SCHEMA_INVALID");
  const big: BundleFile[] = [{ rel: "big.txt", content: "x".repeat(1024 * 1024 + 1) }];
  refused(() => planRecipe(bundle, state("install", {}, { bundle: big })), "unparseable", "SCHEMA_INVALID");
  const exact: BundleFile[] = [{ rel: "big.txt", content: "x".repeat(1024 * 1024) }];
  assert.equal(planRecipe(bundle, state("install", { "plugins/realm/big.txt": null }, { bundle: exact })).changes[0]?.action, "create");
  schemaInvalid(() => planRecipe(bundle, state("install", {}, { bundle: [{ rel: "../x", content: "x" }] })));
  schemaInvalid(() => planRecipe({ ...bundle, source: "../adapters" }, state("install", {}, { bundle: [] })));
  schemaInvalid(() => planRecipe({ ...bundle, dest: "/etc" }, state("install", {}, { bundle: FILES })));
});

void test("bundle-copy uninstall removes owned files and the directories Realm created once they are empty", () => {
  const first = installed(bundle, { [A]: null, [B]: null }, { bundle: FILES });
  const listings = new Map<string, readonly string[]>([
    ["plugins", ["realm"]],
    ["plugins/realm", ["a.txt", "sub"]],
    ["plugins/realm/sub", ["b.txt"]],
  ]);
  const plan = planRecipe(bundle, state("uninstall", first.files, { receipt: first.plan.entries, listings }));
  assert.deepEqual(plan.changes.map((change) => [change.path, change.kind, change.action]), [
    [A, "file", "remove"],
    [B, "file", "remove"],
    ["plugins/realm/sub", "dir", "remove"],
    ["plugins/realm", "dir", "remove"],
    ["plugins", "dir", "remove"],
  ]);
  // A directory that gained a file of the user's is left alone.
  const kept = new Map(listings);
  kept.set("plugins/realm", ["a.txt", "sub", "notes.md"]);
  const partial = planRecipe(bundle, state("uninstall", first.files, { receipt: first.plan.entries, listings: kept }));
  assert.deepEqual(partial.changes.filter((change) => change.kind === "dir").map((change) => change.path), ["plugins/realm/sub"]);
});

void test("bundle-copy uninstall refuses drift for the whole operation and tolerates files already gone", () => {
  const first = installed(bundle, { [A]: null, [B]: null }, { bundle: FILES });
  refused(() => planRecipe(bundle, state("uninstall", { [A]: "CHANGED", [B]: "B" }, { receipt: first.plan.entries })), "drifted", "POLICY_DENIED");
  const gone = planRecipe(bundle, state("uninstall", { [A]: null, [B]: "B" }, { receipt: first.plan.entries }));
  assert.deepEqual(gone.changes.map((change) => change.action), ["noop", "remove"]);
  // A crash left a pending receipt for a file that was never written: its prior content is not drift.
  const pending: ReceiptEntry = { path: A, kind: "bundle-copy", beforeSha256: sha256Text("ORIG"), afterSha256: sha256Text("A") };
  const unapplied = planRecipe(bundle, state("uninstall", { [A]: "ORIG" }, { receipt: [pending] }));
  assert.equal(unapplied.changes[0]?.action, "noop");
});

// ---- shared ----------------------------------------------------------------------

void test("planning is deterministic: the same inputs give the same plan and hashes", () => {
  const inputs: [InstallRecipe, PlanState][] = [
    [json, state("install", { "settings.json": '{\n  "a": 1\n}\n' })],
    [text, state("install", { "config.toml": "a = 1" })],
    [bundle, state("install", { [A]: null, [B]: null }, { bundle: FILES })],
  ];
  for (const [recipe, input] of inputs) {
    assert.equal(JSON.stringify(planRecipe(recipe, input)), JSON.stringify(planRecipe(recipe, input)), recipe.kind);
  }
});

void test("resumeDecision: done, apply or conflict by the current hash", () => {
  const entry = { beforeSha256: sha256Text("before"), afterSha256: sha256Text("after") };
  assert.equal(resumeDecision(entry, sha256Text("after")), "done");
  assert.equal(resumeDecision(entry, sha256Text("before")), "apply");
  assert.equal(resumeDecision(entry, sha256Text("third")), "conflict");
  assert.equal(resumeDecision({ beforeSha256: null, afterSha256: sha256Text("after") }, null), "apply");
});

void test("recipeTargetPaths includes receipt paths and validates them", () => {
  const entry: ReceiptEntry = { path: "old.json", kind: "json-merge", beforeSha256: null, afterSha256: sha256Text("x") };
  assert.deepEqual(recipeTargetPaths(json, "install", [], [entry]), ["old.json", "settings.json"]);
  assert.deepEqual(recipeTargetPaths(json, "uninstall", [], [entry]), ["old.json"]);
  schemaInvalid(() => recipeTargetPaths(json, "uninstall", [], [{ ...entry, path: "../x" }]));
});

// ---- yaml-map dispatch (WAVE2-01; the planner itself is tested in yaml-owned.test.ts) ----------------------------------------------

const yaml: InstallRecipe = { kind: "yaml-map", file: "config.yaml", path: ["mcp_servers", "realm"], value: { command: "realm", args: ["mcp", "--host", "hermes"] } };
const YAML_BLOCK = "mcp_servers:\n  realm:\n    command: realm\n    args:\n      - mcp\n      - --host\n      - hermes\n";

void test("planRecipe dispatches yaml-map to its planner for install and for uninstall", () => {
  const created = planRecipe(yaml, state("install", { "config.yaml": null }));
  assert.equal(created.changes[0]?.after, YAML_BLOCK);
  assert.equal(created.entries[0]?.kind, "yaml-map");
  const removed = planRecipe(yaml, state("uninstall", { "config.yaml": YAML_BLOCK }, { receipt: created.entries }));
  assert.equal(removed.changes[0]?.action, "remove");
  assert.deepEqual(planRecipe(yaml, state("uninstall", { "config.yaml": YAML_BLOCK })), { changes: [], entries: [] });
});

void test("ownedPart reads a yaml-map entry by its parsed value, and reports an unreadable file as unparsed", () => {
  const owned = ownedPart(yaml, YAML_BLOCK);
  assert.deepEqual(owned, { parsed: true, sha256: planRecipe(yaml, state("install", { "config.yaml": null })).entries[0]?.ownedSha256 });
  assert.deepEqual(ownedPart(yaml, "a: 1\n"), { parsed: true, sha256: null });
  assert.deepEqual(ownedPart(yaml, "a: &x 1\n"), { parsed: false, sha256: null });
});

void test("recipeTargetPaths names the file of a yaml-map recipe on install and only receipt paths on uninstall", () => {
  const entry: ReceiptEntry = { path: "config.yaml", kind: "yaml-map", beforeSha256: null, afterSha256: sha256Text("x") };
  assert.deepEqual(recipeTargetPaths(yaml, "install", [], []), ["config.yaml"]);
  assert.deepEqual(recipeTargetPaths(yaml, "uninstall", [], [entry]), ["config.yaml"]);
});
