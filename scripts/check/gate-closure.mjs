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

const STATIC_IMPORT = /\b(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT = /\bimport\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const REQUIRE_CALL = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'\\])\/\/[^\n]*/gm, "$1");
}

// Every module specifier the source names: static, side-effect, dynamic and require forms.
function specifiersOf(source) {
  const text = stripComments(source);
  const found = [];
  for (const pattern of [STATIC_IMPORT, SIDE_EFFECT_IMPORT, DYNAMIC_IMPORT, REQUIRE_CALL]) {
    for (const match of text.matchAll(pattern)) {
      found.push(match[1]);
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
