// The conservative YAML scanner of the `yaml-map` recipe (src/host/yaml-scan.ts): every row of the shared case table (test/support/host-yaml-cases.ts)
// has its state pinned, the locations of the free and present states are pinned, the tiny entry reader accepts and rejects exactly the listed
// constructs, and a hostile input is bounded. Pure: strings in, scan out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { scanYamlMap, type YamlScan } from "../../src/host/yaml-scan.js";
import { YAML_FOREIGN, YAML_UNPARSEABLE, YAML_VALID } from "../support/host-yaml-cases.js";

const PATH = ["mcp_servers", "realm"] as const;
const MAX = 1024 * 1024;

function scan(text: string): YamlScan {
  return scanYamlMap(text, PATH);
}

for (const c of YAML_UNPARSEABLE) {
  void test(`yaml-scan: ${c.name} is unreadable`, () => {
    assert.equal(scan(c.seed).state, "unreadable");
  });
}

for (const c of YAML_FOREIGN) {
  void test(`yaml-scan: ${c.name} is foreign`, () => {
    assert.equal(scan(c.seed).state, "foreign");
  });
}

for (const c of YAML_VALID) {
  void test(`yaml-scan: ${c.name} is ${c.scan}`, () => {
    assert.equal(scan(c.seed).state, c.scan);
  });
}

void test("yaml-scan: a free scan with no parent reports the line ending and no parent", () => {
  assert.deepEqual(scan(""), { state: "free", eol: "\n", parent: null });
  assert.deepEqual(scan("a: 1\n"), { state: "free", eol: "\n", parent: null });
  assert.deepEqual(scan("a: 1\r\nb: 2\r\n"), { state: "free", eol: "\r\n", parent: null });
});

void test("yaml-scan: a free scan with a block parent says where the entry goes, at which indent", () => {
  const seed = "a: 1\nmcp_servers:\n  other:\n    command: x\n  # c\nb: 2\n";
  const found = scan(seed);
  assert.equal(found.state, "free");
  assert.ok(found.parent !== null);
  assert.equal(found.parent.headerStart, seed.indexOf("mcp_servers:"));
  assert.equal(found.parent.headerEnd, seed.indexOf("  other:"));
  assert.equal(found.parent.colon, "mcp_servers".length);
  assert.equal(found.parent.flowEnd, -1);
  assert.equal(found.parent.childIndent, 2);
  assert.equal(found.parent.insertAt, seed.indexOf("  # c"), "just after the last content line, before the trailing comment");
  assert.equal(found.parent.bare, false);
});

void test("yaml-scan: a parent with nothing below it takes the entry right under its header and is bare", () => {
  const found = scan("mcp_servers:\n\nb: 2\n");
  assert.ok(found.state === "free" && found.parent !== null);
  assert.equal(found.parent.childIndent, null);
  assert.equal(found.parent.insertAt, "mcp_servers:\n".length);
  assert.equal(found.parent.bare, true);
  const commented = scan("mcp_servers:\n  # c\n");
  assert.ok(commented.state === "free" && commented.parent !== null);
  assert.equal(commented.parent.bare, false, "an indented comment is not Realm's");
  const rootComment = scan("mcp_servers:\n# c\nb: 2\n");
  assert.ok(rootComment.state === "free" && rootComment.parent !== null);
  assert.equal(rootComment.parent.bare, true, "a column-0 comment belongs to what follows");
});

void test("yaml-scan: `{}` is reported with the offset just after it", () => {
  const found = scan("mcp_servers: {}   # none\n");
  assert.ok(found.state === "free" && found.parent !== null);
  assert.equal(found.parent.flowEnd, "mcp_servers: {}".length);
  assert.equal(found.parent.colon, "mcp_servers".length);
  assert.equal(found.parent.childIndent, null);
});

void test("yaml-scan: a present entry spans its lines up to its last content line and no further", () => {
  const seed = "mcp_servers:\n  other:\n    command: x\n  realm:\n    command: realm\n    args: [mcp, --host, hermes]\n\n  # after\nz: 1\n";
  const found = scan(seed);
  assert.ok(found.state === "present");
  assert.equal(found.childIndent, 2);
  assert.equal(found.entry.start, seed.indexOf("  realm:"));
  assert.equal(found.entry.end, seed.indexOf("\n  # after"), "the blank line and the comment are not part of it");
  assert.deepEqual(found.entry.value, { command: "realm", args: ["mcp", "--host", "hermes"] });
});

void test("yaml-scan: an entry on the last line without a line ending ends at the end of the file", () => {
  const seed = "mcp_servers:\n  realm:\n    command: realm";
  const found = scan(seed);
  assert.ok(found.state === "present");
  assert.equal(found.entry.end, seed.length);
  assert.deepEqual(found.entry.value, { command: "realm" });
});

// A seed whose entry body is `body` (already indented under `realm:`).
function entryOf(body: string): unknown {
  const found = scan(`mcp_servers:\n  realm:\n${body}`);
  assert.ok(found.state === "present", body);
  return found.entry.value;
}

void test("yaml-scan: the entry reader accepts plain, single-quoted and double-quoted scalars", () => {
  assert.deepEqual(entryOf("    command: realm\n"), { command: "realm" });
  assert.deepEqual(entryOf("    command: 'it''s'\n"), { command: "it's" });
  assert.deepEqual(entryOf('    command: "a \\"b\\" \\\\ c"\n'), { command: 'a "b" \\ c' });
  assert.deepEqual(entryOf("    command: realm   # a note\n"), { command: "realm" });
  assert.deepEqual(entryOf('    "command": realm\n    \'name\': x\n'), { command: "realm", name: "x" });
  assert.deepEqual(entryOf("    command: a#b\n"), { command: "a#b" }, "a # with no space before it is not a comment");
  assert.deepEqual(entryOf("    command: --host\n"), { command: "--host" });
});

void test("yaml-scan: the entry reader accepts a block sequence, a level sequence and a flow sequence", () => {
  assert.deepEqual(entryOf("    args:\n      - mcp\n      - --host\n"), { args: ["mcp", "--host"] });
  assert.deepEqual(entryOf("    args:\n    - mcp\n    - 'x y'\n"), { args: ["mcp", "x y"] });
  assert.deepEqual(entryOf("    args: [mcp, \"--host\", 'hermes']\n"), { args: ["mcp", "--host", "hermes"] });
  assert.deepEqual(entryOf("    args: []\n"), { args: [] });
  assert.deepEqual(entryOf("    args: [ 'a, b' ,c ]\n"), { args: ["a, b", "c"] });
  assert.deepEqual(entryOf("    command: realm\n    args:\n      - a\n    cwd: x\n"), { command: "realm", args: ["a"], cwd: "x" });
});

void test("yaml-scan: the entry reader skips blank and comment lines inside the entry", () => {
  assert.deepEqual(entryOf("    # first\n    command: realm\n\n    # second\n    args: [a]\n"), { command: "realm", args: ["a"] });
});

void test("yaml-scan: the entry reader rejects every construct it was not given", () => {
  const rejected: readonly (readonly [string, string])[] = [
    ["a double-quoted escape other than \\\" and \\\\", '    command: "a\\nb"\n'],
    ["a hex escape", '    command: "\\x41"\n'],
    ["a block scalar", "    command: |\n      realm\n"],
    ["a folded scalar", "    command: >\n      realm\n"],
    ["a nested mapping", "    env:\n      A: b\n"],
    ["a repeated key", "    command: a\n    command: b\n"],
    ["a nested flow sequence", "    args: [[a]]\n"],
    ["a flow mapping value", "    env: {A: b}\n"],
    ["a flow sequence with a trailing comma", "    args: [a,]\n"],
    ["a flow sequence with an empty item", "    args: [a,,b]\n"],
    ["a flow sequence that does not close", "    args: [a, b\n"],
    ["a key with no value and no sequence", "    command:\n"],
    ["a sequence in a sequence", "    args:\n      - - a\n"],
    ["a sequence item with no text", "    args:\n      -\n"],
    ["a mapping inside a sequence item", "    args:\n      - a: b\n"],
    ["a sequence whose items are indented differently", "    args:\n      - a\n        - b\n"],
    ["a plain scalar that is a mapping", "    command: a: b\n"],
    ["a plain scalar that starts like a flow collection", "    command: [a\n"],
    ["a plain scalar that ends in a colon", "    command: a:\n"],
    ["a line that is not a key", "    command realm\n"],
    ["a body that is not at one indent", "    command: a\n   other: b\n"],
    ["an empty body", ""],
  ];
  for (const [name, body] of rejected) {
    assert.equal(entryOf(body), null, name);
  }
});

void test("yaml-scan: an inline or empty realm is present but not readable", () => {
  for (const line of ["  realm: {command: evil}\n", "  realm: text\n", "  realm:\n", "  realm: ~\n"]) {
    const found = scan(`mcp_servers:\n${line}`);
    assert.ok(found.state === "present", line);
    assert.equal(found.entry.value, null, line);
  }
});

void test("yaml-scan: the three spellings of a key are the same key", () => {
  for (const [parent, child] of [["mcp_servers", "realm"], ['"mcp_servers"', "'realm'"], ["'mcp_servers'", '"realm"']] as const) {
    const found = scan(`${parent}:\n  ${child}:\n    command: realm\n`);
    assert.ok(found.state === "present", `${parent} ${child}`);
    assert.deepEqual(found.entry.value, { command: "realm" });
  }
  assert.equal(scan('"mcp\\x5fservers":\n  realm:\n    command: x\n').state, "unreadable", "an escape in a quoted key is not interpreted");
});

void test("yaml-scan: indented look-alikes outside the block are never the parent", () => {
  assert.equal(scan("outer:\n  mcp_servers:\n    realm:\n      command: x\n").state, "free");
  assert.deepEqual(scan("outer:\n  mcp_servers:\n    realm: x\n"), { state: "free", eol: "\n", parent: null });
});

void test("yaml-scan: a look-alike inside a block scalar is skipped at any indent, and a block scalar ends at the next line that is not deeper", () => {
  const body = "k: |\n  mcp_servers:\n    realm:\n      command: x\n   still the body\nmcp_servers:\n  other:\n    command: y\n";
  const found = scan(body);
  assert.ok(found.state === "free" && found.parent !== null);
  assert.equal(found.parent.headerStart, body.indexOf("mcp_servers:\n  other"));
  assert.equal(scan("k: >-\n  mcp_servers: {a: 1}\nz: 1\n").state, "free");
  assert.equal(scan("k: |2\n  mcp_servers: {a: 1}\nz: 1\n").state, "free");
});

void test("yaml-scan: a tab inside a block scalar body or a value is not a tab used for indentation", () => {
  assert.equal(scan("k: |\n  \tmcp_servers: x\nz: 1\n").state, "free");
  assert.equal(scan("k: a\tb\n").state, "free");
});

void test("yaml-scan: anchors, aliases, tags and merge keys are refused only outside quotes and comments", () => {
  assert.equal(scan('a: "x &y *z !t"\nb: \'<<: *q\'\n# &c *d !e\n').state, "free");
  assert.equal(scan("a: [*x]\n").state, "unreadable");
  assert.equal(scan("a: {b: &x 1}\n").state, "unreadable");
  assert.equal(scan("a: 1 # note\n  - *x\n").state, "unreadable");
  assert.equal(scan("a: x&y\nb: p*q\nc: r!s\n").state, "free", "a sign inside a word starts no token");
});

void test("yaml-scan: no input over 1 MiB is scanned, and one of exactly 1 MiB is", () => {
  assert.equal(scan(`${"#".repeat(MAX - 1)}\n`).state, "free");
  assert.equal(scan(`${"#".repeat(MAX)}\n`).state, "unreadable");
  assert.equal(scan(`mcp_servers:\n  realm:\n    command: realm\n${"# pad\n".repeat(MAX / 6)}`).state, "unreadable");
});

void test("yaml-scan: a pathological 200 000-character line returns in bounded time", { timeout: 10_000 }, () => {
  const long = 200_000;
  const inputs = [
    `a: ${"x ".repeat(long / 2)}\n`,
    `a: ${"[".repeat(long)}\n`,
    `a: ${"'".repeat(long)}\n`,
    `a: "${"\\".repeat(long)}"\n`,
    `${"<".repeat(long)}\n`,
    `a: ${"| ".repeat(long / 2)}\n`,
    `a: ${": ".repeat(long / 2)}\n`,
    `mcp_servers:\n  realm:\n    command: ${"y".repeat(long)}\n`,
    `mcp_servers:\n  realm:\n    args: [${"a,".repeat(long / 2)}a]\n`,
    `mcp_servers:\n${" ".repeat(long)}x: 1\n`,
    `${"a:".repeat(long / 2)}\n`,
  ];
  for (const input of inputs) {
    assert.ok(["free", "present", "unreadable", "foreign"].includes(scan(input).state));
  }
});
