// Per-directory coverage ratchet (QR-04, decision D-1304).
//
// Runs the compiled test suite under the Node test runner's coverage support with the lcov reporter, sums lines, branches and
// functions per source directory (src/fs, src/core, src/tools, read from the floors file), compares each sum with the floors in
// scripts/check/coverage-floors.json and checks the current sources (src/<dir>/**/*.ts) against the report: a source whose
// compiled file exists but has no lcov record is listed as unloaded (a file nobody imports is absent from the lcov report, so
// the totals alone overstate coverage), a source without a compiled file is listed as not built (run tsc first), a type-only
// module with no runtime code is counted separately, and compiled files whose source is gone (stale output) are ignored and
// counted. Node's own --test-coverage-* thresholds are global, which is why this script exists.
//
// While the floors file says "reportOnly": true (or --report-only is passed) the table and the findings are printed and the
// exit code stays 0. Run `npm run test:coverage` (it compiles first; this script does not build).
//
// Usage: coverage.mjs [--lcov <file>] [--floors <file>] [--report-only] [--write]
//   --lcov <file>    evaluate an existing lcov file instead of running the suite
//   --floors <file>  floors file (default: coverage-floors.json beside this script)
//   --report-only    never fail on a floor or an unloaded file, even if the floors file says reportOnly: false
//   --write          raise the floors file to the measured numbers (floor(actual) - tolerance, never lower than the current floor)
//
// Node writes the lcov file even when a test fails, so a failed suite still gets its table printed; the suite's non-zero exit
// code then wins over every coverage verdict. Without an lcov file the suite's code is returned alone.
//
// Exit codes: the suite's own non-zero code first; otherwise 0 ok or report-only, 1 below a floor, an unloaded file or a source
// that is not built, 2 usage or configuration error (usage and floors-file errors are reported before the suite runs).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_FLOORS = join(SCRIPT_DIR, "coverage-floors.json");
const LCOV_RELATIVE = join("coverage", "lcov.info");
const USAGE = "usage: coverage.mjs [--lcov <file>] [--floors <file>] [--report-only] [--write]";

export const METRICS = ["lines", "branches", "functions"];

export const SUITE_FLAGS = [
  "--test",
  "--experimental-test-coverage",
  // Source maps would report coverage against src/**/*.ts, outside the dist/src/** include filter.
  "--no-enable-source-maps",
  "--test-coverage-include=dist/src/**",
  "--test-reporter=spec",
  "--test-reporter-destination=stdout",
  "--test-reporter=lcov",
  `--test-reporter-destination=${LCOV_RELATIVE.replaceAll("\\", "/")}`,
  // One argument: Node expands the pattern itself, so no shell is involved.
  "dist/test/**/*.test.js",
];

// lcov summary keys and the metric/field each one feeds.
const SUMMARY_KEYS = {
  LF: ["lines", "found"],
  LH: ["lines", "hit"],
  BRF: ["branches", "found"],
  BRH: ["branches", "hit"],
  FNF: ["functions", "found"],
  FNH: ["functions", "hit"],
};

function emptyTotals() {
  return {
    lines: { found: 0, hit: 0 },
    branches: { found: 0, hit: 0 },
    functions: { found: 0, hit: 0 },
    files: [],
  };
}

// "dist/src/..." suffix of a path, "/"-normalized, or null when the path has no dist/src/ segment.
function distRelative(path) {
  const match = /(?:^|\/)(dist\/src\/.*)$/.exec(path.replaceAll("\\", "/"));
  return match === null ? null : match[1];
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The compiled path "dist/src/<dir>/x.js" for a path in either form: a compiled one (dist/src/<dir>/x.js, after any prefix) or
// a source one (src/<dir>/x.ts, after any prefix; .d.ts files have no compiled twin). Null for anything else.
function toDistPath(path, directories) {
  const normalized = path.replaceAll("\\", "/");
  const compiled = distRelative(normalized);
  if (compiled !== null || normalized.endsWith(".d.ts")) {
    return compiled;
  }
  for (const directory of directories) {
    const match = new RegExp(`(?:^|/)(${escapeRegExp(directory)}/.+)\\.ts$`).exec(normalized);
    if (match !== null) {
      return `dist/${match[1]}.js`;
    }
  }
  return null;
}

function belongsTo(relative, directory) {
  return relative !== null && relative.startsWith(`dist/${directory}/`);
}

// Sums an lcov text per directory. A record belongs to a directory when its SF path holds dist/src/<dir>/ after any prefix;
// records outside every directory are ignored. Every requested directory has an entry, even without a record.
export function aggregateLcov(text, directories) {
  const totals = {};
  for (const directory of directories) {
    totals[directory] = emptyTotals();
  }
  let current = null;
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").trim();
    if (line === "") {
      continue;
    }
    const separator = line.indexOf(":");
    const key = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1);
    if (key === "SF") {
      if (current !== null) {
        throw new Error(`lcov line ${index + 1}: SF record starts before the previous record ended`);
      }
      current = { path: value.replaceAll("\\", "/"), counts: {} };
    } else if (key === "end_of_record") {
      if (current === null) {
        throw new Error(`lcov line ${index + 1}: end_of_record without an SF record`);
      }
      const relative = toDistPath(current.path, directories);
      const directory = directories.find((candidate) => belongsTo(relative, candidate));
      if (directory !== undefined) {
        const entry = totals[directory];
        for (const [summaryKey, [metric, field]] of Object.entries(SUMMARY_KEYS)) {
          entry[metric][field] += current.counts[summaryKey] ?? 0;
        }
        entry.files.push(current.path);
      }
      current = null;
    } else if (key in SUMMARY_KEYS) {
      if (current === null) {
        throw new Error(`lcov line ${index + 1}: ${key} outside an SF record`);
      }
      if (!/^\d+$/.test(value)) {
        throw new Error(`lcov line ${index + 1}: ${key} needs a non-negative integer, got ${JSON.stringify(value)}`);
      }
      current.counts[key] = Number(value);
    }
    // TN, FN, FNDA, BRDA, DA and anything else carry nothing the summary keys do not.
  }
  if (current !== null) {
    throw new Error(`lcov ends inside the record for ${current.path} (no end_of_record)`);
  }
  return totals;
}

// hit / found as a percentage; a metric with nothing to measure counts as 100.
export function percent({ found, hit }) {
  return found === 0 ? 100 : (hit / found) * 100;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Throws a plain Error naming the offending field when the parsed floors file has the wrong shape.
export function validateConfig(config) {
  if (!isPlainObject(config)) {
    throw new Error("floors file: top level must be an object");
  }
  if (typeof config.gateNode !== "string" || config.gateNode === "") {
    throw new Error('floors file: "gateNode" must be a non-empty string');
  }
  if (typeof config.tolerance !== "number" || !Number.isFinite(config.tolerance) || config.tolerance < 0) {
    throw new Error('floors file: "tolerance" must be a number >= 0');
  }
  if (typeof config.reportOnly !== "boolean") {
    throw new Error('floors file: "reportOnly" must be true or false');
  }
  if (!isPlainObject(config.floors)) {
    throw new Error('floors file: "floors" must be an object');
  }
  const directories = Object.keys(config.floors);
  if (directories.length === 0) {
    throw new Error('floors file: "floors" must list at least one directory');
  }
  for (const directory of directories) {
    if (!/^src(\/[\w.-]+)+$/.test(directory)) {
      throw new Error(`floors file: directory key ${JSON.stringify(directory)} must look like "src/<name>"`);
    }
    const floor = config.floors[directory];
    if (!isPlainObject(floor)) {
      throw new Error(`floors file: floors["${directory}"] must be an object`);
    }
    for (const metric of METRICS) {
      const value = floor[metric];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error(`floors file: floors["${directory}"].${metric} must be a number from 0 to 100`);
      }
    }
  }
}

// One row per directory and metric, in the floors file's order. status: "ok", "below", or "report" (below a floor while
// reportOnly is true). ok is false only for a "below" row, which cannot exist while reportOnly is true.
export function compareToFloors(totals, config) {
  validateConfig(config);
  const rows = [];
  for (const [directory, floor] of Object.entries(config.floors)) {
    const entry = totals[directory];
    if (entry === undefined) {
      throw new Error(`no coverage totals for ${directory}`);
    }
    for (const metric of METRICS) {
      const actual = percent(entry[metric]);
      const metricFloor = floor[metric];
      let status = "ok";
      if (actual < metricFloor) {
        status = config.reportOnly ? "report" : "below";
      }
      rows.push({ directory, metric, actual, floor: metricFloor, status });
    }
  }
  return { ok: rows.every((row) => row.status !== "below"), rows };
}

// True when the compiled JavaScript has no statements: after removing block comments, line comments (which include the
// sourceMappingURL comment) and whitespace, nothing is left or only `export {};`. Such a module (a types-only source file)
// can never be loaded by a test in a way that produces an lcov record.
export function isTypeOnlyModule(source) {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/\s+/g, "");
  return code === "" || code === "export{};";
}

// Decides which files the report should have covered, from the CURRENT sources (src/<dir>/**/*.ts). lcovFiles are SF paths,
// sourceFiles the current sources and distFiles the compiled files on disk; every path may carry a prefix and is compared by
// its src/... or dist/src/... suffix. Returns, with "/"-normalized paths, sorted per directory:
//   unrecorded: compiled files of a current source that exist on disk but have no lcov record (dist/src/... paths);
//   notBuilt:   current sources (src/...ts paths) that have neither a lcov record nor a compiled file;
//   stale:      compiled files under a directory whose source no longer exists (ignored; not part of the checks).
export function classifyFiles(lcovFiles, sourceFiles, distFiles, directories) {
  const loaded = new Set();
  for (const file of lcovFiles) {
    const relative = toDistPath(file, directories);
    if (relative !== null) {
      loaded.add(relative);
    }
  }
  const built = new Set();
  for (const file of distFiles) {
    const relative = distRelative(file);
    if (relative !== null) {
      built.add(relative);
    }
  }
  const unrecorded = {};
  const notBuilt = {};
  for (const directory of directories) {
    unrecorded[directory] = [];
    notBuilt[directory] = [];
  }
  const expected = new Set();
  for (const file of sourceFiles) {
    const relative = toDistPath(file, directories);
    const directory = directories.find((candidate) => belongsTo(relative, candidate));
    if (directory === undefined || expected.has(relative)) {
      continue;
    }
    expected.add(relative);
    if (loaded.has(relative)) {
      continue;
    }
    if (built.has(relative)) {
      unrecorded[directory].push(relative);
    } else {
      notBuilt[directory].push(`${relative.slice("dist/".length, -".js".length)}.ts`);
    }
  }
  for (const directory of directories) {
    unrecorded[directory].sort();
    notBuilt[directory].sort();
  }
  const stale = [...built]
    .filter((relative) => !expected.has(relative) && directories.some((directory) => belongsTo(relative, directory)))
    .sort();
  return { unrecorded, notBuilt, stale };
}

// The config with each floor raised to max(current floor, floor(actual) - tolerance). Never lowers. A metric with nothing to
// measure (found 0) is left alone, so an empty or unbuilt directory cannot set a floor. Does not modify its arguments.
export function raiseFloors(config, totals) {
  validateConfig(config);
  const floors = {};
  for (const [directory, floor] of Object.entries(config.floors)) {
    const entry = totals[directory];
    if (entry === undefined) {
      throw new Error(`no coverage totals for ${directory}`);
    }
    floors[directory] = {};
    for (const metric of METRICS) {
      const candidate = entry[metric].found === 0 ? 0 : Math.floor(percent(entry[metric])) - config.tolerance;
      floors[directory][metric] = Math.max(floor[metric], candidate);
    }
  }
  return { ...config, floors };
}

function parseArgs(argv) {
  const options = { lcov: undefined, floors: undefined, reportOnly: false, write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--report-only" || flag === "--write") {
      const key = flag === "--write" ? "write" : "reportOnly";
      if (options[key]) {
        throw new Error(`${flag} given more than once; ${USAGE}`);
      }
      options[key] = true;
    } else if (flag === "--lcov" || flag === "--floors") {
      const key = flag === "--lcov" ? "lcov" : "floors";
      const value = argv[index + 1];
      if (value === undefined || value === "" || value.startsWith("--")) {
        throw new Error(`${flag} needs a value; ${USAGE}`);
      }
      if (options[key] !== undefined) {
        throw new Error(`${flag} given more than once; ${USAGE}`);
      }
      options[key] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument ${JSON.stringify(flag)}; ${USAGE}`);
    }
  }
  return options;
}

// Runs the compiled suite under coverage in the root and returns its exit code. The spec output goes to the terminal; the lcov
// report lands in <root>/coverage/lcov.info.
function defaultRunSuite(root) {
  mkdirSync(join(root, "coverage"), { recursive: true });
  // A report left by an earlier run must not pass for this run's report when the suite dies before writing one.
  rmSync(join(root, LCOV_RELATIVE), { force: true });
  const result = spawnSync(process.execPath, SUITE_FLAGS, {
    cwd: root,
    // The suite flags carry --no-enable-source-maps; a command-line option overrides NODE_OPTIONS (checked on Node 22 and 24),
    // so the environment is passed through untouched.
    stdio: "inherit",
  });
  if (result.error !== undefined) {
    throw new Error(`could not start the test suite: ${result.error.message}`, { cause: result.error });
  }
  return result.status ?? 1;
}

// Files under <base>/<relativeDir> (recursive) whose name satisfies the predicate, as "/"-joined paths relative to base.
function listFiles(base, relativeDir, accepts) {
  const absolute = join(base, relativeDir);
  if (!existsSync(absolute)) {
    return [];
  }
  const found = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const relative = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...listFiles(base, relative, accepts));
    } else if (accepts(entry.name)) {
      found.push(relative);
    }
  }
  return found;
}

// Current TypeScript sources (not .d.ts) under <root>/<dir> for each directory, as "src/..." paths.
function defaultListSourceFiles(root, directories) {
  return directories.flatMap((directory) =>
    listFiles(root, directory, (name) => name.endsWith(".ts") && !name.endsWith(".d.ts")),
  );
}

// Compiled .js files under <root>/dist/<dir> for each directory, as "dist/src/..." paths.
function defaultListDistFiles(root, directories) {
  return directories.flatMap((directory) => listFiles(root, `dist/${directory}`, (name) => name.endsWith(".js")));
}

function formatTable(rows) {
  const header = ["directory", "metric", "actual%", "floor%", "status"];
  const body = rows.map((row) => [
    row.directory,
    row.metric,
    row.actual.toFixed(2),
    row.floor.toFixed(2),
    row.status,
  ]);
  const widths = header.map((title, column) => Math.max(title.length, ...body.map((cells) => cells[column].length)));
  const render = (cells) =>
    cells
      .map((cell, column) => (column >= 2 && column <= 3 ? cell.padStart(widths[column]) : cell.padEnd(widths[column])))
      .join("  ")
      .trimEnd();
  return [render(header), ...body.map(render)];
}

// Evaluates coverage and returns { code, output }; never exits the process. overrides: runSuite(root) -> exit code (sync or
// async), listSourceFiles(root, directories) -> current source paths (src/<dir>/**/*.ts), listDistFiles(root, directories) ->
// compiled file paths (dist/src/<dir>/**/*.js), readFile(absolutePath) -> source text (sync or async), root (the repository
// root: where the suite runs, src/, dist/ and coverage/lcov.info live). File lists may be relative to root or absolute.
export async function runCheck(argv, overrides = {}) {
  const root = overrides.root ?? ROOT;
  const runSuite = overrides.runSuite ?? defaultRunSuite;
  const listSourceFiles = overrides.listSourceFiles ?? defaultListSourceFiles;
  const listDistFiles = overrides.listDistFiles ?? defaultListDistFiles;
  const readFile = overrides.readFile ?? ((path) => readFileSync(path, "utf8"));
  const out = [];
  const finish = (code) => ({ code, output: `${out.join("\n")}\n` });

  // Usage, floors file and lcov problems are exit code 2; anything else (a crash in the suite runner) propagates.
  let options;
  let config;
  let floorsPath;
  try {
    options = parseArgs(argv);
    floorsPath = resolve(options.floors ?? DEFAULT_FLOORS);
    try {
      config = JSON.parse(readFileSync(floorsPath, "utf8"));
    } catch (error) {
      throw new Error(`cannot read floors file ${options.floors ?? "coverage-floors.json"}: ${error.message}`, { cause: error });
    }
    validateConfig(config);
  } catch (error) {
    out.push(`coverage: ${error.message}`);
    return finish(2);
  }
  const directories = Object.keys(config.floors);
  const reportOnly = options.reportOnly || config.reportOnly;

  let suiteCode = 0;
  let lcovPath = options.lcov === undefined ? undefined : resolve(options.lcov);
  if (lcovPath === undefined) {
    out.push(`running the suite on node ${process.version}: node ${SUITE_FLAGS.join(" ")}`);
    suiteCode = await runSuite(root);
    lcovPath = join(root, LCOV_RELATIVE);
    // Node writes the lcov file even when a test fails, so a failed run still yields numbers when the file exists.
    if (suiteCode !== 0 && !existsSync(lcovPath)) {
      out.push(`test suite failed with exit code ${suiteCode} and wrote no lcov report; coverage was not compared`);
      return finish(suiteCode);
    }
  }

  let totals;
  try {
    let text;
    try {
      text = readFileSync(lcovPath, "utf8");
    } catch (error) {
      throw new Error(`cannot read lcov file ${options.lcov ?? LCOV_RELATIVE}: ${error.message}`, { cause: error });
    }
    totals = aggregateLcov(text, directories);
  } catch (error) {
    out.push(`coverage: ${error.message}`);
    return finish(suiteCode !== 0 ? suiteCode : 2);
  }

  const { rows } = compareToFloors(totals, { ...config, reportOnly });
  const lcovFiles = directories.flatMap((directory) => totals[directory].files);
  // The current sources decide which files are expected; compiled output without a source is stale and ignored.
  const plan = classifyFiles(
    lcovFiles,
    await listSourceFiles(root, directories),
    await listDistFiles(root, directories),
    directories,
  );
  // A module whose compiled JavaScript has no statements (types and interfaces only) can never have an lcov record.
  const unloaded = {};
  let typeOnlyCount = 0;
  for (const directory of directories) {
    unloaded[directory] = [];
    for (const file of plan.unrecorded[directory]) {
      if (isTypeOnlyModule(await readFile(resolve(root, file)))) {
        typeOnlyCount += 1;
      } else {
        unloaded[directory].push(file);
      }
    }
  }

  out.push(
    `coverage on node ${process.version} (gate leg ${config.gateNode}), floors ${reportOnly ? "report-only" : "enforced"}`,
  );
  out.push(...formatTable(rows));
  for (const directory of directories) {
    if (totals[directory].files.length === 0) {
      out.push(`no lcov records for ${directory}`);
    }
  }
  if (typeOnlyCount > 0) {
    out.push(`type-only modules without runtime code: ${typeOnlyCount}`);
  }
  if (plan.stale.length > 0) {
    out.push(`stale compiled files ignored: ${plan.stale.length}`);
  }
  const notBuiltFiles = directories.flatMap((directory) => plan.notBuilt[directory]);
  if (notBuiltFiles.length > 0) {
    out.push(`not built (run tsc first): ${notBuiltFiles.length}`);
    for (const directory of directories) {
      for (const file of plan.notBuilt[directory]) {
        out.push(`  ${directory}: ${file}`);
      }
    }
  }
  const unloadedFiles = directories.flatMap((directory) => unloaded[directory]);
  if (unloadedFiles.length > 0) {
    out.push("unloaded (no test imports these; absent from the lcov report):");
    for (const directory of directories) {
      for (const file of unloaded[directory]) {
        out.push(`  ${directory}: ${file}`);
      }
    }
  }

  if (options.write) {
    if (suiteCode !== 0) {
      out.push("floors not written: the suite failed in this run");
    } else {
      const raised = raiseFloors(config, totals);
      const changes = [];
      for (const directory of directories) {
        for (const metric of METRICS) {
          const before = config.floors[directory][metric];
          const after = raised.floors[directory][metric];
          if (after !== before) {
            changes.push(`  ${directory} ${metric}: ${before} -> ${after}`);
          }
        }
      }
      writeFileSync(floorsPath, `${JSON.stringify(raised, null, 2)}\n`);
      out.push(changes.length === 0 ? "floors unchanged (nothing rose)" : "floors raised:");
      out.push(...changes);
    }
  }

  const below = rows.filter((row) => row.status !== "ok");
  const failing = !reportOnly && (below.length > 0 || unloadedFiles.length > 0 || notBuiltFiles.length > 0);
  const counts = `${below.length} metric(s) below a floor, ${unloadedFiles.length} unloaded file(s), ${notBuiltFiles.length} not built file(s)`;
  if (suiteCode !== 0) {
    out.push(`coverage: suite failed with exit code ${suiteCode}; the table above comes from that run (${counts})`);
  } else if (reportOnly) {
    out.push(`coverage: report-only run, no floor enforced (${counts})`);
  } else if (failing) {
    out.push(`coverage: FAILED (${counts})`);
  } else {
    out.push("coverage: ok, every metric is at or above its floor and every source file is loaded");
  }
  // The suite's own failure wins over every coverage verdict.
  return finish(suiteCode !== 0 ? suiteCode : failing ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, output } = await runCheck(process.argv.slice(2));
  process.stdout.write(output);
  process.exitCode = code;
}
