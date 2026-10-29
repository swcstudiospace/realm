import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  analyze,
  collectExports,
  countEntries,
  filterEntries,
  isExcluded,
  parseArgs,
  resolveSpecifier,
  runCheck,
  stripNonCode,
} from "./export-usage.mjs";

function namesOf(source) {
  return collectExports(source, "src/a/x.ts").exports.map((found) => `${found.kind}:${found.name}`);
}

function classOf(entries, name) {
  return entries.find((entry) => entry.name === name)?.class;
}

function classesOf(files) {
  return Object.fromEntries(analyze(files).entries.map((entry) => [entry.name, entry.class]));
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
  assert.equal(stripped.length, source.length);
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

test("stripNonCode reads a slash after a non-null assertion, an identifier, a number or a closer as division", () => {
  const source = "const q = numerator! / values.divisor;";
  assert.equal(stripNonCode(source), source);
  for (const divided of ["a / values.b", "(a + b) / values.b", "list[0] / values.b", "3 / values.b", "call()! / values.b"]) {
    assert.ok(stripNonCode(`const q = ${divided};`).includes("values.b"), divided);
  }
});

test("stripNonCode reads a slash after an operator, an opener or a keyword as a regular expression", () => {
  const regexes = [
    'const a = /"hidden"/;',
    "if (x && /hidden/.test(y)) {}",
    "const b = [/hidden/, 1];",
    "const c = !/hidden/.test(y);",
    "function f() { return /hidden/.test(y); }",
    "const d = typeof /hidden/;",
    "const e = cond ? /hidden/ : /other/;",
  ];
  for (const regex of regexes) {
    const stripped = stripNonCode(`${regex}\nexport const visible = 1;`);
    assert.ok(!stripped.includes("hidden"), regex);
    assert.ok(stripped.includes("export const visible"), regex);
  }
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
  assert.deepEqual(found.forwards, []);
  assert.deepEqual(found.unparsed, []);
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

test("collectExports ignores default exports, commented and quoted exports, and lists forwards separately", () => {
  const source = [
    "// export const commented = 1;",
    'const message = "export const quoted = 1";',
    "export default function main() {}",
    'export { one, type Two as Three } from "./other.js";',
    'export * from "./star.js";',
    "export const kept = 1;",
  ].join("\n");
  const found = collectExports(source, "src/a/x.ts");
  assert.deepEqual(namesOf(source), ["const:kept"]);
  assert.deepEqual(found.forwards, [
    {
      line: 4,
      star: false,
      specifier: "./other.js",
      names: [
        { local: "one", exported: "one" },
        { local: "Two", exported: "Three" },
      ],
    },
    { line: 5, star: true, specifier: "./star.js", names: [] },
  ]);
});

test("collectExports yields every declarator of one export statement", () => {
  const source = [
    "export const live = 1, unused = 2;",
    "export let first: Map<string, number> = new Map(), second = call(1, 2), third: number;",
    "export const spread = [1, 2, 3], typed: readonly string[] = [];",
  ].join("\n");
  assert.deepEqual(
    collectExports(source, "src/a/x.ts").exports.map((entry) => [entry.name, entry.kind, entry.line]),
    [
      ["live", "const", 1],
      ["unused", "const", 1],
      ["first", "let", 2],
      ["second", "let", 2],
      ["third", "let", 2],
      ["spread", "const", 3],
      ["typed", "const", 3],
    ],
  );
});

test("collectExports reads the names of a destructured export, with renames, defaults, rest and nesting", () => {
  const source = [
    "export const { a, b: c, d = 1, e: f = 2, ...rest } = source();",
    "export const [x, , y = 2, ...z] = list();",
    "export const { outer: { inner }, [key]: renamed } = nested();",
    "export const { typed }: Holder = holder();",
  ].join("\n");
  assert.deepEqual(
    collectExports(source, "src/a/x.ts").exports.map((entry) => entry.name),
    ["a", "c", "d", "f", "rest", "x", "y", "z", "inner", "renamed", "typed"],
  );
});

test("collectExports reports an export form it cannot parse instead of skipping it", () => {
  const found = collectExports("export const { broken: 5 } = source();\nexport const ok = 1;\n", "src/a/x.ts");
  assert.deepEqual(found.exports.map((entry) => entry.name), ["ok"]);
  assert.equal(found.unparsed.length, 1);
  assert.equal(found.unparsed[0].line, 1);
  assert.match(found.unparsed[0].note, /destructured export that could not be parsed/);
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

test("analyze keeps a reference that follows a division: numerator! / values.divisor", () => {
  const { entries } = analyze({
    "src/a/one.ts": "export const divisor = 2;\nexport const gone = 3;\n",
    "src/b/two.ts": "export const quotient = (numerator: number | undefined, values: { divisor: number }): number => {\n  const q = numerator! / values.divisor;\n  return q;\n};\n",
  });
  assert.equal(classOf(entries, "divisor"), "used-in-src");
  assert.equal(classOf(entries, "gone"), "self-only");
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

test("analyze names the declarators of one statement: export const live = 1, unused = 2", () => {
  const classes = classesOf({
    "src/a/one.ts": "export const live = 1, unused = 2;\n",
    "src/b/two.ts": "export const other = live;\n",
  });
  assert.equal(classes.live, "used-in-src");
  assert.equal(classes.unused, "self-only");
});

test("analyze classifies destructured exports by their bound names", () => {
  const classes = classesOf({
    "src/a/one.ts": "export const { a, b: renamed } = source();\nexport const [first, second] = list();\n",
    "src/b/two.ts": "export const other = [a, first];\n",
  });
  assert.equal(classes.a, "used-in-src");
  assert.equal(classes.renamed, "self-only");
  assert.equal(classes.b, undefined);
  assert.equal(classes.first, "used-in-src");
  assert.equal(classes.second, "self-only");
});

test("analyze lists a destructured export it cannot parse as unclassified with its reason", () => {
  const { entries } = analyze({ "src/a/one.ts": "export const { broken: 5 } = source();\n" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].class, "unclassified");
  assert.equal(entries[0].file, "src/a/one.ts");
  assert.equal(entries[0].line, 1);
  assert.match(entries[0].note, /destructured/);
});

test("analyze marks a self-only type named in the declaration of another export as public-signature", () => {
  const classes = classesOf({
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
  assert.deepEqual(classes, {
    Options: "public-signature",
    Inner: "public-signature",
    Hook: "self-only",
    Service: "self-only",
    Config: "public-signature",
    Result: "public-signature",
    // A body-only use over-protects: the type stays exported, which only shrinks the removal list.
    Body: "public-signature",
    Hidden: "public-signature",
    Lonely: "self-only",
    Row: "public-signature",
    table: "self-only",
    make: "self-only",
  });
  assert.equal(analyze({ "src/a/one.ts": "export interface Lonely {}\n" }).entries.every((entry) => !("extent" in entry)), true);
});

test("analyze keeps types that hide behind an object type, a generic default or a nested class member", () => {
  const classes = classesOf({
    "src/a/one.ts": [
      "export interface Payload { readonly n: number }",
      "export function wrap(): { payload: Payload } { return { payload: { n: 1 } }; }",
      "export interface Box<T = Fallback> { readonly value: T }",
      "export interface Fallback {}",
      "export class Holder {",
      "  readonly nested = { inner: Deep };",
      "  get(): Array<{ deep: Deep }> { return []; }",
      "}",
      "export interface Deep {}",
      "export interface Lonely {}",
    ].join("\n"),
  });
  assert.equal(classes.Payload, "public-signature");
  assert.equal(classes.Fallback, "public-signature");
  assert.equal(classes.Deep, "public-signature");
  assert.equal(classes.Lonely, "self-only");
});

test("analyze follows a non-exported local type that an exported declaration names", () => {
  const classes = classesOf({
    "src/a/one.ts": [
      "export interface Leaf {}",
      "interface Internal { readonly leaf: Leaf }",
      "export function read(): Internal { throw new Error(); }",
    ].join("\n"),
  });
  assert.equal(classes.Leaf, "public-signature");
});

test("analyze takes the extent of an export list member from its local declaration", () => {
  const classes = classesOf({
    "src/a/one.ts": [
      "interface Payload {}",
      "function wrap(x: Payload): Payload { return x; }",
      "export { Payload, wrap };",
    ].join("\n"),
  });
  assert.equal(classes.Payload, "public-signature");
  assert.equal(classes.wrap, "self-only");

  const typeOnly = classesOf({
    "src/a/one.ts": [
      "interface Payload {}",
      "interface Lonely {}",
      "function wrap(x: Payload): void {}",
      "export type { Payload, Lonely };",
      "export { wrap };",
    ].join("\n"),
  });
  assert.equal(typeOnly.Payload, "public-signature");
  assert.equal(typeOnly.Lonely, "self-only");
});

test("analyze classifies the exports a re-export forwards, however they are reached", () => {
  const { entries } = analyze({
    "src/a/index.ts": 'export * from "./value.js";\n',
    "src/a/value.ts": "export const v = 1;\nexport interface Shape {}\n",
    "src/a/named.ts": 'export { n } from "./other.js";\nexport type { T } from "../b/types.js";\n',
    "src/a/other.ts": "export const n = 1;\nexport const unforwarded = 2;\n",
    "src/b/types.ts": "export type T = string;\n",
    "src/c/deep.ts": 'export * from "../a/index.js";\n',
    "test/a/value.test.ts": "const x = [v, Shape, T];\n",
  });
  assert.equal(classOf(entries, "v"), "forwarded");
  assert.equal(classOf(entries, "Shape"), "forwarded");
  assert.equal(classOf(entries, "n"), "forwarded");
  assert.equal(classOf(entries, "T"), "forwarded");
  assert.equal(classOf(entries, "unforwarded"), "self-only");
  assert.equal(entries.length, 5);
});

test("analyze lists a re-export it cannot resolve as unclassified with its reason", () => {
  const { entries } = analyze({
    "src/a/index.ts": [
      'export * from "./missing.js";',
      'export { x, type Y as Z } from "node:fs";',
      'export { w } from "../outside/gone.js";',
    ].join("\n"),
  });
  assert.deepEqual(
    entries.map((entry) => [entry.name, entry.class, entry.line, entry.kind]),
    [
      ["*", "unclassified", 1, "re-export"],
      ["Z", "unclassified", 2, "re-export"],
      ["x", "unclassified", 2, "re-export"],
      ["w", "unclassified", 3, "re-export"],
    ],
  );
  assert.match(entries[0].note, /"\.\/missing\.js", which is not an analyzed src file/);
  assert.match(entries[1].note, /external module "node:fs"/);
});

test("resolveSpecifier maps a relative specifier onto an analyzed src file", () => {
  const paths = new Set(["src/a/value.ts", "src/b/types.ts", "src/a/pkg/index.ts"]);
  assert.equal(resolveSpecifier("src/a/index.ts", "./value.js", paths), "src/a/value.ts");
  assert.equal(resolveSpecifier("src/a/index.ts", "../b/types.js", paths), "src/b/types.ts");
  assert.equal(resolveSpecifier("src/a/index.ts", "./pkg", paths), "src/a/pkg/index.ts");
  assert.equal(resolveSpecifier("src/a/index.ts", "./absent.js", paths), null);
  assert.equal(resolveSpecifier("src/a/index.ts", "node:fs", paths), null);
  assert.equal(resolveSpecifier("src/a/index.ts", null, paths), null);
});

test("countEntries counts per directory and class, and splits test-only by space", () => {
  const { entries } = analyze({
    "src/a/one.ts": "export const used = 1;\nexport interface Shape {}\nexport const seam = 1;\nexport const dead = 1;\n",
    "src/b/two.ts": "export const user = used;\n",
    "test/one.test.ts": "const x = [Shape, seam];\n",
  });
  const counts = countEntries(entries);
  const blank = { "used-in-src": 0, "test-only": 0, "self-only": 0, "public-signature": 0, forwarded: 0, unclassified: 0, excluded: 0 };
  assert.deepEqual(counts.byDirectory["src/a"], { ...blank, "used-in-src": 1, "test-only": 2, "self-only": 1, total: 4 });
  assert.deepEqual(counts.byDirectory["src/b"], { ...blank, "self-only": 1, total: 1 });
  assert.equal(counts.totals.total, 5);
  assert.equal(counts.totals.testOnlyValues, 1);
  assert.equal(counts.totals.testOnlyTypes, 1);
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
      "  dir       used-in-src  test-only  self-only  public-signature  forwarded  unclassified  excluded  total",
      "  src/core  1            0          1          0                 0          0             0         2",
      "  src/mcp   0            1          1          0                 0          0             0         2",
      "  all       1            1          2          0                 0          0             0         4",
      "test-only: 1 values, 0 types",
      "",
    ].join("\n"),
  );
});

test("runCheck lists unclassified entries with their reason", () => {
  const { output } = runCheck(["--class", "unclassified"], {
    loadFiles: () => ({ "src/a/index.ts": 'export * from "./missing.js";\n' }),
  });
  assert.match(output, /unclassified {6}re-export {2}\* {2}src\/a\/index\.ts:1 {2}\(re-export of "\.\/missing\.js", which is not an analyzed src file\)/);
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
  assert.doesNotMatch(klass.output, /used-in-src {7}const/);
  assert.match(klass.output, /dead/);
  assert.match(klass.output, /seam/);

  const both = JSON.parse(
    runCheck(["--json", "--dir", "src/core", "--dir", "src/mcp", "--class", "self-only"], { loadFiles: () => TREE }).output,
  );
  assert.equal(both.totals["self-only"], 2);
  assert.equal(both.totals.total, 2);
  assert.deepEqual(Object.keys(both.counts), ["src/core", "src/mcp"]);
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

test("runCheck --json prints the entries and the counts", () => {
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
});

test("runCheck reports an empty selection as empty counts", () => {
  const { code, output } = runCheck(["--dir", "src/nothing"], { loadFiles: () => TREE });
  assert.equal(code, 0);
  assert.match(output, /^counts per directory and class\n/);
  const json = JSON.parse(runCheck(["--json", "--dir", "src/nothing"], { loadFiles: () => TREE }).output);
  assert.deepEqual(json.entries, []);
  assert.deepEqual(json.counts, {});
  assert.equal(json.totals.total, 0);
});

test("parseArgs accepts repeated --dir and --class and defaults to the list format", () => {
  assert.deepEqual(parseArgs([]), { format: "list", dirs: [], classes: [] });
  assert.deepEqual(parseArgs(["--json", "--dir", "src/a", "--dir", "src/b/", "--class", "excluded", "--class", "forwarded"]), {
    format: "json",
    dirs: ["src/a", "src/b"],
    classes: ["excluded", "forwarded"],
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
    [
      ["--class", "everything"],
      /--class must be one of used-in-src, test-only, self-only, public-signature, forwarded, unclassified, excluded/,
    ],
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

test("an indented export and an export after a block comment are found", () => {
  const found = collectExports("  export const indented = 1;\n/* note */ export const afterComment = 2;\nexport const plain = 3;\n", "src/a/x.ts");
  assert.deepEqual(found.exports.map((entry) => [entry.name, entry.line]), [
    ["indented", 1],
    ["afterComment", 2],
    ["plain", 3],
  ]);
  assert.deepEqual(found.unparsed, []);
});

test("a column-zero object member does not cut off an exported interface", () => {
  const classes = classesOf({
    "src/a/one.ts": [
      "export interface Holder {",
      "  readonly value: {",
      "type: Payload;",
      "  };",
      "}",
      "export interface Payload {}",
    ].join("\n"),
  });
  assert.equal(classes.Payload, "public-signature");
  assert.equal(classes.Holder, "self-only");
});

test("generic arguments in an initializer do not invent bindings: factory<First, Middle, Last>()", () => {
  const found = collectExports("export const value = factory<First, Middle, Last>();\nexport const next = 1;\n", "src/a/x.ts");
  assert.deepEqual(found.exports.map((entry) => entry.name), ["value", "next"]);
  assert.deepEqual(found.unparsed, []);
  const classes = classesOf({ "src/a/one.ts": "export const value = factory<First, Middle, Last>();\n" });
  assert.deepEqual(classes, { value: "self-only" });
});

test("a keyword used as a property name does not open a regular expression: counts.of / values.divisor", () => {
  const stripped = stripNonCode("const q = counts.of / values.divisor;\nconst r = counts?.in / values.other;");
  assert.ok(stripped.includes("values.divisor"));
  assert.ok(stripped.includes("values.other"));
  const { entries } = analyze({
    "src/a/one.ts": "export const divisor = 1;\n",
    "src/b/two.ts": "export const q = (counts: { of: number }, values: { divisor: number }) => counts.of / values.divisor;\n",
  });
  assert.equal(classOf(entries, "divisor"), "used-in-src");
});

test("a ! after return negates and the regular expression after it is blanked: return !/[\"]/.test(text) && values.allowed", () => {
  const source = 'function check(text: string) { return !/["]/.test(text) && values.allowed; }';
  const stripped = stripNonCode(source);
  assert.ok(stripped.includes("values.allowed"));
  assert.ok(!stripped.includes('["]'));
  assert.equal(stripped.length, source.length);
});

test("a ! after an expression stays a non-null assertion, before = it is the comparison operator", () => {
  assert.ok(stripNonCode("const a = x! / values.one;").includes("values.one"));
  assert.ok(stripNonCode("const a = x!! / values.one;").includes("values.one"));
  assert.ok(stripNonCode("const a = f()! / values.one;").includes("values.one"));
  assert.ok(stripNonCode("const a = x != /hidden/ ? 1 : 2;").includes("?"));
  assert.ok(!stripNonCode("const a = x != /hidden/.source;").includes("hidden"));
});

// A table of tricky snippets. Each is analysed as src/a/one.ts next to a src/b/two.ts that names `usedByTwo`, and its
// classes must be exactly the expected ones. A regression in the scanner changes a class or an export name.
const TRICKY = [
  ["division after a non-null assertion", "export const usedByTwo = 1;\nexport const f = (n?: number) => n! / values.divisor;\n", { usedByTwo: "used-in-src", f: "self-only" }],
  ["a link-like path inside strings", 'export const usedByTwo = 1;\nexport const url = "see link/.. and //not-a-comment";\nexport const other = \'a/b\';\n', { usedByTwo: "used-in-src", url: "self-only", other: "self-only" }],
  ["a regular expression with a quote", "export const usedByTwo = 1;\nexport const re = /[\"']/g;\nexport const after = 2;\n", { usedByTwo: "used-in-src", re: "self-only", after: "self-only" }],
  ["a slash inside a regular expression class", "export const re = /[/]x/;\nexport const after = 2;\n", { re: "self-only", after: "self-only" }],
  ["a nested template", "export const t = `a ${ b(`c ${d}`) } e`;\nexport const after = 2;\n", { t: "self-only", after: "self-only" }],
  ["a generic arrow function", "export const id = <T, U>(value: T, other: U): T => value;\nexport const after = 2;\n", { id: "self-only", after: "self-only" }],
  ["an alias in an export list", "const hidden = 1;\nexport { hidden as shown };\n", { shown: "self-only" }],
  ["a type-only export list", "interface Shape {}\nexport type { Shape };\n", { Shape: "self-only" }],
  ["a function overload", "export function over(a: string): string;\nexport function over(a: number): number;\nexport function over(a: unknown): unknown { return a; }\n", { over: "self-only" }],
  ["an export after a one-line block", "if (x) { y(); }\nexport const afterBlock = 1;\n", { afterBlock: "self-only" }],
  ["an export with no semicolons", "export const first = 1\nexport const second = 2\nexport interface Third {}\n", { first: "self-only", second: "self-only", Third: "self-only" }],
  ["a class with a method signature naming a type", "export interface Arg {}\nexport class Service {\n  run(arg: Arg): void {}\n}\n", { Arg: "public-signature", Service: "self-only" }],
  ["a spaced comparison in an initializer", "export const flag = a < b, other = c > d;\n", { flag: "self-only", other: "self-only" }],
  ["an unspaced comparison is two declarators", "export const flag = a<b, other = c>d;\n", { flag: "self-only", other: "self-only" }],
  ["an ambiguous generic is reported, not guessed", "export const amb = a<b, other = c>(d);\nexport const after = 1;\n", { amb: "unclassified", after: "self-only" }],
];

for (const [title, source, expected] of TRICKY) {
  test(`scanner table: ${title}`, () => {
    const files = { "src/a/one.ts": source, "src/b/two.ts": "export const x = usedByTwo;\n" };
    const classes = classesOf(files);
    delete classes.x;
    for (const [name, klass] of Object.entries(expected)) {
      assert.equal(classes[name], klass, `${name} in "${title}"`);
    }
    for (const name of Object.keys(classes)) {
      assert.ok(name in expected, `${title}: unexpected export ${name}`);
    }
  });
}

test("an exported type ending in an indexed access after a brace keeps the key type: { value: number }[Key]", () => {
  const classes = classesOf({
    "src/a/one.ts": "export type Picked = { value: number }[Key];\nexport type Key = 'value';\nexport type Other = { value: number }['value']\nexport interface Lonely {}\n",
  });
  assert.equal(classes.Key, "public-signature");
  assert.equal(classes.Picked, "self-only");
  assert.equal(classes.Lonely, "self-only");
});

test("a template literal expression never ends a statement: export const a = `${x}`, b = 1", () => {
  const found = collectExports("export const a = `${x}`, b = 1;\nexport const c = `${ {d: 1}.d } and ${e}`;\n", "src/a/x.ts");
  assert.deepEqual(found.exports.map((entry) => entry.name), ["a", "b", "c"]);
  const classes = classesOf({
    "src/a/one.ts": "export const t = `${x}`;\nexport type Later = `a${string}`, Used = Later;\nexport interface Ref {}\nexport type Holder = { r: `${Ref}` };\n",
  });
  assert.equal(classes.Ref, "public-signature");
});

// --- Differential test against the TypeScript compiler -------------------------------------------------------------------
//
// The scanner in export-usage.mjs is hand-written, so its statement boundaries and export inventory are compared with the
// TypeScript parser (used as an oracle only: createSourceFile, no type checking) over every .ts file of the repository and
// over a table of tricky snippets with deterministic variants. A mismatch names the file, the offsets and both snippets.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function bindingNames(name, into) {
  if (ts.isIdentifier(name)) {
    into.push(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      bindingNames(element.name, into);
    }
  }
}

function hasModifier(node, kind) {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

// What the TypeScript parser says about a source: the start offsets of its top-level statements (empty statements left
// out, as the scanner does not report a lone `;`), the exported names, and the forwarded exports.
function oracleOf(source, fileName) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const names = [];
  const forwards = [];
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier === undefined ? null : statement.moduleSpecifier.text;
      const clause = statement.exportClause;
      if (clause === undefined) {
        forwards.push(`${specifier}|*`);
      } else if (ts.isNamespaceExport(clause)) {
        names.push(clause.name.text);
      } else if (specifier === null) {
        names.push(...clause.elements.map((element) => element.name.text));
      } else {
        forwards.push(...clause.elements.map((element) => `${specifier}|${(element.propertyName ?? element.name).text}>${element.name.text}`));
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      continue;
    }
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword) || hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        bindingNames(declaration.name, names);
      }
    } else if (ts.isImportEqualsDeclaration(statement)) {
      names.push(statement.name.text);
    } else if (statement.name !== undefined && ts.isIdentifier(statement.name)) {
      names.push(statement.name.text);
    }
  }
  return {
    sourceFile,
    parseErrors: sourceFile.parseDiagnostics.length,
    starts: sourceFile.statements.filter((statement) => statement.kind !== ts.SyntaxKind.EmptyStatement).map((statement) => statement.getStart(sourceFile)),
    names: names.sort(),
    forwards: forwards.sort(),
  };
}

// What the scanner says about the same source, in the same shape.
function scannerOf(source, fileName) {
  const found = collectExports(source, fileName);
  return {
    starts: found.statements
      .filter((statement) => source.slice(statement.start, statement.end) !== ";")
      .map((statement) => statement.start),
    names: found.exports.map((entry) => entry.name).sort(),
    forwards: found.forwards
      .flatMap((forward) =>
        forward.star
          ? [`${forward.specifier}|*`]
          : forward.names.map((member) => `${forward.specifier}|${member.local}>${member.exported}`),
      )
      .sort(),
    unparsed: found.unparsed,
  };
}

function around(source, offset) {
  return JSON.stringify(source.slice(Math.max(0, offset - 20), offset + 60));
}

// Lists the differences between the scanner and the oracle for one source; an empty list means they agree. Where the
// scanner reports an unparsed export (its `unclassified` case) the export inventory is only required to be a subset.
function differences(source, fileName, { allowUnclassified = false } = {}) {
  const expected = oracleOf(source, fileName);
  const actual = scannerOf(source, fileName);
  const problems = [];
  if (expected.parseErrors > 0) {
    problems.push(`${fileName}: the oracle reports ${expected.parseErrors} parse error(s); the snippet is not valid TypeScript`);
  }
  const limit = Math.max(expected.starts.length, actual.starts.length);
  for (let index = 0; index < limit; index += 1) {
    if (expected.starts[index] !== actual.starts[index]) {
      problems.push(
        `${fileName}: statement ${index} starts at ${actual.starts[index]} in the scanner (${around(source, actual.starts[index] ?? 0)}) ` +
          `but at ${expected.starts[index]} in TypeScript (${around(source, expected.starts[index] ?? 0)}); ${actual.starts.length} against ${expected.starts.length} statements`,
      );
      break;
    }
  }
  if (actual.unparsed.length > 0) {
    if (!allowUnclassified) {
      problems.push(`${fileName}: the scanner reports an unparsed export (${actual.unparsed.map((item) => `${item.name}: ${item.note}`).join("; ")})`);
    } else {
      const missing = actual.names.filter((name) => !expected.names.includes(name));
      if (missing.length > 0) {
        problems.push(`${fileName}: the scanner invents ${missing.join(", ")}`);
      }
    }
  } else if (JSON.stringify(actual.names) !== JSON.stringify(expected.names)) {
    problems.push(`${fileName}: exported names differ: scanner ${JSON.stringify(actual.names)}, TypeScript ${JSON.stringify(expected.names)}`);
  }
  if (JSON.stringify(actual.forwards) !== JSON.stringify(expected.forwards)) {
    problems.push(`${fileName}: forwarded exports differ: scanner ${JSON.stringify(actual.forwards)}, TypeScript ${JSON.stringify(expected.forwards)}`);
  }
  return problems;
}

function repositoryFiles() {
  const files = [];
  for (const top of ["src", "test"]) {
    for (const relative of readdirSync(join(REPO_ROOT, top), { recursive: true }).map(String).sort()) {
      if (relative.endsWith(".ts")) {
        files.push(`${top}/${relative.split(sep).join("/")}`);
      }
    }
  }
  return files;
}

test("differential: the scanner agrees with the TypeScript parser on every src and test file", () => {
  const files = repositoryFiles();
  assert.ok(files.length > 100, `expected the whole tree, found ${files.length} files`);
  const problems = [];
  for (const file of files) {
    problems.push(...differences(readFileSync(join(REPO_ROOT, file), "utf8"), file));
  }
  assert.deepEqual(problems.slice(0, 10), [], `${problems.length} mismatch(es) over ${files.length} files`);
});

// Deterministic pseudo-random numbers (mulberry32), so every run builds the same variants.
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// The start offsets of every token (leaf node) of a parsed file, with whether a line break precedes the token.
function tokenSites(sourceFile, source) {
  const starts = new Set();
  const visit = (node) => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) {
      return;
    }
    const children = node.getChildren(sourceFile);
    if (children.length === 0) {
      if (node.kind !== ts.SyntaxKind.EndOfFileToken) {
        starts.add(node.getStart(sourceFile));
      }
      return;
    }
    children.forEach(visit);
  };
  visit(sourceFile);
  return [...starts]
    .sort((left, right) => left - right)
    .map((start) => ({ start, afterBreak: /\n[ \t]*$/.test(source.slice(0, start)) }));
}

const SPACES = [" ", "  ", "\t", "        "];
const BLOCKS = ["/* c */", "/* export const fake = 1; */", '/* "quote \' */', "/* `tick ${x} */", "/*c*/"];
const LINE_COMMENTS = ["// c", "// export const fake = 1;", "// 'quote \"", "// ${x} ` /*"];
const BREAKING = ["/**\n * export const doc = 1;\n */", "/* two\nlines */"];

// Builds a variant of a snippet by inserting trivia at token boundaries. Spaces and block comments without a line break go
// anywhere; line comments, blank lines and block comments that contain a line break go only before a token that already
// follows a line break, so no restricted production (return, throw, postfix ++, ...) changes meaning.
function variantOf(source, random) {
  const sourceFile = ts.createSourceFile("variant.ts", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const sites = tokenSites(sourceFile, source);
  if (sites.length === 0) {
    return source;
  }
  const picks = new Map();
  const count = 1 + Math.floor(sites.length / 5);
  for (let round = 0; round < count; round += 1) {
    const site = sites[Math.floor(random() * sites.length)];
    const pool = site.afterBreak
      ? [...SPACES, ...BLOCKS, ...BREAKING, "\n", ...LINE_COMMENTS.map((comment) => `${comment}\n`)]
      : [...SPACES, ...BLOCKS];
    const insertion = pool[Math.floor(random() * pool.length)];
    picks.set(site.start, `${picks.get(site.start) ?? ""}${insertion}${/\s$/.test(insertion) ? "" : " "}`);
  }
  let result = source;
  for (const start of [...picks.keys()].sort((left, right) => right - left)) {
    result = result.slice(0, start) + picks.get(start) + result.slice(start);
  }
  return result;
}

// [title, source, options]. Every snippet must be valid TypeScript (the test checks that with the oracle).
const SNIPPETS = [
  // The ambiguous generic has its own entry below, with the unclassified allowance.
  ...TRICKY.filter(([title]) => !title.includes("ambiguous")).map(([title, source]) => [`table: ${title}`, source]),
  ["template with an expression, then a comma-separated export", "export const a = `${x}`, b = 1;\nexport const c = 2;\n"],
  ["nested templates and braces in expressions", "export const t = `a ${ b(`c ${ {d: `e ${f}`}.d } g`) } h`, u = 2;\nexport const after = 3;\n"],
  ["template literal types", "export type Tpl = `a${string}`;\nexport type Id<T> = `${T & string}-id`;\nexport interface Z {}\n"],
  ["indexed access types after a brace", "export type A = { value: number }[Key];\nexport type B = { k: number }[\"k\"];\nexport type Key = 'value'\nexport interface Z {}\n"],
  ["arrow functions returning object literals", "export const mk = (): { a: number } => ({ a: 1 });\nexport const b = () => ({ x: 1 })\nexport const c = 2\nexport const d = async () => { return { y: 1 }; };\n"],
  [
    "classes with methods and decorators",
    [
      "function dec(...args: unknown[]): any { return args; }",
      "@dec",
      "export class Decorated {",
      "  @dec method(): void {}",
      "  get v(): number { return 1; }",
      "  static { init(); }",
      "}",
      "@dec() export class Two {}",
      "export @dec class Three {}",
      "@a.b(1, { c: 2 })",
      "@dec",
      "export class Four {}",
      "export const after = 1;",
      "",
    ].join("\n"),
  ],
  [
    "declare and namespace blocks",
    [
      "declare const ambient: number;",
      "export declare function declared(a: string): void;",
      "export declare namespace Outer { const inner: number; namespace Deep { } }",
      "export namespace Impl { export const x = 1; }",
      'declare module "pkg" { export const hidden: number; }',
      "declare global { interface Window { w: number } }",
      "export abstract class Abs {}",
      "export const enum CE { A }",
      "export declare const enum DE { A }",
      "export declare const sym: unique symbol;",
      "namespace Local.Nested { export const y = 1; }",
      "export import Alias = Impl.x;",
      "",
    ].join("\n"),
  ],
  ["overloads", "export function over(a: string): string;\nexport function over(a: number): number;\nexport function over(a: unknown): unknown { return a; }\nexport class C {\n  m(a: string): void;\n  m(a: number): void;\n  m(a: unknown): void {}\n}\n"],
  ["default exports", "export default function def() {}\nexport const afterDefault = 1;\n"],
  ["default class", "export default class {}\nexport const afterDefault = 1;\n"],
  ["default expression", "export default { a: 1 };\nexport const afterDefault = 1;\n"],
  ["default arrow", "export default (a: number) => a;\nexport const afterDefault = 1;\n"],
  ["default interface", "export default interface Iface {}\nexport const afterDefault = 1;\n"],
  ["default abstract class", "export default abstract class A {}\nexport const afterDefault = 1;\n"],
  ["export list with default", "const x = 1;\nexport { x as default };\nexport { x as y };\n"],
  [
    "regular expressions with quotes, brackets and slashes",
    "export const r1 = /[\"'`]/g, r2 = /[/\\]]/, r3 = /\\//;\nexport const r4 = x.replace(/[\\\\/]+/g, '/');\nexport const after = 1;\n",
  ],
  ["division after a closing paren and bracket", "export const d1 = (a + b) / values.c, d2 = list[0] / values.d, d3 = f(1) / g(2);\nexport const after = 1;\n"],
  ["labelled blocks", "outer: {\n  if (flag) break outer;\n  run();\n}\nexport const afterLabel = 1;\nloop: for (const i of list) {\n  continue loop;\n}\nexport const afterLoop = 2;\n"],
  [
    "no semicolons",
    "export const one = 1\nexport const two = 2\nexport function three() {}\nexport interface Four {}\nexport type Five = string\nexport class Six {}\nexport enum Seven { A }\nconst local = 3\nexport { local }\n",
  ],
  [
    "imports and re-exports",
    [
      'import { a } from "./a.js";',
      "import type { B } from './b.js'",
      'import c, * as d from "./c.js"',
      "export const x = 1",
      "export { a, type B }",
      "export * from './z.js'",
      "export * as ns from './ns.js'",
      "export type * from './t.js'",
      "export { q as r, type S } from './q.js';",
      "export { default as dflt } from './d.js';",
      "",
    ].join("\n"),
  ],
  ["destructured exports", "export const { a, b: c, d = 1, ...rest } = obj;\nexport const [x, , y = 2, ...z] = arr;\nexport const { n: { deep }, [k]: computed } = nested, plain = 1;\n"],
  ["generic calls and arrows", "export const g = factory<First, Middle, Last>();\nexport const arrow = <T,>(v: T): T => v, other = 2;\nexport const bound = <T extends object>(v: T) => v;\n"],
  ["property names that are keywords", "export const q = counts.of / values.divisor, r = counts?.in / values.other;\nexport const after = 1;\n"],
  ["negations and non-null assertions", 'export const neg = (text: string) => { return !/["]/.test(text) && values.allowed; };\nexport const nn = x! / values.one, nn2 = y!! / values.two;\n'],
  ["object type members at column zero", "export interface Holder {\n  readonly value: {\ntype: Payload;\n  };\n}\nexport interface Payload {}\n"],
  ["wrapper returning an object type", "export function wrap(): { payload: Payload } { return { payload: p }; }\nexport interface Payload {}\n"],
  ["class heritage and expressions", "export class A {}\nexport class B extends A {}\nexport const c = class {}\nexport const d = function () {}\nexport const e = async () => {}\nexport const f = class extends A {};\n"],
  ["strings that look like comments", "export const s1 = \"/* not a comment\", s2 = '// nor this', s3 = `/* ${1} */`;\nexport const after = 1;\n"],
  ["object literal with methods and computed keys", "export const obj = {\n  a() { return 1 },\n  get b() { return 2 },\n  [`k${1}`]: 3,\n};\nexport const after = 1;\n"],
  ["conditional, mapped and function types", "export type Cond<T> = T extends string ? 'a' : 'b';\nexport type Mapped = { [K in keyof Obj]?: Obj[K] };\nexport type Fn = (a: number) => void;\nexport type Union =\n  | { kind: 'a' }\n  | { kind: 'b' };\nexport const after = 1;\n"],
  ["satisfies and as", "export const cfg = { a: 1 } satisfies Cfg;\nexport const asd = { b: 2 } as const;\nexport const arr = [1, 2] as const;\nexport const nested = {\n  c: { d: 1 },\n} as Shape;\n"],
  ["control flow at top level", "if (flag) {\n  run();\n} else {\n  stop();\n}\nexport const afterIf = 1;\ntry {\n  a();\n} catch (error) {\n  b();\n} finally {\n  c();\n}\nfor (const i of list) {\n  d(i);\n}\nexport const afterFor = 1;\nwhile (x) {\n  y();\n}\nexport const afterWhile = 2;\n"],
  ["immediately invoked functions", "(function () {\n  run();\n})();\nexport const afterIife = 1;\n(() => {\n  run();\n})();\nexport const afterArrow = 2;\n"],
  ["comments with exports inside", "/**\n * export const doc = 1;\n */\nexport const real = 1;\n// export const line = 2;\n/* export const block = 3; */\nexport const real2 = 2;\n"],
  ["tagged templates and numbers", "export const tagged = tag`a${1}b${2}`, plain = 2;\nexport const oc = a?.b?.[0] ?? 1.5e3 / 2;\nexport const inc = i++ / values.n, dec = j-- / values.m;\n"],
  ["generators and async generators", "export function* gen() { yield 1; }\nexport async function* ag() { yield 2; }\nexport async function fn() { await x; }\n"],
  ["enum initializers", "export enum E { A = 1 << 2, B = 'b'.length, C }\nexport const enum F { A = 'a' }\n"],
  ["class members of every kind", "export class Members<T = Default> extends Base<T> implements Iface {\n  static readonly s = 1;\n  #private = 2;\n  accessor acc = 3;\n  [key: string]: unknown;\n  constructor(public readonly a: number, private b?: string) { super(); }\n  get g(): number { return 1; }\n  set g(v: number) {}\n  async *gen(): AsyncGenerator<number> { yield 1; }\n}\nexport interface Default {}\n"],
  ["statements after expressions without semicolons", "const a = 1\nconst b = 2\nexport const c = a + b\nfunction local() {}\nexport const d = local()\n"],
  ["comparison on a property: p.value<5", "export interface Payload { readonly value: number }\nexport const check = (p: Payload) => p.value<5;\nexport const after = 1;\n"],
  ["comparison with a digit: x<5", "export const lt = x<5, after = 1;\nexport const more = 2;\n"],
  ["comparison of two members: a.b<c.d", "export const cmp = a.b<c.d, after = 1;\nexport const more = 2;\n"],
  ["comparison with a length: i<arr.length", "export const inRange = i<arr.length, after = 1;\nexport const more = 2;\n"],
  ["chained comparison: a<b>c", "export const chained = a<b>c, after = 1;\nexport const more = 2;\n"],
  ["generic call: f<T>(x)", "export const called = f<T>(x), after = 1;\nexport const more = 2;\n"],
  ["generic constructor: new Map<string, number>()", "export const map = new Map<string, number>(), after = 1;\nexport const more = 2;\n"],
  ["ambiguous generic stays conservative", "export const amb = a<b, other = c>(d);\nexport const after = 1;\n", { allowUnclassified: true }],
];

// Variants per snippet; the default keeps the run short, EXPORT_USAGE_FUZZ_VARIANTS raises it for a longer local hunt.
const VARIANTS = Number.parseInt(process.env["EXPORT_USAGE_FUZZ_VARIANTS"] ?? "", 10) || 12;

for (const [title, source, options] of SNIPPETS) {
  test(`differential: ${title}`, () => {
    const random = seeded(title.length * 2654435761);
    const problems = differences(source, "snippet.ts", options);
    assert.deepEqual(problems, [], "the snippet itself");
    for (let variant = 0; variant < VARIANTS; variant += 1) {
      const text = variantOf(source, random);
      const found = differences(text, `snippet-variant-${variant}.ts`, options);
      assert.deepEqual(found, [], `variant ${variant}:\n${text}`);
    }
  });
}

test("a comparison after a property is not even unclassified: (p: Payload) => p.value<5", () => {
  const source = "export interface Payload { readonly value: number }\nexport const check = (p: Payload) => p.value<5;\n";
  assert.deepEqual(collectExports(source, "src/a/x.ts").unparsed, []);
  assert.deepEqual(classesOf({ "src/a/one.ts": source }), { Payload: "public-signature", check: "self-only" });
});

test("an unclassified export still protects the types in its extent", () => {
  const classes = classesOf({
    "src/a/one.ts": [
      "export interface Payload { readonly value: number }",
      "export interface Inner {}",
      "interface Hidden { readonly inner: Inner }",
      "export interface Lonely {}",
      "export const amb = (p: Payload, h: Hidden) => a<b, other = c>(d);",
      "",
    ].join("\n"),
  });
  // The ambiguous generic keeps `amb` unclassified, and uncertainty may only keep: every type its extent names stays
  // exported, including a type reached through a non-exported local type.
  assert.equal(classes.amb, "unclassified");
  assert.equal(classes.Payload, "public-signature");
  assert.equal(classes.Inner, "public-signature");
  assert.equal(classes.Lonely, "self-only");
});

test("a `<` after an identifier is a comparison before a digit, a minus, a string or an =", () => {
  for (const comparison of ["a<5", "a< 5", "a<-1", 'a<"s"', "a<'s'", "a<`t`", "a<=b", "a<=b>(c)"]) {
    const found = collectExports(`export const x = ${comparison}, y = 1;\n`, "src/a/x.ts");
    assert.deepEqual(found.exports.map((entry) => entry.name), ["x", "y"], comparison);
    assert.deepEqual(found.unparsed, [], comparison);
  }
});
