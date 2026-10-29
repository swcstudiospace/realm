import { test } from "node:test";
import assert from "node:assert/strict";
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
  const found = collectExports("export const { broken: [ } = source();\nexport const ok = 1;\n", "src/a/x.ts");
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
  const { entries } = analyze({ "src/a/one.ts": "export const { broken: [ } = source();\n" });
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
