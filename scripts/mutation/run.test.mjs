import assert from "node:assert/strict";
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
