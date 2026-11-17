// TEST-HOST-02: the registry is complete and agrees with the table. Node runs each test file in its own process, so a runtime registry filled
// by defineHostRecipeSuite could not be read here (26-CONTEXT F2): completeness is checked against files. The registry names each host's
// suite files; this test reads them, strips comments (a grep over raw source matches a define call inside a comment) and requires a
// defineHost...Suite( call and the host id as a string literal. It lists every problem at once. HOST_LIVE and LIVE_HOST_IDS are imported
// for names only: no gate variable is set and no process starts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import { HOST_IDS, type HostId, type HostRuntimeEntry } from "../../src/host/types.js";
import { HOST_LIVE, LIVE_HOST_IDS } from "../support/host-live.js";
import { HOST_REGISTRY, codeOnly, type RegistryRecord } from "../support/host-registry.js";

// The repository root, found the way manifest.test.ts finds package.json: from the compiled test file, three directories up.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const DEFINE_SUITE_CALL = /\bdefineHost(?:Recipe|Toml|Yaml)Suite\s*\(/;
const QUOTES = ["'", '"', "`"];
// Suite files that hold hand-written tests instead of a define call: they are checked for existence and for the host id as a literal only.
// omp-recipe.test.ts is the Omp recipe's own tests (the bundle-copy kind has no shared suite); shadows.test.ts covers the CodeBuddy shadow guard
// on fixture rows, next to the real-row suite of codebuddy-recipe.test.ts.
const HAND_WRITTEN_SUITES: readonly string[] = ["test/host/omp-recipe.test.ts", "test/host/shadows.test.ts"];

type RegistryLike = Readonly<Record<string, RegistryRecord | undefined>>;

// Every way the registry disagrees with the table or with the repository, as `ID: what`.
export function registryProblems(registry: RegistryLike, table: Readonly<Record<HostId, HostRuntimeEntry>>, root: string): string[] {
  const problems: string[] = [];
  for (const id of HOST_IDS) {
    const record = registry[id];
    if (record === undefined) {
      problems.push(`${id}: no registry record`);
      continue;
    }
    if (record.id !== id) {
      problems.push(`${id}: the record names ${record.id}`);
    }
    const recipe = table[id].recipe;
    const family = recipe === null ? "none" : recipe.kind;
    if (record.family !== family) {
      problems.push(`${id}: family ${record.family} differs from the table (${family})`);
    }
    if (record.snippet === "" || !existsSync(join(root, "docs", "hosts", "snippets", record.snippet))) {
      problems.push(`${id}: snippet ${record.snippet} does not exist`);
    }
    if (recipe === null) {
      if (record.suites.length > 0) {
        problems.push(`${id}: a deferred host lists suite files`);
      }
      if (record.deferral === null) {
        problems.push(`${id}: a host without a recipe has no deferral`);
      }
    } else {
      if (record.deferral !== null) {
        problems.push(`${id}: a host with a recipe has a deferral`);
      }
      if (record.suites.length === 0) {
        problems.push(`${id}: no suite file`);
      }
    }
    for (const suite of record.suites) {
      const path = join(root, suite);
      if (!existsSync(path)) {
        problems.push(`${id}: suite file ${suite} does not exist`);
        continue;
      }
      const code = codeOnly(readFileSync(path, "utf8"));
      if (!HAND_WRITTEN_SUITES.includes(suite) && !DEFINE_SUITE_CALL.test(code)) {
        problems.push(`${id}: ${suite} has no defineHost...Suite( call`);
      }
      if (!QUOTES.some((quote) => code.includes(`${quote}${id}${quote}`))) {
        problems.push(`${id}: ${suite} does not name the host id as a string literal`);
      }
    }
    if (id === "omp" && (record.suites.length !== 1 || record.suites[0] !== "test/host/omp-recipe.test.ts")) {
      problems.push(`${id}: the suite is test/host/omp-recipe.test.ts`);
    }
    if (record.live !== null && (record.live !== id || !LIVE_HOST_IDS.includes(record.live) || !(record.live in HOST_LIVE))) {
      problems.push(`${id}: live ${record.live} is not this host's key in HOST_LIVE`);
    }
    if (record.t2 !== null && [record.t2.date, record.t2.version, record.t2.result, record.t2.command].some((value) => value.trim() === "")) {
      problems.push(`${id}: a recorded T2 result has an empty field`);
    }
  }
  for (const live of LIVE_HOST_IDS) {
    const record = registry[live];
    if (record !== undefined && record.live !== live) {
      problems.push(`${live}: HOST_LIVE has a spec but the registry says live ${String(record.live)}`);
    }
  }
  return problems;
}

void test("TEST-HOST-02: the registry is complete and agrees with the table", () => {
  const problems = registryProblems(HOST_REGISTRY, HOST_RUNTIMES, REPO_ROOT);
  assert.equal(problems.length, 0, `registry problems: ${problems.join("; ")}`);
});

void test("TEST-HOST-02: the registry keys are exactly the host ids", () => {
  assert.deepEqual(Object.keys(HOST_REGISTRY).sort(), [...HOST_IDS].sort());
});

void test("TEST-HOST-02: codeOnly removes a define call that only appears in a comment and keeps one in code", () => {
  const source = [
    "/* defineHostRecipeSuite(blockCommented); */",
    "// defineHostTomlSuite(lineCommented);",
    "  // defineHostYamlSuite(indentedLineCommented);",
    "defineHostRecipeSuite(real); // a trailing comment stays",
    '/* spans',
    "   defineHostYamlSuite(two); lines */",
  ].join("\n");
  const code = codeOnly(source);
  assert.equal(code.includes("blockCommented"), false);
  assert.equal(code.includes("lineCommented"), false);
  assert.equal(code.includes("indentedLineCommented"), false);
  assert.equal(code.includes("two"), false);
  assert.equal(DEFINE_SUITE_CALL.test(code), true);
  assert.equal(code.includes("real"), true);
  assert.equal(code.includes("a trailing comment stays"), true);
  assert.equal(DEFINE_SUITE_CALL.test(codeOnly("// defineHostRecipeSuite(x)\n/* defineHostTomlSuite(y) */")), false);
});

void test("TEST-HOST-02: an injected registry with one host deleted, one family changed and one suite path wrong reports exactly those three problems", () => {
  const broken: Record<string, RegistryRecord> = {};
  for (const id of HOST_IDS) {
    if (id !== "cursor") {
      broken[id] = HOST_REGISTRY[id];
    }
  }
  broken["claude"] = { ...HOST_REGISTRY.claude, family: "toml-table" };
  broken["codex"] = { ...HOST_REGISTRY.codex, suites: ["test/host/codex-recipe-typo.test.ts"] };
  const problems = registryProblems(broken, HOST_RUNTIMES, REPO_ROOT);
  assert.deepEqual(problems, [
    "claude: family toml-table differs from the table (json-merge)",
    "codex: suite file test/host/codex-recipe-typo.test.ts does not exist",
    "cursor: no registry record",
  ]);
});

void test("TEST-HOST-02: a wrong snippet, a deferral on a recipe host, a suite on a deferred host, a live spec the registry denies and an empty T2 field are each named", () => {
  const broken: Record<string, RegistryRecord> = {};
  for (const id of HOST_IDS) {
    broken[id] = HOST_REGISTRY[id];
  }
  broken["pi"] = { ...HOST_REGISTRY.pi, snippet: "no-such-page.md", deferral: { reason: "r", openQuestion: "q" } };
  // zcode: it lists a suite (a deferred host has none), has no deferral, and the suite file does not name the host.
  broken["zcode"] = { ...HOST_REGISTRY.zcode, suites: ["test/host/omp-recipe.test.ts"], deferral: null };
  // claude: HOST_LIVE has a spec the registry denies, and the recorded T2 has an empty date.
  broken["claude"] = { ...HOST_REGISTRY.claude, live: null, t2: { date: "", version: "2.1.322", result: "x", command: "y" } };
  const problems = registryProblems(broken, HOST_RUNTIMES, REPO_ROOT);
  const named = (id: string): string[] => problems.filter((problem) => problem.startsWith(`${id}:`));
  assert.equal(named("pi").length, 2, named("pi").join("; "));
  assert.equal(named("zcode").length, 3, named("zcode").join("; "));
  assert.equal(named("claude").length, 2, named("claude").join("; "));
  assert.equal(problems.length, 7, problems.join("; "));
});
