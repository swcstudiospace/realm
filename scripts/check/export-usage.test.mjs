import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyze,
  collectExports,
  countEntries,
  filterEntries,
  isExcluded,
  parseArgs,
  runCheck,
  stripNonCode,
} from "./export-usage.mjs";

function namesOf(source) {
  return collectExports(source, "src/a/x.ts").exports.map((found) => `${found.kind}:${found.name}`);
}

function classOf(entries, name) {
  return entries.find((entry) => entry.name === name)?.class;
}

test("stripNonCode blanks comments, strings, template text and regular expressions but keeps lines and code", () => {
  const source = [
    "// export const inLineComment = 1;",
    "/* export const inBlock = 1;",
    "   still the block */ export const real = 'export const inString' + `text ${inner} more`;",
    'const pattern = /export const inRegex["\']/g;',
    "export const after = 1;",
  ].join("\n");
  const stripped = stripNonCode(source);
  assert.equal(stripped.split("\n").length, source.split("\n").length);
  assert.ok(stripped.includes("export const real"));
  assert.ok(stripped.includes("inner"));
  assert.ok(stripped.includes("export const after"));
  for (const gone of ["inLineComment", "inBlock", "inString", "inRegex", "text", "more"]) {
    assert.ok(!stripped.includes(gone), `${gone} must be blanked`);
  }
});

test("stripNonCode keeps a template expression that holds a nested template and braces", () => {
  const stripped = stripNonCode("const a = `x ${ fn({ k: `y ${deep}` }) } z`; export const b = 1;");
  assert.ok(stripped.includes("deep"));
  assert.ok(stripped.includes("fn"));
  assert.ok(stripped.includes("export const b"));
  assert.ok(!stripped.includes(" z"));
});

test("collectExports finds every declaration kind with its kind, space and line", () => {
  const source = [
    "export const a = 1;",
    "export let b = 2;",
    "export var c = 3;",
    "export function d(): void {}",
    "export async function e(): Promise<void> {}",
    "export function* f() {}",
    "export class G {}",
    "export abstract class H {}",
    "export interface I {}",
    "export type J = string;",
    "export enum K { One }",
    "export const enum L { One }",
  ].join("\n");
  const found = collectExports(source, "src/a/x.ts");
  assert.deepEqual(
    found.exports.map((entry) => [entry.name, entry.kind, entry.space, entry.line]),
    [
      ["a", "const", "value", 1],
      ["b", "let", "value", 2],
      ["c", "var", "value", 3],
      ["d", "function", "value", 4],
      ["e", "function", "value", 5],
      ["f", "function", "value", 6],
      ["G", "class", "value", 7],
      ["H", "abstract class", "value", 8],
      ["I", "interface", "type", 9],
      ["J", "type", "type", 10],
      ["K", "enum", "value", 11],
      ["L", "const enum", "value", 12],
    ],
  );
  assert.equal(found.unclassified, 0);
});

test("collectExports reads export lists, aliases and type-only lists", () => {
  const source = [
    "function local() {}",
    "interface Shape {}",
    "const plain = 1;",
    "export { local, plain as renamed };",
    "export type { Shape };",
    "export {",
    "  type Shape as Alias,",
    "};",
  ].join("\n");
  const found = collectExports(source, "src/a/x.ts").exports;
  assert.deepEqual(
    found.map((entry) => [entry.name, entry.local, entry.kind, entry.space, entry.line]),
    [
      ["local", "local", "function", "value", 4],
      ["renamed", "plain", "const", "value", 4],
      ["Shape", "Shape", "type", "type", 5],
      ["Alias", "Shape", "type", "type", 6],
    ],
  );
});

test("collectExports ignores default exports, commented and quoted exports, and counts re-exports as unclassified", () => {
  const source = [
    "// export const commented = 1;",
    'const message = "export const quoted = 1";',
    "export default function main() {}",
    'export { one, type Two } from "./other.js";',
    'export * from "./star.js";',
    "export const kept = 1;",
  ].join("\n");
  const found = collectExports(source, "src/a/x.ts");
  assert.deepEqual(namesOf(source), ["const:kept"]);
  assert.equal(found.unclassified, 3);
});

test("analyze classifies used-in-src, test-only (value and type), and self-only", () => {
  const { entries } = analyze({
    "src/a/one.ts": [
      "export const usedElsewhere = 1;",
      "export const testSeam = 2;",
      "export interface TestShape { x: number }",
      "export const insideOnly = 3;",
      "export const nowhere = 4;",
      "export const useInside = insideOnly + 1;",
    ].join("\n"),
    "src/b/two.ts": 'import { usedElsewhere, useInside } from "../a/one.js";\nexport const result = usedElsewhere + useInside;\n',
    "test/a/one.test.ts":
      'import { testSeam, type TestShape, result } from "../../src/a/one.js";\nconst shape: TestShape = { x: testSeam };\nvoid result;\n',
  });
  assert.equal(classOf(entries, "usedElsewhere"), "used-in-src");
  assert.equal(classOf(entries, "useInside"), "used-in-src");
  assert.equal(classOf(entries, "result"), "test-only");
  assert.equal(classOf(entries, "testSeam"), "test-only");
  assert.equal(classOf(entries, "TestShape"), "test-only");
  assert.equal(entries.find((entry) => entry.name === "TestShape")?.space, "type");
  assert.equal(entries.find((entry) => entry.name === "testSeam")?.space, "value");
  assert.equal(classOf(entries, "insideOnly"), "self-only");
  assert.equal(classOf(entries, "nowhere"), "self-only");
});

test("analyze counts a reference by its exported alias, not by its local name", () => {
  const { entries } = analyze({
    "src/a/one.ts": "const hidden = 1;\nexport { hidden as visible };\n",
    "src/b/two.ts": 'import { visible } from "../a/one.js";\nexport const copy = visible;\n',
    "test/x.test.ts": "const sentinel = copy;\n",
  });
  assert.equal(classOf(entries, "visible"), "used-in-src");
  assert.equal(classOf(entries, "copy"), "test-only");
});

test("analyze does not count a reference that is only in a comment or a string", () => {
  const { entries } = analyze({
    "src/a/one.ts": "export const documented = 1;\nexport const messaged = 2;\nexport const tested = 3;\n",
    "src/b/two.ts": [
      "// documented is described here, and {@link documented} too",
      'export const text = "messaged is a word in this message";',
      "export const template = `tested ${text.length}`;",
    ].join("\n"),
    "test/a/one.test.ts": '// tested\nconst label = "documented messaged tested";\n',
  });
  assert.equal(classOf(entries, "documented"), "self-only");
  assert.equal(classOf(entries, "messaged"), "self-only");
  assert.equal(classOf(entries, "tested"), "self-only");
});

test("analyze matches whole words only", () => {
  const { entries } = analyze({
    "src/a/one.ts": "export const run = 1;\n",
    "src/b/two.ts": "export const runner = 1;\nconst running$ = 2;\n",
  });
  assert.equal(classOf(entries, "run"), "self-only");
});

test("analyze excludes the errors, ports, contract and entry modules and ignores other paths", () => {
  const excluded = [
    "src/core/errors.ts",
    "src/core/ports.ts",
    "src/core/ports-extra.ts",
    "src/contract/validate.ts",
    "src/cli/main.ts",
    "src/runtime/driver/main.ts",
    "src/omp/extension.ts",
    "src/acp/stdio.ts",
  ];
  for (const path of excluded) {
    assert.equal(isExcluded(path), true, path);
  }
  for (const path of ["src/core/policy.ts", "src/core/support.ts", "src/acp/agent.ts", "src/mcp/main-loop.ts"]) {
    assert.equal(isExcluded(path), false, path);
  }
  const files = { "scripts/other.ts": "export const outside = 1;\n" };
  for (const path of excluded) {
    files[path] = "export const inExcluded = 1;\n";
  }
  files["src/core/policy.ts"] = "export const inPolicy = 1;\n";
  const { entries } = analyze(files);
  assert.equal(entries.filter((entry) => entry.class === "excluded").length, excluded.length);
  assert.equal(classOf(entries, "inPolicy"), "self-only");
  assert.equal(entries.some((entry) => entry.name === "outside"), false);
});

test("analyze gives every entry its directory and sorts entries by file and line", () => {
  const { entries } = analyze({
    "src/b/two.ts": "export const second = 1;\n",
    "src/a/one.ts": "export const first = 1;\nexport const third = 2;\n",
  });
  assert.deepEqual(
    entries.map((entry) => [entry.dir, entry.name, entry.line]),
    [
      ["src/a", "first", 1],
      ["src/a", "third", 2],
      ["src/b", "second", 1],
    ],
  );
});

test("analyze reports the unclassified re-export count over all src files", () => {
  const { unclassified } = analyze({
    "src/a/one.ts": 'export { x, y } from "./z.js";\nexport * from "./w.js";\n',
    "src/b/two.ts": 'export type { Q } from "./z.js";\n',
    "test/t.ts": 'export * from "./z.js";\n',
  });
  assert.equal(unclassified, 4);
});

test("countEntries counts per directory and class, and splits test-only by space", () => {
  const { entries } = analyze({
    "src/a/one.ts": "export const used = 1;\nexport interface Shape {}\nexport const seam = 1;\nexport const dead = 1;\n",
    "src/b/two.ts": "export const user = used;\n",
    "test/one.test.ts": "const x = [Shape, seam];\n",
  });
  const counts = countEntries(entries);
  assert.deepEqual(counts.byDirectory["src/a"], {
    "used-in-src": 1,
    "test-only": 2,
    "self-only": 1,
    "public-signature": 0,
    excluded: 0,
    total: 4,
  });
  assert.deepEqual(counts.byDirectory["src/b"], {
    "used-in-src": 0,
    "test-only": 0,
    "self-only": 1,
    "public-signature": 0,
    excluded: 0,
    total: 1,
  });
  assert.equal(counts.totals.total, 5);
  assert.equal(counts.totals.testOnlyValues, 1);
  assert.equal(counts.totals.testOnlyTypes, 1);
});

test("analyze marks a self-only type named in another export's signature as public-signature", () => {
  const { entries } = analyze({
    "src/a/one.ts": [
      "export interface Options { readonly inner: Inner }",
      "export interface Inner { readonly n: number }",
      "export type Hook = (options: Options) => void;",
      "export class Service {",
      "  constructor(config: Config) { this.run(config); }",
      "  run(config: Config): Result { const local: Body = build(); return local; }",
      "}",
      "export interface Config {}",
      "export interface Result {}",
      "export interface Body {}",
      "export interface Lonely {}",
      "export function make(options: Options): Service { const x: Hidden = build(); return x; }",
      "export interface Hidden {}",
      "export const table: readonly Row[] = [];",
      "export interface Row {}",
    ].join("\n"),
  });
  const expected = {
    Options: "public-signature",
    Inner: "public-signature",
    Hook: "self-only",
    Service: "self-only",
    Config: "public-signature",
    Result: "public-signature",
    Body: "self-only",
    Lonely: "self-only",
    Hidden: "self-only",
    Row: "public-signature",
    table: "self-only",
    make: "self-only",
  };
  assert.deepEqual(Object.fromEntries(entries.map((entry) => [entry.name, entry.class])), expected);
  assert.equal(entries.every((entry) => !("signature" in entry)), true);
});

const TREE = {
  "src/core/a.ts": "export const used = 1;\nexport const dead = 2;\n",
  "src/mcp/b.ts": 'import { used } from "../core/a.js";\nexport function seam(): number { return used; }\n',
  "src/mcp/c.ts": "export type OnlyTyped = string;\n",
  "test/mcp/b.test.ts": "const x = [seam];\n",
};

test("runCheck --list prints a table grouped by directory, then counts per directory and class", () => {
  const { code, output } = runCheck(["--list"], { loadFiles: () => TREE });
  assert.equal(code, 0);
  assert.equal(
    output,
    [
      "src/core/",
      "  used-in-src       const     used  src/core/a.ts:1",
      "  self-only         const     dead  src/core/a.ts:2",
      "",
      "src/mcp/",
      "  test-only         function  seam       src/mcp/b.ts:2",
      "  self-only         type      OnlyTyped  src/mcp/c.ts:1",
      "",
      "counts per directory and class",
      "  dir       used-in-src  test-only  self-only  public-signature  excluded  total",
      "  src/core  1            0          1          0                 0         2",
      "  src/mcp   0            1          1          0                 0         2",
      "  all       1            1          2          0                 0         4",
      "test-only: 1 values, 0 types",
      "unclassified re-exports and export-star statements: 0",
      "",
    ].join("\n"),
  );
});

test("runCheck lists by default and always exits 0 even when there are self-only exports", () => {
  const defaulted = runCheck([], { loadFiles: () => TREE });
  const listed = runCheck(["--list"], { loadFiles: () => TREE });
  assert.deepEqual(defaulted, listed);
  assert.equal(defaulted.code, 0);
  assert.match(defaulted.output, /self-only/);
});

test("runCheck --dir and --class filter the entries and their counts", () => {
  const dir = runCheck(["--dir", "src/mcp/"], { loadFiles: () => TREE });
  assert.match(dir.output, /seam/);
  assert.doesNotMatch(dir.output, /src\/core/);

  const klass = runCheck(["--class", "self-only", "--class", "test-only"], { loadFiles: () => TREE });
  assert.doesNotMatch(klass.output, /used-in-src {2}const/);
  assert.match(klass.output, /dead/);
  assert.match(klass.output, /seam/);

  const both = runCheck(["--dir", "src/core", "--dir", "src/mcp", "--class", "self-only"], { loadFiles: () => TREE });
  assert.match(both.output, /all {7}0 {12}0 {10}2 {10}0 {17}0 {9}2/);
});

test("filterEntries by directory matches nested directories and no sibling with the same prefix", () => {
  const files = {
    "src/runtime/a.ts": "export const top = 1;\n",
    "src/runtime/driver/b.ts": "export const nested = 1;\n",
    "src/runtime2/c.ts": "export const sibling = 1;\n",
  };
  const entries = analyze(files).entries;
  assert.deepEqual(
    filterEntries(entries, ["src/runtime"], []).map((entry) => entry.name),
    ["top", "nested"],
  );
});

test("runCheck --json prints the entries, the counts and the unclassified number", () => {
  const { code, output } = runCheck(["--json", "--class", "self-only"], { loadFiles: () => TREE });
  assert.equal(code, 0);
  const parsed = JSON.parse(output);
  assert.deepEqual(
    parsed.entries.map((entry) => [entry.name, entry.class, entry.file, entry.line, entry.dir]),
    [
      ["dead", "self-only", "src/core/a.ts", 2, "src/core"],
      ["OnlyTyped", "self-only", "src/mcp/c.ts", 1, "src/mcp"],
    ],
  );
  assert.equal(parsed.totals["self-only"], 2);
  assert.equal(parsed.counts["src/core"]["self-only"], 1);
  assert.equal(parsed.unclassified, 0);
});

test("runCheck reports an empty selection as empty counts", () => {
  const { code, output } = runCheck(["--dir", "src/nothing"], { loadFiles: () => TREE });
  assert.equal(code, 0);
  assert.match(output, /^counts per directory and class\n/);
  assert.match(output, /all {4}0 {12}0 {10}0 {10}0 {17}0 {9}0\n/);
});

test("parseArgs accepts repeated --dir and --class and defaults to the list format", () => {
  assert.deepEqual(parseArgs([]), { format: "list", dirs: [], classes: [] });
  assert.deepEqual(parseArgs(["--json", "--dir", "src/a", "--dir", "src/b/", "--class", "excluded"]), {
    format: "json",
    dirs: ["src/a", "src/b"],
    classes: ["excluded"],
  });
});

test("usage errors exit 2 with the usage line and never read the tree", () => {
  const loadFiles = () => {
    throw new Error("must not be called");
  };
  const cases = [
    [["--unknown"], /unknown argument "--unknown"/],
    [["positional"], /unknown argument "positional"/],
    [["--dir"], /--dir needs a value/],
    [["--dir", "--json"], /--dir needs a value/],
    [["--class"], /--class needs a value/],
    [["--class", "everything"], /--class must be one of used-in-src, test-only, self-only, public-signature, excluded/],
    [["--dir", "test/core"], /--dir must name a directory under src\//],
    [["--dir", "src"], /--dir must name a directory under src\//],
    [["--list", "--json"], /--list and --json are exclusive/],
  ];
  for (const [argv, pattern] of cases) {
    const { code, output } = runCheck(argv, { loadFiles });
    assert.equal(code, 2, argv.join(" "));
    assert.match(output, pattern);
    assert.match(output, /usage: export-usage\.mjs/);
  }
});

test("runCheck exits 1, not 0, when the source tree cannot be read", () => {
  const { code, output } = runCheck([], {
    loadFiles: () => {
      throw new Error("ENOENT: no such directory");
    },
  });
  assert.equal(code, 1);
  assert.match(output, /cannot read the source tree: ENOENT/);
});
