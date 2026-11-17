// The `toml-table` recipe planner (src/host/toml-owned.ts): one TOML table owned by its header, no marker. Pure: strings in, plan out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError } from "../../src/core/errors.js";
import { HostRefusal, ownedPart, planRecipe, sha256Text, type HostRefusalReason, type PlanState, type RecipePlan } from "../../src/host/recipe.js";
import type { ReceiptEntry } from "../../src/host/receipt.js";
import type { InstallRecipe } from "../../src/host/types.js";

type TomlTable = Extract<InstallRecipe, { kind: "toml-table" }>;

const OWNED = '[mcp_servers.realm]\ncommand = "realm"\nargs = ["mcp", "--host", "codex"]\n';
const recipe: TomlTable = {
  kind: "toml-table",
  file: "config.toml",
  table: ["mcp_servers", "realm"],
  text: OWNED.slice(0, -1),
};
const OWNED_HASH = sha256Text(OWNED);

function crlf(text: string): string {
  return text.replaceAll("\n", "\r\n");
}

function state(operation: PlanState["operation"], file: string | null, receipt: readonly ReceiptEntry[] = []): PlanState {
  return { operation, files: new Map([["config.toml", file]]), dirs: new Set([""]), listings: new Map(), receipt, bundle: [] };
}

function afterOf(plan: RecipePlan): string | null {
  const change = plan.changes.find((candidate) => candidate.path === "config.toml");
  assert.ok(change, "a change for config.toml");
  return change.after;
}

function refused(work: () => unknown, reason: HostRefusalReason, code: string): void {
  assert.throws(work, (error: unknown) => error instanceof HostRefusal && error.refusal === reason && error.code === code, reason);
}

// Installs over `file` and returns the plan and the text it wrote.
function install(file: string | null, receipt: readonly ReceiptEntry[] = [], using: InstallRecipe = recipe): { plan: RecipePlan; text: string } {
  const plan = planRecipe(using, state("install", file, receipt));
  const text = afterOf(plan);
  assert.ok(text !== null);
  return { plan, text };
}

void test("toml-table install: an absent file is created with exactly the table and marks the file as created", () => {
  const { plan, text } = install(null);
  assert.equal(text, OWNED);
  assert.equal(plan.changes[0]?.action, "create");
  assert.equal(plan.entries[0]?.kind, "toml-table");
  assert.equal(plan.entries[0]?.ownedSha256, OWNED_HASH);
  assert.equal(plan.entries[0]?.createdFile, true);
  assert.equal(plan.entries[0]?.separatorAdded, undefined);
  assert.equal(text.includes("#"), false, "no marker and no comment");
});

void test("toml-table install: the table is appended after one blank line, and every prior byte stays", () => {
  const cases: readonly { readonly seed: string; readonly wrote: string; readonly separator: boolean }[] = [
    { seed: "", wrote: OWNED, separator: false },
    { seed: "a = 1\n", wrote: `a = 1\n\n${OWNED}`, separator: true },
    { seed: "a = 1\n\n", wrote: `a = 1\n\n${OWNED}`, separator: false },
    { seed: "a = 1", wrote: `a = 1\n\n${OWNED}`, separator: true },
    { seed: "# user comment\nmodel = \"x\"\n\n[mcp_servers.railway]\ncommand = \"b\"\n", wrote: `# user comment\nmodel = "x"\n\n[mcp_servers.railway]\ncommand = "b"\n\n${OWNED}`, separator: true },
    { seed: "a = 1\r\n", wrote: `a = 1\r\n\r\n${crlf(OWNED)}`, separator: true },
    { seed: "a = 1\r\n\r\n", wrote: `a = 1\r\n\r\n${crlf(OWNED)}`, separator: false },
    { seed: "\uFEFFa = 1\n", wrote: `\uFEFFa = 1\n\n${OWNED}`, separator: true },
  ];
  for (const { seed, wrote, separator } of cases) {
    const { plan, text } = install(seed);
    assert.equal(text, wrote, JSON.stringify(seed));
    assert.equal(plan.entries[0]?.separatorAdded === true, separator, JSON.stringify(seed));
    assert.equal(plan.entries[0]?.createdFile, undefined);
  }
});

void test("toml-table install then uninstall gives back the original bytes for every seed", () => {
  for (const seed of ["", "a = 1\n", "a = 1\n\n", "a = 1", "\n", "a = 1\r\n", "a = 1\r\nb = 2", "[features]\nhooks = true", "# only a comment\n"]) {
    const { plan, text } = install(seed);
    const removed = planRecipe(recipe, state("uninstall", text, plan.entries));
    assert.equal(afterOf(removed), seed, JSON.stringify(seed));
  }
  const created = install(null);
  const removed = planRecipe(recipe, state("uninstall", created.text, created.plan.entries));
  assert.equal(removed.changes[0]?.action, "remove", "a file Realm created is removed with its table");
});

void test("toml-table install: a second install is a no-op that keeps the receipt entry", () => {
  const first = install("a = 1\n");
  const again = planRecipe(recipe, state("install", first.text, first.plan.entries));
  assert.equal(again.changes[0]?.action, "noop");
  assert.deepEqual(again.entries, first.plan.entries);
});

void test("toml-table install: the owned text without a receipt is not Realm's, so it is foreign-content", () => {
  refused(() => planRecipe(recipe, state("install", OWNED)), "foreign-content", "POLICY_DENIED");
  refused(() => planRecipe(recipe, state("install", `a = 1\n\n${OWNED}`)), "foreign-content", "POLICY_DENIED");
});

void test("toml-table install: different text, a duplicate, a subtable and a dotted or inline definition are foreign-content", () => {
  const first = install("a = 1\n");
  const seeds = [
    '[mcp_servers.realm]\ncommand = "other"\n',
    `${first.text}\n${OWNED}`,
    `${first.text}\n[mcp_servers.realm.env]\nA = "1"\n`,
    `${first.text}\n[[mcp_servers.realm]]\n`,
    '[mcp_servers]\nrealm = { command = "x" }\n',
    '[mcp_servers]\nrealm.command = "x"\n',
    'mcp_servers.realm.command = "x"\n',
    "mcp_servers = { realm = {} }\n",
    "[ mcp_servers . realm ]\n",
    '[mcp_servers.realm] # note\ncommand = "realm"\n',
    '    [mcp_servers.realm]\ncommand = "realm"\n',
    `# a comment\n${OWNED.replace('command = "realm"\n', '# a comment inside\ncommand = "realm"\n')}`,
  ];
  for (const seed of seeds) {
    for (const receipt of [[], first.plan.entries]) {
      refused(() => planRecipe(recipe, state("install", seed, receipt)), "foreign-content", "POLICY_DENIED");
    }
  }
  for (const seed of ["[mcp_servers.realm\n", "[mcp_servers..realm]\n", `${OWNED}[oops\n`]) {
    refused(() => planRecipe(recipe, state("install", seed)), "unparseable", "SCHEMA_INVALID");
  }
});

void test("toml-table install: a table the receipt owns with older text is replaced in place, the rest of the file stays", () => {
  const older: TomlTable = { ...recipe, text: '[mcp_servers.realm]\ncommand = "realm-old"' };
  const first = install("# keep\n[a]\nx = 1\n", [], older);
  const other = `${first.text}\n[mcp_servers.other]\ncommand = "o"\n`;
  const upgraded = planRecipe(recipe, state("install", other, first.plan.entries));
  assert.equal(afterOf(upgraded), `# keep\n[a]\nx = 1\n\n${OWNED}\n[mcp_servers.other]\ncommand = "o"\n`);
  assert.equal(upgraded.entries[0]?.ownedSha256, OWNED_HASH);
  assert.equal(upgraded.entries[0]?.separatorAdded, first.plan.entries[0]?.separatorAdded);
  // The same table without a receipt is never replaced.
  refused(() => planRecipe(recipe, state("install", other)), "foreign-content", "POLICY_DENIED");
});

void test("toml-table uninstall: another table inserted after (as `codex mcp add other` does) stays, and only the owned table goes", () => {
  const first = install("# user comment\nmodel = \"x\"\n");
  const rewritten = `${first.text}\n[mcp_servers.other]\ncommand = "echo"\nargs = ["hi"]\n`;
  const removed = planRecipe(recipe, state("uninstall", rewritten, first.plan.entries));
  assert.equal(afterOf(removed), '# user comment\nmodel = "x"\n\n[mcp_servers.other]\ncommand = "echo"\nargs = ["hi"]\n');
  // Another table before it, with a comment line that belongs to the next table, is kept byte for byte.
  const between = `# user comment\nmodel = "x"\n\n${OWNED}\n# about o\n[mcp_servers.other]\ncommand = "echo"\n`;
  const kept = planRecipe(recipe, state("uninstall", between, first.plan.entries));
  assert.equal(afterOf(kept), '# user comment\nmodel = "x"\n\n# about o\n[mcp_servers.other]\ncommand = "echo"\n');
});

void test("toml-table uninstall: a CRLF file keeps its line endings", () => {
  const first = install("a = 1\r\nb = 2\r\n");
  assert.equal(first.text, `a = 1\r\nb = 2\r\n\r\n${crlf(OWNED)}`);
  const withOther = `${first.text}\r\n[mcp_servers.other]\r\ncommand = "o"\r\n`;
  const removed = planRecipe(recipe, state("uninstall", withOther, first.plan.entries));
  assert.equal(afterOf(removed), 'a = 1\r\nb = 2\r\n\r\n[mcp_servers.other]\r\ncommand = "o"\r\n');
});

void test("toml-table uninstall: an edited table is drifted, a removed table or file is a no-op that ends the receipt", () => {
  const first = install("a = 1\n");
  refused(() => planRecipe(recipe, state("uninstall", first.text.replace('"realm"', '"evil"'), first.plan.entries)), "drifted", "POLICY_DENIED");
  refused(() => planRecipe(recipe, state("uninstall", `${first.text}\n[mcp_servers.realm.env]\nA = "1"\n`, first.plan.entries)), "drifted", "POLICY_DENIED");
  refused(() => planRecipe(recipe, state("uninstall", `${first.text}\n${OWNED}`, first.plan.entries)), "drifted", "POLICY_DENIED");
  refused(() => planRecipe(recipe, state("uninstall", `${first.text}[oops\n`, first.plan.entries)), "drifted", "POLICY_DENIED");

  const gone = planRecipe(recipe, state("uninstall", "a = 1\n\n[mcp_servers.other]\ncommand = \"o\"\n", first.plan.entries));
  assert.equal(gone.changes[0]?.action, "noop");
  const absent = planRecipe(recipe, state("uninstall", null, first.plan.entries));
  assert.equal(absent.changes[0]?.action, "noop");
  assert.deepEqual(planRecipe(recipe, state("uninstall", first.text)).changes, [], "no receipt, nothing to undo");
  // A receipt entry of another path or without an owned hash is not trusted.
  const stray = first.plan.entries.map((entry) => ({ ...entry, path: "other.toml" }));
  refused(() => planRecipe(recipe, state("uninstall", first.text, stray)), "drifted", "POLICY_DENIED");
  const unowned = first.plan.entries.map((entry): ReceiptEntry => ({ path: entry.path, kind: entry.kind, beforeSha256: entry.beforeSha256, afterSha256: entry.afterSha256 }));
  refused(() => planRecipe(recipe, state("uninstall", first.text, unowned)), "drifted", "POLICY_DENIED");
});

void test("toml-table status: the owned part is the table text hash, null when absent, a fixed other hash when foreign, unparsed when unreadable", () => {
  assert.deepEqual(ownedPart(recipe, OWNED), { parsed: true, sha256: OWNED_HASH });
  assert.deepEqual(ownedPart(recipe, crlf(`a = 1\n\n${OWNED}\n[mcp_servers.other]\ncommand = "o"\n`)), { parsed: true, sha256: OWNED_HASH });
  assert.deepEqual(ownedPart(recipe, "# comment\n[features]\nhooks = true\n"), { parsed: true, sha256: null });
  const foreign = ownedPart(recipe, `${OWNED}\n${OWNED}`);
  assert.equal(foreign.parsed, true);
  assert.notEqual(foreign.sha256, null);
  assert.notEqual(foreign.sha256, OWNED_HASH);
  assert.deepEqual(ownedPart(recipe, "[mcp_servers.realm\n"), { parsed: false, sha256: null });
});

void test("toml-table: a recipe that is not exactly one table is SCHEMA_INVALID", () => {
  const invalid = (changes: Partial<TomlTable>): void => {
    assert.throws(
      () => planRecipe({ ...recipe, ...changes }, state("install", null)),
      (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
      JSON.stringify(changes),
    );
  };
  invalid({ table: [] });
  invalid({ table: ["mcp_servers", "re alm"] });
  invalid({ table: ["a", "b", "c", "d", "e", "f", "g"] });
  invalid({ text: '[mcp_servers.other]\ncommand = "x"' });
  invalid({ text: '# note\n[mcp_servers.realm]\ncommand = "x"' });
  invalid({ text: '[mcp_servers.realm]\n\ncommand = "x"' });
  invalid({ text: '[mcp_servers.realm]\n# note\ncommand = "x"' });
  invalid({ text: '[mcp_servers.realm]\ncommand = "x"\n[mcp_servers.realm.env]' });
  invalid({ text: '[mcp_servers.realm]\r\ncommand = "x"' });
  invalid({ file: "../escape.toml" });
  const six = ["a", "b", "c", "d", "e", "f"];
  assert.equal(planRecipe({ ...recipe, table: six, text: `[${six.join(".")}]\nx = 1` }, state("install", null)).changes[0]?.action, "create");
});
