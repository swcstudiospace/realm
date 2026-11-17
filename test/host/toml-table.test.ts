import { test } from "node:test";
import assert from "node:assert/strict";
import { tomlTableState } from "../../src/host/toml-table.js";

const TARGET = ["mcp_servers", "realm"] as const;

function stateOf(text: string): "free" | "taken" | "unreadable" {
  return tomlTableState(text, TARGET);
}

function crlf(text: string): string {
  return text.replaceAll("\n", "\r\n");
}

const TAKEN: readonly string[] = [
  "[mcp_servers.realm]\ncommand = \"x\"\n",
  "[ mcp_servers . realm ]\n",
  "[mcp_servers.\"realm\"]\n",
  "['mcp_servers'.'realm']\n",
  "[\"mcp_servers\".\"realm\"]\n",
  "[mcp_servers.realm.env]\n",
  "[[mcp_servers.realm]]\n",
  "[mcp_servers.realm] # note\n",
  "[mcp_servers]\nrealm = { command = \"x\" }\n",
  "[mcp_servers]\n\"realm\" = {}\n",
  "[mcp_servers]\nrealm.command = \"x\"\n",
  "mcp_servers.realm.command = \"x\"\n",
  "mcp_servers = { realm = {} }\n",
  "mcp_servers.other.x = 1\n",
  "[other]\nx = 1\n\n[mcp_servers.realm]\n",
  "\uFEFF[mcp_servers.realm]\n",
  "    [mcp_servers.realm]\n",
  "[mcp_servers.realm]",
];

const FREE: readonly string[] = [
  "[mcp_servers.railway]\ncommand = \"x\"\n",
  "[mcp_servers.realm2]\n",
  "[mcp_servers.realm-x]\n",
  "[mcp_servers]\n",
  "[mcp_servers.railway.env]\nTOKEN = \"x\"\n",
  "# [mcp_servers.realm]\n",
  "[other]\nrealm = 1\n",
  "",
  "# only a comment\n\n# another\n",
  "[mcp_servers.railway]\nrealm = 1\n",
  "[features]\nhooks = true\n[mcp_servers.railway]\nx = 1\n",
  "\n\n   \n",
  "other = 1\nmore.keys = 2\n",
];

const UNREADABLE: readonly string[] = ["[mcp_servers.realm\n", "[mcp_servers..realm]\n", "[]\n", "[1, 2]\n", "[[mcp_servers.realm]\n", "[mcp_servers.realm]]\n"];

void test("every taken form of the table and its ancestors is taken", () => {
  for (const text of TAKEN) {
    assert.equal(stateOf(text), "taken", JSON.stringify(text));
  }
});

void test("every taken form is taken with CRLF line endings too", () => {
  for (const text of TAKEN) {
    assert.equal(stateOf(crlf(text)), "taken", JSON.stringify(text));
  }
});

void test("free forms are free, with LF and CRLF", () => {
  for (const text of FREE) {
    assert.equal(stateOf(text), "free", JSON.stringify(text));
    assert.equal(stateOf(crlf(text)), "free", JSON.stringify(crlf(text)));
  }
});

void test("a header or line the scanner cannot read is unreadable", () => {
  for (const text of UNREADABLE) {
    assert.equal(stateOf(text), "unreadable", JSON.stringify(text));
  }
});

void test("the first taken or unreadable line in file order wins", () => {
  assert.equal(stateOf("[mcp_servers.realm]\n[broken\n"), "taken");
  assert.equal(stateOf("[broken\n[mcp_servers.realm]\n"), "unreadable");
});

void test("a deeper target is matched at every depth", () => {
  const deep = ["a", "b", "c"];
  assert.equal(tomlTableState("[a.b.c]\n", deep), "taken");
  assert.equal(tomlTableState("[a.b]\nc.d = 1\n", deep), "taken");
  assert.equal(tomlTableState("[a.b]\nx = 1\n", deep), "free");
  assert.equal(tomlTableState("[a]\nb = {}\n", deep), "taken");
});

void test("an input over 1 MiB is unreadable", () => {
  assert.equal(stateOf(`# ${"x".repeat(1024 * 1024)}\n`), "unreadable");
});

void test("pathological single lines are answered, not hung", () => {
  assert.equal(stateOf(`${"[".repeat(100_000)}\n`), "unreadable");
  assert.equal(stateOf(`${".".repeat(100_000)}\n`), "free");
  assert.equal(stateOf(`${"a.".repeat(50_000)}\n`), "free");
  assert.equal(stateOf(`${"a".repeat(100_000)} = 1\n`), "free");
  assert.equal(stateOf(`[${"a.".repeat(50_000)}\n`), "unreadable");
  assert.equal(stateOf(`${" ".repeat(100_000)}[mcp_servers.realm]\n`), "taken");
  assert.equal(stateOf(`[a${" ".repeat(100_000)}\n`), "unreadable");
  assert.equal(stateOf(`${"\"".repeat(100_000)}\n`), "free");
});

void test("a look-alike inside a multi-line string is a documented false positive: taken", () => {
  assert.equal(stateOf('note = """\n[mcp_servers.realm]\n"""\n'), "taken");
});
