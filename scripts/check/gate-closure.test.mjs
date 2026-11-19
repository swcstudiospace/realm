import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { FORBIDDEN_MODULES, gateClosure, gateViolations, specifiersOf } from "./gate-closure.mjs";

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

test("a dynamic import after a division that follows an increment is still followed", async () => {
  await withFixture(
    {
      "src/core/policy.ts":
        'export async function sample(samples: number): Promise<number> {\n  return samples++ / (await import("./helper.js")).limit;\n}\nexport const gate = sample;\n',
      "src/core/helper.ts": "export const limit = 2;\n",
    },
    async (root) => {
      const { modules, unresolved } = gateClosure({ root, entries: ["src/core/policy.ts"] });
      assert.deepEqual(unresolved, []);
      assert.deepEqual([...modules.keys()].sort(), ["src/core/helper.ts", "src/core/policy.ts"]);
    },
  );
});

test("an import written inside a template literal's text is not followed", async () => {
  await withFixture(
    {
      "src/core/policy.ts": 'export const doc = `Use import("./optional.js") here`;\nexport const gate = doc;\n',
    },
    async (root) => {
      const { modules, unresolved } = gateClosure({ root, entries: ["src/core/policy.ts"] });
      assert.deepEqual(unresolved, []);
      assert.deepEqual([...modules.keys()], ["src/core/policy.ts"]);
    },
  );
});

test("import text inside string literals and comments is not read as an import, and a real import after them is followed", async () => {
  await withFixture(
    {
      "src/core/policy.ts": [
        'export const help = "Use import(\'./optional.js\') here and import { x } from \'./also-missing.js\'";',
        '// import { y } from "./comment-missing.js";',
        '/* import("./block-missing.js") */',
        'import { load } from "./loader.js";',
        "export const gate = load;",
        "",
      ].join("\n"),
      "src/core/loader.ts": 'import { spawn } from "node:child_process";\nexport const load = spawn;\n',
    },
    async (root) => {
      const { modules, unresolved } = gateClosure({ root, entries: ["src/core/policy.ts"] });
      assert.deepEqual(unresolved, []);
      assert.deepEqual([...modules.keys()].sort(), ["src/core/loader.ts", "src/core/policy.ts"]);
      const violations = gateViolations({ root, entries: ["src/core/policy.ts"], forbidden: [] });
      assert.deepEqual(
        violations.map((violation) => violation.chain),
        [["src/core/policy.ts", "src/core/loader.ts"]],
      );
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

test("the forbidden list names the daemon launch module beside the CLI entry", () => {
  assert.ok(FORBIDDEN_MODULES.includes("src/daemon/launch.ts"));
  assert.ok(FORBIDDEN_MODULES.includes("src/cli/main.ts"));
});

test("a closure that reaches the daemon launch module is reported with its import chain", async () => {
  await withFixture(
    {
      "src/core/policy.ts": 'import { start } from "../daemon/launch.js";\nexport const gate = start;\n',
      "src/daemon/launch.ts": "export const start = 1;\n",
    },
    async (root) => {
      const violations = gateViolations({ root, entries: ["src/core/policy.ts"], forbidden: FORBIDDEN_MODULES });
      assert.equal(violations.length, 1);
      assert.equal(violations[0].module, "src/daemon/launch.ts");
      assert.deepEqual(violations[0].chain, ["src/core/policy.ts", "src/daemon/launch.ts"]);
      assert.equal(violations[0].reason, "is a module the exec gate must not reach");
    },
  );
});

test("the gate counts type-only imports and the value-only walk leaves them out", async () => {
  const source = 'import type { A } from "./a.js";\nimport { b } from "./b.js";\nexport type { C } from "./c.js";\nexport const x = b;\n';
  assert.deepEqual(specifiersOf(source), ["./a.js", "./b.js", "./c.js"]);
  assert.deepEqual(specifiersOf(source, "module.ts", { valueOnly: true }), ["./b.js"]);
  await withFixture(
    {
      "src/core/policy.ts": 'import type { Shape } from "./shape.js";\nexport const gate: Shape | undefined = undefined;\n',
      "src/core/shape.ts": 'import { spawn } from "node:child_process";\nexport type Shape = typeof spawn;\n',
    },
    async (root) => {
      const entries = ["src/core/policy.ts"];
      assert.equal(gateViolations({ root, entries, forbidden: [] }).length, 1);
      assert.deepEqual([...gateClosure({ root, entries }).modules.keys()].sort(), ["src/core/policy.ts", "src/core/shape.ts"]);
      assert.deepEqual([...gateClosure({ root, entries, valueOnly: true }).modules.keys()], ["src/core/policy.ts"]);
    },
  );
});
