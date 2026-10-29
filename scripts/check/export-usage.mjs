// Export usage reference analysis (TD-09, QR-06, D-1306). Informational: it lists every export of src/**/*.ts with the
// place it is referenced from, so dead exports can be found by reference and not by coverage (a test that uses an export
// covers it). There is no ratchet: the command exits 0 whatever it finds and 2 only on a usage error.
//
// Classes (checked in this order; the first that applies wins):
//   excluded     out of scope: src/core/errors.ts, src/core/ports*, src/contract/, and the modules loaded by path
//                (src/**/main.ts, src/omp/extension.ts, src/acp/stdio.ts);
//   forwarded    another src file re-exports it (`export * from`, `export { x } from`, `export type { T } from`): it is part
//                of that file's public surface, never a removal candidate;
//   used-in-src  the exported name appears (as a word) in another src file;
//   test-only    it appears only in test files (a "value" or a "type" by its declaration kind: a documented seam);
//   public-signature
//                a TYPE that no other file names, but whose name appears in the declaration of another export of its file
//                (the declaration extent: signature or body; over-protecting a body-only use is accepted), directly or
//                through a non-exported local type. A caller must be able to name it, so it stays exported;
//   self-only    it appears in no other file and in no other export of its file: it is used inside its own file or
//                nowhere, so `export` can be dropped;
//   unclassified the analysis cannot decide (a re-export whose specifier does not resolve to an analyzed src file, a
//                destructured or declarator export it cannot parse). It is counted and listed with the reason; it is
//                never a removal candidate.
// The method errs towards keeping an export. The matching is by word on the source with comments, string literals,
// template text and regular expressions blanked, so documentation and messages are not references. It is a name match,
// not a symbol resolution: a common name used elsewhere hides a dead export.
//
// A declaration extent is one top-level statement, found by nesting depth on the blanked text (see splitStatements), so
// indentation, comments before a statement and column-zero text inside a body do not matter. For `export { a, b as c }`
// and `export type { ... }` the extent of a member is that of the local declaration of its name.
//
// Usage: export-usage.mjs [--list | --json] [--dir src/<dir>]... [--class <class>]...
// Run it from anywhere: it reads <package root>/src and <package root>/test.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

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

const IDENTIFIER = /[A-Za-z_$][\w$]*/g;
const NAME = "[A-Za-z_$][\\w$]*";
const KIND = "async\\s+function|function|abstract\\s+class|class|const\\s+enum|enum|interface|type|const|let|var";
const HEAD = new RegExp(`^(export\\s+)?(?:declare\\s+)?(${KIND})\\b`);
const EXPORT_LIST = /^export\s*(type\s+)?\{([^}]*)\}(?:\s*from\s*(["']))?/;
const EXPORT_STAR = new RegExp(`^export\\s*\\*\\s*(?:as\\s+(${NAME})\\s*)?from\\s*(["'])`);
// A line break at depth 0 ends the statement when the next statement starts with one of these and the line does not
// continue (it ends in an operator or a comma).
const DECLARATION_AHEAD = /\s*(?:export|import|const|let|var|function|class|interface|enum|declare|abstract|type\s+[A-Za-z_$]|async\s+function)\b/y;
const LINE_CONTINUES = ",=+-*/%&|^<?:.";
// After the `}` that returns to depth 0, the statement goes on when the next text is one of these.
const BRACE_CONTINUES = ";.,=(?:+-*/%&|^<>)";
const CONTINUATION_WORDS = new Set(["as", "satisfies", "else", "catch", "finally", "while", "from", "extends", "implements", "in", "of", "instanceof"]);

// Declaration kinds that live in the type space only (they emit no value).
const TYPE_KINDS = new Set(["interface", "type"]);

// Words after which an expression starts: a `/` there opens a regular expression literal and a `!` negates. They count
// only when they are not a property name (`counts.of / total` divides).
const EXPRESSION_KEYWORDS = new Set(["return", "typeof", "case", "in", "of", "yield", "await", "void", "delete", "throw", "else", "do", "instanceof"]);

// Replaces comments, string literals, template text and regular expression literals by spaces, keeping every newline,
// every delimiter and every offset, so line numbers survive and `${ ... }` expressions stay code.
//
// One left-to-right scan keeps the class of the last significant token: "start" (nothing yet), "expr-end" (an identifier
// that is not a keyword or follows a `.`, a number, a string, a template, a regular expression, a closing `)` or `]`, or
// a postfix `!` or `++`), "keyword" (an expression keyword), or "operator" (everything else, including `}`). A `/` after
// "expr-end" divides; after any other class it opens a regular expression literal (`[...]` classes included, where a `/`
// does not end the literal). A `!` is a postfix non-null assertion only after "expr-end" (and not before `=`).
export function stripNonCode(source) {
  const out = [];
  const templateDepths = [];
  const length = source.length;
  const wordPattern = /[A-Za-z_$][\w$]*/y;
  const numberPattern = /\d\w*(?:\.\d\w*)?/y;
  let mode = "code";
  let previous = "start";
  let afterDot = false;
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
        previous = "expr-end";
        index += 1;
      } else if (current === "$" && next === "{") {
        out.push("${");
        templateDepths.push(0);
        mode = "code";
        previous = "operator";
        index += 2;
      } else {
        out.push(blank(current));
        index += 1;
      }
      continue;
    }

    if (/\s/.test(current)) {
      out.push(current);
      index += 1;
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

    const wasDot = afterDot;
    afterDot = false;

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
      previous = "expr-end";
      continue;
    }
    if (current === "`") {
      out.push(current);
      mode = "template";
      index += 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(current)) {
      wordPattern.lastIndex = index;
      const word = wordPattern.exec(source)?.[0] ?? current;
      out.push(word);
      previous = !wasDot && EXPRESSION_KEYWORDS.has(word) ? "keyword" : "expr-end";
      index += word.length;
      continue;
    }
    if (/\d/.test(current)) {
      numberPattern.lastIndex = index;
      const number = numberPattern.exec(source)?.[0] ?? current;
      out.push(number);
      previous = "expr-end";
      index += number.length;
      continue;
    }
    if (current === "/") {
      if (previous === "expr-end") {
        out.push("/");
        previous = "operator";
        index += 1;
        continue;
      }
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
      previous = "expr-end";
      continue;
    }
    if (current === "!") {
      const postfix = previous === "expr-end" && next !== "=";
      out.push("!");
      previous = postfix ? "expr-end" : "operator";
      index += 1;
      continue;
    }
    if ((current === "+" || current === "-") && next === current) {
      out.push(current, current);
      previous = previous === "expr-end" ? "expr-end" : "operator";
      index += 2;
      continue;
    }
    if (current === "?" && next === "." && !/\d/.test(source[index + 2] ?? "")) {
      out.push("?.");
      previous = "operator";
      afterDot = true;
      index += 2;
      continue;
    }
    if (current === ".") {
      out.push(".");
      previous = "operator";
      afterDot = true;
      index += 1;
      continue;
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
    previous = current === ")" || current === "]" ? "expr-end" : "operator";
    index += 1;
  }
  return out.join("");
}

function countNewlines(text, end) {
  let count = 0;
  for (let position = text.indexOf("\n"); position !== -1 && position < end; position = text.indexOf("\n", position + 1)) {
    count += 1;
  }
  return count;
}

function normalizeKind(kind) {
  const compact = kind.replace(/\s+/g, " ").replace(/\s*\*$/, "");
  return compact === "async function" ? "function" : compact;
}

function isVariableKind(kind) {
  return kind === "const" || kind === "let" || kind === "var";
}

// Splits a stripped source into its top-level statements, by nesting depth ((), [] and {} on the blanked text, so
// comments, strings and regular expressions cannot confuse it): { start, end, line, text }. A statement starts at its
// first significant character, wherever that is on the line, and ends
//   - at a `;` at depth 0;
//   - at a `}` that returns to depth 0 unless the next text continues it (`;`, `.`, `,`, `=`, `(`, `?`, `:`, an operator,
//     `)`, or a word such as `else`, `catch`, `as`, `from`);
//   - at a line break at depth 0 when the next statement starts with a declaration keyword and the line does not end in
//     an operator or a comma (no semicolons needed);
//   - before an `export` word at depth 0, which always starts a statement.
function splitStatements(stripped) {
  const statements = [];
  const length = stripped.length;
  let depth = 0;
  let start = -1;
  let startLine = 1;
  let line = 1;
  let last = -1;
  const finish = () => {
    if (start !== -1) {
      statements.push({ start, end: last + 1, line: startLine, text: stripped.slice(start, last + 1), identifiers: undefined });
    }
    start = -1;
  };
  const endsAfterBrace = (from) => {
    let position = from;
    while (position < length && /\s/.test(stripped[position])) {
      position += 1;
    }
    if (position >= length) {
      return true;
    }
    if (BRACE_CONTINUES.includes(stripped[position])) {
      return false;
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(stripped.slice(position, position + 16))?.[0];
    return word === undefined || !CONTINUATION_WORDS.has(word);
  };

  for (let index = 0; index < length; index += 1) {
    const character = stripped[index];
    if (character === "\n") {
      if (start !== -1 && depth === 0 && !LINE_CONTINUES.includes(stripped[last])) {
        DECLARATION_AHEAD.lastIndex = index + 1;
        if (DECLARATION_AHEAD.test(stripped)) {
          finish();
        }
      }
      line += 1;
      continue;
    }
    if (/\s/.test(character)) {
      continue;
    }
    if (start === -1) {
      start = index;
      startLine = line;
    } else if (
      depth === 0 &&
      character === "e" &&
      stripped.startsWith("export", index) &&
      !/[\w$.]/.test(stripped[index - 1] ?? " ") &&
      !/[\w$]/.test(stripped[index + 6] ?? " ")
    ) {
      finish();
      start = index;
      startLine = line;
    }
    last = index;
    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
    } else if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      if (character === "}" && depth === 0 && endsAfterBrace(index + 1)) {
        finish();
      }
    } else if (character === ";" && depth === 0) {
      finish();
    }
  }
  finish();
  return statements;
}

// Splits at depth-0 occurrences of a separator character, counting (), [] and {}.
function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
    } else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
    } else if (depth === 0 && character === separator) {
      parts.push(text.slice(from, index));
      from = index + 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

// The bound identifiers of a destructuring pattern ("{ a, b: c, d = 1, ...rest }", "[x, , y = 2, ...z]", nested), or null
// when the text is not a pattern this parser understands.
function patternNames(pattern) {
  const open = pattern[0];
  if (open !== "{" && open !== "[") {
    return null;
  }
  let depth = 0;
  let end = -1;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
    } else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  if (end === -1) {
    return null;
  }
  const names = [];
  for (const element of splitTopLevel(pattern.slice(1, end), ",")) {
    let part = element.trim();
    if (part === "") {
      continue;
    }
    if (part.startsWith("...")) {
      part = part.slice(3).trim();
    }
    let target = (splitTopLevel(part, "=")[0] ?? "").trim();
    if (open === "{") {
      const keyed = splitTopLevel(target, ":");
      if (keyed.length > 1) {
        target = keyed.slice(1).join(":").trim();
      }
    }
    if (target.startsWith("{") || target.startsWith("[")) {
      const nested = patternNames(target);
      if (nested === null) {
        return null;
      }
      names.push(...nested);
    } else if (new RegExp(`^${NAME}$`).test(target)) {
      names.push(target);
    } else {
      return null;
    }
  }
  return names;
}

// Splits `const a = 1, b: T<X, Y> = f(1, 2), { c } = d;` (the text after the keyword, from `from`) into declarators and
// returns { items: [{ binding, offset }], uncertain }: each binding is the text before the first depth-0 `:` or `=`.
// Generic arguments stay together: a `<` right after an identifier, or at the start of an expression (a generic arrow's
// type parameters), opens a generic that the matching `>` closes; in a type annotation every `<` does. When a generic
// is left open, or the brackets do not balance, `uncertain` is true and the caller must not trust the items.
function declarators(text, from) {
  const items = [];
  let depth = 0;
  let angle = 0;
  let genericStart = -1;
  let doubtful = false;
  let state = "binding";
  let startOffset = from;
  let bindingEnd = null;
  const finish = (end) => {
    const raw = text.slice(startOffset, bindingEnd ?? end);
    const binding = raw.trim();
    if (binding !== "") {
      items.push({ binding, offset: startOffset + (raw.length - raw.trimStart().length) });
    }
  };
  const opensGeneric = (index) => {
    if (/[\w$]/.test(text[index - 1] ?? "")) {
      return true;
    }
    const before = text.slice(0, index).trimEnd().slice(-1);
    return before !== "" && "=(,:?&|".includes(before);
  };
  for (let index = from; index < text.length; index += 1) {
    const character = text[index];
    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
    } else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
    } else if (depth === 0) {
      if (character === ";") {
        finish(index);
        return { items, uncertain: angle !== 0 || doubtful };
      }
      if (state !== "binding") {
        if (character === "<" && (state === "annotation" || opensGeneric(index))) {
          if (angle === 0) {
            genericStart = index;
          }
          angle += 1;
        } else if (character === ">" && angle > 0 && text[index - 1] !== "=") {
          angle -= 1;
          if (angle === 0 && /[=;]/.test(text.slice(genericStart + 1, index).replaceAll("=>", ""))) {
            // `a < b, c = d > e` is a comparison, not a generic: the bindings cannot be trusted.
            doubtful = true;
          }
        }
      }
      if (character === "," && angle === 0) {
        finish(index);
        startOffset = index + 1;
        bindingEnd = null;
        state = "binding";
      } else if (state === "binding" && character === ":") {
        bindingEnd = index;
        state = "annotation";
      } else if (state !== "init" && character === "=" && text[index + 1] !== ">") {
        bindingEnd ??= index;
        state = "init";
      }
    }
  }
  finish(text.length);
  return { items, uncertain: angle !== 0 || depth !== 0 || doubtful };
}

// Reads the quoted module specifier that starts at the quote at `quoteAt` of the extent text; the stripped source blanks
// string contents, so the specifier comes from the original source at the same offsets.
function specifierAt(extent, quoteAt, source) {
  const close = extent.text.indexOf(extent.text[quoteAt], quoteAt + 1);
  return close === -1 ? null : source.slice(extent.start + quoteAt + 1, extent.start + close);
}

// Orders by line, then by name in code-unit order, so the report does not depend on the locale.
function compareEntries(left, right) {
  if (left.line !== right.line) {
    return left.line - right.line;
  }
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

// Reads one source file. Returns { exports, forwards, unparsed, locals }:
//   exports   [{ name, local, kind, space, file, line, extent }]; extent is the declaration extent of the export, or
//             null for a listed name that the file imports and exports again;
//   forwards  [{ line, star, specifier, names: [{ local, exported }] }] for `export * from` and `export { x } from`;
//   unparsed  [{ name, kind, line, note }] for export forms this parser cannot read;
//   locals    Map name -> { kind, extent } of every top-level declaration, exported or not.
function collect(source, file) {
  const stripped = stripNonCode(source);
  const extents = splitStatements(stripped);
  const locals = new Map();
  const exports = [];
  const forwards = [];
  const unparsed = [];
  const lists = [];

  for (const extent of extents) {
    const text = extent.text;
    const list = EXPORT_LIST.exec(text);
    if (list !== null) {
      lists.push({ extent, list });
      continue;
    }
    const star = EXPORT_STAR.exec(text);
    if (star !== null) {
      const specifier = specifierAt(extent, star[0].length - 1, source);
      if (star[1] === undefined) {
        forwards.push({ line: extent.line, star: true, specifier, names: [] });
      } else {
        exports.push({ name: star[1], local: star[1], kind: "namespace", space: "value", file, line: extent.line, extent });
      }
      continue;
    }
    const head = HEAD.exec(text);
    if (head === null) {
      continue;
    }
    const exported = head[1] !== undefined;
    const kind = normalizeKind(head[2]);
    const rest = text.slice(head[0].length);

    if (isVariableKind(kind)) {
      const parsed = declarators(text, head[0].length);
      if (parsed.uncertain) {
        if (exported) {
          unparsed.push({
            name: (parsed.items[0]?.binding ?? kind).replace(/\s+/g, " ").slice(0, 40),
            kind,
            line: extent.line,
            note: "declaration list that could not be split reliably (generic arguments or a comparison in an initializer)",
          });
        }
        continue;
      }
      for (const declared of parsed.items) {
        const line = extent.line + countNewlines(text, declared.offset);
        const bound = new RegExp(`^${NAME}$`).test(declared.binding) ? [declared.binding] : patternNames(declared.binding);
        if (bound === null) {
          if (exported) {
            const destructured = declared.binding.startsWith("{") || declared.binding.startsWith("[");
            unparsed.push({
              name: declared.binding.replace(/\s+/g, " ").slice(0, 40),
              kind,
              line,
              note: destructured ? "destructured export that could not be parsed" : "declarator that could not be parsed",
            });
          }
          continue;
        }
        for (const name of bound) {
          locals.set(name, { kind, extent });
          if (exported) {
            exports.push({ name, local: name, kind, space: "value", file, line, extent });
          }
        }
      }
      continue;
    }

    const named = new RegExp(`^\\s*\\*?\\s*(${NAME})`).exec(rest);
    if (named === null) {
      continue;
    }
    locals.set(named[1], { kind, extent });
    if (exported) {
      exports.push({
        name: named[1],
        local: named[1],
        kind,
        space: TYPE_KINDS.has(kind) ? "type" : "value",
        file,
        line: extent.line,
        extent,
      });
    }
  }

  for (const { extent, list } of lists) {
    const members = [];
    for (const specifier of list[2].split(",").map((part) => part.trim()).filter((part) => part !== "")) {
      const parsed = new RegExp(`^(type\\s+)?(${NAME})(?:\\s+as\\s+(${NAME}))?$`).exec(specifier);
      if (parsed !== null) {
        members.push({ typeOnly: list[1] !== undefined || parsed[1] !== undefined, local: parsed[2], exported: parsed[3] ?? parsed[2] });
      }
    }
    if (list[3] !== undefined) {
      const specifier = specifierAt(extent, list[0].length - 1, source);
      forwards.push({
        line: extent.line,
        star: false,
        specifier,
        names: members.map(({ local, exported }) => ({ local, exported })),
      });
      continue;
    }
    for (const member of members) {
      const local = locals.get(member.local);
      const kind = member.typeOnly ? "type" : (local?.kind ?? "list");
      exports.push({
        name: member.exported,
        local: member.local,
        kind,
        space: kind === "type" || TYPE_KINDS.has(kind) ? "type" : "value",
        file,
        line: extent.line,
        extent: local?.extent ?? null,
      });
    }
  }

  exports.sort(compareEntries);
  forwards.sort((left, right) => left.line - right.line);
  return { exports, forwards, unparsed, locals };
}

// A copy of an export record without its internal declaration extent.
function withoutExtent(found) {
  const visible = { ...found };
  delete visible.extent;
  return visible;
}

// Finds the named exports of one source file: `export const|let|var|function|async function|class|abstract class|
// interface|type|enum Name`, every declarator of `export const a = 1, b = 2`, the names of a destructured
// `export const { a, b: c } = ...` or `export const [x] = ...`, `export { a, b as c }` and `export type { A }`
// (a listed name takes the kind of its local declaration). `export default` is ignored. Returns
// { exports: [{ name, local, kind, space, file, line }], forwards: [{ line, star, specifier, names }], unparsed:
// [{ name, kind, line, note }] }. Forwards are the `export * from` and `export { x } from` statements.
export function collectExports(source, file) {
  const { exports, forwards, unparsed } = collect(source, file);
  return {
    exports: exports.map(withoutExtent),
    forwards,
    unparsed,
  };
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

function identifiersOf(extent) {
  extent.identifiers ??= new Set(extent.text.match(IDENTIFIER) ?? []);
  return extent.identifiers;
}

// Every identifier in the extent and, transitively, in the local type declarations (interface, type alias) it names.
function reachableIdentifiers(extent, localTypes, memo) {
  const known = memo.get(extent);
  if (known !== undefined) {
    return known;
  }
  const seen = new Set();
  const visited = new Set([extent]);
  const queue = [extent];
  while (queue.length > 0) {
    const next = queue.pop();
    for (const identifier of identifiersOf(next)) {
      seen.add(identifier);
      const local = localTypes.get(identifier);
      if (local !== undefined && !visited.has(local)) {
        visited.add(local);
        queue.push(local);
      }
    }
  }
  memo.set(extent, seen);
  return seen;
}

// Classifies every export of the src files. `files` maps a "/"-joined path ("src/core/policy.ts", "test/core/x.ts") to
// its source; paths outside src/ and test/ are ignored. Returns { entries } with each entry
// { name, local, kind, space, file, line, dir, class } (and `note` for an unclassified one), sorted by file, line and name.
export function analyze(files) {
  const identifiers = new Map();
  const sources = new Map();
  for (const path of Object.keys(files).sort()) {
    if (!path.startsWith("src/") && !path.startsWith("test/")) {
      continue;
    }
    sources.set(path, files[path]);
    identifiers.set(path, new Set(stripNonCode(files[path]).match(IDENTIFIER) ?? []));
  }

  const srcPaths = [...sources.keys()].filter((path) => path.startsWith("src/"));
  const srcSet = new Set(srcPaths);
  const testPaths = [...sources.keys()].filter((path) => path.startsWith("test/"));
  const collected = new Map(srcPaths.map((file) => [file, collect(sources.get(file), file)]));

  const forwarded = new Set();
  const unresolved = [];
  for (const [file, { forwards }] of collected) {
    for (const forward of forwards) {
      const target = resolveSpecifier(file, forward.specifier, srcSet);
      if (target === null) {
        const note =
          forward.specifier === null
            ? "re-export whose module specifier could not be read"
            : forward.specifier.startsWith(".")
              ? `re-export of ${JSON.stringify(forward.specifier)}, which is not an analyzed src file`
              : `re-export from external module ${JSON.stringify(forward.specifier)}`;
        const names = forward.star ? ["*"] : forward.names.map((member) => member.exported);
        for (const name of names) {
          unresolved.push({ name, local: name, kind: "re-export", space: "value", file, line: forward.line, note });
        }
        continue;
      }
      const wanted = forward.star ? null : new Set(forward.names.map((member) => member.local));
      for (const exported of collected.get(target).exports) {
        if (wanted === null || wanted.has(exported.name)) {
          forwarded.add(`${target}\u0000${exported.name}`);
        }
      }
    }
  }

  const entries = [];
  for (const file of srcPaths) {
    const { exports, unparsed, locals } = collected.get(file);
    const localTypes = new Map();
    for (const [name, local] of locals) {
      if (TYPE_KINDS.has(local.kind)) {
        localTypes.set(name, local.extent);
      }
    }
    const memo = new Map();
    const fileEntries = [];
    for (const found of exports) {
      let klass;
      if (isExcluded(file)) {
        klass = "excluded";
      } else if (forwarded.has(`${file}\u0000${found.name}`)) {
        klass = "forwarded";
      } else if (srcPaths.some((other) => other !== file && identifiers.get(other).has(found.name))) {
        klass = "used-in-src";
      } else if (testPaths.some((other) => identifiers.get(other).has(found.name))) {
        klass = "test-only";
      } else if (
        found.space === "type" &&
        exports.some(
          (other) =>
            other.extent !== null &&
            other.extent !== found.extent &&
            reachableIdentifiers(other.extent, localTypes, memo).has(found.local),
        )
      ) {
        klass = "public-signature";
      } else {
        klass = "self-only";
      }
      const visible = withoutExtent(found);
      fileEntries.push({ ...visible, dir: directoryOf(file), class: klass });
    }
    const undecided = [
      ...unparsed.map((item) => ({ ...item, local: item.name, space: "value", file })),
      ...unresolved.filter((item) => item.file === file),
    ];
    for (const item of undecided) {
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
