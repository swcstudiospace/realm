// The `yaml-map` recipe planner (src/host/yaml-owned.ts): one `parent.child` entry of a block-style YAML file, owned by key and by parsed
// value, no marker. Pure: strings in, plan out. Every row of the shared case table (test/support/host-yaml-cases.ts) is installed,
// re-installed and uninstalled here; the same rows drive the real-row Hermes suite.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError } from "../../src/core/errors.js";
import type { ReceiptEntry } from "../../src/host/receipt.js";
import { canonicalJson, HostRefusal, ownedPart, planRecipe, sha256Text, type HostRefusalReason, type PlanState, type RecipePlan } from "../../src/host/recipe.js";
import type { InstallRecipe } from "../../src/host/types.js";
import { BLOCK, crlf, ENTRY_2, YAML_FOREIGN, YAML_UNPARSEABLE, YAML_VALID } from "../support/host-yaml-cases.js";

type YamlMap = Extract<InstallRecipe, { kind: "yaml-map" }>;

const FILE = "config.yaml";
const recipe: YamlMap = {
  kind: "yaml-map",
  file: FILE,
  path: ["mcp_servers", "realm"],
  value: { command: "realm", args: ["mcp", "--host", "hermes"] },
};
const OWNED_HASH = sha256Text(canonicalJson(recipe.value));

function state(operation: PlanState["operation"], file: string | null, receipt: readonly ReceiptEntry[] = [], dirs: ReadonlySet<string> = new Set([""])): PlanState {
  return { operation, files: new Map([[FILE, file]]), dirs, listings: new Map(), receipt, bundle: [] };
}

function afterOf(plan: RecipePlan): string | null {
  const change = plan.changes.find((candidate) => candidate.path === FILE);
  assert.ok(change, "a change for config.yaml");
  return change.after;
}

function refused(work: () => unknown, reason: HostRefusalReason, code: string): void {
  assert.throws(work, (error: unknown) => error instanceof HostRefusal && error.refusal === reason && error.code === code, reason);
}

function install(file: string | null, receipt: readonly ReceiptEntry[] = [], using: InstallRecipe = recipe): { plan: RecipePlan; text: string } {
  const plan = planRecipe(using, state("install", file, receipt));
  const text = afterOf(plan);
  assert.ok(text !== null);
  return { plan, text };
}

// ---- the shared table -----------------------------------------------------------------------------------------------------------

for (const c of YAML_VALID) {
  void test(`yaml-map: ${c.name}: install writes the expected bytes, a second install is a no-op and uninstall gives back the seed`, () => {
    const first = planRecipe(recipe, state("install", c.seed));
    const text = afterOf(first);
    assert.equal(text, c.expected);
    if (c.expected === c.seed) {
      // An entry equal to the recipe's that Realm did not write: nothing is written and nothing is claimed.
      assert.equal(first.changes[0]?.action, "noop");
      assert.deepEqual(first.entries, []);
      assert.deepEqual(planRecipe(recipe, state("uninstall", c.seed)), { changes: [], entries: [] });
      return;
    }
    assert.equal(first.changes[0]?.action, "update");
    assert.equal(first.entries.length, 1);
    assert.equal(first.entries[0]?.kind, "yaml-map");
    assert.equal(first.entries[0].ownedSha256, OWNED_HASH);
    assert.equal(first.entries[0].beforeSha256, sha256Text(c.seed));
    assert.equal(first.entries[0].afterSha256, sha256Text(c.expected));
    const again = planRecipe(recipe, state("install", c.expected, first.entries));
    assert.equal(again.changes[0]?.action, "noop");
    assert.deepEqual(again.entries, first.entries);
    const removed = planRecipe(recipe, state("uninstall", c.expected, first.entries));
    assert.equal(afterOf(removed), c.seed);
  });
}

for (const c of YAML_UNPARSEABLE) {
  void test(`yaml-map: ${c.name} is refused as unparseable on install and on uninstall`, () => {
    refused(() => planRecipe(recipe, state("install", c.seed)), "unparseable", "SCHEMA_INVALID");
    const first = install("a: 1\n");
    refused(() => planRecipe(recipe, state("install", c.seed, first.plan.entries)), "unparseable", "SCHEMA_INVALID");
    refused(() => planRecipe(recipe, state("uninstall", c.seed, first.plan.entries)), "unparseable", "SCHEMA_INVALID");
  });
}

for (const c of YAML_FOREIGN) {
  void test(`yaml-map: ${c.name} is refused as foreign-content on install, with or without a receipt, and as drifted on uninstall`, () => {
    const first = install("a: 1\n");
    for (const receipt of [[], first.plan.entries]) {
      refused(() => planRecipe(recipe, state("install", c.seed, receipt)), "foreign-content", "POLICY_DENIED");
    }
    refused(() => planRecipe(recipe, state("uninstall", c.seed, first.plan.entries)), "drifted", "POLICY_DENIED");
  });
}

// ---- install ----------------------------------------------------------------------------------------------------------------------

void test("yaml-map install: an absent file is created with exactly the block, in LF, and the receipt says what Realm created", () => {
  const { plan, text } = install(null);
  assert.equal(text, BLOCK);
  assert.equal(plan.changes[0]?.action, "create");
  const entry = plan.entries[0];
  assert.equal(entry?.kind, "yaml-map");
  assert.equal(entry.ownedSha256, OWNED_HASH);
  assert.equal(entry.beforeSha256, null);
  assert.equal(entry.createdFile, true);
  assert.deepEqual(entry.createdParents, [["mcp_servers"]]);
  assert.equal(entry.separatorAdded, undefined);
  assert.equal(text.includes("#"), false, "no marker and no comment");
});

void test("yaml-map install: the directories below the home that Realm creates for the file are recorded", () => {
  const nested: YamlMap = { ...recipe, file: "a/b/config.yaml" };
  const plan = planRecipe(nested, { operation: "install", files: new Map([["a/b/config.yaml", null]]), dirs: new Set([""]), listings: new Map(), receipt: [], bundle: [] });
  assert.deepEqual(plan.entries[0]?.createdDirs, [["a"], ["a", "b"]]);
});

void test("yaml-map install: what Realm adds around its entry is recorded in the receipt", () => {
  assert.equal(install("a: 1").plan.entries[0]?.separatorAdded, true, "the line ending added after a last line that had none");
  assert.deepEqual(install("a: 1\n").plan.entries[0]?.createdParents, [["mcp_servers"]], "the header Realm added");
  assert.equal(install("a: 1\n").plan.entries[0]?.separatorAdded, undefined);
  const inBlock = install("mcp_servers:\n  other:\n    command: x\n").plan.entries[0];
  assert.equal(inBlock?.createdParents, undefined, "a parent that was there is not Realm's");
  assert.equal(inBlock?.separatorAdded, undefined);
  assert.equal(inBlock?.createdFile, undefined);
  assert.equal(install("mcp_servers: {}\n").plan.entries[0]?.createdParents, undefined, "`{}` was the parent already");
});

void test("yaml-map install: an entry equal to the recipe's is claimed only when the receipt says Realm wrote it", () => {
  const first = install("a: 1\n");
  const claimed = planRecipe(recipe, state("install", first.text, first.plan.entries));
  assert.deepEqual(claimed.entries, first.plan.entries);
  const unclaimed = planRecipe(recipe, state("install", first.text));
  assert.equal(unclaimed.changes[0]?.action, "noop");
  assert.deepEqual(unclaimed.entries, []);
});

void test("yaml-map install: an entry the receipt owns with an older value is replaced in place, and the rest of the file stays", () => {
  const older: YamlMap = { ...recipe, value: { command: "realm-old", args: ["mcp", "--host", "hermes"] } };
  const first = install("# keep\nmcp_servers:\n  a:\n    command: x\n", [], older);
  const other = `${first.text}  other:\n    command: o\n# tail\n`;
  const upgraded = planRecipe(recipe, state("install", other, first.plan.entries));
  assert.equal(afterOf(upgraded), `# keep\nmcp_servers:\n  a:\n    command: x\n${ENTRY_2}  other:\n    command: o\n# tail\n`);
  assert.equal(upgraded.entries[0]?.ownedSha256, OWNED_HASH);
  assert.equal(upgraded.entries[0].beforeSha256, sha256Text(other));
  // The same entry without a receipt is never replaced.
  refused(() => planRecipe(recipe, state("install", other)), "foreign-content", "POLICY_DENIED");
  // A CRLF file keeps its line endings through the replacement.
  const crlfFirst = install(crlf("mcp_servers:\n  a:\n    command: x\n"), [], older);
  assert.equal(afterOf(planRecipe(recipe, state("install", crlfFirst.text, crlfFirst.plan.entries))), crlf(`mcp_servers:\n  a:\n    command: x\n${ENTRY_2}`));
});

void test("yaml-map install: the file the receipt created keeps its flags through an upgrade", () => {
  const older: YamlMap = { ...recipe, value: { command: "realm-old", args: ["mcp"] } };
  const first = install(null, [], older);
  const upgraded = planRecipe(recipe, state("install", first.text, first.plan.entries));
  assert.equal(afterOf(upgraded), BLOCK);
  assert.equal(upgraded.entries[0]?.createdFile, true);
  assert.deepEqual(upgraded.entries[0].createdParents, [["mcp_servers"]]);
});

void test("yaml-map install: after the host removed the entry, a reinstall adds it again and keeps what the receipt says about the file", () => {
  const first = install(null);
  const gone = "mcp_servers:\n  other:\n    command: x\n";
  const again = planRecipe(recipe, state("install", gone, first.plan.entries));
  assert.equal(afterOf(again), `${gone}${ENTRY_2}`);
  assert.equal(again.entries[0]?.createdFile, true);
  assert.equal(again.entries[0].createdParents, undefined, "this install added no header");
});

// ---- uninstall --------------------------------------------------------------------------------------------------------------------

void test("yaml-map uninstall: a file Realm created is removed with its block", () => {
  const created = install(null);
  const removed = planRecipe(recipe, state("uninstall", created.text, created.plan.entries));
  assert.equal(removed.changes[0]?.action, "remove");
  assert.deepEqual(removed.entries, []);
});

void test("yaml-map uninstall: created directories are removed when nothing else is in them", () => {
  const nested: YamlMap = { ...recipe, file: "a/config.yaml" };
  const files = new Map([["a/config.yaml", null]]);
  const made = planRecipe(nested, { operation: "install", files, dirs: new Set([""]), listings: new Map(), receipt: [], bundle: [] });
  const text = made.changes[0]?.after ?? null;
  assert.ok(text !== null);
  const removed = planRecipe(nested, {
    operation: "uninstall",
    files: new Map([["a/config.yaml", text]]),
    dirs: new Set(["", "a"]),
    listings: new Map([["a", ["config.yaml"]]]),
    receipt: made.entries,
    bundle: [],
  });
  assert.deepEqual(removed.changes.map((change) => [change.path, change.action]), [["a/config.yaml", "remove"], ["a", "remove"]]);
});

void test("yaml-map uninstall: another server added after install stays, and only the owned entry goes", () => {
  const first = install("# user\nmodel: x\n");
  const rewritten = `${first.text}  other:\n    command: o\n`;
  assert.equal(afterOf(planRecipe(recipe, state("uninstall", rewritten, first.plan.entries))), "# user\nmodel: x\nmcp_servers:\n  other:\n    command: o\n");
});

void test("yaml-map uninstall: content a host appended after the header Realm created stays, and the header goes", () => {
  const first = install("a: 1\n");
  const appended = `${first.text}z: 2\n`;
  assert.equal(afterOf(planRecipe(recipe, state("uninstall", appended, first.plan.entries))), "a: 1\nz: 2\n");
  const commented = first.text.replace("mcp_servers:\n", "mcp_servers:\n  # mine\n");
  assert.equal(afterOf(planRecipe(recipe, state("uninstall", commented, first.plan.entries))), "a: 1\nmcp_servers:\n  # mine\n", "a header with a comment of the user is kept");
});

void test("yaml-map uninstall: a header that was there before Realm is kept even when it ends up empty, and `{}` comes back", () => {
  const bare = install("a: 1\nmcp_servers:\nb: 2\n");
  assert.equal(afterOf(planRecipe(recipe, state("uninstall", bare.text, bare.plan.entries))), "a: 1\nmcp_servers:\nb: 2\n");
  const flow = install("a: 1\nmcp_servers: {}\nb: 2\n");
  assert.equal(afterOf(planRecipe(recipe, state("uninstall", flow.text, flow.plan.entries))), "a: 1\nmcp_servers: {}\nb: 2\n");
  // When the file changed since (so no text matches the hash taken before the install) the plain removal stands: an empty parent.
  const touched = `# new\n${flow.text}`;
  assert.equal(afterOf(planRecipe(recipe, state("uninstall", touched, flow.plan.entries))), "# new\na: 1\nmcp_servers:\nb: 2\n");
});

void test("yaml-map uninstall: a file that ended without a line ending gets that back, and only while the entry is still the last thing in it", () => {
  const first = install("a: 1");
  assert.equal(afterOf(planRecipe(recipe, state("uninstall", first.text, first.plan.entries))), "a: 1");
  assert.equal(afterOf(planRecipe(recipe, state("uninstall", `${first.text}\nz: 2\n`, first.plan.entries))), "a: 1\nz: 2\n");
});

void test("yaml-map uninstall: no receipt entry or a gone entry is a clean no-op; a changed one is drifted", () => {
  assert.deepEqual(planRecipe(recipe, state("uninstall", BLOCK)), { changes: [], entries: [] });
  const first = install("a: 1\n");
  const gone = planRecipe(recipe, state("uninstall", "a: 1\n", first.plan.entries));
  assert.equal(gone.changes[0]?.action, "noop");
  assert.deepEqual(gone.entries, []);
  const missingFile = planRecipe(recipe, state("uninstall", null, first.plan.entries));
  assert.equal(missingFile.changes[0]?.action, "noop");
  for (const edit of [
    first.text.replace("command: realm", "command: evil"),
    first.text.replace("      - hermes\n", "      - hermes\n      - extra\n"),
    first.text.replace("    args:", "    enabled: true\n    args:"),
    `${first.text}  realm:\n    command: again\n`,
  ]) {
    refused(() => planRecipe(recipe, state("uninstall", edit, first.plan.entries)), "drifted", "POLICY_DENIED");
  }
  const [owned] = first.plan.entries;
  assert.ok(owned !== undefined);
  const wrongPath: ReceiptEntry = { ...owned, path: "other.yaml" };
  refused(() => planRecipe(recipe, state("uninstall", first.text, [wrongPath])), "drifted", "POLICY_DENIED");
  const noHash: ReceiptEntry = { path: FILE, kind: "yaml-map", beforeSha256: null, afterSha256: sha256Text(first.text) };
  refused(() => planRecipe(recipe, state("uninstall", first.text, [noHash])), "drifted", "POLICY_DENIED");
});

void test("yaml-map uninstall: the host's own re-quoted and re-flowed entry is still the owned entry", () => {
  const first = install("a: 1\n");
  const rewritten = 'a: 1\n\nmcp_servers:\n  realm:\n    command: "realm"\n    args: ["mcp", "--host", "hermes"]\n';
  assert.equal(afterOf(planRecipe(recipe, state("uninstall", rewritten, first.plan.entries))), "a: 1\n\n");
});

// ---- the recipe itself --------------------------------------------------------------------------------------------------------------

void test("yaml-map: a recipe that is not exactly one entry of plain strings is SCHEMA_INVALID", () => {
  const invalid = (changes: Partial<YamlMap>): void => {
    const bad = { ...recipe, ...changes };
    for (const work of [
      () => planRecipe(bad, state("install", null)),
      () => planRecipe(bad, state("uninstall", null, [{ path: FILE, kind: "yaml-map", beforeSha256: null, afterSha256: OWNED_HASH, ownedSha256: OWNED_HASH }])),
    ]) {
      assert.throws(work, (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID", JSON.stringify(changes));
    }
    assert.deepEqual(ownedPart(bad, "a: 1\n"), { parsed: false, sha256: null }, "status reads it as unparsed");
  };
  // The path: dotted, unsafe or YAML-typed keys.
  invalid({ path: ["mcp.servers", "realm"] });
  invalid({ path: ["mcp_servers", "re.alm"] });
  invalid({ path: ["__proto__", "realm"] });
  invalid({ path: ["mcp_servers", "constructor"] });
  invalid({ path: ["-servers", "realm"] });
  invalid({ path: ["mcp_servers", "yes"] });
  invalid({ path: ["mcp_servers", "a b"] });
  invalid({ file: "../escape.yaml" });
  // The value: strings that are not plain scalars, or that YAML would type.
  for (const text of ["yes", "no", "on", "off", "true", "false", "null", "~", "1e3", "12", "-1", ".5", ".inf", "1.2.3", ": x", "a b", "#c", "", "a:", "-", "@x", "%x", "=x", "x\ny", "it's", 'say "x"', "[a]", "{a}", "a,b", "a\u00e9", "x".repeat(257)]) {
    invalid({ value: { command: text } });
    invalid({ value: { command: "realm", args: ["mcp", text] } });
  }
  invalid({ value: {} });
  invalid({ value: Object.fromEntries(Array.from({ length: 9 }, (_, index): [string, string] => [`k${String(index)}`, "v"])) });
  invalid({ value: { "bad-key": "v" } });
  invalid({ value: { command: "realm", args: Array.from({ length: 17 }, () => "a") } });
});

void test("yaml-map: the table value of hermes, and the largest accepted recipe, are valid", () => {
  assert.equal(planRecipe(recipe, state("install", null)).changes[0]?.action, "create");
  const six = Object.fromEntries(Array.from({ length: 6 }, (_, index): [string, string] => [`k${String(index)}`, "v"]));
  const sixteen = Array.from({ length: 16 }, (_, index) => `item_${String(index)}`);
  const big: YamlMap = { ...recipe, value: { ...six, command: "x".repeat(256), args: sixteen } };
  assert.equal(planRecipe(big, state("install", null)).changes[0]?.action, "create", "8 keys, 16 items and a 256-character string");
  const empty: YamlMap = { ...recipe, value: { command: "realm", args: [] } };
  assert.equal(afterOf(planRecipe(empty, state("install", null))), "mcp_servers:\n  realm:\n    command: realm\n    args: []\n");
  for (const value of ["--host", "-x", "./bin/realm", "a/b", "a=b", "v1.2", "A_b-c+d%e:f@g"]) {
    const ok: YamlMap = { ...recipe, value: { command: value } };
    assert.equal(planRecipe(ok, state("install", null)).changes[0]?.action, "create", value);
  }
});

// ---- status -------------------------------------------------------------------------------------------------------------------------

void test("yaml-map status: the owned part hashes the parsed entry, whatever its quoting, spacing or comments", () => {
  const owned = (content: string): { readonly parsed: boolean; readonly sha256: string | null } => ownedPart(recipe, content);
  assert.deepEqual(owned(BLOCK), { parsed: true, sha256: OWNED_HASH });
  assert.deepEqual(owned(crlf(`a: 1\n${BLOCK}`)), { parsed: true, sha256: OWNED_HASH });
  assert.deepEqual(owned('mcp_servers:\n  realm:\n    command: "realm"\n    args: ["mcp", \'--host\', hermes]\n'), { parsed: true, sha256: OWNED_HASH });
  assert.deepEqual(owned("mcp_servers:\n  realm:\n    args: [mcp, --host, hermes]\n    command: realm   # c\n"), { parsed: true, sha256: OWNED_HASH }, "key order does not matter");
});

void test("yaml-map status: another value is drift, an absent entry is null, an unreadable file is unparsed, a foreign definition reads as drift", () => {
  const owned = (content: string): { readonly parsed: boolean; readonly sha256: string | null } => ownedPart(recipe, content);
  assert.equal(owned("mcp_servers:\n  realm:\n    command: evil\n").parsed, true);
  assert.notEqual(owned("mcp_servers:\n  realm:\n    command: evil\n").sha256, OWNED_HASH);
  assert.notEqual(owned("mcp_servers:\n  realm:\n    command: realm\n    args: [mcp, --host, hermes]\n    enabled: true\n").sha256, OWNED_HASH, "an added key is drift");
  assert.deepEqual(owned(""), { parsed: true, sha256: null });
  assert.deepEqual(owned("mcp_servers:\n  other:\n    command: x\n"), { parsed: true, sha256: null });
  assert.deepEqual(owned("a: &x 1\n"), { parsed: false, sha256: null });
  assert.deepEqual(owned("\uFEFF"), { parsed: false, sha256: null });
  const foreign = owned("mcp_servers: []\n");
  assert.equal(foreign.parsed, true);
  assert.notEqual(foreign.sha256, null);
  assert.notEqual(foreign.sha256, OWNED_HASH);
  const unreadableEntry = owned("mcp_servers:\n  realm: {command: realm}\n");
  assert.deepEqual(unreadableEntry, foreign, "an entry the reader does not accept hashes like a foreign definition");
});
