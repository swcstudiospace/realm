import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { gateClosure, gateViolations } from "./gate-closure.mjs";

async function withFixture(files, run) {
  const root = await mkdtemp(join(tmpdir(), "gate-closure-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const target = join(root, relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("a child_process import reached through a helper is reported with its import chain", async () => {
  await withFixture(
    {
      "src/core/policy.ts": 'import { run } from "./helper.js";\nexport const gate = run;\n',
      "src/core/helper.ts": 'import { spawn } from "node:child_process";\nexport const run = spawn;\n',
    },
    async (root) => {
      const violations = gateViolations({ root, entries: ["src/core/policy.ts"], forbidden: [] });
      assert.equal(violations.length, 1);
      assert.equal(violations[0].module, "src/core/helper.ts");
      assert.deepEqual(violations[0].chain, ["src/core/policy.ts", "src/core/helper.ts"]);
      assert.equal(violations[0].reason, "imports node:child_process");
    },
  );
});

test("a relative import written with a .js specifier resolves to the .ts source in the closure", async () => {
  await withFixture(
    {
      "src/core/policy.ts": 'import { size } from "../util/size.js";\nexport const gate = size;\n',
      "src/util/size.ts": "export const size = 1;\n",
    },
    async (root) => {
      const { modules, unresolved } = gateClosure({ root, entries: ["src/core/policy.ts"] });
      assert.deepEqual([...modules.keys()].sort(), ["src/core/policy.ts", "src/util/size.ts"]);
      assert.deepEqual(unresolved, []);
    },
  );
});

test("an entry whose closure has only safe imports reports nothing", async () => {
  await withFixture(
    {
      "src/core/policy.ts": 'import { value } from "./states.js";\nimport type { Shape } from "./shape.js";\nexport const gate = value;\n',
      "src/core/states.ts": 'import { fail } from "./errors.js";\nexport const value = fail;\n',
      "src/core/errors.ts": "export const fail = 0;\n",
      "src/core/shape.ts": "export type Shape = { readonly a: number };\n",
    },
    async (root) => {
      const violations = gateViolations({ root, entries: ["src/core/policy.ts"], forbidden: [] });
      assert.deepEqual(violations, []);
    },
  );
});

test("a dynamic import of child_process from a closure module is reported", async () => {
  await withFixture(
    {
      "src/core/policy.ts": 'import { load } from "./loader.js";\nexport const gate = load;\n',
      "src/core/loader.ts": 'export async function load() {\n  return import("node:child_process");\n}\n',
    },
    async (root) => {
      const violations = gateViolations({ root, entries: ["src/core/policy.ts"], forbidden: [] });
      assert.equal(violations.length, 1);
      assert.equal(violations[0].module, "src/core/loader.ts");
      assert.deepEqual(violations[0].chain, ["src/core/policy.ts", "src/core/loader.ts"]);
    },
  );
});

test("a dynamic import that reaches a forbidden module is reported", async () => {
  await withFixture(
    {
      "src/core/policy.ts": 'export async function gate() {\n  return import("../doctor/checks.js");\n}\n',
      "src/doctor/checks.ts": "export const checks = 1;\n",
    },
    async (root) => {
      const violations = gateViolations({
        root,
        entries: ["src/core/policy.ts"],
        forbidden: ["src/doctor/checks.ts"],
      });
      assert.equal(violations.length, 1);
      assert.equal(violations[0].module, "src/doctor/checks.ts");
      assert.deepEqual(violations[0].chain, ["src/core/policy.ts", "src/doctor/checks.ts"]);
    },
  );
});
