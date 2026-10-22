import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The exec gate entry modules. These mirror GATE_MODULES in eslint.config.js.
export const GATE_ENTRIES = [
  "src/core/policy.ts",
  "src/core/states.ts",
  "src/core/errors.ts",
  "src/contract/validate.ts",
];

// Modules the exec gate closure must never reach (TOOL-02, P6-D1).
export const FORBIDDEN_MODULES = ["src/doctor/checks.ts", "src/runtime/session-execution.ts", "src/cli/main.ts"];

const CHILD_PROCESS = new Set(["child_process", "node:child_process"]);

// Import forms, matched on code only (see blankNonCode). The d flag reports each specifier's offset in the source.
const STATIC_IMPORT = /\b(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']/gd;
const SIDE_EFFECT_IMPORT = /\bimport\s*["']([^"']+)["']/gd;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gd;
const REQUIRE_CALL = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/gd;

// Words after which a slash opens a regex literal rather than dividing.
const REGEX_AFTER_WORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

// Index just past the regex literal that starts at start, or -1 when the slash does not open one on this line.
function regexEnd(source, start) {
  let inClass = false;
  for (let j = start + 1; j < source.length; j++) {
    const ch = source[j];
    if (ch === "\n") {
      return -1;
    }
    if (ch === "\\") {
      j++;
    } else if (inClass) {
      inClass = ch !== "]";
    } else if (ch === "[") {
      inClass = true;
    } else if (ch === "/") {
      let k = j + 1;
      while (k < source.length && /[A-Za-z]/.test(source[k])) {
        k++;
      }
      return k;
    }
  }
  return -1;
}

// Returns the source with string literal contents, template literal text, comments and regex literal bodies
// replaced by spaces. Newlines are kept, so every character keeps its offset and line number. Code inside a
// template substitution (${ ... }) is kept, so an import there is still seen.
export function blankNonCode(source) {
  const chars = source.split("");
  const n = source.length;
  const blank = (from, to) => {
    for (let k = from; k < to; k++) {
      if (chars[k] !== "\n") {
        chars[k] = " ";
      }
    }
  };
  // "code" at top level, "expr" inside a ${ ... } with its brace depth, "template" for literal text.
  const frames = [{ kind: "code", depth: 0 }];
  let regexAllowed = true;
  let i = 0;
  while (i < n) {
    const frame = frames.at(-1);
    const ch = source[i];
    if (frame.kind === "template") {
      if (ch === "\\") {
        blank(i, Math.min(i + 2, n));
        i += 2;
      } else if (ch === "`") {
        blank(i, i + 1);
        frames.pop();
        regexAllowed = false;
        i++;
      } else if (ch === "$" && source[i + 1] === "{") {
        frames.push({ kind: "expr", depth: 0 });
        regexAllowed = true;
        i += 2;
      } else {
        blank(i, i + 1);
        i++;
      }
    } else if (ch === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i);
      const stop = newline === -1 ? n : newline;
      blank(i, stop);
      i = stop;
    } else if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      const stop = close === -1 ? n : close + 2;
      blank(i, stop);
      i = stop;
    } else if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < n && source[j] !== ch && source[j] !== "\n") {
        j += source[j] === "\\" ? 2 : 1;
      }
      const end = Math.min(j, n);
      blank(i + 1, end);
      i = source[end] === ch ? end + 1 : end;
      regexAllowed = false;
    } else if (ch === "`") {
      blank(i, i + 1);
      frames.push({ kind: "template" });
      i++;
    } else if (ch === "/" && regexAllowed && regexEnd(source, i) !== -1) {
      const end = regexEnd(source, i);
      blank(i, end);
      i = end;
      regexAllowed = false;
    } else if (/[\w$]/.test(ch)) {
      let j = i;
      while (j < n && /[\w$]/.test(source[j])) {
        j++;
      }
      regexAllowed = REGEX_AFTER_WORDS.has(source.slice(i, j));
      i = j;
    } else {
      if (ch === "{" && frame.kind === "expr") {
        frame.depth++;
      } else if (ch === "}" && frame.kind === "expr") {
        if (frame.depth === 0) {
          frames.pop();
        } else {
          frame.depth--;
        }
      }
      if (ch === ")" || ch === "]") {
        regexAllowed = false;
      } else if (!/\s/.test(ch)) {
        regexAllowed = true;
      }
      i++;
    }
  }
  return chars.join("");
}

// Every module specifier the code names: static, side-effect, dynamic and require forms. The patterns run on the
// blanked code, so text inside literals and comments is never read as an import. The specifier text is read from
// the original source at the offset the d flag reports.
function specifiersOf(source) {
  const code = blankNonCode(source);
  const found = [];
  for (const pattern of [STATIC_IMPORT, SIDE_EFFECT_IMPORT, DYNAMIC_IMPORT, REQUIRE_CALL]) {
    for (const match of code.matchAll(pattern)) {
      const [start, end] = match.indices[1];
      found.push(source.slice(start, end));
    }
  }
  return found;
}

function isRelative(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

// Resolves a relative specifier to a root-relative .ts module, or null. Non-code assets are skipped by the caller.
function resolveRelative(root, fromModule, specifier) {
  const base = posix.join(posix.dirname(fromModule), specifier);
  const candidates = [];
  if (base.endsWith(".js")) {
    candidates.push(`${base.slice(0, -3)}.ts`);
  }
  if (base.endsWith(".ts")) {
    candidates.push(base);
  }
  candidates.push(`${base}.ts`, `${base}/index.ts`);
  return (
    candidates.find((candidate) => !candidate.startsWith("../") && isFile(join(root, candidate))) ?? null
  );
}

function isCodeSpecifier(specifier) {
  const extension = posix.extname(specifier);
  return extension === "" || extension === ".js" || extension === ".ts";
}

// Walks relative imports from the entries. Returns the closure as a Map from root-relative module path to
// { parent, specifiers }, where parent is the module that first reached it (null for an entry), so each
// module has a shortest import chain. Relative specifiers that resolve to no .ts module are listed in unresolved.
export function gateClosure({ root = DEFAULT_ROOT, entries = GATE_ENTRIES } = {}) {
  const modules = new Map();
  const unresolved = [];
  const pending = [];
  for (const entry of entries) {
    if (!isFile(join(root, entry))) {
      throw new Error(`gate entry is missing: ${entry}`);
    }
    pending.push({ module: entry, parent: null });
  }
  while (pending.length > 0) {
    const { module, parent } = pending.shift();
    if (modules.has(module)) {
      continue;
    }
    const specifiers = specifiersOf(readFileSync(join(root, module), "utf8"));
    modules.set(module, { parent, specifiers });
    for (const specifier of specifiers) {
      if (!isRelative(specifier) || !isCodeSpecifier(specifier)) {
        continue;
      }
      const target = resolveRelative(root, module, specifier);
      if (target === null) {
        unresolved.push({ from: module, specifier });
      } else if (!modules.has(target)) {
        pending.push({ module: target, parent: module });
      }
    }
  }
  return { modules, unresolved };
}

// The shortest import chain from an entry to the module, entry first.
export function importChain(modules, module) {
  const chain = [];
  for (let at = module; at !== null && at !== undefined; at = modules.get(at)?.parent ?? null) {
    chain.unshift(at);
  }
  return chain;
}

// Violations in the closure: a module that names child_process, a module that is forbidden, and a relative
// import that resolves to no code module (fail closed). Each carries the chain that reaches it.
export function gateViolations({ root = DEFAULT_ROOT, entries = GATE_ENTRIES, forbidden = FORBIDDEN_MODULES } = {}) {
  const { modules, unresolved } = gateClosure({ root, entries });
  const violations = [];
  for (const [module, { specifiers }] of modules) {
    const chain = importChain(modules, module);
    for (const specifier of specifiers) {
      if (CHILD_PROCESS.has(specifier)) {
        violations.push({ module, chain, reason: `imports ${specifier}` });
      }
    }
    if (forbidden.includes(module)) {
      violations.push({ module, chain, reason: "is a module the exec gate must not reach" });
    }
  }
  for (const { from, specifier } of unresolved) {
    violations.push({ module: from, chain: importChain(modules, from), reason: `has an unresolved relative import ${specifier}` });
  }
  return violations;
}

export function formatViolation(violation) {
  return `${violation.chain.join(" -> ")}: ${violation.reason}`;
}

function main() {
  const { modules } = gateClosure();
  const violations = gateViolations();
  if (violations.length === 0) {
    console.log(`gate closure: ${String(modules.size)} modules, no violations`);
    return 0;
  }
  for (const violation of violations) {
    console.error(`gate closure: ${formatViolation(violation)}`);
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
