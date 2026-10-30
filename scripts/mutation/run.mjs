import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// QR-08 fallback (D-1308). Stryker is not installed: research recorded a 188-package
// tree and an unproven fit with node:test on compiled output. This script mutates
// TypeScript sources one at a time, compiles with the repo tsc, and runs the tests
// that cover that file. A survivor is a report row, never a process failure.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const MAX_MUTANTS = 12;
export const DEFAULT_TIMEOUT_MS = 180_000;

const RELATIONAL = [
  ["<=", ">="],
  [">=", "<="],
  ["<", ">"],
  [">", "<"],
];

/**
 * @param {string} source
 * @returns {string}
 */
export function maskNonCode(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const pair = source.slice(i, i + 2);
    if (pair === "//") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (pair === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += blankKeepNewlines(source.slice(i, stop));
      i = stop;
      continue;
    }
    const ch = source[i];
    if (ch === "'" || ch === '"') {
      const stop = skipQuoted(source, i, ch);
      out += blankKeepNewlines(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === "`") {
      const stop = skipTemplate(source, i);
      out += blankKeepNewlines(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === "/" && isRegexStart(source, i)) {
      const stop = skipRegex(source, i);
      if (stop > i + 1) {
        out += blankKeepNewlines(source.slice(i, stop));
        i = stop;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * @param {string} source
 * @returns {{ start: number, end: number, replacement: string, description: string }[]}
 */
export function findMutations(source) {
  const masked = maskNonCode(source);
  /** @type {{ start: number, end: number, replacement: string, description: string }[]} */
  const sites = [];

  for (const match of masked.matchAll(/\b(true|false)\b/g)) {
    const word = match[1];
    if (word === undefined || match.index === undefined) {
      continue;
    }
    const replacement = word === "true" ? "false" : "true";
    sites.push({
      start: match.index,
      end: match.index + word.length,
      replacement,
      description: `boolean flip ${word} -> ${replacement} at line ${lineOf(source, match.index)}`,
    });
  }

  for (const match of masked.matchAll(/(<=|>=|(?<![=<])<(?![=<])|(?<![=-])>(?![=]))/g)) {
    const op = match[1];
    if (op === undefined || match.index === undefined) {
      continue;
    }
    if (!hasSpaceBeside(masked, match.index, op.length)) {
      continue;
    }
    const flipped = RELATIONAL.find(([from]) => from === op)?.[1];
    if (flipped === undefined) {
      continue;
    }
    sites.push({
      start: match.index,
      end: match.index + op.length,
      replacement: flipped,
      description: `relational operator flip ${op} -> ${flipped} at line ${lineOf(source, match.index)}`,
    });
  }

  for (const match of masked.matchAll(/(?:<=|>=|<(?!=)|(?<![=-])>)\s+(-?\d+)\b|\b(-?\d+)\s+(?:<=|>=|<(?!=)|(?<![=-])>)/g)) {
    const digits = match[1] ?? match[2];
    if (digits === undefined || match.index === undefined) {
      continue;
    }
    const numberStart = match.index + match[0].indexOf(digits);
    const next = String(Number(digits) + 1);
    sites.push({
      start: numberStart,
      end: numberStart + digits.length,
      replacement: next,
      description: `numeric boundary off-by-one ${digits} -> ${next} at line ${lineOf(source, numberStart)}`,
    });
  }

  sites.sort((left, right) => left.start - right.start || left.description.localeCompare(right.description));
  return sites;
}

/**
 * @param {string} file
 * @returns {string[]}
 */
export function compiledTestFiles(dir, names) {
  return names.filter((name) => name.endsWith(".test.js")).sort().map((name) => join(dir, name));
}

export function testsFor(file, listDir = defaultListDir) {
  if (file.startsWith("src/fs/")) {
    return compiledTestFiles("dist/test/fs", listDir("dist/test/fs"));
  }
  if (file === "src/core/policy.ts") {
    return [
      "dist/test/core/policy.test.js",
      "dist/test/core/policy.property.test.js",
      "dist/test/core/policy.schema.test.js",
    ];
  }
  if (file === "src/audit/redact.ts") {
    return ["dist/test/audit/redaction.test.js"];
  }
  const base = file.replace(/^src\//, "").replace(/\.ts$/, "");
  return [`dist/test/${base}.test.js`];
}

function defaultListDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * @param {{ file: string, source: string }[]} files
 * @param {number} cap
 */
export function selectMutants(files, cap) {
  const limit = Math.min(cap, MAX_MUTANTS);
  /** @type {Map<string, { file: string, start: number, end: number, replacement: string, description: string }[]>} */
  const groups = new Map([
    ["policy", []],
    ["redact", []],
    ["fs", []],
    ["other", []],
  ]);
  const byGroup = new Map([
    ["policy", []],
    ["redact", []],
    ["fs", []],
    ["other", []],
  ]);
  for (const entry of files) {
    const group = groupOf(entry.file);
    byGroup.get(group)?.push({ file: entry.file, sites: findMutations(entry.source) });
  }
  for (const [group, members] of byGroup) {
    groups.set(group, interleave(members));
  }
  /** @type {{ file: string, start: number, end: number, replacement: string, description: string }[]} */
  const selected = [];
  const order = ["policy", "redact", "fs", "other"];
  let index = 0;
  while (selected.length < limit) {
    let progressed = false;
    for (const group of order) {
      const site = groups.get(group)?.[index];
      if (site === undefined) {
        continue;
      }
      selected.push(site);
      progressed = true;
      if (selected.length >= limit) {
        break;
      }
    }
    if (!progressed) {
      break;
    }
    index += 1;
  }
  return selected;
}

/**
 * @param {{
 *   root?: string,
 *   reportPath?: string,
 *   cap?: number,
 *   timeoutMs?: number,
 *   files?: string[],
 * }} [options]
 */
export async function runCampaign(options = {}) {
  const root = resolve(options.root ?? REPO_ROOT);
  const cap = Math.min(options.cap ?? MAX_MUTANTS, MAX_MUTANTS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const reportPath = resolve(options.reportPath ?? join(root, "mutation-report.json"));
  /** @type {{ file: string, status: "killed" | "survived" | "timedOut" | "untested", description: string }[]} */
  const mutants = [];

  try {
    const targets = await listTargets(root, options.files);
    const loaded = [];
    for (const file of targets) {
      loaded.push({ file, source: await readFile(join(root, file), "utf8") });
    }
    const selected = selectMutants(loaded, cap);
    if (selected.length > 0) {
      const sandbox = await mkdtemp(join(tmpdir(), "realm-mutation-"));
      try {
        await prepareSandbox(root, sandbox);
        /** @type {Map<string, string>} */
        const originals = new Map();
        for (const mutant of selected) {
          const absolute = join(sandbox, mutant.file);
          if (!originals.has(mutant.file)) {
            originals.set(mutant.file, await readFile(absolute, "utf8"));
          }
          const original = originals.get(mutant.file);
          if (original === undefined) {
            continue;
          }
          const applied = original.slice(0, mutant.start) + mutant.replacement + original.slice(mutant.end);
          await writeFile(absolute, applied);
          let status = /** @type {"killed" | "survived" | "timedOut" | "untested"} */ ("killed");
          try {
            const compiled = await runLimited(
              process.execPath,
              ["node_modules/typescript/lib/tsc.js", "-p", "tsconfig.json", "--incremental", "--tsBuildInfoFile", ".mutation.tsbuildinfo"],
              sandbox,
              timeoutMs,
            );
            if (compiled.timedOut) {
              status = "timedOut";
            } else if (compiled.code === 0) {
              const tests = testsFor(mutant.file);
              if (tests.length === 0) {
                status = "untested";
              } else {
                const tested = await runLimited(process.execPath, ["--test", ...tests], sandbox, timeoutMs);
                if (tested.timedOut) {
                  status = "timedOut";
                } else if (tested.code === 0) {
                  status = "survived";
                }
              }
            }
          } finally {
            await writeFile(absolute, original);
          }
          mutants.push({ file: mutant.file, status, description: mutant.description });
        }
      } finally {
        await rm(sandbox, { recursive: true, force: true });
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown failure";
    mutants.push({
      file: "(run)",
      status: "killed",
      description: `mutation run stopped: ${reason}`,
    });
  }

  const report = {
    killed: mutants.filter((row) => row.status === "killed").length,
    survived: mutants.filter((row) => row.status === "survived").length,
    timedOut: mutants.filter((row) => row.status === "timedOut").length,
    untested: mutants.filter((row) => row.status === "untested").length,
    mutants,
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ root?: string, reportPath?: string, cap?: number, timeoutMs?: number }} */
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--root" && next !== undefined) {
      options.root = next;
      i += 1;
    } else if (arg === "--report" && next !== undefined) {
      options.reportPath = next;
      i += 1;
    } else if (arg === "--cap" && next !== undefined) {
      options.cap = Number(next);
      i += 1;
    } else if (arg === "--timeout-ms" && next !== undefined) {
      options.timeoutMs = Number(next);
      i += 1;
    }
  }
  return options;
}

async function main() {
  const report = await runCampaign(parseArgs(process.argv.slice(2)));
  console.log(
    `mutation: killed=${report.killed} survived=${report.survived} timedOut=${report.timedOut} cap=${MAX_MUTANTS}`,
  );
  process.exitCode = 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const reason = error instanceof Error ? error.message : "unknown failure";
    console.error(`mutation: ${reason}`);
    process.exitCode = 0;
  });
}

/**
 * @param {string} text
 */
function blankKeepNewlines(text) {
  return text.replace(/[^\n]/g, " ");
}

/**
 * @param {string} source
 * @param {number} start
 * @param {string} quote
 */
function skipQuoted(source, start, quote) {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === quote) {
      return i + 1;
    }
    if (source[i] === "\n") {
      return i;
    }
    i += 1;
  }
  return source.length;
}

/**
 * @param {string} source
 * @param {number} start
 */
function skipTemplate(source, start) {
  let i = start + 1;
  let depth = 0;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === "`" && depth === 0) {
      return i + 1;
    }
    if (source.slice(i, i + 2) === "${") {
      depth += 1;
      i += 2;
      continue;
    }
    if (source[i] === "}" && depth > 0) {
      depth -= 1;
    }
    i += 1;
  }
  return source.length;
}

/**
 * @param {string} source
 * @param {number} index
 */
function isRegexStart(source, index) {
  let j = index - 1;
  while (j >= 0 && (source[j] === " " || source[j] === "\t")) {
    j -= 1;
  }
  if (j < 0) {
    return true;
  }
  const prev = source[j];
  if (prev !== undefined && "(,[=:!&|?{};~^".includes(prev)) {
    return true;
  }
  return /(?:return|else|typeof|case)$/.test(source.slice(0, j + 1));
}

/**
 * @param {string} source
 * @param {number} start
 */
function skipRegex(source, start) {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "\n") {
      return start + 1;
    }
    if (ch === "[" && !inClass) {
      inClass = true;
      i += 1;
      continue;
    }
    if (ch === "]" && inClass) {
      inClass = false;
      i += 1;
      continue;
    }
    if (ch === "/" && !inClass) {
      i += 1;
      while (i < source.length && /[a-z]/i.test(source[i] ?? "")) {
        i += 1;
      }
      return i;
    }
    i += 1;
  }
  return start + 1;
}

/**
 * @param {string} source
 * @param {number} index
 */
function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

/**
 * @param {string} masked
 * @param {number} index
 * @param {number} length
 */
function hasSpaceBeside(masked, index, length) {
  const before = masked[index - 1] ?? " ";
  const after = masked[index + length] ?? " ";
  return before === " " || before === "\n" || after === " " || after === "\n" || after === "\r";
}

/**
 * @param {string} file
 */
function groupOf(file) {
  if (file === "src/core/policy.ts") {
    return "policy";
  }
  if (file === "src/audit/redact.ts") {
    return "redact";
  }
  if (file.startsWith("src/fs/")) {
    return "fs";
  }
  return "other";
}

/**
 * @param {{ file: string, sites: { start: number, end: number, replacement: string, description: string }[] }[]} members
 */
function interleave(members) {
  /** @type {{ file: string, start: number, end: number, replacement: string, description: string }[]} */
  const ordered = [];
  let index = 0;
  while (true) {
    let progressed = false;
    for (const member of members) {
      const site = member.sites[index];
      if (site === undefined) {
        continue;
      }
      ordered.push({ file: member.file, ...site });
      progressed = true;
    }
    if (!progressed) {
      return ordered;
    }
    index += 1;
  }
}

/**
 * @param {string} root
 * @param {string[] | undefined} files
 */
async function listTargets(root, files) {
  if (files !== undefined) {
    return files;
  }
  const fsFiles = (await walkTs(join(root, "src", "fs"))).map((absolute) => relative(root, absolute));
  return ["src/core/policy.ts", "src/audit/redact.ts", ...fsFiles.sort()];
}

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function walkTs(dir) {
  /** @type {string[]} */
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return found;
    }
    throw error;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walkTs(path)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      found.push(path);
    }
  }
  return found;
}

/**
 * @param {string} root
 * @param {string} sandbox
 */
async function prepareSandbox(root, sandbox) {
  await cp(join(root, "src"), join(sandbox, "src"), { recursive: true });
  await cp(join(root, "test"), join(sandbox, "test"), { recursive: true });
  await cp(join(root, "tsconfig.json"), join(sandbox, "tsconfig.json"));
  await cp(join(root, "package.json"), join(sandbox, "package.json"));
  await symlink(join(root, "node_modules"), join(sandbox, "node_modules"));
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @param {number} timeoutMs
 */
function runLimited(command, args, cwd, timeoutMs) {
  return new Promise((resolvePromise) => {
    const env = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined || key.startsWith("NODE_TEST_")) {
        continue;
      }
      env[key] = value;
    }
    const child = spawn(command, args, { cwd, env, detached: true, stdio: "ignore" });
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    const timer = setTimeout(() => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
      finish({ code: null, timedOut: true });
    }, timeoutMs);
    child.on("error", () => {
      finish({ code: 1, timedOut: false });
    });
    child.on("close", (code) => {
      finish({ code: code ?? 1, timedOut: false });
    });
  });
}
