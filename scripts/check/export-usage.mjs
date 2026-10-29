// Export usage reference analysis (TD-09, QR-06, D-1306). Informational: it lists every export of src/**/*.ts with the
// place it is referenced from, so dead exports can be found by reference and not by coverage (a test that uses an export
// covers it). There is no ratchet: the command exits 0 whatever it finds and 2 only on a usage error.
//
// Classes:
//   used-in-src  the exported name appears (as a word) in another src file;
//   test-only    it appears only in test files (a "value" or a "type" by its declaration kind: a documented seam);
//   self-only    it appears in no other file: it is used inside its own file or nowhere, so `export` can be dropped;
//   public-signature
//                a self-only TYPE whose name appears in the signature of another export of the same file (an interface,
//                type or class member signature, a function header, a const annotation): it stays exported, because
//                a caller must be able to name it. The check is a conservative text scan, not type resolution;
//   excluded     out of scope: src/core/errors.ts, src/core/ports*, src/contract/, and the modules loaded by path
//                (src/**/main.ts, src/omp/extension.ts, src/acp/stdio.ts).
// The matching is by word on the source with comments, string literals, template text and regular expressions blanked,
// so documentation and messages are not references. It is a name match, not a symbol resolution: a common name used
// elsewhere hides a dead export (the method errs towards keeping).
//
// Re-exports (`export { x } from "..."`) and `export *` are not classified; their number is reported. The names they
// forward are referenced from the re-exporting file, which counts as a use in src.
//
// Usage: export-usage.mjs [--list | --json] [--dir src/<dir>]... [--class <class>]...
// Run it from anywhere: it reads <package root>/src and <package root>/test.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const USAGE = "usage: export-usage.mjs [--list | --json] [--dir src/<dir>]... [--class <class>]...";

export const CLASSES = ["used-in-src", "test-only", "self-only", "public-signature", "excluded"];

const IDENTIFIER = /[A-Za-z_$][\w$]*/g;
const NAME = "[A-Za-z_$][\\w$]*";
const DECLARATION = new RegExp(
  `^[ \\t]*export\\s+(?:declare\\s+)?(?:(async\\s+function\\s*\\*?|function\\s*\\*?|abstract\\s+class|class|const\\s+enum|enum|interface|type|const|let|var))\\s+(${NAME})`,
  "gm",
);
const EXPORT_LIST = /^[ \t]*export\s+(type\s+)?\{([^}]*)\}(\s*from\b)?/gm;
const EXPORT_STAR = /^[ \t]*export\s*\*/gm;

// Declaration kinds that live in the type space only (they emit no value).
const TYPE_KINDS = new Set(["interface", "type"]);

const REGEX_PRECEDERS = "(,=:[!&|?{};+-*%<>~^";

// Replaces comments, string literals, template text and regular expression literals by spaces, keeping every newline
// and every delimiter, so positions and line numbers survive and `${ ... }` expressions stay code.
export function stripNonCode(source) {
  const out = [];
  const templateDepths = [];
  const length = source.length;
  let mode = "code";
  let previous = "";
  let index = 0;
  const blank = (character) => (character === "\n" || character === "\r" ? character : " ");

  while (index < length) {
    const current = source[index];
    const next = source[index + 1];

    if (mode === "template") {
      if (current === "\\") {
        out.push(blank(current));
        if (next !== undefined) {
          out.push(blank(next));
        }
        index += 2;
      } else if (current === "`") {
        out.push(current);
        mode = "code";
        previous = "`";
        index += 1;
      } else if (current === "$" && next === "{") {
        out.push("${");
        templateDepths.push(0);
        mode = "code";
        previous = "{";
        index += 2;
      } else {
        out.push(blank(current));
        index += 1;
      }
      continue;
    }

    if (current === "/" && next === "/") {
      while (index < length && source[index] !== "\n") {
        out.push(" ");
        index += 1;
      }
      continue;
    }
    if (current === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? length : end + 2;
      for (; index < stop; index += 1) {
        out.push(blank(source[index]));
      }
      continue;
    }
    if (current === '"' || current === "'") {
      out.push(current);
      index += 1;
      while (index < length && source[index] !== current && source[index] !== "\n") {
        const escaped = source[index] === "\\" && index + 1 < length && source[index + 1] !== "\n";
        out.push(" ");
        index += 1;
        if (escaped) {
          out.push(" ");
          index += 1;
        }
      }
      if (source[index] === current) {
        out.push(current);
        index += 1;
      }
      previous = current;
      continue;
    }
    if (current === "`") {
      out.push(current);
      mode = "template";
      index += 1;
      continue;
    }
    if (current === "/") {
      const lookBehind = source.slice(Math.max(0, index - 8), index);
      const startsRegex =
        previous === "" || REGEX_PRECEDERS.includes(previous) || /(?:^|[^\w$])return\s*$/.test(lookBehind);
      if (startsRegex) {
        out.push("/");
        index += 1;
        let inClass = false;
        while (index < length && source[index] !== "\n" && (inClass || source[index] !== "/")) {
          const character = source[index];
          if (character === "\\" && index + 1 < length && source[index + 1] !== "\n") {
            out.push(" ", " ");
            index += 2;
            continue;
          }
          if (character === "[") {
            inClass = true;
          } else if (character === "]") {
            inClass = false;
          }
          out.push(" ");
          index += 1;
        }
        if (source[index] === "/") {
          out.push("/");
          index += 1;
          while (index < length && /[a-z]/.test(source[index])) {
            out.push(" ");
            index += 1;
          }
        }
        previous = "/";
        continue;
      }
    }
    if (templateDepths.length > 0) {
      if (current === "{") {
        templateDepths[templateDepths.length - 1] += 1;
      } else if (current === "}") {
        if (templateDepths[templateDepths.length - 1] === 0) {
          templateDepths.pop();
          out.push("}");
          mode = "template";
          index += 1;
          continue;
        }
        templateDepths[templateDepths.length - 1] -= 1;
      }
    }
    out.push(current);
    if (!/\s/.test(current)) {
      previous = current;
    }
    index += 1;
  }
  return out.join("");
}

function lineOf(text, offset) {
  let line = 1;
  for (let position = text.indexOf("\n"); position !== -1 && position < offset; position = text.indexOf("\n", position + 1)) {
    line += 1;
  }
  return line;
}

function normalizeKind(kind) {
  const compact = kind.replace(/\s+/g, " ").replace(/\s*\*$/, "");
  return compact === "async function" ? "function" : compact;
}

// The declaration kind of a local name that an export list exposes, or "list" when the file declares no such thing
// (an imported name that is exported again).
function localKind(stripped, local) {
  const pattern = new RegExp(
    `^[ \\t]*(?:declare\\s+)?(async\\s+function|function|abstract\\s+class|class|const\\s+enum|enum|interface|type|const|let|var)\\s*\\*?\\s+${local.replace(/\$/g, "\\$")}(?![\\w$])`,
    "m",
  );
  const match = pattern.exec(stripped);
  return match?.[1] === undefined ? "list" : normalizeKind(match[1]);
}

// The text of a declaration that callers see, from the start of its `export` statement: the whole of an interface or
// type alias, a function up to its body, a const up to its initializer (its annotation), and a class header plus the
// member signatures at the top level of the class body (method and constructor bodies are left out). Enums give "".
// The source must be stripped of comments and strings.
function signatureText(stripped, start, kind) {
  if (kind === "enum" || kind === "const enum") {
    return "";
  }
  const isClass = kind === "class" || kind === "abstract class";
  const isVariable = kind === "const" || kind === "let" || kind === "var";
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let seenParen = false;
  let opened = false;
  let text = "";
  for (let index = start; index < stripped.length; index += 1) {
    const current = stripped[index];
    const nested = paren + brace + bracket;
    if (nested === 0) {
      if (kind === "type" && current === ";") {
        break;
      }
      if (isVariable && current === "=" && stripped[index + 1] !== ">" && stripped[index - 1] !== "=") {
        break;
      }
      if (kind === "function" && current === "{" && seenParen) {
        break;
      }
    }
    if (!isClass || brace === 0 || (brace === 1 && current !== "}")) {
      text += current;
    }
    if (current === "(") {
      paren += 1;
      seenParen = true;
    } else if (current === ")") {
      paren -= 1;
    } else if (current === "[") {
      bracket += 1;
    } else if (current === "]") {
      bracket -= 1;
    } else if (current === "{") {
      brace += 1;
      opened = true;
    } else if (current === "}") {
      brace -= 1;
      if (brace === 0 && opened && (isClass || kind === "interface")) {
        break;
      }
    }
  }
  return text;
}

function collectFromStripped(stripped, file) {
  const exports = [];
  let unclassified = 0;

  for (const match of stripped.matchAll(DECLARATION)) {
    const kind = normalizeKind(match[1]);
    exports.push({
      name: match[2],
      local: match[2],
      kind,
      space: TYPE_KINDS.has(kind) ? "type" : "value",
      file,
      line: lineOf(stripped, match.index),
      signature: signatureText(stripped, match.index, kind),
    });
  }

  for (const match of stripped.matchAll(EXPORT_LIST)) {
    const specifiers = match[2].split(",").map((part) => part.trim()).filter((part) => part !== "");
    if (match[3] !== undefined) {
      unclassified += specifiers.length;
      continue;
    }
    for (const specifier of specifiers) {
      const parsed = /^(type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(specifier);
      if (parsed === null) {
        continue;
      }
      const local = parsed[2];
      const kind = match[1] !== undefined || parsed[1] !== undefined ? "type" : localKind(stripped, local);
      exports.push({
        name: parsed[3] ?? local,
        local,
        kind,
        space: kind === "type" || TYPE_KINDS.has(kind) ? "type" : "value",
        file,
        line: lineOf(stripped, match.index),
        signature: "",
      });
    }
  }

  unclassified += [...stripped.matchAll(EXPORT_STAR)].length;
  exports.sort((left, right) => left.line - right.line || left.name.localeCompare(right.name));
  return { exports, unclassified };
}

// Finds the named exports of one source file: `export const|let|var|function|async function|class|abstract class|
// interface|type|enum Name`, `export { a, b as c }` and `export type { A }`. `export default` is ignored. Re-exports
// (`export { x } from`, counted by specifier) and `export *` are not listed; their number is `unclassified`.
// Returns { exports: [{ name, local, kind, space, file, line }], unclassified }.
export function collectExports(source, file) {
  return collectFromStripped(stripNonCode(source), file);
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

// Classifies every export of the src files. `files` maps a "/"-joined path ("src/core/policy.ts", "test/core/x.ts") to
// its source; paths outside src/ and test/ are ignored. Returns { entries, unclassified } with each entry
// { name, local, kind, space, file, line, dir, class }, sorted by file, line and name.
export function analyze(files) {
  const identifiers = new Map();
  const stripped = new Map();
  for (const path of Object.keys(files).sort()) {
    if (!path.startsWith("src/") && !path.startsWith("test/")) {
      continue;
    }
    const code = stripNonCode(files[path]);
    stripped.set(path, code);
    identifiers.set(path, new Set(code.match(IDENTIFIER) ?? []));
  }

  const srcPaths = [...stripped.keys()].filter((path) => path.startsWith("src/"));
  const testPaths = [...stripped.keys()].filter((path) => path.startsWith("test/"));
  const entries = [];
  let unclassified = 0;

  for (const file of srcPaths) {
    const collected = collectFromStripped(stripped.get(file), file);
    unclassified += collected.unclassified;
    for (const found of collected.exports) {
      let klass;
      if (isExcluded(file)) {
        klass = "excluded";
      } else if (srcPaths.some((other) => other !== file && identifiers.get(other).has(found.name))) {
        klass = "used-in-src";
      } else if (testPaths.some((other) => identifiers.get(other).has(found.name))) {
        klass = "test-only";
      } else if (
        found.space === "type" &&
        collected.exports.some(
          (other) => other !== found && (other.signature.match(IDENTIFIER) ?? []).includes(found.name),
        )
      ) {
        klass = "public-signature";
      } else {
        klass = "self-only";
      }
      const entry = { ...found, dir: directoryOf(file), class: klass };
      delete entry.signature;
      entries.push(entry);
    }
  }
  return { entries, unclassified };
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

// Renders the table grouped by directory (class, kind, name, file:line), then the counts per directory and class.
export function formatList(entries, unclassified) {
  const lines = [];
  const directories = [...new Set(entries.map((entry) => entry.dir))].sort();
  const classWidth = Math.max(...CLASSES.map((name) => name.length));
  const kindWidth = Math.max(4, ...entries.map((entry) => entry.kind.length));
  for (const directory of directories) {
    const rows = entries.filter((entry) => entry.dir === directory);
    const nameWidth = Math.max(...rows.map((entry) => entry.name.length));
    lines.push(`${directory}/`);
    for (const entry of rows) {
      lines.push(
        `  ${pad(entry.class, classWidth)}  ${pad(entry.kind, kindWidth)}  ${pad(entry.name, nameWidth)}  ${entry.file}:${entry.line}`,
      );
    }
    lines.push("");
  }

  const { byDirectory, totals } = countEntries(entries);
  lines.push("counts per directory and class");
  const dirWidth = Math.max(5, ...Object.keys(byDirectory).map((directory) => directory.length));
  const header = [pad("dir", dirWidth), ...CLASSES.map((name) => pad(name, name.length)), "total"].join("  ");
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
  lines.push(`unclassified re-exports and export-star statements: ${unclassified}`);
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
  const { entries, unclassified } = analyze(files);
  const selected = filterEntries(entries, options.dirs, options.classes);
  if (options.format === "json") {
    const { byDirectory, totals } = countEntries(selected);
    return { code: 0, output: `${JSON.stringify({ entries: selected, counts: byDirectory, totals, unclassified }, null, 2)}\n` };
  }
  return { code: 0, output: formatList(selected, unclassified) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, output } = runCheck(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(output);
  process.exitCode = code;
}
