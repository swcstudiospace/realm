import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MAX_MUTANTS, findMutations, runCampaign, testsFor } from "./run.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SAMPLE = `const spare = true;
export function accept(n: number, enabled: boolean): boolean {
  if (enabled === true && n > 0) {
    return true;
  }
  return false;
}
`;

const SAMPLE_TEST = `import assert from "node:assert/strict";
import { test } from "node:test";
import { accept } from "../src/sample.js";

test("accepts only a positive enabled value", () => {
  assert.equal(accept(1, true), true);
  assert.equal(accept(1, false), false);
  assert.equal(accept(0, true), false);
});
`;

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "rootDir": ".",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
`;

test("finds boolean, relational, and numeric boundary sites", () => {
  const descriptions = findMutations(SAMPLE).map((site) => site.description);
  assert.equal(descriptions.some((text) => text.startsWith("boolean flip true -> false")), true);
  assert.equal(descriptions.some((text) => text.startsWith("relational operator flip > -> <")), true);
  assert.equal(descriptions.some((text) => text.startsWith("numeric boundary off-by-one 0 -> 1")), true);
  assert.equal(MAX_MUTANTS, 12);
});

test("filesystem mutants run compiled test files from the sandbox", async () => {
  const root = await mkdtemp(join(tmpdir(), "realm-mutation-tests-"));
  try {
    await mkdir(join(root, "dist/test/fs"), { recursive: true });
    await writeFile(join(root, "dist/test/fs/write.test.js"), "");
    await writeFile(join(root, "dist/test/fs/notes.md"), "");
    assert.deepEqual(testsFor("src/fs/root.ts", root), [join(root, "dist/test/fs/write.test.js")]);
    assert.equal(testsFor("src/fs/root.ts", join(root, "absent")).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("kills a known mutant and writes the report shape from a fixture", async () => {
  const root = await mkdtemp(join(tmpdir(), "realm-mutation-fixture-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "test"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    await writeFile(join(root, "tsconfig.json"), TSCONFIG);
    await writeFile(join(root, "src", "sample.ts"), SAMPLE);
    await writeFile(join(root, "test", "sample.test.ts"), SAMPLE_TEST);
    await symlink(join(REPO_ROOT, "node_modules"), join(root, "node_modules"));

    const reportPath = join(root, "mutation-report.json");
    const report = await runCampaign({
      root,
      reportPath,
      files: ["src/sample.ts"],
      timeoutMs: 60_000,
    });

    assert.equal(await readFile(join(root, "src", "sample.ts"), "utf8"), SAMPLE);
    assert.equal(report.mutants.length <= MAX_MUTANTS, true);
    const killed = report.mutants.find((row) => row.description.includes("boolean flip true -> false at line 4"));
    assert.ok(killed, "expected the known boolean mutant to be reported");
    assert.equal(killed.status, "killed");
    const survivor = report.mutants.find((row) => row.description.includes("boolean flip true -> false at line 1"));
    assert.ok(survivor, "expected the uncovered boolean mutant to be reported");
    assert.equal(survivor.status, "survived");
    assert.equal(report.compileError, 0);
    assert.equal(report.error, 0);
    assert.equal(killed.file, "src/sample.ts");
    assert.equal(typeof killed.description, "string");
    assert.equal(report.killed, report.mutants.filter((row) => row.status === "killed").length);
    assert.equal(typeof report.survived, "number");
    assert.equal(typeof report.timedOut, "number");
    const written = JSON.parse(await readFile(reportPath, "utf8"));
    assert.deepEqual(written, report);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a missing compiler is a compile error, not a kill", async () => {
  const root = await mkdtemp(join(tmpdir(), "realm-mutation-nocompile-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "test"), { recursive: true });
    await mkdir(join(root, "node_modules"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    await writeFile(join(root, "tsconfig.json"), TSCONFIG);
    await writeFile(join(root, "src", "sample.ts"), SAMPLE);
    const report = await runCampaign({ root, files: ["src/sample.ts"], timeoutMs: 20_000 });
    assert.equal(report.killed, 0);
    assert.equal(report.compileError, 1);
    assert.equal(report.mutants[0]?.status, "compileError");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a failing unmutated test is a baseline failure, not a kill", async () => {
  const root = await mkdtemp(join(tmpdir(), "realm-mutation-baseline-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "test"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    await writeFile(join(root, "tsconfig.json"), TSCONFIG);
    await writeFile(join(root, "src", "sample.ts"), SAMPLE);
    await writeFile(join(root, "test", "sample.test.ts"), "import { test } from \"node:test\";\ntest(\"fails\", () => { throw new Error(\"baseline\"); });\n");
    await symlink(join(REPO_ROOT, "node_modules"), join(root, "node_modules"));
    const report = await runCampaign({ root, files: ["src/sample.ts"], timeoutMs: 60_000 });
    assert.equal(report.killed, 0);
    assert.equal(report.baselineFailed, 1);
    assert.equal(report.mutants[0]?.status, "baselineFailed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mutation CLI reports baseline failure but does not fail for a survivor", async () => {
  const root = await mkdtemp(join(tmpdir(), "realm-mutation-cli-"));
  try {
    await mkdir(join(root, "src/core"), { recursive: true });
    await mkdir(join(root, "src/audit"), { recursive: true });
    await mkdir(join(root, "test/core"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    await writeFile(join(root, "tsconfig.json"), TSCONFIG);
    await writeFile(join(root, "src/core/policy.ts"), SAMPLE);
    await writeFile(join(root, "src/audit/redact.ts"), "export const value = 42;\n");
    const policyTest = SAMPLE_TEST.replace("../src/sample.js", "../../src/core/policy.js");
    for (const name of ["policy.test.ts", "policy.property.test.ts", "policy.schema.test.ts"]) {
      await writeFile(join(root, "test/core", name), policyTest);
    }
    await mkdir(join(root, "node_modules"));
    const script = fileURLToPath(new URL("./run.mjs", import.meta.url));
    const reportPath = join(root, "report.json");
    const run = () => spawnSync(process.execPath, [script, "--root", root, "--report", reportPath, "--cap", "1"], {
      encoding: "utf8",
      timeout: 90_000,
    });

    const broken = run();
    assert.equal(broken.error, undefined);
    assert.equal(broken.status, 1, broken.stderr);
    const failedReport = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(failedReport.mutants[0].stage, "baselineCompile");

    await rm(join(root, "node_modules"), { recursive: true });
    await symlink(join(REPO_ROOT, "node_modules"), join(root, "node_modules"));
    const healthy = run();
    assert.equal(healthy.error, undefined);
    assert.equal(healthy.status, 0, healthy.stderr);
    const passedReport = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(passedReport.survived, 1);
    assert.equal(passedReport.mutants[0].stage, "test");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("controlled subprocess outcomes preserve stages, identities and aggregate counts", async () => {
  const root = await mkdtemp(join(tmpdir(), "realm-mutation-controlled-"));
  const ok = { code: 0, timedOut: false };
  const fail = { code: 1, timedOut: false };
  const timeout = { code: null, timedOut: true };
  const results = [ok, ok, fail, timeout, ok, fail, ok, ok, ok, timeout, ok, { code: null, timedOut: false }, ok];
  let calls = 0;
  let sandbox;
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "test"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    await writeFile(join(root, "tsconfig.json"), TSCONFIG);
    const source = `${SAMPLE}\nconst extra = true;\n`;
    await writeFile(join(root, "src/sample.ts"), source);
    const report = await runCampaign({
      root, files: ["src/sample.ts"], cap: 7,
      runProcess: async (_command, _args, cwd) => {
        sandbox = cwd;
        if (calls === 0) {
          await mkdir(join(cwd, "dist/test"), { recursive: true });
          await writeFile(join(cwd, "dist/test/sample.test.js"), "");
        }
        // The last successfully compiled mutant has no mapped test.
        if (calls === 12) {
          await rm(join(cwd, "dist/test/sample.test.js"));
        }
        const result = results[calls];
        calls += 1;
        assert.ok(result, "unexpected subprocess");
        return result;
      },
    });
    assert.deepEqual(report.mutants.map(({ status, stage, outcome }) => [status, stage, outcome]), [
      ["compileError", "compile", "failed"],
      ["timedOut", "compile", "timedOut"],
      ["killed", "test", "failed"],
      ["survived", "test", "passed"],
      ["timedOut", "test", "timedOut"],
      ["error", "test", "processError"],
      ["untested", "test", "missingTests"],
    ]);
    assert.deepEqual(
      [report.killed, report.survived, report.timedOut, report.untested, report.compileError, report.baselineFailed, report.error],
      [1, 1, 2, 1, 1, 0, 1],
    );
    assert.equal(calls, results.length);
    for (const row of report.mutants) {
      assert.equal(row.file, "src/sample.ts");
      assert.ok(row.description);
    }
    assert.equal(await readFile(join(root, "src/sample.ts"), "utf8"), source);
    await assert.rejects(readFile(join(sandbox, "src/sample.ts")));
    assert.deepEqual(JSON.parse(await readFile(join(root, "mutation-report.json"), "utf8")), report);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("baseline compile and test timeouts are distinct from mutant outcomes", async () => {
  const root = await mkdtemp(join(tmpdir(), "realm-mutation-baseline-controlled-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "test"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    await writeFile(join(root, "tsconfig.json"), TSCONFIG);
    await writeFile(join(root, "src/sample.ts"), SAMPLE);
    const timeout = { code: null, timedOut: true };
    const compileReport = await runCampaign({ root, files: ["src/sample.ts"], runProcess: async () => timeout });
    assert.equal(compileReport.killed, 0);
    assert.deepEqual([compileReport.mutants[0].stage, compileReport.mutants[0].outcome], ["baselineCompile", "timedOut"]);
    let calls = 0;
    const testReport = await runCampaign({
      root, files: ["src/sample.ts"],
      runProcess: async (_command, _args, cwd) => {
        if (calls++ === 0) {
          await mkdir(join(cwd, "dist/test"), { recursive: true });
          await writeFile(join(cwd, "dist/test/sample.test.js"), "");
          return { code: 0, timedOut: false };
        }
        return timeout;
      },
    });
    assert.equal(testReport.killed, 0);
    assert.equal(testReport.baselineFailed, 1);
    assert.deepEqual([testReport.mutants[0].stage, testReport.mutants[0].outcome], ["baselineTest", "timedOut"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

