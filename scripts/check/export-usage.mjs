// Export usage reference analysis (TD-09, QR-06, D-1306). Informational: it lists every export of src/**/*.ts with the
// place it is referenced from, so dead exports can be found by reference and not by coverage (a test that uses an export
// covers it). There is no ratchet: the command exits 0 whatever it finds and 2 only on a usage error.
//
// Documented exception to "scripts use Node built-ins only": this script parses the sources with the TypeScript compiler
// API (`typescript`, already a devDependency of the package; no new dependency). A hand-written scanner kept misreading
// statement boundaries, so the parser decides what a statement, an export and an identifier are. It creates one source
// file per path (`ts.createSourceFile`), with no program and no type checking. It is not a CI gate: it runs only when
// someone invokes it or its test.
//
// What counts:
//   exports     top-level statements with an `export` modifier (functions, classes, interfaces, type aliases, enums, namespaces,
//               `export import X = ...`, and every binding name of a variable statement, destructured ones included),
//               `export { a as b }` and `export type { ... }` (the local declaration is found by name), `export * as ns`, and
//               `export default` (name `default`, the declaration's own kind; it counts as used when another file imports its default);
//   references  every Identifier node of a file (property names, import specifiers and type references included), minus the
//               identifier that declares an export of that same file. Comments and strings are never identifiers. The match
//               is by name, not by symbol, so a common name used anywhere else keeps an export.
//
// Classes (checked in this order; the first that applies wins):
//   excluded     out of scope: src/core/errors.ts, src/core/ports*, src/contract/, and the modules loaded by path
//                (src/**/main.ts, src/omp/extension.ts, src/acp/stdio.ts);
//   forwarded    another src file re-exports it (`export * from`, `export { x } from`, `export type { T } from`,
//                `export * as ns from`): it is part of that file's public surface, never a removal candidate;
//   used-in-src  another src file references its name;
//   test-only    only test files do (a "value" or a "type" by its declaration kind: a documented seam);
//   public-signature
//                a type (interface, type alias, enum, class) that no other file names, but whose name appears in the syntax tree
//                of another export of its file, signature or body, directly or through the non-exported local declarations
//                that export names. A caller may need to name it, so it stays exported (over-protecting a body-only use is
//                accepted: uncertainty only ever keeps things);
//   self-only    it is referenced from no other file and from no other export of its file: it is used inside its own file or
//                nowhere, so `export` can be dropped;
//   unclassified a re-export whose module specifier does not resolve to an analyzed src file (counted and listed with the
//                reason; never a removal candidate).
//
// Usage: export-usage.mjs [--list | --json] [--dir src/<dir>]... [--class <class>]...
// Run it from anywhere: it reads <package root>/src and <package root>/test.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const USAGE = "usage: export-usage.mjs [--list | --json] [--dir src/<dir>]... [--class <class>]...";

export const CLASSES = [
  "used-in-src",
  "test-only",
  "self-only",
  "public-signature",
  "forwarded",
  "unclassified",
  "excluded",
];

// Declaration kinds that live in the type space only (they emit no value).
const TYPE_KINDS = new Set(["interface", "type"]);

// Declaration kinds whose names another declaration's syntax can mention as a type.
const NAMEABLE_KINDS = new Set(["interface", "type", "class", "abstract class", "enum", "const enum"]);

function hasModifier(node, kind) {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

// The kind of a declaration statement ("function", "class", "const", ...), or null for any other statement.
function declarationKind(statement) {
  if (ts.isFunctionDeclaration(statement)) {
    return "function";
  }
  if (ts.isClassDeclaration(statement)) {
    return hasModifier(statement, ts.SyntaxKind.AbstractKeyword) ? "abstract class" : "class";
  }
  if (ts.isInterfaceDeclaration(statement)) {
    return "interface";
  }
  if (ts.isTypeAliasDeclaration(statement)) {
    return "type";
  }
  if (ts.isEnumDeclaration(statement)) {
    return hasModifier(statement, ts.SyntaxKind.ConstKeyword) ? "const enum" : "enum";
  }
  if (ts.isModuleDeclaration(statement)) {
    return statement.flags & ts.NodeFlags.Namespace ? "namespace" : "module";
  }
  if (ts.isVariableStatement(statement)) {
    const flags = statement.declarationList.flags;
    return flags & ts.NodeFlags.Const ? "const" : flags & ts.NodeFlags.Let ? "let" : "var";
  }
  if (ts.isImportEqualsDeclaration(statement)) {
    return "import";
  }
  return null;
}

// Appends the identifiers a binding name declares (a plain name, or every name of a destructuring pattern, nested).
function bindingIdentifiers(name, into) {
  if (ts.isIdentifier(name)) {
    into.push(name);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      bindingIdentifiers(element.name, into);
    }
  }
}

// The identifier nodes a declaration statement declares.
function declaredNames(statement) {
  if (ts.isVariableStatement(statement)) {
    const names = [];
    for (const declaration of statement.declarationList.declarations) {
      bindingIdentifiers(declaration.name, names);
    }
    return names;
  }
  return statement.name !== undefined && ts.isIdentifier(statement.name) ? [statement.name] : [];
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

// Reads one source file with the TypeScript parser. Returns
//   exports   [{ name, local, kind, space, file, line, statements, nameNode }]: `statements` are the declaration statements the
//             export stands for (empty for a name the file imports and exports again), `nameNode` the identifier that
//             declares it (null for `export default <expression>`);
//   forwards  [{ line, star, specifier, names: [{ local, exported }] }] for `export * from` and `export { x } from`;
//   locals    Map name -> { kind, statements } of every top-level declaration, exported or not;
//   defaultReaches  the module specifiers through which this file reaches a module in a way that can expose its `default`
//             (a default or namespace import, `import { default as x }`, `import("...")`, `require("...")`,
//             `import x = require("...")`, `export * from`); a pure named import list that does not name `default` is not one;
//   sourceFile.
function collect(source, file) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const locals = new Map();
  for (const statement of sourceFile.statements) {
    const kind = declarationKind(statement);
    if (kind === null) {
      continue;
    }
    for (const identifier of declaredNames(statement)) {
      const local = locals.get(identifier.text) ?? { kind, statements: [] };
      local.statements.push(statement);
      locals.set(identifier.text, local);
    }
  }

  const exports = [];
  const forwards = [];
  const defaultReaches = [];
  const add = (name, local, kind, space, line, statements, nameNode) =>
    exports.push({ name, local, kind, space, file, line, statements, nameNode });

  for (const statement of sourceFile.statements) {
    const line = lineOf(sourceFile, statement);

    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      const exposesDefault =
        clause !== undefined &&
        (clause.name !== undefined ||
          (bindings !== undefined &&
            (ts.isNamespaceImport(bindings) || bindings.elements.some((element) => (element.propertyName ?? element.name).text === "default"))));
      if (exposesDefault && ts.isStringLiteral(statement.moduleSpecifier)) {
        defaultReaches.push(statement.moduleSpecifier.text);
      }
      continue;
    }

    if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference) && ts.isStringLiteral(statement.moduleReference.expression)) {
      defaultReaches.push(statement.moduleReference.expression.text);
    }

    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (statement.moduleSpecifier !== undefined) {
        const specifier = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null;
        if (clause === undefined) {
          forwards.push({ line, star: true, specifier, names: [] });
          if (specifier !== null) {
            defaultReaches.push(specifier);
          }
        } else if (ts.isNamespaceExport(clause)) {
          const typeOnly = statement.isTypeOnly;
          add(clause.name.text, clause.name.text, typeOnly ? "type" : "namespace", typeOnly ? "type" : "value", line, [statement], clause.name);
          forwards.push({ line, star: true, specifier, names: [], namespace: clause.name.text });
          if (specifier !== null) {
            defaultReaches.push(specifier);
          }
        } else {
          forwards.push({
            line,
            star: false,
            specifier,
            names: clause.elements.map((element) => ({ local: (element.propertyName ?? element.name).text, exported: element.name.text })),
          });
        }
      } else if (clause !== undefined && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          const local = (element.propertyName ?? element.name).text;
          const declared = locals.get(local);
          const typeOnly = statement.isTypeOnly || element.isTypeOnly;
          const kind = typeOnly ? "type" : (declared?.kind ?? "list");
          add(element.name.text, local, kind, kind === "type" || TYPE_KINDS.has(kind) ? "type" : "value", line, declared?.statements ?? [], element.name);
        }
      }
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      if (!statement.isExportEquals) {
        add("default", "default", "default", "value", line, [statement], null);
      }
      continue;
    }

    const kind = declarationKind(statement);
    if (kind === null || !hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      continue;
    }
    if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
      const declared = declaredNames(statement)[0];
      // Keep the declaration kind. A default class is still a class: another export can name it, and that has to
      // count as public-signature. The exported name stays "default".
      add("default", declared?.text ?? "default", kind, TYPE_KINDS.has(kind) ? "type" : "value", line, [statement], declared ?? null);
      continue;
    }
    for (const identifier of declaredNames(statement)) {
      const variable = ts.isVariableStatement(statement);
      add(
        identifier.text,
        identifier.text,
        kind,
        TYPE_KINDS.has(kind) ? "type" : "value",
        variable ? lineOf(sourceFile, identifier) : line,
        [statement],
        identifier,
      );
    }
  }

  exports.sort(compareEntries);
  forwards.sort((left, right) => left.line - right.line);
  // Dynamic import() and require() calls, and import("...") types, anywhere in the file.
  const visitReaches = (node) => {
    if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) {
        defaultReaches.push(node.arguments[0].text);
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      defaultReaches.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visitReaches);
  };
  visitReaches(sourceFile);
  return { sourceFile, exports, forwards, locals, defaultReaches };
}

// Orders by line, then by name in code-unit order, so the report does not depend on the locale.
function compareEntries(left, right) {
  if (left.line !== right.line) {
    return left.line - right.line;
  }
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

// A copy of an export record without its internal syntax-tree fields.
function plain(found) {
  const visible = { ...found };
  delete visible.statements;
  delete visible.nameNode;
  return visible;
}

// Finds the exports of one source file (see collect): `{ exports: [{ name, local, kind, space, file, line }], forwards:
// [{ line, star, specifier, names }] }`. Forwards are the `export * from` and `export { x } from` statements.
export function collectExports(source, file) {
  const { exports, forwards } = collect(source, file);
  return { exports: exports.map(plain), forwards };
}

// True for the files whose exports are out of scope.
export function isExcluded(file) {
  return (
    file === "src/core/errors.ts" ||
    file.startsWith("src/core/ports") ||
    file.startsWith("src/contract/") ||
    /^src\/(?:.*\/)?main\.ts$/.test(file) ||
    file === "src/omp/extension.ts" ||
    file === "src/acp/stdio.ts"
  );
}

function directoryOf(file) {
  const slash = file.lastIndexOf("/");
  return slash === -1 ? "." : file.slice(0, slash);
}

// Resolves a relative module specifier from a file to an analyzed src path ("./value.js" -> "src/a/value.ts"), or null
// when it is not relative or names no analyzed file.
export function resolveSpecifier(file, specifier, srcPaths) {
  if (specifier === null || (!specifier.startsWith("./") && !specifier.startsWith("../"))) {
    return null;
  }
  const parts = directoryOf(file).split("/");
  for (const segment of specifier.split("/")) {
    if (segment === "." || segment === "") {
      continue;
    }
    if (segment === "..") {
      if (parts.length === 0) {
        return null;
      }
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  const target = parts.join("/");
  const candidates = [target.replace(/\.js$/, ".ts"), `${target}.ts`, `${target}/index.ts`];
  return candidates.find((candidate) => srcPaths.has(candidate)) ?? null;
}

// The names a file references: every Identifier node except the ones that declare an export of the file.
function referencedNames(collected) {
  const declaring = new Set(collected.exports.map((found) => found.nameNode));
  const names = new Set();
  const visit = (node) => {
    if (ts.isIdentifier(node) && !declaring.has(node)) {
      names.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(collected.sourceFile);
  return names;
}

// Every identifier name in the subtree of a node (declaring names included), cached per node.
function namesIn(node, cache) {
  let names = cache.get(node);
  if (names === undefined) {
    names = new Set();
    const visit = (child) => {
      if (ts.isIdentifier(child)) {
        names.add(child.text);
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
    cache.set(node, names);
  }
  return names;
}

// Every identifier name in the statements of an export and, transitively, in the top-level declarations of the same file
// that those names point to (exported or not; signature or body).
function reachableNames(statements, locals, cache) {
  const seen = new Set();
  const visited = new Set(statements);
  const queue = [...statements];
  while (queue.length > 0) {
    const statement = queue.pop();
    for (const name of namesIn(statement, cache)) {
      seen.add(name);
      for (const next of locals.get(name)?.statements ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
  }
  return seen;
}

// Classifies every export of the src files. `files` maps a "/"-joined path ("src/core/policy.ts", "test/core/x.ts") to
// its source; paths outside src/ and test/ are ignored. Returns { entries } with each entry
// { name, local, kind, space, file, line, dir, class } (and `note` for an unclassified one), sorted by file, line and name.
export function analyze(files) {
  const parsed = new Map();
  for (const path of Object.keys(files).sort()) {
    if (path.startsWith("src/") || path.startsWith("test/")) {
      const collected = collect(files[path], path);
      parsed.set(path, { ...collected, references: referencedNames(collected) });
    }
  }

  const allPaths = new Set(parsed.keys());
  const srcPaths = [...parsed.keys()].filter((path) => path.startsWith("src/"));
  const srcSet = new Set(srcPaths);
  const testPaths = [...parsed.keys()].filter((path) => path.startsWith("test/"));

  // Which files reach which module in a way that can expose its default export.
  const defaultImporters = new Map();
  for (const [path, { defaultReaches }] of parsed) {
    for (const specifier of defaultReaches) {
      const target = resolveSpecifier(path, specifier, allPaths);
      if (target !== null) {
        defaultImporters.set(target, (defaultImporters.get(target) ?? new Set()).add(path));
      }
    }
  }

  const forwarded = new Set();
  const unresolved = [];
  for (const [file, { forwards }] of parsed) {
    if (!srcSet.has(file)) {
      continue;
    }
    for (const forward of forwards) {
      const target = resolveSpecifier(file, forward.specifier, srcSet);
      if (target === null) {
        const note =
          forward.specifier === null
            ? "re-export whose module specifier could not be read"
            : forward.specifier.startsWith(".")
              ? `re-export of ${JSON.stringify(forward.specifier)}, which is not an analyzed src file`
              : `re-export from external module ${JSON.stringify(forward.specifier)}`;
        const names =
          forward.namespace !== undefined ? [forward.namespace] : forward.star ? ["*"] : forward.names.map((member) => member.exported);
        for (const name of names) {
          unresolved.push({ name, local: name, kind: "re-export", space: "value", file, line: forward.line, note });
        }
        continue;
      }
      const wanted = forward.star ? null : new Set(forward.names.map((member) => member.local));
      for (const exported of parsed.get(target).exports) {
        if (wanted === null || wanted.has(exported.name)) {
          forwarded.add(`${target}\u0000${exported.name}`);
        }
      }
    }
  }

  const referencedFrom = (other, file, found) =>
    found.name === "default" ? (defaultImporters.get(file)?.has(other) ?? false) : parsed.get(other).references.has(found.name);

  const entries = [];
  for (const file of srcPaths) {
    const { exports, locals } = parsed.get(file);
    const cache = new Map();
    const reachable = new Map();
    const namesOf = (other) => {
      let names = reachable.get(other);
      if (names === undefined) {
        names = reachableNames(other.statements, locals, cache);
        reachable.set(other, names);
      }
      return names;
    };
    const fileEntries = [];
    const replaced = new Set(unresolved.filter((item) => item.file === file).map((item) => `${item.line}\0${item.name}`));
    for (const found of exports) {
      if (replaced.has(`${found.line}\0${found.name}`)) {
        continue;
      }
      let klass;
      if (isExcluded(file)) {
        klass = "excluded";
      } else if (forwarded.has(`${file}\u0000${found.name}`)) {
        klass = "forwarded";
      } else if (srcPaths.some((other) => other !== file && referencedFrom(other, file, found))) {
        klass = "used-in-src";
      } else if (testPaths.some((other) => referencedFrom(other, file, found))) {
        klass = "test-only";
      } else if (
        (found.space === "type" || NAMEABLE_KINDS.has(found.kind)) &&
        exports.some(
          (other) =>
            other !== found &&
            other.statements.length > 0 &&
            !other.statements.some((statement) => found.statements.includes(statement)) &&
            namesOf(other).has(found.local),
        )
      ) {
        klass = "public-signature";
      } else {
        klass = "self-only";
      }
      fileEntries.push({ ...plain(found), dir: directoryOf(file), class: klass });
    }
    for (const item of unresolved.filter((candidate) => candidate.file === file)) {
      fileEntries.push({ ...item, dir: directoryOf(file), class: "unclassified" });
    }
    fileEntries.sort(compareEntries);
    entries.push(...fileEntries);
  }
  return { entries };
}

// Counts the entries per directory and class. Returns { byDirectory: { <dir>: { <class>: n, total: n } }, totals }.
export function countEntries(entries) {
  const blankCounts = () => ({ ...Object.fromEntries(CLASSES.map((name) => [name, 0])), total: 0 });
  const byDirectory = {};
  const totals = { ...blankCounts(), testOnlyValues: 0, testOnlyTypes: 0 };
  for (const entry of entries) {
    byDirectory[entry.dir] ??= blankCounts();
    byDirectory[entry.dir][entry.class] += 1;
    byDirectory[entry.dir].total += 1;
    totals[entry.class] += 1;
    totals.total += 1;
    if (entry.class === "test-only") {
      totals[entry.space === "type" ? "testOnlyTypes" : "testOnlyValues"] += 1;
    }
  }
  return { byDirectory, totals };
}

// Parses the command line (without node and the script path). Unknown flags, positional arguments, a missing value, an
// unknown class, a directory outside src/ and --list together with --json are usage errors that carry the usage line.
export function parseArgs(argv) {
  const options = { format: undefined, dirs: [], classes: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--list" || flag === "--json") {
      const format = flag === "--list" ? "list" : "json";
      if (options.format !== undefined && options.format !== format) {
        throw new Error(`--list and --json are exclusive; ${USAGE}`);
      }
      options.format = format;
      continue;
    }
    if (flag !== "--dir" && flag !== "--class") {
      throw new Error(`unknown argument ${JSON.stringify(flag)}; ${USAGE}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value === "" || value.startsWith("--")) {
      throw new Error(`${flag} needs a value; ${USAGE}`);
    }
    index += 1;
    if (flag === "--class") {
      if (!CLASSES.includes(value)) {
        throw new Error(`--class must be one of ${CLASSES.join(", ")}, got ${JSON.stringify(value)}; ${USAGE}`);
      }
      options.classes.push(value);
    } else {
      const directory = value.replace(/\/+$/, "");
      if (!/^src\/[^/]+(?:\/[^/]+)*$/.test(directory)) {
        throw new Error(`--dir must name a directory under src/, got ${JSON.stringify(value)}; ${USAGE}`);
      }
      options.dirs.push(directory);
    }
  }
  options.format ??= "list";
  return options;
}

// Keeps the entries in one of the given directories (or below) and of one of the given classes; an empty filter keeps all.
export function filterEntries(entries, dirs, classes) {
  return entries.filter(
    (entry) =>
      (dirs.length === 0 || dirs.some((dir) => entry.dir === dir || entry.dir.startsWith(`${dir}/`))) &&
      (classes.length === 0 || classes.includes(entry.class)),
  );
}

function pad(text, width) {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

// Renders the table grouped by directory (class, kind, name, file:line, and the reason of an unclassified entry), then the
// counts per directory and class.
export function formatList(entries) {
  const lines = [];
  const directories = [...new Set(entries.map((entry) => entry.dir))].sort();
  const classWidth = Math.max(...CLASSES.map((name) => name.length));
  const kindWidth = Math.max(4, ...entries.map((entry) => entry.kind.length));
  for (const directory of directories) {
    const rows = entries.filter((entry) => entry.dir === directory);
    const nameWidth = Math.max(...rows.map((entry) => entry.name.length));
    lines.push(`${directory}/`);
    for (const entry of rows) {
      const note = entry.note === undefined ? "" : `  (${entry.note})`;
      lines.push(
        `  ${pad(entry.class, classWidth)}  ${pad(entry.kind, kindWidth)}  ${pad(entry.name, nameWidth)}  ${entry.file}:${entry.line}${note}`,
      );
    }
    lines.push("");
  }

  const { byDirectory, totals } = countEntries(entries);
  lines.push("counts per directory and class");
  const dirWidth = Math.max(5, ...Object.keys(byDirectory).map((directory) => directory.length));
  const header = [pad("dir", dirWidth), ...CLASSES, "total"].join("  ");
  lines.push(`  ${header}`);
  for (const directory of Object.keys(byDirectory).sort()) {
    const counts = byDirectory[directory];
    lines.push(
      `  ${[pad(directory, dirWidth), ...CLASSES.map((name) => pad(String(counts[name]), name.length)), counts.total].join("  ")}`,
    );
  }
  lines.push(
    `  ${[pad("all", dirWidth), ...CLASSES.map((name) => pad(String(totals[name]), name.length)), totals.total].join("  ")}`,
  );
  lines.push(`test-only: ${totals.testOnlyValues} values, ${totals.testOnlyTypes} types`);
  return `${lines.join("\n")}\n`;
}

// Lists the "/"-joined paths of every .ts file under a root's src/ and test/ directories, sorted.
function listTypeScript(root) {
  const files = {};
  for (const top of ["src", "test"]) {
    for (const relative of readdirSync(join(root, top), { recursive: true }).map(String).sort()) {
      if (relative.endsWith(".ts")) {
        const path = `${top}/${relative.split(sep).join("/")}`;
        files[path] = readFileSync(join(root, path), "utf8");
      }
    }
  }
  return files;
}

// The side effects of the command: `loadFiles` returns the { path: source } map of src/**/*.ts and test/**/*.ts.
const REAL_DEPS = { loadFiles: () => listTypeScript(ROOT) };

// Runs the whole command for the given arguments (without node and the script path). Returns { code, output }: code 0
// with the report, 2 with the message for a usage error, 1 when the source tree cannot be read. Findings never fail it.
export function runCheck(argv, overrides = {}) {
  const deps = { ...REAL_DEPS, ...overrides };
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    return { code: 2, output: `export-usage failed: ${error.message}\n` };
  }
  let files;
  try {
    files = deps.loadFiles();
  } catch (error) {
    return { code: 1, output: `export-usage failed: cannot read the source tree: ${error.message}\n` };
  }
  const { entries } = analyze(files);
  const selected = filterEntries(entries, options.dirs, options.classes);
  if (options.format === "json") {
    const { byDirectory, totals } = countEntries(selected);
    return { code: 0, output: `${JSON.stringify({ entries: selected, counts: byDirectory, totals }, null, 2)}\n` };
  }
  return { code: 0, output: formatList(selected) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, output } = runCheck(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(output);
  process.exitCode = code;
}
