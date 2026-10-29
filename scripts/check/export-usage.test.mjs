import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyze,
  collectExports,
  countEntries,
  filterEntries,
  isExcluded,
  parseArgs,
  resolveSpecifier,
  runCheck,
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
    "export namespace M { export const inner = 1; }",
    "export declare function N(): void;",
    "export import O = M.inner;",
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
      ["M", "namespace", "value", 13],
      ["N", "function", "value", 14],
      ["O", "import", "value", 15],
    ],
  );
  assert.deepEqual(found.forwards, []);
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

test("collectExports reads default exports as kind default and lists forwards separately", () => {
  const source = [
    "// export const commented = 1;",
    'const message = "export const quoted = 1";',
    "export default function main() {}",
    'export { one, type Two as Three } from "./other.js";',
    'export * from "./star.js";',
    "export const kept = 1;",
  ].join("\n");
  const found = collectExports(source, "src/a/x.ts");
  assert.deepEqual(namesOf(source), ["default:default", "const:kept"]);
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

test("an indented export and an export after a block comment are found", () => {
  const found = collectExports("  export const indented = 1;\n/* note */ export const afterComment = 2;\nexport const plain = 3;\n", "src/a/x.ts");
  assert.deepEqual(found.exports.map((entry) => [entry.name, entry.line]), [
    ["indented", 1],
    ["afterComment", 2],
    ["plain", 3],
  ]);
});

test("decorated exports are found, before or after the export keyword", () => {
  const source = [
    "function dec(...args: unknown[]): any { return args; }",
    "@dec",
    "export class Decorated {}",
    "@dec() export class Two {}",
    "export @dec class Three {}",
    "",
  ].join("\n");
  assert.deepEqual(
    collectExports(source, "src/a/x.ts").exports.map((entry) => [entry.name, entry.line]),
    [
      ["Decorated", 2],
      ["Two", 4],
      ["Three", 5],
    ],
  );
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

test("analyze does not count the declaring name of an export in its own file as a use", () => {
  const classes = classesOf({
    "src/a/one.ts": "export const shared = 1;\n",
    "src/b/two.ts": "export const shared = 2;\n",
  });
  assert.equal(classes.shared, "self-only");
  const { entries } = analyze({
    "src/a/one.ts": "export const shared = 1;\n",
    "src/b/two.ts": "export const shared = 2;\n",
  });
  assert.deepEqual(entries.map((entry) => entry.class), ["self-only", "self-only"]);
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

test("analyze keeps a reference that follows a number with a dot: 3. / values.divisor", () => {
  const { entries } = analyze({
    "src/a/one.ts": "export const divisor = 2;\nexport const gone = 3;\n",
    "src/b/two.ts": "export const third = (values: { divisor: number }): number => 3. / values.divisor;\nexport const half = (values: { divisor: number }): number => 0.5 / values.divisor;\n",
  });
  assert.equal(classOf(entries, "divisor"), "used-in-src");
  assert.equal(classOf(entries, "gone"), "self-only");
});

test('analyze reads a regular expression after a negation: return !/["]/.test(text) && values.allowed', () => {
  const { entries } = analyze({
    "src/a/one.ts": "export const allowed = true;\nexport const quote = 'q';\n",
    "src/b/two.ts": 'export function check(text: string, values: { allowed: boolean }): boolean { return !/["]/.test(text) && values.allowed; }\n',
  });
  assert.equal(classOf(entries, "allowed"), "used-in-src");
  assert.equal(classOf(entries, "quote"), "self-only");
});

test("a keyword used as a property name does not hide a reference: counts.of / values.divisor", () => {
  const { entries } = analyze({
    "src/a/one.ts": "export const divisor = 1;\nexport const other = 2;\n",
    "src/b/two.ts": [
      "export const q = (counts: { of: number; in: number }, values: { divisor: number; other: number }) =>",
      "  counts.of / values.divisor + counts?.in / values.other;",
    ].join("\n"),
  });
  assert.equal(classOf(entries, "divisor"), "used-in-src");
  assert.equal(classOf(entries, "other"), "used-in-src");
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

test("analyze marks a self-only type named in the syntax of another export as public-signature", () => {
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
    // A class is a type too: `make` returns it, so it stays exported.
    Service: "public-signature",
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
  assert.equal(
    analyze({ "src/a/one.ts": "export interface Lonely {}\n" }).entries.every((entry) => !("statements" in entry) && !("nameNode" in entry)),
    true,
  );
});

test("analyze protects a class or an enum that another export of its file names", () => {
  const classes = classesOf({
    "src/a/one.ts": [
      "export class Box {}",
      "export enum Level { Low }",
      "export function open(level: Level): Box { return new Box(); }",
      "export class Lonely {}",
      "export enum Quiet { A }",
    ].join("\n"),
  });
  assert.equal(classes.Box, "public-signature");
  assert.equal(classes.Level, "public-signature");
  assert.equal(classes.Lonely, "self-only");
  assert.equal(classes.Quiet, "self-only");
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

test("analyze treats export * as ns and export type * as forwarding", () => {
  const { entries } = analyze({
    "src/a/index.ts": 'export * as ns from "./value.js";\nexport type * from "./types.js";\n',
    "src/a/value.ts": "export const v = 1;\n",
    "src/a/types.ts": "export interface Shape {}\n",
  });
  assert.equal(classOf(entries, "ns"), "self-only");
  assert.equal(classOf(entries, "v"), "forwarded");
  assert.equal(classOf(entries, "Shape"), "forwarded");
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

test("analyze counts a default export as used when another file imports its default", () => {
  const classes = (importer) =>
    classesOf({
      "src/a/one.ts": "export default function main() {}\nexport const other = 1;\n",
      ...importer,
    }).default;
  assert.equal(classes({ "src/b/two.ts": 'import main from "../a/one.js";\nexport const x = main;\n' }), "used-in-src");
  assert.equal(classes({ "src/b/two.ts": 'import { default as main } from "../a/one.js";\nexport const x = main;\n' }), "used-in-src");
  assert.equal(classes({ "test/a/one.test.ts": 'import main from "../../src/a/one.js";\nvoid main;\n' }), "test-only");
  assert.equal(classes({ "src/b/two.ts": 'import { other } from "../a/one.js";\nexport const x = other;\n' }), "self-only");
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

// --- Findings of the earlier review rounds, each with its exact example ----------------------------------------------------
// The scanner these examples once broke is gone: the TypeScript parser decides what a statement and an identifier are, and
// each example stays as a regression test of the observable classes.

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
  const classes = classesOf({ "src/a/one.ts": "export const value = factory<First, Middle, Last>();\n" });
  assert.deepEqual(classes, { value: "self-only" });
});

// A table of tricky snippets. Each is analysed as src/a/one.ts next to a src/b/two.ts that names `usedByTwo`, and its
// classes must be exactly the expected ones.
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
  ["a generic-looking comparison is still two declarators", "export const amb = a<b, other = c>(d);\nexport const after = 1;\n", { amb: "self-only", other: "self-only", after: "self-only" }],
  ["a comparison on a property: p.value<5", "export interface Payload { readonly value: number }\nexport const check = (p: Payload) => p.value<5;\nexport const after = 1;\n", { Payload: "public-signature", check: "self-only", after: "self-only" }],
  ["a comparison with a digit: x<5", "export const lt = x<5, after = 1;\nexport const more = 2;\n", { lt: "self-only", after: "self-only", more: "self-only" }],
  ["a comparison of two members: a.b<c.d", "export const cmp = a.b<c.d, after = 1;\nexport const more = 2;\n", { cmp: "self-only", after: "self-only", more: "self-only" }],
  ["a comparison with a length: i<arr.length", "export const inRange = i<arr.length, after = 1;\nexport const more = 2;\n", { inRange: "self-only", after: "self-only", more: "self-only" }],
  ["a chained comparison: a<b>c", "export const chained = a<b>c, after = 1;\nexport const more = 2;\n", { chained: "self-only", after: "self-only", more: "self-only" }],
  ["a generic call: f<T>(x)", "export const called = f<T>(x), after = 1;\nexport const more = 2;\n", { called: "self-only", after: "self-only", more: "self-only" }],
  ["a generic constructor: new Map<string, number>()", "export const map = new Map<string, number>(), after = 1;\nexport const more = 2;\n", { map: "self-only", after: "self-only", more: "self-only" }],
];

for (const [title, source, expected] of TRICKY) {
  test(`snippet table: ${title}`, () => {
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

test("a dollar sign before a brace outside a template is part of a name: class Local${} type Internal = Leaf", () => {
  // `Local$` is an identifier and `{}` is the class body, so the class and the alias are two statements and Leaf, which the
  // exported function exposes through the alias, stays public-signature instead of self-only.
  const classes = classesOf({
    "src/a/one.ts": "export interface Leaf { readonly id: number }\nclass Local${} type Internal = Leaf;\nexport function make(): Internal { return { id: 1 }; }\n",
  });
  assert.equal(classes.Leaf, "public-signature");
});

test("a template literal expression never ends a statement: export const a = `${x}`, b = 1", () => {
  const found = collectExports("export const a = `${x}`, b = 1;\nexport const c = `${ {d: 1}.d } and ${e}`;\n", "src/a/x.ts");
  assert.deepEqual(found.exports.map((entry) => entry.name), ["a", "b", "c"]);
  const classes = classesOf({
    "src/a/one.ts": "export const t = `${x}`;\nexport type Later = `a${string}`, Used = Later;\nexport interface Ref {}\nexport type Holder = { r: `${Ref}` };\n",
  });
  assert.equal(classes.Ref, "public-signature");
});

test("a statement after a block is its own statement: a function or a class followed by [1, 2].forEach(...)", () => {
  const found = collectExports(
    [
      "export function setup() {}",
      "[1, 2].forEach((value) => void value);",
      "export class Box {}",
      "[3, 4].forEach((value) => void value);",
      "export const after = 1;",
      "",
    ].join("\n"),
    "src/a/x.ts",
  );
  assert.deepEqual(found.exports.map((entry) => [entry.name, entry.line]), [
    ["setup", 1],
    ["Box", 3],
    ["after", 5],
  ]);
  const classes = classesOf({
    "src/a/one.ts": [
      "export interface Payload { readonly id: number }",
      "export function setup() {}",
      "[1, 2].forEach((value) => void value);",
      "export function use(): Payload { return { id: 1 }; }",
      "export class Box {}",
      "[3, 4].forEach((value) => void value);",
      "export interface Lonely {}",
    ].join("\n"),
  });
  assert.equal(classes.Payload, "public-signature");
  assert.equal(classes.Lonely, "self-only");
  assert.equal(classes.setup, "self-only");
});

test("a comparison after a property is not unclassified and keeps the type it names: (p: Payload) => p.value<5", () => {
  const source = "export interface Payload { readonly value: number }\nexport const check = (p: Payload) => p.value<5;\n";
  assert.deepEqual(classesOf({ "src/a/one.ts": source }), { Payload: "public-signature", check: "self-only" });
  assert.deepEqual(
    analyze({ "src/a/one.ts": source }).entries.filter((entry) => entry.class === "unclassified"),
    [],
  );
});

// --- The real tree -------------------------------------------------------------------------------------------------------

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("analyze completes over the real repository tree and leaves only unresolvable re-exports unclassified", () => {
  const files = {};
  for (const top of ["src", "test"]) {
    for (const relative of readdirSync(join(REPO_ROOT, top), { recursive: true }).map(String).sort()) {
      if (relative.endsWith(".ts")) {
        const path = `${top}/${relative.split(sep).join("/")}`;
        files[path] = readFileSync(join(REPO_ROOT, path), "utf8");
      }
    }
  }
  const { entries } = analyze(files);
  assert.ok(entries.length > 500, `expected more than 500 exports, found ${entries.length}`);
  const unclassified = entries.filter((entry) => entry.class === "unclassified");
  assert.deepEqual(
    unclassified.filter((entry) => entry.kind !== "re-export"),
    [],
  );
  const counts = countEntries(entries).totals;
  assert.equal(counts.total, entries.length);
  assert.ok(counts["used-in-src"] > 0 && counts["public-signature"] > 0 && counts.excluded > 0);
});
